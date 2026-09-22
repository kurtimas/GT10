import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@shared/api/queries/connection";
import {
  attachments,
  auditLog,
  binCleanouts,
  binGradeOverrides,
  binMovements,
  bins,
  certificates,
  dprSnapshots,
  eodReports,
  farmers,
  fumigationLogs,
  gradeFactors,
  gradingSchedules,
  labResults,
  landlords,
  loads,
  loadSplits,
  lots,
  physicalCounts,
  sheetEvents,
  shipments,
  shrinkEntries,
  sites,
  syncLog,
  weightSheets,
} from "@db/schema";

// ---------------------------------------------------------------------------
// Main-office sync RECEIVER — plain Hono endpoints (not tRPC) that the scale
// houses push their end-of-day packages to, and pull office-mastered people
// data from. All writes are idempotent: re-receiving the same package
// upserts headers and rebuilds loads instead of duplicating rows.
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof getDb>;
/** An open transaction on the shared db handle (same shape routers use). */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// --------------------------------------------------------------- sync auth
// FAIL-CLOSED: with no SYNC_KEY configured the receiver refuses every sync
// request (503), in every environment — an unauthenticated receiver is a
// silent write-hole into the mirrored production data. The key is compared
// via sha256 + timingSafeEqual so the header can't be probed byte-by-byte.
const NO_KEY_MESSAGE =
  "SYNC_KEY is not configured on this office server — refusing all sync " +
  "requests. Set SYNC_KEY in the office environment and the same value in " +
  "each scale house's sync settings.";

export function syncKeyConfigured(): boolean {
  return (process.env.SYNC_KEY ?? "").trim() !== "";
}

function checkSyncKey(header: string | undefined): { ok: boolean; status: 401 | 503; message: string } {
  const expected = (process.env.SYNC_KEY ?? "").trim();
  if (!expected) return { ok: false, status: 503, message: NO_KEY_MESSAGE };
  const given = createHash("sha256").update(header ?? "").digest();
  const want = createHash("sha256").update(expected).digest();
  return timingSafeEqual(given, want)
    ? { ok: true, status: 401, message: "" }
    : { ok: false, status: 401, message: "bad sync key" };
}

// ------------------------------------------------------------- payload types
type PersonPayload = { name: string; phone: string | null; email?: string | null };
type LotPayload = {
  code: string;
  farmerName: string | null;
  landlordName: string | null;
  crop: string;
  landlordSplitPct: number;
  status: "OPEN" | "CLOSED";
  // Phase A fields (Phase B2; absent from older plants)
  program?: string;
  practices?: string | null;
  carbonNotes?: string | null;
  notes: string | null;
};
type BinPayload = {
  name: string;
  crop: string;
  capacityLbs: number;
  currentLbs: number;
  program?: string; // Phase A (Phase B2; absent from older plants)
};
// Phase B (#4): farmer/landlord shares of a load. Nested in the load payload
// and rebuilt wholesale with it — the mirror never updates splits in place.
type SplitPayload = {
  partyType: string; // farmer | landlord
  partyName: string | null;
  splitPct: number;
};
type LoadPayload = {
  loadNo: number;
  truckId: string | null;
  driverName: string | null;
  binName: string | null;
  grossLbs: number | null;
  tareLbs: number | null;
  netLbs: number | null;
  grossAt: string | null;
  tareAt: string | null;
  moisturePct: number | null;
  dockagePct: number | null;
  testWeightLbs: number | null;
  proteinPct: number | null;
  // enriched intake + void markers (Phase 3/4; absent from older plants)
  damagePct?: number | null;
  grade?: string | null;
  farmOrigin?: string | null;
  // Phase A/B columns (Phase B2; absent from older plants)
  foreignMaterialPct?: number | null;
  sbPct?: number | null;
  program?: string;
  shrinkLbs?: number | null;
  dockLbs?: number | null;
  splits?: SplitPayload[];
  shrinkPct: number | null;
  grossBushels: number | null;
  netBushels: number | null;
  voidedAt?: string | null;
  voidReason?: string | null;
};
type SheetPayload = {
  ticketNo: string;
  farmerName: string | null;
  lotCode: string | null;
  landlordName: string | null;
  crop: string;
  direction: "INBOUND" | "OUTBOUND";
  status: "OPEN" | "FULL" | "CLOSED";
  closeReason: string | null;
  maxLoads: number;
  createdAt: string;
  closedAt: string | null;
  voidedAt?: string | null;
  voidReason?: string | null;
  loads: LoadPayload[];
};
// Phase 4 streams. References arrive as natural keys (lot code / bin name /
// sheet ticket + loadNo) because the mirror assigns its own ids for those.
type BinMovementPayload = {
  id: number; // plant row id — the idempotency key
  lotCode: string | null;
  fromBinName: string | null;
  toBinName: string | null;
  quantityLbs: number;
  loadTicketNo: string | null;
  loadNo: number | null;
  shipmentId: number | null; // plant shipment id
  operator: string | null;
  note: string | null;
  createdAt: string;
};
type ShipmentPayload = {
  id: number; // plant row id — the idempotency key
  customerName: string;
  destination: string | null;
  lotCode: string | null;
  binName: string | null;
  quantityLbs: number;
  quantityBu: number | null;
  truckId: string | null;
  note: string | null;
  createdAt: string;
};
type AuditLogPayload = {
  id: number; // plant row id — the idempotency key
  actor: string;
  action: string;
  entityType: string;
  entityId: number; // plant-side entity id (raw mirror, not re-keyed)
  beforeJson: string | null;
  afterJson: string | null;
  note: string | null;
  createdAt: string;
};
// Phase B2 sections — same semantics as the Phase-4 streams: the plant row
// id is the idempotency key, references travel as natural keys and are
// re-keyed to mirror ids on receive.
type GradingSchedulePayload = {
  id: number;
  siteScoped: boolean; // false = plant-wide default row (siteId null)
  crop: string;
  moistureShrinkPerPoint: number;
  baseMoisturePct: number;
  handlingShrinkPct: number;
  dockageRules: string | null;
  createdAt: string;
  updatedAt: string;
};
type GradeFactorPayload = {
  id: number;
  siteScoped: boolean;
  crop: string;
  gradeClass: string;
  factor: string;
  minValue: number | null;
  maxValue: number | null;
  createdAt: string;
  updatedAt: string;
};
type CleanoutPayload = {
  id: number;
  binName: string | null;
  emptiedAt: string;
  cleanedAt: string | null;
  method: string | null;
  note: string | null;
  operator: string | null;
  createdAt: string;
  updatedAt: string;
};
type FumigationPayload = {
  id: number;
  binName: string | null;
  product: string;
  dosage: string | null;
  appliedAt: string;
  exposureHours: number | null;
  aerationClearedAt: string | null;
  applicator: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};
type CertificatePayload = {
  id: number;
  type: string;
  certNumber: string;
  issuedAt: string;
  status: string; // issued | reprinted | void
  lotCode: string | null;
  shipmentId: number | null; // plant shipment id — re-keyed on receive
  note: string | null;
  fileRef: string | null;
  createdAt: string;
  updatedAt: string;
};
type LabResultPayload = {
  id: number;
  sampleDate: string;
  labName: string | null;
  testType: string;
  result: string | null;
  passFail: string | null;
  lotCode: string | null;
  loadTicketNo: string | null;
  loadNo: number | null;
  binName: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};
// METADATA ONLY — attachment binaries never leave the plant; the office
// mirrors the row so the portal can show that a document exists.
type AttachmentPayload = {
  id: number;
  entityType: string;
  entityId: number; // plant-side id (raw mirror, like audit_log.entityId)
  filename: string;
  mime: string | null;
  size: number | null;
  storageRef: string | null;
  uploadedBy: string | null;
  createdAt: string;
};
type ShrinkEntryPayload = {
  id: number;
  binName: string | null;
  kind: string;
  quantityLbs: number; // signed
  effectiveDate: string;
  note: string | null;
  operator: string | null;
  createdAt: string;
};
type GradeOverridePayload = {
  id: number;
  binName: string | null;
  factor: string;
  value: number;
  reason: string;
  operator: string | null;
  createdAt: string;
};
type DprSnapshotPayload = {
  id: number;
  day: string; // YYYY-MM-DD
  crop: string;
  program: string;
  openingLbs: number;
  receivedLbs: number;
  receivedBu: number;
  shippedLbs: number;
  shippedBu: number;
  transfersInLbs: number;
  transfersOutLbs: number;
  shrinkMoistureLbs: number;
  shrinkHandlingLbs: number;
  shrinkAerationLbs: number;
  shrinkErrorCorrectionLbs: number;
  adjustmentsLbs: number;
  endingLbs: number;
  endingBu: number;
  frozen: boolean;
  createdAt: string;
};
type PhysicalCountPayload = {
  id: number;
  binName: string | null;
  countedLbs: number;
  countedAt: string;
  note: string | null;
  operator: string | null;
  createdAt: string;
};
type EodPackage = {
  site: { name: string; location: string | null };
  day: string;
  farmers: PersonPayload[];
  landlords: PersonPayload[];
  lots: LotPayload[];
  bins: BinPayload[];
  sheets: SheetPayload[];
  binMovements?: BinMovementPayload[];
  shipments?: ShipmentPayload[];
  auditLog?: AuditLogPayload[];
  gradingSchedules?: GradingSchedulePayload[];
  gradeFactors?: GradeFactorPayload[];
  cleanouts?: CleanoutPayload[];
  fumigations?: FumigationPayload[];
  certificates?: CertificatePayload[];
  labResults?: LabResultPayload[];
  attachments?: AttachmentPayload[];
  shrinkEntries?: ShrinkEntryPayload[];
  gradeOverrides?: GradeOverridePayload[];
  dprSnapshots?: DprSnapshotPayload[];
  physicalCounts?: PhysicalCountPayload[];
  totals: {
    sheetsOpened: number;
    loadCount: number;
    completedCount: number;
    inboundLbs: number;
    outboundLbs: number;
    inboundBu: number;
    outboundBu: number;
  };
};

const toDate = (v: string | null | undefined) => (v ? new Date(v) : null);

async function logReceive(db: Db, status: "OK" | "ERROR", detail: string) {
  try {
    await db.insert(syncLog).values({ direction: "RECEIVE", status, detail });
  } catch (err) {
    console.error("[sync] failed to write sync_log:", err);
  }
}

// ----------------------------------------------------------- upsert helpers
async function upsertSite(db: Tx, name: string, location: string | null) {
  const existing = await db.query.sites.findFirst({ where: eq(sites.name, name) });
  if (existing) {
    await db.update(sites).set({ location }).where(eq(sites.id, existing.id));
    return existing.id;
  }
  const [{ id }] = await db.insert(sites).values({ name, location }).$returningId();
  return id;
}

async function upsertFarmer(db: Tx, p: PersonPayload) {
  const existing = await db.query.farmers.findFirst({ where: eq(farmers.name, p.name) });
  if (existing) {
    await db
      .update(farmers)
      .set({ phone: p.phone ?? null, email: p.email ?? null })
      .where(eq(farmers.id, existing.id));
    return existing.id;
  }
  const [{ id }] = await db
    .insert(farmers)
    .values({ name: p.name, phone: p.phone ?? null, email: p.email ?? null })
    .$returningId();
  return id;
}

async function upsertLandlord(db: Tx, p: PersonPayload) {
  const existing = await db.query.landlords.findFirst({ where: eq(landlords.name, p.name) });
  if (existing) {
    await db.update(landlords).set({ phone: p.phone ?? null }).where(eq(landlords.id, existing.id));
    return existing.id;
  }
  const [{ id }] = await db
    .insert(landlords)
    .values({ name: p.name, phone: p.phone ?? null })
    .$returningId();
  return id;
}

// ----------------------------------------------------- Phase-4 stream upserts
// Shipments / bin_movements / audit_log are append-only on the plant and
// carry the PLANT's row id as the idempotency key: re-receiving a package
// updates the row instead of duplicating it. When two separate plant
// instances push to one office their id series collide; in that case the
// row belonging to another site is left alone and our copy is found by
// content (site + createdAt + distinguishing fields) or inserted fresh.

type ShipmentValues = {
  siteId: number;
  customerName: string;
  destination: string | null;
  lotId: number | null;
  binId: number | null;
  quantityLbs: number;
  quantityBu: number | null;
  truckId: string | null;
  note: string | null;
  createdAt: Date;
};

async function upsertShipment(db: Tx, plantId: number, values: ShipmentValues): Promise<number> {
  const byId = await db.query.shipments.findFirst({ where: eq(shipments.id, plantId) });
  if (byId && byId.siteId === values.siteId) {
    await db.update(shipments).set(values).where(eq(shipments.id, byId.id));
    return byId.id;
  }
  if (!byId) {
    const [{ id }] = await db.insert(shipments).values({ id: plantId, ...values }).$returningId();
    return id;
  }
  // id belongs to another site instance — find our copy by content
  const dupe = await db.query.shipments.findFirst({
    where: and(
      eq(shipments.siteId, values.siteId),
      eq(shipments.createdAt, values.createdAt),
      eq(shipments.quantityLbs, values.quantityLbs),
      eq(shipments.customerName, values.customerName),
    ),
  });
  if (dupe) {
    await db.update(shipments).set(values).where(eq(shipments.id, dupe.id));
    return dupe.id;
  }
  const [{ id }] = await db.insert(shipments).values(values).$returningId();
  return id;
}

type MovementValues = {
  siteId: number;
  lotId: number | null;
  fromBinId: number | null;
  toBinId: number | null;
  quantityLbs: number;
  loadId: number | null;
  shipmentId: number | null;
  operator: string | null;
  note: string | null;
  createdAt: Date;
};

async function upsertMovement(db: Tx, plantId: number, values: MovementValues): Promise<number> {
  const byId = await db.query.binMovements.findFirst({ where: eq(binMovements.id, plantId) });
  if (byId && byId.siteId === values.siteId) {
    await db.update(binMovements).set(values).where(eq(binMovements.id, byId.id));
    return byId.id;
  }
  if (!byId) {
    const [{ id }] = await db
      .insert(binMovements)
      .values({ id: plantId, ...values })
      .$returningId();
    return id;
  }
  const dupe = await db.query.binMovements.findFirst({
    where: and(
      eq(binMovements.siteId, values.siteId),
      eq(binMovements.createdAt, values.createdAt),
      eq(binMovements.quantityLbs, values.quantityLbs),
    ),
  });
  if (dupe) {
    await db.update(binMovements).set(values).where(eq(binMovements.id, dupe.id));
    return dupe.id;
  }
  const [{ id }] = await db.insert(binMovements).values(values).$returningId();
  return id;
}

async function upsertAudit(db: Tx, plantId: number, a: AuditLogPayload): Promise<void> {
  const createdAt = toDate(a.createdAt) ?? new Date();
  const values = {
    actor: a.actor,
    action: a.action,
    entityType: a.entityType,
    entityId: a.entityId,
    beforeJson: a.beforeJson ?? null,
    afterJson: a.afterJson ?? null,
    note: a.note ?? null,
    createdAt,
  };
  const byId = await db.query.auditLog.findFirst({ where: eq(auditLog.id, plantId) });
  if (
    byId &&
    byId.entityType === a.entityType &&
    byId.action === a.action &&
    byId.createdAt.getTime() === createdAt.getTime()
  ) {
    await db.update(auditLog).set(values).where(eq(auditLog.id, byId.id));
    return;
  }
  if (!byId) {
    await db.insert(auditLog).values({ id: plantId, ...values });
    return;
  }
  // id belongs to another plant instance — dedupe by content
  const dupe = await db.query.auditLog.findFirst({
    where: and(
      eq(auditLog.createdAt, createdAt),
      eq(auditLog.entityType, a.entityType),
      eq(auditLog.entityId, a.entityId),
      eq(auditLog.action, a.action),
      eq(auditLog.actor, a.actor),
    ),
  });
  if (!dupe) await db.insert(auditLog).values(values);
}

// ----------------------------------------------------- Phase-B2 stream upserts
// Same idempotency rule as the Phase-4 streams: the plant row id is the key;
// when that id is already taken by ANOTHER site instance, our copy is found
// by content (site + distinguishing fields) or inserted fresh. `plantWide`
// covers grading config rows whose siteId is null on every instance — for
// those, a null-siteId row at the plant id is treated as "ours".
/* eslint-disable @typescript-eslint/no-explicit-any */
async function upsertByPlantId(
  db: Tx,
  cfg: {
    table: any;
    idCol: any;
    plantId: number;
    siteId: number;
    plantWide: boolean;
    values: Record<string, unknown>;
    findById: (id: number) => Promise<{ id: number; siteId: number | null } | undefined>;
    findByContent: () => Promise<{ id: number } | undefined>;
  },
): Promise<number> {
  const byId = await cfg.findById(cfg.plantId);
  const isOurs = (r: { siteId: number | null }) =>
    cfg.plantWide ? r.siteId == null : r.siteId === cfg.siteId;
  if (byId && isOurs(byId)) {
    await db.update(cfg.table).set(cfg.values).where(eq(cfg.idCol, byId.id));
    return byId.id;
  }
  if (!byId) {
    const [{ id }] = await db
      .insert(cfg.table)
      .values({ id: cfg.plantId, ...cfg.values })
      .$returningId();
    return id;
  }
  const dupe = await cfg.findByContent();
  if (dupe) {
    await db.update(cfg.table).set(cfg.values).where(eq(cfg.idCol, dupe.id));
    return dupe.id;
  }
  const [{ id }] = await db.insert(cfg.table).values(cfg.values).$returningId();
  return id;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Resolve a movement's load reference (sheet ticket + loadNo) to the mirrored load id. */
async function resolveMirroredLoadId(
  db: Tx,
  siteId: number,
  ticketNo: string | null,
  loadNo: number | null,
): Promise<number | null> {
  if (!ticketNo || loadNo == null) return null;
  const suffixed = `${ticketNo}@S${siteId}`.slice(0, 32);
  const sheet = await db.query.weightSheets.findFirst({
    where: and(
      eq(weightSheets.siteId, siteId),
      inArray(weightSheets.ticketNo, [ticketNo, suffixed]),
    ),
  });
  if (!sheet) return null;
  const load = await db.query.loads.findFirst({
    where: and(eq(loads.sheetId, sheet.id), eq(loads.loadNo, loadNo)),
  });
  return load?.id ?? null;
}

// ------------------------------------------------------------- receive EOD
// Exported for the router-level tests (office/api/syncReceiver.test.ts).
export type { EodPackage };
export async function receiveEod(pkg: EodPackage) {
  const db = getDb();
  if (!pkg?.site?.name) throw new Error("Invalid package: site.name is required");
  if (!pkg?.day) throw new Error("Invalid package: day is required");

  // The whole import runs in ONE transaction: each sheet's mirrored loads are
  // deleted then re-inserted, so a mid-package failure (bad row, DB hiccup,
  // restart) must roll back rather than leave a sheet mirrored with zero
  // loads until the next successful push.
  const {
    sheetCount, loadCount, shipmentCount, movementCount, auditCount,
    gradingCount, cleanoutCount, fumigationCount, certificateCount,
    labResultCount, attachmentCount, shrinkCount, overrideCount,
    physicalCountCount, dprCount,
  } = await db.transaction(async (tx) => {
  // 1. site
  const siteId = await upsertSite(tx, pkg.site.name, pkg.site.location ?? null);

  // 2. people + lots (name-keyed masters)
  const farmerIdByName = new Map<string, number>();
  for (const f of pkg.farmers ?? []) farmerIdByName.set(f.name, await upsertFarmer(tx, f));
  const landlordIdByName = new Map<string, number>();
  for (const l of pkg.landlords ?? []) landlordIdByName.set(l.name, await upsertLandlord(tx, l));

  const lotIdByCode = new Map<string, number>();
  for (const lot of pkg.lots ?? []) {
    const farmerId = lot.farmerName ? farmerIdByName.get(lot.farmerName) : undefined;
    if (!farmerId) continue; // lot references a farmer not in the package — skip
    const landlordId =
      lot.landlordName != null ? (landlordIdByName.get(lot.landlordName) ?? null) : null;
    const existing = await tx.query.lots.findFirst({ where: eq(lots.code, lot.code) });
    const patch = {
      farmerId,
      landlordId,
      crop: lot.crop,
      landlordSplitPct: lot.landlordSplitPct,
      status: lot.status,
      // Phase A fields (Phase B2; absent from older plants — keep mirror values)
      ...(lot.program !== undefined ? { program: lot.program } : {}),
      ...(lot.practices !== undefined ? { practices: lot.practices ?? null } : {}),
      ...(lot.carbonNotes !== undefined ? { carbonNotes: lot.carbonNotes ?? null } : {}),
      notes: lot.notes ?? null,
      ...(lot.status === "CLOSED" ? {} : { closedAt: null as Date | null }),
    };
    if (existing) {
      await tx.update(lots).set(patch).where(eq(lots.id, existing.id));
      lotIdByCode.set(lot.code, existing.id);
    } else {
      const [{ id }] = await tx
        .insert(lots)
        .values({ code: lot.code, closedAt: lot.status === "CLOSED" ? new Date() : null, ...patch })
        .$returningId();
      lotIdByCode.set(lot.code, id);
    }
  }

  // 3. bins (per site)
  const binIdByName = new Map<string, number>();
  for (const b of pkg.bins ?? []) {
    const existing = await tx.query.bins.findFirst({
      where: and(eq(bins.siteId, siteId), eq(bins.name, b.name)),
    });
    const patch = {
      crop: b.crop,
      capacityLbs: b.capacityLbs,
      currentLbs: b.currentLbs,
      // Phase A field (Phase B2; absent from older plants — keep mirror value)
      ...(b.program !== undefined ? { program: b.program } : {}),
    };
    if (existing) {
      await tx.update(bins).set(patch).where(eq(bins.id, existing.id));
      binIdByName.set(b.name, existing.id);
    } else {
      const [{ id }] = await tx.insert(bins).values({ siteId, name: b.name, ...patch }).$returningId();
      binIdByName.set(b.name, id);
    }
  }

  // 4. sheets — upsert header by (siteId, ticketNo), then rebuild loads
  let sheetCount = 0;
  let loadCount = 0;
  for (const s of pkg.sheets ?? []) {
    if (!s.ticketNo) continue;
    let farmerId = s.farmerName ? farmerIdByName.get(s.farmerName) : undefined;
    if (!farmerId) {
      // farmer wasn't in the package — mirror with a stub so the sheet still
      // lands instead of erroring the whole upload
      const stubName = s.farmerName ?? `Unknown (${s.ticketNo})`;
      farmerId = await upsertFarmer(tx, { name: stubName, phone: null });
      farmerIdByName.set(stubName, farmerId);
    }
    const resolvedFarmerId = farmerId;
    const lotId = s.lotCode ? (lotIdByCode.get(s.lotCode) ?? null) : null;
    const landlordId =
      s.landlordName != null ? (landlordIdByName.get(s.landlordName) ?? null) : null;

    // A previous upload may have stored this ticket under its disambiguated
    // `@S<siteId>` key (ticketNo is globally unique and can clash across site
    // instances) — match BOTH keys so re-uploads update instead of colliding.
    const suffixed = `${s.ticketNo}@S${siteId}`.slice(0, 32);
    const existing = await tx.query.weightSheets.findFirst({
      where: and(
        eq(weightSheets.siteId, siteId),
        inArray(weightSheets.ticketNo, [s.ticketNo, suffixed]),
      ),
    });
    const header = {
      farmerId: resolvedFarmerId,
      lotId,
      landlordId,
      crop: s.crop,
      direction: s.direction,
      status: s.status,
      closeReason: s.closeReason ?? null,
      maxLoads: s.maxLoads ?? 10,
      createdAt: toDate(s.createdAt) ?? new Date(),
      closedAt: toDate(s.closedAt),
      voidedAt: toDate(s.voidedAt),
      voidReason: s.voidReason ?? null,
    };

    let sheetId: number;
    if (existing) {
      await tx.update(weightSheets).set(header).where(eq(weightSheets.id, existing.id));
      sheetId = existing.id;
      // replace mirrored rows wholesale — keeps re-uploads clean. Splits ride
      // inside the load payload (Phase B2), so they must be cleared with the
      // loads they reference or every re-upload would stack another set.
      const oldLoadIds = (
        await tx.select({ id: loads.id }).from(loads).where(eq(loads.sheetId, sheetId))
      ).map((l) => l.id);
      if (oldLoadIds.length) {
        await tx.delete(loadSplits).where(inArray(loadSplits.loadId, oldLoadIds));
      }
      await tx.delete(loads).where(eq(loads.sheetId, sheetId));
      await tx.delete(sheetEvents).where(eq(sheetEvents.sheetId, sheetId));
    } else {
      // ticketNo is globally unique in the shared schema; a collision with a
      // DIFFERENT site means two site instances reuse the same ticket series —
      // disambiguate deterministically instead of failing the upload.
      let ticketNo = s.ticketNo;
      const clash = await tx.query.weightSheets.findFirst({
        where: eq(weightSheets.ticketNo, ticketNo),
      });
      if (clash) {
        ticketNo = suffixed;
        console.warn(
          `[sync] ticket ${s.ticketNo} already exists at another site — stored as ${ticketNo}`,
        );
      }
      const [{ id }] = await tx
        .insert(weightSheets)
        .values({ ticketNo, siteId, notes: null, ...header })
        .$returningId();
      sheetId = id;
    }

    for (const l of s.loads ?? []) {
      const [{ id: mirroredLoadId }] = await tx
        .insert(loads)
        .values({
          sheetId,
          loadNo: l.loadNo,
          truckId: l.truckId ?? null,
          driverName: l.driverName ?? null,
          binId: l.binName ? (binIdByName.get(l.binName) ?? null) : null,
          grossLbs: l.grossLbs ?? null,
          tareLbs: l.tareLbs ?? null,
          netLbs: l.netLbs ?? null,
          grossAt: toDate(l.grossAt),
          tareAt: toDate(l.tareAt),
          moisturePct: l.moisturePct ?? null,
          dockagePct: l.dockagePct ?? null,
          testWeightLbs: l.testWeightLbs ?? null,
          proteinPct: l.proteinPct ?? null,
          damagePct: l.damagePct ?? null,
          grade: l.grade ?? null,
          farmOrigin: l.farmOrigin ?? null,
          // Phase A/B columns (Phase B2; absent from older plants)
          foreignMaterialPct: l.foreignMaterialPct ?? null,
          sbPct: l.sbPct ?? null,
          ...(l.program !== undefined ? { program: l.program } : {}),
          shrinkLbs: l.shrinkLbs ?? null,
          dockLbs: l.dockLbs ?? null,
          shrinkPct: l.shrinkPct ?? null,
          grossBushels: l.grossBushels ?? null,
          netBushels: l.netBushels ?? null,
          voidedAt: toDate(l.voidedAt),
          voidReason: l.voidReason ?? null,
          createdAt: toDate(l.grossAt) ?? toDate(l.tareAt) ?? toDate(s.createdAt) ?? new Date(),
        })
        .$returningId();
      // Phase B (#4): the load's split set rides inside its payload and is
      // rebuilt with it — wholesale replacement keeps re-uploads clean.
      // Parties are name-keyed; an unknown name gets a stub person (same rule
      // as sheet headers) so the upload never errors on a missing master row.
      for (const sp of l.splits ?? []) {
        if (!sp.partyName) continue;
        let partyId: number | undefined;
        if (sp.partyType === "landlord") {
          partyId = landlordIdByName.get(sp.partyName);
          if (!partyId) {
            partyId = await upsertLandlord(tx, { name: sp.partyName, phone: null });
            landlordIdByName.set(sp.partyName, partyId);
          }
        } else {
          partyId = farmerIdByName.get(sp.partyName);
          if (!partyId) {
            partyId = await upsertFarmer(tx, { name: sp.partyName, phone: null });
            farmerIdByName.set(sp.partyName, partyId);
          }
        }
        await tx.insert(loadSplits).values({
          loadId: mirroredLoadId,
          partyType: sp.partyType,
          partyId,
          splitPct: sp.splitPct,
        });
      }
      loadCount += 1;
    }
    await tx.insert(sheetEvents).values({
      sheetId,
      action: "SYNC_RECEIVED",
      detail: `Mirrored from ${pkg.site.name} (${pkg.day})`,
      createdAt: new Date(),
    });
    sheetCount += 1;
  }

  // 4b. shipments — upsert by plant row id; references re-keyed to mirror ids
  let shipmentCount = 0;
  const shipmentIdByPlantId = new Map<number, number>();
  for (const sp of pkg.shipments ?? []) {
    const officeId = await upsertShipment(tx, sp.id, {
      siteId,
      customerName: sp.customerName,
      destination: sp.destination ?? null,
      lotId: sp.lotCode ? (lotIdByCode.get(sp.lotCode) ?? null) : null,
      binId: sp.binName ? (binIdByName.get(sp.binName) ?? null) : null,
      quantityLbs: sp.quantityLbs,
      quantityBu: sp.quantityBu ?? null,
      truckId: sp.truckId ?? null,
      note: sp.note ?? null,
      createdAt: toDate(sp.createdAt) ?? new Date(),
    });
    shipmentIdByPlantId.set(sp.id, officeId);
    shipmentCount += 1;
  }

  // 4c. bin_movements — the provenance stream
  let movementCount = 0;
  for (const m of pkg.binMovements ?? []) {
    await upsertMovement(tx, m.id, {
      siteId,
      lotId: m.lotCode ? (lotIdByCode.get(m.lotCode) ?? null) : null,
      fromBinId: m.fromBinName ? (binIdByName.get(m.fromBinName) ?? null) : null,
      toBinId: m.toBinName ? (binIdByName.get(m.toBinName) ?? null) : null,
      quantityLbs: m.quantityLbs,
      loadId: await resolveMirroredLoadId(tx, siteId, m.loadTicketNo, m.loadNo),
      shipmentId: m.shipmentId != null ? (shipmentIdByPlantId.get(m.shipmentId) ?? null) : null,
      operator: m.operator ?? null,
      note: m.note ?? null,
      createdAt: toDate(m.createdAt) ?? new Date(),
    });
    movementCount += 1;
  }

  // 4d. audit_log — raw mirror (entity ids stay plant-side)
  let auditCount = 0;
  for (const a of pkg.auditLog ?? []) {
    await upsertAudit(tx, a.id, a);
    auditCount += 1;
  }

  // ---- Phase B2 sections (all upsert by plant row id, content-key fallback)
  // 4e. grading config (plant-wide rows keep siteId null)
  let gradingCount = 0;
  for (const g of pkg.gradingSchedules ?? []) {
    const rowSiteId = g.siteScoped ? siteId : null;
    const values = {
      siteId: rowSiteId,
      crop: g.crop,
      moistureShrinkPerPoint: g.moistureShrinkPerPoint,
      baseMoisturePct: g.baseMoisturePct,
      handlingShrinkPct: g.handlingShrinkPct,
      dockageRules: g.dockageRules ?? null,
      createdAt: toDate(g.createdAt) ?? new Date(),
      updatedAt: toDate(g.updatedAt) ?? new Date(),
    };
    await upsertByPlantId(tx, {
      table: gradingSchedules,
      idCol: gradingSchedules.id,
      plantId: g.id,
      siteId,
      plantWide: !g.siteScoped,
      values,
      findById: (id) => tx.query.gradingSchedules.findFirst({ where: eq(gradingSchedules.id, id) }),
      findByContent: () =>
        tx.query.gradingSchedules.findFirst({
          where:
            rowSiteId == null
              ? and(isNull(gradingSchedules.siteId), eq(gradingSchedules.crop, g.crop))
              : and(eq(gradingSchedules.siteId, rowSiteId), eq(gradingSchedules.crop, g.crop)),
        }),
    });
    gradingCount += 1;
  }
  for (const f of pkg.gradeFactors ?? []) {
    const rowSiteId = f.siteScoped ? siteId : null;
    const values = {
      siteId: rowSiteId,
      crop: f.crop,
      gradeClass: f.gradeClass,
      factor: f.factor,
      minValue: f.minValue ?? null,
      maxValue: f.maxValue ?? null,
      createdAt: toDate(f.createdAt) ?? new Date(),
      updatedAt: toDate(f.updatedAt) ?? new Date(),
    };
    await upsertByPlantId(tx, {
      table: gradeFactors,
      idCol: gradeFactors.id,
      plantId: f.id,
      siteId,
      plantWide: !f.siteScoped,
      values,
      findById: (id) => tx.query.gradeFactors.findFirst({ where: eq(gradeFactors.id, id) }),
      findByContent: () =>
        tx.query.gradeFactors.findFirst({
          where: and(
            rowSiteId == null ? isNull(gradeFactors.siteId) : eq(gradeFactors.siteId, rowSiteId),
            eq(gradeFactors.crop, f.crop),
            eq(gradeFactors.gradeClass, f.gradeClass),
            eq(gradeFactors.factor, f.factor),
          ),
        }),
    });
    gradingCount += 1;
  }

  // 4f. cleanouts / fumigations / certificates / lab results
  let cleanoutCount = 0;
  for (const r of pkg.cleanouts ?? []) {
    const binId = r.binName ? (binIdByName.get(r.binName) ?? null) : null;
    if (!binId) continue; // bin not mirrored for this site — skip
    const values = {
      siteId,
      binId,
      emptiedAt: toDate(r.emptiedAt) ?? new Date(),
      cleanedAt: toDate(r.cleanedAt),
      method: r.method ?? null,
      note: r.note ?? null,
      operator: r.operator ?? null,
      createdAt: toDate(r.createdAt) ?? new Date(),
      updatedAt: toDate(r.updatedAt) ?? new Date(),
    };
    await upsertByPlantId(tx, {
      table: binCleanouts,
      idCol: binCleanouts.id,
      plantId: r.id,
      siteId,
      plantWide: false,
      values,
      findById: (id) => tx.query.binCleanouts.findFirst({ where: eq(binCleanouts.id, id) }),
      findByContent: () =>
        tx.query.binCleanouts.findFirst({
          where: and(
            eq(binCleanouts.siteId, siteId),
            eq(binCleanouts.binId, binId),
            eq(binCleanouts.emptiedAt, values.emptiedAt),
          ),
        }),
    });
    cleanoutCount += 1;
  }

  let fumigationCount = 0;
  for (const r of pkg.fumigations ?? []) {
    const binId = r.binName ? (binIdByName.get(r.binName) ?? null) : null;
    if (!binId) continue;
    const values = {
      siteId,
      binId,
      product: r.product,
      dosage: r.dosage ?? null,
      appliedAt: toDate(r.appliedAt) ?? new Date(),
      exposureHours: r.exposureHours ?? null,
      aerationClearedAt: toDate(r.aerationClearedAt),
      applicator: r.applicator ?? null,
      note: r.note ?? null,
      createdAt: toDate(r.createdAt) ?? new Date(),
      updatedAt: toDate(r.updatedAt) ?? new Date(),
    };
    await upsertByPlantId(tx, {
      table: fumigationLogs,
      idCol: fumigationLogs.id,
      plantId: r.id,
      siteId,
      plantWide: false,
      values,
      findById: (id) => tx.query.fumigationLogs.findFirst({ where: eq(fumigationLogs.id, id) }),
      findByContent: () =>
        tx.query.fumigationLogs.findFirst({
          where: and(
            eq(fumigationLogs.siteId, siteId),
            eq(fumigationLogs.binId, binId),
            eq(fumigationLogs.appliedAt, values.appliedAt),
            eq(fumigationLogs.product, r.product),
          ),
        }),
    });
    fumigationCount += 1;
  }

  let certificateCount = 0;
  for (const r of pkg.certificates ?? []) {
    // shipmentId references the PLANT's shipment id — re-key to the mirrored
    // row (this package's map first, then an already-mirrored row at that id)
    let shipmentId: number | null = null;
    if (r.shipmentId != null) {
      shipmentId = shipmentIdByPlantId.get(r.shipmentId) ?? null;
      if (shipmentId == null) {
        const prior = await tx.query.shipments.findFirst({
          where: and(eq(shipments.id, r.shipmentId), eq(shipments.siteId, siteId)),
        });
        shipmentId = prior?.id ?? null;
      }
    }
    const values = {
      siteId,
      type: r.type,
      certNumber: r.certNumber,
      issuedAt: toDate(r.issuedAt) ?? new Date(),
      status: r.status,
      lotId: r.lotCode ? (lotIdByCode.get(r.lotCode) ?? null) : null,
      shipmentId,
      note: r.note ?? null,
      fileRef: r.fileRef ?? null,
      createdAt: toDate(r.createdAt) ?? new Date(),
      updatedAt: toDate(r.updatedAt) ?? new Date(),
    };
    await upsertByPlantId(tx, {
      table: certificates,
      idCol: certificates.id,
      plantId: r.id,
      siteId,
      plantWide: false,
      values,
      findById: (id) => tx.query.certificates.findFirst({ where: eq(certificates.id, id) }),
      findByContent: () =>
        tx.query.certificates.findFirst({
          where: and(
            eq(certificates.siteId, siteId),
            eq(certificates.certNumber, r.certNumber),
            eq(certificates.issuedAt, values.issuedAt),
          ),
        }),
    });
    certificateCount += 1;
  }

  let labResultCount = 0;
  for (const r of pkg.labResults ?? []) {
    const values = {
      siteId,
      sampleDate: toDate(r.sampleDate) ?? new Date(),
      labName: r.labName ?? null,
      testType: r.testType,
      result: r.result ?? null,
      passFail: r.passFail ?? null,
      lotId: r.lotCode ? (lotIdByCode.get(r.lotCode) ?? null) : null,
      loadId: await resolveMirroredLoadId(tx, siteId, r.loadTicketNo, r.loadNo),
      binId: r.binName ? (binIdByName.get(r.binName) ?? null) : null,
      note: r.note ?? null,
      createdAt: toDate(r.createdAt) ?? new Date(),
      updatedAt: toDate(r.updatedAt) ?? new Date(),
    };
    await upsertByPlantId(tx, {
      table: labResults,
      idCol: labResults.id,
      plantId: r.id,
      siteId,
      plantWide: false,
      values,
      findById: (id) => tx.query.labResults.findFirst({ where: eq(labResults.id, id) }),
      findByContent: () =>
        tx.query.labResults.findFirst({
          where: and(
            eq(labResults.siteId, siteId),
            eq(labResults.sampleDate, values.sampleDate),
            eq(labResults.testType, r.testType),
          ),
        }),
    });
    labResultCount += 1;
  }

  // 4g. attachment METADATA (binaries stay plant-side); entityId stays the
  // raw plant-side id, like audit_log.entityId
  let attachmentCount = 0;
  for (const r of pkg.attachments ?? []) {
    const values = {
      siteId,
      entityType: r.entityType,
      entityId: r.entityId,
      filename: r.filename,
      mime: r.mime ?? null,
      size: r.size ?? null,
      storageRef: r.storageRef ?? "",
      uploadedBy: r.uploadedBy ?? null,
      createdAt: toDate(r.createdAt) ?? new Date(),
    };
    await upsertByPlantId(tx, {
      table: attachments,
      idCol: attachments.id,
      plantId: r.id,
      siteId,
      plantWide: false,
      values,
      findById: (id) => tx.query.attachments.findFirst({ where: eq(attachments.id, id) }),
      findByContent: () =>
        tx.query.attachments.findFirst({
          where: and(
            eq(attachments.siteId, siteId),
            eq(attachments.entityType, r.entityType),
            eq(attachments.entityId, r.entityId),
            eq(attachments.filename, r.filename),
          ),
        }),
    });
    attachmentCount += 1;
  }

  // 4h. shrink entries / grade overrides / physical counts (append-only)
  let shrinkCount = 0;
  for (const r of pkg.shrinkEntries ?? []) {
    const binId = r.binName ? (binIdByName.get(r.binName) ?? null) : null;
    if (!binId) continue;
    const values = {
      siteId,
      binId,
      kind: r.kind,
      quantityLbs: r.quantityLbs,
      effectiveDate: toDate(r.effectiveDate) ?? new Date(),
      note: r.note ?? null,
      operator: r.operator ?? null,
      createdAt: toDate(r.createdAt) ?? new Date(),
    };
    await upsertByPlantId(tx, {
      table: shrinkEntries,
      idCol: shrinkEntries.id,
      plantId: r.id,
      siteId,
      plantWide: false,
      values,
      findById: (id) => tx.query.shrinkEntries.findFirst({ where: eq(shrinkEntries.id, id) }),
      findByContent: () =>
        tx.query.shrinkEntries.findFirst({
          where: and(
            eq(shrinkEntries.siteId, siteId),
            eq(shrinkEntries.binId, binId),
            eq(shrinkEntries.effectiveDate, values.effectiveDate),
            eq(shrinkEntries.kind, r.kind),
            eq(shrinkEntries.quantityLbs, r.quantityLbs),
          ),
        }),
    });
    shrinkCount += 1;
  }

  let overrideCount = 0;
  for (const r of pkg.gradeOverrides ?? []) {
    const binId = r.binName ? (binIdByName.get(r.binName) ?? null) : null;
    if (!binId) continue;
    const values = {
      siteId,
      binId,
      factor: r.factor,
      value: r.value,
      reason: r.reason,
      operator: r.operator ?? null,
      createdAt: toDate(r.createdAt) ?? new Date(),
    };
    await upsertByPlantId(tx, {
      table: binGradeOverrides,
      idCol: binGradeOverrides.id,
      plantId: r.id,
      siteId,
      plantWide: false,
      values,
      findById: (id) => tx.query.binGradeOverrides.findFirst({ where: eq(binGradeOverrides.id, id) }),
      findByContent: () =>
        tx.query.binGradeOverrides.findFirst({
          where: and(
            eq(binGradeOverrides.siteId, siteId),
            eq(binGradeOverrides.binId, binId),
            eq(binGradeOverrides.factor, r.factor),
            eq(binGradeOverrides.createdAt, values.createdAt),
          ),
        }),
    });
    overrideCount += 1;
  }

  let physicalCountCount = 0;
  for (const r of pkg.physicalCounts ?? []) {
    const binId = r.binName ? (binIdByName.get(r.binName) ?? null) : null;
    if (!binId) continue;
    const values = {
      siteId,
      binId,
      countedLbs: r.countedLbs,
      countedAt: toDate(r.countedAt) ?? new Date(),
      note: r.note ?? null,
      operator: r.operator ?? null,
      createdAt: toDate(r.createdAt) ?? new Date(),
    };
    await upsertByPlantId(tx, {
      table: physicalCounts,
      idCol: physicalCounts.id,
      plantId: r.id,
      siteId,
      plantWide: false,
      values,
      findById: (id) => tx.query.physicalCounts.findFirst({ where: eq(physicalCounts.id, id) }),
      findByContent: () =>
        tx.query.physicalCounts.findFirst({
          where: and(
            eq(physicalCounts.siteId, siteId),
            eq(physicalCounts.binId, binId),
            eq(physicalCounts.countedAt, values.countedAt),
          ),
        }),
    });
    physicalCountCount += 1;
  }

  // 4i. DPR snapshots — the natural key (site, day, crop, program) is unique,
  // so the content fallback IS the natural key; frozen rows are immutable
  // plant-side, but a re-received package still upserts harmlessly.
  let dprCount = 0;
  for (const r of pkg.dprSnapshots ?? []) {
    const values = {
      siteId,
      day: r.day,
      crop: r.crop,
      program: r.program,
      openingLbs: r.openingLbs,
      receivedLbs: r.receivedLbs,
      receivedBu: r.receivedBu,
      shippedLbs: r.shippedLbs,
      shippedBu: r.shippedBu,
      transfersInLbs: r.transfersInLbs,
      transfersOutLbs: r.transfersOutLbs,
      shrinkMoistureLbs: r.shrinkMoistureLbs,
      shrinkHandlingLbs: r.shrinkHandlingLbs,
      shrinkAerationLbs: r.shrinkAerationLbs,
      shrinkErrorCorrectionLbs: r.shrinkErrorCorrectionLbs,
      adjustmentsLbs: r.adjustmentsLbs,
      endingLbs: r.endingLbs,
      endingBu: r.endingBu,
      frozen: r.frozen,
      createdAt: toDate(r.createdAt) ?? new Date(),
    };
    await upsertByPlantId(tx, {
      table: dprSnapshots,
      idCol: dprSnapshots.id,
      plantId: r.id,
      siteId,
      plantWide: false,
      values,
      findById: (id) => tx.query.dprSnapshots.findFirst({ where: eq(dprSnapshots.id, id) }),
      findByContent: () =>
        tx.query.dprSnapshots.findFirst({
          where: and(
            eq(dprSnapshots.siteId, siteId),
            eq(dprSnapshots.day, r.day),
            eq(dprSnapshots.crop, r.crop),
            eq(dprSnapshots.program, r.program),
          ),
        }),
    });
    dprCount += 1;
  }

  // 5. end-of-day totals per site/day
  const t = pkg.totals;
  const existingReport = await tx.query.eodReports.findFirst({
    where: and(eq(eodReports.siteId, siteId), eq(eodReports.day, pkg.day)),
  });
  const totalsRow = {
    sheetsOpened: t?.sheetsOpened ?? sheetCount,
    loadCount: t?.loadCount ?? loadCount,
    completedCount: t?.completedCount ?? 0,
    inboundLbs: t?.inboundLbs ?? 0,
    outboundLbs: t?.outboundLbs ?? 0,
    inboundBu: t?.inboundBu ?? 0,
    outboundBu: t?.outboundBu ?? 0,
  };
  if (existingReport) {
    await tx.update(eodReports).set(totalsRow).where(eq(eodReports.id, existingReport.id));
  } else {
    await tx.insert(eodReports).values({ siteId, day: pkg.day, ...totalsRow });
  }

  return {
    sheetCount, loadCount, shipmentCount, movementCount, auditCount,
    gradingCount, cleanoutCount, fumigationCount, certificateCount,
    labResultCount, attachmentCount, shrinkCount, overrideCount,
    physicalCountCount, dprCount,
  };
  });

  // 6. log
  await logReceive(
    db,
    "OK",
    `${pkg.site.name} ${pkg.day}: ${sheetCount} sheets / ${loadCount} loads / ${shipmentCount} shipments / ${movementCount} movements / ${auditCount} audit / ` +
      `${gradingCount} grading / ${cleanoutCount} cleanouts / ${fumigationCount} fumigations / ${certificateCount} certificates / ` +
      `${labResultCount} lab results / ${attachmentCount} attachments / ${shrinkCount} shrink / ${overrideCount} overrides / ${dprCount} dpr`,
  );
  return {
    sheets: sheetCount,
    loads: loadCount,
    shipments: shipmentCount,
    binMovements: movementCount,
    auditLog: auditCount,
    grading: gradingCount,
    cleanouts: cleanoutCount,
    fumigations: fumigationCount,
    certificates: certificateCount,
    labResults: labResultCount,
    attachments: attachmentCount,
    shrinkEntries: shrinkCount,
    gradeOverrides: overrideCount,
    physicalCounts: physicalCountCount,
    dprSnapshots: dprCount,
  };
}

// ------------------------------------------------------------------ routes
export const syncReceiver = new Hono();

syncReceiver.use("*", async (c, next) => {
  const auth = checkSyncKey(c.req.header("x-gt-sync-key"));
  if (!auth.ok) {
    return c.json({ error: auth.message }, auth.status);
  }
  return next();
});

syncReceiver.post("/eod", async (c) => {
  let pkg: EodPackage;
  try {
    pkg = (await c.req.json()) as EodPackage;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  try {
    const result = await receiveEod(pkg);
    return c.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync] EOD receive failed:", err);
    const label = pkg?.site?.name ? `${pkg.site.name} ${pkg?.day ?? ""}` : "unknown site";
    await logReceive(getDb(), "ERROR", `${label}: ${message}`);
    return c.json({ error: message }, 500);
  }
});

syncReceiver.get("/people", async (c) => {
  const db = getDb();
  const farmerRows = await db.select().from(farmers).orderBy(asc(farmers.name));
  const landlordRows = await db.select().from(landlords).orderBy(asc(landlords.name));
  const lotRows = await db
    .select({ lot: lots, farmerName: farmers.name, landlordName: landlords.name })
    .from(lots)
    .leftJoin(farmers, eq(lots.farmerId, farmers.id))
    .leftJoin(landlords, eq(lots.landlordId, landlords.id))
    .orderBy(asc(lots.code));
  return c.json({
    farmers: farmerRows.map((f) => ({ name: f.name, phone: f.phone, email: f.email })),
    landlords: landlordRows.map((l) => ({ name: l.name, phone: l.phone })),
    lots: lotRows.map((r) => ({
      code: r.lot.code,
      farmerName: r.farmerName,
      landlordName: r.landlordName,
      crop: r.lot.crop,
      landlordSplitPct: r.lot.landlordSplitPct,
      status: r.lot.status,
      program: r.lot.program,
      practices: r.lot.practices,
      carbonNotes: r.lot.carbonNotes,
      notes: r.lot.notes,
    })),
  });
});

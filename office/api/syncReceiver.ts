import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@shared/api/queries/connection";
import {
  auditLog,
  binMovements,
  bins,
  eodReports,
  farmers,
  landlords,
  loads,
  lots,
  sheetEvents,
  shipments,
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
  notes: string | null;
};
type BinPayload = { name: string; crop: string; capacityLbs: number; currentLbs: number };
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
  const { sheetCount, loadCount, shipmentCount, movementCount, auditCount } = await db.transaction(async (tx) => {
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
    const patch = { crop: b.crop, capacityLbs: b.capacityLbs, currentLbs: b.currentLbs };
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
      // replace mirrored rows wholesale — keeps re-uploads clean
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
      await tx.insert(loads).values({
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
        shrinkPct: l.shrinkPct ?? null,
        grossBushels: l.grossBushels ?? null,
        netBushels: l.netBushels ?? null,
        voidedAt: toDate(l.voidedAt),
        voidReason: l.voidReason ?? null,
        createdAt: toDate(l.grossAt) ?? toDate(l.tareAt) ?? toDate(s.createdAt) ?? new Date(),
      });
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

  return { sheetCount, loadCount, shipmentCount, movementCount, auditCount };
  });

  // 6. log
  await logReceive(
    db,
    "OK",
    `${pkg.site.name} ${pkg.day}: ${sheetCount} sheets / ${loadCount} loads / ${shipmentCount} shipments / ${movementCount} movements / ${auditCount} audit`,
  );
  return {
    sheets: sheetCount,
    loads: loadCount,
    shipments: shipmentCount,
    binMovements: movementCount,
    auditLog: auditCount,
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
      notes: r.lot.notes,
    })),
  });
});

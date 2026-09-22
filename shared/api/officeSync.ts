import { and, asc, eq, gte, inArray, isNull, lte, or, type Column } from "drizzle-orm";
import { getDb } from "./queries/connection";
import {
  attachments,
  auditLog,
  binCleanouts,
  binGradeOverrides,
  binMovements,
  bins,
  certificates,
  dprSnapshots,
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
  settings,
  shipments,
  shrinkEntries,
  sites,
  syncLog,
  weightSheets,
} from "../db/schema";
import { round2 } from "../contracts/grain";

// ---------------------------------------------------------------------------
// Main-office sync — this site pushes an end-of-day package (sheets, loads,
// bins, totals) to the office portal, and pulls office-mastered people/lots
// down. Sync NEVER blocks weighing: every failure is caught, written to
// sync_log, and reported to the caller as a summary.
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof getDb>;

export async function getSetting(db: Db, key: string): Promise<string> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, key) });
  return row?.value ?? "";
}

export async function setSetting(db: Db, key: string, value: string) {
  const existing = await db.query.settings.findFirst({ where: eq(settings.key, key) });
  if (existing) {
    await db.update(settings).set({ value }).where(eq(settings.key, key));
  } else {
    await db.insert(settings).values({ key, value });
  }
}

export async function logSync(
  db: Db,
  direction: "PUSH" | "PULL" | "RECEIVE",
  status: "OK" | "ERROR",
  detail: string,
) {
  await db.insert(syncLog).values({ direction, status, detail });
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function dayKey(d: Date) {
  const x = startOfDay(d);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Build the end-of-day package for one local site for one day. */
async function buildEodPackage(db: Db, siteId: number, day: Date, changedSince: Date | null) {
  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId) });
  if (!site) return null;
  const from = startOfDay(day);
  const to = endOfDay(day);

  // people snapshot (office keeps its master copy current from these)
  const farmerRows = await db.select().from(farmers).orderBy(asc(farmers.name));
  const landlordRows = await db.select().from(landlords).orderBy(asc(landlords.name));
  const lotRows = await db
    .select({ lot: lots, farmerName: farmers.name, landlordName: landlords.name })
    .from(lots)
    .leftJoin(farmers, eq(lots.farmerId, farmers.id))
    .leftJoin(landlords, eq(lots.landlordId, landlords.id));

  const binRows = await db
    .select()
    .from(bins)
    .where(eq(bins.siteId, siteId))
    .orderBy(asc(bins.name));

  // Sheets opened that day, plus any still open (carry-over context), PLUS
  // anything whose state changed since the last successful push — otherwise
  // a sheet opened yesterday and closed today satisfies neither rule and the
  // office mirror would keep it OPEN forever. "Changed" covers: closed since
  // the cursor (closedAt) and sheets that gained new loads since the cursor.
  let changedSheetIds: number[] = [];
  if (changedSince) {
    const changedLoads = await db
      .select({ sheetId: loads.sheetId })
      .from(loads)
      .innerJoin(weightSheets, eq(loads.sheetId, weightSheets.id))
      .where(and(eq(weightSheets.siteId, siteId), gte(loads.createdAt, changedSince)));
    // Phase B2: splits replaced on an old load must re-push its sheet too —
    // the receiver rebuilds a sheet's loads (and their splits) wholesale.
    const changedSplits = await db
      .select({ sheetId: loads.sheetId })
      .from(loadSplits)
      .innerJoin(loads, eq(loadSplits.loadId, loads.id))
      .innerJoin(weightSheets, eq(loads.sheetId, weightSheets.id))
      .where(and(eq(weightSheets.siteId, siteId), gte(loadSplits.createdAt, changedSince)));
    changedSheetIds = [
      ...new Set([...changedLoads.map((r) => r.sheetId), ...changedSplits.map((r) => r.sheetId)]),
    ];
  }
  const sheetRows = await db
    .select({
      sheet: weightSheets,
      farmerName: farmers.name,
      lotCode: lots.code,
      landlordName: landlords.name,
    })
    .from(weightSheets)
    .leftJoin(farmers, eq(weightSheets.farmerId, farmers.id))
    .leftJoin(lots, eq(weightSheets.lotId, lots.id))
    .leftJoin(landlords, eq(weightSheets.landlordId, landlords.id))
    .where(
      and(
        eq(weightSheets.siteId, siteId),
        or(
          and(gte(weightSheets.createdAt, from), lte(weightSheets.createdAt, to)),
          eq(weightSheets.status, "OPEN"),
          ...(changedSince ? [gte(weightSheets.closedAt, changedSince)] : []),
          ...(changedSheetIds.length ? [inArray(weightSheets.id, changedSheetIds)] : []),
        ),
      ),
    )
    .orderBy(asc(weightSheets.createdAt));

  const sheetIds = sheetRows.map((r) => r.sheet.id);
  const loadRows = sheetIds.length
    ? await db
        .select({ load: loads, binName: bins.name })
        .from(loads)
        .leftJoin(bins, eq(loads.binId, bins.id))
        .where(inArray(loads.sheetId, sheetIds))
        .orderBy(asc(loads.loadNo))
    : [];

  const loadsBySheet = new Map<number, typeof loadRows>();
  for (const r of loadRows) {
    const arr = loadsBySheet.get(r.load.sheetId) ?? [];
    arr.push(r);
    loadsBySheet.set(r.load.sheetId, arr);
  }

  // Phase B2: load splits ride INSIDE each load's payload (party as a name —
  // the office mirror re-keys it). The receiver rebuilds them wholesale with
  // the load rows, so re-pushes never leave dangling/orphan splits behind.
  const allLoadIds = loadRows.map((r) => r.load.id);
  const splitRows = allLoadIds.length
    ? await db.select().from(loadSplits).where(inArray(loadSplits.loadId, allLoadIds))
    : [];
  const farmerNameById = new Map(farmerRows.map((f) => [f.id, f.name]));
  const landlordNameById = new Map(landlordRows.map((l) => [l.id, l.name]));
  const splitsByLoadId = new Map<number, typeof splitRows>();
  for (const s of splitRows) {
    const arr = splitsByLoadId.get(s.loadId) ?? [];
    arr.push(s);
    splitsByLoadId.set(s.loadId, arr);
  }

  // totals mirror the daily report: loads weighed that day at this site.
  // Voided rows ride along in the payload (so the office mirror marks them
  // void too) but are excluded from every total.
  const liveLoads = loadRows.filter((r) => r.load.voidedAt == null);
  const dayLoads = liveLoads.filter(
    (r) => r.load.createdAt >= from && r.load.createdAt <= to,
  );
  const sheetsOpened = sheetRows.filter(
    (r) => r.sheet.createdAt >= from && r.sheet.createdAt <= to && r.sheet.voidedAt == null,
  );
  const done = dayLoads.filter((r) => r.load.netLbs != null);
  const dirOf = (sheetId: number) =>
    sheetRows.find((s) => s.sheet.id === sheetId)?.sheet.direction ?? "INBOUND";
  const inbound = done.filter((r) => dirOf(r.load.sheetId) === "INBOUND");
  const outbound = done.filter((r) => dirOf(r.load.sheetId) === "OUTBOUND");
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  // ---- Phase 4 streams: provenance events, shipments, audit trail.
  // All three tables are append-only, so "changed since cursor" is simply
  // createdAt >= cursor (re-uploads are idempotent on the receiver, which
  // upserts by the plant's row id).
  const movementRows = await db
    .select()
    .from(binMovements)
    .where(
      and(
        eq(binMovements.siteId, siteId),
        ...(changedSince ? [gte(binMovements.createdAt, changedSince)] : []),
      ),
    )
    .orderBy(asc(binMovements.createdAt), asc(binMovements.id));

  // resolve display references in JS (counts are modest)
  const lotCodeById = new Map(lotRows.map((r) => [r.lot.id, r.lot.code]));
  const binNameById = new Map(binRows.map((b) => [b.id, b.name]));
  const movementLoadIds = [
    ...new Set(movementRows.map((m) => m.loadId).filter((v): v is number => v != null)),
  ];
  const movementLoadInfo = movementLoadIds.length
    ? await db
        .select({ id: loads.id, loadNo: loads.loadNo, ticketNo: weightSheets.ticketNo })
        .from(loads)
        .innerJoin(weightSheets, eq(loads.sheetId, weightSheets.id))
        .where(inArray(loads.id, movementLoadIds))
    : [];
  const loadInfoById = new Map(movementLoadInfo.map((l) => [l.id, l]));

  const shipmentRows = await db
    .select()
    .from(shipments)
    .where(
      and(
        eq(shipments.siteId, siteId),
        ...(changedSince ? [gte(shipments.createdAt, changedSince)] : []),
      ),
    )
    .orderBy(asc(shipments.createdAt), asc(shipments.id));

  const auditRows = await db
    .select()
    .from(auditLog)
    .where(changedSince ? gte(auditLog.createdAt, changedSince) : undefined)
    .orderBy(asc(auditLog.createdAt), asc(auditLog.id));

  // ---- Phase B2 streams: grading config, cleanouts, fumigations,
  // certificates, lab results, attachment metadata, shrink entries, grade
  // overrides, DPR snapshots, physical counts.
  // Mutable registry tables (updatedAt exists) are selected by
  // createdAt OR updatedAt >= cursor; the append-only ones by createdAt.
  const touched = (createdCol: Column, updatedCol: Column) =>
    changedSince ? or(gte(createdCol, changedSince), gte(updatedCol, changedSince)) : undefined;

  const scheduleRows = await db
    .select()
    .from(gradingSchedules)
    .where(
      and(
        or(eq(gradingSchedules.siteId, siteId), isNull(gradingSchedules.siteId)),
        touched(gradingSchedules.createdAt, gradingSchedules.updatedAt),
      ),
    )
    .orderBy(asc(gradingSchedules.id));

  const factorRows = await db
    .select()
    .from(gradeFactors)
    .where(
      and(
        or(eq(gradeFactors.siteId, siteId), isNull(gradeFactors.siteId)),
        touched(gradeFactors.createdAt, gradeFactors.updatedAt),
      ),
    )
    .orderBy(asc(gradeFactors.id));

  const cleanoutRows = await db
    .select()
    .from(binCleanouts)
    .where(
      and(
        eq(binCleanouts.siteId, siteId),
        touched(binCleanouts.createdAt, binCleanouts.updatedAt),
      ),
    )
    .orderBy(asc(binCleanouts.id));

  const fumigationRows = await db
    .select()
    .from(fumigationLogs)
    .where(
      and(
        eq(fumigationLogs.siteId, siteId),
        touched(fumigationLogs.createdAt, fumigationLogs.updatedAt),
      ),
    )
    .orderBy(asc(fumigationLogs.id));

  const certificateRows = await db
    .select()
    .from(certificates)
    .where(
      and(
        eq(certificates.siteId, siteId),
        touched(certificates.createdAt, certificates.updatedAt),
      ),
    )
    .orderBy(asc(certificates.id));

  const labResultRows = await db
    .select()
    .from(labResults)
    .where(
      and(eq(labResults.siteId, siteId), touched(labResults.createdAt, labResults.updatedAt)),
    )
    .orderBy(asc(labResults.id));

  // lab-result → load references travel as sheet ticket + loadNo (natural key)
  const labLoadIds = [
    ...new Set(labResultRows.map((r) => r.loadId).filter((v): v is number => v != null)),
  ];
  const labLoadInfo = labLoadIds.length
    ? await db
        .select({ id: loads.id, loadNo: loads.loadNo, ticketNo: weightSheets.ticketNo })
        .from(loads)
        .innerJoin(weightSheets, eq(loads.sheetId, weightSheets.id))
        .where(inArray(loads.id, labLoadIds))
    : [];
  const labLoadById = new Map(labLoadInfo.map((l) => [l.id, l]));

  // METADATA ONLY — attachment binaries stay plant-side (data/attachments/);
  // the office mirror upserts the row so it knows the document exists.
  const attachmentRows = await db
    .select()
    .from(attachments)
    .where(
      and(eq(attachments.siteId, siteId), changedSince ? gte(attachments.createdAt, changedSince) : undefined),
    )
    .orderBy(asc(attachments.id));

  const shrinkRows = await db
    .select()
    .from(shrinkEntries)
    .where(
      and(eq(shrinkEntries.siteId, siteId), changedSince ? gte(shrinkEntries.createdAt, changedSince) : undefined),
    )
    .orderBy(asc(shrinkEntries.id));

  const overrideRows = await db
    .select()
    .from(binGradeOverrides)
    .where(
      and(eq(binGradeOverrides.siteId, siteId), changedSince ? gte(binGradeOverrides.createdAt, changedSince) : undefined),
    )
    .orderBy(asc(binGradeOverrides.id));

  const dprRows = await db
    .select()
    .from(dprSnapshots)
    .where(
      and(eq(dprSnapshots.siteId, siteId), changedSince ? gte(dprSnapshots.createdAt, changedSince) : undefined),
    )
    .orderBy(asc(dprSnapshots.day), asc(dprSnapshots.id));

  const physicalCountRows = await db
    .select()
    .from(physicalCounts)
    .where(
      and(eq(physicalCounts.siteId, siteId), changedSince ? gte(physicalCounts.createdAt, changedSince) : undefined),
    )
    .orderBy(asc(physicalCounts.id));

  return {
    site: { name: site.name, location: site.location },
    day: dayKey(day),
    farmers: farmerRows.map((f) => ({ name: f.name, phone: f.phone, email: f.email })),
    landlords: landlordRows.map((l) => ({ name: l.name, phone: l.phone })),
    lots: lotRows.map((r) => ({
      code: r.lot.code,
      farmerName: r.farmerName,
      landlordName: r.landlordName,
      crop: r.lot.crop,
      landlordSplitPct: r.lot.landlordSplitPct,
      status: r.lot.status,
      // Phase A fields (Phase B2 sync): identity-preserved program +
      // farm-of-origin sustainability notes
      program: r.lot.program,
      practices: r.lot.practices,
      carbonNotes: r.lot.carbonNotes,
      notes: r.lot.notes,
    })),
    bins: binRows.map((b) => ({
      name: b.name,
      crop: b.crop,
      capacityLbs: b.capacityLbs,
      currentLbs: b.currentLbs,
      program: b.program,
    })),
    sheets: sheetRows.map((r) => ({
      ticketNo: r.sheet.ticketNo,
      farmerName: r.farmerName,
      lotCode: r.lotCode,
      landlordName: r.landlordName,
      crop: r.sheet.crop,
      direction: r.sheet.direction,
      status: r.sheet.status,
      closeReason: r.sheet.closeReason,
      maxLoads: r.sheet.maxLoads,
      createdAt: r.sheet.createdAt,
      closedAt: r.sheet.closedAt,
      voidedAt: r.sheet.voidedAt,
      voidReason: r.sheet.voidReason,
      loads: (loadsBySheet.get(r.sheet.id) ?? []).map((l) => ({
        loadNo: l.load.loadNo,
        truckId: l.load.truckId,
        driverName: l.load.driverName,
        binName: l.binName,
        grossLbs: l.load.grossLbs,
        tareLbs: l.load.tareLbs,
        netLbs: l.load.netLbs,
        grossAt: l.load.grossAt,
        tareAt: l.load.tareAt,
        moisturePct: l.load.moisturePct,
        dockagePct: l.load.dockagePct,
        testWeightLbs: l.load.testWeightLbs,
        proteinPct: l.load.proteinPct,
        damagePct: l.load.damagePct,
        grade: l.load.grade,
        farmOrigin: l.load.farmOrigin,
        // Phase A/B columns (Phase B2 sync): remaining USGSA factor grid,
        // denormalized program, and the schedule-driven shrink/dock stamps
        foreignMaterialPct: l.load.foreignMaterialPct,
        sbPct: l.load.sbPct,
        program: l.load.program,
        shrinkLbs: l.load.shrinkLbs,
        dockLbs: l.load.dockLbs,
        shrinkPct: l.load.shrinkPct,
        grossBushels: l.load.grossBushels,
        netBushels: l.load.netBushels,
        splits: (splitsByLoadId.get(l.load.id) ?? []).map((sp) => ({
          partyType: sp.partyType,
          partyName:
            sp.partyType === "farmer"
              ? (farmerNameById.get(sp.partyId) ?? null)
              : (landlordNameById.get(sp.partyId) ?? null),
          splitPct: sp.splitPct,
        })),
        voidedAt: l.load.voidedAt,
        voidReason: l.load.voidReason,
      })),
    })),
    // Phase 4 streams (append-only → createdAt cursor). References travel as
    // natural keys (lot code / bin name / sheet ticket + loadNo) because the
    // office mirror assigns its own row ids for those entities.
    binMovements: movementRows.map((m) => ({
      id: m.id,
      lotCode: m.lotId != null ? (lotCodeById.get(m.lotId) ?? null) : null,
      fromBinName: m.fromBinId != null ? (binNameById.get(m.fromBinId) ?? null) : null,
      toBinName: m.toBinId != null ? (binNameById.get(m.toBinId) ?? null) : null,
      quantityLbs: m.quantityLbs,
      loadTicketNo: m.loadId != null ? (loadInfoById.get(m.loadId)?.ticketNo ?? null) : null,
      loadNo: m.loadId != null ? (loadInfoById.get(m.loadId)?.loadNo ?? null) : null,
      shipmentId: m.shipmentId,
      operator: m.operator,
      note: m.note,
      createdAt: m.createdAt,
    })),
    shipments: shipmentRows.map((s) => ({
      id: s.id,
      customerName: s.customerName,
      destination: s.destination,
      lotCode: s.lotId != null ? (lotCodeById.get(s.lotId) ?? null) : null,
      binName: s.binId != null ? (binNameById.get(s.binId) ?? null) : null,
      quantityLbs: s.quantityLbs,
      quantityBu: s.quantityBu,
      truckId: s.truckId,
      note: s.note,
      createdAt: s.createdAt,
    })),
    auditLog: auditRows.map((a) => ({
      id: a.id,
      actor: a.actor,
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId,
      beforeJson: a.beforeJson,
      afterJson: a.afterJson,
      note: a.note,
      createdAt: a.createdAt,
    })),
    // Phase B2 sections. References travel as natural keys (bin name / lot
    // code / sheet ticket + loadNo); siteId null (plant-wide grading config)
    // travels as siteScoped: false. All carry the plant row id — the
    // receiver's idempotency key.
    gradingSchedules: scheduleRows.map((g) => ({
      id: g.id,
      siteScoped: g.siteId != null,
      crop: g.crop,
      moistureShrinkPerPoint: g.moistureShrinkPerPoint,
      baseMoisturePct: g.baseMoisturePct,
      handlingShrinkPct: g.handlingShrinkPct,
      dockageRules: g.dockageRules,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    })),
    gradeFactors: factorRows.map((f) => ({
      id: f.id,
      siteScoped: f.siteId != null,
      crop: f.crop,
      gradeClass: f.gradeClass,
      factor: f.factor,
      minValue: f.minValue,
      maxValue: f.maxValue,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    })),
    cleanouts: cleanoutRows.map((r) => ({
      id: r.id,
      binName: binNameById.get(r.binId) ?? null,
      emptiedAt: r.emptiedAt,
      cleanedAt: r.cleanedAt,
      method: r.method,
      note: r.note,
      operator: r.operator,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    fumigations: fumigationRows.map((r) => ({
      id: r.id,
      binName: binNameById.get(r.binId) ?? null,
      product: r.product,
      dosage: r.dosage,
      appliedAt: r.appliedAt,
      exposureHours: r.exposureHours,
      aerationClearedAt: r.aerationClearedAt,
      applicator: r.applicator,
      note: r.note,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    certificates: certificateRows.map((r) => ({
      id: r.id,
      type: r.type,
      certNumber: r.certNumber,
      issuedAt: r.issuedAt,
      status: r.status,
      lotCode: r.lotId != null ? (lotCodeById.get(r.lotId) ?? null) : null,
      shipmentId: r.shipmentId, // plant-side id — receiver re-keys
      note: r.note,
      fileRef: r.fileRef,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    labResults: labResultRows.map((r) => ({
      id: r.id,
      sampleDate: r.sampleDate,
      labName: r.labName,
      testType: r.testType,
      result: r.result,
      passFail: r.passFail,
      lotCode: r.lotId != null ? (lotCodeById.get(r.lotId) ?? null) : null,
      loadTicketNo: r.loadId != null ? (labLoadById.get(r.loadId)?.ticketNo ?? null) : null,
      loadNo: r.loadId != null ? (labLoadById.get(r.loadId)?.loadNo ?? null) : null,
      binName: r.binId != null ? (binNameById.get(r.binId) ?? null) : null,
      note: r.note,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    attachments: attachmentRows.map((r) => ({
      id: r.id,
      entityType: r.entityType,
      entityId: r.entityId, // plant-side id (raw mirror, like audit_log)
      filename: r.filename,
      mime: r.mime,
      size: r.size,
      storageRef: r.storageRef,
      uploadedBy: r.uploadedBy,
      createdAt: r.createdAt,
    })),
    shrinkEntries: shrinkRows.map((r) => ({
      id: r.id,
      binName: binNameById.get(r.binId) ?? null,
      kind: r.kind,
      quantityLbs: r.quantityLbs,
      effectiveDate: r.effectiveDate,
      note: r.note,
      operator: r.operator,
      createdAt: r.createdAt,
    })),
    gradeOverrides: overrideRows.map((r) => ({
      id: r.id,
      binName: binNameById.get(r.binId) ?? null,
      factor: r.factor,
      value: r.value,
      reason: r.reason,
      operator: r.operator,
      createdAt: r.createdAt,
    })),
    dprSnapshots: dprRows.map((r) => ({
      id: r.id,
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
      createdAt: r.createdAt,
    })),
    physicalCounts: physicalCountRows.map((r) => ({
      id: r.id,
      binName: binNameById.get(r.binId) ?? null,
      countedLbs: r.countedLbs,
      countedAt: r.countedAt,
      note: r.note,
      operator: r.operator,
      createdAt: r.createdAt,
    })),
    totals: {
      sheetsOpened: sheetsOpened.length,
      loadCount: dayLoads.length,
      completedCount: done.length,
      inboundLbs: sum(inbound.map((r) => r.load.netLbs ?? 0)),
      outboundLbs: sum(outbound.map((r) => r.load.netLbs ?? 0)),
      inboundBu: round2(sum(inbound.map((r) => r.load.netBushels ?? 0))),
      outboundBu: round2(sum(outbound.map((r) => r.load.netBushels ?? 0))),
    },
  };
}

export type SyncResult = {
  ok: boolean;
  pushed: number;
  pulled: { farmers: number; landlords: number; lots: number } | null;
  error: string | null;
};

/**
 * Push one site's package for one day to the office portal. Throws on any
 * failure (a 429 carries retryAfterMs from the Retry-After header). On
 * success the per-site cursor advances and sync_log gets the OK row. Shared
 * by pushEod (the manual/close-day path) and the outbox retry worker.
 */
export async function pushOneSite(
  siteId: number,
  day: Date,
): Promise<{ sheets: number; loads: number }> {
  const db = getDb();
  const officeUrl = (await getSetting(db, "officeUrl")).trim().replace(/\/+$/, "");
  if (!officeUrl) {
    throw new Error("Office portal URL not set — configure main-office sync first.");
  }
  const key = await getSetting(db, "officeKey");
  const site = await db.query.sites.findFirst({ where: eq(sites.id, siteId) });
  if (!site) throw new Error(`site ${siteId} no longer exists`);

  // Per-site high-water mark: the package includes sheets that changed since
  // this site's last SUCCESSFUL push. The cursor is captured BEFORE the
  // package is built and only advanced on success, so a failed push never
  // skips changed sheets, and changes made mid-push are picked up by the next
  // one (re-uploads are idempotent).
  const cursorKey = `lastPushAt:site:${site.id}`;
  const cursorRaw = await getSetting(db, cursorKey);
  const changedSince = cursorRaw ? new Date(cursorRaw) : null;
  const pushStartedAt = new Date();

  const pkg = await buildEodPackage(db, site.id, day, changedSince);
  if (!pkg) throw new Error(`could not build package for ${site.name}`);
  const res = await fetchWithTimeout(`${officeUrl}/api/sync/eod`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-gt-sync-key": key },
    body: JSON.stringify(pkg),
  });
  if (!res.ok) {
    const err = new Error(`office responded ${res.status}`) as Error & {
      retryAfterMs?: number;
    };
    if (res.status === 429) {
      // Respect the office's rate-limit signal: Retry-After seconds (or an
      // HTTP date). Fall through to the caller's normal backoff when absent.
      const ra = res.headers.get("retry-after");
      const secs = ra != null ? Number(ra) : NaN;
      if (Number.isFinite(secs) && secs >= 0) err.retryAfterMs = secs * 1000;
      else if (ra) {
        const at = Date.parse(ra);
        if (Number.isFinite(at)) err.retryAfterMs = Math.max(0, at - Date.now());
      }
    }
    throw err;
  }
  const body = (await res.json()) as { sheets?: number; loads?: number };
  await setSetting(db, cursorKey, pushStartedAt.toISOString());
  await logSync(
    db,
    "PUSH",
    "OK",
    `${site.name} ${pkg.day}: ${body.sheets ?? 0} sheets / ${body.loads ?? 0} loads uploaded`,
  );
  return { sheets: body.sheets ?? 0, loads: body.loads ?? 0 };
}

/** Push one day's package per local site to the office portal. Failures are
 * logged AND queued in the sync outbox for automatic retry (P1-8). */
export async function pushEod(day?: Date): Promise<SyncResult> {
  const db = getDb();
  const result: SyncResult = { ok: true, pushed: 0, pulled: null, error: null };
  const officeUrl = (await getSetting(db, "officeUrl")).trim().replace(/\/+$/, "");
  if (!officeUrl) {
    result.error = "Office portal URL not set — configure main-office sync first.";
    return result;
  }
  const targetDay = day ?? new Date();

  const siteRows = await db.select().from(sites).orderBy(asc(sites.name));
  for (const site of siteRows) {
    try {
      await pushOneSite(site.id, targetDay);
      result.pushed += 1;
    } catch (err) {
      result.ok = false;
      result.error = err instanceof Error ? err.message : String(err);
      await logSync(db, "PUSH", "ERROR", `${site.name}: ${result.error}`);
      const { enqueuePush } = await import("./syncOutbox");
      enqueuePush(
        site.id,
        dayKey(targetDay),
        result.error,
        (err as { retryAfterMs?: number }).retryAfterMs,
      );
    }
  }
  return result;
}

/** Pull office-mastered farmers/landlords/lots down to this site. */
export async function pullPeople(): Promise<SyncResult> {
  const db = getDb();
  const result: SyncResult = { ok: true, pushed: 0, pulled: null, error: null };
  const officeUrl = (await getSetting(db, "officeUrl")).trim().replace(/\/+$/, "");
  if (!officeUrl) {
    result.error = "Office portal URL not set — configure main-office sync first.";
    return result;
  }
  const key = await getSetting(db, "officeKey");

  try {
    const res = await fetchWithTimeout(`${officeUrl}/api/sync/people`, {
      headers: { "x-gt-sync-key": key },
    });
    if (!res.ok) throw new Error(`office responded ${res.status}`);
    const data = (await res.json()) as {
      farmers: { name: string; phone: string | null; email: string | null }[];
      landlords: { name: string; phone: string | null }[];
      lots: {
        code: string;
        farmerName: string | null;
        landlordName: string | null;
        crop: string;
        landlordSplitPct: number;
        status: "OPEN" | "CLOSED";
        program?: string;
        practices?: string | null;
        carbonNotes?: string | null;
        notes: string | null;
      }[];
    };

    // upsert people by name — all in ONE transaction so a mid-import failure
    // can't leave a half-applied master-data set behind
    await db.transaction(async (tx) => {
    const farmerIdByName = new Map<string, number>();
    for (const f of data.farmers ?? []) {
      const existing = await tx.query.farmers.findFirst({ where: eq(farmers.name, f.name) });
      if (existing) {
        farmerIdByName.set(f.name, existing.id);
      } else {
        const [{ id }] = await tx
          .insert(farmers)
          .values({ name: f.name, phone: f.phone, email: f.email })
          .$returningId();
        farmerIdByName.set(f.name, id);
      }
    }
    const landlordIdByName = new Map<string, number>();
    for (const l of data.landlords ?? []) {
      const existing = await tx.query.landlords.findFirst({
        where: eq(landlords.name, l.name),
      });
      if (existing) {
        landlordIdByName.set(l.name, existing.id);
      } else {
        const [{ id }] = await tx
          .insert(landlords)
          .values({ name: l.name, phone: l.phone })
          .$returningId();
        landlordIdByName.set(l.name, id);
      }
    }

    // upsert lots by code — office is the master
    for (const lot of data.lots ?? []) {
      const farmerId = lot.farmerName ? farmerIdByName.get(lot.farmerName) : undefined;
      if (!farmerId) continue; // lot references a farmer we don't have — skip
      const landlordId =
        lot.landlordName != null ? (landlordIdByName.get(lot.landlordName) ?? null) : null;
      const existing = await tx.query.lots.findFirst({ where: eq(lots.code, lot.code) });
      const patch = {
        farmerId,
        landlordId,
        crop: lot.crop,
        landlordSplitPct: lot.landlordSplitPct,
        status: lot.status,
        closedAt: lot.status === "CLOSED" ? new Date() : null,
        // Phase A fields ride along when the office sends them (older office
        // builds omit them — keep the plant's values then)
        ...(lot.program !== undefined ? { program: lot.program } : {}),
        ...(lot.practices !== undefined ? { practices: lot.practices } : {}),
        ...(lot.carbonNotes !== undefined ? { carbonNotes: lot.carbonNotes } : {}),
        notes: lot.notes,
      };
      if (existing) {
        await tx.update(lots).set(patch).where(eq(lots.id, existing.id));
      } else {
        await tx.insert(lots).values({ code: lot.code, ...patch });
      }
    }
    });

    result.pulled = {
      farmers: (data.farmers ?? []).length,
      landlords: (data.landlords ?? []).length,
      lots: (data.lots ?? []).length,
    };
    await logSync(
      db,
      "PULL",
      "OK",
      `people: ${result.pulled.farmers} farmers / ${result.pulled.landlords} landlords / ${result.pulled.lots} lots`,
    );
  } catch (err) {
    result.ok = false;
    result.error = err instanceof Error ? err.message : String(err);
    await logSync(db, "PULL", "ERROR", result.error);
  }
  return result;
}

/** Full round-trip: pull office-mastered people/lots, then push today's data. */
export async function syncNow(day?: Date): Promise<{ pull: SyncResult; push: SyncResult }> {
  const pull = await pullPeople();
  const push = await pushEod(day);
  return { pull, push };
}

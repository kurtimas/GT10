import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, isNull, lte, type SQL } from "drizzle-orm";
import { createRouter, publicQuery } from "@shared/api/middleware";
import { getDb } from "@shared/api/queries/connection";
import {
  attachments,
  binCleanouts,
  binGradeOverrides,
  bins,
  binMovements,
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
  shipments,
  shrinkEntries,
  sites,
  syncLog,
  weightSheets,
} from "@db/schema";

// ---------------------------------------------------------------------------
// Office-only queries: per-site overview cards (bin fill, last upload,
// today's activity) and the end-of-day upload history.
// ---------------------------------------------------------------------------

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export const officeRouter = createRouter({
  // Per-site overview for the office home page: bins, last EOD upload time,
  // and today's mirrored sheet/load activity.
  overview: publicQuery.query(async () => {
    const db = getDb();
    const siteRows = await db.select().from(sites).orderBy(asc(sites.name));
    const binRows = await db.select().from(bins).orderBy(asc(bins.name));
    const receiveRows = await db
      .select()
      .from(syncLog)
      .where(and(eq(syncLog.direction, "RECEIVE"), eq(syncLog.status, "OK")))
      .orderBy(desc(syncLog.createdAt))
      .limit(200);

    const from = startOfToday();
    const to = new Date(from);
    to.setHours(23, 59, 59, 999);
    const todaySheetRows = await db
      .select()
      .from(weightSheets)
      .where(and(gte(weightSheets.createdAt, from), lte(weightSheets.createdAt, to)));

    return siteRows.map((site) => {
      const siteBins = binRows.filter((b) => b.siteId === site.id);
      const capacity = siteBins.reduce((a, b) => a + b.capacityLbs, 0);
      const current = siteBins.reduce((a, b) => a + b.currentLbs, 0);
      // sync_log rows carry the site name in their detail ("<site> <day>: …")
      const lastReceive =
        receiveRows.find((r) => r.detail?.startsWith(`${site.name} `))?.createdAt ?? null;
      const sheetsToday = todaySheetRows.filter((s) => s.siteId === site.id);
      return {
        site,
        bins: siteBins,
        fillPct: capacity > 0 ? Math.round((current / capacity) * 100) : 0,
        capacityLbs: capacity,
        currentLbs: current,
        lastReceiveAt: lastReceive,
        todaySheets: sheetsToday.length,
      };
    });
  }),

  // Today's mirrored loads (all sites) — used for the home-page totals.
  todayLoads: publicQuery.query(async () => {
    const db = getDb();
    const from = startOfToday();
    const to = new Date(from);
    to.setHours(23, 59, 59, 999);
    const rows = await db
      .select({ load: loads, siteId: weightSheets.siteId })
      .from(loads)
      .leftJoin(weightSheets, eq(loads.sheetId, weightSheets.id))
      .where(and(gte(loads.createdAt, from), lte(loads.createdAt, to), isNull(loads.voidedAt)));
    const done = rows.filter((r) => r.load.netLbs != null);
    return {
      loadCount: rows.length,
      completedCount: done.length,
      netLbs: done.reduce((a, r) => a + (r.load.netLbs ?? 0), 0),
    };
  }),

  // End-of-day upload history, newest first, optionally per site.
  eodReports: publicQuery
    .input(z.object({ siteId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select({ report: eodReports, siteName: sites.name })
        .from(eodReports)
        .leftJoin(sites, eq(eodReports.siteId, sites.id))
        .where(input?.siteId ? eq(eodReports.siteId, input.siteId) : undefined)
        .orderBy(desc(eodReports.day), asc(sites.name));
      return rows.map((r) => ({ ...r.report, siteName: r.siteName }));
    }),

  // Mirrored shipments pushed by the scale houses (Phase 5) — read-only.
  shipments: publicQuery
    .input(
      z
        .object({
          siteId: z.number().optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select({
          shipment: shipments,
          siteName: sites.name,
          binName: bins.name,
          lotCode: lots.code,
        })
        .from(shipments)
        .leftJoin(sites, eq(shipments.siteId, sites.id))
        .leftJoin(bins, eq(shipments.binId, bins.id))
        .leftJoin(lots, eq(shipments.lotId, lots.id))
        .where(input?.siteId ? eq(shipments.siteId, input.siteId) : undefined)
        .orderBy(desc(shipments.createdAt), desc(shipments.id))
        .limit(input?.limit ?? 200);
      return rows.map((r) => ({
        ...r.shipment,
        siteName: r.siteName,
        binName: r.binName,
        lotCode: r.lotCode,
      }));
    }),

  // Mirrored bin movement events (Phase 5) — read-only provenance feed.
  movements: publicQuery
    .input(
      z
        .object({
          siteId: z.number().optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select({
          movement: binMovements,
          siteName: sites.name,
          lotCode: lots.code,
          ticketNo: weightSheets.ticketNo,
          loadNo: loads.loadNo,
          shipmentCustomer: shipments.customerName,
        })
        .from(binMovements)
        .leftJoin(sites, eq(binMovements.siteId, sites.id))
        .leftJoin(lots, eq(binMovements.lotId, lots.id))
        .leftJoin(loads, eq(binMovements.loadId, loads.id))
        .leftJoin(weightSheets, eq(loads.sheetId, weightSheets.id))
        .leftJoin(shipments, eq(binMovements.shipmentId, shipments.id))
        .where(input?.siteId ? eq(binMovements.siteId, input.siteId) : undefined)
        .orderBy(desc(binMovements.createdAt), desc(binMovements.id))
        .limit(input?.limit ?? 200);
      const binRows = await db.select({ id: bins.id, name: bins.name }).from(bins);
      const nameById = new Map(binRows.map((b) => [b.id, b.name]));
      return rows.map((r) => ({
        ...r.movement,
        siteName: r.siteName,
        lotCode: r.lotCode,
        fromBinName: r.movement.fromBinId != null ? (nameById.get(r.movement.fromBinId) ?? null) : null,
        toBinName: r.movement.toBinId != null ? (nameById.get(r.movement.toBinId) ?? null) : null,
        ticketNo: r.ticketNo,
        loadNo: r.loadNo,
        shipmentCustomer: r.shipmentCustomer,
      }));
    }),

  // ------------------------------------------------------------------
  // Phase B2 read-only mirrors — the office portal lists the compliance /
  // grading / traceability records pushed by the plants. All list endpoints
  // follow the office.shipments/office.movements pattern: optional siteId
  // filter, bounded limit, display names joined in. No writes exist here —
  // mirrored data is only written through the keyed sync receiver.
  // ------------------------------------------------------------------

  // Grading shrink/dock schedules (#3) — includes plant-wide rows (siteId null).
  gradingSchedules: publicQuery
    .input(
      z
        .object({
          siteId: z.number().optional(),
          crop: z.string().optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds: SQL[] = [];
      if (input?.siteId) conds.push(eq(gradingSchedules.siteId, input.siteId));
      if (input?.crop) conds.push(eq(gradingSchedules.crop, input.crop));
      const rows = await db
        .select({ schedule: gradingSchedules, siteName: sites.name })
        .from(gradingSchedules)
        .leftJoin(sites, eq(gradingSchedules.siteId, sites.id))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(asc(gradingSchedules.crop), asc(gradingSchedules.siteId))
        .limit(input?.limit ?? 200);
      return rows.map((r) => ({ ...r.schedule, siteName: r.siteName }));
    }),

  // Grade-factor validation ranges (#3).
  gradeFactors: publicQuery
    .input(
      z
        .object({
          siteId: z.number().optional(),
          crop: z.string().optional(),
          gradeClass: z.string().optional(),
          limit: z.number().int().min(1).max(500).default(500),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds: SQL[] = [];
      if (input?.siteId) conds.push(eq(gradeFactors.siteId, input.siteId));
      if (input?.crop) conds.push(eq(gradeFactors.crop, input.crop));
      if (input?.gradeClass) conds.push(eq(gradeFactors.gradeClass, input.gradeClass));
      const rows = await db
        .select({ factor: gradeFactors, siteName: sites.name })
        .from(gradeFactors)
        .leftJoin(sites, eq(gradeFactors.siteId, sites.id))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(asc(gradeFactors.crop), asc(gradeFactors.gradeClass), asc(gradeFactors.factor))
        .limit(input?.limit ?? 500);
      return rows.map((r) => ({ ...r.factor, siteName: r.siteName }));
    }),

  // Load splits (#4) — farmer/landlord shares, with party + ticket resolved.
  splits: publicQuery
    .input(
      z
        .object({
          siteId: z.number().optional(),
          loadId: z.number().optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds: SQL[] = [];
      if (input?.loadId) conds.push(eq(loadSplits.loadId, input.loadId));
      if (input?.siteId) conds.push(eq(weightSheets.siteId, input.siteId));
      const rows = await db
        .select({
          split: loadSplits,
          ticketNo: weightSheets.ticketNo,
          loadNo: loads.loadNo,
          siteName: sites.name,
        })
        .from(loadSplits)
        .innerJoin(loads, eq(loadSplits.loadId, loads.id))
        .innerJoin(weightSheets, eq(loads.sheetId, weightSheets.id))
        .leftJoin(sites, eq(weightSheets.siteId, sites.id))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(loadSplits.createdAt), desc(loadSplits.id))
        .limit(input?.limit ?? 200);
      const farmerIds = rows.filter((r) => r.split.partyType === "farmer").map((r) => r.split.partyId);
      const landlordIds = rows.filter((r) => r.split.partyType !== "farmer").map((r) => r.split.partyId);
      const farmerRows = farmerIds.length
        ? await db.select({ id: farmers.id, name: farmers.name }).from(farmers).where(inArray(farmers.id, farmerIds))
        : [];
      const landlordRows = landlordIds.length
        ? await db.select({ id: landlords.id, name: landlords.name }).from(landlords).where(inArray(landlords.id, landlordIds))
        : [];
      const farmerName = new Map(farmerRows.map((f) => [f.id, f.name]));
      const landlordName = new Map(landlordRows.map((l) => [l.id, l.name]));
      return rows.map((r) => ({
        ...r.split,
        ticketNo: r.ticketNo,
        loadNo: r.loadNo,
        siteName: r.siteName,
        partyName:
          (r.split.partyType === "farmer"
            ? farmerName.get(r.split.partyId)
            : landlordName.get(r.split.partyId)) ?? null,
      }));
    }),

  // Bin cleanouts (#12) — genealogy reset points.
  cleanouts: publicQuery
    .input(
      z
        .object({
          siteId: z.number().optional(),
          binId: z.number().optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds: SQL[] = [];
      if (input?.siteId) conds.push(eq(binCleanouts.siteId, input.siteId));
      if (input?.binId) conds.push(eq(binCleanouts.binId, input.binId));
      const rows = await db
        .select({ cleanout: binCleanouts, binName: bins.name, siteName: sites.name })
        .from(binCleanouts)
        .leftJoin(bins, eq(binCleanouts.binId, bins.id))
        .leftJoin(sites, eq(binCleanouts.siteId, sites.id))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(binCleanouts.emptiedAt), desc(binCleanouts.id))
        .limit(input?.limit ?? 200);
      return rows.map((r) => ({ ...r.cleanout, binName: r.binName, siteName: r.siteName }));
    }),

  // Fumigation / treatment logs (#19).
  fumigations: publicQuery
    .input(
      z
        .object({
          siteId: z.number().optional(),
          binId: z.number().optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds: SQL[] = [];
      if (input?.siteId) conds.push(eq(fumigationLogs.siteId, input.siteId));
      if (input?.binId) conds.push(eq(fumigationLogs.binId, input.binId));
      const rows = await db
        .select({ fumigation: fumigationLogs, binName: bins.name, siteName: sites.name })
        .from(fumigationLogs)
        .leftJoin(bins, eq(fumigationLogs.binId, bins.id))
        .leftJoin(sites, eq(fumigationLogs.siteId, sites.id))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(fumigationLogs.appliedAt), desc(fumigationLogs.id))
        .limit(input?.limit ?? 200);
      return rows.map((r) => ({ ...r.fumigation, binName: r.binName, siteName: r.siteName }));
    }),

  // Certificate registry (#20) — incl. reprint/void lifecycle status.
  certificates: publicQuery
    .input(
      z
        .object({
          siteId: z.number().optional(),
          type: z.string().optional(),
          status: z.string().optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds: SQL[] = [];
      if (input?.siteId) conds.push(eq(certificates.siteId, input.siteId));
      if (input?.type) conds.push(eq(certificates.type, input.type));
      if (input?.status) conds.push(eq(certificates.status, input.status));
      const rows = await db
        .select({ certificate: certificates, lotCode: lots.code, siteName: sites.name })
        .from(certificates)
        .leftJoin(lots, eq(certificates.lotId, lots.id))
        .leftJoin(sites, eq(certificates.siteId, sites.id))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(certificates.issuedAt), desc(certificates.id))
        .limit(input?.limit ?? 200);
      return rows.map((r) => ({ ...r.certificate, lotCode: r.lotCode, siteName: r.siteName }));
    }),

  // Lab results (#22).
  labResults: publicQuery
    .input(
      z
        .object({
          siteId: z.number().optional(),
          lotId: z.number().optional(),
          binId: z.number().optional(),
          testType: z.string().optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds: SQL[] = [];
      if (input?.siteId) conds.push(eq(labResults.siteId, input.siteId));
      if (input?.lotId) conds.push(eq(labResults.lotId, input.lotId));
      if (input?.binId) conds.push(eq(labResults.binId, input.binId));
      if (input?.testType) conds.push(eq(labResults.testType, input.testType));
      const rows = await db
        .select({ result: labResults, lotCode: lots.code, binName: bins.name, siteName: sites.name })
        .from(labResults)
        .leftJoin(lots, eq(labResults.lotId, lots.id))
        .leftJoin(bins, eq(labResults.binId, bins.id))
        .leftJoin(sites, eq(labResults.siteId, sites.id))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(labResults.sampleDate), desc(labResults.id))
        .limit(input?.limit ?? 200);
      return rows.map((r) => ({
        ...r.result,
        lotCode: r.lotCode,
        binName: r.binName,
        siteName: r.siteName,
      }));
    }),

  // Attachment METADATA (#26) — binaries stay plant-side; the office mirror
  // shows that a document exists, never its payload. entityId is the raw
  // plant-side id (display mirror, like audit_log.entityId).
  attachments: publicQuery
    .input(
      z
        .object({
          siteId: z.number().optional(),
          entityType: z.string().optional(),
          entityId: z.number().optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds: SQL[] = [];
      if (input?.siteId) conds.push(eq(attachments.siteId, input.siteId));
      if (input?.entityType) conds.push(eq(attachments.entityType, input.entityType));
      if (input?.entityId) conds.push(eq(attachments.entityId, input.entityId));
      const rows = await db
        .select({ attachment: attachments, siteName: sites.name })
        .from(attachments)
        .leftJoin(sites, eq(attachments.siteId, sites.id))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(attachments.createdAt), desc(attachments.id))
        .limit(input?.limit ?? 200);
      return rows.map((r) => ({ ...r.attachment, siteName: r.siteName }));
    }),

  // Shrink / reconciliation entries (#15) — append-only, signed.
  shrinkEntries: publicQuery
    .input(
      z
        .object({
          siteId: z.number().optional(),
          binId: z.number().optional(),
          kind: z.string().optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds: SQL[] = [];
      if (input?.siteId) conds.push(eq(shrinkEntries.siteId, input.siteId));
      if (input?.binId) conds.push(eq(shrinkEntries.binId, input.binId));
      if (input?.kind) conds.push(eq(shrinkEntries.kind, input.kind));
      const rows = await db
        .select({ entry: shrinkEntries, binName: bins.name, siteName: sites.name })
        .from(shrinkEntries)
        .leftJoin(bins, eq(shrinkEntries.binId, bins.id))
        .leftJoin(sites, eq(shrinkEntries.siteId, sites.id))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(shrinkEntries.effectiveDate), desc(shrinkEntries.id))
        .limit(input?.limit ?? 200);
      return rows.map((r) => ({ ...r.entry, binName: r.binName, siteName: r.siteName }));
    }),

  // Bin grade overrides (#18) — append-only; latest per (bin, factor) wins.
  gradeOverrides: publicQuery
    .input(
      z
        .object({
          siteId: z.number().optional(),
          binId: z.number().optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds: SQL[] = [];
      if (input?.siteId) conds.push(eq(binGradeOverrides.siteId, input.siteId));
      if (input?.binId) conds.push(eq(binGradeOverrides.binId, input.binId));
      const rows = await db
        .select({ override: binGradeOverrides, binName: bins.name, siteName: sites.name })
        .from(binGradeOverrides)
        .leftJoin(bins, eq(binGradeOverrides.binId, bins.id))
        .leftJoin(sites, eq(binGradeOverrides.siteId, sites.id))
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(binGradeOverrides.createdAt), desc(binGradeOverrides.id))
        .limit(input?.limit ?? 200);
      return rows.map((r) => ({ ...r.override, binName: r.binName, siteName: r.siteName }));
    }),

  // Daily Position Record snapshots (#5) — frozen rows written at closeDay.
  dpr: createRouter({
    list: publicQuery
      .input(
        z
          .object({
            siteId: z.number().optional(),
            dayFrom: z.string().optional(),
            dayTo: z.string().optional(),
            program: z.string().optional(),
            limit: z.number().int().min(1).max(1000).default(500),
          })
          .optional(),
      )
      .query(async ({ input }) => {
        const db = getDb();
        const conds: SQL[] = [];
        if (input?.siteId) conds.push(eq(dprSnapshots.siteId, input.siteId));
        if (input?.dayFrom) conds.push(gte(dprSnapshots.day, input.dayFrom));
        if (input?.dayTo) conds.push(lte(dprSnapshots.day, input.dayTo));
        if (input?.program) conds.push(eq(dprSnapshots.program, input.program));
        const rows = await db
          .select({ dpr: dprSnapshots, siteName: sites.name })
          .from(dprSnapshots)
          .leftJoin(sites, eq(dprSnapshots.siteId, sites.id))
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(desc(dprSnapshots.day), asc(dprSnapshots.crop), asc(dprSnapshots.program))
          .limit(input?.limit ?? 500);
        // ownership (storage vs owned) is not modeled — see shared/api/lib/dpr.ts
        return rows.map((r) => ({ ...r.dpr, siteName: r.siteName, ownershipModeled: false }));
      }),
    get: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const db = getDb();
      const row = await db.query.dprSnapshots.findFirst({ where: eq(dprSnapshots.id, input.id) });
      if (!row) throw new Error("DPR snapshot not found");
      return { ...row, ownershipModeled: false };
    }),
  }),
});

export type OfficeRouter = typeof officeRouter;

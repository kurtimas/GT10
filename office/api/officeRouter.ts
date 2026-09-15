import { z } from "zod";
import { and, asc, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { createRouter, publicQuery } from "@shared/api/middleware";
import { getDb } from "@shared/api/queries/connection";
import { bins, binMovements, eodReports, loads, lots, shipments, sites, syncLog, weightSheets } from "@db/schema";

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
});

export type OfficeRouter = typeof officeRouter;

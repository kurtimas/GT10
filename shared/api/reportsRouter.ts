import { z } from "zod";
import { and, asc, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  bins,
  binMovements,
  dprSnapshots,
  physicalCounts,
  shrinkEntries,
  sites,
} from "../db/schema";
import {
  MASS_BALANCE_FLAG_BU,
  MASS_BALANCE_FLAG_PCT,
  physicalCountSchema,
} from "../contracts/compliance";
import { bushelWeight, round2 } from "../contracts/grain";
import { binTotalLbs } from "../contracts/provenance";
import { cleanoutCutoffs } from "./lib/cleanouts";
import { computeDprRows, dayKey, dprDayIsOpen, parseDay, writeDprSnapshots } from "./lib/dpr";
import { toCsv, type CsvValue } from "./lib/csv";
import { writeAudit } from "./lib/audit";
import { resolveOperator } from "./lib/operators";

// ---------------------------------------------------------------------------
// Reports API (Phase B): mass-balance reconciliation (#15) and the Daily
// Position Record snapshot endpoints (#5).
//
// Mass balance per bin over [from, to]:
//   book(T)    = bin_movements replay up to T (bounded by the bin's latest
//                completed cleanout) + cumulative signed shrink_entries
//   expected   = book(from) + received − shipped ± transfers + shrink + adjustments
//   cache      = bins.currentLbs (fast balance maintained at weigh time)
//   physical   = latest physical_counts row ≤ to; book-vs-physical variance is
//                FLAGGED when it exceeds BOTH 1% of book AND 500 bushels
//                (the examiner threshold).
// ---------------------------------------------------------------------------

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

export const reportsRouter = createRouter({
  // --------------------------------------------------- mass balance (#15)
  massBalance: publicQuery
    .input(
      z.object({
        siteId: z.number().optional(),
        binId: z.number().optional(),
        from: z.string(), // YYYY-MM-DD
        to: z.string(),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const from = startOfDay(parseDay(input.from));
      const to = endOfDay(parseDay(input.to));

      const binConds: SQL[] = [];
      if (input.siteId) binConds.push(eq(bins.siteId, input.siteId));
      if (input.binId) binConds.push(eq(bins.id, input.binId));
      const binRows = await db
        .select({ bin: bins, siteName: sites.name })
        .from(bins)
        .leftJoin(sites, eq(bins.siteId, sites.id))
        .where(binConds.length ? and(...binConds) : undefined)
        .orderBy(asc(bins.name));

      const movementRows = await db
        .select()
        .from(binMovements)
        .orderBy(asc(binMovements.createdAt), asc(binMovements.id));
      const shrinkRows = await db.select().from(shrinkEntries).orderBy(asc(shrinkEntries.effectiveDate));
      const countRows = await db
        .select()
        .from(physicalCounts)
        .orderBy(desc(physicalCounts.countedAt), desc(physicalCounts.id));
      const cutoffs = await cleanoutCutoffs(db, binRows.map((r) => r.bin.id));

      const eventsFor = (binId: number) =>
        movementRows.filter((m) => m.fromBinId === binId || m.toBinId === binId);
      const shrinkFor = (binId: number, upTo: Date) =>
        shrinkRows
          .filter((s) => s.binId === binId && s.effectiveDate <= upTo)
          .reduce((sum, s) => sum + s.quantityLbs, 0);
      const bookAt = (binId: number, t: Date) =>
        binTotalLbs(
          eventsFor(binId).filter((e) => e.createdAt <= t),
          binId,
          cutoffs.get(binId) ?? null,
        ) + shrinkFor(binId, t);

      return {
        from: input.from,
        to: input.to,
        flagRule: `flagged when |variance| > ${MASS_BALANCE_FLAG_PCT}% of book AND > ${MASS_BALANCE_FLAG_BU} bu`,
        bins: binRows.map(({ bin, siteName }) => {
          const events = eventsFor(bin.id);
          const inRange = events.filter((e) => e.createdAt >= from && e.createdAt <= to);

          let receivedLbs = 0;
          let shippedLbs = 0;
          let transfersInLbs = 0;
          let transfersOutLbs = 0;
          let adjustmentsLbs = 0;
          for (const m of inRange) {
            const qty = m.quantityLbs;
            if (m.toBinId === bin.id && m.fromBinId != null) transfersInLbs += qty;
            else if (m.fromBinId === bin.id && m.toBinId != null) transfersOutLbs += qty;
            else if (m.toBinId === bin.id) {
              if (m.loadId != null) receivedLbs += qty;
              else adjustmentsLbs += qty;
            } else if (m.fromBinId === bin.id) {
              if (m.loadId != null || m.shipmentId != null) shippedLbs += qty;
              else adjustmentsLbs -= qty;
            }
          }

          const shrinkInRange = shrinkRows.filter(
            (s) => s.binId === bin.id && s.effectiveDate >= from && s.effectiveDate <= to,
          );
          const shrinkByKind: Record<string, number> = {};
          for (const s of shrinkInRange) {
            shrinkByKind[s.kind] = (shrinkByKind[s.kind] ?? 0) + s.quantityLbs;
          }
          const shrinkLbs = shrinkInRange.reduce((sum, s) => sum + s.quantityLbs, 0);

          const openingLbs = bookAt(bin.id, new Date(from.getTime() - 1));
          const expectedLbs = bookAt(bin.id, to);
          const cacheLbs = bin.currentLbs;
          const cacheVarianceLbs = cacheLbs - expectedLbs;

          // latest physical count in (or before) the window
          const count = countRows.find((c) => c.binId === bin.id && c.countedAt <= to) ?? null;
          let physical: {
            countedLbs: number;
            countedAt: Date;
            bookLbs: number;
            varianceLbs: number;
            variancePct: number;
            varianceBu: number;
            flagged: boolean;
          } | null = null;
          if (count) {
            const bookAtCount = bookAt(bin.id, count.countedAt);
            const varianceLbs = count.countedLbs - bookAtCount;
            const variancePct = bookAtCount > 0 ? round2((varianceLbs / bookAtCount) * 100) : 0;
            const varianceBu = round2(varianceLbs / bushelWeight(bin.crop));
            physical = {
              countedLbs: count.countedLbs,
              countedAt: count.countedAt,
              bookLbs: bookAtCount,
              varianceLbs,
              variancePct,
              varianceBu,
              flagged:
                Math.abs(variancePct) > MASS_BALANCE_FLAG_PCT &&
                Math.abs(varianceBu) > MASS_BALANCE_FLAG_BU,
            };
          }

          return {
            binId: bin.id,
            binName: bin.name,
            siteName,
            crop: bin.crop,
            program: bin.program,
            openingLbs,
            receivedLbs,
            shippedLbs,
            transfersInLbs,
            transfersOutLbs,
            adjustmentsLbs,
            shrinkByKind,
            shrinkLbs,
            expectedLbs,
            cacheLbs,
            cacheVarianceLbs,
            physical,
          };
        }),
      };
    }),

  // Record a physical bin count (#15) — append-only, audit-logged.
  recordPhysicalCount: publicQuery
    .input(physicalCountSchema.omit({ operator: true }).extend({ countedAt: z.date().optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const operator = await resolveOperator(db, ctx.operator);
      const bin = await db.query.bins.findFirst({ where: eq(bins.id, input.binId) });
      if (!bin) throw new Error("Bin not found");
      if (bin.siteId !== input.siteId) throw new Error("Bin belongs to another site");
      const [{ id }] = await db
        .insert(physicalCounts)
        .values({
          siteId: input.siteId,
          binId: input.binId,
          countedLbs: input.countedLbs,
          countedAt: input.countedAt ?? new Date(),
          note: input.note ?? null,
          operator,
        })
        .$returningId();
      await writeAudit(db, {
        actor: operator,
        action: "create",
        entityType: "physical_count",
        entityId: id,
        after: { binId: input.binId, countedLbs: input.countedLbs },
      });
      return db.query.physicalCounts.findFirst({ where: eq(physicalCounts.id, id) });
    }),

  physicalCounts: publicQuery
    .input(z.object({ binId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select()
        .from(physicalCounts)
        .where(eq(physicalCounts.binId, input.binId))
        .orderBy(desc(physicalCounts.countedAt), desc(physicalCounts.id));
    }),

  // ------------------------------------------------------------ DPR (#5)
  dprList: publicQuery
    .input(
      z
        .object({
          siteId: z.number().optional(),
          dayFrom: z.string().optional(),
          dayTo: z.string().optional(),
          program: z.string().optional(),
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
        .orderBy(desc(dprSnapshots.day), asc(dprSnapshots.crop), asc(dprSnapshots.program));
      // ownership (storage vs owned) is not modeled — see dpr.ts
      return rows.map((r) => ({ ...r.dpr, siteName: r.siteName, ownershipModeled: false }));
    }),

  dprGet: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const db = getDb();
    const row = await db.query.dprSnapshots.findFirst({ where: eq(dprSnapshots.id, input.id) });
    if (!row) throw new Error("DPR snapshot not found");
    return { ...row, ownershipModeled: false };
  }),

  // Live preview of today's (or an open day's) DPR — computed, not stored.
  dprPreview: publicQuery
    .input(z.object({ siteId: z.number(), day: z.string() }))
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await computeDprRows(db, input.siteId, parseDay(input.day));
      return { siteId: input.siteId, day: dayKey(parseDay(input.day)), rows, ownershipModeled: false };
    }),

  // Regenerate an OPEN day's snapshot (pre-close). Frozen days are refused.
  dprRegenerate: publicQuery
    .input(z.object({ siteId: z.number(), day: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const operator = await resolveOperator(db, ctx.operator);
      const day = parseDay(input.day);
      if (!(await dprDayIsOpen(db, input.siteId, day))) {
        throw new Error(`DPR for ${input.day} is frozen (day closed) — it cannot be regenerated`);
      }
      const count = await writeDprSnapshots(db, input.siteId, day, false);
      await writeAudit(db, {
        actor: operator,
        action: "update",
        entityType: "dpr_snapshot",
        entityId: input.siteId,
        after: { siteId: input.siteId, day: input.day, rows: count },
        note: "DPR regenerated (day still open)",
      });
      return { ok: true, rows: count };
    }),

  // CSV export of DPR rows in a day range (per site × day × crop × program).
  dprCsv: publicQuery
    .input(z.object({ siteId: z.number().optional(), dayFrom: z.string(), dayTo: z.string() }))
    .query(async ({ input }) => {
      const db = getDb();
      const conds: SQL[] = [
        gte(dprSnapshots.day, input.dayFrom),
        lte(dprSnapshots.day, input.dayTo),
      ];
      if (input?.siteId) conds.push(eq(dprSnapshots.siteId, input.siteId));
      const rows = await db
        .select({ dpr: dprSnapshots, siteName: sites.name })
        .from(dprSnapshots)
        .leftJoin(sites, eq(dprSnapshots.siteId, sites.id))
        .where(and(...conds))
        .orderBy(asc(dprSnapshots.day), asc(dprSnapshots.crop), asc(dprSnapshots.program));
      const csv = toCsv(
        ["site","siteId","day","crop","program","openingLbs","receivedLbs","receivedBu","shippedLbs","shippedBu","transfersInLbs","transfersOutLbs","shrinkMoistureLbs","shrinkHandlingLbs","shrinkAerationLbs","shrinkErrorCorrectionLbs","adjustmentsLbs","endingLbs","endingBu","frozen"],
        rows.map((r) => ({
          site: r.siteName,
          ...r.dpr,
        })) as unknown as Record<string, CsvValue>[],
      );
      return { filename: `dpr_${input.dayFrom}_${input.dayTo}.csv`, csv, rows: rows.length };
    }),
});

export type ReportsRouter = typeof reportsRouter;

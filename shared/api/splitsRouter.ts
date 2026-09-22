import { z } from "zod";
import { asc, eq, inArray } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { farmers, landlords, loads, loadSplits } from "../db/schema";
import { loadSplitSchema, validateLoadSplits } from "../contracts/splits";
import { writeAudit } from "./lib/audit";
import { resolveOperator } from "./lib/operators";

// ---------------------------------------------------------------------------
// Load splits API (Phase B, #4) — farmer/landlord percentage shares of one
// delivered load. Contract: the splits for a load must sum to 100%
// (shared/contracts/splits.ts). Setting splits replaces the load's split set
// atomically (delete + insert in ONE transaction) and is audit-logged against
// the load.
// ---------------------------------------------------------------------------

export const splitsRouter = createRouter({
  // Splits recorded for one load, enriched with party names.
  get: publicQuery.input(z.object({ loadId: z.number() })).query(async ({ input }) => {
    const db = getDb();
    const rows = await db
      .select()
      .from(loadSplits)
      .where(eq(loadSplits.loadId, input.loadId))
      .orderBy(asc(loadSplits.id));
    const farmerIds = rows.filter((r) => r.partyType === "farmer").map((r) => r.partyId);
    const landlordIds = rows.filter((r) => r.partyType === "landlord").map((r) => r.partyId);
    const farmerRows = farmerIds.length
      ? await db.select({ id: farmers.id, name: farmers.name }).from(farmers).where(inArray(farmers.id, farmerIds))
      : [];
    const landlordRows = landlordIds.length
      ? await db.select({ id: landlords.id, name: landlords.name }).from(landlords).where(inArray(landlords.id, landlordIds))
      : [];
    const farmerName = new Map(farmerRows.map((f) => [f.id, f.name]));
    const landlordName = new Map(landlordRows.map((l) => [l.id, l.name]));
    return rows.map((r) => ({
      ...r,
      partyName:
        (r.partyType === "farmer" ? farmerName.get(r.partyId) : landlordName.get(r.partyId)) ??
        null,
    }));
  }),

  // Replace the load's split set atomically. Sum must be 100 (±0.01).
  set: publicQuery
    .input(
      z.object({
        loadId: z.number(),
        splits: z.array(loadSplitSchema.omit({ loadId: true })).min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const load = await db.query.loads.findFirst({ where: eq(loads.id, input.loadId) });
      if (!load) throw new Error("Load not found");
      if (load.voidedAt) throw new Error("Load is voided");
      const operator = await resolveOperator(db, ctx.operator);

      const check = validateLoadSplits(input.splits);
      if (!check.valid) {
        throw new Error(
          `Load splits must sum to 100% — got ${check.totalPct}%`,
        );
      }

      const before = await db
        .select()
        .from(loadSplits)
        .where(eq(loadSplits.loadId, input.loadId))
        .orderBy(asc(loadSplits.id));

      await db.transaction(async (tx) => {
        await tx.delete(loadSplits).where(eq(loadSplits.loadId, input.loadId));
        for (const s of input.splits) {
          await tx.insert(loadSplits).values({ loadId: input.loadId, ...s });
        }
        await writeAudit(tx, {
          actor: operator,
          action: "update",
          entityType: "load",
          entityId: input.loadId,
          before: { splits: before },
          after: { splits: input.splits },
          note: `Load splits set (${input.splits.length} parties, total ${check.totalPct}%)`,
        });
      });

      return { ok: true, totalPct: check.totalPct, count: input.splits.length };
    }),
});

export type SplitsRouter = typeof splitsRouter;

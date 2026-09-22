import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { binCleanouts } from "../../db/schema";

// ---------------------------------------------------------------------------
// Cleanout genealogy cutoff (Phase B, #12). A COMPLETED cleanout (cleanedAt
// set) resets a bin's genealogy: provenance replay, trace, mass balance, and
// grade averaging only consider bin_movements strictly after the latest
// completed cleanout. The movement log itself stays append-only and complete
// — the cutoff is applied at read time (shared/contracts/provenance.ts).
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * The cutoff timestamp for one bin: cleanedAt of its latest COMPLETED
 * cleanout, or null when the bin has never been cleaned out (replay then
 * covers the bin's whole history).
 */
export async function cleanoutCutoff(db: Db | Tx, binId: number): Promise<Date | null> {
  const row = await db.query.binCleanouts.findFirst({
    where: and(eq(binCleanouts.binId, binId), isNotNull(binCleanouts.cleanedAt)),
    orderBy: [desc(binCleanouts.cleanedAt), desc(binCleanouts.id)],
  });
  return row?.cleanedAt ?? null;
}

/** Cutoffs for many bins at once (one query) — used by site-wide reports. */
export async function cleanoutCutoffs(db: Db | Tx, binIds: number[]): Promise<Map<number, Date>> {
  const map = new Map<number, Date>();
  if (binIds.length === 0) return map;
  const rows = await db
    .select()
    .from(binCleanouts)
    .where(and(inArray(binCleanouts.binId, binIds), isNotNull(binCleanouts.cleanedAt)))
    .orderBy(desc(binCleanouts.cleanedAt), desc(binCleanouts.id));
  const wanted = new Set(binIds);
  for (const r of rows) {
    if (wanted.has(r.binId) && !map.has(r.binId) && r.cleanedAt) map.set(r.binId, r.cleanedAt);
  }
  return map;
}

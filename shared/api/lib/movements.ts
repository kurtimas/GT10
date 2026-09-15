import { asc, eq, or } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { binMovements } from "../../db/schema";

// ---------------------------------------------------------------------------
// Bin-movement writer (Phase 4). One append-only bin_movements row per
// quantity of grain entering, leaving, or moving between bins — always
// written in the SAME transaction as the bin-cache delta that it explains,
// so the provenance log can never diverge silently from bins.currentLbs.
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type MovementInput = {
  siteId: number;
  lotId?: number | null;
  /** null = inbound from field/truck */
  fromBinId?: number | null;
  /** null = outbound (shipped / consumed) */
  toBinId?: number | null;
  quantityLbs: number;
  loadId?: number | null;
  shipmentId?: number | null;
  operator?: string | null;
  note?: string | null;
};

/** Append one bin_movements row; returns the new row id. */
export async function recordMovement(db: Db | Tx, m: MovementInput): Promise<number> {
  const [{ id }] = await db
    .insert(binMovements)
    .values({
      siteId: m.siteId,
      lotId: m.lotId ?? null,
      fromBinId: m.fromBinId ?? null,
      toBinId: m.toBinId ?? null,
      quantityLbs: m.quantityLbs,
      loadId: m.loadId ?? null,
      shipmentId: m.shipmentId ?? null,
      operator: m.operator ?? null,
      note: m.note ?? null,
    })
    .$returningId();
  return id;
}

/**
 * All movement events touching a bin (either side), oldest first — the input
 * for the provenance replay functions in shared/contracts/provenance.ts.
 */
export async function movementsForBin(db: Db | Tx, binId: number) {
  return db
    .select()
    .from(binMovements)
    .where(or(eq(binMovements.fromBinId, binId), eq(binMovements.toBinId, binId)))
    .orderBy(asc(binMovements.createdAt), asc(binMovements.id));
}

/** All movement events for a site since a cursor (append-only → createdAt). */
export async function movementsSince(db: Db | Tx, siteId: number, since: Date | null) {
  const rows = await db
    .select()
    .from(binMovements)
    .where(eq(binMovements.siteId, siteId))
    .orderBy(asc(binMovements.createdAt), asc(binMovements.id));
  return since ? rows.filter((r) => r.createdAt >= since) : rows;
}

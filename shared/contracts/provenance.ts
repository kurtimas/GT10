// ---------------------------------------------------------------------------
// Bin provenance — lot-level composition of a bin derived from the append-only
// bin_movements event log (shared/db/schema.ts `binMovements`).
//
// The event log is the source of truth; `bins.currentLbs` is only a fast
// cached balance. Replaying the log answers the traceability questions:
//   * what lots (and how much of each) are in a bin right now  → binLayers /
//     binCompositionByLot
//   * when X lbs ship from a bin, which lots did they come from → fifoDrawdown
//     (oldest grain in the bin ships first — standard elevator practice)
//
// Pure functions over plain event objects, so the plant app, the office
// portal, and future reports all share this one implementation. Rows read
// from the bin_movements table satisfy BinMovementEvent directly.
// ---------------------------------------------------------------------------

/** One bin_movements row (or an equivalent plain object). */
export interface BinMovementEvent {
  id: number;
  /** null only on lot-less manual adjustments ("unknown" lot) */
  lotId: number | null;
  /** null = inbound from field/truck */
  fromBinId: number | null;
  /** null = outbound (shipped / consumed) */
  toBinId: number | null;
  quantityLbs: number;
  createdAt: Date;
}

/** Grain of one lot still sitting in a bin, oldest first. */
export interface BinLotLayer {
  lotId: number | null;
  lbs: number;
  /** when this grain entered the bin */
  since: Date;
  /** id of the inbound movement that opened the layer */
  movementId: number;
}

export interface LotQuantity {
  lotId: number | null;
  lbs: number;
}

export interface FifoDrawdownResult {
  /** per-lot attribution of the draw, oldest lot first */
  allocations: LotQuantity[];
  allocatedLbs: number;
  /** > 0 when the bin holds less grain than was requested */
  shortfallLbs: number;
}

/**
 * Chronological events touching `binId`, oldest first. Events are ordered by
 * (createdAt, id) — the id tie-break keeps same-second events in insert order.
 * Non-positive quantities are ignored (a movement always moves grain).
 * `cutoffAt` (Phase B, #12): when set, only events strictly AFTER it are
 * considered — a completed bin cleanout is a genealogy reset point, so grain
 * that predates it is no longer part of the bin's lineage.
 */
function orderedEventsForBin(
  events: BinMovementEvent[],
  binId: number,
  cutoffAt?: Date | null,
): BinMovementEvent[] {
  const cutoffMs = cutoffAt ? cutoffAt.getTime() : null;
  return events
    .filter(
      (e) =>
        e.quantityLbs > 0 &&
        (e.fromBinId === binId || e.toBinId === binId) &&
        (cutoffMs == null || e.createdAt.getTime() > cutoffMs),
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
}

/** Consume `lbs` from the front (oldest) of the layer stack, in place. */
function consumeOldest(layers: BinLotLayer[], lbs: number): void {
  let remaining = lbs;
  while (remaining > 0 && layers.length > 0) {
    const head = layers[0]!;
    const take = Math.min(head.lbs, remaining);
    head.lbs -= take;
    remaining -= take;
    if (head.lbs === 0) layers.shift();
  }
}

/**
 * Replay the log and return the bin's remaining grain as FIFO layers, oldest
 * first. A transfer event (both fromBinId and toBinId set) counts as an
 * outflow for the source bin and an inflow for the destination. Outflows
 * always consume the oldest layers first, regardless of the lot recorded on
 * the outbound event — that lotId is the attribution computed at write time,
 * and replaying FIFO keeps the log self-consistent. `cutoffAt` (Phase B,
 * #12) bounds the replay to events strictly after a completed cleanout — a
 * cleanout is a genealogy reset point.
 */
export function binLayers(
  events: BinMovementEvent[],
  binId: number,
  cutoffAt?: Date | null,
): BinLotLayer[] {
  const layers: BinLotLayer[] = [];
  for (const e of orderedEventsForBin(events, binId, cutoffAt)) {
    if (e.toBinId === binId) {
      layers.push({ lotId: e.lotId, lbs: e.quantityLbs, since: e.createdAt, movementId: e.id });
    }
    if (e.fromBinId === binId) {
      consumeOldest(layers, e.quantityLbs);
    }
  }
  return layers;
}

/**
 * A bin's current composition by lot: lotId → lbs still in the bin, ordered
 * by when each lot's oldest remaining grain entered (oldest lot first). Only
 * lots with a positive balance are listed. lotId null aggregates lot-less
 * (unknown-origin) grain.
 */
export function binCompositionByLot(
  events: BinMovementEvent[],
  binId: number,
  cutoffAt?: Date | null,
): LotQuantity[] {
  const order: (number | null)[] = [];
  const byLot = new Map<number | null, number>();
  for (const layer of binLayers(events, binId, cutoffAt)) {
    if (!byLot.has(layer.lotId)) order.push(layer.lotId);
    byLot.set(layer.lotId, (byLot.get(layer.lotId) ?? 0) + layer.lbs);
  }
  return order
    .map((lotId) => ({ lotId, lbs: byLot.get(lotId) ?? 0 }))
    .filter((q) => q.lbs > 0);
}

/** Total lbs currently in the bin according to the log (reconcile vs bins.currentLbs). */
export function binTotalLbs(
  events: BinMovementEvent[],
  binId: number,
  cutoffAt?: Date | null,
): number {
  return binLayers(events, binId, cutoffAt).reduce((sum, l) => sum + l.lbs, 0);
}

/**
 * FIFO drawdown: attribute a shipment of `quantityLbs` from `binId` to the
 * lots whose grain is oldest in the bin. When the bin holds less than
 * requested, everything present is allocated and `shortfallLbs` reports the
 * gap — the caller decides whether a short shipment is acceptable.
 */
export function fifoDrawdown(
  events: BinMovementEvent[],
  binId: number,
  quantityLbs: number,
  cutoffAt?: Date | null,
): FifoDrawdownResult {
  if (!Number.isFinite(quantityLbs) || quantityLbs <= 0) {
    throw new Error("fifoDrawdown: quantityLbs must be a positive number");
  }
  const layers = binLayers(events, binId, cutoffAt);
  const allocations: LotQuantity[] = [];
  let remaining = quantityLbs;
  for (const layer of layers) {
    if (remaining <= 0) break;
    const take = Math.min(layer.lbs, remaining);
    const last = allocations[allocations.length - 1];
    if (last && last.lotId === layer.lotId) {
      last.lbs += take; // same lot in several layers — merge, keep oldest-first order
    } else {
      allocations.push({ lotId: layer.lotId, lbs: take });
    }
    remaining -= take;
  }
  const allocatedLbs = quantityLbs - remaining;
  return { allocations, allocatedLbs, shortfallLbs: remaining };
}

// ---------------------------------------------------------------------------
// Per-bin quality averaging (Phase A, research #18) — computed, NOT stored.
// The bin's current grain (the FIFO layers above) is attributed back to the
// inbound loads that delivered it, and each load's grade factors are averaged
// weighted by the lbs of that load still in the bin. Manual overrides are
// stored separately (bin_grade_overrides table) and applied by the caller.
// ---------------------------------------------------------------------------

/** Grade factors averaged per bin. */
export const BIN_GRADE_FACTOR_KEYS = [
  "moisturePct",
  "testWeightLbs",
  "dockagePct",
  "damagePct",
  "proteinPct",
] as const;

export type BinGradeFactorKey = (typeof BIN_GRADE_FACTOR_KEYS)[number];

/** The grade readings of one load (a loads-table row or plain object). */
export interface LoadGradeSample {
  id: number;
  moisturePct?: number | null;
  testWeightLbs?: number | null;
  dockagePct?: number | null;
  damagePct?: number | null;
  proteinPct?: number | null;
}

export interface FactorAverage {
  /** lbs-weighted average over the grain with a reading for this factor */
  value: number;
  /** lbs of grain that had a reading (grain without one is excluded) */
  coveredLbs: number;
}

export interface BinGradeAverages {
  /** lbs currently in the bin according to the log */
  totalLbs: number;
  moisturePct: FactorAverage | null;
  testWeightLbs: FactorAverage | null;
  dockagePct: FactorAverage | null;
  damagePct: FactorAverage | null;
  proteinPct: FactorAverage | null;
}

/**
 * lbs-weighted average grade factors for the grain currently in `binId`,
 * derived from the event log: each remaining FIFO layer is weighted by its
 * lbs and contributes the grade readings of the load that delivered it.
 * Layers whose load carried no reading for a factor are excluded from that
 * factor's average (reported via coveredLbs); a factor with no readings at
 * all comes back null. Lot-less layers (manual adjustments) carry no grades.
 */
export function binGradeAverages(
  events: (BinMovementEvent & { loadId?: number | null })[],
  loads: LoadGradeSample[],
  binId: number,
  cutoffAt?: Date | null,
): BinGradeAverages {
  const gradesByLoadId = new Map(loads.map((l) => [l.id, l]));
  const loadByMovementId = new Map(events.map((e) => [e.id, e.loadId ?? null]));
  const layers = binLayers(events, binId, cutoffAt);
  const totalLbs = layers.reduce((sum, l) => sum + l.lbs, 0);

  const result = { totalLbs } as BinGradeAverages;
  for (const key of BIN_GRADE_FACTOR_KEYS) {
    let weightedSum = 0;
    let coveredLbs = 0;
    for (const layer of layers) {
      const loadId = loadByMovementId.get(layer.movementId);
      const sample = loadId != null ? gradesByLoadId.get(loadId) : undefined;
      const value = sample?.[key];
      if (value == null) continue;
      weightedSum += value * layer.lbs;
      coveredLbs += layer.lbs;
    }
    result[key] =
      coveredLbs > 0
        ? { value: Math.round((weightedSum / coveredLbs) * 100) / 100, coveredLbs }
        : null;
  }
  return result;
}

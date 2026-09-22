// ---------------------------------------------------------------------------
// Load split contracts (Phase A, research feature #4) — grower/landlord
// percentage splits on a delivered load. Contract: the splits for one load
// must sum to 100%.
// ---------------------------------------------------------------------------

import { z } from "zod";

export const SPLIT_PARTY_TYPES = ["farmer", "landlord"] as const;
export type SplitPartyType = (typeof SPLIT_PARTY_TYPES)[number];

/** Tolerance for float sums, e.g. 33.33 + 33.33 + 33.34 = 100.00. */
export const SPLIT_SUM_TOLERANCE_PCT = 0.01;

export const loadSplitSchema = z.object({
  loadId: z.number().int().positive(),
  partyType: z.enum(SPLIT_PARTY_TYPES),
  partyId: z.number().int().positive(),
  splitPct: z.number().gt(0).max(100),
});

export type LoadSplitInput = z.infer<typeof loadSplitSchema>;

/**
 * The splits recorded for one load. At least one split, each in (0, 100],
 * and the percentages must sum to 100 (±0.01 for float dust).
 */
export const loadSplitsSchema = z
  .array(loadSplitSchema.omit({ loadId: true }))
  .min(1)
  .refine((splits) => splitsSumToHundred(splits), {
    message: "splits for a load must sum to 100%",
  });

/** Sum check used by both the zod schema and the Phase-B API. */
export function splitsSumToHundred(splits: { splitPct: number }[]): boolean {
  if (splits.length === 0) return false;
  const total = splits.reduce((sum, s) => sum + s.splitPct, 0);
  return Math.abs(total - 100) <= SPLIT_SUM_TOLERANCE_PCT;
}

/**
 * Validation helper returning detail instead of throwing — the API surfaces
 * the actual total when a user enters a bad split set.
 */
export function validateLoadSplits(splits: { splitPct: number }[]): {
  valid: boolean;
  totalPct: number;
} {
  const totalPct = Math.round(splits.reduce((sum, s) => sum + s.splitPct, 0) * 100) / 100;
  return { valid: splitsSumToHundred(splits), totalPct };
}

// ---------------------------------------------------------------------------
// Grading configuration contracts (Phase A, research feature #3).
//
// Shrink/dock schedules and grade-factor min/max ranges live in EDITABLE
// tables (grading_schedules / grade_factors, seeded on boot with the defaults
// below) — not hardcoded — because every elevator negotiates its own tables.
// This module holds the zod input schemas, the default seed values, and the
// pure math that applies a schedule to a load / validates a grade reading.
// ---------------------------------------------------------------------------

import { z } from "zod";
import { baseMoisture, bushelWeight, round2 } from "./grain";

/** Grade factors a load can carry (columns on `loads`). */
export const GRADE_FACTORS = [
  "moisturePct",
  "testWeight",
  "dockagePct",
  "damagePct",
  "foreignMaterialPct",
  "sbPct",
  "proteinPct",
] as const;

export type GradeFactorName = (typeof GRADE_FACTORS)[number];

/** True water-removal shrink per point of moisture (industry standard). */
export const DEFAULT_MOISTURE_SHRINK_PER_POINT = 1.183;

/** Invisible handling loss, % (research rule of thumb: 0.5% in-and-out). */
export const DEFAULT_HANDLING_SHRINK_PCT = 0.5;

export const gradingScheduleSchema = z.object({
  siteId: z.number().int().positive().nullable().optional(),
  crop: z.string().trim().min(1).max(64),
  moistureShrinkPerPoint: z.number().min(0).max(5),
  baseMoisturePct: z.number().min(0).max(40),
  handlingShrinkPct: z.number().min(0).max(10).default(0),
  dockageRules: z.string().max(2000).nullable().optional(),
});

export type GradingScheduleInput = z.infer<typeof gradingScheduleSchema>;

export const gradeFactorSchema = z
  .object({
    siteId: z.number().int().positive().nullable().optional(),
    crop: z.string().trim().min(1).max(64),
    gradeClass: z.string().trim().min(1).max(32),
    factor: z.enum(GRADE_FACTORS),
    minValue: z.number().nullable().optional(),
    maxValue: z.number().nullable().optional(),
  })
  .refine((r) => r.minValue == null || r.maxValue == null || r.minValue <= r.maxValue, {
    message: "minValue must be <= maxValue",
  });

export type GradeFactorInput = z.infer<typeof gradeFactorSchema>;

/**
 * Default shrink/dock schedules for the big-three US crops, derived from
 * shared/contracts/grain.ts (base moisture) + the industry-standard 1.183%
 * per point true shrink. Handling shrink defaults to the 0.5% in-and-out
 * rule of thumb; dockage is deducted 1:1 from gross bushels.
 */
export function defaultGradingSchedules(): GradingScheduleInput[] {
  return ["Corn", "Soybeans", "Wheat"].map((crop) => ({
    siteId: null,
    crop,
    moistureShrinkPerPoint: DEFAULT_MOISTURE_SHRINK_PER_POINT,
    baseMoisturePct: baseMoisture(crop),
    handlingShrinkPct: DEFAULT_HANDLING_SHRINK_PCT,
    dockageRules: "Dockage deducted 1:1 from gross bushels",
  }));
}

/**
 * Default grade-factor ranges — approximations of the US (USGSA) grade
 * minimums/maximums for corn / soybeans / wheat, editable per elevator.
 * Wheat test weights vary by class; these are sensible middle values.
 */
export function defaultGradeFactors(): GradeFactorInput[] {
  const rows: GradeFactorInput[] = [];
  const add = (
    crop: string,
    gradeClass: string,
    factor: GradeFactorName,
    minValue: number | null,
    maxValue: number | null,
  ) => rows.push({ siteId: null, crop, gradeClass, factor, minValue, maxValue });

  const corn: [string, number, number, number, number][] = [
    // gradeClass, testWeight min, damage max, FM max, S&B max
    ["No. 1", 56, 3, 2, 3],
    ["No. 2", 54, 5, 3, 5],
    ["No. 3", 52, 7, 4, 7],
  ];
  for (const [gc, tw, dmg, fm, sb] of corn) {
    add("Corn", gc, "testWeight", tw, null);
    add("Corn", gc, "damagePct", null, dmg);
    add("Corn", gc, "foreignMaterialPct", null, fm);
    add("Corn", gc, "sbPct", null, sb);
  }

  const soy: [string, number, number, number][] = [
    ["No. 1", 56, 2, 1],
    ["No. 2", 54, 3, 2],
    ["No. 3", 52, 5, 3],
  ];
  for (const [gc, tw, dmg, fm] of soy) {
    add("Soybeans", gc, "testWeight", tw, null);
    add("Soybeans", gc, "damagePct", null, dmg);
    add("Soybeans", gc, "foreignMaterialPct", null, fm);
  }

  const wheat: [string, number, number, number][] = [
    ["No. 1", 58, 2, 0.5],
    ["No. 2", 57, 4, 0.7],
    ["No. 3", 56, 6, 1.0],
  ];
  for (const [gc, tw, dmg, fm] of wheat) {
    add("Wheat", gc, "testWeight", tw, null);
    add("Wheat", gc, "damagePct", null, dmg);
    add("Wheat", gc, "foreignMaterialPct", null, fm);
  }

  return rows;
}

export interface MoistureShrinkResult {
  /** points of moisture above base (0 when at/below base) */
  pointsOver: number;
  /** shrink % of the load weight */
  shrinkPct: number;
  /** lbs of water weight removed */
  shrinkLbs: number;
  /** lbs remaining after shrink */
  shrunkLbs: number;
}

/**
 * Apply a moisture shrink schedule to a load's net weight. Linear per-point
 * on the weight, consistent with grain.ts moistureShrinkPct; capped at 99%
 * so a result never goes negative. ratePerPoint defaults to the 1.183% true
 * water-removal shrink (elevators may charge more — that's the table's job).
 */
export function applyMoistureShrink(
  netLbs: number,
  moisturePct: number | null | undefined,
  baseMoisturePct: number,
  ratePerPoint: number = DEFAULT_MOISTURE_SHRINK_PER_POINT,
): MoistureShrinkResult {
  if (moisturePct == null || netLbs <= 0) {
    return { pointsOver: 0, shrinkPct: 0, shrinkLbs: 0, shrunkLbs: round2(Math.max(netLbs, 0)) };
  }
  const pointsOver = Math.max(0, moisturePct - baseMoisturePct);
  const shrinkPct = Math.min(round2(pointsOver * ratePerPoint), 99);
  const shrinkLbs = round2((netLbs * shrinkPct) / 100);
  return { pointsOver: round2(pointsOver), shrinkPct, shrinkLbs, shrunkLbs: round2(netLbs - shrinkLbs) };
}

/** One grade-factor range row (as stored in grade_factors). */
export interface GradeFactorRule {
  gradeClass: string;
  factor: string;
  minValue: number | null;
  maxValue: number | null;
}

export interface GradeFactorViolation {
  gradeClass: string;
  factor: string;
  value: number;
  minValue: number | null;
  maxValue: number | null;
  direction: "below-min" | "above-max";
}

/**
 * Validate grade readings against the factor ranges of one grade class.
 * Only factors with a reading (non-null value) and a configured bound are
 * checked; unbounded factors (no row, or both bounds null) always pass.
 */
export function validateGradeFactors(
  rules: GradeFactorRule[],
  values: Partial<Record<GradeFactorName, number | null | undefined>>,
): GradeFactorViolation[] {
  const violations: GradeFactorViolation[] = [];
  for (const rule of rules) {
    const value = values[rule.factor as GradeFactorName];
    if (value == null) continue;
    if (rule.minValue != null && value < rule.minValue) {
      violations.push({
        gradeClass: rule.gradeClass,
        factor: rule.factor,
        value,
        minValue: rule.minValue,
        maxValue: rule.maxValue,
        direction: "below-min",
      });
    } else if (rule.maxValue != null && value > rule.maxValue) {
      violations.push({
        gradeClass: rule.gradeClass,
        factor: rule.factor,
        value,
        minValue: rule.minValue,
        maxValue: rule.maxValue,
        direction: "above-max",
      });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Apply-on-weigh settlement math (Phase B, #3) — schedule-driven shrink/dock.
// ---------------------------------------------------------------------------

/** The schedule applied to a load (a grading_schedules row or equivalent). */
export interface ScheduleLike {
  moistureShrinkPerPoint: number;
  baseMoisturePct: number;
  handlingShrinkPct: number;
}

export interface GradeAdjustmentResult {
  /** points of moisture above the schedule base */
  pointsOver: number;
  /** lbs of moisture shrink (schedule rate per point) */
  moistureShrinkLbs: number;
  /** lbs of handling shrink (schedule handling %) */
  handlingLbs: number;
  /** total shrink lbs (moisture + handling) — stamped on loads.shrinkLbs */
  shrinkLbs: number;
  /** lbs of dockage (dockagePct of net weight) — stamped on loads.dockLbs */
  dockLbs: number;
  /** combined shrink+dock as % of net weight — stamped on loads.shrinkPct */
  shrinkPct: number;
  grossBushels: number;
  netBushels: number;
}

/**
 * Compute the shrink/dock/bushel breakdown for a load from its grading
 * schedule (1.183%/point true shrink + schedule handling + dockage 1:1).
 * Falls back to the grain.ts base moisture when the schedule lacks one.
 * Returns null when the load has no net weight yet.
 */
export function computeGradeAdjustments(
  crop: string,
  netLbs: number | null | undefined,
  moisturePct: number | null | undefined,
  dockagePct: number | null | undefined,
  schedule?: ScheduleLike | null,
): GradeAdjustmentResult | null {
  if (netLbs == null || netLbs <= 0) return null;
  const sched: ScheduleLike = schedule ?? {
    moistureShrinkPerPoint: DEFAULT_MOISTURE_SHRINK_PER_POINT,
    baseMoisturePct: baseMoisture(crop),
    handlingShrinkPct: 0,
  };
  const moisture = applyMoistureShrink(
    netLbs,
    moisturePct,
    sched.baseMoisturePct,
    sched.moistureShrinkPerPoint,
  );
  const handlingLbs = round2((netLbs * Math.min(Math.max(sched.handlingShrinkPct, 0), 10)) / 100);
  const shrinkLbs = round2(moisture.shrinkLbs + handlingLbs);
  const dockLbs = round2((netLbs * Math.min(Math.max(dockagePct ?? 0, 0), 50)) / 100);
  const deducted = Math.min(shrinkLbs + dockLbs, netLbs * 0.99);
  const bw = bushelWeight(crop);
  return {
    pointsOver: moisture.pointsOver,
    moistureShrinkLbs: moisture.shrinkLbs,
    handlingLbs,
    shrinkLbs,
    dockLbs,
    shrinkPct: round2((deducted / netLbs) * 100),
    grossBushels: round2(netLbs / bw),
    netBushels: round2((netLbs - deducted) / bw),
  };
}

import { describe, expect, it } from "vitest";
import {
  DEFAULT_HANDLING_SHRINK_PCT,
  DEFAULT_MOISTURE_SHRINK_PER_POINT,
  applyMoistureShrink,
  defaultGradeFactors,
  defaultGradingSchedules,
  gradeFactorSchema,
  gradingScheduleSchema,
  validateGradeFactors,
  type GradeFactorRule,
} from "./grading";
import { baseMoisture } from "./grain";

describe("default grading tables (#3)", () => {
  it("seeds shrink/dock schedules for corn, soybeans and wheat from grain.ts", () => {
    const schedules = defaultGradingSchedules();
    expect(schedules.map((s) => s.crop)).toEqual(["Corn", "Soybeans", "Wheat"]);
    for (const s of schedules) {
      expect(s.baseMoisturePct).toBe(baseMoisture(s.crop));
      expect(s.moistureShrinkPerPoint).toBe(DEFAULT_MOISTURE_SHRINK_PER_POINT);
      expect(s.handlingShrinkPct).toBe(DEFAULT_HANDLING_SHRINK_PCT);
      expect(gradingScheduleSchema.safeParse(s).success).toBe(true);
    }
  });

  it("seeds grade factor ranges per grade class and validates as inputs", () => {
    const factors = defaultGradeFactors();
    const corn2 = factors.filter((f) => f.crop === "Corn" && f.gradeClass === "No. 2");
    // US No. 2 corn: TW >= 54, damage <= 5, FM <= 3, S&B <= 5
    expect(corn2.find((f) => f.factor === "testWeight")?.minValue).toBe(54);
    expect(corn2.find((f) => f.factor === "damagePct")?.maxValue).toBe(5);
    expect(corn2.find((f) => f.factor === "foreignMaterialPct")?.maxValue).toBe(3);
    expect(corn2.find((f) => f.factor === "sbPct")?.maxValue).toBe(5);
    for (const f of factors) {
      expect(gradeFactorSchema.safeParse(f).success).toBe(true);
    }
  });

  it("rejects a factor row whose min exceeds its max", () => {
    const bad = { crop: "Corn", gradeClass: "No. 1", factor: "damagePct", minValue: 5, maxValue: 3 };
    expect(gradeFactorSchema.safeParse(bad).success).toBe(false);
  });
});

describe("applyMoistureShrink", () => {
  it("applies the 1.183%/point default to a load", () => {
    // 56,000 lbs corn at 17.0% vs 15.0% base → 2 points × 1.183 = 2.366%
    const r = applyMoistureShrink(56000, 17.0, 15.0);
    expect(r.pointsOver).toBe(2);
    expect(r.shrinkPct).toBeCloseTo(2.37, 2);
    expect(r.shrinkLbs).toBeCloseTo(1327.2, 2);
    expect(r.shrunkLbs).toBeCloseTo(54672.8, 2);
  });

  it("is zero at or below base moisture and for missing readings", () => {
    expect(applyMoistureShrink(56000, 15.0, 15.0).shrinkLbs).toBe(0);
    expect(applyMoistureShrink(56000, 13.0, 15.0).shrinkLbs).toBe(0);
    expect(applyMoistureShrink(56000, null, 15.0).shrinkLbs).toBe(0);
    expect(applyMoistureShrink(56000, undefined, 15.0).shrinkLbs).toBe(0);
  });

  it("honors an elevator's own rate (e.g. 1.4%/point charged)", () => {
    const r = applyMoistureShrink(56000, 17.0, 15.0, 1.4);
    expect(r.shrinkPct).toBeCloseTo(2.8, 2);
    expect(r.shrinkLbs).toBeCloseTo(1568, 2);
  });

  it("never shrinks more than 99% of the load", () => {
    // 100% moisture vs 15% base = 85 points × 1.183 = 100.555% → capped
    const r = applyMoistureShrink(56000, 100, 15.0);
    expect(r.shrinkPct).toBe(99);
    expect(r.shrunkLbs).toBeGreaterThan(0);
  });
});

describe("validateGradeFactors", () => {
  const rules: GradeFactorRule[] = [
    { gradeClass: "No. 2", factor: "testWeight", minValue: 54, maxValue: null },
    { gradeClass: "No. 2", factor: "damagePct", minValue: null, maxValue: 5 },
    { gradeClass: "No. 2", factor: "moisturePct", minValue: null, maxValue: null },
  ];

  it("passes readings inside the ranges", () => {
    expect(
      validateGradeFactors(rules, { testWeight: 56, damagePct: 3, moisturePct: 15 }),
    ).toEqual([]);
  });

  it("flags below-min and above-max violations with direction", () => {
    const violations = validateGradeFactors(rules, { testWeight: 52, damagePct: 8 });
    expect(violations).toHaveLength(2);
    expect(violations[0]).toMatchObject({ factor: "testWeight", value: 52, direction: "below-min" });
    expect(violations[1]).toMatchObject({ factor: "damagePct", value: 8, direction: "above-max" });
  });

  it("ignores missing readings and unbounded factors", () => {
    expect(validateGradeFactors(rules, {})).toEqual([]);
    expect(validateGradeFactors(rules, { moisturePct: 22 })).toEqual([]);
  });
});

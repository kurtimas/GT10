import { describe, expect, it } from "vitest";
import {
  loadSplitSchema,
  loadSplitsSchema,
  splitsSumToHundred,
  validateLoadSplits,
} from "./splits";

describe("loadSplitSchema", () => {
  it("accepts a farmer/landlord split row", () => {
    expect(
      loadSplitSchema.safeParse({ loadId: 1, partyType: "farmer", partyId: 7, splitPct: 75 })
        .success,
    ).toBe(true);
  });

  it("rejects unknown party types and out-of-range percentages", () => {
    expect(
      loadSplitSchema.safeParse({ loadId: 1, partyType: "coop", partyId: 7, splitPct: 75 }).success,
    ).toBe(false);
    expect(
      loadSplitSchema.safeParse({ loadId: 1, partyType: "farmer", partyId: 7, splitPct: 0 }).success,
    ).toBe(false);
    expect(
      loadSplitSchema.safeParse({ loadId: 1, partyType: "farmer", partyId: 7, splitPct: 101 })
        .success,
    ).toBe(false);
  });
});

describe("splits sum-to-100 contract (#4)", () => {
  it("accepts splits summing to exactly 100", () => {
    const splits = [
      { partyType: "farmer" as const, partyId: 1, splitPct: 75 },
      { partyType: "landlord" as const, partyId: 2, splitPct: 25 },
    ];
    expect(loadSplitsSchema.safeParse(splits).success).toBe(true);
    expect(validateLoadSplits(splits)).toEqual({ valid: true, totalPct: 100 });
  });

  it("accepts float thirds within tolerance", () => {
    const splits = [
      { partyType: "farmer" as const, partyId: 1, splitPct: 33.33 },
      { partyType: "landlord" as const, partyId: 2, splitPct: 33.33 },
      { partyType: "landlord" as const, partyId: 3, splitPct: 33.34 },
    ];
    expect(splitsSumToHundred(splits)).toBe(true);
  });

  it("rejects sums under or over 100 and reports the total", () => {
    for (const pcts of [[50, 40], [60, 50], [100, 0.02]]) {
      const splits = pcts.map((splitPct, i) => ({
        partyType: "farmer" as const,
        partyId: i + 1,
        splitPct,
      }));
      expect(splitsSumToHundred(splits)).toBe(false);
      expect(loadSplitsSchema.safeParse(splits).success).toBe(false);
    }
    const bad = [{ splitPct: 50 }, { splitPct: 40 }];
    expect(validateLoadSplits(bad)).toEqual({ valid: false, totalPct: 90 });
  });

  it("rejects an empty split set", () => {
    expect(splitsSumToHundred([])).toBe(false);
    expect(loadSplitsSchema.safeParse([]).success).toBe(false);
  });

  it("accepts a single 100% split", () => {
    expect(splitsSumToHundred([{ splitPct: 100 }])).toBe(true);
  });
});

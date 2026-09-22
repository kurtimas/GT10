import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROGRAM,
  DEFAULT_RETENTION_YEARS,
  certificateSchema,
  labResultSchema,
  programSchema,
  retentionYearsSchema,
  shrinkEntrySchema,
} from "./compliance";

describe("retention setting (#9)", () => {
  it("defaults to 6 years (covers Iowa 6 + organic/EUDR 5)", () => {
    expect(DEFAULT_RETENTION_YEARS).toBe(6);
  });

  it("validates the 2–10 year range", () => {
    expect(retentionYearsSchema.safeParse(2).success).toBe(true);
    expect(retentionYearsSchema.safeParse(6).success).toBe(true);
    expect(retentionYearsSchema.safeParse(10).success).toBe(true);
    expect(retentionYearsSchema.safeParse(1).success).toBe(false);
    expect(retentionYearsSchema.safeParse(11).success).toBe(false);
    expect(retentionYearsSchema.safeParse(5.5).success).toBe(false);
  });
});

describe("program segregation (#17)", () => {
  it("defaults to conventional and accepts free-ish program tags", () => {
    expect(programSchema.parse(undefined)).toBe(DEFAULT_PROGRAM);
    expect(programSchema.parse("organic")).toBe("organic");
    expect(programSchema.parse("my-custom-program")).toBe("my-custom-program");
    expect(programSchema.safeParse("").success).toBe(false);
  });
});

describe("shrink entries (#15)", () => {
  const base = {
    siteId: 1,
    binId: 2,
    kind: "moisture",
    effectiveDate: new Date("2026-09-01"),
  };

  it("accepts signed adjustments in either direction", () => {
    expect(shrinkEntrySchema.safeParse({ ...base, quantityLbs: -420 }).success).toBe(true);
    expect(shrinkEntrySchema.safeParse({ ...base, quantityLbs: 300 }).success).toBe(true);
  });

  it("rejects a zero adjustment (it would be noise on the DPR)", () => {
    expect(shrinkEntrySchema.safeParse({ ...base, quantityLbs: 0 }).success).toBe(false);
  });
});

describe("certificates (#20)", () => {
  it("defaults status to issued and allows lot-less certificates", () => {
    const parsed = certificateSchema.parse({
      siteId: 1,
      type: "fgis-inspection",
      certNumber: "FGIS-2026-001",
      issuedAt: new Date("2026-09-01"),
    });
    expect(parsed.status).toBe("issued");
    expect(parsed.lotId ?? null).toBeNull();
  });

  it("rejects unknown lifecycle statuses", () => {
    const r = certificateSchema.safeParse({
      siteId: 1,
      type: "phyto",
      certNumber: "X-1",
      issuedAt: new Date(),
      status: "cancelled",
    });
    expect(r.success).toBe(false);
  });
});

describe("lab results (#22)", () => {
  const base = {
    siteId: 1,
    sampleDate: new Date("2026-09-01"),
    testType: "DON",
    result: "4.2 ppm",
  };

  it("must be tied to a lot, load, or bin", () => {
    expect(labResultSchema.safeParse(base).success).toBe(false);
    expect(labResultSchema.safeParse({ ...base, lotId: 5 }).success).toBe(true);
    expect(labResultSchema.safeParse({ ...base, loadId: 5 }).success).toBe(true);
    expect(labResultSchema.safeParse({ ...base, binId: 5 }).success).toBe(true);
  });

  it("passFail is nullable and restricted to pass/fail", () => {
    expect(labResultSchema.safeParse({ ...base, lotId: 5, passFail: "pass" }).success).toBe(true);
    expect(labResultSchema.safeParse({ ...base, lotId: 5, passFail: "maybe" }).success).toBe(false);
  });
});

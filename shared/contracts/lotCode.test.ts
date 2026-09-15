import { describe, expect, it } from "vitest";
import { farmInitials, lotCodeBase, nextLotCode } from "./lotCode";

const NOW = new Date("2026-08-13T12:00:00");

describe("farmInitials", () => {
  it("takes the first letter of each word", () => {
    expect(farmInitials("Kurt Miller")).toBe("KM");
    expect(farmInitials("Triple J Ag")).toBe("TJA");
    expect(farmInitials("Marlene Klassen")).toBe("MK");
  });
  it("splits on punctuation and drops parentheticals", () => {
    expect(farmInitials("S&C Farms (Sam Cole)")).toBe("SCF");
  });
  it("falls back for empty names", () => {
    expect(farmInitials("")).toBe("FARM");
  });
});

describe("nextLotCode", () => {
  it("starts at 01 for a new farmer-year", () => {
    expect(nextLotCode([], "Kurt Miller", undefined, NOW)).toBe("706C-KM-26-01");
  });
  it("increments past the highest existing sequence", () => {
    const codes = ["706C-KM-26-01", "706C-KM-26-02"];
    expect(nextLotCode(codes, "Kurt Miller", undefined, NOW)).toBe("706C-KM-26-03");
  });
  it("ignores other farmers, other years, and old-format codes", () => {
    const codes = [
      "706C-MK-26-05",
      "706C-KM-25-09",
      "KMF-26-C1",
      "706C-KM-2601", // pre-2026 fused year+sequence format
      "706C-KM-26A",
    ];
    expect(nextLotCode(codes, "Kurt Miller", undefined, NOW)).toBe("706C-KM-26-01");
  });
  it("keeps two-digit padding past 09", () => {
    const codes = ["706C-KM-26-09"];
    expect(nextLotCode(codes, "Kurt Miller", undefined, NOW)).toBe("706C-KM-26-10");
  });
  it("appends landlord initials after the farmer's", () => {
    expect(nextLotCode([], "Kurt Miller", "J. Smith", NOW)).toBe("706C-KMJS-26-01");
    const codes = ["706C-KMJS-26-01"];
    expect(nextLotCode(codes, "Kurt Miller", "J. Smith", NOW)).toBe("706C-KMJS-26-02");
  });
  it("counts landlord and no-landlord lots separately for the same farmer", () => {
    const codes = ["706C-KM-26-01", "706C-KM-26-02", "706C-KMJS-26-01"];
    expect(nextLotCode(codes, "Kurt Miller", undefined, NOW)).toBe("706C-KM-26-03");
    expect(nextLotCode(codes, "Kurt Miller", "J. Smith", NOW)).toBe("706C-KMJS-26-02");
  });
  it("uses the current year", () => {
    expect(lotCodeBase("Kurt Miller", undefined, new Date("2027-01-05"))).toBe("706C-KM-27");
    expect(lotCodeBase("Kurt Miller", "J. Smith", new Date("2027-01-05"))).toBe("706C-KMJS-27");
  });
});

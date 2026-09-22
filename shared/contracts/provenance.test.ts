import { describe, expect, it } from "vitest";
import {
  binCompositionByLot,
  binGradeAverages,
  binLayers,
  binTotalLbs,
  fifoDrawdown,
  type BinMovementEvent,
} from "./provenance";

// ---------------------------------------------------------------------------
// Provenance math over the bin_movements event log. The scenario used below:
// lot 1 and lot 2 both fill bin 10 (the case that used to destroy provenance),
// then grain ships out and transfers between bins.
// ---------------------------------------------------------------------------

let nextId = 1;
function mv(
  partial: Omit<BinMovementEvent, "id" | "createdAt"> & { at?: Date; loadId?: number | null },
): BinMovementEvent & { loadId?: number | null } {
  return {
    id: nextId++,
    createdAt: partial.at ?? new Date(2026, 0, nextId), // later ids default to later times
    ...partial,
  };
}

const LOT1 = 1;
const LOT2 = 2;
const BIN = 10;
const OTHER_BIN = 20;

beforeEachReset();
function beforeEachReset() {
  nextId = 1;
}

describe("binLayers / binCompositionByLot", () => {
  it("empty log → empty composition and zero total", () => {
    expect(binLayers([], BIN)).toEqual([]);
    expect(binCompositionByLot([], BIN)).toEqual([]);
    expect(binTotalLbs([], BIN)).toBe(0);
  });

  it("one lot into one bin gives a single layer", () => {
    const log = [mv({ lotId: LOT1, fromBinId: null, toBinId: BIN, quantityLbs: 50_000 })];
    expect(binLayers(log, BIN)).toMatchObject([{ lotId: LOT1, lbs: 50_000 }]);
    expect(binCompositionByLot(log, BIN)).toEqual([{ lotId: LOT1, lbs: 50_000 }]);
    expect(binTotalLbs(log, BIN)).toBe(50_000);
  });

  it("two lots sharing a bin keep their provenance (the review's core gap)", () => {
    const log = [
      mv({ lotId: LOT1, fromBinId: null, toBinId: BIN, quantityLbs: 40_000 }),
      mv({ lotId: LOT2, fromBinId: null, toBinId: BIN, quantityLbs: 30_000 }),
    ];
    expect(binCompositionByLot(log, BIN)).toEqual([
      { lotId: LOT1, lbs: 40_000 },
      { lotId: LOT2, lbs: 30_000 },
    ]);
    expect(binTotalLbs(log, BIN)).toBe(70_000);
  });

  it("an outbound draw consumes the oldest lot first", () => {
    const log = [
      mv({ lotId: LOT1, fromBinId: null, toBinId: BIN, quantityLbs: 40_000 }),
      mv({ lotId: LOT2, fromBinId: null, toBinId: BIN, quantityLbs: 30_000 }),
      // ship 50k: all of lot 1 (40k) + 10k of lot 2
      mv({ lotId: null, fromBinId: BIN, toBinId: null, quantityLbs: 50_000 }),
    ];
    expect(binCompositionByLot(log, BIN)).toEqual([{ lotId: LOT2, lbs: 20_000 }]);
    expect(binTotalLbs(log, BIN)).toBe(20_000);
  });

  it("a bin-to-bin transfer debits the source and credits the destination FIFO-style", () => {
    const log = [
      mv({ lotId: LOT1, fromBinId: null, toBinId: BIN, quantityLbs: 40_000 }),
      mv({ lotId: LOT2, fromBinId: null, toBinId: BIN, quantityLbs: 30_000 }),
      // move 50k to another bin: lot 1 goes first, then 10k of lot 2
      mv({ lotId: LOT1, fromBinId: BIN, toBinId: OTHER_BIN, quantityLbs: 50_000 }),
    ];
    expect(binCompositionByLot(log, BIN)).toEqual([{ lotId: LOT2, lbs: 20_000 }]);
    expect(binCompositionByLot(log, OTHER_BIN)).toEqual([{ lotId: LOT1, lbs: 50_000 }]);
  });

  it("ignores events for other bins", () => {
    const log = [
      mv({ lotId: LOT1, fromBinId: null, toBinId: OTHER_BIN, quantityLbs: 99_000 }),
      mv({ lotId: LOT2, fromBinId: null, toBinId: BIN, quantityLbs: 10_000 }),
    ];
    expect(binCompositionByLot(log, BIN)).toEqual([{ lotId: LOT2, lbs: 10_000 }]);
  });

  it("ignores non-positive quantities and orders same-timestamp events by id", () => {
    const at = new Date(2026, 5, 1, 8, 0, 0);
    const log = [
      mv({ lotId: LOT1, fromBinId: null, toBinId: BIN, quantityLbs: 0, at }),
      mv({ lotId: LOT1, fromBinId: null, toBinId: BIN, quantityLbs: 30_000, at }),
      mv({ lotId: LOT2, fromBinId: null, toBinId: BIN, quantityLbs: 20_000, at }),
      // same timestamp as the inputs: id order decides what ships first
      mv({ lotId: null, fromBinId: BIN, toBinId: null, quantityLbs: 35_000, at }),
    ];
    // lot 1 fully drawn (30k), then 5k of lot 2
    expect(binCompositionByLot(log, BIN)).toEqual([{ lotId: LOT2, lbs: 15_000 }]);
  });

  it("lot-less (unknown origin) grain is tracked under lotId null", () => {
    const log = [
      mv({ lotId: null, fromBinId: null, toBinId: BIN, quantityLbs: 5_000 }),
      mv({ lotId: LOT1, fromBinId: null, toBinId: BIN, quantityLbs: 10_000 }),
    ];
    expect(binCompositionByLot(log, BIN)).toEqual([
      { lotId: null, lbs: 5_000 },
      { lotId: LOT1, lbs: 10_000 },
    ]);
  });
});

describe("fifoDrawdown", () => {
  const log = [
    mv({ lotId: LOT1, fromBinId: null, toBinId: BIN, quantityLbs: 40_000 }),
    mv({ lotId: LOT2, fromBinId: null, toBinId: BIN, quantityLbs: 30_000 }),
  ];

  it("attributes a shipment to the oldest lots first", () => {
    const r = fifoDrawdown(log, BIN, 50_000);
    expect(r.allocations).toEqual([
      { lotId: LOT1, lbs: 40_000 },
      { lotId: LOT2, lbs: 10_000 },
    ]);
    expect(r.allocatedLbs).toBe(50_000);
    expect(r.shortfallLbs).toBe(0);
  });

  it("draws a single lot fully when the quantity fits inside it", () => {
    const r = fifoDrawdown(log, BIN, 25_000);
    expect(r.allocations).toEqual([{ lotId: LOT1, lbs: 25_000 }]);
    expect(r.shortfallLbs).toBe(0);
  });

  it("reports the shortfall when the bin holds less than requested", () => {
    const r = fifoDrawdown(log, BIN, 100_000);
    expect(r.allocations).toEqual([
      { lotId: LOT1, lbs: 40_000 },
      { lotId: LOT2, lbs: 30_000 },
    ]);
    expect(r.allocatedLbs).toBe(70_000);
    expect(r.shortfallLbs).toBe(30_000);
  });

  it("respects grain that already left the bin", () => {
    const withDraw = [
      ...log,
      mv({ lotId: null, fromBinId: BIN, toBinId: null, quantityLbs: 45_000 }),
    ];
    // only 25k of lot 2 remains
    const r = fifoDrawdown(withDraw, BIN, 25_000);
    expect(r.allocations).toEqual([{ lotId: LOT2, lbs: 25_000 }]);
    expect(r.shortfallLbs).toBe(0);
  });

  it("merges repeated layers of the same lot in the allocation", () => {
    const layered = [
      mv({ lotId: LOT1, fromBinId: null, toBinId: BIN, quantityLbs: 10_000 }),
      mv({ lotId: LOT2, fromBinId: null, toBinId: BIN, quantityLbs: 10_000 }),
      mv({ lotId: LOT1, fromBinId: null, toBinId: BIN, quantityLbs: 10_000 }),
    ];
    const r = fifoDrawdown(layered, BIN, 25_000);
    expect(r.allocations).toEqual([
      { lotId: LOT1, lbs: 10_000 },
      { lotId: LOT2, lbs: 10_000 },
      { lotId: LOT1, lbs: 5_000 },
    ]);
  });

  it("rejects non-positive draw quantities", () => {
    expect(() => fifoDrawdown(log, BIN, 0)).toThrow();
    expect(() => fifoDrawdown(log, BIN, -5)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// binGradeAverages (Phase A, #18) — lbs-weighted grade factors per bin from
// the event log. Scenario: load 101 (10k lbs, moisture 16, TW 55) and load
// 102 (30k lbs, moisture 14, TW 58, no damage reading) both fill bin 10,
// then 5k ships out (consuming the oldest grain = load 101 first).
// ---------------------------------------------------------------------------
describe("binGradeAverages", () => {
  const LOAD_A = 101;
  const LOAD_B = 102;
  const log = [
    mv({ lotId: LOT1, fromBinId: null, toBinId: BIN, quantityLbs: 10_000, loadId: LOAD_A }),
    mv({ lotId: LOT2, fromBinId: null, toBinId: BIN, quantityLbs: 30_000, loadId: LOAD_B }),
  ];
  const loads = [
    { id: LOAD_A, moisturePct: 16, testWeightLbs: 55, dockagePct: 2, damagePct: 4 },
    { id: LOAD_B, moisturePct: 14, testWeightLbs: 58, dockagePct: 1, damagePct: null },
  ];

  it("averages factors weighted by lbs in the bin", () => {
    const r = binGradeAverages(log, loads, BIN);
    expect(r.totalLbs).toBe(40_000);
    // moisture: (16×10k + 14×30k) / 40k = 14.5
    expect(r.moisturePct).toEqual({ value: 14.5, coveredLbs: 40_000 });
    // testWeight: (55×10k + 58×30k) / 40k = 57.25
    expect(r.testWeightLbs).toEqual({ value: 57.25, coveredLbs: 40_000 });
  });

  it("re-weights after an outbound draw (FIFO consumes the oldest load)", () => {
    const withDraw = [
      ...log,
      mv({ lotId: null, fromBinId: BIN, toBinId: null, quantityLbs: 5_000 }),
    ];
    const r = binGradeAverages(withDraw, loads, BIN);
    expect(r.totalLbs).toBe(35_000);
    // 5k of load A shipped: (16×5k + 14×30k) / 35k = 14.2857… → 14.29
    expect(r.moisturePct).toEqual({ value: 14.29, coveredLbs: 35_000 });
  });

  it("excludes grain without a reading and reports coveredLbs", () => {
    const r = binGradeAverages(log, loads, BIN);
    // load B has no damage reading → average over load A's 10k only
    expect(r.damagePct).toEqual({ value: 4, coveredLbs: 10_000 });
    // protein was never measured on either load
    expect(r.proteinPct).toBeNull();
  });

  it("returns nulls and zero total for an empty bin", () => {
    const r = binGradeAverages([], [], BIN);
    expect(r.totalLbs).toBe(0);
    expect(r.moisturePct).toBeNull();
    expect(r.testWeightLbs).toBeNull();
  });

  it("ignores lot-less adjustment layers (no load to grade)", () => {
    const withAdjust = [
      ...log,
      mv({ lotId: null, fromBinId: null, toBinId: BIN, quantityLbs: 5_000 }),
    ];
    const r = binGradeAverages(withAdjust, loads, BIN);
    expect(r.totalLbs).toBe(45_000);
    // moisture average still over the 40k delivered by graded loads
    expect(r.moisturePct).toEqual({ value: 14.5, coveredLbs: 40_000 });
  });
});

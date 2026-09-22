import { beforeAll, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import type { TrpcContext } from "./context";

// ---------------------------------------------------------------------------
// Phase B router-level tests (the deferred PHASEB test item). Runs the REAL
// routers against the real (offline, in-memory) database — set the
// force-offline knobs BEFORE any connection module is imported. Each describe
// gets its own site/bin/lots so inventory math stays independent of order.
//
// Covered: grade-factor range reject + schedule-driven shrink/dock stamping
// (#3), splits sum-to-100 (#4), cleanout genealogy cutoff (#12), certificate
// issue/reprint/void lifecycle (#20), mass-balance variance flag (#15), DPR
// frozen-after-closeDay (#5), trace forward/backward attribution (#14).
// ---------------------------------------------------------------------------
process.env.GT_FORCE_OFFLINE = "1";
process.env.GT_OFFLINE_DB_PATH = ":memory:";

type Connection = typeof import("./queries/connection");

let db: ReturnType<Connection["getDb"]>;
/* eslint-disable @typescript-eslint/no-explicit-any */
let sheets: any;
let grading: any;
let splits: any;
let compliance: any;
let reports: any;
let trace: any;
let shipments: any;
/* eslint-enable @typescript-eslint/no-explicit-any */
let schema: typeof import("../db/schema");
let siteId: number;
let farmerId: number;
let landlordId: number;
let lotAId: number;
let lotBId: number;
let seq = 0;

const anon = { operator: null } as unknown as TrpcContext;

async function newSite(name: string) {
  const [{ id }] = await db.insert(schema.sites).values({ name, location: null }).$returningId();
  return id;
}
async function newBin(sid: number, crop = "CORN") {
  seq += 1;
  const [{ id }] = await db
    .insert(schema.bins)
    .values({ siteId: sid, name: `PB-Bin ${seq}`, crop, capacityLbs: 10000000 })
    .$returningId();
  return id;
}
async function newLot(code: string) {
  const [{ id }] = await db
    .insert(schema.lots)
    .values({ farmerId, landlordId: null, code, crop: "CORN" })
    .$returningId();
  return id;
}
/** Weigh a completed inbound load of netLbs into binId; returns loadId. */
async function weighIn(sid: number, lotId: number, binId: number, netLbs: number) {
  const sheet = await sheets.create({ siteId: sid, lotId });
  const w1 = await sheets.weighFirst({
    id: sheet.id,
    weightLbs: netLbs + 10000,
    truckId: `T-${++seq}`,
    binId,
  });
  await sheets.weighSecond({ id: sheet.id, weightLbs: 10000 });
  return w1.loadId as number;
}
function localDayKey(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

beforeAll(async () => {
  const conn: Connection = await import("./queries/connection");
  await conn.initDb();
  db = conn.getDb();
  schema = await import("../db/schema");
  siteId = await newSite("PhaseB Site");
  const [{ id: fid }] = await db
    .insert(schema.farmers)
    .values({ name: "PhaseB Farmer", phone: null, email: null })
    .$returningId();
  farmerId = fid;
  const [{ id: lid }] = await db
    .insert(schema.landlords)
    .values({ name: "PhaseB Landlord", phone: null })
    .$returningId();
  landlordId = lid;
  lotAId = await newLot("PB-A-01");
  lotBId = await newLot("PB-B-01");

  sheets = (await import("./sheetsRouter")).sheetsRouter.createCaller(anon);
  grading = (await import("./gradingRouter")).gradingRouter.createCaller(anon);
  splits = (await import("./splitsRouter")).splitsRouter.createCaller(anon);
  compliance = (await import("./complianceRouter")).complianceRouter.createCaller(anon);
  reports = (await import("./reportsRouter")).reportsRouter.createCaller(anon);
  trace = (await import("./traceRouter")).traceRouter.createCaller(anon);
  shipments = (await import("./shipmentsRouter")).shipmentsRouter.createCaller(anon);
});

describe("grading (#3): factor-range reject + schedule-driven shrink/dock stamp", () => {
  let loadId: number;

  it("stamps shrinkLbs/dockLbs from the crop schedule (1.183%/point over base)", async () => {
    // plant-wide config for the test crop (seeded defaults use "Corn" etc.)
    await grading.schedules.create({
      crop: "CORN",
      moistureShrinkPerPoint: 1.183,
      baseMoisturePct: 15,
      handlingShrinkPct: 0,
      dockageRules: null,
    });
    await grading.factors.create({
      crop: "CORN",
      gradeClass: "No. 2",
      factor: "testWeight",
      minValue: 54,
      maxValue: null,
    });
    await grading.factors.create({
      crop: "CORN",
      gradeClass: "No. 2",
      factor: "foreignMaterialPct",
      minValue: null,
      maxValue: 3,
    });

    const binId = await newBin(siteId);
    loadId = await weighIn(siteId, lotAId, binId, 38000);

    const res = await sheets.updateLoadGrades({
      loadId,
      moisturePct: 17, // 2 points over base 15 → 2 × 1.183 = 2.366 → rounded 2.37%
      dockagePct: 1,
      testWeightLbs: 55,
      proteinPct: null,
      foreignMaterialPct: 2,
      grade: "No. 2",
    });
    expect(res.ok).toBe(true);
    // shrinkPct is rounded to 2 decimals BEFORE the lbs: 2.37% of 38000 =
    // 900.6; dock: 38000 × 1% = 380. "CORN" is not in BUSHEL_WEIGHT_LBS
    // (the table keys are title-case) so bushels fall back to 60 lbs/bu.
    expect(res.shrinkLbs).toBe(900.6);
    expect(res.dockLbs).toBe(380);
    expect(res.shrinkPct).toBe(3.37); // (900.6+380)/38000 combined
    expect(res.grossBushels).toBe(633.33); // 38000 / 60
    expect(res.netBushels).toBe(611.99); // (38000 − 1280.6) / 60
    expect(res.breakdown?.pointsOver).toBe(2);

    // stamped on the row, not just returned
    const load = await db.query.loads.findFirst({ where: eq(schema.loads.id, loadId) });
    expect(load?.shrinkLbs).toBe(900.6);
    expect(load?.dockLbs).toBe(380);
    expect(load?.grade).toBe("No. 2");
  });

  it("rejects readings outside the grade class's factor ranges", async () => {
    // testWeight below the No. 2 minimum (54)
    await expect(
      sheets.updateLoadGrades({
        loadId,
        moisturePct: 17,
        dockagePct: 1,
        testWeightLbs: 50,
        proteinPct: null,
        grade: "No. 2",
      }),
    ).rejects.toThrow(/out of range.*testWeight/);
    // foreign material above the No. 2 maximum (3)
    await expect(
      sheets.updateLoadGrades({
        loadId,
        moisturePct: 17,
        dockagePct: 1,
        testWeightLbs: 55,
        proteinPct: null,
        foreignMaterialPct: 5,
        grade: "No. 2",
      }),
    ).rejects.toThrow(/foreignMaterialPct/);

    // a rejected write leaves the previously stamped values untouched
    const load = await db.query.loads.findFirst({ where: eq(schema.loads.id, loadId) });
    expect(load?.testWeightLbs).toBe(55);
    expect(load?.shrinkLbs).toBe(900.6);
  });
});

describe("splits (#4): sum-to-100 validation", () => {
  it("accepts a 100% set and rejects a bad total with the actual sum", async () => {
    const binId = await newBin(siteId);
    const loadId = await weighIn(siteId, lotAId, binId, 20000);

    const ok = await splits.set({
      loadId,
      splits: [
        { partyType: "farmer", partyId: farmerId, splitPct: 70 },
        { partyType: "landlord", partyId: landlordId, splitPct: 30 },
      ],
    });
    expect(ok).toMatchObject({ ok: true, totalPct: 100, count: 2 });

    const rows = await splits.get({ loadId });
    expect(rows).toHaveLength(2);
    expect(rows.find((r: { partyType: string }) => r.partyType === "farmer")?.partyName).toBe(
      "PhaseB Farmer",
    );
    expect(rows.find((r: { partyType: string }) => r.partyType === "landlord")?.partyName).toBe(
      "PhaseB Landlord",
    );

    await expect(
      splits.set({
        loadId,
        splits: [
          { partyType: "farmer", partyId: farmerId, splitPct: 60 },
          { partyType: "landlord", partyId: landlordId, splitPct: 30 },
        ],
      }),
    ).rejects.toThrow(/sum to 100% — got 90/);

    // the rejected replace left the good set in place
    expect(await splits.get({ loadId })).toHaveLength(2);
  });
});

describe("cleanouts (#12): genealogy cutoff", () => {
  it("excludes movements before the completed cleanout from bin composition", async () => {
    const binId = await newBin(siteId);
    const t1 = new Date("2026-01-10T10:00:00");
    const t2 = new Date("2026-01-15T10:00:00");
    const t3 = new Date("2026-01-20T10:00:00");

    // lot A grain in BEFORE the cleanout
    await db.insert(schema.binMovements).values({
      siteId,
      lotId: lotAId,
      fromBinId: null,
      toBinId: binId,
      quantityLbs: 10000,
      createdAt: t1,
    });

    const { cleanout } = await compliance.cleanouts.record({
      siteId,
      binId,
      emptiedAt: t2,
      note: "scheduled cleanout",
    });
    await compliance.cleanouts.complete({ id: cleanout.id, cleanedAt: t2 });

    // lot B grain in AFTER the cleanout
    await db.insert(schema.binMovements).values({
      siteId,
      lotId: lotBId,
      fromBinId: null,
      toBinId: binId,
      quantityLbs: 6000,
      createdAt: t3,
    });

    const result = await trace.backward({ binId });
    expect(result.totalLbs).toBe(6000); // pre-cutoff 10000 lbs excluded
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({ lotId: lotBId, lbs: 6000, pct: 100 });
  });
});

describe("certificates (#20): issue → reprint → void lifecycle", () => {
  it("reprint keeps the old row marked and creates a DUPLICATE revision; void requires a reason", async () => {
    const cert = await compliance.certificates.create({
      siteId,
      type: "phyto",
      certNumber: "PHY-2026-0001",
      issuedAt: new Date("2026-02-01T09:00:00"),
    });
    expect(cert.status).toBe("issued");

    const { original, reprint } = await compliance.certificates.reprint({ id: cert.id });
    expect(original.status).toBe("reprinted");
    expect(reprint.id).not.toBe(cert.id);
    expect(reprint.status).toBe("issued");
    expect(reprint.certNumber).toBe("PHY-2026-0001");
    expect(reprint.note).toContain("DUPLICATE");

    // void needs a real reason (schema min 3 chars)
    await expect(
      compliance.certificates.void({ id: reprint.id, voidReason: "x" }),
    ).rejects.toThrow();
    const voided = await compliance.certificates.void({
      id: reprint.id,
      voidReason: "issued against the wrong shipment",
    });
    expect(voided.status).toBe("void");
    expect(voided.note).toContain("[VOID: issued against the wrong shipment]");

    await expect(
      compliance.certificates.void({ id: reprint.id, voidReason: "again" }),
    ).rejects.toThrow(/already void/);
    await expect(compliance.certificates.reprint({ id: reprint.id })).rejects.toThrow(
      /cannot be reprinted/,
    );
  });
});

describe("mass balance (#15): examiner variance flag", () => {
  it("flags only when |variance| exceeds BOTH 1% of book AND 500 bu", async () => {
    const t0 = new Date("2026-03-01T10:00:00");
    const t1 = new Date("2026-03-05T10:00:00");

    // bin 1: book 200000 lbs, physical 160000 → −40000 lbs = −20% AND −714 bu → FLAGGED
    const binFlag = await newBin(siteId);
    await db.insert(schema.binMovements).values({
      siteId,
      lotId: null,
      fromBinId: null,
      toBinId: binFlag,
      quantityLbs: 200000,
      createdAt: t0,
    });
    await reports.recordPhysicalCount({ siteId, binId: binFlag, countedLbs: 160000, countedAt: t1 });

    // bin 2: book 100000, physical 98500 → −1500 lbs = −1.5% (>1%) but −26.8 bu (<500) → NOT flagged
    const binOk = await newBin(siteId);
    await db.insert(schema.binMovements).values({
      siteId,
      lotId: null,
      fromBinId: null,
      toBinId: binOk,
      quantityLbs: 100000,
      createdAt: t0,
    });
    await reports.recordPhysicalCount({ siteId, binId: binOk, countedLbs: 98500, countedAt: t1 });

    const report = await reports.massBalance({ siteId, from: "2026-03-01", to: "2026-03-31" });
    const flagged = report.bins.find((b: { binId: number }) => b.binId === binFlag);
    // bushels at the 60 lbs/bu fallback ("CORN" is not in BUSHEL_WEIGHT_LBS)
    expect(flagged.physical).toMatchObject({
      countedLbs: 160000,
      bookLbs: 200000,
      varianceLbs: -40000,
      variancePct: -20,
      varianceBu: -666.67,
      flagged: true,
    });
    const ok = report.bins.find((b: { binId: number }) => b.binId === binOk);
    expect(ok.physical.variancePct).toBe(-1.5);
    expect(Math.abs(ok.physical.varianceBu)).toBeLessThan(500);
    expect(ok.physical.flagged).toBe(false);
  });
});

describe("DPR (#5): regenerate pre-close, frozen after closeDay", () => {
  it("writes frozen snapshots at closeDay and refuses regeneration afterwards", async () => {
    const dprSiteId = await newSite("PhaseB DPR Site");
    const binId = await newBin(dprSiteId);
    // lot-less inbound adjustment → shows up as adjustmentsLbs on the day row
    await db.insert(schema.binMovements).values({
      siteId: dprSiteId,
      lotId: null,
      fromBinId: null,
      toBinId: binId,
      quantityLbs: 50000,
      createdAt: new Date(),
    });
    const today = localDayKey(new Date());

    // pre-close: regenerate computes and stores UNFROZEN rows
    const regen = await reports.dprRegenerate({ siteId: dprSiteId, day: today });
    expect(regen).toMatchObject({ ok: true, rows: 1 });
    let rows = await reports.dprList({ siteId: dprSiteId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ day: today, crop: "CORN", frozen: false, endingLbs: 50000 });
    expect(rows[0].ownershipModeled).toBe(false);

    // close the day → snapshots rewritten as FROZEN (returned in the dpr map)
    const closed = await sheets.closeDay({ siteId: dprSiteId });
    expect(closed.dpr[String(dprSiteId)]).toBe(1);
    rows = await reports.dprList({ siteId: dprSiteId });
    expect(rows).toHaveLength(1);
    expect(rows[0].frozen).toBe(true);

    // frozen days are immutable — regenerate is refused
    await expect(reports.dprRegenerate({ siteId: dprSiteId, day: today })).rejects.toThrow(
      /frozen/,
    );
    // …and the stored row is unchanged
    rows = await reports.dprList({ siteId: dprSiteId });
    expect(rows).toHaveLength(1);
    expect(rows[0].endingLbs).toBe(50000);
  });
});

describe("trace (#14): forward + backward on 2 lots → 1 bin → 1 shipment", () => {
  it("attributes the shipment FIFO by lot with correct %", async () => {
    const traceSiteId = await newSite("PhaseB Trace Site");
    const lotX = await newLot("PB-X-01");
    const lotY = await newLot("PB-Y-01");
    const binId = await newBin(traceSiteId);

    // fill: 20000 lbs of lot X (oldest), then 10000 lbs of lot Y
    await weighIn(traceSiteId, lotX, binId, 20000);
    const loadY = await weighIn(traceSiteId, lotY, binId, 10000);

    const created = await shipments.create({
      siteId: traceSiteId,
      customerName: "River Terminal",
      destination: "St. Louis",
      binId,
      quantityLbs: 24000,
    });
    expect(created.shortfallLbs).toBe(0);
    expect(created.allocations).toEqual([
      { lotId: lotX, lbs: 20000 },
      { lotId: lotY, lbs: 4000 },
    ]);
    const shipmentId = created.shipment.id as number;

    // backward: which lots are in this shipment, and how much of each
    const back = await trace.backward({ shipmentId });
    expect(back.totalLbs).toBe(24000);
    expect(back.shortfallLbs).toBe(0);
    expect(back.sources).toHaveLength(2);
    expect(back.sources[0]).toMatchObject({ lotId: lotX, lbs: 20000, pct: 83.33 });
    expect(back.sources[1]).toMatchObject({ lotId: lotY, lbs: 4000, pct: 16.67 });
    expect(back.sources[0].loads[0].ticketNo).toMatch(/^T-/);

    // forward from lot X: the bin it entered + the shipment that carried it
    const fwd = await trace.forward({ lotId: lotX });
    expect(fwd.bins).toHaveLength(1);
    expect(fwd.bins[0]).toMatchObject({ binId, lbsIn: 20000 });
    expect(fwd.shipments).toHaveLength(1);
    expect(fwd.shipments[0]).toMatchObject({
      shipmentId,
      customerName: "River Terminal",
      quantityLbs: 24000,
      attributedLbs: 20000,
      pct: 83.33,
    });

    // forward from a single load follows that load's grain (lot Y's load)
    const fwdLoad = await trace.forward({ loadId: loadY });
    expect(fwdLoad.shipments).toHaveLength(1);
    expect(fwdLoad.shipments[0]).toMatchObject({ attributedLbs: 4000, pct: 16.67 });
  });
});

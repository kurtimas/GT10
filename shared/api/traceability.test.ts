import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { TrpcContext } from "./context";

// ---------------------------------------------------------------------------
// Phase 4 router-level tests: movement events on weigh-out, VOID-instead-of-
// delete semantics, shipment FIFO validation + shortfall, bins.adjust audit,
// and operator validation. Runs the REAL routers against the real (offline,
// in-memory) database — set the force-offline knobs BEFORE any connection
// module is imported. Each describe gets its own bin so inventory math stays
// independent of test order.
// ---------------------------------------------------------------------------
process.env.GT_FORCE_OFFLINE = "1";
process.env.GT_OFFLINE_DB_PATH = ":memory:";

type Connection = typeof import("./queries/connection");

let db: ReturnType<Connection["getDb"]>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sheets: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let shipments: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let core: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let audit: any;
let schema: typeof import("../db/schema");
let siteId: number;
let lotAId: number;
let lotBId: number;
let binSeq = 0;

const ctx = (operator: string | null) => ({ operator }) as unknown as TrpcContext;

async function newBin() {
  binSeq += 1;
  const [{ id }] = await db
    .insert(schema.bins)
    .values({ siteId, name: `Bin ${binSeq}`, crop: "CORN", capacityLbs: 1000000 })
    .$returningId();
  return id;
}

async function binLbs(id: number) {
  const bin = await db.query.bins.findFirst({ where: eq(schema.bins.id, id) });
  return bin?.currentLbs ?? -1;
}

async function replayTotal(id: number) {
  const { binTotalLbs } = await import("../contracts/provenance");
  const { movementsForBin } = await import("./lib/movements");
  return binTotalLbs(await movementsForBin(db, id), id);
}

beforeAll(async () => {
  const conn: Connection = await import("./queries/connection");
  await conn.initDb();
  db = conn.getDb();
  schema = await import("../db/schema");
  const [{ id: sid }] = await db
    .insert(schema.sites)
    .values({ name: "Trace Site", location: null })
    .$returningId();
  siteId = sid;
  const [{ id: fid }] = await db
    .insert(schema.farmers)
    .values({ name: "Trace Farmer", phone: null, email: null })
    .$returningId();
  const [{ id: la }] = await db
    .insert(schema.lots)
    .values({ farmerId: fid, landlordId: null, code: "TRACE-A-01", crop: "CORN" })
    .$returningId();
  lotAId = la;
  const [{ id: lb }] = await db
    .insert(schema.lots)
    .values({ farmerId: fid, landlordId: null, code: "TRACE-B-01", crop: "CORN" })
    .$returningId();
  lotBId = lb;

  const anon = ctx(null);
  sheets = (await import("./sheetsRouter")).sheetsRouter.createCaller(anon);
  shipments = (await import("./shipmentsRouter")).shipmentsRouter.createCaller(anon);
  core = (await import("./coreRouter")).coreRouter.createCaller(anon);
  audit = (await import("./auditRouter")).auditRouter.createCaller(anon);
});

describe("movement events on weigh-out", () => {
  it("inbound weigh-out writes a bin_movements row in the same flow + audit rows", async () => {
    const binId = await newBin();
    const sheet = await sheets.create({ siteId, lotId: lotAId });
    const w1 = await sheets.weighFirst({
      id: sheet.id,
      weightLbs: 50000,
      truckId: "TRUCK-1",
      binId,
    });
    await sheets.weighSecond({ id: sheet.id, weightLbs: 12000 });

    const movements = await db
      .select()
      .from(schema.binMovements)
      .where(eq(schema.binMovements.loadId, w1.loadId));
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      siteId,
      lotId: lotAId,
      fromBinId: null,
      toBinId: binId,
      quantityLbs: 38000,
      loadId: w1.loadId,
    });
    expect(await binLbs(binId)).toBe(38000);

    // audit trail: load create + load update (weigh-out)
    const trail = await audit.list({ entityType: "load", entityId: w1.loadId });
    expect(trail.total).toBeGreaterThanOrEqual(2);
    expect(trail.rows.some((r: { action: string }) => r.action === "create")).toBe(true);
  });
});

describe("VOID-instead-of-delete", () => {
  let binId: number;
  let sheetId2: number;
  let loadId2: number;

  it("voids keep the row, reverse the bin, and append a reversing movement", async () => {
    binId = await newBin();
    const sheet = await sheets.create({ siteId, lotId: lotAId });
    sheetId2 = sheet.id;
    const w1 = await sheets.weighFirst({ id: sheet.id, weightLbs: 40000, truckId: "TRUCK-2", binId });
    loadId2 = w1.loadId;
    await sheets.weighSecond({ id: sheet.id, weightLbs: 10000 }); // net 30000

    await sheets.voidLoad({ loadId: loadId2, voidReason: "duplicate ticket entry" });

    // row kept, marked void
    const load = await db.query.loads.findFirst({ where: eq(schema.loads.id, loadId2) });
    expect(load?.voidedAt).not.toBeNull();
    expect(load?.voidReason).toBe("duplicate ticket entry");

    // bin cache reversed (30000 in, 30000 back out)
    expect(await binLbs(binId)).toBe(0);

    // provenance replay reconciles: +30000 and a −30000 reversal net to 0
    expect(await replayTotal(binId)).toBe(0);
    const { movementsForBin } = await import("./lib/movements");
    const events = await movementsForBin(db, binId);
    expect(events.some((e) => e.note?.startsWith("Reversal"))).toBe(true);

    // audit row for the void + sheet event keeps a VALID loadId (no orphans)
    const trail = await audit.list({ entityType: "load", entityId: loadId2 });
    expect(trail.rows.some((r: { action: string }) => r.action === "void")).toBe(true);
    const voidEvent = await db.query.sheetEvents.findFirst({
      where: and(
        eq(schema.sheetEvents.sheetId, sheetId2),
        eq(schema.sheetEvents.action, "LOAD_VOID"),
      ),
    });
    expect(voidEvent?.loadId).toBe(loadId2);
  });

  it("voided loads are excluded from sheet detail and daily report totals", async () => {
    const detail = await sheets.get({ id: sheetId2 });
    expect(detail.sheet.loads).toHaveLength(0);
    expect(detail.sheet.netLbs).toBe(0);

    const report = await sheets.dailyReport({ siteId });
    // only the first (non-voided) 38000-lb load counts
    expect(report.inboundLbs).toBe(38000);
    expect(report.loads.some((l: { id: number }) => l.id === loadId2)).toBe(false);
  });

  it("double void and void without a reason are rejected", async () => {
    await expect(
      sheets.voidLoad({ loadId: loadId2, voidReason: "again" }),
    ).rejects.toThrow(/already voided/);
    await expect(sheets.voidLoad({ loadId: loadId2, voidReason: "x" })).rejects.toThrow();
  });
});

describe("shipments FIFO validation", () => {
  it("attributes the draw oldest-lot-first and surfaces shortfallLbs", async () => {
    const binId = await newBin();
    // fill: 20000 of lot A (oldest), then 10000 of lot B
    const sA = await sheets.create({ siteId, lotId: lotAId });
    await sheets.weighFirst({ id: sA.id, weightLbs: 30000, truckId: "T-A", binId });
    await sheets.weighSecond({ id: sA.id, weightLbs: 10000 });
    const sB = await sheets.create({ siteId, lotId: lotBId });
    await sheets.weighFirst({ id: sB.id, weightLbs: 25000, truckId: "T-B", binId });
    await sheets.weighSecond({ id: sB.id, weightLbs: 15000 });
    expect(await binLbs(binId)).toBe(30000);

    const first = await shipments.create({
      siteId,
      customerName: "River Terminal",
      binId,
      quantityLbs: 25000,
    });
    expect(first.shortfallLbs).toBe(0);
    expect(first.allocations).toEqual([
      { lotId: lotAId, lbs: 20000 },
      { lotId: lotBId, lbs: 5000 },
    ]);
    expect(first.shipment.binMovementId).not.toBeNull();
    expect(await binLbs(binId)).toBe(5000);

    // bin is short: everything remaining is allocated, gap is reported
    const second = await shipments.create({
      siteId,
      customerName: "River Terminal",
      binId,
      quantityLbs: 10000,
    });
    expect(second.allocations).toEqual([{ lotId: lotBId, lbs: 5000 }]);
    expect(second.shortfallLbs).toBe(5000);
    expect(await binLbs(binId)).toBe(0); // clamped, never negative

    const trail = await audit.list({ entityType: "shipment" });
    expect(trail.total).toBe(2);
  });
});

describe("bins.adjust audit + provenance", () => {
  it("requires a reason and writes audit_log + lot-less movement", async () => {
    const binId = await newBin();
    await expect(
      core.bins.adjust({ adminPassword: "", id: binId, currentLbs: 3000, reason: "no" }),
    ).rejects.toThrow();

    await core.bins.adjust({
      adminPassword: "",
      id: binId,
      currentLbs: 3000,
      reason: "physical tape measurement",
    });
    expect(await binLbs(binId)).toBe(3000);

    const trail = await audit.list({ entityType: "bin", entityId: binId });
    const adjustRow = trail.rows.find((r: { action: string }) => r.action === "adjust");
    expect(adjustRow).toBeTruthy();
    expect(JSON.parse(adjustRow.beforeJson)).toEqual({ currentLbs: 0 });
    expect(JSON.parse(adjustRow.afterJson)).toEqual({ currentLbs: 3000 });
    expect(adjustRow.note).toBe("physical tape measurement");

    // lot-less movement keeps replay reconciled with the cache
    const { movementsForBin } = await import("./lib/movements");
    const events = await movementsForBin(db, binId);
    const adjustEvent = events[events.length - 1]!;
    expect(adjustEvent).toMatchObject({ lotId: null, fromBinId: null, toBinId: binId, quantityLbs: 3000 });
    expect(await replayTotal(binId)).toBe(3000);
  });
});

describe("operator identity", () => {
  it("rejects unknown operators once the list is managed; records valid ones", async () => {
    await core.operators.add({ adminPassword: "", name: "Dana" });

    const stranger = (await import("./sheetsRouter")).sheetsRouter.createCaller(ctx("Nobody"));
    await expect(stranger.create({ siteId, lotId: lotAId })).rejects.toThrow(/operators list/);

    const binId = await newBin();
    const dana = (await import("./sheetsRouter")).sheetsRouter.createCaller(ctx("Dana"));
    const sheet = await dana.create({ siteId, lotId: lotAId });
    const w1 = await dana.weighFirst({ id: sheet.id, weightLbs: 20000, truckId: "T-D", binId });
    await dana.weighSecond({ id: sheet.id, weightLbs: 10000 });
    const movement = await db.query.binMovements.findFirst({
      where: eq(schema.binMovements.loadId, w1.loadId),
    });
    expect(movement?.operator).toBe("Dana");
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Phase 4 sync tests: the office receiver mirrors shipments, bin_movements,
// and audit_log from the EOD package — transactionally and idempotently
// (re-receiving the same package upserts by the plant's row id, never
// duplicates). Runs the REAL receiver against an in-memory offline database.
// ---------------------------------------------------------------------------
process.env.GT_FORCE_OFFLINE = "1";
process.env.GT_OFFLINE_DB_PATH = ":memory:";
process.env.SYNC_KEY = "test-key";

type Connection = typeof import("@shared/api/queries/connection");
type Receiver = typeof import("./syncReceiver");

let db: ReturnType<Connection["getDb"]>;
let receiveEod: Receiver["receiveEod"];
let schema: typeof import("@db/schema");

const pkg = {
  site: { name: "Plant A", location: "Road 9" },
  day: "2026-06-14",
  farmers: [{ name: "Farmer Joe", phone: null, email: null }],
  landlords: [],
  lots: [
    {
      code: "LOT-A-01",
      farmerName: "Farmer Joe",
      landlordName: null,
      crop: "CORN",
      landlordSplitPct: 0,
      status: "OPEN" as const,
      notes: null,
    },
  ],
  bins: [{ name: "Bin 1", crop: "CORN", capacityLbs: 500000, currentLbs: 42000 }],
  sheets: [
    {
      ticketNo: "T-00001",
      farmerName: "Farmer Joe",
      lotCode: "LOT-A-01",
      landlordName: null,
      crop: "CORN",
      direction: "INBOUND" as const,
      status: "CLOSED" as const,
      closeReason: "EOD",
      maxLoads: 10,
      createdAt: "2026-06-14T08:00:00.000Z",
      closedAt: "2026-06-14T18:00:00.000Z",
      loads: [
        {
          loadNo: 1,
          truckId: "TRUCK-1",
          driverName: null,
          binName: "Bin 1",
          grossLbs: 50000,
          tareLbs: 12000,
          netLbs: 38000,
          grossAt: "2026-06-14T08:10:00.000Z",
          tareAt: "2026-06-14T08:20:00.000Z",
          moisturePct: 15,
          dockagePct: 1,
          testWeightLbs: 56,
          proteinPct: null,
          shrinkPct: 0,
          grossBushels: 892.86,
          netBushels: 892.86,
        },
        {
          loadNo: 2,
          truckId: "TRUCK-2",
          driverName: null,
          binName: "Bin 1",
          grossLbs: 30000,
          tareLbs: 10000,
          netLbs: 20000,
          grossAt: "2026-06-14T09:10:00.000Z",
          tareAt: "2026-06-14T09:20:00.000Z",
          moisturePct: null,
          dockagePct: null,
          testWeightLbs: null,
          proteinPct: null,
          shrinkPct: 0,
          grossBushels: 357.14,
          netBushels: 357.14,
          voidedAt: "2026-06-14T10:00:00.000Z",
          voidReason: "duplicate entry",
        },
      ],
    },
  ],
  binMovements: [
    {
      id: 11,
      lotCode: "LOT-A-01",
      fromBinName: null,
      toBinName: "Bin 1",
      quantityLbs: 38000,
      loadTicketNo: "T-00001",
      loadNo: 1,
      shipmentId: null,
      operator: "Dana",
      note: "Weigh-out T-00001 load 1",
      createdAt: "2026-06-14T08:20:00.000Z",
    },
    {
      id: 12,
      lotCode: "LOT-A-01",
      fromBinName: "Bin 1",
      toBinName: null,
      quantityLbs: 16000,
      loadTicketNo: null,
      loadNo: null,
      shipmentId: 7,
      operator: "Dana",
      note: "FIFO draw: 16000 lbs from lot 5",
      createdAt: "2026-06-14T11:00:00.000Z",
    },
  ],
  shipments: [
    {
      id: 7,
      customerName: "River Terminal",
      destination: "St. Louis",
      lotCode: "LOT-A-01",
      binName: "Bin 1",
      quantityLbs: 16000,
      quantityBu: 285.71,
      truckId: "TRUCK-9",
      note: null,
      createdAt: "2026-06-14T11:00:00.000Z",
    },
  ],
  auditLog: [
    {
      id: 101,
      actor: "Dana",
      action: "create",
      entityType: "shipment",
      entityId: 7,
      beforeJson: null,
      afterJson: '{"customerName":"River Terminal"}',
      note: null,
      createdAt: "2026-06-14T11:00:00.000Z",
    },
    {
      id: 102,
      actor: "Dana",
      action: "void",
      entityType: "load",
      entityId: 99,
      beforeJson: '{"netLbs":20000}',
      afterJson: '{"voidedAt":"2026-06-14T10:00:00.000Z"}',
      note: "duplicate entry",
      createdAt: "2026-06-14T10:00:00.000Z",
    },
  ],
  totals: {
    sheetsOpened: 1,
    loadCount: 1,
    completedCount: 1,
    inboundLbs: 38000,
    outboundLbs: 0,
    inboundBu: 892.86,
    outboundBu: 0,
  },
};

beforeAll(async () => {
  const conn: Connection = await import("@shared/api/queries/connection");
  await conn.initDb();
  db = conn.getDb();
  schema = await import("@db/schema");
  receiveEod = (await import("./syncReceiver")).receiveEod;
});

describe("sync receiver — Phase 4 tables", () => {
  it("mirrors shipments, bin_movements, and audit_log — idempotently", async () => {
    // receive the SAME package twice: rows must upsert, never duplicate
    const first = await receiveEod(pkg);
    expect(first).toMatchObject({ sheets: 1, loads: 2, shipments: 1, binMovements: 2, auditLog: 2 });
    const second = await receiveEod(pkg);
    expect(second).toMatchObject({ sheets: 1, loads: 2, shipments: 1, binMovements: 2, auditLog: 2 });

    expect(await db.select().from(schema.shipments)).toHaveLength(1);
    expect(await db.select().from(schema.binMovements)).toHaveLength(2);
    expect(await db.select().from(schema.auditLog)).toHaveLength(2);
    expect(await db.select().from(schema.loads)).toHaveLength(2);
    expect(await db.select().from(schema.eodReports)).toHaveLength(1);

    // plant row ids are the idempotency keys
    const shipment = await db.query.shipments.findFirst({
      where: eq(schema.shipments.id, 7),
    });
    expect(shipment).toMatchObject({ customerName: "River Terminal", quantityLbs: 16000 });

    // references re-keyed to the mirror's ids (bin/lot/site resolved by name)
    const mirroredBin = await db.query.bins.findFirst({ where: eq(schema.bins.name, "Bin 1") });
    const mirroredLot = await db.query.lots.findFirst({ where: eq(schema.lots.code, "LOT-A-01") });
    expect(shipment?.binId).toBe(mirroredBin?.id);
    expect(shipment?.lotId).toBe(mirroredLot?.id);

    // movement → mirrored load link resolved via sheet ticket + loadNo
    const m1 = await db.query.binMovements.findFirst({ where: eq(schema.binMovements.id, 11) });
    const mirroredLoad = await db.query.loads.findFirst({
      where: eq(schema.loads.loadNo, 1),
    });
    expect(m1?.loadId).toBe(mirroredLoad?.id);
    expect(m1?.operator).toBe("Dana");

    // movement → shipment link re-keyed to the mirrored shipment
    const m2 = await db.query.binMovements.findFirst({ where: eq(schema.binMovements.id, 12) });
    expect(m2?.shipmentId).toBe(shipment?.id);

    // void markers mirrored
    const voided = await db.query.loads.findFirst({ where: eq(schema.loads.loadNo, 2) });
    expect(voided?.voidedAt).not.toBeNull();
    expect(voided?.voidReason).toBe("duplicate entry");
  });
});

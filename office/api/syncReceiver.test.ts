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
  landlords: [{ name: "Landlord Liz", phone: null }],
  lots: [
    {
      code: "LOT-A-01",
      farmerName: "Farmer Joe",
      landlordName: "Landlord Liz",
      crop: "CORN",
      landlordSplitPct: 25,
      status: "OPEN" as const,
      // Phase A fields (Phase B2)
      program: "organic",
      practices: "no-till, cover crops",
      carbonNotes: "enrolled in carbon pilot",
      notes: null,
    },
  ],
  bins: [{ name: "Bin 1", crop: "CORN", capacityLbs: 500000, currentLbs: 42000, program: "organic" }],
  sheets: [
    {
      ticketNo: "T-00001",
      farmerName: "Farmer Joe",
      lotCode: "LOT-A-01",
      landlordName: "Landlord Liz",
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
          // Phase A/B columns (Phase B2)
          foreignMaterialPct: 1.5,
          sbPct: 2,
          program: "organic",
          shrinkLbs: 899.08,
          dockLbs: 380,
          splits: [
            { partyType: "farmer", partyName: "Farmer Joe", splitPct: 75 },
            { partyType: "landlord", partyName: "Landlord Liz", splitPct: 25 },
          ],
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
  // ---- Phase B2 sections (plant row ids are the idempotency keys)
  gradingSchedules: [
    {
      id: 31,
      siteScoped: true,
      crop: "CORN",
      moistureShrinkPerPoint: 1.183,
      baseMoisturePct: 15,
      handlingShrinkPct: 0.5,
      dockageRules: "Dockage deducted 1:1 from gross bushels",
      createdAt: "2026-06-10T08:00:00.000Z",
      updatedAt: "2026-06-14T08:00:00.000Z",
    },
  ],
  gradeFactors: [
    {
      id: 41,
      siteScoped: false, // plant-wide default row
      crop: "CORN",
      gradeClass: "No. 2",
      factor: "testWeight",
      minValue: 54,
      maxValue: null,
      createdAt: "2026-06-10T08:00:00.000Z",
      updatedAt: "2026-06-10T08:00:00.000Z",
    },
  ],
  cleanouts: [
    {
      id: 51,
      binName: "Bin 1",
      emptiedAt: "2026-06-13T16:00:00.000Z",
      cleanedAt: "2026-06-13T17:30:00.000Z",
      method: "sweep + vacuum",
      note: null,
      operator: "Dana",
      createdAt: "2026-06-13T16:00:00.000Z",
      updatedAt: "2026-06-13T17:30:00.000Z",
    },
  ],
  fumigations: [
    {
      id: 61,
      binName: "Bin 1",
      product: "Phostoxin",
      dosage: "30 tablets",
      appliedAt: "2026-06-12T09:00:00.000Z",
      exposureHours: 72,
      aerationClearedAt: "2026-06-15T09:00:00.000Z",
      applicator: "Dana",
      note: null,
      createdAt: "2026-06-12T09:00:00.000Z",
      updatedAt: "2026-06-15T09:00:00.000Z",
    },
  ],
  certificates: [
    {
      id: 71,
      type: "phyto",
      certNumber: "PHY-2026-0001",
      issuedAt: "2026-06-14T12:00:00.000Z",
      status: "issued",
      lotCode: "LOT-A-01",
      shipmentId: 7, // plant shipment id — re-keyed on receive
      note: null,
      fileRef: null,
      createdAt: "2026-06-14T12:00:00.000Z",
      updatedAt: "2026-06-14T12:00:00.000Z",
    },
  ],
  labResults: [
    {
      id: 81,
      sampleDate: "2026-06-14T10:00:00.000Z",
      labName: "SGS",
      testType: "DON",
      result: "0.4 ppm",
      passFail: "pass",
      lotCode: "LOT-A-01",
      loadTicketNo: "T-00001",
      loadNo: 1,
      binName: null,
      note: null,
      createdAt: "2026-06-14T10:30:00.000Z",
      updatedAt: "2026-06-14T10:30:00.000Z",
    },
  ],
  attachments: [
    {
      id: 91,
      entityType: "certificate",
      entityId: 71, // plant-side id — raw mirror
      filename: "phyto.pdf",
      mime: "application/pdf",
      size: 12345,
      storageRef: "ab12cd34.pdf",
      uploadedBy: "Dana",
      createdAt: "2026-06-14T12:05:00.000Z",
    },
  ],
  shrinkEntries: [
    {
      id: 95,
      binName: "Bin 1",
      kind: "moisture",
      quantityLbs: -150,
      effectiveDate: "2026-06-14T12:00:00.000Z",
      note: "aeration moisture loss",
      operator: "Dana",
      createdAt: "2026-06-14T12:00:00.000Z",
    },
  ],
  gradeOverrides: [
    {
      id: 96,
      binName: "Bin 1",
      factor: "moisturePct",
      value: 14.2,
      reason: "lab recheck after dryer fix",
      operator: "Dana",
      createdAt: "2026-06-14T13:00:00.000Z",
    },
  ],
  dprSnapshots: [
    {
      id: 97,
      day: "2026-06-14",
      crop: "CORN",
      program: "organic",
      openingLbs: 4000,
      receivedLbs: 38000,
      receivedBu: 678.57,
      shippedLbs: 16000,
      shippedBu: 285.71,
      transfersInLbs: 0,
      transfersOutLbs: 0,
      shrinkMoistureLbs: -150,
      shrinkHandlingLbs: 0,
      shrinkAerationLbs: 0,
      shrinkErrorCorrectionLbs: 0,
      adjustmentsLbs: 0,
      endingLbs: 25850,
      endingBu: 461.61,
      frozen: true,
      createdAt: "2026-06-14T18:00:00.000Z",
    },
  ],
  physicalCounts: [
    {
      id: 98,
      binName: "Bin 1",
      countedLbs: 42000,
      countedAt: "2026-06-14T07:00:00.000Z",
      note: "tape measurement",
      operator: "Dana",
      createdAt: "2026-06-14T07:00:00.000Z",
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

describe("sync receiver — Phase B2 tables", () => {
  it("mirrors the new sections + columns — idempotently — and office.* serves them", async () => {
    // receive the SAME package twice: every new table must upsert by the
    // plant row id, never duplicate
    const first = await receiveEod(pkg);
    expect(first).toMatchObject({
      grading: 2, // 1 schedule + 1 factor
      cleanouts: 1,
      fumigations: 1,
      certificates: 1,
      labResults: 1,
      attachments: 1,
      shrinkEntries: 1,
      gradeOverrides: 1,
      physicalCounts: 1,
      dprSnapshots: 1,
    });
    await receiveEod(pkg);

    // row counts stable after the re-receive
    expect(await db.select().from(schema.gradingSchedules)).toHaveLength(1);
    expect(await db.select().from(schema.gradeFactors)).toHaveLength(1);
    expect(await db.select().from(schema.loadSplits)).toHaveLength(2);
    expect(await db.select().from(schema.binCleanouts)).toHaveLength(1);
    expect(await db.select().from(schema.fumigationLogs)).toHaveLength(1);
    expect(await db.select().from(schema.certificates)).toHaveLength(1);
    expect(await db.select().from(schema.labResults)).toHaveLength(1);
    expect(await db.select().from(schema.attachments)).toHaveLength(1);
    expect(await db.select().from(schema.shrinkEntries)).toHaveLength(1);
    expect(await db.select().from(schema.binGradeOverrides)).toHaveLength(1);
    expect(await db.select().from(schema.dprSnapshots)).toHaveLength(1);
    expect(await db.select().from(schema.physicalCounts)).toHaveLength(1);

    const mirroredBin = await db.query.bins.findFirst({ where: eq(schema.bins.name, "Bin 1") });
    const mirroredLot = await db.query.lots.findFirst({ where: eq(schema.lots.code, "LOT-A-01") });
    const mirroredLoad = await db.query.loads.findFirst({ where: eq(schema.loads.loadNo, 1) });
    const mirroredFarmer = await db.query.farmers.findFirst({
      where: eq(schema.farmers.name, "Farmer Joe"),
    });
    const mirroredLandlord = await db.query.landlords.findFirst({
      where: eq(schema.landlords.name, "Landlord Liz"),
    });

    // new columns on existing payloads
    expect(mirroredLot).toMatchObject({
      program: "organic",
      practices: "no-till, cover crops",
      carbonNotes: "enrolled in carbon pilot",
    });
    expect(mirroredBin?.program).toBe("organic");
    expect(mirroredLoad).toMatchObject({
      program: "organic",
      foreignMaterialPct: 1.5,
      sbPct: 2,
      shrinkLbs: 899.08,
      dockLbs: 380,
    });

    // splits rebuilt wholesale with the load, parties re-keyed by name
    const splitRows = await db
      .select()
      .from(schema.loadSplits)
      .where(eq(schema.loadSplits.loadId, mirroredLoad!.id));
    expect(splitRows).toHaveLength(2);
    expect(splitRows.find((s) => s.partyType === "farmer")?.partyId).toBe(mirroredFarmer?.id);
    expect(splitRows.find((s) => s.partyType === "landlord")?.partyId).toBe(mirroredLandlord?.id);

    // references re-keyed to mirror ids
    const cleanout = await db.query.binCleanouts.findFirst({
      where: eq(schema.binCleanouts.id, 51),
    });
    expect(cleanout?.binId).toBe(mirroredBin?.id);
    expect(cleanout?.cleanedAt).not.toBeNull();

    const cert = await db.query.certificates.findFirst({
      where: eq(schema.certificates.id, 71),
    });
    expect(cert?.lotId).toBe(mirroredLot?.id);
    expect(cert?.shipmentId).toBe(7); // mirrored shipment kept the plant id
    expect(cert?.status).toBe("issued");

    const lab = await db.query.labResults.findFirst({ where: eq(schema.labResults.id, 81) });
    expect(lab?.lotId).toBe(mirroredLot?.id);
    expect(lab?.loadId).toBe(mirroredLoad?.id); // ticket + loadNo resolved

    const attachment = await db.query.attachments.findFirst({
      where: eq(schema.attachments.id, 91),
    });
    expect(attachment).toMatchObject({
      entityType: "certificate",
      entityId: 71, // raw plant-side id, metadata-only mirror
      filename: "phyto.pdf",
      storageRef: "ab12cd34.pdf",
    });

    const shrink = await db.query.shrinkEntries.findFirst({
      where: eq(schema.shrinkEntries.id, 95),
    });
    expect(shrink).toMatchObject({ binId: mirroredBin?.id, kind: "moisture", quantityLbs: -150 });

    const override = await db.query.binGradeOverrides.findFirst({
      where: eq(schema.binGradeOverrides.id, 96),
    });
    expect(override).toMatchObject({ binId: mirroredBin?.id, factor: "moisturePct", value: 14.2 });

    const count = await db.query.physicalCounts.findFirst({
      where: eq(schema.physicalCounts.id, 98),
    });
    expect(count?.binId).toBe(mirroredBin?.id);

    // plant-wide grading row keeps siteId null; site row got the mirror site id
    const site = await db.query.sites.findFirst({ where: eq(schema.sites.name, "Plant A") });
    const schedule = await db.query.gradingSchedules.findFirst({
      where: eq(schema.gradingSchedules.id, 31),
    });
    expect(schedule?.siteId).toBe(site?.id);
    const factor = await db.query.gradeFactors.findFirst({
      where: eq(schema.gradeFactors.id, 41),
    });
    expect(factor?.siteId).toBeNull();

    // ---- the office.* read endpoints serve the mirrored entities
    const { officeRouter } = await import("./officeRouter");
    const office = officeRouter.createCaller({} as never);

    expect(await office.gradingSchedules({ siteId: site!.id })).toHaveLength(1);
    expect(await office.gradeFactors({ crop: "CORN" })).toHaveLength(1);
    const officeSplits = await office.splits({ siteId: site!.id });
    expect(officeSplits).toHaveLength(2);
    expect(officeSplits.map((s: { partyName: string | null }) => s.partyName).sort()).toEqual([
      "Farmer Joe",
      "Landlord Liz",
    ]);
    expect(await office.cleanouts({ siteId: site!.id })).toHaveLength(1);
    expect(await office.fumigations({ siteId: site!.id })).toHaveLength(1);
    const officeCerts = await office.certificates({ siteId: site!.id });
    expect(officeCerts).toHaveLength(1);
    expect(officeCerts[0]).toMatchObject({ certNumber: "PHY-2026-0001", lotCode: "LOT-A-01" });
    expect(await office.labResults({ siteId: site!.id })).toHaveLength(1);
    expect(await office.attachments({ siteId: site!.id })).toHaveLength(1);
    expect(await office.shrinkEntries({ siteId: site!.id })).toHaveLength(1);
    expect(await office.gradeOverrides({ siteId: site!.id })).toHaveLength(1);

    const dprList = await office.dpr.list({ siteId: site!.id });
    expect(dprList).toHaveLength(1);
    expect(dprList[0]).toMatchObject({
      day: "2026-06-14",
      crop: "CORN",
      program: "organic",
      frozen: true,
      endingLbs: 25850,
      ownershipModeled: false,
    });
    const dprOne = await office.dpr.get({ id: dprList[0].id });
    expect(dprOne.receivedLbs).toBe(38000);
  });
});

import {
  mysqlTable,
  mysqlEnum,
  serial,
  bigint,
  boolean,
  int,
  double,
  varchar,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

// ---------------------------------------------------------------------------
// Sites (grain elevator locations)
// ---------------------------------------------------------------------------
export const sites = mysqlTable("sites", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  location: varchar("location", { length: 255 }),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Bins (storage per site)
// ---------------------------------------------------------------------------
export const bins = mysqlTable(
  "bins",
  {
    id: serial("id").primaryKey(),
    siteId: bigint("siteId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => sites.id),
    name: varchar("name", { length: 255 }).notNull(),
    crop: varchar("crop", { length: 64 }).notNull(),
    capacityLbs: int("capacityLbs").notNull(),
    currentLbs: int("currentLbs").notNull().default(0),
    // Identity-preserved program segregation (Phase A, research #17) —
    // free-ish tag: conventional | organic | non-gmo | seed | certified | …
    program: varchar("program", { length: 32 }).notNull().default("conventional"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => ({ siteIdx: index("bins_site_idx").on(t.siteId) }),
);

// ---------------------------------------------------------------------------
// Farmers & landlords
// ---------------------------------------------------------------------------
export const farmers = mysqlTable("farmers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 64 }),
  email: varchar("email", { length: 320 }),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
});

export const landlords = mysqlTable("landlords", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 64 }),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Lots — a farmer's unique lot/field identity, optionally crop-shared with a
// landlord (landlordSplitPct = landlord's share of each load, 0-100).
// A lot stays OPEN until the grower says it's done; while CLOSED no new
// weight sheets can be opened against it.
// ---------------------------------------------------------------------------
export const lots = mysqlTable(
  "lots",
  {
    id: serial("id").primaryKey(),
    farmerId: bigint("farmerId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => farmers.id),
    landlordId: bigint("landlordId", { mode: "number", unsigned: true }).references(
      () => landlords.id,
    ),
    code: varchar("code", { length: 64 }).notNull().unique(),
    crop: varchar("crop", { length: 64 }).notNull(),
    landlordSplitPct: double("landlordSplitPct").notNull().default(0),
    status: mysqlEnum("status", ["OPEN", "CLOSED"]).notNull().default("OPEN"),
    // Identity-preserved program (Phase A, research #17)
    program: varchar("program", { length: 32 }).notNull().default("conventional"),
    // Farm-of-origin sustainability fields (Phase A, research #31) — free text
    practices: text("practices"),
    carbonNotes: text("carbonNotes"),
    notes: text("notes"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    closedAt: timestamp("closedAt"),
  },
  (t) => ({
    farmerIdx: index("lots_farmer_idx").on(t.farmerId),
    codeIdx: index("lots_code_idx").on(t.code),
  }),
);

// ---------------------------------------------------------------------------
// Weight sheets — the multi-load document tied to one lot (like the paper
// Grain Weight Certificate): header carries farmer/lot/landlord/crop and the
// sheet holds up to `maxLoads` individual truck loads (see `loads`).
//   OPEN   — accepting loads (fewer than maxLoads recorded)
//   FULL   — maxLoads reached; sheet closed automatically, start a new sheet
//   CLOSED — locked by end-of-day close (no further edits)
// closeReason: FULL | EOD | MANUAL
// ---------------------------------------------------------------------------
export const weightSheets = mysqlTable(
  "weight_sheets",
  {
    id: serial("id").primaryKey(),
    ticketNo: varchar("ticketNo", { length: 32 }).notNull().unique(),
    siteId: bigint("siteId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => sites.id),
    farmerId: bigint("farmerId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => farmers.id),
    lotId: bigint("lotId", { mode: "number", unsigned: true }).references(() => lots.id),
    landlordId: bigint("landlordId", { mode: "number", unsigned: true }).references(
      () => landlords.id,
    ),
    crop: varchar("crop", { length: 64 }).notNull(),
    direction: mysqlEnum("direction", ["INBOUND", "OUTBOUND"]).notNull().default("INBOUND"),
    status: mysqlEnum("status", ["OPEN", "FULL", "CLOSED"]).notNull().default("OPEN"),
    closeReason: varchar("closeReason", { length: 16 }),
    maxLoads: int("maxLoads").notNull().default(10),
    notes: text("notes"),
    // VOID-instead-of-delete: set by the void flow (Phase 4) instead of
    // removing the sheet; both stay null on live sheets.
    voidedAt: timestamp("voidedAt"),
    voidReason: text("voidReason"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
    closedAt: timestamp("closedAt"),
  },
  (t) => ({
    farmerIdx: index("sheets_farmer_idx").on(t.farmerId),
    lotIdx: index("sheets_lot_idx").on(t.lotId),
    landlordIdx: index("sheets_landlord_idx").on(t.landlordId),
    statusIdx: index("sheets_status_idx").on(t.status),
    createdIdx: index("sheets_created_idx").on(t.createdAt),
  }),
);

// ---------------------------------------------------------------------------
// Loads — one truck visit on a weight sheet (one row of the paper sheet).
// Inbound: gross captured first, tare second. Outbound reverses. Grades
// (moisture, dockage, test weight, protein) are per load.
// ---------------------------------------------------------------------------
export const loads = mysqlTable(
  "loads",
  {
    id: serial("id").primaryKey(),
    sheetId: bigint("sheetId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => weightSheets.id),
    loadNo: int("loadNo").notNull(),
    truckId: varchar("truckId", { length: 64 }),
    driverName: varchar("driverName", { length: 255 }),
    binId: bigint("binId", { mode: "number", unsigned: true }).references(() => bins.id),
    grossLbs: int("grossLbs"),
    tareLbs: int("tareLbs"),
    netLbs: int("netLbs"),
    grossAt: timestamp("grossAt"),
    tareAt: timestamp("tareAt"),
    // grading (TEST utilities)
    moisturePct: double("moisturePct"),
    dockagePct: double("dockagePct"),
    testWeightLbs: double("testWeightLbs"),
    proteinPct: double("proteinPct"),
    // enriched intake (Phase 3) — all nullable so existing rows/flows keep working
    damagePct: double("damagePct"),
    grade: varchar("grade", { length: 32 }),
    farmOrigin: varchar("farmOrigin", { length: 255 }),
    // remaining grade factors (Phase A, research #3): FM is distinct from
    // dockage on the USGSA factor grid; sbPct = shrunken & broken kernels
    foreignMaterialPct: double("foreignMaterialPct"),
    sbPct: double("sbPct"),
    // program denormalized from the lot at intake for reporting (Phase A, #17)
    program: varchar("program", { length: 32 }).notNull().default("conventional"),
    shrinkPct: double("shrinkPct"),
    grossBushels: double("grossBushels"),
    netBushels: double("netBushels"),
    // Phase B (#3): shrink/dock lbs computed from the crop's grading schedule
    // when grades are saved (schedule-driven, not the flat grain.ts rate)
    shrinkLbs: double("shrinkLbs"),
    dockLbs: double("dockLbs"),
    // outbound loads can be linked to a shipment record (Phase 4 wires the API)
    shipmentId: bigint("shipmentId", { mode: "number", unsigned: true }).references(
      () => shipments.id,
    ),
    changeReason: text("changeReason"),
    // VOID-instead-of-delete: set by the void flow (Phase 4) instead of
    // deleting the row; both stay null on live loads.
    voidedAt: timestamp("voidedAt"),
    voidReason: text("voidReason"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    sheetIdx: index("loads_sheet_idx").on(t.sheetId),
    truckIdx: index("loads_truck_idx").on(t.truckId),
    shipmentIdx: index("loads_shipment_idx").on(t.shipmentId),
    createdIdx: index("loads_created_idx").on(t.createdAt),
    // Backs the weigh-in race guard: two terminals can't both start load N.
    sheetLoadUnique: uniqueIndex("loads_sheet_load_unique").on(t.sheetId, t.loadNo),
  }),
);

// ---------------------------------------------------------------------------
// Audit trail — every weight capture / edit / status change
// ---------------------------------------------------------------------------
export const sheetEvents = mysqlTable(
  "sheet_events",
  {
    id: serial("id").primaryKey(),
    sheetId: bigint("sheetId", { mode: "number", unsigned: true }).notNull(),
    loadId: bigint("loadId", { mode: "number", unsigned: true }),
    action: varchar("action", { length: 64 }).notNull(),
    detail: text("detail"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => ({ sheetIdx: index("events_sheet_idx").on(t.sheetId) }),
);

// ---------------------------------------------------------------------------
// Bin movements — the append-only provenance event log (Phase 3).
// One row per quantity of grain entering, leaving, or moving between bins:
//   fromBinId = null → inbound from field/truck (an intake load)
//   toBinId   = null → outbound (shipped / consumed)
//   both set        → bin-to-bin transfer
// A bin's current composition by lot is derived by replaying these events
// (see shared/contracts/provenance.ts); `bins.currentLbs` stays the fast
// cached balance and is reconciled against the log.
// lotId is nullable only for lot-less manual adjustments recorded here.
// shipmentId and loadId are plain columns (no FK): hard FKs would create a
// create-order cycle with `shipments.binMovementId` / `loads.shipmentId`, and
// the provenance log must survive row changes on the documents that caused it.
// ---------------------------------------------------------------------------
export const binMovements = mysqlTable(
  "bin_movements",
  {
    id: serial("id").primaryKey(),
    siteId: bigint("siteId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => sites.id),
    lotId: bigint("lotId", { mode: "number", unsigned: true }).references(() => lots.id),
    fromBinId: bigint("fromBinId", { mode: "number", unsigned: true }).references(
      () => bins.id,
    ),
    toBinId: bigint("toBinId", { mode: "number", unsigned: true }).references(() => bins.id),
    quantityLbs: int("quantityLbs").notNull(),
    loadId: bigint("loadId", { mode: "number", unsigned: true }),
    shipmentId: bigint("shipmentId", { mode: "number", unsigned: true }),
    operator: varchar("operator", { length: 255 }),
    note: text("note"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => ({
    siteIdx: index("binmov_site_idx").on(t.siteId),
    lotIdx: index("binmov_lot_idx").on(t.lotId),
    fromBinIdx: index("binmov_from_bin_idx").on(t.fromBinId),
    toBinIdx: index("binmov_to_bin_idx").on(t.toBinId),
    loadIdx: index("binmov_load_idx").on(t.loadId),
    createdIdx: index("binmov_created_idx").on(t.createdAt),
  }),
);

// ---------------------------------------------------------------------------
// Shipments — one outbound sale/delivery (Phase 3). lotId is null when the
// grain was drawn from a mixed bin (provenance then comes from FIFO drawdown
// over bin_movements). binMovementId links the outbound movement event that
// records the draw.
// ---------------------------------------------------------------------------
export const shipments = mysqlTable(
  "shipments",
  {
    id: serial("id").primaryKey(),
    siteId: bigint("siteId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => sites.id),
    customerName: varchar("customerName", { length: 255 }).notNull(),
    destination: varchar("destination", { length: 255 }),
    lotId: bigint("lotId", { mode: "number", unsigned: true }).references(() => lots.id),
    binId: bigint("binId", { mode: "number", unsigned: true }).references(() => bins.id),
    quantityLbs: int("quantityLbs").notNull(),
    quantityBu: double("quantityBu"),
    truckId: varchar("truckId", { length: 64 }),
    binMovementId: bigint("binMovementId", { mode: "number", unsigned: true }).references(
      () => binMovements.id,
    ),
    note: text("note"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => ({
    siteIdx: index("shipments_site_idx").on(t.siteId),
    lotIdx: index("shipments_lot_idx").on(t.lotId),
    binIdx: index("shipments_bin_idx").on(t.binId),
    createdIdx: index("shipments_created_idx").on(t.createdAt),
  }),
);

// ---------------------------------------------------------------------------
// Audit log — generic, append-only trail for create/update/void/adjust of any
// entity (Phase 3 table; routers start writing to it in Phase 4). actor is
// free text for now ('system' allowed); before/after carry JSON snapshots.
// entityId intentionally has NO foreign key — it references whatever table
// entityType names, and audit rows must survive entity changes.
// ---------------------------------------------------------------------------
export const auditLog = mysqlTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    actor: varchar("actor", { length: 255 }).notNull().default("system"),
    action: varchar("action", { length: 32 }).notNull(), // create | update | void | adjust
    entityType: varchar("entityType", { length: 64 }).notNull(),
    entityId: bigint("entityId", { mode: "number", unsigned: true }).notNull(),
    beforeJson: text("beforeJson"),
    afterJson: text("afterJson"),
    note: text("note"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => ({
    entityIdx: index("audit_entity_idx").on(t.entityType, t.entityId),
    createdIdx: index("audit_created_idx").on(t.createdAt),
  }),
);

// ---------------------------------------------------------------------------
// Phase A tables (research feature guide, data-model layer).
// All are site-scoped where the entity is site-bound, carry createdAt, and
// mutable records also carry updatedAt so Phase-B audit writes have a clean
// before/after. Append-only logs (shrink_entries, attachments,
// bin_grade_overrides) intentionally have no updatedAt.
// ---------------------------------------------------------------------------

// Grading shrink/dock schedules (#3) — per-crop, editable at the elevator
// (not hardcoded). siteId null = plant-wide default for the crop; a site row
// overrides it. Seeded on boot from shared/contracts/grain.ts values.
export const gradingSchedules = mysqlTable(
  "grading_schedules",
  {
    id: serial("id").primaryKey(),
    siteId: bigint("siteId", { mode: "number", unsigned: true }).references(
      () => sites.id,
    ),
    crop: varchar("crop", { length: 64 }).notNull(),
    // moisture shrink % charged per point above base moisture (1.183 = true
    // water-removal shrink; many elevators charge 1.3-1.4 — editable)
    moistureShrinkPerPoint: double("moistureShrinkPerPoint").notNull(),
    baseMoisturePct: double("baseMoisturePct").notNull(),
    // invisible handling loss % (research: 0.5% in-and-out rule of thumb)
    handlingShrinkPct: double("handlingShrinkPct").notNull().default(0),
    // dockage handling rules, free text (e.g. "deducted 1:1 from gross bu")
    dockageRules: text("dockageRules"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    siteCropIdx: index("grading_sched_site_crop_idx").on(t.siteId, t.crop),
  }),
);

// Grade factor definitions with min/max validation ranges (#3) — one row per
// (crop, grade class, factor); factor ∈ moisturePct | testWeight | dockagePct |
// damagePct | foreignMaterialPct | sbPct | proteinPct. Seeded with US grade
// defaults for corn/soybeans/wheat; editable.
export const gradeFactors = mysqlTable(
  "grade_factors",
  {
    id: serial("id").primaryKey(),
    siteId: bigint("siteId", { mode: "number", unsigned: true }).references(
      () => sites.id,
    ),
    crop: varchar("crop", { length: 64 }).notNull(),
    gradeClass: varchar("gradeClass", { length: 32 }).notNull(), // e.g. "No. 2"
    factor: varchar("factor", { length: 32 }).notNull(),
    minValue: double("minValue"),
    maxValue: double("maxValue"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    siteCropIdx: index("grade_factor_site_crop_idx").on(t.siteId, t.crop),
  }),
);

// Load splits (#4) — who owns what share of a delivered load (farmer/landlord
// percentage splits). partyId references farmers.id or landlords.id depending
// on partyType, so it is deliberately a plain column (no FK possible across
// two tables). Contract: splits for one load must sum to 100
// (shared/contracts/splits.ts).
export const loadSplits = mysqlTable(
  "load_splits",
  {
    id: serial("id").primaryKey(),
    loadId: bigint("loadId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => loads.id),
    partyType: varchar("partyType", { length: 16 }).notNull(), // farmer | landlord
    partyId: bigint("partyId", { mode: "number", unsigned: true }).notNull(),
    splitPct: double("splitPct").notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => ({ loadIdx: index("load_splits_load_idx").on(t.loadId) }),
);

// Bin empty & cleanout records (#12) — genealogy reset points: a cleanout
// bounds any contamination event. emptiedAt set when the bin was emptied;
// cleanedAt null until the cleanout is actually done.
export const binCleanouts = mysqlTable(
  "bin_cleanouts",
  {
    id: serial("id").primaryKey(),
    siteId: bigint("siteId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => sites.id),
    binId: bigint("binId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => bins.id),
    emptiedAt: timestamp("emptiedAt").notNull(),
    cleanedAt: timestamp("cleanedAt"),
    method: varchar("method", { length: 255 }),
    note: text("note"),
    operator: varchar("operator", { length: 255 }),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    siteIdx: index("cleanouts_site_idx").on(t.siteId),
    binIdx: index("cleanouts_bin_idx").on(t.binId),
  }),
);

// Fumigation / treatment logs (#19) — product, dosage, exposure, aeration
// clearance, applicator; tied to a bin. dosage is free text ("30 tablets",
// "1.5 g/m³") because units vary by product.
export const fumigationLogs = mysqlTable(
  "fumigation_logs",
  {
    id: serial("id").primaryKey(),
    siteId: bigint("siteId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => sites.id),
    binId: bigint("binId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => bins.id),
    product: varchar("product", { length: 255 }).notNull(),
    dosage: varchar("dosage", { length: 128 }),
    appliedAt: timestamp("appliedAt").notNull(),
    exposureHours: double("exposureHours"),
    aerationClearedAt: timestamp("aerationClearedAt"),
    applicator: varchar("applicator", { length: 255 }),
    note: text("note"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    siteIdx: index("fumigation_site_idx").on(t.siteId),
    binIdx: index("fumigation_bin_idx").on(t.binId),
  }),
);

// Certificate registry (#20) — FGIS inspection/weight certs, phyto, origin,
// fumigation, mycotoxin, non-GMO declarations. type/status are free-ish
// varchar with contract-level enums (shared/contracts/compliance.ts).
// fileRef links to an attachment storageRef once uploads exist (Phase B).
export const certificates = mysqlTable(
  "certificates",
  {
    id: serial("id").primaryKey(),
    siteId: bigint("siteId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => sites.id),
    type: varchar("type", { length: 32 }).notNull(),
    certNumber: varchar("certNumber", { length: 128 }).notNull(),
    issuedAt: timestamp("issuedAt").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("issued"), // issued | reprinted | void
    lotId: bigint("lotId", { mode: "number", unsigned: true }).references(() => lots.id),
    shipmentId: bigint("shipmentId", { mode: "number", unsigned: true }).references(
      () => shipments.id,
    ),
    note: text("note"),
    fileRef: varchar("fileRef", { length: 255 }),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    siteIdx: index("certificates_site_idx").on(t.siteId),
    lotIdx: index("certificates_lot_idx").on(t.lotId),
    shipmentIdx: index("certificates_shipment_idx").on(t.shipmentId),
  }),
);

// Lab results (#22) — a lab test bound to the lot / load / bin it certifies.
// result is value+unit free text ("4.2 ppm", "34.1%"); passFail null = no
// pass/fail criterion applies. loadId is a plain column (like
// bin_movements.loadId) — lab results must survive changes to the load.
export const labResults = mysqlTable(
  "lab_results",
  {
    id: serial("id").primaryKey(),
    siteId: bigint("siteId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => sites.id),
    sampleDate: timestamp("sampleDate").notNull(),
    labName: varchar("labName", { length: 255 }),
    testType: varchar("testType", { length: 32 }).notNull(), // DON | aflatoxin | protein | gmo | other
    result: varchar("result", { length: 255 }),
    passFail: varchar("passFail", { length: 8 }), // pass | fail | null
    lotId: bigint("lotId", { mode: "number", unsigned: true }).references(() => lots.id),
    loadId: bigint("loadId", { mode: "number", unsigned: true }),
    binId: bigint("binId", { mode: "number", unsigned: true }).references(() => bins.id),
    note: text("note"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  (t) => ({
    siteIdx: index("lab_results_site_idx").on(t.siteId),
    lotIdx: index("lab_results_lot_idx").on(t.lotId),
    binIdx: index("lab_results_bin_idx").on(t.binId),
    loadIdx: index("lab_results_load_idx").on(t.loadId),
  }),
);

// Attachments (#26) — documents captured against any entity (ticket=load,
// sheet, certificate, fumigation log, …). entityId is deliberately a plain
// column (like audit_log.entityId) referencing whatever entityType names.
// storageRef is the content-hash filename under data/attachments/ (Phase B
// wires upload/download).
export const attachments = mysqlTable(
  "attachments",
  {
    id: serial("id").primaryKey(),
    siteId: bigint("siteId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => sites.id),
    entityType: varchar("entityType", { length: 64 }).notNull(),
    entityId: bigint("entityId", { mode: "number", unsigned: true }).notNull(),
    filename: varchar("filename", { length: 255 }).notNull(),
    mime: varchar("mime", { length: 128 }),
    size: int("size"),
    storageRef: varchar("storageRef", { length: 255 }).notNull(),
    uploadedBy: varchar("uploadedBy", { length: 255 }),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => ({
    siteIdx: index("attachments_site_idx").on(t.siteId),
    entityIdx: index("attachments_entity_idx").on(t.entityType, t.entityId),
  }),
);

// Shrink / reconciliation entries (#15) — the "identifiable adjustments" the
// DPR reconciles against: moisture, handling, aeration, error corrections.
// quantityLbs is SIGNED (negative = book stock reduced). Append-only — a
// wrong entry is corrected by a new entry, never edited.
export const shrinkEntries = mysqlTable(
  "shrink_entries",
  {
    id: serial("id").primaryKey(),
    siteId: bigint("siteId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => sites.id),
    binId: bigint("binId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => bins.id),
    kind: varchar("kind", { length: 24 }).notNull(), // moisture | handling | aeration | error-correction
    quantityLbs: int("quantityLbs").notNull(),
    effectiveDate: timestamp("effectiveDate").notNull(),
    note: text("note"),
    operator: varchar("operator", { length: 255 }),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => ({
    siteIdx: index("shrink_entries_site_idx").on(t.siteId),
    binIdx: index("shrink_entries_bin_idx").on(t.binId),
  }),
);

// Bin grade overrides (#18) — manual overrides of the computed lbs-weighted
// bin averages (shared/contracts/provenance.ts binGradeAverages). Append-only
// log of who/when/why; the latest row per (binId, factor) wins.
export const binGradeOverrides = mysqlTable(
  "bin_grade_overrides",
  {
    id: serial("id").primaryKey(),
    siteId: bigint("siteId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => sites.id),
    binId: bigint("binId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => bins.id),
    factor: varchar("factor", { length: 32 }).notNull(),
    value: double("value").notNull(),
    reason: text("reason").notNull(),
    operator: varchar("operator", { length: 255 }),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => ({
    siteIdx: index("grade_overrides_site_idx").on(t.siteId),
    binIdx: index("grade_overrides_bin_idx").on(t.binId),
  }),
);

// ---------------------------------------------------------------------------
// Phase B tables.
// ---------------------------------------------------------------------------

// Daily Position Record snapshots (#5) — one frozen row per site × day ×
// crop × program, written at end-of-day close (sheets.closeDay). Frozen rows
// are immutable; an open day can be regenerated (dpr.regenerate) which only
// replaces rows with frozen = false. Balances come from the bin_movements
// replay (book stock) plus signed shrink_entries; adjustmentsLbs is the
// residual of lot-less manual corrections (bins.adjust). Ownership
// (storage-vs-owned) is NOT modeled — out of scope (contracts/settlements).
export const dprSnapshots = mysqlTable(
  "dpr_snapshots",
  {
    id: serial("id").primaryKey(),
    siteId: bigint("siteId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => sites.id),
    day: varchar("day", { length: 10 }).notNull(), // YYYY-MM-DD
    crop: varchar("crop", { length: 64 }).notNull(),
    program: varchar("program", { length: 32 }).notNull().default("conventional"),
    openingLbs: int("openingLbs").notNull().default(0),
    receivedLbs: int("receivedLbs").notNull().default(0),
    receivedBu: double("receivedBu").notNull().default(0),
    shippedLbs: int("shippedLbs").notNull().default(0),
    shippedBu: double("shippedBu").notNull().default(0),
    transfersInLbs: int("transfersInLbs").notNull().default(0),
    transfersOutLbs: int("transfersOutLbs").notNull().default(0),
    // identifiable adjustments by shrink_entries kind (signed)
    shrinkMoistureLbs: int("shrinkMoistureLbs").notNull().default(0),
    shrinkHandlingLbs: int("shrinkHandlingLbs").notNull().default(0),
    shrinkAerationLbs: int("shrinkAerationLbs").notNull().default(0),
    shrinkErrorCorrectionLbs: int("shrinkErrorCorrectionLbs").notNull().default(0),
    // lot-less manual bin adjustments (bins.adjust), signed net
    adjustmentsLbs: int("adjustmentsLbs").notNull().default(0),
    endingLbs: int("endingLbs").notNull().default(0),
    endingBu: double("endingBu").notNull().default(0),
    // true once written by closeDay — frozen rows are never regenerated
    frozen: boolean("frozen").notNull().default(false),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => ({
    siteDayIdx: index("dpr_site_day_idx").on(t.siteId, t.day),
    scopeUnique: uniqueIndex("dpr_site_day_crop_program_unique").on(
      t.siteId,
      t.day,
      t.crop,
      t.program,
    ),
  }),
);

// Physical bin counts (#15) — periodic physical measurements the book stock
// is reconciled against (mass-balance). Append-only.
export const physicalCounts = mysqlTable(
  "physical_counts",
  {
    id: serial("id").primaryKey(),
    siteId: bigint("siteId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => sites.id),
    binId: bigint("binId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => bins.id),
    countedLbs: int("countedLbs").notNull(),
    countedAt: timestamp("countedAt").notNull(),
    note: text("note"),
    operator: varchar("operator", { length: 255 }),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => ({
    siteIdx: index("physical_counts_site_idx").on(t.siteId),
    binIdx: index("physical_counts_bin_idx").on(t.binId),
  }),
);

// ---------------------------------------------------------------------------
// Main-office sync — key/value settings (office URL + shared key) and a log
// of every push/pull attempt. eod_reports is used by the OFFICE portal to
// store one end-of-day summary per site per day; it exists in both schemas so
// the two deployments share one migration set.
// ---------------------------------------------------------------------------
export const settings = mysqlTable("settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: text("value"),
});

export const syncLog = mysqlTable("sync_log", {
  id: serial("id").primaryKey(),
  direction: mysqlEnum("direction", ["PUSH", "PULL", "RECEIVE"]).notNull(),
  status: mysqlEnum("status", ["OK", "ERROR"]).notNull(),
  detail: text("detail"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
});

export const eodReports = mysqlTable(
  "eod_reports",
  {
    id: serial("id").primaryKey(),
    siteId: bigint("siteId", { mode: "number", unsigned: true })
      .notNull()
      .references(() => sites.id),
    day: varchar("day", { length: 10 }).notNull(), // YYYY-MM-DD
    sheetsOpened: int("sheetsOpened").notNull().default(0),
    loadCount: int("loadCount").notNull().default(0),
    completedCount: int("completedCount").notNull().default(0),
    inboundLbs: int("inboundLbs").notNull().default(0),
    outboundLbs: int("outboundLbs").notNull().default(0),
    inboundBu: double("inboundBu").notNull().default(0),
    outboundBu: double("outboundBu").notNull().default(0),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => ({
    siteIdx: index("eod_site_idx").on(t.siteId),
    dayIdx: index("eod_day_idx").on(t.day),
    // One report per site per day (review 2.2 / P1-6): concurrent receives
    // now collide loudly instead of inserting duplicates.
    siteDayUnique: uniqueIndex("eod_site_day_unique").on(t.siteId, t.day),
  }),
);

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type Site = typeof sites.$inferSelect;
export type Bin = typeof bins.$inferSelect;
export type Farmer = typeof farmers.$inferSelect;
export type Landlord = typeof landlords.$inferSelect;
export type Lot = typeof lots.$inferSelect;
export type WeightSheet = typeof weightSheets.$inferSelect;
export type Load = typeof loads.$inferSelect;
export type SheetEvent = typeof sheetEvents.$inferSelect;
export type BinMovement = typeof binMovements.$inferSelect;
export type Shipment = typeof shipments.$inferSelect;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type GradingSchedule = typeof gradingSchedules.$inferSelect;
export type GradeFactor = typeof gradeFactors.$inferSelect;
export type LoadSplit = typeof loadSplits.$inferSelect;
export type BinCleanout = typeof binCleanouts.$inferSelect;
export type FumigationLog = typeof fumigationLogs.$inferSelect;
export type Certificate = typeof certificates.$inferSelect;
export type LabResult = typeof labResults.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type ShrinkEntry = typeof shrinkEntries.$inferSelect;
export type BinGradeOverride = typeof binGradeOverrides.$inferSelect;
export type DprSnapshot = typeof dprSnapshots.$inferSelect;
export type PhysicalCount = typeof physicalCounts.$inferSelect;

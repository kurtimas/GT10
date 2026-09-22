import {
  sqliteTable,
  integer,
  real,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// SQLite mirror of schema.ts — used ONLY by the offline/dev fallback
// (api/queries/connection.ts). Table names, column names, defaults, and
// indexes match the MySQL schema one-for-one. MySQL `serial` ids become
// INTEGER PRIMARY KEY AUTOINCREMENT; timestamps are stored as integer ms
// (timestamp_ms) so rows read back as Date objects just like MySQL.
// ---------------------------------------------------------------------------

// Sites (grain elevator locations)
export const sites = sqliteTable("sites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  location: text("location"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
});

// Bins (storage per site)
export const bins = sqliteTable(
  "bins",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    siteId: integer("siteId").notNull(),
    name: text("name").notNull(),
    crop: text("crop").notNull(),
    capacityLbs: integer("capacityLbs").notNull(),
    currentLbs: integer("currentLbs").notNull().default(0),
    // program segregation (Phase A, #17)
    program: text("program").notNull().default("conventional"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [index("bins_site_idx").on(t.siteId)],
);

// Farmers & landlords
export const farmers = sqliteTable("farmers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
});

export const landlords = sqliteTable("landlords", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  phone: text("phone"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
});

// Lots — a farmer's unique lot/field identity, optionally crop-shared with a
// landlord (landlordSplitPct = landlord's share of each load, 0-100).
export const lots = sqliteTable(
  "lots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    farmerId: integer("farmerId").notNull(),
    landlordId: integer("landlordId"),
    code: text("code").notNull().unique(),
    crop: text("crop").notNull(),
    landlordSplitPct: real("landlordSplitPct").notNull().default(0),
    status: text("status", { enum: ["OPEN", "CLOSED"] }).notNull().default("OPEN"),
    // program segregation (Phase A, #17) + farm-origin sustainability (#31)
    program: text("program").notNull().default("conventional"),
    practices: text("practices"),
    carbonNotes: text("carbonNotes"),
    notes: text("notes"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
    closedAt: integer("closedAt", { mode: "timestamp_ms" }),
  },
  (t) => [index("lots_farmer_idx").on(t.farmerId), index("lots_code_idx").on(t.code)],
);

// Weight sheets — the multi-load document tied to one lot.
//   OPEN   — accepting loads (fewer than maxLoads recorded)
//   FULL   — maxLoads reached; sheet closed automatically
//   CLOSED — locked by end-of-day close
// closeReason: FULL | EOD | MANUAL
export const weightSheets = sqliteTable(
  "weight_sheets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ticketNo: text("ticketNo").notNull().unique(),
    siteId: integer("siteId").notNull(),
    farmerId: integer("farmerId").notNull(),
    lotId: integer("lotId"),
    landlordId: integer("landlordId"),
    crop: text("crop").notNull(),
    direction: text("direction", { enum: ["INBOUND", "OUTBOUND"] })
      .notNull()
      .default("INBOUND"),
    status: text("status", { enum: ["OPEN", "FULL", "CLOSED"] })
      .notNull()
      .default("OPEN"),
    closeReason: text("closeReason"),
    maxLoads: integer("maxLoads").notNull().default(10),
    notes: text("notes"),
    // VOID-instead-of-delete (Phase 3): null on live sheets
    voidedAt: integer("voidedAt", { mode: "timestamp_ms" }),
    voidReason: text("voidReason"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
    closedAt: integer("closedAt", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("sheets_farmer_idx").on(t.farmerId),
    index("sheets_lot_idx").on(t.lotId),
    index("sheets_landlord_idx").on(t.landlordId),
    index("sheets_status_idx").on(t.status),
    index("sheets_created_idx").on(t.createdAt),
  ],
);

// Loads — one truck visit on a weight sheet. Inbound: gross captured first,
// tare second. Outbound reverses. Grades are per load.
export const loads = sqliteTable(
  "loads",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sheetId: integer("sheetId").notNull(),
    loadNo: integer("loadNo").notNull(),
    truckId: text("truckId"),
    driverName: text("driverName"),
    binId: integer("binId"),
    grossLbs: integer("grossLbs"),
    tareLbs: integer("tareLbs"),
    netLbs: integer("netLbs"),
    grossAt: integer("grossAt", { mode: "timestamp_ms" }),
    tareAt: integer("tareAt", { mode: "timestamp_ms" }),
    // grading (TEST utilities)
    moisturePct: real("moisturePct"),
    dockagePct: real("dockagePct"),
    testWeightLbs: real("testWeightLbs"),
    proteinPct: real("proteinPct"),
    // enriched intake (Phase 3)
    damagePct: real("damagePct"),
    grade: text("grade"),
    farmOrigin: text("farmOrigin"),
    // remaining grade factors + program (Phase A, #3 / #17)
    foreignMaterialPct: real("foreignMaterialPct"),
    sbPct: real("sbPct"),
    program: text("program").notNull().default("conventional"),
    shrinkPct: real("shrinkPct"),
    grossBushels: real("grossBushels"),
    netBushels: real("netBushels"),
    // Phase B (#3): schedule-driven shrink/dock lbs stamped at grade time
    shrinkLbs: real("shrinkLbs"),
    dockLbs: real("dockLbs"),
    // outbound load → shipment link (Phase 3)
    shipmentId: integer("shipmentId"),
    changeReason: text("changeReason"),
    // VOID-instead-of-delete (Phase 3): null on live loads
    voidedAt: integer("voidedAt", { mode: "timestamp_ms" }),
    voidReason: text("voidReason"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [
    index("loads_sheet_idx").on(t.sheetId),
    index("loads_truck_idx").on(t.truckId),
    index("loads_shipment_idx").on(t.shipmentId),
    index("loads_created_idx").on(t.createdAt),
    uniqueIndex("loads_sheet_load_unique").on(t.sheetId, t.loadNo),
  ],
);

// Audit trail — every weight capture / edit / status change
export const sheetEvents = sqliteTable(
  "sheet_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sheetId: integer("sheetId").notNull(),
    loadId: integer("loadId"),
    action: text("action").notNull(),
    detail: text("detail"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [index("events_sheet_idx").on(t.sheetId)],
);

// Bin movements — append-only provenance event log (see schema.ts comments).
export const binMovements = sqliteTable(
  "bin_movements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    siteId: integer("siteId").notNull(),
    lotId: integer("lotId"),
    fromBinId: integer("fromBinId"),
    toBinId: integer("toBinId"),
    quantityLbs: integer("quantityLbs").notNull(),
    loadId: integer("loadId"),
    shipmentId: integer("shipmentId"),
    operator: text("operator"),
    note: text("note"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [
    index("binmov_site_idx").on(t.siteId),
    index("binmov_lot_idx").on(t.lotId),
    index("binmov_from_bin_idx").on(t.fromBinId),
    index("binmov_to_bin_idx").on(t.toBinId),
    index("binmov_load_idx").on(t.loadId),
    index("binmov_created_idx").on(t.createdAt),
  ],
);

// Shipments — one outbound sale/delivery (Phase 3).
export const shipments = sqliteTable(
  "shipments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    siteId: integer("siteId").notNull(),
    customerName: text("customerName").notNull(),
    destination: text("destination"),
    lotId: integer("lotId"),
    binId: integer("binId"),
    quantityLbs: integer("quantityLbs").notNull(),
    quantityBu: real("quantityBu"),
    truckId: text("truckId"),
    binMovementId: integer("binMovementId"),
    note: text("note"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [
    index("shipments_site_idx").on(t.siteId),
    index("shipments_lot_idx").on(t.lotId),
    index("shipments_bin_idx").on(t.binId),
    index("shipments_created_idx").on(t.createdAt),
  ],
);

// Audit log — generic append-only trail (Phase 3 table; routers write in Phase 4).
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actor: text("actor").notNull().default("system"),
    action: text("action").notNull(),
    entityType: text("entityType").notNull(),
    entityId: integer("entityId").notNull(),
    beforeJson: text("beforeJson"),
    afterJson: text("afterJson"),
    note: text("note"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_entity_idx").on(t.entityType, t.entityId),
    index("audit_created_idx").on(t.createdAt),
  ],
);

// Main-office sync — key/value settings and a log of every push/pull attempt.
// eod_reports exists in both schemas so site + office deployments share one
// migration set.
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
});

export const syncLog = sqliteTable("sync_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  direction: text("direction", { enum: ["PUSH", "PULL", "RECEIVE"] }).notNull(),
  status: text("status", { enum: ["OK", "ERROR"] }).notNull(),
  detail: text("detail"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
});

export const eodReports = sqliteTable(
  "eod_reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    siteId: integer("siteId").notNull(),
    day: text("day").notNull(), // YYYY-MM-DD
    sheetsOpened: integer("sheetsOpened").notNull().default(0),
    loadCount: integer("loadCount").notNull().default(0),
    completedCount: integer("completedCount").notNull().default(0),
    inboundLbs: integer("inboundLbs").notNull().default(0),
    outboundLbs: integer("outboundLbs").notNull().default(0),
    inboundBu: real("inboundBu").notNull().default(0),
    outboundBu: real("outboundBu").notNull().default(0),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [
    index("eod_site_idx").on(t.siteId),
    index("eod_day_idx").on(t.day),
    uniqueIndex("eod_site_day_unique").on(t.siteId, t.day),
  ],
);

// ---------------------------------------------------------------------------
// Phase A tables (see schema.ts comments) — SQLite mirror, no FKs (offline DB
// stays app-disciplined, as before).
// ---------------------------------------------------------------------------

// Grading shrink/dock schedules (#3). siteId null = plant-wide default.
export const gradingSchedules = sqliteTable(
  "grading_schedules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    siteId: integer("siteId"),
    crop: text("crop").notNull(),
    moistureShrinkPerPoint: real("moistureShrinkPerPoint").notNull(),
    baseMoisturePct: real("baseMoisturePct").notNull(),
    handlingShrinkPct: real("handlingShrinkPct").notNull().default(0),
    dockageRules: text("dockageRules"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [index("grading_sched_site_crop_idx").on(t.siteId, t.crop)],
);

// Grade factor min/max validation ranges per crop + grade class (#3).
export const gradeFactors = sqliteTable(
  "grade_factors",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    siteId: integer("siteId"),
    crop: text("crop").notNull(),
    gradeClass: text("gradeClass").notNull(),
    factor: text("factor").notNull(),
    minValue: real("minValue"),
    maxValue: real("maxValue"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [index("grade_factor_site_crop_idx").on(t.siteId, t.crop)],
);

// Load splits (#4) — farmer/landlord share per load; partyId is plain
// (references farmers or landlords depending on partyType).
export const loadSplits = sqliteTable(
  "load_splits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    loadId: integer("loadId").notNull(),
    partyType: text("partyType").notNull(),
    partyId: integer("partyId").notNull(),
    splitPct: real("splitPct").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [index("load_splits_load_idx").on(t.loadId)],
);

// Bin empty & cleanout records (#12) — genealogy reset points.
export const binCleanouts = sqliteTable(
  "bin_cleanouts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    siteId: integer("siteId").notNull(),
    binId: integer("binId").notNull(),
    emptiedAt: integer("emptiedAt", { mode: "timestamp_ms" }).notNull(),
    cleanedAt: integer("cleanedAt", { mode: "timestamp_ms" }),
    method: text("method"),
    note: text("note"),
    operator: text("operator"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [index("cleanouts_site_idx").on(t.siteId), index("cleanouts_bin_idx").on(t.binId)],
);

// Fumigation / treatment logs (#19).
export const fumigationLogs = sqliteTable(
  "fumigation_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    siteId: integer("siteId").notNull(),
    binId: integer("binId").notNull(),
    product: text("product").notNull(),
    dosage: text("dosage"),
    appliedAt: integer("appliedAt", { mode: "timestamp_ms" }).notNull(),
    exposureHours: real("exposureHours"),
    aerationClearedAt: integer("aerationClearedAt", { mode: "timestamp_ms" }),
    applicator: text("applicator"),
    note: text("note"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [index("fumigation_site_idx").on(t.siteId), index("fumigation_bin_idx").on(t.binId)],
);

// Certificate registry (#20).
export const certificates = sqliteTable(
  "certificates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    siteId: integer("siteId").notNull(),
    type: text("type").notNull(),
    certNumber: text("certNumber").notNull(),
    issuedAt: integer("issuedAt", { mode: "timestamp_ms" }).notNull(),
    status: text("status").notNull().default("issued"),
    lotId: integer("lotId"),
    shipmentId: integer("shipmentId"),
    note: text("note"),
    fileRef: text("fileRef"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [
    index("certificates_site_idx").on(t.siteId),
    index("certificates_lot_idx").on(t.lotId),
    index("certificates_shipment_idx").on(t.shipmentId),
  ],
);

// Lab results (#22) — bound to the lot / load / bin they certify.
export const labResults = sqliteTable(
  "lab_results",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    siteId: integer("siteId").notNull(),
    sampleDate: integer("sampleDate", { mode: "timestamp_ms" }).notNull(),
    labName: text("labName"),
    testType: text("testType").notNull(),
    result: text("result"),
    passFail: text("passFail"),
    lotId: integer("lotId"),
    loadId: integer("loadId"),
    binId: integer("binId"),
    note: text("note"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [
    index("lab_results_site_idx").on(t.siteId),
    index("lab_results_lot_idx").on(t.lotId),
    index("lab_results_bin_idx").on(t.binId),
    index("lab_results_load_idx").on(t.loadId),
  ],
);

// Attachments (#26) — documents against any entity; storageRef is the
// content-hash filename under data/attachments/.
export const attachments = sqliteTable(
  "attachments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    siteId: integer("siteId").notNull(),
    entityType: text("entityType").notNull(),
    entityId: integer("entityId").notNull(),
    filename: text("filename").notNull(),
    mime: text("mime"),
    size: integer("size"),
    storageRef: text("storageRef").notNull(),
    uploadedBy: text("uploadedBy"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [
    index("attachments_site_idx").on(t.siteId),
    index("attachments_entity_idx").on(t.entityType, t.entityId),
  ],
);

// Shrink / reconciliation entries (#15) — append-only, quantityLbs signed.
export const shrinkEntries = sqliteTable(
  "shrink_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    siteId: integer("siteId").notNull(),
    binId: integer("binId").notNull(),
    kind: text("kind").notNull(),
    quantityLbs: integer("quantityLbs").notNull(),
    effectiveDate: integer("effectiveDate", { mode: "timestamp_ms" }).notNull(),
    note: text("note"),
    operator: text("operator"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [
    index("shrink_entries_site_idx").on(t.siteId),
    index("shrink_entries_bin_idx").on(t.binId),
  ],
);

// Bin grade overrides (#18) — append-only; latest per (binId, factor) wins.
export const binGradeOverrides = sqliteTable(
  "bin_grade_overrides",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    siteId: integer("siteId").notNull(),
    binId: integer("binId").notNull(),
    factor: text("factor").notNull(),
    value: real("value").notNull(),
    reason: text("reason").notNull(),
    operator: text("operator"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [
    index("grade_overrides_site_idx").on(t.siteId),
    index("grade_overrides_bin_idx").on(t.binId),
  ],
);

// ---------------------------------------------------------------------------
// Phase B tables — SQLite mirror (see schema.ts comments).
// ---------------------------------------------------------------------------

// Daily Position Record snapshots (#5) — frozen at close of day.
export const dprSnapshots = sqliteTable(
  "dpr_snapshots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    siteId: integer("siteId").notNull(),
    day: text("day").notNull(), // YYYY-MM-DD
    crop: text("crop").notNull(),
    program: text("program").notNull().default("conventional"),
    openingLbs: integer("openingLbs").notNull().default(0),
    receivedLbs: integer("receivedLbs").notNull().default(0),
    receivedBu: real("receivedBu").notNull().default(0),
    shippedLbs: integer("shippedLbs").notNull().default(0),
    shippedBu: real("shippedBu").notNull().default(0),
    transfersInLbs: integer("transfersInLbs").notNull().default(0),
    transfersOutLbs: integer("transfersOutLbs").notNull().default(0),
    shrinkMoistureLbs: integer("shrinkMoistureLbs").notNull().default(0),
    shrinkHandlingLbs: integer("shrinkHandlingLbs").notNull().default(0),
    shrinkAerationLbs: integer("shrinkAerationLbs").notNull().default(0),
    shrinkErrorCorrectionLbs: integer("shrinkErrorCorrectionLbs").notNull().default(0),
    adjustmentsLbs: integer("adjustmentsLbs").notNull().default(0),
    endingLbs: integer("endingLbs").notNull().default(0),
    endingBu: real("endingBu").notNull().default(0),
    frozen: integer("frozen", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [
    index("dpr_site_day_idx").on(t.siteId, t.day),
    uniqueIndex("dpr_site_day_crop_program_unique").on(t.siteId, t.day, t.crop, t.program),
  ],
);

// Physical bin counts (#15) — mass-balance reconciliation, append-only.
export const physicalCounts = sqliteTable(
  "physical_counts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    siteId: integer("siteId").notNull(),
    binId: integer("binId").notNull(),
    countedLbs: integer("countedLbs").notNull(),
    countedAt: integer("countedAt", { mode: "timestamp_ms" }).notNull(),
    note: text("note"),
    operator: text("operator"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull().defaultNow(),
  },
  (t) => [
    index("physical_counts_site_idx").on(t.siteId),
    index("physical_counts_bin_idx").on(t.binId),
  ],
);

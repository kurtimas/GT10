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
    shrinkPct: real("shrinkPct"),
    grossBushels: real("grossBushels"),
    netBushels: real("netBushels"),
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

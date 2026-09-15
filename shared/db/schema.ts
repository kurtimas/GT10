import {
  mysqlTable,
  mysqlEnum,
  serial,
  bigint,
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
    shrinkPct: double("shrinkPct"),
    grossBushels: double("grossBushels"),
    netBushels: double("netBushels"),
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

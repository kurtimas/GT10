import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import mysql from "mysql2/promise";
import { drizzle as drizzleMysql, type MySql2Database } from "drizzle-orm/mysql2";
import { MySqlTimestamp } from "drizzle-orm/mysql-core";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import * as schema from "../../db/schema";
import * as sqliteSchema from "../../db/sqliteSchema";
import { env } from "../lib/env";

// ---------------------------------------------------------------------------
// Database connection.
//
// Production (docker-compose): MySQL via DATABASE_URL. The mysql container
// takes a while to become healthy, so the connect probe retries for ~30s at
// 1s intervals. Table creation on MySQL is owned by drizzle migrations
// (db/migrations, applied by migrateOnBoot on every boot).
//
// Dev fallback: if MySQL is missing/unreachable after the retries we open an
// embedded better-sqlite3 database at data/grain-tracker-offline.db using the
// sqlite mirror schema (db/sqliteSchema.ts). Offline mode is a dev-only
// convenience — routers use MySQL-only .$returningId(), so some write paths
// diverge offline by design. The offline handle is cast to the MySQL db type
// so every router call-site typechecks against one type.
// ---------------------------------------------------------------------------

/** Active drizzle instance, always typed as the MySQL database. */
export type Db = MySql2Database<typeof schema>;

let db: Db | null = null;
let offline = false;

const CONNECT_ATTEMPTS = 30;
const CONNECT_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// SQLite DDL — equivalent schema for the offline fallback (db/sqliteSchema.ts)
// ---------------------------------------------------------------------------
const SQLITE_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "sites" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS "bins" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "siteId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "crop" TEXT NOT NULL,
    "capacityLbs" INTEGER NOT NULL,
    "currentLbs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE INDEX IF NOT EXISTS "bins_site_idx" ON "bins" ("siteId")`,
  `CREATE TABLE IF NOT EXISTS "farmers" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS "landlords" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS "lots" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "farmerId" INTEGER NOT NULL,
    "landlordId" INTEGER,
    "code" TEXT NOT NULL UNIQUE,
    "crop" TEXT NOT NULL,
    "landlordSplitPct" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    "closedAt" INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS "lots_farmer_idx" ON "lots" ("farmerId")`,
  `CREATE INDEX IF NOT EXISTS "lots_code_idx" ON "lots" ("code")`,
  `CREATE TABLE IF NOT EXISTS "weight_sheets" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "ticketNo" TEXT NOT NULL UNIQUE,
    "siteId" INTEGER NOT NULL,
    "farmerId" INTEGER NOT NULL,
    "lotId" INTEGER,
    "landlordId" INTEGER,
    "crop" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'INBOUND',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closeReason" TEXT,
    "maxLoads" INTEGER NOT NULL DEFAULT 10,
    "notes" TEXT,
    "voidedAt" INTEGER,
    "voidReason" TEXT,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    "updatedAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    "closedAt" INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS "sheets_farmer_idx" ON "weight_sheets" ("farmerId")`,
  `CREATE INDEX IF NOT EXISTS "sheets_lot_idx" ON "weight_sheets" ("lotId")`,
  `CREATE INDEX IF NOT EXISTS "sheets_landlord_idx" ON "weight_sheets" ("landlordId")`,
  `CREATE INDEX IF NOT EXISTS "sheets_status_idx" ON "weight_sheets" ("status")`,
  `CREATE INDEX IF NOT EXISTS "sheets_created_idx" ON "weight_sheets" ("createdAt")`,
  `CREATE TABLE IF NOT EXISTS "loads" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "sheetId" INTEGER NOT NULL,
    "loadNo" INTEGER NOT NULL,
    "truckId" TEXT,
    "driverName" TEXT,
    "binId" INTEGER,
    "grossLbs" INTEGER,
    "tareLbs" INTEGER,
    "netLbs" INTEGER,
    "grossAt" INTEGER,
    "tareAt" INTEGER,
    "moisturePct" REAL,
    "dockagePct" REAL,
    "testWeightLbs" REAL,
    "proteinPct" REAL,
    "damagePct" REAL,
    "grade" TEXT,
    "farmOrigin" TEXT,
    "shrinkPct" REAL,
    "grossBushels" REAL,
    "netBushels" REAL,
    "shipmentId" INTEGER,
    "changeReason" TEXT,
    "voidedAt" INTEGER,
    "voidReason" TEXT,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    "updatedAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE INDEX IF NOT EXISTS "loads_sheet_idx" ON "loads" ("sheetId")`,
  `CREATE INDEX IF NOT EXISTS "loads_truck_idx" ON "loads" ("truckId")`,
  `CREATE INDEX IF NOT EXISTS "loads_shipment_idx" ON "loads" ("shipmentId")`,
  `CREATE INDEX IF NOT EXISTS "loads_created_idx" ON "loads" ("createdAt")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "loads_sheet_load_unique" ON "loads" ("sheetId", "loadNo")`,
  `CREATE TABLE IF NOT EXISTS "sheet_events" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "sheetId" INTEGER NOT NULL,
    "loadId" INTEGER,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE INDEX IF NOT EXISTS "events_sheet_idx" ON "sheet_events" ("sheetId")`,
  `CREATE TABLE IF NOT EXISTS "settings" (
    "key" TEXT PRIMARY KEY,
    "value" TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS "sync_log" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE TABLE IF NOT EXISTS "eod_reports" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "siteId" INTEGER NOT NULL,
    "day" TEXT NOT NULL,
    "sheetsOpened" INTEGER NOT NULL DEFAULT 0,
    "loadCount" INTEGER NOT NULL DEFAULT 0,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "inboundLbs" INTEGER NOT NULL DEFAULT 0,
    "outboundLbs" INTEGER NOT NULL DEFAULT 0,
    "inboundBu" REAL NOT NULL DEFAULT 0,
    "outboundBu" REAL NOT NULL DEFAULT 0,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE INDEX IF NOT EXISTS "eod_site_idx" ON "eod_reports" ("siteId")`,
  `CREATE INDEX IF NOT EXISTS "eod_day_idx" ON "eod_reports" ("day")`,
  `CREATE TABLE IF NOT EXISTS "bin_movements" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "siteId" INTEGER NOT NULL,
    "lotId" INTEGER,
    "fromBinId" INTEGER,
    "toBinId" INTEGER,
    "quantityLbs" INTEGER NOT NULL,
    "loadId" INTEGER,
    "shipmentId" INTEGER,
    "operator" TEXT,
    "note" TEXT,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE INDEX IF NOT EXISTS "binmov_site_idx" ON "bin_movements" ("siteId")`,
  `CREATE INDEX IF NOT EXISTS "binmov_lot_idx" ON "bin_movements" ("lotId")`,
  `CREATE INDEX IF NOT EXISTS "binmov_from_bin_idx" ON "bin_movements" ("fromBinId")`,
  `CREATE INDEX IF NOT EXISTS "binmov_to_bin_idx" ON "bin_movements" ("toBinId")`,
  `CREATE INDEX IF NOT EXISTS "binmov_load_idx" ON "bin_movements" ("loadId")`,
  `CREATE INDEX IF NOT EXISTS "binmov_created_idx" ON "bin_movements" ("createdAt")`,
  `CREATE TABLE IF NOT EXISTS "shipments" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "siteId" INTEGER NOT NULL,
    "customerName" TEXT NOT NULL,
    "destination" TEXT,
    "lotId" INTEGER,
    "binId" INTEGER,
    "quantityLbs" INTEGER NOT NULL,
    "quantityBu" REAL,
    "truckId" TEXT,
    "binMovementId" INTEGER,
    "note" TEXT,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE INDEX IF NOT EXISTS "shipments_site_idx" ON "shipments" ("siteId")`,
  `CREATE INDEX IF NOT EXISTS "shipments_lot_idx" ON "shipments" ("lotId")`,
  `CREATE INDEX IF NOT EXISTS "shipments_bin_idx" ON "shipments" ("binId")`,
  `CREATE INDEX IF NOT EXISTS "shipments_created_idx" ON "shipments" ("createdAt")`,
  `CREATE TABLE IF NOT EXISTS "audit_log" (
    "id" INTEGER PRIMARY KEY AUTOINCREMENT,
    "actor" TEXT NOT NULL DEFAULT 'system',
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" INTEGER NOT NULL,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "note" TEXT,
    "createdAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  )`,
  `CREATE INDEX IF NOT EXISTS "audit_entity_idx" ON "audit_log" ("entityType", "entityId")`,
  `CREATE INDEX IF NOT EXISTS "audit_created_idx" ON "audit_log" ("createdAt")`,
];

// ---------------------------------------------------------------------------
// Existing-dev-database upgrades. CREATE TABLE IF NOT EXISTS above cannot add
// columns or constraints to tables that already exist, so these run on every
// boot and tolerate "already applied" failures:
//   * ADD COLUMN — SQLite has no IF NOT EXISTS form; "duplicate column name"
//     means the database is already up to date.
//   * the eod_reports (siteId, day) unique index — kept out of the strict DDL
//     above because an old database holding duplicate rows would fail boot;
//     instead we log a loud warning so the operator can dedupe.
// ---------------------------------------------------------------------------
const SQLITE_ALTER_COLUMNS: string[] = [
  `ALTER TABLE "weight_sheets" ADD COLUMN "voidedAt" INTEGER`,
  `ALTER TABLE "weight_sheets" ADD COLUMN "voidReason" TEXT`,
  `ALTER TABLE "loads" ADD COLUMN "damagePct" REAL`,
  `ALTER TABLE "loads" ADD COLUMN "grade" TEXT`,
  `ALTER TABLE "loads" ADD COLUMN "farmOrigin" TEXT`,
  `ALTER TABLE "loads" ADD COLUMN "shipmentId" INTEGER`,
  `ALTER TABLE "loads" ADD COLUMN "voidedAt" INTEGER`,
  `ALTER TABLE "loads" ADD COLUMN "voidReason" TEXT`,
];

function applySqliteUpgrades(sqlite: InstanceType<typeof Database>) {
  for (const stmt of SQLITE_ALTER_COLUMNS) {
    try {
      sqlite.exec(stmt);
    } catch (err) {
      if (err instanceof Error && /duplicate column name/i.test(err.message)) continue;
      throw err;
    }
  }
  try {
    sqlite.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS "eod_site_day_unique" ON "eod_reports" ("siteId", "day")`,
    );
  } catch (err) {
    console.warn(
      "[db] could not create eod_reports (siteId, day) unique index — the " +
        "offline database likely holds duplicate rows for a site/day; remove " +
        "the duplicates and restart to enforce it.",
      err,
    );
  }
}

// ---------------------------------------------------------------------------
// MySQL init — probe with retries, then ensure the schema exists
// ---------------------------------------------------------------------------
async function tryInitMysql(): Promise<Db | null> {
  const pool = mysql.createPool({
    uri: env.DATABASE_URL,
    connectionLimit: 10,
    waitForConnections: true,
  });
  let lastErr: unknown;
  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt++) {
    try {
      // Probe only — table creation on MySQL is owned by drizzle migrations
      // (db/migrations, applied by migrateOnBoot). Running our own DDL here
      // too makes migrate() collide with the already-existing tables and its
      // failure would skip the demo seed.
      await pool.query("SELECT 1");
      console.log("[db] connected to MySQL");
      return drizzleMysql(pool, { schema, mode: "default" });
    } catch (err) {
      lastErr = err;
      if (attempt < CONNECT_ATTEMPTS) await sleep(CONNECT_DELAY_MS);
    }
  }
  console.error(
    `[db] MySQL unreachable after ${CONNECT_ATTEMPTS}s — falling back to offline mode:`,
    lastErr instanceof Error ? lastErr.message : lastErr,
  );
  await pool.end().catch(() => {});
  return null;
}

// ---------------------------------------------------------------------------
// Offline init — embedded better-sqlite3 database (dev-only fallback)
// ---------------------------------------------------------------------------
function initSqlite(): Db {
  // GT_OFFLINE_DB_PATH overrides the file location (tests pass ":memory:").
  const override = process.env.GT_OFFLINE_DB_PATH;
  const file = override || path.join(path.resolve(process.cwd(), "data"), "grain-tracker-offline.db");
  if (!override) fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  // The MySQL schema's .defaultNow()/.onUpdateNow() columns make drizzle emit
  // `now()` inside INSERT/UPDATE statements; SQLite has no such function.
  // Register it to return epoch-ms, matching the INTEGER timestamp columns.
  sqlite.function("now", () => Date.now());
  // Server code uses GREATEST(0, x) for atomic clamped updates (bin levels);
  // MySQL has it natively, SQLite gets the scalar here. arity: -1 marks it
  // variadic — a rest-parameter fn would otherwise register as 0-arg.
  // Server code uses GREATEST(0, x) for atomic clamped updates (bin levels);
  // MySQL has it natively, SQLite gets a 2-arg scalar here (that is the only
  // shape we emit — better-sqlite3 has no variadic registration).
  sqlite.function("greatest", (a: unknown, b: unknown) =>
    Math.max(Number(a), Number(b)),
  );
  patchAsyncTransactions(sqlite);
  for (const ddl of SQLITE_DDL) {
    sqlite.exec(ddl);
  }
  applySqliteUpgrades(sqlite);
  patchTimestampColumnsForOffline();
  const sqliteDb = drizzleSqlite(sqlite, { schema: sqliteSchema });
  // Cast so all router call-sites typecheck against the MySQL db type.
  return patchOfflineWrites(sqliteDb) as unknown as Db;
}

// ---------------------------------------------------------------------------
// Offline write compatibility shim.
//
// Routers and the seed are written against the MySQL drizzle API:
//   * inserts read back the new id via MySQL-only .$returningId()
//   * TIMESTAMP columns (MySQL `timestamp` → JS Date) are passed as Date
// The embedded SQLite database stores epoch-ms integers and better-sqlite3
// refuses to bind Date objects, and its insert builders have .returning()
// instead of $returningId(). Rather than forking every write call-site, the
// offline handle (and every transaction handle handed out of it) is wrapped
// so MySQL-style writes just work:
//   * Date values inside .values()/.set() become epoch-ms integers
//   * insert builders gain $returningId(), backed by SQLite RETURNING
// ---------------------------------------------------------------------------
function toEpochMs(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (Array.isArray(value)) return value.map(toEpochMs);
  // Only plain option objects are remapped — drizzle SQL fragments (e.g.
  // sql`GREATEST(...)`) and other class instances must pass through intact.
  if (value && typeof value === "object" && value.constructor === Object) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toEpochMs(v)]));
  }
  return value;
}

/**
 * MySqlTimestamp maps Date ⇄ "YYYY-MM-DD HH:MM:SS" strings for the MySQL
 * wire protocol, but the offline database stores epoch-ms integers. Swap the
 * two mapping directions while offline so writes bind numbers and reads come
 * back as real Dates. MySQL is never used in the same process once the
 * offline fallback is active, so the patch is inert on the MySQL path.
 */
function patchTimestampColumnsForOffline() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = MySqlTimestamp.prototype as any;
  const origToDriver = proto.mapToDriverValue;
  const origFromDriver = proto.mapFromDriverValue;
  proto.mapToDriverValue = function (value: unknown) {
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number") return value;
    return origToDriver.call(this, value);
  };
  proto.mapFromDriverValue = function (value: unknown) {
    if (typeof value === "number") return new Date(value);
    return origFromDriver.call(this, value);
  };
}

/**
 * better-sqlite3's native transaction() rejects promise-returning callbacks,
 * but the routers use `db.transaction(async (tx) => …)` (fine on MySQL). For
 * async callbacks, drive BEGIN/COMMIT/ROLLBACK manually instead: every
 * statement better-sqlite3 runs is synchronous, so awaits between them stay
 * ordered on this single embedded connection. Async transactions are queued
 * so they never overlap. Sync callbacks keep the native path, savepoints and
 * all. The .deferred/.immediate/.exclusive variants drizzle selects on are
 * aliased to the same implementation (BEGIN is fine for a local file DB).
 */
function patchAsyncTransactions(sqlite: InstanceType<typeof Database>) {
  const nativeTransaction = sqlite.transaction.bind(sqlite);
  let queue: Promise<unknown> = Promise.resolve();
  sqlite.transaction = ((fn: (...args: unknown[]) => unknown) => {
    if (fn.constructor?.name !== "AsyncFunction") return nativeTransaction(fn);
    const run = async (...args: unknown[]) => {
      sqlite.exec("BEGIN");
      try {
        const result = await fn(...args);
        sqlite.exec("COMMIT");
        return result;
      } catch (err) {
        try {
          sqlite.exec("ROLLBACK");
        } catch {
          // transaction already unwound by the failure — nothing to roll back
        }
        throw err;
      }
    };
    const wrapped = (...args: unknown[]) => {
      const p = queue.then(() => run(...args));
      queue = p.catch(() => {});
      return p;
    };
    // better-sqlite3's transaction() exposes behavior variants that drizzle
    // selects on; alias them (BEGIN is fine for a local file DB)
    const variants = wrapped as typeof wrapped & {
      default: typeof wrapped;
      deferred: typeof wrapped;
      immediate: typeof wrapped;
      exclusive: typeof wrapped;
    };
    variants.default = wrapped;
    variants.deferred = wrapped;
    variants.immediate = wrapped;
    variants.exclusive = wrapped;
    return variants;
    // the patched signature intentionally widens better-sqlite3's typing
  }) as typeof sqlite.transaction;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- runtime shims over the
 * MySQL-typed handle; kept loose on purpose (see block comment above) */
function patchOfflineWrites(handle: any): any {
  const insert = handle.insert.bind(handle);
  handle.insert = (table: any) => {
    const builder = insert(table);
    const values = builder.values.bind(builder);
    // values() returns a fresh query object, so $returningId has to be
    // attached to that result — backing it with SQLite RETURNING.
    builder.values = (v: unknown) => {
      const query = values(toEpochMs(v));
      query.$returningId = () => query.returning({ id: table.id });
      return query;
    };
    return builder;
  };
  const update = handle.update.bind(handle);
  handle.update = (table: any) => {
    const builder = update(table);
    const set = builder.set.bind(builder);
    builder.set = (v: unknown) => set(toEpochMs(v));
    return builder;
  };
  if (typeof handle.transaction === "function") {
    const transaction = handle.transaction.bind(handle);
    // async wrapper keeps the callback an AsyncFunction, which the offline
    // transaction patch detects to drive BEGIN/COMMIT itself
    handle.transaction = (fn: (tx: unknown) => Promise<unknown>) =>
      transaction(async (tx: unknown) => fn(patchOfflineWrites(tx)));
  }
  return handle;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Establish the database connection (MySQL, or the embedded offline database
 * when MySQL is missing/unreachable). Idempotent — safe to call on every boot.
 */
export async function initDb(): Promise<Db> {
  if (db) return db;
  // GT_FORCE_OFFLINE=1 skips the ~30s MySQL probe — used by the vitest
  // router tests, which run entirely against an in-memory offline database.
  const mysqlDb = process.env.GT_FORCE_OFFLINE === "1" ? null : await tryInitMysql();
  if (mysqlDb) {
    db = mysqlDb;
    offline = false;
    return db;
  }
  if (env.isProduction && !env.ALLOW_OFFLINE) {
    // Booting offline here would record real tickets to a container-local
    // file that diverges from MySQL forever — fail loudly instead.
    console.error(
      "[db] MySQL unreachable in production — refusing to start. " +
        "Check DATABASE_URL / the MySQL container health. Set ALLOW_OFFLINE=1 " +
        "only to deliberately run single-machine on the embedded database " +
        "(data/grain-tracker-offline.db).",
    );
    process.exit(1);
  }
  db = initSqlite();
  offline = true;
  console.warn("[db] OFFLINE MODE — using embedded database (data/grain-tracker-offline.db)");
  return db;
}

/** The active drizzle instance. Throws if initDb() has not run yet. */
export function getDb(): Db {
  if (!db) {
    throw new Error("Database not initialized — call initDb() first");
  }
  return db;
}

/** true when initDb() fell back to the embedded offline database. */
export function isOffline(): boolean {
  return offline;
}

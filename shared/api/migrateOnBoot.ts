import fs from "node:fs";
import path from "node:path";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { getDb, initDb, isOffline } from "./queries/connection";
import { seedGradingDefaults } from "./lib/gradingDefaults";
import { env } from "./lib/env";

/**
 * Runs once at server start: establishes the database (MySQL, or the embedded
 * offline database when MySQL is missing/unreachable), applies migrations for
 * MySQL, then loads the demo dataset if allowed and the database is empty.
 *
 * A failed migration aborts the boot — a server that "looks healthy" against
 * a stale schema fails on every write at the scale. Seed failures are only
 * logged.
 *
 * The seed dataset differs per deployment (scale house vs office portal), so
 * the caller injects its own `seedIfEmpty` (see <app>/api/seed.ts).
 */

// Migrations live in the shared tree (shared/db/migrations). In the repo the
// process cwd is the deployment dir (app/ or office/), so the folder sits at
// ../shared/db/migrations; the legacy flat layout (<cwd>/db/migrations, used
// by older docker images) is kept as a fallback.
function resolveMigrationsFolder(): string {
  const candidates = [
    path.resolve(process.cwd(), "../shared/db/migrations"),
    path.resolve(process.cwd(), "db/migrations"),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
}

export async function migrateAndSeedOnBoot(seedIfEmpty: () => Promise<boolean>) {
  await initDb();
  const db = getDb();
  if (isOffline()) {
    console.log("[boot] running in OFFLINE MODE (embedded local database)");
  } else {
    try {
      await migrate(db, { migrationsFolder: resolveMigrationsFolder() });
      console.log("[boot] database schema up to date");
    } catch (err) {
      console.error("[boot] database migration failed:", err);
      if (env.isProduction) process.exit(1);
      throw err;
    }
  }
  // Grading tables (#3) are editable config seeded with US defaults — insert
  // only the missing crops, never overwriting operator edits.
  try {
    const seeded = await seedGradingDefaults(db);
    if (seeded) console.log("[boot] grading-table defaults seeded");
  } catch (err) {
    console.error("[boot] grading-defaults seed failed (continuing):", err);
  }
  if (!env.SEED_DEMO) {
    console.log("[boot] SEED_DEMO off — skipping demo dataset");
    return;
  }
  try {
    const seeded = await seedIfEmpty();
    if (seeded) console.log("[boot] demo dataset loaded");
  } catch (err) {
    console.error("[boot] demo seed failed (continuing):", err);
  }
}

// ---------------------------------------------------------------------------
// Environment — single typed accessor for process.env. Everything the server
// needs at boot is read once here so the rest of the codebase never touches
// process.env directly (boot.ts reads PORT itself to stay dependency-free).
// ---------------------------------------------------------------------------

const isProduction = process.env.NODE_ENV === "production";

export const env = {
  /** true when NODE_ENV=production (Docker image boots dist/boot.js with it). */
  isProduction,

  /** MySQL connection string, e.g. mysql://grain:pw@mysql:3306/graintracker */
  DATABASE_URL:
    process.env.DATABASE_URL ??
    "mysql://grain:password@localhost:3306/graintracker",

  /**
   * Demo dataset on first boot of an EMPTY database. Dev defaults to on for a
   * usable sandbox; production defaults to off (opt in with SEED_DEMO=true) —
   * fake farmers and pre-filled bins have no place at a real elevator.
   */
  SEED_DEMO:
    process.env.SEED_DEMO != null
      ? process.env.SEED_DEMO !== "false" && process.env.SEED_DEMO !== "0"
      : !isProduction,

  /** Password guarding site administration and farmer/landlord changes. */
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? "grain-admin",

  /**
   * Opt-in to the embedded offline database in production. Without this,
   * production refuses to boot when MySQL is unreachable rather than
   * silently recording tickets to a container-local SQLite file.
   */
  ALLOW_OFFLINE: process.env.ALLOW_OFFLINE === "1",

  /** HTTP port for the production server. */
  PORT: parseInt(process.env.PORT || "3000", 10),
} as const;

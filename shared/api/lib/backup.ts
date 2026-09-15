import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Offline SQLite backups (review P1-14).
//
// The embedded offline database (data/grain-tracker-offline.db) is the ONLY
// copy of the data when the app runs without MySQL, so it gets a simple
// backup story: timestamped copies under data/backups/, keeping the newest N
// (default 7), taken automatically once a day while the server runs
// (startDailyBackup, wired in app/api/boot.ts) and manually via
// `npm run backup` (shared/scripts/backup.mjs). better-sqlite3's online
// backup API is used, so copies are consistent even mid-write.
// ---------------------------------------------------------------------------

export const DEFAULT_RETENTION = 7;

/** The active offline DB file, or null when not file-backed (:memory:). */
export function offlineDbFile(): string | null {
  const override = process.env.GT_OFFLINE_DB_PATH;
  if (override === ":memory:") return null;
  return (
    override ?? path.join(path.resolve(process.cwd(), "data"), "grain-tracker-offline.db")
  );
}

function backupName(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `grain-tracker-offline-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.db`
  );
}

/** Existing backup files for the given source DB, oldest first. */
function listBackups(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /^grain-tracker-offline-\d{8}-\d{6}\.db$/.test(f))
      .sort()
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/**
 * Take one consistent copy of the offline database and prune to `retention`
 * copies. Returns the new backup path, or null when there is no file-backed
 * offline database to back up.
 */
export async function backupOfflineDb(retention = DEFAULT_RETENTION): Promise<string | null> {
  const src = offlineDbFile();
  if (!src || !fs.existsSync(src)) return null;
  const dir = path.join(path.dirname(src), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, backupName(new Date()));

  // Readonly source handle + the online backup API → a consistent copy even
  // while the live connection has the file open in WAL mode.
  const ro = new Database(src, { readonly: true, fileMustExist: true });
  try {
    await ro.backup(dest);
  } finally {
    ro.close();
  }

  // prune oldest beyond retention
  const all = listBackups(dir);
  for (const old of all.slice(0, Math.max(0, all.length - retention))) {
    try {
      fs.unlinkSync(old);
    } catch {
      /* a locked/missing old backup is not worth failing over */
    }
  }
  console.log(`[backup] offline database copied to ${dest} (keeping ${retention})`);
  return dest;
}

/**
 * Once-a-day automatic backup while the server runs: checks hourly, backs up
 * when the newest copy is older than 24 h (or none exists). Unref'd — never
 * keeps the process alive for a backup.
 */
export function startDailyBackup(retention = DEFAULT_RETENTION) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const maybeBackup = () => {
    const src = offlineDbFile();
    if (!src) return;
    const dir = path.join(path.dirname(src), "backups");
    const newest = listBackups(dir).at(-1);
    const newestAge = newest ? Date.now() - fs.statSync(newest).mtimeMs : Infinity;
    if (newestAge >= DAY_MS) {
      backupOfflineDb(retention).catch((err) =>
        console.warn("[backup] scheduled backup failed:", err),
      );
    }
  };
  maybeBackup(); // catch up immediately if the last copy is stale
  const t = setInterval(maybeBackup, 60 * 60 * 1000);
  t.unref?.();
}

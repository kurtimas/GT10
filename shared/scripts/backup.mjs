// Manual offline-database backup (P1-14). The server also backs up daily on
// its own (startDailyBackup in shared/api/lib/backup.ts) — this script is the
// on-demand path: `npm run backup`.
//
// Copies the embedded offline DB (data/grain-tracker-offline.db, or
// GT_OFFLINE_DB_PATH) to <db dir>/backups/ with a timestamp, keeping the
// newest 7. Restore drill: see README.md ("Offline database backups").
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const RETENTION = 7;
const src =
  process.env.GT_OFFLINE_DB_PATH ??
  path.join(path.resolve(process.cwd(), "data"), "grain-tracker-offline.db");

if (src === ":memory:" || !fs.existsSync(src)) {
  console.error(`No offline database file to back up at: ${src}`);
  process.exit(1);
}

const dir = path.join(path.dirname(src), "backups");
fs.mkdirSync(dir, { recursive: true });
const pad = (n) => String(n).padStart(2, "0");
const d = new Date();
const dest = path.join(
  dir,
  `grain-tracker-offline-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.db`,
);

const ro = new Database(src, { readonly: true, fileMustExist: true });
try {
  await ro.backup(dest);
} finally {
  ro.close();
}
console.log(`Backup written: ${dest}`);

const all = fs
  .readdirSync(dir)
  .filter((f) => /^grain-tracker-offline-\d{8}-\d{6}\.db$/.test(f))
  .sort();
for (const old of all.slice(0, Math.max(0, all.length - RETENTION))) {
  fs.unlinkSync(path.join(dir, old));
  console.log(`Pruned old backup: ${old}`);
}
console.log(`Done — keeping the newest ${RETENTION} backup(s) in ${dir}`);

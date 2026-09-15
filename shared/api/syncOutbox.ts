import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Sync outbox (review P1-8) — the app→office EOD push used to fire-and-forget:
// a failed push was logged to sync_log and forgotten until the next manual
// "Sync now". This module adds a small persistent outbox: failed pushes are
// queued to a JSON file and retried by a background worker with exponential
// backoff (1 min → 2 → 4 → … capped at 30 min), honoring Retry-After on 429s.
//
// File-backed (not a DB table) on purpose: the queue must work identically on
// the MySQL and embedded-SQLite paths, and a lost/corrupt file only costs a
// re-push, which the office receiver treats idempotently.
// ---------------------------------------------------------------------------

export type OutboxEntry = {
  id: string;
  siteId: number;
  /** YYYY-MM-DD — the report day the push covers. */
  day: string;
  enqueuedAt: string; // ISO
  attempts: number;
  /** Earliest time the worker may retry (ISO). */
  nextAttemptAt: string;
  lastError: string;
};

export const MAX_ATTEMPTS = 10;
const BASE_DELAY_MS = 60_000;
const MAX_DELAY_MS = 30 * 60_000;

/** Exponential backoff: 1 min × 2^attempts, capped at 30 min. */
export function backoffMs(attempts: number): number {
  const exp = Math.min(Math.max(attempts, 0), 20); // avoid 2**huge
  return Math.min(BASE_DELAY_MS * 2 ** exp, MAX_DELAY_MS);
}

function outboxPath(): string {
  return (
    process.env.GT_SYNC_OUTBOX_PATH ??
    path.join(path.resolve(process.cwd(), "data"), "sync-outbox.json")
  );
}

function loadEntries(): OutboxEntry[] {
  try {
    const raw = fs.readFileSync(outboxPath(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OutboxEntry[]) : [];
  } catch {
    return []; // missing or corrupt file = empty queue (re-push is idempotent)
  }
}

function saveEntries(entries: OutboxEntry[]) {
  const file = outboxPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2));
  fs.renameSync(tmp, file); // atomic-ish: a crash never leaves a half file
}

/** Queue a failed site push for retry. One entry per (siteId, day). */
export function enqueuePush(siteId: number, day: string, error: string, retryAfterMs?: number) {
  const entries = loadEntries();
  const existing = entries.find((e) => e.siteId === siteId && e.day === day);
  const nextAttemptAt = new Date(
    Date.now() + (retryAfterMs ?? backoffMs(existing?.attempts ?? 0)),
  ).toISOString();
  if (existing) {
    existing.lastError = error;
    existing.nextAttemptAt = nextAttemptAt;
  } else {
    entries.push({
      id: `${siteId}:${day}:${Date.now().toString(36)}`,
      siteId,
      day,
      enqueuedAt: new Date().toISOString(),
      attempts: 0,
      nextAttemptAt,
      lastError: error,
    });
  }
  saveEntries(entries);
  console.warn(
    `[sync] push for site ${siteId} (${day}) queued in outbox — retry at ${nextAttemptAt} (${error})`,
  );
}

export type OutboxSummaryEntry = OutboxEntry & {
  /** true once attempts hit MAX_ATTEMPTS — auto-retry stops until manual. */
  dead: boolean;
  dueInMs: number;
};

export function outboxSummary(): { pending: number; entries: OutboxSummaryEntry[] } {
  const now = Date.now();
  const entries = loadEntries().map((e) => ({
    ...e,
    dead: e.attempts >= MAX_ATTEMPTS,
    dueInMs: Math.max(0, new Date(e.nextAttemptAt).getTime() - now),
  }));
  return { pending: entries.length, entries };
}

/** Remove an entry after a successful push (also used by tests). */
export function dequeuePush(id: string) {
  saveEntries(loadEntries().filter((e) => e.id !== id));
}

/** Test hook: point the outbox at a throwaway file. */
export function resetOutboxForTests(file: string) {
  process.env.GT_SYNC_OUTBOX_PATH = file;
  try {
    fs.unlinkSync(file);
  } catch {
    /* absent is fine */
  }
}

// ---------------------------------------------------------------------------
// Worker. The actual push lives in officeSync.ts (pushOneSite); we import it
// lazily inside processOutbox to keep the module cycle one-directional.
// ---------------------------------------------------------------------------

let running = false;

/**
 * Process due outbox entries. With `force`, every entry is treated as due
 * (the manual "retry now" path, including dead entries — attempts reset on
 * success anyway). Never throws; per-entry failures update the entry.
 */
export async function processOutbox(opts?: {
  force?: boolean;
}): Promise<{ attempted: number; succeeded: number; failed: number }> {
  if (running) return { attempted: 0, succeeded: 0, failed: 0 }; // no overlap
  running = true;
  const result = { attempted: 0, succeeded: 0, failed: 0 };
  try {
    const now = Date.now();
    const due = loadEntries().filter(
      (e) =>
        (opts?.force || new Date(e.nextAttemptAt).getTime() <= now) &&
        (opts?.force || e.attempts < MAX_ATTEMPTS),
    );
    if (due.length === 0) return result;
    const { pushOneSite } = await import("./officeSync");
    for (const entry of due) {
      result.attempted += 1;
      entry.attempts += 1;
      try {
        await pushOneSite(entry.siteId, new Date(`${entry.day}T12:00:00`));
        dequeuePush(entry.id);
        result.succeeded += 1;
        console.log(`[sync] outbox push succeeded for site ${entry.siteId} (${entry.day})`);
      } catch (err) {
        const e = err as Error & { retryAfterMs?: number };
        entry.lastError = e.message ?? String(err);
        entry.nextAttemptAt = new Date(
          Date.now() + (e.retryAfterMs ?? backoffMs(entry.attempts)),
        ).toISOString();
        saveEntries(loadEntries().map((x) => (x.id === entry.id ? entry : x)));
        result.failed += 1;
        console.warn(
          `[sync] outbox retry failed for site ${entry.siteId} (${entry.day}), ` +
            `attempt ${entry.attempts}/${MAX_ATTEMPTS}: ${entry.lastError}`,
        );
      }
    }
    return result;
  } finally {
    running = false;
  }
}

let worker: ReturnType<typeof setInterval> | null = null;

/** Start the background retry worker (once per process). No tight loop: one
 * sweep per minute, and each entry is only retried once its backoff elapses. */
export function startOutboxWorker(intervalMs = 60_000) {
  if (worker) return;
  worker = setInterval(() => {
    processOutbox().catch((err) => console.warn("[sync] outbox sweep failed:", err));
  }, intervalMs);
  worker.unref?.(); // never hold the process open for the queue
}

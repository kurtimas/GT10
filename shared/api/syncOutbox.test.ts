import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Sync outbox tests (P1-8): backoff math, enqueue-on-failure, and the retry
// worker flushing against a fake office server. Runs the REAL push path
// (officeSync.pushOneSite) against the real (offline, in-memory) database and
// a real loopback HTTP endpoint standing in for the office portal.
// ---------------------------------------------------------------------------
process.env.GT_FORCE_OFFLINE = "1";
process.env.GT_OFFLINE_DB_PATH = ":memory:";
const OUTBOX_FILE = path.join(
  os.tmpdir(),
  `gt-sync-outbox-test-${process.pid}-${Date.now()}.json`,
);
process.env.GT_SYNC_OUTBOX_PATH = OUTBOX_FILE;

type Behavior =
  | { kind: "ok" }
  | { kind: "fail"; status: number; retryAfter?: string };

let behavior: Behavior = { kind: "fail", status: 500 };
let server: http.Server;
let officeUrl: string;
let requestsSeen = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
let schema: typeof import("../db/schema");
let outbox: typeof import("./syncOutbox");
let sync: typeof import("./officeSync");
let siteId: number;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/api/sync/eod" && req.method === "POST") {
      requestsSeen += 1;
      // drain the body so the request completes
      req.on("data", () => {});
      req.on("end", () => {
        if (behavior.kind === "ok") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ sheets: 0, loads: 0 }));
        } else {
          const headers: Record<string, string> = {};
          if (behavior.retryAfter) headers["retry-after"] = behavior.retryAfter;
          res.writeHead(behavior.status, headers);
          res.end("nope");
        }
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  officeUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const conn = await import("./queries/connection");
  await conn.initDb();
  db = conn.getDb();
  schema = await import("../db/schema");
  outbox = await import("./syncOutbox");
  sync = await import("./officeSync");

  const [{ id }] = await db
    .insert(schema.sites)
    .values({ name: "Outbox Site", location: null })
    .$returningId();
  siteId = id;
  await sync.setSetting(db, "officeUrl", officeUrl);
  await sync.setSetting(db, "officeKey", "test-key");
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("backoffMs", () => {
  it("doubles from 1 minute and caps at 30 minutes", () => {
    expect(outbox.backoffMs(0)).toBe(60_000);
    expect(outbox.backoffMs(1)).toBe(120_000);
    expect(outbox.backoffMs(2)).toBe(240_000);
    expect(outbox.backoffMs(4)).toBe(60_000 * 16); // still uncapped
    expect(outbox.backoffMs(5)).toBe(30 * 60_000); // capped
    expect(outbox.backoffMs(50)).toBe(30 * 60_000); // no overflow
  });
});

describe("outbox lifecycle", () => {
  it("enqueues a failed push, honors Retry-After, and flushes on recovery", async () => {
    // 1. office is down → pushEod fails and the push lands in the outbox
    behavior = { kind: "fail", status: 429, retryAfter: "120" };
    const result = await sync.pushEod(new Date("2025-10-01T12:00:00"));
    expect(result.ok).toBe(false);
    const summary = outbox.outboxSummary();
    expect(summary.pending).toBe(1);
    expect(summary.entries[0].siteId).toBe(siteId);
    expect(summary.entries[0].day).toBe("2025-10-01");
    // Retry-After: 120 → next attempt ~2 minutes out, not the 1-min base
    const dueInMs = new Date(summary.entries[0].nextAttemptAt).getTime() - Date.now();
    expect(dueInMs).toBeGreaterThan(100_000);
    expect(dueInMs).toBeLessThan(125_000);
    // failed push never advances the cursor
    expect(await sync.getSetting(db, `lastPushAt:site:${siteId}`)).toBe("");

    // 2. not due yet (and not forced) → the worker leaves it alone
    const before = requestsSeen;
    const skipped = await outbox.processOutbox();
    expect(skipped.attempted).toBe(0);
    expect(requestsSeen).toBe(before);

    // 3. office recovers → a forced/manual retry flushes the queue and
    //    advances the per-site cursor
    behavior = { kind: "ok" };
    const flushed = await outbox.processOutbox({ force: true });
    expect(flushed).toEqual({ attempted: 1, succeeded: 1, failed: 0 });
    expect(outbox.outboxSummary().pending).toBe(0);
    expect(await sync.getSetting(db, `lastPushAt:site:${siteId}`)).not.toBe("");
  });

  it("dead entries stop auto-retrying but flush on manual retry", async () => {
    behavior = { kind: "fail", status: 500 };
    const r = await sync.pushEod(new Date("2025-10-02T12:00:00"));
    expect(r.ok).toBe(false);
    // burn through the attempt budget with forced retries
    for (let i = 0; i < outbox.MAX_ATTEMPTS; i++) {
      await outbox.processOutbox({ force: true });
    }
    const dead = outbox.outboxSummary();
    expect(dead.pending).toBe(1);
    expect(dead.entries[0].dead).toBe(true);
    // auto sweep skips dead entries even when due
    const sweep = await outbox.processOutbox();
    expect(sweep.attempted).toBe(0);
    // manual "retry now" still tries, and succeeds once the office is back
    behavior = { kind: "ok" };
    const manual = await outbox.processOutbox({ force: true });
    expect(manual.succeeded).toBe(1);
    expect(outbox.outboxSummary().pending).toBe(0);
  });
});

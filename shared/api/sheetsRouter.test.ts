import { beforeAll, describe, expect, it } from "vitest";
import { like } from "drizzle-orm";
import type { TrpcContext } from "./context";

// ---------------------------------------------------------------------------
// Router-level regression test for the sheet-create unique race: the create
// flow used to insert every sheet with ticketNo "PENDING" and then update it,
// so two terminals creating within the same window collided on the unique
// ticketNo index. These tests run the REAL router against the real (offline,
// in-memory) database — set the force-offline knobs BEFORE any connection
// module is imported.
// ---------------------------------------------------------------------------
process.env.GT_FORCE_OFFLINE = "1";
process.env.GT_OFFLINE_DB_PATH = ":memory:";

type Connection = typeof import("./queries/connection");
type SheetsRouter = typeof import("./sheetsRouter").sheetsRouter;

let db: ReturnType<Connection["getDb"]>;
let caller: ReturnType<SheetsRouter["createCaller"]>;
let siteId: number;
let lotId: number;

beforeAll(async () => {
  const conn: Connection = await import("./queries/connection");
  await conn.initDb();
  db = conn.getDb();
  const { sites, farmers, lots } = await import("../db/schema");
  const [{ id: sid }] = await db
    .insert(sites)
    .values({ name: "Test Site", location: null })
    .$returningId();
  siteId = sid;
  const [{ id: fid }] = await db
    .insert(farmers)
    .values({ name: "Test Farmer", phone: null, email: null })
    .$returningId();
  const [{ id: lid }] = await db
    .insert(lots)
    .values({ farmerId: fid, landlordId: null, code: "TEST-LOT-01", crop: "CORN" })
    .$returningId();
  lotId = lid;
  const { sheetsRouter } = await import("./sheetsRouter");
  // The create mutation never touches the request context.
  caller = sheetsRouter.createCaller({} as unknown as TrpcContext);
});

describe("sheets.create ticket-number allocation", () => {
  it("assigns sequential T-<id> ticket numbers", async () => {
    const a = await caller.create({ siteId, lotId });
    const b = await caller.create({ siteId, lotId });
    expect(a.ticketNo).toBe(`T-${String(a.id).padStart(5, "0")}`);
    expect(b.ticketNo).toBe(`T-${String(b.id).padStart(5, "0")}`);
    expect(a.ticketNo).not.toBe(b.ticketNo);
  });

  it("two terminals creating simultaneously cannot collide on the unique ticketNo", async () => {
    // With the old "PENDING" insert-then-update, the second of these inserts
    // hit the unique ticketNo index before the first could be renamed.
    const results = await Promise.all(
      Array.from({ length: 8 }, () => caller.create({ siteId, lotId })),
    );
    const tickets = results.map((r) => r.ticketNo);
    expect(new Set(tickets).size).toBe(results.length);
    for (const t of tickets) expect(t).toMatch(/^T-\d{5}$/);

    // …and no placeholder rows are stranded in the archive.
    const { weightSheets } = await import("../db/schema");
    const leftovers = await db
      .select()
      .from(weightSheets)
      .where(like(weightSheets.ticketNo, "P-%"));
    expect(leftovers).toHaveLength(0);
  });
});

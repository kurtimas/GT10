import { z } from "zod";
import { desc } from "drizzle-orm";
import { createRouter, publicQuery } from "@shared/api/middleware";
import { getDb } from "@shared/api/queries/connection";
import { syncLog, sites } from "@db/schema";
import { assertAdmin } from "@shared/api/lib/adminPassword";
import { getSetting, setSetting, syncNow } from "@shared/api/officeSync";

// ---------------------------------------------------------------------------
// Main-office sync — settings (portal URL + shared key), status log, and the
// manual "Sync now" action (pull people/lots from office, push today's data).
// ---------------------------------------------------------------------------

/** Parse a "YYYY-MM-DD" as local midnight (see sheetsRouter.parseDay). */
function parseDay(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
    return new Date(y, m - 1, d);
  }
  return new Date(s);
}

export const syncRouter = createRouter({
  // The shared key itself is never returned — it can push the whole site's
  // data set to whatever URL it is paired with, so it stays server-side.
  getSettings: publicQuery.query(async () => {
    const db = getDb();
    return {
      officeUrl: await getSetting(db, "officeUrl"),
      officeKeySet: (await getSetting(db, "officeKey")).trim() !== "",
    };
  }),

  setSettings: publicQuery
    .input(
      z.object({
        adminPassword: z.string(),
        officeUrl: z.string(),
        // omit to keep the existing key; empty string clears it
        officeKey: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      assertAdmin(input.adminPassword);
      const db = getDb();
      await setSetting(db, "officeUrl", input.officeUrl.trim());
      if (input.officeKey !== undefined) {
        await setSetting(db, "officeKey", input.officeKey.trim());
      }
      return { ok: true };
    }),

  status: publicQuery.query(async () => {
    const rows = await getDb()
      .select()
      .from(syncLog)
      .orderBy(desc(syncLog.createdAt))
      .limit(12);
    return rows;
  }),

  syncNow: publicQuery
    .input(z.object({ date: z.string().optional() }).optional())
    .mutation(async ({ input }) => {
      const day = input?.date ? parseDay(input.date) : new Date();
      return syncNow(day);
    }),

  // Sync outbox (P1-8): failed pushes waiting for automatic retry. The UI
  // polls this to show the pending count; retryNow is the manual path.
  outboxStatus: publicQuery.query(async () => {
    const { outboxSummary } = await import("@shared/api/syncOutbox");
    const summary = outboxSummary();
    // resolve site names for display (tiny table)
    const db = getDb();
    const siteRows = await db.select({ id: sites.id, name: sites.name }).from(sites);
    const nameById = new Map(siteRows.map((s) => [s.id, s.name]));
    return {
      pending: summary.pending,
      entries: summary.entries.map((e) => ({
        ...e,
        siteName: nameById.get(e.siteId) ?? `site ${e.siteId}`,
      })),
    };
  }),

  retryOutbox: publicQuery.mutation(async () => {
    const { processOutbox } = await import("@shared/api/syncOutbox");
    return processOutbox({ force: true });
  }),
});

export type SyncRouter = typeof syncRouter;

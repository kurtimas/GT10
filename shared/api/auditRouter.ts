import { z } from "zod";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { auditLog } from "../db/schema";

// ---------------------------------------------------------------------------
// Read-only audit trail query (Phase 4) — mounted in BOTH the plant app and
// the office portal so the mirrored trail can be browsed from either side.
// Filters: entityType / entityId / created date range; offset pagination.
// ---------------------------------------------------------------------------

/** Parse a "YYYY-MM-DD" filter as local midnight (see sheetsRouter.parseDay). */
function parseDay(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
    return new Date(y, m - 1, d);
  }
  return new Date(s);
}

export const auditRouter = createRouter({
  list: publicQuery
    .input(
      z
        .object({
          entityType: z.string().optional(),
          entityId: z.number().optional(),
          dateFrom: z.string().optional(), // YYYY-MM-DD
          dateTo: z.string().optional(),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conds = [];
      if (input?.entityType) conds.push(eq(auditLog.entityType, input.entityType));
      if (input?.entityId != null) conds.push(eq(auditLog.entityId, input.entityId));
      if (input?.dateFrom) {
        conds.push(gte(auditLog.createdAt, parseDay(input.dateFrom)));
      }
      if (input?.dateTo) {
        const to = parseDay(input.dateTo);
        to.setHours(23, 59, 59, 999);
        conds.push(lte(auditLog.createdAt, to));
      }
      const where = conds.length ? and(...conds) : undefined;
      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;

      const rows = await db
        .select()
        .from(auditLog)
        .where(where)
        .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
        .limit(limit + 1) // one extra row tells us whether another page exists
        .offset(offset);
      const [{ count }] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(auditLog)
        .where(where);

      return {
        rows: rows.slice(0, limit),
        total: Number(count),
        hasMore: rows.length > limit,
        offset,
        limit,
      };
    }),
});

export type AuditRouter = typeof auditRouter;

import { getDb } from "../queries/connection";
import { auditLog } from "../../db/schema";

// ---------------------------------------------------------------------------
// Generic audit-trail writer (audit_log, Phase 4). Every mutating router
// procedure records who did what to which entity, with before/after JSON
// snapshots. Rows are append-only and survive changes to the entities they
// describe (entityId has no FK by design).
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof getDb>;
/** An open transaction on the shared db handle (same shape routers use). */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type AuditAction = "create" | "update" | "void" | "adjust";

export type AuditEntry = {
  /** operator name from the request context; defaults to 'system' */
  actor?: string | null;
  action: AuditAction;
  /** table/entity name, e.g. 'load', 'weight_sheet', 'bin', 'shipment' */
  entityType: string;
  entityId: number;
  /** snapshot before the change (any JSON-serializable value) */
  before?: unknown;
  /** snapshot after the change */
  after?: unknown;
  note?: string | null;
};

const toJson = (v: unknown): string | null =>
  v === undefined || v === null ? null : JSON.stringify(v);

/** Write one audit_log row. Safe to call inside a transaction (pass tx). */
export async function writeAudit(db: Db | Tx, entry: AuditEntry) {
  await db.insert(auditLog).values({
    actor: entry.actor?.trim() || "system",
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    beforeJson: toJson(entry.before),
    afterJson: toJson(entry.after),
    note: entry.note ?? null,
  });
}

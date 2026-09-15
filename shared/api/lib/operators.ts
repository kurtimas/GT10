import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { settings } from "../../db/schema";

// ---------------------------------------------------------------------------
// Operator identity (review P1-7, Phase 4) — attribution, NOT auth.
//
// The managed operator list lives in the settings table ("operators" key, a
// JSON array of names) and is maintained from the People page (admin-gated).
// A terminal picks its current operator in the app header; the choice is
// stored in localStorage and sent with every tRPC call as the
// `x-gt-operator` header. Mutations record it on bin_movements.operator and
// audit_log.actor.
//
// Validation rule: once at least one operator is configured, a mutation that
// arrives with an operator name NOT on the list is rejected — the audit
// trail must never carry identities nobody manages. While the list is empty
// (fresh install, nothing configured yet) any name is accepted so existing
// terminals keep working until the list is set up.
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const SETTINGS_KEY = "operators";

/** The managed operator names, in the order they were added. */
export async function listOperators(db: Db | Tx): Promise<string[]> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, SETTINGS_KEY) });
  if (!row?.value) return [];
  try {
    const parsed: unknown = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is string => typeof n === "string" && n.trim() !== "");
  } catch {
    return [];
  }
}

/** Replace the managed operator list (deduped, trimmed, case-insensitively). */
export async function saveOperators(db: Db | Tx, names: string[]) {
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    clean.push(name);
  }
  const value = JSON.stringify(clean);
  const existing = await db.query.settings.findFirst({ where: eq(settings.key, SETTINGS_KEY) });
  if (existing) {
    await db.update(settings).set({ value }).where(eq(settings.key, SETTINGS_KEY));
  } else {
    await db.insert(settings).values({ key: SETTINGS_KEY, value });
  }
}

/**
 * Resolve the operator name sent with a request to the canonical managed
 * name, or null when the request carried none. Throws when a list is
 * configured and the name is not on it. Matching is case-insensitive; the
 * canonical (managed) spelling is returned.
 */
export async function resolveOperator(
  db: Db | Tx,
  raw: string | null | undefined,
): Promise<string | null> {
  const name = raw?.trim();
  if (!name) return null;
  const managed = await listOperators(db);
  if (managed.length === 0) return name; // list not configured yet — accept
  const match = managed.find((m) => m.toLowerCase() === name.toLowerCase());
  if (!match) {
    throw new Error(
      `Operator "${name}" is not on the operators list — add them on the Farmers & Lots page first.`,
    );
  }
  return match;
}

// ---------------------------------------------------------------------------
// Per-terminal "current operator" (Phase 4) — attribution, NOT auth.
// The pick is stored in localStorage and sent with every tRPC call as the
// `x-gt-operator` header (see shared/src/providers/trpc.tsx); the server
// validates it against the managed operators list and records it on
// bin_movements / shipments / audit_log rows.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "gt.operator";

export function getCurrentOperator(): string {
  if (typeof localStorage === "undefined") return "";
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setCurrentOperator(name: string) {
  if (typeof localStorage === "undefined") return;
  try {
    if (name.trim()) {
      localStorage.setItem(STORAGE_KEY, name.trim());
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* storage unavailable (private mode) — the pick just won't persist */
  }
}

import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "./env";

// --- Admin password (guards administrative mutations) ----------------------
// Verified server-side against ADMIN_PASSWORD; the client sends it in the
// POST body of each guarded mutation (never as a query param).
//
// GATE OPEN BY DEFAULT (owner request, "for now"): when ADMIN_PASSWORD is
// unset OR left at the default "grain-admin", admin mutations are allowed
// WITHOUT a password — the gate is open and a boot warning says so. Setting
// ADMIN_PASSWORD to any non-default value re-enables the gate with no code
// change.
export const DEFAULT_ADMIN_PASSWORD = "grain-admin";

const adminHash = () => createHash("sha256").update(env.ADMIN_PASSWORD).digest();

// --- Brute-force guard ------------------------------------------------------
// admin.verify and every assertAdmin call are an oracle for the password; cap
// failed attempts in a rolling window so it can't be guessed offline-speed.
// (Only relevant while the gate is closed — see adminGateOpen.)
const VERIFY_WINDOW_MS = 60_000;
const VERIFY_MAX_FAILURES = 5;
let verifyFailures: number[] = [];

/** true when the admin gate is OPEN (no password required for admin mutations). */
export function adminGateOpen(): boolean {
  return env.ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD;
}

/** @deprecated use adminGateOpen() — kept for existing call-sites. */
export function usingDefaultAdminPassword(): boolean {
  return adminGateOpen();
}

export function verifyAdminPassword(given: string): boolean {
  if (adminGateOpen()) return true; // gate open — nothing to verify
  const cutoff = Date.now() - VERIFY_WINDOW_MS;
  verifyFailures = verifyFailures.filter((t) => t > cutoff);
  if (verifyFailures.length >= VERIFY_MAX_FAILURES) {
    throw new Error("Too many admin password attempts — wait a minute and try again");
  }
  const h = createHash("sha256").update(given).digest();
  const ok = h.length === adminHash().length && timingSafeEqual(h, adminHash());
  if (!ok) verifyFailures.push(Date.now());
  return ok;
}

export function assertAdmin(given: string | undefined): void {
  if (adminGateOpen()) return; // gate open — admin mutations are unauthenticated
  if (!given || !verifyAdminPassword(given)) {
    throw new Error("Admin password required");
  }
}

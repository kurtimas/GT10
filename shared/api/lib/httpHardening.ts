import type { MiddlewareHandler } from "hono";

// ---------------------------------------------------------------------------
// HTTP hardening (review P1-12), shared by the app and office servers.
//
// securityHeaders — a CSP-friendly baseline for a same-origin React + tRPC
// app. Neither server sets any CORS headers, so cross-origin XHR is already
// refused by the browser default (same-origin) — deliberately NOT wide open,
// nothing to configure. Style needs 'unsafe-inline' (React inline styles);
// scripts stay 'self' (Vite emits module scripts from the same origin).
//
// simpleBodyLimit — rejects over-large requests by their declared
// Content-Length WITHOUT touching the request body. This replaces
// hono/body-limit, whose body inspection crashes on the office dev server
// (undici/Node-24 vs @hono/vite-dev-server: "Cannot read private member
// #state"), which turned a wrong sync key into a 500 instead of the designed
// 401 — the request now reaches auth normally (Phase 4 quirk, fixed).
// ---------------------------------------------------------------------------

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  );
};

/** 413 for requests whose declared Content-Length exceeds maxBytes. */
export function simpleBodyLimit(maxBytes: number): MiddlewareHandler {
  return async (c, next) => {
    const declared = Number(c.req.header("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      return c.json({ error: `request body too large (limit ${maxBytes} bytes)` }, 413);
    }
    await next();
  };
}

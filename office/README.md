# Grain Tracker — main-office portal

The office-side companion to the scale-house app (`../app`). Scale houses
push their end-of-day packages here over HTTP (shared `x-gt-sync-key`
secret; receiver in `api/syncReceiver.ts`), and the portal mirrors
farmers/landlords/lots and each site's sheets, loads, and bin levels.

Same stack as `app/` (React 19 + Vite frontend, Hono + tRPC + Drizzle
backend). The office mounts only the `office` tRPC router (per-site
overview, today's loads, EOD upload history) plus `ping` and the
`/api/sync` receiver — the plant write routers (`core` / `people` /
`sheets`) are deliberately NOT mounted here, so mirrored data can only be
written through the keyed sync receiver.

## Sync authentication

The receiver authenticates inbound syncs with the `x-gt-sync-key` header,
compared (timing-safe) against the `SYNC_KEY` environment variable. This
check is **fail-closed**: if `SYNC_KEY` is unset or empty the receiver
refuses ALL sync requests with `503` (in every environment, dev included)
and logs a loud boot warning — there is no unauthenticated mode. A wrong
key gets `401`. Set the same key in each scale house's sync settings
(stored server-side as the `officeKey` setting, never returned by the API).

## What the UI has today

- `/` — office home: today's totals across sites, per-site bin levels and
  last-upload times, and the end-of-day report history table.

## Not built yet

Management pages for the mirrored data (sheets archive, bins, people/lots,
reports drill-down) are not implemented — the mirrored rows are only
readable through the home-page overview queries today.

## Commands

```bash
npm run dev      # Vite dev server (embedded SQLite when MySQL is absent)
npm run check    # typecheck
npm run test     # vitest unit tests
npm run build    # client + server bundles → dist/
npm start        # production server on :3000 (NODE_ENV=production)
npm run smoke    # end-to-end tRPC smoke test against a running server
```

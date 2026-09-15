# Grain Tracker — scale-house app

The elevator-side application: truck scale capture (Web Serial, simulator,
or manual entry), multi-load weight sheets, bin inventory, people and lots,
daily reports with end-of-day close, and optional sync to the office portal
(`../office`).

## Stack

React 19 + TypeScript + Vite + Tailwind + shadcn/ui on the frontend;
Hono + tRPC v11 + Drizzle on the backend (MySQL in production, embedded
better-sqlite3 as a dev fallback). One `npm run build` produces
`dist/boot.js` (server, esbuild) + `dist/public` (client, Vite).

## Shape

- `api/` — tRPC routers: `core` (sites/bins/admin), `people`
  (farmers/landlords/lots), `sheets` (the weigh state machine, reports,
  EOD close), `sync` (office portal settings + push/pull). Static serving
  and boot in `api/boot.ts`; DB layer in `api/queries/connection.ts`.
- `db/` — Drizzle schema (MySQL), SQLite mirror, migrations, demo seed.
- `contracts/` — shared client/server logic: bushels/shrink math,
  lot codes, row types, error shapes.
- `src/` — pages (`Dashboard`, `Scale`, `Sheets`, `Bins`, `People`,
  `Reports`), the `useScale` Web Serial hook, tRPC provider.

## Commands

```bash
npm run dev      # Vite dev server (embedded SQLite when MySQL is absent)
npm run check    # typecheck
npm run test     # vitest unit tests (bushels/shrink, lot codes)
npm run build    # client + server bundles → dist/
npm start        # production server on :3000 (NODE_ENV=production)
npm run smoke    # end-to-end tRPC smoke test against a running server
```

## Operational rules baked in

- A load needs a truck ID at weigh-in (tare memory and duplicate checks
  key on it); the server enforces it.
- Weigh-in/weigh-out run in transactions backed by a unique
  `(sheetId, loadNo)` index; bin inventory moves via atomic SQL deltas.
- Sheets and days cannot be closed while a truck is mid-weigh.
- Closing a lot closes its OPEN weight sheets (`closeReason: LOT_CLOSED`,
  refused while a truck is mid-weigh) and the mutation reports which
  sheets were closed; reopening the lot is allowed.
- The admin password gate (OPEN while `ADMIN_PASSWORD` is unset or the
  default `grain-admin`; a boot warning says so — set a non-default value
  to close it) covers: site admin, **editing an existing farmer**,
  bin create/edit/adjust, **changing or voiding loads on a CLOSED
  ticket**, and sync settings. Day-to-day work — adding farmers, lots
  and sheets, weighing, closing lots — needs no password.
- Production refuses to boot when MySQL is unreachable (opt into the
  embedded database with `ALLOW_OFFLINE=1`), aborts on failed migrations,
  and never seeds demo data unless `SEED_DEMO=true`.
- Date filters parse as local dates and day boundaries follow `TZ`.

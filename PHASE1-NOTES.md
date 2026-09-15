# Phase 1 — De-duplication of `app/` and `office/`

**Mechanism chosen:** npm workspaces (root `package.json` with `workspaces: ["app", "office"]`)
**plus** a top-level `shared/` tree imported via tsconfig/vite/vitest aliases — i.e. option (b)
with the alias style of option (a). Workspaces were necessary, not just nice: with `shared/`
outside either app, bare package imports (`drizzle-orm`, `react`, …) from shared files only
resolve if `node_modules` is hoisted to the repo root — otherwise tsc, Vite, and esbuild all
fail to resolve them (verified during the port).

Commits: `8b08976` baseline (pre-dedup), `bd4c13f` the dedup.

## What moved where

All files below were byte-identical in `app/` and `office/`; each now exists exactly once:

| Now in | Files |
|---|---|
| `shared/contracts/` | `grain.ts`, `lotCode.ts`, `types.ts`, `errors.ts`, `grain.test.ts`, `lotCode.test.ts` |
| `shared/db/` | `schema.ts`, `sqliteSchema.ts`, `relations.ts`, `migrations/` (both .sql + meta) |
| `shared/api/` | `context.ts`, `middleware.ts`, `migrateOnBoot.ts`, `coreRouter.ts`, `peopleRouter.ts`, `sheetsRouter.ts`, `officeSync.ts`, `lib/{adminPassword,env,vite}.ts`, `queries/connection.ts` |
| `shared/src/` | `components/ui/*.tsx` (15 shadcn files), `lib/utils.ts`, `lib/trpc.ts`, `providers/trpc.tsx`, `pages/NotFound.tsx`, `App.css`, `index.css` |
| `shared/scripts/` | `smoke.mjs` |
| repo root | single `package-lock.json` (the two per-app locks were byte-identical) |

Import wiring:

- **Inside `shared/`** everything imports relatively — no alias needed, so esbuild's
  per-file tsconfig discovery never comes into play there.
- **Per-app → shared** via aliases configured identically in each app's `tsconfig.json`,
  `tsconfig.app.json`, `tsconfig.server.json`, `vite.config.ts`, `vitest.config.ts`:
  `@shared/* → ../shared/*`, `@db/* → ../shared/db/*`, `@contracts/* → ../shared/contracts/*`,
  `@api/* → ./api/*`, `@/* → ./src/*` (unchanged, app-local code only).
- Two deliberate per-app injection points:
  1. `shared/api/migrateOnBoot.ts` now takes `seedIfEmpty` as a parameter — the demo
     datasets differ per deployment, so `db/seed.ts` became `app/api/seed.ts` and
     `office/api/seed.ts` and each `api/boot.ts` injects its own.
  2. `shared/src/lib/trpc.ts` gets the router type via `import type { AppRouter } from
     "@api/router"` — each frontend keeps its own `AppRouter` type (type-only import;
     erased before bundlers see it).

## What was REMOVED from office (dead weight)

- `office/api/router.ts` no longer mounts `core`, `people`, `sheets` — the office UI is one
  page (`OfficeHome.tsx`) and only calls `office.overview`, `office.todayLoads`,
  `office.eodReports`, and `ping` (verified by reading every `trpc.*` call in `office/src`).
  Mirrored data is written only through the keyed `api/syncReceiver.ts`. Runtime-verified:
  `sheets.list` now returns `NOT_FOUND` on the office server. This also closes the review's
  "office mounts the full unauthenticated sheets mutation surface" attack surface (3.1/6)
  and removes office's dead `pushEod` path (`officeSync` is only bundled into `app` now).

## Intentionally NOT deduped (and why)

- **`api/router.ts`, `api/boot.ts`** — genuinely different per deployment (office adds the
  sync receiver, app adds the sync router + admin-password warning).
- **`api/seed.ts`** — different demo datasets (office seeds two sites + EOD history).
- **`api/syncRouter.ts` (app-only) / `api/officeRouter.ts`, `api/syncReceiver.ts` (office-only)**
  — per-deployment API surfaces.
- **`index.html`, `src/App.tsx`, `src/main.tsx`, app pages/components/hooks vs office's
  `OfficeLayout`/`OfficeHome`** — different UIs.
- **`package.json`** — different package names/scripts ownership; now workspace members.
- **Tool-mandated per-app config files** (`tsconfig*.json`, `vite.config.ts`,
  `vitest.config.ts`, `tailwind.config.js`, `postcss.config.js`, `eslint.config.js`,
  `drizzle.config.ts`, `components.json`, `Dockerfile`) — each tool only discovers these in
  the app root; their *contents* are near-identical twins updated in lockstep.
- **`app/.superdesign/`, `gt-rebuild/`, triple install scripts** — stale scaffolding the
  review flags (1.3); left untouched as out of scope for Phase 1.

## Commands

Install (once, at repo root — workspaces hoist `node_modules` to the root):

```bash
npm install
```

Per app (run from `app/` or `office/` — or use root scripts `npm run build:app`, etc.):

```bash
npm run dev     # vite dev server (frontend + API) on :3000
npm test        # vitest — 21/21 passing in each app
npm run check   # tsc -b typecheck
npm run build   # vite build + esbuild API bundle -> dist/boot.js
npm start       # NODE_ENV=production node dist/boot.js
npm run smoke   # shared/scripts/smoke.mjs against a running server
```

Docker (context is now the **repo root**, was the app dir):

```bash
docker build -f app/Dockerfile .      # plant/elevator instance
docker build -f office/Dockerfile .   # office portal
```

## Notes / follow-ups for later phases

- Production boot intentionally refuses to start without MySQL unless `ALLOW_OFFLINE=1`
  (pre-existing fail-closed behavior; observed while smoke-testing `dist/boot.js`).
- `migrateOnBoot` resolves migrations from `../shared/db/migrations` (repo + new Docker
  layout) with legacy `./db/migrations` fallback.
- The office README still claims auth behaviors that don't match the code (review 4.4) —
  docs fix belongs to the security phase.
- No CI exists (`.github/workflows/docker-image.yml` contains a Dockerfile, not a
  workflow) — wiring `npm run check`/`npm test` into CI is a later-phase item.

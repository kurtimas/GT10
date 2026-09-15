# Phase 2 — P0 security & sync fixes

Follows PHASE1-NOTES.md (dedup). All line references are to the current
post-dedup layout (`shared/`, `app/`, `office/`).

Verified: `npm run check`, `npm test` (23/23, includes the new race
regression test), and `npm run build` pass in BOTH `app/` and `office/`.
Both dev servers were booted, `/api/health` returned `{"ok":true}` on each,
and the office receiver returned 503/401/500 exactly as designed (below).
Nothing was left running.

## 1. Office sync receiver lockdown (review 4.4 / 8.3 — P0)

- `office/api/syncReceiver.ts` — the receiver is now **fail-closed**: when
  `SYNC_KEY` is unset/empty it REFUSES every sync request with **503** and a
  clear message, in every environment (the old code accepted everything with
  a one-time console warning). The key comparison is now timing-safe
  (sha256 + `crypto.timingSafeEqual`; was `===`). Wrong key → 401.
- `office/api/boot.ts` — logs a loud boot warning whenever `SYNC_KEY` is
  missing so the misconfiguration is visible before the first 503.
- Docs: `office/README.md` no longer claims the key is "matched against the
  `officeKey` setting" (false — it is the `SYNC_KEY` env var) and no longer
  lists `core`/`people`/`sheets` as mounted office routers (removed in
  Phase 1). Root `README.md` gained a `SYNC_KEY` env-table row.
- Deploy scripts: `gtv8-vps-setup.sh` now generates `SYNC_KEY`
  (`openssl rand -hex 32`) into `/opt/gtv9-deploy/.env`, prints it once, and
  backfills it into pre-existing `.env` files on re-run.
  `gt-rebuild/repo/gtv8-vps-setup.sh` (stale copy, but it still provisions a
  deploy `.env`) got the same generation. Neither script deploys an office
  service — the office typically runs elsewhere; the printed key plus the
  install-guide note cover provisioning.
- `Grain-Tracker-Install-Guide.md` — Part 4 now tells the operator to save
  the printed `SYNC_KEY`, the cheat-sheet shows how to find it, and a new
  troubleshooting row covers "sync fails with 503".

## 2. Sheet-create race on `ticketNo = "PENDING"` (review 3.2 / 8.1 — P0)

- `shared/api/sheetsRouter.ts` (`sheets.create`) — the insert-then-update
  pattern that inserted the literal `"PENDING"` (globally unique column) is
  gone. The placeholder is now unique per attempt (`P-<uuid29>`) and the real
  `T-<id>` ticket number is assigned inside the SAME transaction — two
  terminals creating simultaneously can no longer collide, and a crash can
  no longer strand a `PENDING` row.
- Regression test: `shared/api/sheetsRouter.test.ts` runs the REAL router
  against the real (in-memory, offline) database — sequential ticket
  numbering, plus 8 concurrent `create` calls asserting distinct `T-XXXXX`
  tickets and zero stranded placeholder rows. (Under the old code the second
  concurrent insert deterministically hit the unique index.)
- Test support: `shared/api/queries/connection.ts` gained two opt-in env
  knobs — `GT_FORCE_OFFLINE=1` (skip the ~30 s MySQL probe) and
  `GT_OFFLINE_DB_PATH` (e.g. `:memory:`). Neither changes default behavior.

## 3. Sync correctness (review 4.1 / 4.2 — P0/P1)

- 3a. Re-push of changed sheets — `shared/api/officeSync.ts`:
  `buildEodPackage` now takes a `changedSince` cursor and the sheet
  selection is `created-that-day OR status=OPEN OR closedAt >= cursor OR
  has-loads-created-since-cursor`. The cursor is a per-site setting
  (`lastPushAt:site:<id>`) captured BEFORE the package is built and advanced
  only after that site's push succeeds — a sheet opened yesterday and closed
  today (previously mirrored OPEN forever) is now included in today's
  package, a failed push never skips changed sheets, and re-uploads stay
  idempotent on the receiver.
- 3b. Transactional receive — `office/api/syncReceiver.ts`: the entire
  `receiveEod` import (site → people/lots → bins → sheets/loads rebuild →
  EOD totals) runs in ONE transaction; a mid-package failure rolls back
  instead of leaving a sheet mirrored with zero loads. The app's pull side
  (`pullPeople` in `shared/api/officeSync.ts`) got the same treatment. Both
  work on MySQL and on the offline SQLite path (its async-transaction shim
  serializes BEGIN/COMMIT/ROLLBACK).

## 4. Admin password gate open "for now" (owner request)

- `shared/api/lib/adminPassword.ts` — new `adminGateOpen()`: true when
  `ADMIN_PASSWORD` is unset OR equals the default `grain-admin`. While open,
  `assertAdmin()` is a no-op and `admin.verify` returns ok. Setting
  `ADMIN_PASSWORD` to any non-default value re-enables full enforcement
  (including the brute-force cap) with no code change.
  **To re-enable:** set `ADMIN_PASSWORD=<strong-password>` in the
  environment (e.g. `/opt/gtv9-deploy/.env`) and restart the app.
- `app/api/boot.ts` — loud boot warning while the gate is open (production
  and dev).
- `shared/api/coreRouter.ts` — new `core.admin.status` query
  (`{ passwordRequired }`) so the frontend can tell.
- Frontend: new `app/src/hooks/useAdminGate.ts`; `AdminPasswordField`
  renders nothing while the gate is open; the Site-admin dialog
  (`AdminSites.tsx`) skips its unlock screen; the submit guards in
  `Bins.tsx` (4 dialogs), `People.tsx` (4 dialogs), and `Reports.tsx` (sync
  settings) only demand a password when the gate is closed. The
  `adminPassword` field still travels in every mutation, so a
  re-enabled gate works with zero frontend changes.
- Docs: root `README.md` env table, `app/README.md` operational rules, and
  `Grain-Tracker-Install-Guide.md` (Part 4 note + troubleshooting row)
  describe the open-by-default gate and the re-enable path.

## Live verification notes

- Office dev server, no `SYNC_KEY`: `POST /api/sync/eod` → 503 with the
  fail-closed message; boot log shows the warning.
- Office dev server, `SYNC_KEY=test123`: wrong header → 401; correct header
  passes auth (package validation then runs).
- App + office `/api/health` → `{"ok":true,"mode":"offline"}` (no MySQL on
  this machine; offline fallback is the designed dev path).

## Not addressed (out of scope, from the review's P0 list)

- "Refuse to boot in production with the default ADMIN_PASSWORD" (review
  P0-5) is superseded by the owner's explicit request to open the gate.

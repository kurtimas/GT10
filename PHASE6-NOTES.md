# Phase 6 — Phase-5 frontend leftovers + P1 ops/robustness + P2 polish (COMPLETE)

Follows PHASE5-NOTES.md. **This phase was delivered in two sittings: §1–§2
(and §3's deferral list) are from the first; §5 "Phase 6b" completes the P2
tail (C8 remainder, C9, C10, C11).** Everything is verified: `npm run check`,
`npm test` (**47/47 app, 48/48 office** — was 44/45; +3 sync-outbox tests), and
`npm run build` pass in BOTH `app/` and `office/`. Both dev servers were
booted against FRESH embedded databases (`GT_FORCE_OFFLINE=1`,
`GT_OFFLINE_DB_PATH=<temp file>`): `/api/health` returned
`{"ok":true,"mode":"offline"}` on each; on the app server `audit.list` and
the new `sync.outboxStatus` answered over HTTP and the security headers were
confirmed on the wire; on the office server a wrong sync key now returns
**401 (not the old 500 bodyLimit quirk)**, `office.shipments`,
`office.movements`, and `audit.list` answered, and the tabbed home page HTML
served. Both servers were stopped afterwards (ports confirmed clear, temp
DBs removed). The manual backup script was run for real (copy written,
retention pruning works — and the dev server's automatic daily backup had
already taken one on boot). The smoke guard was run with no server up and
refused with exit 2 as designed. The CI workflow steps were run locally as
written (`npm run check`, `npm test`, `npm run build:app && npm run
build:office`, all green; runner provides checkout/setup-node/npm ci).

Commits: `a852d0c` (A: office UI + banners), `063781e` (B: ops/P1),
`509b6fc` (C partial: CSV).

## 1. Done

### A. Phase-5 deferred frontend

1. **Office portal UI** — `office/src/pages/OfficeHome.tsx` is now tabbed:
   **Overview** (the original content), **Shipments** (read-only table over
   `office.shipments`: time, site, customer, destination, bin, lot/Mixed,
   qty lbs/bu, truck, note), **Bin movements** (read-only feed over
   `office.movements`: time, site, IN/OUT/MOVE/ADJUST badge, signed qty,
   lot, from → to, operator, ticket/shipment ref, note), **Audit log** (the
   shared `AuditLogTable`, which already handled its own errors). Same card/
   table/eyebrow style as the existing office page.
2. **Error banners** — shared `QueryError` extended to: app Dashboard
   (open-sheets card, bin strip, activity feed), Reports (daily report,
   sync settings, sync log), People (farmers / landlords / lots / operators
   tabs), and the office home (today totals, sites, EOD history — plus the
   two new tabs). Empty states are suppressed when the query errored so a
   failure never renders as "no data". Mutation errors already toasted
   everywhere (verified on People, Reports, Dashboard, Scale, Shipments —
   kept).

### B. P1 remainder

3. **Sync outbox with retry/backoff (P1-8)** — new
   `shared/api/syncOutbox.ts`: file-backed JSON queue
   (`data/sync-outbox.json`, atomic tmp+rename writes;
   `GT_SYNC_OUTBOX_PATH` override for tests). File-backed on purpose: works
   identically on MySQL and the embedded SQLite DB. `officeSync.ts`
   refactored around an exported `pushOneSite(siteId, day)`; `pushEod`
   failures are now enqueued (in addition to the sync_log ERROR row). A
   background worker (wired in `app/api/boot.ts`, unref'd, one sweep per
   minute, no overlap guard) retries with exponential backoff (1 min × 2^n,
   capped at 30 min), honors `Retry-After` on HTTP 429, and gives up after
   10 attempts (entry marked dead; manual retry still works). Pending count
   is logged on every enqueue/retry AND exposed via new tRPC
   `sync.outboxStatus`; `sync.retryOutbox` is the manual "retry now" path —
   both surfaced in the Reports → Office sync card (amber strip with count,
   per-entry site/day, dead-marker, Retry now button). Tests:
   `shared/api/syncOutbox.test.ts` (3 tests) runs the REAL push path against
   a loopback fake office: backoff math, enqueue-on-429 with Retry-After
   honored, no auto-retry before due, flush-on-recovery advancing the
   per-site cursor, dead entries skipping auto sweeps but flushing on manual
   retry.
4. **CI fix (P1-9)** — `.github/workflows/docker-image.yml` (which contained
   a Dockerfile) deleted; new `.github/workflows/ci.yml`: checkout →
   setup-node 24 (npm cache) → `npm ci` → `npm run check` → `npm test` →
   `npm run build:app && npm run build:office`, on push to main + PRs. All
   runnable steps executed locally, green.
5. **Smoke test safety (P1-10)** — `shared/scripts/smoke.mjs` now fetches
   `/api/health` before touching anything and REFUSES (exit 2) unless the
   server reports `mode: "offline"` (the embedded throwaway DB) — the script
   creates/voids sheets, weighs trucks, and closes the day. `--i-know` (or
   `SMOKE_I_KNOW=1`) overrides with a loud warning. Header comment documents
   booting against a temp DB; README smoke line updated.
6. **Security headers + input hardening (P1-12)** — new
   `shared/api/lib/httpHardening.ts`, mounted in BOTH boots:
   - `securityHeaders`: CSP (`default-src 'self'; script-src 'self';
     style-src 'self' 'unsafe-inline'; img/font data:; object-src 'none';
     frame-ancestors 'none'; …`), `X-Content-Type-Options: nosniff`,
     `X-Frame-Options: DENY`, `Referrer-Policy:
     strict-origin-when-cross-origin`. Confirmed on the wire.
   - CORS: verified NOT wide-open — neither server sets any CORS headers,
     so browsers enforce same-origin by default. Nothing to configure.
   - LIKE wildcards: `sheetsRouter` archive search now escapes `\ % _` in
     user input (`escapeLike`) so "50%"/"TRK_1" no longer act as wildcards
     (MySQL-correct; SQLite-mirror nuance noted in a comment).
   - Timing-safe key comparison: VERIFIED already in place from Phase 2
     (`office/api/syncReceiver.ts`: sha256 + `crypto.timingSafeEqual`).
   - **Office bodyLimit quirk FIXED** (was deferred since Phase 4):
     hono/body-limit replaced with `simpleBodyLimit` (Content-Length check
     only, never touches the body) in both boots — a wrong sync key on the
     office dev server now returns the designed **401** instead of the
     undici/Node-24 `#state` 500. Verified live.
7. **SQLite backup story (P1-14)** — `shared/api/lib/backup.ts`:
   `backupOfflineDb()` (better-sqlite3 online-backup API → consistent copy
   to `<db dir>/backups/`, keeps newest 7) and `startDailyBackup()` (hourly
   check, backs up when newest copy >24 h old, unref'd), wired in
   `app/api/boot.ts` when running offline. Manual path: `npm run backup`
   (`shared/scripts/backup.mjs`). README gained an "Offline database
   backups" section with a step-by-step **restore drill**. Verified live:
   the manual script wrote a copy and pruned, and the server's automatic
   backup fired on dev boot.

## 2. Done (partial)

8. **CSV exports** — `shared/src/lib/csv.ts` (`toCsv` RFC-4180 escaping,
   BOM+CRLF for Excel, `downloadCsv`, date stamp) with **Download CSV**
   buttons on the app **Sheets archive** (one row per load incl. void
   markers, respecting current filters) and app **Shipments** list.
   **Remaining:** BinDetailDialog movement history (app), shared
   `AuditLogTable` (would cover both apps' audit viewers), and the two new
   office tabs (`office.shipments` / `office.movements`). The helper +
   pattern are in place; each remaining button is a ~15-line add.

## 3. NOT done (deferred — none of these were started)

9. **Accessibility pass (C9)** — not started. Cheapest known gaps seen
   during the phase: icon-only Buttons without `aria-label` (e.g. edit
   farmer), some Labels without `htmlFor` on Select triggers. No contrast
   audit was run on the new office tabs.
10. **Operator assists (C10)** — not started. The spec
    (`scale-dashboard-rebuild-spec.md` §8) calls for Space/Enter = capture
    and N = new sheet on the scale flow, and the unwired `#ticket-print`
    print stylesheet in `shared/src/index.css` is ready for a TicketPrint
    component + Print button in the sheet detail. Skip big items
    (auto-print, sounds, tare-deviation warnings) as before.
11. **Dead-code cleanup (C11)** — not started. Confirmed-removable
    inventory (all verified unreferenced during exploration):
    `shared/db/relations.ts` (one-line `import {} from "./schema"`, no
    importers), `shared/contracts/errors.ts` (no importers; README line 39
    mentions it), `env.APP_ID`/`env.APP_SECRET` (defined in
    `shared/api/lib/env.ts`, never read — docs/scripts still reference
    them). `.superdesign` does NOT exist in this tree (already absent).
    Install-script triplication untouched: canonical should be root
    `gtv8-vps-setup.sh`; `gt-rebuild/repo/gtv8-vps-setup.sh`,
    `vps-grain-stack-setup.sh` (root + `gt-rebuild/repo/` copy), and
    `grain-track-ubuntu-bootstrap/` need stub-pointers or doc updates —
    `README.md`, `Grain-Tracker-Install-Guide.md`, and
    `Grain Tracker v2 — New Machine Startup Guide.md` reference them. Do
    NOT delete the install guides.

## 4. Notes for the next phase

- The Reports page edit in commit `a852d0c` includes the outbox UI whose
  backend lands in `063781e` — build only the tree HEAD, not mid-history.
- `shared/api/syncOutbox.test.ts` runs in BOTH workspaces' vitest (shared
  dir), hence +3 tests in each.
- The outbox file is dev-machine state, not source: `data/sync-outbox.json`
  (gitignored with the rest of `data/`).
- Headless-browser walk of the new office tabs was not done (HTTP-level
  verification only, as in Phase 5).

## 5. Phase 6b — the P2 tail (C8 remainder, C9, C10, C11)

Follows §3; completes everything deferred there. Verified: `npm run check`,
`npm test` (**47/47 app, 48/48 office**), and `npm run build` pass in BOTH
`app/` and `office/`. Both dev servers were booted against FRESH embedded
databases (`GT_FORCE_OFFLINE=1`, `GT_OFFLINE_DB_PATH=<temp file>`):
`/api/health` returned `{"ok":true,"mode":"offline"}` on each; the app's
`/shipments` page served HTTP 200; on the office server `office.shipments`
and `office.movements` (the queries behind the new CSV buttons) answered
with well-formed tRPC results. Both servers were stopped afterwards — port
3000 confirmed clear, temp DBs removed. The TicketPrint component was
confirmed present in the built bundle (`SCALE TICKET` string + the
`#ticket-print` stylesheet in the CSS asset). Print itself
(`window.print()`) is a browser chrome action — not exercised headlessly.

Commits: see `git log` after `1712d0c` (three: C8+C9, C10, C11 + notes).

### C8 remainder — CSV export buttons (done)

Same `shared/src/lib/csv.ts` pattern as the sheets archive / shipments
list. **Download CSV** added to: `BinDetailDialog` movement history (app),
the shared `AuditLogTable` filter bar (covers both apps' audit viewers —
exports the current page of rows), and the two office tabs (shipments +
bin movements, button row above each table).

### C9 — accessibility pass (done, small fixes only)

- `aria-label` on every icon-only Button (Bins ×4, People edit-farmer,
  AdminSites ×2) — they previously had only `title`.
- `aria-label` on every Radix `SelectTrigger` preceded by a bare `<Label>`
  (Bins, Dashboard, People, Scale, Shipments, AuditLogTable) — `htmlFor`
  doesn't associate with Radix's button trigger, so the trigger gets the
  label directly.
- Audit log before/after expansion is now keyboard-operable: the chevron
  cell is a real ghost Button with `aria-expanded` / `aria-label`
  (row-click still works).
- Dialogs verified OK as-is (Radix: role/aria-labelledby/describedby,
  focus trap, Esc, sr-only close); `focus-visible` ring styles verified
  present globally (`shared/src/index.css`) and on button/input/select/
  tabs/textarea/slider. No contrast redesign.

### C10 — operator assists (print ticket done; rest skipped as scoped)

`app/src/components/TicketPrint.tsx` — print-only scale ticket for a sheet
(header, farmer/lot/landlord/crop block, void banner, loads table,
totals, signature lines; plain inline styles so it's independent of the
dark theme), wired into `SheetDetailDialog` with a **Print ticket** button
that calls `window.print()`. Uses the previously unwired `#ticket-print`
stylesheet (hides the app, shows only the ticket, in `@media print`).
**Skipped (>30 lines each, per phase scope):** the §8 keyboard-shortcut
system (Space/Enter capture, N new sheet) and sound cues.

### C11 — dead-code cleanup (done)

- Deleted `shared/db/relations.ts` (re-verified: no importers; drizzle
  configs point only at `schema.ts`) and `shared/contracts/errors.ts`
  (re-verified: no importers).
- Removed `env.APP_ID` / `env.APP_SECRET` from `shared/api/lib/env.ts`
  (re-verified: nothing read them). Scrubbed the matching remnants:
  `gtv8-vps-setup.sh` no longer generates/writes them into `.env`, the
  root startup guide's §3.4 env example, §3.5 compose block, and the
  stale APP_ID troubleshooting row are updated, and README's "unwired
  groundwork" list drops the errors.ts bullet. (The `gt-rebuild/` copies
  are historical snapshots of the old repo — left as-is.)
- Install scripts consolidated: root `gtv8-vps-setup.sh` is canonical
  (README says so). `vps-grain-stack-setup.sh` (root + `gt-rebuild/repo/`
  copy) and `gt-rebuild/repo/gtv8-vps-setup.sh` replaced with short
  legacy-pointer stubs that print the pointer and exit 1 (all
  `bash -n`-clean). `grain-track-ubuntu-bootstrap/` kept (different
  purpose, README description already accurate). Install guides
  themselves untouched.

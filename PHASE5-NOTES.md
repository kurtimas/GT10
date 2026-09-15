# Phase 5 — frontend for the Phase-4 API (traceability UI, void UX, offline weigh queue)

Follows PHASE4-NOTES.md (API + sync layer). Scope: UI in both apps plus the
small read-model queries the UI needed. **No schema changes.**

Verified: `npm run check`, `npm test` (**44/44 app, 45/45 office** — unchanged,
no new tests this phase), and `npm run build` pass in BOTH `app/` and
`office/`. Both dev servers were booted against FRESH embedded databases
(`GT_FORCE_OFFLINE=1`, `GT_OFFLINE_DB_PATH=<temp file>`): `/api/health`
returned `{"ok":true,"mode":"offline"}` on each; on the app server
`audit.list`, `core.bins.movements`, `shipments.linkableLoads`, and the page
HTML all answered over HTTP (demo seed loaded); on the office server
`office.shipments`, `office.movements`, and `audit.list` answered. Both
servers were stopped afterwards (ports confirmed clear, temp DBs removed).
No headless-browser walk was done — HTTP-level verification only.

Note: the review report referenced in the task
(`..\grain-tracker-v9-review.md`) was not present on disk; the phase worked
from the gap list in the task brief (items 1–10).

## 1. Backend read-model additions (the only API changes)

Small, read-mostly additions exposing Phase-3/4 data the UI needed:

- `sheets.list` / `sheets.get` — new optional `includeVoided` flag. Voided
  sheets/loads stay excluded by default; the flag powers the "show voided"
  toggles. Aggregates (`loadCount`, net totals, activeLoad) NEVER count
  voided loads even when the rows are returned.
- `sheets.updateLoadGrades` — now also accepts `damagePct`, `grade`,
  `farmOrigin` (columns exist since Phase 3); audit before/after covers them.
- `core.bins.movements({ binId, limit })` — movement history for one bin:
  newest-first `bin_movements` enriched with lot code, from/to bin names,
  linked ticket + loadNo, and shipment customer. Bin names are resolved in
  JS (tiny table) to stay portable across the MySQL / offline-SQLite shim.
- `shipments.linkableLoads({ siteId })` — completed, non-voided, unlinked
  OUTBOUND loads for the shipment form's "link outbound load" picker.
- `office.shipments` / `office.movements` — read-only lists over the mirrored
  shipments / bin_movements tables (site/bin/lot names joined).

## 2. App UI delivered

- **Enriched intake (task 1).** The grades dialog was extracted to
  `app/src/components/GradesDialog.tsx` (shared by Sheets + Scale) and now
  captures damage %, grade, and farm/field origin alongside moisture /
  dockage / test weight / protein, all optional, with the live bushel
  preview. The Scale page's loads table gained a per-load **Grades / +
  Grade** button so the operator can grade right after weigh-out without
  leaving the scale flow; net bushels are shown there and in the sheet
  detail ledger as before. The sheet-detail loads table gained Dmg% and
  Grade/Origin columns.
- **Shipments UI (task 2).** New `/shipments` page
  (`app/src/pages/Shipments.tsx`): list (date, customer, destination, bin,
  lot or "Mixed", qty lbs/bu, truck, note) + create dialog. The dialog picks
  a source bin and shows its LIVE lot composition
  (`shipments.binComposition`, incl. log-vs-cache reconciliation line),
  computes a client-side FIFO attribution preview (mirrors
  `fifoDrawdown`) with a shortfall warning BEFORE confirming, validates
  quantity against availability, and offers the linkable-outbound-load
  picker (link mode is explained inline; bin/qty/truck prefill from the
  load). Success toasts surface short shipments loudly.
- **Bin detail / provenance (task 3).** `BinDetailDialog` (History button on
  each bin card): composition by lot (lot code, lbs, % of bin, bar), log
  total vs cached level with a DRIFT warning, and the movement history table
  (time, IN/OUT/MOVE, signed qty, lot, from → to, operator, ticket/shipment,
  note).
- **Audit viewer (task 4, app side).** New `/audit` page mounting the shared
  `AuditLogTable` (`shared/src/components/`): filters (entity type, entity
  id, date range), 50/page offset pagination, expandable before/after JSON,
  action-colored badges.
- **Void UI (task 5).** "Show voided sheets" toggle on the archive list
  (voided rows dimmed + VOID badge); "Show voided loads" toggle in the sheet
  detail (dimmed, VOID-marked, no actions); a **Void sheet** button with
  required-reason dialog next to Close sheet; a destructive banner on voided
  sheets showing when + why. Per-load Void already had the required-reason
  dialog (kept). No delete affordances for loads/sheets exist.
- **Error banners (task 6, partial).** New shared `QueryError` banner
  (red left-border, message, Retry). Applied to: Sheets list + sheet detail
  dialog, Bins page, Scale page (sheet query + bin picker), Shipments page
  and its composition panel, BinDetailDialog, AuditLogTable. Mutation
  failures already toast everywhere (kept).
- **Offline weigh queue (task 7).** `app/src/providers/weighQueue.tsx`:
  weighFirst/weighSecond mutations that fail with a NETWORK error
  (`TRPCClientError` with no response data) are queued in localStorage
  (`gt.weighQueue.v1`) with a warning toast; an amber "N weighs queued"
  indicator lives in the sidebar + a strip on the Scale page; when `ping`
  answers again the queue replays STRICTLY in order (weigh-out depends on
  its weigh-in), invalidates scale queries on success, drops unrecoverable
  server-conflict items with a 15 s error toast naming the truck, and pauses
  on continued network failure. No service worker; the page just stays open.
- **Navigation.** Shipments and Audit Log added to the sidebar; weigh-queue
  provider mounted in `main.tsx`.

## 3. Deferred (hit the phase time budget)

- **Office portal UI (task 4 office side + task 8).** The read-only queries
  (`audit.list`, `office.shipments`, `office.movements`) are mounted and
  verified over HTTP, but the office one-page UI does NOT yet render them —
  needs a tab/section in `OfficeHome.tsx` reusing `AuditLogTable` and two
  simple tables. This is the main remaining frontend gap.
- **Error banners (task 6 remainder).** Dashboard (`sheets.open`, bin strip,
  activity feed), Reports (`sheets.dailyReport`), People lists, and the
  office home queries still fall back to empty/skeleton states on failure;
  `QueryError` is ready to drop in.
- No new automated tests this phase (router behavior unchanged except the
  additive read models); UI verified by typecheck + HTTP smoke only.
- Headless-browser walk of the flows was not done (HTTP-level only).
- Office dev-server `bodyLimit` 500 quirk (pre-existing, from Phase 4) is
  unchanged.

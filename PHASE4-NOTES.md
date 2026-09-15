# Phase 4 — API + sync layer (review P1-6/7/8: traceability wiring, void semantics, operator attribution)

Follows PHASE3-NOTES.md (traceability data model). Scope: routers, sync,
operator identity, tests. **No schema changes** — everything builds on the
Phase-3 tables/columns, so no new migration was needed.

Verified: `npm run check`, `npm test` (**44/44 app, 45/45 office** — was
37/37; +7 shared traceability router tests, +1 office sync-receive
idempotency test), and `npm run build` pass in BOTH `app/` and `office/`.
Both dev servers were booted against FRESH embedded databases
(`GT_FORCE_OFFLINE=1`, `GT_OFFLINE_DB_PATH=<temp file>`): `/api/health`
returned `{"ok":true,"mode":"offline"}` on each, `audit.list` and
`shipments.list` answered over HTTP, and all servers were stopped afterwards
(no stray listeners, temp DBs removed).

Known pre-existing quirk (NOT introduced by Phase 4): on the office dev
server, a POST body through Hono's `bodyLimit` middleware throws
`TypeError: Cannot read private member #state` (undici/Node-24 vs
@hono/vite-dev-server) before sync auth runs, surfacing as a 500 instead of
the designed 401/503. The receiver logic itself is covered by the new
`receiveEod` unit test. Worth its own fix pass (Node pin or bodyLimit
upgrade) — unchanged from Phases 2-3 code.

## 1. Movement events on real flows (task item 1)

Every bin-delta path now appends a `bin_movements` row in the SAME
transaction (`shared/api/lib/movements.ts` `recordMovement`):

- `sheets.weighSecond` — inbound: `null → bin` (lotId from the sheet);
  outbound: `bin → null`.
- `sheets.assignLoadBin` — inbound load: one transfer row `old → new`;
  outbound load: reversal into the old bin + draw from the new one (a
  transfer row would credit the wrong side).
- `sheets.updateLoadWeights` — corrective event for the net delta, note
  carries old → new lbs + change reason.
- `sheets.voidLoad` — reversing event (`note: "Reversal — …"`): the original
  event stays in the append-only log and the reversal nets it out of replay,
  so `binTotalLbs` matches the reversed `bins.currentLbs`.
- `core.bins.adjust` — lot-less event (direction follows the sign).
- `shipments.create` (draw mode) — outbound event with the FIFO attribution
  recorded in the note; `shipmentId` backfilled in the same transaction.

## 2. Shipments API (task item 2)

New `shared/api/shipmentsRouter.ts`, mounted as `shipments` in
`app/api/router.ts` only (office gets shipments via sync):

- `shipments.create` — two modes:
  - **draw mode** (no loadId, or a load that never hit a bin): validates the
    draw with `fifoDrawdown` against the bin's CURRENT composition, records
    per-lot allocations + `shortfallLbs` (bin short → everything allocated,
    gap reported; the shipment is still recorded), writes the movement,
    decrements the bin cache (atomic `GREATEST(0, …)`), links an optional
    outbound load — all in ONE transaction.
  - **link mode** (`loadId` of a completed, unlinked, non-voided OUTBOUND
    load that already weighed out of a bin): the scale already recorded the
    draw at weigh-out, so the shipment only links the load and points at the
    load's existing movement — no double decrement.
- `shipments.list` / `shipments.get` — join site/bin/lot (get also returns
  linked non-voided loads).
- `shipments.binComposition` — provenance replay for one bin: per-lot
  composition (with lot codes), log-derived total, and `bins.currentLbs`
  side by side for reconciliation.

## 3. VOID-instead-of-delete (task item 3)

- `sheets.voidLoad({ loadId, voidReason })` — reason REQUIRED (min 3). The
  row is kept and marked `voidedAt/voidReason`; bin delta reversed +
  reversing movement + `audit_log` 'void' row in one transaction; FULL
  sheets re-open. The `LOAD_VOID` sheet event now keeps a VALID `loadId` —
  no new orphaned `sheet_events` (historical orphans from the old hard
  delete remain, as documented in Phase 3).
- New `sheets.voidSheet({ id, voidReason })` — only for sheets with no
  completed loads (void those individually); voids any on-scale load, marks
  the sheet `CLOSED/VOID` + voided.
- Exclusions: voided loads are filtered from sheet lists/detail, the scale
  flow (weigh-in checks, `loadNo` still computed over ALL rows so the
  unique `(sheetId, loadNo)` index can't collide with a voided row),
  truck-tare memory, daily report, EOD package totals; voided sheets are
  excluded from lists and the opened-today count. Provenance replay skips
  voided loads via the reversing movement (the log stays append-only).
- The EOD package still CARRIES voided rows (with `voidedAt/voidReason`) so
  the office mirror marks them void too; totals exclude them.

## 4. Audit for bin adjustments (task item 4)

`core.bins.adjust({ adminPassword, id, currentLbs, reason })` — reason
REQUIRED. One transaction: bin update + lot-less movement + `audit_log`
'adjust' row with before/after `currentLbs` JSON.

## 5. Audit trail everywhere (task item 5)

`shared/api/lib/audit.ts` `writeAudit(db|tx, …)` — called from every
mutating procedure in `sheetsRouter`, `coreRouter` (sites/bins/operators),
`peopleRouter` (farmers/landlords/lots), and `shipmentsRouter`, with
before/after JSON snapshots. New read-only `audit.list` (shared
`shared/api/auditRouter.ts`; filter by entityType/entityId/date range,
offset-paginated, returns `{rows,total,hasMore}`) mounted in BOTH
`app/api/router.ts` and `office/api/router.ts`.

## 6. Operator identity (task item 6 — attribution, NOT auth)

- Managed list: `settings` key `operators` (JSON array), maintained via
  admin-gated `core.operators.list/add/remove`; UI: new "Operators" tab on
  the Farmers & Lots page.
- Per-terminal pick: `OperatorPicker` in the app header (visible once at
  least one operator exists), persisted in `localStorage` (`gt.operator`),
  sent on every tRPC call as `x-gt-operator` (read per request in
  `shared/src/providers/trpc.tsx`).
- Server side: `TrpcContext.operator`; mutations resolve it via
  `resolveOperator` (`shared/api/lib/operators.ts`) — once the list is
  non-empty, unknown names are REJECTED; while empty (unconfigured) any
  name passes. Recorded on `bin_movements.operator`, `audit_log.actor`, and
  shipments. No passwords, no sessions.

## 7. Sync of the new tables (task item 7)

- Package (`shared/api/officeSync.ts`): new `binMovements`, `shipments`,
  `auditLog` sections, selected by `createdAt >= lastPushAt:site:<id>`
  (append-only tables → the Phase-2 cursor applies directly). References
  travel as NATURAL KEYS (lot code, bin name, sheet ticket + loadNo)
  because the office mirror assigns its own ids; `audit_log.entityId` stays
  a raw plant-side id (display mirror). Sheet/load payloads gained
  `voidedAt/voidReason` (+ `damagePct/grade/farmOrigin` on loads).
- Receiver (`office/api/syncReceiver.ts`): the whole import still runs in
  ONE transaction; new phases upsert shipments → movements → audit rows
  AFTER sheets (so movement→load links resolve). Idempotency: upsert by the
  plant's row id; if that id is already taken by ANOTHER site instance, the
  copy is found by content (site + createdAt + distinguishing fields) or
  inserted fresh — re-receives never duplicate. `receiveEod` response and
  the `sync_log` line now include the new counts. `office.todayLoads`
  excludes voided loads.

## 8. New endpoints summary

| Endpoint | App | Office | Notes |
|---|---|---|---|
| `shipments.create` / `.list` / `.get` / `.binComposition` | ✓ | — | draw + link modes |
| `sheets.voidSheet` | ✓ | — | reason required |
| `sheets.voidLoad` (changed) | ✓ | — | now VOID + `voidReason` required |
| `core.operators.list/add/remove` | ✓ | — | add/remove admin-gated |
| `core.bins.adjust` (changed) | ✓ | — | `reason` now required |
| `audit.list` | ✓ | ✓ | read-only, filtered, paginated |

## 9. Tests

- `shared/api/traceability.test.ts` (7 tests, in-memory offline DB):
  movement + audit on weigh-out; void keeps row / reverses bin / reversing
  movement / no orphan events; void excluded from sheet detail + daily
  totals; double-void and missing-reason rejected; shipment FIFO
  allocations + shortfall; bins.adjust reason/audit/lot-less movement +
  replay reconciliation; operator list validation + recording.
- `office/api/syncReceiver.test.ts` (1 test): receive the same package
  TWICE → shipments/movements/audit upsert by plant id (no duplicates),
  references re-keyed to mirror ids, movement→load link resolved via
  ticket+loadNo, void markers mirrored, one eod_reports row.
- All pre-existing tests (37) still pass.

## 10. Deferred (Phase 5+)

- Shipments UI (scale/office pages) — API + sync only this phase; office UI
  for audit trail likewise (query is mounted, no page yet).
- Multi-plant id-collision handling is content-key based (see §7); a real
  origin-id mapping table would be cleaner if a second plant ever syncs.
- Sync outbox + retry/backoff (review P1-8) — still manual "Sync now".
- Office dev-server `bodyLimit` 500 quirk noted above (pre-existing).
- Scale tickets, contracts/bookings, truck master, shrink tables, EPCIS —
  out of scope, as before.

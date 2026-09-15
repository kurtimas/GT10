# Phase 3 — traceability data model (review P1-6 / section 2)

Follows PHASE2-NOTES.md (P0 security & sync). Scope: **data-model layer only** —
schema, contracts, migrations. No router/API/UI changes; Phase 4 wires the
routers (movement writes on weigh-out, shipment endpoints, audit writes,
VOID-instead-of-delete behavior).

Verified: `npm run check`, `npm test` (37/37, incl. 14 new provenance contract
tests), and `npm run build` pass in BOTH `app/` and `office/`. Both dev servers
were booted against FRESH embedded databases (`GT_FORCE_OFFLINE=1`,
`GT_OFFLINE_DB_PATH=<temp file>`): new tables/columns/indexes verified present
via sqlite_master/PRAGMA, the demo seed loaded, and `/api/health` returned
`{"ok":true,"mode":"offline"}` on each. Nothing was left running.

Note on tooling: the Kimi runtime has no `npm` shim on Git Bash PATH — run
`node "<runtime>/node_modules/npm/bin/npm-cli.js" …` (runtime dir:
`C:\Users\Truk\AppData\Local\Programs\Kimi\resources\resources\runtime`).

## 1. New tables

### `bin_movements` — append-only provenance event log
`id, siteId→sites, lotId→lots (null only for lot-less manual adjustments),
fromBinId→bins (null = inbound from field/truck), toBinId→bins (null =
outbound/shipped), quantityLbs, loadId, shipmentId, operator (text), note,
createdAt`. Indexes: site, lot, fromBin, toBin, load, createdAt.

`loadId`/`shipmentId` are intentionally plain columns (no FK): a hard FK
`bin_movements.loadId → loads.id` closes a type-level cycle
(loads→shipments→bin_movements→loads) that `tsc` cannot resolve, and the
provenance log must survive changes to the documents that caused it (e.g. the
current `voidLoad` hard-delete, until Phase 4 replaces it with VOID status).

### `shipments` — one outbound sale/delivery
`id, siteId→sites, customerName, destination, lotId→lots (NULL when shipped
from a mixed bin — provenance then comes from FIFO drawdown), binId→bins,
quantityLbs, quantityBu, truckId, binMovementId→bin_movements (the draw
event), note, createdAt`. Outbound loads link via `loads.shipmentId`.

### `audit_log` — generic append-only trail
`id, actor (default 'system'), action (create|update|void|adjust), entityType,
entityId, beforeJson, afterJson, note, createdAt`. `entityId` deliberately has
no FK — it references whatever `entityType` names, and audit rows must survive
entity changes. Routers start writing here in Phase 4 (incl. the
`bins.adjust` audit row the review asks for).

## 2. Changed columns

| Table | Added |
|---|---|
| `loads` | `damagePct`, `grade` (varchar 32), `farmOrigin` (varchar 255) — completing the enriched intake set (moisture/testWeight/dockage/protein/netBushels already existed); `shipmentId→shipments`; `voidedAt`, `voidReason` (VOID-instead-of-delete, both null on live rows) |
| `weight_sheets` | `voidedAt`, `voidReason` |
| `eod_reports` | **unique(siteId, day)** (`eod_site_day_unique`) — concurrent receives now collide loudly instead of duplicating; the receiver's find-then-insert inside one transaction keeps re-uploads idempotent |

All new columns are nullable → existing rows, the seeds, and the sync payload
(unchanged) keep working. `contracts/types.ts` gained the matching fields and
new `BinMovementRow` / `ShipmentRow` / `AuditLogRow` interfaces.

## 3. FK constraints added (review 2.2 — "no foreign keys anywhere")

`bins.siteId`, `lots.farmerId/landlordId`, `weight_sheets.siteId/farmerId/
lotId/landlordId`, `loads.sheetId/binId/shipmentId`, `eod_reports.siteId`, plus
all FKs on the new tables above. `sheet_events` got none: historical
`voidLoad` hard-deletes leave `sheet_events.loadId` pointing at deleted loads
on existing databases, so that FK would fail on upgrade.

## 4. Provenance model decision: event log, not a balance table

The review recommended `bin_lot_layers` (a mutable balance table consumed
FIFO). We chose an **append-only event log** (`bin_movements`) with the layer
math in `shared/contracts/provenance.ts` instead:

- **Auditability first** — the log *is* the history ("which outbound trucks
  carried lot X?" is a query), a balance table only answers "what's left".
- **One writer, no drift** — balances are derived, never updated; there is no
  second copy of inventory state to diverge from reality. `bins.currentLbs`
  stays as the fast cached balance and can be reconciled against the log
  (`binTotalLbs`).
- **Simpler failure modes** — a missed event is visible as a gap, not a
  silently wrong balance.

`shared/contracts/provenance.ts` (pure functions, shared by both apps and
future reports):

- `binLayers(events, binId)` — replays the log for one bin, oldest first.
  Inflows push a layer; outflows consume from the front (oldest). A transfer
  event (both bins set) debits the source and credits the destination. Events
  are ordered by `(createdAt, id)`; non-positive quantities are ignored.
- `binCompositionByLot(events, binId)` — layers aggregated per lot
  (`{lotId, lbs}[]`, oldest lot first; `lotId: null` = unknown-origin grain).
- `fifoDrawdown(events, binId, lbs)` — attributes a shipment to the oldest
  lots first: `{allocations: [{lotId, lbs}], allocatedLbs, shortfallLbs}`.
  When the bin holds less than requested, everything is allocated and the gap
  is reported in `shortfallLbs` — the caller decides if a short ship is OK.
- `binTotalLbs(events, binId)` — log-derived balance for reconciliation.

Outbound events consume oldest-first regardless of any lotId recorded on them
(the recorded lot is the attribution computed at write time); replaying pure
FIFO keeps the log self-consistent.

## 5. Migration paths

- **MySQL**: `shared/db/migrations/0002_traceability_model.sql` (drizzle-kit
  generated, journal + snapshot updated) — new tables, new columns, unique
  index, 19 FK constraints; applied by `migrateOnBoot` as before.
- **SQLite offline mirror**: `shared/db/sqliteSchema.ts` mirrors the new
  tables/columns/indexes; `connection.ts` `SQLITE_DDL` creates everything on a
  fresh database, and a new `applySqliteUpgrades()` adds the Phase-3 columns
  to EXISTING dev databases via guarded `ALTER TABLE ADD COLUMN` (ignores
  "duplicate column name") and creates the `eod_site_day_unique` index with a
  loud warning instead of a boot failure if an old DB holds duplicate
  site/day rows.
- **Existing MySQL dev/prod databases**: migration 0002 adds real FKs — it
  will fail on databases containing orphan rows (e.g. sheets whose farmer was
  deleted, `eod_reports` duplicates). Clean those before migrating; offline
  dev databases are handled by the tolerant path above. FK enforcement is
  MySQL-only (the SQLite mirror stays app-disciplined, as before).

## 6. Deferred (Phase 4+)

- Router writes: `bin_movements` rows on weigh-out / transfer / shipment,
  `shipments` endpoints, `audit_log` writes (incl. `bins.adjust`), VOID
  behavior replacing `voidLoad`'s hard delete (columns are ready).
- Sync of `bin_movements` / `shipments` / `audit_log` to the office portal
  (EOD package format unchanged in Phase 3).
- Operator identity on `sheet_events` (review P1-7) — `bin_movements.operator`
  and `audit_log.actor` are free text until a users table exists.
- Scale tickets, contracts/bookings, truck master, per-elevator shrink tables
  (review 2.2) — out of the approved scope.

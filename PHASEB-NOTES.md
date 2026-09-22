# Phase B — traceability API + sync layer (partial: app-side APIs delivered; office sync deferred)

Follows PHASEA-NOTES.md (data model) and PHASE4-NOTES.md (API patterns:
`writeAudit` on every mutation, operator via `x-gt-operator`, VOID semantics,
append-only logs corrected by reversing rows, admin gate intentionally open by
default).

**Status: PARTIAL.** All plant-side (app) APIs for features #3, #4, #5, #9,
#12, #14, #15, #16, #17, #18, #19, #20, #22, #26 are implemented, mounted,
type-checked, and smoke-tested over HTTP. The **office sync extension (#13 —
EOD package + receiver + office read endpoints) and the new router-level test
suite are NOT done** (step limit reached); both are called out below and in
the per-feature list. Existing tests stay green: **78/78 app, 79/79 office**;
`check` + `build` pass in BOTH apps.

Verified: `npm run check`, `npm test`, `npm run build` green in both apps.
The app dev server was booted against a FRESH embedded DB
(`GT_FORCE_OFFLINE=1`, temp `GT_OFFLINE_DB_PATH`): `/api/health` ok, grading
defaults seeded, and `grading.schedules.list`, `reports.dprList`,
`compliance.retention.get`, `reports.massBalance`, `trace.backward`,
`core.bins.suggest` all answered correctly over HTTP. Server stopped; ports
3417/3000 confirmed clear; temp DB removed.

## 0. Schema (one new migration)

`shared/db/migrations/0004_phase_b_dpr_physical_counts.sql` (drizzle-kit
generated; journal + snapshot updated):

- **`dpr_snapshots`** (#5) — one row per site × day × crop × program:
  opening/received/shipped/transfers in-out (lbs + bu), shrink by kind
  (moisture/handling/aeration/error-correction, signed), `adjustmentsLbs`
  (lot-less manual corrections), ending lbs/bu, `frozen` flag. Unique
  `(siteId, day, crop, program)`.
- **`physical_counts`** (#15) — append-only physical bin measurements
  (`countedLbs`, `countedAt`, note, operator).
- **`loads.shrinkLbs` / `loads.dockLbs`** (#3) — schedule-driven deduction
  amounts stamped at grade time.

SQLite mirror (`sqliteSchema.ts`, `connection.ts` DDL + guarded ALTERs)
updated to match; fresh and existing dev DBs both upgrade on boot.

## 1. Grading API (#3) — DONE (app)

- New `grading` router (`shared/api/gradingRouter.ts`):
  `grading.schedules.list/create/update/delete`,
  `grading.factors.list/create/update/delete` — writes admin-gated +
  audit-logged. `grading.preview(siteId, crop, netLbs, moisturePct,
  dockagePct)` returns the schedule + computed breakdown for the UI.
  Resolution rule: site-specific row wins over plant-wide (siteId null).
- `sheets.updateLoadGrades` extended: accepts `foreignMaterialPct`/`sbPct`;
  when a `grade` class is set, readings are validated against the effective
  `grade_factors` min/max ranges (`validateGradeFactors`) and **rejected with
  the violating factors listed**; the breakdown is computed from the crop's
  grading schedule (`computeGradeAdjustments` in `contracts/grading.ts` —
  moisture shrink at the schedule rate, default 1.183%/point over base, +
  handling % + dockage 1:1, 99% cap) and **stamped on the load**
  (`shrinkLbs`, `dockLbs`, `shrinkPct`, `grossBushels`, `netBushels`); the
  full breakdown is returned as `breakdown`.

## 2. Splits API (#4) — DONE (app)

New `splits` router: `splits.get(loadId)` (with party names),
`splits.set(loadId, splits[])` — sum-to-100 validated via
`validateLoadSplits` (bad sets rejected with the actual total), replace is
atomic (delete + insert + audit in ONE transaction).

## 3. Cleanouts API (#12) — DONE (app)

`compliance.cleanouts.list/record/complete`. `record` refuses a bin over
500 lbs residual unless `confirmNotEmpty: true` AND a note are given (the
residual is recorded in the note and returned as a warning). `complete` sets
`cleanedAt` — the genealogy reset: all provenance replay functions
(`binLayers`/`binCompositionByLot`/`binTotalLbs`/`fifoDrawdown`/
`binGradeAverages` in `contracts/provenance.ts`) now take an optional
`cutoffAt` and only consider movements strictly after it. The cutoff helper
(`shared/api/lib/cleanouts.ts`) is wired into `shipments.create`,
`shipments.binComposition`, `core.bins.get`, trace, mass balance, and DPR.

## 4. Fumigation / certificates / lab results (#19/#20/#22) — DONE (app)

`compliance.fumigations.list/create/update` (update covers aeration
clearance). `compliance.certificates.list/get/create/reprint/void` — reprint
keeps the old row (status `reprinted`) and creates a new revision row (status
`issued`, note carries the **DUPLICATE** marker) in one transaction; void
requires a reason. `compliance.labResults.list/create` — the contract schema
enforces at least one of lot/load/bin. All mutations audit-logged with
operator.

## 5. Attachments (#26) — DONE (app)

`attachments.list/upload/download/delete`. Upload is base64 over tRPC (50MB
Hono body limit covers the 10MB decoded cap), stored content-hash-deduped
under `data/attachments/` (`shared/api/lib/attachmentStore.ts`). Download
streams from `GET /api/attachments/:id` (Hono route in `app/api/boot.ts`)
with the stored mime; a tRPC base64 `download` exists for small files/tests.
Delete removes the row and the payload only when no other row shares the
hash. Attach/detach audit-logged. Entity types: load, weight_sheet,
certificate, fumigation_log, lot, bin, shipment, lab_result.

## 6. Shrink entries + mass balance (#15) — DONE (app)

`compliance.shrinkEntries.list/create` — append-only by design (no
update/delete; corrections are reversing entries). New `reports` router:
`reports.massBalance(siteId?, binId?, from, to)` — per bin: opening book lbs
(movement replay bounded by cleanout cutoff + cumulative signed shrink),
received/shipped/transfers/adjustments in range, shrink by kind, expected vs
`bins.currentLbs` variance, and the latest physical count with
book-vs-physical variance **flagged when |variance| > 1% of book AND > 500
bu** (examiner threshold, constants in `contracts/compliance.ts`).
`reports.recordPhysicalCount` / `reports.physicalCounts` record and list
physical counts (append-only, audit-logged).

## 7. DPR — Daily Position Record (#5) — DONE (app)

`shared/api/lib/dpr.ts` computes one row per site × day × crop × program from
the movement replay + shrink entries (semantics documented in the file
header: received = inbound scale loads, shipped = outbound loads/shipments,
transfers counted only across crop/program groups, adjustments = lot-less
manual corrections). `sheets.closeDay` now writes **frozen** snapshots for
the day before the office push and returns a `dpr` map.
`reports.dprList/dprGet/dprPreview/dprRegenerate/dprCsv` — regenerate is
refused once the day is frozen; preview is computed live without storing.
**Storage-vs-owned is NOT derivable** (ownership is not modeled — contracts/
settlements out of scope); responses carry `ownershipModeled: false`.

## 8. Recall/trace queries (#14) — DONE (app)

New `trace` router: `trace.backward(shipmentId | binId+date)` — FIFO replay
of the bin state just before the draw (bounded by cleanout cutoff), per-lot
lbs + % plus per-load breakdown (ticket, farmer); `shortfallLbs` surfaced.
`trace.forward(lotId | loadId)` — every bin entered, and every outbound
movement/shipment that carried the grain with % attribution computed by FIFO
replay at each shipment's moment, plus customer/destination. Loads are
fetched in a handful of bulk queries and replayed in memory (no N+1).
`trace.backwardCsv` / `trace.forwardCsv` emit the FSMA-style sortable
spreadsheet.

## 9. Segregation-aware routing (#16) — DONE (app)

`core.bins.suggest(siteId, crop, program?, moisturePct?, grade?)` — pure
query, no assignment. Same-crop bins ranked: program match first (mismatches
flagged with a segregation reason), grade compatibility (bin avg moisture
within ±1 point of the load's), then cleaned/empty flags, then remaining
capacity. Each candidate carries `reasons[]`, `empty`, `cleaned`,
`gradeCompatible`, `capacityRemainingLbs`.

## 10. Program segregation (#17) — DONE (app)

`program` wired through: `core.bins.list/create/update`,
`people.lots.create/update`, `sheets.list` filter (via lot program),
`sheets.dailyReport` gains a `byProgram` totals group, DPR is per-program by
construction, and `loads.program` is now actually denormalized from the lot
at weigh-in (`sheets.weighFirst`).

## 11. Retention + exam mode (#9) — DONE (app)

`compliance.retention.get/set` (settings key `retentionYears`, default 6,
2–10 enforced; set is admin-gated + audited). `compliance.exam.export(from,
to, entityTypes[], siteId?)` returns a JSON manifest (range, retention,
counts) + CSV sections for tickets (loads incl. void markers), movements,
shipments, audit, DPR. Hard deletion intentionally not built.

## 12. Bin grade overrides (#18) — DONE (app)

`compliance.gradeOverrides.set/list` — append-only, reason required (≥3
chars), audit-logged; latest row per (binId, factor) wins.
`shared/api/lib/binGrades.ts` `effectiveBinGrades(binId)` merges computed
averages with overrides (override wins, marked `override: true` with reason).
Surfaced in the new `core.bins.get` (composition + effective grades +
cleanout cutoff) and `shipments.binComposition`.

## 13. Sync to office — **NOT DONE (deferred)**

The EOD package (`officeSync.ts`) and receiver (`office/api/syncReceiver.ts`)
are UNCHANGED: the new tables (grading schedules/factors, splits, cleanouts,
fumigations, certificates, lab results, attachments metadata, shrink entries,
grade overrides, dpr_snapshots, physical_counts) and the new payload fields
(program on lots/bins/loads, FM/S&B, shrinkLbs/dockLbs) do **not** sync yet,
and the office has no read endpoints for them. Attachment binaries were
always planned as deferred (metadata-only sync). This is the first thing to
do in Phase C: extend `buildEodPackage` with the new sections (createdAt/
updatedAt cursors, natural-key references as in Phase 4), add receiver
upserts (plant-id idempotency), and `office.*` read endpoints.

## Tests — **NOT DONE (deferred)**

No new router-level tests were added (step limit). The required Phase-B test
list stands: grade validation reject + shrink stamp, splits validation,
cleanout genealogy cutoff, certificate lifecycle, mass-balance variance flag,
DPR frozen snapshot, trace forward/backward fixture, sync idempotency.
Existing suites pass unchanged: 78/78 app, 79/79 office.

## Deferred summary

- **#13 sync of all new tables/columns + office read-only endpoints** (whole item).
- **New tests** for everything above (whole test item).
- Attachment binaries never sync (metadata only, as specced).
- UI for all new endpoints (out of Phase B scope).
- Storage-vs-owned DPR split (ownership not modeled; documented in responses).
- Pre-existing office dev-server `bodyLimit` 500 quirk (from Phase 4) unchanged.

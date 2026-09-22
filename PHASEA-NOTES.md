# Phase A — traceability research data-model layer (feature-guide findings)

Follows PHASE6-NOTES.md. Implements the **data-model layer only** for the
approved findings from `../grain-elevator-traceability-feature-guide.md` /
`../grain-elevator-traceability-research.md` (numbers below = feature-guide
list numbers). No router/API/UI changes; Phase B wires writes through the
routers with audit_log rows, and sync.

Out of scope per owner: #6 contracts, #7 settlements, #21 export doc
packages, #23 import/customs, #24 rail logistics, #25 RFID/unattended scale,
#27 grower portal, #28 e-signature, #30 bin sensors, #32 inter-company APIs.

Verified: `npm run check`, `npm test` (**78/78 app, 79/79 office** — was
47/48; +31 new contract tests), and `npm run build` pass in BOTH `app/` and
`office/`. Both dev servers were booted against FRESH embedded databases
(`GT_FORCE_OFFLINE=1`, `GT_OFFLINE_DB_PATH=<temp file>`): `/api/health`
returned `{"ok":true,"mode":"offline"}` on each, all 10 new tables + 7 new
columns were verified via sqlite_master/PRAGMA, and the grading defaults were
seeded (3 shrink schedules + 30 grade-factor rows). Both servers were stopped
afterwards — port 3000 confirmed clear, temp DBs and the verify script
removed.

## 1. New tables (10)

| Table | Feature | Shape |
|---|---|---|
| `grading_schedules` | #3 | `siteId` (null = plant-wide default) FK, `crop`, `moistureShrinkPerPoint`, `baseMoisturePct`, `handlingShrinkPct` (default 0), `dockageRules` text, createdAt/updatedAt. Seeded on boot for Corn/Soybeans/Wheat from `grain.ts` base moistures + 1.183%/point true shrink + 0.5% handling. |
| `grade_factors` | #3 | `siteId` (null = default) FK, `crop`, `gradeClass` ("No. 1"…), `factor`, `minValue`/`maxValue` nullable, createdAt/updatedAt. Seeded with approximations of US (USGSA) grade ranges for corn/soy/wheat (TW min, damage/FM/S&B max) — editable. |
| `load_splits` | #4 | `loadId` FK→loads, `partyType` (farmer/landlord), `partyId` (plain — references farmers OR landlords by partyType, so no FK possible), `splitPct`, createdAt. Sum-to-100 contract in `shared/contracts/splits.ts`. |
| `bin_cleanouts` | #12 | `siteId`/`binId` FKs, `emptiedAt` (notNull), `cleanedAt` (null until done), `method`, `note`, `operator`, createdAt/updatedAt. Genealogy reset points. |
| `fumigation_logs` | #19 | `siteId`/`binId` FKs, `product`, `dosage` (free text — units vary by product), `appliedAt`, `exposureHours`, `aerationClearedAt`, `applicator`, `note`, createdAt/updatedAt. |
| `certificates` | #20 | `siteId` FK, `type` (fgis-inspection/weight/phyto/origin/fumigation/mycotoxin/non-gmo/other), `certNumber`, `issuedAt`, `status` (issued/reprinted/void, default issued), `lotId`/`shipmentId` nullable FKs, `note`, `fileRef` (→ attachment storageRef), createdAt/updatedAt. |
| `lab_results` | #22 | `siteId` FK, `sampleDate`, `labName`, `testType` (DON/aflatoxin/protein/gmo/other), `result` (value+unit free text), `passFail` nullable, `lotId`/`binId` nullable FKs, `loadId` plain (like `bin_movements.loadId` — results must survive load changes), `note`, createdAt/updatedAt. |
| `attachments` | #26 | `siteId` FK, `entityType`/`entityId` (plain, like `audit_log` — references whatever entityType names), `filename`, `mime`, `size`, `storageRef` (content-hash filename under `data/attachments/`), `uploadedBy`, createdAt. Append-only. |
| `shrink_entries` | #15 | `siteId`/`binId` FKs, `kind` (moisture/handling/aeration/error-correction), `quantityLbs` SIGNED int, `effectiveDate`, `note`, `operator`, createdAt. Append-only — the "identifiable adjustments" for the DPR. |
| `bin_grade_overrides` | #18 | `siteId`/`binId` FKs, `factor`, `value`, `reason` (required), `operator`, createdAt. Append-only; latest per (binId, factor) wins. |

Audit-friendliness: every site-bound entity carries `siteId`; everything
carries `createdAt`; mutable records (grading tables, cleanouts, fumigation,
certificates, lab results) carry `updatedAt`; append-only logs (splits,
attachments, shrink entries, grade overrides) deliberately don't — a wrong
entry is corrected by a new row, mirroring the bin_movements philosophy.

## 2. New columns on existing tables

| Table | Added |
|---|---|
| `loads` | `foreignMaterialPct`, `sbPct` (nullable — FM is distinct from dockage on the USGSA grid; S&B = shrunken & broken), `program` varchar(32) NOT NULL DEFAULT 'conventional' (denormalized from the lot at intake for reporting, #17) |
| `lots` | `program` (#17), `practices` text, `carbonNotes` text (#31 farm-origin sustainability, free text) |
| `bins` | `program` (#17) |

All nullable or defaulted → existing rows, seeds, and the sync payload
(unchanged) keep working.

## 3. Contracts (`shared/contracts/`)

- `grading.ts` — zod `gradingScheduleSchema` / `gradeFactorSchema` (min ≤ max
  refine), `GRADE_FACTORS` list, `DEFAULT_MOISTURE_SHRINK_PER_POINT = 1.183`,
  `DEFAULT_HANDLING_SHRINK_PCT = 0.5`, `defaultGradingSchedules()` /
  `defaultGradeFactors()` seed data, `applyMoistureShrink()` (linear
  per-point on weight, consistent with `grain.ts`, 99% cap), and
  `validateGradeFactors()` returning below-min/above-max violations.
- `splits.ts` — `loadSplitSchema`, `loadSplitsSchema` (≥1 split, sum = 100
  ±0.01), `splitsSumToHundred()` / `validateLoadSplits()` for the Phase-B API.
- `compliance.ts` — `PROGRAMS` + free-ish `programSchema` (default
  'conventional'), `DEFAULT_RETENTION_YEARS = 6` + `retentionYearsSchema`
  (int 2–10) + `RETENTION_SETTINGS_KEY` (#9 — settings table unchanged),
  plus zod schemas: `binCleanoutSchema`, `shrinkEntrySchema` (non-zero signed
  qty), `binGradeOverrideSchema` (reason ≥ 3 chars), `fumigationLogSchema`,
  `certificateSchema` (+ CERTIFICATE_TYPES / CERTIFICATE_STATUSES),
  `labResultSchema` (must reference a lot, load, or bin), `attachmentSchema`
  (+ `ATTACHMENTS_DIR = data/attachments`).
- `provenance.ts` — new `binGradeAverages(events, loads, binId)` (#18):
  lbs-weighted average moisture/TW/dockage/damage/protein over the grain
  currently in the bin (FIFO layers attributed back to their inbound loads).
  Layers whose load lacks a reading are excluded per factor (`coveredLbs`
  reports coverage); a factor with no readings is null. Computed, not stored.
- `types.ts` — row interfaces for all 10 tables; `program`/`practices`/
  `carbonNotes`/`foreignMaterialPct`/`sbPct` added to LoadRow/LotRow/BinRow.

## 4. Migrations

- **MySQL**: `shared/db/migrations/0003_oval_firelord.sql` (drizzle-kit
  generated, journal + snapshot updated) — 10 tables, 7 columns, 17 FKs,
  all indexes; applied by `migrateOnBoot` as before. FKs on new tables only
  reference sites/bins/lots/loads/shipments — no cycles.
- **SQLite offline mirror**: `sqliteSchema.ts` mirrors everything; fresh
  databases get the tables from `SQLITE_DDL` (CREATE TABLE IF NOT EXISTS —
  existing dev DBs also pick up the new tables on next boot), and the 7 new
  columns land on existing dev DBs via guarded `ALTER TABLE ADD COLUMN` in
  `applySqliteUpgrades()` (ignores "duplicate column name"), same pattern as
  Phase 3. FK enforcement stays MySQL-only.
- **Grading seed**: `shared/api/lib/gradingDefaults.ts` runs inside
  `migrateAndSeedOnBoot` (both apps), inserting plant-wide defaults only for
  crops that have none yet — operator edits are never overwritten, and it is
  independent of the SEED_DEMO demo dataset.

## 5. Tests (+31; 78/78 app, 79/79 office)

- `grading.test.ts` (10) — default schedules match grain.ts base moistures;
  No. 2 corn factor ranges; min>max rejected; 1.183%/point shrink math
  (56,000 lbs @ 17% vs 15% base → 2.37% / 1,327.2 lbs); custom rate; 99%
  cap; factor min/max validation incl. missing-reading/unbounded pass.
- `splits.test.ts` (7) — party-type/range validation; sums of 100 (exact,
  float thirds, single 100%) accepted; 90/110/empty rejected with reported
  total.
- `compliance.test.ts` (9) — retention 2–10 bounds + default 6; program
  default/free text; shrink-entry zero rejected; certificate status enum;
  lab-result lot/load/bin required + passFail enum.
- `provenance.test.ts` (+5) — binGradeAverages weighting, re-weighting after
  a FIFO draw, uncovered-lb exclusion, empty bin, lot-less layers ignored.

## 6. Design decisions

- **Editable grading tables over hardcoded grids** — elevators negotiate
  their own shrink/dock/premium tables; the DB rows are the config, seeded
  once. siteId null = plant-wide default so a site override can layer on
  later without data migration.
- **Free-ish enums** (program, cert type/status, lab testType, shrink kind):
  varchar columns + contract-level constants, so operators are never blocked
  by our vocabulary (per the "keep it simple" brief).
- **Shrink entries are signed and append-only** — matches the DPR
  "readily identifiable adjustments" requirement; corrections are new rows.
- **binGradeAverages is computed** from the event log (no stored averages to
  drift); overrides live in their own append-only table with required reason.
- **program is varchar(32) NOT NULL DEFAULT 'conventional'** on lots/bins/
  loads — existing rows upgrade cleanly to conventional.
- `load_splits.partyId` and `attachments.entityId`/`lab_results.loadId` are
  plain columns (polymorphic or must survive entity changes), consistent with
  the Phase-3 precedent (`audit_log.entityId`, `bin_movements.loadId`).

## 7. Deferred (Phase B+)

- Routers/endpoints for all new entities (CRUD + audit_log writes + operator
  attribution), splits capture at intake, grade-factor validation in the
  grades dialog, certificate/lab/cleanout/fumigation/shrink/attachment UIs.
- Sync of the new tables (and the new columns: program, FM/S&B, practices/
  carbonNotes) to the office portal — EOD package format unchanged in Phase A.
- Attachment upload/download plumbing (`data/attachments/`, content-hash
  storageRefs); `certificates.fileRef` wiring.
- Retention enforcement/exam-mode export using `settings[retentionYears]`
  (only the constant + validation shipped).
- DPR integration that consumes `shrink_entries` as identifiable adjustment
  columns; segregation enforcement at routing (#16) using the program field.
- `binGradeAverages` surfaced in the bin detail UI with override application
  (latest override wins) — contract + storage only this phase.

# Phase C Notes — App-side traceability UI

Commit: `00f1f81` on `main`. All work is in `app/` only — no schema or API changes.
Office portal (Phase D) untouched.

## Verification results

| Check | Result |
|---|---|
| `app` `npm run check` (tsc -b) | PASS (1 unused-import error found and fixed) |
| `app` `npm run test` (vitest) | PASS — 86/86 |
| `app` `npm run build` | PASS (bundle ~1.05 MB, pre-existing chunk-size warning) |
| `office` `npm run check` | PASS |
| `office` `npm run test` | PASS — 88/88 |
| `office` `npm run build` | PASS |
| HTTP walk (fresh offline DB, `GT_FORCE_OFFLINE=1` + temp `GT_OFFLINE_DB_PATH`, vite :3000) | PASS — `/api/health` → `{"ok":true,"mode":"offline"}`; `/` serves HTML; `grading.schedules.list` returns seeded Corn/… schedules; `compliance.retention.get` → `{years:6,defaultYears:6}`; `reports.dprList` → `[]`; `trace.backward {binId:1}` → well-formed empty result. Server stopped, port 3000 confirmed clear, temp DB deleted. |

## Per-feature status

- **#3 Grading settings + factor grid** — DONE. New page `/grading` (schedules + factor grid CRUD, admin-gated via AdminPasswordField, CSV export, QueryError, delete confirms). `GradesDialog` rewritten: FM%/S&B% fields, live `grading.preview` schedule-driven breakdown panel while editing, returned `breakdown` shown in a post-save "Saved" panel; validation errors shown inline (destructive Alert) and toasted.
- **#4 Per-load splits** — DONE. `SplitsDialog` (draft rows, live 100%±0.01 validation, `splits.set`) + compact `SplitsCell`. Wired: "Splits" button per load row in Scale `SheetLoadsCard` and Sheets `SheetDetailDialog`.
- **#5 Daily Product Report** — DONE. `DprSection` on Reports: preview table, regenerate button, frozen DPR list, CSV range export (`reports.dprCsv`).
- **#9 Exam export + retention** — DONE. `RetentionExamSection` on Reports: retention years (2–10, admin-gated `retention.set`), exam export with date range + entity-type checkboxes downloading manifest JSON + per-section CSVs.
- **#12 Cleanout log** — DONE. Bin detail → Compliance tab: cleanout list, Record dialog with residual >500 lbs warning requiring `confirmNotEmpty` + note, "Mark cleaned" completion. Inventory tab shows a genealogy-reset marker where movements cross `cleanoutCutoff`; pre-cutoff rows dimmed.
- **#14 Trace / Recall** — DONE. New page `/trace` (nav item right after Shipments). Backward panel: shipment picker or bin+date, results table, shortfall warning, CSV export (BOM prepended client-side). Forward panel: lot picker or load-id text input, bins table + shipment attribution table, CSV export.
- **#15 Bin mass balance** — DONE. `MassBalanceSection` on Reports: from/to range, per-bin table (opening/received/shipped/transfers/adjustments/shrink/expected/cache variance), flagged variances highlighted with ⚑ badge, per-row physical-count dialog, CSV. Shrink entries UI lives in Bin detail → Compliance (kind, signed lbs, date, note; append-only; CSV).
- **#16 Bin routing suggestion** — DONE. Scale weigh-in (INBOUND only): top-3 `core.bins.suggest` candidates with reasons, "Use" button sets bin choice; silent on error.
- **#17 Program segregation** — PARTIAL. People: Program select in lot create (default conventional), Program column + badge, program filter chips, lot Edit dialog (`people.lots.update`: program/landlord/split/notes). Sheets: Program filter select (`sheets.list` program filter). **DEFERRED: Bins page program UI (filter chips, card badge, add/edit dialog program select) — not implemented; server already accepts `program` on `core.bins.list/create/update`.**
- **#18 Bin grade overrides** — DONE. Bin detail → Grades tab: effective factors table with OVERRIDE badges, set-override form (factor/value/reason ≥3), override history.
- **#19 Fumigation logs** — DONE. Bin detail → Compliance tab: add dialog, list, "Mark aerated" (`aerationClearedAt`), per-row paperclip opening attachments for the `fumigation_log` entity.
- **#20 Certificates** — DONE. New page `/certificates`: type/status filters, registry table, Issue dialog (type/cert no./issued-at/lot/shipment/note + optional file uploaded post-create), Reprint dialog (creates DUPLICATE revision), Void dialog (reason ≥3 chars), per-row Files dialog (AttachmentsControl), CSV export. Page also hosts the site-wide lab-results card.
- **#22 Lab results** — DONE. `LabResultsSection` + `PassFailBadge`: bin-scoped in Bin detail → Compliance; lot/bin-scoped add form and site-wide list on `/certificates`; CSV export.
- **#26 Attachments** — DONE. `AttachmentsControl` (upload via FileReader→base64 with client-side 10 MB pre-check, list, download via `/api/attachments/:id` link, delete confirm). Mounted for `bin`, `fumigation_log`, and `certificate` entity types.

## Deferred / known gaps

1. **Bins page program UI (#17)** — filter chips, badge, add/edit selects not built (see above). Server-side support already exists.
2. **Office portal UI** — Phase D, out of scope.
3. **Lab results / attachments not surfaced on the Shipments page rows** — reachable via Bin detail and `/certificates` only.
4. **Forward trace by load** requires typing the load id (no picker); lot picker is provided.
5. Server CSV responses have no BOM; the UI prepends `\uFEFF` when downloading trace CSVs.
6. App bundle exceeds 500 kB chunk warning (pre-existing; no code-splitting added).

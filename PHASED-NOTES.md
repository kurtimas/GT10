# Phase D Notes — Office portal traceability views + Bins program UI

Final phase. All UI work — no schema, router, or sync-contract changes. The
plant app was already feature-complete after Phase C except one deferral; the
office portal gained read-only views over every Phase-B2 mirror endpoint.

## What changed

### 1. Office portal tabs (`office/src/pages/OfficeHome.tsx` + new `office/src/components/traceTabs.tsx`)

OfficeHome went from 4 tabs to 14. New tab components live in
`traceTabs.tsx`, following the Phase-6 pattern: `QueryError` banner,
right-aligned CSV export bar (`downloadCsv`/`csvDateStamp`), plain read-only
table with empty/loading states. Shared local helpers: `ExportBar`,
`StateRow`, `TabError`, date/size formatters.

| Tab | Endpoint | Notes |
|---|---|---|
| DPR | `office.dpr.list` / `office.dpr.get` | Row-per site×day×crop×program; opening/received/shipped/ending (lb+bu), frozen/open badge; click a row for the full detail card (transfers, all four shrink kinds, manual adjustments, frozen state) with the `ownershipModeled: false` caveat noted. CSV exports every column. |
| Certificates | `office.certificates` | Status badges: issued (default) / reprinted (secondary) / void (destructive); type badge, lot code, note. CSV. |
| Lab results | `office.labResults` | Test-type badge, result, pass/fail badge (pass default / fail destructive / "—" when n/a), lab, lot, bin. CSV. |
| Fumigations | `office.fumigations` | Product/dosage/exposure, aeration badge (aerated / active), applicator. CSV. |
| Cleanouts | `office.cleanouts` | Emptied timestamp, status badge (cleaned + date / pending cleanout), method, operator. CSV. |
| Shrink | `office.shrinkEntries` | Kind badge, signed qty (explicit `+` on positive), effective date, operator. CSV. |
| Grade overrides | `office.gradeOverrides` | Factor badge, value, reason, operator. CSV. |
| Attachments | `office.attachments` | Metadata only — filename/size(human)/entity-type badge/uploaded-by, with an explicit note that binaries stay plant-side and there is no download. CSV. |
| Load splits | `office.splits` | Ticket + load no., party name + (type), split %. CSV. |
| Grading | `office.gradingSchedules` + `office.gradeFactors` | One "Grading" tab with two stacked read-only reference sections (schedules, then factor ranges); plant-wide rows shown as "(all sites)". CSV per section. |

The `TabsList` got `flex h-auto flex-wrap justify-start` so 14 triggers wrap
cleanly instead of overflowing.

### 2. Phase-C leftover — Bins page program UI (`app/src/pages/Bins.tsx`, #17)

- Program dropdown (`PROGRAMS` from `@contracts/compliance`, default
  `conventional`) on both Add-bin and Edit-bin dialogs, wired to
  `core.bins.create`/`update` (server accepted `program` since Phase A).
  Edit initializes from `bin.program`, falling back to `conventional` for
  unknown values.
- Program filter chips above the bin grid ("All" + each program), same chip
  style as People → Lots; filtering is client-side and applies before
  stats/grouping.
- BinCard shows a secondary badge with the program when it isn't
  `conventional` (matches the lot-row badge behavior).

## Verification

| Check | Result |
|---|---|
| `app` `npm run check` (tsc -b) | PASS |
| `app` `npm run test` | PASS — 86/86 (baseline kept) |
| `app` `npm run build` | PASS (pre-existing chunk-size warning) |
| `office` `npm run check` | PASS |
| `office` `npm run test` | PASS — 88/88 (baseline kept) |
| `office` `npm run build` | PASS |
| Live sync walk (both dev servers, fresh DBs) | PASS — 15/15 assertions |
| Headless-Chrome render check | PASS — 14/14 assertions |

### Live sync walk (temporary `verify-phaseD.mjs`, removed after the run)

Office on :3000 (`GT_FORCE_OFFLINE=1`, temp `GT_OFFLINE_DB_PATH`,
`SYNC_KEY`), plant on :3417 (own temp DB). Over real tRPC HTTP the plant got:
an organic bin (`core.bins.create` with `program: "organic"` — the Phase-D UI
payload), an organic lot, a sheet + load weighed 60,000/20,000 lb, grades
(moisture 17.5, TW 56, dockage 2.0, FM 2.1, grade No. 2), 70/30
farmer/landlord splits, a phyto certificate, a DON lab result (pass), a
fumigation, a cleanout (empty seeded bin), a −900 lb moisture shrink entry, a
grade override, and a certificate attachment upload. One seeded in-flight
load was voided so `sheets.closeDay` could run; close froze the DPR and
pushed the EOD package to the office (`push ok=true`). Office-side
assertions, all over HTTP: `office.dpr.list` organic Corn snapshot with
receivedLbs = 40,000 and frozen; `dpr.get` detail; certificate PHYTO-PD-001
status issued; DON 1.2 ppm pass; Phostoxin on PD-Organic; the cleanout; the
−900 lb shrink; moisturePct=16.8 override; attachment metadata
(phyto-pd-001.txt, entity certificate); both 70/30 splits under the ticket;
grading schedules + grade factors mirrored; `office.overview` sees the site.

### Render check (temporary `verify-phaseD-render.mjs`, removed after the run)

Both dev servers rebooted on fresh temp DBs; headless Chrome `--dump-dom`:
office `/` rendered all 14 tab triggers including the ten new ones with no
error overlay; app `/bins` rendered the stat cards and the program filter
chips. Both servers stopped; ports 3000/3417 confirmed clear; temp DBs
removed.

## Known limitations

1. Attachment binaries never sync (by design since Phase B) — the office tab
   shows metadata only, no download link.
2. DPR ownership (storage vs owned) is still not modeled; the detail card
   states this (`ownershipModeled: false`).
3. No site filter UI on the new tabs — endpoints all accept `siteId`, but the
   portal is single-office and rows carry a Site column instead. Add a site
   picker when multi-plant fleets actually land.
4. Office tab list is long (14); grouping (e.g. a Compliance parent tab) is a
   reasonable future polish but was kept flat to stay consistent with the
   Phase-6 pattern.
5. Pre-existing: app bundle chunk-size warning; office dev-server
   `bodyLimit` 500 quirk (from Phase 4) — neither touched here.

Not pushed to GitHub — the parent handles the push to the new GT10 repo.

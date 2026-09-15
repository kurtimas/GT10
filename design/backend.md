# Backend design — schema, routers, seed (main agent graft pass)

Feature set: `--features db` only (operator terminal, no auth).

## Schema (`db/schema.ts`) — Drizzle MySQL
- `sites`: id (serial pk), name text
- `farmers`: id, name
- `lots`: id, siteId FK, farmerId FK, code (e.g. "C-12", "706C-JK-2601"),
  crop ("Corn"|"Soybeans"|"Wheat"), landlordName nullable, splitPct nullable int
- `bins`: id, siteId FK, name, crop, capacityLbs int, currentLbs int
- `sheets`: id, ticketNo unique ("T-00012"), siteId FK, lotId FK,
  direction enum("INBOUND","OUTBOUND"), status enum("OPEN","CLOSED"),
  createdAt, closedAt nullable
- `loads`: id, sheetId FK, seq int (1..10), truckId, firstWeightLbs int,
  secondWeightLbs int nullable, grossLbs int nullable, tareLbs int nullable,
  netLbs int nullable, bushels decimal nullable, binId FK nullable,
  status enum("ON_SCALE","COMPLETE","VOID"), moisture decimal nullable,
  testWeight decimal nullable, createdAt, completedAt nullable
- `activity`: id, ts, kind ("weigh_in"|"weigh_out"|"create"|"close"|"void"|
  "grade"), message text

Types cross the boundary via `typeof table.$inferSelect` re-exported in
`contracts/`.

## Routers (`api/router.ts` + `api/queries/`)
### sheets
- `open` → sheets status OPEN, each: sheet row + lot + farmer + loads
  (ordered by seq) + derived: activeLoad (status ON_SCALE), completedCount,
  netLbs sum, bushels sum.
- `list {limit}` → most recent sheets any status (with lot), for repeat-last.
- `get {id}` → full sheet detail (loads + lot + farmer + bin names).
- `truckTares` → from COMPLETE non-void loads: group by truckId →
  `{ truckId, avgTareLbs, loads }` (tare = tareLbs of each load).
- `dailyReport` → today (local day): inboundLbs/inboundBu (INBOUND complete
  non-void), outboundLbs/outboundBu, loadsWeighedOut, sheetsOpened,
  onScaleCount, binUtilization {pct, totalLbs, binCount},
  hourly [{hour, lbs, loads}] (completed loads by completion hour),
  cropMix [{crop, bu}] (today's completed inbound bu by crop).
- `recentActivity` → latest 30 activity rows, newest first.
- `create {siteId, lotId?, quickLot?{farmerName, crop, landlordName?,
  splitPct?}, direction}` → ticketNo = next `T-%05d`; quick-lot auto code
  `706C-{INITIALS}-{YY}{NN}` (NN = per-farmer sequence); activity row;
  returns new sheet id.
- `weighFirst {sheetId, weightLbs, truckId, binId?}` → guard: sheet OPEN,
  no ON_SCALE load, <10 loads → insert load seq=next, status ON_SCALE,
  firstWeightLbs, truckId, binId; activity.
- `weighSecond {sheetId, weightLbs, binId?}` → find ON_SCALE load; INBOUND:
  gross=first, tare=weight; OUTBOUND: tare=first, gross=weight;
  net=|gross−tare|; bushels = net / test weight by crop (Corn 56,
  Soybeans 60, Wheat 60); set COMPLETE, completedAt; credit bin
  (currentLbs += net for INBOUND, −= net for OUTBOUND, clamp ≥0);
  activity; returns { netLbs, bushels, sheetFull: completedCount>=10 }.
- `voidLoad {loadId}` → status VOID (uncredit bin if was COMPLETE); activity.
- `gradeLoad {loadId, moisture?, testWeight?}` → set grade fields; activity.
- `close {sheetId}` → blocked if ON_SCALE load exists; status CLOSED,
  closedAt; activity.

### core
- `bins.list` → all bins (with site), ordered by name.

## Seed (`db/seed.ts`) — realistic harvest day
- 1 site "Home Farm".
- 8 bins: BIN 01..08 — crops Corn/Soybeans/Wheat, capacities 240k–400k lbs,
  fill 20–95% (at least one >90% crit, one 70–90% warn).
- Farmers: "J. Kowalski", "R. Mendez", "A. Thompson", "D. Weaver".
- Lots with codes; two with landlord + split (e.g. "Hansen Land Co · 33%").
- ~6 CLOSED sheets earlier today with complete loads (spread across hours for
  the throughput chart, mixed crops/directions) → dailyReport has data.
- 3 OPEN sheets: one with 4/10 complete loads; one with a load ON_SCALE
  (truck "KM-04", first weight 81,250); one fresh 0/10.
- Truck tare history so "USUAL TARE" lines show (KM-04 ~29,400 avg / 6 loads,
  plus 3–4 more trucks).
- Activity rows matching the seeded events.

Crop test weights: Corn 56, Soybeans 60, Wheat 60 lbs/bu.

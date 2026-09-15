# Dashboard page — full anatomy & behavior (transcribed from spec §4–§8)

## Data the page loads (spec §4)
| Query | Poll | Used for |
|---|---|---|
| `trpc.sheets.open` | every 15 s | list of OPEN sheets (right column + selected sheet) |
| `trpc.core.bins.list` | every 15 s | bin % strip, bin suggest, bin dropdown, overview utilization |
| `trpc.sheets.truckTares` | on mount | truck-ID autocomplete + usual-tare memory |
| `trpc.sheets.list` `{limit:1}` | on mount | "Repeat last load" |
| `trpc.sheets.dailyReport` | every 15 s | quick stats + Operations overview |

After every weigh/create action invalidate all six: `sheets.open`,
`sheets.list`, `core.bins.list`, `sheets.dailyReport`, `sheets.truckTares`,
`sheets.recentActivity`.
Mutations: `sheets.create`, `sheets.weighFirst`, `sheets.weighSecond`
(plus `sheets.get` fetch for auto-print).

Local state: `selectedId`, `newOpen` (dialog), `detailId` (dialog),
`manualWeight`, `truckInput`, `binInput` ("auto" or a bin id), `printCtx`,
`soundOn` (persisted localStorage `gt-sound`, default ON), `autoPrint`
(localStorage `gt-autoprint`, default OFF). `useNow(30000)` re-render.

## Page anatomy (spec §5) — page root is `space-y-4`, sections in this order:

### 5.1 Header (kit/PageHeader)
- Eyebrow row: cyan live LED + `Scale operations · {Weekday, Month D}`
  (e.g. "Scale operations · Tuesday, August 18").
- Title: **Scale Dashboard**, extra-bold, text-2xl→3xl.
- Actions (right):
  - "Repeat last load" — large outline button, Copy icon, TEST badge (§7.8).
  - "New sheet" — large primary button, Plus icon, small `<kbd>N</kbd>` hint
    chip (hidden on small screens). Opens NewSheetDialog.

### 5.2 Error banner
If the open-sheets query fails: red left-border alert strip — CircleAlert
icon, monospace uppercase label "Cannot reach server — the database may still
be initializing", truncated error message, outline Retry button.

### 5.3 Bin levels strip (only when ≥1 bin exists)
Horizontal gt-panel in two parts:
- Left block (bordered right, tinted secondary background): tone-colored LED
  (green/amber/red), eyebrow "Bins filled", overall fill % — big
  (text-2xl font-black) monospace number colored by tone.
- Right grid (`grid-cols-2 → sm:3 → xl:6`): one cell per bin — bin name
  (truncated) left, tone-colored % right, below a thin (h-1.5) rounded
  progress bar on secondary track, filled width = pct%, fill color by tone,
  500 ms width transition. Hover tooltip: `{name} · {crop} · {pct}% full`.
- Overall % = total current lbs ÷ total capacity lbs across all bins.

### 5.4 Quick stats (3 StatCards, grid-cols-3)
1. Open weight sheets — count, primary (blue) tone.
2. Loads completed today — count, green tone.
3. Net lbs in today — formatted lbs (inbound completed loads only), default.

### 5.5 Main two-column work area (`grid lg:grid-cols-5`)

LEFT column (`lg:col-span-3`, vertical stack):

(a) **ScalePanel** — gt-panel:
- Header bar (bottom border): green/cyan/gray LED + eyebrow showing
  connection mode ("Scale link · serial" / "· simulator" / "· offline"), plus
  a 4-bar signal-strength graphic (bars light up green when live; top two
  bars require a stable reading). Right side mode buttons: "Connect USB
  scale" (Cable icon, shown unless already serial), "Simulator"
  (FlaskConical icon, shown unless simulating), "Disconnect" (ghost, shown
  when connected).
- Readout: inset terminal — `gt-scan` rounded box, corner brackets in all
  four corners (technical-drawing frame), centered giant weight
  (text-6xl md:text-7xl, monospace, toLocaleString). Shows `––––––` when
  offline. Below: "lbs" + status LED with "stable" or "reading…". Colors:
  offline = dim gray; live-unstable = cyan border/text with subtle cyan glow;
  stable = green border/text with green inner+outer glow (150 ms transition).
- Serial error: red left-border monospace message under the readout.
- Simulator controls (only in simulator mode): bordered sub-panel, eyebrow
  "Simulated truck weight", current value, Slider (0–90,000 lbs, step 500),
  quick-set buttons: "Empty truck 29,500", "Loaded truck 81,250", "Zero 0".
  Simulated weight = base ± random noise (±30 lbs) every 400 ms.

(b) **Manual weight entry** — only when disconnected. Slim gt-panel: eyebrow
"Manual weight entry" + number Input (monospace, max-width 44, placeholder
"lbs"). The manual value becomes the capture weight.

(c) **BIG capture buttons** — directly under the scale block. Two giant
buttons side by side (grid-cols-2 gap-4), each h-32 md:h-40, monospace,
uppercase, extra-bold, tracking wide, big icon above label:
- WEIGH IN (ArrowDownToLine): active style green border + green fill +
  dark-green text + green glow; press animation `active:translate-y-0.5`.
  Enabled only when a sheet is selected AND no load on the scale AND not
  saving. When active and a weight is present, show the live weight
  ("81,250 lbs") as a smaller line inside the button.
- WEIGH OUT (ArrowUpFromLine): same in primary blue; enabled only when a
  load IS on the scale.
- Inactive style: muted secondary background, dimmed text,
  cursor-not-allowed.
- Label adaptation: INBOUND sheets read "WEIGH IN" / "WEIGH OUT"; OUTBOUND
  sheets read "WEIGH IN (EMPTY)" / "WEIGH OUT (LOADED)".

(d) **Operator toggles strip** — gt-panel flex row:
- Keyboard hint: Keyboard icon + `Space = capture · N = new sheet` + TEST.
- NodeToggle "Sound cues" + TEST badge (default ON, persisted).
- NodeToggle "Auto-print ticket" + TEST badge (default OFF, persisted).

(e) **Selected-sheet context panel** — box with 2px left border: solid
primary + faint primary tint when a sheet is selected; dashed gray border
when none.
- Empty state: centered monospace uppercase — "Select a weight sheet — or
  press N to start one from a lot".
- Selected: header row = ticket number (large monospace bold) + StatusBadge;
  underneath: `Farmer name · Lot {lotCode} · {crop}` and if a landlord exists
  `· {landlord} {splitPct}%`. Right side (monospace, right-aligned):
  `LOADS n/10` and `NET x lbs`.
- LoadSlots bar (10 segments).
- Previous loads list: bordered monospace rows, one per load — load number,
  truck icon + truck ID, gross − tare, bold green net lbs, bin name (or "no
  bin"). A load still on scale shows pulsing "on scale · {weight} lbs".
  Completed loads with no moisture grade yet get a small "needs grade" chip.
- Next-load inputs (only when no load on scale), two columns:
  - Truck ID: Input, monospace, placeholder "e.g. KM-04 Peterbilt", with
    `<datalist id="known-trucks">` autocomplete fed from tare memory.
  - Bin: Select. First option "Auto → {suggested bin name}"; then every bin
    at the selected sheet's site as `{name} · {crop} ({pct}%)`.
- Tare memory / estimate line (small monospace): known truck →
  `USUAL TARE {truckId}: {avg} lbs ({n} loads)` + TEST badge. While weighing
  out → `EST NET {lbs} lbs → {suggested bin}` + TEST badge.

RIGHT column (`lg:col-span-2`) — **Open weight sheets** panel: gt-panel,
header (eyebrow "Open weight sheets" + count), scrollable
(max-h-[560px]) divided list.
- Empty state: "No open sheets — press N when a farmer pulls in".
- Each row: clickable block with 3px age border on left — red if open
  ≥ 60 min, primary blue if ≥ 30 min, transparent otherwise. Selected row:
  faint primary background + inset ring; others highlight on hover.
  - Main click area (selects sheet): farmer name (bold, truncated) + ticket
    number; second line: lot-code chip (bordered monospace), crop, Clock
    icon + open time + age ("just now", "42m", "2h 5m").
  - Right side: StatusBadge, "needs grade" chip if any completed load lacks
    moisture, small DETAILS text-button → SheetDetailDialog.
  - LoadSlots bar.
  - Bottom status line (monospace, muted): truck on scale → primary-colored
    `{truckId} on scale · {lbs} lbs — awaiting weigh-out`; otherwise
    `net {lbs} lbs · {bu} bu · ready for next truck` (last clause only when
    under 10 loads).

### 5.6 Operations overview (collapsible, below work area)
Full-width collapsible; open/closed persisted in localStorage
`gt-ops-overview`, default open. Toggle bar = gt-panel button: cyan LED +
"Operations overview · today" + chevron. When open (skeleton loading +
retryable error banner):
1. KPI strip (5 StatCards, grid-cols-2 md:3 xl:5): Inbound today (lbs, sub
   "x bu received", green), Outbound today (lbs, sub "x bu shipped"), Loads
   weighed out (count, sub "n sheets opened today", green), On the scale
   (count awaiting weigh-out, primary when >0), Bin utilization (%, sub
   "x lbs in n bins", primary when >90%).
2. If no loads yet: empty state — "No loads yet today / Once the first truck
   weighs in, this overview starts tracking throughput."
3. Hourly throughput chart (3/5 width) + Crop mix donut (2/5 width).
4. Bin utilization board (3/5 width) + Activity feed (2/5 width).

### 5.7 Dialogs and print layer
- NewSheetDialog — create weight sheet (site, farmer/lot or quick-lot with
  auto lot code `706C-{INITIALS}-{YY}{NN}`, crop, direction, landlord split).
  On success the new sheet is auto-selected.
- SheetDetailDialog — full sheet view: every load, per-load void, grading
  (moisture/test weight), Close sheet (confirm dialog; blocked while a truck
  is on the scale), ticket reprint.
- TicketPrint — print-only; when `printCtx` set, renders scale ticket
  offscreen and `printTicket()` triggers browser print after 150 ms.

## Weigh workflow state machine (spec §6)
`stage` derived from selected sheet:
| Stage | Condition | Meaning |
|---|---|---|
| none | no sheet selected | both buttons disabled |
| first | sheet selected, no active load | WEIGH IN enabled (green) |
| second | sheet selected, activeLoad ≠ null | WEIGH OUT enabled (blue) |

Capture weight = scale reading when connected, else manual-entry number.
- WEIGH IN (`sheets.weighFirst`): requires truck ID; sends sheet id +
  rounded weight + truckId + binId (chosen bin, or auto-suggested when
  "Auto").
- WEIGH OUT (`sheets.weighSecond`): sheet id + rounded weight + binId. On
  success: toast "Load complete — net X lbs (Y bu)", capture beep; if sheet
  just hit 10/10 → 10-second warning "Sheet full…" and selection
  auto-advances to next open sheet; if auto-print on → fetch sheet and print
  last completed load's ticket.

## Operator-assist behaviors (spec §7) — all guarded, never blocking unless noted
1. **No-weight guard**: button pressed with zero/no weight → error toast
   "No weight to capture — connect the scale or enter a weight manually."
2. **Truck ID required**: WEIGH IN without truck ID → error toast, mutation
   not sent.
3. **Tare memory**: `sheets.truckTares` → "USUAL TARE …" + autocomplete.
4. **Tare-deviation warning**: when the capture is the tare reading
   (weigh-out for inbound, weigh-in for outbound) and deviates >3%
   (`TARE_TOLERANCE = 0.03`) from the truck's average → warn beep + 8 s
   warning toast "…differs N% from this truck's usual X lbs — verify the
   truck is empty." Non-blocking.
5. **Duplicate-truck guard**: weighing in a truck ID already on the scale on
   another open sheet → warn beep + 8 s warning "{truck} is already weighed
   in on {ticket} — make sure this isn't a duplicate." Non-blocking.
6. **Bin auto-suggest**: among bins at the sheet's site holding the sheet's
   crop, sorted least-filled first; if an estimated net exists, first bin
   with enough remaining capacity, else least-filled. Shown as
   "Auto → {name}".
7. **Estimated net**: inbound = first weight − usual tare (if known);
   outbound = current capture − first weight. Shown as "EST NET …".
8. **Repeat last load**: look at most recent sheet. If still OPEN → select
   it and prefill its last truck ("Selected T-00012 — truck prefilled"). If
   closed and it had a lot → create NEW sheet on same site/lot/direction,
   select it, prefill truck. Errors toasted otherwise.
9. **Sheet-change prefill**: whenever selected sheet (or its load count)
   changes, truck field prefilled with sheet's last truck ID and bin resets
   to "Auto".
10. **Auto-advance on full sheet and auto-print** per §6.

## Keyboard, sound, timing (spec §8)
- Global keys: `Space` or `Enter` = capture for current stage (acts like
  pressing the enabled big button); `N` = open New Sheet. Ignored while
  typing in input/textarea/select/contenteditable, while any dialog open,
  while a save in flight, or with nothing selected. `preventDefault` on
  handled keys.
- Sounds (WebAudio, gated by Sound cues toggle): `stableBeep` 990 Hz/70 ms
  once each time the reading transitions to stable; `captureBeep` on
  successful weighs; `warnBeep` 220 Hz/250 ms on tare/duplicate warnings.
- Stability: rolling window of last 8 readings; stable when ≥6 readings and
  max−min ≤ 25 lbs.
- Serial: 9600 baud, 8N1. Poll: open sheets / bins / daily report 15 s;
  clock 30 s; simulator 400 ms.

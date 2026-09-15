# BRIEF — Live Yard Board page (Grain Tracker v2) — FOLLOW EXACTLY

A NEW ops page: an at-a-glance board of everything on site RIGHT NOW — trucks mid-cycle on the lot, scale occupancy, rising bin fills, overdue alerts. It complements the weigh console; the operator glances at it between trucks. Desktop 1440, harvest (light) mode. Render ALL content INSIDE the `AppShell` component's `content` slot with props `activeItem="scale"`, `pageTitle="Scale — Live Yard Board"`. Same tokens/CSS as the attached wizard draft: copy the `:root` tokens verbatim (primary deep forest green hue 160, cream ground, gold capture only, amber live, field green stable, red crit — no hue between 180 and 360). Fonts `'Inter'` + `'JetBrains Mono'` (space in the name), tabular-nums on all numbers. Reuse the same `.gt-panel / .gt-eyebrow / .gt-scan / .gt-led / .btn-capture` style definitions. Fill tone semantics: <70% stable green, 70–90% amber live, >90% crit red.

## Page content (inside the slot), top → bottom, `space-y-4`

### 1. KPI strip — `grid grid-cols-4 gap-4`, four `.gt-panel p-4` tiles, each: eyebrow label, mono `text-3xl font-bold` value, mono 11px sub-line
- **Trucks on lot** — value **3** in amber (live), sub `2 mid-cycle · 1 overdue`
- **Scale** — value **OPEN** in field green, sub mono `Empty · last: TRK-22 13:51` — the tile has a small gold LED + right-aligned outline pill `EMPTY`
- **Loads today** — value **12** forest, sub `sheet WS-2026-0142 · 4/12`
- **Bushels today** — value **2,481.5** forest with `bu` at 60%, sub `+238.4 last hour`

### 2. Main grid — `grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4 items-start`

**LEFT — Trucks on the lot** `.gt-panel`: header eyebrow **TRUCKS ON THE LOT** + right mono xs muted `3 on site · shift started 07:00`. Three truck rows separated by 1px borders, each row `p-4 flex items-center gap-4`:
- Row 1 — amber pulsing LED; truck `TRK-14` mono `text-lg font-bold`; driver `M. Okafor` text-xs muted; state pill outline mono 10px uppercase **AT THE SCALE** (amber); middle mono xs: `gross 45,230 lb · 14:18`; right side: destination mini bin graphic (24×56 outline, 62% amber fill) + `Bin 3` mono xs + elapsed mono `00:00:42`; far right a small gold `.btn-capture` button `h-10 px-4 text-sm font-bold` **WEIGH OUT**.
- Row 2 — amber pulsing LED; `TRK-31`; driver `R. Vance`; pill **DUMPING** (amber); `gross 41,905 lb · 14:02`; mini bin 14% green fill `Bin 7`; elapsed `00:11:03`; far right an outline button `Wait` (disabled-looking, muted).
- Row 3 — RED crit LED, row background tint `bg crit/5` with a 3px crit left border; `TRK-22`; driver `—`; pill **OVERDUE** (crit); `gross 43,780 lb · 12:26`; mini bin 91% red fill `Bin 2`; elapsed mono crit bold `00:47:12`; under the row a thin amber note strip: triangle-alert + mono 10px uppercase crit `Overdue — on the lot longer than 45 min. Check the pit or radio the driver.`

**RIGHT column `space-y-4`:**
a) **Scale instrument** `.gt-panel`: header eyebrow **SCALE** + outline pill with gold LED **EMPTY**. Body: `.gt-scan px-6 py-5` with muted cream/40 mono `text-5xl font-bold` **0** + `lb`; source line mono 10px cream/60 **No truck on the deck · sensor clear**; under it a mono xs row: `Next up: TRK-31 after dump · TRK-44 checked in 14:02` and a small radar-node toggle `Auto-assign` (on — gold dot glowing).
b) **Bin fills** `.gt-panel`: header eyebrow **BIN FILLS** + right outline mono badge `6 BINS`. Four rows, each: mono xs bin label left, right mono xs pct + 6px LED; below a full-width 6px rounded track with fill:
- `Bin 3 · Corn` — **82%** amber (live LED), fill amber 82%
- `Bin 2 · Milo` — **91%** red (crit LED), fill crit 91%
- `Bin 7 · Soybeans` — **14%** green (stable LED), fill stable 14%
- `Bin 5 · Wheat` — **58%** green (stable LED), fill stable 58%
Footer strip inside the card: amber chip mono 10px uppercase `Bin 3 at 82% — about 2 loads to full` and crit chip `Bin 2 nearly full — call the mill`.

### 3. Activity ticker — full-width `.gt-panel px-4 py-3` with a `.gt-ticker` marquee (masked edges, 48s linear infinite, pauses on hover)
Mono 11px items separated by wide gaps, each with a small colored LED dot: `13:51 TRK-22 OUT 13,130 lb · 234.5 bu → Bin 2` (green) · `13:07 TRK-14 OUT 14,970 lb · 267.3 bu → Bin 3` (green) · `14:02 TRK-31 IN 41,905 lb gross` (amber) · `12:26 TRK-22 IN` (amber) · `12:02 Sheet WS-2026-0141 closed · 12 loads` (forest). On the right of the ticker header row: outline amber badge with cloud-off icon `1 WEIGH QUEUED OFFLINE`.

## Rules
Use ONLY the fonts, colors, spacing and component styles defined in the design system and the tokens above. Do not introduce any fonts, colors or visual styles not in the design system. Keep the AppShell component. Real domain content only — tickets `WS-YYYY-NNNN`, trucks `TRK-NN`, no lorem ipsum.

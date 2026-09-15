# BRIEF — Truck Cycle Wizard page (Grain Tracker v2) — FOLLOW EXACTLY

Rebuild this page from scratch. The previous version was wrong: invented crimson/red theme, showed step 1 instead of step 4, placed content outside the AppShell, broke the mono font name.

## Tokens — copy VERBATIM into :root (harvest light mode; do NOT add a `.day` class or a dark default)
```
--background: 42 38% 94%; --foreground: 160 20% 12%; --card: 0 0% 100%; --card-foreground: 160 20% 12%;
--primary: 160 38% 18%; --primary-foreground: 42 38% 94%; --secondary: 42 30% 90%; --secondary-foreground: 160 20% 12%;
--muted: 42 20% 88%; --muted-foreground: 160 10% 40%; --accent: 42 96% 58%; --accent-foreground: 160 38% 12%;
--border: 42 20% 85%; --input: 42 20% 80%; --ring: 160 38% 18%; --radius: 0.75rem;
--stable: 142 45% 36%; --live: 38 92% 42%; --go: 42 96% 52%; --crit: 0 84% 45%; --readout: 160 38% 8%;
```
- Primary = DEEP FOREST GREEN (hue 160). Gold `--go` only for capture buttons/attention. Amber `--live` for live readings and trucks on the lot. Field green `--stable` for stable/complete. Red `--crit` only for critical. **No hue between 180 and 360.** No blue, purple, cyan, pink, crimson.
- Body font `'Inter'`. Every number and data label: `'JetBrains Mono'` (family name has a SPACE) with `tabular-nums`. Google Fonts import for both.
- Page ground cream `hsl(42 38% 94%)` + faint wheat radial wash: `radial-gradient(1200px 520px at 50% -10%, hsl(42 60% 70% / .14), transparent 65%)`.
- `.gt-panel`: `border:1px solid hsl(var(--border)); background:hsl(var(--card)); border-radius:0.75rem; box-shadow:0 4px 20px -2px hsl(42 30% 30% / .1)`.
- `.gt-eyebrow`: JetBrains Mono 10px 600 uppercase letter-spacing .18em color muted-foreground.
- `.gt-scan` readout: `background:hsl(var(--readout))`, border 1px hsl(var(--border)), rounded-md, plus a `::after` overlay `repeating-linear-gradient(0deg, hsl(0 0% 100% / .03) 0 1px, transparent 1px 3px)`. Digits glow: `text-shadow: 0 0 10px <color / .55>, 0 0 30px <color / .25>`. Eyebrows on the dark surface use `hsl(42 30% 90% / .65)`.
- `.gt-led`: 6px round; `-on` green stable, `-live` gold, `-warn` amber, `-crit` red; each with glow `0 0 6px c/.9, 0 0 14px c/.45` and a 1.5s opacity pulse.
- Gold capture button: `background-color:hsl(42 96% 52%); background-image:linear-gradient(180deg, hsl(48 100% 70% / .45), hsl(42 96% 52% / .08) 52%, hsl(34 90% 34% / .22)); color:hsl(160 38% 10%)` (forest ink — NOT white); `box-shadow: inset 0 1px 0 hsl(0 0% 100% / .35), 0 4px 14px hsl(42 96% 50% / .35)`; rounded-md; font-bold.
- Buttons: default = forest `bg primary / cream text` h-9 rounded-md; outline = 1px border input, transparent; ghost = no border. Badges: outline, rounded-md, mono 10px uppercase, px-2.5 py-0.5.

## Shell
Render ALL page content INSIDE the `AppShell` component's `content` slot with props `activeItem="scale"`, `pageTitle="Scale — Truck Cycle"`. Do NOT add a second `<main>` with a left margin — the shell already provides sidebar, header and the padded 1400px main area. Desktop 1440 wide.

## Page content (inside the slot), top → bottom, `space-y-4`

### 1. SheetSummary strip — `.gt-panel p-4 flex flex-wrap items-center gap-x-4 gap-y-2`
- mono `text-2xl font-black` forest: **WS-2026-0142**
- outline badge **INBOUND** — border `hsl(var(--live)/.6)`, text amber
- `text-base font-semibold` **Halvorsen Farms**, then mono xs muted **LOT-07**
- outline badge **CORN** — `border live/40, bg live/10, text live`
- outline badge with pulsing amber LED: **ON THE LOT · TRK-14**
- far right (`ml-auto`): mono xs muted **4/12 loads** + 96px×6px rounded track (`bg secondary`) with forest fill at 33%

### 2. Step rail — `.gt-panel px-6 py-4`, five equal columns separated by 1px border lines
Each column: 24px round marker + mono uppercase 11px label + mono 11px sub-value.
1. **IDENTIFY TRUCK** — complete — marker filled field-green with white check; sub `TRK-14 · M. Okafor`
2. **WEIGH IN** — complete — sub `45,230 lb · 14:18`
3. **DUMP AT BIN** — complete — sub `Bin 3 · Corn`
4. **WEIGH OUT** — CURRENT — marker gold with pulsing glow, label bold forest with 2px gold underline; sub `reading…` in amber
5. **TICKET** — upcoming — marker outlined muted, label muted; sub `—`

### 3. Body grid — `grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 items-start`

**LEFT column (`space-y-4`)**
a) **Scale readout** `.gt-panel` — header row: eyebrow "Scale readout" left; right pill = amber LED + mono xs uppercase amber **LIVE**. Body: `.gt-scan px-6 py-5` with amber glowing mono `text-6xl font-bold tabular-nums tracking-tight` **31,880** followed by `lb` `text-xl font-medium` at 60% cream; below, mono 10px uppercase cream/60 **USB scale · settling**. Under the readout a row: outline mono badge **SCALE LINKED**, and an outline button **Simulator** with an 18px radar-node ring (1px muted border, empty center = off).
b) **This cycle** `.gt-panel` — eyebrow header; rows (label eyebrow left, mono value right): Truck **TRK-14**; Driver **M. Okafor**; then a `.gt-scan` strip row `px-4 py-3 flex justify-between`: eyebrow "Gross captured · 14:18:42" left, amber mono `text-xl font-semibold` **45,230 lb** right; Destination row **Bin 3 · Corn · 62% full** with a 24×56px rounded outline bin graphic filled 62% amber from the bottom; On the lot row mono **00:13:25**.

**RIGHT column — the work card `.gt-panel p-6 space-y-5`**
- eyebrow **Step 4 of 5 — Weigh out**
- h2 `text-2xl font-semibold` **TRK-14 is back on the scale**
- Net preview block `.gt-scan p-5`: eyebrow (cream/65) "Net preview"; flex baseline row: field-green glowing mono `text-5xl font-bold` **13,350** + `lb` xl at 60%, then mono `text-2xl` cream/80 **238.39 bu**; under it mono 11px cream/50 **45,230 gross − 31,880 tare**
- GIANT gold capture button `h-20 w-full text-2xl font-bold rounded-md`: **WEIGH OUT — 31,880 lb**
- mono 11px muted: *Captures the tare, computes net, credits Bin 3 and moves to Ticket.*
- amber guard chip `rounded-md border hsl(38 92% 60% / .4) bg hsl(38 92% 60% / .1) px-3 py-2 flex gap-2`: triangle-alert icon amber + mono xs amber: **Tare is 3% heavier than TRK-14 last tare (30,940 lb) — check the box is empty.**
- bottom row `flex items-center gap-2`: outline button **Back to Dump at bin**, ghost button **Cancel cycle**, right-aligned (`ml-auto`) mono 11px muted **Space = capture**

### 4. Today on this sheet — `.gt-panel`
Header eyebrow "Today on this sheet" + right mono xs muted "3 complete · 41,060 lb · 733.21 bu". Compact table, mono xs tabular, numeric columns right-aligned, header cells eyebrow-styled, rows separated by 1px border:
| Load | Truck | Time | Gross lb | Tare lb | Net lb | Net bu | Bin |
| 3 | TRK-09 | 13:51 | 44,120 | 31,160 | 12,960 | 231.43 | Bin 3 |
| 2 | TRK-14 | 13:07 | 45,910 | 30,940 | 14,970 | 267.32 | Bin 3 |
| 1 | TRK-22 | 12:26 | 43,780 | 30,650 | 13,130 | 234.46 | Bin 2 |

## Rules
Use ONLY the fonts, colors, spacing and component styles above / in the design system. Do not introduce any fonts, colors or visual styles not in the design system. Keep the AppShell component. Real domain content only — no lorem, no invented ticket formats (tickets are `WS-YYYY-NNNN`, trucks `TRK-NN`).

# Grain Tracker v2 — Design System ("Harvest Modern")

## 1. Product context

**Grain Tracker v2** is a scale-house operations console for a grain elevator. One operator, one truck scale, many trucks. The operator opens a **weight sheet** (a ticket) for a farmer's lot, presses **WEIGH IN** when a truck drives onto the scale, **WEIGH OUT** when it returns; the system computes **net lbs → bushels**, credits the destination **bin**, and can print a scale ticket. Runs on a desktop/touch terminal in the scale house window, all day, harvest season, day and night shift. Offline-tolerant: weighs captured while the server is unreachable are queued and replayed.

**Jobs to be done**
- Weigh a truck in two presses with zero ambiguity about which ticket/truck it belongs to.
- Know at a glance what's on the lot right now: trucks mid-cycle, scale occupied or empty, bins filling up.
- Never lose a weigh (offline queue), never mis-assign a load (guards + warnings, not hard stops).
- Read numbers from across the room: glowing mono readouts, LEDs, big gold capture buttons.

**Design principles (from the rebuild spec):** big touch targets · glanceable status · minimal typing · recovery from mistakes · instrument-panel honesty (state is always visible, never hidden in a menu).

## 2. Architecture & key pages

App shell = fixed **left rail** (w-60, deepest forest, always dark in both modes) + **header** (eyebrow "Grain Tracker v2" + page title; operator picker, site picker, night toggle, live mono clock chip) + scrollable main (`max-w-[1400px] p-6`).

Nav (in order): Dashboard `/` · Scale `/scale`, `/scale/:sheetId` · Weight Sheets `/sheets` · Shipments `/shipments` · Bins `/bins` · Farmers & Lots `/people` · Reports `/reports` · Audit Log `/audit`.

**Scale console (`/scale/:sheetId`)** — the anchor for all weigh-domain screens: SheetSummary strip (huge mono ticketNo, INBOUND/OUTBOUND badge, farmer, lot, crop badge, "On the lot · TRK-14" amber LED badge, loads progress bar) → grid `2fr | 3fr`: **ScalePanel** (gt-scan readout with glowing 6xl digits, STABLE/LIVE/NO SIGNAL LED, source line, connect/simulator/manual controls) | **WeighConsole** (truck ID + driver inputs, destination bin select "Auto — least-filled Corn bin", h-14 gold `WEIGH IN — 45,230 lb` button; when a truck is on the lot: CapturedStrip "Gross captured · TRK-14  45,230 lb" + forest `WEIGH OUT` button) → **Loads table** (Load, Truck, Time, Gross lb, Tare lb, Net lb, Net bu, Bin, Grades; mid-weigh rows tinted `bg-live/5` with "on the lot" badge).

**Domain vocabulary** — Weight sheet / ticket (`WS-2026-0142`), direction INBOUND (gross first, tare second) or OUTBOUND (tare first), status OPEN / FULL / CLOSED, `completedLoads/maxLoads`. Load: loadNo, truckId (`TRK-14`), driver, grossLbs, tareLbs, netLbs, netBushels, bin, moisture %, grade. Crops: Corn, Wheat, Soybeans, Sorghum/Milo. Bins: name, crop, capacity, current lbs, % full (tone: <70 stable, 70–90 warn/live, >90 crit). Trucks "on the lot" = weighed in, not yet weighed out. Scale sources: USB scale (Web Serial), Simulator, Manual entry. Weights are whole lb comma-grouped (`45,230`), bushels 2dp.

## 3. Visual language

### Palette — harvest (light, default)
Field-day palette: **cream ground, ivory cards, deep forest ink & primary, wheat gold instrument color.**

| Role | HSL | Tailwind |
|---|---|---|
| Page ground | 42 38% 94% (light cream, faint wheat radial wash from top) | `bg-background` |
| Text | 160 20% 12% dark forest ink | `text-foreground` |
| Card | 0 0% 100% ivory | `bg-card` / `.gt-panel` |
| Primary | 160 38% 18% deep forest green | `bg-primary text-primary-foreground` |
| Secondary | 42 30% 90% warm putty | `bg-secondary` |
| Muted fg | 160 10% 40% | `text-muted-foreground` |
| Accent | 42 96% 58% wheat gold | `bg-accent` (hover) |
| Border / input | 42 20% 85% / 42 20% 80% warm tan | `border-border`, `border-input` |
| Sidebar | bg 160 38% 12%, fg 42 30% 90%, primary gold 42 96% 58%, accent 160 30% 18%, border 160 20% 20% | `bg-sidebar …` |

### Signal tokens (semantics never change between modes)
| Token | Harvest | Night | Use |
|---|---|---|---|
| `stable` | 142 45% 36% field green | 142 48% 52% | stable reading · complete · positive · server online LED |
| `live` | 38 92% 42% amber | 42 96% 62% | moving telemetry · truck on the lot · INBOUND · warn fill |
| `go` | 42 96% 52% wheat gold | 42 96% 58% | **CAPTURE** — WEIGH buttons, attention, active nav, Wheat crop |
| `crit` | 0 84% 45% red | 0 85% 60% | overdue · critical · offline · >90% bin |
| `readout` | 160 38% 8% | 160 32% 5% | inset dark-forest instrument ground |

### Night mode (`.night`)
Forest-dark console: ground 160 22% 7%, card 160 18% 10%, primary lit-forest 152 32% 40%, border 160 12% 20%, ring gold, faint forest + gold radial glows. Sidebar stays deepest forest. All signal semantics identical.

### Typography
- **Inter** for UI text (feature-settings cv02/cv03/cv04). Sizes: page title `text-lg font-semibold`; body `text-sm`; helper `text-xs`/`text-[11px]`.
- **JetBrains Mono** for *every* number and label-as-data: readout digits, ticket numbers (`text-2xl font-black`), truck IDs, timestamps, table numerics — always `tabular-nums`.
- `.gt-eyebrow` — JetBrains Mono 10px semibold UPPERCASE, letter-spacing 0.18em, muted. The header of every panel and every section label.
- Readout hierarchy: 5xl→6xl bold digits + `text-xl font-medium` unit at 60% opacity; captured values `text-xl font-semibold text-live`.

### Shape, surface, depth
- Radius base **0.75rem** (`rounded-lg`); inner elements `rounded-md`; pills `rounded-full`; badges `rounded-md`.
- **`.gt-panel`** — ivory card, 1px warm border, soft warm shadow `0 4px 20px -2px hsl(42 30% 30% / .1)`; night: inset top gloss + deep drop.
- **`.gt-scan` / `bg-readout`** — the instrument screen: dark forest inset, 3px scanline overlay, digits glow (`text-shadow 0 0 10px / 0 0 30px` in the digit color). Eyebrows on readout surfaces render in `sidebar-foreground/65`.
- **Gold capture button `bg-go`** — gold body with vertical gloss gradient, forest-ink text, inset white top highlight, wide gold glow shadow; `h-14 w-full text-lg font-bold`, label pattern `WEIGH IN — 45,230 lb`. Weigh-out uses forest `bg-primary` at the same size.
- **LEDs `.gt-led`** — 6px dots: `gt-led-on` green, `gt-led-live` gold, `gt-led-warn` amber, `gt-led-crit` red; glow + `gt-pulse` breathing (1.5s; crit 1.1s).
- `.gt-radar` — gold conic radar sweep (logo badge / live indicator). `.gt-node` — 18px radar-dot toggle (replaces switches). `.gt-ticker` — masked marquee status ticker.
- Badges: `variant="outline"` mono `text-[10px] uppercase`; crop tints via `cropBadgeClass` (Corn amber/live, Wheat gold/go, Soybeans green/stable, Sorghum forest/primary). Direction: INBOUND `border-live/60 text-live`, OUTBOUND `border-primary/60 text-primary`.
- Progress bars: `h-1.5 rounded-full bg-secondary` track, `bg-primary` fill, `transition-[width] duration-500`.
- Warning chip (offline queue): `border-[hsl(38_92%_60%)]/40 bg-[hsl(38_92%_60%)]/10` amber with CloudOff icon and mono uppercase text.
- Error strip (QueryError): `border-l-4 border-l-crit bg-crit/10`, mono uppercase crit title, Retry outline button.
- Focus ring: double ring (2px background, 4px ring). Thin 6px console scrollbars. Gold text selection.

### Spacing & layout
- Panels stacked with `space-y-4`; grid gaps `gap-4`; card padding p-4/p-6; CardHeader pb-2/pb-3.
- Work consoles `xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]`; standalone `[2fr_1fr]`.
- Touch targets ≥ h-9; primary actions h-14; kiosk/wizard steps may go larger (h-16 – h-20).
- Icons lucide-react `h-4 w-4` (`h-3.5` in chips).

### Motion
`gt-pulse` LED breathing · `gt-sweep` 4.2s radar · `gt-ticker` 48s marquee · dialogs via tailwindcss-animate fade/zoom · progress width 500ms. Everything honors `prefers-reduced-motion`. No decorative motion beyond instrument feedback.

## 4. Component kit (real primitives — see `.superdesign/init/components.md`)
Button (default forest / outline / secondary / ghost / destructive; sizes sm h-8, default h-9, lg h-10, icon), Card (+Header/Content/Title), Badge, Input (h-9, mono when data), Label, Select (Radix), Table (dense mono numerics, right-aligned numbers), Tabs, Dialog, Alert, Separator, Skeleton, Slider, Textarea, sonner toasts (bottom-right, richColors). Domain widgets: ScaleReadout, SheetSummary strip, WeighConsole, CapturedStrip, BinFillTile (vertical grain fill in crop color), QueryError, TicketPrint.

## 5. Hard rules for generated designs
1. **Use only these tokens.** No new hues (no blue, purple, pink, cyan). Gold is for capture/attention, green for stable/complete, amber for live/on-lot, red for critical. Forest green is the primary.
2. **Fonts: Inter + JetBrains Mono only.** All numbers mono + tabular-nums. Section labels are `.gt-eyebrow`.
3. **Every screen sits inside the real app shell** (left rail + header) unless explicitly a kiosk/full-screen mode.
4. Cards are `.gt-panel`; readouts are `.gt-scan` dark instrument panels with glowing digits; state is shown with LEDs + mono uppercase labels (STABLE / LIVE / NO SIGNAL / ON THE LOT).
5. Capture actions are giant gold `bg-go` buttons with the weight in the label; secondary flow actions are forest `bg-primary`.
6. Design for gloves and glare: big targets, high contrast, no hover-only affordances, no tiny text for critical values.
7. Both **harvest** and **night** must work — prefer token classes over literal colors.
8. Real domain content only: tickets like `WS-2026-0142`, trucks `TRK-14`, farmers/lots (`Halvorsen Farms · LOT-07`), crops from the list, weights like `45,230 lb`, bushels `807.68 bu`, bins `Bin 3 · Corn · 62%`.

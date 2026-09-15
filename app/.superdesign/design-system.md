# Grain Tracker v2 — Design System

## Product context

**Grain Tracker v2** is a scale-house operations tool for a grain elevator. One operator, one certified truck scale, many trucks during harvest: open a **weight sheet** for a farmer's lot, truck drives on → **WEIGH IN**, dumps grain → **WEIGH OUT**; the app computes net lbs → bushels (moisture shrink/dockage), credits the right bin, prints a scale ticket. Sheets hold up to 10 loads. End of day: Daily Report → Close Day; optional sync to a main-office portal.

- **Users:** scale-house operator (primary, touch/click under time pressure), office admin (secondary).
- **Environment:** desktop/tablet in a scale house; Chrome/Edge over HTTPS (Web Serial USB scale link requires it).
- **Key pages:** Dashboard (live scale readout + open sheets + activity), Weight Sheets (archive: search/filter/table), Bins (capacity + fill), Farmers & Lots (farmers/landlords/lots CRUD tabs), Reports (daily ledger, bin levels, close day, office sync).
- **JTBD:** capture a truck's weight in seconds without errors; trust the numbers; close the day cleanly.

## Stack

React 19 + TypeScript + Vite; Tailwind CSS v3.4 with shadcn/ui (new-york) over Radix primitives; HSL CSS custom properties consumed via `hsl(var(--token))`; lucide-react icons; sonner toasts. Theme is hand-rolled: dark "console" default (`:root`) + `.day` daylight mode toggled by a class on `<html>`, persisted in localStorage (`gt-theme`).

## Brand & visual language (current)

"Console" — a dark grain-elevator **instrument panel**. Warm-black ground with crimson undertone; warm-grey cards with gold-whisper hairlines; **crimson = action + critical**; **gold = instrument signal** (stable weight, capture, positive — the big WEIGH buttons); **warm ivory = live telemetry** (moving scale readings). A `.day` mode turns the page to warm paper while the **sidebar stays dark in both modes**.

### Color tokens (HSL triplets, `hsl(var(--token))`)

| Token | Console dark (`:root`) | Daylight (`.day`) |
| --- | --- | --- |
| `--background` | `345 14% 5%` | `45 15% 94%` |
| `--foreground` | `45 20% 94%` | `345 20% 12%` |
| `--card` | `345 10% 9%` | `0 0% 99%` |
| `--primary` (crimson) | `348 86% 54%` | `348 80% 44%` |
| `--secondary` | `335 8% 14%` | `42 10% 91%` |
| `--muted` / `--muted-foreground` | `335 8% 13%` / `40 8% 64%` | `42 8% 92%` / `345 6% 44%` |
| `--accent` | `335 10% 16%` | `40 14% 89%` |
| `--destructive` | `348 84% 60%` | `348 78% 47%` |
| `--border` | `36 14% 20%` | `40 12% 84%` |
| `--input` | `36 12% 24%` | `40 10% 78%` |
| `--ring` | `348 86% 54%` | `348 80% 44%` |

**Signal tokens** (Tailwind utilities `live`, `go`, `crit`, `readout`):

| Token | Dark | Day | Meaning |
| --- | --- | --- | --- |
| `--live` | `48 30% 88%` warm ivory | `345 12% 36%` | moving telemetry (LIVE) |
| `--go` | `42 96% 58%` gold | `38 90% 40%` | stable / capture / positive (WEIGH buttons) |
| `--crit` | `348 95% 64%` crimson | `348 78% 47%` | overdue / critical / offline |
| `--readout` | `345 25% 3%` | `45 20% 97%` | inset readout surface |

**Sidebar tokens** (same in both modes — dark rail): background `345 16% 4%`, foreground `45 15% 88%`, primary gold `42 96% 58%`, accent `335 10% 13%`, border `36 12% 16%`, ring `348 86% 54%`.

### Typography

- **Inter** (400–800) — UI text; `font-feature-settings: "cv02" cv03 cv04"`.
- **JetBrains Mono** (400–800) — ALL numbers, tickets, codes, eyebrows, table digits; `tabular-nums` everywhere digits appear.
- Page title `text-xl font-semibold tracking-tight`; eyebrow `.gt-eyebrow` = mono `10px` semibold uppercase `0.18em` tracking, muted; scale readout digits `font-mono text-5xl/6xl font-bold tabular-nums`; stat numbers `font-mono text-xl font-bold`; tables `text-sm`, often `font-mono text-xs`.

### Shape, elevation, spacing

- `--radius: 0.375rem` (rounded-lg = 0.375rem; xs/sm/md smaller). Panels are squared-ish, instrument-like.
- `.gt-panel`: console card = `rounded-md border border-border bg-card` + inset top-edge light + depth shadow (used on most cards).
- Buttons: `bg-go` gets a brushed-gold gradient + glow (dark only); `bg-primary` gets crimson gloss + glow; WEIGH buttons are huge (`h-14`, full width).
- Content column `max-w-[1400px]`, `p-6`; sidebar ~15rem fixed.
- Shadows subtle; depth comes from inset lights, hairlines, and glows rather than drop shadows.

### Motion

- `gt-pulse` LED blink 1.5s (crit 1.1s); `gt-sweep` radar 4.2s; `gt-ticker` marquee 48s; `caret-blink` 1.25s; accordion 0.2s. All disabled under `prefers-reduced-motion`.
- LEDs glow (`.gt-led` 6px dot + box-shadow); readout digits glow in dark mode (`.gt-scan .text-go/.text-live`).

### Signature `.gt-*` utilities

`.gt-panel` (console card), `.gt-brand` (gold→crimson gradient wordmark), `.gt-eyebrow` (micro-label), `.gt-led` + `-on/-live/-warn/-crit` (status dots), `.gt-scan` (CRT scanline overlay on readouts), `.gt-ticker` (status marquee), `.gt-radar` (circular sweep logo mark), `.gt-node` (radar-node toggle dot replacing switches).

### Other globals

`::selection` gold on dark; thin 6px scrollbars; `:focus-visible` double ring; ambient fixed radial gradients on `body` (crimson top-left + gold top-right in dark, warm vignette in day); `#ticket-print` print stylesheet that hides the app and prints a paper scale ticket.

## Project requirements

1. Readability under pressure: giant tabular-num readouts, big touch targets (WEIGH IN/OUT h-14), unambiguous status (STABLE gold / LIVE ivory / OFFLINE crimson).
2. Dark console default + daylight mode; the app must work in both (tokens, never hardcoded colors).
3. Mono for every number; operators glance, they don't read.
4. Scale link is Web Serial (Chrome/Edge + HTTPS); simulator + manual entry are first-class fallbacks.
5. Print: scale tickets must print cleanly on paper regardless of theme.

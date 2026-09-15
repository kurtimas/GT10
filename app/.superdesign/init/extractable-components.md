# Extractable Components

Menu of components that can be extracted as reusable Superdesign `DraftComponent` entities. Full source lives in `components.md` / `layouts.md` / the page files — not duplicated here.

## Layout Components

### AppShell (Layout)
- Source: `src/components/Layout.tsx`
- Category: layout
- Description: Full app shell — fixed 240px dark left rail (radar logo + gradient "GRAIN TRACKER v2" wordmark, 5 NavLinks with active-state indicator bar, server-online LED footer) plus right column (conditional crimson offline banner, header with page title + theme toggle + live clock chip, scrollable `max-w-[1400px] p-6` main, sonner Toaster).
- Extractable props: `activeItem` (string, one of "dashboard" | "sheets" | "bins" | "people" | "reports" — controls highlighted nav item and header title), `serverOnline` (boolean, default true — offline banner + footer LED state), `pageTitle` (string, optional override of derived title), `dayMode` (boolean, default false — Sun/Moon toggle state)
- Hardcoded: nav item list with labels/icons/routes, brand wordmark + "Scale House Ops" eyebrow, gt-radar logo mark, sidebar width `w-60`, `max-w-[1400px]` content column, Toaster position/config, localStorage key "gt-theme", 1s clock tick, all CSS classes.

### Sidebar (left rail)
- Source: `src/components/Layout.tsx` (inline `<aside>` — extractable as its own draft)
- Category: layout
- Description: The dark rail alone: brand header, NavLink stack, online-status footer.
- Extractable props: `activeItem` (string), `serverOnline` (boolean, default true)
- Hardcoded: NAV_ITEMS (Dashboard/Weight Sheets/Bins/Farmers & Lots/Reports with lucide icons), radar logo, gradient brand text, sidebar token colors.

### AppHeader (top bar)
- Source: `src/components/Layout.tsx` (inline `<header>` — extractable as its own draft)
- Category: layout
- Description: Header with eyebrow + page title on the left; theme toggle button and live LED clock chip on the right.
- Extractable props: `pageTitle` (string), `dayMode` (boolean, default false), `showClock` (boolean, default true)
- Hardcoded: "Grain Tracker v2" eyebrow, Sun/Moon icons, clock format, `bg-readout` chip styling.

## Basic Components (used across pages)

### Button
- Source: `src/components/ui/button.tsx`
- Category: basic
- Description: shadcn Button (cva variants default/destructive/outline/secondary/ghost/link; sizes default/sm/lg/icon); dark-mode crimson gloss via global CSS, and `bg-go` variant gets the brushed-gold WEIGH treatment.
- Extractable props: none beyond content/children (variant/size are style props, keep hardcoded per usage)
- Hardcoded: variant classes, `[&_svg]:size-4` icon sizing.

### Card / PanelCard
- Source: `src/components/ui/card.tsx` (base) — the app-level pattern is `<Card className="gt-panel">`
- Category: basic
- Description: shadcn Card family; pages consistently compose `Card + CardHeader/CardContent` with the `gt-panel` class for the lit-edge console panel look.
- Extractable props: none (content-driven)
- Hardcoded: `rounded-lg border bg-card shadow-sm`, `.gt-panel` inset shadow.

### StatCard
- Source: `src/pages/Bins.tsx` (4 stat cards in `Bins()`), `src/pages/Reports.tsx` (`SummaryCard` at line 85)
- Category: basic
- Description: Metric card — `.gt-eyebrow` label over a large mono bold tabular number with unit suffix; Reports' SummaryCard adds a `sub` line and `tone` ("go"/"amber") color.
- Extractable props: `label` (string), `value` (string), `sub` (string, optional), `tone` ("default" | "go" | "amber", optional), `loading` (boolean, default false — swaps in Skeleton)
- Hardcoded: `gt-eyebrow` label styling, `text-xl font-mono font-bold tabular-nums` value, "lb" unit suffix, p-4 padding.

### Badge / StatusBadge / DirectionBadge
- Source: `src/components/ui/badge.tsx` (base); status/direction variants defined inline in `src/pages/Sheets.tsx` (`StatusBadge` ~line 91, `DirectionBadge` ~line 99) and `src/pages/Reports.tsx` (`DirectionBadge` line 58, `LoadStatusBadge` line 73)
- Category: basic
- Description: Mono status pills — sheet status (OPEN/FULL/CLOSED), direction (INBOUND ivory `text-live` / OUTBOUND crimson `text-primary`), sync direction/status, load status.
- Extractable props: `status` (string enum), `direction` ("INBOUND" | "OUTBOUND")
- Hardcoded: border/text color mapping per status, `font-mono text-[10px]` sizing.

### StatusLed
- Source: `src/index.css` `.gt-led` family; used in `src/components/Layout.tsx` (online + clock), `src/pages/Dashboard.tsx` (ScalePanel signal LED)
- Category: basic
- Description: 6px glowing pulsing LED dot (CSS-only component).
- Extractable props: `state` ("off" | "on" | "live" | "warn" | "crit")
- Hardcoded: 6px size, glow shadows, pulse keyframes.

### EyebrowLabel
- Source: `src/index.css` `.gt-eyebrow`; used on every page
- Category: basic
- Description: Mono uppercase micro-label with 0.18em tracking (e.g. "Scale readout", "ARCHIVE", "Open sheets").
- Extractable props: none (children = text)
- Hardcoded: JetBrains Mono 10px semibold uppercase, muted color.

### DataTable
- Source: `src/components/ui/table.tsx` (base); composed in `src/pages/Sheets.tsx`, `src/pages/People.tsx` (Farmers/Landlords/Lots tabs), `src/pages/Reports.tsx` (by-crop/by-farmer/loads/bin levels/sync log)
- Category: basic
- Description: shadcn Table wrapped in a Card with `CardHeader` title + result count; mono `text-xs` cells, skeleton rows and dashed empty-state row.
- Extractable props: `title` (string), `rowCount` (number — "N results" label), `loading` (boolean), `empty` (boolean)
- Hardcoded: column definitions per page, mono cell classes, hover states.

### FormDialog
- Source: `src/components/ui/dialog.tsx` (base); pattern repeated by NewSheetDialog (`src/pages/Dashboard.tsx`), SheetDetail/Grades/Weights/BinAssign (`Sheets.tsx`), AddSite/AddBin/EditBin/AdjustLevel/DeleteBin (`Bins.tsx`), Farmer/Landlord/Lot/CloseLot (`People.tsx`), Close day (`Reports.tsx`)
- Category: basic
- Description: Centered modal with DialogHeader (title + description), Label+Input/Select/Textarea field stack, DialogFooter with cancel + primary/destructive action; pending states on buttons.
- Extractable props: `open` (boolean), `title` (string), `description` (string), `confirmLabel` (string), `pending` (boolean)
- Hardcoded: field contents per dialog, destructive confirm styling.

### ReadoutDisplay
- Source: `src/pages/Dashboard.tsx` `ScalePanel` (the `gt-scan` block, ~lines 113–127); also the Layout clock chip
- Category: basic
- Description: Instrument readout — huge mono tabular digits on a `bg-readout` scanline surface with signal-state color (gold stable / ivory live / muted no-signal) and dark-mode text glow.
- Extractable props: `value` (string), `state` ("none" | "live" | "stable"), `unit` (string, default "lb"), `caption` (string — source line)
- Hardcoded: `gt-scan` overlay, text-5xl/6xl sizing, glow CSS.

### FillBar
- Source: `src/pages/Bins.tsx` (`fillBarClass`/`fillTextClass` + BinCard bar, ~lines 48–64, 588); smaller variant in `Reports.tsx` bin-levels table
- Category: basic
- Description: Horizontal fill percentage bar with threshold coloring (go <70%, primary 70–90%, crit >90%).
- Extractable props: `pct` (number 0–100), `showLabel` (boolean, default true)
- Hardcoded: h-1.5 track height, threshold breakpoints.

### WeighButton
- Source: `src/pages/Dashboard.tsx` `SheetCard` (WEIGH IN / WEIGH OUT buttons)
- Category: basic
- Description: Large gold capture button (`bg-go` + global brushed-gold gradient) for scale capture actions.
- Extractable props: `label` (string, e.g. "WEIGH IN"/"WEIGH OUT"), `disabled` (boolean), `pending` (boolean)
- Hardcoded: gold gradient CSS, disabled flattening.

## Not extractable / skip

- `NotFound` (`src/pages/NotFound.tsx`) — trivial one-off 404.
- `ScalePanel`/`SheetCard`/`ActivityFeed` internals beyond ReadoutDisplay/WeighButton — page-specific composition; extract on demand if designing the Dashboard.
- `useScale` (`src/hooks/useScale.ts`), `src/lib/trpc.ts`, `src/providers/trpc.tsx`, `contracts/*`, `db/schema.ts` — logic/type modules, not visual components.

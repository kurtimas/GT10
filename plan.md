# Plan — Grain Tracker v2 · Scale Dashboard Full Rebuild

## Source of truth
`/mnt/agents/temp/scale-dashboard-rebuild-spec.pdf` — complete rebuild spec (layout §5, design tokens §3, data layer §4, state machine §6, operator assists §7, keyboard/sound §8, checklist §9).

## Stage 0 — Clarify scope (ask_user)
- Backend scope: full-stack (Hono+tRPC+Drizzle) vs frontend with in-browser simulated data layer implementing the same trpc.* contract.
- Skill to load: `vibecoding-webapp-swarm` (orchestration) before building.

## Stage 1 — Project scaffold & design shell
- Skill: `vibecoding-webapp-swarm` (+ `webapp-building-swarm` as needed).
- React 18 + TS + Vite + Tailwind + shadcn/ui primitives + lucide-react + sonner.
- index.css design tokens: `--go`, `--live`, `--crit`, `--readout`, amber; `.gt-panel`, `.gt-eyebrow`, `.gt-led` variants, `.gt-scan`, tabular-nums mono, TestBadge, NodeToggle, fillTone helpers.
- musepool plugin may be consulted for anti-slop design inspiration, but spec §3 design language (instrument panel, dark phosphor) wins on conflict.

## Stage 2 — Data layer + scale hardware
- useScale hook: Web Serial parser (last-number-on-line, 9600 8N1), simulator (base ± noise every 400 ms), stability window (8 readings, ≥6, max−min ≤ 25 lbs), manual-entry fallback.
- Data layer per §4: sheets.open / core.bins.list / sheets.truckTares / sheets.list{limit:1} / sheets.dailyReport with 15 s polling; mutations sheets.create/weighFirst/weighSecond; invalidate-all after mutations; localStorage persistence (gt-sound, gt-autoprint, gt-ops-overview).
- sound.ts (stableBeep 990 Hz/70 ms, captureBeep, warnBeep 220 Hz/250 ms), printTicket.ts.

## Stage 3 — Dashboard layout (exact §5 order)
Header (PageHeader) → error banner → bin levels strip → 3 quick StatCards → lg:grid-cols-5 work area:
- LEFT (col-span-3): ScalePanel (LEDs, signal bars, readout w/ corner brackets + scanlines, serial error, simulator slider + quick-set) → manual entry → BIG WEIGH IN/OUT buttons (h-32/40, stage-gated, direction-aware labels) → operator toggles strip → selected-sheet context panel (LoadSlots, previous loads, next-load inputs, tare memory/est-net).
- RIGHT (col-span-2): open sheets list (age borders, status line, DETAILS).
→ Operations overview (collapsible, persisted): KPI strip ×5, hourly throughput chart, crop donut, bin board, activity feed.

## Stage 4 — State machine + operator assists (§6–§7)
Stage derivation (none/first/second), doWeigh with all guards: no-weight, truck-required, tare memory, tare-deviation >3% warn, duplicate-truck warn, bin auto-suggest, est-net, repeat-last-load, sheet-change prefill, auto-advance on 10/10, auto-print.

## Stage 5 — Keyboard/sound/timing (§8) + dialogs (§5.7)
Global keys (Space/Enter capture, N new sheet, guards), NewSheetDialog, SheetDetailDialog (void, grading, close sheet, reprint), TicketPrint (print-only, 150 ms delay).

## Stage 6 — QA + delivery
- Build passes, interactive smoke test of the full weigh in→out loop, warnings, shortcuts.
- Deliver via `website_version_manager` build_version (type: static after build; or dynamic if real backend chosen).

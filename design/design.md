# Grain Tracker v2 — Scale Dashboard · Global Design Document

> This document is a faithful transcription of the uploaded rebuild spec
> (`scale-dashboard-rebuild-spec.pdf`). The spec is the single source of truth —
> implement it exactly, no re-design, no "improvements".

## Product
One operator, one scale, many trucks. The operator opens a weight sheet for a
farmer's lot, presses WEIGH IN when a truck drives on, WEIGH OUT when it comes
back; the system computes net lbs and bushels, credits the bin, optionally
prints a ticket. Optimize for: big touch targets, glanceable status, minimal
typing, recovery from mistakes (guards + warnings, not hard stops).

## Tech stack (pinned)
- Node.js 20 · Vite 7.2.4 · React 19 + TypeScript · Tailwind CSS v3.4.19
- shadcn/ui primitives: Button, Input, Select, Slider, Skeleton, Dialog
- lucide-react icons · sonner toasts
- Data: tRPC client — `import { trpc } from "@/providers/trpc"`,
  `trpc.<router>.<proc>.useQuery/useMutation`, `trpc.useUtils()` for
  invalidation. Backend: Hono + tRPC + Drizzle ORM (MySQL).
- Scale hardware: Web Serial API (Chrome/Edge over HTTPS only) + built-in
  simulator + manual-entry fallback.
- `BrowserRouter`; single route `/` → Dashboard page.

## Design language — the "instrument panel" look
Industrial control equipment. Dark theme by default; phosphor-green/cyan
accents; monospace numbers everywhere.

### Design tokens (CSS custom properties in `src/index.css`)
| Token | Dark value | Use |
|---|---|---|
| `--go` | `158 64% 52%` (phosphor green) | capture / positive / stable states |
| `--live` | `187 92% 55%` (cyan) | live telemetry, "reading…" |
| `--crit` | `0 91% 68%` (signal red) | overdue / critical |
| `--readout` | `222 60% 3%` (near-black) | inset readout background |
| amber (hardcoded) | `hsl(38 92% 60%)` | warning fill level (70–90%) |

Light theme ("day" mode, `.day` class on root) remaps all four tokens to
brighter/darker variants. **Always reference the tokens, never hardcode
green/red.**

### Reusable classes (define in `src/index.css`)
- `.gt-panel` — the standard card: `rounded-sm`, border, card background.
  Every section of the dashboard is a gt-panel.
- `.gt-eyebrow` — tiny uppercase monospace label (text-[10-11px],
  letter-spaced, muted). Header of every panel.
- `.gt-led` — small glowing dot. Modifiers: `.gt-led-on` (green glow),
  `.gt-led-live` (cyan glow), `.gt-led-warn` (amber), `.gt-led-crit` (red).
  Used like a physical indicator lamp.
- `.gt-scan` — inset "terminal screen" effect for the weight readout: dark
  ground + scanline overlay (`::after` pseudo-element with repeating
  horizontal lines, suppressed in day mode).
- `tabular-nums` + `font-mono` on every number so digits never shift layout.
- `TestBadge` — a small "TEST" chip next to any trial feature (repeat-last,
  keyboard shortcuts, sound, auto-print, tare memory, est-net). Keep visible.

### Fill-level color logic — `src/components/manage/fillTone.ts`
- `fillPct(currentLbs, capacityLbs)` → 0–100, clamped, rounded; 0 if
  capacity ≤ 0.
- `fillTone(pct)` → `"go"` (<70), `"warn"` (70–90), `"crit"` (>90).
- `fillColor(tone)` → inline CSS color (green / amber `hsl(38 92% 60%)` /
  red token).
- `fillTextClass(tone)` / `fillLedClass(tone)` → matching Tailwind class /
  LED modifier.

## Shared kit (built by scaffold agent — exact paths)
- `src/components/kit/PageHeader.tsx` — eyebrow row + title + right-side
  action slot.
- `src/components/kit/StatCard.tsx` — gt-panel p-4; eyebrow label; big
  (text-3xl) monospace value; optional muted sub-line. Prop `tone`:
  `default | primary | go | warn | crit`.
- `src/components/kit/ErrorBanner.tsx` — red left-border alert strip:
  CircleAlert icon, monospace uppercase label, truncated error message,
  outline Retry button.
- `src/components/kit/EmptyState.tsx` — centered muted monospace uppercase
  message block.
- `src/components/kit/TestBadge.tsx` — the "TEST" chip.
- `src/components/kit/NodeToggle.tsx` — custom "radar node" switch: glowing
  ring with center dot (`.gt-node` with `data-on` attribute), NOT a standard
  switch. Props: `{ label: string; on: boolean; onChange(v:boolean): void;
  test?: boolean }` (test renders TestBadge).
- `src/components/kit/StatusBadge.tsx` — sheet status chip (OPEN etc.).
- `src/components/kit/LoadSlots.tsx` — 10-segment bar, one segment per load
  slot: filled = solid green; load currently on scale = pulsing primary;
  empty = muted; `n/10` counter at the right end. Props:
  `{ total: number; loads: number; onScale?: boolean }` (reused in context
  panel AND right-column rows).
- `src/lib/fillTone.ts` re-exported at `src/components/manage/fillTone.ts`.
- `src/lib/sound.ts` — WebAudio, gated by Sound cues toggle:
  `stableBeep()` 990 Hz / 70 ms (fires once each time reading transitions to
  stable); `captureBeep()` on successful weighs; `warnBeep()` 220 Hz / 250 ms
  on tare/duplicate warnings.
- `src/lib/printTicket.ts` — `printTicket()` triggers browser print after a
  150 ms delay (used with the offscreen TicketPrint component).
- `src/lib/format.ts` — `fmtLbs` (toLocaleString), `fmtBu`, `fmtAge`
  ("just now", "42m", "2h 5m"), crop test weights (corn 56, soybean 60,
  wheat 60 lbs/bu).
- `src/hooks/useNow.ts` — `useNow(30000)` re-renders every 30 s so ages stay
  fresh.

## Data contract (backend graft — anchors all agents)
The backend branch lands BEFORE page branches fork; page agents read
`api/router.ts`, `api/queries/*`, `db/schema.ts`, `contracts/*` in their
worktree for exact shapes. Contract summary:

Queries (poll interval in parens):
- `trpc.sheets.open` (15 s) → OPEN weight sheets, each with loads, lot,
  farmer, crop, direction, activeLoad, net totals.
- `trpc.core.bins.list` (15 s) → bins with crop, capacityLbs, currentLbs.
- `trpc.sheets.truckTares` (on mount) → `{ truckId, avgTareLbs, loads }[]`.
- `trpc.sheets.list` `{limit:1}` (on mount) → most recent sheet (repeat-last).
- `trpc.sheets.dailyReport` (15 s) → today's KPIs, hourly throughput,
  crop mix, bin utilization.
- `trpc.sheets.recentActivity` → activity feed events.
- `trpc.sheets.get` `{id}` → full sheet for detail dialog / auto-print.

Mutations: `sheets.create`, `sheets.weighFirst`, `sheets.weighSecond`,
`sheets.voidLoad`, `sheets.gradeLoad`, `sheets.close`.
After every weigh/create action invalidate ALL: `sheets.open`, `sheets.list`,
`core.bins.list`, `sheets.dailyReport`, `sheets.truckTares`,
`sheets.recentActivity`.

Direction semantics: INBOUND = weigh loaded first, empty second
(net = gross − tare). OUTBOUND = empty first, loaded second. The server
computes net/bushels and credits bins; the UI only labels and estimates.

## Component contracts (cross-agent — pin exactly)

### `src/hooks/useScale.ts` (agent: scale-terminal)
```ts
export type ScaleMode = "serial" | "sim" | "offline";
export interface UseScale {
  mode: ScaleMode;
  weight: number | null;      // current reading, lbs (null when offline w/o manual)
  stable: boolean;
  live: boolean;              // connected (serial or sim)
  error: string | null;       // serial connection error message
  simBase: number;            // simulator base weight
  setSimBase(v: number): void;
  connectSerial(): Promise<void>;
  startSimulator(): void;
  disconnect(): void;
}
export function useScale(): UseScale
```
- Simulator: `simBase ± random noise (±30 lbs)` tick every 400 ms.
- Stability: rolling window of last 8 readings; stable when ≥6 readings and
  max−min ≤ 25 lbs.
- Serial parse: take the LAST number on each line (handles "NT 12500 lb",
  "ST,GS,+12500lb", "GR81,250LB", bare numbers; strip thousands separators;
  absolute value, rounded). Port: 9600 baud, 8 data bits, 1 stop bit, no
  parity. If Web Serial unavailable → error message "Web Serial is not
  available in this browser. Use Chrome/Edge over HTTPS, or the simulator."

### scale-terminal components
```tsx
// src/components/scale/ScalePanel.tsx
<ScalePanel scale={UseScale} />
// src/components/scale/ManualWeight.tsx — rendered only when disconnected
<ManualWeight value={string} onChange={(v:string)=>void} />
// src/components/scale/CaptureButtons.tsx
<CaptureButtons
  stage={"none"|"first"|"second"}
  direction={"INBOUND"|"OUTBOUND"}
  weight={number|null} saving={boolean}
  onWeighIn={()=>void} onWeighOut={()=>void} />
// src/components/scale/TogglesStrip.tsx
<TogglesStrip soundOn={boolean} onSoundChange={fn}
  autoPrint={boolean} onAutoPrintChange={fn} />
```

### dashboard-core components (agent: dashboard-core)
Owns `src/pages/Dashboard.tsx` (composition, stage machine, doWeigh,
keyboard, guards, prefill, auto-advance, auto-print) plus:
`src/components/dash/BinStrip.tsx`, `QuickStats.tsx`,
`ContextPanel.tsx` (selected sheet), `OpenSheetsList.tsx` (right column).

### ops-dialogs components (agent: ops-dialogs)
```tsx
// src/components/ops/OpsOverview.tsx — self-contained (own tRPC queries)
<OpsOverview />
// src/components/dialogs/NewSheetDialog.tsx
<NewSheetDialog open={boolean} onOpenChange={fn}
  onCreated={(sheetId:number)=>void} />
// src/components/dialogs/SheetDetailDialog.tsx
<SheetDetailDialog sheetId={number|null} open={boolean}
  onOpenChange={fn} onChanged={()=>void} />
// src/components/dialogs/TicketPrint.tsx — print-only, renders offscreen
<TicketPrint ctx={PrintCtx|null} />   // PrintCtx = { sheet: SheetDetail; loadSeq: number }
```

## File ownership map (merge-conflict control)
| Branch | Owns | Must NOT touch |
|---|---|---|
| scaffold | index.css, tailwind config, kit/*, lib/*, hooks/useNow, App.tsx stub route | api/, db/ |
| backend (main agent) | db/schema.ts, db/seed.ts, api/router.ts, api/queries/*, contracts/* | src/ except nothing |
| feat-scale | hooks/useScale.ts, components/scale/* | pages/, kit/, api/ |
| feat-core | pages/Dashboard.tsx, components/dash/* | scale/*, ops/*, dialogs/*, api/ |
| feat-ops | components/ops/*, components/dialogs/* | pages/, dash/*, api/ |

## Dependencies to add
`sonner`, `lucide-react`, `recharts` (ops overview charts) — shadcn Slider/
Select/Dialog/Skeleton are already in the template.

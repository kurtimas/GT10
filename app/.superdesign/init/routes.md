# Routes

Routing is config-based via `react-router` v7 (`BrowserRouter` in `src/main.tsx`, `<Routes>`/`<Route>` in `src/App.tsx`). There is no separate router config file — `src/App.tsx` is the router config. All routes render inside the shared `Layout` shell (`src/components/Layout.tsx`).

Provider stack (`src/main.tsx`): `StrictMode > BrowserRouter > TRPCProvider > App`.

| URL | Component | File | Layout |
| --- | --- | --- | --- |
| `/` | Dashboard | `src/pages/Dashboard.tsx` | Layout |
| `/sheets` | Sheets | `src/pages/Sheets.tsx` | Layout |
| `/bins` | Bins | `src/pages/Bins.tsx` | Layout |
| `/people` | People | `src/pages/People.tsx` | Layout |
| `/reports` | Reports | `src/pages/Reports.tsx` | Layout |
| `*` | NotFound | `src/pages/NotFound.tsx` | Layout |

## Router config — `src/App.tsx` (full source)

```tsx
import { Routes, Route } from "react-router";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Sheets from "./pages/Sheets";
import Bins from "./pages/Bins";
import People from "./pages/People";
import Reports from "./pages/Reports";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/sheets" element={<Sheets />} />
        <Route path="/bins" element={<Bins />} />
        <Route path="/people" element={<People />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}
```

## Page summaries

### `/` — Dashboard (`src/pages/Dashboard.tsx`)

The scale-house operator's main screen; a 2:1 two-column grid (`xl:grid-cols-[2fr_1fr]`).

- **ScalePanel** (inline component) — the hero: a `gt-scan` scanline readout surface (`bg-readout`) with huge mono digits (5xl/6xl) colored by signal state (`text-go` when stable, `text-live` when moving, muted with `———` when no signal), a `gt-led` + STABLE/LIVE/NO SIGNAL status chip, source label (USB scale / Simulator / Manual entry / No source). Below: browser-support and scale-error Alerts, connect/disconnect USB scale (Web Serial) buttons, Simulator toggle with `gt-node` indicator, SCALE LINKED/OFFLINE badge, a Slider for simulator base weight (1,000–120,000 lb, step 500) and a manual weight entry Input + Set/Clear. Driven by `useScale()` from `src/hooks/useScale.ts`.
- **Open weight sheets** — eyebrow header + count Badge + "+ New sheet" button (**NewSheetDialog**, inline): Dialog with Site select, INBOUND/OUTBOUND Tabs toggle, open-lot select (inbound) or farmer+crop selects (outbound), optional notes Textarea. Below, a 2-col grid of **SheetCard**s (inline): ticket no in primary color, direction Badge (OUTBOUND crimson / INBOUND ivory), farmer/lot/crop line, truck + driver inputs, and big **WEIGH IN / WEIGH OUT** gold (`bg-go`) buttons calling `sheets.weighFirst` / `sheets.weighSecond` with the current scale reading; skeleton/empty states included.
- **ActivityFeed** (inline, right column) — `gt-panel` Card listing recent sheet events (ticket in primary, time, action + detail), polling every 10s.

### `/sheets` — Weight Sheets archive (`src/pages/Sheets.tsx`)

- **Filter bar Card** — 7-column grid: free-text search Input (debounced ~300ms; farmer, lot, landlord, ticket, truck, driver), Farmer / Crop / Status selects, From/To date Inputs, Clear button.
- **Results table** — Card + shadcn Table of all sheets: ticket (mono, primary), date, farmer, lot code + landlord/split badge, crop, direction badge, status badge (OPEN/FULL/CLOSED with colored mono styling), loads x/y, net lbs, net bu; skeleton rows while loading; clicking a row opens the detail dialog.
- **SheetDetailDialog** — full sheet drill-down: loads ledger (per-load gross/tare/net, bushels, moisture, FM, grade badges), actions to open **GradesDialog** (dockage/test wt/grade per load), **WeightsDialog** (weight corrections), **BinAssignDialog** (assign/void bin per load), close sheet with reason, void loads, and audit trail of sheet events.
- Data via `trpc.sheets.list` + `trpc.people.farmers.list`.

### `/bins` — Bins & sites (`src/pages/Bins.tsx`)

- **Stat cards row** — 4 cards (Total capacity, On hand, Overall fill %, Bin count) with big mono tabular numbers; fill text color shifts with threshold helpers.
- **Actions** — "Add site" / "Add bin" buttons.
- **Body** — bins grouped by site (uppercase tracked section headers with location + bin count; "Unassigned" group last), each a grid of **BinCard**s: bin name, crop Badge, current/capacity lbs + bushels, fill percentage with a colored progress bar (`bg-go` <70%, `bg-primary` 70–90%, `bg-crit` >90%), edit / adjust level / delete buttons.
- **Dialogs** (all inline): AddSiteDialog, AddBinDialog (with live lbs↔bu capacity converter `useCapacityConverter`), EditBinDialog, AdjustLevelDialog (manual +/- inventory), DeleteBinDialog (confirm). Empty state with Warehouse icon.
- Data via `trpc.core.sites.list` + `trpc.core.bins.list`.

### `/people` — Farmers, landlords & lots (`src/pages/People.tsx`)

- Header with Users icon + "Farmers, landlords & lots" title.
- **Tabs** (shadcn): Farmers / Landlords / Lots.
  - **FarmersTab** — table of farmers (name, contact, phone, email, notes) + add/edit (**FarmerDialog**).
  - **LandlordsTab** — table of landlords + **LandlordDialog**.
  - **LotsTab** — table of lots (code, farmer, landlord, split %, crop, open/closed status badges) + **LotDialog** (create/edit lot, choose farmer/landlord/split/crop) and **CloseLotDialog**.
- Shared helpers: TableSkeletonRows, EmptyRow. Data via `trpc.people.*`.

### `/reports` — Daily report (`src/pages/Reports.tsx`)

- **Header + date picker** — "Daily Report" title + date Input.
- **Summary cards** — 4 SummaryCards: sheets opened, loads weighed (completed sub), inbound lbs/bu (tone "go"), outbound lbs/bu (tone "amber").
- **By crop / By farmer tables** — net totals for completed loads, side by side.
- **Loads ledger** — wide table of every load that date (ticket, time, farmer, lot, crop, dir badge, truck, bin, gross, tare, net lbs, net bu, moisture %, status badge).
- **Bin levels snapshot** — table with bin/site/crop/current/capacity + mini fill bar.
- **Close day** — destructive-bordered Card: open-sheet count + "Close day" button opening a confirm Dialog that calls `sheets.closeDay` (closes OPEN sheets with reason EOD, optionally pushes the report to the office portal).
- **Office sync** — Card with Office URL/key Inputs, Save settings / Sync now buttons, and a sync log table (direction PUSH/PULL badges, OK/error badges, detail, time). Data via `trpc.sheets.dailyReport`, `trpc.sync.*`.

### `*` — NotFound (`src/pages/NotFound.tsx`)

Trivial 404: giant mono "404" in primary color, "This scale ticket doesn't exist." copy, Button linking back to `/`.

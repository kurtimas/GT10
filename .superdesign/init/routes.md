# Routes

Config-based routing — react-router v7 (`<Routes>` in `app/src/App.tsx`, `BrowserRouter` in `app/src/main.tsx`). Every route renders inside `app/src/components/Layout.tsx` (left rail + header shell).

```tsx
<Routes>
  <Route path="/" element={<Dashboard />} />
  <Route path="/scale" element={<Scale />} />
  <Route path="/scale/:sheetId" element={<Scale />} />
  <Route path="/sheets" element={<Sheets />} />
  <Route path="/shipments" element={<Shipments />} />
  <Route path="/bins" element={<Bins />} />
  <Route path="/people" element={<People />} />
  <Route path="/reports" element={<Reports />} />
  <Route path="/audit" element={<Audit />} />
  <Route path="*" element={<NotFound />} />
</Routes>
```

| Path | File | Renders |
|---|---|---|
| `/` | `app/src/pages/Dashboard.tsx` | Landing ops page: OPEN weight sheets to pick and start weighing, recent activity feed |
| `/scale` | `app/src/pages/Scale.tsx` | Standalone weigh console — scale readout, no sheet recording |
| `/scale/:sheetId` | `app/src/pages/Scale.tsx` | Weigh console bound to a weight sheet: SheetSummary strip, ScalePanel (2fr) + WeighConsole (3fr), loads table |
| `/sheets` | `app/src/pages/Sheets.tsx` | Weight Sheets archive: list/filter sheets, sheet detail, print ticket |
| `/shipments` | `app/src/pages/Shipments.tsx` | Outbound shipments log |
| `/bins` | `app/src/pages/Bins.tsx` | Bin inventory with fill-level graphics + BinDetailDialog |
| `/people` | `app/src/pages/People.tsx` | Farmers & Lots management (operators, farmers, lots, crops) |
| `/reports` | `app/src/pages/Reports.tsx` | Daily reports |
| `/audit` | `app/src/pages/Audit.tsx` | Audit log (shared `AuditLogTable`) |
| `*` | `shared/src/pages/NotFound` | 404 |

Nav labels (left rail, in order): Dashboard, Scale, Weight Sheets, Shipments, Bins, Farmers & Lots, Reports, Audit Log.

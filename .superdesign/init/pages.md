# Page dependency trees

Shared ui primitives (`@shared/src/components/ui/*`), `cn/cropBadgeClass/cropFillClass` (`@shared/src/lib/utils`), `QueryError`, sonner `toast`, and lucide icons are common to nearly every page — full sources live in `components.md`. They are marked "(shared ui)" below.

## /scale/:sheetId — Scale weigh console (style anchor for Scale-domain screens)
Entry: `app/src/pages/Scale.tsx`
Dependencies:
- `app/src/hooks/useScale.ts` — Web Serial USB scale hook + weight simulator + manual entry state
- `app/src/providers/weighQueue.tsx` — offline weigh queue (enqueue/replay)
- `app/src/components/GradesDialog.tsx` — moisture/grade entry dialog (shared ui + AdminPasswordField)
- shared ui: Card, Badge, Button, Input, Label, Select, Separator, Skeleton, Slider, Table, Alert, QueryError
- In-file sections: `ScalePanel` (readout instrument + source controls), `WeighConsole` (truck/driver inputs, destination bin select, gold WEIGH IN/OUT capture buttons, CapturedStrip), `SheetSummary` (ticketNo + direction/farmer/crop badges + load progress bar), `SheetLoadsCard` (loads table w/ grades action)
- `@contracts/grain` fmt helpers, `@contracts/types` (SheetRow: ticketNo, farmerName, lotCode, crop, direction INBOUND/OUTBOUND, completedLoads/maxLoads, status OPEN/FULL/CLOSED, activeLoad; LoadRow: loadNo, truckId, driverName, grossLbs, tareLbs, netLbs, netBushels, binId/binName, moisturePct, grade)

## / — Dashboard
Entry: `app/src/pages/Dashboard.tsx`
Dependencies:
- `app/src/providers/site.tsx` — active site context
- shared ui: Badge, Button, Card, Label, Skeleton, Tabs, Textarea, QueryError
- Data: `trpc.sheets.open` (open sheets), `trpc.sheets.recentActivity`, `CROPS`, `fmtLbs`

## /sheets — Weight Sheets archive
Entry: `app/src/pages/Sheets.tsx`
Dependencies:
- `app/src/components/GradesDialog.tsx`, `app/src/components/AdminPasswordField.tsx`, `app/src/components/TicketPrint.tsx` (print-only scale ticket)
- `app/src/providers/site.tsx`
- shared ui: Button, Badge, Card, Input, Label, Textarea, Skeleton, Separator, Alert, QueryError
- Data: `@shared/src/lib/csv` (downloadCsv/csvDateStamp), CROPS, fmtBu, fmtLbs

## /bins — Bins inventory
Entry: `app/src/pages/Bins.tsx`
Dependencies:
- `app/src/components/BinDetailDialog.tsx` (bin detail w/ loads + CSV export), `app/src/components/AdminPasswordField.tsx`
- `app/src/hooks/useAdminGate.ts`, `app/src/providers/site.tsx`
- shared ui: Badge, Button, Card, Input, Label, Skeleton, QueryError
- `cropFillClass` for solid grain-fill bin graphics; BinRow: name, crop, capacityLbs, currentLbs

## /shipments — Shipments
Entry: `app/src/pages/Shipments.tsx`
Dependencies:
- `app/src/providers/site.tsx`
- shared ui: Badge, Button, Card, Input, Label, Skeleton, Textarea, QueryError
- Data: `@shared/src/lib/csv`, bushelWeight/fmtBu/fmtLbs

## /people — Farmers & Lots
Entry: `app/src/pages/People.tsx`
Dependencies:
- `app/src/components/AdminPasswordField.tsx`, `app/src/hooks/useAdminGate.ts`
- shared ui: Badge, Button, Card, Input, Label, Skeleton, Tabs, Textarea, QueryError
- Data: CROPS/Crop, LotRow

## /reports — Reports
Entry: `app/src/pages/Reports.tsx`
Dependencies:
- `app/src/components/AdminPasswordField.tsx`, `app/src/hooks/useAdminGate.ts`, `app/src/providers/site.tsx`
- shared ui: Button, Input, Label, Badge, Skeleton, Separator, QueryError
- Data: fmtBu, fmtLbs

## /audit — Audit log
Entry: `app/src/pages/Audit.tsx`
Dependencies:
- `@shared/src/components/AuditLogTable` (shared table component)

## Shell (every page)
- `app/src/components/Layout.tsx` — left rail nav + header (operator picker, site picker, night toggle, live clock) + offline banner + weigh-queue chip
- `app/src/components/AdminSites.tsx` — sidebar site admin dialog
- `app/src/providers/weighQueue.tsx`, `app/src/providers/site.tsx`, `@shared/src/providers/trpc`

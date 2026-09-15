# Extractable components

## AppShell (Layout)
- Source: `app/src/components/Layout.tsx`
- Category: layout
- Description: Left rail shell — deepest-forest sidebar (radar logo + GRAIN TRACKER v2 brand, nav with gold active bar + LED, server LED, offline queue chip) and right column (offline crit banner, header with gt-eyebrow + page title, operator select, site select, night toggle, mono clock readout chip), main scroll area max-w-[1400px] p-6
- Extractable props: activeItem (string, default "dashboard"), pageTitle (string, default "Dashboard"), online (boolean, default true), queuedWeighs (number, default 0), night (boolean, default false), clock (string, default "12:00:00")
- Hardcoded: GRAIN TRACKER v2 wordmark (gt-brand gold gradient), nav items + lucide icons, gt-radar sweep logo, all gt-* classes

## ScaleReadout (instrument panel)
- Source: `app/src/pages/Scale.tsx` (ScalePanel readout block)
- Category: basic
- Description: Signature instrument readout — `.gt-scan` dark forest inset panel, mono 5xl–6xl glowing tabular digits + "lb" unit, source line ("USB scale · Simulator · Manual entry"), STABLE/LIVE/NO SIGNAL LED + mono label
- Extractable props: value (string, default "45,230"), unit (string, default "lb"), state ("stable"|"live"|"nosignal", default "stable"), source (string, default "USB scale")
- Hardcoded: gt-scan/gt-led/gt-eyebrow classes, glow text-shadow, tabular-nums

## SheetSummary strip
- Source: `app/src/pages/Scale.tsx` (SheetSummary)
- Category: basic
- Description: One-row ticket strip — huge mono ticketNo, direction badge (INBOUND amber / OUTBOUND forest), farmer + lotCode, crop badge, "On the lot · truck" amber badge with LED, loads progress bar
- Extractable props: ticketNo (string), direction ("INBOUND"|"OUTBOUND"), farmerName (string), lotCode (string), crop (string), completed (number), max (number), onLot (boolean), truckId (string)
- Hardcoded: cropBadgeClass tints, progress bar styles

## WeighConsole card
- Source: `app/src/pages/Scale.tsx` (WeighConsole)
- Category: basic
- Description: Weigh capture card — farmer/crop header row, truck ID + driver inputs (mono), destination bin select with "Auto — least-filled crop bin" option, h-14 gold bg-go capture button ("WEIGH IN — 45,230 lb"), CapturedStrip (gt-scan tare/gross captured readout) when a truck is mid-cycle
- Extractable props: mode ("weigh-in"|"weigh-out", default "weigh-in"), weightLbs (string, default ""), truckId (string, default ""), binLabel (string, default "Auto — least-filled Corn bin"), capturedLbs (string, default "")
- Hardcoded: bg-go button treatment, gt-scan CapturedStrip

## BinFillTile
- Source: `app/src/pages/Bins.tsx`
- Category: basic
- Description: Bin card with vertical grain-fill graphic (cropFillClass solid fill), % full, crop badge
- Extractable props: name (string), crop (string), pctFull (number, default 62)
- Hardcoded: fill classes per crop

## QueryError banner
- Source: `shared/src/components/QueryError.tsx`
- Category: basic
- Description: Red left-border error strip with mono uppercase title, truncated message, Retry button

## GradesDialog / BinDetailDialog
- Source: `app/src/components/GradesDialog.tsx`, `app/src/components/BinDetailDialog.tsx`
- Category: basic
- Description: Radix dialog patterns — grades entry (moisture/test weight/grade) and bin detail with loads table + CSV export

## TicketPrint
- Source: `app/src/components/TicketPrint.tsx`
- Category: basic
- Description: Print-only scale ticket (paper styling, mono, hidden behind #ticket-print print CSS)

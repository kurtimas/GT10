# Page Dependency Trees

Five key pages (trivial `/`-404 NotFound skipped). All render inside the shared `Layout` shell via `src/App.tsx`, so the shell chain is included at the top of every tree. Node-module imports (react, react-router, lucide-react, radix, sonner, trpc client libs, clsx, tailwind-merge, drizzle-orm) are omitted per INIT.md. Path aliases: `@/*` → `src/*`, `@contracts/*` → `contracts/*`, `@db/*` → `db/*` (set in `vite.config.ts` + `tsconfig.app.json`).

Shared leaf notes:
- `src/lib/trpc.ts` imports `AppRouter` **type-only** from `../../api/router` (backend; excluded from UI context).
- `contracts/grain.ts` and `contracts/types.ts` are pure constants/types/formatters (no local imports).
- `db/schema.ts` is drizzle table definitions (npm-only imports); People imports only the `Farmer` type from it.
- All `src/components/ui/*` depend on `src/lib/utils.ts`; dialog/select also use lucide icons; most wrap Radix primitives.

## / (Dashboard)

Entry: `src/pages/Dashboard.tsx`

Inline page-local components (defined in Dashboard.tsx, not imported): `ScalePanel`, `SheetCard`, `NewSheetDialog`, `ActivityFeed`.

```
src/pages/Dashboard.tsx
- src/components/Layout.tsx                        (shared shell via App.tsx)
  - src/lib/utils.ts
  - src/providers/trpc.tsx
    - src/lib/trpc.ts                              (type-only link to api/router)
  - src/components/ui/sonner.tsx
- src/lib/trpc.ts
- src/lib/utils.ts
- src/hooks/useScale.ts                            (Web Serial scale + simulator; react only)
- src/components/ui/sonner.tsx
- src/components/ui/alert.tsx
  - src/lib/utils.ts
- src/components/ui/badge.tsx
  - src/lib/utils.ts
- src/components/ui/button.tsx
  - src/lib/utils.ts
- src/components/ui/card.tsx
  - src/lib/utils.ts
- src/components/ui/dialog.tsx
  - src/lib/utils.ts
- src/components/ui/input.tsx
  - src/lib/utils.ts
- src/components/ui/label.tsx
  - src/lib/utils.ts
- src/components/ui/select.tsx
  - src/lib/utils.ts
- src/components/ui/separator.tsx
  - src/lib/utils.ts
- src/components/ui/skeleton.tsx
  - src/lib/utils.ts
- src/components/ui/slider.tsx
  - src/lib/utils.ts
- src/components/ui/tabs.tsx
  - src/lib/utils.ts
- src/components/ui/textarea.tsx
  - src/lib/utils.ts
- contracts/grain.ts                               (CROPS, fmtBu, fmtLbs — leaf)
- contracts/types.ts                               (SheetRow — leaf)
```

## /sheets (Sheets)

Entry: `src/pages/Sheets.tsx`

Inline page-local components: `StatusBadge`, `DirectionBadge`, hook `useInvalidateSheets`, `SheetDetailDialog` (loads ledger + audit trail), `GradesDialog`, `WeightsDialog`, `BinAssignDialog`.

```
src/pages/Sheets.tsx
- src/components/Layout.tsx                        (shared shell via App.tsx)
  - src/lib/utils.ts
  - src/providers/trpc.tsx
    - src/lib/trpc.ts
  - src/components/ui/sonner.tsx
- src/lib/trpc.ts
- src/lib/utils.ts
- src/components/ui/sonner.tsx
- src/components/ui/button.tsx
  - src/lib/utils.ts
- src/components/ui/badge.tsx
  - src/lib/utils.ts
- src/components/ui/card.tsx
  - src/lib/utils.ts
- src/components/ui/input.tsx
  - src/lib/utils.ts
- src/components/ui/label.tsx
  - src/lib/utils.ts
- src/components/ui/select.tsx
  - src/lib/utils.ts
- src/components/ui/table.tsx
  - src/lib/utils.ts
- src/components/ui/dialog.tsx
  - src/lib/utils.ts
- src/components/ui/textarea.tsx
  - src/lib/utils.ts
- src/components/ui/skeleton.tsx
  - src/lib/utils.ts
- src/components/ui/separator.tsx
  - src/lib/utils.ts
- src/components/ui/alert.tsx
  - src/lib/utils.ts
- contracts/grain.ts                               (CROPS, computeBushels, fmtBu, fmtLbs — leaf)
- contracts/types.ts                               (LoadRow, SheetRow — leaf)
```

## /bins (Bins)

Entry: `src/pages/Bins.tsx`

Inline page-local components: helpers (`fillBarClass`, `fillTextClass`), hook `useCapacityConverter`, `CapacityFields`, `AddSiteDialog`, `AddBinDialog`, `EditBinDialog`, `AdjustLevelDialog`, `DeleteBinDialog`, `BinCard`.

```
src/pages/Bins.tsx
- src/components/Layout.tsx                        (shared shell via App.tsx)
  - src/lib/utils.ts
  - src/providers/trpc.tsx
    - src/lib/trpc.ts
  - src/components/ui/sonner.tsx
- src/lib/trpc.ts
- src/lib/utils.ts
- src/components/ui/sonner.tsx
- src/components/ui/badge.tsx
  - src/lib/utils.ts
- src/components/ui/button.tsx
  - src/lib/utils.ts
- src/components/ui/card.tsx
  - src/lib/utils.ts
- src/components/ui/dialog.tsx
  - src/lib/utils.ts
- src/components/ui/input.tsx
  - src/lib/utils.ts
- src/components/ui/label.tsx
  - src/lib/utils.ts
- src/components/ui/select.tsx
  - src/lib/utils.ts
- src/components/ui/skeleton.tsx
  - src/lib/utils.ts
- contracts/grain.ts                               (CROPS, bushelWeight, fmtLbs, Crop — leaf)
- contracts/types.ts                               (BinRow — leaf)
```

## /people (People)

Entry: `src/pages/People.tsx`

Inline page-local components: helpers (`TableSkeletonRows`, `EmptyRow`), `FarmerDialog`, `LandlordDialog`, `LotDialog`, `CloseLotDialog`, `FarmersTab`, `LandlordsTab`, `LotsTab`.

```
src/pages/People.tsx
- src/components/Layout.tsx                        (shared shell via App.tsx)
  - src/lib/utils.ts
  - src/providers/trpc.tsx
    - src/lib/trpc.ts
  - src/components/ui/sonner.tsx
- src/lib/trpc.ts
- src/components/ui/sonner.tsx
- src/components/ui/badge.tsx
  - src/lib/utils.ts
- src/components/ui/button.tsx
  - src/lib/utils.ts
- src/components/ui/card.tsx
  - src/lib/utils.ts
- src/components/ui/dialog.tsx
  - src/lib/utils.ts
- src/components/ui/input.tsx
  - src/lib/utils.ts
- src/components/ui/label.tsx
  - src/lib/utils.ts
- src/components/ui/select.tsx
  - src/lib/utils.ts
- src/components/ui/skeleton.tsx
  - src/lib/utils.ts
- src/components/ui/table.tsx
  - src/lib/utils.ts
- src/components/ui/tabs.tsx
  - src/lib/utils.ts
- src/components/ui/textarea.tsx
  - src/lib/utils.ts
- contracts/grain.ts                               (CROPS, Crop — leaf)
- contracts/types.ts                               (LotRow — leaf)
- db/schema.ts                                     (Farmer type only; drizzle-orm npm dep)
```

## /reports (Reports)

Entry: `src/pages/Reports.tsx`

Inline page-local components: `DirectionBadge`, `LoadStatusBadge`, `SummaryCard`.

```
src/pages/Reports.tsx
- src/components/Layout.tsx                        (shared shell via App.tsx)
  - src/lib/utils.ts
  - src/providers/trpc.tsx
    - src/lib/trpc.ts
  - src/components/ui/sonner.tsx
- src/lib/trpc.ts
- contracts/grain.ts                               (fmtBu, fmtLbs — leaf)
- src/components/ui/sonner.tsx
- src/components/ui/button.tsx
  - src/lib/utils.ts
- src/components/ui/card.tsx
  - src/lib/utils.ts
- src/components/ui/input.tsx
  - src/lib/utils.ts
- src/components/ui/label.tsx
  - src/lib/utils.ts
- src/components/ui/badge.tsx
  - src/lib/utils.ts
- src/components/ui/skeleton.tsx
  - src/lib/utils.ts
- src/components/ui/separator.tsx
  - src/lib/utils.ts
- src/components/ui/table.tsx
  - src/lib/utils.ts
- src/components/ui/dialog.tsx
  - src/lib/utils.ts
```

## Entry chain (all pages)

```
index.html
- src/main.tsx
  - src/index.css                                  (theme tokens + .gt-* utilities)
  - src/providers/trpc.tsx
    - src/lib/trpc.ts
  - src/App.tsx
    - src/components/Layout.tsx                    (shell: sidebar + header + main + Toaster)
    - src/pages/Dashboard.tsx | Sheets.tsx | Bins.tsx | People.tsx | Reports.tsx | NotFound.tsx
```

Deduplicated `--context-file` candidate set for any page design: the page file itself, `src/components/Layout.tsx`, the `src/components/ui/*` files the page imports, `src/lib/utils.ts`, `src/hooks/useScale.ts` (Dashboard only), and the `contracts/*` files it references. Apply PAYLOAD BUDGET rules when selecting — the page file plus Layout plus `src/index.css` token summary (theme.md Part 1) is usually the core.

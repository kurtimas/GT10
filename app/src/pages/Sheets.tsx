// Weight Sheets — searchable archive of all sheets + full sheet detail
// (loads ledger, per-load grades / weight corrections / bin assign / void,
// close sheet, audit trail).

import { useEffect, useMemo, useState } from "react";
import { Download, Printer } from "lucide-react";
import { trpc } from "@shared/src/lib/trpc";
import { cn } from "@shared/src/lib/utils";
import { csvDateStamp, downloadCsv } from "@shared/src/lib/csv";
import { useSite } from "@/providers/site";
import { toast } from "@shared/src/components/ui/sonner";
import { Button } from "@shared/src/components/ui/button";
import { Badge } from "@shared/src/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@shared/src/components/ui/card";
import { Input } from "@shared/src/components/ui/input";
import { Label } from "@shared/src/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shared/src/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@shared/src/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@shared/src/components/ui/dialog";
import { Textarea } from "@shared/src/components/ui/textarea";
import { Skeleton } from "@shared/src/components/ui/skeleton";
import { Separator } from "@shared/src/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@shared/src/components/ui/alert";
import { QueryError } from "@shared/src/components/QueryError";
import { GradesDialog } from "@/components/GradesDialog";
import { AdminPasswordField } from "@/components/AdminPasswordField";
import { TicketPrint } from "@/components/TicketPrint";
import { CROPS, fmtBu, fmtLbs } from "@contracts/grain";
import type { LoadRow, SheetRow } from "@contracts/types";

// ---------------------------------------------------------------- helpers

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return `${fmtDate(d)} ${fmtTime(d)}`;
}

/** Parse a nullable numeric input — empty string means null. */
function parseNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function numStr(n: number | null | undefined): string {
  return n == null ? "" : String(n);
}

function statusBadgeClass(status: SheetRow["status"]): string {
  switch (status) {
    case "OPEN":
      return "border-stable/50 bg-stable/10 text-stable";
    case "FULL":
      return "border-go/50 bg-go/10 text-go";
    case "CLOSED":
      return "border-border bg-muted text-muted-foreground";
  }
}

function StatusBadge({ status }: { status: SheetRow["status"] }) {
  return (
    <Badge variant="outline" className={cn("font-mono text-[10px]", statusBadgeClass(status))}>
      {status}
    </Badge>
  );
}

function DirectionBadge({ direction }: { direction: SheetRow["direction"] }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono text-[10px]",
        direction === "INBOUND"
          ? "border-live/50 bg-live/10 text-live"
          : "border-go/50 bg-go/10 text-go",
      )}
    >
      {direction === "INBOUND" ? "IN" : "OUT"}
    </Badge>
  );
}

/** Invalidate everything a sheet mutation can touch. */
function useInvalidateSheets() {
  const utils = trpc.useUtils();
  return () => {
    void utils.sheets.get.invalidate();
    void utils.sheets.list.invalidate();
    void utils.sheets.open.invalidate();
    void utils.core.bins.list.invalidate();
  };
}

// ---------------------------------------------------------------- page

export default function SheetsPage() {
  const { siteId } = useSite();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [farmerId, setFarmerId] = useState("all");
  const [crop, setCrop] = useState("all");
  const [status, setStatus] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showVoided, setShowVoided] = useState(false);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // debounce free-text search (~300ms)
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const filters = useMemo(
    () => ({
      ...(siteId != null ? { siteId } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(farmerId !== "all" ? { farmerId: Number(farmerId) } : {}),
      ...(crop !== "all" ? { crop } : {}),
      ...(status !== "all" ? { status: status as SheetRow["status"] } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
      ...(showVoided ? { includeVoided: true } : {}),
    }),
    [siteId, debouncedSearch, farmerId, crop, status, dateFrom, dateTo, showVoided],
  );

  const sheetsQ = trpc.sheets.list.useQuery(filters, { enabled: siteId != null });
  const farmersQ = trpc.people.farmers.list.useQuery();

  const hasFilters =
    debouncedSearch !== "" ||
    farmerId !== "all" ||
    crop !== "all" ||
    status !== "all" ||
    dateFrom !== "" ||
    dateTo !== "";

  const clearFilters = () => {
    setSearch("");
    setDebouncedSearch("");
    setFarmerId("all");
    setCrop("all");
    setStatus("all");
    setDateFrom("");
    setDateTo("");
  };

  const openDetail = (id: number) => {
    setSelectedId(id);
    setDetailOpen(true);
  };

  const rows = sheetsQ.data ?? [];

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <div className="gt-eyebrow">ARCHIVE</div>
        <h1 className="text-xl font-semibold tracking-tight">Weight Sheets</h1>
      </div>

      {/* ------------------------------------------------ filter bar */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-3 p-4 md:grid-cols-3 xl:grid-cols-7">
          <div className="col-span-2 space-y-1">
            <Label htmlFor="sheet-search" className="text-xs">
              Search
            </Label>
            <Input
              id="sheet-search"
              placeholder="Farmer, lot, landlord, ticket, truck, driver…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Farmer</Label>
            <Select value={farmerId} onValueChange={setFarmerId}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All farmers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All farmers</SelectItem>
                {(farmersQ.data ?? []).map((f) => (
                  <SelectItem key={f.id} value={String(f.id)}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Crop</Label>
            <Select value={crop} onValueChange={setCrop}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All crops" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All crops</SelectItem>
                {CROPS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="OPEN">OPEN</SelectItem>
                <SelectItem value="FULL">FULL</SelectItem>
                <SelectItem value="CLOSED">CLOSED</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="date-from" className="text-xs">
              From
            </Label>
            <Input
              id="date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="date-to" className="text-xs">
              To
            </Label>
            <div className="flex gap-2">
              <Input
                id="date-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-8 font-mono text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={clearFilters}
                disabled={!hasFilters && search === ""}
              >
                Clear
              </Button>
            </div>
          </div>
          <div className="col-span-2 flex items-end justify-between gap-3 pb-1 md:col-span-3 xl:col-span-7">
            <label className="flex cursor-pointer items-center gap-2 font-mono text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={showVoided}
                onChange={(e) => setShowVoided(e.target.checked)}
                className="h-3.5 w-3.5 accent-[hsl(var(--crit))]"
              />
              Show voided sheets (audit view)
            </label>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={rows.length === 0}
              onClick={() =>
                downloadCsv(
                  `weight-sheets-${csvDateStamp()}.csv`,
                  [
                    "Ticket", "Created", "Farmer", "Lot", "Crop", "Direction", "Status",
                    "Load #", "Truck", "Driver", "Bin", "Gross lbs", "Tare lbs", "Net lbs",
                    "Net bu", "Moisture %", "Voided",
                  ],
                  rows.flatMap((s) => {
                    const base = [
                      s.ticketNo,
                      new Date(s.createdAt).toLocaleString("en-US"),
                      s.farmerName,
                      s.lotCode,
                      s.crop,
                      s.direction,
                      s.voidedAt ? `VOID (${s.voidReason ?? ""})` : s.status,
                    ];
                    const loads = s.loads ?? [];
                    if (loads.length === 0) {
                      return [[...base, "", "", "", "", "", "", "", "", "", s.voidedAt ? "yes" : ""]];
                    }
                    return loads.map((l) => [
                      ...base,
                      l.loadNo,
                      l.truckId,
                      l.driverName,
                      l.binName,
                      l.grossLbs,
                      l.tareLbs,
                      l.netLbs,
                      l.netBushels,
                      l.moisturePct,
                      l.voidedAt ? "yes" : "",
                    ]);
                  }),
                )
              }
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Download CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {sheetsQ.isError && (
        <QueryError
          title="Weight sheets failed to load"
          message={sheetsQ.error.message}
          onRetry={() => void sheetsQ.refetch()}
          retrying={sheetsQ.isRefetching}
        />
      )}

      {/* ------------------------------------------------ results table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 py-3">
          <CardTitle className="text-sm font-medium">Sheets</CardTitle>
          <span className="font-mono text-xs text-muted-foreground">
            {sheetsQ.isLoading ? "…" : `${rows.length} result${rows.length === 1 ? "" : "s"}`}
          </span>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticket</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Farmer</TableHead>
                <TableHead>Lot</TableHead>
                <TableHead>Crop</TableHead>
                <TableHead>Dir</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Loads</TableHead>
                <TableHead className="text-right">Net lbs</TableHead>
                <TableHead className="text-right">Net bu</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sheetsQ.isLoading &&
                Array.from({ length: 6 }, (_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 10 }, (_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              {!sheetsQ.isLoading && !sheetsQ.isError && rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={10}
                    className="h-24 text-center text-sm text-muted-foreground"
                  >
                    No weight sheets match these filters
                  </TableCell>
                </TableRow>
              )}
              {rows.map((s) => (
                <TableRow
                  key={s.id}
                  className={cn(
                    "cursor-pointer hover:bg-accent/40",
                    s.voidedAt != null && "opacity-55",
                  )}
                  onClick={() => openDetail(s.id)}
                >
                  <TableCell className="font-mono text-xs text-primary">
                    {s.ticketNo}
                    {s.voidedAt != null && (
                      <Badge
                        variant="outline"
                        className="ml-2 border-crit/50 bg-crit/10 font-mono text-[10px] text-crit"
                        title={s.voidReason ?? "Voided"}
                      >
                        VOID
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {fmtDate(s.createdAt)}
                  </TableCell>
                  <TableCell className="text-sm">{s.farmerName ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs">{s.lotCode ?? "—"}</span>
                      {s.landlordName != null && (
                        <Badge
                          variant="outline"
                          className="border-border font-mono text-[10px] text-muted-foreground"
                        >
                          {s.landlordName}
                          {s.lotSplitPct != null && s.lotSplitPct > 0 ? ` ${s.lotSplitPct}%` : ""}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{s.crop}</TableCell>
                  <TableCell>
                    <DirectionBadge direction={s.direction} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={s.status} />
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {s.completedLoads}/{s.maxLoads}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{fmtLbs(s.netLbs)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {fmtBu(s.netBushels)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <SheetDetailDialog
        sheetId={selectedId}
        open={detailOpen}
        onOpenChange={(o) => {
          setDetailOpen(o);
          if (!o) setSelectedId(null);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- detail

function SheetDetailDialog({
  sheetId,
  open,
  onOpenChange,
}: {
  sheetId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const invalidate = useInvalidateSheets();
  const [showVoidedLoads, setShowVoidedLoads] = useState(false);
  const detailQ = trpc.sheets.get.useQuery(
    { id: sheetId ?? -1, ...(showVoidedLoads ? { includeVoided: true } : {}) },
    { enabled: open && sheetId != null },
  );
  const binsQ = trpc.core.bins.list.useQuery(undefined, { enabled: open });

  const [gradesLoad, setGradesLoad] = useState<LoadRow | null>(null);
  const [weightsLoad, setWeightsLoad] = useState<LoadRow | null>(null);
  const [binLoad, setBinLoad] = useState<LoadRow | null>(null);
  const [voidTarget, setVoidTarget] = useState<LoadRow | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidPassword, setVoidPassword] = useState("");
  const [closeConfirm, setCloseConfirm] = useState(false);
  const [voidSheetConfirm, setVoidSheetConfirm] = useState(false);
  const [voidSheetReason, setVoidSheetReason] = useState("");

  const closeMut = trpc.sheets.close.useMutation({
    onSuccess: () => {
      toast.success("Sheet closed");
      setCloseConfirm(false);
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const voidMut = trpc.sheets.voidLoad.useMutation({
    onSuccess: () => {
      toast.success("Load voided");
      setVoidTarget(null);
      setVoidReason("");
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const voidSheetMut = trpc.sheets.voidSheet.useMutation({
    onSuccess: () => {
      toast.success("Sheet voided");
      setVoidSheetConfirm(false);
      setVoidSheetReason("");
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const sheet = detailQ.data?.sheet;
  const events = detailQ.data?.events ?? [];
  const loads = sheet?.loads ?? [];
  // Recorded data stays editable on CLOSED (locked) tickets — those edits
  // ask for the admin password inside each dialog.
  const editable = sheet != null;
  const locked = sheet?.status === "CLOSED";
  const siteBins = (binsQ.data ?? []).filter(
    (b) => sheet != null && b.siteId === sheet.siteId && b.crop === sheet.crop,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        {detailQ.isLoading || !sheet ? (
          <div className="space-y-3 p-2">
            <DialogHeader>
              <DialogTitle>Loading sheet…</DialogTitle>
              <DialogDescription className="sr-only">Loading sheet detail</DialogDescription>
            </DialogHeader>
            {detailQ.isError ? (
              <QueryError
                title="Sheet detail failed to load"
                message={detailQ.error.message}
                onRetry={() => void detailQ.refetch()}
                retrying={detailQ.isRefetching}
              />
            ) : (
              <>
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-40 w-full" />
              </>
            )}
          </div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle className="font-mono text-lg text-primary">
                  {sheet.ticketNo}
                </DialogTitle>
                <StatusBadge status={sheet.status} />
                <DirectionBadge direction={sheet.direction} />
                <Badge variant="outline" className="font-mono text-[10px]">
                  {sheet.crop}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  onClick={() => window.print()}
                >
                  <Printer className="mr-2 h-3.5 w-3.5" />
                  Print ticket
                </Button>
              </div>
              <DialogDescription>
                {sheet.farmerName ?? "—"}
                {sheet.lotCode ? ` · Lot ${sheet.lotCode}` : ""}
                {sheet.landlordName
                  ? ` · ${sheet.landlordName}${
                      sheet.lotSplitPct != null && sheet.lotSplitPct > 0
                        ? ` ${sheet.lotSplitPct}%`
                        : ""
                    }`
                  : ""}
                {sheet.siteName ? ` · ${sheet.siteName}` : ""}
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs md:grid-cols-4">
              <div>
                <span className="gt-eyebrow">Created</span>
                <div className="font-mono">{fmtDateTime(sheet.createdAt)}</div>
              </div>
              <div>
                <span className="gt-eyebrow">Closed</span>
                <div className="font-mono">{sheet.closedAt ? fmtDateTime(sheet.closedAt) : "—"}</div>
              </div>
              <div>
                <span className="gt-eyebrow">Loads</span>
                <div className="font-mono">
                  {sheet.completedLoads}/{sheet.maxLoads} complete
                </div>
              </div>
              <div>
                <span className="gt-eyebrow">Totals</span>
                <div className="font-mono">
                  {fmtLbs(sheet.netLbs)} lbs · {fmtBu(sheet.netBushels)} bu
                </div>
              </div>
              {sheet.notes && (
                <div className="col-span-2 md:col-span-4">
                  <span className="gt-eyebrow">Notes</span>
                  <div className="text-muted-foreground">{sheet.notes}</div>
                </div>
              )}
              {sheet.closeReason && (
                <div className="col-span-2 md:col-span-4">
                  <span className="gt-eyebrow">Close reason</span>
                  <div className="font-mono text-muted-foreground">{sheet.closeReason}</div>
                </div>
              )}
            </div>

            {sheet.voidedAt != null && (
              <Alert variant="destructive">
                <AlertTitle>Sheet voided {fmtDateTime(sheet.voidedAt)}</AlertTitle>
                <AlertDescription>
                  {sheet.voidReason ?? "No reason recorded"}. The sheet and its loads are
                  kept for the audit trail but count toward nothing.
                </AlertDescription>
              </Alert>
            )}

            {sheet.status === "OPEN" && sheet.voidedAt == null && (
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-crit/50 text-crit hover:bg-crit/10"
                  onClick={() => setVoidSheetConfirm(true)}
                >
                  Void sheet
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-primary/50 text-primary hover:bg-primary/10"
                  onClick={() => setCloseConfirm(true)}
                >
                  Close sheet
                </Button>
              </div>
            )}

            <Separator />

            {/* ------------------------------------------------ loads */}
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="gt-eyebrow">Loads</div>
                <label className="flex cursor-pointer items-center gap-2 font-mono text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={showVoidedLoads}
                    onChange={(e) => setShowVoidedLoads(e.target.checked)}
                    className="h-3.5 w-3.5 accent-[hsl(var(--crit))]"
                  />
                  Show voided loads
                </label>
              </div>
              <div className="overflow-x-auto rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right">#</TableHead>
                      <TableHead>Truck</TableHead>
                      <TableHead>Driver</TableHead>
                      <TableHead>Bin</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">Tare</TableHead>
                      <TableHead className="text-right">Net lbs</TableHead>
                      <TableHead>In</TableHead>
                      <TableHead>Out</TableHead>
                      <TableHead className="text-right">Moist%</TableHead>
                      <TableHead className="text-right">Dock%</TableHead>
                      <TableHead className="text-right">TW</TableHead>
                      <TableHead className="text-right">Prot%</TableHead>
                      <TableHead className="text-right">Dmg%</TableHead>
                      <TableHead className="text-right">Shrink%</TableHead>
                      <TableHead className="text-right">Gross bu</TableHead>
                      <TableHead className="text-right">Net bu</TableHead>
                      <TableHead>Grade / Origin</TableHead>
                      {editable && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loads.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={editable ? 19 : 18}
                          className="h-16 text-center text-sm text-muted-foreground"
                        >
                          No loads recorded on this sheet yet
                        </TableCell>
                      </TableRow>
                    )}
                    {loads.map((l) => {
                      const onScale = l.netLbs == null && l.voidedAt == null;
                      const voided = l.voidedAt != null;
                      return (
                        <TableRow
                          key={l.id}
                          className={cn(
                            onScale && "bg-live/10 hover:bg-live/15",
                            voided && "opacity-55",
                          )}
                        >
                          <TableCell className="text-right font-mono text-xs">
                            <div className="flex items-center justify-end gap-1.5">
                              {onScale && (
                                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-live">
                                  ON SCALE
                                </span>
                              )}
                              {voided && (
                                <span
                                  className="font-mono text-[10px] font-semibold uppercase tracking-wider text-crit"
                                  title={l.voidReason ?? "Voided"}
                                >
                                  VOID
                                </span>
                              )}
                              {l.loadNo}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{l.truckId ?? "—"}</TableCell>
                          <TableCell className="text-xs">{l.driverName ?? "—"}</TableCell>
                          <TableCell className="text-xs">{l.binName ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {fmtLbs(l.grossLbs)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {fmtLbs(l.tareLbs)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs font-semibold">
                            {fmtLbs(l.netLbs)}
                          </TableCell>
                          <TableCell className="font-mono text-[11px] text-muted-foreground">
                            {fmtTime(l.grossAt)}
                          </TableCell>
                          <TableCell className="font-mono text-[11px] text-muted-foreground">
                            {fmtTime(l.tareAt)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {l.moisturePct ?? "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {l.dockagePct ?? "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {l.testWeightLbs ?? "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {l.proteinPct ?? "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {l.damagePct ?? "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {l.shrinkPct ?? "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {fmtBu(l.grossBushels)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {fmtBu(l.netBushels)}
                          </TableCell>
                          <TableCell className="max-w-[160px] truncate font-mono text-[11px] text-muted-foreground">
                            {l.grade || l.farmOrigin
                              ? [l.grade, l.farmOrigin].filter(Boolean).join(" · ")
                              : "—"}
                          </TableCell>
                          {editable && (
                            <TableCell className="text-right">
                              {!voided && (
                                <div className="flex justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 font-mono text-[10px]"
                                  onClick={() => setGradesLoad(l)}
                                >
                                  Grades
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 font-mono text-[10px]"
                                  onClick={() => setWeightsLoad(l)}
                                  disabled={onScale}
                                  title={onScale ? "Finish weighing before correcting" : undefined}
                                >
                                  Weights
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 font-mono text-[10px]"
                                  onClick={() => setBinLoad(l)}
                                >
                                  Bin
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 font-mono text-[10px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                                  onClick={() => setVoidTarget(l)}
                                >
                                  Void
                                </Button>
                                </div>
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* ------------------------------------------------ audit trail */}
            <div>
              <div className="gt-eyebrow mb-2">Audit trail</div>
              {events.length === 0 ? (
                <div className="text-xs text-muted-foreground">No events recorded.</div>
              ) : (
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                  {events.map((ev) => (
                    <div
                      key={ev.id}
                      className="flex items-baseline gap-3 font-mono text-[11px] leading-tight"
                    >
                      <span className="flex-none text-muted-foreground">
                        {fmtDateTime(ev.createdAt)}
                      </span>
                      <span className="flex-none font-semibold text-primary">{ev.action}</span>
                      {ev.loadId != null && (
                        <span className="flex-none text-muted-foreground">L#{ev.loadId}</span>
                      )}
                      {ev.detail && (
                        <span className="truncate text-muted-foreground">{ev.detail}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ------------------------------------------ nested dialogs */}
        {sheet && <TicketPrint sheet={sheet} />}
        {sheet && gradesLoad && (
          <GradesDialog
            key={gradesLoad.id}
            load={gradesLoad}
            crop={sheet.crop}
            locked={locked}
            open
            onOpenChange={(o) => !o && setGradesLoad(null)}
          />
        )}
        {weightsLoad && (
          <WeightsDialog
            key={weightsLoad.id}
            load={weightsLoad}
            locked={locked}
            open
            onOpenChange={(o) => !o && setWeightsLoad(null)}
          />
        )}
        {binLoad && (
          <BinAssignDialog
            key={binLoad.id}
            load={binLoad}
            bins={siteBins}
            locked={locked}
            open
            onOpenChange={(o) => !o && setBinLoad(null)}
          />
        )}

        {/* void confirm */}
        <Dialog
          open={voidTarget != null}
          onOpenChange={(o) => {
            if (!o) {
              setVoidTarget(null);
              setVoidReason("");
            }
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Void load {voidTarget?.loadNo}?</DialogTitle>
              <DialogDescription>
                The load is marked void and kept for the audit trail — it no
                longer counts toward sheet totals, bins, or reports.
              </DialogDescription>
            </DialogHeader>
            <Alert variant="destructive">
              <AlertTitle>Bin inventory is reversed</AlertTitle>
              <AlertDescription>
                Voiding removes this load&apos;s weight from its bin. A FULL sheet re-opens.
              </AlertDescription>
            </Alert>
            <div className="space-y-1.5">
              <Label htmlFor="void-reason">Void reason</Label>
              <Textarea
                id="void-reason"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="Why is this load being voided? (required)"
                rows={2}
                autoFocus
              />
            </div>
            {locked && (
              <AdminPasswordField
                id="void-locked-password"
                value={voidPassword}
                onChange={setVoidPassword}
                hint="This ticket is locked (closed) — voiding a load on it requires the site admin password."
              />
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setVoidTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={
                  voidMut.isPending ||
                  voidReason.trim().length < 3 ||
                  (locked && voidPassword === "")
                }
                onClick={() =>
                  voidTarget &&
                  voidMut.mutate({
                    loadId: voidTarget.id,
                    voidReason: voidReason.trim(),
                    adminPassword: voidPassword || undefined,
                  })
                }
              >
                {voidMut.isPending ? "Voiding…" : "Void load"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* void sheet confirm */}
        <Dialog
          open={voidSheetConfirm}
          onOpenChange={(o) => {
            setVoidSheetConfirm(o);
            if (!o) setVoidSheetReason("");
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Void sheet {sheet?.ticketNo}?</DialogTitle>
              <DialogDescription>
                The sheet is marked void and kept for the audit trail. Only
                sheets with no completed loads can be voided — void completed
                loads individually first. Any load still on the scale is
                voided with the same reason.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="void-sheet-reason">Void reason</Label>
              <Textarea
                id="void-sheet-reason"
                value={voidSheetReason}
                onChange={(e) => setVoidSheetReason(e.target.value)}
                placeholder="Why is this sheet being voided? (required)"
                rows={2}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setVoidSheetConfirm(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={voidSheetMut.isPending || voidSheetReason.trim().length < 3}
                onClick={() =>
                  sheetId != null &&
                  voidSheetMut.mutate({ id: sheetId, voidReason: voidSheetReason.trim() })
                }
              >
                {voidSheetMut.isPending ? "Voiding…" : "Void sheet"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* close sheet confirm */}        <Dialog open={closeConfirm} onOpenChange={setCloseConfirm}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Close sheet {sheet?.ticketNo}?</DialogTitle>
              <DialogDescription>
                Closed sheets are locked — no more loads or edits. The server refuses while a load
                is still on the scale.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCloseConfirm(false)}>
                Cancel
              </Button>
              <Button
                disabled={closeMut.isPending || sheetId == null}
                onClick={() => sheetId != null && closeMut.mutate({ id: sheetId })}
              >
                {closeMut.isPending ? "Closing…" : "Close sheet"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- weights

function WeightsDialog({
  load,
  locked,
  open,
  onOpenChange,
}: {
  load: LoadRow;
  /** sheet is CLOSED — the edit needs the admin password */
  locked?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const invalidate = useInvalidateSheets();
  const [gross, setGross] = useState(numStr(load.grossLbs));
  const [tare, setTare] = useState(numStr(load.tareLbs));
  const [reason, setReason] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const mut = trpc.sheets.updateLoadWeights.useMutation({
    onSuccess: () => {
      toast.success(`Weights corrected for load ${load.loadNo}`);
      invalidate();
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const grossN = parseNum(gross);
  const tareN = parseNum(tare);
  const netPreview = grossN != null && tareN != null ? grossN - tareN : null;
  const valid =
    grossN != null &&
    grossN > 0 &&
    tareN != null &&
    tareN > 0 &&
    netPreview != null &&
    netPreview > 0 &&
    reason.trim().length >= 3 &&
    (!locked || adminPassword !== "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Correct weights — load {load.loadNo}</DialogTitle>
          <DialogDescription>
            Corrections rebalance bin inventory and are written to the audit trail.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="w-gross" className="text-xs">
              Gross lbs
            </Label>
            <Input
              id="w-gross"
              type="number"
              min="1"
              value={gross}
              onChange={(e) => setGross(e.target.value)}
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="w-tare" className="text-xs">
              Tare lbs
            </Label>
            <Input
              id="w-tare"
              type="number"
              min="1"
              value={tare}
              onChange={(e) => setTare(e.target.value)}
              className="h-8 font-mono text-xs"
            />
          </div>
        </div>
        {netPreview != null && netPreview > 0 && (
          <div className="flex justify-between rounded-md border border-border bg-readout px-3 py-2 font-mono text-xs text-sidebar-foreground">
            <span className="text-sidebar-foreground/60">New net</span>
            <span className="font-semibold">{fmtLbs(netPreview)} lbs</span>
          </div>
        )}
        {netPreview != null && netPreview <= 0 && (
          <p className="font-mono text-[10px] text-crit">
            Net must be positive — gross has to exceed tare (the server will
            refuse the correction).
          </p>
        )}
        <div className="space-y-1">
          <Label htmlFor="w-reason" className="text-xs">
            Change reason <span className="text-crit">*</span>
          </Label>
          <Textarea
            id="w-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Required — why are these weights being corrected?"
            rows={2}
            className="text-xs"
          />
          {reason.trim().length > 0 && reason.trim().length < 3 && (
            <p className="font-mono text-[10px] text-crit">
              Reason must be at least 3 characters.
            </p>
          )}
        </div>
        {locked && (
          <AdminPasswordField
            id="weights-locked-password"
            value={adminPassword}
            onChange={setAdminPassword}
            hint="This ticket is locked (closed) — correcting weights requires the site admin password."
          />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!valid || mut.isPending}
            onClick={() =>
              grossN != null &&
              tareN != null &&
              mut.mutate({
                loadId: load.id,
                grossLbs: Math.round(grossN),
                tareLbs: Math.round(tareN),
                changeReason: reason.trim(),
                adminPassword: adminPassword || undefined,
              })
            }
          >
            {mut.isPending ? "Saving…" : "Save correction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------- bin assign

function BinAssignDialog({
  load,
  bins,
  locked,
  open,
  onOpenChange,
}: {
  load: LoadRow;
  bins: { id: number; name: string; currentLbs: number; capacityLbs: number }[];
  /** sheet is CLOSED — the edit needs the admin password */
  locked?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const invalidate = useInvalidateSheets();
  const [binId, setBinId] = useState(load.binId != null ? String(load.binId) : "none");
  const [adminPassword, setAdminPassword] = useState("");

  const mut = trpc.sheets.assignLoadBin.useMutation({
    onSuccess: () => {
      toast.success(`Bin updated for load ${load.loadNo}`);
      invalidate();
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Assign bin — load {load.loadNo}</DialogTitle>
          <DialogDescription>
            Only bins at this sheet&apos;s site holding the sheet&apos;s crop are listed. Inventory
            moves with the assignment.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label className="text-xs">Bin</Label>
          <Select value={binId} onValueChange={setBinId}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select bin" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— none —</SelectItem>
              {bins.map((b) => (
                <SelectItem key={b.id} value={String(b.id)}>
                  {b.name} ({fmtLbs(b.currentLbs)}/{fmtLbs(b.capacityLbs)} lbs)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {bins.length === 0 && (
            <p className="font-mono text-[10px] text-muted-foreground">
              No bins at this site hold this crop.
            </p>
          )}
        </div>
        {locked && (
          <AdminPasswordField
            id="bin-locked-password"
            value={adminPassword}
            onChange={setAdminPassword}
            hint="This ticket is locked (closed) — moving grain between bins requires the site admin password."
          />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={mut.isPending || (locked && adminPassword === "")}
            onClick={() =>
              mut.mutate({
                loadId: load.id,
                binId: binId === "none" ? null : Number(binId),
                adminPassword: adminPassword || undefined,
              })
            }
          >
            {mut.isPending ? "Saving…" : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

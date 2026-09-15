// Bin detail / provenance view (Phase 5): current composition by lot
// (provenance replay via shipments.binComposition) plus the append-only
// movement history (core.bins.movements) — in/out events with timestamps,
// quantities, operator, and linked ticket / shipment.

import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, Download } from "lucide-react";
import { trpc } from "@shared/src/lib/trpc";
import { cn, cropBadgeClass } from "@shared/src/lib/utils";
import { csvDateStamp, downloadCsv } from "@shared/src/lib/csv";
import { Badge } from "@shared/src/components/ui/badge";
import { Button } from "@shared/src/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@shared/src/components/ui/dialog";
import { Separator } from "@shared/src/components/ui/separator";
import { Skeleton } from "@shared/src/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@shared/src/components/ui/table";
import { QueryError } from "@shared/src/components/QueryError";
import { bushelWeight, fmtLbs } from "@contracts/grain";
import type { BinRow } from "@contracts/types";

function fmtDateTime(d: Date | string): string {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Direction of a movement RELATIVE to the bin being viewed. */
function directionOf(m: { fromBinId: number | null; toBinId: number | null }, binId: number) {
  const isIn = m.toBinId === binId;
  const isOut = m.fromBinId === binId;
  if (isIn && isOut) return "transfer" as const; // shouldn't happen, defensive
  if (isIn) return m.fromBinId == null ? ("in" as const) : ("transfer" as const);
  if (isOut) return m.toBinId == null ? ("out" as const) : ("transfer" as const);
  return "out" as const;
}

const DIR_META = {
  in: { label: "IN", icon: ArrowDownToLine, cls: "border-stable/50 bg-stable/10 text-stable" },
  out: { label: "OUT", icon: ArrowUpFromLine, cls: "border-crit/50 bg-crit/10 text-crit" },
  transfer: { label: "MOVE", icon: ArrowLeftRight, cls: "border-live/50 bg-live/10 text-live" },
} as const;

export function BinDetailDialog({
  bin,
  onClose,
}: {
  bin: BinRow;
  onClose: () => void;
}) {
  const compQ = trpc.shipments.binComposition.useQuery({ binId: bin.id });
  const movesQ = trpc.core.bins.movements.useQuery({ binId: bin.id });

  const comp = compQ.data;
  const compTotal = comp?.composition.reduce((a, c) => a + c.lbs, 0) ?? 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="text-lg">{bin.name}</DialogTitle>
            <Badge
              variant="outline"
              className={cn("font-mono text-[10px] uppercase", cropBadgeClass(bin.crop))}
            >
              {bin.crop}
            </Badge>
          </div>
          <DialogDescription>
            {bin.siteName ?? ""} · holding {fmtLbs(bin.currentLbs)} lb (
            {bin.capacityLbs > 0
              ? `${fmtLbs(Math.round(bin.currentLbs / bushelWeight(bin.crop)))} bu`
              : "—"}
            ) of {fmtLbs(bin.capacityLbs)} lb capacity
          </DialogDescription>
        </DialogHeader>

        {/* ------------------------------------------ composition by lot */}
        <div>
          <div className="gt-eyebrow mb-2">Composition by lot (provenance replay)</div>
          {compQ.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          ) : compQ.isError ? (
            <QueryError
              title="Composition failed to load"
              message={compQ.error.message}
              onRetry={() => void compQ.refetch()}
            />
          ) : comp && comp.composition.length === 0 ? (
            <p className="font-mono text-xs text-muted-foreground">
              No lots in the movement log for this bin.
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lot</TableHead>
                    <TableHead className="text-right">lbs</TableHead>
                    <TableHead className="text-right">% of bin</TableHead>
                    <TableHead className="w-2/5" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comp?.composition.map((c, i) => {
                    const pct = compTotal > 0 ? (c.lbs / compTotal) * 100 : 0;
                    return (
                      <TableRow key={c.lotId ?? `unknown-${i}`}>
                        <TableCell className="font-mono text-xs font-semibold">
                          {c.lotCode ?? "Unknown origin"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {fmtLbs(c.lbs)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {pct.toFixed(1)}%
                        </TableCell>
                        <TableCell>
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${Math.min(100, pct)}%` }}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {comp && (
            <p
              className={cn(
                "mt-2 font-mono text-[11px]",
                comp.logTotalLbs === comp.cacheLbs
                  ? "text-muted-foreground"
                  : "font-semibold text-[hsl(38_92%_60%)]",
              )}
            >
              Movement log total: {fmtLbs(comp.logTotalLbs)} lb · cached level:{" "}
              {fmtLbs(comp.cacheLbs)} lb
              {comp.logTotalLbs === comp.cacheLbs
                ? " · reconciled"
                : " · DRIFT — reconcile with a level adjustment"}
            </p>
          )}
        </div>

        <Separator />

        {/* ------------------------------------------ movement history */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="gt-eyebrow">Movement history</div>
            <Button
              variant="outline"
              size="sm"
              disabled={(movesQ.data ?? []).length === 0}
              onClick={() =>
                downloadCsv(
                  `bin-${bin.id}-movements-${csvDateStamp()}.csv`,
                  ["Time", "Direction", "Qty lbs", "Lot", "From", "To", "Operator", "Ticket", "Shipment", "Note"],
                  (movesQ.data ?? []).map((m) => [
                    new Date(m.createdAt).toLocaleString("en-US"),
                    DIR_META[directionOf(m, bin.id)].label,
                    m.quantityLbs,
                    m.lotCode,
                    m.fromBinName ?? "field/truck",
                    m.toBinName ?? "shipped",
                    m.operator,
                    m.ticketNo != null ? `${m.ticketNo}${m.loadNo != null ? ` L${m.loadNo}` : ""}` : null,
                    m.shipmentCustomer,
                    m.note,
                  ]),
                )
              }
            >
              <Download className="mr-2 h-3.5 w-3.5" />
              CSV
            </Button>
          </div>
          {movesQ.isPending ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          ) : movesQ.isError ? (
            <QueryError
              title="Movement history failed to load"
              message={movesQ.error.message}
              onRetry={() => void movesQ.refetch()}
            />
          ) : (movesQ.data ?? []).length === 0 ? (
            <p className="font-mono text-xs text-muted-foreground">
              No movements recorded for this bin yet.
            </p>
          ) : (
            <div className="max-h-80 overflow-y-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Dir</TableHead>
                    <TableHead className="text-right">Qty lbs</TableHead>
                    <TableHead>Lot</TableHead>
                    <TableHead>From → To</TableHead>
                    <TableHead>Operator</TableHead>
                    <TableHead>Ticket / Shipment</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(movesQ.data ?? []).map((m) => {
                    const dir = directionOf(m, bin.id);
                    const meta = DIR_META[dir];
                    const Icon = meta.icon;
                    const signed =
                      dir === "in" ? m.quantityLbs : dir === "out" ? -m.quantityLbs : m.quantityLbs;
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground">
                          {fmtDateTime(m.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn("gap-1 font-mono text-[10px]", meta.cls)}
                          >
                            <Icon className="h-3 w-3" />
                            {meta.label}
                          </Badge>
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-mono text-xs font-semibold tabular-nums",
                            dir === "out" ? "text-crit" : "text-stable",
                          )}
                        >
                          {signed > 0 ? "+" : ""}
                          {fmtLbs(signed)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {m.lotCode ?? "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                          {m.fromBinName ?? "field/truck"} → {m.toBinName ?? "shipped"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {m.operator ?? "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-[11px]">
                          {m.ticketNo != null
                            ? `${m.ticketNo}${m.loadNo != null ? ` L${m.loadNo}` : ""}`
                            : "—"}
                          {m.shipmentCustomer != null && (
                            <span className="text-muted-foreground">
                              {m.ticketNo != null ? " · " : ""}ship → {m.shipmentCustomer}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate font-mono text-[11px] text-muted-foreground">
                          {m.note ?? "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

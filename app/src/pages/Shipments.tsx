// Shipments — outbound sales drawn from bins (Phase 5 UI over the Phase 4
// shipments API). List + create form with live bin lot composition, client-
// side FIFO attribution preview, and shortfall warning before confirming.

import { useMemo, useState } from "react";
import { Download, Plus } from "lucide-react";
import { trpc } from "@shared/src/lib/trpc";
import { cn } from "@shared/src/lib/utils";
import { csvDateStamp, downloadCsv } from "@shared/src/lib/csv";
import { useSite } from "@/providers/site";
import { toast } from "@shared/src/components/ui/sonner";
import { Badge } from "@shared/src/components/ui/badge";
import { Button } from "@shared/src/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shared/src/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@shared/src/components/ui/dialog";
import { Input } from "@shared/src/components/ui/input";
import { Label } from "@shared/src/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shared/src/components/ui/select";
import { Skeleton } from "@shared/src/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@shared/src/components/ui/table";
import { Textarea } from "@shared/src/components/ui/textarea";
import { QueryError } from "@shared/src/components/QueryError";
import { bushelWeight, fmtBu, fmtLbs } from "@contracts/grain";

function fmtDateTime(d: Date | string): string {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/* ------------------------------------------------------------------ */
/* Create shipment dialog                                              */
/* ------------------------------------------------------------------ */

function NewShipmentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const { siteId } = useSite();

  const [customerName, setCustomerName] = useState("");
  const [destination, setDestination] = useState("");
  const [truckId, setTruckId] = useState("");
  const [note, setNote] = useState("");
  const [binChoice, setBinChoice] = useState("");
  const [loadChoice, setLoadChoice] = useState("none");
  const [qtyText, setQtyText] = useState("");

  const binsQ = trpc.core.bins.list.useQuery(
    { siteId: siteId ?? undefined },
    { enabled: open && siteId != null },
  );
  const linkableQ = trpc.shipments.linkableLoads.useQuery(
    { siteId: siteId ?? -1 },
    { enabled: open && siteId != null },
  );

  const linkedLoad = useMemo(
    () => (linkableQ.data ?? []).find((l) => String(l.id) === loadChoice) ?? null,
    [linkableQ.data, loadChoice],
  );

  // A linked load with a bin already weighed OUT of that bin — the server
  // records link mode (no new draw). Otherwise the shipment draws now.
  const linkOnly = linkedLoad != null && linkedLoad.binId != null;
  const effectiveBinId =
    binChoice !== "" ? Number(binChoice) : (linkedLoad?.binId ?? null);

  const compQ = trpc.shipments.binComposition.useQuery(
    { binId: effectiveBinId ?? -1 },
    { enabled: open && effectiveBinId != null },
  );

  const bins = binsQ.data ?? [];
  const selectedBin = bins.find((b) => b.id === effectiveBinId) ?? null;

  const qtyLbs = useMemo(() => {
    const n = Number(qtyText.replace(/,/g, ""));
    return qtyText.trim() !== "" && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }, [qtyText]);
  const effectiveQty = qtyLbs ?? linkedLoad?.netLbs ?? null;

  // Picking a load prefills qty/bin (still editable while it's a draw).
  const applyLoad = (v: string) => {
    setLoadChoice(v);
    const load = (linkableQ.data ?? []).find((l) => String(l.id) === v) ?? null;
    if (load) {
      if (load.binId != null) setBinChoice(String(load.binId));
      if (load.netLbs != null) setQtyText(String(load.netLbs));
      if (load.truckId) setTruckId(load.truckId);
    }
  };

  // Client-side FIFO preview over the live composition (mirrors the server's
  // fifoDrawdown so the operator sees attribution + shortfall BEFORE commit).
  const preview = useMemo(() => {
    if (linkOnly || effectiveQty == null || !compQ.data) return null;
    let remaining = effectiveQty;
    const allocations: { lotCode: string | null; lbs: number }[] = [];
    for (const layer of compQ.data.composition) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, layer.lbs);
      if (take > 0) allocations.push({ lotCode: layer.lotCode, lbs: take });
      remaining -= take;
    }
    return { allocations, shortfallLbs: Math.max(0, remaining) };
  }, [linkOnly, effectiveQty, compQ.data]);

  const create = trpc.shipments.create.useMutation({
    onSuccess: async (data) => {
      if (data.shortfallLbs > 0) {
        toast.warning(`Shipment recorded — SHORT ${fmtLbs(data.shortfallLbs)} lb`, {
          description: "The bin held less than the shipment quantity.",
          duration: 12_000,
        });
      } else {
        toast.success(`Shipment #${data.shipment?.id ?? ""} recorded`);
      }
      onOpenChange(false);
      setCustomerName("");
      setDestination("");
      setTruckId("");
      setNote("");
      setBinChoice("");
      setLoadChoice("none");
      setQtyText("");
      await Promise.all([
        utils.shipments.list.invalidate(),
        utils.shipments.linkableLoads.invalidate(),
        utils.shipments.binComposition.invalidate(),
        utils.core.bins.list.invalidate(),
      ]);
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    if (siteId == null) return;
    if (!customerName.trim()) {
      toast.error("A customer is required");
      return;
    }
    if (effectiveBinId == null) {
      toast.error("Pick a source bin");
      return;
    }
    if (effectiveQty == null) {
      toast.error("Enter a quantity in lbs (or link a weighed-out load)");
      return;
    }
    create.mutate({
      siteId,
      customerName: customerName.trim(),
      destination: destination.trim() || undefined,
      binId: effectiveBinId,
      quantityLbs: effectiveQty,
      truckId: truckId.trim() || undefined,
      note: note.trim() || undefined,
      loadId: linkedLoad?.id,
    });
  };

  const overAvailable =
    !linkOnly && effectiveQty != null && compQ.data != null && effectiveQty > compQ.data.cacheLbs;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New shipment</DialogTitle>
          <DialogDescription>
            Draw grain out of a bin for a customer. Attribution to lots is
            oldest-first (FIFO); a bin that comes up short is reported, not
            blocked.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ship-customer">Customer *</Label>
              <Input
                id="ship-customer"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="e.g. Cargill — Cedar Rapids"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ship-dest">Destination</Label>
              <Input
                id="ship-dest"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="optional"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ship-truck">Truck ID</Label>
              <Input
                id="ship-truck"
                className="font-mono"
                value={truckId}
                onChange={(e) => setTruckId(e.target.value)}
                placeholder="optional"
              />
            </div>
            <div className="space-y-1">
              <Label>Link outbound load</Label>
              <Select value={loadChoice} onValueChange={applyLoad}>
                <SelectTrigger className="font-mono text-xs" aria-label="Link outbound load">
                  <SelectValue placeholder="— none —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="font-mono text-xs">
                    — none —
                  </SelectItem>
                  {(linkableQ.data ?? []).map((l) => (
                    <SelectItem key={l.id} value={String(l.id)} className="font-mono text-xs">
                      {l.ticketNo} L{l.loadNo} · {l.truckId ?? "?"} · {fmtLbs(l.netLbs)} lb
                      {l.binName ? ` · ${l.binName}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {linkOnly && (
                <p className="font-mono text-[11px] text-live">
                  This load already drew from its bin at weigh-out — the
                  shipment just links it (no second draw).
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Source bin *</Label>
              <Select value={binChoice} onValueChange={setBinChoice} disabled={linkOnly}>
                <SelectTrigger className="font-mono text-xs" aria-label="Source bin">
                  <SelectValue placeholder="Select bin…" />
                </SelectTrigger>
                <SelectContent>
                  {bins.map((b) => (
                    <SelectItem key={b.id} value={String(b.id)} className="font-mono text-xs">
                      {b.name} — {b.crop} · {fmtLbs(b.currentLbs)} lb
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {bins.length === 0 && !binsQ.isPending && (
                <p className="font-mono text-[11px] text-muted-foreground">
                  No bins at this location.
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="ship-qty">Quantity (lbs) *</Label>
              <Input
                id="ship-qty"
                inputMode="numeric"
                className="font-mono"
                value={qtyText}
                onChange={(e) => setQtyText(e.target.value)}
                placeholder={
                  linkedLoad?.netLbs != null ? String(linkedLoad.netLbs) : "e.g. 48000"
                }
              />
              {effectiveQty != null && selectedBin && (
                <p className="font-mono text-[11px] text-muted-foreground">
                  ≈ {fmtBu(effectiveQty / bushelWeight(selectedBin.crop))} bu at{" "}
                  {bushelWeight(selectedBin.crop)} lb/bu
                </p>
              )}
            </div>
          </div>

          {/* live bin composition */}
          {effectiveBinId != null && (
            <div className="rounded-md border border-border">
              <div className="border-b border-border px-3 py-2">
                <span className="gt-eyebrow">
                  Current composition — {selectedBin?.name ?? `bin #${effectiveBinId}`}
                </span>
              </div>
              {compQ.isPending ? (
                <div className="space-y-2 p-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : compQ.isError ? (
                <div className="p-3">
                  <QueryError
                    title="Composition failed to load"
                    message={compQ.error.message}
                    onRetry={() => void compQ.refetch()}
                  />
                </div>
              ) : compQ.data && compQ.data.composition.length === 0 ? (
                <p className="px-3 py-3 font-mono text-xs text-muted-foreground">
                  Bin is empty per the movement log (cache: {fmtLbs(compQ.data.cacheLbs)} lb).
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {compQ.data?.composition.map((c, i) => {
                    const pct =
                      compQ.data.logTotalLbs > 0
                        ? Math.round((c.lbs / compQ.data.logTotalLbs) * 100)
                        : 0;
                    return (
                      <div
                        key={c.lotId ?? `unknown-${i}`}
                        className="flex items-center justify-between gap-3 px-3 py-1.5 font-mono text-xs"
                      >
                        <span className="font-semibold">{c.lotCode ?? "Unknown origin"}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {fmtLbs(c.lbs)} lb · {pct}%
                        </span>
                      </div>
                    );
                  })}
                  {compQ.data && compQ.data.logTotalLbs !== compQ.data.cacheLbs && (
                    <div className="px-3 py-1.5 font-mono text-[11px] text-[hsl(38_92%_60%)]">
                      Log total {fmtLbs(compQ.data.logTotalLbs)} lb ≠ cached{" "}
                      {fmtLbs(compQ.data.cacheLbs)} lb — reconcile with a level adjustment.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* FIFO attribution preview */}
          {preview && effectiveQty != null && (
            <div
              className={cn(
                "rounded-md border px-3 py-2",
                preview.shortfallLbs > 0
                  ? "border-[hsl(38_92%_60%)]/50 bg-[hsl(38_92%_60%)]/10"
                  : "border-live/40 bg-live/10",
              )}
            >
              <div className="gt-eyebrow mb-1">FIFO attribution (oldest lot first)</div>
              {preview.allocations.length === 0 ? (
                <p className="font-mono text-xs text-muted-foreground">
                  Nothing to allocate — the bin is empty.
                </p>
              ) : (
                <div className="space-y-0.5">
                  {preview.allocations.map((a, i) => (
                    <div key={i} className="flex justify-between font-mono text-xs">
                      <span>{a.lotCode ?? "Unknown origin"}</span>
                      <span className="tabular-nums">{fmtLbs(a.lbs)} lb</span>
                    </div>
                  ))}
                </div>
              )}
              {preview.shortfallLbs > 0 && (
                <p className="mt-1 font-mono text-xs font-semibold text-[hsl(38_92%_60%)]">
                  SHORT {fmtLbs(preview.shortfallLbs)} lb — the bin does not hold the full
                  quantity. The shipment is still recorded as a short ship.
                </p>
              )}
            </div>
          )}
          {overAvailable && preview == null && (
            <p className="font-mono text-xs text-[hsl(38_92%_60%)]">
              Quantity exceeds the bin's current level — the shipment will record a shortfall.
            </p>
          )}

          <div className="space-y-1">
            <Label htmlFor="ship-note">Note</Label>
            <Textarea
              id="ship-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="optional"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={
              create.isPending ||
              !customerName.trim() ||
              effectiveBinId == null ||
              effectiveQty == null
            }
          >
            {create.isPending ? "Recording…" : "Record shipment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function Shipments() {
  const { siteId } = useSite();
  const [dialogOpen, setDialogOpen] = useState(false);

  const shipmentsQ = trpc.shipments.list.useQuery(
    { siteId: siteId ?? undefined },
    { enabled: siteId != null },
  );
  const rows = shipmentsQ.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="gt-eyebrow">OUTBOUND</div>
          <h1 className="text-xl font-semibold tracking-tight">Shipments</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Grain sold out of the bins — each shipment carries its FIFO lot
            attribution for traceability.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={rows.length === 0}
            onClick={() =>
              downloadCsv(
                `shipments-${csvDateStamp()}.csv`,
                ["Date", "Customer", "Destination", "Bin", "Lot", "Truck", "Qty lbs", "Qty bu", "Note"],
                rows.map((s) => [
                  new Date(s.createdAt).toLocaleString("en-US"),
                  s.customerName,
                  s.destination,
                  s.binName ?? (s.binId != null ? `#${s.binId}` : null),
                  s.lotCode ?? "Mixed",
                  s.truckId,
                  s.quantityLbs,
                  s.quantityBu,
                  s.note,
                ]),
              )
            }
          >
            <Download className="mr-2 h-4 w-4" />
            Download CSV
          </Button>
          <Button onClick={() => setDialogOpen(true)} disabled={siteId == null}>
            <Plus className="mr-2 h-4 w-4" />
            New shipment
          </Button>
        </div>
      </div>

      {shipmentsQ.isError && (
        <QueryError
          title="Shipments failed to load"
          message={shipmentsQ.error.message}
          onRetry={() => void shipmentsQ.refetch()}
          retrying={shipmentsQ.isRefetching}
        />
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 py-3">
          <CardTitle className="text-sm font-medium">Shipments</CardTitle>
          <span className="font-mono text-xs text-muted-foreground">
            {shipmentsQ.isPending
              ? "…"
              : `${rows.length} record${rows.length === 1 ? "" : "s"}`}
          </span>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Bin</TableHead>
                <TableHead>Lot</TableHead>
                <TableHead>Truck</TableHead>
                <TableHead className="text-right">Qty lbs</TableHead>
                <TableHead className="text-right">Qty bu</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shipmentsQ.isPending &&
                Array.from({ length: 5 }, (_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 9 }, (_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              {!shipmentsQ.isPending && !shipmentsQ.isError && rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="h-24 text-center text-sm text-muted-foreground"
                  >
                    No shipments recorded yet
                  </TableCell>
                </TableRow>
              )}
              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">
                    {fmtDateTime(s.createdAt)}
                  </TableCell>
                  <TableCell className="text-sm font-semibold">{s.customerName}</TableCell>
                  <TableCell className="text-sm">{s.destination ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {s.binName ?? (s.binId != null ? `#${s.binId}` : "—")}
                  </TableCell>
                  <TableCell>
                    {s.lotCode ? (
                      <span className="font-mono text-xs">{s.lotCode}</span>
                    ) : (
                      <Badge variant="outline" className="font-mono text-[10px] uppercase">
                        Mixed
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{s.truckId ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {fmtLbs(s.quantityLbs)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {s.quantityBu != null ? fmtBu(s.quantityBu) : "—"}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                    {s.note ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {dialogOpen && <NewShipmentDialog open onOpenChange={setDialogOpen} />}
    </div>
  );
}

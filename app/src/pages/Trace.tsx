// Trace / recall (Phase C, #14) — the FSMA one-step-back / one-step-forward
// view. Commingling-aware: after blending, identity is proportional, so every
// attribution carries lbs + % rather than pretending kernel-level identity.
//
//   Backward — pick a shipment (or a bin + date): which lots and loads
//     contributed to it, and how much of each (FIFO replay bounded by the
//     bin's latest completed cleanout).
//   Forward — pick a lot (or a single load): every bin the grain entered and
//     every shipment that carried it, with % attribution, customer, and
//     destination.
//
// Both panels export the FSMA-style sortable spreadsheet (trace.*Csv).

import { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Download, Route } from "lucide-react";
import { trpc } from "@shared/src/lib/trpc";
import { cn } from "@shared/src/lib/utils";
import { toast } from "@shared/src/components/ui/sonner";
import { Badge } from "@shared/src/components/ui/badge";
import { Button } from "@shared/src/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@shared/src/components/ui/card";
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
import { QueryError } from "@shared/src/components/QueryError";
import { useSite } from "@/providers/site";
import { fmtLbs } from "@contracts/grain";

function fmtDateTime(d: Date | string): string {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------- backward

type BackwardParams = { shipmentId: number } | { binId: number; date?: string };

function BackwardPanel() {
  const utils = trpc.useUtils();
  const { siteId } = useSite();
  const [mode, setMode] = useState<"shipment" | "bin">("shipment");
  const [shipmentChoice, setShipmentChoice] = useState("");
  const [binChoice, setBinChoice] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [submitted, setSubmitted] = useState<BackwardParams | null>(null);

  const shipmentsQ = trpc.shipments.list.useQuery(
    { siteId: siteId ?? undefined, limit: 200 },
    { enabled: siteId != null },
  );
  const binsQ = trpc.core.bins.list.useQuery(
    { siteId: siteId ?? undefined },
    { enabled: siteId != null },
  );

  const traceQ = trpc.trace.backward.useQuery(submitted ?? { shipmentId: -1 }, {
    enabled: submitted != null,
  });

  const run = () => {
    if (mode === "shipment") {
      const id = Number(shipmentChoice);
      if (!Number.isFinite(id) || id <= 0) {
        toast.error("Pick a shipment to trace");
        return;
      }
      setSubmitted({ shipmentId: id });
    } else {
      const id = Number(binChoice);
      if (!Number.isFinite(id) || id <= 0) {
        toast.error("Pick a bin to trace");
        return;
      }
      setSubmitted({ binId: id, date: date || undefined });
    }
  };

  const exportCsv = async () => {
    if (!submitted) return;
    try {
      const r = await utils.trace.backwardCsv.fetch(submitted);
      downloadText(r.filename, "﻿" + r.csv);
      toast.success(`Exported ${r.filename}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "CSV export failed");
    }
  };

  const r = traceQ.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ArrowDownToLine className="h-4 w-4 text-live" />
          Backward trace — where did this grain come from?
        </CardTitle>
        <CardDescription>
          Pick a shipment (or a bin at a date) and replay which lots/loads
          contributed, with lbs and % of the total.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Trace</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as "shipment" | "bin")}>
              <SelectTrigger className="h-8 w-44 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="shipment">A shipment</SelectItem>
                <SelectItem value="bin">A bin at a date</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mode === "shipment" ? (
            <div className="min-w-64 flex-1 space-y-1">
              <Label className="text-xs">Shipment</Label>
              <Select value={shipmentChoice} onValueChange={setShipmentChoice}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select shipment…" />
                </SelectTrigger>
                <SelectContent>
                  {(shipmentsQ.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      #{s.id} — {s.customerName} · {fmtLbs(s.quantityLbs)} lb ·{" "}
                      {fmtDateTime(s.createdAt)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <>
              <div className="min-w-44 flex-1 space-y-1">
                <Label className="text-xs">Bin</Label>
                <Select value={binChoice} onValueChange={setBinChoice}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select bin…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(binsQ.data ?? []).map((b) => (
                      <SelectItem key={b.id} value={String(b.id)}>
                        {b.name} — {b.crop}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="bw-date" className="text-xs">
                  As of date
                </Label>
                <Input
                  id="bw-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="h-8 font-mono text-xs"
                />
              </div>
            </>
          )}
          <Button onClick={run} disabled={traceQ.isFetching} className="h-8">
            {traceQ.isFetching ? "Tracing…" : "Run trace"}
          </Button>
        </div>

        {submitted != null && traceQ.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : traceQ.isError ? (
          <QueryError
            title="Backward trace failed"
            message={traceQ.error.message}
            onRetry={() => void traceQ.refetch()}
            retrying={traceQ.isRefetching}
          />
        ) : r ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-readout px-3 py-2 font-mono text-xs text-sidebar-foreground">
              <span>
                {String(r.subject.type ?? "") === "shipment"
                  ? `Shipment #${String(r.subject.shipmentId)} → ${String(r.subject.customerName ?? "")}${r.subject.destination ? ` (${String(r.subject.destination)})` : ""}`
                  : `Bin ${String(r.subject.binName ?? "")} as of ${fmtDateTime(String(r.subject.asOf))}`}
                {" · "}from bin {String(r.subject.binName ?? "")}
              </span>
              <span className="font-semibold">
                Total {fmtLbs(r.totalLbs)} lb
                {r.shortfallLbs > 0 && (
                  <span className="ml-2 text-crit">
                    · SHORTFALL {fmtLbs(r.shortfallLbs)} lb (bin held less than shipped)
                  </span>
                )}
              </span>
              <Button variant="outline" size="sm" className="h-7" onClick={() => void exportCsv()}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Export CSV
              </Button>
            </div>

            {r.sources.length === 0 ? (
              <p className="font-mono text-xs text-muted-foreground">
                No contributing lots — the bin was empty at that moment (or its
                genealogy was reset by a cleanout).
              </p>
            ) : (
              <div className="overflow-hidden rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lot</TableHead>
                      <TableHead className="text-right">lbs</TableHead>
                      <TableHead className="text-right">% of total</TableHead>
                      <TableHead>Contributing loads</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.sources.map((s, i) => (
                      <TableRow key={s.lotId ?? `unknown-${i}`}>
                        <TableCell className="align-top font-mono text-xs font-semibold">
                          {s.lotCode ?? "Unknown origin"}
                        </TableCell>
                        <TableCell className="align-top text-right font-mono text-xs tabular-nums">
                          {fmtLbs(s.lbs)}
                        </TableCell>
                        <TableCell className="align-top text-right">
                          <Badge
                            variant="outline"
                            className={cn(
                              "font-mono text-[10px] tabular-nums",
                              s.pct >= 50
                                ? "border-primary/50 text-primary"
                                : "text-muted-foreground",
                            )}
                          >
                            {s.pct}%
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {s.loads.length === 0 ? (
                            <span className="font-mono text-[11px] text-muted-foreground">—</span>
                          ) : (
                            <div className="space-y-0.5">
                              {s.loads.map((l) => (
                                <div key={l.loadId} className="font-mono text-[11px]">
                                  <span className="text-primary">
                                    {l.ticketNo ?? "?"} L{l.loadNo}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {" "}
                                    · {l.farmerName ?? "—"} · {fmtLbs(l.lbs)} lb
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        ) : (
          <p className="font-mono text-xs text-muted-foreground">
            Pick a subject and run the trace.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------- forward

type ForwardParams = { lotId: number } | { loadId: number };

function ForwardPanel() {
  const utils = trpc.useUtils();
  const lotsQ = trpc.people.lots.list.useQuery();
  const [mode, setMode] = useState<"lot" | "load">("lot");
  const [lotChoice, setLotChoice] = useState("");
  const [loadIdText, setLoadIdText] = useState("");
  const [submitted, setSubmitted] = useState<ForwardParams | null>(null);

  const traceQ = trpc.trace.forward.useQuery(submitted ?? { lotId: -1 }, {
    enabled: submitted != null,
  });

  const run = () => {
    if (mode === "lot") {
      const id = Number(lotChoice);
      if (!Number.isFinite(id) || id <= 0) {
        toast.error("Pick a lot to trace");
        return;
      }
      setSubmitted({ lotId: id });
    } else {
      const id = Number(loadIdText);
      if (!Number.isFinite(id) || id <= 0) {
        toast.error("Enter a load id (from the sheet detail / audit log)");
        return;
      }
      setSubmitted({ loadId: id });
    }
  };

  const exportCsv = async () => {
    if (!submitted) return;
    try {
      const r = await utils.trace.forwardCsv.fetch(submitted);
      downloadText(r.filename, "﻿" + r.csv);
      toast.success(`Exported ${r.filename}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "CSV export failed");
    }
  };

  const r = traceQ.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ArrowUpFromLine className="h-4 w-4 text-go" />
          Forward trace — where did this lot go?
        </CardTitle>
        <CardDescription>
          Pick a lot (or a single load by id): every bin it entered, and every
          shipment that carried its grain — with % attribution, customer, and
          destination. This is the recall answer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Trace</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as "lot" | "load")}>
              <SelectTrigger className="h-8 w-44 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lot">A lot</SelectItem>
                <SelectItem value="load">A single load (by id)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mode === "lot" ? (
            <div className="min-w-64 flex-1 space-y-1">
              <Label className="text-xs">Lot</Label>
              <Select value={lotChoice} onValueChange={setLotChoice}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select lot…" />
                </SelectTrigger>
                <SelectContent>
                  {(lotsQ.data ?? []).map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.code} — {l.farmerName ?? ""} · {l.crop}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="fw-load" className="text-xs">
                Load id
              </Label>
              <Input
                id="fw-load"
                inputMode="numeric"
                value={loadIdText}
                onChange={(e) => setLoadIdText(e.target.value)}
                placeholder="e.g. 42"
                className="h-8 w-32 font-mono text-xs"
              />
            </div>
          )}
          <Button onClick={run} disabled={traceQ.isFetching} className="h-8">
            {traceQ.isFetching ? "Tracing…" : "Run trace"}
          </Button>
        </div>

        {submitted != null && traceQ.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : traceQ.isError ? (
          <QueryError
            title="Forward trace failed"
            message={traceQ.error.message}
            onRetry={() => void traceQ.refetch()}
            retrying={traceQ.isRefetching}
          />
        ) : r ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-readout px-3 py-2 font-mono text-xs text-sidebar-foreground">
              <span>
                {String(r.subject.type ?? "") === "load"
                  ? `Load #${String(r.subject.loadId)} (ticket ${String(r.subject.ticketNo ?? "?")} L${String(r.subject.loadNo ?? "?")})`
                  : `Lot ${String(r.subject.lotCode ?? "")} — ${String(r.subject.crop ?? "")}`}
              </span>
              <Button variant="outline" size="sm" className="h-7" onClick={() => void exportCsv()}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Export CSV
              </Button>
            </div>

            <div>
              <div className="gt-eyebrow mb-1.5">Bins the grain entered</div>
              {r.bins.length === 0 ? (
                <p className="font-mono text-xs text-muted-foreground">
                  No bin movements recorded for this subject.
                </p>
              ) : (
                <div className="overflow-hidden rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bin</TableHead>
                        <TableHead>Site</TableHead>
                        <TableHead className="text-right">lbs in</TableHead>
                        <TableHead>First</TableHead>
                        <TableHead>Last</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {r.bins.map((b) => (
                        <TableRow key={b.binId}>
                          <TableCell className="font-mono text-xs font-semibold">
                            {b.binName ?? `#${b.binId}`}
                          </TableCell>
                          <TableCell className="text-xs">{b.siteName ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono text-xs tabular-nums">
                            {fmtLbs(b.lbsIn)}
                          </TableCell>
                          <TableCell className="font-mono text-[11px] tabular-nums text-muted-foreground">
                            {fmtDateTime(b.firstAt)}
                          </TableCell>
                          <TableCell className="font-mono text-[11px] tabular-nums text-muted-foreground">
                            {fmtDateTime(b.lastAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            <div>
              <div className="gt-eyebrow mb-1.5">
                Shipments & outbound draws that carried it
              </div>
              {r.shipments.length === 0 ? (
                <p className="font-mono text-xs text-muted-foreground">
                  Nothing shipped yet — the grain is still in the bins above.
                </p>
              ) : (
                <div className="overflow-hidden rounded-md border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Customer / destination</TableHead>
                        <TableHead>Bin</TableHead>
                        <TableHead className="text-right">Shipped lbs</TableHead>
                        <TableHead className="text-right">This lot lbs</TableHead>
                        <TableHead className="text-right">% of draw</TableHead>
                        <TableHead>Ticket</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {r.shipments.map((s, i) => (
                        <TableRow key={`${s.shipmentId ?? "x"}-${s.loadId ?? "x"}-${i}`}>
                          <TableCell className="whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground">
                            {fmtDateTime(s.date)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {s.customerName ?? "—"}
                            {s.destination && (
                              <span className="text-muted-foreground"> → {s.destination}</span>
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{s.binName ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono text-xs tabular-nums">
                            {fmtLbs(s.quantityLbs)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">
                            {fmtLbs(s.attributedLbs)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant="outline"
                              className={cn(
                                "font-mono text-[10px] tabular-nums",
                                s.pct >= 50
                                  ? "border-primary/50 text-primary"
                                  : "text-muted-foreground",
                              )}
                            >
                              {s.pct}%
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-[11px] text-muted-foreground">
                            {s.ticketNo ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        ) : (
          <p className="font-mono text-xs text-muted-foreground">
            Pick a subject and run the trace.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// --------------------------------------------------------------------- page

export default function Trace() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Route className="h-5 w-5 text-muted-foreground" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Trace / Recall</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            One step back, one step forward — the FSMA §204 sortable spreadsheet,
            computed from the bin-movement genealogy. Completed cleanouts bound
            every trace.
          </p>
        </div>
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <BackwardPanel />
        <ForwardPanel />
      </div>
    </div>
  );
}

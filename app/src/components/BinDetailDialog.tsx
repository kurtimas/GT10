// Bin detail / provenance view (Phase 5; Phase C #12/#15/#18/#19/#22/#26).
// Tabs:
//   Inventory  — composition by lot (provenance replay) + append-only
//                movement history with the genealogy-reset (cleanout) marker.
//   Grades     — effective grade factors (lbs-weighted averages with manual
//                overrides on top), set-override form, override history (#18).
//   Compliance — cleanout record/history (#12), fumigation log (#19),
//                shrink entries (#15), lab results (#22), attachments (#26).

import { useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  BrushCleaning,
  Download,
  Paperclip,
  Plus,
} from "lucide-react";
import { trpc } from "@shared/src/lib/trpc";
import { cn, cropBadgeClass } from "@shared/src/lib/utils";
import { csvDateStamp, downloadCsv } from "@shared/src/lib/csv";
import { toast } from "@shared/src/components/ui/sonner";
import { Badge } from "@shared/src/components/ui/badge";
import { Button } from "@shared/src/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@shared/src/components/ui/tabs";
import { Textarea } from "@shared/src/components/ui/textarea";
import { QueryError } from "@shared/src/components/QueryError";
import { AttachmentsControl } from "@/components/AttachmentsControl";
import { LabResultsSection } from "@/components/LabResultsSection";
import { bushelWeight, fmtLbs } from "@contracts/grain";
import { BIN_GRADE_FACTOR_KEYS } from "@contracts/provenance";
import { SHRINK_ENTRY_KINDS } from "@contracts/compliance";
import type { BinRow, FumigationLogRow } from "@contracts/types";

function fmtDateTime(d: Date | string): string {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
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

/** lbs above which a cleanout needs the explicit non-empty confirmation. */
const EMPTY_TOLERANCE_LBS = 500;

/** Keyed fragment for the movement-history map (marker row + movement row). */
function MovementSlice({ marker, children }: { marker: ReactNode; children: ReactNode }) {
  return (
    <>
      {marker}
      {children}
    </>
  );
}

// ---------------------------------------------------------------------------
// Inventory tab (existing Phase 5 content + genealogy reset marker)
// ---------------------------------------------------------------------------

function InventoryTab({ bin }: { bin: BinRow }) {
  const compQ = trpc.shipments.binComposition.useQuery({ binId: bin.id });
  const movesQ = trpc.core.bins.movements.useQuery({ binId: bin.id });
  const detailQ = trpc.core.bins.get.useQuery({ id: bin.id });
  const cutoff = detailQ.data?.cleanoutCutoff ?? null;

  const comp = compQ.data;
  const compTotal = comp?.composition.reduce((a, c) => a + c.lbs, 0) ?? 0;

  const moves = movesQ.data ?? [];
  // index of the first movement AT/BEFORE the cleanout cutoff — the reset
  // marker renders above it (history below the line is excluded from replay)
  const cutoffIdx = cutoff
    ? moves.findIndex((m) => new Date(m.createdAt).getTime() <= new Date(cutoff).getTime())
    : -1;
  const markerRow = (key: string) => (
    <TableRow key={key} className="bg-[hsl(38_92%_60%)]/10 hover:bg-[hsl(38_92%_60%)]/10">
      <TableCell colSpan={8} className="py-1.5">
        <span className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-[hsl(38_92%_60%)]">
          <BrushCleaning className="h-3 w-3" />
          Cleanout completed {cutoff ? fmtDateTime(cutoff) : ""} — genealogy resets here; older
          movements no longer count toward this bin&apos;s lineage
        </span>
      </TableCell>
    </TableRow>
  );

  return (
    <div className="space-y-4">
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
            disabled={moves.length === 0}
            onClick={() =>
              downloadCsv(
                `bin-${bin.id}-movements-${csvDateStamp()}.csv`,
                ["Time", "Direction", "Qty lbs", "Lot", "From", "To", "Operator", "Ticket", "Shipment", "Note"],
                moves.map((m) => [
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
        ) : moves.length === 0 ? (
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
                {moves.map((m, i) => {
                  const dir = directionOf(m, bin.id);
                  const meta = DIR_META[dir];
                  const Icon = meta.icon;
                  const signed =
                    dir === "in" ? m.quantityLbs : dir === "out" ? -m.quantityLbs : m.quantityLbs;
                  const beforeCutoff =
                    cutoff != null &&
                    new Date(m.createdAt).getTime() <= new Date(cutoff).getTime();
                  return (
                    <MovementSlice key={m.id} marker={cutoffIdx === i ? markerRow(`cutoff-${i}`) : null}>
                      <TableRow className={cn(beforeCutoff && "opacity-45")}>                        <TableCell className="whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground">
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
                        <TableCell className="font-mono text-xs">{m.lotCode ?? "—"}</TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                          {m.fromBinName ?? "field/truck"} → {m.toBinName ?? "shipped"}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{m.operator ?? "—"}</TableCell>
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
                    </MovementSlice>
                  );
                })}
                {cutoff != null && cutoffIdx === -1 && moves.length > 0 && markerRow("cutoff-end")}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grades tab (#18) — effective factors, set override, override history
// ---------------------------------------------------------------------------

const FACTOR_LABELS: Record<string, string> = {
  moisturePct: "Moisture %",
  testWeightLbs: "Test weight lbs",
  dockagePct: "Dockage %",
  damagePct: "Damage %",
  proteinPct: "Protein %",
};

function GradesTab({ bin }: { bin: BinRow }) {
  const utils = trpc.useUtils();
  const detailQ = trpc.core.bins.get.useQuery({ id: bin.id });
  const historyQ = trpc.compliance.gradeOverrides.list.useQuery({ binId: bin.id });

  const [factor, setFactor] = useState<string>(BIN_GRADE_FACTOR_KEYS[0]);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");

  const setOverride = trpc.compliance.gradeOverrides.set.useMutation({
    onSuccess: async () => {
      toast.success(`Override set — ${bin.name} ${factor}`);
      setValue("");
      setReason("");
      await Promise.all([
        utils.compliance.gradeOverrides.list.invalidate(),
        utils.core.bins.get.invalidate(),
        utils.shipments.binComposition.invalidate(),
      ]);
    },
    onError: (err) => toast.error(err.message),
  });

  const grades = detailQ.data?.grades ?? {};
  const totalLbs = detailQ.data?.gradeTotalLbs ?? 0;
  const history = historyQ.data ?? [];

  const submit = () => {
    const n = Number(value);
    if (value.trim() === "" || !Number.isFinite(n)) {
      toast.error("Enter a numeric override value");
      return;
    }
    if (reason.trim().length < 3) {
      toast.error("A reason is required (≥3 characters) — overrides are audited");
      return;
    }
    setOverride.mutate({
      siteId: bin.siteId,
      binId: bin.id,
      factor,
      value: n,
      reason: reason.trim(),
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="gt-eyebrow mb-2">
          Effective grade factors — weighted over {fmtLbs(totalLbs)} lb in the bin
        </div>
        {detailQ.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : detailQ.isError ? (
          <QueryError
            title="Grade factors failed to load"
            message={detailQ.error.message}
            onRetry={() => void detailQ.refetch()}
          />
        ) : Object.keys(grades).length === 0 ? (
          <p className="font-mono text-xs text-muted-foreground">
            No graded loads in this bin yet — factors appear once graded loads are stored here.
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Factor</TableHead>
                  <TableHead className="text-right">Effective value</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Override reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {BIN_GRADE_FACTOR_KEYS.map((key) => {
                  const f = grades[key];
                  if (!f) return null;
                  return (
                    <TableRow key={key}>
                      <TableCell className="font-mono text-xs">{FACTOR_LABELS[key] ?? key}</TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">
                        {f.value}
                      </TableCell>
                      <TableCell>
                        {f.override ? (
                          <Badge
                            variant="outline"
                            className="border-go/50 bg-go/10 font-mono text-[10px] text-go"
                          >
                            OVERRIDE
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="font-mono text-[10px] text-muted-foreground"
                            title={`Weighted average over ${fmtLbs(f.coveredLbs ?? 0)} lb of graded grain`}
                          >
                            computed avg
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate font-mono text-[11px] text-muted-foreground">
                        {f.reason ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* set override */}
      <div className="rounded-md border border-border p-3">
        <div className="gt-eyebrow mb-2">Set override</div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">Factor</Label>
            <Select value={factor} onValueChange={setFactor}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BIN_GRADE_FACTOR_KEYS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {FACTOR_LABELS[k] ?? k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ov-value" className="text-xs">
              Value
            </Label>
            <Input
              id="ov-value"
              type="number"
              step="any"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="col-span-2 space-y-1">
            <Label htmlFor="ov-reason" className="text-xs">
              Reason <span className="text-crit">*</span>
            </Label>
            <Input
              id="ov-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Required — who/why (audit trail)"
              className="h-8 text-xs"
            />
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={submit} disabled={setOverride.isPending}>
            {setOverride.isPending ? "Saving…" : "Set override"}
          </Button>
        </div>
        <p className="mt-2 font-mono text-[10px] text-muted-foreground">
          Overrides win over the computed average, are append-only, and every row
          keeps its who/when/why.
        </p>
      </div>

      {/* override history */}
      <div>
        <div className="gt-eyebrow mb-2">Override history</div>
        {historyQ.isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : historyQ.isError ? (
          <QueryError
            title="Override history failed to load"
            message={historyQ.error.message}
            onRetry={() => void historyQ.refetch()}
          />
        ) : history.length === 0 ? (
          <p className="font-mono text-xs text-muted-foreground">No overrides recorded.</p>
        ) : (
          <div className="max-h-48 overflow-y-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Factor</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground">
                      {fmtDateTime(h.createdAt)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {FACTOR_LABELS[h.factor] ?? h.factor}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {h.value}
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate text-xs">{h.reason}</TableCell>
                    <TableCell className="font-mono text-xs">{h.operator ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compliance tab (#12 cleanouts, #19 fumigation, #15 shrink entries)
// ---------------------------------------------------------------------------

function CleanoutsSection({ bin }: { bin: BinRow }) {
  const utils = trpc.useUtils();
  const listQ = trpc.compliance.cleanouts.list.useQuery({ binId: bin.id });
  const [recordOpen, setRecordOpen] = useState(false);

  const complete = trpc.compliance.cleanouts.complete.useMutation({
    onSuccess: async () => {
      toast.success(`Cleanout completed — ${bin.name} genealogy resets`);
      await Promise.all([
        utils.compliance.cleanouts.list.invalidate(),
        utils.core.bins.get.invalidate(),
        utils.core.bins.movements.invalidate(),
        utils.shipments.binComposition.invalidate(),
      ]);
    },
    onError: (err) => toast.error(err.message),
  });

  const rows = listQ.data ?? [];
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="gt-eyebrow">Empty & cleanout records</div>
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          onClick={() => setRecordOpen(true)}
        >
          <BrushCleaning className="mr-1.5 h-3.5 w-3.5" />
          Record empty / cleanout
        </Button>
      </div>
      {listQ.isPending ? (
        <Skeleton className="h-10 w-full" />
      ) : listQ.isError ? (
        <QueryError
          title="Cleanouts failed to load"
          message={listQ.error.message}
          onRetry={() => void listQ.refetch()}
        />
      ) : rows.length === 0 ? (
        <p className="font-mono text-xs text-muted-foreground">
          No cleanouts recorded — a completed cleanout bounds the bin&apos;s genealogy
          (contamination events, trace, mass balance).
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Emptied</TableHead>
                <TableHead>Cleaned</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="w-[110px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground">
                    {fmtDateTime(c.emptiedAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-[11px] tabular-nums">
                    {c.cleanedAt ? (
                      <Badge
                        variant="outline"
                        className="border-stable/50 bg-stable/10 font-mono text-[10px] text-stable"
                      >
                        {fmtDateTime(c.cleanedAt)} · RESET
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-live/50 font-mono text-[10px] text-live"
                      >
                        pending
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{c.method ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{c.operator ?? "—"}</TableCell>
                  <TableCell className="max-w-[220px] truncate font-mono text-[11px] text-muted-foreground">
                    {c.note ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {c.cleanedAt == null && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 font-mono text-[10px]"
                        disabled={complete.isPending}
                        onClick={() => complete.mutate({ id: c.id })}
                      >
                        Mark cleaned
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {recordOpen && <RecordCleanoutDialog bin={bin} onClose={() => setRecordOpen(false)} />}
    </div>
  );
}

function RecordCleanoutDialog({ bin, onClose }: { bin: BinRow; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [emptiedAt, setEmptiedAt] = useState(todayInput);
  const [method, setMethod] = useState("");
  const [note, setNote] = useState("");
  const [confirmNotEmpty, setConfirmNotEmpty] = useState(false);

  const notEmpty = bin.currentLbs > EMPTY_TOLERANCE_LBS;

  const record = trpc.compliance.cleanouts.record.useMutation({
    onSuccess: async (r) => {
      if (r.warning) toast.warning(r.warning, { duration: 10_000 });
      else toast.success(`Cleanout recorded for ${bin.name}`);
      onClose();
      await utils.compliance.cleanouts.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    if (notEmpty && !confirmNotEmpty) {
      toast.error("Confirm the non-empty cleanout first (the bin is not near zero)");
      return;
    }
    if (bin.currentLbs > 0 && note.trim() === "") {
      toast.error("A note is required when the bin is not empty");
      return;
    }
    record.mutate({
      siteId: bin.siteId,
      binId: bin.id,
      emptiedAt: new Date(`${emptiedAt}T12:00:00`),
      method: method.trim() || undefined,
      note: note.trim() || undefined,
      confirmNotEmpty: confirmNotEmpty || undefined,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record empty / cleanout — {bin.name}</DialogTitle>
          <DialogDescription>
            Records the bin as emptied. Mark it cleaned afterwards — the cleaned
            timestamp is the genealogy reset point for trace and mass balance.
          </DialogDescription>
        </DialogHeader>
        {bin.currentLbs > 0 && (
          <div
            className={cn(
              "rounded-md border px-3 py-2 font-mono text-xs",
              notEmpty
                ? "border-crit/50 bg-crit/10 text-crit"
                : "border-[hsl(38_92%_60%)]/50 bg-[hsl(38_92%_60%)]/10 text-[hsl(38_92%_60%)]",
            )}
          >
            {bin.name} still holds {fmtLbs(bin.currentLbs)} lb
            {notEmpty
              ? " — empty it first, or confirm below and explain in the note."
              : " (within the near-zero tolerance) — note it below."}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="co-date" className="text-xs">
              Emptied on
            </Label>
            <Input
              id="co-date"
              type="date"
              value={emptiedAt}
              onChange={(e) => setEmptiedAt(e.target.value)}
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="co-method" className="text-xs">
              Method (optional)
            </Label>
            <Input
              id="co-method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              placeholder="e.g. sweep auger + washdown"
              className="h-8 text-xs"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="co-note" className="text-xs">
            Note {bin.currentLbs > 0 && <span className="text-crit">*</span>}
          </Label>
          <Textarea
            id="co-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={
              bin.currentLbs > 0
                ? "Required — where did the residual go?"
                : "optional"
            }
            className="text-xs"
          />
        </div>
        {notEmpty && (
          <label className="flex cursor-pointer items-center gap-2 font-mono text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={confirmNotEmpty}
              onChange={(e) => setConfirmNotEmpty(e.target.checked)}
              className="h-3.5 w-3.5 accent-[hsl(var(--crit))]"
            />
            Confirm: record the cleanout even though the bin is not near zero
          </label>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={record.isPending}>
            {record.isPending ? "Recording…" : "Record cleanout"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FumigationSection({ bin }: { bin: BinRow }) {
  const utils = trpc.useUtils();
  const listQ = trpc.compliance.fumigations.list.useQuery({ binId: bin.id });
  const [addOpen, setAddOpen] = useState(false);
  const [filesFor, setFilesFor] = useState<FumigationLogRow | null>(null);

  const markAerated = trpc.compliance.fumigations.update.useMutation({
    onSuccess: async () => {
      toast.success("Aeration clearance recorded");
      await utils.compliance.fumigations.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const rows = listQ.data ?? [];
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="gt-eyebrow">Fumigation / treatment log</div>
        <Button variant="outline" size="sm" className="h-7" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add fumigation
        </Button>
      </div>
      {listQ.isPending ? (
        <Skeleton className="h-10 w-full" />
      ) : listQ.isError ? (
        <QueryError
          title="Fumigation log failed to load"
          message={listQ.error.message}
          onRetry={() => void listQ.refetch()}
        />
      ) : rows.length === 0 ? (
        <p className="font-mono text-xs text-muted-foreground">
          No fumigation treatments recorded for this bin.
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Applied</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Dosage</TableHead>
                <TableHead className="text-right">Exposure h</TableHead>
                <TableHead>Aeration cleared</TableHead>
                <TableHead>Applicator</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="w-[70px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground">
                    {fmtDateTime(f.appliedAt)}
                  </TableCell>
                  <TableCell className="text-xs font-medium">{f.product}</TableCell>
                  <TableCell className="font-mono text-xs">{f.dosage ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {f.exposureHours ?? "—"}
                  </TableCell>
                  <TableCell>
                    {f.aerationClearedAt ? (
                      <Badge
                        variant="outline"
                        className="border-stable/50 bg-stable/10 font-mono text-[10px] text-stable"
                      >
                        {fmtDateTime(f.aerationClearedAt)}
                      </Badge>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 px-2 font-mono text-[10px]"
                        disabled={markAerated.isPending}
                        onClick={() =>
                          markAerated.mutate({ id: f.id, aerationClearedAt: new Date() })
                        }
                      >
                        Mark aerated
                      </Button>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{f.applicator ?? "—"}</TableCell>
                  <TableCell className="max-w-[180px] truncate font-mono text-[11px] text-muted-foreground">
                    {f.note ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      title="Documents for this treatment"
                      aria-label="Fumigation attachments"
                      onClick={() => setFilesFor(f)}
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {addOpen && <AddFumigationDialog bin={bin} onClose={() => setAddOpen(false)} />}
      {filesFor && (
        <Dialog open onOpenChange={(o) => !o && setFilesFor(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Documents — {filesFor.product}</DialogTitle>
              <DialogDescription>
                Fumigation record #{filesFor.id} · applied {fmtDateTime(filesFor.appliedAt)}
              </DialogDescription>
            </DialogHeader>
            <AttachmentsControl
              siteId={bin.siteId}
              entityType="fumigation_log"
              entityId={filesFor.id}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function AddFumigationDialog({ bin, onClose }: { bin: BinRow; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [product, setProduct] = useState("");
  const [dosage, setDosage] = useState("");
  const [appliedAt, setAppliedAt] = useState(todayInput);
  const [exposureHours, setExposureHours] = useState("");
  const [applicator, setApplicator] = useState("");
  const [note, setNote] = useState("");

  const create = trpc.compliance.fumigations.create.useMutation({
    onSuccess: async () => {
      toast.success(`Fumigation logged for ${bin.name}`);
      onClose();
      await utils.compliance.fumigations.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    if (!product.trim()) {
      toast.error("Product is required");
      return;
    }
    const hours = exposureHours.trim() === "" ? null : Number(exposureHours);
    if (hours != null && (!Number.isFinite(hours) || hours < 0)) {
      toast.error("Exposure hours must be a non-negative number");
      return;
    }
    create.mutate({
      siteId: bin.siteId,
      binId: bin.id,
      product: product.trim(),
      dosage: dosage.trim() || undefined,
      appliedAt: new Date(`${appliedAt}T12:00:00`),
      exposureHours: hours ?? undefined,
      applicator: applicator.trim() || undefined,
      note: note.trim() || undefined,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add fumigation — {bin.name}</DialogTitle>
          <DialogDescription>
            Product, dosage, and exposure. Record the aeration clearance from
            the log row when the bin clears.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="fum-product" className="text-xs">
              Product <span className="text-crit">*</span>
            </Label>
            <Input
              id="fum-product"
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              placeholder="e.g. Phostoxin"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fum-dosage" className="text-xs">
              Dosage
            </Label>
            <Input
              id="fum-dosage"
              value={dosage}
              onChange={(e) => setDosage(e.target.value)}
              placeholder="e.g. 90 tablets"
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fum-applied" className="text-xs">
              Applied on
            </Label>
            <Input
              id="fum-applied"
              type="date"
              value={appliedAt}
              onChange={(e) => setAppliedAt(e.target.value)}
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fum-hours" className="text-xs">
              Exposure hours
            </Label>
            <Input
              id="fum-hours"
              type="number"
              step="any"
              min="0"
              value={exposureHours}
              onChange={(e) => setExposureHours(e.target.value)}
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="col-span-2 space-y-1">
            <Label htmlFor="fum-applicator" className="text-xs">
              Applicator (defaults to the current operator)
            </Label>
            <Input
              id="fum-applicator"
              value={applicator}
              onChange={(e) => setApplicator(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="fum-note" className="text-xs">
            Note (optional)
          </Label>
          <Textarea
            id="fum-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="text-xs"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending ? "Saving…" : "Log fumigation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShrinkSection({ bin }: { bin: BinRow }) {
  const utils = trpc.useUtils();
  const listQ = trpc.compliance.shrinkEntries.list.useQuery({ binId: bin.id });
  const [kind, setKind] = useState<string>(SHRINK_ENTRY_KINDS[0]);
  const [qty, setQty] = useState("");
  const [date, setDate] = useState(todayInput);
  const [note, setNote] = useState("");

  const create = trpc.compliance.shrinkEntries.create.useMutation({
    onSuccess: async () => {
      toast.success("Shrink entry recorded");
      setQty("");
      setNote("");
      await utils.compliance.shrinkEntries.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    const n = Number(qty);
    if (qty.trim() === "" || !Number.isFinite(n) || n === 0) {
      toast.error("Enter a signed, non-zero quantity in lbs (negative = loss)");
      return;
    }
    create.mutate({
      siteId: bin.siteId,
      binId: bin.id,
      kind,
      quantityLbs: Math.round(n),
      effectiveDate: new Date(`${date}T12:00:00`),
      note: note.trim() || undefined,
    });
  };

  const rows = listQ.data ?? [];
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="gt-eyebrow">Shrink entries (append-only)</div>
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          disabled={rows.length === 0}
          onClick={() =>
            downloadCsv(
              `bin-${bin.id}-shrink-${csvDateStamp()}.csv`,
              ["Date", "Kind", "Qty lbs", "Note", "Operator"],
              rows.map((s) => [
                new Date(s.effectiveDate).toLocaleDateString("en-US"),
                s.kind,
                s.quantityLbs,
                s.note,
                s.operator,
              ]),
            )
          }
        >
          <Download className="mr-1.5 h-3.5 w-3.5" />
          CSV
        </Button>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 rounded-md border border-border p-3 md:grid-cols-5">
        <div className="space-y-1">
          <Label className="text-xs">Kind</Label>
          <Select value={kind} onValueChange={setKind}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SHRINK_ENTRY_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="sh-qty" className="text-xs">
            Qty lbs (signed)
          </Label>
          <Input
            id="sh-qty"
            type="number"
            step="any"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="-420"
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sh-date" className="text-xs">
            Effective date
          </Label>
          <Input
            id="sh-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sh-note" className="text-xs">
            Note
          </Label>
          <Input
            id="sh-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="h-8 text-xs"
          />
        </div>
        <div className="flex items-end">
          <Button size="sm" className="h-8 w-full" onClick={submit} disabled={create.isPending}>
            {create.isPending ? "Saving…" : "Add entry"}
          </Button>
        </div>
      </div>

      {listQ.isPending ? (
        <Skeleton className="h-10 w-full" />
      ) : listQ.isError ? (
        <QueryError
          title="Shrink entries failed to load"
          message={listQ.error.message}
          onRetry={() => void listQ.refetch()}
        />
      ) : rows.length === 0 ? (
        <p className="font-mono text-xs text-muted-foreground">
          No shrink entries — corrections are posted as reversing entries, never edited.
        </p>
      ) : (
        <div className="max-h-48 overflow-y-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead className="text-right">Qty lbs</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground">
                    {new Date(s.effectiveDate).toLocaleDateString("en-US")}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {s.kind}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono text-xs font-semibold tabular-nums",
                      s.quantityLbs < 0 ? "text-crit" : "text-stable",
                    )}
                  >
                    {s.quantityLbs > 0 ? "+" : ""}
                    {fmtLbs(s.quantityLbs)}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate font-mono text-[11px] text-muted-foreground">
                    {s.note ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{s.operator ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export function BinDetailDialog({
  bin,
  onClose,
}: {
  bin: BinRow;
  onClose: () => void;
}) {
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
            {bin.program !== "conventional" && (
              <Badge
                variant="outline"
                className="border-go/50 bg-go/10 font-mono text-[10px] uppercase text-go"
              >
                {bin.program}
              </Badge>
            )}
          </div>
          <DialogDescription>
            {bin.siteName ?? ""} · holding {fmtLbs(bin.currentLbs)} lb (
            {bin.capacityLbs > 0
              ? `${fmtLbs(Math.round(bin.currentLbs / bushelWeight(bin.crop)))} bu`
              : "—"}
            ) of {fmtLbs(bin.capacityLbs)} lb capacity
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="inventory">
          <TabsList>
            <TabsTrigger value="inventory">Inventory</TabsTrigger>
            <TabsTrigger value="grades">Grades</TabsTrigger>
            <TabsTrigger value="compliance">Compliance</TabsTrigger>
          </TabsList>
          <TabsContent value="inventory" className="mt-4">
            <InventoryTab bin={bin} />
          </TabsContent>
          <TabsContent value="grades" className="mt-4">
            <GradesTab bin={bin} />
          </TabsContent>
          <TabsContent value="compliance" className="mt-4">
            <div className="space-y-5">
              <CleanoutsSection bin={bin} />
              <Separator />
              <FumigationSection bin={bin} />
              <Separator />
              <ShrinkSection bin={bin} />
              <Separator />
              <LabResultsSection siteId={bin.siteId} binId={bin.id} />
              <Separator />
              <AttachmentsControl siteId={bin.siteId} entityType="bin" entityId={bin.id} />
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

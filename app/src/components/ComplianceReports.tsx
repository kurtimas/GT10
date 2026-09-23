// Compliance report sections for the Reports page (Phase C):
//   #5  DprSection        — Daily Position Record: live preview for the
//                           report day, regenerate while the day is open,
//                           frozen snapshot list, CSV export. Rows are per
//                           site × day × crop × program (segregation, #17).
//   #15 MassBalanceSection — per-bin book vs cache vs physical count, with
//                           the examiner variance flag (>1% of book AND
//                           >500 bu) highlighted; physical count entry.
//   #9  RetentionExamSection — retention-years setting + exam-mode export
//                           (date range + entity checkboxes → CSV bundle).

import { useState } from "react";
import { Download, Gauge, RotateCw } from "lucide-react";
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
import { AdminPasswordField } from "@/components/AdminPasswordField";
import { useAdminGate } from "@/hooks/useAdminGate";
import { downloadCsv } from "@shared/src/lib/csv";
import { fmtBu, fmtLbs } from "@contracts/grain";
import { RETENTION_YEARS_MAX, RETENTION_YEARS_MIN } from "@contracts/compliance";
import type { BinRow } from "@contracts/types";

function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoInput(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function fmtDateTime(d: Date | string): string {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ------------------------------------------------------------------ DPR (#5)

interface DprRowShape {
  crop: string;
  program: string;
  openingLbs: number;
  receivedLbs: number;
  receivedBu: number;
  shippedLbs: number;
  shippedBu: number;
  transfersInLbs: number;
  transfersOutLbs: number;
  shrinkMoistureLbs: number;
  shrinkHandlingLbs: number;
  shrinkAerationLbs: number;
  shrinkErrorCorrectionLbs: number;
  adjustmentsLbs: number;
  endingLbs: number;
  endingBu: number;
}

function DprRowsTable({ rows }: { rows: DprRowShape[] }) {
  const shrinkTotal = (r: DprRowShape) =>
    r.shrinkMoistureLbs + r.shrinkHandlingLbs + r.shrinkAerationLbs + r.shrinkErrorCorrectionLbs;
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Crop</TableHead>
            <TableHead>Program</TableHead>
            <TableHead className="text-right">Opening lbs</TableHead>
            <TableHead className="text-right">Received lbs</TableHead>
            <TableHead className="text-right">Shipped lbs</TableHead>
            <TableHead className="text-right">Transfers ±</TableHead>
            <TableHead className="text-right">Shrink lbs</TableHead>
            <TableHead className="text-right">Adjust lbs</TableHead>
            <TableHead className="text-right">Ending lbs</TableHead>
            <TableHead className="text-right">Ending bu</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={`${r.crop}-${r.program}-${i}`}>
              <TableCell className="font-medium">{r.crop}</TableCell>
              <TableCell>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {r.program}
                </Badge>
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">
                {fmtLbs(r.openingLbs)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums text-stable">
                +{fmtLbs(r.receivedLbs)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums text-crit">
                -{fmtLbs(r.shippedLbs)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">
                {fmtLbs(r.transfersInLbs - r.transfersOutLbs)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">
                {fmtLbs(shrinkTotal(r))}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">
                {fmtLbs(r.adjustmentsLbs)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">
                {fmtLbs(r.endingLbs)}
              </TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">
                {fmtBu(r.endingBu)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function DprSection({ siteId, day }: { siteId: number; day: string }) {
  const utils = trpc.useUtils();
  const previewQ = trpc.reports.dprPreview.useQuery({ siteId, day });
  const listQ = trpc.reports.dprList.useQuery({ siteId });
  const [csvFrom, setCsvFrom] = useState(() => daysAgoInput(30));
  const [csvTo, setCsvTo] = useState(todayInput);
  const [csvBusy, setCsvBusy] = useState(false);

  const regenerate = trpc.reports.dprRegenerate.useMutation({
    onSuccess: async (r) => {
      toast.success(`DPR regenerated — ${r.rows} row(s) for ${day}`);
      await Promise.all([
        utils.reports.dprPreview.invalidate(),
        utils.reports.dprList.invalidate(),
      ]);
    },
    onError: (err) => toast.error(err.message),
  });

  const exportCsv = async () => {
    setCsvBusy(true);
    try {
      const r = await utils.reports.dprCsv.fetch({ siteId, dayFrom: csvFrom, dayTo: csvTo });
      downloadText(r.filename, "﻿" + r.csv);
      toast.success(`Exported ${r.rows} DPR row(s)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "DPR export failed");
    } finally {
      setCsvBusy(false);
    }
  };

  const frozen = listQ.data ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Daily Position Record (DPR)</CardTitle>
        <CardDescription>
          One row per day × crop × program. The report day&apos;s preview is live;
          closing the day freezes it. Storage-vs-owned is not modeled.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="gt-eyebrow">Preview — {day} (open until close of day)</div>
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              disabled={regenerate.isPending}
              title="Snapshot the open day (refused once the day is closed/frozen)"
              onClick={() => regenerate.mutate({ siteId, day })}
            >
              <RotateCw className={cn("mr-1.5 h-3.5 w-3.5", regenerate.isPending && "animate-spin")} />
              {regenerate.isPending ? "Regenerating…" : "Regenerate snapshot"}
            </Button>
          </div>
          {previewQ.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : previewQ.isError ? (
            <QueryError
              title="DPR preview failed"
              message={previewQ.error.message}
              onRetry={() => void previewQ.refetch()}
              retrying={previewQ.isRefetching}
            />
          ) : (previewQ.data?.rows.length ?? 0) === 0 ? (
            <p className="font-mono text-xs text-muted-foreground">
              No position for {day} yet — rows appear once grain moves.
            </p>
          ) : (
            <DprRowsTable rows={previewQ.data!.rows} />
          )}
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="gt-eyebrow">Frozen snapshots</div>
            <div className="flex items-end gap-2">
              <Input
                type="date"
                aria-label="DPR CSV from"
                value={csvFrom}
                onChange={(e) => setCsvFrom(e.target.value)}
                className="h-7 w-36 font-mono text-xs"
              />
              <Input
                type="date"
                aria-label="DPR CSV to"
                value={csvTo}
                onChange={(e) => setCsvTo(e.target.value)}
                className="h-7 w-36 font-mono text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-7"
                disabled={csvBusy}
                onClick={() => void exportCsv()}
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                {csvBusy ? "Exporting…" : "CSV export"}
              </Button>
            </div>
          </div>
          {listQ.isPending ? (
            <Skeleton className="h-20 w-full" />
          ) : listQ.isError ? (
            <QueryError
              title="DPR snapshots failed to load"
              message={listQ.error.message}
              onRetry={() => void listQ.refetch()}
              retrying={listQ.isRefetching}
            />
          ) : frozen.length === 0 ? (
            <p className="font-mono text-xs text-muted-foreground">
              No snapshots yet — close a day to freeze its DPR.
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Day</TableHead>
                    <TableHead>Crop</TableHead>
                    <TableHead>Program</TableHead>
                    <TableHead className="text-right">Received</TableHead>
                    <TableHead className="text-right">Shipped</TableHead>
                    <TableHead className="text-right">Ending lbs</TableHead>
                    <TableHead>State</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {frozen.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs tabular-nums">{r.day}</TableCell>
                      <TableCell className="text-xs">{r.crop}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {r.program}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {fmtLbs(r.receivedLbs)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {fmtLbs(r.shippedLbs)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">
                        {fmtLbs(r.endingLbs)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "font-mono text-[10px]",
                            r.frozen
                              ? "border-stable/50 bg-stable/10 text-stable"
                              : "border-live/50 bg-live/10 text-live",
                          )}
                        >
                          {r.frozen ? "FROZEN" : "open"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// --------------------------------------------------------- mass balance (#15)

function PhysicalCountDialog({ bin, onClose }: { bin: BinRow; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");

  const record = trpc.reports.recordPhysicalCount.useMutation({
    onSuccess: async () => {
      toast.success(`Physical count recorded for ${bin.name}`);
      onClose();
      await utils.reports.massBalance.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    const n = Number(counted);
    if (counted.trim() === "" || !Number.isFinite(n) || n < 0) {
      toast.error("Enter the measured contents in lbs (0 or more)");
      return;
    }
    record.mutate({
      siteId: bin.siteId,
      binId: bin.id,
      countedLbs: Math.round(n),
      note: note.trim() || undefined,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Physical count — {bin.name}</DialogTitle>
          <DialogDescription>
            The measured contents (tape/reading). Book-vs-physical variance is
            flagged when it exceeds BOTH 1% of book and 500 bu.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="pc-lbs">Counted lbs</Label>
          <Input
            id="pc-lbs"
            inputMode="numeric"
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
            placeholder="e.g. 812400"
            className="font-mono"
            autoFocus
          />
          <p className="font-mono text-[10px] text-muted-foreground">
            Book level: {fmtLbs(bin.currentLbs)} lb
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pc-note">Note (optional)</Label>
          <Input
            id="pc-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. tape measurement"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={record.isPending}>
            {record.isPending ? "Recording…" : "Record count"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MassBalanceSection({ siteId }: { siteId: number }) {
  const binsQ = trpc.core.bins.list.useQuery({ siteId });
  const [from, setFrom] = useState(() => daysAgoInput(30));
  const [to, setTo] = useState(todayInput);
  const [countBin, setCountBin] = useState<BinRow | null>(null);

  const mbQ = trpc.reports.massBalance.useQuery({ siteId, from, to });
  const rows = mbQ.data?.bins ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Mass balance — book vs physical</CardTitle>
        <CardDescription>
          Per-bin book inventory (movement replay + signed shrink entries) vs
          the cached level vs the latest physical count.{" "}
          {mbQ.data ? `Variance ${mbQ.data.flagRule}.` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="mb-from" className="text-xs">
              From
            </Label>
            <Input
              id="mb-from"
              type="date"
              value={from}
              onChange={(e) => e.target.value && setFrom(e.target.value)}
              className="h-8 w-40 font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mb-to" className="text-xs">
              To
            </Label>
            <Input
              id="mb-to"
              type="date"
              value={to}
              onChange={(e) => e.target.value && setTo(e.target.value)}
              className="h-8 w-40 font-mono text-xs"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={rows.length === 0}
            onClick={() =>
              downloadCsv(
                `mass-balance-${from}_${to}.csv`,
                [
                  "Bin", "Crop", "Program", "Opening lbs", "Received lbs", "Shipped lbs",
                  "Transfers in", "Transfers out", "Shrink lbs", "Adjustments lbs",
                  "Expected (book) lbs", "Cache lbs", "Cache variance lbs",
                  "Physical lbs", "Counted at", "Physical variance lbs",
                  "Variance %", "Variance bu", "Flagged",
                ],
                rows.map((r) => [
                  r.binName,
                  r.crop,
                  r.program,
                  r.openingLbs,
                  r.receivedLbs,
                  r.shippedLbs,
                  r.transfersInLbs,
                  r.transfersOutLbs,
                  r.shrinkLbs,
                  r.adjustmentsLbs,
                  r.expectedLbs,
                  r.cacheLbs,
                  r.cacheVarianceLbs,
                  r.physical?.countedLbs,
                  r.physical ? fmtDateTime(r.physical.countedAt) : null,
                  r.physical?.varianceLbs,
                  r.physical?.variancePct,
                  r.physical?.varianceBu,
                  r.physical?.flagged ? "YES" : "",
                ]),
              )
            }
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            CSV
          </Button>
        </div>

        {mbQ.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : mbQ.isError ? (
          <QueryError
            title="Mass balance failed to load"
            message={mbQ.error.message}
            onRetry={() => void mbQ.refetch()}
            retrying={mbQ.isRefetching}
          />
        ) : rows.length === 0 ? (
          <p className="font-mono text-xs text-muted-foreground">
            No bins at this location.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bin</TableHead>
                  <TableHead className="text-right">Opening</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Shipped</TableHead>
                  <TableHead className="text-right">Shrink</TableHead>
                  <TableHead className="text-right">Book (expected)</TableHead>
                  <TableHead className="text-right">Cache</TableHead>
                  <TableHead className="text-right">Physical</TableHead>
                  <TableHead className="text-right">Book vs physical</TableHead>
                  <TableHead className="w-[100px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const binRow = (binsQ.data ?? []).find((b) => b.id === r.binId);
                  return (
                    <TableRow
                      key={r.binId}
                      className={cn(r.physical?.flagged && "bg-crit/5")}
                    >
                      <TableCell className="font-mono text-xs font-semibold">
                        {r.binName}
                        <span className="ml-1.5 font-normal text-muted-foreground">
                          {r.crop}
                          {r.program !== "conventional" ? ` · ${r.program}` : ""}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {fmtLbs(r.openingLbs)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums text-stable">
                        +{fmtLbs(r.receivedLbs)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums text-crit">
                        -{fmtLbs(r.shippedLbs)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums"
                        title={Object.entries(r.shrinkByKind)
                          .map(([k, v]) => `${k}: ${fmtLbs(v)} lb`)
                          .join(" · ")}
                      >
                        {fmtLbs(r.shrinkLbs)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">
                        {fmtLbs(r.expectedLbs)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono text-xs tabular-nums",
                          r.cacheVarianceLbs !== 0 && "text-[hsl(38_92%_60%)]",
                        )}
                        title={`Cache variance ${fmtLbs(r.cacheVarianceLbs)} lb`}
                      >
                        {fmtLbs(r.cacheLbs)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {r.physical ? fmtLbs(r.physical.countedLbs) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.physical ? (
                          <Badge
                            variant="outline"
                            className={cn(
                              "font-mono text-[10px] tabular-nums",
                              r.physical.flagged
                                ? "border-crit/60 bg-crit/10 text-crit"
                                : "border-stable/50 text-stable",
                            )}
                            title={`${fmtLbs(r.physical.varianceLbs)} lb · counted ${fmtDateTime(r.physical.countedAt)}`}
                          >
                            {r.physical.variancePct > 0 ? "+" : ""}
                            {r.physical.variancePct}% · {fmtBu(r.physical.varianceBu)} bu
                            {r.physical.flagged ? " ⚑" : ""}
                          </Badge>
                        ) : (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            no count
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {binRow && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 font-mono text-[10px]"
                            title="Record a physical count"
                            onClick={() => setCountBin(binRow)}
                          >
                            <Gauge className="mr-1 h-3 w-3" />
                            Count
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      {countBin && (
        <PhysicalCountDialog bin={countBin} onClose={() => setCountBin(null)} />
      )}
    </Card>
  );
}

// ------------------------------------------------------ retention + exam (#9)

const EXAM_ENTITIES = [
  { key: "tickets", label: "Tickets (loads incl. voids)" },
  { key: "movements", label: "Bin movements" },
  { key: "shipments", label: "Shipments" },
  { key: "audit", label: "Audit log" },
  { key: "dpr", label: "DPR snapshots" },
] as const;

type ExamEntity = (typeof EXAM_ENTITIES)[number]["key"];

export function RetentionExamSection() {
  const utils = trpc.useUtils();
  const retentionQ = trpc.compliance.retention.get.useQuery();
  const [years, setYears] = useState("");
  const [loadedYears, setLoadedYears] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const { passwordRequired } = useAdminGate();

  if (retentionQ.data && !loadedYears) {
    setLoadedYears(true);
    setYears(String(retentionQ.data.years));
  }

  const setRetention = trpc.compliance.retention.set.useMutation({
    onSuccess: async (r) => {
      toast.success(`Retention set to ${r.years} years`);
      setAdminPassword("");
      await utils.compliance.retention.get.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const saveYears = () => {
    const n = Number(years);
    if (!Number.isInteger(n) || n < RETENTION_YEARS_MIN || n > RETENTION_YEARS_MAX) {
      toast.error(
        `Retention must be a whole number of years, ${RETENTION_YEARS_MIN}–${RETENTION_YEARS_MAX}`,
      );
      return;
    }
    if (passwordRequired && !adminPassword) {
      toast.error("Admin password is required to change retention");
      return;
    }
    setRetention.mutate({ years: n, adminPassword: adminPassword || undefined });
  };

  const [examFrom, setExamFrom] = useState(() => daysAgoInput(365));
  const [examTo, setExamTo] = useState(todayInput);
  const [examEntities, setExamEntities] = useState<ExamEntity[]>(["tickets", "audit"]);
  const [examBusy, setExamBusy] = useState(false);

  const toggleEntity = (key: ExamEntity) =>
    setExamEntities((cur) =>
      cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key],
    );

  const runExamExport = async () => {
    if (examEntities.length === 0) {
      toast.error("Pick at least one record type");
      return;
    }
    setExamBusy(true);
    try {
      const r = await utils.compliance.exam.export.fetch({
        from: examFrom,
        to: examTo,
        entityTypes: examEntities,
      });
      downloadText(
        `exam-manifest_${examFrom}_${examTo}.json`,
        JSON.stringify(r.manifest, null, 2),
        "application/json",
      );
      for (const [name, csv] of Object.entries(r.sections)) {
        downloadText(`exam-${name}_${examFrom}_${examTo}.csv`, "﻿" + csv);
      }
      const counts = Object.entries(r.manifest.counts)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      toast.success(`Exam bundle downloaded — ${counts}`, { duration: 10_000 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Exam export failed");
    } finally {
      setExamBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Retention & exam mode</CardTitle>
        <CardDescription>
          How long records are kept (2–10 years; 6 covers Iowa warehouse law and
          organic/EUDR), and the one-shot export bundle for an unannounced exam.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {retentionQ.isError && (
          <QueryError
            title="Retention setting failed to load"
            message={retentionQ.error.message}
            onRetry={() => void retentionQ.refetch()}
            retrying={retentionQ.isRefetching}
          />
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="retention-years" className="gt-eyebrow">
              Retention (years)
            </Label>
            {retentionQ.isPending ? (
              <Skeleton className="h-9 w-24" />
            ) : (
              <Input
                id="retention-years"
                type="number"
                min={RETENTION_YEARS_MIN}
                max={RETENTION_YEARS_MAX}
                value={years}
                onChange={(e) => setYears(e.target.value)}
                className="w-24 font-mono"
              />
            )}
          </div>
          <AdminPasswordField
            id="retention-admin-password"
            value={adminPassword}
            onChange={setAdminPassword}
          />
          <Button
            variant="outline"
            onClick={saveYears}
            disabled={setRetention.isPending || retentionQ.isPending}
          >
            {setRetention.isPending ? "Saving…" : "Save retention"}
          </Button>
        </div>

        <div className="rounded-md border border-border p-3">
          <div className="gt-eyebrow mb-2">Exam export</div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="exam-from" className="text-xs">
                From
              </Label>
              <Input
                id="exam-from"
                type="date"
                value={examFrom}
                onChange={(e) => setExamFrom(e.target.value)}
                className="h-8 w-40 font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="exam-to" className="text-xs">
                To
              </Label>
              <Input
                id="exam-to"
                type="date"
                value={examTo}
                onChange={(e) => setExamTo(e.target.value)}
                className="h-8 w-40 font-mono text-xs"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3 pb-1">
              {EXAM_ENTITIES.map((e) => (
                <label
                  key={e.key}
                  className="flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-muted-foreground"
                >
                  <input
                    type="checkbox"
                    checked={examEntities.includes(e.key)}
                    onChange={() => toggleEntity(e.key)}
                    className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
                  />
                  {e.label}
                </label>
              ))}
            </div>
            <Button onClick={() => void runExamExport()} disabled={examBusy}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {examBusy ? "Exporting…" : "Download exam bundle"}
            </Button>
          </div>
          <p className="mt-2 font-mono text-[10px] text-muted-foreground">
            Downloads a manifest JSON plus one CSV per selected record type —
            tickets (voided rows included and marked), movements, shipments,
            audit log, and DPR snapshots for the range.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

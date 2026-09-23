// Lab results (Phase C, #22) — sample → lab → result bound to the lot, load,
// or bin it certifies. Reusable section: pass lotId/loadId/binId to scope the
// list + pre-link the add form; with none of them the add form offers lot and
// bin pickers (the server requires at least one link). Pass/fail badges.

import { useState } from "react";
import { Download, FlaskConical, Plus } from "lucide-react";
import { trpc } from "@shared/src/lib/trpc";
import { cn } from "@shared/src/lib/utils";
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
import { LAB_TEST_TYPES } from "@contracts/compliance";

function fmtDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function PassFailBadge({ passFail }: { passFail: string | null }) {
  if (passFail == null) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-mono text-[10px] uppercase",
        passFail === "pass"
          ? "border-stable/50 bg-stable/10 text-stable"
          : "border-crit/60 bg-crit/10 text-crit",
      )}
    >
      {passFail}
    </Badge>
  );
}

export function LabResultsSection({
  siteId,
  lotId,
  loadId,
  binId,
}: {
  siteId: number;
  lotId?: number;
  loadId?: number;
  binId?: number;
}) {
  const utils = trpc.useUtils();
  const [addOpen, setAddOpen] = useState(false);

  const filter = {
    siteId,
    ...(lotId != null ? { lotId } : {}),
    ...(loadId != null ? { loadId } : {}),
    ...(binId != null ? { binId } : {}),
  };
  const listQ = trpc.compliance.labResults.list.useQuery(filter);
  const rows = listQ.data ?? [];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="gt-eyebrow flex items-center gap-1.5">
          <FlaskConical className="h-3 w-3" />
          Lab results
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            disabled={rows.length === 0}
            onClick={() =>
              downloadCsv(
                `lab-results-${csvDateStamp()}.csv`,
                ["Sample date", "Lab", "Test", "Result", "Pass/Fail", "Lot", "Bin", "Load", "Note"],
                rows.map((r) => [
                  fmtDate(r.sampleDate),
                  r.labName,
                  r.testType,
                  r.result,
                  r.passFail,
                  r.lotCode,
                  r.binName,
                  r.loadId,
                  r.note,
                ]),
              )
            }
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            CSV
          </Button>
          <Button size="sm" className="h-7" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add result
          </Button>
        </div>
      </div>

      {listQ.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-2/3" />
        </div>
      ) : listQ.isError ? (
        <QueryError
          title="Lab results failed to load"
          message={listQ.error.message}
          onRetry={() => void listQ.refetch()}
          retrying={listQ.isRefetching}
        />
      ) : rows.length === 0 ? (
        <p className="font-mono text-xs text-muted-foreground">
          No lab results recorded here yet.
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sampled</TableHead>
                <TableHead>Test</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>P/F</TableHead>
                <TableHead>Lab</TableHead>
                <TableHead>Link</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground">
                    {fmtDate(r.sampleDate)}
                  </TableCell>
                  <TableCell className="font-mono text-xs font-semibold">{r.testType}</TableCell>
                  <TableCell className="font-mono text-xs">{r.result ?? "—"}</TableCell>
                  <TableCell>
                    <PassFailBadge passFail={r.passFail} />
                  </TableCell>
                  <TableCell className="text-xs">{r.labName ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                    {[r.lotCode, r.binName, r.loadId != null ? `load #${r.loadId}` : null]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate font-mono text-[11px] text-muted-foreground">
                    {r.note ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {addOpen && (
        <AddLabResultDialog
          siteId={siteId}
          lotId={lotId}
          loadId={loadId}
          binId={binId}
          onClose={() => setAddOpen(false)}
          onSaved={() => void utils.compliance.labResults.list.invalidate()}
        />
      )}
    </div>
  );
}

function AddLabResultDialog({
  siteId,
  lotId,
  loadId,
  binId,
  onClose,
  onSaved,
}: {
  siteId: number;
  lotId?: number;
  loadId?: number;
  binId?: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const scoped = lotId != null || loadId != null || binId != null;
  const lotsQ = trpc.people.lots.list.useQuery(undefined, { enabled: !scoped });
  const binsQ = trpc.core.bins.list.useQuery({ siteId }, { enabled: !scoped });

  const [sampleDate, setSampleDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [labName, setLabName] = useState("");
  const [testType, setTestType] = useState<string>(LAB_TEST_TYPES[0]);
  const [result, setResult] = useState("");
  const [passFail, setPassFail] = useState("none");
  const [lotChoice, setLotChoice] = useState("none");
  const [binChoice, setBinChoice] = useState("none");
  const [note, setNote] = useState("");

  const create = trpc.compliance.labResults.create.useMutation({
    onSuccess: () => {
      toast.success("Lab result recorded");
      onSaved();
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  const linkedLot = lotId ?? (lotChoice !== "none" ? Number(lotChoice) : null);
  const linkedBin = binId ?? (binChoice !== "none" ? Number(binChoice) : null);
  const linkedLoad = loadId ?? null;
  const hasLink = linkedLot != null || linkedBin != null || linkedLoad != null;

  const submit = () => {
    if (!sampleDate) {
      toast.error("Sample date is required");
      return;
    }
    if (!hasLink) {
      toast.error("Link the result to a lot or a bin (the server requires one)");
      return;
    }
    create.mutate({
      siteId,
      sampleDate: new Date(`${sampleDate}T12:00:00`),
      labName: labName.trim() || undefined,
      testType,
      result: result.trim() || undefined,
      passFail: passFail === "none" ? undefined : (passFail as "pass" | "fail"),
      lotId: linkedLot ?? undefined,
      loadId: linkedLoad ?? undefined,
      binId: linkedBin ?? undefined,
      note: note.trim() || undefined,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add lab result</DialogTitle>
          <DialogDescription>
            Bind a sample result to the lot, load, or bin it certifies.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="lab-date" className="text-xs">
              Sample date
            </Label>
            <Input
              id="lab-date"
              type="date"
              value={sampleDate}
              onChange={(e) => setSampleDate(e.target.value)}
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Test type</Label>
            <Select value={testType} onValueChange={setTestType}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LAB_TEST_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="lab-name" className="text-xs">
              Lab (optional)
            </Label>
            <Input
              id="lab-name"
              value={labName}
              onChange={(e) => setLabName(e.target.value)}
              placeholder="e.g. SGS"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lab-result" className="text-xs">
              Result (optional)
            </Label>
            <Input
              id="lab-result"
              value={result}
              onChange={(e) => setResult(e.target.value)}
              placeholder="e.g. 0.8 ppm"
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Pass / fail</Label>
            <Select value={passFail} onValueChange={setPassFail}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not graded</SelectItem>
                <SelectItem value="pass">Pass</SelectItem>
                <SelectItem value="fail">Fail</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {!scoped && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Lot</Label>
                <Select value={lotChoice} onValueChange={setLotChoice}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {(lotsQ.data ?? []).map((l) => (
                      <SelectItem key={l.id} value={String(l.id)}>
                        {l.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Bin</Label>
                <Select value={binChoice} onValueChange={setBinChoice}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {(binsQ.data ?? []).map((b) => (
                      <SelectItem key={b.id} value={String(b.id)}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="lab-note" className="text-xs">
            Note (optional)
          </Label>
          <Textarea
            id="lab-note"
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
            {create.isPending ? "Saving…" : "Add result"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

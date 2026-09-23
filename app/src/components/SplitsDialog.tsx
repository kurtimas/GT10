// Load splits (Phase C, #4) — farmer/landlord percentage shares of one load.
// The dialog edits the split set with live sum-to-100 validation (the server
// re-checks authoritatively and rejects with the actual total); SplitsCell is
// the compact read-only rendering used inside load lists/detail rows.

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { trpc } from "@shared/src/lib/trpc";
import { toast } from "@shared/src/components/ui/sonner";
import { cn } from "@shared/src/lib/utils";
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
import { QueryError } from "@shared/src/components/QueryError";
import { round2 } from "@contracts/grain";
import type { LoadRow } from "@contracts/types";

/** Compact split summary for a load row, e.g. "K. Miller 70% · S. Cole 30%". */
export function SplitsCell({ loadId }: { loadId: number }) {
  const splitsQ = trpc.splits.get.useQuery({ loadId });
  if (splitsQ.isPending) return <Skeleton className="mt-0.5 h-3 w-20" />;
  if (splitsQ.isError) return null; // the dialog surfaces the error with retry
  const rows = splitsQ.data ?? [];
  if (rows.length === 0) return null;
  return (
    <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
      {rows
        .map((s) => `${s.partyName ?? `#${s.partyId}`} ${s.splitPct}%`)
        .join(" · ")}
    </div>
  );
}

interface SplitDraft {
  partyType: "farmer" | "landlord";
  partyId: string;
  pct: string;
}

export function SplitsDialog({
  load,
  open,
  onOpenChange,
}: {
  load: LoadRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const splitsQ = trpc.splits.get.useQuery({ loadId: load.id }, { enabled: open });
  const farmersQ = trpc.people.farmers.list.useQuery();
  const landlordsQ = trpc.people.landlords.list.useQuery();

  const [rows, setRows] = useState<SplitDraft[] | null>(null);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);

  // Seed the editor from the server once the current splits arrive
  // (render-phase adjustment — same pattern as LotDialog's code suggestion).
  if (splitsQ.data && loadedFor !== load.id) {
    setLoadedFor(load.id);
    setRows(
      splitsQ.data.length === 0
        ? [{ partyType: "farmer", partyId: "", pct: "100" }]
        : splitsQ.data.map((s) => ({
            partyType: s.partyType as "farmer" | "landlord",
            partyId: String(s.partyId),
            pct: String(s.splitPct),
          })),
    );
  }

  const set = trpc.splits.set.useMutation({
    onSuccess: async (r) => {
      toast.success(`Splits saved for load ${load.loadNo} — ${r.count} parties, ${r.totalPct}%`);
      await utils.splits.get.invalidate({ loadId: load.id });
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const drafts = rows ?? [];
  const parsed = drafts.map((d) => ({
    ...d,
    partyIdNum: Number(d.partyId),
    pctNum: Number(d.pct),
  }));
  const total = round2(
    parsed.reduce((sum, d) => sum + (Number.isFinite(d.pctNum) ? d.pctNum : 0), 0),
  );
  const rowsValid =
    drafts.length > 0 &&
    parsed.every(
      (d) =>
        Number.isFinite(d.partyIdNum) &&
        d.partyIdNum > 0 &&
        d.pct.trim() !== "" &&
        Number.isFinite(d.pctNum) &&
        d.pctNum > 0 &&
        d.pctNum <= 100,
    );
  const sumOk = Math.abs(total - 100) <= 0.01;
  const canSave = rowsValid && sumOk && !set.isPending;

  const update = (i: number, patch: Partial<SplitDraft>) =>
    setRows(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const save = () =>
    set.mutate({
      loadId: load.id,
      splits: parsed.map((d) => ({
        partyType: d.partyType,
        partyId: d.partyIdNum,
        splitPct: d.pctNum,
      })),
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Splits — load {load.loadNo}</DialogTitle>
          <DialogDescription>
            Who shares this load. Percentages must sum to 100%; saving replaces
            the whole set atomically and is written to the audit trail.
          </DialogDescription>
        </DialogHeader>

        {splitsQ.isError ? (
          <QueryError
            title="Splits failed to load"
            message={splitsQ.error.message}
            onRetry={() => void splitsQ.refetch()}
            retrying={splitsQ.isRefetching}
          />
        ) : splitsQ.isPending || rows == null ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <>
            <div className="space-y-2">
              {drafts.map((d, i) => {
                const parties =
                  (d.partyType === "farmer" ? farmersQ.data : landlordsQ.data) ?? [];
                return (
                  <div key={i} className="flex items-end gap-2">
                    <div className="w-28 space-y-1">
                      <Label className="text-xs">Party</Label>
                      <Select
                        value={d.partyType}
                        onValueChange={(v) =>
                          update(i, { partyType: v as "farmer" | "landlord", partyId: "" })
                        }
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="farmer">Farmer</SelectItem>
                          <SelectItem value="landlord">Landlord</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <Label className="text-xs">Name</Label>
                      <Select
                        value={d.partyId}
                        onValueChange={(v) => update(i, { partyId: v })}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select…" />
                        </SelectTrigger>
                        <SelectContent>
                          {parties.map((p) => (
                            <SelectItem key={p.id} value={String(p.id)}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-24 space-y-1">
                      <Label className="text-xs">Split %</Label>
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        max="100"
                        value={d.pct}
                        onChange={(e) => update(i, { pct: e.target.value })}
                        className="h-8 font-mono text-xs"
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 flex-none text-muted-foreground hover:text-destructive"
                      disabled={drafts.length <= 1}
                      title="Remove row"
                      aria-label="Remove split row"
                      onClick={() => setRows(drafts.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                className="h-7"
                onClick={() =>
                  setRows([...drafts, { partyType: "landlord", partyId: "", pct: "" }])
                }
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add party
              </Button>
              <span
                className={cn(
                  "font-mono text-xs font-semibold tabular-nums",
                  sumOk ? "text-stable" : "text-crit",
                )}
              >
                Total {total}% {sumOk ? "✓" : "— must be 100%"}
              </span>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {set.isPending ? "Saving…" : "Save splits"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

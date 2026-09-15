import { useMemo, useState } from "react";
import { Gauge, History, Pencil, Plus, Trash2, Warehouse } from "lucide-react";
import { trpc } from "@shared/src/lib/trpc";
import { cn, cropBadgeClass, cropFillClass } from "@shared/src/lib/utils";
import { useSite } from "@/providers/site";
import { toast } from "@shared/src/components/ui/sonner";
import { Badge } from "@shared/src/components/ui/badge";
import { Button } from "@shared/src/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shared/src/components/ui/card";
import { QueryError } from "@shared/src/components/QueryError";
import { BinDetailDialog } from "@/components/BinDetailDialog";
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
import { AdminPasswordField } from "@/components/AdminPasswordField";
import { useAdminGate } from "@/hooks/useAdminGate";
import {
  CROPS,
  bushelWeight,
  fmtLbs,
  type Crop,
} from "@contracts/grain";
import type { BinRow } from "@contracts/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtBuInput(n: number): string {
  return String(Math.round(n * 10) / 10);
}

function fmtBuLive(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function fillTextClass(pct: number): string {
  if (pct > 90) return "text-crit";
  if (pct >= 70) return "text-go";
  return "text-stable";
}

/**
 * Bushel <-> lbs capacity converter. Operator can type bushels (converted
 * live using the crop's standard bushel weight) or lbs directly; both fields
 * stay in sync. `capacityLbs` is the parsed positive integer lbs, or null.
 */
function useCapacityConverter(crop: string, initialLbs?: number) {
  const weight = bushelWeight(crop);
  const [bu, setBu] = useState(() =>
    initialLbs != null ? fmtBuInput(initialLbs / weight) : "",
  );
  const [lbs, setLbs] = useState(() =>
    initialLbs != null ? String(initialLbs) : "",
  );

  // When the crop changes, the lb/bu factor changes — re-derive lbs from bu.
  const [prevWeight, setPrevWeight] = useState(weight);
  if (prevWeight !== weight) {
    setPrevWeight(weight);
    const n = Number(bu);
    if (bu.trim() !== "" && Number.isFinite(n)) {
      setLbs(n > 0 ? String(Math.round(n * weight)) : "");
    }
  }

  const onBuChange = (v: string) => {
    setBu(v);
    const n = Number(v);
    setLbs(v.trim() !== "" && Number.isFinite(n) && n > 0 ? String(Math.round(n * weight)) : "");
  };

  const onLbsChange = (v: string) => {
    setLbs(v);
    const n = Number(v);
    setBu(v.trim() !== "" && Number.isFinite(n) && n > 0 ? fmtBuInput(n / weight) : "");
  };

  const lbsNum = Number(lbs);
  const capacityLbs =
    lbs.trim() !== "" && Number.isFinite(lbsNum) && lbsNum > 0
      ? Math.round(lbsNum)
      : null;

  return { bu, lbs, weight, capacityLbs, onBuChange, onLbsChange };
}

function CapacityFields({
  converter,
}: {
  converter: ReturnType<typeof useCapacityConverter>;
}) {
  const { bu, lbs, weight, capacityLbs, onBuChange, onLbsChange } = converter;
  const buNum = Number(bu);
  const showConversion =
    bu.trim() !== "" && Number.isFinite(buNum) && buNum > 0 && capacityLbs != null;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="capacity-bu">Capacity (bushels)</Label>
          <Input
            id="capacity-bu"
            inputMode="decimal"
            placeholder="25,000"
            value={bu}
            onChange={(e) => onBuChange(e.target.value)}
            className="font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="capacity-lbs">Capacity (lbs)</Label>
          <Input
            id="capacity-lbs"
            inputMode="numeric"
            placeholder="1,400,000"
            value={lbs}
            onChange={(e) => onLbsChange(e.target.value)}
            className="font-mono"
          />
        </div>
      </div>
      <p className="font-mono text-xs text-muted-foreground">
        {showConversion ? (
          <>
            {fmtBuLive(buNum)} bu × {weight} lb/bu ={" "}
            <span className="text-foreground">{fmtLbs(capacityLbs)} lb</span>
          </>
        ) : (
          <>Enter bushels (converted at {weight} lb/bu) or lbs directly.</>
        )}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function AddBinDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const utils = trpc.useUtils();
  const { siteId: activeSiteId } = useSite();
  const sitesQuery = trpc.core.sites.list.useQuery();
  const sites = sitesQuery.data ?? [];

  const [siteId, setSiteId] = useState<string>(
    () => (activeSiteId != null ? String(activeSiteId) : ""),
  );
  const [name, setName] = useState("");
  const [crop, setCrop] = useState<Crop>("Corn");
  const capacity = useCapacityConverter(crop);
  const [adminPassword, setAdminPassword] = useState("");
  const { passwordRequired } = useAdminGate();

  const createBin = trpc.core.bins.create.useMutation({
    onSuccess: async () => {
      toast.success(`Bin "${name.trim()}" added`);
      onOpenChange(false);
      await Promise.all([
        utils.core.bins.list.invalidate(),
        utils.core.sites.list.invalidate(),
      ]);
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    const siteIdNum = Number(siteId);
    if (!siteId || !Number.isFinite(siteIdNum)) {
      toast.error("Pick a site first");
      return;
    }
    if (!name.trim()) {
      toast.error("Bin name is required");
      return;
    }
    if (capacity.capacityLbs == null) {
      toast.error("Enter a valid capacity");
      return;
    }
    if (passwordRequired && !adminPassword) {
      toast.error("Admin password is required to add a bin");
      return;
    }
    createBin.mutate({
      adminPassword,
      siteId: siteIdNum,
      name: name.trim(),
      crop,
      capacityLbs: capacity.capacityLbs,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add bin</DialogTitle>
          <DialogDescription>
            Capacity can be entered in bushels — it converts to lbs using the
            crop's standard bushel weight.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Site</Label>
            <Select value={siteId} onValueChange={setSiteId}>
              <SelectTrigger aria-label="Site">
                <SelectValue placeholder="Select site…" />
              </SelectTrigger>
              <SelectContent>
                {sites.map((site) => (
                  <SelectItem key={site.id} value={String(site.id)}>
                    {site.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {sites.length === 0 && !sitesQuery.isPending && (
              <p className="text-xs text-muted-foreground">
                No sites yet — add a site first.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bin-name">Name</Label>
              <Input
                id="bin-name"
                placeholder="Bin 1"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Crop</Label>
              <Select value={crop} onValueChange={(v) => setCrop(v as Crop)}>
                <SelectTrigger aria-label="Crop">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CROPS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <CapacityFields converter={capacity} />
          <AdminPasswordField
            id="add-bin-password"
            value={adminPassword}
            onChange={setAdminPassword}
            hint="Adding a bin requires the site admin password."
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={createBin.isPending || sites.length === 0}
          >
            {createBin.isPending ? "Adding…" : "Add bin"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditBinDialog({
  bin,
  onClose,
}: {
  bin: BinRow;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(bin.name);
  const [crop, setCrop] = useState<Crop>(
    (CROPS as readonly string[]).includes(bin.crop) ? (bin.crop as Crop) : "Corn",
  );
  const capacity = useCapacityConverter(crop, bin.capacityLbs);
  const [adminPassword, setAdminPassword] = useState("");
  const { passwordRequired } = useAdminGate();

  const updateBin = trpc.core.bins.update.useMutation({
    onSuccess: async () => {
      toast.success(`Bin "${name.trim()}" updated`);
      onClose();
      await utils.core.bins.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    if (!name.trim()) {
      toast.error("Bin name is required");
      return;
    }
    if (capacity.capacityLbs == null) {
      toast.error("Enter a valid capacity");
      return;
    }
    if (passwordRequired && !adminPassword) {
      toast.error("Admin password is required to edit a bin");
      return;
    }
    updateBin.mutate({
      adminPassword,
      id: bin.id,
      name: name.trim(),
      crop,
      capacityLbs: capacity.capacityLbs,
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit bin — {bin.name}</DialogTitle>
          <DialogDescription>
            Rename, change the crop, or resize the bin.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-bin-name">Name</Label>
              <Input
                id="edit-bin-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Crop</Label>
              <Select value={crop} onValueChange={(v) => setCrop(v as Crop)}>
                <SelectTrigger aria-label="Crop">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CROPS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <CapacityFields converter={capacity} />
          {bin.currentLbs > 0 && capacity.capacityLbs != null && (
            <p
              className={cn(
                "font-mono text-xs",
                capacity.capacityLbs < bin.currentLbs
                  ? "text-crit"
                  : "text-muted-foreground",
              )}
            >
              Currently holding {fmtLbs(bin.currentLbs)} lb
              {capacity.capacityLbs < bin.currentLbs
                ? " — new capacity is below the current level"
                : ""}
            </p>
          )}
          <AdminPasswordField
            id="edit-bin-password"
            value={adminPassword}
            onChange={setAdminPassword}
            hint="Editing a bin requires the site admin password."
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={updateBin.isPending}>
            {updateBin.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdjustLevelDialog({
  bin,
  onClose,
}: {
  bin: BinRow;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [value, setValue] = useState(String(bin.currentLbs));
  const [reason, setReason] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const { passwordRequired } = useAdminGate();

  const adjust = trpc.core.bins.adjust.useMutation({
    onSuccess: async () => {
      toast.success(`${bin.name} level set to ${fmtLbs(Number(value))} lb`);
      onClose();
      await utils.core.bins.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    const n = Number(value);
    if (value.trim() === "" || !Number.isFinite(n) || n < 0) {
      toast.error("Enter a valid non-negative level in lbs");
      return;
    }
    if (reason.trim().length < 3) {
      toast.error("A reason is required — level corrections are audited");
      return;
    }
    if (passwordRequired && !adminPassword) {
      toast.error("Admin password is required to adjust a bin level");
      return;
    }
    adjust.mutate({
      adminPassword,
      id: bin.id,
      currentLbs: Math.round(n),
      reason: reason.trim(),
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adjust level — {bin.name}</DialogTitle>
          <DialogDescription>
            Set the bin contents to a physical measurement. Normally inventory
            moves automatically with weight sheets — use this only to correct
            drift.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="adjust-lbs">Current contents (lbs)</Label>
          <Input
            id="adjust-lbs"
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="font-mono"
            autoFocus
          />
          <p className="font-mono text-xs text-muted-foreground">
            Capacity: {fmtLbs(bin.capacityLbs)} lb
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="adjust-reason">Reason</Label>
            <Input
              id="adjust-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. physical tape measurement 2026-06-14"
            />
            <p className="text-xs text-muted-foreground">
              Required — the correction is written to the audit log and the
              provenance ledger.
            </p>
          </div>
          <AdminPasswordField
            id="adjust-bin-password"
            value={adminPassword}
            onChange={setAdminPassword}
            hint="Level corrections move inventory — they require the site admin password."
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={adjust.isPending}>
            {adjust.isPending ? "Saving…" : "Set level"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteBinDialog({
  bin,
  onClose,
}: {
  bin: BinRow;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [adminPassword, setAdminPassword] = useState("");
  const { passwordRequired } = useAdminGate();

  const deleteBin = trpc.core.bins.delete.useMutation({
    onSuccess: async () => {
      toast.success(`Bin "${bin.name}" deleted`);
      onClose();
      await utils.core.bins.list.invalidate();
    },
    // Backend refuses when the bin is not empty or has load history.
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    if (passwordRequired && !adminPassword) {
      toast.error("Admin password is required to delete a bin");
      return;
    }
    deleteBin.mutate({ adminPassword, id: bin.id });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete bin — {bin.name}?</DialogTitle>
          <DialogDescription>
            Only empty bins with no load history can be deleted. This cannot be
            undone.
          </DialogDescription>
        </DialogHeader>
        {bin.currentLbs > 0 && (
          <p className="font-mono text-xs text-crit">
            This bin still holds {fmtLbs(bin.currentLbs)} lb — the server will
            refuse to delete it.
          </p>
        )}
        <AdminPasswordField
          id="delete-bin-password"
          value={adminPassword}
          onChange={setAdminPassword}
          hint="Deleting a bin requires the site admin password."
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={deleteBin.isPending}>
            {deleteBin.isPending ? "Deleting…" : "Delete bin"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Bin card
// ---------------------------------------------------------------------------

/**
 * Vertical bin silhouette with the grain level drawn in — a picture of the
 * bin, filled from the bottom, with the fill % on a chip. Over-capacity
 * shows a red band at the top of the bin.
 */
function BinGlyph({ fillPct, crop }: { fillPct: number; crop: string }) {
  const clamped = Math.min(100, Math.max(0, fillPct));
  const over = fillPct > 100;
  return (
    <div
      className="relative h-28 w-16 flex-none overflow-hidden rounded-b-lg rounded-t-[2rem] border-2 border-border bg-muted/40"
      title={`${crop} bin — ${fillPct.toFixed(1)}% full`}
    >
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 transition-[height] duration-500",
          cropFillClass(crop),
        )}
        style={{ height: `${clamped}%` }}
      >
        {/* grain surface */}
        <div className="h-0.5 w-full bg-foreground/25" />
      </div>
      {over && <div className="absolute inset-x-0 top-0 h-1.5 bg-crit" />}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="rounded bg-background/85 px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums text-foreground">
          {Math.round(fillPct)}%
        </span>
      </div>
    </div>
  );
}

function BinCard({
  bin,
  onDetail,
  onEdit,
  onAdjust,
  onDelete,
}: {
  bin: BinRow;
  onDetail: () => void;
  onEdit: () => void;
  onAdjust: () => void;
  onDelete: () => void;
}) {
  const pct =
    bin.capacityLbs > 0 ? (bin.currentLbs / bin.capacityLbs) * 100 : 0;
  const bu = bin.currentLbs / bushelWeight(bin.crop);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0 pb-3">
        <div className="min-w-0">
          <CardTitle className="truncate text-base">{bin.name}</CardTitle>
          <div className="mt-1.5">
            <Badge
              variant="outline"
              className={cn("font-mono text-[10px] uppercase", cropBadgeClass(bin.crop))}
            >
              {bin.crop}
            </Badge>
          </div>
        </div>
        <div className="flex flex-none items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            title="Bin detail — lot composition & movement history"
            aria-label="Bin detail — lot composition & movement history"
            onClick={onDetail}
          >
            <History className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Edit bin"
            aria-label="Edit bin"
            onClick={onEdit}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Adjust level (physical measurement)"
            aria-label="Adjust level (physical measurement)"
            onClick={onAdjust}
          >
            <Gauge className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Delete bin"
            aria-label="Delete bin"
            onClick={onDelete}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex gap-4 space-y-0">
        <BinGlyph fillPct={pct} crop={bin.crop} />
        <div className="flex min-w-0 flex-1 flex-col justify-between py-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className={cn("font-mono text-2xl font-bold tabular-nums", fillTextClass(pct))}>
              {pct.toFixed(1)}%
            </span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {fmtBuLive(bu)} bu
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2 font-mono text-xs tabular-nums">
            <span className="text-foreground">{fmtLbs(bin.currentLbs)} lb</span>
            <span className="text-muted-foreground">
              / {fmtLbs(bin.capacityLbs)} lb
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Bins() {
  const { siteId } = useSite();
  const sitesQuery = trpc.core.sites.list.useQuery();
  const binsQuery = trpc.core.bins.list.useQuery(
    { siteId: siteId ?? undefined },
    { enabled: siteId != null },
  );

  const [binDialogOpen, setBinDialogOpen] = useState(false);
  const [detailBin, setDetailBin] = useState<BinRow | null>(null);
  const [editBin, setEditBin] = useState<BinRow | null>(null);
  const [adjustBin, setAdjustBin] = useState<BinRow | null>(null);
  const [deleteBin, setDeleteBin] = useState<BinRow | null>(null);

  const sites = useMemo(() => sitesQuery.data ?? [], [sitesQuery.data]);
  const bins = useMemo(() => binsQuery.data ?? [], [binsQuery.data]);
  const loading = sitesQuery.isPending || (siteId != null && binsQuery.isPending);

  const stats = useMemo(() => {
    const capacity = bins.reduce((sum, b) => sum + b.capacityLbs, 0);
    const current = bins.reduce((sum, b) => sum + b.currentLbs, 0);
    const fillPct = capacity > 0 ? (current / capacity) * 100 : 0;
    return { capacity, current, fillPct, count: bins.length };
  }, [bins]);

  // Everything on this page belongs to the active location; only bins whose
  // site no longer exists fall into the catch-all bucket.
  const groups = useMemo(() => {
    const active = sites.find((s) => s.id === siteId) ?? null;
    const siteBins = active ? bins.filter((b) => b.siteId === active.id) : [];
    const unassigned = active ? bins.filter((b) => b.siteId !== active.id) : [...bins];
    return { active, siteBins, unassigned };
  }, [sites, bins, siteId]);

  const isEmpty = !loading && sites.length === 0;

  return (
    <div className="space-y-6">
      {/* ---- Header stats + actions ------------------------------------ */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <div className="gt-eyebrow">Total capacity</div>
              {loading ? (
                <Skeleton className="mt-2 h-7 w-24" />
              ) : (
                <div className="mt-1 font-mono text-xl font-bold tabular-nums">
                  {fmtLbs(stats.capacity)}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">lb</span>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="gt-eyebrow">On hand</div>
              {loading ? (
                <Skeleton className="mt-2 h-7 w-24" />
              ) : (
                <div className="mt-1 font-mono text-xl font-bold tabular-nums">
                  {fmtLbs(stats.current)}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">lb</span>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="gt-eyebrow">Overall fill</div>
              {loading ? (
                <Skeleton className="mt-2 h-7 w-16" />
              ) : (
                <div
                  className={cn(
                    "mt-1 font-mono text-xl font-bold tabular-nums",
                    fillTextClass(stats.fillPct),
                  )}
                >
                  {stats.fillPct.toFixed(1)}%
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="gt-eyebrow">Bins</div>
              {loading ? (
                <Skeleton className="mt-2 h-7 w-10" />
              ) : (
                <div className="mt-1 font-mono text-xl font-bold tabular-nums">
                  {stats.count}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="flex flex-none gap-2">
          <Button onClick={() => setBinDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add bin
          </Button>
        </div>
      </div>

      {/* ---- Body ------------------------------------------------------- */}
      {(sitesQuery.isError || binsQuery.isError) && (
        <QueryError
          title="Bins failed to load"
          message={(sitesQuery.error ?? binsQuery.error)?.message}
          onRetry={() => {
            void sitesQuery.refetch();
            void binsQuery.refetch();
          }}
          retrying={sitesQuery.isRefetching || binsQuery.isRefetching}
        />
      )}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      ) : isEmpty ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Warehouse className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Add your first site in Site admin (sidebar), then add bins here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {groups.active ? (
            <section className="space-y-3">
              <div className="flex items-baseline gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-widest">
                  {groups.active.name}
                </h2>
                {groups.active.location && (
                  <span className="text-xs text-muted-foreground">
                    {groups.active.location}
                  </span>
                )}
                <span className="font-mono text-xs text-muted-foreground">
                  {groups.siteBins.length} bin{groups.siteBins.length === 1 ? "" : "s"}
                </span>
              </div>
              {groups.siteBins.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No bins at this location yet — add the first one.
                </p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {groups.siteBins.map((bin) => (
                    <BinCard
                      key={bin.id}
                      bin={bin}
                      onDetail={() => setDetailBin(bin)}
                      onEdit={() => setEditBin(bin)}
                      onAdjust={() => setAdjustBin(bin)}
                      onDelete={() => setDeleteBin(bin)}
                    />
                  ))}
                </div>
              )}
            </section>
          ) : (
            <p className="text-sm text-muted-foreground">
              No active location — switch locations in the header.
            </p>
          )}
          {groups.unassigned.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-widest">
                Unassigned
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {groups.unassigned.map((bin) => (
                  <BinCard
                    key={bin.id}
                    bin={bin}
                    onDetail={() => setDetailBin(bin)}
                    onEdit={() => setEditBin(bin)}
                    onAdjust={() => setAdjustBin(bin)}
                    onDelete={() => setDeleteBin(bin)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* ---- Dialogs ----------------------------------------------------- */}
      {/* key remounts the dialog so stale form state never leaks between opens */}
      {binDialogOpen && (
        <AddBinDialog key="add-bin" open onOpenChange={setBinDialogOpen} />
      )}
      {detailBin && (
        <BinDetailDialog bin={detailBin} onClose={() => setDetailBin(null)} />
      )}
      {editBin && (
        <EditBinDialog key={editBin.id} bin={editBin} onClose={() => setEditBin(null)} />
      )}
      {adjustBin && (
        <AdjustLevelDialog bin={adjustBin} onClose={() => setAdjustBin(null)} />
      )}
      {deleteBin && (
        <DeleteBinDialog bin={deleteBin} onClose={() => setDeleteBin(null)} />
      )}
    </div>
  );
}

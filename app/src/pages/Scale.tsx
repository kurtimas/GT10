import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, CloudOff } from "lucide-react";

import { trpc } from "@shared/src/lib/trpc";
import { cn, cropBadgeClass } from "@shared/src/lib/utils";
import { useScale, type UseScale } from "@/hooks/useScale";
import { useWeighQueue, isNetworkError } from "@/providers/weighQueue";
import { toast } from "@shared/src/components/ui/sonner";
import { Alert, AlertDescription, AlertTitle } from "@shared/src/components/ui/alert";
import { QueryError } from "@shared/src/components/QueryError";
import { GradesDialog } from "@/components/GradesDialog";
import { Badge } from "@shared/src/components/ui/badge";
import { Button } from "@shared/src/components/ui/button";
import { Card, CardContent, CardHeader } from "@shared/src/components/ui/card";
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
import { Slider } from "@shared/src/components/ui/slider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@shared/src/components/ui/table";

import { fmtBu, fmtLbs } from "@contracts/grain";
import type { BinRow, LoadRow, SheetRow } from "@contracts/types";

const SIM_MIN_LBS = 1_000;
const SIM_MAX_LBS = 120_000;
const SIM_STEP_LBS = 500;

/* ------------------------------------------------------------------ */
/* Scale readout panel                                                 */
/* ------------------------------------------------------------------ */

interface ScalePanelProps {
  scale: UseScale;
  /** Effective weight shown on the readout (live reading wins over manual). */
  weightLbs: number | null;
  onManualLbs: (lbs: number | null) => void;
  /** Sheet whose weigh console is open — captures below belong to it. */
  boundSheet: SheetRow | null;
  /** True when opened from /scale with no sheet — readings go nowhere. */
  standalone?: boolean;
}

function ScalePanel({ scale, weightLbs, onManualLbs, boundSheet, standalone }: ScalePanelProps) {
  const [simBase, setSimBase] = useState(45_000);
  const [manualText, setManualText] = useState("");

  const applyManual = () => {
    const n = Number.parseInt(manualText.replace(/,/g, ""), 10);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Enter a weight in whole pounds (e.g. 45230).");
      return;
    }
    onManualLbs(n);
    setManualText("");
    toast.success(`Manual weight set — ${fmtLbs(n)} lb`);
  };

  const hasReading = weightLbs != null;
  const readoutColor = !hasReading
    ? "text-sidebar-foreground/40"
    : scale.stable
      ? "text-stable"
      : "text-live";

  const source = scale.connected
    ? "USB scale"
    : scale.simulator.active
      ? "Simulator"
      : hasReading
        ? "Manual entry"
        : "No source";

  return (
    <Card className="gt-panel">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <p className="gt-eyebrow">Scale readout</p>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "gt-led",
              hasReading && (scale.stable ? "gt-led-on" : "gt-led-live"),
            )}
          />
          <span
            className={cn(
              "font-mono text-xs font-semibold uppercase tracking-widest",
              !hasReading
                ? "text-muted-foreground"
                : scale.stable
                  ? "text-stable"
                  : "text-live",
            )}
          >
            {!hasReading ? "NO SIGNAL" : scale.stable ? "STABLE" : "LIVE"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="gt-scan rounded-md border border-border bg-readout px-6 py-5">
          <div
            className={cn(
              "font-mono text-5xl font-bold tabular-nums tracking-tight md:text-6xl",
              readoutColor,
            )}
          >
            {hasReading ? fmtLbs(weightLbs) : "———"}
            <span className="ml-2 text-xl font-medium text-sidebar-foreground/60">lb</span>
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-sidebar-foreground/60">
            {source}
            {scale.simulator.active ? ` · base ${fmtLbs(simBase)} lb` : ""}
          </div>
        </div>

        {boundSheet ? (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-live/40 bg-live/10 px-3 py-2">
            <span className="flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-widest text-live">
              <span className="gt-led gt-led-warn" />
              Weighing for {boundSheet.ticketNo}
            </span>
            <span className="truncate text-xs font-semibold">
              {boundSheet.farmerName ?? "—"}
              {boundSheet.lotCode ? ` · ${boundSheet.lotCode}` : ""} · {boundSheet.crop}
            </span>
          </div>
        ) : standalone ? (
          <p className="font-mono text-[11px] text-muted-foreground">
            Standalone scale — readings here are not recorded to a weight sheet.
          </p>
        ) : (
          <p className="font-mono text-[11px] text-muted-foreground">Loading sheet…</p>
        )}

        {!scale.supported && (
          <Alert>
            <AlertTitle>USB scale not available in this browser</AlertTitle>
            <AlertDescription>
              Web Serial requires Chrome or Edge served over HTTPS or localhost. Use the
              simulator or manual entry below until then.
            </AlertDescription>
          </Alert>
        )}
        {scale.error && (
          <Alert variant="destructive">
            <AlertTitle>Scale error</AlertTitle>
            <AlertDescription>{scale.error}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {scale.supported &&
            (scale.connected ? (
              <Button variant="outline" onClick={() => void scale.disconnect()}>
                Disconnect scale
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={scale.connecting}
                onClick={() => void scale.connect()}
              >
                {scale.connecting ? "Connecting…" : "Connect USB scale"}
              </Button>
            ))}
          <Button
            variant={scale.simulator.active ? "secondary" : "outline"}
            onClick={() =>
              scale.simulator.active ? scale.simulator.stop() : scale.simulator.start()
            }
          >
            <span className="gt-node" data-on={scale.simulator.active} />
            Simulator
          </Button>
          <Badge variant="outline" className="font-mono">
            {scale.connected ? "SCALE LINKED" : scale.connecting ? "LINKING…" : "SCALE OFFLINE"}
          </Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="sim-base">Simulator base</Label>
              <span className="font-mono text-xs text-muted-foreground">
                {fmtLbs(simBase)} lb
              </span>
            </div>
            <Slider
              id="sim-base"
              min={SIM_MIN_LBS}
              max={SIM_MAX_LBS}
              step={SIM_STEP_LBS}
              value={[simBase]}
              onValueChange={(v) => {
                const n = v[0] ?? simBase;
                setSimBase(n);
                scale.simulator.setBaseLbs(n);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-weight">Manual entry (lb)</Label>
            <div className="flex gap-2">
              <Input
                id="manual-weight"
                inputMode="numeric"
                placeholder="e.g. 45230"
                className="font-mono"
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyManual();
                }}
              />
              <Button variant="secondary" onClick={applyManual}>
                Set
              </Button>
              {source === "Manual entry" && (
                <Button variant="ghost" onClick={() => onManualLbs(null)}>
                  Clear
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Weigh console — truck, destination bin, capture buttons             */
/* ------------------------------------------------------------------ */

interface WeighConsoleProps {
  sheet: SheetRow;
  weightLbs: number | null;
  onChanged: () => void;
}

function WeighConsole({ sheet, weightLbs, onChanged }: WeighConsoleProps) {
  const [truckId, setTruckId] = useState(sheet.lastTruckId ?? "");
  const [driverName, setDriverName] = useState("");
  const [binChoice, setBinChoice] = useState("auto");
  const { enqueue } = useWeighQueue();

  // Destination bin picker — bins at this sheet's location, matching crop
  // first, then least-filled (mirrors the server's auto-pick order).
  const binsQ = trpc.core.bins.list.useQuery(
    { siteId: sheet.siteId },
    { staleTime: 30_000 },
  );
  const siteBins = useMemo(() => {
    const fill = (b: BinRow) =>
      b.capacityLbs > 0 ? b.currentLbs / b.capacityLbs : 0;
    return [...(binsQ.data ?? [])].sort((a, b) => {
      const am = a.crop === sheet.crop ? 0 : 1;
      const bm = b.crop === sheet.crop ? 0 : 1;
      if (am !== bm) return am - bm;
      return fill(a) - fill(b);
    });
  }, [binsQ.data, sheet.crop]);
  const chosenBinId = binChoice !== "auto" ? Number(binChoice) : undefined;
  const binSelect = (
    <div className="space-y-1">
      <Label>Destination bin</Label>
      {binsQ.isError && (
        <QueryError
          title="Bins failed to load"
          message={binsQ.error.message}
          onRetry={() => void binsQ.refetch()}
          retrying={binsQ.isRefetching}
        />
      )}
      <Select value={binChoice} onValueChange={setBinChoice}>
        <SelectTrigger className="h-8 font-mono text-xs" aria-label="Destination bin">
          <SelectValue placeholder="Auto" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto" className="font-mono text-xs">
            Auto — least-filled {sheet.crop} bin
          </SelectItem>
          {siteBins.map((b) => (
            <SelectItem key={b.id} value={String(b.id)} className="font-mono text-xs">
              {b.name} — {b.crop}
              {b.capacityLbs > 0
                ? ` · ${Math.round((b.currentLbs / b.capacityLbs) * 100)}% full`
                : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {siteBins.length === 0 && !binsQ.isPending && (
        <p className="font-mono text-[11px] text-muted-foreground">
          No bins at this location — loads stay unassigned.
        </p>
      )}
      {binChoice === "auto" && sheet.activeLoad?.binId != null && (
        <p className="font-mono text-[11px] text-muted-foreground">
          Picked at weigh-in:{" "}
          {siteBins.find((b) => b.id === sheet.activeLoad?.binId)?.name ??
            `bin #${sheet.activeLoad.binId}`}
        </p>
      )}
    </div>
  );

  const weighFirst = trpc.sheets.weighFirst.useMutation({
    onSuccess: (data, vars) => {
      toast.success(`Load #${data.loadNo} weighed in — ${fmtLbs(vars.weightLbs)} lb`);
      onChanged();
    },
    onError: (err, vars) => {
      if (isNetworkError(err)) {
        // offline: queue the weigh-in — replayed in order when the server is back
        enqueue("weighFirst", { ...vars }, `${sheet.ticketNo} · truck ${vars.truckId} (weigh in)`);
        toast.warning("No connection — weigh-in queued", {
          description: `${sheet.ticketNo} · ${vars.truckId} · ${fmtLbs(vars.weightLbs)} lb. It sends automatically when the server is back.`,
          duration: 10_000,
        });
        return;
      }
      toast.error(err.message);
    },
  });
  const weighSecond = trpc.sheets.weighSecond.useMutation({
    onSuccess: (data) => {
      toast.success(
        `Load complete — net ${fmtLbs(data.netLbs)} lb · ${fmtBu(data.netBushels)} bu`,
        {
          description: data.sheetFull
            ? `Sheet is FULL (${sheet.maxLoads}/${sheet.maxLoads} loads)`
            : undefined,
        },
      );
      onChanged();
    },
    onError: (err, vars) => {
      if (isNetworkError(err)) {
        enqueue("weighSecond", { ...vars }, `${sheet.ticketNo} · truck ${sheet.activeLoad?.truckId ?? "?"} (weigh out)`);
        toast.warning("No connection — weigh-out queued", {
          description: `${sheet.ticketNo} · ${fmtLbs(vars.weightLbs)} lb. It sends automatically when the server is back.`,
          duration: 10_000,
        });
        return;
      }
      toast.error(err.message);
    },
  });

  const outbound = sheet.direction === "OUTBOUND";
  const active = sheet.activeLoad;
  const busy = weighFirst.isPending || weighSecond.isPending;
  const canWeigh = weightLbs != null && weightLbs > 0 && !busy;

  return (
    <Card className="gt-panel">
      <CardHeader className="pb-3">
        <p className="gt-eyebrow">
          {active ? "Weigh out — truck on the lot" : "Weigh in — next load"}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          <span className="font-semibold">{sheet.farmerName ?? "—"}</span>
          {sheet.lotCode && (
            <span className="font-mono text-xs text-muted-foreground">{sheet.lotCode}</span>
          )}
          <Badge
            variant="outline"
            className={cn("font-mono text-[10px] uppercase", cropBadgeClass(sheet.crop))}
          >
            {sheet.crop}
          </Badge>
        </div>

        <Separator />

        {active == null ? (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor={`truck-${sheet.id}`}>Truck ID</Label>
                <Input
                  id={`truck-${sheet.id}`}
                  className="h-8 font-mono"
                  placeholder="e.g. TRK-14"
                  value={truckId}
                  onChange={(e) => setTruckId(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`driver-${sheet.id}`}>Driver</Label>
                <Input
                  id={`driver-${sheet.id}`}
                  className="h-8"
                  placeholder="Driver name"
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                />
              </div>
            </div>
            <Button
              className="h-14 w-full bg-go text-lg font-bold hover:bg-go/90"
              disabled={!canWeigh}
              onClick={() => {
                if (weightLbs == null || weightLbs <= 0) return;
                const truck = truckId.trim();
                if (!truck) {
                  toast.error("Enter a truck ID — tare memory and duplicate-truck checks key on it.");
                  return;
                }
                weighFirst.mutate({
                  id: sheet.id,
                  weightLbs,
                  truckId: truck,
                  driverName: driverName.trim() || undefined,
                  binId: chosenBinId,
                });
              }}
            >
              {outbound ? "WEIGH IN (EMPTY)" : "WEIGH IN"}
              {weightLbs != null ? ` — ${fmtLbs(weightLbs)} lb` : ""}
            </Button>
            {binSelect}
          </>
        ) : (
          <>
            <CapturedStrip load={active} outbound={outbound} />
            {binSelect}
            <Button
              className="h-14 w-full text-lg font-bold"
              disabled={!canWeigh}
              onClick={() => {
                if (weightLbs == null || weightLbs <= 0) return;
                weighSecond.mutate({ id: sheet.id, weightLbs, binId: chosenBinId });
              }}
            >
              WEIGH OUT{weightLbs != null ? ` — ${fmtLbs(weightLbs)} lb` : ""}
            </Button>
          </>
        )}
        {weightLbs == null || weightLbs <= 0 ? (
          <p className="font-mono text-[11px] text-muted-foreground">
            No weight on the scale — connect, start the simulator, or use manual entry.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CapturedStrip({ load, outbound }: { load: LoadRow; outbound: boolean }) {
  const firstLbs = outbound ? load.tareLbs : load.grossLbs;
  return (
    <div className="gt-scan flex items-center justify-between rounded-md border border-border bg-readout px-4 py-3">
      <span className="gt-eyebrow">
        {outbound ? "Tare captured" : "Gross captured"}
        {load.truckId ? ` · ${load.truckId}` : ""}
      </span>
      <span className="font-mono text-xl font-semibold tabular-nums text-live">
        {fmtLbs(firstLbs)} lb
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sheet summary card                                                  */
/* ------------------------------------------------------------------ */

function SheetSummary({ sheet }: { sheet: SheetRow }) {
  const active = sheet.activeLoad;
  const since = active
    ? new Date(active.grossAt ?? active.tareAt ?? active.createdAt).toLocaleTimeString(
        "en-US",
        { hour12: false },
      )
    : null;
  return (
    <Card className="gt-panel">
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
        <span className="font-mono text-2xl font-black tabular-nums text-primary">
          {sheet.ticketNo}
        </span>
        <Badge
          variant="outline"
          className={cn(
            "font-mono",
            sheet.direction === "OUTBOUND"
              ? "border-primary/60 text-primary"
              : "border-live/60 text-live",
          )}
        >
          {sheet.direction}
        </Badge>
        <span className="text-base font-semibold">{sheet.farmerName ?? "—"}</span>
        {sheet.lotCode && (
          <span className="font-mono text-xs text-muted-foreground">{sheet.lotCode}</span>
        )}
        <Badge
          variant="outline"
          className={cn("font-mono text-[10px] uppercase", cropBadgeClass(sheet.crop))}
        >
          {sheet.crop}
        </Badge>
        {active && (
          <Badge
            variant="outline"
            className="border-live/60 font-mono text-[10px] uppercase tracking-wider text-live"
            title={`On the lot since ${since}`}
          >
            <span className="gt-led gt-led-warn mr-1.5" />
            On the lot{active.truckId ? ` · ${active.truckId}` : ""}
          </Badge>
        )}
        <span className="ml-auto flex items-center gap-3">
          <span className="font-mono text-xs text-muted-foreground">
            {sheet.completedLoads}/{sheet.maxLoads} loads
          </span>
          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
            <span
              className="block h-full rounded-full bg-primary transition-[width] duration-500"
              style={{
                width: `${Math.min(100, (sheet.completedLoads / sheet.maxLoads) * 100)}%`,
              }}
            />
          </span>
        </span>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Loads already recorded on this sheet                                */
/* ------------------------------------------------------------------ */

/** Time a load finished weighing (second capture), or started if mid-weigh. */
function loadTimeOf(l: LoadRow, outbound: boolean): Date {
  return (outbound ? l.grossAt ?? l.tareAt : l.tareAt ?? l.grossAt) ?? l.createdAt;
}

function SheetLoadsCard({ sheet }: { sheet: SheetRow }) {
  const [gradesLoad, setGradesLoad] = useState<LoadRow | null>(null);
  const outbound = sheet.direction === "OUTBOUND";
  // Newest first — the operator's eye lands on the most recent load.
  const loads = [...(sheet.loads ?? [])].sort((a, b) => b.loadNo - a.loadNo);
  const done = loads.filter((l) => l.netLbs != null);
  const totalNet = done.reduce((a, l) => a + (l.netLbs ?? 0), 0);
  const totalBu = done.reduce((a, l) => a + (l.netBushels ?? 0), 0);

  return (
    <Card className="gt-panel">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <p className="gt-eyebrow">Loads on this sheet</p>
        {done.length > 0 && (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {done.length} complete · {fmtLbs(totalNet)} lb · {fmtBu(totalBu)} bu
          </span>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Load</TableHead>
              <TableHead>Truck</TableHead>
              <TableHead>Time</TableHead>
              <TableHead className="text-right">Gross lb</TableHead>
              <TableHead className="text-right">Tare lb</TableHead>
              <TableHead className="text-right">Net lb</TableHead>
              <TableHead className="text-right">Net bu</TableHead>
              <TableHead className="text-right">Bin</TableHead>
              <TableHead className="text-right">Grades</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loads.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="py-6 text-center text-sm text-muted-foreground"
                >
                  No loads yet — the first weigh-in will appear here.
                </TableCell>
              </TableRow>
            ) : (
              loads.map((l) => {
                const midWeigh = l.netLbs == null;
                return (
                  <TableRow key={l.id} className={midWeigh ? "bg-live/5" : undefined}>
                    <TableCell className="font-mono text-xs font-semibold tabular-nums">
                      {l.loadNo}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {l.truckId ?? "—"}
                      {midWeigh && (
                        <Badge
                          variant="outline"
                          className="ml-2 border-live/60 font-mono text-[10px] uppercase tracking-wider text-live"
                        >
                          on the lot
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                      {loadTimeOf(l, outbound).toLocaleTimeString("en-US", { hour12: false })}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {l.grossLbs != null ? fmtLbs(l.grossLbs) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {l.tareLbs != null ? fmtLbs(l.tareLbs) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">
                      {midWeigh ? "—" : fmtLbs(l.netLbs ?? 0)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {l.netBushels != null ? fmtBu(l.netBushels) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {l.binName ?? (l.binId != null ? `#${l.binId}` : "—")}
                    </TableCell>
                    <TableCell className="text-right">
                      {!midWeigh && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 font-mono text-[10px]"
                          onClick={() => setGradesLoad(l)}
                        >
                          {l.moisturePct != null || l.grade != null ? "Grades" : "+ Grade"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
      {gradesLoad && (
        <GradesDialog
          key={gradesLoad.id}
          load={gradesLoad}
          crop={sheet.crop}
          open
          onOpenChange={(o) => !o && setGradesLoad(null)}
        />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Scale page — /scale (standalone) or /scale/:sheetId                 */
/* ------------------------------------------------------------------ */

export default function Scale() {
  const { sheetId } = useParams();
  const id = sheetId != null && /^\d+$/.test(sheetId) ? Number(sheetId) : null;

  const scale = useScale();
  const [manualLbs, setManualLbs] = useState<number | null>(null);
  const utils = trpc.useUtils();
  const { pending: queuedWeighs } = useWeighQueue();

  const sheetQ = trpc.sheets.get.useQuery(
    { id: id ?? -1 },
    {
      enabled: id != null,
      // Refresh while weighing; a FULL/CLOSED/missing sheet is static.
      refetchInterval: (query) =>
        query.state.data?.sheet?.status === "OPEN" ? 5_000 : false,
    },
  );
  const sheet = sheetQ.data?.sheet ?? null;

  const invalidate = () => {
    if (id != null) void utils.sheets.get.invalidate({ id });
    void utils.sheets.open.invalidate();
    void utils.sheets.list.invalidate();
    void utils.core.bins.list.invalidate();
    void utils.sheets.recentActivity.invalidate();
  };

  // Live scale/simulator readings win over the manual override — but once
  // the live source is gone, only the manual entry is trustworthy; a stale
  // frozen reading must never silently override it.
  const liveSource = scale.connected || scale.simulator.active;
  const effectiveLbs = liveSource ? (scale.weightLbs ?? manualLbs) : manualLbs;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" asChild>
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
            Dashboard
          </Link>
        </Button>
        <p className="gt-eyebrow">
          {id == null ? "Standalone scale" : sheet ? sheet.ticketNo : "Weight sheet"}
        </p>
      </div>

      {queuedWeighs.length > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-[hsl(38_92%_60%)]/50 bg-[hsl(38_92%_60%)]/10 px-4 py-2">
          <CloudOff className="h-4 w-4 flex-none text-[hsl(38_92%_60%)]" />
          <span className="font-mono text-xs text-[hsl(38_92%_60%)]">
            {queuedWeighs.length} weigh{queuedWeighs.length === 1 ? "" : "s"} queued offline
            — sent in order when the server answers. Keep this page open.
          </span>
        </div>
      )}

      {id == null ? (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <ScalePanel
            scale={scale}
            weightLbs={effectiveLbs}
            onManualLbs={setManualLbs}
            boundSheet={null}
            standalone
          />
          <Card className="gt-panel h-fit">
            <CardHeader className="pb-2">
              <p className="gt-eyebrow">When to use this</p>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                Check a weight without touching a weight sheet — re-weigh a truck, verify
                the scale, or settle a question at the window.
              </p>
              <p className="font-mono text-[11px]">
                Nothing here is recorded. To weigh against a ticket, pick a sheet on the
                dashboard.
              </p>
            </CardContent>
          </Card>
        </div>
      ) : sheetQ.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-16 w-full" />
          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <Skeleton className="h-96 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        </div>
      ) : !sheet ? (
        <Card className="gt-panel">
          <CardContent className="space-y-2 py-10 text-center">
            <p className="text-sm font-semibold">Weight sheet not found</p>
            <p className="text-sm text-muted-foreground">
              It may have been closed. Open one from the dashboard.
            </p>
            <Button asChild variant="outline">
              <Link to="/">Back to dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      ) : sheet.status !== "OPEN" ? (
        <Card className="gt-panel">
          <CardContent className="space-y-2 py-10 text-center">
            <p className="text-sm font-semibold">
              {sheet.ticketNo} is {sheet.status === "FULL" ? "FULL" : "closed"}
            </p>
            <p className="text-sm text-muted-foreground">
              {sheet.completedLoads}/{sheet.maxLoads} loads recorded. Start a new sheet to
              keep weighing.
            </p>
            <Button asChild variant="outline">
              <Link to="/">Back to dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <SheetSummary sheet={sheet} />
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <ScalePanel
              scale={scale}
              weightLbs={effectiveLbs}
              onManualLbs={setManualLbs}
              boundSheet={sheet}
            />
            <WeighConsole
              key={sheet.id}
              sheet={sheet}
              weightLbs={effectiveLbs}
              onChanged={invalidate}
            />
          </div>
          <SheetLoadsCard sheet={sheet} />
        </>
      )}
    </div>
  );
}

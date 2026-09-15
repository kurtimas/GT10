import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, ChevronRight, MapPin } from "lucide-react";

import { trpc } from "@shared/src/lib/trpc";
import { cn, cropBadgeClass } from "@shared/src/lib/utils";
import { useSite } from "@/providers/site";
import { toast } from "@shared/src/components/ui/sonner";
import { QueryError } from "@shared/src/components/QueryError";
import { Badge } from "@shared/src/components/ui/badge";
import { Button } from "@shared/src/components/ui/button";
import { Card, CardContent, CardHeader } from "@shared/src/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@shared/src/components/ui/dialog";
import { Label } from "@shared/src/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shared/src/components/ui/select";
import { Skeleton } from "@shared/src/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@shared/src/components/ui/tabs";
import { Textarea } from "@shared/src/components/ui/textarea";

import { CROPS, fmtLbs } from "@contracts/grain";
import type { SheetRow } from "@contracts/types";

function fmtTime(d: Date): string {
  return new Date(d).toLocaleTimeString("en-US", { hour12: false });
}

/* ------------------------------------------------------------------ */
/* Storage at a glance — bin fill strip                                */
/* ------------------------------------------------------------------ */

function fillPct(currentLbs: number, capacityLbs: number): number {
  if (capacityLbs <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((currentLbs / capacityLbs) * 100)));
}

/** green under 70%, amber 70–90%, red over 90% — as inline CSS colors. */
function fillColor(pct: number): string {
  if (pct > 90) return "hsl(var(--crit))";
  if (pct >= 70) return "hsl(var(--live))";
  return "hsl(var(--stable))";
}

function BinStrip() {
  const { siteId } = useSite();
  const binsQ = trpc.core.bins.list.useQuery(
    { siteId: siteId ?? undefined },
    { enabled: siteId != null, refetchInterval: 15_000 },
  );
  const bins = binsQ.data ?? [];
  if (binsQ.isError) {
    return (
      <QueryError
        title="Bin levels failed to load"
        message={binsQ.error.message}
        onRetry={() => void binsQ.refetch()}
        retrying={binsQ.isRefetching}
      />
    );
  }
  if (bins.length === 0) return null;

  const capacity = bins.reduce((s, b) => s + b.capacityLbs, 0);
  const current = bins.reduce((s, b) => s + b.currentLbs, 0);
  const overall = fillPct(current, capacity);

  return (
    <Card className="gt-panel">
      <CardContent className="flex flex-col gap-5 p-4 md:flex-row md:items-center">
        <div className="flex shrink-0 items-center gap-4 md:border-r md:border-border md:pr-6">
          <div>
            <p className="gt-eyebrow">Storage</p>
            <div
              className="font-mono text-2xl font-black tabular-nums leading-none"
              style={{ color: fillColor(overall) }}
            >
              {overall}%
              <span className="ml-1 text-xs font-medium text-muted-foreground">full</span>
            </div>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {fmtLbs(current)} of {fmtLbs(capacity)} lb
            </p>
          </div>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 xl:grid-cols-6">
          {bins.map((b) => {
            const pct = fillPct(b.currentLbs, b.capacityLbs);
            return (
              <div key={b.id} title={`${b.name} · ${b.crop} · ${pct}% full`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-semibold">{b.name}</span>
                  <span
                    className="font-mono text-xs font-semibold tabular-nums"
                    style={{ color: fillColor(pct) }}
                  >
                    {pct}%
                  </span>
                </div>
                <p className="truncate font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {b.crop}
                </p>
                <div className="mt-1.5 h-1.5 rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{ width: `${pct}%`, background: fillColor(pct) }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Open weight sheets — pick one to open the scale for it              */
/* ------------------------------------------------------------------ */

function OpenSheetsCard({
  sheets,
  pending,
  error,
  onCreated,
}: {
  sheets: SheetRow[];
  pending: boolean;
  error: { message: string; refetch: () => void; isRefetching: boolean } | null;
  onCreated: (id: number) => void;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="gt-eyebrow">Open weight sheets</p>
          {!pending && (
            <Badge variant="secondary" className="font-mono">
              {sheets.length}
            </Badge>
          )}
        </div>
        <NewSheetDialog onCreated={onCreated} />
      </div>

      {error && (
        <QueryError
          title="Open sheets failed to load"
          message={error.message}
          onRetry={error.refetch}
          retrying={error.isRefetching}
        />
      )}
      {pending ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : sheets.length === 0 && !error ? (
        <Card className="gt-panel">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No open weight sheets — start one when a truck arrives.
          </CardContent>
        </Card>
      ) : sheets.length > 0 ? (
        <Card className="gt-panel overflow-hidden">
          {sheets.map((sheet, i) => (
            <SheetRowButton key={sheet.id} sheet={sheet} first={i === 0} />
          ))}
        </Card>
      ) : null}
    </section>
  );
}

function SheetRowButton({ sheet, first }: { sheet: SheetRow; first: boolean }) {
  const navigate = useNavigate();
  const active = sheet.activeLoad;
  return (
    <button
      type="button"
      onClick={() => navigate(`/scale/${sheet.id}`)}
      className={cn(
        "flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left transition-colors hover:bg-secondary/50",
        !first && "border-t border-border",
      )}
    >
      <span className="min-w-0 flex-1 basis-48">
        <span className="block truncate text-sm font-semibold">
          {sheet.farmerName ?? "—"}
        </span>
        <span className="block truncate font-mono text-xs text-muted-foreground">
          {sheet.ticketNo} · {sheet.completedLoads}/{sheet.maxLoads} loads
          {sheet.lotCode ? ` · ${sheet.lotCode}` : ""}
        </span>
      </span>
      <Badge
        variant="outline"
        className={cn(
          "font-mono text-[10px] uppercase",
          cropBadgeClass(sheet.crop),
        )}
      >
        {sheet.crop}
      </Badge>
      {active ? (
        <Badge
          variant="outline"
          className="border-live/60 font-mono text-[10px] uppercase tracking-wider text-live"
        >
          On the lot
        </Badge>
      ) : (
        <Badge
          variant="outline"
          className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
        >
          Waiting
        </Badge>
      )}
      <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* On the lot — trucks weighed in and still unloading                  */
/* ------------------------------------------------------------------ */

function OnTheLotCard({ sheets, pending }: { sheets: SheetRow[]; pending: boolean }) {
  const navigate = useNavigate();
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <p className="gt-eyebrow">On the lot</p>
        {!pending && sheets.length > 0 && (
          <Badge
            variant="outline"
            className="border-live/60 font-mono text-[10px] uppercase tracking-wider text-live"
          >
            {sheets.length}
          </Badge>
        )}
      </div>

      {pending ? (
        <Card className="gt-panel">
          <CardContent className="p-4">
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      ) : sheets.length === 0 ? (
        <Card className="gt-panel">
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            No trucks on the lot.
          </CardContent>
        </Card>
      ) : (
        <Card className="gt-panel overflow-hidden">
          {sheets.map((sheet, i) => {
            const active = sheet.activeLoad!;
            const since = new Date(
              active.grossAt ?? active.tareAt ?? active.createdAt,
            );
            return (
              <button
                key={sheet.id}
                type="button"
                onClick={() => navigate(`/scale/${sheet.id}`)}
                className={cn(
                  "flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-secondary/50",
                  "sm:flex-row sm:items-center sm:justify-between sm:gap-x-4 sm:gap-y-0",
                  i > 0 && "border-t border-border",
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="gt-led gt-led-warn flex-none" />
                  <span className="truncate font-mono text-sm font-bold text-primary">
                    {sheet.ticketNo}
                  </span>
                  {active.truckId && (
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {active.truckId}
                    </span>
                  )}
                  <span className="hidden truncate text-sm font-semibold sm:inline sm:ml-2">
                    {sheet.farmerName ?? "—"}
                  </span>
                </span>
                <span className="flex items-center justify-between gap-2 sm:flex-none sm:justify-end">
                  <span className="font-mono text-[11px] text-muted-foreground">
                    since {fmtTime(since)} · {fmtLbs(
                      sheet.direction === "OUTBOUND" ? active.tareLbs : active.grossLbs,
                    )}{" "}
                    captured
                  </span>
                  <span className="flex items-center gap-1 font-mono text-xs font-bold uppercase tracking-wider text-live">
                    Weigh out
                    <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                </span>
                <span className="truncate text-sm font-semibold sm:hidden">
                  {sheet.farmerName ?? "—"}
                </span>
              </button>
            );
          })}
        </Card>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* New weight sheet dialog                                             */
/* ------------------------------------------------------------------ */

function NewSheetDialog({ onCreated }: { onCreated: (sheetId: number) => void }) {
  const [open, setOpen] = useState(false);
  const { siteId, sites } = useSite();
  const site = sites.find((s) => s.id === siteId);
  const [direction, setDirection] = useState<"INBOUND" | "OUTBOUND">("INBOUND");
  const [lotId, setLotId] = useState("");
  const [farmerId, setFarmerId] = useState("");
  const [crop, setCrop] = useState("");
  const [notes, setNotes] = useState("");

  const lots = trpc.people.lots.list.useQuery(undefined, { enabled: open });
  const farmers = trpc.people.farmers.list.useQuery(undefined, {
    enabled: open && direction === "OUTBOUND",
  });
  const openLots = (lots.data ?? []).filter((l) => l.status === "OPEN");

  const create = trpc.sheets.create.useMutation({
    onSuccess: (data) => {
      toast.success(`Weight sheet ${data.ticketNo} opened`);
      onCreated(data.id);
      setOpen(false);
      setLotId("");
      setFarmerId("");
      setCrop("");
      setNotes("");
    },
    onError: (err) => toast.error(err.message),
  });

  const canSubmit =
    siteId != null &&
    (direction === "INBOUND" ? lotId !== "" : farmerId !== "" && crop !== "") &&
    !create.isPending;

  const submit = () => {
    if (!canSubmit || siteId == null) return;
    create.mutate({
      siteId,
      direction,
      lotId: direction === "INBOUND" ? Number(lotId) : undefined,
      farmerId: direction === "OUTBOUND" ? Number(farmerId) : undefined,
      crop: direction === "OUTBOUND" ? crop : undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>+ New sheet</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New weight sheet</DialogTitle>
          <DialogDescription>
            Open a ticket for the truck on the scale. Inbound sheets tie to an open lot;
            outbound sheets name the farmer and crop directly.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Location</Label>
            <div className="flex h-9 items-center gap-2 rounded-md border border-input bg-muted/40 px-3 font-mono text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 flex-none" />
              {site ? (
                <>
                  {site.name}
                  {site.location ? ` — ${site.location}` : ""}
                </>
              ) : (
                "No location — add one under Bins first"
              )}
            </div>
            <p className="font-mono text-[11px] text-muted-foreground">
              Sheets open at the active location (switch it in the header).
            </p>
          </div>

          <div className="space-y-1">
            <Label>Direction</Label>
            <Tabs
              value={direction}
              onValueChange={(v) => setDirection(v as "INBOUND" | "OUTBOUND")}
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="INBOUND">INBOUND</TabsTrigger>
                <TabsTrigger value="OUTBOUND">OUTBOUND</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {direction === "INBOUND" ? (
            <div className="space-y-1">
              <Label>Open lot</Label>
              <Select value={lotId} onValueChange={setLotId}>
                <SelectTrigger aria-label="Open lot">
                  <SelectValue placeholder="Select open lot…" />
                </SelectTrigger>
                <SelectContent>
                  {openLots.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.code} — {l.farmerName ?? "?"} — {l.crop}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {lots.data && openLots.length === 0 && (
                <p className="font-mono text-[11px] text-muted-foreground">
                  No open lots — create one under Farmers &amp; Lots first.
                </p>
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Farmer</Label>
                <Select value={farmerId} onValueChange={setFarmerId}>
                  <SelectTrigger aria-label="Farmer">
                    <SelectValue placeholder="Select farmer…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(farmers.data ?? []).map((f) => (
                      <SelectItem key={f.id} value={String(f.id)}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Crop</Label>
                <Select value={crop} onValueChange={setCrop}>
                  <SelectTrigger aria-label="Crop">
                    <SelectValue placeholder="Select crop…" />
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
          )}

          <div className="space-y-1">
            <Label htmlFor="sheet-notes">Notes (optional)</Label>
            <Textarea
              id="sheet-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={submit} disabled={!canSubmit}>
            {create.isPending ? "Opening…" : "Open sheet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Recent activity feed                                                */
/* ------------------------------------------------------------------ */

function ActivityFeed() {
  const { siteId } = useSite();
  const activity = trpc.sheets.recentActivity.useQuery(
    { siteId: siteId ?? undefined },
    { enabled: siteId != null, refetchInterval: 10_000 },
  );

  return (
    <Card className="gt-panel h-fit">
      <CardHeader className="pb-2">
        <p className="gt-eyebrow">Recent activity</p>
      </CardHeader>
      <CardContent>
        {activity.isError && (
          <QueryError
            title="Activity feed failed to load"
            message={activity.error.message}
            onRetry={() => void activity.refetch()}
            retrying={activity.isRefetching}
          />
        )}
        {activity.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </div>
        ) : activity.isError ? null : (activity.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ul className="space-y-2">
            {(activity.data ?? []).slice(0, 12).map((ev) => (
              <li key={ev.id} className="font-mono text-xs leading-relaxed">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-primary">{ev.ticketNo}</span>
                  <span className="text-muted-foreground">{fmtTime(ev.createdAt)}</span>
                </div>
                <div className="text-foreground">
                  {ev.action}
                  {ev.detail ? (
                    <span className="text-muted-foreground"> — {ev.detail}</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Dashboard page                                                      */
/* ------------------------------------------------------------------ */

export default function Dashboard() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { siteId } = useSite();

  const openSheets = trpc.sheets.open.useQuery(
    { siteId: siteId ?? undefined },
    { enabled: siteId != null, refetchInterval: 5_000 },
  );

  const handleCreated = (id: number) => {
    void utils.sheets.open.invalidate();
    void utils.sheets.list.invalidate();
    navigate(`/scale/${id}`);
  };

  const sheets = openSheets.data ?? [];
  const onLot = sheets.filter((s) => s.activeLoad != null);

  return (
    <div className="space-y-4">
      <BinStrip />

      {/* trucks still on the lot lead the page — they need weigh-out next */}
      <OnTheLotCard sheets={onLot} pending={openSheets.isPending} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <OpenSheetsCard
          sheets={sheets}
          pending={openSheets.isPending}
          error={
            openSheets.isError
              ? {
                  message: openSheets.error.message,
                  refetch: () => void openSheets.refetch(),
                  isRefetching: openSheets.isRefetching,
                }
              : null
          }
          onCreated={handleCreated}
        />
        <ActivityFeed />
      </div>
    </div>
  );
}

// Grading settings (Phase C, #3) — the editable shrink/dock schedules and
// grade-factor min/max ranges the scale house applies at grade time. Writes
// are admin-gated server-side (gate intentionally open by default — the
// password field renders only when the gate is closed) and audit-logged.

import { useState } from "react";
import { Download, Pencil, Plus, Trash2 } from "lucide-react";
import { trpc } from "@shared/src/lib/trpc";
import { csvDateStamp, downloadCsv } from "@shared/src/lib/csv";
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
import { AdminPasswordField } from "@/components/AdminPasswordField";
import { useAdminGate } from "@/hooks/useAdminGate";
import { CROPS } from "@contracts/grain";
import { GRADE_FACTORS } from "@contracts/grading";
import type { GradeFactorRow, GradingScheduleRow } from "@contracts/types";

const PLANT_WIDE = "plant";

function parseNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function numStr(n: number | null | undefined): string {
  return n == null ? "" : String(n);
}

// --------------------------------------------------------------- schedules

function ScheduleDialog({
  schedule,
  onClose,
}: {
  schedule: GradingScheduleRow | null; // null = create
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const sitesQ = trpc.core.sites.list.useQuery();
  const [crop, setCrop] = useState(schedule?.crop ?? "Corn");
  const [site, setSite] = useState(
    schedule?.siteId != null ? String(schedule.siteId) : PLANT_WIDE,
  );
  const [shrink, setShrink] = useState(numStr(schedule?.moistureShrinkPerPoint ?? 1.183));
  const [base, setBase] = useState(numStr(schedule?.baseMoisturePct));
  const [handling, setHandling] = useState(numStr(schedule?.handlingShrinkPct ?? 0));
  const [dockageRules, setDockageRules] = useState(schedule?.dockageRules ?? "");
  const [adminPassword, setAdminPassword] = useState("");
  const { passwordRequired } = useAdminGate();

  const invalidate = () => utils.grading.schedules.list.invalidate();
  const create = trpc.grading.schedules.create.useMutation({
    onSuccess: async () => {
      toast.success("Grading schedule created");
      onClose();
      await invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const update = trpc.grading.schedules.update.useMutation({
    onSuccess: async () => {
      toast.success("Grading schedule updated");
      onClose();
      await invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    const shrinkN = parseNum(shrink);
    const baseN = parseNum(base);
    const handlingN = parseNum(handling) ?? 0;
    if (shrinkN == null || shrinkN < 0 || shrinkN > 5) {
      toast.error("Shrink %/point must be a number between 0 and 5");
      return;
    }
    if (baseN == null || baseN < 0 || baseN > 40) {
      toast.error("Base moisture must be a number between 0 and 40");
      return;
    }
    if (handlingN < 0 || handlingN > 10) {
      toast.error("Handling shrink must be between 0 and 10%");
      return;
    }
    if (passwordRequired && !adminPassword) {
      toast.error("Admin password is required to change grading schedules");
      return;
    }
    const siteId = site === PLANT_WIDE ? null : Number(site);
    const payload = {
      crop,
      siteId,
      moistureShrinkPerPoint: shrinkN,
      baseMoisturePct: baseN,
      handlingShrinkPct: handlingN,
      dockageRules: dockageRules.trim() || null,
      adminPassword: adminPassword || undefined,
    };
    if (schedule) update.mutate({ id: schedule.id, ...payload });
    else create.mutate(payload);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {schedule ? `Edit schedule — ${schedule.crop}` : "Add grading schedule"}
          </DialogTitle>
          <DialogDescription>
            Moisture shrink per point over base, plus the flat handling shrink.
            A site row overrides the plant-wide default for its crop.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Crop</Label>
            <Select value={crop} onValueChange={setCrop}>
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
          <div className="space-y-1.5">
            <Label>Applies to</Label>
            <Select value={site} onValueChange={setSite}>
              <SelectTrigger aria-label="Site">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PLANT_WIDE}>Plant-wide default</SelectItem>
                {(sitesQ.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sched-shrink">Shrink % / point</Label>
            <Input
              id="sched-shrink"
              type="number"
              step="any"
              value={shrink}
              onChange={(e) => setShrink(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sched-base">Base moisture %</Label>
            <Input
              id="sched-base"
              type="number"
              step="any"
              value={base}
              onChange={(e) => setBase(e.target.value)}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sched-handling">Handling shrink %</Label>
            <Input
              id="sched-handling"
              type="number"
              step="any"
              value={handling}
              onChange={(e) => setHandling(e.target.value)}
              className="font-mono"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sched-dock">Dockage rules (optional)</Label>
          <Textarea
            id="sched-dock"
            value={dockageRules}
            onChange={(e) => setDockageRules(e.target.value)}
            rows={2}
            placeholder="e.g. Dockage deducted 1:1 from gross bushels"
            className="text-xs"
          />
        </div>
        <AdminPasswordField
          id="schedule-admin-password"
          value={adminPassword}
          onChange={setAdminPassword}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={create.isPending || update.isPending}>
            {create.isPending || update.isPending ? "Saving…" : "Save schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------- factors

function FactorDialog({
  factor,
  onClose,
}: {
  factor: GradeFactorRow | null; // null = create
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const sitesQ = trpc.core.sites.list.useQuery();
  const [crop, setCrop] = useState(factor?.crop ?? "Corn");
  const [gradeClass, setGradeClass] = useState(factor?.gradeClass ?? "");
  const [factorName, setFactorName] = useState<string>(factor?.factor ?? "testWeight");
  const [site, setSite] = useState(factor?.siteId != null ? String(factor.siteId) : PLANT_WIDE);
  const [minValue, setMinValue] = useState(numStr(factor?.minValue));
  const [maxValue, setMaxValue] = useState(numStr(factor?.maxValue));
  const [adminPassword, setAdminPassword] = useState("");
  const { passwordRequired } = useAdminGate();

  const invalidate = () => utils.grading.factors.list.invalidate();
  const create = trpc.grading.factors.create.useMutation({
    onSuccess: async () => {
      toast.success("Grade factor range created");
      onClose();
      await invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const update = trpc.grading.factors.update.useMutation({
    onSuccess: async () => {
      toast.success("Grade factor range updated");
      onClose();
      await invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    const minN = parseNum(minValue);
    const maxN = parseNum(maxValue);
    if (!gradeClass.trim()) {
      toast.error("Grade class is required (e.g. No. 2)");
      return;
    }
    if (minN != null && maxN != null && minN > maxN) {
      toast.error("Min must be ≤ max");
      return;
    }
    if (passwordRequired && !adminPassword) {
      toast.error("Admin password is required to change grade factors");
      return;
    }
    if (factor) {
      update.mutate({
        id: factor.id,
        gradeClass: gradeClass.trim(),
        minValue: minN,
        maxValue: maxN,
        adminPassword: adminPassword || undefined,
      });
    } else {
      create.mutate({
        crop,
        gradeClass: gradeClass.trim(),
        factor: factorName as (typeof GRADE_FACTORS)[number],
        siteId: site === PLANT_WIDE ? null : Number(site),
        minValue: minN,
        maxValue: maxN,
        adminPassword: adminPassword || undefined,
      });
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {factor
              ? `Edit ${factor.crop} ${factor.gradeClass} — ${factor.factor}`
              : "Add grade factor range"}
          </DialogTitle>
          <DialogDescription>
            Min/max bounds for one factor of one grade class. Blank = unbounded.
            Grades outside the range are refused at the scale.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Crop</Label>
            <Select value={crop} onValueChange={setCrop} disabled={factor != null}>
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
          <div className="space-y-1.5">
            <Label htmlFor="factor-class">Grade class</Label>
            <Input
              id="factor-class"
              value={gradeClass}
              onChange={(e) => setGradeClass(e.target.value)}
              placeholder="e.g. No. 2"
              className="font-mono"
            />
          </div>
          {!factor && (
            <>
              <div className="space-y-1.5">
                <Label>Factor</Label>
                <Select value={factorName} onValueChange={setFactorName}>
                  <SelectTrigger aria-label="Factor">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GRADE_FACTORS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Applies to</Label>
                <Select value={site} onValueChange={setSite}>
                  <SelectTrigger aria-label="Site">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={PLANT_WIDE}>Plant-wide default</SelectItem>
                    {(sitesQ.data ?? []).map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="factor-min">Min</Label>
            <Input
              id="factor-min"
              type="number"
              step="any"
              value={minValue}
              onChange={(e) => setMinValue(e.target.value)}
              placeholder="—"
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="factor-max">Max</Label>
            <Input
              id="factor-max"
              type="number"
              step="any"
              value={maxValue}
              onChange={(e) => setMaxValue(e.target.value)}
              placeholder="—"
              className="font-mono"
            />
          </div>
        </div>
        <AdminPasswordField
          id="factor-admin-password"
          value={adminPassword}
          onChange={setAdminPassword}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={create.isPending || update.isPending}>
            {create.isPending || update.isPending ? "Saving…" : "Save range"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteConfirm({
  label,
  onDelete,
  onClose,
  pending,
}: {
  label: string;
  onDelete: (adminPassword: string) => void;
  onClose: () => void;
  pending: boolean;
}) {
  const [adminPassword, setAdminPassword] = useState("");
  const { passwordRequired } = useAdminGate();
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete {label}?</DialogTitle>
          <DialogDescription>
            The deletion is written to the audit log. Loads already graded are
            not re-evaluated.
          </DialogDescription>
        </DialogHeader>
        <AdminPasswordField
          id="grading-delete-password"
          value={adminPassword}
          onChange={setAdminPassword}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={pending || (passwordRequired && !adminPassword)}
            onClick={() => onDelete(adminPassword)}
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------------------------------------------------------------------- page

export default function Grading() {
  const utils = trpc.useUtils();
  const schedulesQ = trpc.grading.schedules.list.useQuery();
  const factorsQ = trpc.grading.factors.list.useQuery();
  const sitesQ = trpc.core.sites.list.useQuery();

  const [scheduleDialog, setScheduleDialog] = useState<{
    schedule: GradingScheduleRow | null;
  } | null>(null);
  const [factorDialog, setFactorDialog] = useState<{ factor: GradeFactorRow | null } | null>(
    null,
  );
  const [deleteSchedule, setDeleteSchedule] = useState<GradingScheduleRow | null>(null);
  const [deleteFactor, setDeleteFactor] = useState<GradeFactorRow | null>(null);

  const delSchedule = trpc.grading.schedules.delete.useMutation({
    onSuccess: async () => {
      toast.success("Grading schedule deleted");
      setDeleteSchedule(null);
      await utils.grading.schedules.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const delFactor = trpc.grading.factors.delete.useMutation({
    onSuccess: async () => {
      toast.success("Grade factor range deleted");
      setDeleteFactor(null);
      await utils.grading.factors.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const siteName = (id: number | null) =>
    id == null ? "Plant-wide" : (sitesQ.data ?? []).find((s) => s.id === id)?.name ?? `#${id}`;

  const schedules = schedulesQ.data ?? [];
  const factors = factorsQ.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <div className="gt-eyebrow">SETTINGS</div>
        <h1 className="text-xl font-semibold tracking-tight">Grading schedules & factors</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Shrink/dock tables and grade-factor ranges applied when a load is
          graded. Site rows override the plant-wide defaults.
        </p>
      </div>

      {/* ------------------------------------------------ schedules */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 py-3">
          <CardTitle className="text-sm font-medium">Shrink & dock schedules</CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={schedules.length === 0}
              onClick={() =>
                downloadCsv(
                  `grading-schedules-${csvDateStamp()}.csv`,
                  ["Crop", "Site", "Shrink %/point", "Base moisture %", "Handling %", "Dockage rules"],
                  schedules.map((s) => [
                    s.crop,
                    siteName(s.siteId),
                    s.moistureShrinkPerPoint,
                    s.baseMoisturePct,
                    s.handlingShrinkPct,
                    s.dockageRules,
                  ]),
                )
              }
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              CSV
            </Button>
            <Button size="sm" className="h-8" onClick={() => setScheduleDialog({ schedule: null })}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add schedule
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {schedulesQ.isError ? (
            <div className="p-4">
              <QueryError
                title="Grading schedules failed to load"
                message={schedulesQ.error.message}
                onRetry={() => void schedulesQ.refetch()}
                retrying={schedulesQ.isRefetching}
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Crop</TableHead>
                  <TableHead>Applies to</TableHead>
                  <TableHead className="text-right">Shrink %/pt</TableHead>
                  <TableHead className="text-right">Base moist %</TableHead>
                  <TableHead className="text-right">Handling %</TableHead>
                  <TableHead>Dockage rules</TableHead>
                  <TableHead className="w-[90px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedulesQ.isPending ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ) : schedules.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      No schedules — add one per crop, or rely on the seeded defaults.
                    </TableCell>
                  </TableRow>
                ) : (
                  schedules.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.crop}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            s.siteId == null
                              ? "font-mono text-[10px] text-muted-foreground"
                              : "border-live/50 font-mono text-[10px] text-live"
                          }
                        >
                          {siteName(s.siteId)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {s.moistureShrinkPerPoint}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {s.baseMoisturePct}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {s.handlingShrinkPct}
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate text-xs text-muted-foreground">
                        {s.dockageRules ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Edit schedule"
                            aria-label="Edit schedule"
                            onClick={() => setScheduleDialog({ schedule: s })}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            title="Delete schedule"
                            aria-label="Delete schedule"
                            onClick={() => setDeleteSchedule(s)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------ factor grid */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 py-3">
          <CardTitle className="text-sm font-medium">Grade factor ranges</CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={factors.length === 0}
              onClick={() =>
                downloadCsv(
                  `grade-factors-${csvDateStamp()}.csv`,
                  ["Crop", "Grade class", "Factor", "Min", "Max", "Site"],
                  factors.map((f) => [
                    f.crop,
                    f.gradeClass,
                    f.factor,
                    f.minValue,
                    f.maxValue,
                    siteName(f.siteId),
                  ]),
                )
              }
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              CSV
            </Button>
            <Button size="sm" className="h-8" onClick={() => setFactorDialog({ factor: null })}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add range
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {factorsQ.isError ? (
            <div className="p-4">
              <QueryError
                title="Grade factors failed to load"
                message={factorsQ.error.message}
                onRetry={() => void factorsQ.refetch()}
                retrying={factorsQ.isRefetching}
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Crop</TableHead>
                  <TableHead>Grade class</TableHead>
                  <TableHead>Factor</TableHead>
                  <TableHead className="text-right">Min</TableHead>
                  <TableHead className="text-right">Max</TableHead>
                  <TableHead>Applies to</TableHead>
                  <TableHead className="w-[90px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {factorsQ.isPending ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ) : factors.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      No factor ranges — grading is unvalidated until ranges exist.
                    </TableCell>
                  </TableRow>
                ) : (
                  factors.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell className="font-medium">{f.crop}</TableCell>
                      <TableCell className="font-mono text-xs">{f.gradeClass}</TableCell>
                      <TableCell className="font-mono text-xs">{f.factor}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {f.minValue ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {f.maxValue ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            f.siteId == null
                              ? "font-mono text-[10px] text-muted-foreground"
                              : "border-live/50 font-mono text-[10px] text-live"
                          }
                        >
                          {siteName(f.siteId)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Edit range"
                            aria-label="Edit range"
                            onClick={() => setFactorDialog({ factor: f })}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            title="Delete range"
                            aria-label="Delete range"
                            onClick={() => setDeleteFactor(f)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------ dialogs */}
      {scheduleDialog && (
        <ScheduleDialog
          key={scheduleDialog.schedule?.id ?? "new"}
          schedule={scheduleDialog.schedule}
          onClose={() => setScheduleDialog(null)}
        />
      )}
      {factorDialog && (
        <FactorDialog
          key={factorDialog.factor?.id ?? "new"}
          factor={factorDialog.factor}
          onClose={() => setFactorDialog(null)}
        />
      )}
      {deleteSchedule && (
        <DeleteConfirm
          label={`${deleteSchedule.crop} schedule (${siteName(deleteSchedule.siteId)})`}
          pending={delSchedule.isPending}
          onClose={() => setDeleteSchedule(null)}
          onDelete={(pw) => delSchedule.mutate({ id: deleteSchedule.id, adminPassword: pw || undefined })}
        />
      )}
      {deleteFactor && (
        <DeleteConfirm
          label={`${deleteFactor.crop} ${deleteFactor.gradeClass} ${deleteFactor.factor} range`}
          pending={delFactor.isPending}
          onClose={() => setDeleteFactor(null)}
          onDelete={(pw) => delFactor.mutate({ id: deleteFactor.id, adminPassword: pw || undefined })}
        />
      )}
    </div>
  );
}

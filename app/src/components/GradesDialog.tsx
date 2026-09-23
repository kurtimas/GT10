// Load grading / enriched intake dialog (Phase 5; Phase C #3) — shared by the
// Sheets archive and the Scale page: moisture, dockage, test weight, protein
// plus damage %, foreign material %, S&B %, grade, and farm/field origin.
// Every field is optional; blank clears the stored value.
//
// Phase C additions: the schedule-driven shrink/dock breakdown is previewed
// live (grading.preview) before save, the server's computed breakdown is
// shown after a successful save, and grade-factor validation rejections are
// surfaced inline (and toasted).

import { useState } from "react";
import { trpc } from "@shared/src/lib/trpc";
import { toast } from "@shared/src/components/ui/sonner";
import { Alert, AlertDescription, AlertTitle } from "@shared/src/components/ui/alert";
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
import { computeBushels, fmtBu, fmtLbs } from "@contracts/grain";
import type { GradeAdjustmentResult } from "@contracts/grading";
import type { LoadRow } from "@contracts/types";
import { AdminPasswordField } from "@/components/AdminPasswordField";

function parseNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function numStr(n: number | null | undefined): string {
  return n == null ? "" : String(n);
}

/** Schedule-driven shrink/dock breakdown panel (preview + post-save). */
function BreakdownPanel({
  result,
  title,
  tone,
}: {
  result: GradeAdjustmentResult;
  title: string;
  tone: "preview" | "saved";
}) {
  return (
    <div
      className={
        tone === "saved"
          ? "rounded-md border border-stable/40 bg-stable/10 p-3 font-mono text-xs"
          : "rounded-md border border-live/30 bg-readout p-3 font-mono text-xs text-sidebar-foreground"
      }
    >
      <div className="gt-eyebrow mb-1">{title}</div>
      <div className="flex justify-between">
        <span className="opacity-60">Moisture shrink ({result.pointsOver} pts over base)</span>
        <span>-{fmtLbs(result.moistureShrinkLbs)} lb</span>
      </div>
      <div className="flex justify-between">
        <span className="opacity-60">Handling shrink</span>
        <span>-{fmtLbs(result.handlingLbs)} lb</span>
      </div>
      <div className="flex justify-between">
        <span className="opacity-60">Dockage</span>
        <span>-{fmtLbs(result.dockLbs)} lb</span>
      </div>
      <div className="mt-1 flex justify-between border-t border-foreground/20 pt-1 font-semibold">
        <span className="opacity-60">
          Total deduction ({result.shrinkPct}%) · Net
        </span>
        <span>
          -{fmtLbs(result.shrinkLbs + result.dockLbs)} lb → {fmtBu(result.netBushels)} bu
        </span>
      </div>
    </div>
  );
}

export function GradesDialog({
  load,
  crop,
  siteId,
  locked,
  open,
  onOpenChange,
  onSaved,
}: {
  load: LoadRow;
  crop: string;
  /** sheet's site — enables the schedule-driven preview (grading.preview) */
  siteId?: number;
  /** sheet is CLOSED — the edit needs the admin password */
  locked?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** extra invalidation hook for the caller (sheet refetch etc.) */
  onSaved?: () => void;
}) {
  const utils = trpc.useUtils();
  const [moisture, setMoisture] = useState(numStr(load.moisturePct));
  const [dockage, setDockage] = useState(numStr(load.dockagePct));
  const [tw, setTw] = useState(numStr(load.testWeightLbs));
  const [protein, setProtein] = useState(numStr(load.proteinPct));
  const [damage, setDamage] = useState(numStr(load.damagePct));
  const [fm, setFm] = useState(numStr(load.foreignMaterialPct));
  const [sb, setSb] = useState(numStr(load.sbPct));
  const [grade, setGrade] = useState(load.grade ?? "");
  const [farmOrigin, setFarmOrigin] = useState(load.farmOrigin ?? "");
  const [adminPassword, setAdminPassword] = useState("");
  const [savedBreakdown, setSavedBreakdown] = useState<GradeAdjustmentResult | null>(null);

  const invalidate = () => {
    void utils.sheets.get.invalidate();
    void utils.sheets.list.invalidate();
    void utils.sheets.open.invalidate();
    onSaved?.();
  };

  const mut = trpc.sheets.updateLoadGrades.useMutation({
    onSuccess: (data) => {
      invalidate();
      if (data.breakdown) {
        // show the server's authoritative shrink/dock breakdown before closing
        setSavedBreakdown(data.breakdown);
        toast.success(`Grades saved for load ${load.loadNo}`);
      } else {
        toast.success(`Grades saved for load ${load.loadNo}`);
        onOpenChange(false);
      }
    },
    // grade-factor validation failures render inline below AND toast
    onError: (err) => toast.error(err.message),
  });

  const moistureN = parseNum(moisture);
  const dockageN = parseNum(dockage);
  const twN = parseNum(tw);
  const proteinN = parseNum(protein);
  const damageN = parseNum(damage);
  const fmN = parseNum(fm);
  const sbN = parseNum(sb);
  const valid =
    (moisture.trim() === "" || moistureN != null) &&
    (dockage.trim() === "" || dockageN != null) &&
    (tw.trim() === "" || twN != null) &&
    (protein.trim() === "" || proteinN != null) &&
    (damage.trim() === "" || damageN != null) &&
    (fm.trim() === "" || fmN != null) &&
    (sb.trim() === "" || sbN != null) &&
    (!locked || adminPassword !== "");

  // live schedule-driven preview (grading.preview) — falls back to the
  // legacy grain.ts bushel math when no siteId is available
  const previewQ = trpc.grading.preview.useQuery(
    {
      siteId: siteId ?? -1,
      crop,
      netLbs: load.netLbs ?? 0,
      moisturePct: moistureN,
      dockagePct: dockageN,
    },
    { enabled: siteId != null && load.netLbs != null && load.netLbs > 0 && valid },
  );
  const schedulePreview = previewQ.data?.result ?? null;
  const legacyPreview =
    siteId == null && load.netLbs != null
      ? computeBushels(crop, load.netLbs, moistureN, dockageN)
      : null;

  const save = () =>
    mut.mutate({
      loadId: load.id,
      moisturePct: moistureN,
      dockagePct: dockageN,
      testWeightLbs: twN,
      proteinPct: proteinN,
      damagePct: damageN,
      foreignMaterialPct: fmN,
      sbPct: sbN,
      grade: grade.trim() || null,
      farmOrigin: farmOrigin.trim() || null,
      adminPassword: adminPassword || undefined,
    });

  const numField = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    placeholder: string,
  ) => (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        step="any"
        min="0"
        value={value}
        placeholder={placeholder}
        onChange={(e) => set(e.target.value)}
        className="h-8 font-mono text-xs"
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Grades — load {load.loadNo}</DialogTitle>
          <DialogDescription>
            All fields optional. Leave a field blank to clear it. The backend
            recomputes shrink, dock, and bushels authoritatively from the
            crop&apos;s grading schedule.
          </DialogDescription>
        </DialogHeader>

        {savedBreakdown ? (
          <>
            <BreakdownPanel result={savedBreakdown} title="Saved — computed deduction" tone="saved" />
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              {numField("g-moist", "Moisture %", moisture, setMoisture, "e.g. 17.5")}
              {numField("g-dock", "Dockage %", dockage, setDockage, "e.g. 1.0")}
              {numField("g-tw", "Test weight lbs", tw, setTw, "e.g. 56")}
              {numField("g-prot", "Protein %", protein, setProtein, "optional")}
              {numField("g-dmg", "Damage %", damage, setDamage, "optional")}
              {numField("g-fm", "Foreign material %", fm, setFm, "optional")}
              {numField("g-sb", "S&B %", sb, setSb, "optional")}
              <div className="space-y-1">
                <Label htmlFor="g-grade" className="text-xs">
                  Grade
                </Label>
                <Input
                  id="g-grade"
                  value={grade}
                  placeholder="e.g. No. 2 Yellow"
                  onChange={(e) => setGrade(e.target.value)}
                  className="h-8 font-mono text-xs"
                  maxLength={32}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="g-origin" className="text-xs">
                Farm / field origin
              </Label>
              <Input
                id="g-origin"
                value={farmOrigin}
                placeholder="e.g. Home farm — north 40"
                onChange={(e) => setFarmOrigin(e.target.value)}
                className="h-8 font-mono text-xs"
                maxLength={255}
              />
            </div>

            {mut.isError && (
              <Alert variant="destructive">
                <AlertTitle>Grades rejected</AlertTitle>
                <AlertDescription className="font-mono text-xs">
                  {mut.error.message}
                </AlertDescription>
              </Alert>
            )}

            {schedulePreview ? (
              <BreakdownPanel
                result={schedulePreview}
                title={
                  previewQ.data?.schedule
                    ? `Schedule preview — ${previewQ.data.schedule.moistureShrinkPerPoint}%/pt over ${previewQ.data.schedule.baseMoisturePct}%`
                    : "Schedule preview (default rates)"
                }
                tone="preview"
              />
            ) : legacyPreview ? (
              <div className="rounded-md border border-live/30 bg-readout p-3 font-mono text-xs text-sidebar-foreground">
                <div className="gt-eyebrow mb-1">Live preview</div>
                <div className="flex justify-between">
                  <span className="text-sidebar-foreground/60">Gross</span>
                  <span>{fmtBu(legacyPreview.grossBushels)} bu</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sidebar-foreground/60">Shrink</span>
                  <span className="text-live">{legacyPreview.shrinkPct}%</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span className="text-sidebar-foreground/60">Net</span>
                  <span className="text-go">{fmtBu(legacyPreview.netBushels)} bu</span>
                </div>
              </div>
            ) : null}

            {locked && (
              <AdminPasswordField
                id="grades-locked-password"
                value={adminPassword}
                onChange={setAdminPassword}
                hint="This ticket is locked (closed) — editing grades requires the site admin password."
              />
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={save} disabled={!valid || mut.isPending}>
                {mut.isPending ? "Saving…" : "Save grades"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

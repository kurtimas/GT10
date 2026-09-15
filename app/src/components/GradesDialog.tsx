// Load grading / enriched intake dialog (Phase 5) — shared by the Sheets
// archive and the Scale page so the operator can grade right after
// weigh-out: moisture, dockage, test weight, protein (drive the bushel
// math) plus damage %, grade, and farm/field origin (traceability only).
// Every field is optional; blank clears the stored value.

import { useState } from "react";
import { trpc } from "@shared/src/lib/trpc";
import { toast } from "@shared/src/components/ui/sonner";
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
import { computeBushels, fmtBu } from "@contracts/grain";
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

export function GradesDialog({
  load,
  crop,
  locked,
  open,
  onOpenChange,
  onSaved,
}: {
  load: LoadRow;
  crop: string;
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
  const [grade, setGrade] = useState(load.grade ?? "");
  const [farmOrigin, setFarmOrigin] = useState(load.farmOrigin ?? "");
  const [adminPassword, setAdminPassword] = useState("");

  const invalidate = () => {
    void utils.sheets.get.invalidate();
    void utils.sheets.list.invalidate();
    void utils.sheets.open.invalidate();
    onSaved?.();
  };

  const mut = trpc.sheets.updateLoadGrades.useMutation({
    onSuccess: () => {
      toast.success(`Grades saved for load ${load.loadNo}`);
      invalidate();
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const moistureN = parseNum(moisture);
  const dockageN = parseNum(dockage);
  const twN = parseNum(tw);
  const proteinN = parseNum(protein);
  const damageN = parseNum(damage);
  const valid =
    (moisture.trim() === "" || moistureN != null) &&
    (dockage.trim() === "" || dockageN != null) &&
    (tw.trim() === "" || twN != null) &&
    (protein.trim() === "" || proteinN != null) &&
    (damage.trim() === "" || damageN != null) &&
    (!locked || adminPassword !== "");

  // live bushel preview when the load has completed weighing
  const preview =
    load.netLbs != null ? computeBushels(crop, load.netLbs, moistureN, dockageN) : null;

  const save = () =>
    mut.mutate({
      loadId: load.id,
      moisturePct: moistureN,
      dockagePct: dockageN,
      testWeightLbs: twN,
      proteinPct: proteinN,
      damagePct: damageN,
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
            recomputes bushels authoritatively.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          {numField("g-moist", "Moisture %", moisture, setMoisture, "e.g. 17.5")}
          {numField("g-dock", "Dockage %", dockage, setDockage, "e.g. 1.0")}
          {numField("g-tw", "Test weight lbs", tw, setTw, "e.g. 56")}
          {numField("g-prot", "Protein %", protein, setProtein, "optional")}
          {numField("g-dmg", "Damage %", damage, setDamage, "optional")}
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
        {preview && (
          <div className="rounded-md border border-live/30 bg-readout p-3 font-mono text-xs text-sidebar-foreground">
            <div className="gt-eyebrow mb-1">Live preview</div>
            <div className="flex justify-between">
              <span className="text-sidebar-foreground/60">Gross</span>
              <span>{fmtBu(preview.grossBushels)} bu</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sidebar-foreground/60">Shrink</span>
              <span className="text-live">{preview.shrinkPct}%</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span className="text-sidebar-foreground/60">Net</span>
              <span className="text-go">{fmtBu(preview.netBushels)} bu</span>
            </div>
          </div>
        )}
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
      </DialogContent>
    </Dialog>
  );
}

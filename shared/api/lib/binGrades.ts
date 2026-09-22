import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { binGradeOverrides, loads } from "../../db/schema";
import {
  binGradeAverages,
  BIN_GRADE_FACTOR_KEYS,
  type BinGradeAverages,
  type BinGradeFactorKey,
} from "../../contracts/provenance";
import { movementsForBin } from "./movements";
import { cleanoutCutoff } from "./cleanouts";

// ---------------------------------------------------------------------------
// Effective per-bin grade factors (Phase B, #18): the computed lbs-weighted
// averages (provenance.binGradeAverages, bounded by the bin's cleanout
// cutoff) with the latest bin_grade_overrides row per factor applied on top.
// An override always wins over the computed average and is marked as such.
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface EffectiveFactor {
  value: number;
  /** true when the value comes from a manual override (latest row wins) */
  override: boolean;
  reason: string | null;
  /** lbs of grain the computed average covered (null for overrides) */
  coveredLbs: number | null;
}

export interface EffectiveBinGrades {
  totalLbs: number;
  /** latest completed cleanout bounding the replay, if any */
  cleanoutCutoff: Date | null;
  averages: BinGradeAverages;
  factors: Partial<Record<BinGradeFactorKey, EffectiveFactor>>;
}

export async function effectiveBinGrades(db: Db | Tx, binId: number): Promise<EffectiveBinGrades> {
  const cutoff = await cleanoutCutoff(db, binId);
  const events = await movementsForBin(db, binId);
  const loadIds = [...new Set(events.map((e) => e.loadId).filter((v): v is number => v != null))];
  const loadRows = loadIds.length
    ? await db
        .select({
          id: loads.id,
          moisturePct: loads.moisturePct,
          testWeightLbs: loads.testWeightLbs,
          dockagePct: loads.dockagePct,
          damagePct: loads.damagePct,
          proteinPct: loads.proteinPct,
        })
        .from(loads)
        .where(inArray(loads.id, loadIds))
    : [];
  const averages = binGradeAverages(events, loadRows, binId, cutoff);

  const overrideRows = await db
    .select()
    .from(binGradeOverrides)
    .where(eq(binGradeOverrides.binId, binId))
    .orderBy(desc(binGradeOverrides.createdAt), desc(binGradeOverrides.id));
  const latestByFactor = new Map<string, (typeof overrideRows)[number]>();
  for (const r of overrideRows) {
    if (!latestByFactor.has(r.factor)) latestByFactor.set(r.factor, r);
  }

  const factors: Partial<Record<BinGradeFactorKey, EffectiveFactor>> = {};
  for (const key of BIN_GRADE_FACTOR_KEYS) {
    const override = latestByFactor.get(key);
    if (override) {
      factors[key] = { value: override.value, override: true, reason: override.reason, coveredLbs: null };
    } else if (averages[key]) {
      factors[key] = {
        value: averages[key]!.value,
        override: false,
        reason: null,
        coveredLbs: averages[key]!.coveredLbs,
      };
    }
  }
  return { totalLbs: averages.totalLbs, cleanoutCutoff: cutoff, averages, factors };
}

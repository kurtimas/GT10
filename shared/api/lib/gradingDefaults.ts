// ---------------------------------------------------------------------------
// Grading-table default seed (Phase A, research #3). The shrink/dock
// schedules and grade-factor ranges are EDITABLE tables, so the defaults
// (US corn/soybeans/wheat, from shared/contracts/grading.ts) are inserted
// once on boot and only when the crop has no plant-wide (siteId null) rows
// yet — operator edits are never overwritten.
// ---------------------------------------------------------------------------

import { and, eq, isNull } from "drizzle-orm";
import { gradeFactors, gradingSchedules } from "../../db/schema";
import { defaultGradeFactors, defaultGradingSchedules } from "../../contracts/grading";
import type { Db } from "../queries/connection";

export async function seedGradingDefaults(db: Db): Promise<boolean> {
  let inserted = 0;

  for (const schedule of defaultGradingSchedules()) {
    const existing = await db
      .select({ id: gradingSchedules.id })
      .from(gradingSchedules)
      .where(and(isNull(gradingSchedules.siteId), eq(gradingSchedules.crop, schedule.crop)))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(gradingSchedules).values(schedule);
      inserted++;
    }
  }

  const factorsByCrop = new Map<string, ReturnType<typeof defaultGradeFactors>>();
  for (const factor of defaultGradeFactors()) {
    const list = factorsByCrop.get(factor.crop) ?? [];
    list.push(factor);
    factorsByCrop.set(factor.crop, list);
  }
  for (const [crop, factors] of factorsByCrop) {
    const existing = await db
      .select({ id: gradeFactors.id })
      .from(gradeFactors)
      .where(and(isNull(gradeFactors.siteId), eq(gradeFactors.crop, crop)))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(gradeFactors).values(factors);
      inserted += factors.length;
    }
  }

  return inserted > 0;
}

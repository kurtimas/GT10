import { z } from "zod";
import { and, asc, desc, eq, isNull, or, type SQL } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { gradeFactors, gradingSchedules } from "../db/schema";
import {
  computeGradeAdjustments,
  gradeFactorSchema,
  gradingScheduleSchema,
  type ScheduleLike,
} from "../contracts/grading";
import { assertAdmin } from "./lib/adminPassword";
import { writeAudit } from "./lib/audit";
import { resolveOperator } from "./lib/operators";

// ---------------------------------------------------------------------------
// Grading configuration API (Phase B, #3) — CRUD for the editable
// shrink/dock schedules and grade-factor ranges seeded in Phase A. Writes are
// admin-gated (the gate is intentionally open by default — see
// lib/adminPassword.ts) and audit-logged; reads are open.
//
// siteId null = plant-wide default for the crop; a site row overrides it.
// Schedule/factor resolution for a site: site-specific row wins, else the
// plant-wide default row.
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof getDb>;

/** Effective shrink schedule for (site, crop): site row wins, else default. */
export async function scheduleFor(
  db: Db,
  siteId: number,
  crop: string,
): Promise<(ScheduleLike & { id: number; siteId: number | null }) | null> {
  const rows = await db
    .select()
    .from(gradingSchedules)
    .where(and(eq(gradingSchedules.crop, crop), or(
      eq(gradingSchedules.siteId, siteId),
      isNull(gradingSchedules.siteId),
    )))
    .orderBy(desc(gradingSchedules.siteId)); // site rows (non-null) sort after null → reverse
  const siteRow = rows.find((r) => r.siteId === siteId);
  const defaultRow = rows.find((r) => r.siteId == null);
  const row = siteRow ?? defaultRow;
  return row ?? null;
}

/** Effective grade-factor rules for (site, crop, gradeClass): site rows win per factor. */
export async function factorRulesFor(
  db: Db,
  siteId: number,
  crop: string,
  gradeClass: string,
) {
  const rows = await db
    .select()
    .from(gradeFactors)
    .where(
      and(
        eq(gradeFactors.crop, crop),
        eq(gradeFactors.gradeClass, gradeClass),
        or(eq(gradeFactors.siteId, siteId), isNull(gradeFactors.siteId)),
      ),
    );
  const byFactor = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const existing = byFactor.get(r.factor);
    if (!existing || (existing.siteId == null && r.siteId != null)) byFactor.set(r.factor, r);
  }
  return [...byFactor.values()];
}

export const gradingRouter = createRouter({
  schedules: createRouter({
    list: publicQuery
      .input(z.object({ siteId: z.number().nullable().optional() }).optional())
      .query(async ({ input }) => {
        const db = getDb();
        const conds: SQL[] = [];
        if (input?.siteId === null) conds.push(isNull(gradingSchedules.siteId));
        else if (input?.siteId != null) {
          conds.push(
            or(eq(gradingSchedules.siteId, input.siteId), isNull(gradingSchedules.siteId))!,
          );
        }
        return db
          .select()
          .from(gradingSchedules)
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(asc(gradingSchedules.crop), asc(gradingSchedules.siteId));
      }),
    create: publicQuery
      .input(gradingScheduleSchema.extend({ adminPassword: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        assertAdmin(input.adminPassword);
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const { adminPassword: _pw, ...data } = input;
        const [{ id }] = await db
          .insert(gradingSchedules)
          .values({ ...data, siteId: data.siteId ?? null, dockageRules: data.dockageRules ?? null })
          .$returningId();
        await writeAudit(db, {
          actor: operator,
          action: "create",
          entityType: "grading_schedule",
          entityId: id,
          after: data,
        });
        return db.query.gradingSchedules.findFirst({ where: eq(gradingSchedules.id, id) });
      }),
    update: publicQuery
      .input(
        gradingScheduleSchema.partial().extend({
          id: z.number(),
          adminPassword: z.string().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertAdmin(input.adminPassword);
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const { id, adminPassword: _pw, ...data } = input;
        const before = await db.query.gradingSchedules.findFirst({
          where: eq(gradingSchedules.id, id),
        });
        if (!before) throw new Error("Grading schedule not found");
        await db.update(gradingSchedules).set(data).where(eq(gradingSchedules.id, id));
        await writeAudit(db, {
          actor: operator,
          action: "update",
          entityType: "grading_schedule",
          entityId: id,
          before,
          after: data,
        });
        return db.query.gradingSchedules.findFirst({ where: eq(gradingSchedules.id, id) });
      }),
    delete: publicQuery
      .input(z.object({ id: z.number(), adminPassword: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        assertAdmin(input.adminPassword);
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const before = await db.query.gradingSchedules.findFirst({
          where: eq(gradingSchedules.id, input.id),
        });
        if (!before) throw new Error("Grading schedule not found");
        await db.delete(gradingSchedules).where(eq(gradingSchedules.id, input.id));
        await writeAudit(db, {
          actor: operator,
          action: "void",
          entityType: "grading_schedule",
          entityId: input.id,
          before,
          note: "Grading schedule deleted",
        });
        return { ok: true };
      }),
  }),

  factors: createRouter({
    list: publicQuery
      .input(
        z
          .object({
            crop: z.string().optional(),
            gradeClass: z.string().optional(),
            siteId: z.number().nullable().optional(),
          })
          .optional(),
      )
      .query(async ({ input }) => {
        const db = getDb();
        const conds: SQL[] = [];
        if (input?.crop) conds.push(eq(gradeFactors.crop, input.crop));
        if (input?.gradeClass) conds.push(eq(gradeFactors.gradeClass, input.gradeClass));
        if (input?.siteId === null) conds.push(isNull(gradeFactors.siteId));
        else if (input?.siteId != null) {
          conds.push(or(eq(gradeFactors.siteId, input.siteId), isNull(gradeFactors.siteId))!);
        }
        return db
          .select()
          .from(gradeFactors)
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(asc(gradeFactors.crop), asc(gradeFactors.gradeClass), asc(gradeFactors.factor));
      }),
    create: publicQuery
      .input(gradeFactorSchema.extend({ adminPassword: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        assertAdmin(input.adminPassword);
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const { adminPassword: _pw, ...data } = input;
        const [{ id }] = await db
          .insert(gradeFactors)
          .values({
            ...data,
            siteId: data.siteId ?? null,
            minValue: data.minValue ?? null,
            maxValue: data.maxValue ?? null,
          })
          .$returningId();
        await writeAudit(db, {
          actor: operator,
          action: "create",
          entityType: "grade_factor",
          entityId: id,
          after: data,
        });
        return db.query.gradeFactors.findFirst({ where: eq(gradeFactors.id, id) });
      }),
    update: publicQuery
      .input(
        z
          .object({
            id: z.number(),
            gradeClass: z.string().trim().min(1).max(32).optional(),
            minValue: z.number().nullable().optional(),
            maxValue: z.number().nullable().optional(),
            adminPassword: z.string().optional(),
          })
          .refine((r) => r.minValue == null || r.maxValue == null || r.minValue <= r.maxValue, {
            message: "minValue must be <= maxValue",
          }),
      )
      .mutation(async ({ input, ctx }) => {
        assertAdmin(input.adminPassword);
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const { id, adminPassword: _pw, ...data } = input;
        const before = await db.query.gradeFactors.findFirst({ where: eq(gradeFactors.id, id) });
        if (!before) throw new Error("Grade factor not found");
        const minValue = data.minValue !== undefined ? data.minValue : before.minValue;
        const maxValue = data.maxValue !== undefined ? data.maxValue : before.maxValue;
        if (minValue != null && maxValue != null && minValue > maxValue) {
          throw new Error("minValue must be <= maxValue");
        }
        await db.update(gradeFactors).set(data).where(eq(gradeFactors.id, id));
        await writeAudit(db, {
          actor: operator,
          action: "update",
          entityType: "grade_factor",
          entityId: id,
          before,
          after: data,
        });
        return db.query.gradeFactors.findFirst({ where: eq(gradeFactors.id, id) });
      }),
    delete: publicQuery
      .input(z.object({ id: z.number(), adminPassword: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        assertAdmin(input.adminPassword);
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const before = await db.query.gradeFactors.findFirst({
          where: eq(gradeFactors.id, input.id),
        });
        if (!before) throw new Error("Grade factor not found");
        await db.delete(gradeFactors).where(eq(gradeFactors.id, input.id));
        await writeAudit(db, {
          actor: operator,
          action: "void",
          entityType: "grade_factor",
          entityId: input.id,
          before,
          note: "Grade factor deleted",
        });
        return { ok: true };
      }),
  }),

  // Live preview for the grades dialog: what the current schedule does to a
  // load of netLbs at moisturePct/dockagePct — same math updateLoadGrades stamps.
  preview: publicQuery
    .input(
      z.object({
        siteId: z.number(),
        crop: z.string(),
        netLbs: z.number().positive(),
        moisturePct: z.number().nullable().optional(),
        dockagePct: z.number().nullable().optional(),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const schedule = await scheduleFor(db, input.siteId, input.crop);
      return {
        schedule,
        result: computeGradeAdjustments(
          input.crop,
          input.netLbs,
          input.moisturePct,
          input.dockagePct,
          schedule,
        ),
      };
    }),
});

export type GradingRouter = typeof gradingRouter;

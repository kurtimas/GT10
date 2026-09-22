import { z } from "zod";
import { and, asc, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  auditLog,
  binCleanouts,
  binGradeOverrides,
  bins,
  binMovements,
  certificates,
  dprSnapshots,
  farmers,
  fumigationLogs,
  labResults,
  loads,
  lots,
  shipments,
  shrinkEntries,
  sites,
  weightSheets,
} from "../db/schema";
import {
  binCleanoutSchema,
  binGradeOverrideSchema,
  certificateSchema,
  DEFAULT_RETENTION_YEARS,
  fumigationLogSchema,
  labResultSchema,
  RETENTION_SETTINGS_KEY,
  retentionYearsSchema,
  shrinkEntrySchema,
} from "../contracts/compliance";
import { assertAdmin } from "./lib/adminPassword";
import { writeAudit } from "./lib/audit";
import { resolveOperator } from "./lib/operators";
import { getSetting, setSetting } from "./officeSync";
import { toCsv, type CsvValue } from "./lib/csv";
import { parseDay } from "./lib/dpr";

// ---------------------------------------------------------------------------
// Compliance APIs (Phase B): bin cleanouts (#12), fumigation logs (#19),
// certificate registry with issue/reprint/void lifecycle (#20), lab results
// (#22), append-only shrink entries (#15), bin grade overrides (#18), record
// retention setting + exam-mode export (#9).
//
// Every mutation writes audit_log with the resolved operator; mutations that
// change configuration are admin-gated (gate intentionally open by default).
// ---------------------------------------------------------------------------

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** "At/near zero" threshold for recording a bin as emptied (#12). */
const EMPTY_TOLERANCE_LBS = 500;

export const complianceRouter = createRouter({
  // ------------------------------------------------------- cleanouts (#12)
  cleanouts: createRouter({
    list: publicQuery
      .input(z.object({ siteId: z.number().optional(), binId: z.number().optional() }).optional())
      .query(async ({ input }) => {
        const db = getDb();
        const conds: SQL[] = [];
        if (input?.siteId) conds.push(eq(binCleanouts.siteId, input.siteId));
        if (input?.binId) conds.push(eq(binCleanouts.binId, input.binId));
        const rows = await db
          .select({ cleanout: binCleanouts, binName: bins.name, siteName: sites.name })
          .from(binCleanouts)
          .leftJoin(bins, eq(binCleanouts.binId, bins.id))
          .leftJoin(sites, eq(binCleanouts.siteId, sites.id))
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(desc(binCleanouts.emptiedAt), desc(binCleanouts.id));
        return rows.map((r) => ({ ...r.cleanout, binName: r.binName, siteName: r.siteName }));
      }),

    // Record a bin empty + cleanout. The bin should be at/near zero lbs; a
    // non-empty bin is allowed only with confirmNotEmpty + a note (the
    // residual is real grain — its genealogy ends here).
    record: publicQuery
      .input(
        binCleanoutSchema
          .omit({ emptiedAt: true, operator: true })
          .extend({
            emptiedAt: z.date().optional(),
            confirmNotEmpty: z.boolean().optional(),
          }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const bin = await db.query.bins.findFirst({ where: eq(bins.id, input.binId) });
        if (!bin) throw new Error("Bin not found");
        if (bin.siteId !== input.siteId) throw new Error("Bin belongs to another site");
        const residualLbs = bin.currentLbs;
        if (residualLbs > EMPTY_TOLERANCE_LBS && input.confirmNotEmpty !== true) {
          throw new Error(
            `Bin ${bin.name} still holds ${residualLbs.toLocaleString()} lbs — ` +
              `empty it first, or confirm the non-empty cleanout (a note is required)`,
          );
        }
        if (residualLbs > 0 && !(input.note ?? "").trim()) {
          throw new Error("A note is required when recording a cleanout on a non-empty bin");
        }
        const note =
          residualLbs > 0
            ? `${input.note ?? ""} [recorded with ${residualLbs.toLocaleString()} lbs residual]`.trim()
            : (input.note ?? null);
        const [{ id }] = await db
          .insert(binCleanouts)
          .values({
            siteId: input.siteId,
            binId: input.binId,
            emptiedAt: input.emptiedAt ?? new Date(),
            cleanedAt: input.cleanedAt ?? null,
            method: input.method ?? null,
            note,
            operator,
          })
          .$returningId();
        await writeAudit(db, {
          actor: operator,
          action: "create",
          entityType: "bin_cleanout",
          entityId: id,
          after: { binId: input.binId, residualLbs, method: input.method ?? null, note },
        });
        return {
          cleanout: await db.query.binCleanouts.findFirst({ where: eq(binCleanouts.id, id) }),
          warning:
            residualLbs > 0
              ? `Recorded with ${residualLbs.toLocaleString()} lbs still in the bin`
              : null,
        };
      }),

    // Mark a cleanout complete — this is the genealogy reset point: after
    // cleanedAt, provenance replay for the bin ignores earlier movements.
    complete: publicQuery
      .input(
        z.object({
          id: z.number(),
          cleanedAt: z.date().optional(),
          method: z.string().trim().max(255).optional(),
          note: z.string().max(4000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const before = await db.query.binCleanouts.findFirst({
          where: eq(binCleanouts.id, input.id),
        });
        if (!before) throw new Error("Cleanout not found");
        if (before.cleanedAt) throw new Error("Cleanout is already marked complete");
        const patch = {
          cleanedAt: input.cleanedAt ?? new Date(),
          ...(input.method !== undefined ? { method: input.method } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
        };
        await db.update(binCleanouts).set(patch).where(eq(binCleanouts.id, input.id));
        await writeAudit(db, {
          actor: operator,
          action: "update",
          entityType: "bin_cleanout",
          entityId: input.id,
          before: { cleanedAt: before.cleanedAt, method: before.method },
          after: patch,
          note: "Cleanout completed — bin genealogy resets here",
        });
        return db.query.binCleanouts.findFirst({ where: eq(binCleanouts.id, input.id) });
      }),
  }),

  // ----------------------------------------------------- fumigation (#19)
  fumigations: createRouter({
    list: publicQuery
      .input(z.object({ siteId: z.number().optional(), binId: z.number().optional() }).optional())
      .query(async ({ input }) => {
        const db = getDb();
        const conds: SQL[] = [];
        if (input?.siteId) conds.push(eq(fumigationLogs.siteId, input.siteId));
        if (input?.binId) conds.push(eq(fumigationLogs.binId, input.binId));
        const rows = await db
          .select({ fumigation: fumigationLogs, binName: bins.name, siteName: sites.name })
          .from(fumigationLogs)
          .leftJoin(bins, eq(fumigationLogs.binId, bins.id))
          .leftJoin(sites, eq(fumigationLogs.siteId, sites.id))
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(desc(fumigationLogs.appliedAt), desc(fumigationLogs.id));
        return rows.map((r) => ({ ...r.fumigation, binName: r.binName, siteName: r.siteName }));
      }),
    create: publicQuery
      .input(fumigationLogSchema.omit({}))
      .mutation(async ({ input, ctx }) => {
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const bin = await db.query.bins.findFirst({ where: eq(bins.id, input.binId) });
        if (!bin) throw new Error("Bin not found");
        if (bin.siteId !== input.siteId) throw new Error("Bin belongs to another site");
        const [{ id }] = await db
          .insert(fumigationLogs)
          .values({
            siteId: input.siteId,
            binId: input.binId,
            product: input.product,
            dosage: input.dosage ?? null,
            appliedAt: input.appliedAt,
            exposureHours: input.exposureHours ?? null,
            aerationClearedAt: input.aerationClearedAt ?? null,
            applicator: input.applicator ?? operator,
            note: input.note ?? null,
          })
          .$returningId();
        await writeAudit(db, {
          actor: operator,
          action: "create",
          entityType: "fumigation_log",
          entityId: id,
          after: input,
        });
        return db.query.fumigationLogs.findFirst({ where: eq(fumigationLogs.id, id) });
      }),
    // record aeration clearance / fix details — before/after audited
    update: publicQuery
      .input(
        z.object({
          id: z.number(),
          dosage: z.string().trim().max(128).nullable().optional(),
          exposureHours: z.number().min(0).max(24 * 60).nullable().optional(),
          aerationClearedAt: z.date().nullable().optional(),
          applicator: z.string().trim().max(255).nullable().optional(),
          note: z.string().max(4000).nullable().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const { id, ...data } = input;
        const before = await db.query.fumigationLogs.findFirst({
          where: eq(fumigationLogs.id, id),
        });
        if (!before) throw new Error("Fumigation log not found");
        await db.update(fumigationLogs).set(data).where(eq(fumigationLogs.id, id));
        await writeAudit(db, {
          actor: operator,
          action: "update",
          entityType: "fumigation_log",
          entityId: id,
          before,
          after: data,
        });
        return db.query.fumigationLogs.findFirst({ where: eq(fumigationLogs.id, id) });
      }),
  }),

  // ---------------------------------------------------- certificates (#20)
  certificates: createRouter({
    list: publicQuery
      .input(
        z
          .object({
            siteId: z.number().optional(),
            type: z.string().optional(),
            status: z.string().optional(),
            lotId: z.number().optional(),
            shipmentId: z.number().optional(),
          })
          .optional(),
      )
      .query(async ({ input }) => {
        const db = getDb();
        const conds: SQL[] = [];
        if (input?.siteId) conds.push(eq(certificates.siteId, input.siteId));
        if (input?.type) conds.push(eq(certificates.type, input.type));
        if (input?.status) conds.push(eq(certificates.status, input.status));
        if (input?.lotId) conds.push(eq(certificates.lotId, input.lotId));
        if (input?.shipmentId) conds.push(eq(certificates.shipmentId, input.shipmentId));
        const rows = await db
          .select({
            certificate: certificates,
            lotCode: lots.code,
            siteName: sites.name,
          })
          .from(certificates)
          .leftJoin(lots, eq(certificates.lotId, lots.id))
          .leftJoin(sites, eq(certificates.siteId, sites.id))
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(desc(certificates.issuedAt), desc(certificates.id));
        return rows.map((r) => ({ ...r.certificate, lotCode: r.lotCode, siteName: r.siteName }));
      }),
    get: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const db = getDb();
      const row = await db.query.certificates.findFirst({ where: eq(certificates.id, input.id) });
      if (!row) throw new Error("Certificate not found");
      return row;
    }),
    // Issue a new certificate (status 'issued').
    create: publicQuery
      .input(certificateSchema.omit({ status: true }))
      .mutation(async ({ input, ctx }) => {
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const [{ id }] = await db
          .insert(certificates)
          .values({
            siteId: input.siteId,
            type: input.type,
            certNumber: input.certNumber,
            issuedAt: input.issuedAt,
            status: "issued",
            lotId: input.lotId ?? null,
            shipmentId: input.shipmentId ?? null,
            note: input.note ?? null,
            fileRef: input.fileRef ?? null,
          })
          .$returningId();
        await writeAudit(db, {
          actor: operator,
          action: "create",
          entityType: "certificate",
          entityId: id,
          after: input,
        });
        return db.query.certificates.findFirst({ where: eq(certificates.id, id) });
      }),
    // Reprint (#20 / warehouse-examiner DUPLICATE rule): the old row is kept
    // and marked 'reprinted'; a new revision row is created (status 'issued',
    // note carries the DUPLICATE marker). One transaction.
    reprint: publicQuery
      .input(z.object({ id: z.number(), note: z.string().max(4000).optional() }))
      .mutation(async ({ input, ctx }) => {
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const before = await db.query.certificates.findFirst({
          where: eq(certificates.id, input.id),
        });
        if (!before) throw new Error("Certificate not found");
        if (before.status === "void") throw new Error("Voided certificates cannot be reprinted");
        const newId = await db.transaction(async (tx) => {
          await tx
            .update(certificates)
            .set({ status: "reprinted" })
            .where(eq(certificates.id, before.id));
          const dupNote =
            `DUPLICATE — reprint of certificate ${before.certNumber} (#${before.id})` +
            (input.note ? ` — ${input.note}` : "");
          const [{ id }] = await tx
            .insert(certificates)
            .values({
              siteId: before.siteId,
              type: before.type,
              certNumber: before.certNumber,
              issuedAt: new Date(),
              status: "issued",
              lotId: before.lotId,
              shipmentId: before.shipmentId,
              note: dupNote,
              fileRef: before.fileRef,
            })
            .$returningId();
          await writeAudit(tx, {
            actor: operator,
            action: "update",
            entityType: "certificate",
            entityId: before.id,
            before: { status: before.status },
            after: { status: "reprinted" },
            note: dupNote,
          });
          await writeAudit(tx, {
            actor: operator,
            action: "create",
            entityType: "certificate",
            entityId: id,
            after: { certNumber: before.certNumber, reprintOf: before.id },
            note: dupNote,
          });
          return id;
        });
        return {
          original: await db.query.certificates.findFirst({
            where: eq(certificates.id, before.id),
          }),
          reprint: await db.query.certificates.findFirst({ where: eq(certificates.id, newId) }),
        };
      }),
    // Void a certificate (reason required; row kept, status 'void').
    void: publicQuery
      .input(z.object({ id: z.number(), voidReason: z.string().min(3) }))
      .mutation(async ({ input, ctx }) => {
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const before = await db.query.certificates.findFirst({
          where: eq(certificates.id, input.id),
        });
        if (!before) throw new Error("Certificate not found");
        if (before.status === "void") throw new Error("Certificate is already void");
        await db
          .update(certificates)
          .set({ status: "void", note: `${before.note ?? ""} [VOID: ${input.voidReason}]`.trim() })
          .where(eq(certificates.id, input.id));
        await writeAudit(db, {
          actor: operator,
          action: "void",
          entityType: "certificate",
          entityId: input.id,
          before: { status: before.status },
          after: { status: "void" },
          note: input.voidReason,
        });
        return db.query.certificates.findFirst({ where: eq(certificates.id, input.id) });
      }),
  }),

  // ----------------------------------------------------- lab results (#22)
  labResults: createRouter({
    list: publicQuery
      .input(
        z
          .object({
            siteId: z.number().optional(),
            lotId: z.number().optional(),
            loadId: z.number().optional(),
            binId: z.number().optional(),
            testType: z.string().optional(),
          })
          .optional(),
      )
      .query(async ({ input }) => {
        const db = getDb();
        const conds: SQL[] = [];
        if (input?.siteId) conds.push(eq(labResults.siteId, input.siteId));
        if (input?.lotId) conds.push(eq(labResults.lotId, input.lotId));
        if (input?.loadId) conds.push(eq(labResults.loadId, input.loadId));
        if (input?.binId) conds.push(eq(labResults.binId, input.binId));
        if (input?.testType) conds.push(eq(labResults.testType, input.testType));
        const rows = await db
          .select({ result: labResults, lotCode: lots.code, binName: bins.name, siteName: sites.name })
          .from(labResults)
          .leftJoin(lots, eq(labResults.lotId, lots.id))
          .leftJoin(bins, eq(labResults.binId, bins.id))
          .leftJoin(sites, eq(labResults.siteId, sites.id))
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(desc(labResults.sampleDate), desc(labResults.id));
        return rows.map((r) => ({
          ...r.result,
          lotCode: r.lotCode,
          binName: r.binName,
          siteName: r.siteName,
        }));
      }),
    // The contract schema enforces: at least one of lotId / loadId / binId.
    create: publicQuery.input(labResultSchema).mutation(async ({ input, ctx }) => {
      const db = getDb();
      const operator = await resolveOperator(db, ctx.operator);
      const [{ id }] = await db
        .insert(labResults)
        .values({
          siteId: input.siteId,
          sampleDate: input.sampleDate,
          labName: input.labName ?? null,
          testType: input.testType,
          result: input.result ?? null,
          passFail: input.passFail ?? null,
          lotId: input.lotId ?? null,
          loadId: input.loadId ?? null,
          binId: input.binId ?? null,
          note: input.note ?? null,
        })
        .$returningId();
      await writeAudit(db, {
        actor: operator,
        action: "create",
        entityType: "lab_result",
        entityId: id,
        after: input,
      });
      return db.query.labResults.findFirst({ where: eq(labResults.id, id) });
    }),
  }),

  // ---------------------------------------------- shrink entries (#15)
  // Append-only: a wrong entry is corrected by posting a REVERSING entry
  // (opposite sign), never edited — there is deliberately no update/delete.
  shrinkEntries: createRouter({
    list: publicQuery
      .input(
        z
          .object({
            siteId: z.number().optional(),
            binId: z.number().optional(),
            kind: z.string().optional(),
            dateFrom: z.string().optional(),
            dateTo: z.string().optional(),
          })
          .optional(),
      )
      .query(async ({ input }) => {
        const db = getDb();
        const conds: SQL[] = [];
        if (input?.siteId) conds.push(eq(shrinkEntries.siteId, input.siteId));
        if (input?.binId) conds.push(eq(shrinkEntries.binId, input.binId));
        if (input?.kind) conds.push(eq(shrinkEntries.kind, input.kind));
        if (input?.dateFrom) conds.push(gte(shrinkEntries.effectiveDate, startOfDay(parseDay(input.dateFrom))));
        if (input?.dateTo) conds.push(lte(shrinkEntries.effectiveDate, endOfDay(parseDay(input.dateTo))));
        const rows = await db
          .select({ entry: shrinkEntries, binName: bins.name, siteName: sites.name })
          .from(shrinkEntries)
          .leftJoin(bins, eq(shrinkEntries.binId, bins.id))
          .leftJoin(sites, eq(shrinkEntries.siteId, sites.id))
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(desc(shrinkEntries.effectiveDate), desc(shrinkEntries.id));
        return rows.map((r) => ({ ...r.entry, binName: r.binName, siteName: r.siteName }));
      }),
    create: publicQuery
      .input(shrinkEntrySchema.omit({ operator: true }))
      .mutation(async ({ input, ctx }) => {
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const bin = await db.query.bins.findFirst({ where: eq(bins.id, input.binId) });
        if (!bin) throw new Error("Bin not found");
        if (bin.siteId !== input.siteId) throw new Error("Bin belongs to another site");
        const [{ id }] = await db
          .insert(shrinkEntries)
          .values({
            siteId: input.siteId,
            binId: input.binId,
            kind: input.kind,
            quantityLbs: input.quantityLbs,
            effectiveDate: input.effectiveDate,
            note: input.note ?? null,
            operator,
          })
          .$returningId();
        await writeAudit(db, {
          actor: operator,
          action: input.quantityLbs < 0 ? "adjust" : "create",
          entityType: "shrink_entry",
          entityId: id,
          after: input,
        });
        return db.query.shrinkEntries.findFirst({ where: eq(shrinkEntries.id, id) });
      }),
  }),

  // ------------------------------------------ bin grade overrides (#18)
  // Append-only log; the latest row per (binId, factor) wins. Reason required.
  gradeOverrides: createRouter({
    list: publicQuery
      .input(z.object({ binId: z.number(), siteId: z.number().optional() }))
      .query(async ({ input }) => {
        const db = getDb();
        const rows = await db
          .select()
          .from(binGradeOverrides)
          .where(eq(binGradeOverrides.binId, input.binId))
          .orderBy(desc(binGradeOverrides.createdAt), desc(binGradeOverrides.id));
        return rows;
      }),
    set: publicQuery
      .input(binGradeOverrideSchema.omit({ operator: true }))
      .mutation(async ({ input, ctx }) => {
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const bin = await db.query.bins.findFirst({ where: eq(bins.id, input.binId) });
        if (!bin) throw new Error("Bin not found");
        if (bin.siteId !== input.siteId) throw new Error("Bin belongs to another site");
        const [{ id }] = await db
          .insert(binGradeOverrides)
          .values({
            siteId: input.siteId,
            binId: input.binId,
            factor: input.factor,
            value: input.value,
            reason: input.reason,
            operator,
          })
          .$returningId();
        await writeAudit(db, {
          actor: operator,
          action: "adjust",
          entityType: "bin",
          entityId: input.binId,
          after: { factor: input.factor, value: input.value },
          note: `Grade override: ${input.reason}`,
        });
        return db.query.binGradeOverrides.findFirst({ where: eq(binGradeOverrides.id, id) });
      }),
  }),

  // -------------------------------------- retention + exam mode (#9)
  retention: createRouter({
    get: publicQuery.query(async () => {
      const db = getDb();
      const raw = await getSetting(db, RETENTION_SETTINGS_KEY);
      const years = raw ? Number(raw) : DEFAULT_RETENTION_YEARS;
      return {
        years: Number.isFinite(years) ? years : DEFAULT_RETENTION_YEARS,
        defaultYears: DEFAULT_RETENTION_YEARS,
      };
    }),
    set: publicQuery
      .input(z.object({ adminPassword: z.string().optional(), years: retentionYearsSchema }))
      .mutation(async ({ input, ctx }) => {
        assertAdmin(input.adminPassword);
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const before = await getSetting(db, RETENTION_SETTINGS_KEY);
        await setSetting(db, RETENTION_SETTINGS_KEY, String(input.years));
        await writeAudit(db, {
          actor: operator,
          action: "update",
          entityType: "settings",
          entityId: 0,
          before: { [RETENTION_SETTINGS_KEY]: before || null },
          after: { [RETENTION_SETTINGS_KEY]: String(input.years) },
        });
        return { ok: true, years: input.years };
      }),
  }),

  exam: createRouter({
    // Exam-mode export (#9): one JSON manifest + CSV sections covering the
    // records a warehouse examiner asks for, in a date range. No zip — the
    // caller saves each section as its own .csv.
    export: publicQuery
      .input(
        z.object({
          from: z.string(), // YYYY-MM-DD
          to: z.string(),
          siteId: z.number().optional(),
          entityTypes: z
            .array(z.enum(["tickets", "movements", "shipments", "audit", "dpr"]))
            .min(1),
        }),
      )
      .query(async ({ input }) => {
        const db = getDb();
        const from = startOfDay(parseDay(input.from));
        const to = endOfDay(parseDay(input.to));
        const sections: Record<string, string> = {};
        const counts: Record<string, number> = {};

        if (input.entityTypes.includes("tickets")) {
          const rows = await db
            .select({ load: loads, sheet: weightSheets, farmerName: farmers.name, lotCode: lots.code })
            .from(loads)
            .innerJoin(weightSheets, eq(loads.sheetId, weightSheets.id))
            .leftJoin(farmers, eq(weightSheets.farmerId, farmers.id))
            .leftJoin(lots, eq(weightSheets.lotId, lots.id))
            .where(
              and(
                gte(loads.createdAt, from),
                lte(loads.createdAt, to),
                ...(input.siteId ? [eq(weightSheets.siteId, input.siteId)] : []),
              ),
            )
            .orderBy(asc(loads.createdAt), asc(loads.id));
          // voided rows ride along, marked — an examiner wants the full accounting
          const body = rows.map((r) => ({
            ticketNo: `${r.sheet.ticketNo}-${String(r.load.loadNo).padStart(2, "0")}`,
            siteId: r.sheet.siteId,
            direction: r.sheet.direction,
            farmer: r.farmerName,
            lotCode: r.lotCode,
            crop: r.sheet.crop,
            program: r.load.program,
            truckId: r.load.truckId,
            grossLbs: r.load.grossLbs,
            tareLbs: r.load.tareLbs,
            netLbs: r.load.netLbs,
            moisturePct: r.load.moisturePct,
            dockagePct: r.load.dockagePct,
            testWeightLbs: r.load.testWeightLbs,
            grade: r.load.grade,
            shrinkLbs: r.load.shrinkLbs,
            dockLbs: r.load.dockLbs,
            netBushels: r.load.netBushels,
            voidedAt: r.load.voidedAt,
            voidReason: r.load.voidReason,
            createdAt: r.load.createdAt,
          }));
          sections.tickets = toCsv(
            ["ticketNo","siteId","direction","farmer","lotCode","crop","program","truckId","grossLbs","tareLbs","netLbs","moisturePct","dockagePct","testWeightLbs","grade","shrinkLbs","dockLbs","netBushels","voidedAt","voidReason","createdAt"],
            body as unknown as Record<string, CsvValue>[],
          );
          counts.tickets = body.length;
        }

        if (input.entityTypes.includes("movements")) {
          const conds: SQL[] = [gte(binMovements.createdAt, from), lte(binMovements.createdAt, to)];
          if (input.siteId) conds.push(eq(binMovements.siteId, input.siteId));
          const rows = await db
            .select()
            .from(binMovements)
            .where(and(...conds))
            .orderBy(asc(binMovements.createdAt), asc(binMovements.id));
          sections.movements = toCsv(
            ["id","siteId","lotId","fromBinId","toBinId","quantityLbs","loadId","shipmentId","operator","note","createdAt"],
            rows as unknown as Record<string, CsvValue>[],
          );
          counts.movements = rows.length;
        }

        if (input.entityTypes.includes("shipments")) {
          const conds: SQL[] = [gte(shipments.createdAt, from), lte(shipments.createdAt, to)];
          if (input.siteId) conds.push(eq(shipments.siteId, input.siteId));
          const rows = await db
            .select()
            .from(shipments)
            .where(and(...conds))
            .orderBy(asc(shipments.createdAt), asc(shipments.id));
          sections.shipments = toCsv(
            ["id","siteId","customerName","destination","lotId","binId","quantityLbs","quantityBu","truckId","note","createdAt"],
            rows as unknown as Record<string, CsvValue>[],
          );
          counts.shipments = rows.length;
        }

        if (input.entityTypes.includes("audit")) {
          const rows = await db
            .select()
            .from(auditLog)
            .where(and(gte(auditLog.createdAt, from), lte(auditLog.createdAt, to)))
            .orderBy(asc(auditLog.createdAt), asc(auditLog.id));
          sections.audit = toCsv(
            ["id","actor","action","entityType","entityId","beforeJson","afterJson","note","createdAt"],
            rows as unknown as Record<string, CsvValue>[],
          );
          counts.audit = rows.length;
        }

        if (input.entityTypes.includes("dpr")) {
          const conds: SQL[] = [
            gte(dprSnapshots.day, input.from),
            lte(dprSnapshots.day, input.to),
          ];
          if (input.siteId) conds.push(eq(dprSnapshots.siteId, input.siteId));
          const rows = await db
            .select()
            .from(dprSnapshots)
            .where(and(...conds))
            .orderBy(asc(dprSnapshots.day), asc(dprSnapshots.siteId));
          sections.dpr = toCsv(
            ["siteId","day","crop","program","openingLbs","receivedLbs","receivedBu","shippedLbs","shippedBu","transfersInLbs","transfersOutLbs","shrinkMoistureLbs","shrinkHandlingLbs","shrinkAerationLbs","shrinkErrorCorrectionLbs","adjustmentsLbs","endingLbs","endingBu","frozen"],
            rows as unknown as Record<string, CsvValue>[],
          );
          counts.dpr = rows.length;
        }

        const retentionRaw = await getSetting(db, RETENTION_SETTINGS_KEY);
        return {
          manifest: {
            generatedAt: new Date(),
            from: input.from,
            to: input.to,
            siteId: input.siteId ?? null,
            retentionYears: Number(retentionRaw) || DEFAULT_RETENTION_YEARS,
            counts,
          },
          sections,
        };
      }),
  }),
});

export type ComplianceRouter = typeof complianceRouter;

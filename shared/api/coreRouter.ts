import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { adminGateOpen, assertAdmin, verifyAdminPassword } from "./lib/adminPassword";
import { sites, bins, loads, binMovements, lots, weightSheets, shipments } from "../db/schema";
import { and, asc, desc, eq, or } from "drizzle-orm";
import { CROPS } from "../contracts/grain";
import { writeAudit } from "./lib/audit";
import { recordMovement } from "./lib/movements";
import { listOperators, resolveOperator, saveOperators } from "./lib/operators";
import { binCompositionByLot, binTotalLbs } from "../contracts/provenance";
import { movementsForBin } from "./lib/movements";
import { cleanoutCutoff } from "./lib/cleanouts";
import { effectiveBinGrades } from "./lib/binGrades";

export const coreRouter = createRouter({
  // ------------------------------------------------------------- admin
  admin: createRouter({
    // Lets the frontend skip its unlock dialog / password fields while the
    // gate is open (ADMIN_PASSWORD unset or default — see lib/adminPassword).
    status: publicQuery.query(() => ({ passwordRequired: !adminGateOpen() })),
    // Mutation (not query) so the password travels in the POST body.
    verify: publicQuery
      .input(z.object({ password: z.string() }))
      .mutation(async ({ input }) => ({ ok: verifyAdminPassword(input.password) })),
  }),

  // --------------------------------------------------------- operators
  // The managed operator list (attribution, not auth — see lib/operators).
  operators: createRouter({
    list: publicQuery.query(() => listOperators(getDb())),
    add: publicQuery
      .input(z.object({ adminPassword: z.string(), name: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        assertAdmin(input.adminPassword);
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const names = await listOperators(db);
        if (names.some((n) => n.toLowerCase() === input.name.trim().toLowerCase())) {
          throw new Error(`Operator "${input.name.trim()}" is already on the list`);
        }
        await saveOperators(db, [...names, input.name]);
        const after = await listOperators(db);
        const added = after.find((n) => n.toLowerCase() === input.name.trim().toLowerCase());
        await writeAudit(db, {
          actor: operator,
          action: "create",
          entityType: "operator",
          entityId: after.length, // operators have no row id — position in list
          after: { name: added ?? input.name.trim() },
        });
        return { operators: after };
      }),
    remove: publicQuery
      .input(z.object({ adminPassword: z.string(), name: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        assertAdmin(input.adminPassword);
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const names = await listOperators(db);
        const next = names.filter((n) => n.toLowerCase() !== input.name.trim().toLowerCase());
        if (next.length === names.length) throw new Error("Operator not found");
        await saveOperators(db, next);
        await writeAudit(db, {
          actor: operator,
          action: "update",
          entityType: "operator",
          entityId: names.length,
          before: { operators: names },
          after: { operators: next },
          note: `Removed operator "${input.name.trim()}"`,
        });
        return { operators: next };
      }),
  }),

  // ------------------------------------------------------------- sites
  sites: createRouter({
    list: publicQuery.query(() => getDb().select().from(sites).orderBy(sites.name)),
    create: publicQuery
      .input(
        z.object({
          adminPassword: z.string(),
          name: z.string().min(1),
          location: z.string().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertAdmin(input.adminPassword);
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const [{ id }] = await db
          .insert(sites)
          .values({ name: input.name, location: input.location })
          .$returningId();
        await writeAudit(db, {
          actor: operator,
          action: "create",
          entityType: "site",
          entityId: id,
          after: { name: input.name, location: input.location ?? null },
        });
        return db.query.sites.findFirst({ where: eq(sites.id, id) });
      }),
    update: publicQuery
      .input(
        z.object({
          adminPassword: z.string(),
          id: z.number(),
          name: z.string().min(1).optional(),
          location: z.string().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const { id, adminPassword, ...data } = input;
        assertAdmin(adminPassword);
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        if (Object.keys(data).length === 0) throw new Error("Nothing to update");
        const before = await db.query.sites.findFirst({ where: eq(sites.id, id) });
        if (!before) throw new Error("Site not found");
        await db.update(sites).set(data).where(eq(sites.id, id));
        await writeAudit(db, {
          actor: operator,
          action: "update",
          entityType: "site",
          entityId: id,
          before: { name: before.name, location: before.location },
          after: data,
        });
        return db.query.sites.findFirst({ where: eq(sites.id, id) });
      }),
  }),

  // -------------------------------------------------------------- bins
  bins: createRouter({
    list: publicQuery
      .input(
        z
          .object({
            siteId: z.number().optional(),
            // #17 — filter by identity-preserved program
            program: z.string().optional(),
          })
          .optional(),
      )
      .query(async ({ input }) => {
        const db = getDb();
        const conds = [];
        if (input?.siteId) conds.push(eq(bins.siteId, input.siteId));
        if (input?.program) conds.push(eq(bins.program, input.program));
        const rows = await db
          .select({ bin: bins, siteName: sites.name })
          .from(bins)
          .leftJoin(sites, eq(bins.siteId, sites.id))
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(sites.name, bins.name);
        return rows.map((r) => ({ ...r.bin, siteName: r.siteName }));
      }),
    create: publicQuery
      .input(
        z.object({
          adminPassword: z.string(),
          siteId: z.number(),
          name: z.string().min(1),
          crop: z.enum(CROPS),
          capacityLbs: z.number().int().positive(),
          program: z.string().trim().min(1).max(32).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertAdmin(input.adminPassword);
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const { adminPassword, ...bin } = input;
        const [{ id }] = await db.insert(bins).values(bin).$returningId();
        await writeAudit(db, {
          actor: operator,
          action: "create",
          entityType: "bin",
          entityId: id,
          after: bin,
        });
        return db.query.bins.findFirst({ where: eq(bins.id, id) });
      }),
    update: publicQuery
      .input(
        z.object({
          adminPassword: z.string(),
          id: z.number(),
          name: z.string().min(1).optional(),
          crop: z.enum(CROPS).optional(),
          capacityLbs: z.number().int().positive().optional(),
          program: z.string().trim().min(1).max(32).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const { id, adminPassword, ...data } = input;
        assertAdmin(adminPassword);
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const before = await db.query.bins.findFirst({ where: eq(bins.id, id) });
        if (!before) throw new Error("Bin not found");
        await db.update(bins).set(data).where(eq(bins.id, id));
        await writeAudit(db, {
          actor: operator,
          action: "update",
          entityType: "bin",
          entityId: id,
          before: { name: before.name, crop: before.crop, capacityLbs: before.capacityLbs, program: before.program },
          after: data,
        });
        return db.query.bins.findFirst({ where: eq(bins.id, id) });
      }),

    // Bin detail (#18): composition replay + effective grade factors
    // (lbs-weighted average with the latest manual override per factor
    // applied, marked as override). The replay is bounded by the bin's
    // latest completed cleanout (#12).
    get: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const db = getDb();
      const bin = await db.query.bins.findFirst({ where: eq(bins.id, input.id) });
      if (!bin) throw new Error("Bin not found");
      const cutoff = await cleanoutCutoff(db, bin.id);
      const events = await movementsForBin(db, bin.id);
      const composition = binCompositionByLot(events, bin.id, cutoff);
      const grades = await effectiveBinGrades(db, bin.id);
      return {
        ...bin,
        composition,
        logTotalLbs: binTotalLbs(events, bin.id, cutoff),
        grades: grades.factors,
        gradeTotalLbs: grades.totalLbs,
        cleanoutCutoff: cutoff,
      };
    }),

    // Segregation-aware routing suggestion (Phase B, #16) — ranked candidate
    // bins for an inbound load. PURE QUERY, no auto-assignment:
    //   1. same crop is required (other crops are not candidates)
    //   2. same program ranks first; a different program is flagged as a
    //      segregation conflict (identity preservation, #17)
    //   3. when moisturePct is given, bins whose current contents average
    //      within ±1 point are marked grade-compatible
    //   4. empty bins and bins cleaned since their last fill are flagged
    suggest: publicQuery
      .input(
        z.object({
          siteId: z.number(),
          crop: z.string().min(1),
          program: z.string().trim().max(32).optional(),
          moisturePct: z.number().min(0).max(60).optional(),
          grade: z.string().max(32).optional(),
        }),
      )
      .query(async ({ input }) => {
        const db = getDb();
        const rows = await db
          .select()
          .from(bins)
          .where(and(eq(bins.siteId, input.siteId), eq(bins.crop, input.crop)))
          .orderBy(asc(bins.name));

        type Candidate = {
          bin: (typeof rows)[number];
          rank: number;
          programMatch: boolean;
          empty: boolean;
          cleaned: boolean;
          gradeCompatible: boolean | null;
          capacityRemainingLbs: number;
          reasons: string[];
        };
        const candidates: Candidate[] = [];
        for (const bin of rows) {
          const reasons: string[] = [];
          const empty = bin.currentLbs === 0;
          const cutoff = await cleanoutCutoff(db, bin.id);
          // cleaned since last fill = empty (or refilled) AFTER a completed cleanout
          let cleaned = false;
          if (cutoff) {
            const events = await movementsForBin(db, bin.id);
            const lastFill = events.filter((e) => e.toBinId === bin.id).pop() ?? null;
            cleaned = !lastFill || lastFill.createdAt > cutoff;
          }
          const programMatch = input.program == null || bin.program === input.program;
          if (input.program != null && !programMatch) {
            reasons.push(`program mismatch — bin is '${bin.program}', load is '${input.program}' (segregation)`);
          }
          if (empty) reasons.push("bin is empty");
          if (cleaned) reasons.push("cleaned since last fill");
          if (!empty && !cleaned) reasons.push("holds current-crop grain");

          // grade compatibility vs current contents (only when measurable)
          let gradeCompatible: boolean | null = null;
          if (input.moisturePct != null && !empty) {
            const grades = await effectiveBinGrades(db, bin.id);
            const avg = grades.factors.moisturePct;
            if (avg) {
              const diff = Math.abs(avg.value - input.moisturePct);
              gradeCompatible = diff <= 1.0;
              reasons.push(
                gradeCompatible
                  ? `moisture compatible (bin avg ${avg.value}%, load ${input.moisturePct}%)`
                  : `moisture differs (bin avg ${avg.value}% vs load ${input.moisturePct}%)`,
              );
            } else {
              reasons.push("contents have no moisture readings to compare");
            }
          }

          candidates.push({
            bin,
            rank: 0, // computed below
            programMatch,
            empty,
            cleaned,
            gradeCompatible,
            capacityRemainingLbs: bin.capacityLbs - bin.currentLbs,
            reasons,
          });
        }

        // rank: program match first, then grade compatibility, then
        // cleaned/empty bins, then most remaining capacity
        const score = (c: Candidate) =>
          (c.programMatch ? 100 : 0) +
          (c.gradeCompatible === true ? 20 : c.gradeCompatible === null ? 10 : 0) +
          (c.cleaned ? 5 : 0) +
          (c.empty ? 3 : 0);
        candidates.sort((a, b) => score(b) - score(a) || b.capacityRemainingLbs - a.capacityRemainingLbs);
        candidates.forEach((c, i) => (c.rank = i + 1));
        return { crop: input.crop, program: input.program ?? null, candidates };
      }),
    // Delete an empty bin with no ticket history
    delete: publicQuery
      .input(z.object({ adminPassword: z.string(), id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        assertAdmin(input.adminPassword);
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const bin = await db.query.bins.findFirst({ where: eq(bins.id, input.id) });
        if (!bin) throw new Error("Bin not found");
        if (bin.currentLbs > 0)
          throw new Error("Bin is not empty — adjust the level to 0 before deleting");
        const refs = await db
          .select({ id: loads.id })
          .from(loads)
          .where(eq(loads.binId, input.id))
          .limit(1);
        if (refs.length) throw new Error("Bin has load history and cannot be deleted");
        await db.delete(bins).where(eq(bins.id, input.id));
        await writeAudit(db, {
          actor: operator,
          action: "update",
          entityType: "bin",
          entityId: input.id,
          before: { name: bin.name, crop: bin.crop, capacityLbs: bin.capacityLbs },
          note: "Bin deleted (was empty, no load history)",
        });
        return { ok: true };
      }),
    // Manual level correction (e.g. after physical measurement). A reason is
    // required: the correction moves inventory, so it writes BOTH an
    // audit_log 'adjust' row (before/after lbs) and a lot-less bin_movements
    // row, keeping provenance replay reconcilable with the bin cache
    // (review 8.9 / P1-6).
    adjust: publicQuery
      .input(
        z.object({
          adminPassword: z.string(),
          id: z.number(),
          currentLbs: z.number().int().min(0),
          reason: z.string().min(3, "A reason is required for a level adjustment"),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertAdmin(input.adminPassword);
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const bin = await db.query.bins.findFirst({ where: eq(bins.id, input.id) });
        if (!bin) throw new Error("Bin not found");
        const beforeLbs = bin.currentLbs;
        const delta = input.currentLbs - beforeLbs;
        await db.transaction(async (tx) => {
          await tx
            .update(bins)
            .set({ currentLbs: input.currentLbs })
            .where(eq(bins.id, input.id));
          if (delta !== 0) {
            // lot-less adjustment event (unknown-origin grain) — direction
            // follows the sign of the correction
            await recordMovement(tx, {
              siteId: bin.siteId,
              lotId: null,
              fromBinId: delta < 0 ? bin.id : null,
              toBinId: delta > 0 ? bin.id : null,
              quantityLbs: Math.abs(delta),
              operator,
              note: `Manual level adjustment: ${input.reason}`,
            });
          }
          await writeAudit(tx, {
            actor: operator,
            action: "adjust",
            entityType: "bin",
            entityId: bin.id,
            before: { currentLbs: beforeLbs },
            after: { currentLbs: input.currentLbs },
            note: input.reason,
          });
        });
        return db.query.bins.findFirst({ where: eq(bins.id, input.id) });
      }),
    // Movement history for one bin (Phase 5 bin-detail / provenance view):
    // newest-first bin_movements rows touching the bin, enriched with the
    // lot code, bin names, the linked ticket/load, and shipment. Bin names
    // are resolved in JS (the bin list is tiny) to keep the SQL portable
    // across the MySQL / offline-SQLite dialect shim.
    movements: publicQuery
      .input(
        z.object({
          binId: z.number(),
          limit: z.number().int().min(1).max(500).default(100),
        }),
      )
      .query(async ({ input }) => {
        const db = getDb();
        const rows = await db
          .select({
            movement: binMovements,
            lotCode: lots.code,
            ticketNo: weightSheets.ticketNo,
            loadNo: loads.loadNo,
            shipmentCustomer: shipments.customerName,
          })
          .from(binMovements)
          .leftJoin(lots, eq(binMovements.lotId, lots.id))
          .leftJoin(loads, eq(binMovements.loadId, loads.id))
          .leftJoin(weightSheets, eq(loads.sheetId, weightSheets.id))
          .leftJoin(shipments, eq(binMovements.shipmentId, shipments.id))
          .where(
            or(eq(binMovements.fromBinId, input.binId), eq(binMovements.toBinId, input.binId)),
          )
          .orderBy(desc(binMovements.createdAt), desc(binMovements.id))
          .limit(input.limit);
        const binRows = await db.select({ id: bins.id, name: bins.name }).from(bins);
        const nameById = new Map(binRows.map((b) => [b.id, b.name]));
        return rows.map((r) => ({
          ...r.movement,
          lotCode: r.lotCode,
          fromBinName: r.movement.fromBinId != null ? (nameById.get(r.movement.fromBinId) ?? null) : null,
          toBinName: r.movement.toBinId != null ? (nameById.get(r.movement.toBinId) ?? null) : null,
          ticketNo: r.ticketNo,
          loadNo: r.loadNo,
          shipmentCustomer: r.shipmentCustomer,
        }));
      }),
  }),
});

export type CoreRouter = typeof coreRouter;

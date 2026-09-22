import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  weightSheets,
  loads,
  sheetEvents,
  farmers,
  landlords,
  lots,
  sites,
  bins,
} from "../db/schema";
import { and, asc, desc, eq, gte, inArray, isNull, like, lte, or, sql, type SQL } from "drizzle-orm";
import { computeBushels, round2 } from "../contracts/grain";
import { pushEod, getSetting } from "./officeSync";
import { assertAdmin } from "./lib/adminPassword";
import { writeAudit } from "./lib/audit";
import { recordMovement } from "./lib/movements";
import { resolveOperator } from "./lib/operators";

const STATUS = z.enum(["OPEN", "FULL", "CLOSED"]);

async function logEvent(sheetId: number, action: string, detail?: string, loadId?: number | null) {
  await getDb()
    .insert(sheetEvents)
    .values({ sheetId, loadId: loadId ?? null, action, detail: detail ?? null });
}

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

/**
 * Parse a "YYYY-MM-DD" filter as local midnight. `new Date(str)` would parse
 * it as UTC, so on any server behind UTC the operator's "Sep 1" report would
 * silently aggregate Aug 31.
 */
function parseDay(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
    return new Date(y, m - 1, d);
  }
  return new Date(s);
}

/**
 * Escape LIKE wildcards in user-supplied search text (P1-12): without this a
 * search for "50%" or "TRK_1" silently becomes a wildcard match. MySQL treats
 * backslash as the LIKE escape by default; the SQLite offline mirror has no
 * default escape char, so a literal backslash in the needle may not match
 * there — acceptable for a dev-only path, search terms with \ % _ are rare
 * at a scale house.
 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** An open transaction on the shared db handle. */
type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

/**
 * Move bin inventory by a delta with one atomic SQL statement. The previous
 * read-modify-write form lost updates whenever two weigh-outs (or a manual
 * adjust) touched the same bin concurrently — a snapshot read inside the
 * transaction does not lock the row on MySQL. GREATEST clamps at empty; the
 * offline SQLite connection registers a GREATEST scalar to match.
 */
function applyToBin(tx: Tx, binId: number, deltaLbs: number) {
  return tx
    .update(bins)
    .set({ currentLbs: sql`GREATEST(0, ${bins.currentLbs} + ${deltaLbs})` })
    .where(eq(bins.id, binId));
}

/** Find a bin at the site for this crop with room for `needLbs`. */
async function findBinFor(siteId: number, crop: string, needLbs: number) {
  const db = getDb();
  const candidates = await db
    .select()
    .from(bins)
    .where(and(eq(bins.siteId, siteId), eq(bins.crop, crop)))
    .orderBy(asc(bins.currentLbs));
  return (
    candidates.find((b) => b.capacityLbs - b.currentLbs >= needLbs) ?? candidates[0] ?? null
  );
}

// --------------------------------------------------------------- joins
const sheetSelect = {
  sheet: weightSheets,
  farmerName: farmers.name,
  lotCode: lots.code,
  lotSplitPct: lots.landlordSplitPct,
  lotStatus: lots.status,
  landlordName: landlords.name,
  siteName: sites.name,
};

function joinSheetTables(db: ReturnType<typeof getDb>) {
  return db
    .select(sheetSelect)
    .from(weightSheets)
    .leftJoin(farmers, eq(weightSheets.farmerId, farmers.id))
    .leftJoin(lots, eq(weightSheets.lotId, lots.id))
    .leftJoin(landlords, eq(weightSheets.landlordId, landlords.id))
    .leftJoin(sites, eq(weightSheets.siteId, sites.id));
}

type JoinedSheetRow = {
  sheet: typeof weightSheets.$inferSelect;
  farmerName: string | null;
  lotCode: string | null;
  lotSplitPct: number | null;
  lotStatus: "OPEN" | "CLOSED" | null;
  landlordName: string | null;
  siteName: string | null;
};

type LoadRowT = typeof loads.$inferSelect;

async function fetchLoads(
  db: ReturnType<typeof getDb>,
  sheetIds: number[],
  includeVoided = false,
) {
  if (sheetIds.length === 0) return new Map<number, (LoadRowT & { binName: string | null })[]>();
  const rows = await db
    .select({ load: loads, binName: bins.name })
    .from(loads)
    .leftJoin(bins, eq(loads.binId, bins.id))
    // VOID-instead-of-delete (Phase 4): voided loads stay in the table for
    // audit but are invisible to sheets, totals, and reports — unless the
    // caller explicitly asks for them (sheet-detail "show voided" toggle).
    .where(
      includeVoided
        ? inArray(loads.sheetId, sheetIds)
        : and(inArray(loads.sheetId, sheetIds), isNull(loads.voidedAt)),
    )
    .orderBy(asc(loads.loadNo));
  const map = new Map<number, (LoadRowT & { binName: string | null })[]>();
  for (const r of rows) {
    const arr = map.get(r.load.sheetId) ?? [];
    arr.push({ ...r.load, binName: r.binName });
    map.set(r.load.sheetId, arr);
  }
  return map;
}

function toSheetRow(
  r: JoinedSheetRow,
  sheetLoads: (LoadRowT & { binName: string | null })[],
  includeLoads: boolean,
) {
  // Aggregates NEVER count voided loads, even when the caller asked for the
  // voided rows to be included in the loads array (audit view).
  const live = sheetLoads.filter((l) => l.voidedAt == null);
  const completed = live.filter((l) => l.netLbs != null);
  const activeLoad = live.find((l) => l.netLbs == null) ?? null;
  const last = live[live.length - 1];
  return {
    ...r.sheet,
    farmerName: r.farmerName,
    lotCode: r.lotCode,
    lotSplitPct: r.lotSplitPct,
    lotStatus: r.lotStatus,
    landlordName: r.landlordName,
    siteName: r.siteName,
    loadCount: live.length,
    completedLoads: completed.length,
    netLbs: completed.reduce((a, l) => a + (l.netLbs ?? 0), 0),
    netBushels: round2(completed.reduce((a, l) => a + (l.netBushels ?? 0), 0)),
    activeLoad,
    lastTruckId: last?.truckId ?? null,
    ...(includeLoads ? { loads: sheetLoads } : {}),
  };
}

/** Load the in-progress load (second weight still pending) for a sheet. */
async function activeLoadOf(db: ReturnType<typeof getDb>, sheetId: number) {
  const rows = await db.select().from(loads).where(eq(loads.sheetId, sheetId));
  return rows.find((l) => l.netLbs == null && l.voidedAt == null) ?? null;
}

export const sheetsRouter = createRouter({
  // ----------------------------------------------------- archive search
  list: publicQuery
    .input(
      z
        .object({
          search: z.string().optional(),
          siteId: z.number().optional(),
          farmerId: z.number().optional(),
          lotId: z.number().optional(),
          landlordId: z.number().optional(),
          crop: z.string().optional(),
          /** #17 — filter by the lot's identity-preserved program */
          program: z.string().optional(),
          status: STATUS.optional(),
          dateFrom: z.string().optional(), // YYYY-MM-DD
          dateTo: z.string().optional(),
          /** audit/archive view: also return voided sheets (marked in the UI) */
          includeVoided: z.boolean().optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      // voided sheets stay in the archive table but out of every list,
      // unless the caller explicitly asks for them ("show voided" toggle)
      const conds: (SQL | undefined)[] = input?.includeVoided
        ? []
        : [isNull(weightSheets.voidedAt)];
      const q = input?.search?.trim();
      if (q) {
        const p = `%${escapeLike(q)}%`;
        // trucks/drivers live on loads now — find matching sheets there too
        const loadHits = await db
          .select({ sheetId: loads.sheetId })
          .from(loads)
          .where(or(like(loads.truckId, p), like(loads.driverName, p)));
        const hitIds = [...new Set(loadHits.map((h) => h.sheetId))];
        conds.push(
          or(
            like(farmers.name, p),
            like(lots.code, p),
            like(landlords.name, p),
            like(weightSheets.ticketNo, p),
            ...(hitIds.length ? [inArray(weightSheets.id, hitIds)] : []),
          ),
        );
      }
      if (input?.siteId) conds.push(eq(weightSheets.siteId, input.siteId));
      if (input?.farmerId) conds.push(eq(weightSheets.farmerId, input.farmerId));
      if (input?.lotId) conds.push(eq(weightSheets.lotId, input.lotId));
      if (input?.landlordId) conds.push(eq(weightSheets.landlordId, input.landlordId));
      if (input?.crop) conds.push(eq(weightSheets.crop, input.crop));
      if (input?.program) conds.push(eq(lots.program, input.program));
      if (input?.status) conds.push(eq(weightSheets.status, input.status));
      if (input?.dateFrom) conds.push(gte(weightSheets.createdAt, startOfDay(parseDay(input.dateFrom))));
      if (input?.dateTo) conds.push(lte(weightSheets.createdAt, endOfDay(parseDay(input.dateTo))));

      const rows = await joinSheetTables(db)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(weightSheets.createdAt))
        .limit(input?.limit ?? 200);
      const typed = rows as JoinedSheetRow[];
      const loadMap = await fetchLoads(db, typed.map((r) => r.sheet.id));
      return typed.map((r) => toSheetRow(r, loadMap.get(r.sheet.id) ?? [], false));
    }),

  // --------------------------------------- dashboard: open sheet queue
  open: publicQuery
    .input(z.object({ siteId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await joinSheetTables(db)
        .where(
          input?.siteId
            ? and(eq(weightSheets.status, "OPEN"), eq(weightSheets.siteId, input.siteId))
            : eq(weightSheets.status, "OPEN"),
        )
        .orderBy(asc(weightSheets.createdAt));
      const typed = rows as JoinedSheetRow[];
      const loadMap = await fetchLoads(db, typed.map((r) => r.sheet.id));
      return typed.map((r) => toSheetRow(r, loadMap.get(r.sheet.id) ?? [], true));
    }),

  get: publicQuery
    .input(
      z.object({
        id: z.number(),
        /** sheet-detail "show voided" toggle — voided loads included, marked */
        includeVoided: z.boolean().optional(),
      }),
    )
    .query(async ({ input }) => {
    const db = getDb();
    const rows = await joinSheetTables(db).where(eq(weightSheets.id, input.id));
    const typed = rows as JoinedSheetRow[];
    if (!typed[0]) throw new Error("Sheet not found");
    const loadMap = await fetchLoads(db, [input.id], input.includeVoided === true);
    const events = await db
      .select()
      .from(sheetEvents)
      .where(eq(sheetEvents.sheetId, input.id))
      .orderBy(desc(sheetEvents.createdAt));
    return { sheet: toSheetRow(typed[0], loadMap.get(input.id) ?? [], true), events };
  }),

  // ------------------------------------------------------------- create
  // A weight sheet is always opened against a lot (inbound). Outbound sheets
  // may go lot-less with an explicit farmer + crop.
  create: publicQuery
    .input(
      z.object({
        siteId: z.number(),
        lotId: z.number().nullable().optional(),
        farmerId: z.number().optional(),
        crop: z.string().min(1).optional(),
        direction: z.enum(["INBOUND", "OUTBOUND"]).default("INBOUND"),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const operator = await resolveOperator(db, ctx.operator);
      let farmerId = input.farmerId ?? null;
      let landlordId: number | null = null;
      let crop = input.crop ?? null;

      if (input.lotId) {
        const lot = await db.query.lots.findFirst({ where: eq(lots.id, input.lotId) });
        if (!lot) throw new Error("Lot not found");
        if (lot.status === "CLOSED") {
          throw new Error(
            `Lot ${lot.code} is closed — the grower must open a new lot before more sheets can be started.`,
          );
        }
        farmerId = lot.farmerId;
        landlordId = lot.landlordId ?? null;
        crop = lot.crop;
      } else if (input.direction === "INBOUND") {
        throw new Error("Pick an open lot for this farmer first — inbound sheets tie to a lot.");
      }
      if (!farmerId || !crop) throw new Error("Farmer and crop are required");

      // Two terminals opening a sheet at the same moment used to collide on
      // the unique ticketNo because every insert started life as the literal
      // "PENDING". Now the placeholder is unique per attempt (uuid-derived),
      // and the real ticket number is assigned from the row id inside the
      // SAME transaction — concurrent creates can no longer collide, and a
      // crash can't strand a PENDING row.
      const placeholder = `P-${randomUUID().replace(/-/g, "").slice(0, 29)}`;
      const { id, ticketNo } = await db.transaction(async (tx) => {
        const [{ id }] = await tx
          .insert(weightSheets)
          .values({
            ticketNo: placeholder,
            siteId: input.siteId,
            farmerId,
            lotId: input.lotId ?? null,
            landlordId,
            crop,
            direction: input.direction,
            notes: input.notes || null,
          })
          .$returningId();
        const ticketNo = `T-${String(id).padStart(5, "0")}`;
        await tx.update(weightSheets).set({ ticketNo }).where(eq(weightSheets.id, id));
        return { id, ticketNo };
      });
      await logEvent(id, "CREATED", `Weight sheet ${ticketNo} opened (${input.direction})`);
      await writeAudit(db, {
        actor: operator,
        action: "create",
        entityType: "weight_sheet",
        entityId: id,
        after: { ticketNo, siteId: input.siteId, farmerId, lotId: input.lotId ?? null, crop, direction: input.direction },
      });
      return { id, ticketNo };
    }),

  // ---------------------------------------------------- weigh in / out
  // First weight starts a new load row on the sheet (loaded truck for
  // INBOUND, empty truck for OUTBOUND).
  weighFirst: publicQuery
    .input(
      z.object({
        id: z.number(),
        weightLbs: z.number().int().positive(),
        truckId: z.string().min(1, "A truck ID is required at weigh-in"),
        driverName: z.string().optional(),
        binId: z.number().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const s = await db.query.weightSheets.findFirst({ where: eq(weightSheets.id, input.id) });
      if (!s) throw new Error("Sheet not found");
      if (s.voidedAt) throw new Error("Sheet is voided");
      if (s.status === "CLOSED") throw new Error("Sheet is closed for the day");
      if (s.status === "FULL")
        throw new Error(`Sheet is full (${s.maxLoads}/${s.maxLoads} loads) — open a new sheet for this lot`);

      const operator = await resolveOperator(db, ctx.operator);

      if (input.binId != null) {
        const bin = await db.query.bins.findFirst({ where: eq(bins.id, input.binId) });
        if (!bin) throw new Error("Destination bin not found");
        if (bin.siteId !== s.siteId) throw new Error("Destination bin belongs to another site");
      }

      const isInbound = s.direction === "INBOUND";
      // Check + insert inside a transaction, backed by the unique
      // (sheetId, loadNo) index: a double-click or a second terminal can no
      // longer create two "on the scale" loads, which would strand one.
      const { loadId, loadNo } = await db.transaction(async (tx) => {
        const existing = await tx.select().from(loads).where(eq(loads.sheetId, input.id));
        // Voided loads keep their rows (and loadNo) but no longer occupy a
        // slot on the sheet or block the scale.
        const live = existing.filter((l) => l.voidedAt == null);
        if (live.some((l) => l.netLbs == null))
          throw new Error("A load is still on the scale — weigh it out first");
        if (live.length >= s.maxLoads)
          throw new Error(`Sheet already has ${s.maxLoads} loads — open a new sheet for this lot`);

        // loadNo comes from ALL loads (incl. voided) so the unique
        // (sheetId, loadNo) index can never collide with a voided row.
        const loadNo = Math.max(0, ...existing.map((l) => l.loadNo)) + 1;
        // program denormalized from the lot at intake (#17) for reporting
        let program = "conventional";
        if (s.lotId != null) {
          const lot = await tx.query.lots.findFirst({ where: eq(lots.id, s.lotId) });
          program = lot?.program ?? program;
        }
        const [{ id: loadId }] = await tx
          .insert(loads)
          .values({
            sheetId: input.id,
            loadNo,
            truckId: input.truckId,
            driverName: input.driverName || null,
            binId: input.binId ?? null,
            program,
            ...(isInbound
              ? { grossLbs: input.weightLbs, grossAt: new Date() }
              : { tareLbs: input.weightLbs, tareAt: new Date() }),
          })
          .$returningId();
        return { loadId, loadNo };
      });
      await logEvent(
        input.id,
        isInbound ? "WEIGH_IN" : "WEIGH_IN_EMPTY",
        `Load ${loadNo} · ${input.weightLbs.toLocaleString()} lbs captured · ${input.truckId}`,
        loadId,
      );
      await writeAudit(db, {
        actor: operator,
        action: "create",
        entityType: "load",
        entityId: loadId,
        after: {
          sheetId: input.id,
          loadNo,
          truckId: input.truckId,
          firstWeightLbs: input.weightLbs,
          direction: s.direction,
        },
      });
      return { ok: true, loadId, loadNo };
    }),

  weighSecond: publicQuery
    .input(
      z.object({
        id: z.number(),
        weightLbs: z.number().int().positive(),
        binId: z.number().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const s = await db.query.weightSheets.findFirst({ where: eq(weightSheets.id, input.id) });
      if (!s) throw new Error("Sheet not found");
      if (s.voidedAt) throw new Error("Sheet is voided");
      if (s.status !== "OPEN") throw new Error("Sheet is not open for loads");
      const load = await activeLoadOf(db, input.id);
      if (!load) throw new Error("No load waiting on the scale — weigh in first");

      const operator = await resolveOperator(db, ctx.operator);

      const isInbound = s.direction === "INBOUND";
      if (isInbound && load.grossLbs == null) throw new Error("Weigh in first");
      if (!isInbound && load.tareLbs == null) throw new Error("Weigh in (empty) first");

      const gross = isInbound ? (load.grossLbs as number) : input.weightLbs;
      const tare = isInbound ? input.weightLbs : (load.tareLbs as number);
      const netLbs = gross - tare;
      if (netLbs <= 0) throw new Error("Net weight must be positive — check scale readings");

      if (input.binId != null) {
        const picked = await db.query.bins.findFirst({ where: eq(bins.id, input.binId) });
        if (!picked) throw new Error("Destination bin not found");
        if (picked.siteId !== s.siteId) throw new Error("Destination bin belongs to another site");
      }

      // bin: explicit pick now, else the pick made at weigh-in, else auto
      let binId = input.binId ?? load.binId;
      if (!binId) {
        const bin = await findBinFor(s.siteId, s.crop, netLbs);
        binId = bin?.id ?? null;
      }

      const { grossBushels, shrinkPct, netBushels } = computeBushels(
        s.crop,
        netLbs,
        load.moisturePct,
        load.dockagePct,
      );

      let sheetFull = false;
      await db.transaction(async (tx) => {
        await tx
          .update(loads)
          .set(
            isInbound
              ? { tareLbs: tare, tareAt: new Date(), netLbs, binId, grossBushels, shrinkPct, netBushels }
              : { grossLbs: gross, grossAt: new Date(), netLbs, binId, grossBushels, shrinkPct, netBushels },
          )
          .where(eq(loads.id, load.id));
        if (binId) {
          // Atomic delta — a plain read-then-write here loses the other
          // truck's grain when two weigh-outs land on the same bin.
          const delta = isInbound ? netLbs : -netLbs;
          await applyToBin(tx, binId, delta);
          // Provenance event in the SAME transaction as the bin delta:
          // inbound → field/truck into the bin; outbound → bin to truck.
          await recordMovement(tx, {
            siteId: s.siteId,
            lotId: s.lotId,
            fromBinId: isInbound ? null : binId,
            toBinId: isInbound ? binId : null,
            quantityLbs: netLbs,
            loadId: load.id,
            operator,
            note: `Weigh-out ${s.ticketNo} load ${load.loadNo}`,
          });
        }
        await writeAudit(tx, {
          actor: operator,
          action: "update",
          entityType: "load",
          entityId: load.id,
          before: { grossLbs: load.grossLbs, tareLbs: load.tareLbs, netLbs: load.netLbs, binId: load.binId },
          after: { grossLbs: gross, tareLbs: tare, netLbs, binId },
        });
        // auto-close the sheet when the last slot fills
        const all = await tx.select().from(loads).where(eq(loads.sheetId, input.id));
        const done = all.filter((l) => l.voidedAt == null && (l.netLbs != null || l.id === load.id)).length;
        if (done >= s.maxLoads) {
          sheetFull = true;
          await tx
            .update(weightSheets)
            .set({ status: "FULL", closeReason: "FULL", closedAt: new Date() })
            .where(eq(weightSheets.id, input.id));
        }
      });
      await logEvent(
        input.id,
        isInbound ? "WEIGH_OUT" : "WEIGH_OUT_LOADED",
        `Load ${load.loadNo} · ${input.weightLbs.toLocaleString()} lbs → net ${netLbs.toLocaleString()} lbs` +
          (binId ? ` → bin #${binId}` : " (no bin assigned)"),
        load.id,
      );
      if (sheetFull) {
        await logEvent(
          input.id,
          "SHEET_FULL",
          `${s.maxLoads}/${s.maxLoads} loads — sheet closed, start a new sheet for this lot`,
        );
      }
      return { ok: true, netLbs, netBushels, sheetFull };
    }),

  // ----------------------------- edit load weights (change reason req.)
  // Editing a CLOSED (locked) ticket is allowed, but only with the admin
  // password — it rewrites settled numbers.
  updateLoadWeights: publicQuery
    .input(
      z.object({
        loadId: z.number(),
        grossLbs: z.number().int().positive(),
        tareLbs: z.number().int().positive(),
        changeReason: z.string().min(3, "A change reason is required"),
        adminPassword: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const load = await db.query.loads.findFirst({ where: eq(loads.id, input.loadId) });
      if (!load) throw new Error("Load not found");
      if (load.voidedAt) throw new Error("Load is voided");
      const s = await db.query.weightSheets.findFirst({ where: eq(weightSheets.id, load.sheetId) });
      if (!s) throw new Error("Sheet not found");
      if (s.status === "CLOSED") {
        assertAdmin(input.adminPassword);
      }
      const operator = await resolveOperator(db, ctx.operator);
      const netLbs = input.grossLbs - input.tareLbs;
      if (netLbs <= 0) throw new Error("Net weight must be positive");
      const { grossBushels, shrinkPct, netBushels } = computeBushels(
        s.crop,
        netLbs,
        load.moisturePct,
        load.dockagePct,
      );

      // Rebalance bin inventory and rewrite the load in one transaction — a
      // crash between the two would leave the bin diverged from the ledger.
      await db.transaction(async (tx) => {
        if (load.netLbs != null && load.binId) {
          const delta = netLbs - load.netLbs;
          if (delta !== 0) {
            await applyToBin(tx, load.binId, s.direction === "INBOUND" ? delta : -delta);
            // corrective provenance event so replay stays reconciled with
            // the bin cache after the weight edit
            const inboundDelta = s.direction === "INBOUND" ? delta : -delta;
            await recordMovement(tx, {
              siteId: s.siteId,
              lotId: s.lotId,
              fromBinId: inboundDelta < 0 ? load.binId : null,
              toBinId: inboundDelta > 0 ? load.binId : null,
              quantityLbs: Math.abs(delta),
              loadId: load.id,
              operator,
              note: `Weight correction load ${load.loadNo} (${load.netLbs.toLocaleString()} → ${netLbs.toLocaleString()} lbs): ${input.changeReason}`,
            });
          }
        }

        await tx
          .update(loads)
          .set({
            grossLbs: input.grossLbs,
            tareLbs: input.tareLbs,
            netLbs,
            grossBushels,
            shrinkPct,
            netBushels,
            changeReason: input.changeReason,
          })
          .where(eq(loads.id, input.loadId));
        await writeAudit(tx, {
          actor: operator,
          action: "update",
          entityType: "load",
          entityId: load.id,
          before: { grossLbs: load.grossLbs, tareLbs: load.tareLbs, netLbs: load.netLbs },
          after: { grossLbs: input.grossLbs, tareLbs: input.tareLbs, netLbs },
          note: input.changeReason,
        });
      });
      await logEvent(
        load.sheetId,
        "WEIGHT_EDIT",
        `Load ${load.loadNo} · gross ${input.grossLbs.toLocaleString()} / tare ${input.tareLbs.toLocaleString()} — ${input.changeReason}`,
        load.id,
      );
      return { ok: true, netLbs };
    }),

  // ------------------------------------------------- grading (TEST)
  // Phase B (#3): saving a load's grades validates the readings against the
  // crop's grade_factors min/max ranges for the declared grade class (a
  // reading outside the range is REJECTED with the violating factors listed)
  // and stamps the schedule-driven shrink/dock breakdown (shrinkLbs, dockLbs,
  // netBushels) computed from the site's grading schedule — not the flat
  // grain.ts rate used for the pre-grade estimate at weigh-out.
  updateLoadGrades: publicQuery
    .input(
      z.object({
        loadId: z.number(),
        moisturePct: z.number().min(0).max(60).nullable(),
        dockagePct: z.number().min(0).max(50).nullable(),
        testWeightLbs: z.number().min(0).max(80).nullable(),
        proteinPct: z.number().min(0).max(30).nullable(),
        // enriched intake (Phase 5 UI — columns exist since Phase 3)
        damagePct: z.number().min(0).max(100).nullable().optional(),
        grade: z.string().max(32).nullable().optional(),
        farmOrigin: z.string().max(255).nullable().optional(),
        // remaining USGSA factor grid columns (Phase A)
        foreignMaterialPct: z.number().min(0).max(100).nullable().optional(),
        sbPct: z.number().min(0).max(100).nullable().optional(),
        adminPassword: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const load = await db.query.loads.findFirst({ where: eq(loads.id, input.loadId) });
      if (!load) throw new Error("Load not found");
      if (load.voidedAt) throw new Error("Load is voided");
      const s = await db.query.weightSheets.findFirst({ where: eq(weightSheets.id, load.sheetId) });
      if (!s) throw new Error("Sheet not found");
      if (s.status === "CLOSED") {
        assertAdmin(input.adminPassword);
      }
      const operator = await resolveOperator(db, ctx.operator);
      const { loadId, ...grades } = input;
      // blank-string select values arrive as null; empty text fields as null
      const cleaned = {
        ...grades,
        grade: grades.grade?.trim() ? grades.grade.trim() : null,
        farmOrigin: grades.farmOrigin?.trim() ? grades.farmOrigin.trim() : null,
        foreignMaterialPct: grades.foreignMaterialPct ?? null,
        sbPct: grades.sbPct ?? null,
      };

      // Factor validation against the grade class's configured ranges (#3).
      // No grade class declared → nothing to validate against → pass.
      if (cleaned.grade) {
        const { factorRulesFor } = await import("./gradingRouter");
        const { validateGradeFactors } = await import("../contracts/grading");
        const rules = await factorRulesFor(db, s.siteId, s.crop, cleaned.grade);
        const violations = validateGradeFactors(rules, {
          moisturePct: cleaned.moisturePct,
          testWeight: cleaned.testWeightLbs,
          dockagePct: cleaned.dockagePct,
          damagePct: cleaned.damagePct,
          foreignMaterialPct: cleaned.foreignMaterialPct,
          sbPct: cleaned.sbPct,
          proteinPct: cleaned.proteinPct,
        });
        if (violations.length > 0) {
          const detail = violations
            .map(
              (v) =>
                `${v.factor} ${v.value} is ${v.direction === "below-min" ? "below min" : "above max"} ` +
                `(${v.minValue ?? "—"}–${v.maxValue ?? "—"}) for grade ${v.gradeClass}`,
            )
            .join("; ");
          throw new Error(`Grade factors out of range — ${detail}`);
        }
      }

      // Schedule-driven settlement breakdown (#3): moisture shrink from the
      // crop's grading schedule (default 1.183%/point over base) + handling
      // shrink + dockage, stamped on the load.
      const { scheduleFor } = await import("./gradingRouter");
      const { computeGradeAdjustments } = await import("../contracts/grading");
      const schedule = await scheduleFor(db, s.siteId, s.crop);
      const adj = computeGradeAdjustments(
        s.crop,
        load.netLbs,
        cleaned.moisturePct,
        cleaned.dockagePct,
        schedule,
      );
      const calc = adj
        ? {
            shrinkLbs: adj.shrinkLbs,
            dockLbs: adj.dockLbs,
            shrinkPct: adj.shrinkPct,
            grossBushels: adj.grossBushels,
            netBushels: adj.netBushels,
          }
        : { shrinkLbs: null, dockLbs: null, shrinkPct: null, grossBushels: null, netBushels: null };
      await db
        .update(loads)
        .set({ ...cleaned, ...calc })
        .where(eq(loads.id, loadId));
      await writeAudit(db, {
        actor: operator,
        action: "update",
        entityType: "load",
        entityId: loadId,
        before: {
          moisturePct: load.moisturePct,
          dockagePct: load.dockagePct,
          testWeightLbs: load.testWeightLbs,
          proteinPct: load.proteinPct,
          damagePct: load.damagePct,
          foreignMaterialPct: load.foreignMaterialPct,
          sbPct: load.sbPct,
          grade: load.grade,
          farmOrigin: load.farmOrigin,
        },
        after: { ...cleaned, ...calc },
      });
      await logEvent(
        load.sheetId,
        "GRADES",
        `Load ${load.loadNo} · moisture ${grades.moisturePct ?? "—"}% · dockage ${grades.dockagePct ?? "—"}% · TW ${grades.testWeightLbs ?? "—"} · protein ${grades.proteinPct ?? "—"}%`,
        loadId,
      );
      return { ok: true, ...calc, breakdown: adj };
    }),

  assignLoadBin: publicQuery
    .input(
      z.object({
        loadId: z.number(),
        binId: z.number().nullable(),
        adminPassword: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const load = await db.query.loads.findFirst({ where: eq(loads.id, input.loadId) });
      if (!load) throw new Error("Load not found");
      if (load.voidedAt) throw new Error("Load is voided");
      const s = await db.query.weightSheets.findFirst({ where: eq(weightSheets.id, load.sheetId) });
      if (!s) throw new Error("Sheet not found");
      if (s.status === "CLOSED") {
        assertAdmin(input.adminPassword);
      }
      const operator = await resolveOperator(db, ctx.operator);
      if (input.binId != null) {
        const bin = await db.query.bins.findFirst({ where: eq(bins.id, input.binId) });
        if (!bin) throw new Error("Bin not found");
        if (bin.siteId !== s.siteId) throw new Error("Bin belongs to another site");
      }
      await db.transaction(async (tx) => {
        if (load.netLbs != null && load.binId !== input.binId) {
          const delta = s.direction === "INBOUND" ? load.netLbs : -load.netLbs;
          if (load.binId) await applyToBin(tx, load.binId, -delta);
          if (input.binId) await applyToBin(tx, input.binId, delta);
          // provenance for the move: inbound grain transfers bin → bin;
          // outbound grain is put back into the old bin and drawn from the
          // new one (a "transfer" row would credit the wrong side)
          const base = {
            siteId: s.siteId,
            lotId: s.lotId,
            quantityLbs: load.netLbs,
            loadId: load.id,
            operator,
          };
          if (s.direction === "INBOUND") {
            await recordMovement(tx, {
              ...base,
              fromBinId: load.binId,
              toBinId: input.binId,
              note: `Load ${load.loadNo} reassigned bin ${load.binId ?? "none"} → ${input.binId ?? "none"}`,
            });
          } else {
            if (load.binId)
              await recordMovement(tx, {
                ...base,
                fromBinId: null,
                toBinId: load.binId,
                note: `Load ${load.loadNo} draw reversed (bin reassigned)`,
              });
            if (input.binId)
              await recordMovement(tx, {
                ...base,
                fromBinId: input.binId,
                toBinId: null,
                note: `Load ${load.loadNo} redrawn from reassigned bin`,
              });
          }
        }
        await tx.update(loads).set({ binId: input.binId }).where(eq(loads.id, input.loadId));
        await writeAudit(tx, {
          actor: operator,
          action: "update",
          entityType: "load",
          entityId: load.id,
          before: { binId: load.binId },
          after: { binId: input.binId },
        });
      });
      await logEvent(load.sheetId, "BIN_ASSIGN", `Load ${load.loadNo} → bin ${input.binId ?? "none"}`, load.id);
      return { ok: true };
    }),

  // Void a mistaken load (sheet not closed). The row is KEPT and marked
  // voidedAt/voidReason — never deleted — so weights, truck, grades, and bin
  // attribution survive for traceability and disputes (review 8.8). The bin
  // delta is reversed and a reversing provenance event is appended in the
  // same transaction, so replay of bin_movements no longer counts the load.
  // Voided rows are excluded from lists, totals, EOD packages, and the
  // scale flow. Re-opens a full sheet.
  voidLoad: publicQuery
    .input(
      z.object({
        loadId: z.number(),
        voidReason: z.string().min(3, "A void reason is required"),
        // voiding a settled load on a CLOSED (locked) ticket needs the
        // admin password
        adminPassword: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const load = await db.query.loads.findFirst({ where: eq(loads.id, input.loadId) });
      if (!load) throw new Error("Load not found");
      if (load.voidedAt) throw new Error(`Load ${load.loadNo} is already voided`);
      const s = await db.query.weightSheets.findFirst({ where: eq(weightSheets.id, load.sheetId) });
      if (!s) throw new Error("Sheet not found");
      if (s.status === "CLOSED") {
        assertAdmin(input.adminPassword);
      }
      const operator = await resolveOperator(db, ctx.operator);
      const now = new Date();
      await db.transaction(async (tx) => {
        if (load.netLbs != null && load.binId) {
          await applyToBin(tx, load.binId, s.direction === "INBOUND" ? -load.netLbs : load.netLbs);
          // reversing provenance event — the original movement stays in the
          // append-only log; this one nets it back out of replay
          await recordMovement(tx, {
            siteId: s.siteId,
            lotId: s.lotId,
            fromBinId: s.direction === "INBOUND" ? load.binId : null,
            toBinId: s.direction === "INBOUND" ? null : load.binId,
            quantityLbs: load.netLbs,
            loadId: load.id,
            operator,
            note: `Reversal — load ${load.loadNo} voided: ${input.voidReason}`,
          });
        }
        await tx
          .update(loads)
          .set({ voidedAt: now, voidReason: input.voidReason })
          .where(eq(loads.id, input.loadId));
        if (s.status === "FULL") {
          await tx
            .update(weightSheets)
            .set({ status: "OPEN", closeReason: null, closedAt: null })
            .where(eq(weightSheets.id, s.id));
        }
        await writeAudit(tx, {
          actor: operator,
          action: "void",
          entityType: "load",
          entityId: load.id,
          before: {
            loadNo: load.loadNo,
            truckId: load.truckId,
            netLbs: load.netLbs,
            binId: load.binId,
            voidedAt: null,
          },
          after: { voidedAt: now, voidReason: input.voidReason },
          note: input.voidReason,
        });
      });
      // The load row survives now, so this event keeps a VALID loadId — the
      // old hard-delete left sheet_events pointing at deleted loads.
      await logEvent(
        s.id,
        "LOAD_VOID",
        `Load ${load.loadNo} voided${load.truckId ? ` (${load.truckId})` : ""} — ${input.voidReason}`,
        load.id,
      );
      return { ok: true };
    }),

  // Void a whole sheet — only when it carries no completed loads (void those
  // individually first: each one touches bin inventory). Any load still on
  // the scale is voided with the same reason. The sheet is marked voided,
  // closed with reason VOID, and excluded from lists/EOD.
  voidSheet: publicQuery
    .input(
      z.object({
        id: z.number(),
        voidReason: z.string().min(3, "A void reason is required"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const s = await db.query.weightSheets.findFirst({ where: eq(weightSheets.id, input.id) });
      if (!s) throw new Error("Sheet not found");
      if (s.voidedAt) throw new Error(`Sheet ${s.ticketNo} is already voided`);
      if (s.status === "CLOSED") throw new Error("Closed sheets cannot be voided");
      const operator = await resolveOperator(db, ctx.operator);
      const all = await db.select().from(loads).where(eq(loads.sheetId, s.id));
      const live = all.filter((l) => l.voidedAt == null);
      if (live.some((l) => l.netLbs != null)) {
        throw new Error(
          "Sheet has completed loads — void those loads individually (they touch bin inventory)",
        );
      }
      const now = new Date();
      await db.transaction(async (tx) => {
        for (const l of live) {
          await tx
            .update(loads)
            .set({ voidedAt: now, voidReason: input.voidReason })
            .where(eq(loads.id, l.id));
          await writeAudit(tx, {
            actor: operator,
            action: "void",
            entityType: "load",
            entityId: l.id,
            before: { loadNo: l.loadNo, voidedAt: null },
            after: { voidedAt: now, voidReason: input.voidReason },
            note: `Voided with sheet ${s.ticketNo}`,
          });
        }
        await tx
          .update(weightSheets)
          .set({
            voidedAt: now,
            voidReason: input.voidReason,
            status: "CLOSED",
            closeReason: "VOID",
            closedAt: now,
          })
          .where(eq(weightSheets.id, s.id));
        await writeAudit(tx, {
          actor: operator,
          action: "void",
          entityType: "weight_sheet",
          entityId: s.id,
          before: { ticketNo: s.ticketNo, status: s.status, voidedAt: null },
          after: { status: "CLOSED", closeReason: "VOID", voidedAt: now, voidReason: input.voidReason },
          note: input.voidReason,
        });
      });
      await logEvent(s.id, "SHEET_VOID", `Sheet voided — ${input.voidReason}`);
      return { ok: true };
    }),

  // Close an open sheet early (operator decision, before 10 loads / EOD).
  // Refused while a truck is still mid-weigh on it. The sheet stays in the
  // archive with its loads — closing only stops further loads being added.
  close: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const s = await db.query.weightSheets.findFirst({ where: eq(weightSheets.id, input.id) });
    if (!s) throw new Error("Sheet not found");
    if (s.status !== "OPEN") throw new Error(`Sheet ${s.ticketNo} is already closed`);
    const inProgress = await db.query.loads.findFirst({
      where: and(eq(loads.sheetId, s.id), isNull(loads.netLbs), isNull(loads.voidedAt)),
    });
    if (inProgress) {
      throw new Error(
        `Load ${inProgress.loadNo} is still on the scale — finish or void that load before closing the sheet`,
      );
    }
    const operator = await resolveOperator(db, ctx.operator);
    await db
      .update(weightSheets)
      .set({ status: "CLOSED", closeReason: "MANUAL", closedAt: new Date() })
      .where(eq(weightSheets.id, s.id));
    await writeAudit(db, {
      actor: operator,
      action: "update",
      entityType: "weight_sheet",
      entityId: s.id,
      before: { status: s.status },
      after: { status: "CLOSED", closeReason: "MANUAL" },
    });
    await logEvent(s.id, "CLOSED", "Closed by operator");
    return { ok: true };
  }),

  // ------------------------------- truck tare memory (from history)
  truckTares: publicQuery
    .input(z.object({ siteId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select({ truckId: loads.truckId, tareLbs: loads.tareLbs })
        .from(loads)
        .innerJoin(weightSheets, eq(loads.sheetId, weightSheets.id))
        .where(
          input?.siteId
            ? and(eq(weightSheets.siteId, input.siteId), isNull(loads.voidedAt))
            : isNull(loads.voidedAt),
        );
      // group in JS (avg + count + spread per truck)
      const byTruck = new Map<string, number[]>();
      for (const r of rows) {
        if (!r.truckId || r.tareLbs == null) continue;
        byTruck.set(r.truckId, [...(byTruck.get(r.truckId) ?? []), r.tareLbs]);
      }
      return [...byTruck.entries()].map(([truckId, tares]) => {
        const avg = Math.round(tares.reduce((a, b) => a + b, 0) / tares.length);
        return {
          truckId,
          avgTare: avg,
          loads: tares.length,
          minTare: Math.min(...tares),
          maxTare: Math.max(...tares),
        };
      });
    }),

  // -------------------------------------- global activity feed (audit)
  recentActivity: publicQuery
    .input(
      z
        .object({ limit: z.number().int().min(1).max(100).default(25), siteId: z.number().optional() })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select({ event: sheetEvents, ticketNo: weightSheets.ticketNo })
        .from(sheetEvents)
        .leftJoin(weightSheets, eq(sheetEvents.sheetId, weightSheets.id))
        .where(input?.siteId ? eq(weightSheets.siteId, input.siteId) : undefined)
        .orderBy(desc(sheetEvents.createdAt))
        .limit(input?.limit ?? 25);
      return rows.map((r) => ({ ...r.event, ticketNo: r.ticketNo }));
    }),

  // ------------------------------------------------------- end of day
  // Any sheet still open at close of day is closed (FULL sheets are already
  // closed). Lots stay open — a fresh sheet can be started tomorrow.
  // Refused while any truck is still mid-weigh: a CLOSED sheet can no longer
  // be weighed out or voided, so that load would be stranded for good.
  //
  // Phase B (#5): closing the day also writes the FROZEN Daily Position
  // Record — one immutable dpr_snapshots row per site × crop × program —
  // BEFORE the office push, so the snapshots ride along in the EOD package.
  closeDay: publicQuery
    .input(z.object({ siteId: z.number().optional() }).optional())
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const operator = await resolveOperator(db, ctx.operator);
      const { writeDprSnapshots } = await import("./lib/dpr");
      const openWhere = input?.siteId
        ? and(eq(weightSheets.status, "OPEN"), eq(weightSheets.siteId, input.siteId))
        : eq(weightSheets.status, "OPEN");
      const open = await db.select({ id: weightSheets.id, siteId: weightSheets.siteId }).from(weightSheets).where(openWhere);
      // target sites: the requested one, or every site that has open sheets
      // (a site with no open sheets and no activity produces zero DPR rows)
      const targetSiteIds = input?.siteId
        ? [input.siteId]
        : [...new Set(open.map((r) => r.siteId))];
    if (open.length === 0 && !input?.siteId) return { closed: 0, office: null, dpr: {} };
    const ids = open.map((r) => r.id);
    const inFlight = ids.length
      ? await db
          .select({ ticketNo: weightSheets.ticketNo, loadNo: loads.loadNo })
          .from(loads)
          .innerJoin(weightSheets, eq(loads.sheetId, weightSheets.id))
          .where(and(inArray(loads.sheetId, ids), isNull(loads.netLbs), isNull(loads.voidedAt)))
      : [];
    if (inFlight.length > 0) {
      const detail = inFlight.map((l) => `${l.ticketNo} load ${l.loadNo}`).join(", ");
      throw new Error(
        `Trucks still mid-weigh (${detail}) — finish or void those loads before closing the day`,
      );
    }
    if (ids.length) {
      await db
        .update(weightSheets)
        .set({ status: "CLOSED", closeReason: "EOD", closedAt: new Date() })
        .where(inArray(weightSheets.id, ids));
    }
    for (const id of ids) {
      await logEvent(id, "CLOSED", "End-of-day close — sheet locked");
      await writeAudit(db, {
        actor: operator,
        action: "update",
        entityType: "weight_sheet",
        entityId: id,
        before: { status: "OPEN" },
        after: { status: "CLOSED", closeReason: "EOD" },
      });
    }
    // Frozen DPR snapshots for the day being closed (#5) — one row per
    // site × crop × program; immutable once written.
    const dpr: Record<string, number> = {};
    for (const sid of targetSiteIds) {
      dpr[String(sid)] = await writeDprSnapshots(db, sid, new Date(), true);
      await writeAudit(db, {
        actor: operator,
        action: "create",
        entityType: "dpr_snapshot",
        entityId: sid,
        after: { siteId: sid, day: new Date(), rows: dpr[String(sid)] },
        note: "DPR frozen at end-of-day close",
      });
    }
    // Upload the closed day to the main office portal, but only when one is
    // configured — and sync failures never block the close (logged in sync_log).
    const officeUrl = (await getSetting(db, "officeUrl")).trim();
    const office = officeUrl ? await pushEod(new Date()) : null;
    return { closed: ids.length, office, dpr };
  }),

  // ------------------------------------------------------ daily report
  dailyReport: publicQuery
    .input(z.object({ date: z.string().optional(), siteId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const day = input?.date ? parseDay(input.date) : new Date();
      const from = startOfDay(day);
      const to = endOfDay(day);

      // loads weighed that day (a load weighs in and out within minutes)
      const loadRows = await db
        .select({
          load: loads,
          binName: bins.name,
          sheet: weightSheets,
          farmerName: farmers.name,
          lotCode: lots.code,
          lotProgram: lots.program,
          landlordName: landlords.name,
        })
        .from(loads)
        .innerJoin(weightSheets, eq(loads.sheetId, weightSheets.id))
        .leftJoin(bins, eq(loads.binId, bins.id))
        .leftJoin(farmers, eq(weightSheets.farmerId, farmers.id))
        .leftJoin(lots, eq(weightSheets.lotId, lots.id))
        .leftJoin(landlords, eq(weightSheets.landlordId, landlords.id))
        .where(
          and(
            gte(loads.createdAt, from),
            lte(loads.createdAt, to),
            isNull(loads.voidedAt),
            ...(input?.siteId ? [eq(weightSheets.siteId, input.siteId)] : []),
          ),
        )
        .orderBy(asc(loads.createdAt));

      // sheets opened that day (for the "opened today" count)
      const sheetsOpened = await db
        .select({ id: weightSheets.id })
        .from(weightSheets)
        .where(
          and(
            gte(weightSheets.createdAt, from),
            lte(weightSheets.createdAt, to),
            isNull(weightSheets.voidedAt),
            ...(input?.siteId ? [eq(weightSheets.siteId, input.siteId)] : []),
          ),
        );

      const ledger = loadRows.map((r) => ({
        id: r.load.id,
        sheetId: r.sheet.id,
        ticketNo: `${r.sheet.ticketNo}-${String(r.load.loadNo).padStart(2, "0")}`,
        loadNo: r.load.loadNo,
        farmerName: r.farmerName,
        lotCode: r.lotCode,
        // #17 — program: the load's denormalized tag, falling back to the lot's
        program: r.load.program ?? r.lotProgram ?? "conventional",
        landlordName: r.landlordName,
        crop: r.sheet.crop,
        direction: r.sheet.direction,
        status: (r.load.netLbs != null ? "COMPLETED" : "OPEN") as "COMPLETED" | "OPEN",
        truckId: r.load.truckId,
        binName: r.binName,
        grossLbs: r.load.grossLbs,
        tareLbs: r.load.tareLbs,
        netLbs: r.load.netLbs,
        netBushels: r.load.netBushels,
        moisturePct: r.load.moisturePct,
        createdAt: (r.load.grossAt ?? r.load.tareAt ?? r.load.createdAt) as Date,
      }));

      const done = ledger.filter((l) => l.netLbs != null);
      const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
      const inbound = done.filter((l) => l.direction === "INBOUND");
      const outbound = done.filter((l) => l.direction === "OUTBOUND");

      const byCrop = new Map<string, { lbs: number; bu: number; count: number }>();
      for (const l of done) {
        const e = byCrop.get(l.crop) ?? { lbs: 0, bu: 0, count: 0 };
        e.lbs += l.netLbs ?? 0;
        e.bu = round2(e.bu + (l.netBushels ?? 0));
        e.count += 1;
        byCrop.set(l.crop, e);
      }
      const byFarmer = new Map<string, { lbs: number; bu: number; count: number }>();
      for (const l of done) {
        const k = l.farmerName ?? "Unknown";
        const e = byFarmer.get(k) ?? { lbs: 0, bu: 0, count: 0 };
        e.lbs += l.netLbs ?? 0;
        e.bu = round2(e.bu + (l.netBushels ?? 0));
        e.count += 1;
        byFarmer.set(k, e);
      }

      // #17 — per-program totals (identity-preserved segregation reporting)
      const byProgram = new Map<string, { lbs: number; bu: number; count: number }>();
      for (const l of done) {
        const e = byProgram.get(l.program) ?? { lbs: 0, bu: 0, count: 0 };
        e.lbs += l.netLbs ?? 0;
        e.bu = round2(e.bu + (l.netBushels ?? 0));
        e.count += 1;
        byProgram.set(l.program, e);
      }

      const binRows = await db
        .select({ bin: bins, siteName: sites.name })
        .from(bins)
        .leftJoin(sites, eq(bins.siteId, sites.id))
        .where(input?.siteId ? eq(bins.siteId, input.siteId) : undefined)
        .orderBy(sites.name, bins.name);

      return {
        date: startOfDay(day),
        sheetCount: sheetsOpened.length,
        loadCount: ledger.length,
        completedCount: done.length,
        inboundLbs: sum(inbound.map((l) => l.netLbs ?? 0)),
        outboundLbs: sum(outbound.map((l) => l.netLbs ?? 0)),
        inboundBu: round2(sum(inbound.map((l) => l.netBushels ?? 0))),
        outboundBu: round2(sum(outbound.map((l) => l.netBushels ?? 0))),
        byCrop: [...byCrop.entries()].map(([crop, v]) => ({ crop, ...v })),
        byFarmer: [...byFarmer.entries()].map(([farmer, v]) => ({ farmer, ...v })),
        byProgram: [...byProgram.entries()].map(([program, v]) => ({ program, ...v })),
        bins: binRows.map((r) => ({ ...r.bin, siteName: r.siteName })),
        loads: ledger,
      };
    }),
});

export type SheetsRouter = typeof sheetsRouter;

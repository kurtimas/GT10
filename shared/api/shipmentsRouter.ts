import { z } from "zod";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { binMovements, bins, loads, lots, shipments, sites, weightSheets } from "../db/schema";
import { computeBushels } from "../contracts/grain";
import { binCompositionByLot, binTotalLbs, fifoDrawdown } from "../contracts/provenance";
import { movementsForBin, recordMovement } from "./lib/movements";
import { writeAudit } from "./lib/audit";
import { resolveOperator } from "./lib/operators";

// ---------------------------------------------------------------------------
// Shipments — one outbound sale/delivery drawn from a bin (Phase 4).
//
// Two create modes:
//   * draw mode (no loadId, or a load that never hit a bin): validates the
//     draw with fifoDrawdown against the bin's CURRENT composition (oldest
//     lot first), writes the outbound bin_movements row, decrements the bin
//     cache, and records the per-lot attribution on the movement note — all
//     in ONE transaction. shortfallLbs is returned when the bin is short;
//     the shipment is still recorded (a short truck is a commercial fact).
//   * link mode (loadId of a completed, unlinked outbound load that already
//     weighed out of a bin): the scale already recorded the draw (movement +
//     bin decrement at weigh-out), so the shipment only links the load and
//     points at the load's existing movement. No double decrement.
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Atomic clamped bin delta — identical to sheetsRouter.applyToBin. */
function applyToBin(tx: Tx, binId: number, deltaLbs: number) {
  return tx
    .update(bins)
    .set({ currentLbs: sql`GREATEST(0, ${bins.currentLbs} + ${deltaLbs})` })
    .where(eq(bins.id, binId));
}

const shipmentSelect = {
  shipment: shipments,
  lotCode: lots.code,
  binName: bins.name,
  siteName: sites.name,
};

function joinShipmentTables(db: Db) {
  return db
    .select(shipmentSelect)
    .from(shipments)
    .leftJoin(lots, eq(shipments.lotId, lots.id))
    .leftJoin(bins, eq(shipments.binId, bins.id))
    .leftJoin(sites, eq(shipments.siteId, sites.id));
}

type JoinedShipment = {
  shipment: typeof shipments.$inferSelect;
  lotCode: string | null;
  binName: string | null;
  siteName: string | null;
};

function toShipmentRow(r: JoinedShipment) {
  return { ...r.shipment, lotCode: r.lotCode, binName: r.binName, siteName: r.siteName };
}

export const shipmentsRouter = createRouter({
  // ------------------------------------------------------------- create
  create: publicQuery
    .input(
      z.object({
        siteId: z.number(),
        customerName: z.string().min(1, "A customer is required"),
        destination: z.string().optional(),
        /** explicit lot attribution; mixed-bin draws leave this null */
        lotId: z.number().nullable().optional(),
        /** source bin — required in draw mode */
        binId: z.number().optional(),
        /** lbs to draw — required in draw mode unless a load supplies it */
        quantityLbs: z.number().int().positive().optional(),
        truckId: z.string().optional(),
        note: z.string().optional(),
        /** link a completed outbound load (see header comment) */
        loadId: z.number().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const operator = await resolveOperator(db, ctx.operator);

      // ---- resolve + validate the linked load, if any
      let load: typeof loads.$inferSelect | null = null;
      let sheet: typeof weightSheets.$inferSelect | null = null;
      if (input.loadId != null) {
        load = (await db.query.loads.findFirst({ where: eq(loads.id, input.loadId) })) ?? null;
        if (!load) throw new Error("Load not found");
        if (load.voidedAt) throw new Error(`Load ${load.loadNo} is voided and cannot ship`);
        if (load.shipmentId != null) throw new Error("Load is already linked to a shipment");
        if (load.netLbs == null) throw new Error("Load is not weighed out yet");
        sheet =
          (await db.query.weightSheets.findFirst({ where: eq(weightSheets.id, load.sheetId) })) ??
          null;
        if (!sheet) throw new Error("Sheet not found");
        if (sheet.direction !== "OUTBOUND") throw new Error("Only outbound loads can ship");
        if (sheet.siteId !== input.siteId) throw new Error("Load belongs to another site");
      }

      const linkOnly = load != null && load.binId != null;
      const binId = input.binId ?? load?.binId ?? null;
      if (binId == null) throw new Error("A source bin is required");
      const quantityLbs = input.quantityLbs ?? load?.netLbs ?? null;
      if (quantityLbs == null) throw new Error("A quantity (lbs) is required");

      const bin = await db.query.bins.findFirst({ where: eq(bins.id, binId) });
      if (!bin) throw new Error("Source bin not found");
      if (bin.siteId !== input.siteId) throw new Error("Source bin belongs to another site");

      // FIFO attribution of the draw against the bin's CURRENT composition.
      // In link-only mode the grain already left via the scale, so the draw
      // is not re-validated (it would see the post-weigh-out composition).
      const events = await movementsForBin(db, binId);
      const draw = linkOnly ? null : fifoDrawdown(events, binId, quantityLbs);
      const allocations = draw?.allocations ?? [];
      const shortfallLbs = draw?.shortfallLbs ?? 0;
      const attributionNote =
        allocations.length > 0
          ? `FIFO draw: ${allocations.map((a) => `${a.lbs.toLocaleString()} lbs from lot ${a.lotId ?? "unknown"}`).join(", ")}` +
            (shortfallLbs > 0 ? ` — SHORT ${shortfallLbs.toLocaleString()} lbs` : "")
          : null;

      const quantityBu = computeBushels(bin.crop, quantityLbs, null, null).netBushels;
      const lotId =
        input.lotId ?? (allocations.length === 1 ? (allocations[0]!.lotId ?? null) : null);

      const result = await db.transaction(async (tx) => {
        let movementId: number | null = null;

        if (linkOnly && load) {
          // The scale already recorded the draw — point at that movement.
          const own = events.find((e) => e.loadId === load.id && e.fromBinId === binId);
          movementId = own?.id ?? null;
        } else {
          movementId = await recordMovement(tx, {
            siteId: input.siteId,
            lotId,
            fromBinId: binId,
            toBinId: null,
            quantityLbs,
            loadId: load?.id ?? null,
            operator,
            note: attributionNote,
          });
          await applyToBin(tx, binId, -quantityLbs);
        }

        const [{ id: shipmentId }] = await tx
          .insert(shipments)
          .values({
            siteId: input.siteId,
            customerName: input.customerName,
            destination: input.destination || null,
            lotId,
            binId,
            quantityLbs,
            quantityBu,
            truckId: input.truckId || load?.truckId || null,
            binMovementId: movementId,
            note: input.note || null,
          })
          .$returningId();

        if (!linkOnly && movementId != null) {
          // backfill the movement → shipment link (the movement was written
          // before the shipment id existed)
          await tx
            .update(binMovements)
            .set({ shipmentId })
            .where(eq(binMovements.id, movementId));
        }

        if (load) {
          await tx
            .update(loads)
            .set({ shipmentId, ...(load.binId == null ? { binId } : {}) })
            .where(eq(loads.id, load.id));
        }

        await writeAudit(tx, {
          actor: operator,
          action: "create",
          entityType: "shipment",
          entityId: shipmentId,
          after: {
            ...input,
            quantityLbs,
            lotId,
            allocations,
            shortfallLbs,
            linkedLoadId: load?.id ?? null,
            mode: linkOnly ? "link" : "draw",
          },
          note: attributionNote,
        });

        return { shipmentId, movementId };
      });

      const rows = (await joinShipmentTables(db).where(eq(shipments.id, result.shipmentId))) as JoinedShipment[];
      return {
        shipment: rows[0] ? toShipmentRow(rows[0]) : null,
        allocations,
        shortfallLbs,
      };
    }),

  // --------------------------------------------------------------- list
  list: publicQuery
    .input(
      z
        .object({
          siteId: z.number().optional(),
          limit: z.number().int().min(1).max(500).default(200),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const rows = (await joinShipmentTables(db)
        .where(input?.siteId ? eq(shipments.siteId, input.siteId) : undefined)
        .orderBy(desc(shipments.createdAt))
        .limit(input?.limit ?? 200)) as JoinedShipment[];
      return rows.map(toShipmentRow);
    }),

  // ---------------------------------------------------------------- get
  get: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const db = getDb();
    const rows = (await joinShipmentTables(db).where(eq(shipments.id, input.id))) as JoinedShipment[];
    if (!rows[0]) throw new Error("Shipment not found");
    const linkedLoads = await db
      .select()
      .from(loads)
      .where(and(eq(loads.shipmentId, input.id), isNull(loads.voidedAt)));
    return { shipment: toShipmentRow(rows[0]), loads: linkedLoads };
  }),

  // ------------------------------------------- linkable outbound loads
  // Completed, non-voided, not-yet-shipped loads on OUTBOUND sheets — the
  // "link an outbound load" picker in the shipment create form. A load with
  // a bin already drew down at weigh-out (link mode); one without a bin
  // draws at shipment time (draw mode).
  linkableLoads: publicQuery
    .input(z.object({ siteId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select({
          load: loads,
          ticketNo: weightSheets.ticketNo,
          binName: bins.name,
        })
        .from(loads)
        .innerJoin(weightSheets, eq(loads.sheetId, weightSheets.id))
        .leftJoin(bins, eq(loads.binId, bins.id))
        .where(
          and(
            eq(weightSheets.siteId, input.siteId),
            eq(weightSheets.direction, "OUTBOUND"),
            isNull(loads.voidedAt),
            isNull(loads.shipmentId),
            isNull(weightSheets.voidedAt),
          ),
        )
        .orderBy(desc(loads.createdAt))
        .limit(200);
      return rows
        .filter((r) => r.load.netLbs != null)
        .map((r) => ({ ...r.load, ticketNo: r.ticketNo, binName: r.binName }));
    }),

  // ---------------------------------- bin composition (provenance replay)
  // What lots are in a bin right now, per the movement log — plus the
  // log-derived total next to the cached bins.currentLbs for reconciliation.
  binComposition: publicQuery
    .input(z.object({ binId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const bin = await db.query.bins.findFirst({ where: eq(bins.id, input.binId) });
      if (!bin) throw new Error("Bin not found");
      const events = await movementsForBin(db, input.binId);
      const composition = binCompositionByLot(events, input.binId);
      const lotIds = composition.map((c) => c.lotId).filter((v): v is number => v != null);
      const lotRows = lotIds.length
        ? await db.select({ id: lots.id, code: lots.code }).from(lots).where(inArray(lots.id, lotIds))
        : [];
      const codeById = new Map(lotRows.map((l) => [l.id, l.code]));
      return {
        bin,
        composition: composition.map((c) => ({
          lotId: c.lotId,
          lotCode: c.lotId != null ? (codeById.get(c.lotId) ?? null) : null,
          lbs: c.lbs,
        })),
        logTotalLbs: binTotalLbs(events, input.binId),
        cacheLbs: bin.currentLbs,
      };
    }),
});

export type ShipmentsRouter = typeof shipmentsRouter;

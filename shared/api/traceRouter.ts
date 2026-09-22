import { z } from "zod";
import { asc, eq, inArray } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  bins,
  binMovements,
  farmers,
  loads,
  lots,
  shipments,
  sites,
  weightSheets,
} from "../db/schema";
import { round2 } from "../contracts/grain";
import { binLayers, type BinLotLayer, type BinMovementEvent } from "../contracts/provenance";
import { cleanoutCutoff, cleanoutCutoffs } from "./lib/cleanouts";
import { toCsv, type CsvValue } from "./lib/csv";
import { parseDay } from "./lib/dpr";

// ---------------------------------------------------------------------------
// Recall / trace queries (Phase B, #14) — FSMA one-step-back/forward over the
// bin_movements genealogy. Commingling-aware (#13): after blending, identity
// is proportional — every attribution carries lbs + % rather than pretending
// kernel-level identity survives.
//
//   backward(shipmentId | binId+date) → which lots/loads contributed, and how
//     much of each (FIFO replay bounded by cleanout cutoffs).
//   forward(lotId | loadId) → every bin the grain entered, and every shipment
//     that drew from those bins with the lot's % attribution (FIFO at each
//     shipment's moment in time), plus customer/destination.
//
// Both load their rows in a handful of queries (site movements, referenced
// lots/loads/shipments) and replay in memory — no per-row queries.
// ---------------------------------------------------------------------------

type MovementRow = typeof binMovements.$inferSelect;

/** Events strictly before a reference movement (state just before it). */
function eventsBefore(events: MovementRow[], ref: MovementRow): BinMovementEvent[] {
  return events.filter(
    (e) =>
      e.createdAt.getTime() < ref.createdAt.getTime() ||
      (e.createdAt.getTime() === ref.createdAt.getTime() && e.id < ref.id),
  );
}

/** Events up to (inclusive) a moment in time. */
function eventsUntil(events: MovementRow[], t: Date): BinMovementEvent[] {
  return events.filter((e) => e.createdAt.getTime() <= t.getTime());
}

/** Consume `qty` from FIFO layers; per (lotId, loadId-of-inbound-movement) lbs. */
function attributeDraw(
  layers: BinLotLayer[],
  qty: number,
  loadIdByMovementId: Map<number, number | null>,
) {
  const out: { lotId: number | null; loadId: number | null; lbs: number }[] = [];
  let remaining = qty;
  for (const layer of layers) {
    if (remaining <= 0) break;
    const take = Math.min(layer.lbs, remaining);
    remaining -= take;
    const loadId = loadIdByMovementId.get(layer.movementId) ?? null;
    const last = out[out.length - 1];
    if (last && last.lotId === layer.lotId && last.loadId === loadId) last.lbs += take;
    else out.push({ lotId: layer.lotId, loadId, lbs: take });
  }
  return { allocations: out, shortfallLbs: remaining };
}

type BackwardResult = {
  subject: Record<string, unknown>;
  totalLbs: number;
  shortfallLbs: number;
  sources: {
    lotId: number | null;
    lotCode: string | null;
    lbs: number;
    pct: number;
    loads: {
      loadId: number;
      ticketNo: string | null;
      loadNo: number;
      lbs: number;
      farmerName: string | null;
    }[];
  }[];
};

async function computeBackward(
  input: { shipmentId?: number; binId?: number; date?: string },
): Promise<BackwardResult> {
  const db = getDb();

  let binId: number;
  let qty: number | null = null;
  let asOf: Date;
  let subject: Record<string, unknown>;

  if (input.shipmentId != null) {
    const shipment = await db.query.shipments.findFirst({
      where: eq(shipments.id, input.shipmentId),
    });
    if (!shipment) throw new Error("Shipment not found");
    if (shipment.binId == null) {
      throw new Error("Shipment has no source bin — nothing to trace");
    }
    binId = shipment.binId;
    qty = shipment.quantityLbs;
    asOf = shipment.createdAt;
    subject = {
      type: "shipment",
      shipmentId: shipment.id,
      customerName: shipment.customerName,
      destination: shipment.destination,
      quantityLbs: shipment.quantityLbs,
      createdAt: shipment.createdAt,
    };
  } else if (input.binId != null) {
    binId = input.binId;
    asOf = input.date
      ? (() => {
          const d = parseDay(input.date!);
          d.setHours(23, 59, 59, 999);
          return d;
        })()
      : new Date();
    const bin = await db.query.bins.findFirst({ where: eq(bins.id, binId) });
    if (!bin) throw new Error("Bin not found");
    subject = { type: "bin", binId, binName: bin.name, asOf };
  } else {
    throw new Error("Provide shipmentId or binId");
  }

  const bin = await db.query.bins.findFirst({ where: eq(bins.id, binId) });
  if (!bin) throw new Error("Bin not found");
  const cutoff = await cleanoutCutoff(db, binId);

  // one query: every movement at the site, filtered to this bin in memory
  const allEvents = await db
    .select()
    .from(binMovements)
    .where(eq(binMovements.siteId, bin.siteId))
    .orderBy(asc(binMovements.createdAt), asc(binMovements.id));
  const binEvents = allEvents.filter((e) => e.fromBinId === binId || e.toBinId === binId);
  const loadIdByMovementId = new Map(binEvents.map((e) => [e.id, e.loadId]));

  // state of the bin at the subject moment, after the cleanout cutoff.
  // Shipment mode replays the state just BEFORE the shipment's own outbound
  // movement (the draw itself must not consume the layers first).
  let stateEvents: BinMovementEvent[];
  if (input.shipmentId != null) {
    const shipment = await db.query.shipments.findFirst({
      where: eq(shipments.id, input.shipmentId),
    });
    const ownMovement =
      shipment?.binMovementId != null
        ? binEvents.find((e) => e.id === shipment.binMovementId)
        : undefined;
    stateEvents = ownMovement ? eventsBefore(binEvents, ownMovement) : eventsUntil(binEvents, asOf);
  } else {
    stateEvents = eventsUntil(binEvents, asOf);
  }
  const layers = binLayers(stateEvents, binId, cutoff);
  const presentLbs = layers.reduce((s, l) => s + l.lbs, 0);

  // shipment: attribute exactly the shipped qty; bin: report full contents
  const draw = qty != null ? attributeDraw(layers, qty, loadIdByMovementId) : null;
  const perSource = new Map<string, { lotId: number | null; loadId: number | null; lbs: number }>();
  const push = (lotId: number | null, loadId: number | null, lbs: number) => {
    const key = `${lotId}:${loadId}`;
    const cur = perSource.get(key) ?? { lotId, loadId, lbs: 0 };
    cur.lbs += lbs;
    perSource.set(key, cur);
  };
  if (draw) {
    for (const a of draw.allocations) push(a.lotId, a.loadId, a.lbs);
  } else {
    for (const layer of layers) {
      push(layer.lotId, loadIdByMovementId.get(layer.movementId) ?? null, layer.lbs);
    }
  }

  const totalLbs = qty ?? presentLbs;
  const lotIds = [...new Set([...perSource.values()].map((s) => s.lotId).filter((v): v is number => v != null))];
  const loadIds = [...new Set([...perSource.values()].map((s) => s.loadId).filter((v): v is number => v != null))];
  const lotRows = lotIds.length
    ? await db.select().from(lots).where(inArray(lots.id, lotIds))
    : [];
  const loadRows = loadIds.length
    ? await db
        .select({ load: loads, ticketNo: weightSheets.ticketNo, farmerName: farmers.name })
        .from(loads)
        .leftJoin(weightSheets, eq(loads.sheetId, weightSheets.id))
        .leftJoin(farmers, eq(weightSheets.farmerId, farmers.id))
        .where(inArray(loads.id, loadIds))
    : [];
  const lotCodeById = new Map(lotRows.map((l) => [l.id, l.code]));
  const loadById = new Map(loadRows.map((r) => [r.load.id, r]));

  // group per lot, with per-load breakdown
  const byLot = new Map<number | null, BackwardResult["sources"][number]>();
  for (const s of perSource.values()) {
    let entry = byLot.get(s.lotId);
    if (!entry) {
      entry = {
        lotId: s.lotId,
        lotCode: s.lotId != null ? (lotCodeById.get(s.lotId) ?? null) : null,
        lbs: 0,
        pct: 0,
        loads: [],
      };
      byLot.set(s.lotId, entry);
    }
    entry.lbs += s.lbs;
    if (s.loadId != null) {
      const lr = loadById.get(s.loadId);
      entry.loads.push({
        loadId: s.loadId,
        ticketNo: lr?.ticketNo ?? null,
        loadNo: lr?.load.loadNo ?? 0,
        lbs: s.lbs,
        farmerName: lr?.farmerName ?? null,
      });
    }
  }
  const sources = [...byLot.values()]
    .map((s) => ({ ...s, pct: totalLbs > 0 ? round2((s.lbs / totalLbs) * 100) : 0 }))
    .sort((a, b) => b.lbs - a.lbs);

  return {
    subject: { ...subject, binId, binName: bin.name },
    totalLbs,
    shortfallLbs: draw?.shortfallLbs ?? 0,
    sources,
  };
}

type ForwardResult = {
  subject: Record<string, unknown>;
  bins: {
    binId: number;
    binName: string | null;
    siteName: string | null;
    lbsIn: number;
    firstAt: Date;
    lastAt: Date;
  }[];
  shipments: {
    shipmentId: number | null;
    loadId: number | null;
    ticketNo: string | null;
    date: Date;
    customerName: string | null;
    destination: string | null;
    binId: number;
    binName: string | null;
    quantityLbs: number;
    attributedLbs: number;
    pct: number;
  }[];
};

async function computeForward(input: { lotId?: number; loadId?: number }): Promise<ForwardResult> {
  const db = getDb();

  let lotId: number | null = input.lotId ?? null;
  let subject: Record<string, unknown>;
  if (input.loadId != null) {
    const load = await db.query.loads.findFirst({ where: eq(loads.id, input.loadId) });
    if (!load) throw new Error("Load not found");
    const sheet = await db.query.weightSheets.findFirst({
      where: eq(weightSheets.id, load.sheetId),
    });
    lotId = sheet?.lotId ?? null;
    subject = {
      type: "load",
      loadId: load.id,
      loadNo: load.loadNo,
      ticketNo: sheet?.ticketNo ?? null,
      lotId,
    };
  } else if (input.lotId != null) {
    const lot = await db.query.lots.findFirst({ where: eq(lots.id, input.lotId) });
    if (!lot) throw new Error("Lot not found");
    subject = { type: "lot", lotId: lot.id, lotCode: lot.code, crop: lot.crop };
  } else {
    throw new Error("Provide lotId or loadId");
  }

  // For a load-trace we follow the load's grain; without a lot (lot-less
  // adjustment grain) there is no forward genealogy beyond its own movement.
  const loadFilter = input.loadId != null ? input.loadId : null;

  // all movements for this lot (or this load), then all movements for the
  // bins the grain entered (needed to replay FIFO at each outbound moment)
  const seedConds = loadFilter != null
    ? eq(binMovements.loadId, loadFilter)
    : lotId != null
      ? eq(binMovements.lotId, lotId)
      : null;
  if (!seedConds) {
    return { subject, bins: [], shipments: [] };
  }
  const seedMovements = await db
    .select()
    .from(binMovements)
    .where(seedConds)
    .orderBy(asc(binMovements.createdAt), asc(binMovements.id));

  // bins the grain entered (inbound side of any movement)
  const enteredBinIds = [
    ...new Set(
      seedMovements.map((m) => m.toBinId).filter((v): v is number => v != null),
    ),
  ];
  const binRowsAll = enteredBinIds.length
    ? await db
        .select({ bin: bins, siteName: sites.name })
        .from(bins)
        .leftJoin(sites, eq(bins.siteId, sites.id))
        .where(inArray(bins.id, enteredBinIds))
    : [];
  const binInfoById = new Map(binRowsAll.map((r) => [r.bin.id, r]));

  const allBinEvents = enteredBinIds.length
    ? await db
        .select()
        .from(binMovements)
        .where(
          inArray(binMovements.siteId, [...new Set(binRowsAll.map((r) => r.bin.siteId))]),
        )
        .orderBy(asc(binMovements.createdAt), asc(binMovements.id))
    : [];
  const cutoffs = await cleanoutCutoffs(db, enteredBinIds);

  // per-bin: how much of this lot/load entered and when
  const binSummary: ForwardResult["bins"] = [];
  for (const binId of enteredBinIds) {
    const inbound = seedMovements.filter((m) => m.toBinId === binId);
    const lbsIn = inbound.reduce((s, m) => s + m.quantityLbs, 0);
    const info = binInfoById.get(binId);
    binSummary.push({
      binId,
      binName: info?.bin.name ?? null,
      siteName: info?.siteName ?? null,
      lbsIn,
      firstAt: inbound[0]!.createdAt,
      lastAt: inbound[inbound.length - 1]!.createdAt,
    });
  }

  // every outbound movement from those bins — did it carry this lot's grain?
  const outbound = allBinEvents.filter(
    (m) => m.fromBinId != null && enteredBinIds.includes(m.fromBinId) && m.toBinId == null,
  );
  const shipmentIds = [...new Set(outbound.map((m) => m.shipmentId).filter((v): v is number => v != null))];
  const shipmentRows = shipmentIds.length
    ? await db.select().from(shipments).where(inArray(shipments.id, shipmentIds))
    : [];
  const shipmentById = new Map(shipmentRows.map((s) => [s.id, s]));
  const outLoadIds = [...new Set(outbound.map((m) => m.loadId).filter((v): v is number => v != null))];
  const outLoadRows = outLoadIds.length
    ? await db
        .select({ load: loads, ticketNo: weightSheets.ticketNo })
        .from(loads)
        .leftJoin(weightSheets, eq(loads.sheetId, weightSheets.id))
        .where(inArray(loads.id, outLoadIds))
    : [];
  const outLoadById = new Map(outLoadRows.map((r) => [r.load.id, r]));

  const matchesLot = (layerLotId: number | null, movement: MovementRow): boolean => {
    if (loadFilter != null) return movement.loadId === loadFilter;
    return lotId != null && layerLotId === lotId;
  };

  const shipRows: ForwardResult["shipments"] = [];
  for (const m of outbound) {
    const binId = m.fromBinId!;
    // replay the bin state just BEFORE this outbound movement
    const prior = eventsBefore(
      allBinEvents.filter((e) => e.fromBinId === binId || e.toBinId === binId),
      m,
    );
    const layers = binLayers(prior, binId, cutoffs.get(binId) ?? null);
    // attribute this draw FIFO
    let remaining = m.quantityLbs;
    let attributed = 0;
    for (const layer of layers) {
      if (remaining <= 0) break;
      const take = Math.min(layer.lbs, remaining);
      remaining -= take;
      // does this layer belong to the traced subject? for lot traces the
      // layer's lotId decides; for a single-load trace only the movement
      // that carried that exact load into the bin counts
      const layerMovement = allBinEvents.find((e) => e.id === layer.movementId);
      if (layerMovement && matchesLot(layer.lotId, layerMovement)) attributed += take;
    }
    if (attributed <= 0) continue;
    const shipment = m.shipmentId != null ? shipmentById.get(m.shipmentId) : undefined;
    const outLoad = m.loadId != null ? outLoadById.get(m.loadId) : undefined;
    const info = binInfoById.get(binId);
    shipRows.push({
      shipmentId: m.shipmentId,
      loadId: m.loadId,
      ticketNo: outLoad?.ticketNo ?? null,
      date: m.createdAt,
      customerName: shipment?.customerName ?? null,
      destination: shipment?.destination ?? null,
      binId,
      binName: info?.bin.name ?? null,
      quantityLbs: m.quantityLbs,
      attributedLbs: attributed,
      pct: round2((attributed / m.quantityLbs) * 100),
    });
  }

  return { subject, bins: binSummary, shipments: shipRows };
}

export const traceRouter = createRouter({
  backward: publicQuery
    .input(
      z
        .object({
          shipmentId: z.number().optional(),
          binId: z.number().optional(),
          date: z.string().optional(), // YYYY-MM-DD, bin mode only
        })
        .refine((v) => v.shipmentId != null || v.binId != null, {
          message: "Provide shipmentId or binId",
        }),
    )
    .query(({ input }) => computeBackward(input)),

  forward: publicQuery
    .input(
      z
        .object({ lotId: z.number().optional(), loadId: z.number().optional() })
        .refine((v) => v.lotId != null || v.loadId != null, {
          message: "Provide lotId or loadId",
        }),
    )
    .query(({ input }) => computeForward(input)),

  // FSMA-style sortable spreadsheet: CSV of the backward trace.
  backwardCsv: publicQuery
    .input(
      z
        .object({
          shipmentId: z.number().optional(),
          binId: z.number().optional(),
          date: z.string().optional(),
        })
        .refine((v) => v.shipmentId != null || v.binId != null, {
          message: "Provide shipmentId or binId",
        }),
    )
    .query(async ({ input }) => {
      const r = await computeBackward(input);
      const rows: Record<string, CsvValue>[] = [];
      for (const s of r.sources) {
        if (s.loads.length === 0) {
          rows.push({
            lotId: s.lotId,
            lotCode: s.lotCode,
            lbs: s.lbs,
            pct: s.pct,
            loadId: null,
            ticketNo: null,
            loadNo: null,
            loadLbs: null,
            farmerName: null,
          });
        }
        for (const l of s.loads) {
          rows.push({
            lotId: s.lotId,
            lotCode: s.lotCode,
            lbs: s.lbs,
            pct: s.pct,
            loadId: l.loadId,
            ticketNo: l.ticketNo,
            loadNo: l.loadNo,
            loadLbs: l.lbs,
            farmerName: l.farmerName,
          });
        }
      }
      return {
        filename: "trace-backward.csv",
        subject: r.subject,
        totalLbs: r.totalLbs,
        csv: toCsv(["lotId","lotCode","lbs","pct","loadId","ticketNo","loadNo","loadLbs","farmerName"], rows),
      };
    }),

  forwardCsv: publicQuery
    .input(
      z
        .object({ lotId: z.number().optional(), loadId: z.number().optional() })
        .refine((v) => v.lotId != null || v.loadId != null, {
          message: "Provide lotId or loadId",
        }),
    )
    .query(async ({ input }) => {
      const r = await computeForward(input);
      const csv = toCsv(
        ["shipmentId","date","customerName","destination","binId","binName","quantityLbs","attributedLbs","pct","ticketNo"],
        r.shipments as unknown as Record<string, CsvValue>[],
      );
      return { filename: "trace-forward.csv", subject: r.subject, csv };
    }),
});

export type TraceRouter = typeof traceRouter;

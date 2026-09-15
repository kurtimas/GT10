import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { loads, sheetEvents, weightSheets } from "../../db/schema";

/**
 * Close every OPEN weight sheet tied to a lot that is being closed — a
 * CLOSED lot must not leave live sheets that can still accept loads.
 *
 * Refuses while a truck is still mid-weigh on one of them (a closed sheet
 * can no longer be weighed out or voided without the admin password), and
 * returns the ticket numbers that were closed so callers can surface the
 * "you had N open sheets" notice to the operator.
 */
export async function closeOpenSheetsForLot(
  lotId: number,
  lotCode: string,
): Promise<string[]> {
  const db = getDb();
  const openSheets = await db
    .select({ id: weightSheets.id, ticketNo: weightSheets.ticketNo })
    .from(weightSheets)
    .where(and(eq(weightSheets.lotId, lotId), eq(weightSheets.status, "OPEN")));
  if (openSheets.length === 0) return [];

  const ids = openSheets.map((s) => s.id);
  const inFlight = await db
    .select({ ticketNo: weightSheets.ticketNo, loadNo: loads.loadNo })
    .from(loads)
    .innerJoin(weightSheets, eq(loads.sheetId, weightSheets.id))
    .where(
      and(
        inArray(loads.sheetId, ids),
        isNull(loads.netLbs),
        // soft-voided loads (Phase 4) never completed weighing but are no
        // longer on the scale — they must not block the close
        isNull(loads.voidedAt),
      ),
    );
  if (inFlight.length > 0) {
    const detail = inFlight.map((l) => `${l.ticketNo} load ${l.loadNo}`).join(", ");
    throw new Error(
      `Trucks still mid-weigh (${detail}) — finish or void those loads before closing lot ${lotCode}`,
    );
  }

  await db
    .update(weightSheets)
    .set({ status: "CLOSED", closeReason: "LOT_CLOSED", closedAt: new Date() })
    .where(inArray(weightSheets.id, ids));
  for (const s of openSheets) {
    await db
      .insert(sheetEvents)
      .values({ sheetId: s.id, action: "CLOSED", detail: `Lot ${lotCode} closed — sheet locked` });
  }
  return openSheets.map((s) => s.ticketNo);
}

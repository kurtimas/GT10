import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { assertAdmin } from "./lib/adminPassword";
import { farmers, landlords, lots } from "../db/schema";
import { eq } from "drizzle-orm";
import { CROPS } from "../contracts/grain";
import { nextLotCode } from "../contracts/lotCode";
import { writeAudit } from "./lib/audit";
import { resolveOperator } from "./lib/operators";
import { closeOpenSheetsForLot } from "./lib/lotClose";

export const peopleRouter = createRouter({
  // ----------------------------------------------------------- farmers
  // Adding a farmer is daily in-season work and stays open; editing an
  // existing farmer (their identity/settlement record) needs the password.
  farmers: createRouter({
    list: publicQuery.query(() => getDb().select().from(farmers).orderBy(farmers.name)),
    create: publicQuery
      .input(
        z.object({
          name: z.string().min(1),
          phone: z.string().optional(),
          email: z.string().email().optional().or(z.literal("")),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const [{ id }] = await db
          .insert(farmers)
          .values({ name: input.name, phone: input.phone || null, email: input.email || null })
          .$returningId();
        await writeAudit(db, {
          actor: operator,
          action: "create",
          entityType: "farmer",
          entityId: id,
          after: { name: input.name, phone: input.phone || null, email: input.email || null },
        });
        return db.query.farmers.findFirst({ where: eq(farmers.id, id) });
      }),
    update: publicQuery
      .input(
        z.object({
          adminPassword: z.string(),
          id: z.number(),
          name: z.string().min(1).optional(),
          phone: z.string().optional(),
          email: z.string().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const { id, adminPassword, ...data } = input;
        assertAdmin(adminPassword);
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        if (Object.keys(data).length === 0) throw new Error("Nothing to update");
        const before = await db.query.farmers.findFirst({ where: eq(farmers.id, id) });
        if (!before) throw new Error("Farmer not found");
        await db.update(farmers).set(data).where(eq(farmers.id, id));
        await writeAudit(db, {
          actor: operator,
          action: "update",
          entityType: "farmer",
          entityId: id,
          before: { name: before.name, phone: before.phone, email: before.email },
          after: data,
        });
        return db.query.farmers.findFirst({ where: eq(farmers.id, id) });
      }),
  }),

  // ---------------------------------------------------------- landlords
  landlords: createRouter({
    list: publicQuery.query(() => getDb().select().from(landlords).orderBy(landlords.name)),
    create: publicQuery
      .input(
        z.object({
          adminPassword: z.string(),
          name: z.string().min(1),
          phone: z.string().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertAdmin(input.adminPassword);
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const [{ id }] = await db
          .insert(landlords)
          .values({ name: input.name, phone: input.phone || null })
          .$returningId();
        await writeAudit(db, {
          actor: operator,
          action: "create",
          entityType: "landlord",
          entityId: id,
          after: { name: input.name, phone: input.phone || null },
        });
        return db.query.landlords.findFirst({ where: eq(landlords.id, id) });
      }),
  }),

  // --------------------------------------------------------------- lots
  lots: createRouter({
    list: publicQuery.query(async () => {
      const db = getDb();
      const rows = await db
        .select({
          lot: lots,
          farmerName: farmers.name,
          landlordName: landlords.name,
        })
        .from(lots)
        .leftJoin(farmers, eq(lots.farmerId, farmers.id))
        .leftJoin(landlords, eq(lots.landlordId, landlords.id))
        .orderBy(lots.code);
      return rows.map((r) => ({ ...r.lot, farmerName: r.farmerName, landlordName: r.landlordName }));
    }),
    // suggested next lot code for a farmer: 706C-<INITIALS>-<YY><NN>
    nextCode: publicQuery
      .input(
        z.object({
          farmerId: z.number(),
          landlordId: z.number().nullable().optional(),
        }),
      )
      .query(async ({ input }) => {
        const db = getDb();
        const farmer = await db.query.farmers.findFirst({
          where: eq(farmers.id, input.farmerId),
        });
        if (!farmer) throw new Error("Farmer not found");
        const landlord =
          input.landlordId != null
            ? await db.query.landlords.findFirst({ where: eq(landlords.id, input.landlordId) })
            : null;
        const rows = await db.select({ code: lots.code }).from(lots);
        return { code: nextLotCode(rows.map((r) => r.code), farmer.name, landlord?.name) };
      }),
    create: publicQuery
      .input(
        z.object({
          farmerId: z.number(),
          landlordId: z.number().nullable().optional(),
          code: z.string().min(1),
          crop: z.enum(CROPS),
          landlordSplitPct: z.number().min(0).max(100).default(0),
          notes: z.string().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const lot = input;
        const [{ id }] = await db
          .insert(lots)
          .values({ ...lot, landlordId: lot.landlordId ?? null })
          .$returningId();
        await writeAudit(db, {
          actor: operator,
          action: "create",
          entityType: "lot",
          entityId: id,
          after: lot,
        });
        return db.query.lots.findFirst({ where: eq(lots.id, id) });
      }),
    update: publicQuery
      .input(
        z.object({
          id: z.number(),
          landlordId: z.number().nullable().optional(),
          landlordSplitPct: z.number().min(0).max(100).optional(),
          notes: z.string().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const { id, ...data } = input;
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const before = await db.query.lots.findFirst({ where: eq(lots.id, id) });
        if (!before) throw new Error("Lot not found");
        await db.update(lots).set(data).where(eq(lots.id, id));
        await writeAudit(db, {
          actor: operator,
          action: "update",
          entityType: "lot",
          entityId: id,
          before: {
            landlordId: before.landlordId,
            landlordSplitPct: before.landlordSplitPct,
            notes: before.notes,
          },
          after: data,
        });
        return db.query.lots.findFirst({ where: eq(lots.id, id) });
      }),
    // Lots stay open until the grower says the lot is done. While CLOSED no
    // new weight sheets can be opened against the lot; reopening is allowed.
    // Closing a lot also closes its OPEN weight sheets (refused while a
    // truck is mid-weigh) and reports which sheets were closed.
    setStatus: publicQuery
      .input(z.object({ id: z.number(), status: z.enum(["OPEN", "CLOSED"]) }))
      .mutation(async ({ input, ctx }) => {
        const db = getDb();
        const operator = await resolveOperator(db, ctx.operator);
        const lot = await db.query.lots.findFirst({ where: eq(lots.id, input.id) });
        if (!lot) throw new Error("Lot not found");
        await db
          .update(lots)
          .set({
            status: input.status,
            closedAt: input.status === "CLOSED" ? new Date() : null,
          })
          .where(eq(lots.id, input.id));
        // Closing a lot locks its live sheets so no more loads sneak in —
        // and tells the operator which ones were open.
        const closedSheets =
          input.status === "CLOSED" ? await closeOpenSheetsForLot(lot.id, lot.code) : [];
        await writeAudit(db, {
          actor: operator,
          action: "update",
          entityType: "lot",
          entityId: input.id,
          before: { status: lot.status },
          after: { status: input.status },
          note: closedSheets.length > 0 ? `closed sheets: ${closedSheets.join(", ")}` : undefined,
        });
        return {
          lot: await db.query.lots.findFirst({ where: eq(lots.id, input.id) }),
          closedSheets,
        };
      }),
  }),
});

export type PeopleRouter = typeof peopleRouter;

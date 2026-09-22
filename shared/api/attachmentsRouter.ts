import { z } from "zod";
import { and, desc, eq, ne } from "drizzle-orm";
import { createRouter, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { attachments, sites } from "../db/schema";
import { ATTACHMENT_ENTITY_TYPES, ATTACHMENT_MAX_BYTES } from "../contracts/compliance";
import {
  attachmentPath,
  deleteAttachmentFile,
  readAttachment,
  storeAttachment,
} from "./lib/attachmentStore";
import { writeAudit } from "./lib/audit";
import { resolveOperator } from "./lib/operators";

// ---------------------------------------------------------------------------
// Attachments API (Phase B, #26) — documents captured against any entity
// (loads/tickets, weight sheets, certificates, fumigation logs, …).
//
// Upload travels as base64 inside the tRPC call (the 50MB Hono body limit
// leaves ample headroom for the 10MB payload cap); download streams from
// GET /api/attachments/:id (wired in app/api/boot.ts) with the stored mime.
// Payloads are content-hash deduped under data/attachments/. Attach/detach
// are audit-logged; the rows are the metadata of record.
// ---------------------------------------------------------------------------

export const attachmentsRouter = createRouter({
  list: publicQuery
    .input(
      z.object({
        entityType: z.enum(ATTACHMENT_ENTITY_TYPES),
        entityId: z.number(),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select()
        .from(attachments)
        .where(and(eq(attachments.entityType, input.entityType), eq(attachments.entityId, input.entityId)))
        .orderBy(desc(attachments.createdAt), desc(attachments.id));
    }),

  upload: publicQuery
    .input(
      z.object({
        siteId: z.number(),
        entityType: z.enum(ATTACHMENT_ENTITY_TYPES),
        entityId: z.number().int().positive(),
        filename: z.string().trim().min(1).max(255),
        mime: z.string().trim().max(128).optional(),
        /** base64-encoded payload, ≤ ~10MB decoded */
        dataBase64: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const operator = await resolveOperator(db, ctx.operator);
      const site = await db.query.sites.findFirst({ where: eq(sites.id, input.siteId) });
      if (!site) throw new Error("Site not found");
      let data: Buffer;
      try {
        data = Buffer.from(input.dataBase64, "base64");
      } catch {
        throw new Error("Invalid base64 payload");
      }
      if (data.length === 0) throw new Error("Empty attachment");
      if (data.length > ATTACHMENT_MAX_BYTES) {
        throw new Error(
          `Attachment too large — ${Math.round(data.length / 1024 / 1024)}MB exceeds the ${ATTACHMENT_MAX_BYTES / 1024 / 1024}MB cap`,
        );
      }
      const { storageRef, size } = storeAttachment(data, input.filename);
      const [{ id }] = await db
        .insert(attachments)
        .values({
          siteId: input.siteId,
          entityType: input.entityType,
          entityId: input.entityId,
          filename: input.filename,
          mime: input.mime ?? null,
          size,
          storageRef,
          uploadedBy: operator,
        })
        .$returningId();
      await writeAudit(db, {
        actor: operator,
        action: "create",
        entityType: input.entityType,
        entityId: input.entityId,
        after: { attachmentId: id, filename: input.filename, size, storageRef },
        note: "Attachment uploaded",
      });
      return db.query.attachments.findFirst({ where: eq(attachments.id, id) });
    }),

  // tRPC download (base64) for small files / tests; the Hono route streams.
  download: publicQuery.input(z.object({ id: z.number() })).query(async ({ input }) => {
    const db = getDb();
    const row = await db.query.attachments.findFirst({ where: eq(attachments.id, input.id) });
    if (!row) throw new Error("Attachment not found");
    const data = readAttachment(row.storageRef);
    if (!data) throw new Error("Attachment payload is missing from storage");
    return {
      filename: row.filename,
      mime: row.mime ?? "application/octet-stream",
      size: row.size ?? data.length,
      dataBase64: data.toString("base64"),
    };
  }),

  delete: publicQuery.input(z.object({ id: z.number() })).mutation(async ({ input, ctx }) => {
    const db = getDb();
    const operator = await resolveOperator(db, ctx.operator);
    const row = await db.query.attachments.findFirst({ where: eq(attachments.id, input.id) });
    if (!row) throw new Error("Attachment not found");
    await db.delete(attachments).where(eq(attachments.id, input.id));
    // payload files are content-hash deduped — only delete when no other
    // row still references the same payload
    const stillUsed = await db.query.attachments.findFirst({
      where: and(eq(attachments.storageRef, row.storageRef), ne(attachments.id, input.id)),
    });
    if (!stillUsed) deleteAttachmentFile(row.storageRef);
    await writeAudit(db, {
      actor: operator,
      action: "void",
      entityType: row.entityType,
      entityId: row.entityId,
      before: { attachmentId: row.id, filename: row.filename, storageRef: row.storageRef },
      note: "Attachment deleted",
    });
    return { ok: true };
  }),
});

/** Resolve the streamable file for the Hono download route. */
export async function attachmentFileFor(id: number) {
  const db = getDb();
  const row = await db.query.attachments.findFirst({ where: eq(attachments.id, id) });
  if (!row) return null;
  const file = attachmentPath(row.storageRef);
  if (!file) return null;
  return { file, filename: row.filename, mime: row.mime ?? "application/octet-stream" };
}

export type AttachmentsRouter = typeof attachmentsRouter;

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ATTACHMENTS_DIR } from "../../contracts/compliance";

// ---------------------------------------------------------------------------
// Attachment payload storage (Phase B, #26). Files live under
// data/attachments/ (relative to the app working directory) named by content
// hash — identical payloads are stored once. The DB row (attachments table)
// carries the metadata; this module owns the bytes.
// ---------------------------------------------------------------------------

/** Absolute attachments directory, created on first use. */
export function attachmentsDir(): string {
  const dir = path.resolve(process.cwd(), ATTACHMENTS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const SAFE_EXT = /^[A-Za-z0-9]{1,10}$/;

/** Write a payload; returns the storageRef (content-hash filename). */
export function storeAttachment(data: Buffer, filename: string): { storageRef: string; size: number } {
  const hash = createHash("sha256").update(data).digest("hex");
  const rawExt = filename.includes(".") ? filename.split(".").pop()! : "";
  const ext = SAFE_EXT.test(rawExt) ? `.${rawExt.toLowerCase()}` : "";
  const storageRef = `${hash}${ext}`;
  const file = path.join(attachmentsDir(), storageRef);
  if (!fs.existsSync(file)) fs.writeFileSync(file, data);
  return { storageRef, size: data.length };
}

/** Resolve a storageRef to an absolute path (null when the file is gone). */
export function attachmentPath(storageRef: string): string | null {
  // storageRef is a hash + simple extension; refuse anything path-like
  if (!/^[a-f0-9]{64}(\.[A-Za-z0-9]{1,10})?$/.test(storageRef)) return null;
  const file = path.join(attachmentsDir(), storageRef);
  return fs.existsSync(file) ? file : null;
}

/** Read a stored payload. */
export function readAttachment(storageRef: string): Buffer | null {
  const file = attachmentPath(storageRef);
  return file ? fs.readFileSync(file) : null;
}

/** Delete the payload file (only when no DB row references it — caller checks). */
export function deleteAttachmentFile(storageRef: string): void {
  const file = attachmentPath(storageRef);
  if (file) fs.unlinkSync(file);
}

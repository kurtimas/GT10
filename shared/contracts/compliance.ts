// ---------------------------------------------------------------------------
// Compliance & traceability entity contracts (Phase A): program segregation
// (#17), record retention (#9), bin cleanouts (#12), shrink entries (#15),
// bin grade overrides (#18), fumigation logs (#19), certificates (#20),
// lab results (#22), attachments (#26). Free-ish enums: the *_TYPES lists
// are the suggested values; schemas accept any short non-empty string so an
// elevator is never blocked by our vocabulary.
// ---------------------------------------------------------------------------

import { z } from "zod";

// #17 — identity-preserved program segregation (lots, bins, denormalized
// onto loads). 'conventional' is the default everywhere.
export const PROGRAMS = ["conventional", "organic", "non-gmo", "seed", "certified"] as const;
export type Program = (typeof PROGRAMS)[number];
export const DEFAULT_PROGRAM: Program = "conventional";
export const programSchema = z.string().trim().min(1).max(32).default(DEFAULT_PROGRAM);

// #9 — configurable record retention. 6 years covers Iowa warehouse law and
// organic/EUDR (5) in one setting; 2–10 spans every cited state regime.
export const DEFAULT_RETENTION_YEARS = 6;
export const RETENTION_YEARS_MIN = 2;
export const RETENTION_YEARS_MAX = 10;
export const retentionYearsSchema = z
  .number()
  .int()
  .min(RETENTION_YEARS_MIN)
  .max(RETENTION_YEARS_MAX);
/** settings table key holding the retention value (written in Phase B). */
export const RETENTION_SETTINGS_KEY = "retentionYears";

// #12 — bin empty & cleanout records (genealogy reset points)
export const binCleanoutSchema = z.object({
  siteId: z.number().int().positive(),
  binId: z.number().int().positive(),
  emptiedAt: z.date(),
  cleanedAt: z.date().nullable().optional(),
  method: z.string().trim().max(255).nullable().optional(),
  note: z.string().max(4000).nullable().optional(),
  operator: z.string().trim().max(255).nullable().optional(),
});
export type BinCleanoutInput = z.infer<typeof binCleanoutSchema>;

// #15 — shrink / reconciliation entries (signed, append-only)
export const SHRINK_ENTRY_KINDS = ["moisture", "handling", "aeration", "error-correction"] as const;
export type ShrinkEntryKind = (typeof SHRINK_ENTRY_KINDS)[number];
export const shrinkEntrySchema = z.object({
  siteId: z.number().int().positive(),
  binId: z.number().int().positive(),
  kind: z.string().trim().min(1).max(24),
  quantityLbs: z.number().int().refine((n) => n !== 0, "quantityLbs must be non-zero"),
  effectiveDate: z.date(),
  note: z.string().max(4000).nullable().optional(),
  operator: z.string().trim().max(255).nullable().optional(),
});
export type ShrinkEntryInput = z.infer<typeof shrinkEntrySchema>;

// #18 — manual bin grade overrides (append-only; reason required)
export const binGradeOverrideSchema = z.object({
  siteId: z.number().int().positive(),
  binId: z.number().int().positive(),
  factor: z.string().trim().min(1).max(32),
  value: z.number(),
  reason: z.string().trim().min(3).max(4000),
  operator: z.string().trim().max(255).nullable().optional(),
});
export type BinGradeOverrideInput = z.infer<typeof binGradeOverrideSchema>;

// #19 — fumigation / treatment logs
export const fumigationLogSchema = z.object({
  siteId: z.number().int().positive(),
  binId: z.number().int().positive(),
  product: z.string().trim().min(1).max(255),
  dosage: z.string().trim().max(128).nullable().optional(),
  appliedAt: z.date(),
  exposureHours: z.number().min(0).max(24 * 60).nullable().optional(),
  aerationClearedAt: z.date().nullable().optional(),
  applicator: z.string().trim().max(255).nullable().optional(),
  note: z.string().max(4000).nullable().optional(),
});
export type FumigationLogInput = z.infer<typeof fumigationLogSchema>;

// #20 — certificate registry
export const CERTIFICATE_TYPES = [
  "fgis-inspection",
  "weight",
  "phyto",
  "origin",
  "fumigation",
  "mycotoxin",
  "non-gmo",
  "other",
] as const;
export type CertificateType = (typeof CERTIFICATE_TYPES)[number];
export const CERTIFICATE_STATUSES = ["issued", "reprinted", "void"] as const;
export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number];
export const certificateSchema = z.object({
  siteId: z.number().int().positive(),
  type: z.string().trim().min(1).max(32),
  certNumber: z.string().trim().min(1).max(128),
  issuedAt: z.date(),
  status: z.enum(CERTIFICATE_STATUSES).default("issued"),
  lotId: z.number().int().positive().nullable().optional(),
  shipmentId: z.number().int().positive().nullable().optional(),
  note: z.string().max(4000).nullable().optional(),
  fileRef: z.string().trim().max(255).nullable().optional(),
});
export type CertificateInput = z.infer<typeof certificateSchema>;

// #22 — lab results bound to the lot / load / bin they certify
export const LAB_TEST_TYPES = ["DON", "aflatoxin", "protein", "gmo", "other"] as const;
export type LabTestType = (typeof LAB_TEST_TYPES)[number];
export const labResultSchema = z
  .object({
    siteId: z.number().int().positive(),
    sampleDate: z.date(),
    labName: z.string().trim().max(255).nullable().optional(),
    testType: z.string().trim().min(1).max(32),
    result: z.string().trim().max(255).nullable().optional(),
    passFail: z.enum(["pass", "fail"]).nullable().optional(),
    lotId: z.number().int().positive().nullable().optional(),
    loadId: z.number().int().positive().nullable().optional(),
    binId: z.number().int().positive().nullable().optional(),
    note: z.string().max(4000).nullable().optional(),
  })
  .refine((r) => r.lotId != null || r.loadId != null || r.binId != null, {
    message: "a lab result must be tied to a lot, load, or bin",
  });
export type LabResultInput = z.infer<typeof labResultSchema>;

// #26 — attachments (entityId references whatever entityType names)
export const attachmentSchema = z.object({
  siteId: z.number().int().positive(),
  entityType: z.string().trim().min(1).max(64),
  entityId: z.number().int().positive(),
  filename: z.string().trim().min(1).max(255),
  mime: z.string().trim().max(128).nullable().optional(),
  size: z.number().int().min(0).nullable().optional(),
  storageRef: z.string().trim().min(1).max(255),
  uploadedBy: z.string().trim().max(255).nullable().optional(),
});
export type AttachmentInput = z.infer<typeof attachmentSchema>;
/** Local directory Phase B stores attachment payloads in. */
export const ATTACHMENTS_DIR = "data/attachments";

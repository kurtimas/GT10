// Shared view types between backend responses and frontend components.
// Dates arrive as Date instances via superjson.

/** One truck visit recorded on a weight sheet (a row of the paper sheet). */
export interface LoadRow {
  id: number;
  sheetId: number;
  loadNo: number;
  truckId: string | null;
  driverName: string | null;
  binId: number | null;
  grossLbs: number | null;
  tareLbs: number | null;
  netLbs: number | null;
  grossAt: Date | null;
  tareAt: Date | null;
  moisturePct: number | null;
  dockagePct: number | null;
  testWeightLbs: number | null;
  proteinPct: number | null;
  // enriched intake (Phase 3)
  damagePct: number | null;
  grade: string | null;
  farmOrigin: string | null;
  // remaining grade factors + program (Phase A)
  foreignMaterialPct: number | null;
  sbPct: number | null;
  program: string;
  shrinkPct: number | null;
  grossBushels: number | null;
  netBushels: number | null;
  // schedule-driven shrink/dock lbs (Phase B)
  shrinkLbs: number | null;
  dockLbs: number | null;
  shipmentId: number | null;
  changeReason: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  // joined
  binName: string | null;
}

/** A multi-load weight sheet tied to one lot. */
export interface SheetRow {
  id: number;
  ticketNo: string;
  siteId: number;
  farmerId: number;
  lotId: number | null;
  landlordId: number | null;
  crop: string;
  direction: "INBOUND" | "OUTBOUND";
  status: "OPEN" | "FULL" | "CLOSED";
  closeReason: string | null;
  maxLoads: number;
  notes: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
  // joined
  farmerName: string | null;
  lotCode: string | null;
  lotSplitPct: number | null;
  lotStatus: "OPEN" | "CLOSED" | null;
  landlordName: string | null;
  siteName: string | null;
  // load aggregates
  loadCount: number;
  completedLoads: number;
  netLbs: number;
  netBushels: number;
  /** the load still waiting for its second weight, if any */
  activeLoad: LoadRow | null;
  /** truck of the most recent load — handy prefill for the next load */
  lastTruckId: string | null;
  /** present when the caller asked for loads (open queue / detail) */
  loads?: LoadRow[];
}

/** A load flattened with its sheet context — daily report ledger rows. */
export interface ReportLoadRow {
  id: number;
  sheetId: number;
  ticketNo: string; // sheet ticket + load suffix, e.g. T-00012-03
  loadNo: number;
  farmerName: string | null;
  lotCode: string | null;
  landlordName: string | null;
  crop: string;
  direction: "INBOUND" | "OUTBOUND";
  status: "OPEN" | "COMPLETED"; // load-level: second weight captured?
  truckId: string | null;
  binName: string | null;
  grossLbs: number | null;
  tareLbs: number | null;
  netLbs: number | null;
  netBushels: number | null;
  moisturePct: number | null;
  createdAt: Date; // first-weight time (falls back to load creation)
}

export interface SheetEventRow {
  id: number;
  sheetId: number;
  loadId: number | null;
  action: string;
  detail: string | null;
  createdAt: Date;
}

export interface LotRow {
  id: number;
  farmerId: number;
  landlordId: number | null;
  code: string;
  crop: string;
  landlordSplitPct: number;
  status: "OPEN" | "CLOSED";
  program: string; // Phase A (#17)
  practices: string | null; // Phase A (#31)
  carbonNotes: string | null; // Phase A (#31)
  notes: string | null;
  createdAt: Date;
  closedAt: Date | null;
  farmerName: string | null;
  landlordName: string | null;
}

export interface BinRow {
  id: number;
  siteId: number;
  name: string;
  crop: string;
  capacityLbs: number;
  currentLbs: number;
  program: string; // Phase A (#17)
  createdAt: Date;
  siteName: string | null;
}

/** One append-only bin_movements event (Phase 3 provenance log). */
export interface BinMovementRow {
  id: number;
  siteId: number;
  lotId: number | null;
  /** null = inbound from field/truck */
  fromBinId: number | null;
  /** null = outbound (shipped / consumed) */
  toBinId: number | null;
  quantityLbs: number;
  loadId: number | null;
  shipmentId: number | null;
  operator: string | null;
  note: string | null;
  createdAt: Date;
}

/** One outbound shipment record (Phase 3). */
export interface ShipmentRow {
  id: number;
  siteId: number;
  customerName: string;
  destination: string | null;
  /** null when shipped from a mixed bin */
  lotId: number | null;
  binId: number | null;
  quantityLbs: number;
  quantityBu: number | null;
  truckId: string | null;
  binMovementId: number | null;
  note: string | null;
  createdAt: Date;
}

/** One generic audit trail entry (Phase 3 table; written from Phase 4). */
export interface AuditLogRow {
  id: number;
  actor: string;
  action: string; // create | update | void | adjust
  entityType: string;
  entityId: number;
  beforeJson: string | null;
  afterJson: string | null;
  note: string | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Phase A row types (research feature guide, data-model layer)
// ---------------------------------------------------------------------------

/** Per-crop shrink/dock schedule row (#3). siteId null = plant-wide default. */
export interface GradingScheduleRow {
  id: number;
  siteId: number | null;
  crop: string;
  moistureShrinkPerPoint: number;
  baseMoisturePct: number;
  handlingShrinkPct: number;
  dockageRules: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Grade-factor min/max range for one (crop, grade class, factor) (#3). */
export interface GradeFactorRow {
  id: number;
  siteId: number | null;
  crop: string;
  gradeClass: string;
  factor: string;
  minValue: number | null;
  maxValue: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Farmer/landlord percentage split of one load (#4). */
export interface LoadSplitRow {
  id: number;
  loadId: number;
  partyType: string; // farmer | landlord
  partyId: number;
  splitPct: number;
  createdAt: Date;
}

/** Bin empty & cleanout record — genealogy reset point (#12). */
export interface BinCleanoutRow {
  id: number;
  siteId: number;
  binId: number;
  emptiedAt: Date;
  cleanedAt: Date | null;
  method: string | null;
  note: string | null;
  operator: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Fumigation / treatment log entry (#19). */
export interface FumigationLogRow {
  id: number;
  siteId: number;
  binId: number;
  product: string;
  dosage: string | null;
  appliedAt: Date;
  exposureHours: number | null;
  aerationClearedAt: Date | null;
  applicator: string | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Certificate registry entry (#20). */
export interface CertificateRow {
  id: number;
  siteId: number;
  type: string;
  certNumber: string;
  issuedAt: Date;
  status: string; // issued | reprinted | void
  lotId: number | null;
  shipmentId: number | null;
  note: string | null;
  fileRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Lab result bound to a lot / load / bin (#22). */
export interface LabResultRow {
  id: number;
  siteId: number;
  sampleDate: Date;
  labName: string | null;
  testType: string;
  result: string | null;
  passFail: string | null; // pass | fail | null
  lotId: number | null;
  loadId: number | null;
  binId: number | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Attached document metadata (#26). */
export interface AttachmentRow {
  id: number;
  siteId: number;
  entityType: string;
  entityId: number;
  filename: string;
  mime: string | null;
  size: number | null;
  storageRef: string;
  uploadedBy: string | null;
  createdAt: Date;
}

/** Shrink / reconciliation adjustment entry (#15), quantityLbs signed. */
export interface ShrinkEntryRow {
  id: number;
  siteId: number;
  binId: number;
  kind: string; // moisture | handling | aeration | error-correction
  quantityLbs: number;
  effectiveDate: Date;
  note: string | null;
  operator: string | null;
  createdAt: Date;
}

/** Manual override of a computed bin grade average (#18), append-only. */
export interface BinGradeOverrideRow {
  id: number;
  siteId: number;
  binId: number;
  factor: string;
  value: number;
  reason: string;
  operator: string | null;
  createdAt: Date;
}

/** Frozen Daily Position Record row, one per site × day × crop × program (#5). */
export interface DprSnapshotRow {
  id: number;
  siteId: number;
  day: string; // YYYY-MM-DD
  crop: string;
  program: string;
  openingLbs: number;
  receivedLbs: number;
  receivedBu: number;
  shippedLbs: number;
  shippedBu: number;
  transfersInLbs: number;
  transfersOutLbs: number;
  shrinkMoistureLbs: number;
  shrinkHandlingLbs: number;
  shrinkAerationLbs: number;
  shrinkErrorCorrectionLbs: number;
  adjustmentsLbs: number;
  endingLbs: number;
  endingBu: number;
  frozen: boolean;
  createdAt: Date;
}

/** Physical bin count for mass-balance reconciliation (#15). */
export interface PhysicalCountRow {
  id: number;
  siteId: number;
  binId: number;
  countedLbs: number;
  countedAt: Date;
  note: string | null;
  operator: string | null;
  createdAt: Date;
}

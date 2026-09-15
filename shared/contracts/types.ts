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
  shrinkPct: number | null;
  grossBushels: number | null;
  netBushels: number | null;
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

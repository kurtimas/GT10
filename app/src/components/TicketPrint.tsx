// TicketPrint (C10 / spec §5.7) — print-only scale ticket for one weight
// sheet. Invisible on screen (`#ticket-print { display: none }` in
// shared/src/index.css); `@media print` hides the app and shows only this
// node. A "Print ticket" button in the sheet detail just calls
// window.print(). Plain inline styles so the ticket is independent of the
// (dark) app theme.

import { fmtBu, fmtLbs } from "@contracts/grain";

interface TicketLoad {
  loadNo: number;
  truckId: string | null;
  driverName?: string | null;
  binName?: string | null;
  grossLbs: number | null;
  tareLbs: number | null;
  netLbs: number | null;
  netBushels: number | null;
  grossAt?: Date | string | null;
  tareAt?: Date | string | null;
  voidedAt?: Date | string | null;
}

export interface TicketSheet {
  ticketNo: string;
  status: string;
  direction: string;
  crop: string;
  farmerName?: string | null;
  lotCode?: string | null;
  landlordName?: string | null;
  lotSplitPct?: number | null;
  siteName?: string | null;
  createdAt?: Date | string | null;
  closedAt?: Date | string | null;
  netLbs?: number | null;
  netBushels?: number | null;
  voidedAt?: Date | string | null;
  voidReason?: string | null;
  notes?: string | null;
  loads?: TicketLoad[];
}

const S = {
  page: { fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#000" } as const,
  h1: { fontSize: 18, fontWeight: 700, letterSpacing: 2, margin: 0 } as const,
  sub: { fontSize: 11, color: "#333" } as const,
  hr: { border: "none", borderTop: "2px solid #000", margin: "8px 0" } as const,
  th: { textAlign: "right", borderBottom: "1px solid #000", padding: "3px 6px", fontSize: 10, textTransform: "uppercase" } as const,
  thL: { textAlign: "left", borderBottom: "1px solid #000", padding: "3px 6px", fontSize: 10, textTransform: "uppercase" } as const,
  td: { textAlign: "right", padding: "3px 6px", fontVariantNumeric: "tabular-nums" } as const,
  tdL: { textAlign: "left", padding: "3px 6px" } as const,
};

function fmtTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function TicketPrint({ sheet }: { sheet: TicketSheet }) {
  const liveLoads = (sheet.loads ?? []).filter((l) => l.voidedAt == null);
  return (
    <div id="ticket-print" style={S.page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 style={S.h1}>SCALE TICKET</h1>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{sheet.ticketNo}</div>
      </div>
      <div style={S.sub}>
        Grain Tracker · {sheet.siteName ?? "—"} · printed{" "}
        {new Date().toLocaleString("en-US")}
      </div>
      <hr style={S.hr} />
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 8 }}>
        <tbody>
          <tr>
            <td style={S.tdL}><b>Farmer:</b> {sheet.farmerName ?? "—"}</td>
            <td style={S.tdL}><b>Lot:</b> {sheet.lotCode ?? "—"}</td>
            <td style={S.tdL}><b>Crop:</b> {sheet.crop}</td>
            <td style={S.tdL}><b>Direction:</b> {sheet.direction}</td>
          </tr>
          <tr>
            <td style={S.tdL}>
              <b>Landlord:</b> {sheet.landlordName ?? "—"}
              {sheet.lotSplitPct != null && sheet.lotSplitPct > 0 ? ` (${sheet.lotSplitPct}%)` : ""}
            </td>
            <td style={S.tdL}><b>Opened:</b> {fmtTime(sheet.createdAt)}</td>
            <td style={S.tdL}><b>Closed:</b> {sheet.closedAt ? fmtTime(sheet.closedAt) : "—"}</td>
            <td style={S.tdL}><b>Status:</b> {sheet.status}</td>
          </tr>
        </tbody>
      </table>

      {sheet.voidedAt != null && (
        <div style={{ border: "2px solid #000", padding: 6, marginBottom: 8, fontWeight: 700 }}>
          VOID — {sheet.voidReason ?? "no reason recorded"} ({fmtTime(sheet.voidedAt)})
        </div>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={S.th}>#</th>
            <th style={S.thL}>Truck</th>
            <th style={S.thL}>Driver</th>
            <th style={S.thL}>Bin</th>
            <th style={S.th}>Gross lbs</th>
            <th style={S.th}>Tare lbs</th>
            <th style={S.th}>Net lbs</th>
            <th style={S.th}>Net bu</th>
            <th style={S.thL}>Weighed in</th>
            <th style={S.thL}>Weighed out</th>
          </tr>
        </thead>
        <tbody>
          {liveLoads.map((l) => (
            <tr key={l.loadNo}>
              <td style={S.td}>{l.loadNo}</td>
              <td style={S.tdL}>{l.truckId ?? "—"}</td>
              <td style={S.tdL}>{l.driverName ?? "—"}</td>
              <td style={S.tdL}>{l.binName ?? "—"}</td>
              <td style={S.td}>{fmtLbs(l.grossLbs)}</td>
              <td style={S.td}>{fmtLbs(l.tareLbs)}</td>
              <td style={{ ...S.td, fontWeight: 700 }}>{fmtLbs(l.netLbs)}</td>
              <td style={S.td}>{l.netBushels != null ? fmtBu(l.netBushels) : "—"}</td>
              <td style={S.tdL}>{fmtTime(l.grossAt)}</td>
              <td style={S.tdL}>{fmtTime(l.tareAt)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6} style={{ ...S.td, borderTop: "2px solid #000", fontWeight: 700 }}>
              TOTAL ({liveLoads.length} load{liveLoads.length === 1 ? "" : "s"})
            </td>
            <td style={{ ...S.td, borderTop: "2px solid #000", fontWeight: 700 }}>
              {fmtLbs(sheet.netLbs ?? 0)}
            </td>
            <td style={{ ...S.td, borderTop: "2px solid #000", fontWeight: 700 }}>
              {fmtBu(sheet.netBushels ?? 0)}
            </td>
            <td colSpan={2} style={{ borderTop: "2px solid #000" }} />
          </tr>
        </tfoot>
      </table>

      {sheet.notes && <div style={{ marginTop: 8, ...S.sub }}>Notes: {sheet.notes}</div>}

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 36, fontSize: 11 }}>
        <span>Operator: ______________________</span>
        <span>Received by: ______________________</span>
      </div>
    </div>
  );
}

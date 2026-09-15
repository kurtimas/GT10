// Tiny CSV export helper (P2) — used by the "Download CSV" buttons on the
// sheets/loads archive, shipments, bin movements, and audit lists in both
// apps. Exports exactly the rows the list is showing.

export type CsvCell = string | number | null | undefined;

/** Escape one cell per RFC 4180: quote when needed, double inner quotes. */
function cell(v: CsvCell): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers.map(cell).join(",")];
  for (const r of rows) lines.push(r.map(cell).join(","));
  // CRLF + BOM so Excel opens it cleanly on Windows
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** Trigger a browser download of the CSV. */
export function downloadCsv(filename: string, headers: string[], rows: CsvCell[][]) {
  const blob = new Blob([toCsv(headers, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** YYYY-MM-DD stamp for filenames. */
export function csvDateStamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

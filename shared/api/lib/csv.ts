// ---------------------------------------------------------------------------
// Minimal CSV encoder (Phase B) — used by DPR / trace / exam-mode exports.
// RFC-4180-ish: quote fields containing commas, quotes, or newlines; dates
// serialize as ISO strings; null/undefined become empty cells.
// ---------------------------------------------------------------------------

export type CsvValue = string | number | boolean | Date | null | undefined;

function cell(v: CsvValue): string {
  if (v == null) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV document from a header list and row objects/arrays. */
export function toCsv(
  headers: string[],
  rows: (CsvValue[] | Record<string, CsvValue>)[],
): string {
  const lines = [headers.map(cell).join(",")];
  for (const row of rows) {
    const values = Array.isArray(row) ? row : headers.map((h) => row[h]);
    lines.push(values.map(cell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

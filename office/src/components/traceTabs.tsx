import { useState } from "react";
import { Download } from "lucide-react";
import { trpc } from "@shared/src/lib/trpc";
import { fmtBu, fmtLbs } from "@contracts/grain";
import { csvDateStamp, downloadCsv, type CsvCell } from "@shared/src/lib/csv";
import { QueryError } from "@shared/src/components/QueryError";
import { Badge } from "@shared/src/components/ui/badge";
import { Button } from "@shared/src/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shared/src/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@shared/src/components/ui/table";

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function fmtDateTime(d: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtDay(d: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtSize(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Right-aligned CSV export bar, matching the Phase-6 tabs. */
function ExportBar({
  filename,
  headers,
  rows,
}: {
  filename: string;
  headers: string[];
  rows: CsvCell[][];
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-end gap-2 border-b border-border px-3 py-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={rows.length === 0}
          onClick={() => downloadCsv(filename, headers, rows)}
        >
          <Download className="mr-1.5 h-3.5 w-3.5" />
          CSV
        </Button>
      </CardContent>
    </Card>
  );
}

function StateRow({ colSpan, children }: { colSpan: number; children: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="text-muted-foreground">
        {children}
      </TableCell>
    </TableRow>
  );
}

function TabError({
  title,
  q,
}: {
  title: string;
  q: { error: { message: string }; refetch: () => Promise<unknown>; isRefetching: boolean };
}) {
  return (
    <QueryError
      title={title}
      message={q.error.message}
      onRetry={() => void q.refetch()}
      retrying={q.isRefetching}
    />
  );
}

/* ------------------------------------------------------------------ */
/* DPR tab — frozen Daily Position Record snapshots (list + detail)    */
/* ------------------------------------------------------------------ */

export function DprTab() {
  const q = trpc.office.dpr.list.useQuery();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const detail = trpc.office.dpr.get.useQuery(
    { id: selectedId ?? 0 },
    { enabled: selectedId != null },
  );

  const rows = q.data ?? [];

  return (
    <div className="space-y-3">
      {q.isError && <TabError title="DPR snapshots failed to load" q={q} />}
      <ExportBar
        filename={`office-dpr-${csvDateStamp()}.csv`}
        headers={[
          "Day", "Site", "Crop", "Program", "Opening lbs", "Received lbs", "Received bu",
          "Shipped lbs", "Shipped bu", "Transfers in lbs", "Transfers out lbs",
          "Shrink moisture lbs", "Shrink handling lbs", "Shrink aeration lbs",
          "Shrink error-correction lbs", "Adjustments lbs", "Ending lbs", "Ending bu", "Frozen",
        ]}
        rows={rows.map((r) => [
          r.day, r.siteName, r.crop, r.program, r.openingLbs, r.receivedLbs, r.receivedBu,
          r.shippedLbs, r.shippedBu, r.transfersInLbs, r.transfersOutLbs,
          r.shrinkMoistureLbs, r.shrinkHandlingLbs, r.shrinkAerationLbs,
          r.shrinkErrorCorrectionLbs, r.adjustmentsLbs, r.endingLbs, r.endingBu,
          r.frozen ? "yes" : "no",
        ])}
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Crop</TableHead>
                <TableHead>Program</TableHead>
                <TableHead className="text-right">Opening</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Shipped</TableHead>
                <TableHead className="text-right">Ending</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isPending ? (
                <StateRow colSpan={9}>Loading…</StateRow>
              ) : rows.length === 0 ? (
                <StateRow colSpan={9}>
                  No DPR snapshots yet — they freeze at end-of-day close on each scale house.
                </StateRow>
              ) : (
                rows.map((r) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    data-state={selectedId === r.id ? "selected" : undefined}
                    onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}
                  >
                    <TableCell className="font-mono text-xs">{r.day}</TableCell>
                    <TableCell className="text-xs">{r.siteName ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.crop}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {r.program}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {fmtLbs(r.openingLbs)} lb
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {fmtLbs(r.receivedLbs)} lb
                      <span className="ml-1 text-muted-foreground">({fmtBu(r.receivedBu)} bu)</span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {fmtLbs(r.shippedLbs)} lb
                      <span className="ml-1 text-muted-foreground">({fmtBu(r.shippedBu)} bu)</span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {fmtLbs(r.endingLbs)} lb
                      <span className="ml-1 text-muted-foreground">({fmtBu(r.endingBu)} bu)</span>
                    </TableCell>
                    <TableCell>
                      {r.frozen ? (
                        <Badge className="font-mono text-[10px]">frozen</Badge>
                      ) : (
                        <Badge variant="secondary" className="font-mono text-[10px]">open</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selectedId != null && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              DPR detail — {detail.data ? `${detail.data.day} · ${detail.data.crop}` : "…"}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Storage-vs-owned ownership is not modeled (ownershipModeled: false) — quantities
              are total book stock. Click the row again to collapse.
            </p>
          </CardHeader>
          <CardContent>
            {detail.isPending ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : detail.isError ? (
              <TabError title="DPR detail failed to load" q={detail} />
            ) : detail.data ? (
              <div className="grid gap-x-8 gap-y-1 font-mono text-xs tabular-nums sm:grid-cols-2 lg:grid-cols-3">
                {(
                  [
                    ["Opening", `${fmtLbs(detail.data.openingLbs)} lb`],
                    ["Received", `${fmtLbs(detail.data.receivedLbs)} lb (${fmtBu(detail.data.receivedBu)} bu)`],
                    ["Shipped", `${fmtLbs(detail.data.shippedLbs)} lb (${fmtBu(detail.data.shippedBu)} bu)`],
                    ["Transfers in", `${fmtLbs(detail.data.transfersInLbs)} lb`],
                    ["Transfers out", `${fmtLbs(detail.data.transfersOutLbs)} lb`],
                    ["Shrink — moisture", `${fmtLbs(detail.data.shrinkMoistureLbs)} lb`],
                    ["Shrink — handling", `${fmtLbs(detail.data.shrinkHandlingLbs)} lb`],
                    ["Shrink — aeration", `${fmtLbs(detail.data.shrinkAerationLbs)} lb`],
                    ["Shrink — error correction", `${fmtLbs(detail.data.shrinkErrorCorrectionLbs)} lb`],
                    ["Manual adjustments", `${fmtLbs(detail.data.adjustmentsLbs)} lb`],
                    ["Ending", `${fmtLbs(detail.data.endingLbs)} lb (${fmtBu(detail.data.endingBu)} bu)`],
                    ["Frozen", detail.data.frozen ? "yes — immutable" : "no — regenerable until close"],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{label}</span>
                    <span>{value}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Certificates tab — registry with status badges                      */
/* ------------------------------------------------------------------ */

function CertStatusBadge({ status }: { status: string }) {
  if (status === "void") return <Badge variant="destructive" className="font-mono text-[10px]">void</Badge>;
  if (status === "reprinted") return <Badge variant="secondary" className="font-mono text-[10px]">reprinted</Badge>;
  return <Badge className="font-mono text-[10px]">issued</Badge>;
}

export function CertificatesTab() {
  const q = trpc.office.certificates.useQuery();
  const rows = q.data ?? [];

  return (
    <div className="space-y-3">
      {q.isError && <TabError title="Certificates failed to load" q={q} />}
      <ExportBar
        filename={`office-certificates-${csvDateStamp()}.csv`}
        headers={["Issued", "Site", "Type", "Cert no.", "Status", "Lot", "Note"]}
        rows={rows.map((c) => [
          c.issuedAt ? new Date(c.issuedAt).toLocaleString("en-US") : null,
          c.siteName, c.type, c.certNumber, c.status, c.lotCode, c.note,
        ])}
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Issued</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Cert no.</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Lot</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isPending ? (
                <StateRow colSpan={7}>Loading…</StateRow>
              ) : rows.length === 0 ? (
                <StateRow colSpan={7}>No certificates synced yet.</StateRow>
              ) : (
                rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {fmtDateTime(c.issuedAt)}
                    </TableCell>
                    <TableCell className="text-xs">{c.siteName ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[10px]">{c.type}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.certNumber}</TableCell>
                    <TableCell>
                      <CertStatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.lotCode ?? "—"}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                      {c.note ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lab results tab                                                     */
/* ------------------------------------------------------------------ */

function PassFailBadge({ passFail }: { passFail: string | null }) {
  if (passFail === "pass") return <Badge className="font-mono text-[10px]">pass</Badge>;
  if (passFail === "fail") return <Badge variant="destructive" className="font-mono text-[10px]">fail</Badge>;
  return <span className="text-xs text-muted-foreground">—</span>;
}

export function LabResultsTab() {
  const q = trpc.office.labResults.useQuery();
  const rows = q.data ?? [];

  return (
    <div className="space-y-3">
      {q.isError && <TabError title="Lab results failed to load" q={q} />}
      <ExportBar
        filename={`office-lab-results-${csvDateStamp()}.csv`}
        headers={["Sample date", "Site", "Test", "Result", "Pass/fail", "Lab", "Lot", "Bin", "Note"]}
        rows={rows.map((r) => [
          r.sampleDate ? new Date(r.sampleDate).toLocaleDateString("en-US") : null,
          r.siteName, r.testType, r.result, r.passFail, r.labName, r.lotCode, r.binName, r.note,
        ])}
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sample date</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Test</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Pass/fail</TableHead>
                <TableHead>Lab</TableHead>
                <TableHead>Lot</TableHead>
                <TableHead>Bin</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isPending ? (
                <StateRow colSpan={9}>Loading…</StateRow>
              ) : rows.length === 0 ? (
                <StateRow colSpan={9}>No lab results synced yet.</StateRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {fmtDay(r.sampleDate)}
                    </TableCell>
                    <TableCell className="text-xs">{r.siteName ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[10px]">{r.testType}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.result ?? "—"}</TableCell>
                    <TableCell>
                      <PassFailBadge passFail={r.passFail} />
                    </TableCell>
                    <TableCell className="text-xs">{r.labName ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.lotCode ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.binName ?? "—"}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                      {r.note ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fumigations tab                                                     */
/* ------------------------------------------------------------------ */

export function FumigationsTab() {
  const q = trpc.office.fumigations.useQuery();
  const rows = q.data ?? [];

  return (
    <div className="space-y-3">
      {q.isError && <TabError title="Fumigation logs failed to load" q={q} />}
      <ExportBar
        filename={`office-fumigations-${csvDateStamp()}.csv`}
        headers={["Applied", "Site", "Bin", "Product", "Dosage", "Exposure h", "Aeration cleared", "Applicator", "Note"]}
        rows={rows.map((f) => [
          f.appliedAt ? new Date(f.appliedAt).toLocaleString("en-US") : null,
          f.siteName, f.binName, f.product, f.dosage, f.exposureHours,
          f.aerationClearedAt ? new Date(f.aerationClearedAt).toLocaleString("en-US") : null,
          f.applicator, f.note,
        ])}
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Applied</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Bin</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Dosage</TableHead>
                <TableHead className="text-right">Exposure</TableHead>
                <TableHead>Aeration</TableHead>
                <TableHead>Applicator</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isPending ? (
                <StateRow colSpan={9}>Loading…</StateRow>
              ) : rows.length === 0 ? (
                <StateRow colSpan={9}>No fumigation logs synced yet.</StateRow>
              ) : (
                rows.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {fmtDateTime(f.appliedAt)}
                    </TableCell>
                    <TableCell className="text-xs">{f.siteName ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{f.binName ?? "—"}</TableCell>
                    <TableCell className="text-xs font-medium">{f.product}</TableCell>
                    <TableCell className="font-mono text-xs">{f.dosage ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {f.exposureHours != null ? `${f.exposureHours} h` : "—"}
                    </TableCell>
                    <TableCell>
                      {f.aerationClearedAt ? (
                        <Badge className="font-mono text-[10px]">aerated</Badge>
                      ) : (
                        <Badge variant="secondary" className="font-mono text-[10px]">active</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{f.applicator ?? "—"}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                      {f.note ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cleanouts tab                                                       */
/* ------------------------------------------------------------------ */

export function CleanoutsTab() {
  const q = trpc.office.cleanouts.useQuery();
  const rows = q.data ?? [];

  return (
    <div className="space-y-3">
      {q.isError && <TabError title="Cleanouts failed to load" q={q} />}
      <ExportBar
        filename={`office-cleanouts-${csvDateStamp()}.csv`}
        headers={["Emptied", "Site", "Bin", "Cleaned", "Method", "Operator", "Note"]}
        rows={rows.map((c) => [
          c.emptiedAt ? new Date(c.emptiedAt).toLocaleString("en-US") : null,
          c.siteName, c.binName,
          c.cleanedAt ? new Date(c.cleanedAt).toLocaleString("en-US") : null,
          c.method, c.operator, c.note,
        ])}
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Emptied</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Bin</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Operator</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isPending ? (
                <StateRow colSpan={7}>Loading…</StateRow>
              ) : rows.length === 0 ? (
                <StateRow colSpan={7}>No cleanouts synced yet.</StateRow>
              ) : (
                rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {fmtDateTime(c.emptiedAt)}
                    </TableCell>
                    <TableCell className="text-xs">{c.siteName ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{c.binName ?? "—"}</TableCell>
                    <TableCell>
                      {c.cleanedAt ? (
                        <Badge className="font-mono text-[10px]">
                          cleaned {fmtDay(c.cleanedAt)}
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="font-mono text-[10px]">
                          pending cleanout
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{c.method ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{c.operator ?? "—"}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                      {c.note ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shrink entries tab — signed, append-only reconciliation entries     */
/* ------------------------------------------------------------------ */

export function ShrinkTab() {
  const q = trpc.office.shrinkEntries.useQuery();
  const rows = q.data ?? [];

  return (
    <div className="space-y-3">
      {q.isError && <TabError title="Shrink entries failed to load" q={q} />}
      <ExportBar
        filename={`office-shrink-${csvDateStamp()}.csv`}
        headers={["Effective date", "Site", "Bin", "Kind", "Qty lbs", "Operator", "Note"]}
        rows={rows.map((e) => [
          e.effectiveDate ? new Date(e.effectiveDate).toLocaleDateString("en-US") : null,
          e.siteName, e.binName, e.kind, e.quantityLbs, e.operator, e.note,
        ])}
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Effective</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Bin</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Operator</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isPending ? (
                <StateRow colSpan={7}>Loading…</StateRow>
              ) : rows.length === 0 ? (
                <StateRow colSpan={7}>No shrink entries synced yet.</StateRow>
              ) : (
                rows.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {fmtDay(e.effectiveDate)}
                    </TableCell>
                    <TableCell className="text-xs">{e.siteName ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{e.binName ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[10px]">{e.kind}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {e.quantityLbs > 0 ? "+" : ""}
                      {fmtLbs(e.quantityLbs)} lb
                    </TableCell>
                    <TableCell className="font-mono text-xs">{e.operator ?? "—"}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                      {e.note ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Grade overrides tab — append-only; latest per (bin, factor) wins    */
/* ------------------------------------------------------------------ */

export function GradeOverridesTab() {
  const q = trpc.office.gradeOverrides.useQuery();
  const rows = q.data ?? [];

  return (
    <div className="space-y-3">
      {q.isError && <TabError title="Grade overrides failed to load" q={q} />}
      <ExportBar
        filename={`office-grade-overrides-${csvDateStamp()}.csv`}
        headers={["Time", "Site", "Bin", "Factor", "Value", "Reason", "Operator"]}
        rows={rows.map((o) => [
          o.createdAt ? new Date(o.createdAt).toLocaleString("en-US") : null,
          o.siteName, o.binName, o.factor, o.value, o.reason, o.operator,
        ])}
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Bin</TableHead>
                <TableHead>Factor</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Operator</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isPending ? (
                <StateRow colSpan={7}>Loading…</StateRow>
              ) : rows.length === 0 ? (
                <StateRow colSpan={7}>No grade overrides synced yet.</StateRow>
              ) : (
                rows.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {fmtDateTime(o.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs">{o.siteName ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{o.binName ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[10px]">{o.factor}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {o.value}
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate text-xs text-muted-foreground">
                      {o.reason}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{o.operator ?? "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Attachments tab — METADATA only; binaries never leave the plant     */
/* ------------------------------------------------------------------ */

export function AttachmentsTab() {
  const q = trpc.office.attachments.useQuery();
  const rows = q.data ?? [];

  return (
    <div className="space-y-3">
      {q.isError && <TabError title="Attachments failed to load" q={q} />}
      <p className="text-xs text-muted-foreground">
        Document metadata only — files themselves stay on the scale-house
        server (binaries are never synced), so there is no download here.
      </p>
      <ExportBar
        filename={`office-attachments-${csvDateStamp()}.csv`}
        headers={["Uploaded", "Site", "Entity type", "Entity id (plant)", "Filename", "MIME", "Size bytes", "Uploaded by"]}
        rows={rows.map((a) => [
          a.createdAt ? new Date(a.createdAt).toLocaleString("en-US") : null,
          a.siteName, a.entityType, a.entityId, a.filename, a.mime, a.size, a.uploadedBy,
        ])}
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Uploaded</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Filename</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead>Uploaded by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isPending ? (
                <StateRow colSpan={6}>Loading…</StateRow>
              ) : rows.length === 0 ? (
                <StateRow colSpan={6}>No attachments synced yet.</StateRow>
              ) : (
                rows.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {fmtDateTime(a.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs">{a.siteName ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {a.entityType} #{a.entityId}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate font-mono text-xs">
                      {a.filename}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {fmtSize(a.size)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{a.uploadedBy ?? "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Load splits tab — farmer/landlord shares per load                   */
/* ------------------------------------------------------------------ */

export function SplitsTab() {
  const q = trpc.office.splits.useQuery();
  const rows = q.data ?? [];

  return (
    <div className="space-y-3">
      {q.isError && <TabError title="Load splits failed to load" q={q} />}
      <ExportBar
        filename={`office-load-splits-${csvDateStamp()}.csv`}
        headers={["Ticket", "Load", "Site", "Party type", "Party", "Split %", "Recorded"]}
        rows={rows.map((s) => [
          s.ticketNo, s.loadNo, s.siteName, s.partyType, s.partyName, s.splitPct,
          s.createdAt ? new Date(s.createdAt).toLocaleString("en-US") : null,
        ])}
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticket / load</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Party</TableHead>
                <TableHead className="text-right">Split</TableHead>
                <TableHead>Recorded</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isPending ? (
                <StateRow colSpan={5}>Loading…</StateRow>
              ) : rows.length === 0 ? (
                <StateRow colSpan={5}>No load splits synced yet.</StateRow>
              ) : (
                rows.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {s.ticketNo}
                      {s.loadNo != null && (
                        <span className="text-muted-foreground"> #{s.loadNo}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{s.siteName ?? "—"}</TableCell>
                    <TableCell className="text-xs">
                      {s.partyName ?? "—"}
                      <span className="ml-1.5 text-muted-foreground">({s.partyType})</span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {s.splitPct}%
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {fmtDateTime(s.createdAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Grading tab — read-only reference: shrink/dock schedules + factor   */
/* validation ranges mirrored from each plant.                          */
/* ------------------------------------------------------------------ */

export function GradingTab() {
  const schedules = trpc.office.gradingSchedules.useQuery();
  const factors = trpc.office.gradeFactors.useQuery();
  const schedRows = schedules.data ?? [];
  const factorRows = factors.data ?? [];

  return (
    <div className="space-y-6">
      {/* Shrink/dock schedules */}
      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-widest">
            Shrink/dock schedules
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Rows with no site are plant-wide defaults. Read-only here — edited
            on each scale house.
          </p>
        </div>
        {schedules.isError && <TabError title="Grading schedules failed to load" q={schedules} />}
        <ExportBar
          filename={`office-grading-schedules-${csvDateStamp()}.csv`}
          headers={["Crop", "Site", "Moisture shrink %/pt", "Base moisture %", "Handling shrink %", "Dockage rules", "Updated"]}
          rows={schedRows.map((s) => [
            s.crop, s.siteName ?? "(all sites)", s.moistureShrinkPerPoint,
            s.baseMoisturePct, s.handlingShrinkPct, s.dockageRules,
            s.updatedAt ? new Date(s.updatedAt).toLocaleString("en-US") : null,
          ])}
        />
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Crop</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead className="text-right">Shrink %/pt</TableHead>
                  <TableHead className="text-right">Base moisture</TableHead>
                  <TableHead className="text-right">Handling %</TableHead>
                  <TableHead>Dockage rules</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.isPending ? (
                  <StateRow colSpan={6}>Loading…</StateRow>
                ) : schedRows.length === 0 ? (
                  <StateRow colSpan={6}>No grading schedules synced yet.</StateRow>
                ) : (
                  schedRows.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="text-xs font-medium">{s.crop}</TableCell>
                      <TableCell className="text-xs">{s.siteName ?? "(all sites)"}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {s.moistureShrinkPerPoint}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {s.baseMoisturePct}%
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {s.handlingShrinkPct}%
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate text-xs text-muted-foreground">
                        {s.dockageRules ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Grade factor ranges */}
      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-widest">
            Grade factor ranges
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Min/max validation ranges per crop × grade class × factor.
          </p>
        </div>
        {factors.isError && <TabError title="Grade factors failed to load" q={factors} />}
        <ExportBar
          filename={`office-grade-factors-${csvDateStamp()}.csv`}
          headers={["Crop", "Grade class", "Factor", "Min", "Max", "Site"]}
          rows={factorRows.map((f) => [
            f.crop, f.gradeClass, f.factor, f.minValue, f.maxValue, f.siteName ?? "(all sites)",
          ])}
        />
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Crop</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead>Factor</TableHead>
                  <TableHead className="text-right">Min</TableHead>
                  <TableHead className="text-right">Max</TableHead>
                  <TableHead>Site</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {factors.isPending ? (
                  <StateRow colSpan={6}>Loading…</StateRow>
                ) : factorRows.length === 0 ? (
                  <StateRow colSpan={6}>No grade factors synced yet.</StateRow>
                ) : (
                  factorRows.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell className="text-xs font-medium">{f.crop}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {f.gradeClass}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{f.factor}</TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {f.minValue ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {f.maxValue ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">{f.siteName ?? "(all sites)"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

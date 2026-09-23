import { Download } from "lucide-react";
import { trpc } from "@shared/src/lib/trpc";
import { fmtBu, fmtLbs } from "@contracts/grain";
import { csvDateStamp, downloadCsv } from "@shared/src/lib/csv";
import { AuditLogTable } from "@shared/src/components/AuditLogTable";
import { QueryError } from "@shared/src/components/QueryError";
import { Badge } from "@shared/src/components/ui/badge";
import { Button } from "@shared/src/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shared/src/components/ui/card";
import { Skeleton } from "@shared/src/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@shared/src/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@shared/src/components/ui/tabs";
import {
  AttachmentsTab,
  CertificatesTab,
  CleanoutsTab,
  DprTab,
  FumigationsTab,
  GradeOverridesTab,
  GradingTab,
  LabResultsTab,
  ShrinkTab,
  SplitsTab,
} from "../components/traceTabs";

function fmtDateTime(d: Date | null): string {
  if (!d) return "never";
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fillTone(pct: number): string {
  if (pct > 90) return "text-crit";
  if (pct >= 70) return "text-go";
  return "text-stable";
}

/* ------------------------------------------------------------------ */
/* Overview tab — today's totals, per-site cards, EOD upload history   */
/* ------------------------------------------------------------------ */

function OverviewTab() {
  const overview = trpc.office.overview.useQuery();
  const today = trpc.office.todayLoads.useQuery();
  const eod = trpc.office.eodReports.useQuery();

  return (
    <div className="space-y-6">
      {today.isError && (
        <QueryError
          title="Today's totals failed to load"
          message={today.error.message}
          onRetry={() => void today.refetch()}
          retrying={today.isRefetching}
        />
      )}
      {/* today's totals across all sites */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="gt-eyebrow">Loads today</div>
            {today.isPending ? (
              <Skeleton className="mt-2 h-7 w-16" />
            ) : (
              <div className="mt-1 font-mono text-xl font-bold tabular-nums">
                {today.data?.loadCount ?? 0}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="gt-eyebrow">Completed today</div>
            {today.isPending ? (
              <Skeleton className="mt-2 h-7 w-16" />
            ) : (
              <div className="mt-1 font-mono text-xl font-bold tabular-nums">
                {today.data?.completedCount ?? 0}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="gt-eyebrow">Net today</div>
            {today.isPending ? (
              <Skeleton className="mt-2 h-7 w-24" />
            ) : (
              <div className="mt-1 font-mono text-xl font-bold tabular-nums">
                {fmtLbs(today.data?.netLbs ?? 0)}
                <span className="ml-1 text-xs font-normal text-muted-foreground">lb</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* per-site cards */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest">Sites</h2>
        {overview.isError && (
          <QueryError
            title="Sites failed to load"
            message={overview.error.message}
            onRetry={() => void overview.refetch()}
            retrying={overview.isRefetching}
          />
        )}
        {overview.isPending ? (
          <div className="grid gap-4 md:grid-cols-2">
            {["a", "b"].map((k) => (
              <Card key={k}>
                <CardContent className="p-4">
                  <Skeleton className="h-16 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : !overview.data?.length ? (
          !overview.isError && (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No sites yet — they appear here as scale houses sync in.
              </CardContent>
            </Card>
          )
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {overview.data.map((s) => (
              <Card key={s.site.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-baseline justify-between text-base">
                    <span>{s.site.name}</span>
                    <span className={fillTone(s.fillPct)}>{s.fillPct}% full</span>
                  </CardTitle>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {s.site.location ?? "—"}
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {s.todaySheets} sheet{s.todaySheets === 1 ? "" : "s"} today
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1 font-mono text-xs tabular-nums">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">On hand</span>
                    <span>
                      {fmtLbs(s.currentLbs)} / {fmtLbs(s.capacityLbs)} lb
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Last EOD upload</span>
                    <span>{fmtDateTime(s.lastReceiveAt)}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* end-of-day upload history */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest">
          End-of-day uploads
        </h2>
        {eod.isError && (
          <QueryError
            title="Upload history failed to load"
            message={eod.error.message}
            onRetry={() => void eod.refetch()}
            retrying={eod.isRefetching}
          />
        )}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead className="text-right">Sheets</TableHead>
                  <TableHead className="text-right">Loads</TableHead>
                  <TableHead className="text-right">Inbound</TableHead>
                  <TableHead className="text-right">Outbound</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {eod.isPending ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-muted-foreground">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : !eod.data?.length ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-muted-foreground">
                      No end-of-day reports received yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  eod.data.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono">{r.day}</TableCell>
                      <TableCell>{r.siteName ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {r.sheetsOpened}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {r.completedCount}/{r.loadCount}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {fmtLbs(r.inboundLbs)} lb
                        <span className="ml-1 text-muted-foreground">
                          ({fmtBu(r.inboundBu)} bu)
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {fmtLbs(r.outboundLbs)} lb
                        <span className="ml-1 text-muted-foreground">
                          ({fmtBu(r.outboundBu)} bu)
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-muted-foreground">
                        {fmtDateTime(r.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shipments tab — mirrored outbound sales (read-only)                 */
/* ------------------------------------------------------------------ */

function ShipmentsTab() {
  const q = trpc.office.shipments.useQuery();

  return (
    <div className="space-y-3">
      {q.isError && (
        <QueryError
          title="Shipments failed to load"
          message={q.error.message}
          onRetry={() => void q.refetch()}
          retrying={q.isRefetching}
        />
      )}
      <Card>
        <CardContent className="flex items-center justify-end gap-2 border-b border-border px-3 py-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={(q.data ?? []).length === 0}
            onClick={() =>
              downloadCsv(
                `office-shipments-${csvDateStamp()}.csv`,
                ["Time", "Site", "Customer", "Destination", "Bin", "Lot", "Qty lbs", "Qty bu", "Truck", "Note"],
                (q.data ?? []).map((s) => [
                  s.createdAt ? new Date(s.createdAt).toLocaleString("en-US") : null,
                  s.siteName,
                  s.customerName,
                  s.destination,
                  s.binName,
                  s.lotCode ?? "Mixed",
                  s.quantityLbs,
                  s.quantityBu,
                  s.truckId,
                  s.note,
                ]),
              )
            }
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            CSV
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Bin</TableHead>
                <TableHead>Lot</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Truck</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isPending ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : !q.data?.length ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-muted-foreground">
                    No shipments synced yet.
                  </TableCell>
                </TableRow>
              ) : (
                q.data.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {fmtDateTime(s.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs">{s.siteName ?? "—"}</TableCell>
                    <TableCell className="font-medium">{s.customerName}</TableCell>
                    <TableCell className="text-xs">{s.destination ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{s.binName ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {s.lotCode ?? (
                        <span className="text-muted-foreground">Mixed</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {fmtLbs(s.quantityLbs)} lb
                      {s.quantityBu != null && (
                        <span className="ml-1 text-muted-foreground">
                          ({fmtBu(s.quantityBu)} bu)
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{s.truckId ?? "—"}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                      {s.note ?? "—"}
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
/* Bin movements tab — mirrored provenance event feed (read-only)      */
/* ------------------------------------------------------------------ */

function movementKind(m: { fromBinId: number | null; toBinId: number | null }): string {
  if (m.fromBinId == null && m.toBinId != null) return "IN";
  if (m.fromBinId != null && m.toBinId == null) return "OUT";
  if (m.fromBinId != null && m.toBinId != null) return "MOVE";
  return "ADJUST";
}

function MovementsTab() {
  const q = trpc.office.movements.useQuery();

  return (
    <div className="space-y-3">
      {q.isError && (
        <QueryError
          title="Bin movements failed to load"
          message={q.error.message}
          onRetry={() => void q.refetch()}
          retrying={q.isRefetching}
        />
      )}
      <Card>
        <CardContent className="flex items-center justify-end gap-2 border-b border-border px-3 py-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={(q.data ?? []).length === 0}
            onClick={() =>
              downloadCsv(
                `office-bin-movements-${csvDateStamp()}.csv`,
                ["Time", "Site", "Type", "Qty lbs", "Lot", "From", "To", "Operator", "Ref", "Note"],
                (q.data ?? []).map((m) => [
                  m.createdAt ? new Date(m.createdAt).toLocaleString("en-US") : null,
                  m.siteName,
                  movementKind(m),
                  m.quantityLbs,
                  m.lotCode,
                  m.fromBinName ?? "field",
                  m.toBinName ?? "shipped",
                  m.operator,
                  m.ticketNo
                    ? `${m.ticketNo}${m.loadNo != null ? ` #${m.loadNo}` : ""}`
                    : m.shipmentCustomer,
                  m.note,
                ]),
              )
            }
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            CSV
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Lot</TableHead>
                <TableHead>From → To</TableHead>
                <TableHead>Operator</TableHead>
                <TableHead>Ref</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isPending ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : !q.data?.length ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-muted-foreground">
                    No bin movements synced yet.
                  </TableCell>
                </TableRow>
              ) : (
                q.data.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {fmtDateTime(m.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs">{m.siteName ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {movementKind(m)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {m.fromBinId != null ? "−" : "+"}
                      {fmtLbs(m.quantityLbs)} lb
                    </TableCell>
                    <TableCell className="font-mono text-xs">{m.lotCode ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {m.fromBinName ?? "field"} → {m.toBinName ?? "shipped"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{m.operator ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {m.ticketNo
                        ? `${m.ticketNo}${m.loadNo != null ? ` #${m.loadNo}` : ""}`
                        : (m.shipmentCustomer ?? "—")}
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                      {m.note ?? "—"}
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

/**
 * Office portal home: mirrored activity across sites (overview), outbound
 * shipments, the bin-movement provenance feed, the Phase-B2 traceability
 * mirrors (DPR, certificates, lab results, fumigations, cleanouts, shrink,
 * grade overrides, attachments, load splits, grading reference), and the
 * audit trail — all read-only views over data pushed in by each scale house.
 */
export default function OfficeHome() {
  return (
    <Tabs defaultValue="overview" className="space-y-4">
      <TabsList className="flex h-auto flex-wrap justify-start">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="shipments">Shipments</TabsTrigger>
        <TabsTrigger value="movements">Bin movements</TabsTrigger>
        <TabsTrigger value="dpr">DPR</TabsTrigger>
        <TabsTrigger value="certificates">Certificates</TabsTrigger>
        <TabsTrigger value="lab">Lab results</TabsTrigger>
        <TabsTrigger value="fumigations">Fumigations</TabsTrigger>
        <TabsTrigger value="cleanouts">Cleanouts</TabsTrigger>
        <TabsTrigger value="shrink">Shrink</TabsTrigger>
        <TabsTrigger value="overrides">Grade overrides</TabsTrigger>
        <TabsTrigger value="attachments">Attachments</TabsTrigger>
        <TabsTrigger value="splits">Load splits</TabsTrigger>
        <TabsTrigger value="grading">Grading</TabsTrigger>
        <TabsTrigger value="audit">Audit log</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">
        <OverviewTab />
      </TabsContent>
      <TabsContent value="shipments">
        <ShipmentsTab />
      </TabsContent>
      <TabsContent value="movements">
        <MovementsTab />
      </TabsContent>
      <TabsContent value="dpr">
        <DprTab />
      </TabsContent>
      <TabsContent value="certificates">
        <CertificatesTab />
      </TabsContent>
      <TabsContent value="lab">
        <LabResultsTab />
      </TabsContent>
      <TabsContent value="fumigations">
        <FumigationsTab />
      </TabsContent>
      <TabsContent value="cleanouts">
        <CleanoutsTab />
      </TabsContent>
      <TabsContent value="shrink">
        <ShrinkTab />
      </TabsContent>
      <TabsContent value="overrides">
        <GradeOverridesTab />
      </TabsContent>
      <TabsContent value="attachments">
        <AttachmentsTab />
      </TabsContent>
      <TabsContent value="splits">
        <SplitsTab />
      </TabsContent>
      <TabsContent value="grading">
        <GradingTab />
      </TabsContent>
      <TabsContent value="audit">
        <AuditLogTable />
      </TabsContent>
    </Tabs>
  );
}

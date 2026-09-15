import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { trpc } from "../lib/trpc";
import { cn } from "../lib/utils";
import { csvDateStamp, downloadCsv } from "../lib/csv";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Skeleton } from "./ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { QueryError } from "./QueryError";

/**
 * Audit trail viewer (Phase 5) — mounted in BOTH the plant app and the
 * office portal against the shared read-only `audit.list` query (filters by
 * entity type / date range, offset-paginated, expandable before/after JSON).
 */

const ENTITY_TYPES = [
  "weight_sheet",
  "load",
  "bin",
  "site",
  "shipment",
  "farmer",
  "landlord",
  "lot",
  "operator",
] as const;

const PAGE_SIZE = 50;

function fmtDateTime(d: Date | string): string {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function actionBadgeClass(action: string): string {
  switch (action) {
    case "create":
      return "border-stable/50 bg-stable/10 text-stable";
    case "update":
      return "border-live/50 bg-live/10 text-live";
    case "void":
      return "border-crit/50 bg-crit/10 text-crit";
    case "adjust":
      return "border-[hsl(38_92%_60%)]/50 bg-[hsl(38_92%_60%)]/10 text-[hsl(38_92%_60%)]";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

/** Pretty-print a JSON snapshot cell; null renders as a dash. */
function JsonBlock({ label, json }: { label: string; json: string | null }) {
  let pretty = json ?? "—";
  if (json) {
    try {
      pretty = JSON.stringify(JSON.parse(json), null, 2);
    } catch {
      pretty = json;
    }
  }
  return (
    <div className="min-w-0 flex-1">
      <div className="gt-eyebrow mb-1">{label}</div>
      <pre className="max-h-64 overflow-auto rounded-md border border-border bg-readout p-2 font-mono text-[11px] leading-relaxed text-sidebar-foreground">
        {pretty}
      </pre>
    </div>
  );
}

export function AuditLogTable() {
  const [entityType, setEntityType] = useState("all");
  const [entityId, setEntityId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const entityIdNum = Number(entityId);
  const input = {
    ...(entityType !== "all" ? { entityType } : {}),
    ...(entityId.trim() !== "" && Number.isFinite(entityIdNum)
      ? { entityId: entityIdNum }
      : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  };
  const query = trpc.audit.list.useQuery(input);

  const applyFilter = (fn: () => void) => {
    fn();
    setPage(0);
    setExpandedId(null);
  };

  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const hasMore = query.data?.hasMore ?? false;

  return (
    <div className="space-y-3">
      {/* ------------------------------------------------ filter bar */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-3 p-4 md:grid-cols-5">
          <div className="space-y-1">
            <Label className="text-xs">Entity type</Label>
            <Select value={entityType} onValueChange={(v) => applyFilter(() => setEntityType(v))}>
              <SelectTrigger className="h-8 text-xs" aria-label="Entity type">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {ENTITY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-entity-id" className="text-xs">
              Entity ID
            </Label>
            <Input
              id="audit-entity-id"
              inputMode="numeric"
              placeholder="any"
              value={entityId}
              onChange={(e) => {
                setEntityId(e.target.value);
                setPage(0);
              }}
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-from" className="text-xs">
              From
            </Label>
            <Input
              id="audit-from"
              type="date"
              value={dateFrom}
              onChange={(e) => applyFilter(() => setDateFrom(e.target.value))}
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-to" className="text-xs">
              To
            </Label>
            <Input
              id="audit-to"
              type="date"
              value={dateTo}
              onChange={(e) => applyFilter(() => setDateTo(e.target.value))}
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="flex items-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={rows.length === 0}
              onClick={() =>
                downloadCsv(
                  `audit-log-${csvDateStamp()}.csv`,
                  ["Time", "Actor", "Action", "Entity type", "Entity ID", "Note"],
                  rows.map((r) => [
                    new Date(r.createdAt).toLocaleString("en-US"),
                    r.actor,
                    r.action,
                    r.entityType,
                    r.entityId,
                    r.note,
                  ]),
                )
              }
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={
                entityType === "all" && entityId === "" && dateFrom === "" && dateTo === ""
              }
              onClick={() => {
                setEntityType("all");
                setEntityId("");
                setDateFrom("");
                setDateTo("");
                setPage(0);
              }}
            >
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {query.isError && (
        <QueryError
          title="Audit log failed to load"
          message={query.error.message}
          onRetry={() => void query.refetch()}
          retrying={query.isRefetching}
        />
      )}

      {/* ------------------------------------------------ table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Time</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.isPending &&
                Array.from({ length: 8 }, (_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 6 }, (_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              {!query.isPending && !query.isError && rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-24 text-center text-sm text-muted-foreground"
                  >
                    No audit entries match these filters
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => {
                const expanded = expandedId === r.id;
                const hasJson = r.beforeJson != null || r.afterJson != null;
                return (
                  <Fragment key={r.id}>
                    <TableRow
                      className={cn(hasJson && "cursor-pointer hover:bg-accent/40")}
                      onClick={() => hasJson && setExpandedId(expanded ? null : r.id)}
                    >
                      <TableCell className="w-8 pr-0">
                        {hasJson && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            aria-expanded={expanded}
                            aria-label={expanded ? "Hide before/after details" : "Show before/after details"}
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedId(expanded ? null : r.id);
                            }}
                          >
                            {expanded ? (
                              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </Button>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">
                        {fmtDateTime(r.createdAt)}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-semibold">
                        {r.actor}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn("font-mono text-[10px] uppercase", actionBadgeClass(r.action))}
                        >
                          {r.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.entityType} #{r.entityId}
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">
                        {r.note ?? "—"}
                      </TableCell>
                    </TableRow>
                    {expanded && (
                      <TableRow key={`${r.id}-json`} className="hover:bg-transparent">
                        <TableCell colSpan={6} className="bg-muted/30 p-3">
                          <div className="flex flex-col gap-3 md:flex-row">
                            <JsonBlock label="Before" json={r.beforeJson} />
                            <JsonBlock label="After" json={r.afterJson} />
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ------------------------------------------------ pagination */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-muted-foreground">
          {query.isPending
            ? "…"
            : `${total.toLocaleString()} entr${total === 1 ? "y" : "ies"} · page ${page + 1}`}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0 || query.isPending}
            onClick={() => {
              setPage((p) => Math.max(0, p - 1));
              setExpandedId(null);
            }}
          >
            ← Newer
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasMore || query.isPending}
            onClick={() => {
              setPage((p) => p + 1);
              setExpandedId(null);
            }}
          >
            Older →
          </Button>
        </div>
      </div>
    </div>
  );
}

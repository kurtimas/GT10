// Certificates registry (Phase C, #20) — FGIS inspection/weight certificates,
// phytos, origin, fumigation, mycotoxin, non-GMO declarations… with the
// warehouse-examiner lifecycle: issue → reprint (old row kept as 'reprinted',
// new revision carries the DUPLICATE marker) → void with a required reason.
// An optional document can be attached at issue time (#26).
//
// The page also hosts the site-wide Lab results section (#22) — results can
// be added here linked to any lot or bin.

import { useState } from "react";
import { Award, Download, Paperclip, Plus, Printer, XCircle } from "lucide-react";
import { trpc } from "@shared/src/lib/trpc";
import { cn } from "@shared/src/lib/utils";
import { csvDateStamp, downloadCsv } from "@shared/src/lib/csv";
import { toast } from "@shared/src/components/ui/sonner";
import { Badge } from "@shared/src/components/ui/badge";
import { Button } from "@shared/src/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@shared/src/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@shared/src/components/ui/dialog";
import { Input } from "@shared/src/components/ui/input";
import { Label } from "@shared/src/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shared/src/components/ui/select";
import { Skeleton } from "@shared/src/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@shared/src/components/ui/table";
import { Textarea } from "@shared/src/components/ui/textarea";
import { QueryError } from "@shared/src/components/QueryError";
import { AttachmentsControl } from "@/components/AttachmentsControl";
import { LabResultsSection } from "@/components/LabResultsSection";
import { useSite } from "@/providers/site";
import {
  ATTACHMENT_MAX_BYTES,
  CERTIFICATE_STATUSES,
  CERTIFICATE_TYPES,
} from "@contracts/compliance";
import type { CertificateRow } from "@contracts/types";

const ALL = "all";

function fmtDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type CertRow = CertificateRow & { lotCode: string | null; siteName: string | null };

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "issued"
      ? "border-stable/50 bg-stable/10 text-stable"
      : status === "reprinted"
        ? "border-live/50 bg-live/10 text-live"
        : "border-crit/60 bg-crit/10 text-crit";
  return (
    <Badge variant="outline" className={cn("font-mono text-[10px] uppercase", cls)}>
      {status}
    </Badge>
  );
}

// ------------------------------------------------------------- issue dialog

function IssueDialog({ siteId, onClose }: { siteId: number; onClose: () => void }) {
  const utils = trpc.useUtils();
  const lotsQ = trpc.people.lots.list.useQuery();
  const shipmentsQ = trpc.shipments.list.useQuery({ siteId, limit: 200 });

  const [type, setType] = useState<string>(CERTIFICATE_TYPES[0]);
  const [certNumber, setCertNumber] = useState("");
  const [issuedAt, setIssuedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [lotChoice, setLotChoice] = useState("none");
  const [shipmentChoice, setShipmentChoice] = useState("none");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const upload = trpc.attachments.upload.useMutation({
    onError: (err) => toast.error(`Certificate issued, but the file failed: ${err.message}`),
  });
  const create = trpc.compliance.certificates.create.useMutation({
    onSuccess: async (cert) => {
      if (file && cert) {
        // optional document capture — uploaded against the new certificate row
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result ?? "");
          upload.mutate({
            siteId,
            entityType: "certificate",
            entityId: cert.id,
            filename: file.name,
            mime: file.type || undefined,
            dataBase64: result.slice(result.indexOf(",") + 1),
          });
        };
        reader.readAsDataURL(file);
      }
      toast.success(`Certificate ${cert?.certNumber ?? ""} issued`);
      onClose();
      await utils.compliance.certificates.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const submit = () => {
    if (!certNumber.trim()) {
      toast.error("Certificate number is required");
      return;
    }
    if (file && file.size > ATTACHMENT_MAX_BYTES) {
      toast.error(
        `"${file.name}" exceeds the ${ATTACHMENT_MAX_BYTES / 1024 / 1024}MB attachment cap`,
      );
      return;
    }
    create.mutate({
      siteId,
      type,
      certNumber: certNumber.trim(),
      issuedAt: new Date(`${issuedAt}T12:00:00`),
      lotId: lotChoice !== "none" ? Number(lotChoice) : undefined,
      shipmentId: shipmentChoice !== "none" ? Number(shipmentChoice) : undefined,
      note: note.trim() || undefined,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Issue certificate</DialogTitle>
          <DialogDescription>
            Link it to a lot and/or a shipment so the paper trail follows the grain.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CERTIFICATE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cert-num" className="text-xs">
              Certificate # <span className="text-crit">*</span>
            </Label>
            <Input
              id="cert-num"
              value={certNumber}
              onChange={(e) => setCertNumber(e.target.value)}
              placeholder="e.g. FGIS-2026-0142"
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cert-date" className="text-xs">
              Issued on
            </Label>
            <Input
              id="cert-date"
              type="date"
              value={issuedAt}
              onChange={(e) => setIssuedAt(e.target.value)}
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Lot (optional)</Label>
            <Select value={lotChoice} onValueChange={setLotChoice}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {(lotsQ.data ?? []).map((l) => (
                  <SelectItem key={l.id} value={String(l.id)}>
                    {l.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Shipment (optional)</Label>
            <Select value={shipmentChoice} onValueChange={setShipmentChoice}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {(shipmentsQ.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    #{s.id} — {s.customerName} · {fmtDate(s.createdAt)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="cert-note" className="text-xs">
            Note (optional)
          </Label>
          <Textarea
            id="cert-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cert-file" className="text-xs">
            Document (optional, ≤{ATTACHMENT_MAX_BYTES / 1024 / 1024}MB)
          </Label>
          <Input
            id="cert-file"
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="h-8 text-xs"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending ? "Issuing…" : "Issue certificate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------------------------- page

export default function Certificates() {
  const utils = trpc.useUtils();
  const { siteId } = useSite();
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [issueOpen, setIssueOpen] = useState(false);
  const [reprintTarget, setReprintTarget] = useState<CertRow | null>(null);
  const [reprintNote, setReprintNote] = useState("");
  const [voidTarget, setVoidTarget] = useState<CertRow | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [filesFor, setFilesFor] = useState<CertRow | null>(null);

  const listQ = trpc.compliance.certificates.list.useQuery(
    {
      ...(siteId != null ? { siteId } : {}),
      ...(typeFilter !== ALL ? { type: typeFilter } : {}),
      ...(statusFilter !== ALL ? { status: statusFilter } : {}),
    },
    { enabled: siteId != null },
  );
  const rows = (listQ.data ?? []) as CertRow[];

  const invalidate = () => utils.compliance.certificates.list.invalidate();
  const reprint = trpc.compliance.certificates.reprint.useMutation({
    onSuccess: async (r) => {
      toast.success(`Reprinted — new revision #${r.reprint?.id} marked DUPLICATE`, {
        duration: 8000,
      });
      setReprintTarget(null);
      setReprintNote("");
      await invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const voidMut = trpc.compliance.certificates.void.useMutation({
    onSuccess: async () => {
      toast.success("Certificate voided");
      setVoidTarget(null);
      setVoidReason("");
      await invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Award className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Certificates</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Inspection, weight, phyto, origin, and fumigation certificates — issue,
              reprint (DUPLICATE), or void with a reason.
            </p>
          </div>
        </div>
        <Button onClick={() => setIssueOpen(true)} disabled={siteId == null}>
          <Plus className="mr-2 h-4 w-4" />
          Issue certificate
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 py-3">
          <CardTitle className="text-sm font-medium">Registry</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-8 w-40 text-xs" aria-label="Filter by type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All types</SelectItem>
                {CERTIFICATE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-32 text-xs" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {CERTIFICATE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={rows.length === 0}
              onClick={() =>
                downloadCsv(
                  `certificates-${csvDateStamp()}.csv`,
                  ["Cert #", "Type", "Status", "Issued", "Lot", "Shipment", "Site", "Note"],
                  rows.map((c) => [
                    c.certNumber,
                    c.type,
                    c.status,
                    fmtDate(c.issuedAt),
                    c.lotCode,
                    c.shipmentId,
                    c.siteName,
                    c.note,
                  ]),
                )
              }
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {listQ.isError ? (
            <div className="p-4">
              <QueryError
                title="Certificates failed to load"
                message={listQ.error.message}
                onRetry={() => void listQ.refetch()}
                retrying={listQ.isRefetching}
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cert #</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Lot</TableHead>
                  <TableHead>Shipment</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="w-[190px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQ.isPending ? (
                  Array.from({ length: 4 }, (_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 8 }, (_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                      No certificates match these filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((c) => (
                    <TableRow key={c.id} className={cn(c.status === "void" && "opacity-55")}>
                      <TableCell className="font-mono text-xs font-semibold">
                        #{c.id} · {c.certNumber}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{c.type}</TableCell>
                      <TableCell>
                        <StatusBadge status={c.status} />
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                        {fmtDate(c.issuedAt)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{c.lotCode ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {c.shipmentId != null ? `#${c.shipmentId}` : "—"}
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate font-mono text-[11px] text-muted-foreground">
                        {c.note ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Documents"
                            aria-label="Certificate documents"
                            onClick={() => setFilesFor(c)}
                          >
                            <Paperclip className="h-3.5 w-3.5" />
                          </Button>
                          {c.status !== "void" && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 font-mono text-[10px]"
                                title="Reprint — creates a DUPLICATE revision"
                                onClick={() => setReprintTarget(c)}
                              >
                                <Printer className="mr-1 h-3 w-3" />
                                Reprint
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 font-mono text-[10px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => setVoidTarget(c)}
                              >
                                <XCircle className="mr-1 h-3 w-3" />
                                Void
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* site-wide lab results (#22) */}
      {siteId != null && (
        <Card>
          <CardContent className="p-4">
            <LabResultsSection siteId={siteId} />
          </CardContent>
        </Card>
      )}

      {/* dialogs */}
      {issueOpen && siteId != null && (
        <IssueDialog siteId={siteId} onClose={() => setIssueOpen(false)} />
      )}

      <Dialog
        open={reprintTarget != null}
        onOpenChange={(o) => {
          if (!o) {
            setReprintTarget(null);
            setReprintNote("");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reprint {reprintTarget?.certNumber}?</DialogTitle>
            <DialogDescription>
              The original is kept and marked REPRINTED; a new revision is
              issued with the DUPLICATE marker — the warehouse-examiner rule.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reprint-note">Note (optional)</Label>
            <Input
              id="reprint-note"
              value={reprintNote}
              onChange={(e) => setReprintNote(e.target.value)}
              placeholder="e.g. copy for driver"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReprintTarget(null)}>
              Cancel
            </Button>
            <Button
              disabled={reprint.isPending}
              onClick={() =>
                reprintTarget &&
                reprint.mutate({
                  id: reprintTarget.id,
                  note: reprintNote.trim() || undefined,
                })
              }
            >
              {reprint.isPending ? "Reprinting…" : "Reprint as DUPLICATE"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={voidTarget != null}
        onOpenChange={(o) => {
          if (!o) {
            setVoidTarget(null);
            setVoidReason("");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Void {voidTarget?.certNumber}?</DialogTitle>
            <DialogDescription>
              The certificate is marked VOID and kept for the audit trail — it
              is never deleted.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cert-void-reason">
              Void reason <span className="text-crit">*</span>
            </Label>
            <Textarea
              id="cert-void-reason"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              rows={2}
              placeholder="Why is this certificate being voided? (required)"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={voidMut.isPending || voidReason.trim().length < 3}
              onClick={() =>
                voidTarget && voidMut.mutate({ id: voidTarget.id, voidReason: voidReason.trim() })
              }
            >
              {voidMut.isPending ? "Voiding…" : "Void certificate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {filesFor && siteId != null && (
        <Dialog open onOpenChange={(o) => !o && setFilesFor(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                Documents — {filesFor.certNumber}
              </DialogTitle>
              <DialogDescription>
                Certificate #{filesFor.id} · {filesFor.type} · {filesFor.status}
              </DialogDescription>
            </DialogHeader>
            <AttachmentsControl
              siteId={filesFor.siteId}
              entityType="certificate"
              entityId={filesFor.id}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

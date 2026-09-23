// Attachments control (Phase C, #26) — reusable document capture for any
// entity (weight sheet / load, certificate, fumigation log, lot, bin, …).
// Upload (≤10MB, base64 over tRPC) + list + download (streams from
// GET /api/attachments/:id) + delete with confirm. Attach/detach are
// audit-logged server-side with the current operator.

import { useRef, useState } from "react";
import { Download, Paperclip, Trash2, Upload } from "lucide-react";
import { trpc } from "@shared/src/lib/trpc";
import { toast } from "@shared/src/components/ui/sonner";
import { Badge } from "@shared/src/components/ui/badge";
import { Button } from "@shared/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@shared/src/components/ui/dialog";
import { Skeleton } from "@shared/src/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@shared/src/components/ui/table";
import { QueryError } from "@shared/src/components/QueryError";
import {
  ATTACHMENT_ENTITY_TYPES,
  ATTACHMENT_MAX_BYTES,
} from "@contracts/compliance";
import type { AttachmentRow } from "@contracts/types";

type EntityType = (typeof ATTACHMENT_ENTITY_TYPES)[number];

const MAX_MB = ATTACHMENT_MAX_BYTES / 1024 / 1024;

function fmtSize(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function fmtDateTime(d: Date | string): string {
  return new Date(d).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      // strip the data:<mime>;base64, prefix
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

export function AttachmentsControl({
  siteId,
  entityType,
  entityId,
  title = "Attachments",
}: {
  siteId: number;
  entityType: EntityType;
  entityId: number;
  title?: string;
}) {
  const utils = trpc.useUtils();
  const fileRef = useRef<HTMLInputElement>(null);
  const [deleteTarget, setDeleteTarget] = useState<AttachmentRow | null>(null);

  const listQ = trpc.attachments.list.useQuery({ entityType, entityId });

  const invalidate = () => utils.attachments.list.invalidate({ entityType, entityId });

  const upload = trpc.attachments.upload.useMutation({
    onSuccess: async (row) => {
      toast.success(`Attached ${row?.filename ?? "file"}`);
      await invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const del = trpc.attachments.delete.useMutation({
    onSuccess: async () => {
      toast.success("Attachment deleted");
      setDeleteTarget(null);
      await invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > ATTACHMENT_MAX_BYTES) {
      toast.error(
        `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)}MB — the cap is ${MAX_MB}MB per file`,
      );
      return;
    }
    try {
      const dataBase64 = await readFileBase64(file);
      upload.mutate({
        siteId,
        entityType,
        entityId,
        filename: file.name,
        mime: file.type || undefined,
        dataBase64,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the file");
    }
  };

  const rows = listQ.data ?? [];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="gt-eyebrow flex items-center gap-1.5">
          <Paperclip className="h-3 w-3" />
          {title}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-muted-foreground">≤{MAX_MB}MB/file</span>
          <Button
            variant="outline"
            size="sm"
            className="h-7"
            disabled={upload.isPending}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            {upload.isPending ? "Uploading…" : "Upload"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              void pickFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {listQ.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-2/3" />
        </div>
      ) : listQ.isError ? (
        <QueryError
          title="Attachments failed to load"
          message={listQ.error.message}
          onRetry={() => void listQ.refetch()}
          retrying={listQ.isRefetching}
        />
      ) : rows.length === 0 ? (
        <p className="font-mono text-xs text-muted-foreground">
          No documents attached — upload signed delivery docs, affidavits, or lab
          reports here.
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead>By</TableHead>
                <TableHead className="text-right">When</TableHead>
                <TableHead className="w-[80px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="max-w-[220px] truncate font-mono text-xs">
                    {a.filename}
                    {a.mime && (
                      <Badge
                        variant="outline"
                        className="ml-2 font-mono text-[9px] text-muted-foreground"
                      >
                        {a.mime.split("/")[1] ?? a.mime}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {fmtSize(a.size)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{a.uploadedBy ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                    {fmtDateTime(a.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                        <a
                          href={`/api/attachments/${a.id}`}
                          download={a.filename}
                          title={`Download ${a.filename}`}
                          aria-label={`Download ${a.filename}`}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        title={`Delete ${a.filename}`}
                        aria-label={`Delete ${a.filename}`}
                        onClick={() => setDeleteTarget(a)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={deleteTarget != null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.filename}?</DialogTitle>
            <DialogDescription>
              The document is removed and the deletion is written to the audit
              log. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={del.isPending}
              onClick={() => deleteTarget && del.mutate({ id: deleteTarget.id })}
            >
              {del.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

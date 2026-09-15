import { AuditLogTable } from "@shared/src/components/AuditLogTable";

/**
 * Plant-side audit trail — every mutation (create / update / void / adjust)
 * with before/after snapshots. Same viewer the office portal mounts against
 * its mirrored copy.
 */
export default function Audit() {
  return (
    <div className="space-y-4">
      <div>
        <div className="gt-eyebrow">TRACEABILITY</div>
        <h1 className="text-xl font-semibold tracking-tight">Audit Log</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every change recorded at this scale house — who did what, when, and
          the before/after values.
        </p>
      </div>
      <AuditLogTable />
    </div>
  );
}

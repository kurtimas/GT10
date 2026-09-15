import { Input } from "@shared/src/components/ui/input";
import { Label } from "@shared/src/components/ui/label";
import { useAdminGate } from "@/hooks/useAdminGate";

/**
 * Admin password input for server-gated mutations (sites, farmers, landlords,
 * lots, bins, sync settings). Each dialog keeps its own state and remounts
 * when reopened, so the password is asked fresh every time.
 *
 * While the server-side admin gate is OPEN (ADMIN_PASSWORD unset or default)
 * the password isn't checked, so this renders nothing at all — the dialog's
 * submit guard uses the same useAdminGate() hook to allow an empty password.
 */
export function AdminPasswordField({
  id,
  value,
  onChange,
  hint = "This change requires the site admin password.",
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  const { passwordRequired } = useAdminGate();
  if (!passwordRequired) return null;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Admin password</Label>
      <Input
        id={id}
        type="password"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

import { trpc } from "@shared/src/lib/trpc";

/**
 * Is the admin password gate closed? While ADMIN_PASSWORD is unset or left
 * at the default, the server allows admin mutations without a password — the
 * UI then skips its unlock dialog and password fields instead of blocking on
 * a password that isn't checked. Defaults to "not required" while loading:
 * if the gate IS closed, a premature submit simply fails server-side with
 * "Admin password required", which is already toasted.
 */
export function useAdminGate() {
  const status = trpc.core.admin.status.useQuery(undefined, { staleTime: 60_000 });
  return { passwordRequired: status.data?.passwordRequired ?? false };
}

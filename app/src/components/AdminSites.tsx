import { useState } from "react";
import { Check, Copy, Lock, Pencil, Plus, Settings2 } from "lucide-react";
import { trpc } from "@shared/src/lib/trpc";
import { cn } from "@shared/src/lib/utils";
import { useSite } from "@/providers/site";
import { useAdminGate } from "@/hooks/useAdminGate";
import { toast } from "@shared/src/components/ui/sonner";
import { Badge } from "@shared/src/components/ui/badge";
import { Button } from "@shared/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@shared/src/components/ui/dialog";
import { Input } from "@shared/src/components/ui/input";
import { Label } from "@shared/src/components/ui/label";

/**
 * Site administration. While the server-side admin gate is open
 * (ADMIN_PASSWORD unset or default) the management UI opens directly;
 * when the gate is closed (non-default ADMIN_PASSWORD) a password unlock
 * is asked each time the dialog is opened. The password is verified
 * server-side.
 */
export function AdminSites() {
  const [open, setOpen] = useState(false);
  const { sites, siteId, setSiteId } = useSite();
  const { passwordRequired } = useAdminGate();

  const utils = trpc.useUtils();

  const [unlockedPassword, setUnlockedPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [newName, setNewName] = useState("");
  const [newLocation, setNewLocation] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editLocation, setEditLocation] = useState("");

  // Gate open → straight to the management UI; gate closed → require unlock.
  const unlocked = !passwordRequired || unlockedPassword;

  const closeDialog = (next: boolean) => {
    setOpen(next);
    if (!next) {
      // Lock again on close — the password is asked each session.
      setUnlockedPassword(false);
      setPassword("");
      setEditingId(null);
    }
  };

  const verify = trpc.core.admin.verify.useMutation({
    onSuccess: (res) => {
      if (res.ok) {
        setUnlockedPassword(true);
      } else {
        toast.error("Wrong password");
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const invalidate = () => {
    void utils.core.sites.list.invalidate();
    void utils.core.bins.list.invalidate();
  };

  const create = trpc.core.sites.create.useMutation({
    onSuccess: (site) => {
      if (!site) return;
      toast.success(`Site "${site.name}" created`);
      setNewName("");
      setNewLocation("");
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const update = trpc.core.sites.update.useMutation({
    onSuccess: (site) => {
      if (!site) return;
      toast.success(`Site "${site.name}" saved`);
      setEditingId(null);
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const copySiteLink = async (id: number, name: string) => {
    const url = `${window.location.origin}/?site=${id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(`Link for "${name}" copied — bookmark it on that site's machine`);
    } catch {
      toast.error(url, { description: "Copy failed — here is the link:" });
    }
  };

  const submitNew = () => {
    const name = newName.trim();
    if (!name) {
      toast.error("Site name is required.");
      return;
    }
    create.mutate({
      adminPassword: password,
      name,
      location: newLocation.trim() || undefined,
    });
  };

  const submitEdit = (id: number) => {
    const name = editName.trim();
    if (!name) {
      toast.error("Site name is required.");
      return;
    }
    update.mutate({
      adminPassword: password,
      id,
      name,
      location: editLocation.trim() || undefined,
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Manage sites"
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Settings2 className="h-4 w-4 flex-none" />
        <span>Site admin</span>
      </button>

      <Dialog open={open} onOpenChange={closeDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Sites</DialogTitle>
            <DialogDescription>
              {unlocked
                ? "Create sites, edit details, switch this machine's site, or copy a per-site link each location can bookmark."
                : "Enter the admin password to manage sites."}
            </DialogDescription>
          </DialogHeader>

          {!unlocked ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-md border border-dashed p-4">
                <Lock className="h-5 w-5 flex-none text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Site administration is password-protected.
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="admin-password">Admin password</Label>
                <Input
                  id="admin-password"
                  type="password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && password) verify.mutate({ password });
                  }}
                />
              </div>
              <Button
                className="w-full"
                disabled={!password || verify.isPending}
                onClick={() => verify.mutate({ password })}
              >
                <Lock className="h-4 w-4" />
                {verify.isPending ? "Checking…" : "Unlock"}
              </Button>
            </div>
          ) : (
            <>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {sites.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No sites yet — add the first one below.
              </p>
            )}
            {sites.map((site) => {
              const active = site.id === siteId;
              return (
                <div
                  key={site.id}
                  className={cn(
                    "rounded-md border p-3",
                    active ? "border-go/50 bg-go/5" : "border-border",
                  )}
                >
                  {editingId === site.id ? (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label htmlFor={`site-name-${site.id}`}>Name</Label>
                        <Input
                          id={`site-name-${site.id}`}
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`site-loc-${site.id}`}>Location (optional)</Label>
                        <Input
                          id={`site-loc-${site.id}`}
                          value={editLocation}
                          onChange={(e) => setEditLocation(e.target.value)}
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingId(null)}
                          disabled={update.isPending}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => submitEdit(site.id)}
                          disabled={update.isPending}
                        >
                          {update.isPending ? "Saving…" : "Save"}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold">{site.name}</span>
                          {active && (
                            <Badge
                              variant="outline"
                              className="border-go/50 font-mono text-[10px] uppercase text-go"
                            >
                              This machine
                            </Badge>
                          )}
                        </div>
                        {site.location && (
                          <p className="truncate text-xs text-muted-foreground">
                            {site.location}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-none items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Copy this site's link (?site=…)"
                          aria-label={`Copy link for site ${site.name}`}
                          onClick={() => void copySiteLink(site.id, site.name)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Edit site"
                          aria-label={`Edit site ${site.name}`}
                          onClick={() => {
                            setEditingId(site.id);
                            setEditName(site.name);
                            setEditLocation(site.location ?? "");
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {!active && (
                          <Button
                            variant="outline"
                            size="sm"
                            title="Switch this machine to this site"
                            onClick={() => {
                              setSiteId(site.id);
                              toast.success(`This machine is now on "${site.name}"`);
                            }}
                          >
                            <Check className="h-4 w-4" />
                            Use
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="space-y-2 rounded-md border border-dashed p-3">
            <p className="gt-eyebrow">Add site</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="new-site-name">Name</Label>
                <Input
                  id="new-site-name"
                  placeholder="e.g. Pleasant Valley"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitNew()}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="new-site-loc">Location (optional)</Label>
                <Input
                  id="new-site-loc"
                  placeholder="e.g. Haven, KS"
                  value={newLocation}
                  onChange={(e) => setNewLocation(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitNew()}
                />
              </div>
            </div>
            <Button
              size="sm"
              className="w-full"
              onClick={submitNew}
              disabled={create.isPending}
            >
              <Plus className="h-4 w-4" />
              {create.isPending ? "Creating…" : "Add site"}
            </Button>
          </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

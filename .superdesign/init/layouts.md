# Shared Layout Components — full source

The app shell is a single `Layout` wrapping every route: a deepest-forest **left rail** (w-60 sidebar: brand block with radar-sweep logo, nav with active indicator bar, footer with admin sites / server LED / offline-weigh queue chip) and a **right side** (offline crit banner when down, header with eyebrow + page title + operator picker + site picker + night toggle + live mono clock, then scrollable main content capped at max-w-[1400px] p-6).

### `app/src/components/Layout.tsx`

```tsx
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router";
import {
  LayoutDashboard,
  Scale as ScaleIcon,
  FileSpreadsheet,
  Warehouse,
  Users,
  BarChart3,
  Sun,
  Moon,
  WifiOff,
  MapPin,
  User,
  Truck,
  ScrollText,
  CloudOff,
} from "lucide-react";
import { cn } from "@shared/src/lib/utils";
import { useServerOnline } from "@shared/src/providers/trpc";
import { trpc } from "@shared/src/lib/trpc";
import { getCurrentOperator, setCurrentOperator } from "@shared/src/lib/operator";
import { AdminSites } from "@/components/AdminSites";
import { useSite } from "@/providers/site";
import { useWeighQueue } from "@/providers/weighQueue";
import { Toaster } from "@shared/src/components/ui/sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@shared/src/components/ui/select";

const THEME_STORAGE_KEY = "gt-theme";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/scale", label: "Scale", icon: ScaleIcon },
  { to: "/sheets", label: "Weight Sheets", icon: FileSpreadsheet },
  { to: "/shipments", label: "Shipments", icon: Truck },
  { to: "/bins", label: "Bins", icon: Warehouse },
  { to: "/people", label: "Farmers & Lots", icon: Users },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/audit", label: "Audit Log", icon: ScrollText },
] as const;

function pageTitleFor(pathname: string): string {
  const match = NAV_ITEMS.find((item) =>
    item.to === "/" ? pathname === "/" : pathname.startsWith(item.to),
  );
  return match?.label ?? "Not Found";
}

function useNightMode(): [boolean, () => void] {
  const [night, setNight] = useState<boolean>(() => {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(THEME_STORAGE_KEY) === "night";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("night", night);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, night ? "night" : "harvest");
    } catch {
      /* storage unavailable (private mode) — class toggle still works */
    }
  }, [night]);

  return [night, () => setNight((v) => !v)];
}

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(timer);
  }, []);
  return now.toLocaleTimeString("en-GB", { hour12: false });
}

const NO_OPERATOR = "__none__";

/**
 * The terminal's current operator — persisted in localStorage and sent with
 * every mutation (attribution, not auth). Hidden until at least one operator
 * is managed on the Farmers & Lots page.
 */
function OperatorPicker() {
  const operatorsQ = trpc.core.operators.list.useQuery();
  const [operator, setOperator] = useState<string>(() => getCurrentOperator());
  const operators = operatorsQ.data ?? [];
  if (operators.length === 0) return null;
  return (
    <Select
      value={operator || NO_OPERATOR}
      onValueChange={(v) => {
        const next = v === NO_OPERATOR ? "" : v;
        setOperator(next);
        setCurrentOperator(next);
      }}
    >
      <SelectTrigger
        className="h-9 w-[170px] gap-2 font-medium"
        title="Current operator — recorded on every weigh, edit, and shipment"
      >
        <User className="h-4 w-4 flex-none text-muted-foreground" />
        <SelectValue placeholder="No operator" />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value={NO_OPERATOR}>No operator</SelectItem>
        {operators.map((name) => (
          <SelectItem key={name} value={name}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const online = useServerOnline();
  const { pending: queuedWeighs, replaying } = useWeighQueue();
  const [night, toggleNight] = useNightMode();
  const { sites, siteId, setSiteId } = useSite();
  const clock = useClock();
  const pageTitle = pageTitleFor(location.pathname);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* ---- Left rail ------------------------------------------------ */}
      <aside className="flex w-60 flex-none flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-4">
          <span className="gt-radar flex h-8 w-8 flex-none items-center justify-center border border-sidebar-border bg-sidebar-accent">
            <span className="relative z-10 h-2 w-2 rounded-full bg-sidebar-primary" />
          </span>
          <div className="min-w-0">
            <div className="gt-brand truncate font-mono text-sm font-bold tracking-widest">
              GRAIN TRACKER v2
            </div>
            <div className="gt-eyebrow mt-0.5">Scale House Ops</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      "absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-sidebar-primary transition-opacity",
                      isActive ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <Icon className="h-4 w-4 flex-none" />
                  <span className="truncate">{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-1.5 border-t border-sidebar-border px-3 py-3">
          <AdminSites />
          <div className="flex items-center gap-2 px-2">
            <span className={cn("gt-led", online ? "gt-led-on" : "gt-led-crit")} />
            <span className="font-mono text-[10px] uppercase tracking-widest text-sidebar-foreground/60">
              {online ? "Server online" : "Server offline"}
            </span>
          </div>
          {queuedWeighs.length > 0 && (
            <div
              className="flex items-center gap-2 rounded-md border border-[hsl(38_92%_60%)]/40 bg-[hsl(38_92%_60%)]/10 px-2 py-1.5"
              title="Weighs captured while offline — replayed in order when the server answers"
            >
              <CloudOff className="h-3.5 w-3.5 flex-none text-[hsl(38_92%_60%)]" />
              <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-[hsl(38_92%_60%)]">
                {queuedWeighs.length} weigh{queuedWeighs.length === 1 ? "" : "s"} queued
                {replaying ? " · sending…" : ""}
              </span>
            </div>
          )}
        </div>
      </aside>

      {/* ---- Right side ------------------------------------------------ */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!online && (
          <div className="flex flex-none items-center gap-2 bg-crit px-4 py-2 text-sm font-medium text-white">
            <WifiOff className="h-4 w-4 flex-none" />
            <span>
              Cannot reach the server — database may still be starting…
            </span>
          </div>
        )}

        <header className="flex flex-none items-center justify-between gap-4 border-b border-border px-6 py-3">
          <div className="min-w-0">
            <div className="gt-eyebrow">Grain Tracker v2</div>
            <h1 className="truncate text-lg font-semibold leading-tight">
              {pageTitle}
            </h1>
          </div>
          <div className="flex flex-none items-center gap-3">
            <OperatorPicker />
            <Select
              value={siteId != null ? String(siteId) : undefined}
              onValueChange={(v) => setSiteId(Number(v))}
            >
              <SelectTrigger
                className="h-9 w-[220px] gap-2 font-medium"
                title="Active location — the whole app is scoped to it"
              >
                <MapPin className="h-4 w-4 flex-none text-muted-foreground" />
                <SelectValue placeholder="No locations yet" />
              </SelectTrigger>
              <SelectContent align="end">
                {sites.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                    {s.location ? ` — ${s.location}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              type="button"
              onClick={toggleNight}
              title={night ? "Switch to harvest (light) mode" : "Switch to night mode"}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {night ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <div className="flex items-center gap-2 rounded-md border border-border bg-readout px-3 py-1.5">
              <span className="gt-led gt-led-live" />
              <span className="font-mono text-sm tabular-nums text-sidebar-foreground">
                {clock}
              </span>
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] p-6">{children}</div>
        </main>
      </div>

      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}
```

### `app/src/components/AdminSites.tsx`

Sidebar-resident admin control (rendered inside the left rail footer): opens a dialog to add/manage site locations behind the admin password gate.

```tsx
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
```

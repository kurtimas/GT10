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
        <div className="border-b border-sidebar-border px-5 py-4">
          <img
            src="/iemc-logo.png"
            alt="IEMC"
            className="h-11 w-auto"
            draggable={false}
          />
          <div className="gt-brand mt-2.5 truncate font-mono text-sm font-bold tracking-widest">
            GRAIN TRACKER v2
          </div>
          <div className="gt-eyebrow mt-0.5">Scale House Ops</div>
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

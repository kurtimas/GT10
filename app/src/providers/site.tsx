import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { trpc } from "@shared/src/lib/trpc";

const SITE_STORAGE_KEY = "gt-site";

export interface SiteOption {
  id: number;
  name: string;
  location: string | null;
}

interface SiteContextValue {
  /** All known locations, ordered by name. */
  sites: SiteOption[];
  /** Active location — null while sites load (or none exist yet). */
  siteId: number | null;
  siteName: string | null;
  setSiteId: (id: number) => void;
}

const SiteContext = createContext<SiteContextValue | null>(null);

/**
 * Initial selection, resolved once at mount:
 *   1. `?site=<id>` URL param — per-site bookmark/shortcut (Admin → Sites
 *      copies these). Lets several sites share one browser or terminal and
 *      still always land on their own site.
 *   2. localStorage — this machine's own remembered site.
 * A stale/absent choice falls back to the first site, but a valid
 * remembered site is never switched away from implicitly.
 */
function readInitialSiteId(): number | null {
  if (typeof window !== "undefined") {
    const n = Number(new URLSearchParams(window.location.search).get("site"));
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (typeof localStorage === "undefined") return null;
  const n = Number(localStorage.getItem(SITE_STORAGE_KEY));
  return Number.isFinite(n) ? n : null;
}

/**
 * Owns the active location selection: the whole app (dashboard, sheets,
 * bins, reports) is scoped to one site at a time. The choice persists in
 * localStorage per machine; each site keeps its own site day after day.
 */
export function SiteProvider({ children }: { children: ReactNode }) {
  const { data } = trpc.core.sites.list.useQuery(undefined, {
    staleTime: 60_000,
    refetchInterval: 120_000, // new sites created in Bins appear here too
  });
  const sites: SiteOption[] = data ?? [];

  const [storedId, setStoredId] = useState<number | null>(readInitialSiteId);

  const siteId =
    storedId != null && sites.some((s) => s.id === storedId)
      ? storedId
      : (sites[0]?.id ?? null);

  useEffect(() => {
    if (siteId == null) return;
    try {
      localStorage.setItem(SITE_STORAGE_KEY, String(siteId));
    } catch {
      /* storage unavailable (private mode) — session-only selection */
    }
  }, [siteId]);

  return (
    <SiteContext.Provider
      value={{
        sites,
        siteId,
        siteName: sites.find((s) => s.id === siteId)?.name ?? null,
        setSiteId: setStoredId,
      }}
    >
      {children}
    </SiteContext.Provider>
  );
}

export function useSite(): SiteContextValue {
  const ctx = useContext(SiteContext);
  if (!ctx) throw new Error("useSite must be used inside <SiteProvider>");
  return ctx;
}

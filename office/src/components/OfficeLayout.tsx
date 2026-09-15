import type { ReactNode } from "react";
import { cn } from "@shared/src/lib/utils";
import { useServerOnline } from "@shared/src/providers/trpc";

/**
 * Lean chrome for the office portal — one page today (home), so no sidebar
 * navigation. The scale-house app keeps its own Layout.
 */
export default function OfficeLayout({ children }: { children: ReactNode }) {
  const online = useServerOnline();
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <img
              src="/iemc-logo.png"
              alt="IEMC"
              className="h-9 w-auto"
              draggable={false}
            />
            <div>
              <div className="text-sm font-semibold leading-tight">
                Grain Tracker — Main Office
              </div>
              <div className="gt-eyebrow">Multi-site portal</div>
            </div>
          </div>
          <span
            className={cn(
              "font-mono text-[10px] font-semibold uppercase tracking-widest",
              online ? "text-stable" : "text-crit",
            )}
          >
            <span
              className={cn("gt-led mr-1.5", online ? "gt-led-on" : "gt-led-crit")}
            />
            {online ? "Online" : "Offline"}
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">{children}</main>
    </div>
  );
}

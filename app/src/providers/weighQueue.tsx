import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { TRPCClientError } from "@trpc/client";
import { trpc } from "@shared/src/lib/trpc";
import { useServerOnline } from "@shared/src/providers/trpc";
import { toast } from "@shared/src/components/ui/sonner";

// ---------------------------------------------------------------------------
// Offline weigh queue (review P1-13).
//
// When the scale house loses its connection to the server, weigh-in / weigh-
// out captures are queued in localStorage and replayed IN ORDER once the
// server answers again. Deliberately simple:
//   * localStorage (not IndexedDB) — a handful of small JSON records
//   * FIFO replay, one at a time — a weighSecond depends on its weighFirst
//   * network errors pause replay (still offline); SERVER errors (conflicts
//     like "sheet is full" or "already weighed in") drop the item with a loud
//     toast so the operator can re-weigh the truck that is physically there
//   * no service worker — the page must simply stay open
// ---------------------------------------------------------------------------

const STORAGE_KEY = "gt.weighQueue.v1";

export type WeighKind = "weighFirst" | "weighSecond";

export interface QueuedWeigh {
  id: string;
  kind: WeighKind;
  /** mutation input — matches sheets.weighFirst / sheets.weighSecond */
  input: Record<string, unknown>;
  /** human label for toasts, e.g. "T-00012 · truck TRK-14" */
  label: string;
  queuedAt: string; // ISO
}

/** True when the failure never reached the server (no HTTP response). */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof TRPCClientError) {
    return (err as { data?: unknown }).data == null;
  }
  return false;
}

function loadQueue(): QueuedWeigh[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedWeigh[]) : [];
  } catch {
    return [];
  }
}

function saveQueue(items: QueuedWeigh[]) {
  try {
    if (items.length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* storage full / private mode — the in-memory queue still works */
  }
}

interface WeighQueueCtx {
  /** items still waiting to be sent, oldest first */
  pending: QueuedWeigh[];
  /** add a weigh to the offline queue (called on network failure) */
  enqueue: (kind: WeighKind, input: Record<string, unknown>, label: string) => void;
  /** true while the queue is being replayed */
  replaying: boolean;
}

const Ctx = createContext<WeighQueueCtx>({
  pending: [],
  enqueue: () => {},
  replaying: false,
});

export function useWeighQueue(): WeighQueueCtx {
  return useContext(Ctx);
}

export function WeighQueueProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<QueuedWeigh[]>(() => loadQueue());
  const [replaying, setReplaying] = useState(false);
  const online = useServerOnline();
  const utils = trpc.useUtils();
  // guards against overlapping replays (interval re-entry / fast toggles)
  const replayLock = useRef(false);

  const update = useCallback((next: QueuedWeigh[]) => {
    setPending(next);
    saveQueue(next);
  }, []);

  const enqueue = useCallback(
    (kind: WeighKind, input: Record<string, unknown>, label: string) => {
      setPending((prev) => {
        const next: QueuedWeigh[] = [
          ...prev,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            kind,
            input,
            label,
            queuedAt: new Date().toISOString(),
          },
        ];
        saveQueue(next);
        return next;
      });
    },
    [],
  );

  // Replay, oldest first, whenever the server is reachable and items wait.
  useEffect(() => {
    if (!online || pending.length === 0 || replayLock.current) return;
    replayLock.current = true;
    setReplaying(true);

    (async () => {
      let queue = loadQueue(); // re-read — another tab may have drained it
      let sent = 0;
      const failed: { label: string; message: string }[] = [];

      while (queue.length > 0) {
        const item = queue[0]!;
        try {
          if (item.kind === "weighFirst") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await utils.client.sheets.weighFirst.mutate(item.input as any);
          } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await utils.client.sheets.weighSecond.mutate(item.input as any);
          }
          queue = queue.slice(1);
          sent += 1;
        } catch (err) {
          if (isNetworkError(err)) {
            break; // still offline — stop, keep the remaining queue
          }
          // server-side conflict: the weigh can never succeed — drop it and
          // tell the operator exactly which truck needs attention
          failed.push({
            label: item.label,
            message: err instanceof Error ? err.message : String(err),
          });
          queue = queue.slice(1);
        }
      }

      update(queue);

      if (sent > 0) {
        toast.success(
          sent === 1
            ? "1 queued weigh sent to the server"
            : `${sent} queued weighs sent to the server`,
        );
        // server state changed behind the UI — refresh everything scale-related
        void utils.sheets.get.invalidate();
        void utils.sheets.open.invalidate();
        void utils.sheets.list.invalidate();
        void utils.core.bins.list.invalidate();
        void utils.sheets.recentActivity.invalidate();
      }
      for (const f of failed) {
        toast.error(`Queued weigh failed — ${f.label}`, {
          description: `${f.message}. The truck may need to be re-weighed.`,
          duration: 15_000,
        });
      }

      replayLock.current = false;
      setReplaying(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, pending.length]);

  return <Ctx.Provider value={{ pending, enqueue, replaying }}>{children}</Ctx.Provider>;
}

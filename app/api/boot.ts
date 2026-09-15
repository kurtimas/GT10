import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "@shared/api/context";
import { env } from "@shared/api/lib/env";
import { securityHeaders, simpleBodyLimit } from "@shared/api/lib/httpHardening";
import { isOffline } from "@shared/api/queries/connection";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(securityHeaders);
app.use(simpleBodyLimit(50 * 1024 * 1024));
app.get("/api/health", (c) =>
  c.json({ ok: true, mode: isOffline() ? ("offline" as const) : ("mysql" as const) }),
);
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("@shared/api/lib/vite");
  const { migrateAndSeedOnBoot } = await import("@shared/api/migrateOnBoot");
  const { seedIfEmpty } = await import("./seed");
  const { adminGateOpen } = await import("@shared/api/lib/adminPassword");
  serveStaticFiles(app);
  if (adminGateOpen()) {
    console.error(
      "[admin] ADMIN GATE IS OPEN — ADMIN_PASSWORD is unset or the default " +
        "'grain-admin', so admin mutations (sites, farmers, lots, bins, sync " +
        "settings) require NO password. Set ADMIN_PASSWORD to a non-default " +
        "value in the environment to re-enable the gate.",
    );
  }
  await migrateAndSeedOnBoot(seedIfEmpty);
  // retry queued office pushes (sync outbox, P1-8) — one sweep per minute
  const { startOutboxWorker } = await import("@shared/api/syncOutbox");
  startOutboxWorker();
  // daily offline-database backups (P1-14) — no-op on the MySQL path
  if (isOffline()) {
    const { startDailyBackup } = await import("@shared/api/lib/backup");
    startDailyBackup();
  }

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
} else {
  // dev server — probe MySQL, fall back to the embedded database if needed
  const { migrateAndSeedOnBoot } = await import("@shared/api/migrateOnBoot");
  const { seedIfEmpty } = await import("./seed");
  const { adminGateOpen } = await import("@shared/api/lib/adminPassword");
  if (adminGateOpen()) {
    console.warn("[admin] admin gate is OPEN (no ADMIN_PASSWORD set) — admin mutations need no password");
  }
  await migrateAndSeedOnBoot(seedIfEmpty);
  const { startOutboxWorker } = await import("@shared/api/syncOutbox");
  startOutboxWorker();
  if (isOffline()) {
    const { startDailyBackup } = await import("@shared/api/lib/backup");
    startDailyBackup();
  }
}

import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { syncKeyConfigured, syncReceiver } from "./syncReceiver";
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
// main-office sync receiver (plain Hono, keyed with x-gt-sync-key)
app.route("/api/sync", syncReceiver);
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

// Fail-closed reminder: the receiver refuses sync requests until SYNC_KEY is
// set (503), so surface the misconfiguration loudly at every boot.
if (!syncKeyConfigured()) {
  console.error(
    "[sync] SYNC_KEY is not set — the sync receiver is REFUSING all sync " +
      "requests (503). Set SYNC_KEY in the environment and the same value in " +
      "each scale house's sync settings.",
  );
}

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("@shared/api/lib/vite");
  const { migrateAndSeedOnBoot } = await import("@shared/api/migrateOnBoot");
  const { seedIfEmpty } = await import("./seed");
  serveStaticFiles(app);
  await migrateAndSeedOnBoot(seedIfEmpty);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
} else {
  // dev server — probe MySQL, fall back to the embedded database if needed
  const { migrateAndSeedOnBoot } = await import("@shared/api/migrateOnBoot");
  const { seedIfEmpty } = await import("./seed");
  await migrateAndSeedOnBoot(seedIfEmpty);
}

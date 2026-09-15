import { createRouter, publicQuery } from "@shared/api/middleware";
import { coreRouter } from "@shared/api/coreRouter";
import { peopleRouter } from "@shared/api/peopleRouter";
import { sheetsRouter } from "@shared/api/sheetsRouter";
import { shipmentsRouter } from "@shared/api/shipmentsRouter";
import { auditRouter } from "@shared/api/auditRouter";
import { syncRouter } from "./syncRouter";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  core: coreRouter,
  people: peopleRouter,
  sheets: sheetsRouter,
  shipments: shipmentsRouter,
  audit: auditRouter,
  sync: syncRouter,
});

export type AppRouter = typeof appRouter;

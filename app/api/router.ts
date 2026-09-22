import { createRouter, publicQuery } from "@shared/api/middleware";
import { coreRouter } from "@shared/api/coreRouter";
import { peopleRouter } from "@shared/api/peopleRouter";
import { sheetsRouter } from "@shared/api/sheetsRouter";
import { shipmentsRouter } from "@shared/api/shipmentsRouter";
import { auditRouter } from "@shared/api/auditRouter";
import { gradingRouter } from "@shared/api/gradingRouter";
import { splitsRouter } from "@shared/api/splitsRouter";
import { complianceRouter } from "@shared/api/complianceRouter";
import { attachmentsRouter } from "@shared/api/attachmentsRouter";
import { reportsRouter } from "@shared/api/reportsRouter";
import { traceRouter } from "@shared/api/traceRouter";
import { syncRouter } from "./syncRouter";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  core: coreRouter,
  people: peopleRouter,
  sheets: sheetsRouter,
  shipments: shipmentsRouter,
  audit: auditRouter,
  // Phase B routers
  grading: gradingRouter,
  splits: splitsRouter,
  compliance: complianceRouter,
  attachments: attachmentsRouter,
  reports: reportsRouter,
  trace: traceRouter,
  sync: syncRouter,
});

export type AppRouter = typeof appRouter;

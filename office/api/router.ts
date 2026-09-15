import { createRouter, publicQuery } from "@shared/api/middleware";
import { officeRouter } from "./officeRouter";
import { auditRouter } from "@shared/api/auditRouter";

// The office portal is a read-only mirror: its one-page UI only calls
// office.* and ping. The plant write routers (core/people/sheets/shipments)
// are deliberately NOT mounted here — mirrored data is only written through
// the keyed sync receiver (api/syncReceiver.ts). The read-only audit trail
// query IS mounted so the mirrored audit_log can be browsed from the office.
export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  office: officeRouter,
  audit: auditRouter,
});

export type AppRouter = typeof appRouter;

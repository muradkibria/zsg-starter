import type { Express } from "express";
import { createServer, type Server } from "http";
import { initSocket } from "./socket.js";

export async function registerRoutes(app: Express): Promise<Server> {
  const server = createServer(app);

  initSocket(server);

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

  if (process.env.MOCK === "true") {
    console.log("[routes] MOCK mode — serving fake data, no PocketBase or Colorlight needed");
    const { mockRouter } = await import("./mock/routes.js");
    app.use("/api", mockRouter);
  } else {
    const { authenticatePB } = await import("./db/pocketbase.js");
    const { requireAuth } = await import("./middleware/auth.js");
    const { authRouter } = await import("./routes/auth.js");
    const { bagsRouter } = await import("./routes/bags.js");
    const { ridersRouter } = await import("./routes/riders.js");
    const { mediaRouter } = await import("./routes/media.js");
    const { campaignsRouter } = await import("./routes/campaigns.js");
    const { schedulesRouter } = await import("./routes/schedules.js");
    const { zonesRouter } = await import("./routes/zones.js");
    const { fleetRouter } = await import("./routes/fleet.js");
    const { reportsRouter } = await import("./routes/reports.js");
    const { colortlightRouter } = await import("./routes/colorlight.js");
    const { auditRouter } = await import("./routes/audit.js");
    const { startGpsPoller } = await import("./services/gps-poller.js");
    const { startScheduleEnforcer } = await import("./services/schedule-enforcer.js");

    if (process.env.POCKETBASE_URL) {
      await authenticatePB();
      startGpsPoller();
      startScheduleEnforcer();
    }

    app.use("/api/auth", authRouter);
    app.use("/api/bags", requireAuth, bagsRouter);
    app.use("/api/riders", requireAuth, ridersRouter);
    app.use("/api/media", requireAuth, mediaRouter);
    app.use("/api/campaigns", requireAuth, campaignsRouter);
    app.use("/api/schedules", requireAuth, schedulesRouter);
    app.use("/api/zones", requireAuth, zonesRouter);
    app.use("/api/fleet", requireAuth, fleetRouter);
    app.use("/api/reports", requireAuth, reportsRouter);
    app.use("/api/colorlight", requireAuth, colortlightRouter);
    app.use("/api/audit", requireAuth, auditRouter);
  }

  return server;
}

import type { Express } from "express";
import { createServer, type Server } from "http";
import { initSocket } from "./socket.js";

export async function registerRoutes(app: Express): Promise<Server> {
  const server = createServer(app);

  initSocket(server);

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

  const mock = process.env.MOCK === "true";

  if (mock) {
    // Frontend dev mode — fake data, no external services needed.
    console.log("[routes] MOCK mode — serving fake data");
    const { mockRouter } = await import("./mock/routes.js");
    app.use("/api", mockRouter);
    return server;
  }

  // ── LIVE mode: Colorlight Cloud only. No mock fallback. ──────────────────
  console.log("[routes] LIVE mode — connecting to Colorlight Cloud…");

  const { initColorlight } = await import("./colorlight/client.js");
  const { liveRouter } = await import("./colorlight/routes.js");
  const { stubRouter } = await import("./colorlight/stub-router.js");
  const { startColorlightGpsPoller } = await import("./colorlight/gps-poller.js");

  // Always register the routers so the server can boot even if Colorlight is
  // unreachable — individual requests will surface upstream errors via 502
  // and the frontend renders error states per-page.
  app.use("/api", liveRouter);
  app.use("/api", stubRouter);

  try {
    await initColorlight();
    startColorlightGpsPoller();
    console.log("[routes] LIVE mode ready");
  } catch (err) {
    console.error("┌─────────────────────────────────────────────────────────");
    console.error("│ [routes] Colorlight authentication FAILED");
    console.error("│  ", (err as Error).message);
    console.error("│ The dashboard will still load but all live endpoints");
    console.error("│ will return 502 until credentials / network are fixed.");
    console.error("│ Check COLORLIGHT_API_BASE / USERNAME / PASSWORD in env.");
    console.error("└─────────────────────────────────────────────────────────");
  }

  return server;
}

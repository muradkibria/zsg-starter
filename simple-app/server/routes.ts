import type { Express } from "express";
import { createServer, type Server } from "http";
import { initSocket } from "./socket.js";

export async function registerRoutes(app: Express): Promise<Server> {
  const server = createServer(app);

  initSocket(server);

  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

  const mock = process.env.MOCK === "true";

  if (mock) {
    console.log("[routes] MOCK mode — serving fake data, no Colorlight call");
    const { mockRouter } = await import("./mock/routes.js");
    app.use("/api", mockRouter);
    return server;
  }

  // ── LIVE mode: Colorlight Cloud, with mock router as fallback ─────────────
  console.log("[routes] LIVE mode — connecting to Colorlight Cloud…");
  const { initColorlight } = await import("./colorlight/client.js");
  const { mockRouter } = await import("./mock/routes.js");

  try {
    await initColorlight();
    const { liveRouter } = await import("./colorlight/routes.js");
    // Live router takes priority — anything it doesn't handle falls through
    // to the mock router (riders, campaigns, ad-slots, zones, audit, etc.).
    app.use("/api", liveRouter);
    app.use("/api", mockRouter);
    console.log("[routes] LIVE mode ready");
  } catch (err) {
    console.error("[routes] Colorlight login failed:", (err as Error).message);
    console.warn("[routes] Falling back to MOCK mode for this session.");
    app.use("/api", mockRouter);
  }

  return server;
}

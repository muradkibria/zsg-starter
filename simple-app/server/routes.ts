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

  const { initColorlight, writesEnabled } = await import("./colorlight/client.js");
  const { liveRouter } = await import("./colorlight/routes.js");
  const { publishRouter } = await import("./colorlight/publish-routes.js");
  const { playlistRouter } = await import("./store/playlist-routes.js");
  const { campaignStoreRouter } = await import("./store/campaign-routes.js");
  const { tflRouter } = await import("./store/tfl-routes.js");
  const { reportRouter } = await import("./reports/report-routes.js");
  const { stubRouter } = await import("./colorlight/stub-router.js");
  const { riderStoreRouter } = await import("./store/rider-routes.js");
  const { startColorlightGpsPoller } = await import("./colorlight/gps-poller.js");

  // Order matters — first matching route wins:
  //   1. publishRouter        — file uploads + legacy single-file deploy
  //   2. playlistRouter       — playlist CRUD + multi-item deploy (preferred)
  //   3. campaignStoreRouter  — campaign CRUD (Campaigns sub-tab)
  //   4. liveRouter           — Colorlight-backed reads (bags, GPS, media, plays, sessions, occupancy, ad-slots)
  //   5. riderStoreRouter     — JSON-backed rider profiles + documents
  //   6. stubRouter           — empty / 501 for everything else
  // Always register so the server can boot even if Colorlight is unreachable —
  // individual requests will surface upstream errors via 502 and the frontend
  // renders error states per-page.
  app.use("/api", publishRouter);
  app.use("/api", playlistRouter);
  app.use("/api", campaignStoreRouter);
  app.use("/api", tflRouter);
  app.use("/api", reportRouter);
  app.use("/api", liveRouter);
  app.use("/api", riderStoreRouter);
  app.use("/api", stubRouter);

  if (!writesEnabled()) {
    console.warn(
      "┌────────────────────────────────────────────────────────────\n" +
      "│ [routes] COLORLIGHT_WRITES_ENABLED=false — DEV / dry-run mode\n" +
      "│ Uploads, program creation, and bag assignments are LOGGED ONLY.\n" +
      "│ No real Colorlight write traffic will occur. Riders are safe.\n" +
      "│ Flip COLORLIGHT_WRITES_ENABLED=true on Railway when ready.\n" +
      "└────────────────────────────────────────────────────────────"
    );
  } else {
    console.warn(
      "┌────────────────────────────────────────────────────────────\n" +
      "│ [routes] COLORLIGHT_WRITES_ENABLED=true — LIVE write mode\n" +
      "│ Upload + deploy actions WILL push to real Colorlight bags.\n" +
      "└────────────────────────────────────────────────────────────"
    );
  }

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

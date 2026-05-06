import "./env";

import express from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

const PORT = Number(process.env.PORT ?? 3000);

const app = express();
// Trust the platform's proxy (Railway, Heroku, etc.) for correct req.ip / req.protocol
app.set("trust proxy", 1);
// Body-parser limit bumped to 100 MB so video ad uploads fit through the
// /api/upload endpoint. Multer (used by that endpoint) enforces a separate
// 100 MB cap per file. Smaller JSON requests are unaffected.
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: false, limit: "100mb" }));

(async () => {
  const server = await registerRoutes(app);

  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  server.listen(PORT, () => {
    log(`serving on port ${PORT}`);
  });
})();

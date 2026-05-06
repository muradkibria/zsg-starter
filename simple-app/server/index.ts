import "./env";

import express from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

const PORT = Number(process.env.PORT ?? 3000);

const app = express();
// Trust the platform's proxy (Railway, Heroku, etc.) for correct req.ip / req.protocol
app.set("trust proxy", 1);
// Body-parser limit bumped to 10 MB so rider-document uploads (base64-encoded
// IDs, proofs of address) fit in a single POST. Each doc is capped to ~5 MB
// in the UI; total request size lands well under this limit.
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false, limit: "10mb" }));

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

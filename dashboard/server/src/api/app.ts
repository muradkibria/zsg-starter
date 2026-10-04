import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { authRouter, requireSignedIn, sessionMiddleware } from "./auth";
import { coreRouter } from "./core";
import { errorHandler, HttpError } from "./http";
import { auditRouter } from "./areas/audit";
import { bagsRouter } from "./areas/bags";
import { campaignsRouter } from "./areas/campaigns";
import { exportsRouter } from "./areas/exports";
import { loopsRouter } from "./areas/loops";
import { payrollRouter } from "./areas/payroll";
import { reportsRouter } from "./areas/reports";
import { ridersRouter } from "./areas/riders";
import { schedulesRouter } from "./areas/schedules";
import { teamRouter } from "./areas/team";
import { zonesRouter } from "./areas/zones";

export function createApp(): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });
  app.use(cookieParser());
  app.use(express.json({ limit: "2mb" }));
  app.use(sessionMiddleware);

  app.get("/api/health", (_req, res) => void res.json({ ok: true }));
  app.use("/api/auth", authRouter());

  // Everything else needs a signed-in user; each route checks its permission.
  const api = express.Router();
  api.use(requireSignedIn);
  api.use(coreRouter());
  api.use(bagsRouter());
  api.use(ridersRouter());
  api.use(loopsRouter());
  api.use(schedulesRouter());
  api.use(payrollRouter());
  api.use(exportsRouter());
  api.use(campaignsRouter());
  api.use(reportsRouter());
  api.use(teamRouter());
  api.use(auditRouter());
  api.use(zonesRouter());
  api.use((_req, _res, next) => next(new HttpError(404, "Not found")));
  app.use("/api", api);

  // In production the API also serves the built web app.
  const webDist = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "dist");
  const altDist = join(process.cwd(), "..", "web", "dist");
  const dist = existsSync(webDist) ? webDist : existsSync(altDist) ? altDist : null;
  if (dist) {
    app.use(express.static(dist, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, "index.html")));
  }

  app.use(errorHandler);
  return app;
}

import { config } from "./config";
import { createApp } from "./api/app";
import { logger } from "./log";
import { checkSchema, connectPb } from "./pb";
import { startJobs } from "./jobs";

const log = logger("server");

async function main() {
  await connectPb();
  await checkSchema();
  const app = createApp();
  app.listen(config.API_PORT, config.API_HOST, () => {
    log.info(`API listening on http://${config.API_HOST}:${config.API_PORT}`);
    log.info(
      `Colorlight changes: ${config.COLORLIGHT_WRITES.toUpperCase()}` +
        (config.COLORLIGHT_WRITES === "off" ? " (dry run — nothing is sent to bags)" : ` · test bag(s): ${config.testBagIds.join(", ")}`),
    );
  });
  await startJobs();
}

// A stray rejection in background work is logged, not allowed to take the API down.
process.on("unhandledRejection", (err) => log.error("unhandled rejection (kept running)", err));

main().catch((err) => {
  log.error("failed to start", err);
  process.exit(1);
});

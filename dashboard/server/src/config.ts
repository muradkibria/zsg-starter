// Settings come from the repo's single .env (shared with PocketBase) or the
// host's variables. Only the PocketBase superuser and the Colorlight login are
// required; everything else has a default (see ../../../.env.example).

import { hkdfSync } from "node:crypto";
import { z } from "zod";

const schema = z.object({
  POCKETBASE_URL: z.string().default("http://127.0.0.1:8190"),
  POCKETBASE_EMAIL: z.string().min(3),
  POCKETBASE_PASSWORD: z.string().min(8),
  // Hosts like Railway set PORT; API_PORT wins when both are set.
  API_PORT: z.coerce.number().default(Number(process.env.PORT) || 4000),
  API_HOST: z.string().default("127.0.0.1"),
  // Optional: by default the session key is worked out from POCKETBASE_PASSWORD.
  SESSION_SECRET: z.string().min(16).optional(),
  COLORLIGHT_API_BASE: z.string().default("https://beu.colorlightcloud.com"),
  COLORLIGHT_USERNAME: z.string().default(""),
  COLORLIGHT_PASSWORD: z.string().default(""),
  COLORLIGHT_WRITES: z.enum(["off", "test", "fleet"]).default("off"),
  COLORLIGHT_TEST_BAG_IDS: z.string().default("5786440"),
  SYNC_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  SYNC_BACKFILL_DAYS: z.coerce.number().default(14),
  // Older history is imported back this far (Colorlight keeps about 3 months of GPS, 6 of plays).
  SYNC_HISTORY_DAYS: z.coerce.number().default(200),
  NODE_ENV: z.string().default("development"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment: check the repo's .env (npm run setup creates it).\n", z.prettifyError(parsed.error));
  process.exit(1);
}

const env = parsed.data;

/**
 * The key that signs dashboard session cookies: SESSION_SECRET if set, else derived
 * from the PocketBase superuser password (so changing that password also signs
 * everyone out of the dashboard). scripts/qa.mjs derives it the same way.
 */
const sessionKey = env.SESSION_SECRET
  ? new TextEncoder().encode(env.SESSION_SECRET)
  : new Uint8Array(hkdfSync("sha256", env.POCKETBASE_PASSWORD, "digilite-hub", "session cookie", 32));

export const config = {
  ...env,
  sessionKey,
  testBagIds: env.COLORLIGHT_TEST_BAG_IDS.split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0),
  colorlightConfigured: !!(env.COLORLIGHT_USERNAME && env.COLORLIGHT_PASSWORD),
  isProd: env.NODE_ENV === "production",
};

export type Config = typeof config;

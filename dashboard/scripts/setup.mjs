#!/usr/bin/env node
// One-time (and re-runnable) project setup:
//   1. create the repo's .env (shared by PocketBase and the dashboard) from
//      .env.example, with a generated PocketBase password; an old dashboard/.env
//      is moved up to the repo root
//   2. copy the Colorlight login from ../simple-app/.env if it exists (never printed)
//   3. download PocketBase and create or update the superuser
//   4. apply the schema and seed the first rows with ../pocketbase/scripts/setup-schema.js
//      (against the running database, or a temporary one if nothing is running)
// When POCKETBASE_URL is a deployed PocketBase, 3 is skipped (its container sets the
// superuser) and 4 runs against it.
//
// Safe to run again: values already in .env are kept (including settings that
// aren't in the template), and the schema script never overwrites a row or drops
// a field that holds data.

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureBinary, isLocalPocketBase, pbDir, pocketbaseHost, pocketbaseUrl, runPocketBase } from "./pocketbase.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const envPath = join(repo, ".env");
const oldEnvPath = join(repo, "dashboard", ".env");

function parseEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

// ── 1 + 2: .env ───────────────────────────────────────────────────────────────
const template = readFileSync(join(repo, ".env.example"), "utf8");
const moving = !existsSync(envPath) && existsSync(oldEnvPath);
const current = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : moving ? parseEnv(readFileSync(oldEnvPath, "utf8")) : {};
const legacyPath = join(repo, "simple-app", ".env");
const legacy = existsSync(legacyPath) ? parseEnv(readFileSync(legacyPath, "utf8")) : {};

const generated = { POCKETBASE_PASSWORD: randomBytes(24).toString("base64url") };
const fromLegacy = { COLORLIGHT_USERNAME: legacy.COLORLIGHT_USERNAME, COLORLIGHT_PASSWORD: legacy.COLORLIGHT_PASSWORD };
// No longer used: the session key and the first owner login come from the PocketBase superuser,
// and session cookies are marked Secure whenever the request is HTTPS.
const retired = new Set(["OWNER_EMAIL", "OWNER_PASSWORD", "OWNER_NAME", "COOKIE_SECURE"]);
// The old dashboard/.env always had a generated session secret; it's now worked out from the
// PocketBase password unless someone sets one on purpose.
if (moving) retired.add("SESSION_SECRET");

const inTemplate = new Set([...template.matchAll(/^#? ?([A-Z0-9_]+)=/gm)].map((m) => m[1]));
const lines = template.split("\n").map((line) => {
  const active = line.match(/^([A-Z0-9_]+)=(.*)$/);
  const optional = line.match(/^# ([A-Z0-9_]+)=(.*)$/);
  const key = active?.[1] ?? optional?.[1];
  if (!key) return line;
  const value = current[key];
  if (active) return `${key}=${value || fromLegacy[key] || generated[key] || active[2]}`;
  if (retired.has(key)) return line;
  // An optional setting stays commented out unless it was set to something other than the default.
  return value !== undefined && value !== "" && value !== optional[2] ? `${key}=${value}` : line;
});
const extra = Object.keys(current).filter((k) => !inTemplate.has(k) && !retired.has(k));
if (extra.length) lines.push("", "# ── Kept from your previous .env ──", ...extra.map((k) => `${k}=${current[k]}`));
writeFileSync(envPath, lines.join("\n"), { mode: 0o600 });
if (moving) rmSync(oldEnvPath);
const env = parseEnv(lines.join("\n"));
console.log(
  `[setup] .env ready at the repo root${moving ? " (moved up from dashboard/)" : ""}` +
    (env.COLORLIGHT_USERNAME ? "" : ": add your Colorlight login to it"),
);

// ── 3: PocketBase binary, the schema script's dependency, superuser ───────────
const local = isLocalPocketBase();
if (!existsSync(join(pbDir, "node_modules", "pocketbase"))) {
  execFileSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: pbDir, stdio: "ignore" });
}
if (local) {
  await ensureBinary();
  await runPocketBase(["superuser", "upsert", env.POCKETBASE_EMAIL, env.POCKETBASE_PASSWORD], { stdio: "ignore" });
  console.log("[setup] PocketBase superuser ready");
} else {
  console.log(`[setup] using the deployed PocketBase at ${pocketbaseUrl().origin}`);
}

// ── 4: schema + seeds ─────────────────────────────────────────────────────────
const base = local ? `http://${pocketbaseHost()}` : pocketbaseUrl().href.replace(/\/$/, "");
const up = async () => {
  try {
    return (await fetch(`${base}/api/health`)).ok;
  } catch {
    return false;
  }
};

let temp = null;
if (!(await up())) {
  if (!local) throw new Error(`[setup] can't reach PocketBase at ${base}`);
  void runPocketBase(["serve"], { stdio: "ignore", onSpawn: (child) => (temp = child) }).catch(() => {});
  for (let i = 0; i < 50 && !(await up()); i++) await new Promise((r) => setTimeout(r, 200));
}
try {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(pbDir, "scripts", "setup-schema.js")], {
      stdio: "inherit",
      env: { ...process.env, ...env, POCKETBASE_URL: base },
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("schema setup failed"))));
  });
} finally {
  temp?.kill();
}
console.log("[setup] done: run `npm run dev`");

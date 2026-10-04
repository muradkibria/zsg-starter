#!/usr/bin/env node
// Visual QA: signs in as the first owner, visits every screen at desktop and phone
// sizes, saves screenshots to qa-screenshots/ and reports console errors / failed
// API calls. It signs itself in with a session made from the repo's .env (the
// PocketBase superuser), so it needs no dashboard password.
//
//   node scripts/qa.mjs                  every screen, plus one of each detail page
//   node scripts/qa.mjs /map /bags       specific routes
//   BASE=http://127.0.0.1:4000 node scripts/qa.mjs   (against a production build)
//   SIZES=mobile node scripts/qa.mjs     one size only
//
// Screenshots are full length (the app scrolls inside <main>, so the window is
// stretched to fit before capturing), except the map, which fills the screen.

import { chromium } from "playwright-core";
import { createHmac, hkdfSync } from "node:crypto";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(root, "..", ".env"), "utf8")
    .split("\n")
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const BASE = process.env.BASE ?? "http://127.0.0.1:5173";

/** A dashboard session for the first active owner, signed the way server/src/config.ts + api/auth.ts do. */
async function ownerSession() {
  const pbUrl = env.POCKETBASE_URL || "http://127.0.0.1:8190";
  const auth = await fetch(`${pbUrl}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identity: env.POCKETBASE_EMAIL, password: env.POCKETBASE_PASSWORD }),
  }).then((r) => r.json());
  if (!auth.token) throw new Error("Couldn't sign in to PocketBase with POCKETBASE_EMAIL / POCKETBASE_PASSWORD from .env");
  const filter = encodeURIComponent('role = "owner" && disabled = false');
  const owner = (await fetch(`${pbUrl}/api/collections/users/records?filter=${filter}&sort=created&perPage=1`, { headers: { authorization: auth.token } }).then((r) => r.json())).items?.[0];
  if (!owner) throw new Error("No owner login yet: run npm run setup");
  const key = env.SESSION_SECRET
    ? Buffer.from(env.SESSION_SECRET)
    : Buffer.from(hkdfSync("sha256", env.POCKETBASE_PASSWORD, "digilite-hub", "session cookie", 32));
  const part = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${part({ alg: "HS256" })}.${part({ sub: owner.id, sv: owner.session_version || 0, iat: now, exp: now + 3600 })}`;
  return `${unsigned}.${createHmac("sha256", key).update(unsigned).digest("base64url")}`;
}
const session = await ownerSession();
const out = join(root, "qa-screenshots");
mkdirSync(out, { recursive: true });

const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => existsSync(p));

const DEFAULT_ROUTES = [
  "/map",
  "/alerts",
  "/bags",
  "/riders",
  "/loops",
  "/schedules",
  "/payroll",
  "/exports",
  "/campaigns",
  "/reports",
  "/zones",
  "/settings",
  "/more",
];

const routes = process.argv.slice(2).filter((a) => a.startsWith("/"));
const list = routes.length ? [...routes] : [...DEFAULT_ROUTES];
const sizes = (process.env.SIZES ?? "desktop,mobile").split(",");
const VIEW = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
let problems = 0;
for (const size of sizes) {
  const ctx = await browser.newContext({ viewport: VIEW[size], deviceScaleFactor: size === "mobile" ? 2 : 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/tile|glyph|sprite|Failed to load resource.*(openfreemap|openstreetmap)/i.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("response", (r) => {
    if (r.url().includes("/api/") && r.status() >= 400 && r.status() !== 401) errors.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`);
  });

  await ctx.addCookies([{ name: "dl_session", value: session, url: BASE }]);
  await page.goto(`${BASE}/map`);
  await page.waitForURL(/\/map/, { timeout: 15000 });

  // One of each detail page, found from the API (only when no routes were given).
  const detail = [];
  if (!routes.length && size === sizes[0]) {
    const first = async (path, pick = (x) => x) => {
      const r = await page.request.get(`${BASE}/api${path}`);
      if (!r.ok()) return null;
      const body = await r.json();
      const rows = Array.isArray(body) ? body : body.items ?? body.riders ?? body.loops ?? body.campaigns ?? [];
      return rows.map(pick).find(Boolean) ?? null;
    };
    const bag = await first("/bags", (b) => (b.status === "now" ? b.id : null));
    const rider = await first("/riders", (r) => (r.stage === "active" ? r.id : null));
    const loop = await first("/loops", (l) => l.id);
    const campaign = await first("/campaigns", (c) => c.id);
    if (bag) detail.push(`/bags/${bag}`, `/map?bag=${bag}`);
    if (rider) detail.push(`/riders/${rider}`, `/riders/${rider}/end`);
    if (loop) detail.push(`/loops/${loop}`);
    if (campaign) detail.push(`/campaigns/${campaign}`, `/reports/${campaign}`);
    list.push(...detail);
  }

  for (const route of list) {
    errors.length = 0;
    await page.goto(`${BASE}${route}`);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(route.startsWith("/map") || route.startsWith("/zones") ? 3500 : 1200);
    const name = `${size}-${route.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "root"}.png`;
    const full = !route.startsWith("/map");
    if (full) {
      const height = await page.evaluate(() => {
        const main = document.querySelector("main");
        const inner = main ? main.getBoundingClientRect().top + main.scrollHeight : 0;
        return Math.max(inner, document.documentElement.scrollHeight, window.innerHeight);
      });
      await page.setViewportSize({ width: VIEW[size].width, height: Math.min(height, size === "mobile" ? 7000 : 9000) });
      await page.waitForTimeout(400);
    }
    await page.screenshot({ path: join(out, name), fullPage: full });
    if (full) await page.setViewportSize(VIEW[size]);
    const placeholder = await page.locator("text=Being built.").count();
    const status = errors.length || placeholder ? "✗" : "✓";
    if (errors.length || placeholder) problems++;
    console.log(`${status} ${size.padEnd(7)} ${route}${placeholder ? "  (placeholder page)" : ""}`);
    for (const e of errors) console.log(`    ${e.slice(0, 220)}`);
  }
  await ctx.close();
}
await browser.close();
console.log(problems ? `\n${problems} screen(s) need attention` : "\nAll screens clean");
process.exit(problems ? 1 : 0);

#!/usr/bin/env node
/**
 * DigiLite Hub — PocketBase schema setup.
 *
 * Idempotent: safe to re-run against any instance. Collections are created if
 * absent and their fields, indexes and API rules reconciled if present. Then the
 * PocketBase settings the API server relies on are applied, and the first rows are
 * seeded if they don't exist yet. A seeded row is never overwritten.
 *
 *   POCKETBASE_URL       e.g. http://127.0.0.1:8190
 *   POCKETBASE_EMAIL     superuser
 *   POCKETBASE_PASSWORD  superuser
 *
 * Read from the environment, then from the repo's .env (shared with the dashboard)
 * for anything unset. A fresh install's first dashboard owner signs in with the
 * same email and password; change it in Settings once you're in.
 *
 *   npm run setup                                  apply (from this directory)
 *   npm run setup -- --check                       show what would change, change nothing
 *   npm run setup -- --allow-drop                  also remove fields that aren't listed below
 *   npm run setup:schema                           the same, from dashboard/
 *
 * ── The rules that shape everything below ───────────────────────────────────
 *
 * PocketBase is DigiLite Hub's record. The data comes from Colorlight, the only
 * data source for now: the API server's Colorlight sync pulls bag status, GPS,
 * plays, ads and loops on timers and records them here. If Colorlight later
 * changes or drops something, the record here stands.
 *
 * Everything is kept permanently. There are no retention windows, so:
 *   - no relation cascades onto history. Deleting a bag, rider or loop that has
 *     history is refused instead of silently taking the history with it;
 *   - pb_hooks/keep-history.pb.js refuses to delete history and audit records at
 *     all, whoever asks: the API, the admin UI or a cascade;
 *   - this script never drops a field it finds in the database but not below. It
 *     stops and lists them, because the column's data goes with it. Check, then
 *     re-run with --allow-drop.
 *
 * Every collection is locked: all API rules null, superuser only, and nobody can
 * sign in to PocketBase as a dashboard user (`users.authRule` is null too). The web
 * app never talks to PocketBase; the API server is the only client, checks each
 * person's six-digit sign-in code itself and enforces roles.
 *
 * What this script cannot do, so nobody looks for it here:
 *   - change a field's type in place. Add a field with a new name and backfill it;
 *   - give a new field a value on existing rows: a new number reads 0 and a new
 *     text reads "" until something writes it.
 */

const crypto = require("node:crypto");
const path = require("node:path");

try {
  process.loadEnvFile(path.resolve(__dirname, "../../.env"));
} catch {
  // No .env: everything must come from the environment.
}

const PocketBase = require("pocketbase/cjs");

const URL_ = process.env.POCKETBASE_URL;
const EMAIL = process.env.POCKETBASE_EMAIL;
const PASSWORD = process.env.POCKETBASE_PASSWORD;
const CHECK = process.argv.includes("--check");
const ALLOW_DROP = process.argv.includes("--allow-drop");

if (!URL_ || !EMAIL || !PASSWORD) {
  console.error(
    "\nMissing configuration. Set these in the repo's .env or the environment:\n\n" +
      "  POCKETBASE_URL=http://127.0.0.1:8190\n" +
      "  POCKETBASE_EMAIL=you@example.com\n" +
      "  POCKETBASE_PASSWORD=...\n",
  );
  process.exit(1);
}

// ─── Field helpers ──────────────────────────────────────────────────────────
//
// `target` on a relation is the target collection's NAME; it becomes a
// collectionId at apply time, once that collection exists.

const text = (name, max, o = {}) => ({ name, type: "text", max, ...o });
const number = (name, o = {}) => ({ name, type: "number", ...o });
const int = (name, o = {}) => ({ name, type: "number", onlyInt: true, ...o });
const bool = (name) => ({ name, type: "bool" });
const date = (name, o = {}) => ({ name, type: "date", ...o });
const json = (name, maxSize) => ({ name, type: "json", maxSize });
const select = (name, values, o = {}) => ({ name, type: "select", values, maxSelect: 1, ...o });
const file = (name, maxSize, mimeTypes, o = {}) => ({ name, type: "file", maxSelect: 1, maxSize, mimeTypes, ...o });
const relation = (name, target, o = {}) => ({ name, type: "relation", target, maxSelect: 1, cascadeDelete: false, ...o });
const created = () => ({ name: "created", type: "autodate", onCreate: true, onUpdate: false });
const updated = () => ({ name: "updated", type: "autodate", onCreate: true, onUpdate: true });

const LOCKED = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };

// ─── Collections, in creation order ─────────────────────────────────────────
//
// A relation needs its target's collection id, which only exists once the target
// has been created, so every collection comes after the ones it points at. The
// order here IS the order of creation.

const COLLECTIONS = [
  {
    name: "users",
    type: "auth",
    // PocketBase's own auth fields (email, password, tokenKey, verified,
    // emailVisibility) and their indexes are kept as they are. The password is
    // random and unused: people sign in to the dashboard with their code.
    fields: [
      text("name", 255),
      file("avatar", 0, ["image/jpeg", "image/png", "image/svg+xml", "image/gif", "image/webp"]),
      created(),
      updated(),
      select("role", ["owner", "ops", "sales", "viewer"], { required: true }),
      bool("disabled"),
      // Carried in the dashboard's session cookie. A new code bumps it, which ends
      // that person's other sessions.
      int("session_version"),
      // Their six-digit sign-in code, unique across the team (empty: they can't sign in).
      text("login_code", 6, { pattern: "^[0-9]{6}$", hidden: true }),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_users_login_code ON users (login_code) WHERE login_code != ''"],
    rules: { ...LOCKED, authRule: null, manageRule: null },
  },

  // ── Contracts and ads ─────────────────────────────────────────────────────
  {
    name: "campaigns",
    fields: [
      text("advertiser", 200, { required: true }),
      text("name", 200, { required: true }),
      date("start_date"),
      date("end_date"),
      int("contracted_bags"),
      select("status", ["draft", "live", "ended"]),
      text("notes", 5000),
      bool("demo"),
      created(),
      updated(),
    ],
  },
  {
    // Ad files. Uploaded here, or recorded from Colorlight's media library
    // (`colorlight_media_id`, `colorlight_md5` = the name plays are reported under).
    // The file itself is kept here either way.
    name: "creatives",
    fields: [
      text("name", 300, { required: true }),
      text("advertiser", 200),
      relation("campaign", "campaigns"),
      select("source", ["uploaded", "colorlight"], { required: true }),
      file("file", 100 * 1024 * 1024, ["video/mp4", "video/quicktime", "image/jpeg", "image/png", "image/gif"]),
      file("thumb", 5 * 1024 * 1024, ["image/jpeg", "image/png", "image/webp", "image/gif"]),
      select("media_type", ["video", "image"]),
      number("duration_s"),
      int("width"),
      int("height"),
      int("size_bytes"),
      int("colorlight_media_id"),
      text("colorlight_md5", 200),
      text("colorlight_url", 1000),
      json("checks", 20000),
      bool("archived"),
      created(),
      updated(),
    ],
    indexes: ["CREATE INDEX idx_creatives_cl ON creatives (colorlight_media_id)", "CREATE INDEX idx_creatives_md5 ON creatives (colorlight_md5)"],
  },
  {
    // Loops (Colorlight calls them programs). One record per version: a loop that
    // is on bags is fixed, and a change made in Colorlight's own editor arrives as
    // a new record, with the old one kept and archived.
    name: "loops",
    fields: [
      text("name", 200, { required: true }),
      select("status", ["draft", "published", "imported", "archived"], { required: true }),
      json("items", 200000),
      int("colorlight_program_id"),
      text("colorlight_program_name", 300),
      date("published_at"),
      text("notes", 2000),
      created(),
      updated(),
      // The file name Colorlight gives this version ("June 26_<md5>_7174.vsn").
      // Bags report exactly this name as what they're playing.
      text("colorlight_vsn", 400),
    ],
    indexes: ["CREATE INDEX idx_loops_program ON loops (colorlight_program_id)", "CREATE INDEX `idx_loops_vsn` ON `loops` (colorlight_vsn)"],
  },

  // ── Bags and their history ────────────────────────────────────────────────
  {
    // The bag is the asset. One per Colorlight terminal (`colorlight_id`); the
    // device fields are the latest values Colorlight reported.
    name: "bags",
    fields: [
      int("colorlight_id", { required: true }),
      text("name", 80, { required: true }),
      text("colorlight_name", 120),
      int("group_id"),
      text("model", 40),
      text("firmware", 40),
      text("serial", 60),
      int("width"),
      int("height"),
      number("brightness_raw"),
      text("timezone", 20),
      text("locale", 20),
      text("playing_program", 200),
      text("playing_vsn", 300),
      json("downloaded_programs", 200000),
      number("storage_used_pct"),
      bool("power_on"),
      bool("ws_connected"),
      date("last_report_at"),
      date("last_screenshot_at"),
      number("gps_interval_s"),
      number("lat"),
      number("lng"),
      number("speed"),
      number("heading"),
      date("last_gps_at"),
      select("lifecycle", ["active", "storage", "repair", "lost", "retired"]),
      text("lifecycle_note", 500),
      json("device_schedule", 500000),
      json("device_status", 500000),
      date("status_synced_at"),
      created(),
      updated(),
      relation("playing_loop", "loops"),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_bags_colorlight_id ON bags (colorlight_id)", "CREATE INDEX idx_bags_name ON bags (name)"],
  },
  {
    name: "gps_points",
    fields: [
      relation("bag", "bags", { required: true }),
      date("ts", { required: true }),
      int("seq"),
      number("lat", { required: true }),
      number("lng", { required: true }),
      bool("late"),
      text("k", 80, { required: true }),
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_gps_k ON gps_points (k)",
      "CREATE INDEX idx_gps_bag_ts ON gps_points (bag, ts)",
      "CREATE INDEX idx_gps_ts ON gps_points (ts)",
    ],
  },
  {
    name: "plays",
    fields: [
      relation("bag", "bags", { required: true }),
      date("hour", { required: true }),
      text("media_md5", 200, { required: true }),
      text("media_name", 300),
      text("media_type", 20),
      int("plays"),
      number("seconds"),
      created(),
      updated(),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_plays_key ON plays (bag, hour, media_md5)", "CREATE INDEX idx_plays_hour ON plays (hour)"],
  },
  {
    // Worked out from gps_points (and plays) per bag per London day; recomputed in place.
    name: "bag_days",
    fields: [
      relation("bag", "bags", { required: true }),
      text("day", 10, { required: true }),
      date("first_at"),
      date("last_at"),
      int("points"),
      number("on_seconds"),
      number("moving_seconds"),
      number("stopped_seconds"),
      number("gap_seconds"),
      int("gaps"),
      number("km"),
      json("shifts", 200000),
      json("stops", 200000),
      json("signal_gaps", 200000),
      json("zones", 50000),
      int("plays"),
      date("computed_at"),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_bag_days_key ON bag_days (bag, day)", "CREATE INDEX idx_bag_days_day ON bag_days (day)"],
  },
  {
    name: "screenshots",
    fields: [
      relation("bag", "bags", { required: true }),
      date("taken_at", { required: true }),
      file("file", 5 * 1024 * 1024, ["image/jpeg", "image/png"]),
      created(),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_screens_key ON screenshots (bag, taken_at)"],
  },

  // ── Riders ────────────────────────────────────────────────────────────────
  {
    name: "riders",
    fields: [
      text("name", 120, { required: true }),
      text("phone", 40),
      text("email", 200),
      select("stage", ["applied", "checked", "waiting", "active", "ended"], { required: true }),
      date("joined_at"),
      date("ended_at"),
      text("ended_reason", 500),
      text("notes", 5000),
      bool("demo"),
      created(),
      updated(),
    ],
    indexes: ["CREATE INDEX idx_riders_stage ON riders (stage)"],
  },
  {
    // Protected files: only the superuser (so only the API server) can read them.
    name: "rider_documents",
    fields: [
      relation("rider", "riders", { required: true }),
      select("kind", ["id", "right_to_work", "address", "dbs", "agreement", "insurance", "other"], { required: true }),
      file("file", 15 * 1024 * 1024, ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/webp"], { protected: true }),
      select("status", ["pending", "checked", "rejected"]),
      date("checked_at"),
      date("expires_at"),
      text("notes", 1000),
      created(),
      updated(),
    ],
  },
  {
    // Who carried which bag, when. A rider's hours and routes are the bag's data
    // between these dates.
    name: "assignments",
    fields: [
      relation("bag", "bags", { required: true }),
      relation("rider", "riders", { required: true }),
      date("start_at", { required: true }),
      date("end_at"),
      text("end_reason", 500),
      created(),
      updated(),
    ],
    indexes: ["CREATE INDEX idx_assign_bag ON assignments (bag, start_at)", "CREATE INDEX idx_assign_rider ON assignments (rider, start_at)"],
  },

  // ── Places, changes to bags, and the rules that drive them ────────────────
  {
    name: "zones",
    fields: [
      text("name", 120, { required: true }),
      select("kind", ["circle", "polygon"], { required: true }),
      select("type", ["neighbourhood", "high_street", "station", "other"]),
      number("center_lat"),
      number("center_lng"),
      number("radius_m"),
      json("polygon", 200000),
      bool("active"),
      int("sort"),
      created(),
      updated(),
    ],
  },
  {
    // Every attempt to send a loop to bags, including dry runs and blocked ones.
    name: "deployments",
    fields: [
      relation("loop", "loops", { required: true }),
      select("target", ["test_bag", "bags", "fleet"], { required: true }),
      json("bags", 50000),
      int("colorlight_program_id"),
      select("status", ["dry_run", "blocked", "sending", "sent", "failed", "confirmed", "partial"], { required: true }),
      json("delivery", 200000),
      text("error", 2000),
      relation("requested_by", "users"),
      created(),
      updated(),
    ],
  },
  {
    // Every attempt to change a bag (brightness, restart, screen, schedule), dry runs included.
    name: "commands",
    fields: [
      relation("bag", "bags", { required: true }),
      select("type", ["brightness", "reboot", "screenshot", "sleep", "wakeup", "schedule", "publish"], { required: true }),
      json("value", 200000),
      select("status", ["dry_run", "blocked", "sent", "failed", "confirmed"], { required: true }),
      json("response", 200000),
      text("error", 2000),
      relation("requested_by", "users"),
      date("confirmed_at"),
      created(),
      updated(),
    ],
    indexes: ["CREATE INDEX idx_commands_bag ON commands (bag, created)"],
  },
  {
    name: "schedules",
    fields: [
      text("name", 200, { required: true }),
      select("scope", ["fleet", "bag"], { required: true }),
      relation("bag", "bags"),
      json("rules", 200000),
      json("brightness", 50000),
      select("status", ["draft", "applied"]),
      date("applied_at"),
      json("applied_to", 50000),
      created(),
      updated(),
    ],
  },
  {
    name: "payroll_periods",
    fields: [
      text("start_day", 10, { required: true }),
      text("end_day", 10, { required: true }),
      select("status", ["draft", "approved"], { required: true }),
      json("adjustments", 200000),
      json("snapshot", 2000000),
      relation("approved_by", "users"),
      date("approved_at"),
      created(),
      updated(),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_payroll_period ON payroll_periods (start_day, end_day)"],
  },
  {
    // One row, key "main". Edited from the dashboard's Settings page.
    name: "app_settings",
    fields: [
      text("key", 40, { required: true }),
      bool("fleet_writes_enabled"),
      text("fleet_loop_name", 200),
      number("brightness_target_pct"),
      int("brightness_command_scale"),
      number("shift_break_min"),
      number("signal_gap_min"),
      number("stop_radius_m"),
      number("stop_min"),
      text("pay_rate", 60),
      number("pay_min_hours"),
      bool("pay_signal_gaps"),
      created(),
      updated(),
    ],
    indexes: ["CREATE UNIQUE INDEX idx_settings_key ON app_settings (key)"],
  },
  {
    name: "audit_log",
    fields: [
      relation("actor", "users"),
      text("actor_name", 200),
      text("action", 80, { required: true }),
      text("entity_type", 60),
      text("entity_id", 60),
      text("summary", 1000),
      json("meta", 50000),
      created(),
    ],
    indexes: ["CREATE INDEX idx_audit_created ON audit_log (created)", "CREATE INDEX `idx_audit_action_actor` ON `audit_log` (action, actor)"],
  },
  {
    // Where each Colorlight sync job has got to, so a restart carries on from there.
    name: "sync_state",
    fields: [text("key", 120, { required: true }), json("value", 200000), updated()],
    indexes: ["CREATE UNIQUE INDEX idx_sync_key ON sync_state (key)"],
  },
];

// ─── PocketBase settings the API server depends on ──────────────────────────

const SETTINGS = {
  meta: { appName: "DigiLite Hub data" },
  // The Colorlight sync writes GPS and plays in batches of up to 1,000.
  batch: { enabled: true, maxRequests: 1000, timeout: 30 },
};
// Daily backups at 03:30 when none are scheduled yet (a schedule set in the admin
// UI, e.g. to S3, is left alone). Data is kept permanently, so this matters.
const BACKUPS = { cron: "30 3 * * *", cronMaxKeep: 3 };

// ─── Seeds (created when missing, never overwritten) ────────────────────────

const SETTINGS_ROW = {
  key: "main",
  fleet_writes_enabled: false,
  fleet_loop_name: "",
  brightness_target_pct: 70,
  // Bags take brightness as 0–255 (Colorlight's docs, and what every bag reports).
  brightness_command_scale: 255,
  shift_break_min: 45,
  signal_gap_min: 5,
  stop_radius_m: 50,
  stop_min: 15,
  pay_rate: "",
  pay_min_hours: 0,
  pay_signal_gaps: false,
};

// Six provisional zones where the fleet's routes concentrate. Agree the real set
// in the Zones page; these are only created on an instance with no zones at all.
const ZONES = [
  ["Shoreditch & Hoxton", 51.53275, -0.0745, 1040],
  ["Soho & Covent Garden", 51.5147, -0.129, 1040],
  ["Whitechapel & Aldgate", 51.52092, -0.064, 830],
  ["Stepney & Shadwell", 51.51843, -0.048, 760],
  ["Mayfair & St James's", 51.51003, -0.1415, 760],
  ["The City", 51.51843, -0.095, 830],
];

// ─── Comparing a spec with what's there ─────────────────────────────────────

const RULE_KEYS = ["listRule", "viewRule", "createRule", "updateRule", "deleteRule", "authRule", "manageRule"];

/** The options this file manages, per type, with PocketBase's defaults. */
const MANAGED = {
  text: { required: false, max: 0, pattern: "", hidden: false },
  number: { required: false, onlyInt: false },
  bool: { required: false },
  date: { required: false },
  json: { required: false, maxSize: 0 },
  select: { required: false, values: [], maxSelect: 1 },
  file: { required: false, maxSelect: 1, maxSize: 0, mimeTypes: [], protected: false },
  relation: { required: false, collectionId: "", maxSelect: 1, cascadeDelete: false },
  autodate: { onCreate: false, onUpdate: false },
};

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const normIndex = (s) => s.replace(/[`"]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/** The spec field as PocketBase wants it: relation targets turned into collection ids. */
function resolve(field, ids) {
  const { target, ...rest } = field;
  if (field.type !== "relation") return rest;
  if (!ids[target]) throw new Error(`"${field.name}" points at "${target}", which hasn't been created yet`);
  return { ...rest, collectionId: ids[target] };
}

/** What differs between a spec field and the field in the database, as "key a → b" notes. */
function fieldChanges(spec, live) {
  const managed = MANAGED[spec.type] ?? {};
  const notes = [];
  for (const [key, fallback] of Object.entries(managed)) {
    const want = spec[key] ?? fallback;
    const have = live[key] ?? fallback;
    if (!same(want, have)) notes.push(`${key} ${JSON.stringify(have)} → ${JSON.stringify(want)}`);
  }
  return notes;
}

/** Work out what applying `spec` to `current` (or creating it) would do. */
function plan(spec, current, ids) {
  const fields = spec.fields.map((f) => resolve(f, ids));
  const rules = { ...LOCKED, ...(spec.rules ?? {}) };
  if (spec.type !== "auth") {
    delete rules.authRule;
    delete rules.manageRule;
  }
  const out = { name: spec.name, create: !current, adds: [], drops: [], updates: [], retypes: [], indexNotes: [], ruleNotes: [] };

  if (!current) {
    out.payload = { name: spec.name, type: spec.type ?? "base", fields, indexes: spec.indexes ?? [], ...rules };
    return out;
  }

  const specByName = new Map(fields.map((f) => [f.name, f]));
  const liveByName = new Map(current.fields.map((f) => [f.name, f]));
  const merged = [];
  for (const live of current.fields) {
    const want = specByName.get(live.name);
    if (!want) {
      // PocketBase's own fields (id, and email/password/tokenKey… on auth) stay as they are.
      if (live.system) merged.push(live);
      else out.drops.push(live.name);
      continue;
    }
    if (want.type !== live.type) {
      out.retypes.push(`${live.name} (${live.type} → ${want.type})`);
      merged.push(live);
      continue;
    }
    const notes = fieldChanges(want, live);
    if (notes.length) out.updates.push(`${live.name}: ${notes.join(", ")}`);
    // Same field id, so the column and its data stay where they are.
    merged.push({ ...live, ...want, id: live.id });
  }
  for (const f of fields) {
    if (!liveByName.has(f.name)) {
      out.adds.push(f.name);
      merged.push(f);
    }
  }
  const fieldsOut = ALLOW_DROP ? merged : [...merged, ...current.fields.filter((f) => out.drops.includes(f.name))];

  // Indexes: keep PocketBase's own (on auth fields), and only rewrite when the set really differs.
  const systemIndexes = (current.indexes ?? []).filter((i) => /idx_(tokenKey|email)_/.test(i));
  const wantIndexes = [...systemIndexes, ...(spec.indexes ?? [])];
  const haveSet = new Set((current.indexes ?? []).map(normIndex));
  const wantSet = new Set(wantIndexes.map(normIndex));
  for (const i of wantIndexes) if (!haveSet.has(normIndex(i))) out.indexNotes.push(`add ${i}`);
  for (const i of current.indexes ?? []) if (!wantSet.has(normIndex(i))) out.indexNotes.push(`remove ${i}`);
  const indexes = out.indexNotes.length ? wantIndexes : current.indexes;

  for (const key of Object.keys(rules)) {
    if (!same(current[key], rules[key])) out.ruleNotes.push(`${key} ${JSON.stringify(current[key])} → ${JSON.stringify(rules[key])}`);
  }

  out.changed = !!(out.adds.length || out.updates.length || out.indexNotes.length || out.ruleNotes.length || (ALLOW_DROP && out.drops.length));
  out.payload = { fields: fieldsOut, indexes, ...rules };
  return out;
}

function describe(p) {
  if (p.create) return [`  create   ${p.name}`];
  const lines = [];
  for (const a of p.adds) lines.push(`  add      ${p.name}.${a}`);
  for (const u of p.updates) lines.push(`  update   ${p.name}.${u}`);
  for (const d of p.drops) lines.push(`  ${ALLOW_DROP ? "drop   " : "DROP?  "}  ${p.name}.${d}${ALLOW_DROP ? "" : "   (in the database, not in this file: needs --allow-drop)"}`);
  for (const r of p.retypes) lines.push(`  RETYPE?  ${p.name}.${r}   (can't be changed in place)`);
  for (const i of p.indexNotes) lines.push(`  index    ${p.name}: ${i}`);
  for (const r of p.ruleNotes) lines.push(`  rule     ${p.name}.${r}`);
  if (!lines.length) lines.push(`  ok       ${p.name}`);
  return lines;
}

// ─── Seeding ────────────────────────────────────────────────────────────────

async function seed(pb) {
  const settings = await pb.collection("app_settings").getList(1, 1, { filter: 'key = "main"' });
  if (!settings.items.length) {
    await pb.collection("app_settings").create(SETTINGS_ROW);
    console.log("  seeded   app_settings (main)");
  } else {
    console.log("  kept     app_settings (main)");
  }

  const zones = await pb.collection("zones").getList(1, 1, { fields: "id" });
  if (!zones.totalItems) {
    for (const [i, [name, lat, lng, r]] of ZONES.entries()) {
      await pb.collection("zones").create({ name, kind: "circle", type: "neighbourhood", center_lat: lat, center_lng: lng, radius_m: r, active: true, sort: i });
    }
    console.log(`  seeded   zones (${ZONES.length} provisional)`);
  } else {
    console.log(`  kept     zones (${zones.totalItems})`);
  }

  // The first owner, and a sign-in code for them if no working owner has one (so
  // someone can always get in). The code is printed here, once; the owner gives
  // everyone else theirs from the dashboard's Settings → Team & roles.
  const owners = await pb.collection("users").getFullList({ filter: 'role = "owner"', sort: "created", fields: "id,disabled,login_code" });
  const working = owners.filter((o) => !o.disabled);
  if (!owners.length) {
    const code = await unusedCode(pb);
    const password = crypto.randomBytes(24).toString("base64url");
    await pb.collection("users").create({ email: EMAIL, password, passwordConfirm: password, name: "Owner", role: "owner", verified: true, login_code: code });
    console.log(`  seeded   owner login, sign-in code ${code} (shown once: keep it)`);
  } else if (working.length && !working.some((o) => o.login_code)) {
    const code = await unusedCode(pb);
    await pb.collection("users").update(working[0].id, { login_code: code, "session_version+": 1 });
    console.log(`  set      a sign-in code for the owner: ${code} (shown once: keep it)`);
  } else {
    console.log("  kept     owner login");
  }
}

/** A random six-digit code nobody on the team has. */
async function unusedCode(pb) {
  for (;;) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const taken = await pb.collection("users").getList(1, 1, { filter: `login_code = "${code}"`, fields: "id" });
    if (!taken.totalItems) return code;
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const pb = new PocketBase(URL_);
  pb.autoCancellation(false);
  try {
    await pb.collection("_superusers").authWithPassword(EMAIL, PASSWORD);
  } catch (err) {
    console.error(`\nCould not sign in as the superuser at ${URL_}\n  ${err?.message || err}\n`);
    process.exit(1);
  }

  const existing = await pb.collections.getFullList();
  const byName = new Map(existing.map((c) => [c.name, c]));
  const ids = Object.fromEntries(existing.map((c) => [c.name, c.id]));

  // Check everything before writing anything: a run that would lose data or can't
  // be applied stops here with nothing changed.
  const plans = [];
  for (const spec of COLLECTIONS) {
    // A collection that doesn't exist yet gets a placeholder id for planning; the
    // real one is filled in as it's created, before anything points at it.
    if (!ids[spec.name]) ids[spec.name] = `(new ${spec.name})`;
    plans.push(plan(spec, byName.get(spec.name), ids));
  }
  console.log(`\n${CHECK ? "Checking" : "Reconciling"} the schema at ${URL_}\n`);
  for (const p of plans) for (const line of describe(p)) console.log(line);

  const blocked = plans.some((p) => p.retypes.length) || (!ALLOW_DROP && plans.some((p) => p.drops.length));
  if (blocked) {
    console.error(
      "\nNothing was changed. Fields marked DROP? hold data that would be deleted with them: check, then re-run with" +
        " --allow-drop. A RETYPE? can't be done in place: add a new field instead.\n",
    );
    process.exit(1);
  }
  if (CHECK) {
    console.log("\n--check: nothing was changed.\n");
    return;
  }

  // Apply, in order, so each relation's target exists before it's needed.
  for (const spec of COLLECTIONS) {
    const current = byName.get(spec.name);
    const p = plan(spec, current, ids);
    if (p.create) {
      const saved = await pb.collections.create(p.payload);
      ids[spec.name] = saved.id;
    } else if (p.changed) {
      await pb.collections.update(current.id, p.payload);
    }
  }

  // Settings
  const settings = await pb.settings.getAll();
  const patch = {};
  if (settings.meta?.appName !== SETTINGS.meta.appName) patch.meta = { ...settings.meta, ...SETTINGS.meta };
  if (!same({ ...settings.batch, ...SETTINGS.batch }, settings.batch)) patch.batch = { ...settings.batch, ...SETTINGS.batch };
  if (!settings.backups?.cron) patch.backups = { ...settings.backups, ...BACKUPS };
  if (Object.keys(patch).length) {
    await pb.settings.update(patch);
    console.log(`\n  settings ${Object.keys(patch).join(", ")} updated`);
  }

  console.log("");
  await seed(pb);

  console.log(`\nSchema reconciled at ${URL_}\n`);
  console.log("Reminders:");
  console.log("  • PocketBase is DigiLite Hub's source of truth and keeps everything permanently. In a");
  console.log("    container, /pb/pb_data MUST be a persistent volume: without one the next deploy");
  console.log("    starts empty, silently. pocketbase/README.md has the check.");
  console.log("  • Backups run daily at 03:30 into pb_data/backups unless a schedule was set already.");
  console.log("    Point them at S3 (admin UI → Settings → Backups) so a copy lives off the volume.");
  console.log("  • History (GPS, plays, bag days, screenshots, changes sent to bags, the audit log,");
  console.log("    approved pay) can't be deleted: pb_hooks/keep-history.pb.js refuses it.\n");
}

main().catch((err) => {
  console.error("\nSchema setup failed:", err?.response?.data ? JSON.stringify(err.response.data) : err?.message || err, "\n");
  process.exit(1);
});

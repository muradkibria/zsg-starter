// PocketBase access for the API server. The server authenticates as superuser;
// all collections are locked so nothing else can read them.

import PocketBase, { ClientResponseError, type RecordModel, type SendOptions } from "pocketbase";
import { createHash } from "node:crypto";
import { config } from "./config";
import { logger } from "./log";
import { toPbDate, fromPbDate } from "@digilite/shared";

const log = logger("pb");

export const pb = new PocketBase(config.POCKETBASE_URL);
pb.autoCancellation(false);

const SUPERUSER_AUTH = "/api/collections/_superusers/auth-with-password";

/**
 * Sign in again after PocketBase refuses our token. Setting the superuser's password
 * (the PocketBase container does it at every boot) revokes every token issued
 * before, so a long-running API server must expect this. One sign-in is shared by
 * every request refused at the same moment.
 */
let signingIn: Promise<boolean> | null = null;
let lastSignIn = 0;
function signInAgain(): Promise<boolean> {
  if (signingIn) return signingIn;
  // Refused again straight after a fresh sign-in: the refusal is real, not a stale token.
  if (Date.now() - lastSignIn < 5000) return Promise.resolve(false);
  lastSignIn = Date.now();
  signingIn = pb
    .collection("_superusers")
    .authWithPassword(config.POCKETBASE_EMAIL, config.POCKETBASE_PASSWORD, { autoRefreshThreshold: 30 * 60 })
    .then(() => {
      log.info("signed in to PocketBase again (its superuser token had been revoked)");
      return true;
    })
    .catch((err) => {
      log.warn(`couldn't sign in to PocketBase again: ${(err as Error).message}`);
      return false;
    })
    .finally(() => {
      signingIn = null;
    });
  return signingIn;
}

/** Refused for want of a valid superuser token (a batch reports it per request inside a 400). */
function refusedToken(err: ClientResponseError): boolean {
  if (err.status === 401 || err.status === 403) return true;
  return err.status === 400 && /superusers can perform this action|authorization token/i.test(JSON.stringify(err.response ?? {}));
}

// Two retries, each at most once per request:
// - a refused token: sign in again (or use the sign-in another request just did) and resend;
// - a dropped connection (status 0, not an abort) on a read: resend once. A request can
//   land on a keep-alive socket PocketBase has just closed. Writes aren't resent then,
//   so nothing is applied twice.
const sendOnce = pb.send.bind(pb);
pb.send = async function send<T>(path: string, options: SendOptions): Promise<T> {
  const tokenUsed = pb.authStore.token;
  try {
    return await sendOnce<T>(path, options);
  } catch (err) {
    if (!(err instanceof ClientResponseError)) throw err;
    if (refusedToken(err) && !path.includes(SUPERUSER_AUTH)) {
      if (pb.authStore.token !== tokenUsed || (await signInAgain())) return sendOnce<T>(path, options);
      throw err;
    }
    const method = String(options?.method ?? "GET").toUpperCase();
    if (err.status !== 0 || err.isAbort || method !== "GET") throw err;
    await new Promise((r) => setTimeout(r, 150));
    return sendOnce<T>(path, options);
  }
};

export async function connectPb(retries = 60): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await pb.collection("_superusers").authWithPassword(config.POCKETBASE_EMAIL, config.POCKETBASE_PASSWORD, {
        autoRefreshThreshold: 30 * 60,
      });
      log.info(`connected to PocketBase at ${config.POCKETBASE_URL}`);
      return;
    } catch (err) {
      if (i === 0 || i % 10 === 9) log.warn(`waiting for PocketBase at ${config.POCKETBASE_URL}…`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error(`Could not connect to PocketBase at ${config.POCKETBASE_URL}`);
}

/**
 * Refuse to start against a database whose schema is behind this code. PocketBase
 * silently drops a field it doesn't know on write, so a missing field would lose
 * data without an error. The schema comes from the repo's pocketbase/scripts/setup-schema.js.
 */
const EXPECTED: Record<string, string[]> = {
  users: ["role", "disabled", "session_version"],
  bags: ["colorlight_id", "lifecycle", "playing_loop", "device_status"],
  gps_points: ["bag", "ts", "k"],
  plays: ["bag", "hour", "media_md5"],
  bag_days: ["bag", "day", "shifts"],
  riders: ["stage"],
  rider_documents: ["rider", "file"],
  assignments: ["bag", "rider", "start_at"],
  zones: ["kind"],
  campaigns: ["advertiser"],
  creatives: ["colorlight_md5", "file", "archived"],
  loops: ["items", "colorlight_vsn"],
  deployments: ["loop", "delivery"],
  commands: ["bag", "type", "confirmed_at"],
  schedules: ["rules", "brightness"],
  payroll_periods: ["snapshot"],
  app_settings: ["key", "brightness_command_scale"],
  audit_log: ["action"],
  screenshots: ["bag", "file"],
  sync_state: ["key", "value"],
};

export async function checkSchema(): Promise<void> {
  const have = new Map((await pb.collections.getFullList({ fields: "name,fields" })).map((c) => [c.name, new Set(c.fields.map((f) => f.name))]));
  const missing: string[] = [];
  for (const [name, fields] of Object.entries(EXPECTED)) {
    const got = have.get(name);
    if (!got) missing.push(name);
    else for (const f of fields) if (!got.has(f)) missing.push(`${name}.${f}`);
  }
  if (missing.length) {
    throw new Error(`The database schema is behind this code (missing ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "…" : ""}). Run \`npm run setup:schema\`.`);
  }
}

/** A separate client for checking dashboard users' passwords (never shares the superuser auth). */
export function userClient() {
  const c = new PocketBase(config.POCKETBASE_URL);
  c.autoCancellation(false);
  return c;
}

/**
 * Deterministic 15-char record id from a natural key, so repeated syncs of the
 * same data upsert instead of duplicating (PocketBase ids are [a-z0-9]{15}).
 */
export function stableId(key: string): string {
  return createHash("sha1").update(key).digest("hex").slice(0, 15);
}

export const pbDate = toPbDate;
export const parsePbDate = fromPbDate;

/** Escape a value for use inside a PocketBase filter string literal. */
export function q(value: string | number | boolean): string {
  if (typeof value !== "string") return String(value);
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export async function getAll<T = RecordModel>(
  collection: string,
  opts: { filter?: string; sort?: string; fields?: string; expand?: string } = {},
): Promise<T[]> {
  return pb.collection(collection).getFullList<T>({ batch: 1000, skipTotal: true, ...opts });
}

export async function getFirst<T = RecordModel>(collection: string, filter: string, opts: { sort?: string; fields?: string } = {}): Promise<T | null> {
  const res = await pb.collection(collection).getList<T>(1, 1, { filter, skipTotal: true, ...opts });
  return res.items[0] ?? null;
}

export async function getOneOrNull<T = RecordModel>(collection: string, id: string): Promise<T | null> {
  try {
    return await pb.collection(collection).getOne<T>(id);
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) return null;
    throw err;
  }
}

/** Transactional bulk create in chunks (PocketBase batch API). */
export async function batchCreate(collection: string, rows: Record<string, unknown>[], chunk = 500): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const batch = pb.createBatch();
    for (const r of rows.slice(i, i + chunk)) batch.collection(collection).create(r);
    await batch.send();
    n += Math.min(chunk, rows.length - i);
  }
  return n;
}

export async function batchUpsert(collection: string, rows: Record<string, unknown>[], chunk = 500): Promise<void> {
  for (let i = 0; i < rows.length; i += chunk) {
    const batch = pb.createBatch();
    for (const r of rows.slice(i, i + chunk)) batch.collection(collection).upsert(r);
    await batch.send();
  }
}

export function isNotFound(err: unknown) {
  return err instanceof ClientResponseError && err.status === 404;
}

export { ClientResponseError, type RecordModel, parsePbDate as toDate };
export { fromPbDate };

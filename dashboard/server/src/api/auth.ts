// Dashboard sign-in. Each person has their own six-digit code (`users.login_code`,
// unique); the API checks it and issues its own short-lived session cookie
// (httpOnly, SameSite=Lax). The cookie carries the person's session version, which
// moves on whenever they get a new code, so that signs them out everywhere else.
//
// Clients sign in on the same page with their own code (`clients.login_code`).
// Codes are unique across the team and clients together, so the code alone says
// who it is. A client's cookie is marked as one (`k: "c"`) and only ever sets
// req.portalClient, which the team's API ignores: clients reach the portal and nothing else.

import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response, Router } from "express";
import express from "express";
import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import type { ClientSession, Role, SessionUser } from "@digilite/shared";
import { config } from "../config";
import { audit } from "../domain/audit";
import { randomCode, SignInGate } from "../domain/signin";
import { logger } from "../log";
import { getFirst, getOneOrNull, pb, pbDate, q, type RecordModel } from "../pb";
import { HttpError, parse } from "./http";

const COOKIE = "dl_session";
const secret = config.sessionKey;
const TTL_HOURS = 12;
const log = logger("auth");

/** A signed-in person plus their session version (moved on when their code changes). */
interface Known {
  user: SessionUser;
  version: number;
}

const userCache = new Map<string, { at: number; known: Known | null }>();

function toUser(r: RecordModel): SessionUser {
  return { id: r.id, email: r.email, name: r.name || r.email, role: (r.role || "viewer") as Role };
}

async function loadUser(id: string): Promise<Known | null> {
  const hit = userCache.get(id);
  if (hit && Date.now() - hit.at < 30000) return hit.known;
  const rec = await getOneOrNull<RecordModel>("users", id);
  const known = rec && !rec.disabled ? { user: toUser(rec), version: rec.session_version || 0 } : null;
  userCache.set(id, { at: Date.now(), known });
  return known;
}

export function forgetUser(id: string) {
  userCache.delete(id);
}

const clientCache = new Map<string, { at: number; known: { client: ClientSession; version: number } | null }>();

const toClient = (r: RecordModel): ClientSession => ({ kind: "client", id: r.id, name: r.name || "Client" });

async function loadClient(id: string) {
  const hit = clientCache.get(id);
  if (hit && Date.now() - hit.at < 30000) return hit.known;
  const rec = await getOneOrNull<RecordModel>("clients", id);
  const known = rec && !rec.disabled ? { client: toClient(rec), version: rec.session_version || 0 } : null;
  clientCache.set(id, { at: Date.now(), known });
  return known;
}

export function forgetClient(id: string) {
  clientCache.delete(id);
}

/** A code nobody on the team, and no client, has. */
export async function unusedCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = randomCode();
    const filter = `login_code = ${q(code)}`;
    const [u, c] = await Promise.all([getFirst<RecordModel>("users", filter, { fields: "id" }), getFirst<RecordModel>("clients", filter, { fields: "id" })]);
    if (!u && !c) return code;
  }
  throw new HttpError(500, "Couldn't find a free code. Try again.");
}

/** Give a client a new code, ending their other portal sessions. */
export async function setClientCode(clientId: string, code: string): Promise<RecordModel> {
  const rec = await pb.collection("clients").update<RecordModel>(clientId, { login_code: code, "session_version+": 1 });
  forgetClient(clientId);
  return rec;
}

/** PocketBase needs a password on every login record. Nobody uses it: everyone signs in with a code. */
export const unusedPassword = () => randomBytes(24).toString("base64url");

/**
 * Give someone a new code and end every other session of theirs: their session
 * version moves on, so older cookies stop working. Pass `keepSignedIn` to keep the
 * current browser signed in (someone getting a new code for themselves).
 */
export async function setCode(userId: string, code: string, keepSignedIn?: { res: Response; user: SessionUser }): Promise<RecordModel> {
  const rec = await pb.collection("users").update<RecordModel>(userId, { login_code: code, "session_version+": 1 });
  forgetUser(userId);
  if (keepSignedIn) await issue(keepSignedIn.res, keepSignedIn.user, rec.session_version || 0);
  return rec;
}

async function issue(res: Response, u: { id: string }, version: number, kind?: "client") {
  const token = await new SignJWT(kind === "client" ? { sub: u.id, sv: version, k: "c" } : { sub: u.id, sv: version })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TTL_HOURS}h`)
    .sign(secret);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Marked Secure whenever the request came over HTTPS (behind a proxy too: trust proxy is on).
    secure: res.req.secure,
    maxAge: TTL_HOURS * 3600 * 1000,
    path: "/",
  });
}

/** Attaches req.user (or req.portalClient, for a portal session) when a valid session cookie is present. */
export async function sessionMiddleware(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE];
  if (!token) return next();
  try {
    const { payload } = await jwtVerify(token, secret);
    const version = typeof payload.sv === "number" ? payload.sv : 0;
    if (payload.k === "c") {
      const known = payload.sub ? await loadClient(payload.sub) : null;
      if (known && known.version === version) req.portalClient = known.client;
    } else {
      const known = payload.sub ? await loadUser(payload.sub) : null;
      if (known && known.version === version) req.user = known.user;
    }
  } catch {
    // expired or tampered — treated as signed out
  }
  next();
}

export function requireSignedIn(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, "Please sign in"));
  next();
}

const loginSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter your six-digit code") });

// Wrong codes are rationed (relaxed in development): 5 per address per 15 minutes,
// and 50 an hour from everyone together.
const gate = new SignInGate(
  config.isProd
    ? { perAddress: 5, addressWindowMs: 15 * 60_000, overall: 50, overallWindowMs: 60 * 60_000 }
    : { perAddress: 500, addressWindowMs: 15 * 60_000, overall: 5000, overallWindowMs: 60 * 60_000 },
);

export function authRouter(): Router {
  const r = express.Router();

  r.post("/login", async (req, res) => {
    const { code } = parse(loginSchema, req.body);
    const address = req.ip ?? "unknown";
    const blocked = gate.blocked(address);
    if (blocked) throw new HttpError(429, blocked);
    const rec = await getFirst<RecordModel>("users", `login_code = ${q(code)}`);
    const clientRec = rec ? null : await getFirst<RecordModel>("clients", `login_code = ${q(code)}`);
    if (!rec && !clientRec) {
      gate.wrong(address);
      log.warn(`wrong sign-in code from ${address}`);
      throw new HttpError(401, "That code isn't right");
    }
    gate.right(address);
    if (clientRec) {
      if (clientRec.disabled) throw new HttpError(403, "This login has been switched off. Please contact DigiLite.");
      const c = toClient(clientRec);
      const version = clientRec.session_version || 0;
      clientCache.set(c.id, { at: Date.now(), known: { client: c, version } });
      await issue(res, c, version, "client");
      await pb.collection("clients").update(c.id, { last_sign_in: pbDate(new Date()) }).catch(() => {});
      await audit({ id: "", name: `${c.name} (client)` }, "auth.client_login", `${c.name} signed in to the client portal`, { type: "client", id: c.id });
      return void res.json(c);
    }
    if (!rec) throw new HttpError(401, "That code isn't right");
    if (rec.disabled) throw new HttpError(403, "This login has been switched off");
    const u = toUser(rec);
    const version = rec.session_version || 0;
    userCache.set(u.id, { at: Date.now(), known: { user: u, version } });
    await issue(res, u, version);
    await audit(u, "auth.login", `${u.name} signed in`);
    res.json(u);
  });

  r.post("/logout", (_req, res) => {
    res.clearCookie(COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  r.get("/me", (req, res) => {
    const me = req.user ?? req.portalClient;
    if (!me) throw new HttpError(401, "Please sign in");
    res.json(me);
  });

  return r;
}

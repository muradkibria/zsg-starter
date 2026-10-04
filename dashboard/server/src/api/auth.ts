// Dashboard sign-in. Each person has their own six-digit code (`users.login_code`,
// unique); the API checks it and issues its own short-lived session cookie
// (httpOnly, SameSite=Lax). The cookie carries the person's session version, which
// moves on whenever they get a new code, so that signs them out everywhere else.

import { randomBytes } from "node:crypto";
import type { NextFunction, Request, Response, Router } from "express";
import express from "express";
import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import type { Role, SessionUser } from "@digilite/shared";
import { config } from "../config";
import { audit } from "../domain/audit";
import { randomCode, SignInGate } from "../domain/signin";
import { logger } from "../log";
import { getFirst, getOneOrNull, pb, q, type RecordModel } from "../pb";
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

/** A code nobody on the team has. */
export async function unusedCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = randomCode();
    if (!(await getFirst<RecordModel>("users", `login_code = ${q(code)}`, { fields: "id" }))) return code;
  }
  throw new HttpError(500, "Couldn't find a free code. Try again.");
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

async function issue(res: Response, u: SessionUser, version: number) {
  const token = await new SignJWT({ sub: u.id, sv: version })
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

/** Attaches req.user when a valid session cookie is present. */
export async function sessionMiddleware(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE];
  if (!token) return next();
  try {
    const { payload } = await jwtVerify(token, secret);
    const known = payload.sub ? await loadUser(payload.sub) : null;
    const version = typeof payload.sv === "number" ? payload.sv : 0;
    if (known && known.version === version) req.user = known.user;
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
    if (!rec) {
      gate.wrong(address);
      log.warn(`wrong sign-in code from ${address}`);
      throw new HttpError(401, "That code isn't right");
    }
    gate.right(address);
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
    if (!req.user) throw new HttpError(401, "Please sign in");
    res.json(req.user);
  });

  return r;
}

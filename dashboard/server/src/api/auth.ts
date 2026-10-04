// Dashboard sign-in. Passwords are checked against PocketBase `users`; the API
// then issues its own short-lived session cookie (httpOnly, SameSite=Lax).

import type { NextFunction, Request, Response, Router } from "express";
import express from "express";
import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import type { Role, SessionUser } from "@digilite/shared";
import { config } from "../config";
import { audit } from "../domain/audit";
import { getOneOrNull, pb, userClient, type RecordModel } from "../pb";
import { HttpError, parse } from "./http";

const COOKIE = "dl_session";
const secret = config.sessionKey;
const TTL_HOURS = 12;

/** A signed-in person plus their session version (bumped when their password changes). */
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

/**
 * Update a password and end every other session of that person: their session
 * version moves on, so older cookies stop working. Pass `res` to keep the
 * current browser signed in (someone changing their own password).
 */
export async function setPassword(userId: string, password: string, keepSignedIn?: { res: Response; user: SessionUser }) {
  const rec = await pb.collection("users").update<RecordModel>(userId, {
    password,
    passwordConfirm: password,
    "session_version+": 1,
  });
  forgetUser(userId);
  if (keepSignedIn) await issue(keepSignedIn.res, keepSignedIn.user, rec.session_version || 0);
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

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

// Simple in-memory throttle: 10 attempts per 10 minutes per email+IP (relaxed in development).
const attempts = new Map<string, number[]>();
const MAX_ATTEMPTS = config.isProd ? 10 : 500;
function throttle(key: string) {
  const now = Date.now();
  const list = (attempts.get(key) ?? []).filter((t) => now - t < 10 * 60000);
  if (list.length >= MAX_ATTEMPTS) throw new HttpError(429, "Too many attempts. Try again in a few minutes.");
  list.push(now);
  attempts.set(key, list);
}

export function authRouter(): Router {
  const r = express.Router();

  r.post("/login", async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    throttle(`${email.toLowerCase()}|${req.ip}`);
    let rec: RecordModel;
    try {
      const auth = await userClient().collection("users").authWithPassword(email, password);
      rec = auth.record;
    } catch {
      throw new HttpError(401, "That email and password don't match");
    }
    if (rec.disabled) throw new HttpError(403, "This account has been switched off");
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

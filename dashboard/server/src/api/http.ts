// Express helpers: typed errors, validation, role checks.

import type { NextFunction, Request, Response } from "express";
import { can, type Permission, type SessionUser } from "@digilite/shared";
import { z } from "zod";
import { ClientResponseError } from "pocketbase";
import { WriteBlockedError } from "../colorlight/gate";
import { logger } from "../log";

const log = logger("api");

export class HttpError extends Error {
  constructor(public status: number, message: string, public detail?: string) {
    super(message);
  }
}

export const notFound = (what = "Not found") => new HttpError(404, what);
export const badRequest = (msg: string, detail?: string) => new HttpError(400, msg, detail);
export const forbidden = (msg = "You don't have permission to do that") => new HttpError(403, msg);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

/** A route param as a single string (Express 5 types params as string | string[]). */
export function param(req: Request, name: string): string {
  const v = (req.params as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export function user(req: Request): SessionUser {
  if (!req.user) throw new HttpError(401, "Please sign in");
  return req.user;
}

/** Route guard: the signed-in user must hold the permission. */
export function need(p: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, "Please sign in"));
    if (!can(req.user.role, p)) return next(forbidden());
    next();
  };
}

/** "lifecycleNote: Too big: …" → "lifecycle note: too big: …" (shown to users). */
function readableIssue(issue: z.core.$ZodIssue): string {
  const field = issue.path
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase())
    .join(" › ");
  const message = issue.message.charAt(0).toLowerCase() + issue.message.slice(1);
  return field ? `${field}: ${message}` : message;
}

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const first = r.error.issues[0];
    throw badRequest(`Some details aren't right${first ? ` (${readableIssue(first)})` : ""}`, z.prettifyError(r.error));
  }
  return r.data;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, detail: err.detail });
    return;
  }
  if (err instanceof WriteBlockedError) {
    res.status(403).json({ error: err.message });
    return;
  }
  if (err instanceof ClientResponseError) {
    const status = err.status === 404 ? 404 : err.status === 400 ? 400 : 502;
    log.warn(`database error ${err.status}: ${err.message}`, JSON.stringify(err.response?.data ?? {}));
    res.status(status).json({ error: status === 404 ? "Not found" : "The database rejected that change", detail: err.message });
    return;
  }
  log.error("unexpected error", err);
  res.status(500).json({ error: "Something went wrong on our side" });
}

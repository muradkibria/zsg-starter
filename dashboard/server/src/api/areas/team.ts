// team area routes (mounted under /api). Owned by the team feature.
//
//   GET   /team                       everyone with a login               team.edit (owner)
//   POST  /team                       add someone; temporary password     team.edit
//   PATCH /team/:id                   rename, change role, switch off/on  team.edit
//   POST  /team/:id/reset-password    new temporary password              team.edit
//   POST  /team/me/password           change your own password            any signed-in user
//
// Temporary passwords are returned once in the response and never logged or
// stored in plain text (PocketBase keeps only a hash).

import express, { type Response, type Router } from "express";
import { z } from "zod";
import { PASSWORD_MIN_LENGTH, ROLE_LABEL, type TeamPasswordResult } from "@digilite/shared";
import { audit } from "../../domain/audit";
import { listTeam, loadTeamUsers, teamChangeProblem, tempPassword, toTeamMember } from "../../domain/team";
import { getOneOrNull, pb, userClient, type RecordModel } from "../../pb";
import { forgetUser, setPassword } from "../auth";
import { badRequest, HttpError, need, notFound, param, parse, user } from "../http";

const role = z.enum(["owner", "ops", "sales", "viewer"]);
const inviteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  role,
});
const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: role.optional(),
  disabled: z.boolean().optional(),
});
const passwordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(200),
});

/** Responses that carry a password must never be cached anywhere. */
function noStore(res: Response) {
  res.setHeader("Cache-Control", "no-store");
}

// Changing your own password checks the current one: allow 8 tries per 10 minutes.
const tries = new Map<string, number[]>();
function throttle(userId: string) {
  const now = Date.now();
  const list = (tries.get(userId) ?? []).filter((t) => now - t < 10 * 60_000);
  if (list.length >= 8) throw new HttpError(429, "Too many attempts. Try again in a few minutes.");
  list.push(now);
  tries.set(userId, list);
}

export function teamRouter(): Router {
  const r = express.Router();

  r.get("/team", need("team.edit"), async (_req, res) => {
    res.json(await listTeam());
  });

  r.post("/team", need("team.edit"), async (req, res) => {
    const body = parse(inviteSchema, req.body);
    const users = await loadTeamUsers();
    if (users.some((u) => String(u.email).toLowerCase() === body.email)) throw badRequest("Someone on the team already uses that email");
    const password = tempPassword();
    const rec = await pb.collection("users").create<RecordModel>({
      email: body.email,
      name: body.name,
      role: body.role,
      disabled: false,
      verified: true,
      emailVisibility: false,
      password,
      passwordConfirm: password,
    });
    forgetUser(rec.id);
    await audit(user(req), "team.invite", `Added ${body.name} to the team as ${ROLE_LABEL[body.role]}`, { type: "user", id: rec.id });
    noStore(res);
    const out: TeamPasswordResult = { member: toTeamMember(rec, null), tempPassword: password };
    res.status(201).json(out);
  });

  r.patch("/team/:id", need("team.edit"), async (req, res) => {
    const me = user(req);
    const body = parse(patchSchema, req.body);
    const users = await loadTeamUsers();
    const target = users.find((u) => u.id === param(req, "id"));
    if (!target) throw notFound("That person isn't on the team");
    const problem = teamChangeProblem(
      users.map((u) => ({ id: u.id, role: u.role, disabled: !!u.disabled })),
      me.id,
      target.id,
      body,
    );
    if (problem) throw badRequest(problem);

    const update: Record<string, unknown> = {};
    const notes: { action: string; summary: string }[] = [];
    const name = body.name ?? target.name ?? target.email;
    if (body.name !== undefined && body.name !== target.name) {
      update.name = body.name;
      notes.push({ action: "team.rename", summary: `Renamed ${target.name || target.email} to ${body.name}` });
    }
    if (body.role !== undefined && body.role !== target.role) {
      update.role = body.role;
      notes.push({ action: "team.role", summary: `${name} is now ${ROLE_LABEL[body.role]} (was ${ROLE_LABEL[target.role as keyof typeof ROLE_LABEL] ?? target.role})` });
    }
    if (body.disabled !== undefined && body.disabled !== !!target.disabled) {
      update.disabled = body.disabled;
      notes.push(
        body.disabled
          ? { action: "team.disable", summary: `Switched off ${name}'s login` }
          : { action: "team.enable", summary: `Switched ${name}'s login back on` },
      );
    }
    if (!Object.keys(update).length) {
      const [member] = (await listTeam()).filter((m) => m.id === target.id);
      return void res.json(member);
    }
    await pb.collection("users").update(target.id, update);
    forgetUser(target.id);
    for (const n of notes) await audit(me, n.action, n.summary, { type: "user", id: target.id });
    const [member] = (await listTeam()).filter((m) => m.id === target.id);
    res.json(member);
  });

  r.post("/team/:id/reset-password", need("team.edit"), async (req, res) => {
    const me = user(req);
    const target = await getOneOrNull<RecordModel>("users", param(req, "id"));
    if (!target) throw notFound("That person isn't on the team");
    if (target.id === me.id) throw badRequest("Use “Change your password” for your own login");
    const password = tempPassword();
    await setPassword(target.id, password);
    await audit(me, "team.reset_password", `Reset ${target.name || target.email}'s password`, { type: "user", id: target.id });
    noStore(res);
    const [member] = (await listTeam()).filter((m) => m.id === target.id);
    const out: TeamPasswordResult = { member, tempPassword: password };
    res.json(out);
  });

  r.post("/team/me/password", async (req, res) => {
    const me = user(req);
    const body = parse(passwordSchema, req.body);
    throttle(me.id);
    const rec = await getOneOrNull<RecordModel>("users", me.id);
    if (!rec || rec.disabled) throw new HttpError(401, "Please sign in");
    try {
      await userClient().collection("users").authWithPassword(rec.email, body.currentPassword);
    } catch {
      throw badRequest("Your current password isn't right");
    }
    if (body.newPassword === body.currentPassword) throw badRequest("Pick a new password that's different from the current one");
    await setPassword(me.id, body.newPassword, { res, user: me });
    await audit(me, "team.password", `${me.name} changed their password`, { type: "user", id: me.id });
    res.json({ ok: true });
  });

  return r;
}

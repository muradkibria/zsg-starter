// team area routes (mounted under /api). Owned by the team feature.
//
//   GET   /team                   everyone with a login               team.edit (owner)
//   POST  /team                   add someone; returns their code     team.edit
//   PATCH /team/:id               rename, change role, switch off/on  team.edit
//   POST  /team/:id/new-code      a new code for someone              team.edit
//   POST  /team/me/new-code       a new code for yourself             any signed-in user
//
// Everyone signs in with their own six-digit code. Codes are made here at random:
// nobody picks one, so nobody can find someone else's by trying codes that are
// "taken". A code is returned once and never logged.

import express, { type Response, type Router } from "express";
import { z } from "zod";
import { ROLE_LABEL, type TeamCodeResult } from "@digilite/shared";
import { audit } from "../../domain/audit";
import { listTeam, loadTeamUsers, teamChangeProblem, toTeamMember } from "../../domain/team";
import { getOneOrNull, pb, type RecordModel } from "../../pb";
import { forgetUser, setCode, unusedCode, unusedPassword } from "../auth";
import { badRequest, need, notFound, param, parse, user } from "../http";

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

/** Responses that carry a code must never be cached anywhere. */
function noStore(res: Response) {
  res.setHeader("Cache-Control", "no-store");
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
    const code = await unusedCode();
    const password = unusedPassword();
    const rec = await pb.collection("users").create<RecordModel>({
      email: body.email,
      name: body.name,
      role: body.role,
      disabled: false,
      verified: true,
      emailVisibility: false,
      password,
      passwordConfirm: password,
      login_code: code,
    });
    forgetUser(rec.id);
    await audit(user(req), "team.invite", `Added ${body.name} to the team as ${ROLE_LABEL[body.role]}`, { type: "user", id: rec.id });
    noStore(res);
    const out: TeamCodeResult = { member: toTeamMember(rec, null), code };
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

  // Before /team/:id/new-code, which would otherwise take "me" for an id.
  r.post("/team/me/new-code", async (req, res) => {
    const me = user(req);
    const code = await unusedCode();
    const rec = await setCode(me.id, code, { res, user: me });
    await audit(me, "team.code", `${me.name} got a new sign-in code`, { type: "user", id: me.id });
    noStore(res);
    const out: TeamCodeResult = { member: toTeamMember(rec, null), code };
    res.json(out);
  });

  r.post("/team/:id/new-code", need("team.edit"), async (req, res) => {
    const me = user(req);
    const target = await getOneOrNull<RecordModel>("users", param(req, "id"));
    if (!target) throw notFound("That person isn't on the team");
    if (target.id === me.id) throw badRequest("Use “Get a new code” under Your sign-in code for your own");
    const code = await unusedCode();
    await setCode(target.id, code);
    await audit(me, "team.new_code", `Gave ${target.name || target.email} a new sign-in code`, { type: "user", id: target.id });
    noStore(res);
    const [member] = (await listTeam()).filter((m) => m.id === target.id);
    const out: TeamCodeResult = { member, code };
    res.json(out);
  });

  return r;
}

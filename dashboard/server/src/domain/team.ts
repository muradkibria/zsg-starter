// Dashboard logins: listing the team and the rules that keep at least one owner
// able to sign in. Sign-in codes themselves are in api/auth.ts and domain/signin.ts.

import type { Role, TeamMember } from "@digilite/shared";
import { getAll, getFirst, parsePbDate, q, type RecordModel } from "../pb";

export interface TeamUserLite {
  id: string;
  role: Role;
  disabled: boolean;
}

/**
 * Why a change to someone's login isn't allowed, or null when it is.
 * You can't switch off or change the role of your own login, and there must
 * always be at least one owner who can sign in.
 */
export function teamChangeProblem(
  users: TeamUserLite[],
  actorId: string,
  targetId: string,
  patch: { role?: Role; disabled?: boolean },
): string | null {
  const target = users.find((u) => u.id === targetId);
  if (!target) return "That person isn't on the team";
  const roleChange = patch.role !== undefined && patch.role !== target.role;
  const switchingOff = patch.disabled === true && !target.disabled;
  if (targetId === actorId) {
    if (roleChange) return "You can't change your own role. Another owner can.";
    if (switchingOff) return "You can't switch off your own login.";
  }
  const losesOwner = target.role === "owner" && !target.disabled && ((roleChange && patch.role !== "owner") || switchingOff);
  if (losesOwner && !users.some((u) => u.id !== targetId && u.role === "owner" && !u.disabled)) {
    return "There must always be at least one owner who can sign in. Make someone else an owner first.";
  }
  return null;
}

export function toTeamMember(r: RecordModel, lastSignInAt: string | null): TeamMember {
  return {
    id: r.id,
    name: r.name || r.email,
    email: r.email,
    role: (r.role || "viewer") as Role,
    disabled: !!r.disabled,
    // Whether there is one, never the code itself.
    hasCode: !!r.login_code,
    created: parsePbDate(r.created)?.toISOString() ?? new Date(0).toISOString(),
    lastSignInAt,
  };
}

async function lastSignIn(userId: string): Promise<string | null> {
  const row = await getFirst<RecordModel>("audit_log", `action = "auth.login" && actor = ${q(userId)}`, { sort: "-created", fields: "created" });
  return parsePbDate(row?.created)?.toISOString() ?? null;
}

export async function loadTeamUsers(): Promise<RecordModel[]> {
  return getAll<RecordModel>("users", { sort: "created", fields: "id,email,name,role,disabled,login_code,created" });
}

export async function listTeam(): Promise<TeamMember[]> {
  const users = await loadTeamUsers();
  const seen = await Promise.all(users.map((u) => lastSignIn(u.id)));
  const order: Record<Role, number> = { owner: 0, ops: 1, sales: 2, viewer: 3 };
  return users
    .map((u, i) => toTeamMember(u, seen[i]))
    .sort((a, b) => Number(a.disabled) - Number(b.disabled) || order[a.role] - order[b.role] || a.name.localeCompare(b.name));
}

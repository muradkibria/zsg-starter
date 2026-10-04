// Contracts for the team area: dashboard logins, roles and passwords.

import type { Permission, Role } from "../status";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: Role;
  disabled: boolean;
  /** ISO time the login was created */
  created: string;
  /** ISO time of the last sign-in (from the audit log), if any */
  lastSignInAt: string | null;
}

/** POST /team */
export interface TeamInviteRequest {
  name: string;
  email: string;
  role: Role;
}

/** PATCH /team/:id */
export interface TeamPatch {
  name?: string;
  role?: Role;
  disabled?: boolean;
}

/** POST /team and POST /team/:id/reset-password. The password is shown once and never stored in plain text. */
export interface TeamPasswordResult {
  member: TeamMember;
  tempPassword: string;
}

/** POST /team/me/password */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export const PASSWORD_MIN_LENGTH = 10;

export const ROLES: Role[] = ["owner", "ops", "sales", "viewer"];

/** What each role is for, in plain English. */
export const ROLE_SUMMARY: Record<Role, string> = {
  owner: "Everything, including settings and the team.",
  ops: "Everything except settings and the team.",
  sales: "Campaigns, client reports, loops and exports. No rider documents.",
  viewer: "Can look, can't change.",
};

/** Plain-English rows for the "what each role can do" table. Each row is allowed when the role has any of its permissions. */
export const PERMISSION_ROWS: { label: string; perms: Permission[] }[] = [
  { label: "See the map, bags and routes", perms: ["fleet.view"] },
  { label: "Change bags (brightness, restart, loops)", perms: ["bags.control", "loops.publish"] },
  { label: "See riders and their hours", perms: ["riders.view"] },
  { label: "Open rider documents", perms: ["riders.documents"] },
  { label: "Edit ads, loops and schedules", perms: ["loops.edit", "schedules.edit"] },
  { label: "Campaigns and client reports", perms: ["campaigns.view", "campaigns.edit"] },
  { label: "Payroll", perms: ["payroll.view", "payroll.approve"] },
  { label: "Exports", perms: ["exports.run"] },
  { label: "Edit zones", perms: ["zones.edit"] },
  { label: "Read the audit log", perms: ["audit.view"] },
  { label: "Change settings", perms: ["settings.edit"] },
  { label: "Manage the team", perms: ["team.edit"] },
];

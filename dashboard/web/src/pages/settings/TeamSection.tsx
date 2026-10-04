// Team & roles: who can sign in, what each role can do, and your sign-in code.

import { useState, type FormEvent } from "react";
import clsx from "clsx";
import { Check, Copy, KeyRound, Minus, Power, UserPlus } from "lucide-react";
import {
  PERMISSION_ROWS,
  ROLE_LABEL,
  ROLE_PERMISSIONS,
  ROLE_SUMMARY,
  ROLES,
  type Role,
  type TeamCodeResult,
  type TeamMember,
} from "@digilite/shared";
import { useFeedback } from "@/components/feedback";
import { Avatar, Button, Card, CardHeader, ErrorState, Field, Input, Notice, Pill, Select, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { when } from "@/lib/format";
import { useInvite, useNewCode, useNewOwnCode, useTeam, useUpdateMember } from "./api";
import { Modal } from "./Modal";

export function TeamSection() {
  const { can, user } = useAuth();
  const owner = can("team.edit");
  return (
    <div className="flex flex-col gap-5">
      {owner ? <TeamList /> : user && <YourAccount />}
      <RolesTable />
      <CodeCard />
    </div>
  );
}

// ── The team (owner) ──────────────────────────────────────────────────────────
function TeamList() {
  const { user } = useAuth();
  const { confirm, toast } = useFeedback();
  const team = useTeam(true);
  const invite = useInvite();
  const updateMember = useUpdateMember();
  const newCode = useNewCode();
  const [adding, setAdding] = useState(false);
  const [reveal, setReveal] = useState<{ result: TeamCodeResult; kind: "new" | "reset" } | null>(null);
  const [renaming, setRenaming] = useState<TeamMember | null>(null);

  const changeRole = async (m: TeamMember, role: Role) => {
    if (role === m.role) return;
    if (role === "owner") {
      const ok = await confirm({
        title: `Make ${m.name} an owner?`,
        body: "Owners can change every setting, the team and the switch that allows changes to the whole fleet.",
        confirm: "Make owner",
      });
      if (!ok) return;
    }
    try {
      await updateMember.mutateAsync({ id: m.id, patch: { role } });
      toast(`${m.name} is now ${ROLE_LABEL[role]}`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const setDisabled = async (m: TeamMember, disabled: boolean) => {
    if (disabled) {
      const ok = await confirm({
        title: `Switch off ${m.name}'s login?`,
        body: "They're signed out straight away and can't sign in until you switch it back on. Their name stays on everything they did.",
        confirm: "Switch off",
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await updateMember.mutateAsync({ id: m.id, patch: { disabled } });
      toast(disabled ? `${m.name} can no longer sign in` : `${m.name} can sign in again`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const giveNewCode = async (m: TeamMember) => {
    const ok = await confirm({
      title: m.hasCode ? `Give ${m.name} a new code?` : `Give ${m.name} a code?`,
      body: m.hasCode
        ? "Their current code stops working and they're signed out. You'll see the new one once, to pass on."
        : "You'll see it once, to pass on.",
      confirm: m.hasCode ? "New code" : "Make a code",
      danger: m.hasCode,
    });
    if (!ok) return;
    try {
      setReveal({ result: await newCode.mutateAsync(m.id), kind: "reset" });
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const members = team.data ?? [];
  const active = members.filter((m) => !m.disabled).length;

  return (
    <Card className="flex flex-col gap-4 p-4 md:p-5" aria-label="Team">
      <CardHeader
        title="Team & roles"
        sub={team.data ? `${active} ${active === 1 ? "person" : "people"} can sign in${members.length > active ? ` · ${members.length - active} switched off` : ""}` : undefined}
        action={
          !adding && (
            <Button size="sm" icon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>
              Add someone
            </Button>
          )
        }
      />

      {adding && (
        <InviteForm
          busy={invite.isPending}
          onCancel={() => setAdding(false)}
          onSubmit={async (body) => {
            try {
              const result = await invite.mutateAsync(body);
              setAdding(false);
              setReveal({ result, kind: "new" });
            } catch (e) {
              toast((e as Error).message, "error");
            }
          }}
        />
      )}

      {team.isLoading && <Spinner label="Loading the team…" />}
      {team.error && <ErrorState error={team.error} retry={() => void team.refetch()} />}

      <ul className="m-0 flex list-none flex-col p-0">
        {members.map((m) => {
          const you = m.id === user?.id;
          return (
            <li key={m.id} className="flex flex-col gap-3 border-b border-rule-soft py-3 last:border-b-0 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Avatar name={m.name} size={36} className={clsx(m.disabled && "opacity-50")} />
                <div className="flex min-w-0 flex-col">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className={clsx("truncate text-sm font-semibold", m.disabled && "text-muted line-through decoration-1")}>{m.name}</span>
                    {you && <Pill tone="info">You</Pill>}
                    {m.disabled && <Pill tone="red">Switched off</Pill>}
                    {!m.disabled && !m.hasCode && <Pill tone="amber">No code</Pill>}
                  </span>
                  <span className="truncate text-xs text-muted">{m.email}</span>
                  <span className="text-[11px] text-caption">
                    {you ? "Signed in now" : m.lastSignInAt ? `Last signed in ${when(m.lastSignInAt)}` : "Hasn't signed in yet"}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-12 sm:pl-0">
                <label className="sr-only" htmlFor={`role-${m.id}`}>
                  Role for {m.name}
                </label>
                <Select
                  id={`role-${m.id}`}
                  value={m.role}
                  disabled={you || updateMember.isPending}
                  title={you ? "You can't change your own role" : undefined}
                  onChange={(e) => void changeRole(m, e.target.value as Role)}
                  className="h-9 max-w-[160px] text-[13px]"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </Select>
                <Button size="sm" variant="ghost" onClick={() => setRenaming(m)}>
                  Rename
                </Button>
                {!you && (
                  <>
                    {!m.disabled && (
                      <Button size="sm" variant="ghost" icon={<KeyRound className="size-3.5" />} onClick={() => void giveNewCode(m)} disabled={newCode.isPending}>
                        {m.hasCode ? "New code" : "Give a code"}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant={m.disabled ? "secondary" : "danger"}
                      icon={<Power className="size-3.5" />}
                      onClick={() => void setDisabled(m, !m.disabled)}
                      disabled={updateMember.isPending}
                    >
                      {m.disabled ? "Switch on" : "Switch off"}
                    </Button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {reveal && <CodeReveal result={reveal.result} kind={reveal.kind} onClose={() => setReveal(null)} />}
      {renaming && (
        <RenameDialog
          member={renaming}
          busy={updateMember.isPending}
          onClose={() => setRenaming(null)}
          onSave={async (name) => {
            try {
              await updateMember.mutateAsync({ id: renaming.id, patch: { name } });
              toast(`Renamed to ${name}`);
              setRenaming(null);
            } catch (e) {
              toast((e as Error).message, "error");
            }
          }}
        />
      )}
    </Card>
  );
}

function InviteForm({ busy, onCancel, onSubmit }: { busy: boolean; onCancel: () => void; onSubmit: (b: { name: string; email: string; role: Role }) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("ops");
  const [error, setError] = useState<{ name?: string; email?: string }>({});
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: typeof error = {};
    if (!name.trim()) errs.name = "Add their name";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errs.email = "Add a valid email address";
    setError(errs);
    if (!errs.name && !errs.email) onSubmit({ name: name.trim(), email: email.trim(), role });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-rule bg-paper p-4" aria-label="Add someone">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" error={error.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={120} autoComplete="off" />
        </Field>
        <Field label="Email" error={error.email}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} autoComplete="off" />
        </Field>
      </div>
      <Field label="Role" hint={ROLE_SUMMARY[role]}>
        <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </Select>
      </Field>
      <p className="m-0 text-xs text-muted">We'll make a six-digit sign-in code for them. You'll see it once, to pass on privately.</p>
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          Add and make a code
        </Button>
      </div>
    </form>
  );
}

function CodeReveal({ result, kind, onClose }: { result: TeamCodeResult; kind: "new" | "reset" | "self"; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };
  const title = kind === "self" ? "Your new code" : kind === "new" ? `${result.member.name} can now sign in` : `New code for ${result.member.name}`;
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <p className="m-0">
        {kind === "self"
          ? "Use it next time you sign in. Your old code has stopped working, and you're signed out everywhere else."
          : `Give ${result.member.name} this code. It's all they need to sign in.`}
      </p>
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-line bg-paper p-2 pl-3">
        <code className="num min-w-0 flex-1 truncate font-mono text-[22px] font-semibold tracking-[0.3em] text-ink" aria-label="Sign-in code">
          {result.code}
        </code>
        <Button size="sm" variant={copied ? "secondary" : "primary"} onClick={() => void copy()} icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} data-autofocus>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <Notice tone="amber">
        <span className="block pt-0.5">
          {kind === "self" ? "This is the only time it's shown." : "This is the only time it's shown. Share it privately, not in a group chat."}
        </span>
      </Notice>
    </Modal>
  );
}

function RenameDialog({ member, busy, onClose, onSave }: { member: TeamMember; busy: boolean; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(member.name);
  const valid = name.trim().length > 0 && name.trim() !== member.name;
  return (
    <Modal
      title={`Rename ${member.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!valid} loading={busy} onClick={() => onSave(name.trim())}>
            Save name
          </Button>
        </>
      }
    >
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} onKeyDown={(e) => e.key === "Enter" && valid && onSave(name.trim())} />
      </Field>
    </Modal>
  );
}

// ── Everyone else ─────────────────────────────────────────────────────────────
function YourAccount() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <Card className="flex flex-col gap-3 p-4 md:p-5" aria-label="Your account">
      <CardHeader title="Your account" />
      <div className="flex items-center gap-3">
        <Avatar name={user.name} size={40} />
        <div className="min-w-0">
          <div className="text-sm font-semibold">{user.name}</div>
          <div className="truncate text-xs text-muted">{user.email}</div>
        </div>
        <Pill tone="navy" className="ml-auto">
          {ROLE_LABEL[user.role]}
        </Pill>
      </div>
      <p className="m-0 text-[13px] text-ink-2">{ROLE_SUMMARY[user.role]}</p>
      <p className="m-0 text-xs text-muted">Only the owner can add people, change roles or switch logins off.</p>
    </Card>
  );
}

// ── What each role can do ─────────────────────────────────────────────────────
function RolesTable() {
  const { user } = useAuth();
  const short: Record<Role, string> = { owner: "Owner", ops: "Ops", sales: "Sales", viewer: "Read-only" };
  return (
    <Card className="flex flex-col gap-3 p-4 md:p-5" aria-label="What each role can do">
      <CardHeader title="What each role can do" />
      <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
        {ROLES.map((r) => (
          <li key={r} className={clsx("rounded-xl px-3 py-2.5", user?.role === r ? "bg-tint-2 ring-1 ring-accent/30" : "bg-paper")}>
            <div className="text-[13px] font-bold">
              {ROLE_LABEL[r]}
              {user?.role === r && <span className="ml-1.5 font-medium text-muted">· you</span>}
            </div>
            <div className="text-xs text-ink-2">{ROLE_SUMMARY[r]}</div>
          </li>
        ))}
      </ul>
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <table className="w-full min-w-[340px] border-collapse text-[13px]">
          <thead>
            <tr className="text-xs text-muted">
              <th className="py-1.5 pr-2 text-left font-semibold">Can…</th>
              {ROLES.map((r) => (
                <th key={r} scope="col" className="w-[58px] px-1 py-1.5 text-center font-semibold">
                  {short[r]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_ROWS.map((row) => (
              <tr key={row.label} className="border-t border-rule-soft">
                <th scope="row" className="py-1.5 pr-2 text-left font-normal text-ink">
                  {row.label}
                </th>
                {ROLES.map((r) => {
                  const yes = row.perms.some((p) => ROLE_PERMISSIONS[r].includes(p));
                  return (
                    <td key={r} className="py-1.5 text-center">
                      <span
                        className={clsx("inline-flex size-5 items-center justify-center rounded-full", yes ? "bg-navy text-white" : "bg-paper-2 text-caption")}
                        aria-label={`${ROLE_LABEL[r]}: ${yes ? "yes" : "no"}`}
                        role="img"
                      >
                        {yes ? <Check className="size-3" strokeWidth={3} /> : <Minus className="size-3" strokeWidth={3} />}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── Your code ─────────────────────────────────────────────────────────────────
function CodeCard() {
  const { confirm, toast } = useFeedback();
  const change = useNewOwnCode();
  const [reveal, setReveal] = useState<TeamCodeResult | null>(null);
  const getNew = async () => {
    const ok = await confirm({
      title: "Get a new code?",
      body: "Your current code stops working, and you're signed out everywhere except here.",
      confirm: "Get a new code",
      danger: true,
    });
    if (!ok) return;
    try {
      setReveal(await change.mutateAsync());
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  return (
    <Card className="flex flex-col gap-3 p-4 md:p-5" aria-label="Your sign-in code">
      <CardHeader title="Your sign-in code" sub="Six digits, yours alone. Get a new one if someone may have seen it." />
      <div>
        <Button icon={<KeyRound className="size-4" />} loading={change.isPending} onClick={() => void getNew()}>
          Get a new code
        </Button>
      </div>
      {reveal && <CodeReveal result={reveal} kind="self" onClose={() => setReveal(null)} />}
    </Card>
  );
}

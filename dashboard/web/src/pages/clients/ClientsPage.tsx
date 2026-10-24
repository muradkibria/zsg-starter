// Clients: advertisers who sign in to the client portal with their own six-digit
// code to see their campaigns and download their reports. Here the team adds
// them, chooses which campaigns their portal shows, gives them a code (shown
// once) and switches them off.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import clsx from "clsx";
import { Building2, Check, Copy, KeyRound, Pencil, Plus, Power } from "lucide-react";
import type { CampaignSummary, ClientAccount, ClientCodeResult } from "@digilite/shared";
import { useFeedback } from "@/components/feedback";
import { Button, Card, EmptyState, ErrorState, Field, Input, Notice, Page, PageHeader, Pill, Spinner } from "@/components/ui";
import { when } from "@/lib/format";
import { useCampaigns } from "../campaigns/api";
import { dayRange } from "../campaigns/format";
import { Modal } from "../settings/Modal";
import { useAddClient, useClients, useNewClientCode, useUpdateClient } from "./api";

const signInUrl = () => `${window.location.origin}/login`;

export default function ClientsPage() {
  const { confirm, toast } = useFeedback();
  const clients = useClients();
  const campaigns = useCampaigns();
  const add = useAddClient();
  const update = useUpdateClient();
  const newCode = useNewClientCode();
  const [params] = useSearchParams();
  const [editing, setEditing] = useState<ClientAccount | "new" | null>(null);
  const [reveal, setReveal] = useState<{ result: ClientCodeResult; kind: "new" | "reset" } | null>(null);
  const focus = params.get("client");

  useEffect(() => {
    if (focus) document.getElementById(`client-${focus}`)?.scrollIntoView({ block: "center" });
  }, [focus, clients.data]);

  const list = clients.data ?? [];
  const active = list.filter((c) => !c.disabled).length;

  const giveNewCode = async (c: ClientAccount) => {
    const ok = await confirm({
      title: c.hasCode ? `Give ${c.name} a new code?` : `Give ${c.name} a code?`,
      body: c.hasCode
        ? "Their current code will stop working and they'll be signed out of the portal. The new code is shown once so you can send it to them."
        : "The code is shown once so you can send it to them.",
      confirm: c.hasCode ? "New code" : "Make a code",
      danger: c.hasCode,
    });
    if (!ok) return;
    try {
      setReveal({ result: await newCode.mutateAsync(c.id), kind: "reset" });
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const setDisabled = async (c: ClientAccount, disabled: boolean) => {
    if (disabled) {
      const ok = await confirm({
        title: `Switch off ${c.name}'s portal?`,
        body: "They will be signed out and won't be able to sign in until you switch their access back on. Their campaigns and reports stay as they are.",
        confirm: "Switch off",
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await update.mutateAsync({ id: c.id, patch: { disabled } });
      toast(disabled ? `${c.name} can no longer sign in` : `${c.name} can sign in again`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <Page width="narrow">
      <PageHeader
        title="Clients"
        sub="Advertisers who sign in to the client portal with their own six-digit code, to see their campaigns and download their reports."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
            Add a client
          </Button>
        }
      />

      <Notice tone="info">
        <span className="block pt-0.5">
          Clients sign in on the same page as the team, <strong>{signInUrl()}</strong>, and see only the confirmed campaigns linked to them: plays, time on
          screen, estimated impressions and their reports. They can't see riders, routes or other advertisers' campaigns.
        </span>
      </Notice>

      {clients.isLoading && <Spinner label="Loading clients…" />}
      {clients.error && <ErrorState error={clients.error} retry={() => void clients.refetch()} />}
      {clients.data && list.length === 0 && (
        <EmptyState
          icon={<Building2 className="size-6" />}
          title="No clients yet"
          body="Add a client, link their campaigns and pass on their code. They can then see and download their own reports."
          action={
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
              Add a client
            </Button>
          }
        />
      )}

      {list.length > 0 && (
        <Card className="flex flex-col p-4 md:p-5" aria-label="Clients">
          <p className="m-0 mb-1 text-[13px] text-muted">
            {active} {active === 1 ? "client" : "clients"} can sign in{list.length > active ? ` · ${list.length - active} switched off` : ""}
          </p>
          <ul className="m-0 flex list-none flex-col p-0">
            {list.map((c) => (
              <li
                key={c.id}
                id={`client-${c.id}`}
                className={clsx("flex flex-col gap-3 border-b border-rule-soft py-4 last:border-b-0", focus === c.id && "-mx-2 rounded-xl bg-tint-2 px-2")}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className={clsx("text-[15px] font-semibold", c.disabled && "text-muted line-through decoration-1")}>{c.name}</span>
                      {c.disabled && <Pill tone="red">Switched off</Pill>}
                      {!c.disabled && !c.hasCode && <Pill tone="amber">No code</Pill>}
                    </span>
                    {(c.contactName || c.contactEmail) && (
                      <span className="truncate text-xs text-muted">{[c.contactName, c.contactEmail].filter(Boolean).join(" · ")}</span>
                    )}
                    <span className="text-[11px] text-caption">{c.lastSignInAt ? `Last signed in ${when(c.lastSignInAt)}` : "Hasn't signed in yet"}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(c)}>
                      Edit
                    </Button>
                    {!c.disabled && (
                      <Button size="sm" variant="ghost" icon={<KeyRound className="size-3.5" />} onClick={() => void giveNewCode(c)} disabled={newCode.isPending}>
                        {c.hasCode ? "New code" : "Give a code"}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant={c.disabled ? "secondary" : "danger"}
                      icon={<Power className="size-3.5" />}
                      onClick={() => void setDisabled(c, !c.disabled)}
                      disabled={update.isPending}
                    >
                      {c.disabled ? "Switch on" : "Switch off"}
                    </Button>
                  </div>
                </div>
                <CampaignChips client={c} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {editing && (
        <ClientDialog
          client={editing === "new" ? null : editing}
          clients={list}
          campaigns={campaigns.data?.campaigns ?? []}
          busy={add.isPending || update.isPending}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            try {
              if (editing === "new") {
                const result = await add.mutateAsync(body);
                setEditing(null);
                setReveal({ result, kind: "new" });
              } else {
                await update.mutateAsync({ id: editing.id, patch: body });
                setEditing(null);
                toast(`Saved ${body.name}`);
              }
            } catch (e) {
              toast((e as Error).message, "error");
            }
          }}
        />
      )}
      {reveal && <CodeReveal result={reveal.result} kind={reveal.kind} onClose={() => setReveal(null)} />}
    </Page>
  );
}

function CampaignChips({ client }: { client: ClientAccount }) {
  if (!client.campaigns.length) return <p className="m-0 text-xs text-muted">No campaigns linked yet: their portal is empty.</p>;
  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label={`Campaigns ${client.name} can see`}>
      {client.campaigns.map((c) => (
        <li key={c.id} className="inline-flex items-center gap-1.5 rounded-full bg-paper-2 px-2.5 py-1 text-xs text-ink-2">
          <span className="font-semibold text-ink">{c.name}</span>
          <span>{dayRange(c.startDay, c.endDay)}</span>
          {!c.confirmed && <span className="text-amber-ink">· draft, not shown yet</span>}
        </li>
      ))}
    </ul>
  );
}

interface ClientForm {
  name: string;
  contactName: string;
  contactEmail: string;
  campaignIds: string[];
}

function ClientDialog({
  client,
  clients,
  campaigns,
  busy,
  onClose,
  onSave,
}: {
  client: ClientAccount | null;
  clients: ClientAccount[];
  campaigns: CampaignSummary[];
  busy: boolean;
  onClose: () => void;
  onSave: (body: ClientForm) => void;
}) {
  const [name, setName] = useState(client?.name ?? "");
  const [contactName, setContactName] = useState(client?.contactName ?? "");
  const [contactEmail, setContactEmail] = useState(client?.contactEmail ?? "");
  const [picked, setPicked] = useState<Set<string>>(new Set(client?.campaigns.map((c) => c.id) ?? []));
  const [error, setError] = useState<{ name?: string; email?: string }>({});

  // Who each campaign is linked to now, to say when ticking one moves it.
  const owner = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of clients) for (const x of c.campaigns) m.set(x.id, c.id === client?.id ? "" : c.name);
    return m;
  }, [clients, client]);
  // Suggest the campaigns whose advertiser matches the name first.
  const sorted = useMemo(() => {
    const q = name.trim().toLowerCase();
    const match = (c: CampaignSummary) => (q && c.advertiser.toLowerCase().includes(q) ? 0 : 1);
    return [...campaigns].filter((c) => !c.demo || picked.has(c.id) || match(c) === 0).sort((a, b) => match(a) - match(b) || Number(picked.has(b.id)) - Number(picked.has(a.id)) || (b.startDay ?? "").localeCompare(a.startDay ?? ""));
  }, [campaigns, name, picked]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: typeof error = {};
    if (!name.trim()) errs.name = "Add the client's name";
    if (contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())) errs.email = "Add a valid email address, or leave it empty";
    setError(errs);
    if (!errs.name && !errs.email) onSave({ name: name.trim(), contactName: contactName.trim(), contactEmail: contactEmail.trim(), campaignIds: [...picked] });
  };
  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Modal
      title={client ? `Edit ${client.name}` : "Add a client"}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            {client ? "Save" : "Add and make a code"}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-3" aria-label={client ? "Edit client" : "Add a client"}>
        <Field label="Client name" hint="Shown to them in the portal" error={error.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={200} autoComplete="off" placeholder="e.g. Charity Right" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contact" hint="Optional, for the team">
            <Input value={contactName} onChange={(e) => setContactName(e.target.value)} maxLength={200} autoComplete="off" />
          </Field>
          <Field label="Contact email" hint="Optional" error={error.email}>
            <Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} maxLength={200} autoComplete="off" />
          </Field>
        </div>
        <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
          <legend className="mb-1.5 text-[13px] font-semibold text-ink">Campaigns their portal shows</legend>
          {sorted.length === 0 && <p className="m-0 text-xs text-muted">No campaigns yet. Add one under Campaigns first.</p>}
          <ul className="m-0 flex max-h-[260px] list-none flex-col overflow-y-auto rounded-xl border border-rule p-0">
            {sorted.map((c) => {
              const other = owner.get(c.id);
              return (
                <li key={c.id} className="border-b border-rule-soft last:border-b-0">
                  <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2.5 hover:bg-paper">
                    <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} className="mt-0.5 size-4 accent-navy" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink">
                        {c.advertiser} · {c.name}
                      </span>
                      <span className="block text-xs text-muted">
                        {dayRange(c.startDay, c.endDay)}
                        {!c.confirmed && " · draft: shown once confirmed"}
                        {other && <span className="text-amber-ink">{picked.has(c.id) ? ` · moves from ${other}` : ` · with ${other}`}</span>}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
        {!client && <p className="m-0 text-xs text-muted">A six-digit sign-in code will be created for them. It is shown once, so send it to them directly.</p>}
      </form>
    </Modal>
  );
}

function CodeReveal({ result, kind, onClose }: { result: ClientCodeResult; kind: "new" | "reset"; onClose: () => void }) {
  const [copied, setCopied] = useState<"code" | "both" | null>(null);
  const copy = async (what: "code" | "both") => {
    try {
      await navigator.clipboard.writeText(what === "code" ? result.code : `Sign in to your DigiLite client portal at ${signInUrl()} with this code: ${result.code}`);
      setCopied(what);
      setTimeout(() => setCopied(null), 2500);
    } catch {
      setCopied(null);
    }
  };
  return (
    <Modal
      title={kind === "new" ? `${result.client.name} can now sign in` : `New code for ${result.client.name}`}
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <p className="m-0">
        Give {result.client.name} this code. They sign in at <strong>{signInUrl()}</strong>.
      </p>
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-line bg-paper p-2 pl-3">
        <code className="num min-w-0 flex-1 truncate font-mono text-[22px] font-semibold tracking-[0.3em] text-ink" aria-label="Sign-in code">
          {result.code}
        </code>
        <Button size="sm" variant={copied === "code" ? "secondary" : "primary"} onClick={() => void copy("code")} icon={copied === "code" ? <Check className="size-4" /> : <Copy className="size-4" />} data-autofocus>
          {copied === "code" ? "Copied" : "Copy"}
        </Button>
      </div>
      <Button size="sm" variant="ghost" className="mt-2" onClick={() => void copy("both")} icon={copied === "both" ? <Check className="size-4" /> : <Copy className="size-4" />}>
        {copied === "both" ? "Copied" : "Copy a message with the link and code"}
      </Button>
      <Notice tone="amber">
        <span className="block pt-0.5">This code won't be shown again. Send it to the client directly.</span>
      </Notice>
    </Modal>
  );
}

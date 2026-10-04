// Audit log: every change anyone made, newest first, in plain English.

import { Link, useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, todayLondon, type AuditEntryDto } from "@digilite/shared";
import { Avatar, Button, Card, CardHeader, EmptyState, ErrorState, Select, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { when } from "@/lib/format";
import { PeriodPicker, usePeriod, type PeriodPreset } from "../zones/PeriodPicker";
import { useAudit, useAuditFacets } from "./api";

const PER_PAGE = 25;

const PRESETS: PeriodPreset[] = [
  { key: "all", label: "All time", range: () => null },
  { key: "today", label: "Today", range: () => ({ from: todayLondon(), to: todayLondon() }) },
  { key: "7d", label: "Last 7 days", range: () => ({ from: addDays(todayLondon(), -6), to: todayLondon() }) },
  { key: "30d", label: "Last 30 days", range: () => ({ from: addDays(todayLondon(), -29), to: todayLondon() }) },
];

const exact = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "medium" });

function Entry({ e }: { e: AuditEntryDto }) {
  return (
    <li className="flex gap-3 border-b border-rule-soft py-3 last:border-b-0">
      {e.actorId ? (
        <Avatar name={e.actorName} size={30} />
      ) : (
        <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-info-bg text-[10px] font-bold text-info-ink" aria-hidden>
          Hub
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm leading-snug text-ink">{e.summary}</span>
        {e.details.length > 0 && (
          <ul className="m-0 mt-0.5 list-none p-0 text-xs text-ink-2">
            {e.details.map((d, i) => (
              <li key={i} className="break-words">
                {d}
              </li>
            ))}
          </ul>
        )}
        <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
          <span>{e.actorId ? e.actorName : "The Hub"}</span>
          <span aria-hidden>·</span>
          <span>{e.category}</span>
          {e.entity?.href && (
            <>
              <span aria-hidden>·</span>
              <Link to={e.entity.href} className="font-semibold text-accent no-underline hover:underline">
                Open
              </Link>
            </>
          )}
        </span>
      </div>
      <time dateTime={e.created} title={exact(e.created)} className="shrink-0 pt-0.5 text-xs whitespace-nowrap text-caption">
        {when(e.created)}
      </time>
    </li>
  );
}

export function AuditSection() {
  const { can } = useAuth();
  const allowed = can("audit.view");
  const [params, setParams] = useSearchParams();
  const [period, setPeriod] = usePeriod(PRESETS);
  const group = params.get("group") ?? "";
  const actor = params.get("actor") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const showSignIns = params.get("signins") === "1" || group === "auth";
  const facets = useAuditFacets(allowed);
  const audit = useAudit(
    {
      page,
      perPage: PER_PAGE,
      action: group || undefined,
      actorId: actor || undefined,
      fromDay: period.from ?? undefined,
      toDay: period.to ?? undefined,
      hideSignIns: showSignIns ? undefined : true,
    },
    allowed,
  );

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  if (!allowed) {
    return (
      <Card className="p-4 md:p-5">
        <EmptyState title="The audit log is for Owner and Operations" body="Ask the owner if you need to know who changed something." />
      </Card>
    );
  }

  const data = audit.data;
  const total = data?.total ?? 0;
  const first = total ? (page - 1) * PER_PAGE + 1 : 0;
  const last = Math.min(total, page * PER_PAGE);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <Card className="flex flex-col gap-4 p-4 md:p-5" aria-label="Audit log">
      <CardHeader title="Audit log" sub="Every change anyone made, newest first." />
      <div className="flex flex-col gap-3">
        <PeriodPicker presets={PRESETS} value={period} onChange={setPeriod} maxDays={366} label="Period" />
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
            What
            <Select value={group} onChange={(e) => set({ group: e.target.value || null, page: null })}>
              <option value="">Everything</option>
              {(facets.data?.groups ?? []).map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
            Who
            <Select value={actor} onChange={(e) => set({ actor: e.target.value || null, page: null })}>
              <option value="">Anyone</option>
              {(facets.data?.actors ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.id === "system" ? "The Hub (automatic)" : a.name}
                </option>
              ))}
            </Select>
          </label>
        </div>
        {group !== "auth" && (
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            <input
              type="checkbox"
              checked={showSignIns}
              onChange={(e) => set({ signins: e.target.checked ? "1" : null, page: null })}
              className="size-4 accent-[var(--color-navy)]"
            />
            Show sign-ins
          </label>
        )}
      </div>

      {audit.isLoading && <Spinner label="Loading the log…" />}
      {audit.error && <ErrorState error={audit.error} retry={() => void audit.refetch()} />}
      {data && data.items.length === 0 && <EmptyState title="Nothing matches" body="Try a longer period or clear the filters." />}
      {data && data.items.length > 0 && (
        <ul className={`m-0 list-none p-0 ${audit.isPlaceholderData ? "opacity-60" : ""}`}>
          {data.items.map((e) => (
            <Entry key={e.id} e={e} />
          ))}
        </ul>
      )}

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-rule-soft pt-3">
          <span className="text-xs text-muted">
            {first.toLocaleString("en-GB")}–{last.toLocaleString("en-GB")} of {total.toLocaleString("en-GB")}
          </span>
          <div className="flex gap-2">
            <Button size="sm" icon={<ChevronLeft className="size-4" />} disabled={page <= 1} onClick={() => set({ page: page > 2 ? String(page - 1) : null })}>
              Newer
            </Button>
            <Button size="sm" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}>
              Older
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

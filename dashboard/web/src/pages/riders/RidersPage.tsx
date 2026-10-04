// Riders: the pipeline (applied → documents checked → waiting for a bag →
// carrying a bag → ended), the list with each rider's last 14 days against the
// fleet, adding riders and giving out bags (?give=<bagId> / ?assign=<riderId>).

import { useMemo, useState, type MouseEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import clsx from "clsx";
import { AlertTriangle, ChevronRight, Clock3, Plus, Search, X } from "lucide-react";
import { docsDue, RIDER_STAGES, RIDER_STAGE_LABEL, todayLondon, type FleetBaseline, type RiderListItem, type RiderListResponse, type RiderStage } from "@digilite/shared";
import { useAuth } from "@/lib/auth";
import { Avatar, Button, Card, Chip, EmptyState, ErrorState, Page, Pill, Spinner, StatusIcon, StatusLabel } from "@/components/ui";
import { shortDate, time, when } from "@/lib/format";
import { useRiders } from "./api";
import { DemoPill, DocsPill, firstName, Sparkline, StagePill, STATUS_SHORT, StoppedMeter, stoppedWellAbove } from "./bits";
import { GiveBagSheet, type GiveMode } from "./GiveBag";
import { AddRiderSheet } from "./RiderForm";

const STAGE_RANK: Record<RiderStage, number> = { waiting: 0, active: 1, checked: 2, applied: 3, ended: 4 };
const BAG_RANK = { now: 0, day: 1, idle: 2, gone: 3 } as const;

function order(a: RiderListItem, b: RiderListItem) {
  return (
    STAGE_RANK[a.stage] - STAGE_RANK[b.stage] ||
    (a.bag && b.bag ? BAG_RANK[a.bag.status] - BAG_RANK[b.bag.status] : 0) ||
    a.name.localeCompare(b.name)
  );
}

const needsAttention = (r: RiderListItem, fleet: FleetBaseline) =>
  (r.stage !== "ended" && r.docs.state !== "ok") || (r.stage !== "ended" && stoppedWellAbove(r.activity.stoppedPct, fleet));

const isOutNow = (r: RiderListItem) => !!r.bag && !r.bag.upcoming && r.bag.status === "now";

/** "Since 17:02" while out now; otherwise when they were last out. */
function lastOutText(r: RiderListItem): { text: string; live: boolean } {
  if (!r.lastOut) return { text: "—", live: false };
  const recent = Date.now() - Date.parse(r.lastOut.end) < 60 * 60_000;
  if (isOutNow(r) && recent && r.lastOut.day === todayLondon()) return { text: `Since ${time(r.lastOut.shiftStart)}`, live: true };
  const w = when(r.lastOut.end);
  return { text: w.charAt(0).toUpperCase() + w.slice(1), live: false };
}

export default function RidersPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const riders = useRiders();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");

  const rawStage = params.get("stage");
  const stage = (RIDER_STAGES as string[]).includes(rawStage ?? "") ? (rawStage as RiderStage) : null;
  const docsDueOnly = params.get("docs") === "due";
  const outNow = params.get("out") === "1";
  const give = params.get("give");
  const assign = params.get("assign");
  const adding = params.get("add") === "1";
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  const data = riders.data;
  const base = useMemo(() => (data?.riders ?? []).filter((r) => (stage ? r.stage === stage : r.stage !== "ended")), [data, stage]);
  const term = q.trim().toLowerCase();
  const shown = useMemo(
    () =>
      base
        .filter((r) => !docsDueOnly || (r.stage !== "ended" && docsDue(r.docs)))
        .filter((r) => !outNow || isOutNow(r))
        .filter((r) => !term || r.name.toLowerCase().includes(term) || (r.bag?.name.toLowerCase().includes(term) ?? false))
        .sort(order),
    [base, docsDueOnly, outNow, term],
  );
  const baseDocs = base.filter((r) => r.stage !== "ended" && docsDue(r.docs)).length;
  const baseOut = base.filter(isOutNow).length;
  const giveMode: GiveMode | null = give ? { kind: "bag", bagId: give } : assign ? { kind: "rider", riderId: assign } : null;
  const filtered = !!(stage || docsDueOnly || outNow || term);

  const openAssign = (e: MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    set({ assign: id, give: null });
  };

  return (
    <Page>
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="m-0 font-display text-[28px] leading-tight font-semibold tracking-[-0.02em] md:text-[32px]">
            Riders {data && <span className="num align-middle font-sans text-base font-medium text-muted md:hidden">{data.riders.filter((r) => r.stage !== "ended").length}</span>}
          </h1>
          {data && <p className="m-0 mt-1.5 text-sm text-muted">{headline(data)}</p>}
        </div>
        {can("riders.edit") && (
          <>
            <span className="hidden md:block">
              <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => set({ add: "1" })}>
                Add a rider
              </Button>
            </span>
            <button
              type="button"
              onClick={() => set({ add: "1" })}
              aria-label="Add a rider"
              className="flex size-12 shrink-0 items-center justify-center rounded-full bg-navy text-white shadow-[var(--shadow-float)] md:hidden"
            >
              <Plus className="size-6" />
            </button>
          </>
        )}
      </header>

      {riders.isLoading && <Spinner label="Loading riders…" />}
      {riders.error && <ErrorState error={riders.error} retry={() => void riders.refetch()} />}

      {data && (
        <>
          <Pipeline data={data} stage={stage} onPick={(s) => set({ stage: s })} />

          <Card className="overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-rule px-4 py-3 md:flex-row md:items-center md:px-5">
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-1 md:px-0">
                {stage && (
                  <Chip active onClick={() => set({ stage: null })}>
                    {RIDER_STAGE_LABEL[stage]}
                    <X className="size-3.5" aria-label="Clear" />
                  </Chip>
                )}
                <Chip active={outNow} count={baseOut} onClick={() => set({ out: outNow ? null : "1" })}>
                  <StatusIcon status="now" size={14} /> Out now
                </Chip>
                <Chip active={docsDueOnly} count={baseDocs} tone={baseDocs && !docsDueOnly ? "amber" : undefined} onClick={() => set({ docs: docsDueOnly ? null : "due" })}>
                  Documents due
                </Chip>
              </div>
              <label className="flex h-10 items-center gap-2 rounded-[10px] border border-line bg-white px-3 md:w-[220px] lg:w-[260px]">
                <Search className="size-4 shrink-0 text-muted" aria-hidden />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Rider or bag"
                  aria-label="Search riders by name or bag"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-caption"
                />
              </label>
            </div>

            {shown.length === 0 ? (
              <EmptyState
                title={filtered ? "No riders match" : "No riders yet"}
                body={filtered ? "Try a different filter or search." : "Add your first rider to start the pipeline."}
                action={
                  filtered ? (
                    <Button
                      onClick={() => {
                        setQ("");
                        set({ stage: null, docs: null, out: null });
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : can("riders.edit") ? (
                    <Button variant="primary" onClick={() => set({ add: "1" })}>
                      Add a rider
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <DesktopList riders={shown} data={data} canEdit={can("riders.edit")} onAssign={openAssign} onOpen={(id) => nav(`/riders/${id}`)} />
                <PhoneList riders={shown} data={data} canEdit={can("riders.edit")} onAssign={openAssign} />
              </>
            )}

            <footer className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-rule px-4 py-2.5 text-xs text-muted md:px-5">
              <span>
                Showing {shown.length} of {data.riders.length}
              </span>
              {data.fleet.stoppedPct != null && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-3 w-0.5 rounded bg-ink-2" aria-hidden /> fleet average, {Math.round(data.fleet.stoppedPct)}% stopped
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <span className="size-3 rounded-[3px] border border-amber-line bg-amber-bg" aria-hidden /> stopped far above the fleet, or documents needing attention
              </span>
              <span className="hidden xl:inline">Last 14 days, from each bag's data while the rider carried it</span>
            </footer>
          </Card>
        </>
      )}

      <GiveBagSheet key={give ?? assign ?? "none"} mode={giveMode} onClose={() => set({ give: null, assign: null })} />
      {adding && <AddRiderSheet open onClose={() => set({ add: null })} />}
    </Page>
  );
}

function headline(d: RiderListResponse): string {
  const parts = [`${d.counts.active} carrying a bag`];
  if (d.counts.waiting) parts.push(`${d.counts.waiting} waiting for a bag`);
  if (d.counts.docsDue) parts.push(`${d.counts.docsDue} ${d.counts.docsDue === 1 ? "needs" : "need"} documents`);
  return parts.join(" · ");
}

// ── Pipeline strip ────────────────────────────────────────────────────────────
function Pipeline({ data, stage, onPick }: { data: RiderListResponse; stage: RiderStage | null; onPick: (s: RiderStage | null) => void }) {
  const by = (s: RiderStage) => data.riders.filter((r) => r.stage === s);
  const names = (list: RiderListItem[]) => (list.length ? list.map((r) => firstName(r.name)).join(", ") : "No one");
  const sub: Record<RiderStage, string> = {
    applied: names(by("applied")),
    checked: names(by("checked")),
    waiting: (() => {
      const w = by("waiting").sort((a, b) => (a.joinedAt ?? "").localeCompare(b.joinedAt ?? ""));
      if (!w.length) return "No one waiting";
      return `${firstName(w[0].name)}${w[0].joinedAt ? `, joined ${shortDate(w[0].joinedAt)}` : ""}${w.length > 1 ? ` +${w.length - 1}` : ""}`;
    })(),
    active: `${data.counts.outNow} out right now`,
    ended: (() => {
      const e = by("ended").sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? ""));
      return e.length ? `Latest: ${firstName(e[0].name)}${e[0].endedAt ? `, ${shortDate(e[0].endedAt)}` : ""}` : "None yet";
    })(),
  };
  const tone = (s: RiderStage, on: boolean) =>
    on
      ? "border-navy bg-tint-2 ring-1 ring-navy text-ink"
      : s === "waiting" && data.counts.waiting > 0
        ? "border-amber-line bg-amber-bg text-amber-ink hover:border-st-idle"
        : "border-rule bg-white text-ink hover:border-line";
  return (
    <nav aria-label="Rider pipeline">
      {/* Wide screens: five cards with the next step between them */}
      <div className="hidden xl:flex">
        {RIDER_STAGES.map((s, i) => {
          const on = stage === s;
          const alert = s === "waiting" && data.counts.waiting > 0 && !on;
          return (
            <div key={s} className="flex min-w-0 flex-1 items-center">
              <button
                aria-pressed={on}
                onClick={() => onPick(on ? null : s)}
                className={clsx("flex min-w-0 flex-1 flex-col items-start gap-1 rounded-2xl border px-4 py-3 text-left transition-colors", tone(s, on))}
              >
                <span className="text-[13px] font-semibold">{RIDER_STAGE_LABEL[s]}</span>
                <span className="num font-display text-[26px] leading-none font-semibold text-ink">{data.counts[s]}</span>
                <span className={clsx("w-full truncate text-xs", alert ? "text-amber-ink" : "text-muted")}>{sub[s]}</span>
              </button>
              {i < RIDER_STAGES.length - 1 && <ChevronRight className="mx-1 size-4 shrink-0 text-caption" aria-hidden />}
            </div>
          );
        })}
      </div>
      {/* Phones and tablets: one scrollable row */}
      <div className="-mx-4 flex items-center gap-1 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0 xl:hidden">
        {RIDER_STAGES.map((s, i) => {
          const on = stage === s;
          return (
            <div key={s} className="flex shrink-0 items-center gap-1">
              <button
                aria-pressed={on}
                onClick={() => onPick(on ? null : s)}
                className={clsx("flex h-11 items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold whitespace-nowrap", tone(s, on))}
              >
                {SHORT_STAGE[s]}
                <span className="num font-display text-base leading-none">{data.counts[s]}</span>
              </button>
              {i < RIDER_STAGES.length - 1 && <ChevronRight className="size-3.5 shrink-0 text-caption" aria-hidden />}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

const SHORT_STAGE: Record<RiderStage, string> = {
  applied: "Applied",
  checked: "Docs checked",
  waiting: "Waiting",
  active: "Carrying a bag",
  ended: "Ended",
};

// ── Desktop list ──────────────────────────────────────────────────────────────
const COLS = "grid-cols-[minmax(150px,1.5fr)_minmax(84px,0.8fr)_minmax(100px,0.9fr)_minmax(140px,1fr)_minmax(112px,0.8fr)_minmax(130px,1.1fr)_minmax(92px,0.8fr)]";

function StatusCell({ r }: { r: RiderListItem }) {
  if (r.stage === "active" && r.bag && !r.bag.upcoming) return <StatusLabel status={r.bag.status} text={STATUS_SHORT[r.bag.status]} />;
  if (r.stage === "active" && r.bag?.upcoming) return <Pill tone="info">Starts {shortDate(r.bag.since)}</Pill>;
  if (r.stage === "waiting")
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-amber-ink">
        <Clock3 className="size-4" aria-hidden /> Waiting
      </span>
    );
  return <StagePill stage={r.stage} />;
}

function BagCell({ r, canEdit, onAssign }: { r: RiderListItem; canEdit: boolean; onAssign: (e: MouseEvent, id: string) => void }) {
  if (r.bag)
    return (
      <span className="flex min-w-0 flex-col">
        <Link to={`/bags/${r.bag.id}`} onClick={(e) => e.stopPropagation()} className="truncate text-sm font-semibold no-underline hover:underline">
          {r.bag.name}
        </Link>
        {(r.bag.upcoming || r.bag.until) && (
          <span className="text-[11px] text-muted">{r.bag.upcoming ? `from ${shortDate(r.bag.since)}` : `until ${shortDate(new Date(Date.parse(r.bag.until!) - 1))}`}</span>
        )}
      </span>
    );
  if (r.stage === "waiting" && canEdit)
    return (
      <Button size="sm" variant="primary" onClick={(e) => onAssign(e, r.id)}>
        Give a bag
      </Button>
    );
  return <span className="text-[13px] text-caption">—</span>;
}

function DesktopList({
  riders,
  data,
  canEdit,
  onAssign,
  onOpen,
}: {
  riders: RiderListItem[];
  data: RiderListResponse;
  canEdit: boolean;
  onAssign: (e: MouseEvent, id: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div role="table" aria-label="Riders" className="hidden xl:block">
      <div role="row" className={clsx("grid gap-3 border-b border-rule px-5 py-2.5 text-xs font-semibold text-muted", COLS)}>
        <span role="columnheader">Rider</span>
        <span role="columnheader">Bag</span>
        <span role="columnheader">Status</span>
        <span role="columnheader">Days out, 2 weeks</span>
        <span role="columnheader">Time stopped</span>
        <span role="columnheader">Documents</span>
        <span role="columnheader">Last out</span>
      </div>
      {riders.map((r) => {
        const attention = needsAttention(r, data.fleet);
        const last = lastOutText(r);
        return (
          <div
            key={r.id}
            role="row"
            onClick={() => onOpen(r.id)}
            className={clsx(
              "grid cursor-pointer items-center gap-3 border-b border-rule-soft px-5 py-2.5 last:border-b-0 hover:bg-paper",
              COLS,
              attention && "bg-amber-bg/45 shadow-[inset_3px_0_0_var(--color-st-idle)] hover:bg-amber-bg/70",
            )}
          >
            <span role="cell" className="flex min-w-0 items-center gap-2.5">
              <Avatar name={r.name} size={32} />
              <span className="flex min-w-0 items-center gap-1.5">
                <Link to={`/riders/${r.id}`} onClick={(e) => e.stopPropagation()} className="truncate text-sm font-semibold text-ink no-underline hover:underline">
                  {r.name}
                </Link>
                {r.demo && <DemoPill />}
              </span>
            </span>
            <span role="cell" className="min-w-0">
              <BagCell r={r} canEdit={canEdit} onAssign={onAssign} />
            </span>
            <span role="cell">
              <StatusCell r={r} />
            </span>
            <span role="cell" className="flex items-center gap-2">
              {r.activity.daysCarrying > 0 ? (
                <>
                  <Sparkline values={r.movingHours} daysOut={r.activity.daysOut} />
                  <span className="num text-xs text-muted">
                    {r.activity.daysOut}/{data.days.length}
                  </span>
                </>
              ) : (
                <span className="text-[13px] text-caption">No bag yet</span>
              )}
            </span>
            <span role="cell">
              <StoppedMeter pct={r.activity.stoppedPct} fleet={data.fleet} />
            </span>
            <span role="cell" className="min-w-0">
              {r.stage === "ended" ? <span className="text-[13px] text-caption">—</span> : <DocsPill docs={r.docs} className="max-w-full truncate" />}
            </span>
            <span role="cell" className={clsx("num truncate text-[13px]", last.live ? "font-semibold text-green-ink" : "text-ink-2")} title={r.lastOut ? undefined : "Not out in the last 14 days"}>
              {last.text}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Phone list ────────────────────────────────────────────────────────────────
function phoneStatus(r: RiderListItem): { text: string; cls: string } {
  if (r.stage === "active" && r.bag?.upcoming) return { text: `Starts ${shortDate(r.bag.since)}`, cls: "text-info-ink" };
  if (r.stage === "active" && r.bag) {
    if (r.bag.status === "now") return { text: "Out now", cls: "text-green-ink" };
    const last = lastOutText(r);
    return { text: r.lastOut ? last.text : STATUS_SHORT[r.bag.status], cls: "text-ink-2" };
  }
  if (r.stage === "waiting") return { text: "Waiting for a bag", cls: "text-amber-ink" };
  if (r.stage === "ended") return { text: r.endedAt ? `Ended ${shortDate(r.endedAt)}` : "Ended", cls: "text-muted" };
  return { text: RIDER_STAGE_LABEL[r.stage], cls: "text-muted" };
}

function PhoneList({
  riders,
  data,
  canEdit,
  onAssign,
}: {
  riders: RiderListItem[];
  data: RiderListResponse;
  canEdit: boolean;
  onAssign: (e: MouseEvent, id: string) => void;
}) {
  return (
    <ul className="m-0 list-none p-0 xl:hidden" aria-label="Riders">
      {riders.map((r) => {
        const st = phoneStatus(r);
        const attention = needsAttention(r, data.fleet);
        return (
          <li key={r.id} className={clsx("border-b border-rule-soft last:border-b-0", attention && "bg-amber-bg/45 shadow-[inset_3px_0_0_var(--color-st-idle)]")}>
            <Link to={`/riders/${r.id}`} className="flex min-h-[64px] items-start gap-3 px-4 py-3 text-ink no-underline active:bg-paper md:px-5 lg:items-center">
              <Avatar name={r.name} size={40} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[15px] font-semibold">{r.name}</span>
                  {r.demo && <DemoPill />}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ink-2">
                  {r.bag ? (
                    <>
                      <StatusIcon status={r.bag.status} size={12} />
                      <span className="truncate">
                        {r.bag.name}
                        {r.bag.upcoming ? ` from ${shortDate(r.bag.since)}` : ""}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted">No bag yet</span>
                  )}
                </span>
                {r.stage !== "ended" && (r.docs.state !== "ok" || stoppedWellAbove(r.activity.stoppedPct, data.fleet)) && (
                  <span className="mt-1.5 flex flex-wrap gap-1.5">
                    {r.docs.state !== "ok" && <DocsPill docs={r.docs} className="max-w-full truncate" />}
                    {stoppedWellAbove(r.activity.stoppedPct, data.fleet) && (
                      <span className="lg:hidden">
                        <Pill tone="amber">
                          <AlertTriangle className="size-3.5" aria-hidden /> {Math.round(r.activity.stoppedPct!)}% stopped
                        </Pill>
                      </span>
                    )}
                  </span>
                )}
              </span>
              {r.activity.daysCarrying > 0 && (
                <span className="hidden shrink-0 items-center gap-6 lg:flex">
                  <span className="flex items-center gap-2">
                    <Sparkline values={r.movingHours} daysOut={r.activity.daysOut} />
                    <span className="num text-xs text-muted">
                      {r.activity.daysOut}/{data.days.length}
                    </span>
                  </span>
                  <StoppedMeter pct={r.activity.stoppedPct} fleet={data.fleet} />
                </span>
              )}
              <span className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5 lg:w-36 lg:pt-0">
                <span className={clsx("text-[13px] font-semibold", st.cls)}>{st.text}</span>
                {r.activity.daysCarrying > 0 && (
                  <span className="lg:hidden">
                    <Sparkline values={r.movingHours} daysOut={r.activity.daysOut} />
                  </span>
                )}
              </span>
            </Link>
            {r.stage === "waiting" && canEdit && (
              <div className="-mt-1 pb-3 pl-[68px]">
                <Button size="sm" variant="primary" onClick={(e) => onAssign(e, r.id)}>
                  Give a bag
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

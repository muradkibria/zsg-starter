// Bags register: every bag, how it compares to the rest of the fleet, and
// filters for the "needs attention" links (?issue=…). Status, issue,
// lifecycle and search all live in the URL.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import clsx from "clsx";
import { AlertTriangle, Archive, ArrowUpDown, ChevronRight, CircleCheck, OctagonAlert, Search, X } from "lucide-react";
import {
  BAG_ISSUE_META,
  BAG_ISSUE_ORDER,
  BAG_LIFECYCLE_LABEL,
  BAG_LIFECYCLES,
  STATUS_ORDER,
  isBagIssueKind,
  type BagIssueKind,
  type BagStatus,
  type BagSummary,
  type Lifecycle,
} from "@digilite/shared";
import { useAuth } from "@/lib/auth";
import { useBags, useFleet } from "@/lib/queries";
import { useFeedback } from "@/components/feedback";
import { Button, Chip, EmptyState, ErrorState, Notice, Page, PageHeader, Segmented, Select, Spinner, StatusIcon, cx } from "@/components/ui";
import { useBulkLifecycle } from "./api";
import { BrightnessText, ClockText, LifecyclePill, LoopText, RiderText, SeenText, SoftwareText, TestBagPill, byName, bySeen, hasIssue } from "./bits";

const STATUS_CHIP: Record<BagStatus, string> = {
  now: "Out now",
  day: "Out in the last day",
  idle: "Idle 1–7 days",
  gone: "Not seen 7+ days",
};

const isStatus = (v: string | null): v is BagStatus => !!v && (STATUS_ORDER as string[]).includes(v);
const isLifecycle = (v: string | null): v is Lifecycle => !!v && (BAG_LIFECYCLES as string[]).includes(v);

type SortKey = "seen" | "name";

/** Desktop grid columns: select · bag · status · rider · on screen · brightness · software · clock */
const GRID =
  "grid grid-cols-[28px_minmax(120px,1fr)_minmax(150px,1.2fr)_minmax(120px,1.1fr)_minmax(110px,1fr)_84px_104px_minmax(110px,1fr)] items-center gap-3";

function useRegisterState() {
  const [params, setParams] = useSearchParams();
  const rawStatus = params.get("status");
  const rawIssue = params.get("issue");
  const rawLifecycle = params.get("lifecycle");
  const state = {
    status: isStatus(rawStatus) ? rawStatus : null,
    issue: isBagIssueKind(rawIssue) ? rawIssue : null,
    lifecycle: isLifecycle(rawLifecycle) ? rawLifecycle : null,
    q: params.get("q") ?? "",
    sort: (params.get("sort") === "name" ? "name" : "seen") as SortKey,
  };
  const update = (patch: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace });
  };
  return { ...state, update };
}

export default function BagsPage() {
  const s = useRegisterState();
  const bagsQ = useBags();
  const fleetQ = useFleet();
  const fleet = fleetQ.data;
  const { can } = useAuth();
  const canEdit = can("bags.edit");
  const canViewRiders = can("riders.view");
  const { toast, confirm } = useFeedback();
  const bulk = useBulkLifecycle();
  const nav = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const all = useMemo(() => bagsQ.data ?? [], [bagsQ.data]);
  const fleetBags = all.filter((b) => b.lifecycle !== "retired");

  const view = useMemo(() => {
    const inScope = all.filter((b) => (s.lifecycle ? b.lifecycle === s.lifecycle : b.lifecycle !== "retired"));
    const term = s.q.trim().toLowerCase();
    const searched = term
      ? inScope.filter((b) => `${b.name} ${b.colorlightId} ${b.rider?.name ?? ""} ${b.playing ?? ""}`.toLowerCase().includes(term))
      : inScope;
    // Faceted counts: each chip row counts within the other active filters.
    const forStatus = s.issue ? searched.filter((b) => hasIssue(b, s.issue!)) : searched;
    const forIssue = s.status ? searched.filter((b) => b.status === s.status) : searched;
    const statusCounts = Object.fromEntries(STATUS_ORDER.map((st) => [st, forStatus.filter((b) => b.status === st).length])) as Record<BagStatus, number>;
    const issueCounts = Object.fromEntries(BAG_ISSUE_ORDER.map((k) => [k, forIssue.filter((b) => hasIssue(b, k)).length])) as Record<BagIssueKind, number>;
    const rows = forStatus.filter((b) => !s.status || b.status === s.status).sort(s.sort === "name" ? byName : bySeen);
    return { inScope, rows, statusCounts, issueCounts, allCount: forStatus.length };
  }, [all, s.lifecycle, s.q, s.issue, s.status, s.sort]);

  const lifecycleCounts = useMemo(() => {
    const c = Object.fromEntries(BAG_LIFECYCLES.map((l) => [l, 0])) as Record<Lifecycle, number>;
    for (const b of all) c[b.lifecycle]++;
    return c;
  }, [all]);

  const selectable = (b: BagSummary) => canEdit && hasIssue(b, "not_seen");
  const selectableRows = view.rows.filter(selectable);
  const picked = selectableRows.filter((b) => selected.has(b.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const setMany = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const n = new Set(prev);
      for (const id of ids) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });

  async function markAsStorage(list: BagSummary[]) {
    if (!list.length) return;
    const names = list.map((b) => b.name);
    const ok = await confirm({
      title: list.length === 1 ? `Mark ${names[0]} as in storage?` : `Mark ${list.length} bags as in storage?`,
      body: (
        <>
          <p className="m-0">
            {listNames(names)} will stop counting as missing and drop off the “needs attention” list.{" "}
            {list.length === 1 ? "It stays" : "They stay"} in the register, marked “In storage”.
          </p>
          <p className="m-0 mt-2">
            {list.length === 1 ? "If it turns up" : "If one turns up"} on the road, set it back to Active on its page.
          </p>
        </>
      ),
      confirm: "Mark as in storage",
    });
    if (!ok) return;
    try {
      const res = await bulk.mutateAsync({ bagIds: list.map((b) => b.id), lifecycle: "storage" });
      setSelected(new Set());
      const n = res.changed.length;
      const first = res.bags.find((b) => res.changed.includes(b.id))?.name ?? names[0];
      toast(
        <span>
          {n === 1 ? `${first} marked as in storage.` : n === 0 ? "Those bags were already in storage." : `${n} bags marked as in storage.`}{" "}
          {n > 0 && (
            <button className="font-semibold underline" onClick={() => void undo(res.changed)}>
              Undo
            </button>
          )}
        </span>,
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't update those bags", "error");
    }
  }

  async function undo(ids: string[]) {
    try {
      await bulk.mutateAsync({ bagIds: ids, lifecycle: "active" });
      toast(ids.length === 1 ? "Undone. The bag is active again." : `Undone. ${ids.length} bags are active again.`, "info");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't undo that", "error");
    }
  }

  const summary = bagsQ.data
    ? `${fleetBags.length} bags · ${fleetBags.filter((b) => b.status === "now" || b.status === "day").length} out in the last day · ${
        fleetBags.filter((b) => b.status === "gone").length
      } not seen for over a week`
    : "Every bag, and what's different from the rest of the fleet";

  const statusRow = useActiveChipInView(`${s.status}:${!!bagsQ.data}`);
  const issueRow = useActiveChipInView(`${s.issue}:${!!bagsQ.data}`);
  const attention = s.issue ? fleet?.attention.find((a) => a.kind === s.issue) : undefined;
  const filtered = !!(s.status || s.issue || s.lifecycle || s.q);
  const issueChips = BAG_ISSUE_ORDER.filter((k) => view.issueCounts[k] > 0 || s.issue === k);
  // Whether anything in the fleet has the chosen issue (not just within the other filters).
  const issueInFleet = s.issue ? fleetBags.some((b) => hasIssue(b, s.issue!)) : false;

  return (
    <Page>
      <PageHeader title="Bags" sub={summary} />

      {/* Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 min-[1400px]:flex-row min-[1400px]:items-center">
          <div
            ref={statusRow}
            role="group"
            aria-label="Show bags by status"
            className="relative -mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
          >
            <Chip active={!s.status} onClick={() => s.update({ status: null })} count={view.allCount} className="h-11! shrink-0 md:h-8!">
              All
            </Chip>
            {STATUS_ORDER.map((st) => (
              <Chip
                key={st}
                active={s.status === st}
                onClick={() => s.update({ status: s.status === st ? null : st })}
                count={view.statusCounts[st]}
                className="h-11! shrink-0 md:h-8!"
              >
                <StatusIcon status={st} size={14} />
                {STATUS_CHIP[st]}
              </Chip>
            ))}
          </div>
          <div className="flex gap-2 min-[1400px]:ml-auto">
            <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-[10px] border border-line bg-white px-3 focus-within:border-navy md:h-10 md:max-w-[360px] min-[1400px]:w-[240px] min-[1400px]:flex-none">
              <Search className="size-4 shrink-0 text-muted" aria-hidden="true" />
              <input
                type="search"
                value={s.q}
                onChange={(e) => s.update({ q: e.target.value }, true)}
                placeholder="Bag, rider or loop"
                aria-label="Search bags"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-caption"
              />
            </label>
            <Select
              aria-label="Lifecycle"
              value={s.lifecycle ?? ""}
              onChange={(e) => s.update({ lifecycle: e.target.value || null })}
              className="h-11! w-auto! shrink-0 md:h-10!"
            >
              <option value="">In the fleet ({all.length - lifecycleCounts.retired})</option>
              {BAG_LIFECYCLES.map((l) => (
                <option key={l} value={l}>
                  {BAG_LIFECYCLE_LABEL[l]} ({lifecycleCounts[l]})
                </option>
              ))}
            </Select>
          </div>
        </div>

        {issueChips.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-muted md:hidden">Needs a fix</span>
            <div
              ref={issueRow}
              role="group"
              aria-label="Show bags with an issue"
              className="relative -mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-0.5 md:mx-0 md:flex-wrap md:overflow-visible md:px-0"
            >
              <span className="hidden shrink-0 pr-1 text-xs font-semibold text-muted md:inline" aria-hidden="true">
                Needs a fix
              </span>
              {issueChips.map((k) => (
                <Chip
                  key={k}
                  active={s.issue === k}
                  tone={BAG_ISSUE_META[k].tone}
                  onClick={() => s.update({ issue: s.issue === k ? null : k })}
                  count={view.issueCounts[k]}
                  className="h-11! shrink-0 md:h-8!"
                >
                  {BAG_ISSUE_META[k].tone === "red" ? (
                    <OctagonAlert className="size-3.5" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="size-3.5" aria-hidden="true" />
                  )}
                  {BAG_ISSUE_META[k].chip}
                  {s.issue === k && <X className="size-3.5" aria-hidden="true" />}
                </Chip>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* What the issue filter means, and what to do about it */}
      {s.issue && bagsQ.data && (
        <Notice
          tone={!issueInFleet ? "green" : BAG_ISSUE_META[s.issue].tone}
          icon={
            !issueInFleet ? (
              <CircleCheck className="size-4" />
            ) : BAG_ISSUE_META[s.issue].tone === "red" ? (
              <OctagonAlert className="size-4" />
            ) : (
              <AlertTriangle className="size-4" />
            )
          }
          action={
            <button onClick={() => s.update({ issue: null })} className="shrink-0 font-semibold underline">
              Show all bags
            </button>
          }
        >
          {!issueInFleet ? (
            <span>Nothing to fix here right now.</span>
          ) : (
            <>
              <strong className="font-semibold">{attention?.title ?? BAG_ISSUE_META[s.issue].chip}.</strong>{" "}
              {attention?.body ?? BAG_ISSUE_META[s.issue].explain}
              {s.issue === "not_seen" && canEdit && selectableRows.length > 0 && (
                <span className="mt-2 flex flex-wrap items-center gap-2">
                  <span>Tick the ones you've accounted for, then mark them as in storage.</span>
                  <button
                    className="font-semibold underline"
                    onClick={() => setMany(selectableRows.map((b) => b.id), picked.length !== selectableRows.length)}
                  >
                    {picked.length === selectableRows.length ? "Clear the ticks" : `Tick all ${selectableRows.length}`}
                  </button>
                </span>
              )}
            </>
          )}
        </Notice>
      )}

      {bagsQ.isLoading && <Spinner label="Loading bags…" />}
      {bagsQ.error && <ErrorState error={bagsQ.error} retry={() => void bagsQ.refetch()} />}

      {bagsQ.data &&
        (view.rows.length === 0 ? (
          <div className="card">
            <EmptyState
              title={filtered ? "No bags match" : "No bags yet"}
              body={filtered ? "Try another filter or clear the search." : "Bags appear here once the first sync from Colorlight has run."}
              action={
                filtered ? (
                  <Button onClick={() => s.update({ status: null, issue: null, lifecycle: null, q: null })}>Clear filters</Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <>
            {/* Desktop: one row per bag */}
            <DesktopTable
              rows={view.rows}
              total={view.inScope.length}
              sort={s.sort}
              setSort={(k) => s.update({ sort: k === "seen" ? null : k })}
              fleetLoop={fleet?.fleetLoop}
              target={fleet?.brightnessTargetPct}
              selectable={selectable}
              selected={selected}
              toggle={toggle}
              setMany={setMany}
              canViewRiders={canViewRiders}
              open={(id) => nav(`/bags/${id}`)}
            />

            {/* Phone and tablet: cards */}
            <div className="flex flex-col gap-3 xl:hidden">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-muted">
                  {countLine(view.rows.length, view.inScope.length)}
                </span>
                <Segmented<SortKey>
                  label="Sort bags"
                  value={s.sort}
                  onChange={(k) => s.update({ sort: k === "seen" ? null : k })}
                  options={[
                    { value: "seen", label: "Last seen" },
                    { value: "name", label: "Name" },
                  ]}
                />
              </div>
              <ul className="m-0 grid list-none gap-2.5 p-0 md:grid-cols-2">
                {view.rows.map((b) => (
                  <BagCard
                    key={b.id}
                    bag={b}
                    fleetLoop={fleet?.fleetLoop}
                    target={fleet?.brightnessTargetPct}
                    selectable={selectable(b)}
                    selected={selected.has(b.id)}
                    toggle={() => toggle(b.id)}
                    canViewRiders={canViewRiders}
                    open={() => nav(`/bags/${b.id}`)}
                  />
                ))}
              </ul>
              <p className="m-0 text-xs text-muted">Amber and red mark what's different from the rest of the fleet.</p>
            </div>
          </>
        ))}

      {/* Bulk action bar: sticks to the bottom while bags are ticked. Sticky offsets are measured inside
          <main>'s bottom padding (pb-20 on phones), so a small offset already clears the tab bar. */}
      {canEdit && picked.length > 0 && (
        <div
          role="region"
          aria-label="Ticked bags"
          className="sticky bottom-2 z-20 flex items-center gap-2 rounded-2xl border border-navy bg-white py-2 pr-2 pl-1 shadow-[var(--shadow-pop)] md:bottom-5 md:gap-3 md:py-2.5 md:pr-2.5 md:pl-2"
        >
          <button
            onClick={() => setSelected(new Set())}
            aria-label="Clear the ticks"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-paper-2 hover:text-ink md:size-10"
          >
            <X className="size-5" />
          </button>
          <span className="min-w-0 flex-1 text-sm">
            <strong className="num font-semibold">{picked.length}</strong> ticked
            <span className="hidden md:inline"> · not seen for over a week</span>
          </span>
          <Button
            variant="primary"
            icon={<Archive className="size-4" />}
            loading={bulk.isPending}
            onClick={() => void markAsStorage(picked)}
            className="min-h-11 shrink-0 md:min-h-0"
          >
            Mark as in storage
          </Button>
        </div>
      )}
    </Page>
  );
}

/** Keep the pressed chip visible in a sideways-scrolling chip row (phones). */
function useActiveChipInView(key: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = ref.current;
    const chip = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!row || !chip || row.scrollWidth <= row.clientWidth) return;
    const left = chip.offsetLeft - 16;
    const right = chip.offsetLeft + chip.offsetWidth + 16 - row.clientWidth;
    if (row.scrollLeft > left) row.scrollLeft = left;
    else if (row.scrollLeft < right) row.scrollLeft = right;
  }, [key]);
  return ref;
}

/** "1 bag", "42 bags", "Showing 18 of 42". */
function countLine(shown: number, total: number): string {
  return shown === total ? `${shown} ${shown === 1 ? "bag" : "bags"}` : `Showing ${shown} of ${total}`;
}

function listNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length <= 4) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

// ── Desktop table ─────────────────────────────────────────────────────────────

function DesktopTable({
  rows,
  total,
  sort,
  setSort,
  fleetLoop,
  target,
  selectable,
  selected,
  toggle,
  setMany,
  canViewRiders,
  open,
}: {
  rows: BagSummary[];
  total: number;
  sort: SortKey;
  setSort: (k: SortKey) => void;
  fleetLoop: string | null | undefined;
  target: number | undefined;
  selectable: (b: BagSummary) => boolean;
  selected: Set<string>;
  toggle: (id: string) => void;
  setMany: (ids: string[], on: boolean) => void;
  canViewRiders: boolean;
  open: (id: string) => void;
}) {
  const pickable = rows.filter(selectable);
  const pickedCount = pickable.filter((b) => selected.has(b.id)).length;
  const allRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = pickedCount > 0 && pickedCount < pickable.length;
  }, [pickedCount, pickable.length]);

  const sortHeader = (key: SortKey, label: string) => (
    <span role="columnheader" aria-sort={sort === key ? (key === "name" ? "ascending" : "descending") : "none"}>
      <button
        onClick={() => setSort(key)}
        className={cx("inline-flex items-center gap-1 rounded hover:text-ink", sort === key ? "text-ink" : "text-muted")}
        title={key === "name" ? "Sort by name" : "Sort by last seen"}
      >
        {label}
        <ArrowUpDown className={cx("size-3", sort === key ? "opacity-90" : "opacity-40")} aria-hidden="true" />
      </button>
    </span>
  );

  return (
    <div role="table" aria-label="Bags" aria-rowcount={rows.length + 1} className="card hidden overflow-hidden xl:block">
      <div role="rowgroup">
        <div role="row" className={cx(GRID, "border-b border-rule px-4 py-2.5 text-xs font-semibold text-muted")}>
          <span role="columnheader" className="flex">
            {pickable.length > 0 && (
              <input
                ref={allRef}
                type="checkbox"
                aria-label="Tick every not-seen bag shown"
                checked={pickedCount > 0 && pickedCount === pickable.length}
                onChange={(e) => setMany(pickable.map((b) => b.id), e.target.checked)}
                className="size-4 accent-navy"
              />
            )}
          </span>
          {sortHeader("name", "Bag")}
          {sortHeader("seen", "Status")}
          <span role="columnheader">Rider</span>
          <span role="columnheader">On screen</span>
          <span role="columnheader">Brightness</span>
          <span role="columnheader">Software</span>
          <span role="columnheader">Clock</span>
        </div>
      </div>
      <div role="rowgroup">
        {rows.map((b) => {
          const isPicked = selected.has(b.id);
          return (
            <div
              key={b.id}
              role="row"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("a,button,input,label")) return;
                open(b.id);
              }}
              className={cx(
                GRID,
                "cursor-pointer border-b border-rule-soft px-4 py-2.5 text-[13px] last:border-b-0",
                isPicked ? "bg-info-bg" : "hover:bg-paper",
                b.lifecycle !== "active" && !isPicked && "bg-paper/50",
              )}
            >
              <span role="cell" className="flex">
                {selectable(b) && (
                  <input
                    type="checkbox"
                    aria-label={`Tick ${b.name}`}
                    checked={isPicked}
                    onChange={() => toggle(b.id)}
                    className="size-4 accent-navy"
                  />
                )}
              </span>
              <span role="cell" className="flex min-w-0 items-center gap-2">
                <Link to={`/bags/${b.id}`} className="truncate font-bold text-ink no-underline hover:text-accent hover:underline">
                  {b.name}
                </Link>
                {b.isTestBag && <TestBagPill className="px-2 text-[11px]" />}
                <LifecyclePill lifecycle={b.lifecycle} className="px-2 text-[11px]" />
              </span>
              <span role="cell" className="flex min-w-0">
                <SeenText bag={b} iconSize={14} />
              </span>
              <span role="cell" className="flex min-w-0">
                <RiderText bag={b} canView={canViewRiders} />
              </span>
              <span role="cell" className="flex min-w-0">
                <LoopText bag={b} fleetLoop={fleetLoop} />
              </span>
              <span role="cell" className="flex min-w-0">
                <BrightnessText bag={b} target={target} />
              </span>
              <span role="cell" className="flex min-w-0">
                <SoftwareText bag={b} />
              </span>
              <span role="cell" className="flex min-w-0">
                <ClockText bag={b} />
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between border-t border-rule px-4 py-3 text-xs text-muted">
        <span>{countLine(rows.length, total)}</span>
        <span>Amber and red mark what's different from the rest of the fleet</span>
      </div>
    </div>
  );
}

// ── Phone / tablet card ───────────────────────────────────────────────────────

function BagCard({
  bag: b,
  fleetLoop,
  target,
  selectable,
  selected,
  toggle,
  canViewRiders,
  open,
}: {
  bag: BagSummary;
  fleetLoop: string | null | undefined;
  target: number | undefined;
  selectable: boolean;
  selected: boolean;
  toggle: () => void;
  canViewRiders: boolean;
  open: () => void;
}) {
  return (
    <li
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button,input,label")) return;
        open();
      }}
      className={clsx(
        "card flex cursor-pointer items-stretch gap-1 py-3 pr-2 pl-3.5",
        selected ? "border-navy bg-info-bg" : "hover:border-line",
        selectable && "pl-1",
      )}
    >
      {selectable && (
        <label className="flex w-11 shrink-0 items-start justify-center pt-0.5">
          <input type="checkbox" aria-label={`Tick ${b.name}`} checked={selected} onChange={toggle} className="size-5 accent-navy" />
        </label>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link to={`/bags/${b.id}`} className="font-display text-[17px] font-semibold text-ink no-underline">
            {b.name}
          </Link>
          {b.isTestBag && <TestBagPill />}
          <LifecyclePill lifecycle={b.lifecycle} />
        </div>
        <div className="flex min-w-0 items-center gap-2 text-[13px]">
          <SeenText bag={b} iconSize={14} className="shrink-0" />
          <span className="text-caption" aria-hidden="true">
            ·
          </span>
          <RiderText bag={b} canView={canViewRiders} className="min-w-0" />
        </div>
        {/* What differs is marked with an icon and colour; spacing (not dots) separates values so wrapping stays tidy. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-0.5 text-[13px] text-ink-2">
          <LoopText bag={b} fleetLoop={fleetLoop} />
          {b.brightnessPct != null && <BrightnessText bag={b} target={target} />}
          {hasIssue(b, "software") && <SoftwareText bag={b} />}
          {b.clock.ok === false && <ClockText bag={b} />}
        </div>
      </div>
      <ChevronRight className="size-5 shrink-0 self-center text-caption" aria-hidden="true" />
    </li>
  );
}

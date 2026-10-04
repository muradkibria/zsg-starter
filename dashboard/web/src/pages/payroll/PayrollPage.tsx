// Payroll: paid hours per rider per London day for a pay period, the shifts
// that need a look, and approving the period (after which it's read-only).

import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import clsx from "clsx";
import { AlertTriangle, ArrowLeftRight, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Download, Info, Loader2, UserX } from "lucide-react";
import {
  PAY_MAX_DAYS,
  formatPay,
  isDay,
  payDayCount,
  payFortnightOf,
  payIsFortnight,
  payLastCompletedFortnight,
  payPeriodLabel,
  payStepPeriod,
  todayLondon,
  type PayRange,
  type PayrollResponse,
} from "@digilite/shared";
import { useAuth } from "@/lib/auth";
import { useFeedback } from "@/components/feedback";
import { Button, EmptyState, ErrorState, Field, Input, Notice, Page, Select, Spinner, buttonClass } from "@/components/ui";
import { dayLabel, shortDate, when } from "@/lib/format";
import { payrollExportHref, useApprovePeriod, usePayroll, useReopenPeriod } from "./api";
import { GridLegend, PayGrid, RiderCards } from "./PayGrid";
import { ReviewQueue } from "./ReviewQueue";
import { DayDialog, fmtHours, secHours } from "./parts";

function usePeriodParam(): [PayRange | null, (r: PayRange | null) => void] {
  const [params, setParams] = useSearchParams();
  const s = params.get("start");
  const e = params.get("end");
  const range = isDay(s) && isDay(e) ? { startDay: s, endDay: e } : null;
  const set = (r: PayRange | null) => {
    const next = new URLSearchParams(params);
    if (r) {
      next.set("start", r.startDay);
      next.set("end", r.endDay);
    } else {
      next.delete("start");
      next.delete("end");
    }
    setParams(next);
  };
  return [range, set];
}

const same = (a: PayRange, b: PayRange) => a.startDay === b.startDay && a.endDay === b.endDay;

export default function PayrollPage() {
  const [range, setRange] = usePeriodParam();
  const q = usePayroll(range);
  const { can, user } = useAuth();
  const [openCell, setOpenCell] = useState<{ riderId: string; day: string } | null>(null);
  const [custom, setCustom] = useState(false);
  const data = q.data;
  const canChange = can("payroll.approve") && data?.status !== "approved";

  if (q.isLoading) {
    return (
      <Page wide>
        <Spinner label="Working out the hours…" />
      </Page>
    );
  }
  if (q.error || !data) {
    return (
      <Page wide>
        <h1 className="m-0 font-display text-[28px] font-semibold">Payroll</h1>
        <ErrorState error={q.error} retry={() => void q.refetch()} />
        {range && (
          <div>
            <Button onClick={() => setRange(null)}>Show the last pay period</Button>
          </div>
        )}
      </Page>
    );
  }

  const shown: PayRange = { startDay: data.startDay, endDay: data.endDay };
  const openRow = openCell ? data.riders.find((r) => r.riderId === openCell.riderId) : null;

  return (
    <Page wide>
      <PeriodHeader data={data} fetching={q.isFetching} custom={custom} setCustom={setCustom} onPick={(r) => setRange(r)} />
      {custom && <CustomRange initial={shown} onApply={(r) => { setRange(r); setCustom(false); }} onCancel={() => setCustom(false)} />}

      <div className={clsx("flex flex-col gap-5 transition-opacity", q.isFetching && q.isPlaceholderData && "opacity-60")}>
        <Tiles data={data} />
        <div className="flex flex-col gap-1 rounded-xl bg-info-bg px-3.5 py-2.5 text-[13px] text-info-ink md:flex-row md:items-start md:gap-2.5">
          <p className="m-0 flex flex-1 items-start gap-2.5">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{data.rules.sentence}</span>
          </p>
          {can("settings.view") && (
            <Link to="/settings?section=pay" className="ml-[26px] inline-flex min-h-11 shrink-0 items-center font-semibold whitespace-nowrap md:ml-0 md:min-h-0">
              Change pay rules
            </Link>
          )}
        </div>

        <div className="grid gap-5 [grid-template-areas:'review'_'main'_'close'] md:max-[1379px]:grid-cols-2 md:max-[1379px]:[grid-template-areas:'main_main'_'review_close'] min-[1380px]:grid-cols-[minmax(0,1fr)_356px] min-[1380px]:grid-rows-[auto_1fr] min-[1380px]:[grid-template-areas:'main_review'_'main_close']">
          <div className="flex min-w-0 flex-col gap-3 [grid-area:main]">
            <PeriodNotes data={data} />
            {data.riders.length === 0 ? (
              <div className="card">
                <EmptyState
                  title="No riders had a bag in this period"
                  body="Hours appear here once a rider is assigned to a bag and the bag goes out."
                  action={
                    <Link to="/riders" className={buttonClass("secondary")}>
                      Go to riders
                    </Link>
                  }
                />
              </div>
            ) : (
              <>
                <div className="hidden md:block">
                  <PayGrid data={data} onOpen={(riderId, day) => setOpenCell({ riderId, day })} />
                </div>
                <div className="md:hidden">
                  <RiderCards data={data} onOpen={(riderId, day) => setOpenCell({ riderId, day })} />
                </div>
                <GridLegend />
              </>
            )}
          </div>
          <div className="min-w-0 [grid-area:review]">
            <ReviewQueue data={data} canChange={can("payroll.approve")} />
          </div>
          <div className="min-w-0 self-start [grid-area:close]">
            <ClosePeriod data={data} canApprove={can("payroll.approve")} isOwner={user?.role === "owner"} />
          </div>
        </div>
      </div>

      {openCell && openRow && (
        <DayDialog
          row={openRow}
          day={openCell.day}
          range={shown}
          paySignalGaps={data.rules.paySignalGaps}
          canChange={canChange}
          onClose={() => setOpenCell(null)}
        />
      )}
    </Page>
  );
}

// ── Header & period picking ───────────────────────────────────────────────────

function PeriodHeader({
  data,
  fetching,
  custom,
  setCustom,
  onPick,
}: {
  data: PayrollResponse;
  fetching: boolean;
  custom: boolean;
  setCustom: (v: boolean) => void;
  onPick: (r: PayRange) => void;
}) {
  const today = todayLondon();
  const cur: PayRange = { startDay: data.startDay, endDay: data.endDay };
  const last = payLastCompletedFortnight(today);
  const current = payFortnightOf(today);
  const prev = payStepPeriod(cur, -1);
  const next = payStepPeriod(cur, 1);
  const isCustom = !payIsFortnight(cur);
  const kind = isCustom ? `Custom range · ${payDayCount(cur.startDay, cur.endDay)} days` : "Pay period";
  const status =
    data.status === "approved"
      ? "approved"
      : !data.ended
        ? `in progress · ends ${dayLabel(data.endDay)}`
        : "draft · not approved yet";
  const tab = (label: string, active: boolean, onClick: () => void) => (
    <button
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        "inline-flex h-10 items-center rounded-lg px-3 text-[13px] font-semibold md:h-8",
        active ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink",
      )}
    >
      {label}
    </button>
  );
  const arrow = "flex size-11 items-center justify-center rounded-[9px] border border-line bg-white hover:bg-paper disabled:opacity-40 md:size-9";
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <p className="m-0 flex items-center gap-1.5 text-[13px] text-muted">
          {kind} · {status}
          {fetching && <Loader2 className="size-3.5 animate-spin" aria-label="Updating" />}
        </p>
        <h1 className="m-0 mt-1 font-display text-[28px] leading-tight font-semibold tracking-[-0.02em] md:text-[32px]">
          {payPeriodLabel(data.startDay, data.endDay, { year: data.startDay.slice(0, 4) !== todayLondon().slice(0, 4) })}
        </h1>
      </div>
      <div className="flex w-full items-center gap-2 md:w-auto">
        <button aria-label="Previous period" className={arrow} onClick={() => onPick(prev)}>
          <ChevronLeft className="size-4" />
        </button>
        <Select
          aria-label="Pick a pay period"
          className="h-11 flex-1 font-semibold md:hidden"
          value={custom ? "custom" : same(cur, last) ? "last" : same(cur, current) ? "this" : "shown"}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "custom") return setCustom(true);
            setCustom(false);
            if (v === "last") onPick(last);
            if (v === "this") onPick(current);
          }}
        >
          {!same(cur, last) && !same(cur, current) && <option value="shown">{payPeriodLabel(cur.startDay, cur.endDay, { short: true })}</option>}
          <option value="last">Last period ({payPeriodLabel(last.startDay, last.endDay, { short: true })})</option>
          <option value="this">This period ({payPeriodLabel(current.startDay, current.endDay, { short: true })})</option>
          <option value="custom">Custom range…</option>
        </Select>
        <div role="group" aria-label="Pick a pay period" className="hidden rounded-[10px] bg-paper-2 p-[3px] md:inline-flex">
          {tab("Last period", !custom && same(cur, last), () => {
            setCustom(false);
            onPick(last);
          })}
          {tab("This period", !custom && same(cur, current), () => {
            setCustom(false);
            onPick(current);
          })}
          {tab("Custom", custom || isCustom, () => setCustom(!custom))}
        </div>
        <button aria-label="Next period" className={arrow} disabled={next.startDay > today} onClick={() => onPick(next)}>
          <ChevronRight className="size-4" />
        </button>
      </div>
    </header>
  );
}

function CustomRange({ initial, onApply, onCancel }: { initial: PayRange; onApply: (r: PayRange) => void; onCancel: () => void }) {
  const [from, setFrom] = useState(initial.startDay);
  const [to, setTo] = useState(initial.endDay);
  const error = !isDay(from) || !isDay(to) ? "Pick both dates" : to < from ? "The end is before the start" : payDayCount(from, to) > PAY_MAX_DAYS ? `Pick ${PAY_MAX_DAYS} days or fewer` : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!error) onApply({ startDay: from, endDay: to });
  };
  return (
    <form onSubmit={submit} className="card flex flex-wrap items-end gap-3 p-3.5" aria-label="Custom range">
      <Field label="From" className="w-[calc(50%-6px)] sm:w-44">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11 md:h-10" />
      </Field>
      <Field label="To" className="w-[calc(50%-6px)] sm:w-44">
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-11 md:h-10" />
      </Field>
      <Button type="submit" variant="primary" className="h-11 md:h-10" disabled={!!error}>
        Show these days
      </Button>
      <Button className="h-11 md:h-10" onClick={onCancel}>
        Cancel
      </Button>
      <span className={clsx("basis-full text-xs", error && from && to ? "text-red-ink" : "text-muted")}>
        {error && from && to ? error : `London days, midnight to midnight · up to ${PAY_MAX_DAYS} days`}
      </span>
    </form>
  );
}

// ── Summary ───────────────────────────────────────────────────────────────────

function Tile({ label, value, sub, tone, className }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "amber" | "placeholder"; className?: string }) {
  return (
    <div className={clsx("card flex min-w-0 flex-col gap-0.5 px-4 py-3", className)}>
      <span className="text-xs text-muted">{label}</span>
      <span className={clsx("num font-display text-[22px] leading-tight font-semibold md:text-[26px]", tone === "amber" && "text-amber-ink", tone === "placeholder" && "text-muted")}>
        {value}
      </span>
      {sub && <span className="text-xs text-caption">{sub}</span>}
    </div>
  );
}

function Tiles({ data }: { data: PayrollResponse }) {
  const t = data.totals;
  const r = data.rules;
  const changed = Math.abs(t.hours - t.calculatedHours) >= 0.005;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <Tile label="Riders with paid hours" value={t.riders} sub={`of ${t.carrying} carrying a bag`} />
      <Tile
        label="Paid hours"
        value={fmtHours(t.hours)}
        sub={changed ? `${fmtHours(t.calculatedHours)} calculated, changed by hand` : r.paySignalGaps ? "moving, plus no signal" : "bag on and moving"}
      />
      <Tile label={`Stopped ${r.stopMin} min or more`} value={secHours(t.stoppedSeconds)} sub="not paid" />
      <Tile label="No signal" value={secHours(t.gapSeconds)} sub={r.paySignalGaps ? "paid, as your pay rules say" : "not paid · long gaps go to review"} />
      <Tile
        className="col-span-2 md:col-span-1"
        label="To pay"
        value={t.pay !== null ? formatPay(t.pay) : "No rate set"}
        tone={t.pay === null ? "placeholder" : undefined}
        sub={r.rate !== null ? `at ${formatPay(r.rate)} per hour` : "set an hourly rate to see money"}
      />
    </div>
  );
}

// ── Hand-overs, bags with no rider, overlaps ──────────────────────────────────

function PeriodNotes({ data }: { data: PayrollResponse }) {
  const unassignedHours = data.unassigned.reduce((s, u) => s + u.paidSeconds, 0);
  const approvedOverlap = data.overlaps.filter((o) => o.status === "approved");
  return (
    <>
      {approvedOverlap.map((o) => (
        <Notice key={`${o.startDay}${o.endDay}`} tone="amber">
          Some of these days are also in the approved period{" "}
          <Link to={`/payroll?start=${o.startDay}&end=${o.endDay}`}>{payPeriodLabel(o.startDay, o.endDay, { short: true })}</Link>. Pay each day once.
        </Notice>
      ))}
      {data.handovers.map((h) => (
        <div key={`${h.bagId}${h.at}`} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl border border-dashed border-line px-3.5 py-2.5 text-[13px] text-ink-2">
          <ArrowLeftRight className="size-4 shrink-0 text-info-ink" aria-hidden />
          <span className="min-w-0 flex-1">{h.text}</span>
          <Link to={`/bags/${h.bagId}`} className="inline-flex min-h-11 shrink-0 items-center font-semibold md:min-h-0">
            Bag history
          </Link>
        </div>
      ))}
      {data.unassigned.length > 0 && (
        <details className="group rounded-xl border border-dashed border-line px-3.5 py-2.5 text-[13px] text-ink-2">
          <summary className="flex cursor-pointer list-none items-start gap-2.5 [&::-webkit-details-marker]:hidden">
            <UserX className="mt-0.5 size-4 shrink-0 text-amber-ink" aria-hidden />
            <span className="min-w-0 flex-1">
              <strong className="font-semibold text-ink">
                {data.unassigned.length} {data.unassigned.length === 1 ? "bag was" : "bags were"} out with nobody assigned ({secHours(unassignedHours)} moving).
              </strong>{" "}
              Those hours aren't credited to anyone. If someone was carrying a bag, add them on the bag's page.
            </span>
            <ChevronDown className="mt-0.5 size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="m-0 mt-2 grid list-none gap-1 p-0 pl-6 sm:grid-cols-2">
            {data.unassigned.map((u) => (
              <li key={u.bagId}>
                <Link to={`/bags/${u.bagId}`} className="font-semibold">
                  {u.bagName}
                </Link>{" "}
                <span className="text-muted">
                  · {u.days.length} {u.days.length === 1 ? "day" : "days"} · {secHours(u.paidSeconds)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

// ── Totals, export, approve ───────────────────────────────────────────────────

function ClosePeriod({ data, canApprove, isOwner }: { data: PayrollResponse; canApprove: boolean; isOwner: boolean }) {
  const approve = useApprovePeriod();
  const reopen = useReopenPeriod();
  const { confirm, toast } = useFeedback();
  const range: PayRange = { startDay: data.startDay, endDay: data.endDay };
  const t = data.totals;
  const label = payPeriodLabel(data.startDay, data.endDay);
  const approved = data.status === "approved";
  const rate = data.rules.rate !== null ? `${formatPay(data.rules.rate)} per hour` : data.rules.payRate.trim() || "Not set";
  const clash = data.overlaps.find((o) => o.status === "approved");

  const onApprove = async () => {
    const ok = await confirm({
      title: `Approve ${label}?`,
      body: (
        <>
          <p className="m-0">
            {fmtHours(t.hours)} for {t.riders} {t.riders === 1 ? "rider" : "riders"}
            {t.pay !== null ? `, ${formatPay(t.pay)} to pay` : ""}.
          </p>
          {t.toReview > 0 && (
            <p className="m-0 mt-2">
              {t.toReview} {t.toReview === 1 ? "shift hasn't" : "shifts haven't"} been checked and will be approved as calculated.
            </p>
          )}
          <p className="m-0 mt-2">After approval the hours are frozen. Only the owner can reopen the period.</p>
        </>
      ),
      confirm: "Approve period",
    });
    if (!ok) return;
    approve.mutate(range, {
      onSuccess: () => toast(`${label} approved`),
      onError: (e) => toast(e.message, "error"),
    });
  };

  const onReopen = async () => {
    const ok = await confirm({
      title: `Reopen ${label}?`,
      body: "The hours will be worked out again from the data and can be changed. Reopening is recorded in the audit log.",
      confirm: "Reopen period",
      danger: true,
    });
    if (!ok) return;
    reopen.mutate(range, {
      onSuccess: () => toast(`${label} reopened`),
      onError: (e) => toast(e.message, "error"),
    });
  };

  return (
    <section aria-label="Close the period" className="card flex flex-col gap-2 p-4 md:p-[18px]">
      {approved && (
        <div className="mb-1 flex items-start gap-2 rounded-xl bg-green-bg px-3 py-2.5 text-[13px] text-green-ink">
          <CheckCircle2 className="mt-px size-4 shrink-0" aria-hidden />
          <span>
            <strong className="font-semibold">Approved by {data.approvedBy ?? "someone"}</strong>
            {data.approvedAt ? ` on ${shortDate(data.approvedAt)} (${when(data.approvedAt)})` : ""}. These hours are frozen.
          </span>
        </div>
      )}
      {approved && data.changedSinceApproval && (
        <div role="status" className="mb-1 flex items-start gap-2 rounded-xl bg-amber-bg px-3 py-2.5 text-[13px] text-amber-ink">
          <AlertTriangle className="mt-px size-4 shrink-0" aria-hidden />
          <span>
            <strong className="font-semibold">
              Data that arrived after approval changes this period by {data.changedSinceApproval.deltaHours > 0 ? "+" : ""}
              {fmtHours(data.changedSinceApproval.deltaHours)}
            </strong>{" "}
            ({data.changedSinceApproval.riders
              .slice(0, 3)
              .map((r) => `${r.riderName} ${r.deltaHours > 0 ? "+" : ""}${fmtHours(r.deltaHours)}`)
              .join(", ")}
            {data.changedSinceApproval.riders.length > 3 ? ` and ${data.changedSinceApproval.riders.length - 3} more` : ""}), usually from bags
            uploading what they recorded while offline. The approved hours stand; reopen the period to include it.
          </span>
        </div>
      )}
      <Row label={`Paid hours, ${t.riders} ${t.riders === 1 ? "rider" : "riders"}`} value={fmtHours(t.hours)} />
      <Row label="Rate" value={rate} muted={data.rules.rate === null} />
      {t.underMinimum > 0 && <Row label={`Under the ${data.rules.payMinHours} h minimum`} value={`${t.underMinimum} not paid`} />}
      <div className="flex items-baseline justify-between border-t border-paper-2 pt-2">
        <span className="text-[13px] font-semibold">To pay</span>
        <span className={clsx("num font-display text-[22px] font-semibold", t.pay === null && "text-muted")}>{t.pay !== null ? formatPay(t.pay) : "—"}</span>
      </div>
      {data.rules.rate === null && (
        <p className="m-0 text-xs text-muted">
          No hourly rate is set yet, so the total isn't worked out.{" "}
          <Link to="/settings?section=pay" className="font-semibold">
            Set a rate
          </Link>
        </p>
      )}
      <div className="mt-1.5 flex flex-col gap-2">
        {!approved && canApprove && (
          <Button variant="primary" size="lg" className="w-full" loading={approve.isPending} disabled={!data.ended || !!clash} onClick={() => void onApprove()}>
            Approve period
          </Button>
        )}
        <ExportMenu range={range} />
        {approved && isOwner && (
          <Button size="lg" className="w-full" loading={reopen.isPending} onClick={() => void onReopen()}>
            Reopen period
          </Button>
        )}
      </div>
      <p className="m-0 text-xs text-muted">
        {approved
          ? isOwner
            ? "Reopening lets hours change again. It's recorded in the audit log."
            : "Only the owner can reopen an approved period."
          : clash
            ? `Some of these days are in the approved period ${payPeriodLabel(clash.startDay, clash.endDay, { short: true })}. Reopen that one first, or pick other days.`
            : !data.ended
            ? `You can approve this period from ${dayLabel(nextDay(data.endDay))}, once its last day is over.`
            : t.toReview > 0
              ? "Shifts not checked are approved as calculated."
              : "Everything has been checked."}
      </p>
    </section>
  );
}

function nextDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function Row({ label, value, muted }: { label: string; value: ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-[13px]">
      <span className="text-ink-2">{label}</span>
      <strong className={clsx("num text-right", muted && "font-semibold text-muted")}>{value}</strong>
    </div>
  );
}

function ExportMenu({ range }: { range: PayRange }) {
  const close = (e: React.MouseEvent) => {
    const d = (e.currentTarget as HTMLElement).closest("details");
    if (d) d.open = false;
  };
  const item = "flex min-h-11 flex-col justify-center rounded-lg px-3 py-1.5 text-sm font-semibold text-ink no-underline hover:bg-paper";
  return (
    <details className="group relative">
      <summary className={buttonClass("secondary", "lg", "w-full list-none [&::-webkit-details-marker]:hidden")}>
        <Download className="size-4" aria-hidden />
        Export for payroll
        <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="absolute bottom-full left-0 z-20 mb-1.5 flex w-full min-w-[230px] flex-col rounded-xl border border-rule bg-white p-1.5 shadow-[var(--shadow-pop)]">
        <a href={payrollExportHref(range, "xlsx")} download onClick={close} className={item}>
          Excel
          <span className="text-xs font-normal text-muted">Summary, riders × days, and every day in detail</span>
        </a>
        <a href={payrollExportHref(range, "csv")} download onClick={close} className={item}>
          CSV
          <span className="text-xs font-normal text-muted">One row per rider per day, with notes</span>
        </a>
      </div>
    </details>
  );
}

// Schedules: the fleet schedule (and any bag's own schedule, via ?bag=) —
// which loop plays when, by priority, and how bright the screens are through
// the day — with a week preview and a careful path to applying it: the test
// bag first, then the fleet.

import { useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import {
  addDays,
  isDay,
  mondayOf,
  type ApplyResult,
  type ApplyTarget,
  type ScheduleContent,
  type ScheduleDto,
  type ScheduleResponse,
} from "@digilite/shared";
import { useAuth } from "@/lib/auth";
import { useFeedback } from "@/components/feedback";
import { Button, EmptyState, ErrorState, Field, Input, Page, PageHeader, Pill, Spinner, buttonClass, cx } from "@/components/ui";
import { date } from "@/lib/format";
import { useApply, useChecks, usePreview, useRemoveOwnSchedule, useSaveSchedule, useSchedule } from "./api";
import { BrightnessCard } from "./BrightnessCard";
import { ChecksCard } from "./ChecksCard";
import { OverridesCard } from "./OverridesCard";
import { Popover, useNow, weekOfLabel } from "./parts";
import { RulesCard } from "./RulesCard";
import { WeekView } from "./WeekView";

export default function SchedulesPage() {
  const [params, setParams] = useSearchParams();
  const bagId = params.get("bag");
  const sched = useSchedule(bagId);

  if (sched.isLoading) {
    return (
      <Page wide>
        <PageHeader title={bagId ? "Bag schedule" : "Fleet schedule"} />
        <Spinner label="Loading the schedule…" />
      </Page>
    );
  }
  if (sched.error || !sched.data) {
    return (
      <Page wide>
        <PageHeader title={bagId ? "Bag schedule" : "Fleet schedule"} crumbs={bagId ? [{ label: "Fleet schedule", to: "/schedules" }] : undefined} />
        <ErrorState error={sched.error} retry={() => void sched.refetch()} />
      </Page>
    );
  }
  if (bagId && !sched.data.schedule) return <NoOwnSchedule data={sched.data} onBack={() => setParams({})} />;
  return <Editor data={sched.data} schedule={sched.data.schedule!} bagId={bagId} params={params} setParams={setParams} />;
}

function Editor({
  data,
  schedule,
  bagId,
  params,
  setParams,
}: {
  data: ScheduleResponse;
  schedule: ScheduleDto;
  bagId: string | null;
  params: URLSearchParams;
  setParams: (p: URLSearchParams | Record<string, string>) => void;
}) {
  const { can } = useAuth();
  const canEdit = can("schedules.edit");
  const { toast, confirm } = useFeedback();
  const now = useNow();
  const weekParam = params.get("week");
  const weekOf = mondayOf(isDay(weekParam) ? weekParam : now.today);
  const [picked, setPicked] = useState<string | null>(null);
  const inWeek = (d: string) => d >= weekOf && d <= addDays(weekOf, 6);
  const selectedDay = picked && inWeek(picked) ? picked : inWeek(now.today) ? now.today : weekOf;

  const preview = usePreview(bagId, weekOf);
  const checks = useChecks(bagId);
  const save = useSaveSchedule(bagId);
  const apply = useApply();
  const remove = useRemoveOwnSchedule(bagId ?? "");
  const [applying, setApplying] = useState<ApplyTarget | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);

  const content: ScheduleContent = { defaultLoopId: schedule.defaultLoopId, rules: schedule.rules, brightness: schedule.brightness };
  const bag = data.bag;

  const setWeek = (day: string) => {
    const next = new URLSearchParams(params);
    const m = mondayOf(day);
    if (m === mondayOf(now.today)) next.delete("week");
    else next.set("week", m);
    setParams(next);
  };

  const onSave = async (next: ScheduleContent, done: string): Promise<boolean> => {
    try {
      await save.mutateAsync(next);
      setResult(null);
      toast(done);
      return true;
    } catch (e) {
      toast((e as Error).message, "error");
      return false;
    }
  };

  const run = async (target: ApplyTarget) => {
    const c = checks.data;
    const real = c && c.writeMode !== "off";
    if (target === "fleet") {
      const ok = await confirm({
        title: `Apply to ${c?.targets.willGet ?? "all"} bags?`,
        body: (
          <>
            Each bag gets {data.bags.own ? "its own schedule, or this one" : "this schedule"}, one bag at a time. It replaces whatever schedule the bag has now.
            {c?.targets.leftOut ? ` ${c.targets.leftOut} ${c.targets.leftOut === 1 ? "bag is" : "bags are"} left out (see the checks).` : ""}
          </>
        ),
        confirm: "Apply to the fleet",
        danger: true,
      });
      if (!ok) return;
    } else if (target === "bag" && real) {
      const ok = await confirm({
        title: `Apply to ${bag?.name}?`,
        body: "It replaces the schedule on that bag. It switches over when the bag next checks in.",
        confirm: `Apply to ${bag?.name}`,
        danger: true,
      });
      if (!ok) return;
    } else if (target === "test" && real) {
      const ok = await confirm({
        title: `Send to the test bag (${c?.testBag?.name})?`,
        body: "It replaces the test bag's schedule. Nothing else changes.",
        confirm: "Send to the test bag",
      });
      if (!ok) return;
    }
    setApplying(target);
    try {
      const res = await apply.mutateAsync(target === "fleet" ? { target } : { target, bagId: bagId ?? undefined });
      setResult(res);
      toast(res.summary, res.counts.failed || res.counts.blocked ? "error" : res.counts.sent ? "success" : "info");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setApplying(null);
    }
  };

  const removeOwn = async () => {
    if (!bag) return;
    const ok = await confirm({
      title: `Remove ${bag.name}'s own schedule?`,
      body: "It will follow the fleet schedule again. Apply the fleet schedule to update the bag itself.",
      confirm: "Remove its own schedule",
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await remove.mutateAsync();
      toast(res.message);
      setParams({});
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const status = schedule.changedSinceApply ? (
    <Pill tone="amber">Changed since applied</Pill>
  ) : schedule.status === "applied" && schedule.appliedAt ? (
    <Pill tone="green">Applied {date(schedule.appliedAt)}</Pill>
  ) : (
    <Pill>Draft · not applied</Pill>
  );

  const followers = data.bags.total - data.bags.own;
  const sub = bag
    ? `Replaces the fleet schedule on ${bag.name} only.`
    : data.bags.own
      ? `Applies to ${followers} of ${data.bags.total} bags · ${data.bags.own} ${data.bags.own === 1 ? "has its" : "have their"} own`
      : `Applies to all ${data.bags.total} bags`;

  return (
    <Page wide>
      <PageHeader
        crumbs={bag ? [{ label: "Fleet schedule", to: "/schedules" }, { label: bag.name }] : undefined}
        title={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            {bag ? `${bag.name}'s own schedule` : "Fleet schedule"}
            <span className="font-sans tracking-normal">{status}</span>
          </span>
        }
        sub={
          <>
            {sub}
            {bag && (
              <>
                {" · "}
                <Link to={`/bags/${bag.id}`}>Open the bag</Link>
              </>
            )}
          </>
        }
        actions={
          <>
            <WeekNav weekOf={weekOf} today={now.today} onChange={setWeek} />
            {bag && canEdit && (
              <Button variant="danger" onClick={() => void removeOwn()} loading={remove.isPending} className="h-11 md:h-10">
                Remove its own schedule
              </Button>
            )}
          </>
        }
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-5">
          {preview.error ? (
            <ErrorState error={preview.error} retry={() => void preview.refetch()} />
          ) : (
            <WeekView
              preview={preview.data}
              loading={preview.isLoading}
              selectedDay={selectedDay}
              onSelectDay={setPicked}
              today={now.today}
              nowMin={now.minute}
            />
          )}
        </div>
        <aside className="flex min-w-0 flex-col gap-4" aria-label="Schedule settings">
          <RulesCard content={content} loops={data.loops} today={data.today} canEdit={canEdit} onSave={onSave} />
          <BrightnessCard steps={content.brightness} today={now.today} canEdit={canEdit} onSave={(steps, done) => onSave({ ...content, brightness: steps }, done)} />
          <ChecksCard
            checks={checks.data}
            loading={checks.isLoading}
            bag={bag}
            canEdit={canEdit}
            applying={applying}
            lastAttempt={schedule.lastAttempt}
            result={result}
            onTryTest={() => void run("test")}
            onApply={() => void run(bag ? "bag" : "fleet")}
            onDismissResult={() => setResult(null)}
          />
          {!bag && <OverridesCard canEdit={canEdit} />}
        </aside>
      </div>
    </Page>
  );
}

function WeekNav({ weekOf, today, onChange }: { weekOf: string; today: string; onChange: (day: string) => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const thisWeek = mondayOf(today);
  const presets = [
    { label: "Last week", day: addDays(thisWeek, -7) },
    { label: "This week", day: thisWeek },
    { label: "Next week", day: addDays(thisWeek, 7) },
    { label: "In 2 weeks", day: addDays(thisWeek, 14) },
  ];
  const btn = "flex size-11 shrink-0 items-center justify-center rounded-[9px] border border-line bg-white hover:bg-paper md:size-10";
  return (
    <div className="relative flex w-full items-center gap-2 md:w-auto" role="group" aria-label="Week">
      <button className={btn} aria-label="Previous week" onClick={() => onChange(addDays(weekOf, -7))}>
        <ChevronLeft className="size-4" />
      </button>
      <button
        ref={trigger}
        className="inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-[9px] border border-line bg-white px-3 text-sm font-semibold whitespace-nowrap hover:bg-paper md:h-10 md:flex-none"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <CalendarDays className="size-4 text-muted" aria-hidden="true" />
        Week of {weekOfLabel(weekOf, today)}
        <ChevronDown className="size-4 text-muted" aria-hidden="true" />
      </button>
      <button className={btn} aria-label="Next week" onClick={() => onChange(addDays(weekOf, 7))}>
        <ChevronRight className="size-4" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={trigger} className="top-full right-0 w-[272px] max-md:left-0">
        <div role="dialog" aria-label="Pick a week" className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2">
            {presets.map((p) => (
              <button
                key={p.label}
                aria-pressed={p.day === weekOf}
                onClick={() => {
                  onChange(p.day);
                  setOpen(false);
                }}
                className={cx(
                  "h-11 rounded-[10px] border text-[13px] font-semibold md:h-9",
                  p.day === weekOf ? "border-navy bg-navy text-white" : "border-line bg-white hover:bg-paper",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Field label="Or pick any date" hint="Shows the week (Monday to Sunday) that contains it.">
            <Input
              type="date"
              defaultValue={weekOf}
              onChange={(e) => {
                if (isDay(e.target.value)) {
                  onChange(e.target.value);
                  setOpen(false);
                }
              }}
              className="h-11"
            />
          </Field>
        </div>
      </Popover>
    </div>
  );
}

function NoOwnSchedule({ data, onBack }: { data: ScheduleResponse; onBack: () => void }) {
  const bag = data.bag!;
  const { can } = useAuth();
  const { toast } = useFeedback();
  const save = useSaveSchedule(bag.id);
  const give = async () => {
    try {
      await save.mutateAsync({ copyFleet: true });
      toast(`${bag.name} now has its own schedule, copied from the fleet one`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  return (
    <Page wide>
      <PageHeader crumbs={[{ label: "Fleet schedule", to: "/schedules" }, { label: bag.name }]} title={`${bag.name}'s schedule`} />
      <div className="card">
        <EmptyState
          title={`${bag.name} follows the fleet schedule`}
          body="Give it its own schedule to play different loops or brightness on this bag only. It starts as a copy of the fleet schedule."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {can("schedules.edit") && (
                <Button variant="primary" onClick={() => void give()} loading={save.isPending} className="h-11">
                  Give it its own schedule
                </Button>
              )}
              <button onClick={onBack} className={buttonClass("secondary", "md", "h-11")}>
                Back to the fleet schedule
              </button>
              <Link to={`/bags/${bag.id}`} className={buttonClass("ghost", "md", "h-11")}>
                Open the bag
              </Link>
            </div>
          }
        />
      </div>
    </Page>
  );
}

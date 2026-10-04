// "Loops, by priority": the rules list, reordering, and the sheet to add or
// edit a rule. 1 is the top: where two rules overlap, the higher one plays.

import { useMemo, useState } from "react";
import clsx from "clsx";
import { AlertTriangle, ArrowUp, Plus } from "lucide-react";
import {
  addDays,
  describeRule,
  describeTimes,
  hmToMin,
  renumberRules,
  scheduleProblems,
  WEEKDAY_SHORT,
  type LoopRule,
  type ScheduleContent,
  type ScheduleLoop,
} from "@digilite/shared";
import { Button, Card, CardHeader, Field, Input, Select } from "@/components/ui";
import { useFeedback } from "@/components/feedback";
import { PriorityBadge, Sheet } from "./parts";

type Save = (next: ScheduleContent, done: string) => Promise<boolean>;

/** Insert `rule` at its priority (1 = top) and renumber the rest. */
export function placeRule(rules: LoopRule[], rule: LoopRule): LoopRule[] {
  const others = renumberRules(rules.filter((r) => r.id !== rule.id));
  const at = Math.max(0, Math.min(others.length, rule.priority - 1));
  return [...others.slice(0, at), rule, ...others.slice(at)].map((r, i) => ({ ...r, priority: i + 1 }));
}

const newId = () => Math.random().toString(36).slice(2, 10);

export function RulesCard({
  content,
  loops,
  today,
  canEdit,
  onSave,
}: {
  content: ScheduleContent;
  loops: ScheduleLoop[];
  today: string;
  canEdit: boolean;
  onSave: Save;
}) {
  const { confirm } = useFeedback();
  const [editing, setEditing] = useState<{ rule: LoopRule; isNew: boolean } | null>(null);
  const [pickDefault, setPickDefault] = useState(false);
  const byId = useMemo(() => new Map(loops.map((l) => [l.id, l])), [loops]);
  const rules = renumberRules(content.rules);
  const fallback = content.defaultLoopId ? byId.get(content.defaultLoopId) : null;

  const add = () =>
    setEditing({
      isNew: true,
      rule: {
        id: newId(),
        loopId: loops.find((l) => l.ready)?.id ?? loops[0]?.id ?? "",
        startDate: today,
        endDate: null,
        weekdays: [true, true, true, true, true, true, true],
        startTime: "17:00",
        endTime: "23:30",
        priority: 1,
      },
    });

  const moveUp = async (r: LoopRule) => {
    const name = byId.get(r.loopId)?.name ?? "Rule";
    await onSave({ ...content, rules: placeRule(rules, { ...r, priority: r.priority - 1 }) }, `“${name}” moved up to priority ${r.priority - 1}`);
  };

  const remove = async (r: LoopRule) => {
    const name = byId.get(r.loopId)?.name ?? "this loop";
    const ok = await confirm({
      title: `Remove the “${name}” rule?`,
      body: "It comes off the schedule here. Bags keep their current schedule until you apply again.",
      confirm: "Remove rule",
      danger: true,
    });
    if (!ok) return false;
    return onSave({ ...content, rules: renumberRules(rules.filter((x) => x.id !== r.id)) }, `“${name}” rule removed`);
  };

  return (
    <Card className="flex flex-col gap-3 p-4 md:p-5" aria-label="Loops, by priority">
      <CardHeader
        title="Loops, by priority"
        action={
          canEdit ? (
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={add} className="h-11 md:h-8">
              Add
            </Button>
          ) : undefined
        }
      />
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {rules.map((r, i) => {
          const loop = byId.get(r.loopId);
          const ended = !!r.endDate && r.endDate < today;
          return (
            <li key={r.id} className={clsx("flex items-stretch gap-1 rounded-[10px] border border-paper-2", ended && "opacity-60")}>
              <button
                onClick={() => canEdit && setEditing({ rule: r, isNew: false })}
                disabled={!canEdit}
                className="flex min-h-11 min-w-0 flex-1 items-start gap-2.5 rounded-[10px] p-2.5 text-left hover:bg-paper disabled:cursor-default disabled:hover:bg-transparent"
                aria-label={`Priority ${r.priority}: ${loop?.name ?? "Removed loop"}, ${describeRule(r, today)}${canEdit ? ". Edit" : ""}`}
              >
                <PriorityBadge priority={r.priority} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[13px] font-semibold">{loop?.name ?? "Removed loop"}</span>
                  <span className="text-xs text-muted">{describeRule(r, today)}</span>
                  {loop && !loop.ready && (
                    <span className="flex items-start gap-1 text-xs text-red-ink">
                      <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                      {loop.problem}
                    </span>
                  )}
                </span>
              </button>
              {canEdit && i > 0 && (
                <button
                  onClick={() => void moveUp(r)}
                  aria-label={`Move “${loop?.name ?? "rule"}” up to priority ${r.priority - 1}`}
                  className="flex w-11 shrink-0 items-center justify-center rounded-[10px] text-muted hover:bg-paper hover:text-ink"
                >
                  <ArrowUp className="size-4" />
                </button>
              )}
            </li>
          );
        })}
        <li className="flex items-stretch gap-1 rounded-[10px] border border-dashed border-rule">
          <button
            onClick={() => canEdit && setPickDefault(true)}
            disabled={!canEdit}
            className="flex min-h-11 min-w-0 flex-1 items-start gap-2.5 rounded-[10px] p-2.5 text-left hover:bg-paper disabled:cursor-default disabled:hover:bg-transparent"
            aria-label={`Default loop: ${fallback?.name ?? "none"}${canEdit ? ". Change" : ""}`}
          >
            <PriorityBadge priority={null} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className={clsx("truncate text-[13px] font-semibold", !fallback && "text-muted")}>{fallback?.name ?? "No default loop"}</span>
              <span className="text-xs text-muted">{fallback ? "Fills any gap" : "Pick one to fill the gaps between rules"}</span>
              {fallback && !fallback.ready && (
                <span className="flex items-start gap-1 text-xs text-red-ink">
                  <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                  {fallback.problem}
                </span>
              )}
            </span>
          </button>
        </li>
      </ol>
      <p className="m-0 text-xs text-muted">
        {rules.length ? "When two overlap, the higher one plays." : "No rules yet. Add one to play a loop on chosen days and times."}
      </p>

      {editing && (
        <RuleSheet
          key={editing.rule.id}
          initial={editing.rule}
          isNew={editing.isNew}
          content={content}
          loops={loops}
          today={today}
          onClose={() => setEditing(null)}
          onSave={async (next, done) => {
            const ok = await onSave(next, done);
            if (ok) setEditing(null);
            return ok;
          }}
          onRemove={async (r) => {
            const ok = await remove(r);
            if (ok) setEditing(null);
          }}
        />
      )}
      {pickDefault && (
        <DefaultLoopSheet
          content={content}
          loops={loops}
          onClose={() => setPickDefault(false)}
          onSave={async (next, done) => {
            const ok = await onSave(next, done);
            if (ok) setPickDefault(false);
            return ok;
          }}
        />
      )}
    </Card>
  );
}

// ── Rule sheet ─────────────────────────────────────────────────────────────────

type DatePreset = "from_today" | "next_7" | "this_month" | "next_month" | "custom";

function monthEnd(day: string): string {
  const [y, m] = day.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

function presetRange(p: Exclude<DatePreset, "custom">, today: string): { start: string; end: string | null } {
  if (p === "from_today") return { start: today, end: null };
  if (p === "next_7") return { start: today, end: addDays(today, 6) };
  if (p === "this_month") return { start: today, end: monthEnd(today) };
  const first = addDays(monthEnd(today), 1);
  return { start: first, end: monthEnd(first) };
}

function detectPreset(start: string, end: string | null, today: string): DatePreset {
  for (const p of ["from_today", "next_7", "this_month", "next_month"] as const) {
    const r = presetRange(p, today);
    if (r.start === start && r.end === end) return p;
  }
  return "custom";
}

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "from_today", label: "From today" },
  { value: "next_7", label: "Next 7 days" },
  { value: "this_month", label: "Rest of this month" },
  { value: "next_month", label: "Next month" },
  { value: "custom", label: "Custom" },
];

const TIME_PRESETS = [
  { label: "All day", start: "00:00", end: "24:00" },
  { label: "Lunch 11:00–15:00", start: "11:00", end: "15:00" },
  { label: "Evening 17:00–23:30", start: "17:00", end: "23:30" },
];

function ChipButton({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={clsx(
        "inline-flex h-11 items-center justify-center rounded-full border px-3.5 text-[13px] font-semibold whitespace-nowrap transition-colors md:h-9",
        on ? "border-navy bg-navy text-white" : "border-line bg-white text-ink hover:bg-paper",
      )}
    >
      {children}
    </button>
  );
}

function RuleSheet({
  initial,
  isNew,
  content,
  loops,
  today,
  onClose,
  onSave,
  onRemove,
}: {
  initial: LoopRule;
  isNew: boolean;
  content: ScheduleContent;
  loops: ScheduleLoop[];
  today: string;
  onClose: () => void;
  onSave: Save;
  onRemove: (r: LoopRule) => Promise<void>;
}) {
  const [rule, setRule] = useState<LoopRule>(initial);
  const [preset, setPreset] = useState<DatePreset>(() => (isNew ? "from_today" : detectPreset(initial.startDate, initial.endDate, today)));
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<LoopRule>) => setRule((r) => ({ ...r, ...patch }));
  const others = content.rules.filter((r) => r.id !== rule.id);
  const positions = others.length + 1;
  const loop = loops.find((l) => l.id === rule.loopId);
  const next = { ...content, rules: placeRule(content.rules, rule) };
  const names = new Map(loops.map((l) => [l.id, l.name]));
  const problems = scheduleProblems(next, (id) => names.get(id) ?? null);
  const w = { start: hmToMin(rule.startTime), end: hmToMin(rule.endTime) };
  const allDay = w.start === 0 && (w.end === 0 || w.end === 1440);
  const overnight = !allDay && w.start !== null && w.end !== null && w.end !== 1440 && w.end <= w.start && w.end !== 0;
  const visibleLoops = loops.filter((l) => l.status !== "archived" || l.id === rule.loopId);

  const pickPreset = (p: DatePreset) => {
    setPreset(p);
    if (p !== "custom") {
      const r = presetRange(p, today);
      set({ startDate: r.start, endDate: r.end });
    }
  };

  const setDays = (days: boolean[]) => set({ weekdays: days });
  const daysIs = (days: boolean[]) => rule.weekdays.every((x, i) => x === days[i]);
  const EVERY = [true, true, true, true, true, true, true];
  const WEEKDAYS = [true, true, true, true, true, false, false];
  const WEEKENDS = [false, false, false, false, false, true, true];

  const save = async () => {
    setBusy(true);
    const name = loop?.name ?? "Loop";
    await onSave(next, isNew ? `“${name}” added at priority ${rule.priority}` : `“${name}” rule saved`);
    setBusy(false);
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={isNew ? "Add a loop rule" : "Edit loop rule"}
      footer={
        <div className="flex items-center gap-2">
          {!isNew && (
            <Button variant="danger" onClick={() => void onRemove(initial)} className="h-11">
              Remove
            </Button>
          )}
          <div className="flex-1" />
          <Button onClick={onClose} className="h-11">
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={problems.length > 0} loading={busy} className="h-11">
            {isNew ? "Add rule" : "Save rule"}
          </Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problems.length) void save();
        }}
      >
        <Field
          label="Loop"
          hint={loop?.ready ? "On Colorlight and ready for bags." : undefined}
          error={loop && !loop.ready ? `Can't go on a bag yet: ${loop.problem} You can still plan with it.` : undefined}
        >
          <Select value={rule.loopId} onChange={(e) => set({ loopId: e.target.value })} className="h-11">
            {!rule.loopId && <option value="">Pick a loop</option>}
            {visibleLoops.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.ready ? "" : " (not ready)"}
              </option>
            ))}
          </Select>
        </Field>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-[13px] font-semibold">Dates</legend>
          <div className="flex flex-wrap gap-2">
            {DATE_PRESETS.map((p) => (
              <ChipButton key={p.value} on={preset === p.value} onClick={() => pickPreset(p.value)}>
                {p.label}
              </ChipButton>
            ))}
          </div>
          {preset === "custom" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="From">
                <Input type="date" value={rule.startDate} onChange={(e) => e.target.value && set({ startDate: e.target.value })} className="h-11" />
              </Field>
              <Field label="Until">
                <Input
                  type="date"
                  value={rule.endDate ?? ""}
                  min={rule.startDate}
                  onChange={(e) => set({ endDate: e.target.value || null })}
                  className="h-11"
                  aria-describedby="no-end-hint"
                />
              </Field>
              <span id="no-end-hint" className="col-span-2 -mt-1 text-xs text-muted">
                Leave “Until” empty for no end date.
              </span>
            </div>
          ) : (
            <p className="m-0 text-xs text-muted">{describeRule(rule, today).split(" · ")[0]}</p>
          )}
        </fieldset>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-[13px] font-semibold">Days</legend>
          <div className="flex flex-wrap gap-2">
            <ChipButton on={daysIs(EVERY)} onClick={() => setDays(EVERY)}>
              Every day
            </ChipButton>
            <ChipButton on={daysIs(WEEKDAYS)} onClick={() => setDays(WEEKDAYS)}>
              Weekdays
            </ChipButton>
            <ChipButton on={daysIs(WEEKENDS)} onClick={() => setDays(WEEKENDS)}>
              Weekends
            </ChipButton>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_SHORT.map((d, i) => (
              <button
                key={d}
                type="button"
                aria-pressed={rule.weekdays[i]}
                onClick={() => setDays(rule.weekdays.map((x, j) => (j === i ? !x : x)))}
                className={clsx(
                  "flex h-11 items-center justify-center rounded-lg border text-[12px] font-semibold",
                  rule.weekdays[i] ? "border-navy bg-navy text-white" : "border-line bg-white text-ink hover:bg-paper",
                )}
              >
                {d}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-[13px] font-semibold">Times</legend>
          <div className="flex flex-wrap gap-2">
            {TIME_PRESETS.map((t) => (
              <ChipButton
                key={t.label}
                on={rule.startTime === t.start && (rule.endTime === t.end || (t.end === "24:00" && rule.endTime === "00:00"))}
                onClick={() => set({ startTime: t.start, endTime: t.end })}
              >
                {t.label}
              </ChipButton>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <Input type="time" value={rule.startTime} onChange={(e) => e.target.value && set({ startTime: e.target.value })} className="h-11" />
            </Field>
            <Field label="Until">
              <Input
                type="time"
                value={rule.endTime === "24:00" ? "00:00" : rule.endTime}
                onChange={(e) => e.target.value && set({ endTime: e.target.value === "00:00" ? "24:00" : e.target.value })}
                className="h-11"
              />
            </Field>
          </div>
          <p className="m-0 text-xs text-muted">
            {allDay
              ? "All day, midnight to midnight."
              : overnight
                ? `Runs past midnight, until ${rule.endTime} the next morning.`
                : `${describeTimes(rule.startTime, rule.endTime)}, London time.`}
          </p>
        </fieldset>

        <Field label="Priority" hint="1 is the top. When two rules overlap, the higher one plays.">
          <Select value={rule.priority} onChange={(e) => set({ priority: Number(e.target.value) })} className="h-11">
            {Array.from({ length: positions }, (_, i) => i + 1).map((p) => (
              <option key={p} value={p}>
                {p === 1 ? "1 · top" : p === positions ? `${p} · bottom` : p}
              </option>
            ))}
          </Select>
        </Field>

        {problems.length > 0 && (
          <div role="alert" className="rounded-xl bg-red-bg px-3.5 py-2.5 text-[13px] text-red-ink">
            {problems.slice(0, 3).map((p) => (
              <p key={p} className="m-0">
                {p}
              </p>
            ))}
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

// ── Default loop ───────────────────────────────────────────────────────────────

function DefaultLoopSheet({ content, loops, onClose, onSave }: { content: ScheduleContent; loops: ScheduleLoop[]; onClose: () => void; onSave: Save }) {
  const [value, setValue] = useState(content.defaultLoopId ?? "");
  const [busy, setBusy] = useState(false);
  const loop = loops.find((l) => l.id === value);
  const save = async () => {
    setBusy(true);
    await onSave({ ...content, defaultLoopId: value || null }, value ? `Default loop set to “${loop?.name}”` : "Default loop removed");
    setBusy(false);
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title="Default loop"
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} className="h-11">
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={busy} className="h-11">
            Save
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="m-0 text-sm text-ink-2">Plays whenever no rule does, so bags never go blank between rules.</p>
        <Field label="Loop" error={loop && !loop.ready ? `Can't go on a bag yet: ${loop.problem}` : undefined}>
          <Select value={value} onChange={(e) => setValue(e.target.value)} className="h-11">
            <option value="">No default loop (nothing scheduled in the gaps)</option>
            {loops
              .filter((l) => l.status !== "archived" || l.id === value)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.ready ? "" : " (not ready)"}
                </option>
              ))}
          </Select>
        </Field>
      </div>
    </Sheet>
  );
}

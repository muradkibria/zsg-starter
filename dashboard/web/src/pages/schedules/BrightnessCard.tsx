// The brightness plan: steps through the day at fixed times or at London's
// actual sunrise and sunset.

import { useState } from "react";
import { Moon, Plus, Sun, Trash2 } from "lucide-react";
import {
  brightnessStepsOn,
  hmToMin,
  londonSunTimes,
  minToHm,
  scheduleProblems,
  type BrightnessStep,
} from "@digilite/shared";
import { Button, Card, CardHeader, Input, Select } from "@/components/ui";

const USUAL: BrightnessStep[] = [
  { from: "sunrise", pct: 85 },
  { from: "sunset", pct: 65 },
  { from: "22:00", pct: 45 },
];

function stepLabel(s: BrightnessStep): string {
  return s.from === "sunrise" ? "From sunrise" : s.from === "sunset" ? "From sunset" : `From ${s.from}`;
}

export function BrightnessCard({
  steps,
  today,
  canEdit,
  onSave,
}: {
  steps: BrightnessStep[];
  today: string;
  canEdit: boolean;
  onSave: (steps: BrightnessStep[], done: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<BrightnessStep[] | null>(null);
  const [busy, setBusy] = useState(false);
  const sun = londonSunTimes(today);
  const resolved = brightnessStepsOn(steps, today);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    const ok = await onSave(draft, draft.length ? "Brightness plan saved" : "Brightness plan cleared");
    setBusy(false);
    if (ok) setDraft(null);
  };

  return (
    <Card className="flex flex-col gap-3 p-4 md:p-5" aria-label="Brightness">
      <CardHeader
        title="Brightness"
        action={
          canEdit && !draft ? (
            <Button size="sm" variant="ghost" onClick={() => setDraft(steps.length ? steps.map((s) => ({ ...s })) : USUAL.map((s) => ({ ...s })))} className="h-11 md:h-8">
              {steps.length ? "Edit" : "Set up"}
            </Button>
          ) : undefined
        }
      />
      <p className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1">
          <Sun className="size-3.5" aria-hidden="true" /> Sunrise today <strong className="num text-ink">{sun.sunrise}</strong>
        </span>
        <span className="inline-flex items-center gap-1">
          <Moon className="size-3.5" aria-hidden="true" /> Sunset today <strong className="num text-ink">{sun.sunset}</strong>
        </span>
      </p>

      {draft ? (
        <StepsEditor draft={draft} setDraft={setDraft} today={today} busy={busy} onSave={() => void save()} onCancel={() => setDraft(null)} />
      ) : resolved.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {resolved.map((s) => (
            <li key={s.index} className="flex items-baseline justify-between gap-3 text-[13px]">
              <span>
                {stepLabel(steps[s.index])}
                {s.from === "sunrise" || s.from === "sunset" ? <span className="num text-muted"> · {minToHm(s.at)} today</span> : null}
              </span>
              <strong className="num font-display text-base">{s.pct}%</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[13px] text-ink-2">Not scheduled. Bags keep whatever brightness they're set to.</p>
      )}
      {!draft && <p className="m-0 text-xs text-muted">Sunrise and sunset follow London's actual times through the year, summer time included.</p>}
    </Card>
  );
}

function StepsEditor({
  draft,
  setDraft,
  today,
  busy,
  onSave,
  onCancel,
}: {
  draft: BrightnessStep[];
  setDraft: (s: BrightnessStep[]) => void;
  today: string;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const problems = scheduleProblems({ defaultLoopId: null, rules: [], brightness: draft });
  const sun = londonSunTimes(today);
  const update = (i: number, patch: Partial<BrightnessStep>) => setDraft(draft.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const freeTime = () => {
    for (const t of ["12:00", "20:00", "23:00", "06:00", "09:00", "15:00", "18:00", "21:00"]) if (!draft.some((s) => s.from === t)) return t;
    return "13:00";
  };
  return (
    <div className="flex flex-col gap-3">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {draft.map((s, i) => {
          const kind = s.from === "sunrise" || s.from === "sunset" ? s.from : "time";
          return (
            <li key={i} className="flex flex-col gap-2 rounded-[10px] border border-paper-2 p-2.5">
              <div className="grid grid-cols-2 gap-2">
                <Select
                  aria-label={`Step ${i + 1}: when`}
                  value={kind}
                  onChange={(e) => {
                    const v = e.target.value;
                    update(i, { from: v === "time" ? freeTime() : v });
                  }}
                  className="h-11 md:h-10"
                >
                  <option value="sunrise">At sunrise</option>
                  <option value="sunset">At sunset</option>
                  <option value="time">At a set time</option>
                </Select>
                {kind === "time" ? (
                  <Input
                    type="time"
                    aria-label={`Step ${i + 1}: time`}
                    value={s.from}
                    onChange={(e) => e.target.value && update(i, { from: e.target.value })}
                    className="h-11 md:h-10"
                  />
                ) : (
                  <span className="num flex items-center text-xs text-muted">{kind === "sunrise" ? sun.sunrise : sun.sunset} today</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-[13px] text-ink-2">
                  Brightness
                  <span className="w-[72px]">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={100}
                      aria-label={`Step ${i + 1}: brightness percent`}
                      value={Number.isFinite(s.pct) ? s.pct : ""}
                      onChange={(e) => update(i, { pct: e.target.value === "" ? Number.NaN : Math.round(Number(e.target.value)) })}
                      className="h-11 md:h-10"
                    />
                  </span>
                  %
                </label>
                <button
                  type="button"
                  onClick={() => setDraft(draft.filter((_, j) => j !== i))}
                  aria-label={`Remove step ${i + 1}`}
                  className="ml-auto flex size-11 items-center justify-center rounded-lg text-muted hover:bg-red-bg hover:text-red-ink md:size-10"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {!draft.length && <p className="m-0 text-[13px] text-ink-2">No steps: brightness won't be scheduled.</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setDraft([...draft, { from: freeTime(), pct: 70 }])} disabled={draft.length >= 12} className="h-11 md:h-8">
          Add a step
        </Button>
        {!draft.length && (
          <Button size="sm" variant="quiet" onClick={() => setDraft(USUAL.map((s) => ({ ...s })))} className="h-11 md:h-8">
            Use 85% by day, 65% from sunset, 45% from 22:00
          </Button>
        )}
      </div>
      {problems.length > 0 && (
        <div role="alert" className="rounded-xl bg-red-bg px-3.5 py-2.5 text-[13px] text-red-ink">
          {problems.slice(0, 3).map((p) => (
            <p key={p} className="m-0">
              {p}
            </p>
          ))}
        </div>
      )}
      <p className="m-0 text-xs text-muted">
        Each step holds until the next one, through the night.
        {draft.some((s) => hmToMin(s.from) !== null) && draft.some((s) => s.from === "sunset") ? " Steps reorder themselves if sunset passes a set time." : ""}
      </p>
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel} className="h-11 md:h-10">
          Cancel
        </Button>
        <Button variant="primary" onClick={onSave} disabled={problems.length > 0} loading={busy} className="h-11 md:h-10">
          Save brightness
        </Button>
      </div>
    </div>
  );
}

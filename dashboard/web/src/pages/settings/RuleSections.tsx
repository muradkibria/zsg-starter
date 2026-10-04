// Settings kept in the app_settings record: fleet defaults, tracking rules and
// pay rules, plus how data is protected. Each form starts from the saved values and
// resets itself after a save (it's keyed on what's saved).

import { useState, type ReactNode } from "react";
import { CheckCircle2, RefreshCw } from "lucide-react";
import type { SettingsDto } from "@digilite/shared";
import { useFeedback } from "@/components/feedback";
import { Button, Card, CardHeader, ErrorState, Field, Input, Notice, Select, Spinner, Switch } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { when } from "@/lib/format";
import { useSettings } from "@/lib/queries";
import { useFleetLoopOptions, useRecompute, useRecomputeStatus, useSaveSettings } from "./api";

function rangeError(raw: string, min: number, max: number, label = "a number"): string | null {
  if (raw.trim() === "") return `Enter ${label}`;
  const n = Number(raw);
  if (!Number.isFinite(n)) return `Enter ${label}`;
  if (n < min || n > max) return `Use ${min} to ${max}`;
  return null;
}

function NumberInput({ value, onChange, unit, min, max, disabled, id }: { value: string; onChange: (v: string) => void; unit: string; min: number; max: number; disabled?: boolean; id?: string }) {
  return (
    <span className="flex items-center gap-2">
      <Input id={id} type="number" inputMode="decimal" min={min} max={max} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="max-w-28" />
      <span className="text-[13px] font-normal text-muted">{unit}</span>
    </span>
  );
}

function FormFooter({ dirty, invalid, busy, onSave, onReset }: { dirty: boolean; invalid: boolean; busy: boolean; onSave: () => void; onReset: () => void }) {
  const { can } = useAuth();
  if (!can("settings.edit")) return <p className="m-0 text-xs text-muted">Only the owner can change these.</p>;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-rule-soft pt-4">
      <Button variant="primary" onClick={onSave} loading={busy} disabled={!dirty || invalid}>
        Save changes
      </Button>
      {dirty && (
        <Button variant="ghost" onClick={onReset} disabled={busy}>
          Undo changes
        </Button>
      )}
    </div>
  );
}

/** Render a settings form keyed on the saved values, so it resets after every save. */
function WithSettings({ children }: { children: (s: SettingsDto, readOnly: boolean) => ReactNode }) {
  const settings = useSettings();
  const { can } = useAuth();
  if (settings.isLoading) return <Spinner />;
  if (settings.error) return <ErrorState error={settings.error} retry={() => void settings.refetch()} />;
  if (!settings.data) return null;
  return <>{children(settings.data, !can("settings.edit"))}</>;
}

// ── Fleet defaults ────────────────────────────────────────────────────────────
export function DefaultsSection() {
  return <WithSettings>{(s, ro) => <DefaultsForm key={`${s.fleetLoopName}|${s.brightnessTargetPct}|${s.brightnessCommandScale}`} s={s} readOnly={ro} />}</WithSettings>;
}

function DefaultsForm({ s, readOnly }: { s: SettingsDto; readOnly: boolean }) {
  const { toast } = useFeedback();
  const save = useSaveSettings();
  const loops = useFleetLoopOptions();
  const [loop, setLoop] = useState(s.fleetLoopName);
  const [target, setTarget] = useState(String(s.brightnessTargetPct));
  const [scale, setScale] = useState<100 | 255>(s.brightnessCommandScale === 255 ? 255 : 100);
  const targetErr = rangeError(target, 5, 100);
  const dirty = loop.trim() !== s.fleetLoopName || Number(target) !== s.brightnessTargetPct || scale !== s.brightnessCommandScale;
  const options = loops.data ?? [];
  const hasOptions = options.length > 0;
  const example = Number(target) || 70;

  const submit = async () => {
    try {
      await save.mutateAsync({ fleetLoopName: loop.trim(), brightnessTargetPct: Number(target), brightnessCommandScale: scale });
      toast("Fleet defaults saved");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <Card className="flex flex-col gap-5 p-4 md:p-5" aria-label="Fleet defaults">
      <CardHeader title="Fleet defaults" sub="What every bag should be doing. Bags that differ are flagged on the map and in Alerts." />
      <Field
        label="Fleet loop"
        hint={
          hasOptions
            ? "Bags playing anything else are flagged “Playing a different loop”."
            : "Type the loop's name exactly as it appears in Colorlight. Bags playing anything else are flagged."
        }
      >
        {hasOptions ? (
          <Select value={loop} onChange={(e) => setLoop(e.target.value)} disabled={readOnly}>
            {!options.some((o) => o.name === loop) && <option value={loop}>{loop || "Not set"}</option>}
            {options.map((o) => (
              <option key={o.name} value={o.name}>
                {o.name}
                {o.playingOn ? ` · playing on ${o.playingOn} ${o.playingOn === 1 ? "bag" : "bags"}` : ""}
              </option>
            ))}
          </Select>
        ) : (
          <Input value={loop} onChange={(e) => setLoop(e.target.value)} maxLength={200} disabled={readOnly || loops.isLoading} />
        )}
      </Field>

      <Field label="Brightness target" error={targetErr} hint="Bags more than 8 points above or below this are flagged.">
        <span className="flex flex-wrap items-center gap-3">
          <NumberInput value={target} onChange={setTarget} unit="%" min={5} max={100} disabled={readOnly} />
          <input
            type="range"
            min={5}
            max={100}
            step={1}
            value={Number(target) || 5}
            onChange={(e) => setTarget(e.target.value)}
            disabled={readOnly}
            aria-label="Brightness target"
            className="h-6 min-w-40 flex-1 accent-[var(--color-navy)]"
          />
        </span>
      </Field>

      <div className="flex flex-col gap-2">
        <span id="scale-label" className="text-[13px] font-semibold">
          Brightness command scale
        </span>
        <div role="radiogroup" aria-labelledby="scale-label" className="flex flex-wrap gap-2">
          {([100, 255] as const).map((v) => (
            <label
              key={v}
              className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] border px-3.5 text-[13px] font-semibold ${
                scale === v ? "border-accent bg-tint-2 text-accent" : "border-line bg-white text-ink-2"
              } ${readOnly ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <input type="radio" name="scale" checked={scale === v} onChange={() => setScale(v)} disabled={readOnly} className="accent-[var(--color-navy)]" />
              0–{v}
            </label>
          ))}
        </div>
        <p className="m-0 text-xs text-muted">
          How bags read a brightness number. At {example}% the Hub sends {example} on the 0–100 scale, or {Math.round(example * 2.55)} on the 0–255
          scale. Check it on the test bag first: set 50% and confirm the screen is at half brightness before relying on it for the fleet.
        </p>
      </div>

      <FormFooter
        dirty={dirty}
        invalid={!!targetErr}
        busy={save.isPending}
        onSave={() => void submit()}
        onReset={() => {
          setLoop(s.fleetLoopName);
          setTarget(String(s.brightnessTargetPct));
          setScale(s.brightnessCommandScale === 255 ? 255 : 100);
        }}
      />
    </Card>
  );
}

// ── Tracking rules ────────────────────────────────────────────────────────────
export function TrackingSection() {
  return (
    <div className="flex flex-col gap-5">
      <WithSettings>
        {(s, ro) => <TrackingForm key={`${s.shiftBreakMin}|${s.signalGapMin}|${s.stopRadiusM}|${s.stopMin}`} s={s} readOnly={ro} />}
      </WithSettings>
      <RecomputeCard />
    </div>
  );
}

const TRACKING = [
  {
    key: "shiftBreakMin",
    label: "Shift break",
    unit: "minutes",
    min: 10,
    max: 240,
    hint: "No location for longer than this ends a shift. Riders' hours are worked out shift by shift.",
  },
  {
    key: "signalGapMin",
    label: "Signal gap",
    unit: "minutes",
    min: 1,
    max: 60,
    hint: "No location for longer than this, but less than a shift break, is a signal gap: the bag was on but didn't say where it was. Gaps are shown on routes, never filled in.",
  },
  {
    key: "stopRadiusM",
    label: "Stop radius",
    unit: "metres",
    min: 10,
    max: 500,
    hint: "A bag that stays within this distance of one spot…",
  },
  {
    key: "stopMin",
    label: "Stop length",
    unit: "minutes",
    min: 1,
    max: 120,
    hint: "…for at least this long has stopped. Stops show on routes and aren't counted as moving time.",
  },
] as const;

type TrackingKey = (typeof TRACKING)[number]["key"];

function TrackingForm({ s, readOnly }: { s: SettingsDto; readOnly: boolean }) {
  const { toast, confirm } = useFeedback();
  const save = useSaveSettings();
  const recompute = useRecompute();
  const initial = Object.fromEntries(TRACKING.map((f) => [f.key, String(s[f.key])])) as Record<TrackingKey, string>;
  const [v, setV] = useState(initial);
  const errors = Object.fromEntries(TRACKING.map((f) => [f.key, rangeError(v[f.key], f.min, f.max)])) as Record<TrackingKey, string | null>;
  if (!errors.signalGapMin && !errors.shiftBreakMin && Number(v.signalGapMin) >= Number(v.shiftBreakMin)) {
    errors.signalGapMin = "Make it shorter than the shift break";
  }
  const dirty = TRACKING.some((f) => Number(v[f.key]) !== s[f.key]);
  const invalid = Object.values(errors).some(Boolean);

  const submit = async () => {
    try {
      await save.mutateAsync(Object.fromEntries(TRACKING.map((f) => [f.key, Number(v[f.key])])) as Partial<SettingsDto>);
      const now = await confirm({
        title: "Tracking rules saved. Recompute recent days?",
        body: "New days use the new rules straight away. Recompute the last 28 days so past routes, hours, zone time and both pay periods that could still be open use them too. It takes a minute or so.",
        confirm: "Recompute the last 28 days",
      });
      if (now) {
        const st = await recompute.mutateAsync(28);
        toast(`Recomputing ${st.total} bag-days in the background`);
      } else {
        toast("Tracking rules saved");
      }
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <Card className="flex flex-col gap-5 p-4 md:p-5" aria-label="Tracking rules">
      <CardHeader title="Tracking rules" sub="How GPS points become shifts, stops and signal gaps. These drive routes, hours, payroll and zone time." />
      <div className="grid gap-5 sm:grid-cols-2">
        {TRACKING.map((f) => (
          <Field key={f.key} label={f.label} error={errors[f.key]} hint={f.hint}>
            <NumberInput value={v[f.key]} onChange={(x) => setV({ ...v, [f.key]: x })} unit={f.unit} min={f.min} max={f.max} disabled={readOnly} />
          </Field>
        ))}
      </div>
      <FormFooter dirty={dirty} invalid={invalid} busy={save.isPending || recompute.isPending} onSave={() => void submit()} onReset={() => setV(initial)} />
    </Card>
  );
}

function RecomputeCard() {
  const { can } = useAuth();
  const { toast } = useFeedback();
  const status = useRecomputeStatus();
  const recompute = useRecompute();
  const st = status.data;
  const running = !!st && st.remaining > 0;
  const done = st ? st.total - st.remaining : 0;
  return (
    <Card className="flex flex-col gap-3 p-4 md:p-5" aria-label="Recompute">
      <CardHeader title="Recompute recent days" />
      <p className="m-0 text-[13px] text-ink-2">
        Days are worked out as the GPS arrives, using the rules at the time. After changing the rules, recompute the last 28 days (two pay periods) so routes,
        hours, payroll and zone time all use the new ones.
      </p>
      {running && (
        <div className="flex flex-col gap-1.5" role="status">
          <span className="text-[13px]">
            Recomputing · {done.toLocaleString("en-GB")} of {st.total.toLocaleString("en-GB")} bag-days done
          </span>
          <span className="block h-1.5 overflow-hidden rounded-full bg-paper-2" aria-hidden>
            <span className="block h-full rounded-full bg-navy transition-all" style={{ width: `${(done / Math.max(1, st.total)) * 100}%` }} />
          </span>
        </div>
      )}
      {st && !running && st.finishedAt && (
        <Notice tone="green" icon={<CheckCircle2 className="size-4" />}>
          Recomputed {st.total.toLocaleString("en-GB")} bag-days, finished {when(st.finishedAt)}.
        </Notice>
      )}
      {can("settings.edit") ? (
        <div>
          <Button
            icon={<RefreshCw className="size-4" />}
            loading={recompute.isPending}
            disabled={running}
            onClick={async () => {
              try {
                const r = await recompute.mutateAsync(28);
                toast(`Recomputing ${r.total} bag-days in the background`);
              } catch (e) {
                toast((e as Error).message, "error");
              }
            }}
          >
            Recompute the last 28 days
          </Button>
        </div>
      ) : (
        <p className="m-0 text-xs text-muted">Only the owner can start a recompute.</p>
      )}
    </Card>
  );
}

// ── Pay rules ─────────────────────────────────────────────────────────────────
export function PaySection() {
  return (
    <WithSettings>{(s, ro) => <PayForm key={`${s.payRate}|${s.payMinHours}|${s.paySignalGaps}|${s.stopMin}`} s={s} readOnly={ro} />}</WithSettings>
  );
}

function PayForm({ s, readOnly }: { s: SettingsDto; readOnly: boolean }) {
  const { toast } = useFeedback();
  const save = useSaveSettings();
  const [rate, setRate] = useState(s.payRate);
  const [minHours, setMinHours] = useState(String(s.payMinHours));
  const [gaps, setGaps] = useState(s.paySignalGaps);
  const minErr = rangeError(minHours, 0, 200);
  const dirty = rate.trim() !== s.payRate || Number(minHours) !== s.payMinHours || gaps !== s.paySignalGaps;
  const submit = async () => {
    try {
      await save.mutateAsync({ payRate: rate.trim(), payMinHours: Number(minHours), paySignalGaps: gaps });
      toast("Pay rules saved");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  return (
    <Card className="flex flex-col gap-5 p-4 md:p-5" aria-label="Pay rules">
      <CardHeader title="Pay rules" sub="Used by Payroll to work out each rider's paid hours." />
      <Field label="Rate" hint="Shown on payroll, e.g. £12.00/hour. Leave blank if riders are paid another way.">
        <Input value={rate} onChange={(e) => setRate(e.target.value)} maxLength={60} placeholder="£12.00/hour" disabled={readOnly} className="max-w-xs" />
      </Field>
      <Field label="Minimum hours to qualify" error={minErr} hint="0 means there's no minimum.">
        <NumberInput value={minHours} onChange={setMinHours} unit="hours" min={0} max={200} disabled={readOnly} />
      </Field>
      <div className="flex flex-col gap-1.5">
        <Switch checked={gaps} onChange={setGaps} disabled={readOnly} label={<span className="font-semibold">Pay for signal-gap time</span>} />
        <p className="m-0 pl-14 text-xs text-muted">
          Paid time is moving time. Stops ({s.stopMin} minutes or more in one place) are never paid. Switch this on to also pay for signal gaps:
          time the bag was on but not sending its location.
        </p>
      </div>
      <FormFooter
        dirty={dirty}
        invalid={!!minErr}
        busy={save.isPending}
        onSave={() => void submit()}
        onReset={() => {
          setRate(s.payRate);
          setMinHours(String(s.payMinHours));
          setGaps(s.paySignalGaps);
        }}
      />
    </Card>
  );
}

// ── Data & privacy ────────────────────────────────────────────────────────────
export function PrivacySection() {
  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-3 p-4 md:p-5" aria-label="How data is protected">
        <CardHeader title="How data is protected" />
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-[13px]">
          {[
            "Everything is kept permanently: routes, ad plays, rider records and documents, pay periods and the audit log. Nothing is deleted automatically.",
            "Clients only see bag-level data, never rider names.",
            "Location is only recorded while a bag is on.",
            "Rider documents are protected files: only people allowed to see them can open them, and every view is logged.",
            "Every change anyone makes is written to the audit log.",
          ].map((t) => (
            <li key={t} className="flex items-start gap-2.5">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-ink" aria-hidden />
              {t}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}


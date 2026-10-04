// Period selector: a few presets plus a custom range (every date or period
// selector in the Hub offers both). The value lives in the URL so a period
// can be shared and survives a reload.

import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import clsx from "clsx";
import { CalendarRange } from "lucide-react";
import { addDays, isDay, todayLondon } from "@digilite/shared";
import { shortDate } from "@/lib/format";

export interface PeriodPreset {
  key: string;
  label: string;
  /** null = no date limit (e.g. "All time") */
  range: () => { from: string; to: string } | null;
}

export interface Period {
  key: string;
  from: string | null;
  to: string | null;
  label: string;
}

const d = (day: string) => new Date(`${day}T12:00:00Z`);

/** "28 Sep", "22 – 28 Sep", "28 Aug – 3 Sep" */
export function rangeLabel(from: string, to: string): string {
  if (from === to) return shortDate(d(from));
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return sameMonth ? `${Number(from.slice(8))} – ${shortDate(d(to))}` : `${shortDate(d(from))} – ${shortDate(d(to))}`;
}

/** Read the period from ?period=&from=&to= (falling back to the first preset). */
export function usePeriod(presets: PeriodPreset[], prefix = ""): [Period, (p: { key: string; from?: string; to?: string }) => void] {
  const [params, setParams] = useSearchParams();
  const key = params.get(`${prefix}period`) ?? presets[0].key;
  const from = params.get(`${prefix}from`);
  const to = params.get(`${prefix}to`);
  let period: Period;
  const preset = presets.find((p) => p.key === key);
  if (key === "custom" && isDay(from) && isDay(to) && from <= to) {
    period = { key, from, to, label: rangeLabel(from, to) };
  } else {
    const p = preset ?? presets[0];
    const r = p.range();
    period = { key: p.key, from: r?.from ?? null, to: r?.to ?? null, label: p.label };
  }
  const set = (p: { key: string; from?: string; to?: string }) => {
    const next = new URLSearchParams(params);
    next.set(`${prefix}period`, p.key);
    if (p.key === "custom" && p.from && p.to) {
      next.set(`${prefix}from`, p.from);
      next.set(`${prefix}to`, p.to);
    } else {
      next.delete(`${prefix}from`);
      next.delete(`${prefix}to`);
    }
    next.delete("page");
    setParams(next, { replace: true });
  };
  return [period, set];
}

export function PeriodPicker({
  presets,
  value,
  onChange,
  maxDays,
  label,
  className,
}: {
  presets: PeriodPreset[];
  value: Period;
  onChange: (p: { key: string; from?: string; to?: string }) => void;
  maxDays: number;
  label: string;
  className?: string;
}) {
  const today = todayLondon();
  const [custom, setCustom] = useState(value.key === "custom");
  const [from, setFrom] = useState(value.from ?? addDays(today, -6));
  const [to, setTo] = useState(value.to ?? today);

  useEffect(() => {
    setCustom(value.key === "custom");
    if (value.key === "custom" && value.from && value.to) {
      setFrom(value.from);
      setTo(value.to);
    }
  }, [value.key, value.from, value.to]);

  const error = !isDay(from) || !isDay(to)
    ? "Pick both dates"
    : to < from
      ? "The end date is before the start date"
      : to > today
        ? "Pick days up to today"
        : addDays(from, maxDays - 1) < to
          ? `Pick ${maxDays} days or fewer`
          : null;

  const apply = (f: string, t: string) => {
    setFrom(f);
    setTo(t);
    if (isDay(f) && isDay(t) && f <= t && t <= today && addDays(f, maxDays - 1) >= t) onChange({ key: "custom", from: f, to: t });
  };

  // With many options, phones get a plain select instead of tabs.
  const compact = presets.length + 1 > 3;

  return (
    <div className={clsx("flex min-w-0 flex-col gap-2", className)}>
      {compact && (
        <select
          aria-label={label}
          value={custom ? "custom" : value.key}
          onChange={(e) => {
            if (e.target.value === "custom") {
              setCustom(true);
              apply(from, to);
            } else {
              setCustom(false);
              onChange({ key: e.target.value });
            }
          }}
          className="h-10 w-full rounded-[10px] border border-line bg-white px-3 text-sm text-ink sm:hidden"
        >
          {presets.map((p) => {
            const r = p.range();
            return (
              <option key={p.key} value={p.key}>
                {p.label}
                {r ? ` · ${rangeLabel(r.from, r.to)}` : ""}
              </option>
            );
          })}
          <option value="custom">Custom range…</option>
        </select>
      )}
      <div className={clsx("-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0", compact && "hidden sm:block")}>
        <div role="radiogroup" aria-label={label} className="inline-flex rounded-[10px] bg-paper-2 p-[3px]">
          {presets.map((p) => {
            const on = !custom && value.key === p.key;
            const r = p.range();
            return (
              <button
                key={p.key}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setCustom(false);
                  onChange({ key: p.key });
                }}
                className={clsx(
                  "inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold whitespace-nowrap sm:px-3",
                  on ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink",
                )}
              >
                {p.label}
                {on && r && <span className="hidden font-medium text-muted sm:inline">· {rangeLabel(r.from, r.to)}</span>}
              </button>
            );
          })}
          <button
            type="button"
            role="radio"
            aria-checked={custom}
            onClick={() => {
              setCustom(true);
              apply(from, to);
            }}
            className={clsx(
              "inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold whitespace-nowrap sm:px-3",
              custom ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink",
            )}
          >
            <CalendarRange className="size-3.5" aria-hidden />
            Custom range
            {custom && value.key === "custom" && value.from && value.to && <span className="hidden font-medium text-muted sm:inline">· {rangeLabel(value.from, value.to)}</span>}
          </button>
        </div>
      </div>
      {custom && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
            From
            <input
              type="date"
              value={from}
              max={today}
              onChange={(e) => apply(e.target.value, to)}
              className="h-9 rounded-lg border border-line bg-white px-2 text-sm font-normal text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-ink-2">
            To
            <input
              type="date"
              value={to}
              max={today}
              onChange={(e) => apply(from, e.target.value)}
              className="h-9 rounded-lg border border-line bg-white px-2 text-sm font-normal text-ink"
            />
          </label>
          {error && (
            <span role="alert" className="pb-2 text-xs font-medium text-red-ink">
              {error}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

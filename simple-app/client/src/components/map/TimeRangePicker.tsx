import { useEffect, useRef, useState } from "react";
import { Calendar, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface TimeRange {
  startMs: number;        // epoch ms
  endMs: number;          // epoch ms
  label: string;          // human-readable label for the button trigger
  preset: PresetKey | "custom";
}

type PresetKey = "today" | "yesterday" | "last24h" | "last7d" | "last30d";

const PRESETS: { key: PresetKey; label: string; build: () => { startMs: number; endMs: number } }[] = [
  {
    key: "today",
    label: "Today",
    build: () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      return { startMs: start.getTime(), endMs: Date.now() };
    },
  },
  {
    key: "yesterday",
    label: "Yesterday",
    build: () => {
      const start = new Date();
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      return { startMs: start.getTime(), endMs: end.getTime() };
    },
  },
  {
    key: "last24h",
    label: "Last 24 hours",
    build: () => ({ startMs: Date.now() - 24 * 3600 * 1000, endMs: Date.now() }),
  },
  {
    key: "last7d",
    label: "Last 7 days",
    build: () => ({ startMs: Date.now() - 7 * 24 * 3600 * 1000, endMs: Date.now() }),
  },
  {
    key: "last30d",
    label: "Last 30 days",
    build: () => ({ startMs: Date.now() - 30 * 24 * 3600 * 1000, endMs: Date.now() }),
  },
];

export function defaultRange(): TimeRange {
  const built = PRESETS[0].build();   // "Today"
  return { ...built, preset: "today", label: "Today" };
}

function fmtForInput(ms: number): { date: string; time: string } {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function fmtRangeShort(r: { startMs: number; endMs: number }): string {
  const s = new Date(r.startMs);
  const e = new Date(r.endMs);
  const sameDay =
    s.getFullYear() === e.getFullYear() &&
    s.getMonth() === e.getMonth() &&
    s.getDate() === e.getDate();
  const dayPart = (d: Date) =>
    d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const timePart = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return sameDay
    ? `${dayPart(s)} ${timePart(s)}–${timePart(e)}`
    : `${dayPart(s)} ${timePart(s)} → ${dayPart(e)} ${timePart(e)}`;
}

interface Props {
  value: TimeRange;
  onChange: (r: TimeRange) => void;
  /** When true, shows an "(applies to Route + Heatmap)" hint inline */
  affectsHistoryOnly?: boolean;
  /** Disabled = greyed out, not interactive (e.g. Live mode) */
  disabled?: boolean;
}

export function TimeRangePicker({ value, onChange, affectsHistoryOnly, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(value.preset === "custom");
  const [draft, setDraft] = useState(() => ({
    start: fmtForInput(value.startMs),
    end: fmtForInput(value.endMs),
  }));
  const ref = useRef<HTMLDivElement>(null);

  // Refresh draft when value prop changes externally
  useEffect(() => {
    setDraft({ start: fmtForInput(value.startMs), end: fmtForInput(value.endMs) });
    setShowCustom(value.preset === "custom");
  }, [value.startMs, value.endMs, value.preset]);

  // Outside-click close
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choosePreset = (p: typeof PRESETS[number]) => {
    const built = p.build();
    onChange({ ...built, preset: p.key, label: p.label });
    setOpen(false);
  };

  const applyCustom = () => {
    const startMs = Date.parse(`${draft.start.date}T${draft.start.time}:00`);
    const endMs = Date.parse(`${draft.end.date}T${draft.end.time}:00`);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return;
    if (endMs < startMs) return;
    onChange({
      startMs,
      endMs,
      preset: "custom",
      label: fmtRangeShort({ startMs, endMs }),
    });
    setOpen(false);
  };

  const triggerLabel = value.label;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-md border bg-background text-xs font-medium transition-colors ${
          disabled
            ? "opacity-50 cursor-not-allowed"
            : "border-border hover:bg-accent"
        }`}
      >
        <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
        {triggerLabel}
        <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-[1100] w-72 rounded-lg border bg-popover shadow-lg overflow-hidden">
          {affectsHistoryOnly && (
            <p className="text-[10px] text-muted-foreground bg-muted/50 px-3 py-1.5 border-b">
              Applies to Route &amp; Heatmap modes (Live mode is always &ldquo;now&rdquo;).
            </p>
          )}
          <div className="py-1">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => choosePreset(p)}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center justify-between ${
                  value.preset === p.key ? "bg-accent/50 font-medium" : ""
                }`}
              >
                <span>{p.label}</span>
                {value.preset === p.key && <span className="text-primary text-xs">✓</span>}
              </button>
            ))}
            <div className="border-t my-1" />
            <button
              onClick={() => setShowCustom((s) => !s)}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-accent flex items-center justify-between ${
                value.preset === "custom" ? "bg-accent/50 font-medium" : ""
              }`}
            >
              <span>Custom range</span>
              <ChevronDown className={`h-3 w-3 transition-transform ${showCustom ? "rotate-180" : ""}`} />
            </button>
          </div>

          {showCustom && (
            <div className="border-t px-3 py-2 space-y-2">
              <div>
                <label className="text-[10px] text-muted-foreground block mb-0.5">From</label>
                <div className="flex gap-1">
                  <input
                    type="date"
                    value={draft.start.date}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, start: { ...d.start, date: e.target.value } }))
                    }
                    className="flex-1 text-xs border rounded px-2 py-1 bg-background"
                  />
                  <input
                    type="time"
                    value={draft.start.time}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, start: { ...d.start, time: e.target.value } }))
                    }
                    className="text-xs border rounded px-2 py-1 bg-background w-24"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground block mb-0.5">To</label>
                <div className="flex gap-1">
                  <input
                    type="date"
                    value={draft.end.date}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, end: { ...d.end, date: e.target.value } }))
                    }
                    className="flex-1 text-xs border rounded px-2 py-1 bg-background"
                  />
                  <input
                    type="time"
                    value={draft.end.time}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, end: { ...d.end, time: e.target.value } }))
                    }
                    className="text-xs border rounded px-2 py-1 bg-background w-24"
                  />
                </div>
              </div>
              <Button size="sm" className="w-full h-7 text-xs" onClick={applyCustom}>
                Apply
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

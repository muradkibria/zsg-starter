// "Time in each zone": hours, bags and a 7-day sparkline per zone, plus the
// share of all time out that was spent inside a zone.

import { memo } from "react";
import clsx from "clsx";
import { Circle, Pentagon } from "lucide-react";
import { describeZoneShape, todayLondon, ZONE_TYPE_LABEL, type ZoneDto, type ZoneStatsResponse } from "@digilite/shared";
import { Card, CardHeader, EmptyState, Spinner } from "@/components/ui";
import { dayLabel, shortDate } from "@/lib/format";

export function zoneHours(seconds: number): string {
  const h = seconds / 3600;
  if (h <= 0) return "0 h";
  if (h < 0.05) return "under 0.1 h";
  return h >= 100 ? `${Math.round(h).toLocaleString("en-GB")} h` : `${h.toFixed(1)} h`;
}

function Sparkline({ values, days, hasData, max, selected }: { values: number[]; days: string[]; hasData: boolean[]; max: number; selected: boolean }) {
  const today = todayLondon();
  const text = days.map((d, i) => `${dayLabel(d)}: ${hasData[i] ? zoneHours(values[i]) + (d === today ? " so far" : "") : "no data"}`).join(", ");
  return (
    <span role="img" aria-label={`Hours per day. ${text}`} title={text} className="flex h-7 shrink-0 items-end gap-[3px]">
      {values.map((v, i) => (
        <span
          key={days[i]}
          className={clsx(
            "w-[7px] rounded-[2px]",
            !hasData[i] ? "bg-rule" : days[i] === today ? "bg-st-day/40" : selected ? "bg-navy" : "bg-st-day",
          )}
          style={{ height: hasData[i] ? Math.max(3, Math.round((v / max) * 28)) : 3 }}
        />
      ))}
    </span>
  );
}

export const ZoneList = memo(function ZoneList({
  zones,
  stats,
  loading,
  selectedId,
  periodLabel,
  onSelect,
}: {
  zones: ZoneDto[];
  stats: ZoneStatsResponse | undefined;
  loading: boolean;
  selectedId: string | null;
  periodLabel: string;
  onSelect: (id: string) => void;
}) {
  const byId = new Map((stats?.zones ?? []).map((s) => [s.zoneId, s]));
  const rows = zones
    .map((z) => ({ z, s: byId.get(z.id) }))
    .sort((a, b) => Number(b.z.active) - Number(a.z.active) || (b.s?.seconds ?? -1) - (a.s?.seconds ?? -1) || a.z.name.localeCompare(b.z.name));
  const max = Math.max(1, ...rows.flatMap((r) => r.s?.daily ?? []));
  const share = stats && stats.onSeconds > 0 ? Math.min(1, stats.share) : null;
  const spark = stats?.sparkDays ?? [];
  const missing = stats ? stats.sparkHasData.filter((x) => !x).length : 0;

  return (
    <Card className="flex flex-col gap-3 p-4 md:p-5" aria-label="Time in each zone">
      <CardHeader title="Time in each zone" sub={`${periodLabel} · fleet hours`} />
      {stats &&
        (stats.onSeconds > 0 && share != null ? (
          <div className="flex flex-col gap-1.5">
            <p className="m-0 text-[13px] text-ink-2">
              <strong className="text-ink">{zoneHours(stats.zoneSeconds)}</strong> of {zoneHours(stats.onSeconds)} out was inside a zone ({Math.round(share * 100)}%).
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-paper-2" aria-hidden>
              <div className="h-full rounded-full bg-navy" style={{ width: `${share * 100}%` }} />
            </div>
            <p className="m-0 text-xs text-muted">
              {stats.bagsOut} {stats.bagsOut === 1 ? "bag" : "bags"} out
              {stats.days > 1 && ` on ${stats.daysWithData} of ${stats.days} days`}
            </p>
          </div>
        ) : (
          <p className="m-0 text-[13px] text-muted">No bags were out in this period, so there's no zone time to show.</p>
        ))}

      {loading && !stats && <Spinner label="Adding up time in each zone…" />}

      {zones.length === 0 ? (
        <EmptyState title="No zones yet" body="Add a zone to start measuring how long bags spend in the areas that matter to clients." />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {rows.map(({ z, s }) => {
            const selected = z.id === selectedId;
            return (
              <li key={z.id}>
                <button
                  type="button"
                  onClick={() => onSelect(z.id)}
                  aria-current={selected ? "true" : undefined}
                  className={clsx(
                    "flex w-full items-center gap-3 rounded-[11px] border px-3 py-2.5 text-left transition-colors",
                    selected ? "border-accent bg-tint-2" : "border-rule-soft bg-white hover:border-line",
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className={clsx("truncate text-[13px] font-bold", !z.active && "text-muted")}>{z.name}</span>
                    <span className="truncate text-[11px] text-muted">
                      {s ? `${s.bags} ${s.bags === 1 ? "bag" : "bags"}` : "—"} · {ZONE_TYPE_LABEL[z.type]}
                    </span>
                    <span className={clsx("flex items-center gap-1 text-[11px] font-semibold", selected ? "text-accent" : "text-caption")}>
                      {z.kind === "circle" ? <Circle className="size-3" aria-hidden /> : <Pentagon className="size-3" aria-hidden />}
                      {z.active ? describeZoneShape(z) : "Not counted"}
                    </span>
                  </span>
                  {s && spark.length > 0 && <Sparkline values={s.daily} days={spark} hasData={stats!.sparkHasData} max={max} selected={selected} />}
                  <span className="num w-[62px] shrink-0 text-right font-display text-base font-semibold">{s ? zoneHours(s.seconds) : "—"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {spark.length > 0 && zones.length > 0 && (
        <p className="m-0 text-[11px] leading-relaxed text-caption">
          Bars show each day from {shortDate(new Date(`${spark[0]}T12:00:00Z`))} to {shortDate(new Date(`${spark[spark.length - 1]}T12:00:00Z`))}
          {spark.includes(todayLondon()) && ", with today so far lighter"}.
          {missing > 0 && stats?.firstDataDay && ` Routes are stored from ${shortDate(new Date(`${stats.firstDataDay}T12:00:00Z`))}, so earlier days are blank.`}
        </p>
      )}
    </Card>
  );
});

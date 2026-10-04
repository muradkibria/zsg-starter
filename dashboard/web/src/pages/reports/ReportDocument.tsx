// The client report itself — the paper the advertiser sees. Measured numbers
// only; estimated reach stays out until its method is agreed; rider names only
// when switched on. Layout follows the paper's own width (container queries),
// so it's the same on screen, on a phone and on A4.

import clsx from "clsx";
import type { CampaignReport, ReportSection } from "@digilite/shared";
import { EstimateBox } from "@/components/ui";
import { DailyBars, HBarList } from "../campaigns/components/charts";
import { PlayedMap } from "../campaigns/components/PlayedMap";
import { date as fmtDate } from "@/lib/format";
import { dayRange, dayShort, kmText, n, screenHours } from "../campaigns/format";

export function ReportDocument({
  report,
  sections,
  summary,
  onMapSnapshot,
  mapImage,
  className,
}: {
  report: CampaignReport;
  sections: ReportSection[];
  summary: string;
  onMapSnapshot?: (url: string) => void;
  mapImage?: string | null;
  className?: string;
}) {
  const on = (k: ReportSection) => sections.includes(k);
  const s = report.stats;
  const t = s.totals;
  const c = report.campaign;
  const clipped = report.fromDay !== report.requested.fromDay;
  const hasPlays = t.plays > 0;
  const riderCol = report.riderNames.included && s.bags.some((b) => b.riders?.length);

  return (
    <article aria-label="Client report" className={clsx("dl-report-paper @container mx-auto w-full max-w-[794px] overflow-hidden rounded-sm bg-white text-ink shadow-[0_18px_48px_rgb(16_24_43/0.16)]", className)}>
      <header className="flex flex-col gap-4 bg-navy px-6 py-5 text-white @xl:flex-row @xl:items-center @xl:px-9 @xl:py-6">
        <div className="flex items-center gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white p-1.5">
            <img src="/digilite-mark.png" alt="" className="size-full" />
          </span>
          <div>
            <div className="font-display text-[22px] leading-tight font-bold tracking-wide">DigiLite</div>
            <div className="text-[10.5px] font-semibold tracking-[0.2em] text-white/70">PROOF OF PLAY</div>
          </div>
        </div>
        <div className="min-w-0 @xl:ml-auto @xl:text-right">
          <div className="font-display text-lg leading-snug font-semibold">
            {c.advertiser} · {c.name}
          </div>
          <div className="text-[13px] text-white/80">{dayRange(report.fromDay, report.toDay, { long: true })}</div>
        </div>
      </header>

      <div className="flex flex-col gap-6 px-6 py-6 @xl:px-9 @xl:py-7">
        {c.demo && <p className="m-0 rounded-md border border-dashed border-line px-3 py-1.5 text-xs text-muted">Demo campaign — a sample contract used for walkthroughs. The plays and routes shown are real measurements.</p>}

        {on("summary") && summary.trim() && <p className="m-0 text-[15px] leading-relaxed whitespace-pre-line text-ink">{summary.trim()}</p>}

        {on("measured") && (
          <section className="flex flex-col gap-2.5 break-inside-avoid">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[11px] font-bold tracking-[0.12em] text-ink uppercase">Measured</span>
              <span className="text-xs text-muted">counted by the bags' play logs and GPS</span>
            </div>
            <div className="grid grid-cols-2 gap-2 @xl:grid-cols-4">
              <Kpi label="Plays" value={n(t.plays)} />
              <Kpi label="Time on screen" value={screenHours(t.seconds)} />
              <Kpi label="Bags" value={n(t.bags)} />
              <Kpi label="Distance ridden" value={kmText(t.km)} sub="by those bags, on the days it played" />
            </div>
          </section>
        )}

        {hasPlays && (on("daily") || on("hours")) && (
          <div className={clsx("grid gap-6 break-inside-avoid", on("daily") && on("hours") && "@xl:grid-cols-[3fr_2fr]")}>
            {on("daily") && (
              <section className="flex min-w-0 flex-col gap-1">
                <h3 className="m-0 text-sm font-bold">Plays per day</h3>
                <DailyBars days={s.perDay} height={120} />
              </section>
            )}
            {on("hours") && (
              <section className="flex min-w-0 flex-col gap-2">
                <h3 className="m-0 text-sm font-bold">
                  Time of day <span className="font-normal text-muted">· London time</span>
                </h3>
                <HBarList
                  dense
                  rows={report.timeOfDay.map((b) => ({
                    key: b.key,
                    label: (
                      <>
                        {b.label} <span className="text-muted">{b.range}</span>
                      </>
                    ),
                    value: b.plays,
                    display: `${Math.round(b.share * 100)}%`,
                  }))}
                />
              </section>
            )}
          </div>
        )}

        {hasPlays && (on("map") || on("zones")) && (
          <div className={clsx("grid gap-6 break-inside-avoid", on("map") && on("zones") && "@xl:grid-cols-[6fr_5fr]")}>
            {on("map") && (
              <section className="flex min-w-0 flex-col gap-1.5">
                <h3 className="m-0 text-sm font-bold">Where it played</h3>
                <div className="relative h-[240px] overflow-hidden rounded-lg border border-rule @xl:h-[260px]">
                  <div className={clsx("absolute inset-0", mapImage && "print:hidden")}>
                    <PlayedMap map={s.map} zones={s.zones} interactive={false} className="absolute inset-0" onSnapshot={onMapSnapshot} />
                  </div>
                  {mapImage && <img src={mapImage} alt="Map of where the ad played" className="absolute inset-0 hidden size-full object-cover print:block" />}
                </div>
                <p className="m-0 text-[11px] text-muted">
                  Routes of the bags carrying it on {s.map.days.map((d) => dayShort(d)).join(", ")}, while it played. Map data © OpenStreetMap contributors.
                </p>
              </section>
            )}
            {on("zones") && (
              <section className="flex min-w-0 flex-col gap-2">
                <h3 className="m-0 text-sm font-bold">Time in zones</h3>
                <p className="m-0 -mt-1 text-[11px] text-muted">Hours the bags carrying it spent in each zone, on the days it played</p>
                {s.zones.length ? (
                  <HBarList dense rows={s.zones.slice(0, 6).map((z) => ({ key: z.zoneId, label: z.name, value: z.seconds, display: screenHours(z.seconds) }))} />
                ) : (
                  <p className="m-0 text-[13px] text-muted">The bags didn't pass through a zone on those days.</p>
                )}
              </section>
            )}
          </div>
        )}

        {hasPlays && on("bags") && (
          <section className={clsx("flex flex-col gap-2", s.bags.length <= 30 && "break-inside-avoid")}>
            <h3 className="m-0 text-sm font-bold break-after-avoid">Bags that played it</h3>
            <table className="w-full border-collapse text-[12.5px]">
              <thead className="text-left text-[11px] text-muted">
                <tr className="border-b border-rule">
                  <th className="py-1.5 pr-2 font-semibold">Bag</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Plays</th>
                  <th className="px-2 py-1.5 text-right font-semibold">On screen</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Days</th>
                  {riderCol && <th className="py-1.5 pl-2 font-semibold">Rider</th>}
                </tr>
              </thead>
              <tbody>
                {s.bags.map((b) => (
                  <tr key={b.bagId} className="border-b border-rule-soft break-inside-avoid">
                    <td className="py-1 pr-2 font-semibold">{b.bagName}</td>
                    <td className="num px-2 py-1 text-right">{n(b.plays)}</td>
                    <td className="num px-2 py-1 text-right">{screenHours(b.seconds)}</td>
                    <td className="num px-2 py-1 text-right">{b.days}</td>
                    {riderCol && <td className="py-1 pl-2">{b.riders?.join(", ")}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {!hasPlays && (on("daily") || on("hours") || on("map") || on("zones") || on("bags")) && (
          <p className="m-0 rounded-lg bg-paper px-4 py-3 text-[13px] text-muted">No plays were recorded in this period, so there are no charts or map to show.</p>
        )}

        {on("estimate") && (
          <EstimateBox className="break-inside-avoid">
            <p className="m-0 text-[13px] text-ink-2">
              <strong className="text-ink">Reach and impressions.</strong> {report.estimate.note} Every figure above is measured by the bags.
            </p>
          </EstimateBox>
        )}

        <footer className="flex flex-col gap-1 border-t border-rule pt-3 text-[11px] text-muted @xl:flex-row @xl:justify-between">
          <span>
            {report.riderNames.included ? "Rider names are shown as first name and initial." : "Rider names are not included."} Locations come from each bag's GPS.
            {clipped && ` Play records begin ${dayShort(report.fromDay)}.`}
          </span>
          <span className="shrink-0">Prepared {fmtDate(report.preparedAt)} · DigiLite</span>
        </footer>
      </div>
    </article>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-tint-2 px-3.5 py-3">
      <span className="text-xs text-muted">{label}</span>
      <span className="font-display text-[22px] leading-tight font-semibold">{value}</span>
      {sub && <span className="text-[10.5px] leading-snug text-muted">{sub}</span>}
    </div>
  );
}

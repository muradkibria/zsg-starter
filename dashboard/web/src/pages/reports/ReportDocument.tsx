// The client report itself — the paper the advertiser sees, in A4 pages:
//   1. at a glance: measured numbers, estimated impressions, a heat map of where it played;
//   2. when and where: plays per day, time of day, estimated impressions per
//      day and by time of day, time in zones;
//   3. a page for each day it played, each with its own map.
// Measured numbers (plays, time on screen, km) are always kept apart from the
// estimated impressions, which are labelled as such. The estimate comes from TfL
// station footfall around the path the bags took, but stations are an internal
// input: the report never names or marks them. Rider names only when
// switched on. Layout follows the paper's own width (container queries), so it's
// the same on screen, on a phone and on A4.

import type { ReactNode } from "react";
import clsx from "clsx";
import { roundEstimate, type CampaignReport, type ReportDay, type ReportSection } from "@digilite/shared";
import { date as fmtDate } from "@/lib/format";
import { DailyBars, HBarList, HourBars } from "../campaigns/components/charts";
import { dayRange, dayShort, hourLabel, kmText, n, screenHours } from "../campaigns/format";
import { HeatMap } from "./HeatMap";

const longDay = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
const dayTitle = (day: string) => longDay.format(new Date(`${day}T12:00:00Z`));
/** "≈ 12,000" */
const est = (v: number) => `≈ ${n(roundEstimate(v))}`;

/** The maps a report draws (keys for their print snapshots): the whole period, then each day it played. */
export function reportMapKeys(report: CampaignReport, sections: ReportSection[]): string[] {
  if (report.stats.totals.plays <= 0) return [];
  return [
    ...(sections.includes("map") && report.hexes.length ? ["period"] : []),
    ...(sections.includes("days") ? report.days.filter((d) => d.plays > 0 && d.hexes.length).map((d) => d.day) : []),
  ];
}

export function ReportDocument({
  report,
  sections,
  summary,
  onMapSnapshot,
  mapImages = {},
  className,
}: {
  report: CampaignReport;
  sections: ReportSection[];
  summary: string;
  onMapSnapshot?: (key: string, url: string) => void;
  mapImages?: Record<string, string>;
  className?: string;
}) {
  const on = (k: ReportSection) => sections.includes(k);
  const s = report.stats;
  const t = s.totals;
  const c = report.campaign;
  const imp = report.impressions;
  const clipped = report.fromDay !== report.requested.fromDay;
  const hasPlays = t.plays > 0;
  const riderCol = report.riderNames.included && s.bags.some((b) => b.riders?.length);
  const playedDays = report.days.filter((d) => d.plays > 0);
  const showEstimate = on("estimate");

  const map = (key: string, node: ReactNode, alt: string, height = "h-[300px] @xl:h-[330px]") => (
    <div className={clsx("relative overflow-hidden rounded-lg border border-rule bg-paper-3", height)}>
      <div className={clsx("absolute inset-0", mapImages[key] && "print:hidden")}>{node}</div>
      {mapImages[key] && <img src={mapImages[key]} alt={alt} className="absolute inset-0 hidden size-full object-cover print:block" />}
    </div>
  );

  return (
    <article aria-label="Client report" className={clsx("dl-report-paper @container mx-auto w-full max-w-[794px] overflow-hidden rounded-sm bg-white text-ink shadow-[0_18px_48px_rgb(16_24_43/0.16)]", className)}>
      {/* ── 1 · At a glance ───────────────────────────────────────────── */}
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

        {(on("measured") || showEstimate) && (
          <section className={clsx("grid grid-cols-2 gap-2 break-inside-avoid", on("measured") && showEstimate && hasPlays ? "@xl:grid-cols-5" : "@xl:grid-cols-4")}>
            {on("measured") && (
              <>
                <Kpi label="Plays" value={n(t.plays)} />
                <Kpi label="Time on screen" value={screenHours(t.seconds)} />
                <Kpi label="Bags" value={n(t.bags)} sub={`on ${t.daysWithPlays} ${t.daysWithPlays === 1 ? "day" : "days"}`} />
                <Kpi label="Distance ridden" value={kmText(t.km)} sub="by those bags, on the days it played" />
              </>
            )}
            {showEstimate && hasPlays && <Kpi label="Estimated impressions" value={est(imp.total)} />}
          </section>
        )}

        {hasPlays && on("map") && report.hexes.length > 0 && (
          <section className="flex flex-col gap-1.5 break-inside-avoid">
            <h3 className="m-0 text-sm font-bold">Where it played</h3>
            {map(
              "period",
              <HeatMap
                hexes={report.hexes}
                label="Heat map of where the ad played"
                className="absolute inset-0"
                onSnapshot={onMapSnapshot && ((url) => onMapSnapshot("period", url))}
              />,
              "Heat map of where the ad played",
            )}
            <HeatLegend />
          </section>
        )}

        {!hasPlays && <p className="m-0 rounded-lg bg-paper px-4 py-3 text-[13px] text-muted">No plays were recorded in this period, so there are no charts or maps to show.</p>}
      </div>

      {/* ── 2 · When and where ───────────────────────────────────────── */}
      {hasPlays && (on("daily") || on("hours") || on("zones") || showEstimate || on("bags")) && (
        <Page title="When and where" sub={dayRange(report.fromDay, report.toDay, { long: true })}>
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

          {showEstimate && (
            <section className="flex flex-col gap-2 break-inside-avoid">
              <h3 className="m-0 text-sm font-bold">Estimated impressions</h3>
              <div className="grid gap-6 @xl:grid-cols-2">
                <HBarList
                  dense
                  rows={playedDays.map((d) => ({ key: d.day, label: dayTitle(d.day), value: d.impressions, display: est(d.impressions) }))}
                />
                <HBarList
                  dense
                  rows={report.impressionsTimeOfDay.map((b) => ({
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
              </div>
            </section>
          )}
          {on("zones") && (
            <section className="flex flex-col gap-2 break-inside-avoid">
              <h3 className="m-0 text-sm font-bold">Time in zones</h3>
              <p className="m-0 -mt-1 text-[11px] text-muted">Hours the bags carrying it spent in each zone, on the days it played</p>
              {s.zones.length ? (
                <HBarList dense columns={2} rows={s.zones.slice(0, 6).map((z) => ({ key: z.zoneId, label: z.name, value: z.seconds, display: screenHours(z.seconds) }))} />
              ) : (
                <p className="m-0 text-[13px] text-muted">The bags didn't pass through a zone on those days.</p>
              )}
            </section>
          )}
          {on("bags") && (
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
        </Page>
      )}

      {/* ── 3 · Day by day ────────────────────────────────────────────── */}
      {hasPlays &&
        on("days") &&
        playedDays.map((d) => (
          <DayPage
            key={d.day}
            d={d}
            report={report}
            showEstimate={showEstimate}
            mapNode={
              d.hexes.length > 0 &&
              map(
                d.day,
                <HeatMap
                  hexes={d.hexes}
                    label={`Heat map of where the ad played on ${dayTitle(d.day)}`}
                  className="absolute inset-0"
                  onSnapshot={onMapSnapshot && ((url) => onMapSnapshot(d.day, url))}
                />,
                `Heat map of where the ad played on ${dayTitle(d.day)}`,
                "h-[330px] @xl:h-[380px]",
              )
            }
          />
        ))}

      <footer className="flex flex-col gap-1 border-t border-rule px-6 py-3 text-[11px] text-muted @xl:flex-row @xl:justify-between @xl:px-9">
        <span>
          {report.riderNames.included ? "Rider names are shown as first name and initial." : "Rider names are not included."} Locations from each bag's GPS. Map data © OpenStreetMap
          contributors.
          {clipped && ` Play records begin ${dayShort(report.fromDay)}.`}
        </span>
        <span className="shrink-0">Prepared {fmtDate(report.preparedAt)} · DigiLite</span>
      </footer>
    </article>
  );
}

/** A new A4 page in print; a ruled section on screen. */
function Page({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="dl-report-page flex flex-col gap-6 border-t-[6px] border-paper-2 px-6 py-6 break-before-page @xl:px-9 @xl:py-7 print:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-rule pb-2">
        <h2 className="m-0 font-display text-xl font-semibold">{title}</h2>
        {sub && <span className="text-[13px] text-muted">{sub}</span>}
      </div>
      {children}
    </section>
  );
}

function DayPage({ d, report, showEstimate, mapNode }: { d: ReportDay; report: CampaignReport; showEstimate: boolean; mapNode: ReactNode }) {
  const zone = d.zones[0];
  const peak = [...d.impressionsTimeOfDay].sort((a, b) => b.plays - a.plays)[0];
  const lines = [
    d.busiest && `Busiest three hours: ${hourLabel(d.busiest.startHour)}–${hourLabel(d.busiest.endHour % 24)}, with ${n(d.busiest.plays)} plays.`,
    zone && `Most time in ${zone.name} (${screenHours(zone.seconds)}).`,
    showEstimate && peak && peak.plays > 0 && `Most estimated impressions in the ${peak.label.toLowerCase()} (${peak.range}).`,
  ].filter(Boolean);
  return (
    <Page title={dayTitle(d.day)} sub={`${report.campaign.advertiser} · ${report.campaign.name}`}>
      <div className={clsx("grid grid-cols-2 gap-2", showEstimate ? "@xl:grid-cols-5" : "@xl:grid-cols-4")}>
        <Kpi label="Plays" value={n(d.plays)} />
        <Kpi label="On screen" value={screenHours(d.seconds)} />
        <Kpi label="Bags" value={n(d.bags)} />
        <Kpi label="Distance" value={kmText(d.km)} />
        {showEstimate && <Kpi label="Est. impressions" value={est(d.impressions)} />}
      </div>
      {mapNode && (
        <section className="flex flex-col gap-1.5 break-inside-avoid">
          {mapNode}
          <HeatLegend />
        </section>
      )}
      {lines.length > 0 && <p className="m-0 text-[14px] leading-relaxed text-ink">{lines.join(" ")}</p>}
      <div className="grid gap-6 break-inside-avoid @xl:grid-cols-[3fr_2fr]">
        <section className="flex min-w-0 flex-col gap-1">
          <h3 className="m-0 text-sm font-bold">
            Hour by hour <span className="font-normal text-muted">· plays, London time</span>
          </h3>
          <HourBars byHour={d.byHour} height={110} />
        </section>
        {showEstimate ? (
          <section className="flex min-w-0 flex-col gap-2">
            <h3 className="m-0 text-sm font-bold">
              Estimated impressions <span className="font-normal text-muted">· by time of day</span>
            </h3>
            <HBarList
              dense
              rows={d.impressionsTimeOfDay.map((b) => ({
                key: b.key,
                label: (
                  <>
                    {b.label} <span className="text-muted">{b.range}</span>
                  </>
                ),
                value: b.plays,
                display: b.plays > 0 ? est(b.plays) : "—",
              }))}
            />
          </section>
        ) : (
          <section className="flex min-w-0 flex-col gap-2">
            <h3 className="m-0 text-sm font-bold">Time in zones</h3>
            {d.zones.length ? (
              <HBarList dense rows={d.zones.slice(0, 5).map((z) => ({ key: z.zoneId, label: z.name, value: z.seconds, display: screenHours(z.seconds) }))} />
            ) : (
              <p className="m-0 text-[13px] text-muted">No zones that day.</p>
            )}
          </section>
        )}
      </div>
    </Page>
  );
}

function HeatLegend() {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-muted">
      Less
      <span className="h-2 w-20 rounded-sm" style={{ background: "linear-gradient(90deg,rgba(127,161,230,0.35),#2f5fd0,#061b47)" }} />
      More time on screen, while the ad played
    </div>
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

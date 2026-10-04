// One campaign: how it reaches the street (creatives → loops → bags → riders),
// what the bags measured for a period, where it played, and a way into the
// client report. Estimated reach stays out until its method is agreed.

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import clsx from "clsx";
import { FileText, Link2, Pencil, Table2 } from "lucide-react";
import { todayLondon, type CampaignDetail, type CampaignStats } from "@digilite/shared";
import { Button, Card, CardHeader, EmptyState, ErrorState, EstimateBox, LinkButton, Notice, Page, PageHeader, Spinner, Stat } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useCampaign, useCampaignStats, useSuggestedCreatives } from "./api";
import { CampaignForm } from "./components/CampaignForm";
import { ChainStrip } from "./components/ChainStrip";
import { ChartTable, DailyBars, HBarList, HourBars } from "./components/charts";
import { CreativePicker } from "./components/CreativePicker";
import { CreativeThumb } from "./components/CreativeThumb";
import { PeriodPicker } from "./components/PeriodPicker";
import { PlayedMap } from "./components/PlayedMap";
import { DemoPill, StatusPill } from "./components/StatusPill";
import { dayDiff, dayRange, dayShort, dayWeek, hourLabel, kmText, n, plural, presetPeriod, screenHours, type Period } from "./format";

export default function CampaignPage() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const q = useCampaign(id);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const c = q.data;

  if (q.isLoading) return <Page><Spinner label="Loading the campaign…" /></Page>;
  if (q.error || !c)
    return (
      <Page>
        <PageHeader title="Campaign" crumbs={[{ label: "Campaigns", to: "/campaigns" }]} />
        <ErrorState error={q.error ?? new Error("Campaign not found")} retry={() => void q.refetch()} />
      </Page>
    );

  const canEdit = can("campaigns.edit");
  const today = todayLondon();
  const running = !!c.startDay && !!c.endDay && c.startDay <= today && today <= c.endDay;
  const dayNote = running ? `day ${dayDiff(c.startDay!, today) + 1} of ${dayDiff(c.startDay!, c.endDay!) + 1}` : null;

  return (
    <Page>
      <PageHeader
        crumbs={[{ label: "Campaigns", to: "/campaigns" }, { label: c.advertiser }]}
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span>{c.name}</span>
            <StatusPill status={c.status} className="text-[13px]" />
            {c.demo && <DemoPill />}
          </span>
        }
        sub={[c.advertiser, dayRange(c.startDay, c.endDay), dayNote, `${plural(c.contractedBags, "bag")} contracted`].filter(Boolean).join(" · ")}
        actions={
          <>
            {canEdit && (
              <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            <LinkButton to={`/reports?campaign=${c.id}`} variant="primary" icon={<FileText className="size-4" />}>
              Build client report
            </LinkButton>
          </>
        }
      />

      <StatusProblem c={c} canEdit={canEdit} onLink={() => setPicking(true)} />
      {c.notes && <p className="m-0 -mt-2 text-[13px] text-muted">Notes: {c.notes}</p>}

      <ChainStrip c={c} onLink={() => setPicking(true)} canEdit={canEdit} />

      <CreativesCard c={c} canEdit={canEdit} onLink={() => setPicking(true)} />

      <Measured c={c} />

      <EstimateBox>
        <p className="m-0 text-sm font-semibold text-ink">Reach and impressions</p>
        <p className="m-0 mt-1 text-[13px] text-ink-2">Estimated reach isn't included until the method is agreed. Everything above is measured by the bags.</p>
      </EstimateBox>

      {canEdit && <CampaignForm open={editing} onClose={() => setEditing(false)} campaign={c} />}
      {canEdit && <CreativePicker open={picking} onClose={() => setPicking(false)} campaign={c} />}
    </Page>
  );
}

function StatusProblem({ c, canEdit, onLink }: { c: CampaignDetail; canEdit: boolean; onLink: () => void }) {
  const { can } = useAuth();
  if (!c.status.warn) return null;
  if (c.status.phase === "ended_on_screen")
    return (
      <Notice
        tone="red"
        action={can("loops.edit") ? <Link to="/loops" className="shrink-0 font-bold text-red-ink">Fix the loop</Link> : undefined}
      >
        <strong>Ended {c.endDay ? dayShort(c.endDay) : ""}, but still on screen.</strong> {plural(c.bagsAfterEnd, "bag")} played it in the last 7 days — {n(c.playsAfterEnd)} plays
        after its end date so far. Take it out of the loop, or extend the campaign.
      </Notice>
    );
  if (c.creativeFiles === 0)
    return (
      <Notice tone="amber" action={canEdit ? <button type="button" onClick={onLink} className="shrink-0 font-bold text-amber-ink underline">Link creatives</button> : undefined}>
        <strong>No creatives linked.</strong> Link this campaign's ad files so the plays the bags record can be counted for it.
      </Notice>
    );
  return (
    <Notice tone="amber">
      <strong>{c.status.note}.</strong>{" "}
      {c.status.phase === "draft"
        ? "It's still a draft, but its ads are already playing."
        : c.chain.loops.some((l) => l.bagsPlaying > 0)
          ? "Its loop is on the bags, but they haven't played it — check the schedule."
          : "None of the loops holding its ads is playing on the bags. Add them to the loop the fleet plays."}
    </Notice>
  );
}

function CreativesCard({ c, canEdit, onLink }: { c: CampaignDetail; canEdit: boolean; onLink: () => void }) {
  const files = c.chain.files;
  const suggest = useSuggestedCreatives(c.id, canEdit && files.length === 0);
  const likely = suggest.data?.suggested.filter((f) => !f.campaignId).length ?? 0;
  return (
    <Card className="flex flex-col gap-3 p-4 md:p-5" aria-label="Linked creatives">
      <CardHeader
        title="Creatives"
        sub={files.length ? "Plays of these ad files are counted for this campaign" : undefined}
        action={
          canEdit && (
            <Button size="sm" icon={<Link2 className="size-4" />} onClick={onLink}>
              {files.length ? "Change" : "Link creatives"}
            </Button>
          )
        }
      />
      {files.length === 0 ? (
        <p className="m-0 text-sm text-muted">
          None linked yet.
          {likely > 0 && canEdit && (
            <>
              {" "}
              {plural(likely, "file")} in the library {likely === 1 ? "looks" : "look"} like {c.advertiser}'s —{" "}
              <button type="button" onClick={onLink} className="font-semibold text-accent underline">
                review {likely === 1 ? "it" : "them"}
              </button>
              .
            </>
          )}
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-2.5 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {files.map((f) => {
            const loop = c.chain.loops.find((l) => f.loops.includes(l.name) && l.bagsPlaying > 0);
            return (
              <li key={f.key} className="flex items-center gap-3 rounded-xl border border-rule px-3 py-2.5">
                <CreativeThumb id={f.thumbId} name={f.name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{f.name}</div>
                  <div className="truncate text-xs text-muted">
                    {f.durationS ? `${f.durationS} s · ` : ""}
                    {loop ? `in ${loop.name}, playing on ${plural(loop.bagsPlaying, "bag")}` : f.loops.length ? `in ${f.loops[0]}${f.loops.length > 1 ? ` +${f.loops.length - 1}` : ""} · not playing` : "not in a loop"}
                  </div>
                  <div className="text-xs text-ink-2">
                    <span className="num font-semibold">{n(f.playsLast7)}</span> plays in the last 7 days
                    {f.ids.length > 1 && <span className="text-muted"> · {f.ids.length} copies</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Measured({ c }: { c: CampaignDetail }) {
  const [period, setPeriod] = useState<Period>(() => presetPeriod("campaign", c));
  useEffect(() => setPeriod(presetPeriod("campaign", c)), [c.id, c.startDay, c.endDay]); // eslint-disable-line react-hooks/exhaustive-deps
  const stats = useCampaignStats(c.id, period.fromDay, period.toDay);
  const s = stats.data;
  const today = todayLondon();
  const upcoming = !!c.startDay && c.startDay > today;

  return (
    <section aria-label="Measured" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="m-0 font-display text-[22px] font-semibold">Measured</h2>
          <p className="m-0 mt-0.5 text-[13px] text-muted">
            Counted by the bags' play logs and GPS · {dayRange(period.fromDay, period.toDay)}
          </p>
        </div>
        <PeriodPicker value={period} onChange={setPeriod} campaign={c} />
      </div>

      {upcoming && period.preset === "campaign" && (
        <Notice tone="info">It starts on {dayShort(c.startDay!)}. Until then this shows the last 7 days, so you can see if its ads are already playing.</Notice>
      )}
      {s?.playsFrom && period.fromDay < s.playsFrom && (
        <Notice tone="info">
          Play records start on {dayShort(s.playsFrom)} — days before that have no data (not zero), so they're shown hatched and left out of the totals.
        </Notice>
      )}
      {stats.error && <ErrorState error={stats.error} retry={() => void stats.refetch()} />}
      {!s && stats.isLoading && <Spinner label="Counting plays…" />}
      {s && <MeasuredBody s={s} stale={stats.isFetching} />}
    </section>
  );
}

function MeasuredBody({ s, stale }: { s: CampaignStats; stale: boolean }) {
  const [table, setTable] = useState<"none" | "days" | "hours">("none");
  const t = s.totals;
  const none = t.plays === 0;
  return (
    <div className={clsx("flex flex-col gap-4 transition-opacity", stale && "opacity-60")}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Plays" value={n(t.plays)} className="bg-white" />
        <Stat label="Time on screen" value={screenHours(t.seconds)} className="bg-white" />
        <Stat label="Bags that played it" value={n(t.bags)} className="bg-white" />
        <Stat label="Days with plays" value={`${t.daysWithPlays} of ${s.perDay.filter((d) => !d.noRecords).length}`} className="bg-white" />
        <Stat label="Distance ridden" value={kmText(t.km)} sub="by those bags, on those days" className="bg-white" />
        <Stat label="Time out" value={screenHours(t.onSeconds)} sub="by those bags, on those days" className="bg-white" />
      </div>

      {none ? (
        <Card>
          <EmptyState
            title="No plays in this period"
            body={s.files.length || s.perDay.length ? "The bags didn't record any plays of this campaign's ads between these dates." : "Link this campaign's creatives to count its plays."}
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
            <Card className="flex flex-col gap-2 p-4 md:p-5" aria-label="Plays per day">
              <CardHeader
                title="Plays per day"
                sub="London days"
                action={
                  <Button size="sm" variant="ghost" icon={<Table2 className="size-4" />} aria-pressed={table === "days"} onClick={() => setTable(table === "days" ? "none" : "days")}>
                    {table === "days" ? "Chart" : "Table"}
                  </Button>
                }
              />
              {table === "days" ? (
                <ChartTable
                  head={["Day", "Plays", "On screen", "Bags"]}
                  rows={s.perDay.map((d) => [dayWeek(d.day), d.noRecords ? "no records" : n(d.plays), d.noRecords ? "—" : screenHours(d.seconds), d.noRecords ? "—" : d.bags])}
                />
              ) : (
                <DailyBars days={s.perDay} />
              )}
            </Card>
            <Card className="flex flex-col gap-2 p-4 md:p-5" aria-label="Time of day">
              <CardHeader
                title="Time of day"
                sub="Plays by hour, London time"
                action={
                  <Button size="sm" variant="ghost" icon={<Table2 className="size-4" />} aria-pressed={table === "hours"} onClick={() => setTable(table === "hours" ? "none" : "hours")}>
                    {table === "hours" ? "Chart" : "Table"}
                  </Button>
                }
              />
              {table === "hours" ? (
                <ChartTable head={["Hour", "Plays"]} rows={s.byHour.map((v, h) => [`${hourLabel(h)}–${hourLabel((h + 1) % 24)}`, n(v)])} />
              ) : (
                <HourBars byHour={s.byHour} />
              )}
            </Card>
          </div>

          <Card className="overflow-hidden" aria-label="Where it played">
            <div id="where-it-played" className="flex flex-col gap-1 px-4 pt-4 md:px-5">
              <h2 className="m-0 font-display text-lg font-semibold">Where it played</h2>
              <p className="m-0 text-[13px] text-muted">
                Routes of the bags that played it on {s.map.days.length ? s.map.days.map(dayShort).join(", ") : "—"}, only during the hours it played (from each bag's GPS).
              </p>
            </div>
            <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_340px]">
              <PlayedMap map={s.map} zones={s.zones} className="m-4 h-[300px] overflow-hidden rounded-xl md:h-[420px] lg:mr-0" />
              <div className="flex flex-col gap-3 p-4 md:p-5">
                <div>
                  <h3 className="m-0 text-sm font-semibold">Time in zones by bags carrying it</h3>
                  <p className="m-0 mt-0.5 text-xs text-muted">Each bag's time in each zone, on the days it played this campaign ({dayRange(s.fromDay, s.toDay)}).</p>
                </div>
                {s.zones.length ? (
                  <HBarList
                    rows={s.zones.map((z) => ({ key: z.zoneId, label: z.name, value: z.seconds, display: screenHours(z.seconds) }))}
                  />
                ) : (
                  <p className="m-0 text-[13px] text-muted">The bags didn't pass through a zone on those days.</p>
                )}
              </div>
            </div>
          </Card>

          <BagsTable s={s} />
        </>
      )}
    </div>
  );
}

function BagsTable({ s }: { s: CampaignStats }) {
  const [all, setAll] = useState(false);
  const showRiders = s.riderNamesIncluded && s.bags.some((b) => b.riders?.length);
  const rows = all ? s.bags : s.bags.slice(0, 10);
  return (
    <Card className="overflow-hidden" aria-label="Bags that played it">
      <div className="px-4 pt-4 pb-2 md:px-5">
        <CardHeader
          title="Bags that played it"
          sub={showRiders ? "Riders by assignment, for internal use only — clients see bag numbers." : "Bag by bag, for the period above."}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-[13px]">
          <thead className="bg-paper/70 text-left text-xs text-muted">
            <tr>
              <th className="px-4 py-2 font-semibold md:px-5">Bag</th>
              <th className="px-3 py-2 text-right font-semibold">Plays</th>
              <th className="px-3 py-2 text-right font-semibold">On screen</th>
              <th className="px-3 py-2 text-right font-semibold">Days</th>
              {showRiders && <th className="px-4 py-2 font-semibold md:px-5">Carried by</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.bagId} className="border-t border-rule-soft">
                <td className="px-4 py-2 md:px-5">
                  <Link to={`/bags/${b.bagId}`} className="font-semibold">
                    {b.bagName}
                  </Link>
                </td>
                <td className="num px-3 py-2 text-right">{n(b.plays)}</td>
                <td className="num px-3 py-2 text-right">{screenHours(b.seconds)}</td>
                <td className="num px-3 py-2 text-right">{b.days}</td>
                {showRiders && <td className="px-4 py-2 text-ink-2 md:px-5">{b.riders?.join(", ") || "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {s.bags.length > 10 && (
        <div className="border-t border-rule px-4 py-2 md:px-5">
          <button type="button" onClick={() => setAll(!all)} className="min-h-9 text-[13px] font-semibold text-accent">
            {all ? "Show the top 10" : `Show all ${s.bags.length} bags`}
          </button>
        </div>
      )}
    </Card>
  );
}

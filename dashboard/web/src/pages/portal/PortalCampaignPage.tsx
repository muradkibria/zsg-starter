// One campaign in the client portal: its figures so far, plays day by day, its
// reports (ready-made periods or any dates within the campaign, to view or
// download as a PDF) and the ads it's running.

import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Download, Eye, FileText } from "lucide-react";
import { roundEstimate, type CampaignDayPlays, type PortalCampaignDetail, type PortalPeriod } from "@digilite/shared";
import { Button, Card, CardHeader, EmptyState, ErrorState, Field, Input, LinkButton, Page, PageHeader, Spinner, Stat } from "@/components/ui";
import { DailyBars } from "../campaigns/components/charts";
import { CreativeThumb } from "../campaigns/components/CreativeThumb";
import { StatusPill } from "../campaigns/components/StatusPill";
import { dayRange, kmText, n, screenHours } from "../campaigns/format";
import { usePortalCampaign, usePortalOverview } from "./api";

export const reportHref = (id: string, fromDay: string, toDay: string, download = false) =>
  `/portal/campaigns/${id}/report?${new URLSearchParams({ fromDay, toDay, ...(download ? { download: "1" } : {}) }).toString()}`;

export default function PortalCampaignPage() {
  const { id = "" } = useParams();
  const detail = usePortalCampaign(id);
  const overview = usePortalOverview();
  const d = detail.data;
  const several = (overview.data?.campaigns.length ?? 0) > 1;

  return (
    <Page width="narrow">
      <PageHeader
        crumbs={several ? [{ label: "Your campaigns", to: "/portal" }, { label: d?.campaign.name ?? "Campaign" }] : undefined}
        title={d?.campaign.name ?? "Campaign"}
        sub={
          d && (
            <span className="inline-flex flex-wrap items-center gap-2">
              <StatusPill status={d.campaign.status} />
              <span>{dayRange(d.campaign.startDay, d.campaign.endDay, { long: true })}</span>
            </span>
          )
        }
      />
      {detail.isLoading && <Spinner label="Loading your campaign…" />}
      {detail.error && <ErrorState error={detail.error} retry={() => void detail.refetch()} />}
      {d && <CampaignBody d={d} />}
    </Page>
  );
}

function CampaignBody({ d }: { d: PortalCampaignDetail }) {
  const t = d.totals;
  const started = d.periods.length > 0;
  const days: CampaignDayPlays[] = d.perDay.map((x) => ({ ...x, footfallStandIn: false, noRecords: false }));
  const soFar = d.campaign.status.phase !== "ended";

  if (!started) {
    return (
      <EmptyState
        icon={<FileText className="size-6" />}
        title={d.campaign.startDay ? `Starts ${dayRange(d.campaign.startDay, d.campaign.startDay, { long: true })}` : "Not started yet"}
        body="Figures and reports appear here from the campaign's first day."
      />
    );
  }

  return (
    <>
      <section aria-label={soFar ? "The campaign so far" : "The whole campaign"} className="flex flex-col gap-2">
        <h2 className="m-0 text-[13px] font-semibold tracking-wide text-muted">
          {soFar ? "SO FAR" : "THE WHOLE CAMPAIGN"} · {dayRange(d.fromDay, d.toDay)}
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Plays" value={n(t.plays)} className="bg-white ring-1 ring-rule" />
          <Stat label="Time on screen" value={screenHours(t.seconds)} className="bg-white ring-1 ring-rule" />
          <Stat label="Bags" value={n(t.bags)} sub={`on ${t.daysWithPlays} ${t.daysWithPlays === 1 ? "day" : "days"}`} className="bg-white ring-1 ring-rule" />
          <Stat label="Distance covered" value={kmText(t.km)} className="bg-white ring-1 ring-rule" />
          <Stat label="Estimated impressions" value={t.impressions > 0 ? `≈ ${n(roundEstimate(t.impressions))}` : "—"} className="col-span-2 bg-white ring-1 ring-rule sm:col-span-1" />
        </div>
      </section>

      <Reports d={d} />

      {days.length > 1 && (
        <Card className="flex flex-col gap-3 p-4 md:p-5" aria-label="Plays per day">
          <CardHeader title="Plays per day" sub="London time. Hover or tap a day for its figures." />
          <DailyBars days={days} height={150} />
        </Card>
      )}

      {d.ads.length > 0 && (
        <Card className="flex flex-col gap-3 p-4 md:p-5" aria-label="Your ads">
          <CardHeader title={d.ads.length === 1 ? "Your ad" : "Your ads"} sub="Plays since the campaign began." />
          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
            {d.ads.map((a) => (
              <li key={a.key} className="flex items-center gap-3 rounded-xl bg-paper p-2.5">
                <CreativeThumb id={a.thumbId} name={a.name} base="/portal/ads" size="lg" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{a.name}</div>
                  <div className="text-xs text-muted">
                    {a.mediaType === "image" ? "Still image" : a.mediaType === "video" ? "Video" : "Ad"} · {n(a.plays)} plays
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

const WEEKS_SHOWN = 6;

function Reports({ d }: { d: PortalCampaignDetail }) {
  const id = d.campaign.id;
  const whole = d.periods.find((p) => p.kind === "campaign")!;
  const weeks = d.periods.filter((p) => p.kind === "week");
  const months = d.periods.filter((p) => p.kind === "month");
  const [allWeeks, setAllWeeks] = useState(false);

  return (
    <Card className="flex flex-col gap-4 p-4 md:p-5" aria-label="Reports">
      <CardHeader title="Reports" sub="Proof-of-play reports with maps of where your ad played. View one here or download it as a PDF." />

      <div className="flex flex-col gap-3 rounded-xl bg-navy p-4 text-white sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="font-display text-base font-semibold">{whole.label}</div>
          <div className="text-[13px] text-white/75">{dayRange(whole.fromDay, whole.toDay, { long: true })}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to={reportHref(id, whole.fromDay, whole.toDay)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-white/10 px-3.5 text-sm font-semibold text-white no-underline hover:bg-white/20"
          >
            <Eye className="size-4" /> View
          </Link>
          <Link
            to={reportHref(id, whole.fromDay, whole.toDay, true)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-white px-3.5 text-sm font-semibold text-navy no-underline hover:bg-white/90"
          >
            <Download className="size-4" /> Download PDF
          </Link>
        </div>
      </div>

      {weeks.length > 0 && (
        <PeriodList
          title="By week"
          id={id}
          periods={allWeeks ? weeks : weeks.slice(0, WEEKS_SHOWN)}
          more={
            weeks.length > WEEKS_SHOWN && (
              <Button size="sm" variant="ghost" onClick={() => setAllWeeks((v) => !v)}>
                {allWeeks ? "Show fewer weeks" : `Show all ${weeks.length} weeks`}
              </Button>
            )
          }
        />
      )}
      {months.length > 0 && <PeriodList title="By month" id={id} periods={months} />}
      <CustomRange d={d} />
    </Card>
  );
}

function PeriodList({ title, id, periods, more }: { title: string; id: string; periods: PortalPeriod[]; more?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="m-0 text-[13px] font-bold">{title}</h3>
      <ul className="m-0 flex list-none flex-col p-0">
        {periods.map((p) => (
          <li key={p.key} className="flex items-center gap-2 border-b border-rule-soft py-1.5 last:border-b-0">
            <Link to={reportHref(id, p.fromDay, p.toDay)} className="min-w-0 flex-1 truncate py-1.5 text-sm font-semibold text-ink no-underline hover:text-accent">
              {p.label}
              {p.kind === "month" && p.fromDay.slice(8) !== "01" && <span className="font-normal text-muted"> · from {dayRange(p.fromDay, p.fromDay)}</span>}
            </Link>
            <LinkButton to={reportHref(id, p.fromDay, p.toDay)} size="sm" variant="ghost" icon={<Eye className="size-4" />} className="max-sm:hidden">
              View<span className="sr-only"> the report for {p.label}</span>
            </LinkButton>
            <LinkButton to={reportHref(id, p.fromDay, p.toDay, true)} size="sm" variant="secondary" icon={<Download className="size-4" />}>
              PDF<span className="sr-only"> of the report for {p.label}</span>
            </LinkButton>
          </li>
        ))}
      </ul>
      {more && <div>{more}</div>}
    </div>
  );
}

function CustomRange({ d }: { d: PortalCampaignDetail }) {
  const navigate = useNavigate();
  const [from, setFrom] = useState(d.fromDay);
  const [to, setTo] = useState(d.toDay);
  const valid = !!from && !!to && from <= to && from >= d.fromDay && to <= d.toDay;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid) navigate(reportHref(d.campaign.id, from, to));
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-xl border border-rule p-3.5" aria-label="Other dates">
      <h3 className="m-0 text-[13px] font-bold">Other dates</h3>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="From" className="min-w-[150px] flex-1">
          <Input type="date" value={from} min={d.fromDay} max={d.toDay} onChange={(e) => setFrom(e.target.value)} required />
        </Field>
        <Field label="To" className="min-w-[150px] flex-1">
          <Input type="date" value={to} min={d.fromDay} max={d.toDay} onChange={(e) => setTo(e.target.value)} required />
        </Field>
        <Button type="submit" disabled={!valid} icon={<Eye className="size-4" />}>
          View report
        </Button>
      </div>
      {from && to && !valid && <p className="m-0 text-xs text-red-ink">Pick dates within the campaign so far ({dayRange(d.fromDay, d.toDay)}), with the start before the end.</p>}
    </form>
  );
}

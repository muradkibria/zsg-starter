// Client report builder: pick a campaign and a period, choose what goes in,
// edit the summary, and see exactly what the client will get on the right.
// Settings live in the URL so the printable page can come back to them.

import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import clsx from "clsx";
import { AlertTriangle, Download, EyeOff, FileText, RotateCcw } from "lucide-react";
import { REPORT_SECTIONS, todayLondon, type CampaignSummary, type ReportSection } from "@digilite/shared";
import { buttonClass, Card, EmptyState, ErrorState, Field, Notice, Page, Select, Spinner, Switch, Textarea } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useCampaigns } from "../campaigns/api";
import { PeriodPicker } from "../campaigns/components/PeriodPicker";
import { dayRange, presetPeriod, type Period } from "../campaigns/format";
import { useCampaignReport } from "./api";
import { ReportDocument } from "./ReportDocument";
import { mentionsEstimate, printableHref, readReportParams, reportSearch, type ReportState } from "./reportParams";

export default function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const campaigns = useCampaigns();
  const list = campaigns.data?.campaigns ?? [];
  const campaignId = params.get("campaign") ?? "";
  const current = list.find((c) => c.id === campaignId) ?? null;
  const st = useMemo(() => readReportParams(params), [params]);

  const update = (patch: Partial<ReportState>, id = campaignId) => {
    const next = { ...st, ...patch };
    setParams(reportSearch(next, id ? { campaign: id } : {}), { replace: true });
  };

  // Pick a campaign when none is chosen: the first one the bags played, else the first.
  useEffect(() => {
    if (campaignId || !list.length) return;
    const pick = list.find((c) => c.plays > 0) ?? list[0];
    setParams(reportSearch({ ...st, summary: null }, { campaign: pick.id }), { replace: true });
  }, [campaignId, list, st, setParams]);

  // Default the period to the whole campaign.
  const period: Period | null = useMemo(() => {
    if (!current) return null;
    if (st.fromDay && st.toDay) return { preset: st.preset ?? "custom", fromDay: st.fromDay, toDay: st.toDay };
    return presetPeriod("campaign", current);
  }, [current, st.fromDay, st.toDay, st.preset]);

  const report = useCampaignReport(current?.id, period?.fromDay ?? null, period?.toDay ?? null, st.riderNames);
  const r = report.data && report.data.campaign.id === current?.id ? report.data : undefined;
  const generated = r?.summary ?? "";
  // The summary is edited locally and written to the URL when the box loses focus.
  const [draft, setDraft] = useState<string | null>(st.summary);
  useEffect(() => setDraft(st.summary), [st.summary, campaignId]);
  const summary = draft ?? generated;
  const edited = draft !== null && draft !== generated;
  const full: ReportState = { ...st, preset: period?.preset ?? null, fromDay: period?.fromDay ?? null, toDay: period?.toDay ?? null };
  const canRiders = can("riders.view");

  const chooseCampaign = (id: string) => {
    setParams(reportSearch({ preset: null, fromDay: null, toDay: null, sections: st.sections, riderNames: st.riderNames, summary: null }, { campaign: id }), { replace: true });
  };
  const toggleSection = (k: ReportSection) => update({ sections: st.sections.includes(k) ? st.sections.filter((x) => x !== k) : [...st.sections, k] });

  return (
    <Page wide>
      <div className="grid items-start gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside aria-label="Report settings" className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            {current && (
              <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
                <Link to={`/campaigns/${current.id}`} className="text-accent no-underline hover:underline">
                  {current.advertiser} — {current.name}
                </Link>
                <span className="mx-1.5 text-caption">/</span>Report
              </nav>
            )}
            <h1 className="m-0 font-display text-[28px] font-semibold tracking-[-0.02em] md:text-[32px]">Client report</h1>
            <p className="m-0 text-sm text-muted">Measured proof of play for an advertiser. The preview shows exactly what they get.</p>
          </div>

          {campaigns.isLoading && <Spinner label="Loading campaigns…" />}
          {campaigns.error && <ErrorState error={campaigns.error} retry={() => void campaigns.refetch()} />}
          {campaigns.data && !list.length && (
            <Card>
              <EmptyState title="No campaigns yet" body="Add a campaign and link its creatives first — reports are built from the plays the bags measure." action={<Link to="/campaigns" className={buttonClass("primary")}>Go to campaigns</Link>} />
            </Card>
          )}

          {list.length > 0 && (
            <>
              <Field label="Campaign">
                <Select value={campaignId} onChange={(e) => chooseCampaign(e.target.value)}>
                  {list.map((c) => (
                    <option key={c.id} value={c.id}>
                      {optionLabel(c)}
                    </option>
                  ))}
                </Select>
              </Field>

              {current && period && (
                <div className="flex flex-col gap-2">
                  <span className="text-[13px] font-semibold">Period</span>
                  <PeriodPicker
                    value={period}
                    onChange={(p) => update({ preset: p.preset, fromDay: p.fromDay, toDay: p.toDay })}
                    campaign={current}
                    presets={["campaign", "last7", "thisMonth", "lastMonth", "custom"]}
                  />
                  <span className="text-xs text-muted">
                    {dayRange(period.fromDay, period.toDay)}
                    {r && r.fromDay !== period.fromDay && ` · play records begin ${dayRange(r.fromDay, r.fromDay)}, so the report starts then`}
                    {period.toDay > todayLondon() && " · up to today"}
                  </span>
                </div>
              )}

              <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
                <legend className="mb-2 p-0 text-[13px] font-semibold">Sections</legend>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-1">
                  {REPORT_SECTIONS.map((s) => (
                    <label key={s.key} className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-lg px-1 text-[13px] hover:bg-paper-2">
                      <input type="checkbox" checked={st.sections.includes(s.key)} onChange={() => toggleSection(s.key)} className="size-4 accent-[#061b47]" />
                      {s.label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="rounded-xl border border-rule bg-white p-3.5">
                <div className="flex items-start gap-3">
                  <EyeOff className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <Switch
                      checked={st.riderNames && canRiders}
                      disabled={!canRiders}
                      onChange={(v) => update({ riderNames: v })}
                      label={<span className="font-semibold">Rider names</span>}
                    />
                    <p className="m-0 mt-1.5 text-xs text-muted">
                      {!canRiders
                        ? "Only people who can see riders can include them. Clients see bag numbers."
                        : st.riderNames
                          ? "On: first name and initial appear in the list of bags. Riders are contractors — only include them if you must."
                          : "Off: clients see bag numbers only. Riders are contractors."}
                    </p>
                  </div>
                </div>
              </div>

              <section aria-label="Summary text" className="flex flex-col gap-2 rounded-2xl bg-tint-2 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold">Summary</span>
                  {draft !== null && (
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(null);
                        update({ summary: null });
                      }}
                      className="inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-accent"
                    >
                      <RotateCcw className="size-3.5" /> Reset
                    </button>
                  )}
                </div>
                <Textarea
                  aria-label="Summary text"
                  value={summary}
                  rows={Math.min(16, Math.max(6, Math.ceil(summary.length / 42) + 1))}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => {
                    if (draft !== st.summary) update({ summary: draft });
                  }}
                  className="bg-white leading-relaxed"
                />
                {mentionsEstimate(summary) ? (
                  <p className="m-0 flex items-start gap-1.5 text-xs font-semibold text-amber-ink">
                    <AlertTriangle className="mt-px size-3.5 shrink-0" />
                    It mentions reach, views or audience. Estimated figures stay out of reports until the method is agreed.
                  </p>
                ) : edited ? (
                  <p className="m-0 text-xs text-muted">Edited by you. Check any number you changed against the measured figures in the preview.</p>
                ) : (
                  <p className="m-0 text-xs text-muted">Written from the measured numbers only. Edit it before sending if you like.</p>
                )}
              </section>
            </>
          )}
        </aside>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 lg:sticky lg:top-0 lg:z-10 lg:-mx-2 lg:bg-paper/95 lg:px-2 lg:py-2 lg:backdrop-blur">
            <span className="mr-auto text-[13px] text-muted">Preview · what the client sees</span>
            {current && (
              <>
                <Link to={printableHref(current.id, { ...full, summary: edited ? summary : null })} className={buttonClass("secondary", "md")}>
                  <FileText className="size-4" /> Open printable report
                </Link>
                <Link to={printableHref(current.id, { ...full, summary: edited ? summary : null }, true)} className={buttonClass("primary", "md")}>
                  <Download className="size-4" /> Download PDF
                </Link>
              </>
            )}
          </div>
          {report.error && <ErrorState error={report.error} retry={() => void report.refetch()} />}
          {current && !r && report.isLoading && (
            <Card>
              <Spinner label="Building the report…" />
            </Card>
          )}
          {r && (
            <div className={clsx("transition-opacity", report.isFetching && "opacity-60")}>
              {r.riderNames.reason && (
                <div className="mb-3">
                  <Notice tone="amber">{r.riderNames.reason}</Notice>
                </div>
              )}
              <ReportDocument report={r} sections={st.sections} summary={summary} />
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}

function optionLabel(c: CampaignSummary): string {
  return `${c.advertiser} — ${c.name}${c.demo ? " (demo)" : ""}`;
}

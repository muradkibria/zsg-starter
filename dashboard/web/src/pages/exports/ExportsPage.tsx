// Exports: routes, shifts, ad plays or time in zones, for chosen riders and/or
// bags over London days, as Excel, CSV or a map file. A check before you
// download says what's in the file; every download is audited.

import { useMemo, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import clsx from "clsx";
import { CalendarDays, Download } from "lucide-react";
import {
  EXPORT_TYPES,
  EXPORT_TYPE_LABEL,
  PAY_MAX_DAYS,
  addDays,
  exportFormatsFor,
  isDay,
  payDayCount,
  payLastCompletedFortnight,
  payPeriodLabel,
  todayLondon,
  type ExportFormat,
  type ExportOptions,
  type ExportPreview,
  type ExportRequest,
  type ExportType,
} from "@digilite/shared";
import { useFeedback } from "@/components/feedback";
import { Button, Chip, ErrorState, Field, Input, Page, PageHeader, Spinner, buttonClass } from "@/components/ui";
import { exportDownloadHref, useExportOptions, useExportPreview } from "./api";
import { BeforeYouDownload, PreviewTable } from "./PreviewPanel";
import { WhoPicker } from "./WhoPicker";

const TYPE_NOTE: Record<ExportType, string> = {
  routes: "Every location point, with stops and signal gaps",
  shifts: "One row per shift: start, end, paid, stopped",
  plays: "Plays and screen time per ad, bag and day",
  zones: "Time spent in each zone, per bag and day",
};

const FORMAT_LABEL: Record<ExportFormat, string> = { xlsx: "Excel", csv: "CSV", gpx: "GPX map file", kml: "KML (Google Earth)" };
const FORMAT_BUTTON: Record<ExportFormat, string> = { xlsx: "Download Excel", csv: "Download CSV", gpx: "Download GPX", kml: "Download KML" };

type Preset = "yesterday" | "7d" | "pay" | "month" | "custom";
const PRESETS: { value: Preset; label: string }[] = [
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 days" },
  { value: "pay", label: "Last pay period" },
  { value: "month", label: "This month" },
  { value: "custom", label: "Custom" },
];

function presetRange(p: Preset, today: string): { fromDay: string; toDay: string } | null {
  if (p === "yesterday") return { fromDay: addDays(today, -1), toDay: addDays(today, -1) };
  if (p === "7d") return { fromDay: addDays(today, -6), toDay: today };
  if (p === "pay") {
    const r = payLastCompletedFortnight(today);
    return { fromDay: r.startDay, toDay: r.endDay };
  }
  if (p === "month") return { fromDay: `${today.slice(0, 8)}01`, toDay: today };
  return null;
}

function fmtBytes(n: number | undefined): string {
  if (!n) return "";
  if (n < 1024 * 1024) return `About ${Math.max(1, Math.round(n / 1024))} KB`;
  return `About ${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** Form state lives in the URL so a reload (or a shared link) keeps it. */
function useExportForm() {
  const [params, setParams] = useSearchParams();
  const today = todayLondon();
  const list = (k: string) => (params.get(k) ?? "").split(",").filter(Boolean);
  const type = (EXPORT_TYPES as string[]).includes(params.get("type") ?? "") ? (params.get("type") as ExportType) : "routes";
  const preset = (PRESETS.map((p) => p.value) as string[]).includes(params.get("when") ?? "") ? (params.get("when") as Preset) : "7d";
  const custom = { fromDay: params.get("from") ?? "", toDay: params.get("to") ?? "" };
  const range = preset === "custom" ? custom : presetRange(preset, today)!;
  const formats = exportFormatsFor(type);
  const format = formats.includes(params.get("format") as ExportFormat) ? (params.get("format") as ExportFormat) : "xlsx";
  const rangeError =
    !isDay(range.fromDay) || !isDay(range.toDay)
      ? "Pick both dates"
      : range.toDay < range.fromDay
        ? "The end is before the start"
        : payDayCount(range.fromDay, range.toDay) > PAY_MAX_DAYS
          ? `Pick ${PAY_MAX_DAYS} days or fewer`
          : null;
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };
  return { type, preset, range, format, formats, rangeError, bagIds: list("bags"), riderIds: list("riders"), set, today };
}

export default function ExportsPage() {
  const f = useExportForm();
  const options = useExportOptions();
  const request: ExportRequest | null = useMemo(
    () => (f.rangeError ? null : { type: f.type, bagIds: f.bagIds, riderIds: f.riderIds, fromDay: f.range.fromDay, toDay: f.range.toDay }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [f.type, f.bagIds.join(), f.riderIds.join(), f.range.fromDay, f.range.toDay, f.rangeError],
  );
  const preview = useExportPreview(request);
  const p = preview.data && request && preview.data.type === request.type ? preview.data : undefined;

  return (
    <Page wide>
      <div className="grid gap-5 lg:grid-cols-[372px_minmax(0,1fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <PageHeader title="Exports" sub="Rider movement and bag data for payroll, clients or your own spreadsheets." />
          {options.isLoading && <Spinner />}
          {options.error && <ErrorState error={options.error} retry={() => void options.refetch()} />}
          {options.data && (
            <form className="card flex flex-col gap-5 p-4 md:p-[18px]" onSubmit={(e) => e.preventDefault()} aria-label="What to export">
              <WhatPicker type={f.type} onChange={(t) => f.set({ type: t, format: exportFormatsFor(t).includes(f.format) ? f.format : null })} />
              <WhoPicker
                options={options.data}
                bagIds={f.bagIds}
                riderIds={f.riderIds}
                handovers={p?.handovers ?? []}
                onChange={(n) => f.set({ bags: n.bagIds.join(","), riders: n.riderIds.join(",") })}
              />
              <WhenPicker form={f} options={options.data} />
              <FormatPicker type={f.type} format={f.format} formats={f.formats} onChange={(v) => f.set({ format: v === "xlsx" ? null : v })} />
              <div className="hidden lg:block">
                <DownloadBlock request={request} format={f.format} preview={p} loading={preview.isFetching} />
              </div>
            </form>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {f.rangeError ? (
            <div className="card flex flex-col gap-1 p-4 md:p-[18px]">
              <h2 className="m-0 font-display text-lg font-semibold">Before you download</h2>
              <p className="m-0 text-sm text-red-ink">{f.rangeError}.</p>
              <p className="m-0 text-[13px] text-muted">An export covers up to {PAY_MAX_DAYS} London days at a time, so it stays quick to make. Split longer stretches into months.</p>
            </div>
          ) : (
            <BeforeYouDownload preview={p} loading={preview.isFetching} error={preview.error} />
          )}
          {options.data && (
            <div className="lg:hidden">
              <DownloadBlock request={request} format={f.format} preview={p} loading={preview.isFetching} />
            </div>
          )}
          {!f.rangeError && <PreviewTable preview={p} loading={preview.isFetching} />}
        </div>
      </div>
    </Page>
  );
}

// ── Form parts ────────────────────────────────────────────────────────────────

function Legend({ children }: { children: ReactNode }) {
  return <legend className="mb-2 p-0 text-[13px] font-bold">{children}</legend>;
}

function WhatPicker({ type, onChange }: { type: ExportType; onChange: (t: ExportType) => void }) {
  return (
    <fieldset className="m-0 border-0 p-0">
      <Legend>What</Legend>
      <div className="grid grid-cols-2 gap-2">
        {EXPORT_TYPES.map((t) => (
          <label
            key={t}
            className={clsx(
              "flex cursor-pointer flex-col gap-1 rounded-xl border px-3 py-2.5",
              t === type ? "border-[1.5px] border-navy bg-tint-2" : "border-rule bg-white hover:border-line",
            )}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <input type="radio" name="export-what" value={t} checked={t === type} onChange={() => onChange(t)} className="size-4 shrink-0 accent-navy" />
              {EXPORT_TYPE_LABEL[t]}
            </span>
            <span className="text-[11px] leading-snug text-muted">{TYPE_NOTE[t]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function WhenPicker({ form, options }: { form: ReturnType<typeof useExportForm>; options: ExportOptions }) {
  const { preset, range, rangeError, set, today } = form;
  const valid = !rangeError;
  const bothDays = isDay(range.fromDay) && isDay(range.toDay) && range.toDay >= range.fromDay;
  const count = bothDays ? payDayCount(range.fromDay, range.toDay) : 0;
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <Legend>When</Legend>
      <div className="flex h-11 items-center gap-2.5 rounded-[10px] border border-line bg-white px-3">
        <CalendarDays className="size-4 shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{bothDays ? payPeriodLabel(range.fromDay, range.toDay, { year: true }) : "Pick the days"}</span>
        {bothDays && count > 0 && (
          <span className={clsx("shrink-0 text-xs", valid ? "text-muted" : "font-semibold text-red-ink")}>
            {count} {count === 1 ? "day" : "days"}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick ranges">
        {PRESETS.map((pr) => (
          <Chip
            key={pr.value}
            active={preset === pr.value}
            className="h-11 md:h-8"
            onClick={() =>
              pr.value === "custom"
                ? set({ when: "custom", from: range.fromDay || addDays(today, -6), to: range.toDay || today })
                : set({ when: pr.value === "7d" ? null : pr.value, from: null, to: null })
            }
          >
            {pr.label}
          </Chip>
        ))}
      </div>
      {preset === "custom" && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="From">
            <Input type="date" value={range.fromDay} max={today} onChange={(e) => set({ from: e.target.value })} className="h-11 md:h-10" />
          </Field>
          <Field label="To">
            <Input type="date" value={range.toDay} max={today} onChange={(e) => set({ to: e.target.value })} className="h-11 md:h-10" />
          </Field>
        </div>
      )}
      {rangeError && preset === "custom" && <p className="m-0 text-xs font-medium text-red-ink">{rangeError}</p>}
      <p className="m-0 text-xs text-muted">
        London days, midnight to midnight. A shift that runs past midnight is split across two days. Up to {options.maxDays} days.
      </p>
    </fieldset>
  );
}

function FormatPicker({ type, format, formats, onChange }: { type: ExportType; format: ExportFormat; formats: ExportFormat[]; onChange: (f: ExportFormat) => void }) {
  return (
    <fieldset className="m-0 border-0 p-0">
      <Legend>Format</Legend>
      <div className="grid grid-cols-2 gap-1.5">
        {formats.map((fm) => (
          <label
            key={fm}
            className={clsx(
              "flex h-11 cursor-pointer items-center gap-2 rounded-[10px] border bg-white px-2.5 text-[13px] whitespace-nowrap md:h-10",
              fm === format ? "border-[1.5px] border-navy font-bold text-navy" : "border-line font-medium text-ink",
            )}
          >
            <input type="radio" name="export-format" value={fm} checked={fm === format} onChange={() => onChange(fm)} className="size-4 shrink-0 accent-navy" />
            {FORMAT_LABEL[fm]}
          </label>
        ))}
      </div>
      {type === "routes" && (format === "gpx" || format === "kml") && (
        <p className="m-0 mt-2 text-xs text-muted">One track per bag per day, named with the rider. The line breaks at signal gaps; nothing is joined up.</p>
      )}
    </fieldset>
  );
}

function DownloadBlock({ request, format, preview, loading }: { request: ExportRequest | null; format: ExportFormat; preview: ExportPreview | undefined; loading: boolean }) {
  const { toast } = useFeedback();
  const ready = !!request && !!preview && preview.rowCount > 0;
  const size = preview ? fmtBytes(preview.estimatedBytes[format]) : "";
  const extra =
    request?.type === "routes" ? (format === "xlsx" ? "one sheet per bag" : format === "gpx" || format === "kml" ? "one track per bag per day" : "") : "";
  return (
    <div className="flex flex-col gap-2">
      {ready ? (
        <a
          href={exportDownloadHref(request!, format)}
          download
          className={buttonClass("primary", "lg", "w-full")}
          onClick={() => toast(`Your ${FORMAT_LABEL[format]} file is on its way`, "info")}
        >
          <Download className="size-4" aria-hidden />
          {FORMAT_BUTTON[format]}
        </a>
      ) : (
        <Button variant="primary" size="lg" className="w-full" disabled loading={loading && !preview}>
          <Download className="size-4" aria-hidden />
          {FORMAT_BUTTON[format]}
        </Button>
      )}
      <span className="text-center text-xs text-caption">
        {!request ? "Pick the days first" : preview && preview.rowCount === 0 ? "Nothing to download for this choice" : [size, extra].filter(Boolean).join(" · ") || "\u00a0"}
      </span>
    </div>
  );
}

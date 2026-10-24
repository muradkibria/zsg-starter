// A report in the client portal: the same proof-of-play report the team sends,
// for any dates within the campaign, to read here, download as a PDF or print.
// With ?download=1 it saves the PDF by itself once the maps have drawn.

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Link, useParams, useSearchParams } from "react-router";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { isDay, type ReportSection } from "@digilite/shared";
import { useFeedback } from "@/components/feedback";
import { Button, ErrorState, Spinner } from "@/components/ui";
import { dayRange } from "../campaigns/format";
import { REPORT_PRINT_CSS, reportFileName } from "../reports/pdf";
import { ReportDocument } from "../reports/ReportDocument";
import { DEFAULT_SECTIONS } from "../reports/reportParams";
import { useReportPdf } from "../reports/useReportPdf";
import { usePortalReport } from "./api";

/** The standard report, without the list of bags (internal). */
const SECTIONS: ReportSection[] = DEFAULT_SECTIONS.filter((s) => s !== "bags");

export default function PortalReportPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const fromDay = isDay(params.get("fromDay")) ? params.get("fromDay") : null;
  const toDay = isDay(params.get("toDay")) ? params.get("toDay") : null;
  const report = usePortalReport(id, fromDay, toDay);
  const r = report.isPlaceholderData ? undefined : report.data;
  const { paperRef, mapImages, onMapSnapshot, mapsReady, download, progress } = useReportPdf(r, SECTIONS);
  const { toast } = useFeedback();
  const autoDownload = params.get("download") === "1";
  const started = useRef(false);

  const fileName = r ? reportFileName(r.campaign.advertiser, r.campaign.name, dayRange(r.fromDay, r.toDay, { long: true })) : "";
  const save = () => void download(fileName).catch((e) => toast((e as Error).message || "Couldn't make the PDF. Please try again.", "error"));

  useEffect(() => {
    if (!r) return;
    const before = document.title;
    document.title = fileName.replace(/\.pdf$/, "");
    return () => {
      document.title = before;
    };
  }, [r, fileName]);

  // Download once the maps are in; don't do it again on reload.
  useEffect(() => {
    if (!autoDownload || started.current || !r || !mapsReady) return;
    started.current = true;
    const t = setTimeout(() => {
      save();
      const next = new URLSearchParams(params);
      next.delete("download");
      setParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDownload, r, mapsReady]);

  return createPortal(
    <div className="dl-report-overlay fixed inset-0 z-[80] overflow-y-auto bg-paper-2" data-full-height>
      <style>{REPORT_PRINT_CSS}</style>
      <div className="dl-report-toolbar sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-rule bg-white/95 px-3 py-2.5 backdrop-blur md:px-6">
        <Link to={`/portal/campaigns/${id}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold no-underline hover:bg-paper-2">
          <ArrowLeft className="size-4" /> Back to the campaign
        </Link>
        <span className="mr-auto hidden text-[13px] text-muted sm:inline">{r ? dayRange(r.fromDay, r.toDay, { long: true }) : ""}</span>
        <Button variant="ghost" icon={<Printer className="size-4" />} onClick={() => window.print()} disabled={!r} className="ml-auto max-sm:hidden sm:ml-0">
          Print
        </Button>
        <Button
          variant="primary"
          icon={<Download className="size-4" />}
          loading={!!progress}
          disabled={!r || !mapsReady}
          onClick={save}
          className="ml-auto sm:ml-0"
        >
          {progress ?? (r && !mapsReady ? "Drawing maps…" : "Download PDF")}
        </Button>
      </div>
      <div className="dl-report-wrap px-3 py-5 md:px-6 md:py-10">
        {!r && !report.error && <Spinner label="Preparing your report…" />}
        {report.error && (
          <div className="mx-auto max-w-[794px]">
            <ErrorState error={report.error} retry={() => void report.refetch()} />
          </div>
        )}
        {r && <ReportDocument report={r} sections={SECTIONS} summary={r.summary} onMapSnapshot={onMapSnapshot} mapImages={mapImages} paperRef={paperRef} />}
      </div>
    </div>,
    document.body,
  );
}

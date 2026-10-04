// The printable client report: a clean, A4-friendly page drawn over the app
// (rendered into <body>, so the app's navigation never prints). With ?print=1
// it opens the print dialog by itself once the map has settled — choose
// "Save as PDF" there to download it.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useParams, useSearchParams } from "react-router";
import { ArrowLeft, Download } from "lucide-react";
import { Button, ErrorState, Spinner } from "@/components/ui";
import { presetPeriod } from "../campaigns/format";
import { useCampaign } from "../campaigns/api";
import { useCampaignReport } from "./api";
import { ReportDocument } from "./ReportDocument";
import { builderHref, readReportParams } from "./reportParams";

const PRINT_CSS = `
@page { size: A4 portrait; margin: 10mm; }
@media print {
  html, body { height: auto !important; background: #fff !important; overflow: visible !important; }
  body > *:not(.dl-report-overlay) { display: none !important; }
  .dl-report-overlay { position: static !important; inset: auto !important; overflow: visible !important; background: #fff !important; }
  .dl-report-toolbar { display: none !important; }
  .dl-report-wrap { padding: 0 !important; }
  .dl-report-paper { box-shadow: none !important; max-width: none !important; border-radius: 0 !important; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
}
`;

export default function ReportPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const st = readReportParams(params);
  const campaign = useCampaign(id);
  const fallback = campaign.data ? presetPeriod("campaign", campaign.data) : null;
  const fromDay = st.fromDay ?? fallback?.fromDay ?? null;
  const toDay = st.toDay ?? fallback?.toDay ?? null;
  const ready = !!(st.fromDay && st.toDay) || !!fallback;
  const report = useCampaignReport(ready ? id : null, fromDay, toDay, st.riderNames);
  const r = report.data;
  const autoPrint = params.get("print") === "1";
  const [mapImage, setMapImage] = useState<string | null>(null);
  const printed = useRef(false);

  const needsMap = !!r && st.sections.includes("map") && r.stats.totals.plays > 0;
  const canPrint = !!r && (!needsMap || !!mapImage);

  // Title the tab (and the saved PDF) after the report.
  useEffect(() => {
    if (!r) return;
    const before = document.title;
    document.title = `${r.campaign.advertiser} — ${r.campaign.name} · proof of play ${r.fromDay} to ${r.toDay}`;
    return () => {
      document.title = before;
    };
  }, [r]);

  useEffect(() => {
    if (!autoPrint || printed.current || !r) return;
    // Wait for the map picture; give up waiting after a few seconds and print the live map.
    const t = setTimeout(
      () => {
        printed.current = true;
        window.print();
        // Don't print again on reload.
        const next = new URLSearchParams(params);
        next.delete("print");
        setParams(next, { replace: true });
      },
      canPrint ? 400 : 6000,
    );
    return () => clearTimeout(t);
  }, [autoPrint, r, canPrint, params, setParams]);

  return createPortal(
    <div className="dl-report-overlay fixed inset-0 z-[80] overflow-y-auto bg-paper-2" data-full-height>
      <style>{PRINT_CSS}</style>
      <div className="dl-report-toolbar sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-rule bg-white/95 px-3 py-2.5 backdrop-blur md:px-6">
        <Link to={builderHref(id, st)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold no-underline hover:bg-paper-2">
          <ArrowLeft className="size-4" /> Report builder
        </Link>
        <span className="mr-auto hidden text-[13px] text-muted sm:inline">Printable report · A4</span>
        <Button variant="primary" icon={<Download className="size-4" />} onClick={() => window.print()} disabled={!r} className="ml-auto sm:ml-0">
          Download PDF
        </Button>
      </div>
      <div className="dl-report-wrap px-3 py-5 md:px-6 md:py-10">
        {(campaign.isLoading || (report.isLoading && !r)) && <Spinner label="Preparing the report…" />}
        {(campaign.error || report.error) && (
          <div className="mx-auto max-w-[794px]">
            <ErrorState error={campaign.error ?? report.error} retry={() => void report.refetch()} />
          </div>
        )}
        {r && (
          <>
            <ReportDocument report={r} sections={st.sections} summary={st.summary ?? r.summary} onMapSnapshot={setMapImage} mapImage={mapImage} />
            <p className="dl-report-toolbar mx-auto mt-4 max-w-[794px] text-center text-xs text-muted">
              To download, choose <strong>Save as PDF</strong> in the print dialog.
            </p>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

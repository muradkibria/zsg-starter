// Everything a page showing a report needs to save it as a PDF: the paper, each
// heat map's still picture as it arrives, whether they've all arrived, and the
// download itself.

import { useCallback, useRef, useState } from "react";
import type { CampaignReport, ReportSection } from "@digilite/shared";
import { reportMapKeys } from "./ReportDocument";
import { downloadReportPdf } from "./pdf";

export function useReportPdf(report: CampaignReport | undefined, sections: ReportSection[]) {
  const paperRef = useRef<HTMLElement>(null);
  // Pictures belong to one report: a different period starts afresh.
  const id = report ? `${report.campaign.id}:${report.fromDay}:${report.toDay}` : "";
  const [images, setImages] = useState<{ id: string; urls: Record<string, string> }>({ id: "", urls: {} });
  const mapImages = images.id === id ? images.urls : {};
  const onMapSnapshot = useCallback(
    (key: string, url: string) =>
      setImages((cur) => {
        const urls = cur.id === id ? cur.urls : {};
        return urls[key] === url ? cur : { id, urls: { ...urls, [key]: url } };
      }),
    [id],
  );
  const keys = report ? reportMapKeys(report, sections) : [];
  const mapsReady = !!report && keys.every((k) => mapImages[k]);

  const [progress, setProgress] = useState<string | null>(null);
  const download = useCallback(
    async (fileName: string) => {
      if (!paperRef.current) return;
      setProgress("Preparing…");
      try {
        await downloadReportPdf(paperRef.current, fileName, (done, total) => setProgress(done < total ? `Page ${done + 1} of ${total}…` : "Saving…"));
      } finally {
        setProgress(null);
      }
    },
    [],
  );

  return { paperRef, mapImages, onMapSnapshot, mapsReady, download, progress };
}

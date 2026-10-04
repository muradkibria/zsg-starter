// React Query hooks for exports.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ExportFormat, ExportOptions, ExportPreview, ExportRequest } from "@digilite/shared";
import { api } from "@/lib/api";

export const useExportOptions = () =>
  useQuery({ queryKey: ["exports", "options"], queryFn: () => api.get<ExportOptions>("/exports/options"), staleTime: 60_000 });

const params = (r: ExportRequest) => ({
  type: r.type,
  bagIds: r.bagIds.join(","),
  riderIds: r.riderIds.join(","),
  fromDay: r.fromDay,
  toDay: r.toDay,
});

/** The "before you download" check and sample rows. */
export const useExportPreview = (r: ExportRequest | null) =>
  useQuery({
    queryKey: ["exports", "preview", r ? JSON.stringify(params(r)) : ""],
    queryFn: () => api.get<ExportPreview>("/exports/preview", params(r!)),
    enabled: !!r,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

export const exportDownloadHref = (r: ExportRequest, format: ExportFormat) => api.href("/exports/download", { ...params(r), format });

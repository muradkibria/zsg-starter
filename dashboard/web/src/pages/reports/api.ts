// React Query hooks for client reports.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { CampaignReport } from "@digilite/shared";
import { api } from "@/lib/api";

export const useCampaignReport = (id: string | null | undefined, fromDay: string | null, toDay: string | null, riderNames: boolean) =>
  useQuery({
    queryKey: ["report", id ?? "", fromDay ?? "", toDay ?? "", riderNames],
    queryFn: () =>
      api.get<CampaignReport>(`/reports/campaign/${id}`, {
        fromDay: fromDay ?? undefined,
        toDay: toDay ?? undefined,
        riderNames: riderNames ? 1 : 0,
      }),
    enabled: !!id,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

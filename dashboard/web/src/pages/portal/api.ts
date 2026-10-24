// React Query hooks for the client portal (/api/portal, client sessions only).

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { CampaignReport, PortalCampaignDetail, PortalOverview } from "@digilite/shared";
import { api } from "@/lib/api";

export const usePortalOverview = () => useQuery({ queryKey: ["portal", "overview"], queryFn: () => api.get<PortalOverview>("/portal/overview"), staleTime: 60_000 });

export const usePortalCampaign = (id: string) =>
  useQuery({ queryKey: ["portal", "campaign", id], queryFn: () => api.get<PortalCampaignDetail>(`/portal/campaigns/${id}`), staleTime: 60_000 });

export const usePortalReport = (id: string, fromDay: string | null, toDay: string | null) =>
  useQuery({
    queryKey: ["portal", "report", id, fromDay ?? "", toDay ?? ""],
    queryFn: () => api.get<CampaignReport>(`/portal/campaigns/${id}/report`, { fromDay: fromDay ?? undefined, toDay: toDay ?? undefined }),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });

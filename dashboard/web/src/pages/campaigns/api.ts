// React Query hooks for campaigns and live inventory.

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CampaignDetail,
  CampaignInput,
  CampaignListResponse,
  CampaignPatch,
  CampaignStats,
  InventoryResponse,
  LinkCreativesResponse,
  SuggestedCreativesResponse,
} from "@digilite/shared";
import { api } from "@/lib/api";

export const ck = {
  list: ["campaigns"] as const,
  one: (id: string) => ["campaign", id] as const,
  stats: (id: string, from?: string, to?: string) => ["campaign-stats", id, from ?? "", to ?? ""] as const,
  suggest: (id: string) => ["campaign-suggest", id] as const,
  inventory: ["inventory"] as const,
};

export const useCampaigns = () =>
  useQuery({ queryKey: ck.list, queryFn: () => api.get<CampaignListResponse>("/campaigns"), refetchInterval: 5 * 60_000 });

export const useCampaign = (id: string | null | undefined) =>
  useQuery({ queryKey: ck.one(id ?? ""), queryFn: () => api.get<CampaignDetail>(`/campaigns/${id}`), enabled: !!id });

export const useCampaignStats = (id: string | null | undefined, fromDay?: string, toDay?: string) =>
  useQuery({
    queryKey: ck.stats(id ?? "", fromDay, toDay),
    queryFn: () => api.get<CampaignStats>(`/campaigns/${id}/stats`, { fromDay, toDay }),
    enabled: !!id,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

export const useInventory = () =>
  useQuery({ queryKey: ck.inventory, queryFn: () => api.get<InventoryResponse>("/inventory"), refetchInterval: 5 * 60_000 });

export const useSuggestedCreatives = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: ck.suggest(id),
    queryFn: () => api.get<SuggestedCreativesResponse>(`/campaigns/${id}/suggested-creatives`),
    enabled,
    staleTime: 30_000,
  });

function useInvalidateCampaigns() {
  const qc = useQueryClient();
  return (id?: string) => {
    void qc.invalidateQueries({ queryKey: ck.list });
    void qc.invalidateQueries({ queryKey: ck.inventory });
    void qc.invalidateQueries({ queryKey: ["report"] });
    if (id) {
      void qc.invalidateQueries({ queryKey: ck.one(id) });
      void qc.invalidateQueries({ queryKey: ["campaign-stats", id] });
      void qc.invalidateQueries({ queryKey: ck.suggest(id) });
    }
  };
}

export function useCreateCampaign() {
  const invalidate = useInvalidateCampaigns();
  return useMutation({
    mutationFn: (body: CampaignInput) => api.post<CampaignDetail>("/campaigns", body),
    onSuccess: (c) => invalidate(c.id),
  });
}

export function useUpdateCampaign(id: string) {
  const invalidate = useInvalidateCampaigns();
  return useMutation({
    mutationFn: (patch: CampaignPatch) => api.patch<CampaignDetail>(`/campaigns/${id}`, patch),
    onSuccess: () => invalidate(id),
  });
}

export function useDeleteCampaign(id: string) {
  const invalidate = useInvalidateCampaigns();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del<{ ok: true; creativesUnlinked: number }>(`/campaigns/${id}`),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ck.one(id) });
      invalidate();
    },
  });
}

export function useLinkCreatives(id: string) {
  const invalidate = useInvalidateCampaigns();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (creativeIds: string[]) => api.put<LinkCreativesResponse>(`/campaigns/${id}/creatives`, { creativeIds }),
    onSuccess: (res) => {
      qc.setQueryData(ck.one(id), res.detail);
      invalidate(id);
    },
  });
}

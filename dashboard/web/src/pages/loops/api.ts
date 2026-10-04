// React Query hooks for Ads & loops.

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type {
  LibraryCampaignRef,
  LibraryCreative,
  LibraryCreativePatch,
  LoopCreateRequest,
  LoopDeployment,
  LoopDetail,
  LoopListItem,
  LoopPatch,
  LoopPublishRequest,
  LoopPublishResult,
} from "@digilite/shared";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";

export const lk = {
  all: ["loops-area"] as const,
  creatives: ["loops-area", "creatives"] as const,
  campaigns: ["loops-area", "campaign-options"] as const,
  loops: ["loops-area", "loops"] as const,
  loop: (id: string) => ["loops-area", "loop", id] as const,
  loopDeployments: (id: string) => ["loops-area", "loop-deployments", id] as const,
  deployments: ["loops-area", "deployments"] as const,
};

/** Everything in this area changes together (counts, loops containing an ad, bags playing). */
function refreshArea(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: lk.all });
}

export const useCreatives = () =>
  useQuery({ queryKey: lk.creatives, queryFn: () => api.get<LibraryCreative[]>("/creatives"), staleTime: 30_000 });

export const useCampaignOptions = (enabled = true) =>
  useQuery({ queryKey: lk.campaigns, queryFn: () => api.get<LibraryCampaignRef[]>("/creatives/campaigns"), staleTime: 5 * 60_000, enabled });

export const useLoops = () => useQuery({ queryKey: lk.loops, queryFn: () => api.get<LoopListItem[]>("/loops"), staleTime: 30_000 });

export const useLoop = (id: string | undefined) =>
  useQuery({ queryKey: lk.loop(id ?? ""), queryFn: () => api.get<LoopDetail>(`/loops/${id}`), enabled: !!id, refetchInterval: 60_000 });

export const useLoopDeployments = (id: string | undefined) =>
  useQuery({
    queryKey: lk.loopDeployments(id ?? ""),
    queryFn: () => api.get<LoopDeployment[]>(`/loops/${id}/deployments`),
    enabled: !!id,
    refetchInterval: 30_000,
  });

export const useDeployments = (enabled = true) =>
  useQuery({ queryKey: lk.deployments, queryFn: () => api.get<LoopDeployment[]>("/deployments", { limit: 40 }), refetchInterval: 30_000, enabled });

export function useUpdateCreative() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: LibraryCreativePatch }) => api.patch<LibraryCreative>(`/creatives/${id}`, patch),
    onSuccess: () => refreshArea(qc),
  });
}

export function useDeleteCreative() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ deleted: boolean }>(`/creatives/${id}`),
    onSuccess: () => refreshArea(qc),
  });
}

export function useUploadCreative() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ form, onProgress }: { form: FormData; onProgress: (pct: number) => void }) =>
      api.upload<LibraryCreative>("/creatives", form, { onProgress }),
    onSuccess: () => refreshArea(qc),
  });
}

export function useCreateLoop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: LoopCreateRequest) => api.post<LoopDetail>("/loops", req),
    onSuccess: (loop) => {
      qc.setQueryData(lk.loop(loop.id), loop);
      refreshArea(qc);
    },
  });
}

export function useUpdateLoop(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: LoopPatch) => api.patch<LoopDetail>(`/loops/${id}`, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: lk.loops });
      void qc.invalidateQueries({ queryKey: lk.creatives });
    },
  });
}

export function useDeleteLoop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ deleted: boolean; archived: boolean }>(`/loops/${id}`),
    onSuccess: () => refreshArea(qc),
  });
}

export function usePublishLoop(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: LoopPublishRequest) => api.post<LoopPublishResult>(`/loops/${id}/publish`, req),
    onSuccess: () => {
      refreshArea(qc);
      void qc.invalidateQueries({ queryKey: qk.bags });
      void qc.invalidateQueries({ queryKey: qk.fleet });
      void qc.invalidateQueries({ queryKey: qk.live });
      void qc.invalidateQueries({ queryKey: qk.settings });
    },
  });
}

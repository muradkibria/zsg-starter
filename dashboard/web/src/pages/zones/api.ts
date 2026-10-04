// React Query hooks for the zones area.

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ZoneDto,
  ZoneHeatResponse,
  ZonePatch,
  ZonePreviewRequest,
  ZonePreviewResponse,
  ZoneStatsResponse,
  ZoneWrite,
} from "@digilite/shared";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";

export const zk = {
  stats: (from: string, to: string) => ["zone-stats", from, to] as const,
  preview: (key: string) => ["zone-preview", key] as const,
  heat: ["zone-heat"] as const,
};

/** Time in each zone for a period. Polls while zone time is being recomputed. */
export const useZoneStats = (fromDay: string, toDay: string) =>
  useQuery({
    queryKey: zk.stats(fromDay, toDay),
    queryFn: () => api.get<ZoneStatsResponse>("/zones/stats", { fromDay, toDay }),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.recompute && q.state.data.recompute.remaining > 0 ? 3000 : 60_000),
  });

/** What a shape would have recorded over the last 14 days. */
export const useZonePreview = (req: ZonePreviewRequest | null) => {
  const key = req ? JSON.stringify(req) : "";
  return useQuery({
    queryKey: zk.preview(key),
    queryFn: () => api.post<ZonePreviewResponse>("/zones/preview", req),
    enabled: !!req,
    // While a reshaped zone is re-measured, keep showing its last numbers (never another zone's).
    placeholderData: (prev, prevQuery) => {
      if (!prev || !prevQuery || !req) return undefined;
      try {
        const before = JSON.parse(String(prevQuery.queryKey[1])) as ZonePreviewRequest;
        return (before.zoneId ?? null) === (req.zoneId ?? null) ? prev : undefined;
      } catch {
        return undefined;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
};

export const useZoneHeat = (enabled: boolean) =>
  useQuery({ queryKey: zk.heat, queryFn: () => api.get<ZoneHeatResponse>("/zones/heat"), enabled, staleTime: 10 * 60_000 });

function useInvalidateZones() {
  const qc = useQueryClient();
  return (saved?: ZoneDto | { ok: true }) => {
    // Show a saved zone straight away; the refetch below confirms it.
    if (saved && "id" in saved) {
      qc.setQueryData<ZoneDto[]>(qk.zones, (old) => (old ? [...old.filter((z) => z.id !== saved.id), saved] : old));
    }
    void qc.invalidateQueries({ queryKey: qk.zones });
    void qc.invalidateQueries({ queryKey: ["zone-stats"] });
    void qc.invalidateQueries({ queryKey: ["zone-preview"] });
  };
}

export function useCreateZone() {
  const done = useInvalidateZones();
  return useMutation({ mutationFn: (body: ZoneWrite) => api.post<ZoneDto>("/zones", body), onSuccess: (z) => done(z) });
}

export function useUpdateZone() {
  const done = useInvalidateZones();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ZonePatch }) => api.patch<ZoneDto>(`/zones/${id}`, patch),
    onSuccess: (z) => done(z),
  });
}

export function useDeleteZone() {
  const done = useInvalidateZones();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/zones/${id}`),
    onSuccess: (_r, id) => {
      qc.setQueryData<ZoneDto[]>(qk.zones, (old) => old?.filter((z) => z.id !== id));
      done();
    },
  });
}

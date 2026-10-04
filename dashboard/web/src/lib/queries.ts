// React Query hooks for the core API. Feature areas add their own hooks in
// their page folders, following the same pattern.

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type {
  BagCommandRequest,
  BagDayDto,
  BagDetail,
  BagPatch,
  BagSummary,
  CommandResult,
  FleetOverview,
  LiveBag,
  LiveEvent,
  LiveResponse,
  RouteResponse,
  SearchResult,
  SettingsDto,
  WriteMode,
  ZoneDto,
} from "@digilite/shared";
import { api } from "./api";

export const qk = {
  fleet: ["fleet"] as const,
  live: ["live"] as const,
  bags: ["bags"] as const,
  bag: (id: string) => ["bag", id] as const,
  route: (id: string, key: string) => ["route", id, key] as const,
  days: (id: string, from?: string, to?: string) => ["days", id, from ?? "", to ?? ""] as const,
  zones: ["zones"] as const,
  settings: ["settings"] as const,
  search: (q: string) => ["search", q] as const,
};

export const useFleet = () => useQuery({ queryKey: qk.fleet, queryFn: () => api.get<FleetOverview>("/fleet"), refetchInterval: 60_000 });

export const useLiveBags = () =>
  useQuery({ queryKey: qk.live, queryFn: () => api.get<LiveResponse>("/fleet/live"), refetchInterval: 120_000 });

export const useBags = () => useQuery({ queryKey: qk.bags, queryFn: () => api.get<BagSummary[]>("/bags"), refetchInterval: 60_000 });

export const useBag = (id: string | null | undefined) =>
  useQuery({ queryKey: qk.bag(id ?? ""), queryFn: () => api.get<BagDetail>(`/bags/${id}`), enabled: !!id });

/** A bag's route for a London day; with no day, its most recent day out. */
export const useRoute = (id: string | null | undefined, day?: string | null) =>
  useQuery({
    queryKey: qk.route(id ?? "", day ?? "last"),
    queryFn: () => (day ? api.get<RouteResponse>(`/bags/${id}/route`, { day }) : api.get<RouteResponse>(`/bags/${id}/last-route`)),
    enabled: !!id,
    staleTime: 60_000,
  });

export const useBagDays = (id: string | null | undefined, fromDay?: string, toDay?: string) =>
  useQuery({
    queryKey: qk.days(id ?? "", fromDay, toDay),
    queryFn: () => api.get<BagDayDto[]>(`/bags/${id}/days`, { fromDay, toDay }),
    enabled: !!id,
  });

export const useZones = () => useQuery({ queryKey: qk.zones, queryFn: () => api.get<ZoneDto[]>("/zones"), staleTime: 60_000 });

export type SettingsResponse = SettingsDto & { writeMode: WriteMode; testBagColorlightIds: number[] };
export const useSettings = () => useQuery({ queryKey: qk.settings, queryFn: () => api.get<SettingsResponse>("/settings") });

export const useSearch = (q: string) =>
  useQuery({ queryKey: qk.search(q), queryFn: () => api.get<SearchResult[]>("/search", { q }), enabled: q.trim().length > 0, staleTime: 10_000 });

export function useBagCommand(bagId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: BagCommandRequest) => api.post<CommandResult>(`/bags/${bagId}/commands`, req),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.bag(bagId) });
    },
  });
}

export function useBagPatch(bagId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: BagPatch) => api.patch<BagSummary>(`/bags/${bagId}`, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.bag(bagId) });
      void qc.invalidateQueries({ queryKey: qk.bags });
      void qc.invalidateQueries({ queryKey: qk.live });
      void qc.invalidateQueries({ queryKey: qk.fleet });
    },
  });
}

function mergeLive(qc: QueryClient, bags: LiveBag[], asOf: string) {
  qc.setQueryData<LiveResponse>(qk.live, (prev) => {
    if (!prev) return prev;
    const byId = new Map(prev.bags.map((b) => [b.id, b]));
    for (const b of bags) byId.set(b.id, b);
    return { asOf, bags: [...byId.values()] };
  });
}

/** Subscribe to server-sent updates (positions, statuses) for the whole app. */
export function useLiveUpdates() {
  const qc = useQueryClient();
  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      es = new EventSource("/api/live");
      es.onmessage = (m) => {
        try {
          const e = JSON.parse(m.data) as LiveEvent;
          if (e.type === "bags") mergeLive(qc, e.bags, e.asOf);
          if (e.type === "overview") qc.setQueryData(qk.fleet, e.overview);
        } catch {
          /* ignore */
        }
      };
      es.onerror = () => {
        es?.close();
        retry = setTimeout(connect, 5000);
      };
    };
    connect();
    return () => {
      es?.close();
      if (retry) clearTimeout(retry);
    };
  }, [qc]);
}

// React Query hooks for settings, team and the audit log.

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AuditEntryDto,
  AuditFacets,
  AuditQuery,
  FleetLoopOption,
  Paged,
  RecomputeStatus,
  SettingsDto,
  SyncHealth,
  TeamCodeResult,
  TeamInviteRequest,
  TeamMember,
  TeamPatch,
  WriteMode,
} from "@digilite/shared";
import { api } from "@/lib/api";
import { qk, type SettingsResponse } from "@/lib/queries";

export const sk = {
  system: ["system"] as const,
  team: ["team"] as const,
  audit: (q: AuditQuery) => ["audit", q] as const,
  facets: ["audit-facets"] as const,
  recompute: ["recompute"] as const,
  loops: ["fleet-loop-options"] as const,
};

export interface SystemResponse {
  sync: SyncHealth;
  writeMode: WriteMode;
  testBagColorlightIds: number[];
  version: string;
}

export const useSystem = () => useQuery({ queryKey: sk.system, queryFn: () => api.get<SystemResponse>("/system"), refetchInterval: 30_000 });

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<SettingsDto>) => api.patch<SettingsResponse>("/settings", patch),
    onSuccess: (s) => {
      qc.setQueryData(qk.settings, s);
      // Fleet checks (loop, brightness) and the safety switch show elsewhere.
      void qc.invalidateQueries({ queryKey: qk.fleet });
      void qc.invalidateQueries({ queryKey: qk.live });
      void qc.invalidateQueries({ queryKey: qk.bags });
      void qc.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

export const useFleetLoopOptions = () =>
  useQuery({ queryKey: sk.loops, queryFn: () => api.get<FleetLoopOption[]>("/settings/fleet-loop-options"), staleTime: 60_000 });

export const useRecomputeStatus = () =>
  useQuery({
    queryKey: sk.recompute,
    queryFn: () => api.get<RecomputeStatus | null>("/settings/recompute"),
    refetchInterval: (q) => (q.state.data && q.state.data.remaining > 0 ? 2000 : false),
  });

export function useRecompute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (days: number) => api.post<RecomputeStatus>("/settings/recompute", { days }),
    onSuccess: (s) => {
      qc.setQueryData(sk.recompute, s);
      void qc.invalidateQueries({ queryKey: ["audit"] });
    },
  });
}

// ── Team ──────────────────────────────────────────────────────────────────────
export const useTeam = (enabled: boolean) => useQuery({ queryKey: sk.team, queryFn: () => api.get<TeamMember[]>("/team"), enabled });

function useTeamDone() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: sk.team });
    void qc.invalidateQueries({ queryKey: ["audit"] });
    void qc.invalidateQueries({ queryKey: sk.facets });
  };
}

export function useInvite() {
  const done = useTeamDone();
  return useMutation({ mutationFn: (body: TeamInviteRequest) => api.post<TeamCodeResult>("/team", body), onSuccess: done });
}

export function useUpdateMember() {
  const done = useTeamDone();
  return useMutation({ mutationFn: ({ id, patch }: { id: string; patch: TeamPatch }) => api.patch<TeamMember>(`/team/${id}`, patch), onSuccess: done });
}

export function useNewCode() {
  const done = useTeamDone();
  return useMutation({ mutationFn: (id: string) => api.post<TeamCodeResult>(`/team/${id}/new-code`), onSuccess: done });
}

export function useNewOwnCode() {
  const done = useTeamDone();
  return useMutation({ mutationFn: () => api.post<TeamCodeResult>("/team/me/new-code"), onSuccess: done });
}

// ── Audit ─────────────────────────────────────────────────────────────────────
export const useAudit = (q: AuditQuery, enabled: boolean) =>
  useQuery({
    queryKey: sk.audit(q),
    queryFn: () => api.get<Paged<AuditEntryDto>>("/audit", { ...q }),
    enabled,
    placeholderData: keepPreviousData,
  });

export const useAuditFacets = (enabled: boolean) => useQuery({ queryKey: sk.facets, queryFn: () => api.get<AuditFacets>("/audit/facets"), enabled, staleTime: 60_000 });

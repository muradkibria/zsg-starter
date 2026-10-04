// React Query hooks for the schedules area.

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ApplyRequest,
  ApplyResult,
  ScheduleBagRow,
  ScheduleChecks,
  ScheduleContent,
  SchedulePreview,
  ScheduleResponse,
} from "@digilite/shared";
import { api } from "@/lib/api";

export const sk = {
  all: ["schedules"] as const,
  schedule: (bagId: string | null) => ["schedules", "schedule", bagId ?? "fleet"] as const,
  preview: (bagId: string | null, weekOf: string) => ["schedules", "preview", bagId ?? "fleet", weekOf] as const,
  checks: (bagId: string | null) => ["schedules", "checks", bagId ?? "fleet"] as const,
  bags: ["schedules", "bags"] as const,
};

/** The fleet schedule, or a bag's own schedule (null inside when it has none). */
export const useSchedule = (bagId: string | null) =>
  useQuery({
    queryKey: sk.schedule(bagId),
    queryFn: () => api.get<ScheduleResponse>(bagId ? `/schedules/bag/${bagId}` : "/schedules/fleet"),
  });

export const usePreview = (bagId: string | null, weekOf: string, enabled = true) =>
  useQuery({
    queryKey: sk.preview(bagId, weekOf),
    queryFn: () => api.get<SchedulePreview>("/schedules/preview", { weekOf, bag: bagId }),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useChecks = (bagId: string | null, enabled = true) =>
  useQuery({
    queryKey: sk.checks(bagId),
    queryFn: () => api.get<ScheduleChecks>("/schedules/checks", { bag: bagId }),
    enabled,
  });

export const useScheduleBags = () => useQuery({ queryKey: sk.bags, queryFn: () => api.get<ScheduleBagRow[]>("/schedules/bags") });

export function useSaveSchedule(bagId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ScheduleContent | { copyFleet: true }) =>
      api.put<ScheduleResponse>(bagId ? `/schedules/bag/${bagId}` : "/schedules/fleet", body),
    onSuccess: (data) => {
      qc.setQueryData(sk.schedule(bagId), data);
      void qc.invalidateQueries({ queryKey: sk.all });
    },
  });
}

export function useRemoveOwnSchedule(bagId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del<{ ok: true; message: string }>(`/schedules/bag/${bagId}`),
    onSuccess: () => {
      // Mark it gone first so the editor unmounts; the bag's own checks/preview would 404 now.
      qc.setQueryData<ScheduleResponse>(sk.schedule(bagId), (old) => (old ? { ...old, schedule: null } : old));
      qc.removeQueries({ queryKey: sk.checks(bagId) });
      qc.removeQueries({ queryKey: ["schedules", "preview", bagId] });
      void qc.invalidateQueries({ queryKey: sk.schedule(null) });
      void qc.invalidateQueries({ queryKey: sk.checks(null) });
      void qc.invalidateQueries({ queryKey: sk.bags });
    },
  });
}

export function useApply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: ApplyRequest) => api.post<ApplyResult>("/schedules/apply", req),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: sk.all });
      for (const r of res.results) void qc.invalidateQueries({ queryKey: ["bag", r.bagId] });
    },
  });
}

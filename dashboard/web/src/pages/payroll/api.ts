// React Query hooks for payroll.

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PayAdjustRequest, PayAdjustment, PayRange, PayrollResponse } from "@digilite/shared";
import { api } from "@/lib/api";

const key = (r: PayRange | null) => ["payroll", r?.startDay ?? "latest", r?.endDay ?? ""] as const;

/** A pay period; with no range, the most recent completed fortnight. */
export const usePayroll = (range: PayRange | null) =>
  useQuery({
    queryKey: key(range),
    queryFn: () => api.get<PayrollResponse>("/payroll", range ? { startDay: range.startDay, endDay: range.endDay } : undefined),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

export function useAdjustHours() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PayAdjustRequest) => api.post<PayAdjustment>("/payroll/adjust", body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["payroll"] }),
  });
}

function usePeriodAction(path: "/payroll/approve" | "/payroll/reopen") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (r: PayRange) => api.post<PayrollResponse>(path, { startDay: r.startDay, endDay: r.endDay }),
    onSuccess: (data) => {
      qc.setQueryData(key(data), data);
      void qc.invalidateQueries({ queryKey: ["payroll"] });
    },
  });
}

export const useApprovePeriod = () => usePeriodAction("/payroll/approve");
export const useReopenPeriod = () => usePeriodAction("/payroll/reopen");

export const payrollExportHref = (r: PayRange, format: "csv" | "xlsx") => api.href("/payroll/export", { startDay: r.startDay, endDay: r.endDay, format });

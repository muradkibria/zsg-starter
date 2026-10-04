// React Query hooks for the riders area.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AssignBagRequest,
  EndAssignmentRequest,
  RiderActionResult,
  RiderCoverage,
  RiderCreateRequest,
  RiderDetail,
  RiderDocPatchRequest,
  RiderDocumentDto,
  RiderListResponse,
  RiderPatchRequest,
  RiderPaySummary,
  RiderPerformance,
  SpareBag,
} from "@digilite/shared";
import { api } from "@/lib/api";
import { qk } from "@/lib/queries";

export const rk = {
  all: ["riders"] as const,
  list: ["riders", "list"] as const,
  rider: (id: string) => ["riders", "one", id] as const,
  docs: (id: string) => ["riders", "docs", id] as const,
  performance: (id: string, days: number) => ["riders", "performance", id, days] as const,
  coverage: (id: string, days: number) => ["riders", "coverage", id, days] as const,
  pay: (id: string, toDay: string) => ["riders", "pay", id, toDay] as const,
  spare: ["riders", "spare-bags"] as const,
};

export const useRiders = () =>
  useQuery({ queryKey: rk.list, queryFn: () => api.get<RiderListResponse>("/riders"), refetchInterval: 60_000 });

export const useRider = (id: string | null | undefined) =>
  useQuery({ queryKey: rk.rider(id ?? ""), queryFn: () => api.get<RiderDetail>(`/riders/${id}`), enabled: !!id });

export const useRiderDocuments = (id: string | null | undefined) =>
  useQuery({ queryKey: rk.docs(id ?? ""), queryFn: () => api.get<RiderDocumentDto[]>(`/riders/${id}/documents`), enabled: !!id });

export const useRiderPerformance = (id: string | null | undefined, days = 14) =>
  useQuery({
    queryKey: rk.performance(id ?? "", days),
    queryFn: () => api.get<RiderPerformance>(`/riders/${id}/performance`, { days }),
    enabled: !!id,
    staleTime: 60_000,
  });

export const useRiderCoverage = (id: string | null | undefined, days = 14) =>
  useQuery({
    queryKey: rk.coverage(id ?? "", days),
    queryFn: () => api.get<RiderCoverage>(`/riders/${id}/coverage`, { days }),
    enabled: !!id,
    staleTime: 5 * 60_000,
  });

export const useRiderPay = (id: string | null | undefined, toDay: string) =>
  useQuery({
    queryKey: rk.pay(id ?? "", toDay),
    queryFn: () => api.get<RiderPaySummary>(`/riders/${id}/pay`, { toDay }),
    enabled: !!id && !!toDay,
  });

export const useSpareBags = (enabled = true) =>
  useQuery({ queryKey: rk.spare, queryFn: () => api.get<SpareBag[]>("/spare-bags"), enabled, refetchInterval: 60_000 });

/** After anything that changes who carries what: riders, bags, the map and route attributions. */
function useRefresh() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: rk.all });
    void qc.invalidateQueries({ queryKey: qk.bags });
    void qc.invalidateQueries({ queryKey: qk.live });
    void qc.invalidateQueries({ queryKey: qk.fleet });
    void qc.invalidateQueries({ queryKey: ["bag"] });
    void qc.invalidateQueries({ queryKey: ["route"] });
    void qc.invalidateQueries({ queryKey: ["days"] });
  };
}

export function useCreateRider() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: RiderCreateRequest) => api.post<RiderDetail>("/riders", body),
    onSuccess: refresh,
  });
}

export function useUpdateRider(id: string) {
  const qc = useQueryClient();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: RiderPatchRequest) => api.patch<RiderDetail>(`/riders/${id}`, body),
    onSuccess: (r) => {
      qc.setQueryData(rk.rider(id), r);
      refresh();
    },
  });
}

export function useAssignBag() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ riderId, ...body }: AssignBagRequest & { riderId: string }) =>
      api.post<RiderActionResult>(`/riders/${riderId}/assign`, body),
    onSuccess: refresh,
  });
}

export function useEndAssignment(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: EndAssignmentRequest) => api.post<RiderActionResult>(`/riders/${id}/end`, body),
    onSuccess: refresh,
  });
}

function useRefreshDocs(riderId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: rk.docs(riderId) });
    void qc.invalidateQueries({ queryKey: rk.rider(riderId) });
    void qc.invalidateQueries({ queryKey: rk.list });
    void qc.invalidateQueries({ queryKey: qk.fleet });
  };
}

export function useUploadDocument(riderId: string) {
  const refresh = useRefreshDocs(riderId);
  return useMutation({
    mutationFn: (form: FormData) => api.upload<RiderDocumentDto>(`/riders/${riderId}/documents`, form),
    onSuccess: refresh,
  });
}

export function useUpdateDocument(riderId: string) {
  const refresh = useRefreshDocs(riderId);
  return useMutation({
    mutationFn: ({ docId, ...body }: RiderDocPatchRequest & { docId: string }) =>
      api.patch<RiderDocumentDto>(`/riders/${riderId}/documents/${docId}`, body),
    onSuccess: refresh,
  });
}

export function useDeleteDocument(riderId: string) {
  const refresh = useRefreshDocs(riderId);
  return useMutation({
    mutationFn: (docId: string) => api.del<{ ok: true }>(`/riders/${riderId}/documents/${docId}`),
    onSuccess: refresh,
  });
}

/** Same-origin links for opening a document (the API checks permission and audits each open). */
export const documentHref = (riderId: string, docId: string, download = false) =>
  api.href(`/riders/${riderId}/documents/${docId}/file`, download ? { download: 1 } : undefined);

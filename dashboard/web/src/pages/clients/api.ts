// React Query hooks for managing clients (their portal logins and campaigns).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ClientAccount, ClientCodeResult, ClientInput, ClientPatch } from "@digilite/shared";
import { api } from "@/lib/api";

const key = ["clients"] as const;

export const useClients = () => useQuery({ queryKey: key, queryFn: () => api.get<ClientAccount[]>("/clients") });

function useDone() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ["audit"] });
  };
}

export function useAddClient() {
  const done = useDone();
  return useMutation({ mutationFn: (body: ClientInput) => api.post<ClientCodeResult>("/clients", body), onSuccess: done });
}

export function useUpdateClient() {
  const done = useDone();
  return useMutation({ mutationFn: ({ id, patch }: { id: string; patch: ClientPatch }) => api.patch<ClientAccount>(`/clients/${id}`, patch), onSuccess: done });
}

export function useNewClientCode() {
  const done = useDone();
  return useMutation({ mutationFn: (id: string) => api.post<ClientCodeResult>(`/clients/${id}/new-code`), onSuccess: done });
}

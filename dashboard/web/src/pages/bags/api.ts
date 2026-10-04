// React Query hooks for the bags area (beyond the core hooks in lib/queries.ts).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BagCommandRequest,
  BagDetail,
  BagsLifecycleRequest,
  BagsLifecycleResult,
  CommandResult,
  CommandSummary,
  FleetOverview,
  RouteResponse,
} from "@digilite/shared";
import { api } from "@/lib/api";
import { qk, useBagCommand } from "@/lib/queries";
import { useFeedback } from "@/components/feedback";

/**
 * Send a command to one bag and say what happened in a toast, using the
 * API's own plain-English message (e.g. "Dry run: …").
 */
export function useRunCommand(bagId: string) {
  const cmd = useBagCommand(bagId);
  const { toast } = useFeedback();
  const run = async (req: BagCommandRequest, opts: { whenSent?: string } = {}): Promise<CommandResult | null> => {
    try {
      const res = await cmd.mutateAsync(req);
      const st = res.command.status;
      const text = st === "sent" && opts.whenSent ? `${res.message} ${opts.whenSent}` : res.message;
      toast(text, st === "sent" || st === "confirmed" ? "success" : st === "failed" ? "error" : "info");
      return res;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't send that to the bag", "error");
      return null;
    }
  };
  return { run, pending: cmd.isPending ? (cmd.variables?.type ?? null) : null };
}

/**
 * The bag page's detail query: the core `useBag` key and endpoint, refreshed
 * every minute so status, screenshot and command outcomes (Sent → Confirmed)
 * keep up while the page is open. Core mutations still invalidate it.
 */
export const useBagDetail = (id: string) =>
  useQuery({ queryKey: qk.bag(id), queryFn: () => api.get<BagDetail>(`/bags/${id}`), enabled: !!id, refetchInterval: 60_000 });

/**
 * One London day of a bag's route — the core `useRoute` key, so the map page
 * shares the cache — refreshed every two minutes while the day is still going.
 */
export const useDayRoute = (id: string, day: string | null, live: boolean) =>
  useQuery({
    queryKey: qk.route(id, day ?? "last"),
    queryFn: () => api.get<RouteResponse>(`/bags/${id}/route`, { day }),
    enabled: !!id && !!day,
    staleTime: 60_000,
    refetchInterval: live ? 120_000 : false,
  });

/** Mark several bags at once (e.g. not-seen bags → in storage). */
export function useBulkLifecycle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: BagsLifecycleRequest) => api.post<BagsLifecycleResult>("/bags/lifecycle", req),
    onSuccess: (_res, req) => {
      void qc.invalidateQueries({ queryKey: qk.bags });
      void qc.invalidateQueries({ queryKey: qk.live });
      void qc.invalidateQueries({ queryKey: qk.fleet });
      for (const id of req.bagIds) void qc.invalidateQueries({ queryKey: qk.bag(id) });
    },
  });
}

export type Outcome = CommandSummary["status"];

/**
 * What the write gate will most likely do with a change to this bag, so
 * confirm dialogs can say it up front. The server still decides.
 */
export function expectedOutcome(fleet: FleetOverview | undefined, isTestBag: boolean): "dry_run" | "send" | "block" | null {
  if (!fleet) return null;
  if (fleet.writeMode === "off") return "dry_run";
  if (fleet.writeMode === "fleet" && fleet.fleetWritesEnabled) return "send";
  return isTestBag ? "send" : "block";
}

export const COMMAND_LABEL: Record<BagCommandRequest["type"] | "schedule" | "publish", string> = {
  brightness: "Brightness",
  reboot: "Restart",
  screenshot: "Screenshot",
  sleep: "Screen off",
  wakeup: "Screen on",
  schedule: "Schedule sent",
  publish: "Loop sent",
};

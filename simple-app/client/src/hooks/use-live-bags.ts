import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { getSocket } from "../lib/socket";

export interface BagLiveState {
  id: string;
  name: string;
  status: string;
  riderId: string | null;
  rider?: { id: string; name: string } | null;
  gps: { lat: number; lng: number; speed: number | null; heading: number | null; recorded_at: string } | null;
}

export function useLiveBags() {
  const { data: initial, isLoading, isError, error, refetch } = useQuery<BagLiveState[]>({
    queryKey: ["fleet", "live"],
    queryFn: () => api.get<BagLiveState[]>("/fleet/live"),
    refetchInterval: 30_000,
  });

  const [bags, setBags] = useState<Map<string, BagLiveState>>(new Map());

  // Seed from REST response
  useEffect(() => {
    if (!initial) return;
    setBags(new Map(initial.map((b) => [b.id, b])));
  }, [initial]);

  // Layer in live Socket.IO updates
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onPosition = (data: { bagId: string; lat: number; lng: number; speed: number; heading: number; timestamp: string }) => {
      setBags((prev) => {
        const next = new Map(prev);
        const bag = next.get(data.bagId);
        if (bag) {
          next.set(data.bagId, {
            ...bag,
            gps: { lat: data.lat, lng: data.lng, speed: data.speed, heading: data.heading, recorded_at: data.timestamp },
          });
        }
        return next;
      });
    };

    const onStatus = (data: { bagId: string; status: string; riderId: string }) => {
      setBags((prev) => {
        const next = new Map(prev);
        const bag = next.get(data.bagId);
        if (bag) next.set(data.bagId, { ...bag, status: data.status, riderId: data.riderId });
        return next;
      });
    };

    socket.on("bag:position", onPosition);
    socket.on("bag:status", onStatus);

    return () => {
      socket.off("bag:position", onPosition);
      socket.off("bag:status", onStatus);
    };
  }, []);

  return {
    bags: Array.from(bags.values()),
    isLoading,
    isError,
    error,
    refetch,
  };
}

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

// Shape returned by GET /api/fleet/live (flat) — needs transforming into BagLiveState (nested gps).
interface FleetLiveRecord {
  bagId: string;
  name: string;
  status: string;
  riderId: string | null;
  riderName: string | null;
  lat: number | null;
  lng: number | null;
  speed: number | null;
  heading: number | null;
  lastGpsAt: string | null;
}

function fromApi(r: FleetLiveRecord): BagLiveState {
  return {
    id: r.bagId,
    name: r.name,
    status: r.status,
    riderId: r.riderId,
    rider: r.riderId && r.riderName ? { id: r.riderId, name: r.riderName } : null,
    gps:
      r.lat != null && r.lng != null && r.lastGpsAt
        ? {
            lat: r.lat,
            lng: r.lng,
            speed: r.speed,
            heading: r.heading,
            recorded_at: r.lastGpsAt,
          }
        : null,
  };
}

export function useLiveBags() {
  const { data: initial, isLoading, isError, error, refetch } = useQuery<FleetLiveRecord[]>({
    queryKey: ["fleet", "live"],
    queryFn: () => api.get<FleetLiveRecord[]>("/fleet/live"),
    refetchInterval: 15_000, // tighter — server-side cache de-dupes Colorlight calls
  });

  const [bags, setBags] = useState<Map<string, BagLiveState>>(new Map());

  // Seed from REST response (and re-merge on every refetch — handles new bags
  // and status changes; the Socket.IO layer below adds finer-grained updates)
  useEffect(() => {
    if (!initial) return;
    setBags((prev) => {
      const next = new Map<string, BagLiveState>();
      for (const r of initial) {
        const transformed = fromApi(r);
        // Prefer the existing entry's gps if it's newer (Socket.IO might have updated it
        // between REST polls)
        const existing = prev.get(transformed.id);
        if (
          existing?.gps &&
          transformed.gps &&
          new Date(existing.gps.recorded_at) > new Date(transformed.gps.recorded_at)
        ) {
          next.set(transformed.id, { ...transformed, gps: existing.gps });
        } else {
          next.set(transformed.id, transformed);
        }
      }
      return next;
    });
  }, [initial]);

  // Layer in live Socket.IO updates
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onPosition = (data: { bagId: string; lat: number; lng: number; speed: number | null; heading: number | null; timestamp: string }) => {
      setBags((prev) => {
        const next = new Map(prev);
        const bag = next.get(data.bagId);
        if (bag) {
          // A fresh GPS report → mark as active
          next.set(data.bagId, {
            ...bag,
            status: "active",
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

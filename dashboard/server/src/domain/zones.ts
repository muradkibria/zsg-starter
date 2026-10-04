import type { ZoneDto, ZoneShape } from "@digilite/shared";
import { getAll, type RecordModel } from "../pb";

let cache: { at: number; zones: ZoneDto[] } | null = null;

export function toZoneDto(r: RecordModel): ZoneDto {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    type: r.type || "neighbourhood",
    centerLat: r.center_lat ?? null,
    centerLng: r.center_lng ?? null,
    radiusM: r.radius_m ?? null,
    polygon: Array.isArray(r.polygon) ? (r.polygon as [number, number][]) : null,
    active: !!r.active,
    sort: r.sort ?? 0,
  };
}

export async function listZones(opts: { fresh?: boolean } = {}): Promise<ZoneDto[]> {
  if (!opts.fresh && cache && Date.now() - cache.at < 30000) return cache.zones;
  const zones = (await getAll("zones", { sort: "sort,name" })).map(toZoneDto);
  cache = { at: Date.now(), zones };
  return zones;
}

export function invalidateZones() {
  cache = null;
}

export async function activeZoneShapes(): Promise<ZoneShape[]> {
  return (await listZones()).filter((z) => z.active).map((z) => ({ ...z }));
}

export async function zoneNames(): Promise<Map<string, string>> {
  return new Map((await listZones()).map((z) => [z.id, z.name]));
}

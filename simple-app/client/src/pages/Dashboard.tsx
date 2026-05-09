import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useLiveBags } from "@/hooks/use-live-bags";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LiveMap, type MapMode } from "@/components/map/LiveMap";
import { BagFilter } from "@/components/map/BagFilter";
import { TimeRangePicker, defaultRange, type TimeRange } from "@/components/map/TimeRangePicker";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Truck, Megaphone, MapPin } from "lucide-react";

interface Campaign { id: string; status: string }

const MAP_MODES: { value: MapMode; label: string; desc: string }[] = [
  { value: "live", label: "Live", desc: "Current positions" },
  { value: "route", label: "Route", desc: "Path taken today" },
  { value: "heatmap", label: "Heatmap", desc: "Movement density" },
];

export function Dashboard() {
  const { bags, isLoading: bagsLoading, isError: bagsError, error, refetch } = useLiveBags();
  const [mapMode, setMapMode] = useState<MapMode>("live");
  const [selectedBags, setSelectedBags] = useState<Set<string>>(new Set());
  const [timeRange, setTimeRange] = useState<TimeRange>(() => defaultRange());

  const { data: campaigns = [] } = useQuery<Campaign[]>({
    queryKey: ["campaigns"],
    queryFn: () => api.get<Campaign[]>("/campaigns"),
  });

  const kpis = [
    { label: "Active Bags", value: bags.filter((b) => b.status === "active").length, total: bags.length, icon: Truck, color: "text-blue-500" },
    { label: "Active Campaigns", value: campaigns.filter((c: Campaign) => c.status === "active").length, total: campaigns.length, icon: Megaphone, color: "text-purple-500" },
    { label: "Bags on Map", value: bags.filter((b) => b.gps != null).length, total: bags.length, icon: MapPin, color: "text-orange-500" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {kpis.map(({ label, value, total, icon: Icon, color }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
              <Icon className={`h-4 w-4 ${color}`} />
            </CardHeader>
            <CardContent>
              {bagsLoading && (label === "Active Bags" || label === "Bags on Map") ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <>
                  <div className="text-2xl font-bold">{value}</div>
                  <p className="text-xs text-muted-foreground mt-0.5">of {total} total</p>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <CardTitle className="text-sm font-medium">Fleet Map</CardTitle>
            {!bagsError && bags.length > 0 && (
              <BagFilter
                bags={bags}
                selected={selectedBags}
                onChange={setSelectedBags}
              />
            )}
            <TimeRangePicker
              value={timeRange}
              onChange={setTimeRange}
              affectsHistoryOnly
              disabled={mapMode === "live"}
            />
          </div>
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            {MAP_MODES.map(({ value, label, desc }) => (
              <button
                key={value}
                title={desc}
                onClick={() => setMapMode(value)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  mapMode === value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent
          className="p-0 overflow-hidden rounded-b-lg"
          style={{ height: bagsError ? "auto" : 480 }}
        >
          {bagsError ? (
            <div className="p-6">
              <ErrorState
                title="Live fleet data unavailable"
                error={error}
                onRetry={() => refetch()}
              />
            </div>
          ) : (
            <LiveMap bags={bags} mode={mapMode} selectedBagIds={selectedBags} timeRange={timeRange} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

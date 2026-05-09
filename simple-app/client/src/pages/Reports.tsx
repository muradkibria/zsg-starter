import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Clock, Film, Image as ImageIcon } from "lucide-react";
import { ErrorState } from "@/components/ui/error-state";
import { TimeRangePicker, defaultRange, type TimeRange } from "@/components/map/TimeRangePicker";

interface Campaign { id: string; name: string }
interface Zone { id: string; name: string }

interface Rider {
  id: string;
  name: string;
  bag_id: string | null;
  status: string;
}

interface Session {
  id: string;
  bag_id: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  gps_points: number;
}

interface DayBreakdown {
  date: string;
  total_seconds: number;
  total_hours: number;
  session_count: number;
  sessions: Session[];
}

interface SessionsResponse {
  rider_id?: string;
  bag_id: string | null;
  days: number;
  totalSessions: number;
  totalSeconds: number;
  totalHours: number;
  byDay: DayBreakdown[];
  sessions: Session[];
}

interface PlayTimes {
  terminalId: number;
  totalPlayTimes: number;
  statistic: {
    mediaMd5: string;
    mediaName: string;
    mediaType: string;
    totalPlayTimes: number;
    totalPlayDuration: number;
  }[];
}

interface DayRow { date: string; plays?: number; visits?: number; sessions?: number }

function formatHours(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h === 0 ? `${m}m` : `${h}h ${m}m`;
}

function BarChart({ data, valueKey }: { data: DayRow[]; valueKey: string }) {
  if (!data.length) return <p className="text-sm text-muted-foreground text-center py-8">No data for this period</p>;
  const max = Math.max(...data.map((d) => Number((d as any)[valueKey] ?? 0)), 1);
  return (
    <div className="space-y-1">
      {data.map((row) => {
        const val = Number((row as any)[valueKey] ?? 0);
        const pct = (val / max) * 100;
        return (
          <div key={row.date} className="flex items-center gap-3 text-xs">
            <span className="w-20 shrink-0 text-muted-foreground">{row.date}</span>
            <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
              <div className="bg-primary h-full rounded-full" style={{ width: `${pct}%` }} />
            </div>
            <span className="w-12 text-right font-medium">{val}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Timesheets tab ───────────────────────────────────────────────────────────

function TimesheetsTab() {
  const { data: riders = [] } = useQuery<Rider[]>({
    queryKey: ["riders"],
    queryFn: () => api.get("/riders"),
  });

  const [selectedRiderId, setSelectedRiderId] = useState("all");
  const [timeRange, setTimeRange] = useState<TimeRange>(() => {
    // Default to "Last 7 days" so the matrix view shows a useful spread out of the box.
    const endMs = Date.now();
    const startMs = endMs - 7 * 24 * 3600 * 1000;
    return { startMs, endMs, preset: "last7d", label: "Last 7 days" };
  });

  const showAll = selectedRiderId === "all";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap pb-3">
          <div>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Rider timesheets
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Online hours derived from GPS reports — handles multiple shifts per day automatically.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Select value={selectedRiderId} onValueChange={setSelectedRiderId}>
              <SelectTrigger className="w-48 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All riders</SelectItem>
                {riders.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}{!r.bag_id ? " (no bag)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <TimeRangePicker value={timeRange} onChange={setTimeRange} />
          </div>
        </CardHeader>

        <CardContent>
          {showAll ? (
            <AllRidersTimesheet riders={riders} timeRange={timeRange} />
          ) : (
            <SingleRiderTimesheet
              rider={riders.find((r) => r.id === selectedRiderId)}
              timeRange={timeRange}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── All-riders matrix view ──────────────────────────────────────────────────

function AllRidersTimesheet({ riders, timeRange }: { riders: Rider[]; timeRange: TimeRange }) {
  const ridersWithBags = riders.filter((r) => r.bag_id);
  const startStr = new Date(timeRange.startMs).toISOString();
  const endStr = new Date(timeRange.endMs).toISOString();
  const qs = `startTime=${encodeURIComponent(startStr)}&endTime=${encodeURIComponent(endStr)}`;

  const queries = useQueries({
    queries: ridersWithBags.map((rider) => ({
      queryKey: ["rider-sessions", rider.id, startStr, endStr],
      queryFn: () => api.get<SessionsResponse>(`/riders/${rider.id}/sessions?${qs}`),
      staleTime: 5 * 60_000,
    })),
  });

  // Build the date columns within the selected range (most recent first).
  // Capped at 31 columns so a misclick doesn't render an unreadable wall.
  const dateColumns = useMemo(() => {
    const cols: string[] = [];
    const start = new Date(timeRange.startMs);
    start.setHours(0, 0, 0, 0);
    let cursor = new Date(timeRange.endMs);
    cursor.setHours(0, 0, 0, 0);
    while (cursor.getTime() >= start.getTime() && cols.length < 31) {
      cols.push(
        `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`
      );
      cursor.setDate(cursor.getDate() - 1);
    }
    return cols;
  }, [timeRange.startMs, timeRange.endMs]);

  const isLoading = queries.some((q) => q.isLoading);
  const hasError = queries.some((q) => q.isError);

  if (riders.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        No riders registered yet.{" "}
        <Link to="/fleet" className="text-primary hover:underline">
          Open the Fleet page
        </Link>{" "}
        to add some.
      </p>
    );
  }

  if (ridersWithBags.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        No riders have a terminal assigned. Assign bags to riders to see their hours.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b">
            <th className="text-left px-3 py-2 font-medium sticky left-0 bg-background z-10 min-w-[160px]">
              Rider
            </th>
            <th className="text-left px-3 py-2 font-medium">Bag</th>
            {dateColumns.map((d) => {
              const date = new Date(d + "T00:00:00");
              return (
                <th key={d} className="text-right px-3 py-2 font-medium whitespace-nowrap">
                  <div>{date.toLocaleDateString(undefined, { weekday: "short" })}</div>
                  <div className="text-muted-foreground font-normal">
                    {date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                  </div>
                </th>
              );
            })}
            <th className="text-right px-3 py-2 font-medium border-l whitespace-nowrap">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {ridersWithBags.map((rider, idx) => {
            const q = queries[idx];
            const data = q.data;
            const byDate = new Map((data?.byDay ?? []).map((d) => [d.date, d]));
            const totalHours = data?.totalHours ?? 0;

            return (
              <tr key={rider.id} className="border-b hover:bg-accent/30">
                <td className="px-3 py-2 sticky left-0 bg-background hover:bg-accent/30 transition-colors">
                  <Link
                    to={`/fleet/${rider.bag_id}`}
                    className="text-primary hover:underline font-medium"
                  >
                    {rider.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted-foreground font-mono">
                  {rider.bag_id}
                </td>
                {dateColumns.map((d) => {
                  const dayData = byDate.get(d);
                  const hours = dayData?.total_hours ?? 0;
                  const sessions = dayData?.session_count ?? 0;

                  return (
                    <td key={d} className="text-right px-3 py-2 tabular-nums">
                      {q.isLoading ? (
                        <Skeleton className="h-3 w-8 ml-auto" />
                      ) : hours > 0 ? (
                        <div title={`${sessions} session${sessions !== 1 ? "s" : ""}`}>
                          <div className="font-medium">{hours.toFixed(1)}h</div>
                          {sessions > 1 && (
                            <div className="text-[10px] text-muted-foreground">×{sessions}</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="text-right px-3 py-2 border-l font-semibold tabular-nums">
                  {q.isLoading ? (
                    <Skeleton className="h-3 w-10 ml-auto" />
                  ) : (
                    <>{totalHours.toFixed(1)}h</>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {hasError && !isLoading && (
        <p className="text-xs text-destructive text-center py-3">
          Some rider data couldn't be loaded — Colorlight may be unreachable.
        </p>
      )}
    </div>
  );
}

// ── Single-rider deep view (sessions + ads) ─────────────────────────────────

function SingleRiderTimesheet({
  rider,
  timeRange,
}: {
  rider: Rider | undefined;
  timeRange: TimeRange;
}) {
  if (!rider) {
    return <p className="text-sm text-muted-foreground text-center py-6">Rider not found</p>;
  }

  if (!rider.bag_id) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        {rider.name} has no terminal assigned.{" "}
        <Link to="/fleet" className="text-primary hover:underline">
          Assign one
        </Link>{" "}
        to track hours.
      </p>
    );
  }

  const startStr = new Date(timeRange.startMs).toISOString();
  const endStr = new Date(timeRange.endMs).toISOString();
  const qs = `startTime=${encodeURIComponent(startStr)}&endTime=${encodeURIComponent(endStr)}`;

  const sessionsQ = useQuery<SessionsResponse>({
    queryKey: ["rider-sessions", rider.id, startStr, endStr],
    queryFn: () => api.get(`/riders/${rider.id}/sessions?${qs}`),
    staleTime: 5 * 60_000,
  });

  // Plays endpoint still uses days for now (its underlying Colorlight call only
  // supports a single window anyway). Approximate to the closest day count.
  const dayCount = Math.max(1, Math.ceil((timeRange.endMs - timeRange.startMs) / (24 * 3600 * 1000)));
  const playsQ = useQuery<PlayTimes>({
    queryKey: ["bag-plays", rider.bag_id, dayCount],
    queryFn: () => api.get(`/bags/${rider.bag_id}/play-times?days=${dayCount}`),
    staleTime: 5 * 60_000,
  });

  const downloadCsv = () => {
    window.location.href = `/api/riders/${rider.id}/sessions/export?${qs}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link
            to={`/fleet/${rider.bag_id}`}
            className="text-sm font-semibold text-primary hover:underline"
          >
            {rider.name}
          </Link>
          <span className="text-xs text-muted-foreground ml-2 font-mono">
            bag #{rider.bag_id}
          </span>
        </div>
        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs" onClick={downloadCsv}>
          <Download className="h-3 w-3" /> Export CSV
        </Button>
      </div>

      {sessionsQ.isError ? (
        <ErrorState
          title="Couldn't load sessions"
          error={sessionsQ.error}
          onRetry={() => sessionsQ.refetch()}
        />
      ) : sessionsQ.isLoading || !sessionsQ.data ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : sessionsQ.data.sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          No GPS reports in this period
        </p>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3">
            <SummaryStat label="Total online" value={`${sessionsQ.data.totalHours.toFixed(1)}h`} />
            <SummaryStat label="Sessions" value={String(sessionsQ.data.totalSessions)} />
            <SummaryStat label="Active days" value={String(sessionsQ.data.byDay.length)} />
          </div>

          {/* Per-day */}
          <div className="space-y-2">
            {sessionsQ.data.byDay.map((day) => (
              <DayCard key={day.date} day={day} />
            ))}
          </div>
        </>
      )}

      {/* Ads played */}
      <AdsSection playsQ={playsQ} days={dayCount} />
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border rounded-md p-3 text-center">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function DayCard({ day }: { day: DayBreakdown }) {
  const date = new Date(day.date + "T00:00:00");
  const label = date.toLocaleDateString(undefined, {
    weekday: "long", day: "numeric", month: "short",
  });

  return (
    <div className="border rounded-md overflow-hidden">
      <div className="px-3 py-2 bg-muted/40 border-b flex items-center justify-between text-sm">
        <div>
          <span className="font-medium">{label}</span>
          <span className="text-xs text-muted-foreground ml-2">
            {day.session_count} session{day.session_count !== 1 ? "s" : ""}
          </span>
        </div>
        <span className="font-semibold tabular-nums">{formatHours(day.total_seconds)}</span>
      </div>
      <table className="w-full text-xs">
        <tbody>
          {day.sessions.map((s, i) => (
            <tr key={s.id} className="border-t">
              <td className="px-3 py-1.5 text-muted-foreground w-8">#{i + 1}</td>
              <td className="px-3 py-1.5 font-mono">
                {new Date(s.started_at).toLocaleTimeString()}
              </td>
              <td className="px-3 py-1.5 text-muted-foreground">→</td>
              <td className="px-3 py-1.5 font-mono">
                {new Date(s.ended_at).toLocaleTimeString()}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums w-20">
                {formatHours(s.duration_seconds)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdsSection({ playsQ, days }: { playsQ: ReturnType<typeof useQuery<PlayTimes>>; days: number }) {
  if (playsQ.isError) return null; // Quietly skip — not critical

  return (
    <div className="border rounded-md overflow-hidden">
      <div className="px-3 py-2 bg-muted/40 border-b flex items-center justify-between text-sm">
        <span className="font-medium">Ads played on this bag · last {days}d</span>
        {playsQ.data && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {playsQ.data.totalPlayTimes} total plays
          </span>
        )}
      </div>

      {playsQ.isLoading ? (
        <div className="p-3 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
        </div>
      ) : !playsQ.data || playsQ.data.statistic.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">
          No ad-play data for this period
        </p>
      ) : (
        <div className="p-3 space-y-2">
          {(() => {
            const max = Math.max(...playsQ.data.statistic.map((s) => s.totalPlayTimes), 1);
            return playsQ.data.statistic.map((s) => {
              const isVideo = s.mediaType?.toLowerCase() === "video";
              return (
                <div key={s.mediaMd5} className="flex items-center gap-3">
                  <div className="w-44 shrink-0 flex items-center gap-1.5">
                    {isVideo
                      ? <Film className="h-3 w-3 text-blue-500 shrink-0" />
                      : <ImageIcon className="h-3 w-3 text-purple-500 shrink-0" />}
                    <span className="text-xs font-medium truncate" title={s.mediaName}>
                      {s.mediaName}
                    </span>
                  </div>
                  <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                    <div
                      className="h-full bg-primary/70"
                      style={{ width: `${(s.totalPlayTimes / max) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-medium tabular-nums w-14 text-right">
                    {s.totalPlayTimes} plays
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums w-14 text-right">
                    {Math.round(s.totalPlayDuration / 60)}m
                  </span>
                </div>
              );
            });
          })()}
        </div>
      )}
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export function Reports() {
  const [selectedCampaign, setSelectedCampaign] = useState("");
  const [selectedZone, setSelectedZone] = useState("");

  const { data: campaigns = [] } = useQuery<Campaign[]>({
    queryKey: ["campaigns"],
    queryFn: () => api.get("/campaigns"),
  });
  const { data: zones = [] } = useQuery<Zone[]>({
    queryKey: ["zones"],
    queryFn: () => api.get("/zones"),
  });

  const campaignQ = useQuery<DayRow[]>({
    queryKey: ["report", "campaign", selectedCampaign],
    queryFn: () => api.get(`/reports/campaign/${selectedCampaign}`),
    enabled: !!selectedCampaign,
  });
  const zoneQ = useQuery<DayRow[]>({
    queryKey: ["report", "zone", selectedZone],
    queryFn: () => api.get(`/reports/zone/${selectedZone}`),
    enabled: !!selectedZone,
  });

  const exportCsv = (type: string, id: string) => {
    const a = document.createElement("a");
    a.href = `/api/reports/export/csv?type=${type}&id=${id}`;
    a.setAttribute("download", `${type}-report.csv`);
    a.click();
  };

  return (
    <Tabs defaultValue="timesheet">
      <TabsList className="mb-4">
        <TabsTrigger value="timesheet">Timesheets</TabsTrigger>
        <TabsTrigger value="campaign">Campaign</TabsTrigger>
        <TabsTrigger value="zone">Zone</TabsTrigger>
      </TabsList>

      <TabsContent value="timesheet">
        <TimesheetsTab />
      </TabsContent>

      <TabsContent value="campaign">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm font-medium">Campaign Performance</CardTitle>
            <div className="flex items-center gap-2">
              <Select value={selectedCampaign} onValueChange={setSelectedCampaign}>
                <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="Select campaign" /></SelectTrigger>
                <SelectContent>{campaigns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
              {selectedCampaign && <Button variant="outline" size="sm" className="h-8" onClick={() => exportCsv("campaign", selectedCampaign)}><Download className="h-3.5 w-3.5 mr-1" />CSV</Button>}
            </div>
          </CardHeader>
          <CardContent>
            {campaignQ.isError ? (
              <ErrorState title="Couldn't load campaign report" error={campaignQ.error} onRetry={() => campaignQ.refetch()} variant="inline" />
            ) : (
              <BarChart data={Array.isArray(campaignQ.data) ? campaignQ.data : []} valueKey="plays" />
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="zone">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm font-medium">Zone Exposure</CardTitle>
            <div className="flex items-center gap-2">
              <Select value={selectedZone} onValueChange={setSelectedZone}>
                <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="Select zone" /></SelectTrigger>
                <SelectContent>{zones.map((z) => <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>)}</SelectContent>
              </Select>
              {selectedZone && <Button variant="outline" size="sm" className="h-8" onClick={() => exportCsv("zone", selectedZone)}><Download className="h-3.5 w-3.5 mr-1" />CSV</Button>}
            </div>
          </CardHeader>
          <CardContent>
            {zoneQ.isError ? (
              <ErrorState title="Couldn't load zone report" error={zoneQ.error} onRetry={() => zoneQ.refetch()} variant="inline" />
            ) : (
              <BarChart data={Array.isArray(zoneQ.data) ? zoneQ.data : []} valueKey="visits" />
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

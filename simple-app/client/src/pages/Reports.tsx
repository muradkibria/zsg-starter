import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, Clock, Film, Image as ImageIcon, BarChart2, ListMusic, Truck, AlertCircle } from "lucide-react";
import { ErrorState } from "@/components/ui/error-state";
import { TimeRangePicker, defaultRange, type TimeRange } from "@/components/map/TimeRangePicker";
import { BagFilter, applyBagFilter } from "@/components/map/BagFilter";
import { useLiveBags } from "@/hooks/use-live-bags";
import { CampaignReportsTab } from "@/pages/CampaignReports";

interface Campaign { id: string; name: string }
interface Zone { id: string; name: string }

interface Rider {
  id: string;
  name: string;
  bag_id: string | null;
  status: string;
}

interface IdleWindow {
  started_at: string;
  ended_at: string;
  duration_seconds: number;
}

interface Session {
  id: string;
  bag_id: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  /** Time the rider was stationary (within IDLE_RADIUS_M for ≥ IDLE_THRESHOLD_MINUTES). */
  idle_seconds?: number;
  working_seconds?: number;
  idle_windows?: IdleWindow[];
  gps_points: number;
}

interface DayBreakdown {
  date: string;
  total_seconds: number;
  total_hours: number;
  idle_seconds?: number;
  idle_hours?: number;
  working_seconds?: number;
  working_hours?: number;
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

  // Bag list lookup — used to show the friendly "Terminal X" name next to each
  // rider rather than the raw Colorlight numeric ID. TanStack dedupes this
  // query with other components on the page that fetch ["bags"].
  const bagsQ = useQuery<{ id: string; name: string }[]>({
    queryKey: ["bags"],
    queryFn: () => api.get("/bags"),
  });
  const bagNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of bagsQ.data ?? []) m.set(b.id, b.name);
    return m;
  }, [bagsQ.data]);

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

  // Roll up totals across all rider queries so the "Total" column shows the
  // raw / working / idle breakdown too.
  const riderTotals = queries.map((q) => {
    let total = 0, idle = 0;
    for (const d of q.data?.byDay ?? []) {
      total += d.total_seconds ?? 0;
      idle += d.idle_seconds ?? 0;
    }
    return { total_h: total / 3600, idle_h: idle / 3600, working_h: Math.max(0, (total - idle) / 3600) };
  });

  return (
    <div className="overflow-x-auto">
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground mb-2 px-1">
        <span className="font-medium text-foreground">Reading the cells:</span>
        <span><strong className="text-foreground">5.2h</strong> raw</span>
        <span>·</span>
        <span><strong className="text-foreground">4.1h</strong> working</span>
        <span>·</span>
        <span className="text-amber-700"><strong>1.1h</strong> idle</span>
        <span className="ml-auto italic">
          Idle = bag on but no movement &gt; {IDLE_THRESHOLD_LABEL}. Cells with &gt;25% idle are flagged amber.
        </span>
      </div>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b">
            <th className="text-left px-3 py-2 font-medium sticky left-0 bg-background z-10 min-w-[200px]">
              Rider · Terminal
            </th>
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
            const totals = riderTotals[idx];

            return (
              <tr key={rider.id} className="border-b hover:bg-accent/30">
                <td className="px-3 py-2 sticky left-0 bg-background hover:bg-accent/30 transition-colors">
                  <Link
                    to={`/fleet/${rider.bag_id}`}
                    className="text-primary hover:underline font-medium"
                  >
                    {rider.name}
                  </Link>
                  <span className="text-muted-foreground ml-2">
                    · {bagNameById.get(rider.bag_id!) ?? rider.bag_id}
                  </span>
                </td>
                {dateColumns.map((d) => {
                  const dayData = byDate.get(d);
                  const hours = dayData?.total_hours ?? 0;
                  const idle = dayData?.idle_hours ?? 0;
                  const working = dayData?.working_hours ?? Math.max(0, hours - idle);
                  const sessions = dayData?.session_count ?? 0;
                  const idleRatio = hours > 0 ? idle / hours : 0;
                  const flagged = idleRatio > 0.25;

                  return (
                    <td
                      key={d}
                      className={`text-right px-3 py-2 tabular-nums ${flagged ? "bg-amber-50/70" : ""}`}
                    >
                      {q.isLoading ? (
                        <Skeleton className="h-3 w-8 ml-auto" />
                      ) : hours > 0 ? (
                        <div title={`${sessions} session${sessions !== 1 ? "s" : ""} · ${working.toFixed(2)}h working · ${idle.toFixed(2)}h idle`}>
                          <div className="font-medium">{hours.toFixed(1)}h</div>
                          <div className="text-[10px] text-muted-foreground leading-tight">
                            <span className="text-foreground/80">{working.toFixed(1)}w</span>
                            {idle > 0 && (
                              <>
                                {" "}·{" "}
                                <span className="text-amber-700">{idle.toFixed(1)}i</span>
                              </>
                            )}
                            {sessions > 1 && <span className="ml-1">×{sessions}</span>}
                          </div>
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
                    <div>
                      <div>{totals.total_h.toFixed(1)}h</div>
                      <div className="text-[10px] font-normal text-muted-foreground leading-tight">
                        <span className="text-foreground/80">{totals.working_h.toFixed(1)}w</span>
                        {totals.idle_h > 0 && (
                          <>
                            {" "}·{" "}
                            <span className="text-amber-700">{totals.idle_h.toFixed(1)}i</span>
                          </>
                        )}
                      </div>
                    </div>
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

// Lifted out for the legend — keeps the component readable. The server's actual
// threshold is set via IDLE_THRESHOLD_MINUTES env; we don't surface it via API
// so this is a soft display label only.
const IDLE_THRESHOLD_LABEL = "15 min within 50 m";

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

  // Bag-name lookup so we can render the friendly "Terminal X" alongside the rider.
  // Shares the ["bags"] query key with the matrix view so TanStack dedupes.
  const bagsQ = useQuery<{ id: string; name: string }[]>({
    queryKey: ["bags"],
    queryFn: () => api.get("/bags"),
  });
  const bagName = bagsQ.data?.find((b) => b.id === rider.bag_id)?.name ?? null;

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
          <span className="text-xs text-muted-foreground ml-2">
            · {bagName ?? `bag #${rider.bag_id}`}
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
          {/* Summary — show raw / working / idle so payroll has the breakdown at a glance */}
          {(() => {
            const totalSec = sessionsQ.data.byDay.reduce((s, d) => s + (d.total_seconds ?? 0), 0);
            const idleSec  = sessionsQ.data.byDay.reduce((s, d) => s + (d.idle_seconds ?? 0), 0);
            const workSec  = Math.max(0, totalSec - idleSec);
            return (
              <div className="grid grid-cols-4 gap-3">
                <SummaryStat label="Total online" value={`${(totalSec / 3600).toFixed(1)}h`} />
                <SummaryStat label="Working" value={`${(workSec / 3600).toFixed(1)}h`} />
                <SummaryStat label="Idle" value={`${(idleSec / 3600).toFixed(1)}h`} tone={idleSec > 0 ? "amber" : undefined} />
                <SummaryStat label="Active days" value={String(sessionsQ.data.byDay.length)} />
              </div>
            );
          })()}

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

function SummaryStat({
  label, value, tone,
}: { label: string; value: string; tone?: "amber" }) {
  return (
    <div className={`border rounded-md p-3 text-center ${tone === "amber" ? "border-amber-300 bg-amber-50/60" : ""}`}>
      <p className={`text-2xl font-bold tabular-nums ${tone === "amber" ? "text-amber-700" : ""}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function DayCard({ day }: { day: DayBreakdown }) {
  const date = new Date(day.date + "T00:00:00");
  const label = date.toLocaleDateString(undefined, {
    weekday: "long", day: "numeric", month: "short",
  });
  const idleSec = day.idle_seconds ?? 0;
  const workingSec = day.working_seconds ?? Math.max(0, day.total_seconds - idleSec);

  return (
    <div className="border rounded-md overflow-hidden">
      <div className="px-3 py-2 bg-muted/40 border-b flex items-center justify-between text-sm">
        <div>
          <span className="font-medium">{label}</span>
          <span className="text-xs text-muted-foreground ml-2">
            {day.session_count} session{day.session_count !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-3 tabular-nums">
          <span className="font-semibold">{formatHours(day.total_seconds)}</span>
          <span className="text-xs text-muted-foreground">
            {formatHours(workingSec)} work
            {idleSec > 0 && (
              <> · <span className="text-amber-700">{formatHours(idleSec)} idle</span></>
            )}
          </span>
        </div>
      </div>
      <table className="w-full text-xs">
        <tbody>
          {day.sessions.map((s, i) => {
            const sIdle = s.idle_seconds ?? 0;
            const windows = s.idle_windows ?? [];
            return (
              <Fragment key={s.id}>
                <tr className="border-t">
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
                  <td className="px-3 py-1.5 text-right tabular-nums w-24 text-amber-700">
                    {sIdle > 0 ? `${formatHours(sIdle)} idle` : ""}
                  </td>
                </tr>
                {windows.map((w, wi) => (
                  <tr key={`${s.id}-w${wi}`} className="bg-amber-50/40">
                    <td className="px-3 py-1 text-amber-700/80 text-[10px] pl-6">↳ idle</td>
                    <td className="px-3 py-1 font-mono text-amber-800 text-[11px]">
                      {new Date(w.started_at).toLocaleTimeString()}
                    </td>
                    <td className="px-3 py-1 text-amber-700/80">→</td>
                    <td className="px-3 py-1 font-mono text-amber-800 text-[11px]">
                      {new Date(w.ended_at).toLocaleTimeString()}
                    </td>
                    <td className="px-3 py-1"></td>
                    <td className="px-3 py-1 text-right tabular-nums text-amber-700 text-[11px]">
                      {formatHours(w.duration_seconds)}
                    </td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
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

// ── Ad Plays tab ─────────────────────────────────────────────────────────────

interface AdPlaysBreakdown {
  startTime: string;
  endTime: string;
  bagsCovered: number;
  bagIds: string[];
  totalPlays: number;
  totalDurationSeconds: number;
  adCount: number;
  byAd: {
    mediaMd5: string;
    mediaName: string;
    mediaType: string;
    totalPlays: number;
    totalDurationSeconds: number;
    perBag: { bagId: string; bagName: string; plays: number; durationSeconds: number }[];
  }[];
  byBag: {
    bagId: string;
    bagName: string;
    totalPlays: number;
    totalDurationSeconds: number;
    perAd: { mediaMd5: string; mediaName: string; mediaType: string; plays: number; durationSeconds: number }[];
  }[];
  byPlaylist: {
    playlistId: string;
    playlistName: string;
    bagIds: string[];
    itemCount: number;
    totalPlays: number;
    totalDurationSeconds: number;
    perAd: { mediaMd5: string; mediaName: string; mediaType: string; plays: number; durationSeconds: number }[];
  }[];
  unmatched: {
    totalPlays: number;
    ads: { mediaMd5: string; mediaName: string; mediaType: string; plays: number; durationSeconds: number }[];
  };
}

type AdPlaysView = "byAd" | "byBag" | "byPlaylist";

function formatHm(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function AdIcon({ type, className = "h-3 w-3" }: { type: string; className?: string }) {
  return type?.toLowerCase() === "video"
    ? <Film className={`${className} text-blue-500 shrink-0`} />
    : <ImageIcon className={`${className} text-purple-500 shrink-0`} />;
}

function AdPlaysTab() {
  // Default to "Today"
  const [timeRange, setTimeRange] = useState<TimeRange>(() => defaultRange());
  const [view, setView] = useState<AdPlaysView>("byAd");
  const [selectedBags, setSelectedBags] = useState<Set<string>>(new Set());

  // Load bag list (for filter dropdown)
  const { bags } = useLiveBags();

  // Resolve bag filter into a comma-separated query param
  const filteredBags = applyBagFilter(bags, selectedBags);
  const isFiltered = selectedBags.size > 0 && filteredBags.length < bags.length;
  const bagIdsParam = isFiltered ? filteredBags.map((b) => b.id).join(",") : "";

  const startStr = new Date(timeRange.startMs).toISOString();
  const endStr = new Date(timeRange.endMs).toISOString();

  const breakdownQ = useQuery<AdPlaysBreakdown>({
    queryKey: ["ad-plays-breakdown", startStr, endStr, bagIdsParam],
    queryFn: () => {
      const qs = new URLSearchParams({ startTime: startStr, endTime: endStr });
      if (bagIdsParam) qs.set("bagIds", bagIdsParam);
      return api.get(`/reports/ad-plays-breakdown?${qs.toString()}`);
    },
    staleTime: 60_000,
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap pb-3">
          <div>
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-muted-foreground" />
              Ad Plays
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              How many times each ad has played, sourced directly from Colorlight's playback stats.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <TimeRangePicker value={timeRange} onChange={setTimeRange} />
            <BagFilter bags={bags} selected={selectedBags} onChange={setSelectedBags} />
            <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
              {[
                { value: "byAd" as const, label: "By Ad", icon: BarChart2 },
                { value: "byBag" as const, label: "By Bag", icon: Truck },
                { value: "byPlaylist" as const, label: "By Playlist", icon: ListMusic },
              ].map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  onClick={() => setView(value)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${
                    view === value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {breakdownQ.isError ? (
            <ErrorState
              title="Couldn't load ad-play data"
              error={breakdownQ.error}
              onRetry={() => breakdownQ.refetch()}
            />
          ) : breakdownQ.isLoading || !breakdownQ.data ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : breakdownQ.data.totalPlays === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No ad plays recorded in this period
              {isFiltered ? " for the selected bags" : ""}.
            </p>
          ) : (
            <>
              <SummaryRow data={breakdownQ.data} />
              <div className="mt-4">
                {view === "byAd" && <ByAdView data={breakdownQ.data} />}
                {view === "byBag" && <ByBagView data={breakdownQ.data} />}
                {view === "byPlaylist" && <ByPlaylistView data={breakdownQ.data} />}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryRow({ data }: { data: AdPlaysBreakdown }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      <SummaryStat label="Total plays" value={data.totalPlays.toLocaleString()} />
      <SummaryStat label="Total airtime" value={formatHm(data.totalDurationSeconds)} />
      <SummaryStat label="Distinct ads" value={String(data.adCount)} />
      <SummaryStat label="Bags covered" value={String(data.bagsCovered)} />
    </div>
  );
}

// (SummaryStat is shared with the timesheet's SingleRiderTimesheet — defined further up)

// ── By Ad view ───────────────────────────────────────────────────────────────

function ByAdView({ data }: { data: AdPlaysBreakdown }) {
  const max = Math.max(...data.byAd.map((a) => a.totalPlays), 1);
  return (
    <div className="space-y-1.5">
      {data.byAd.map((ad) => (
        <details key={ad.mediaMd5} className="border rounded-md overflow-hidden group">
          <summary className="px-3 py-2 cursor-pointer hover:bg-accent/40 list-none flex items-center gap-3 text-sm">
            <AdIcon type={ad.mediaType} className="h-3.5 w-3.5" />
            <span className="flex-1 truncate font-medium" title={ad.mediaName}>{ad.mediaName}</span>
            <div className="hidden sm:block flex-1 max-w-[180px] h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary/70 rounded-full" style={{ width: `${(ad.totalPlays / max) * 100}%` }} />
            </div>
            <span className="text-xs font-medium tabular-nums w-16 text-right">{ad.totalPlays.toLocaleString()} plays</span>
            <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">{formatHm(ad.totalDurationSeconds)}</span>
            <span className="text-xs text-muted-foreground hidden md:inline">{ad.perBag.length} bag{ad.perBag.length !== 1 ? "s" : ""}</span>
          </summary>
          <div className="border-t bg-muted/20 px-3 py-2">
            <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide">Per-bag breakdown</p>
            <table className="w-full text-xs">
              <tbody>
                {ad.perBag
                  .slice()
                  .sort((a, b) => b.plays - a.plays)
                  .map((b) => (
                    <tr key={b.bagId} className="border-t first:border-t-0">
                      <td className="px-2 py-1 font-medium">{b.bagName}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{b.plays.toLocaleString()} plays</td>
                      <td className="px-2 py-1 text-right text-muted-foreground tabular-nums w-20">{formatHm(b.durationSeconds)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </div>
  );
}

// ── By Bag view ──────────────────────────────────────────────────────────────

function ByBagView({ data }: { data: AdPlaysBreakdown }) {
  const max = Math.max(...data.byBag.map((b) => b.totalPlays), 1);
  return (
    <div className="space-y-1.5">
      {data.byBag.map((bag) => (
        <details key={bag.bagId} className="border rounded-md overflow-hidden">
          <summary className="px-3 py-2 cursor-pointer hover:bg-accent/40 list-none flex items-center gap-3 text-sm">
            <Truck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Link
              to={`/fleet/${bag.bagId}`}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 truncate font-medium text-primary hover:underline"
            >
              {bag.bagName}
            </Link>
            <div className="hidden sm:block flex-1 max-w-[180px] h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary/70 rounded-full" style={{ width: `${(bag.totalPlays / max) * 100}%` }} />
            </div>
            <span className="text-xs font-medium tabular-nums w-16 text-right">{bag.totalPlays.toLocaleString()} plays</span>
            <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">{formatHm(bag.totalDurationSeconds)}</span>
            <span className="text-xs text-muted-foreground hidden md:inline">{bag.perAd.length} ad{bag.perAd.length !== 1 ? "s" : ""}</span>
          </summary>
          {bag.perAd.length === 0 ? (
            <div className="border-t bg-muted/20 px-3 py-3 text-xs text-muted-foreground italic">
              No ads played on this bag in the selected period.
            </div>
          ) : (
            <div className="border-t bg-muted/20 px-3 py-2">
              <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide">Ads played here</p>
              <table className="w-full text-xs">
                <tbody>
                  {bag.perAd
                    .slice()
                    .sort((a, b) => b.plays - a.plays)
                    .map((ad) => (
                      <tr key={ad.mediaMd5} className="border-t first:border-t-0">
                        <td className="px-2 py-1 w-5"><AdIcon type={ad.mediaType} /></td>
                        <td className="px-2 py-1 truncate max-w-[200px]" title={ad.mediaName}>{ad.mediaName}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{ad.plays.toLocaleString()} plays</td>
                        <td className="px-2 py-1 text-right text-muted-foreground tabular-nums w-20">{formatHm(ad.durationSeconds)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
      ))}
    </div>
  );
}

// ── By Playlist view ─────────────────────────────────────────────────────────

function ByPlaylistView({ data }: { data: AdPlaysBreakdown }) {
  const hasPlaylists = data.byPlaylist.length > 0;
  const hasUnmatched = data.unmatched.totalPlays > 0;

  if (!hasPlaylists && !hasUnmatched) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        No playlist activity yet — once you deploy a playlist from the{" "}
        <Link to="/playlists" className="text-primary hover:underline">Playlists page</Link>,
        its plays will appear here grouped by playlist.
      </p>
    );
  }

  const max = Math.max(
    ...data.byPlaylist.map((p) => p.totalPlays),
    data.unmatched.totalPlays,
    1
  );

  return (
    <div className="space-y-2">
      {data.byPlaylist.map((pl) => (
        <details key={pl.playlistId} open={data.byPlaylist.length === 1} className="border rounded-md overflow-hidden">
          <summary className="px-3 py-2 cursor-pointer hover:bg-accent/40 list-none flex items-center gap-3 text-sm">
            <ListMusic className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Link
              to="/playlists"
              onClick={(e) => e.stopPropagation()}
              className="flex-1 truncate font-medium text-primary hover:underline"
            >
              {pl.playlistName}
            </Link>
            <div className="hidden sm:block flex-1 max-w-[180px] h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary/70 rounded-full" style={{ width: `${(pl.totalPlays / max) * 100}%` }} />
            </div>
            <span className="text-xs font-medium tabular-nums w-16 text-right">{pl.totalPlays.toLocaleString()} plays</span>
            <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">{formatHm(pl.totalDurationSeconds)}</span>
            <span className="text-xs text-muted-foreground hidden md:inline">{pl.bagIds.length} bag{pl.bagIds.length !== 1 ? "s" : ""}</span>
          </summary>
          <div className="border-t bg-muted/20 px-3 py-2 space-y-2">
            <p className="text-xs text-muted-foreground">
              {pl.itemCount} item{pl.itemCount !== 1 ? "s" : ""} in playlist · deployed to bags:{" "}
              {pl.bagIds.length > 0
                ? pl.bagIds.map((id) => {
                    const bag = data.byBag.find((b) => b.bagId === id);
                    return bag?.bagName ?? id;
                  }).join(", ")
                : "—"}
            </p>
            <table className="w-full text-xs">
              <tbody>
                {pl.perAd.map((ad) => (
                  <tr key={ad.mediaMd5} className="border-t first:border-t-0">
                    <td className="px-2 py-1 w-5"><AdIcon type={ad.mediaType} /></td>
                    <td className="px-2 py-1 truncate max-w-[260px]" title={ad.mediaName}>{ad.mediaName}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{ad.plays.toLocaleString()} plays</td>
                    <td className="px-2 py-1 text-right text-muted-foreground tabular-nums w-20">{formatHm(ad.durationSeconds)}</td>
                  </tr>
                ))}
                {pl.perAd.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-2 py-2 text-xs text-muted-foreground italic">
                      No plays for this playlist's items in the selected window.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </details>
      ))}

      {hasUnmatched && (
        <details className="border rounded-md overflow-hidden border-amber-200">
          <summary className="px-3 py-2 cursor-pointer hover:bg-amber-50 list-none flex items-center gap-3 text-sm">
            <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
            <span className="flex-1 truncate font-medium">Other / legacy programs</span>
            <span className="text-xs font-medium tabular-nums w-16 text-right">{data.unmatched.totalPlays.toLocaleString()} plays</span>
            <span className="text-xs text-muted-foreground hidden md:inline">{data.unmatched.ads.length} ad{data.unmatched.ads.length !== 1 ? "s" : ""}</span>
          </summary>
          <div className="border-t bg-amber-50/40 px-3 py-2 space-y-2">
            <p className="text-xs text-muted-foreground">
              These ads played but aren't part of any CMS-managed playlist — they're from programs deployed
              directly in Colorlight (legacy bags) or playlists that have since been edited.
            </p>
            <table className="w-full text-xs">
              <tbody>
                {data.unmatched.ads.map((ad) => (
                  <tr key={ad.mediaMd5} className="border-t first:border-t-0">
                    <td className="px-2 py-1 w-5"><AdIcon type={ad.mediaType} /></td>
                    <td className="px-2 py-1 truncate max-w-[260px]" title={ad.mediaName}>{ad.mediaName}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{ad.plays.toLocaleString()} plays</td>
                    <td className="px-2 py-1 text-right text-muted-foreground tabular-nums w-20">{formatHm(ad.durationSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
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
        <TabsTrigger value="adplays">Ad Plays</TabsTrigger>
        <TabsTrigger value="campaignreport">Campaign Report</TabsTrigger>
        <TabsTrigger value="campaign">Campaign</TabsTrigger>
        <TabsTrigger value="zone">Zone</TabsTrigger>
      </TabsList>

      <TabsContent value="timesheet">
        <TimesheetsTab />
      </TabsContent>

      <TabsContent value="adplays">
        <AdPlaysTab />
      </TabsContent>

      <TabsContent value="campaignreport">
        <CampaignReportsTab />
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

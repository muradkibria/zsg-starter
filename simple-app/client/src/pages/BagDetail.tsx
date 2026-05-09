import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ErrorState } from "@/components/ui/error-state";
import {
  ArrowLeft, Save, Loader2, Phone, Mail, MapPin, FileText, Plus, Trash2,
  Download, Clock, ExternalLink, Truck, ListMusic, ShieldAlert,
} from "lucide-react";
import { TimeRangePicker, defaultRange, type TimeRange } from "@/components/map/TimeRangePicker";

// ── Types ────────────────────────────────────────────────────────────────────

interface Bag {
  id: string;
  name: string;
  colorlight_device_id: string;
  status: string;
  rider_id: string | null;
  last_lat: number | null;
  last_lng: number | null;
  last_speed: number | null;
  last_heading: number | null;
  last_gps_at: string | null;
}

interface RiderDocument {
  id: string;
  type: string;
  filename: string;
  mime_type: string;
  data: string;
  size_bytes: number;
  uploaded: string;
}

interface Rider {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  bag_id: string | null;
  status: "active" | "inactive";
  documents: RiderDocument[];
  notes: string;
  created: string;
  updated: string;
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
  bag_id: string;
  days: number;
  totalSessions: number;
  totalSeconds: number;
  totalHours: number;
  byDay: DayBreakdown[];
  sessions: Session[];
}

const DOC_TYPES = ["National ID", "Passport", "Driving Licence", "Proof of Address", "DBS Check", "Right to Work", "Other"];

const MAX_DOC_SIZE = 5 * 1024 * 1024; // 5 MB

function formatHours(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

// ── Status pill ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    active: "bg-green-100 text-green-800 border-green-200",
    inactive: "bg-gray-100 text-gray-600 border-gray-200",
    offline: "bg-red-100 text-red-700 border-red-200",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls[status] ?? cls.inactive}`}>
      {status}
    </span>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function BagDetail() {
  const { bagId } = useParams<{ bagId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  // Bag info (Colorlight)
  const bagQ = useQuery<Bag>({
    queryKey: ["bag", bagId],
    queryFn: () => api.get(`/bags/${bagId}`),
    enabled: !!bagId,
  });

  // Rider assigned to this bag (our store)
  const riderQ = useQuery<Rider | null>({
    queryKey: ["bag-rider", bagId],
    queryFn: async () => {
      try {
        return await api.get<Rider>(`/bags/${bagId}/rider`);
      } catch (err: any) {
        if (err?.status === 404) return null;
        throw err;
      }
    },
    enabled: !!bagId,
    retry: false,
  });

  // Sessions (Colorlight GPS-derived). Default to last 7 days.
  const [timeRange, setTimeRange] = useState<TimeRange>(() => {
    const endMs = Date.now();
    return { startMs: endMs - 7 * 24 * 3600 * 1000, endMs, preset: "last7d", label: "Last 7 days" };
  });
  const sessionStart = new Date(timeRange.startMs).toISOString();
  const sessionEnd = new Date(timeRange.endMs).toISOString();
  const sessionsQ = useQuery<SessionsResponse>({
    queryKey: ["bag-sessions", bagId, sessionStart, sessionEnd],
    queryFn: () =>
      api.get(
        `/bags/${bagId}/sessions?startTime=${encodeURIComponent(sessionStart)}&endTime=${encodeURIComponent(sessionEnd)}`
      ),
    enabled: !!bagId,
  });

  if (!bagId) return null;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* ── Top bar ── */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/fleet")} className="gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Fleet
        </Button>
        <span className="text-muted-foreground">/</span>
        {bagQ.isLoading ? (
          <Skeleton className="h-5 w-32" />
        ) : (
          <h2 className="text-base font-semibold">
            {bagQ.data?.name ?? bagId}
          </h2>
        )}
        {bagQ.data && <StatusBadge status={bagQ.data.status} />}
      </div>

      {/* ── Bag stats ── */}
      <BagStatsCard bag={bagQ.data} loading={bagQ.isLoading} error={bagQ.isError} />

      {/* ── Currently playing ── */}
      <CurrentlyPlayingCard bagId={bagId} />

      {/* ── Rider allocation ── */}
      <RiderAllocationCard
        bagId={bagId}
        rider={riderQ.data ?? null}
        loading={riderQ.isLoading}
        error={riderQ.isError}
        onChange={() => {
          qc.invalidateQueries({ queryKey: ["bag-rider", bagId] });
          qc.invalidateQueries({ queryKey: ["riders"] });
          qc.invalidateQueries({ queryKey: ["bags"] });
        }}
      />

      {/* ── Timesheet ── */}
      <TimesheetSection
        bagId={bagId}
        riderId={riderQ.data?.id ?? null}
        riderName={riderQ.data?.name ?? bagQ.data?.name ?? "this bag"}
        timeRange={timeRange}
        setTimeRange={setTimeRange}
        sessionsQ={sessionsQ}
      />
    </div>
  );
}

// ── Currently-playing card ───────────────────────────────────────────────────

interface PlaylistItemForCard {
  media_id: string;
  filename: string;
  duration_seconds: number;
  file_type: string;
}
interface PlaylistDeployment {
  bag_id: string;
  program_id: number;
  program_name: string;
  deployed_at: string;
  dry_run: boolean;
}
interface PlaylistForCard {
  id: string;
  name: string;
  items: PlaylistItemForCard[];
  deployed_to: PlaylistDeployment[];
}

function CurrentlyPlayingCard({ bagId }: { bagId: string }) {
  const qc = useQueryClient();
  const playlistQ = useQuery<PlaylistForCard | null>({
    queryKey: ["bag-playlist", bagId],
    queryFn: async () => {
      try {
        return await api.get<PlaylistForCard>(`/bags/${bagId}/playlist`);
      } catch (err: any) {
        if (err?.status === 404) return null;
        throw err;
      }
    },
    retry: false,
  });

  const unassign = useMutation({
    mutationFn: () => {
      if (!playlistQ.data) throw new Error("No playlist to unassign");
      return api.post(`/playlists/${playlistQ.data.id}/unassign`, { bagId });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bag-playlist", bagId] });
      qc.invalidateQueries({ queryKey: ["playlists"] });
    },
  });

  const playlist = playlistQ.data;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <ListMusic className="h-4 w-4 text-muted-foreground" />
            Currently playing
          </h3>
          <Link
            to="/playlists"
            className="text-xs text-primary hover:underline"
          >
            Manage playlists →
          </Link>
        </div>

        {playlistQ.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : !playlist ? (
          <div className="text-sm text-muted-foreground bg-muted/40 border rounded-md px-3 py-3">
            <p className="font-medium text-foreground">Not yet managed by CMS</p>
            <p className="text-xs mt-1">
              This bag is still running whatever program was assigned via Colorlight directly.
              To take over from this CMS, build a playlist and deploy it to this bag.
            </p>
            <Link
              to="/playlists"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-2"
            >
              <Plus className="h-3 w-3" /> Create or pick a playlist
            </Link>
          </div>
        ) : (
          <>
            <div className="border rounded-md p-3 bg-muted/20">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <Link
                    to="/playlists"
                    className="text-sm font-semibold text-primary hover:underline"
                  >
                    {playlist.name}
                  </Link>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {playlist.items.length} item{playlist.items.length !== 1 ? "s" : ""} ·{" "}
                    {playlist.items.reduce((s, i) => s + i.duration_seconds, 0)}s loop
                  </p>
                </div>
                {playlist.deployed_to.find((d) => d.bag_id === bagId)?.dry_run && (
                  <span className="inline-flex items-center gap-1 text-[10px] bg-amber-50 text-amber-900 border border-amber-200 rounded px-1.5 py-0.5">
                    <ShieldAlert className="h-2.5 w-2.5" /> Deployed in dev mode
                  </span>
                )}
              </div>
              <ol className="space-y-0.5 list-decimal list-inside">
                {playlist.items.map((item) => (
                  <li key={item.media_id} className="text-xs text-muted-foreground truncate">
                    <span className="text-foreground">{item.filename}</span>
                    <span className="ml-2 tabular-nums">{item.duration_seconds}s</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive text-xs h-7"
                onClick={() => {
                  if (
                    confirm(
                      `Unassign "${playlist.name}" from this bag?\n\n` +
                      "Note: this only updates the CMS. The bag will keep playing the last-pushed program until you push something else."
                    )
                  ) {
                    unassign.mutate();
                  }
                }}
                disabled={unassign.isPending}
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Unassign from this bag
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Bag stats card ───────────────────────────────────────────────────────────

function BagStatsCard({ bag, loading, error }: { bag: Bag | undefined; loading: boolean; error: boolean }) {
  if (loading) {
    return (
      <Card>
        <CardContent className="p-4 space-y-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
        </CardContent>
      </Card>
    );
  }
  if (error || !bag) {
    return <ErrorState title="Couldn't load terminal info" />;
  }
  return (
    <Card>
      <CardContent className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide mb-1">Device ID</p>
          <p className="font-mono text-xs">{bag.colorlight_device_id}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide mb-1">Last GPS</p>
          <p className="text-xs">
            {bag.last_gps_at ? new Date(bag.last_gps_at).toLocaleString() : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide mb-1">Position</p>
          <p className="font-mono text-xs">
            {bag.last_lat != null && bag.last_lng != null
              ? `${bag.last_lat.toFixed(4)}, ${bag.last_lng.toFixed(4)}`
              : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wide mb-1">Speed</p>
          <p className="text-xs">
            {bag.last_speed != null ? `${bag.last_speed.toFixed(1)} km/h` : "—"}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Rider allocation ─────────────────────────────────────────────────────────

interface RiderListEntry {
  id: string;
  name: string;
  bag_id: string | null;
}

function RiderAllocationCard({
  bagId,
  rider,
  loading,
  error,
  onChange,
}: {
  bagId: string;
  rider: Rider | null;
  loading: boolean;
  error: boolean;
  onChange: () => void;
}) {
  const [picking, setPicking] = useState(false);

  // List of all registered riders (for the assignment dropdown)
  const ridersQ = useQuery<RiderListEntry[]>({
    queryKey: ["riders"],
    queryFn: () => api.get("/riders"),
  });

  const assign = useMutation({
    mutationFn: (riderId: string) =>
      api.put(`/bags/${bagId}/rider`, { riderId }),
    onSuccess: () => {
      onChange();
      setPicking(false);
    },
  });

  const unassign = useMutation({
    mutationFn: () => api.delete(`/bags/${bagId}/rider`),
    onSuccess: () => onChange(),
  });

  if (loading) {
    return (
      <Card><CardContent className="p-4"><Skeleton className="h-20 w-full" /></CardContent></Card>
    );
  }
  if (error) {
    return <ErrorState title="Couldn't load rider info" />;
  }

  // Empty state: no rider assigned to this bag
  if (!rider) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold">Rider</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                No rider assigned to this terminal.
              </p>
            </div>
            {!picking && (
              <Button size="sm" onClick={() => setPicking(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Assign rider
              </Button>
            )}
          </div>

          {picking && (
            <RiderPicker
              riders={ridersQ.data ?? []}
              loading={ridersQ.isLoading}
              currentRiderId={null}
              onCancel={() => setPicking(false)}
              onPick={(id) => assign.mutate(id)}
              isPending={assign.isPending}
            />
          )}
        </CardContent>
      </Card>
    );
  }

  // Rider assigned: show summary + actions
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold">Rider</h3>
            <Link
              to={`/riders/${rider.id}`}
              className="text-base font-semibold text-primary hover:underline"
            >
              {rider.name}
            </Link>
          </div>
          {!picking && (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={() => setPicking(true)}>
                Change
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  if (confirm(`Unassign ${rider.name} from this terminal?`)) {
                    unassign.mutate();
                  }
                }}
                disabled={unassign.isPending}
              >
                {unassign.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Unassign"}
              </Button>
            </div>
          )}
        </div>

        {!picking && (
          <div className="space-y-1.5">
            {rider.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span>{rider.phone}</span>
              </div>
            )}
            {rider.email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span>{rider.email}</span>
              </div>
            )}
            {rider.address && (
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span>{rider.address}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
              <FileText className="h-3 w-3" />
              {rider.documents.length} document{rider.documents.length !== 1 ? "s" : ""}
              <Link to={`/riders/${rider.id}`} className="text-primary hover:underline ml-1">
                Manage on rider page →
              </Link>
            </div>
          </div>
        )}

        {picking && (
          <RiderPicker
            riders={ridersQ.data ?? []}
            loading={ridersQ.isLoading}
            currentRiderId={rider.id}
            onCancel={() => setPicking(false)}
            onPick={(id) => assign.mutate(id)}
            isPending={assign.isPending}
          />
        )}
      </CardContent>
    </Card>
  );
}

function RiderPicker({
  riders,
  loading,
  currentRiderId,
  onCancel,
  onPick,
  isPending,
}: {
  riders: RiderListEntry[];
  loading: boolean;
  currentRiderId: string | null;
  onCancel: () => void;
  onPick: (id: string) => void;
  isPending: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string>("");

  if (loading) {
    return <Skeleton className="h-10 w-full" />;
  }
  if (riders.length === 0) {
    return (
      <div className="border border-dashed rounded-md p-4 text-center text-sm">
        <p className="text-muted-foreground mb-2">No riders registered yet.</p>
        <Link to="/fleet" className="text-primary text-xs hover:underline">
          Register a rider on the Fleet → Riders tab
        </Link>
      </div>
    );
  }

  // Sort: unassigned first, then alphabetical. Exclude the currently-assigned rider.
  const options = riders
    .filter((r) => r.id !== currentRiderId)
    .sort((a, b) => {
      const aFree = !a.bag_id;
      const bFree = !b.bag_id;
      if (aFree && !bFree) return -1;
      if (!aFree && bFree) return 1;
      return a.name.localeCompare(b.name);
    });

  return (
    <div className="border rounded-md p-3 bg-muted/20 space-y-2">
      <div>
        <label className="text-xs font-medium text-muted-foreground block mb-1">
          {currentRiderId ? "Replace with" : "Pick a registered rider"}
        </label>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="w-full border rounded-md px-2 py-1.5 text-sm bg-background"
          autoFocus
        >
          <option value="">— select rider —</option>
          {options.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}{r.bag_id ? ` (currently on terminal ${r.bag_id})` : " (unallocated)"}
            </option>
          ))}
        </select>
        {selectedId && options.find((r) => r.id === selectedId)?.bag_id && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2">
            This rider will be moved from their current terminal automatically.
          </p>
        )}
      </div>
      <div className="flex justify-between gap-2">
        <Link to="/fleet" className="text-xs text-primary hover:underline self-center">
          + Register new rider
        </Link>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={() => onPick(selectedId)} disabled={!selectedId || isPending}>
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            {currentRiderId ? "Replace" : "Assign"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Timesheet ────────────────────────────────────────────────────────────────

function TimesheetSection({
  bagId,
  riderId,
  riderName,
  timeRange,
  setTimeRange,
  sessionsQ,
}: {
  bagId: string;
  riderId: string | null;
  riderName: string;
  timeRange: TimeRange;
  setTimeRange: (r: TimeRange) => void;
  sessionsQ: ReturnType<typeof useQuery<SessionsResponse>>;
}) {
  const data = sessionsQ.data;

  const downloadCsv = () => {
    if (riderId) {
      const startStr = new Date(timeRange.startMs).toISOString();
      const endStr = new Date(timeRange.endMs).toISOString();
      window.location.href =
        `/api/riders/${riderId}/sessions/export?startTime=${encodeURIComponent(startStr)}&endTime=${encodeURIComponent(endStr)}`;
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              Timesheet
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Online sessions derived from GPS reports — accurate even when Colorlight's online flag isn't.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <TimeRangePicker value={timeRange} onChange={setTimeRange} />
            {riderId && (
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={downloadCsv}>
                <Download className="h-3 w-3" /> CSV
              </Button>
            )}
          </div>
        </div>

        {sessionsQ.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : sessionsQ.isError ? (
          <ErrorState
            title="Couldn't load timesheet"
            error={sessionsQ.error}
            onRetry={() => sessionsQ.refetch()}
          />
        ) : !data || data.sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No GPS reports in this period
          </p>
        ) : (
          <>
            {/* Summary */}
            <div className="grid grid-cols-3 gap-3">
              <div className="border rounded-md p-3 text-center">
                <p className="text-2xl font-bold">{data.totalHours.toFixed(1)}h</p>
                <p className="text-xs text-muted-foreground">Total online</p>
              </div>
              <div className="border rounded-md p-3 text-center">
                <p className="text-2xl font-bold">{data.totalSessions}</p>
                <p className="text-xs text-muted-foreground">Sessions</p>
              </div>
              <div className="border rounded-md p-3 text-center">
                <p className="text-2xl font-bold">{data.byDay.length}</p>
                <p className="text-xs text-muted-foreground">Active days</p>
              </div>
            </div>

            {/* Per-day breakdown */}
            <div className="space-y-2">
              {data.byDay.map((day) => (
                <DayRow key={day.date} day={day} />
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DayRow({ day }: { day: DayBreakdown }) {
  const [open, setOpen] = useState(false);
  const date = new Date(day.date + "T00:00:00");
  const dayLabel = date.toLocaleDateString(undefined, {
    weekday: "short", day: "numeric", month: "short",
  });

  return (
    <div className="border rounded-md overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-accent/40 transition-colors text-sm"
      >
        <div className="flex items-center gap-3">
          <span className="font-medium w-32 text-left">{dayLabel}</span>
          <span className="text-muted-foreground text-xs">
            {day.session_count} session{day.session_count !== 1 ? "s" : ""}
          </span>
        </div>
        <span className="font-mono font-semibold tabular-nums">
          {formatHours(day.total_seconds)}
        </span>
      </button>

      {open && (
        <div className="border-t bg-muted/30">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left px-3 py-1.5 font-medium">Session</th>
                <th className="text-left px-3 py-1.5 font-medium">Started</th>
                <th className="text-left px-3 py-1.5 font-medium">Ended</th>
                <th className="text-right px-3 py-1.5 font-medium">Duration</th>
                <th className="text-right px-3 py-1.5 font-medium">GPS pts</th>
              </tr>
            </thead>
            <tbody>
              {day.sessions.map((s, i) => (
                <tr key={s.id} className="border-t">
                  <td className="px-3 py-1.5">#{i + 1}</td>
                  <td className="px-3 py-1.5 font-mono">
                    {new Date(s.started_at).toLocaleTimeString()}
                  </td>
                  <td className="px-3 py-1.5 font-mono">
                    {new Date(s.ended_at).toLocaleTimeString()}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {formatHours(s.duration_seconds)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                    {s.gps_points}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

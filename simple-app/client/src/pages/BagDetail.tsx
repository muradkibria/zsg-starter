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

  // Sessions (Colorlight GPS-derived)
  const [days, setDays] = useState(7);
  const sessionsQ = useQuery<SessionsResponse>({
    queryKey: ["bag-sessions", bagId, days],
    queryFn: () => api.get(`/bags/${bagId}/sessions?days=${days}`),
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

      {/* ── Rider profile ── */}
      <RiderSection
        bagId={bagId}
        rider={riderQ.data ?? null}
        loading={riderQ.isLoading}
        error={riderQ.isError}
        onChange={() => {
          qc.invalidateQueries({ queryKey: ["bag-rider", bagId] });
          qc.invalidateQueries({ queryKey: ["riders"] });
        }}
      />

      {/* ── Documents ── */}
      {riderQ.data && (
        <DocumentsSection
          rider={riderQ.data}
          onChange={() => {
            qc.invalidateQueries({ queryKey: ["bag-rider", bagId] });
            qc.invalidateQueries({ queryKey: ["riders"] });
          }}
        />
      )}

      {/* ── Timesheet ── */}
      <TimesheetSection
        bagId={bagId}
        riderId={riderQ.data?.id ?? null}
        riderName={riderQ.data?.name ?? bagQ.data?.name ?? "this bag"}
        days={days}
        setDays={setDays}
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

// ── Rider profile section ───────────────────────────────────────────────────

function RiderSection({
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
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: rider?.name ?? "",
    phone: rider?.phone ?? "",
    email: rider?.email ?? "",
    address: rider?.address ?? "",
    notes: rider?.notes ?? "",
  });

  // Reset form when rider data changes
  useEffect(() => {
    if (rider) {
      setForm({
        name: rider.name,
        phone: rider.phone ?? "",
        email: rider.email ?? "",
        address: rider.address ?? "",
        notes: rider.notes ?? "",
      });
    }
  }, [rider?.id, rider?.updated]);

  const create = useMutation({
    mutationFn: () =>
      api.post<Rider>("/riders", {
        ...form,
        bag_id: bagId,
        status: "active",
      }),
    onSuccess: () => {
      onChange();
      setEditing(false);
    },
  });

  const update = useMutation({
    mutationFn: () => {
      if (!rider) throw new Error("No rider");
      return api.put<Rider>(`/riders/${rider.id}`, {
        name: form.name,
        phone: form.phone || null,
        email: form.email || null,
        address: form.address || null,
        notes: form.notes,
      });
    },
    onSuccess: () => {
      onChange();
      setEditing(false);
    },
  });

  const remove = useMutation({
    mutationFn: () => {
      if (!rider) throw new Error("No rider");
      return api.delete(`/riders/${rider.id}`);
    },
    onSuccess: () => {
      onChange();
      setEditing(false);
    },
  });

  if (loading) {
    return (
      <Card><CardContent className="p-4"><Skeleton className="h-20 w-full" /></CardContent></Card>
    );
  }

  if (error) {
    return <ErrorState title="Couldn't load rider profile" />;
  }

  // Empty state — no rider assigned to this bag
  if (!rider && !editing) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <Truck className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-semibold mb-1">No rider assigned</p>
          <p className="text-xs text-muted-foreground mb-4">
            Register a rider to track contact details, ID documents and online hours for this terminal.
          </p>
          <Button size="sm" onClick={() => setEditing(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Register rider
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Editing OR creating — show form
  if (editing || !rider) {
    return (
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              {rider ? "Edit rider" : "New rider"}
            </h3>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium text-muted-foreground block mb-1">Full name *</label>
              <Input
                placeholder="e.g. James Okafor"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Phone</label>
              <Input
                placeholder="+44 …"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Email</label>
              <Input
                type="email"
                placeholder="rider@email.com"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-muted-foreground block mb-1">Address</label>
              <Input
                placeholder="Street, city, postcode"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-muted-foreground block mb-1">Notes</label>
              <textarea
                rows={3}
                className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring"
                placeholder="Internal notes (shift preferences, training, etc.)"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div>
              {rider && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => {
                    if (confirm("Delete this rider? Their documents and profile will be removed.")) {
                      remove.mutate();
                    }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Delete rider
                </Button>
              )}
            </div>
            <Button
              size="sm"
              onClick={() => (rider ? update.mutate() : create.mutate())}
              disabled={!form.name.trim() || create.isPending || update.isPending}
            >
              {(create.isPending || update.isPending) ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <Save className="h-3.5 w-3.5 mr-1" />
              )}
              {rider ? "Save changes" : "Create rider"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Display mode
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-base font-semibold">{rider.name}</h3>
            <StatusBadge status={rider.status} />
          </div>
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit</Button>
        </div>

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
          {rider.notes && (
            <p className="text-sm text-muted-foreground italic mt-2 whitespace-pre-wrap">
              {rider.notes}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Documents ────────────────────────────────────────────────────────────────

function DocumentsSection({ rider, onChange }: { rider: Rider; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const [docType, setDocType] = useState(DOC_TYPES[0]);
  const [file, setFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file");
      if (file.size > MAX_DOC_SIZE) {
        throw new Error(`File too large — max ${formatBytes(MAX_DOC_SIZE)}`);
      }
      const data = await readFileAsDataURL(file);
      return api.post(`/riders/${rider.id}/documents`, {
        type: docType,
        filename: file.name,
        mime_type: file.type || "application/octet-stream",
        data,
        size_bytes: file.size,
      });
    },
    onSuccess: () => {
      onChange();
      setAdding(false);
      setFile(null);
      setDocType(DOC_TYPES[0]);
      setUploadError(null);
    },
    onError: (err) => setUploadError(err instanceof Error ? err.message : "Upload failed"),
  });

  const remove = useMutation({
    mutationFn: (docId: string) =>
      api.delete(`/riders/${rider.id}/documents/${docId}`),
    onSuccess: () => onChange(),
  });

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">
            ID Documents
            <span className="text-xs text-muted-foreground font-normal ml-2">
              ({rider.documents.length})
            </span>
          </h3>
          {!adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add document
            </Button>
          )}
        </div>

        {adding && (
          <div className="border rounded-md p-3 mb-3 bg-muted/30 space-y-2">
            <div className="flex gap-2">
              <select
                className="border rounded-md px-2 py-1.5 text-xs bg-background"
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
              >
                {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
              <Input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.heic"
                className="text-xs flex-1"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setUploadError(null);
                }}
              />
            </div>
            {uploadError && (
              <p className="text-xs text-destructive">{uploadError}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setAdding(false); setFile(null); setUploadError(null); }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!file || add.isPending}
                onClick={() => add.mutate()}
              >
                {add.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                Upload
              </Button>
            </div>
          </div>
        )}

        {rider.documents.length === 0 && !adding ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            No documents uploaded
          </p>
        ) : (
          <div className="space-y-1.5">
            {rider.documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center gap-2 border rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors group"
              >
                <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-xs">{doc.type}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {doc.filename} · {formatBytes(doc.size_bytes)} · uploaded {new Date(doc.uploaded).toLocaleDateString()}
                  </p>
                </div>
                <a
                  href={doc.data}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground p-1"
                  title="Open"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <a
                  href={doc.data}
                  download={doc.filename}
                  className="text-muted-foreground hover:text-foreground p-1"
                  title="Download"
                >
                  <Download className="h-3.5 w-3.5" />
                </a>
                <button
                  onClick={() => {
                    if (confirm(`Delete "${doc.filename}"?`)) remove.mutate(doc.id);
                  }}
                  className="text-muted-foreground hover:text-destructive p-1 opacity-0 group-hover:opacity-100"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Timesheet ────────────────────────────────────────────────────────────────

function TimesheetSection({
  bagId,
  riderId,
  riderName,
  days,
  setDays,
  sessionsQ,
}: {
  bagId: string;
  riderId: string | null;
  riderName: string;
  days: number;
  setDays: (n: number) => void;
  sessionsQ: ReturnType<typeof useQuery<SessionsResponse>>;
}) {
  const data = sessionsQ.data;

  const downloadCsv = () => {
    if (riderId) {
      window.location.href = `/api/riders/${riderId}/sessions/export?days=${days}`;
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
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="border rounded-md px-2 py-1 text-xs bg-background h-7"
            >
              <option value={1}>Today</option>
              <option value={3}>Last 3 days</option>
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
            </select>
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

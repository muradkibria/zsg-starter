import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, EmptyState } from "@/components/ui/error-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Film, Image as ImageIcon, Upload, Loader2, Trash2, Clock, ShieldAlert, ListMusic,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface MediaAsset {
  id: string;
  filename: string;
  file_type: string;
  file_size_bytes: number | null;
  duration_seconds: number | null;
  fileUrl: string;
  created: string;
  source_url?: string;
  thumbnail_url?: string;
}

interface DevUpload {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  file_type: "video" | "image";
  duration_seconds: number;
  width: number;
  height: number;
  created: string;
  deployed_to: { bagIds: string[]; programName: string; at: string }[];
}

interface SystemStatus {
  writesEnabled: boolean;
  mode: "mock" | "live";
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(b: number | null) {
  if (!b) return "";
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function Media() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [duration, setDuration] = useState(10);

  // Live media (from Colorlight)
  const liveQ = useQuery<MediaAsset[]>({
    queryKey: ["media"],
    queryFn: () => api.get("/media"),
  });

  // Pending dev-queue uploads
  const devQ = useQuery<DevUpload[]>({
    queryKey: ["dev-uploads"],
    queryFn: () => api.get("/uploads/dev-queue"),
  });

  // System status (to know whether we're in dev mode)
  const statusQ = useQuery<SystemStatus>({
    queryKey: ["system-status"],
    queryFn: () => api.get("/system/status"),
  });

  const isDev = statusQ.data?.writesEnabled === false;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("duration_seconds", String(duration));
      await api.upload("/upload", fd);
      qc.invalidateQueries({ queryKey: ["media"] });
      qc.invalidateQueries({ queryKey: ["dev-uploads"] });
      qc.invalidateQueries({ queryKey: ["system-status"] });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const deleteDev = useMutation({
    mutationFn: (id: string) => api.delete(`/uploads/dev-queue/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dev-uploads"] });
      qc.invalidateQueries({ queryKey: ["system-status"] });
    },
  });

  const liveAssets = liveQ.data ?? [];
  const devUploads = devQ.data ?? [];

  return (
    <div className="space-y-6">
      {/* ── Upload form ── */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="text-sm font-semibold">Upload an ad</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                MP4 / MOV / JPG / PNG · 160×120 · max 100 MB
              </p>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Duration:</label>
              <Input
                type="number"
                min={1}
                max={300}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-20 h-8 text-xs"
              />
              <span className="text-xs text-muted-foreground">sec</span>
              <Button
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading
                  ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Uploading…</>
                  : <><Upload className="h-3.5 w-3.5 mr-1" />Choose file</>}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/mp4,video/quicktime"
                className="hidden"
                onChange={handleUpload}
              />
            </div>
          </div>

          {uploadError && (
            <p className="text-xs text-destructive">{uploadError}</p>
          )}

          {isDev && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 flex items-center gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
              Dev mode — uploads land in the queue below but don't reach Colorlight until writes are enabled.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            After uploading, head to the{" "}
            <Link to="/playlists" className="text-primary hover:underline">Playlists page</Link>{" "}
            to assemble an ordered loop and deploy it to your bags.
          </p>
        </CardContent>
      </Card>

      {/* ── Dev queue ── */}
      {devUploads.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-600" />
            Pending uploads (dev queue)
            <Badge variant="outline" className="text-xs">{devUploads.length}</Badge>
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {devUploads.map((dev) => {
              const isVideo = dev.file_type === "video";
              return (
                <Card key={dev.id} className="overflow-hidden group relative">
                  <div className="aspect-video bg-muted flex items-center justify-center relative">
                    {isVideo
                      ? <Film className="h-10 w-10 text-muted-foreground/50" />
                      : <ImageIcon className="h-10 w-10 text-muted-foreground/50" />}
                    <Badge className="absolute top-2 left-2 bg-amber-100 text-amber-900 border-amber-300 text-[10px]">
                      Pending
                    </Badge>
                  </div>
                  <CardContent className="p-2 space-y-1">
                    <div className="flex items-center gap-1">
                      {isVideo
                        ? <Film className="h-3 w-3 text-muted-foreground shrink-0" />
                        : <ImageIcon className="h-3 w-3 text-muted-foreground shrink-0" />}
                      <p className="text-xs font-medium truncate flex-1" title={dev.filename}>
                        {dev.filename}
                      </p>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{formatBytes(dev.size_bytes)}</span>
                      <span>{dev.duration_seconds}s</span>
                    </div>
                    {dev.deployed_to.length > 0 && (
                      <p className="text-[10px] text-green-700">
                        Deployed × {dev.deployed_to.length}
                      </p>
                    )}
                    <div className="flex items-center gap-1 pt-1">
                      <UsedInBadge mediaId={dev.id} className="flex-1" />
                      <button
                        onClick={() => {
                          if (confirm(`Delete pending upload "${dev.filename}"?`)) {
                            deleteDev.mutate(dev.id);
                          }
                        }}
                        className="text-muted-foreground hover:text-destructive p-1"
                        title="Remove from queue"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Live media ── */}
      <div>
        <h3 className="text-sm font-semibold mb-2">
          Media library
          <span className="text-xs text-muted-foreground font-normal ml-2">
            ({liveAssets.length})
          </span>
        </h3>

        {liveQ.isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-video rounded-lg" />)}
          </div>
        ) : liveQ.isError ? (
          <ErrorState
            title="Couldn't load media library"
            error={liveQ.error}
            onRetry={() => liveQ.refetch()}
          />
        ) : liveAssets.length === 0 ? (
          <EmptyState
            title="No media yet"
            message={isDev
              ? "Upload an ad above — it'll land in the dev queue."
              : "Upload an ad above to populate your Colorlight library."}
            icon={<Upload className="h-5 w-5" />}
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {liveAssets.map((asset) => {
              const isVideo = asset.file_type === "video" || asset.file_type === "mp4";
              return (
                <Card key={asset.id} className="overflow-hidden group relative">
                  <div className="aspect-video bg-muted flex items-center justify-center overflow-hidden">
                    {asset.fileUrl ? (
                      <img
                        src={asset.fileUrl}
                        alt={asset.filename}
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : isVideo ? (
                      <Film className="h-10 w-10 text-muted-foreground/50" />
                    ) : (
                      <ImageIcon className="h-10 w-10 text-muted-foreground/50" />
                    )}
                  </div>
                  <CardContent className="p-2 space-y-1">
                    <div className="flex items-center gap-1">
                      {isVideo
                        ? <Film className="h-3 w-3 text-muted-foreground shrink-0" />
                        : <ImageIcon className="h-3 w-3 text-muted-foreground shrink-0" />}
                      <p className="text-xs font-medium truncate flex-1" title={asset.filename}>
                        {asset.filename}
                      </p>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{formatBytes(asset.file_size_bytes)}</span>
                      {asset.duration_seconds ? <span>{asset.duration_seconds}s</span> : null}
                    </div>
                    <UsedInBadge mediaId={asset.id} className="mt-1" />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}

// ── "Used in N playlists" badge with click-to-list ───────────────────────────

function UsedInBadge({ mediaId, className = "" }: { mediaId: string; className?: string }) {
  const { data } = useQuery<{ id: string; name: string; item_count: number }[]>({
    queryKey: ["media-playlists", mediaId],
    queryFn: () => api.get(`/media/${mediaId}/playlists`),
  });
  const playlists = data ?? [];
  if (playlists.length === 0) {
    return (
      <Link
        to="/playlists"
        className={`inline-flex items-center justify-center gap-1 text-[11px] text-muted-foreground border rounded-md py-1 px-2 hover:bg-accent hover:text-foreground transition-colors ${className}`}
      >
        <ListMusic className="h-3 w-3" />
        Add to playlist
      </Link>
    );
  }
  return (
    <Link
      to="/playlists"
      className={`inline-flex items-center justify-center gap-1 text-[11px] text-primary border border-primary/30 bg-primary/5 rounded-md py-1 px-2 hover:bg-primary/10 transition-colors ${className}`}
      title={playlists.map((p) => p.name).join(", ")}
    >
      <ListMusic className="h-3 w-3" />
      In {playlists.length} playlist{playlists.length !== 1 ? "s" : ""}
    </Link>
  );
}


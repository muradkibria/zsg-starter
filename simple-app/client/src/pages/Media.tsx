import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, EmptyState } from "@/components/ui/error-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Film, Image as ImageIcon, Upload, Loader2, Send, Trash2, Clock, ShieldAlert,
} from "lucide-react";
import { useLiveBags } from "@/hooks/use-live-bags";

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
  const [deployTarget, setDeployTarget] = useState<{ kind: "dev"; upload: DevUpload } | { kind: "live"; asset: MediaAsset } | null>(null);

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
                      <Button
                        size="sm"
                        className="h-7 text-xs flex-1"
                        onClick={() => setDeployTarget({ kind: "dev", upload: dev })}
                      >
                        <Send className="h-3 w-3 mr-1" /> Deploy
                      </Button>
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
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs w-full mt-1"
                      onClick={() => setDeployTarget({ kind: "live", asset })}
                    >
                      <Send className="h-3 w-3 mr-1" /> Deploy
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Deploy modal ── */}
      {deployTarget && (
        <DeployModal
          target={deployTarget}
          onClose={() => setDeployTarget(null)}
          isDev={isDev ?? false}
        />
      )}
    </div>
  );
}

// ── Deploy modal ─────────────────────────────────────────────────────────────

function DeployModal({
  target,
  onClose,
  isDev,
}: {
  target: { kind: "dev"; upload: DevUpload } | { kind: "live"; asset: MediaAsset };
  onClose: () => void;
  isDev: boolean;
}) {
  const qc = useQueryClient();
  const { bags } = useLiveBags();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [programName, setProgramName] = useState(() => {
    const name = target.kind === "dev" ? target.upload.filename : target.asset.filename;
    return name.replace(/\.[^.]+$/, "");
  });
  const [result, setResult] = useState<null | {
    programId: number;
    programName: string;
    bagIds: string[];
    dryRun: boolean;
    message: string;
  }>(null);

  const sortedBags = [...bags].sort((a, b) => {
    if (a.status === "active" && b.status !== "active") return -1;
    if (a.status !== "active" && b.status === "active") return 1;
    return a.name.localeCompare(b.name);
  });

  const filtered = search
    ? sortedBags.filter((b) => b.name.toLowerCase().includes(search.toLowerCase()))
    : sortedBags;

  const toggleBag = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllActive = () => setSelected(new Set(sortedBags.filter((b) => b.status === "active").map((b) => b.id)));
  const clearAll = () => setSelected(new Set());

  const deploy = useMutation({
    mutationFn: () =>
      api.post<{ programId: number; programName: string; bagIds: string[]; dryRun: boolean; message: string }>(
        "/deploy",
        target.kind === "dev"
          ? {
              uploadId: target.upload.id,
              bagIds: Array.from(selected),
              programName,
            }
          : {
              mediaId: target.asset.id,
              filename: target.asset.filename,
              source_url: target.asset.source_url ?? target.asset.fileUrl,
              thumbnail_url: target.asset.thumbnail_url ?? target.asset.fileUrl,
              file_type: target.asset.file_type === "video" ? "mp4" : target.asset.file_type,
              type: target.asset.file_type === "video" ? "video" : "image",
              duration_seconds: target.asset.duration_seconds ?? 10,
              bagIds: Array.from(selected),
              programName,
            }
      ),
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: ["dev-uploads"] });
    },
  });

  const fileName = target.kind === "dev" ? target.upload.filename : target.asset.filename;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Deploy to bags</DialogTitle>
          <p className="text-xs text-muted-foreground mt-1 truncate" title={fileName}>
            {fileName}
          </p>
        </DialogHeader>

        {result ? (
          <div className="space-y-3 py-4">
            <div className={`rounded-md p-4 ${result.dryRun ? "bg-amber-50 border border-amber-200" : "bg-green-50 border border-green-200"}`}>
              <p className="text-sm font-medium mb-1">
                {result.dryRun ? "Dry-run completed" : "Deployed"}
              </p>
              <p className="text-xs text-muted-foreground">{result.message}</p>
            </div>
            <div className="text-xs space-y-0.5">
              <p><span className="text-muted-foreground">Program ID:</span> {result.programId}</p>
              <p><span className="text-muted-foreground">Program name:</span> {result.programName}</p>
              <p><span className="text-muted-foreground">Bags:</span> {result.bagIds.length}</p>
            </div>
            <DialogFooter>
              <Button onClick={onClose}>Close</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-3 py-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  Program name
                </label>
                <Input
                  value={programName}
                  onChange={(e) => setProgramName(e.target.value)}
                  placeholder="e.g. BurgerKing Spring Sale"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Select bags ({selected.size} of {sortedBags.length})
                  </label>
                  <div className="flex items-center gap-2 text-xs">
                    <button onClick={selectAllActive} className="text-primary hover:underline">
                      All active
                    </button>
                    <span className="text-muted-foreground">·</span>
                    <button onClick={clearAll} className="text-primary hover:underline">
                      Clear
                    </button>
                  </div>
                </div>
                <Input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="mb-2 h-8 text-xs"
                />
                <div className="border rounded-md max-h-60 overflow-y-auto">
                  {filtered.map((bag) => {
                    const checked = selected.has(bag.id);
                    return (
                      <label
                        key={bag.id}
                        className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-accent ${checked ? "bg-accent/50" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleBag(bag.id)}
                          className="h-3.5 w-3.5"
                        />
                        <span
                          className={`inline-block w-2 h-2 rounded-full shrink-0 ${
                            bag.status === "active" ? "bg-green-500" : "bg-gray-400"
                          }`}
                        />
                        <span className="flex-1 truncate">{bag.name}</span>
                        <span className="text-[10px] text-muted-foreground capitalize">{bag.status}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {isDev && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                  Dev mode — Deploy will be logged but no real action taken.
                </p>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                onClick={() => deploy.mutate()}
                disabled={selected.size === 0 || !programName.trim() || deploy.isPending}
              >
                {deploy.isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  : <Send className="h-3.5 w-3.5 mr-1" />}
                {isDev ? "Deploy (dry-run)" : "Deploy"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

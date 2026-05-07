import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ErrorState, EmptyState } from "@/components/ui/error-state";
import { useLiveBags } from "@/hooks/use-live-bags";
import {
  Plus, ListMusic, Film, Image as ImageIcon, Send, ChevronUp, ChevronDown, Trash2,
  Save, Loader2, ShieldAlert, X, Pencil, Search,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface PlaylistItem {
  media_id: string;
  filename: string;
  file_type: string;
  duration_seconds: number;
  source_url?: string;
  thumbnail_url?: string;
  fileID?: number;
}

interface PlaylistDeployment {
  bag_id: string;
  program_id: number;
  program_name: string;
  deployed_at: string;
  dry_run: boolean;
}

interface Playlist {
  id: string;
  name: string;
  items: PlaylistItem[];
  deployed_to: PlaylistDeployment[];
  created: string;
  updated: string;
}

interface MediaAsset {
  id: string;
  filename: string;
  file_type: string;
  duration_seconds: number | null;
  fileUrl: string;
  source_url?: string;
  thumbnail_url?: string;
}

interface DevUpload {
  id: string;
  filename: string;
  file_type: "video" | "image";
  duration_seconds: number;
  size_bytes: number;
}

interface SystemStatus {
  writesEnabled: boolean;
  mode: "mock" | "live";
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function totalDuration(items: PlaylistItem[]): number {
  return items.reduce((sum, i) => sum + (i.duration_seconds || 0), 0);
}

function formatDuration(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return ss === 0 ? `${m}m` : `${m}m ${ss}s`;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function Playlists() {
  const qc = useQueryClient();
  const [editorOpen, setEditorOpen] = useState<{ kind: "new" } | { kind: "edit"; playlist: Playlist } | null>(null);

  const playlistsQ = useQuery<Playlist[]>({
    queryKey: ["playlists"],
    queryFn: () => api.get("/playlists"),
  });

  const statusQ = useQuery<SystemStatus>({
    queryKey: ["system-status"],
    queryFn: () => api.get("/system/status"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/playlists/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["playlists"] }),
    onError: (err: any) => {
      alert(`Couldn't delete: ${err?.message ?? "unknown error"}`);
    },
  });

  const playlists = playlistsQ.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <ListMusic className="h-4 w-4 text-muted-foreground" />
            Playlists
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Build ordered loops of ad creatives, then deploy to one or more bags. Each bag plays one playlist at a time.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditorOpen({ kind: "new" })}>
          <Plus className="h-3.5 w-3.5 mr-1" /> New playlist
        </Button>
      </div>

      {playlistsQ.isError ? (
        <ErrorState
          title="Couldn't load playlists"
          error={playlistsQ.error}
          onRetry={() => playlistsQ.refetch()}
        />
      ) : playlistsQ.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : playlists.length === 0 ? (
        <EmptyState
          title="No playlists yet"
          message="Create your first playlist to define what plays on your bags."
          icon={<ListMusic className="h-5 w-5" />}
          action={
            <Button size="sm" onClick={() => setEditorOpen({ kind: "new" })}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Create playlist
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {playlists.map((p) => (
            <Card key={p.id}>
              <CardContent className="p-3 flex items-center gap-3">
                <ListMusic className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.items.length} item{p.items.length !== 1 ? "s" : ""} ·{" "}
                    {formatDuration(totalDuration(p.items))} total ·{" "}
                    {p.deployed_to.length === 0
                      ? "Not deployed"
                      : `On ${p.deployed_to.length} bag${p.deployed_to.length !== 1 ? "s" : ""}`}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setEditorOpen({ kind: "edit", playlist: p })}
                  >
                    <Pencil className="h-3 w-3 mr-1" /> Edit
                  </Button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete playlist "${p.name}"?`)) remove.mutate(p.id);
                    }}
                    disabled={p.deployed_to.length > 0}
                    title={p.deployed_to.length > 0 ? "Unassign from all bags first" : "Delete"}
                    className="text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:cursor-not-allowed p-1.5"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editorOpen && (
        <PlaylistEditor
          mode={editorOpen}
          isDev={statusQ.data?.writesEnabled === false}
          onClose={() => setEditorOpen(null)}
        />
      )}
    </div>
  );
}

// ── Editor (create or edit) ──────────────────────────────────────────────────

function PlaylistEditor({
  mode,
  isDev,
  onClose,
}: {
  mode: { kind: "new" } | { kind: "edit"; playlist: Playlist };
  isDev: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = mode.kind === "edit";
  const initial = isEdit ? mode.playlist : null;

  const [name, setName] = useState(initial?.name ?? "");
  const [items, setItems] = useState<PlaylistItem[]>(initial?.items ?? []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);

  const dirty =
    !isEdit ||
    name !== initial!.name ||
    JSON.stringify(items) !== JSON.stringify(initial!.items);

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    const next = [...items];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    setItems(next);
  };
  const moveDown = (idx: number) => {
    if (idx === items.length - 1) return;
    const next = [...items];
    [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
    setItems(next);
  };
  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };
  const addItems = (newItems: PlaylistItem[]) => {
    setItems((prev) => [...prev, ...newItems]);
    setPickerOpen(false);
  };

  // ── Drag-reorder via HTML5 dnd ────────────────────────────────────────────
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const handleDragStart = (e: React.DragEvent, idx: number) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = "move";
  };
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    setDragIdx(idx);
  };
  const handleDragEnd = () => setDragIdx(null);

  const create = useMutation({
    mutationFn: () => api.post<Playlist>("/playlists", { name: name.trim(), items }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playlists"] });
      onClose();
    },
  });

  const save = useMutation({
    mutationFn: () =>
      api.put<Playlist>(`/playlists/${initial!.id}`, { name: name.trim(), items }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playlists"] });
      onClose();
    },
  });

  const total = totalDuration(items);
  const canSave = name.trim().length > 0 && items.length > 0;
  const isDeployed = isEdit && initial!.deployed_to.length > 0;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit: ${initial!.name}` : "New playlist"}</DialogTitle>
          {isDeployed && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mt-2 flex items-center gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
              This playlist is currently deployed to {initial!.deployed_to.length} bag{initial!.deployed_to.length !== 1 ? "s" : ""}.
              Saving updates the playlist but does not auto-redeploy. Hit "Save & Deploy" to push the changes.
            </p>
          )}
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Morning Loop"
            />
          </div>

          {/* Items list */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-muted-foreground">
                Items · plays in this order
                {items.length > 0 && (
                  <span className="ml-2 text-foreground/70">
                    {items.length} item{items.length !== 1 ? "s" : ""} · {formatDuration(total)} total
                  </span>
                )}
              </label>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPickerOpen(true)}>
                <Plus className="h-3 w-3 mr-1" /> Add media
              </Button>
            </div>

            {items.length === 0 ? (
              <div className="border border-dashed rounded-md py-8 text-center text-sm text-muted-foreground">
                No items yet — click <strong>Add media</strong> to start building the loop.
              </div>
            ) : (
              <div className="border rounded-md divide-y">
                {items.map((item, idx) => {
                  const isVideo = item.file_type === "video" || item.file_type === "mp4";
                  const isDevItem = item.media_id.startsWith("dev_");
                  return (
                    <div
                      key={`${item.media_id}-${idx}`}
                      draggable
                      onDragStart={(e) => handleDragStart(e, idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDragEnd={handleDragEnd}
                      className={`flex items-center gap-2 px-2 py-2 hover:bg-accent/40 ${dragIdx === idx ? "opacity-50" : ""}`}
                    >
                      <span
                        className="cursor-move text-muted-foreground select-none"
                        title="Drag to reorder"
                        style={{ fontSize: 18, lineHeight: 1 }}
                      >
                        ≡
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums w-5 text-right">
                        {idx + 1}.
                      </span>
                      {isVideo
                        ? <Film className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        : <ImageIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                      <span className="flex-1 text-sm truncate" title={item.filename}>
                        {item.filename}
                      </span>
                      {isDevItem && (
                        <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-900 border-amber-200">
                          dev
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">
                        {item.duration_seconds}s
                      </span>
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() => moveUp(idx)}
                          disabled={idx === 0}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-30 p-1"
                          title="Move up"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => moveDown(idx)}
                          disabled={idx === items.length - 1}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-30 p-1"
                          title="Move down"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => removeItem(idx)}
                          className="text-muted-foreground hover:text-destructive p-1"
                          title="Remove from playlist"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {isDev && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 flex items-center gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
              Dev mode — saving this playlist is fine, but "Save & Deploy" will be a no-op against real bags until writes are enabled.
            </p>
          )}
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="outline"
            disabled={!canSave || (isEdit && !dirty) || create.isPending || save.isPending}
            onClick={() => (isEdit ? save.mutate() : create.mutate())}
          >
            {(create.isPending || save.isPending)
              ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              : <Save className="h-3.5 w-3.5 mr-1" />}
            Save draft
          </Button>
          <Button
            disabled={!canSave || create.isPending || save.isPending}
            onClick={async () => {
              // Save first if needed, then open the deploy dialog
              if (isEdit && dirty) {
                await save.mutateAsync();
              } else if (!isEdit) {
                await create.mutateAsync();
                onClose();
                return; // for new playlists, deploy from the list afterwards
              }
              setDeployOpen(true);
            }}
          >
            <Send className="h-3.5 w-3.5 mr-1" />
            Save & Deploy
          </Button>
        </DialogFooter>

        {pickerOpen && (
          <MediaPicker
            existingIds={new Set(items.map((i) => i.media_id))}
            onClose={() => setPickerOpen(false)}
            onPick={addItems}
          />
        )}

        {deployOpen && isEdit && (
          <DeployDialog
            playlist={{ ...initial!, name: name.trim(), items }}
            isDev={isDev}
            onClose={() => setDeployOpen(false)}
            onDeployed={() => {
              setDeployOpen(false);
              onClose();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Media picker ─────────────────────────────────────────────────────────────

function MediaPicker({
  existingIds,
  onClose,
  onPick,
}: {
  existingIds: Set<string>;
  onClose: () => void;
  onPick: (items: PlaylistItem[]) => void;
}) {
  const liveQ = useQuery<MediaAsset[]>({
    queryKey: ["media"],
    queryFn: () => api.get("/media"),
  });
  const devQ = useQuery<DevUpload[]>({
    queryKey: ["dev-uploads"],
    queryFn: () => api.get("/uploads/dev-queue"),
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const live = liveQ.data ?? [];
  const dev = devQ.data ?? [];

  const candidates = useMemo(() => {
    const all = [
      ...dev.map<{ kind: "dev"; id: string; filename: string; file_type: "video" | "image"; duration: number }>((d) => ({
        kind: "dev",
        id: d.id,
        filename: d.filename,
        file_type: d.file_type,
        duration: d.duration_seconds,
      })),
      ...live.map<{ kind: "live"; id: string; filename: string; file_type: string; duration: number; source_url?: string; thumbnail_url?: string }>((m) => ({
        kind: "live",
        id: m.id,
        filename: m.filename,
        file_type: m.file_type,
        duration: m.duration_seconds ?? 10,
        source_url: m.source_url ?? m.fileUrl,
        thumbnail_url: m.thumbnail_url ?? m.fileUrl,
      })),
    ];
    if (!search) return all;
    return all.filter((c) => c.filename.toLowerCase().includes(search.toLowerCase()));
  }, [live, dev, search]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = () => {
    const items: PlaylistItem[] = [];
    for (const c of candidates) {
      if (!selected.has(c.id)) continue;
      items.push({
        media_id: c.id,
        filename: c.filename,
        file_type: c.file_type,
        duration_seconds: c.duration,
        source_url: c.kind === "live" ? (c as any).source_url : undefined,
        thumbnail_url: c.kind === "live" ? (c as any).thumbnail_url : undefined,
        fileID: c.kind === "live" ? Number(c.id) : undefined,
      });
    }
    onPick(items);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add media</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex items-center gap-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search files…"
              className="h-8 text-xs"
            />
          </div>

          {liveQ.isLoading || devQ.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : candidates.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">
              No media available. Upload some from the Media page first.
            </p>
          ) : (
            <div className="border rounded-md max-h-72 overflow-y-auto">
              {candidates.map((c) => {
                const checked = selected.has(c.id);
                const alreadyAdded = existingIds.has(c.id);
                const isVideo = c.file_type === "video" || c.file_type === "mp4";
                return (
                  <label
                    key={c.id}
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-accent ${alreadyAdded ? "opacity-50" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={alreadyAdded}
                      onChange={() => toggle(c.id)}
                      className="h-3.5 w-3.5"
                    />
                    {isVideo
                      ? <Film className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      : <ImageIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                    <span className="flex-1 truncate">{c.filename}</span>
                    {c.kind === "dev" && (
                      <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-900 border-amber-200">
                        dev
                      </Badge>
                    )}
                    <span className="text-muted-foreground tabular-nums">{c.duration}s</span>
                    {alreadyAdded && <span className="text-[10px] text-muted-foreground">already added</span>}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={selected.size === 0} onClick={handleAdd}>
            Add {selected.size > 0 ? `${selected.size} item${selected.size !== 1 ? "s" : ""}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Deploy dialog ────────────────────────────────────────────────────────────

function DeployDialog({
  playlist,
  isDev,
  onClose,
  onDeployed,
}: {
  playlist: Playlist;
  isDev: boolean;
  onClose: () => void;
  onDeployed: () => void;
}) {
  const { bags } = useLiveBags();
  const [selected, setSelected] = useState<Set<string>>(
    new Set(playlist.deployed_to.map((d) => d.bag_id))
  );
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<null | {
    bagIds: string[];
    dryRun: boolean;
    message: string;
    itemCount: number;
  }>(null);

  const sortedBags = [...bags].sort((a, b) => {
    if (a.status === "active" && b.status !== "active") return -1;
    if (a.status !== "active" && b.status === "active") return 1;
    return a.name.localeCompare(b.name);
  });
  const filtered = search
    ? sortedBags.filter((b) => b.name.toLowerCase().includes(search.toLowerCase()))
    : sortedBags;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deploy = useMutation({
    mutationFn: () =>
      api.post<{ bagIds: string[]; dryRun: boolean; message: string; itemCount: number }>(
        `/playlists/${playlist.id}/deploy`,
        { bagIds: Array.from(selected) }
      ),
    onSuccess: (data) => {
      setResult(data);
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Deploy "{playlist.name}"</DialogTitle>
          <p className="text-xs text-muted-foreground">
            {playlist.items.length} item{playlist.items.length !== 1 ? "s" : ""} · {formatDuration(totalDuration(playlist.items))} loop
          </p>
        </DialogHeader>

        {result ? (
          <div className="py-4 space-y-3">
            <div className={`rounded-md p-4 ${result.dryRun ? "bg-amber-50 border border-amber-200" : "bg-green-50 border border-green-200"}`}>
              <p className="text-sm font-medium mb-1">{result.dryRun ? "Dry-run completed" : "Deployed"}</p>
              <p className="text-xs text-muted-foreground">{result.message}</p>
            </div>
            <DialogFooter>
              <Button onClick={onDeployed}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-3 py-2">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Select bags ({selected.size} of {sortedBags.length})
                  </label>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      onClick={() => setSelected(new Set(sortedBags.filter((b) => b.status === "active").map((b) => b.id)))}
                      className="text-primary hover:underline"
                    >
                      All active
                    </button>
                    <span className="text-muted-foreground">·</span>
                    <button onClick={() => setSelected(new Set())} className="text-primary hover:underline">
                      Clear
                    </button>
                  </div>
                </div>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search bags…"
                  className="h-8 text-xs mb-2"
                />
                <div className="border rounded-md max-h-60 overflow-y-auto">
                  {filtered.map((b) => {
                    const checked = selected.has(b.id);
                    return (
                      <label
                        key={b.id}
                        className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-accent ${checked ? "bg-accent/50" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(b.id)}
                          className="h-3.5 w-3.5"
                        />
                        <span
                          className={`inline-block w-2 h-2 rounded-full shrink-0 ${
                            b.status === "active" ? "bg-green-500" : "bg-gray-400"
                          }`}
                        />
                        <span className="flex-1 truncate">{b.name}</span>
                        <span className="text-[10px] text-muted-foreground capitalize">{b.status}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {isDev && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                  Dev mode — deploy will be logged but no real action taken.
                </p>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                onClick={() => deploy.mutate()}
                disabled={selected.size === 0 || deploy.isPending}
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

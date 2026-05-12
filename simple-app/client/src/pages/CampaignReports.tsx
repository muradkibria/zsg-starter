import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ErrorState, EmptyState } from "@/components/ui/error-state";
import { TimeRangePicker, defaultRange, type TimeRange } from "@/components/map/TimeRangePicker";
import { BagFilter, applyBagFilter } from "@/components/map/BagFilter";
import { useLiveBags } from "@/hooks/use-live-bags";
import {
  Sparkles, Upload, FileText, Trash2, Loader2, ChevronRight, ChevronDown,
  Film, Image as ImageIcon, X, AlertCircle, Download, BarChart2,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface SystemStatus {
  tflDatasetLoaded: boolean;
  anthropicConfigured: boolean;
  canGenerate: boolean;
}

interface TflSummary {
  hasDataset: boolean;
  meta: {
    rowCount: number;
    uploadedAt: string;
    sourceFilename: string;
    minFootfall: number;
    maxFootfall: number;
    bbox?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  };
  sample: { station_name: string; lat: number; lng: number; daily_entries: number; daily_exits: number; zone?: string }[];
}

interface MediaAsset {
  id: string;
  filename: string;
  file_type: string;
  duration_seconds: number | null;
  fileUrl: string;
}

interface Campaign {
  id: string;
  client_name: string;
  campaign_name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
}

interface SavedReportSummary {
  id: string;
  title: string;
  campaign_id: string | null;
  client_name: string | null;
  campaign_name: string | null;
  ad_count: number;
  bag_count: number;
  start_time: string;
  end_time: string;
  estimated_impressions: number;
  total_plays: number;
  generated_at: string;
  model_used: string | null;
}

interface SavedReport extends SavedReportSummary {
  ad_ids: string[];
  bag_ids: string[];
  numbers: any;
  narrative_markdown: string | null;
  token_usage: { input: number; output: number } | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  return Math.round(n).toLocaleString();
}

function formatHm(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── Main tab ─────────────────────────────────────────────────────────────────

export function CampaignReportsTab() {
  const [viewing, setViewing] = useState<string | null>(null);

  const statusQ = useQuery<SystemStatus>({
    queryKey: ["reports-system-status"],
    queryFn: () => api.get("/reports/system-status"),
    refetchInterval: 60_000,
  });

  if (viewing) {
    return <ReportViewer reportId={viewing} onClose={() => setViewing(null)} />;
  }

  return (
    <div className="space-y-4">
      <SystemStatusBar status={statusQ.data} loading={statusQ.isLoading} />
      <GenerateForm canGenerate={!!statusQ.data?.canGenerate} onViewReport={setViewing} />
      <SavedReportsList onView={setViewing} />
    </div>
  );
}

// ── System status bar (TfL + Anthropic readiness) ────────────────────────────

function SystemStatusBar({ status, loading }: { status: SystemStatus | undefined; loading: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (loading) {
    return <Skeleton className="h-12 w-full" />;
  }

  const ready = status?.canGenerate;

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full text-left rounded-md px-3 py-2 border flex items-center gap-2 text-sm transition-colors ${
          ready
            ? "bg-green-50 border-green-200 text-green-900 hover:bg-green-100"
            : "bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100"
        }`}
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <strong>{ready ? "Ready to generate reports" : "Setup needed before you can generate reports"}</strong>
        <span className="text-xs ml-auto">
          {status?.tflDatasetLoaded ? "✓" : "✗"} TfL · {status?.anthropicConfigured ? "✓" : "✗"} Claude
        </span>
      </button>

      {expanded && (
        <div className="border border-t-0 rounded-b-md px-3 py-3 space-y-3 text-xs">
          <TflStatusRow loaded={!!status?.tflDatasetLoaded} />
          <AnthropicStatusRow configured={!!status?.anthropicConfigured} />
        </div>
      )}
    </div>
  );
}

function TflStatusRow({ loaded }: { loaded: boolean }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<{ rowCount: number; droppedRows: number } | null>(null);

  const summaryQ = useQuery<TflSummary>({
    queryKey: ["tfl-summary"],
    queryFn: () => api.get("/tfl/summary"),
  });

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    setUploadResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.upload<{ meta: { rowCount: number }; droppedRows: number }>("/tfl/upload", fd);
      setUploadResult({ rowCount: res.meta.rowCount, droppedRows: res.droppedRows });
      qc.invalidateQueries({ queryKey: ["tfl-summary"] });
      qc.invalidateQueries({ queryKey: ["reports-system-status"] });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const clear = useMutation({
    mutationFn: () => api.delete("/tfl/dataset"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tfl-summary"] });
      qc.invalidateQueries({ queryKey: ["reports-system-status"] });
    },
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={loaded ? "text-green-700" : "text-amber-700"}>
          {loaded ? "✓" : "✗"}
        </span>
        <strong>TfL footfall dataset</strong>
        {loaded && summaryQ.data?.meta && (
          <span className="text-muted-foreground">
            · {summaryQ.data.meta.rowCount} stations · uploaded {new Date(summaryQ.data.meta.uploadedAt).toLocaleString()}
          </span>
        )}
      </div>

      {!loaded && (
        <p className="text-muted-foreground">
          Upload a CSV with columns: <code>station_name</code>, <code>lat</code>, <code>lng</code>, <code>daily_entries</code>, <code>daily_exits</code>{" "}
          (optional: <code>zone</code>). Common aliases like "latitude", "longitude", "name" are accepted.
        </p>
      )}

      <div className="flex items-center gap-2">
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onUpload} />
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Upload className="h-3 w-3 mr-1" />}
          {loaded ? "Replace dataset" : "Upload CSV"}
        </Button>
        {loaded && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => {
              if (confirm("Clear the TfL dataset? Reports won't be generatable until you re-upload.")) {
                clear.mutate();
              }
            }}
            disabled={clear.isPending}
          >
            Clear
          </Button>
        )}
      </div>

      {uploadError && <p className="text-destructive">{uploadError}</p>}
      {uploadResult && (
        <p className="text-green-700">
          Imported {uploadResult.rowCount} stations.{" "}
          {uploadResult.droppedRows > 0 && (
            <span className="text-amber-700">{uploadResult.droppedRows} rows had parse errors and were skipped.</span>
          )}
        </p>
      )}
    </div>
  );
}

function AnthropicStatusRow({ configured }: { configured: boolean }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className={configured ? "text-green-700" : "text-amber-700"}>{configured ? "✓" : "✗"}</span>
        <strong>Anthropic Claude API</strong>
      </div>
      {!configured && (
        <p className="text-muted-foreground">
          Set the <code>ANTHROPIC_API_KEY</code> environment variable on your server (Railway → Variables).
          Get a key at <a className="text-primary underline" href="https://console.anthropic.com/" target="_blank" rel="noreferrer">console.anthropic.com</a>.
          Reports cost ~$0.005–$0.030 each.
        </p>
      )}
    </div>
  );
}

// ── Generate form ────────────────────────────────────────────────────────────

function GenerateForm({
  canGenerate,
  onViewReport,
}: {
  canGenerate: boolean;
  onViewReport: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [campaignId, setCampaignId] = useState<string>("");
  const [selectedAds, setSelectedAds] = useState<Set<string>>(new Set());
  const [selectedBags, setSelectedBags] = useState<Set<string>>(new Set());
  const [timeRange, setTimeRange] = useState<TimeRange>(() => defaultRange());
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const campaignsQ = useQuery<Campaign[]>({
    queryKey: ["campaigns"],
    queryFn: () => api.get("/campaigns"),
  });

  // When a campaign is selected, auto-fill title and date range as a shortcut.
  useEffect(() => {
    if (!campaignId) return;
    const c = campaignsQ.data?.find((x) => x.id === campaignId);
    if (!c) return;
    if (!title) {
      const month = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });
      setTitle(`${c.client_name} — ${c.campaign_name} — ${month}`);
    }
    if (c.start_date && c.end_date) {
      const startMs = new Date(c.start_date + "T00:00:00").getTime();
      const endMs = new Date(c.end_date + "T23:59:59").getTime();
      setTimeRange({ startMs, endMs, preset: "custom", label: `${c.start_date} → ${c.end_date}` });
    }
  }, [campaignId, campaignsQ.data]);

  const { bags: allBags } = useLiveBags();

  const generate = useMutation({
    mutationFn: () => {
      const adIds = Array.from(selectedAds);
      const bagFilterApplied =
        selectedBags.size > 0 && selectedBags.size !== allBags.length && !selectedBags.has("__none__");
      const bagIds = bagFilterApplied
        ? applyBagFilter(allBags, selectedBags).map((b) => b.id)
        : undefined;
      const payload: any = {
        title: title.trim() || "Campaign Report",
        campaign_id: campaignId || null,
        adIds,
        startTime: new Date(timeRange.startMs).toISOString(),
        endTime: new Date(timeRange.endMs).toISOString(),
      };
      if (bagIds) payload.bagIds = bagIds;
      return api.post<SavedReport>("/reports/generate", payload);
    },
    onMutate: () => {
      setError(null);
      setProgress("Pulling playback data and GPS tracks…");
      // Crude "progress" — at ~5s switch to next phase label
      setTimeout(() => setProgress("Computing time-weighted exposure…"), 5000);
      setTimeout(() => setProgress("Generating narrative with Claude…"), 12000);
    },
    onSuccess: (report) => {
      setProgress(null);
      qc.invalidateQueries({ queryKey: ["saved-reports"] });
      onViewReport(report.id);
    },
    onError: (err) => {
      setProgress(null);
      setError(err instanceof Error ? err.message : "Generate failed");
    },
  });

  const canSubmit =
    canGenerate &&
    selectedAds.size > 0 &&
    title.trim().length > 0 &&
    timeRange.endMs > timeRange.startMs;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Generate a campaign report</h3>
        </div>

        {/* Title + campaign tag */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Report title *</label>
            <Input
              placeholder="e.g. Burger King Spring Sale — April 2026"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Tag with campaign (optional, auto-fills title + dates)
            </label>
            <Select value={campaignId || "_none"} onValueChange={(v) => setCampaignId(v === "_none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="— none —" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">— none —</SelectItem>
                {(campaignsQ.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.client_name} — {c.campaign_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Ad picker */}
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">Ad creatives *</label>
          <AdPicker selected={selectedAds} onChange={setSelectedAds} />
        </div>

        {/* Date range + bag filter */}
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Date range *</label>
            <TimeRangePicker value={timeRange} onChange={setTimeRange} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Limit to bags (optional)
            </label>
            <BagFilter bags={allBags} selected={selectedBags} onChange={setSelectedBags} />
          </div>
        </div>

        {/* Progress / error / submit */}
        {progress && (
          <div className="rounded-md bg-primary/5 border border-primary/20 px-3 py-2 text-xs flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span>{progress}</span>
          </div>
        )}
        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs flex items-center gap-2 text-destructive">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center justify-end">
          <Button
            onClick={() => generate.mutate()}
            disabled={!canSubmit || generate.isPending}
            title={
              !canGenerate
                ? "TfL data + Anthropic key required (see status above)"
                : selectedAds.size === 0
                  ? "Pick at least one ad"
                  : !title.trim()
                    ? "Add a title"
                    : ""
            }
          >
            {generate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
            Generate report
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Ad picker (multi-select from media library) ──────────────────────────────

function AdPicker({
  selected,
  onChange,
}: {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const mediaQ = useQuery<MediaAsset[]>({
    queryKey: ["media"],
    queryFn: () => api.get("/media"),
  });
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const media = mediaQ.data ?? [];
  const filtered = useMemo(() => {
    if (!search.trim()) return media;
    return media.filter((m) => m.filename.toLowerCase().includes(search.toLowerCase()));
  }, [media, search]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  const selectedMedia = media.filter((m) => selected.has(m.id));

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left rounded-md border bg-background px-3 py-2 text-sm flex items-center gap-2 hover:bg-accent/40 transition-colors"
      >
        {selected.size === 0 ? (
          <span className="text-muted-foreground">— pick ads from the media library —</span>
        ) : (
          <div className="flex flex-wrap gap-1 flex-1">
            {selectedMedia.slice(0, 4).map((m) => (
              <Badge key={m.id} variant="outline" className="text-xs gap-1">
                {m.file_type === "video" ? <Film className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
                <span className="max-w-[160px] truncate">{m.filename}</span>
                <X
                  className="h-3 w-3 cursor-pointer hover:text-destructive"
                  onClick={(e) => { e.stopPropagation(); toggle(m.id); }}
                />
              </Badge>
            ))}
            {selectedMedia.length > 4 && (
              <Badge variant="outline" className="text-xs">+{selectedMedia.length - 4} more</Badge>
            )}
          </div>
        )}
        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-md border bg-popover shadow-lg">
          <div className="border-b p-2">
            <Input
              autoFocus
              type="text"
              placeholder="Search ads…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="max-h-72 overflow-y-auto">
            {mediaQ.isLoading ? (
              <div className="p-3 space-y-1">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">
                {search ? "No matches" : "No media in library"}
              </p>
            ) : (
              filtered.map((m) => {
                const checked = selected.has(m.id);
                return (
                  <label
                    key={m.id}
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-accent ${checked ? "bg-accent/50" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(m.id)}
                      className="h-3.5 w-3.5"
                    />
                    {m.file_type === "video"
                      ? <Film className="h-3 w-3 text-blue-500 shrink-0" />
                      : <ImageIcon className="h-3 w-3 text-purple-500 shrink-0" />}
                    <span className="flex-1 truncate">{m.filename}</span>
                    {m.duration_seconds ? <span className="text-muted-foreground tabular-nums">{m.duration_seconds}s</span> : null}
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Saved reports list ───────────────────────────────────────────────────────

function SavedReportsList({ onView }: { onView: (id: string) => void }) {
  const qc = useQueryClient();
  const reportsQ = useQuery<SavedReportSummary[]>({
    queryKey: ["saved-reports"],
    queryFn: () => api.get("/reports"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/reports/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-reports"] }),
  });

  if (reportsQ.isError) return <ErrorState title="Couldn't load saved reports" error={reportsQ.error} onRetry={() => reportsQ.refetch()} />;
  if (reportsQ.isLoading) return <Skeleton className="h-24 w-full" />;

  const reports = reportsQ.data ?? [];
  if (reports.length === 0) {
    return (
      <EmptyState
        title="No saved reports yet"
        message="Generate your first report above. Past reports will appear here for easy re-opening."
        icon={<FileText className="h-5 w-5" />}
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-3 py-2 border-b text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Saved reports ({reports.length})
        </div>
        <div className="divide-y">
          {reports.map((r) => (
            <button
              key={r.id}
              onClick={() => onView(r.id)}
              className="w-full text-left p-3 hover:bg-accent/30 transition-colors flex items-center gap-3"
            >
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{r.title}</p>
                <p className="text-xs text-muted-foreground">
                  {r.ad_count} ad{r.ad_count !== 1 ? "s" : ""} · {r.bag_count} bag{r.bag_count !== 1 ? "s" : ""} ·{" "}
                  {formatNumber(r.estimated_impressions)} est. impressions · {new Date(r.generated_at).toLocaleString()}
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete report "${r.title}"?`)) remove.mutate(r.id);
                }}
                className="text-muted-foreground hover:text-destructive p-1.5"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Report viewer ────────────────────────────────────────────────────────────

function ReportViewer({ reportId, onClose }: { reportId: string; onClose: () => void }) {
  const reportQ = useQuery<SavedReport>({
    queryKey: ["report", reportId],
    queryFn: () => api.get(`/reports/${reportId}`),
  });
  const [showNumbers, setShowNumbers] = useState(false);

  if (reportQ.isError) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={onClose}>← Back to reports</Button>
        <ErrorState title="Couldn't load report" error={reportQ.error} onRetry={() => reportQ.refetch()} />
      </div>
    );
  }
  if (reportQ.isLoading || !reportQ.data) {
    return <Skeleton className="h-96 w-full" />;
  }

  const r = reportQ.data;

  const exportMarkdown = () => {
    if (!r.narrative_markdown) return;
    const blob = new Blob([r.narrative_markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${r.title.replace(/[^a-z0-9-_ ]/gi, "_")}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <Button variant="ghost" size="sm" onClick={onClose}>← Back to reports</Button>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Generated {new Date(r.generated_at).toLocaleString()}
            {r.model_used && ` · ${r.model_used}`}
            {r.token_usage && ` · ${r.token_usage.input + r.token_usage.output} tokens`}
          </span>
          <Button variant="outline" size="sm" onClick={exportMarkdown} disabled={!r.narrative_markdown}>
            <Download className="h-3.5 w-3.5 mr-1" /> Export .md
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-6">
          <h1 className="text-xl font-bold mb-1">{r.title}</h1>
          <p className="text-xs text-muted-foreground mb-4">
            {new Date(r.start_time).toLocaleDateString()} – {new Date(r.end_time).toLocaleDateString()} ·{" "}
            {r.ad_count} ad{r.ad_count !== 1 ? "s" : ""} · {r.bag_count} bag{r.bag_count !== 1 ? "s" : ""} ·{" "}
            {formatNumber(r.estimated_impressions)} estimated impressions
          </p>
          <div className="prose prose-sm max-w-none">
            {r.narrative_markdown ? <Markdown text={r.narrative_markdown} /> : <p className="text-muted-foreground italic">No narrative generated.</p>}
          </div>
        </CardContent>
      </Card>

      {/* Collapsible numbers panel */}
      <Card>
        <CardContent className="p-0">
          <button
            onClick={() => setShowNumbers(!showNumbers)}
            className="w-full px-4 py-3 flex items-center gap-2 hover:bg-accent/30 transition-colors text-sm"
          >
            <BarChart2 className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">Underlying numbers</span>
            {showNumbers ? <ChevronDown className="h-3.5 w-3.5 ml-auto" /> : <ChevronRight className="h-3.5 w-3.5 ml-auto" />}
          </button>
          {showNumbers && <NumbersPanel report={r} />}
        </CardContent>
      </Card>
    </div>
  );
}

function NumbersPanel({ report }: { report: SavedReport }) {
  const n = report.numbers;
  return (
    <div className="border-t p-4 space-y-4 text-xs">
      <Section title="Ad performance">
        <table className="w-full">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="text-left py-1">Ad</th>
              <th className="text-right py-1">Plays</th>
              <th className="text-right py-1">Airtime</th>
              <th className="text-right py-1">Est. impressions</th>
            </tr>
          </thead>
          <tbody>
            {(n.ads || []).map((a: any) => (
              <tr key={a.media_md5} className="border-b last:border-b-0">
                <td className="py-1 max-w-[260px] truncate">{a.filename}</td>
                <td className="py-1 text-right tabular-nums">{formatNumber(a.totalPlays)}</td>
                <td className="py-1 text-right tabular-nums">{formatHm(a.totalAirtimeSeconds)}</td>
                <td className="py-1 text-right tabular-nums">{formatNumber(a.estimatedImpressions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Top zones">
        <table className="w-full">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="text-left py-1">Zone</th>
              <th className="text-right py-1">Est. impressions</th>
              <th className="text-right py-1">Visits</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(n.byZone || {})
              .sort((a: any, b: any) => b[1].impressions - a[1].impressions)
              .slice(0, 10)
              .map(([zone, v]: any) => (
                <tr key={zone} className="border-b last:border-b-0">
                  <td className="py-1">{zone}</td>
                  <td className="py-1 text-right tabular-nums">{formatNumber(v.impressions)}</td>
                  <td className="py-1 text-right tabular-nums">{v.visits}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </Section>

      <Section title="Time bands">
        <table className="w-full">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="text-left py-1">Band</th>
              <th className="text-right py-1">Weight</th>
              <th className="text-right py-1">Est. impressions</th>
              <th className="text-right py-1">Exposure</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(n.byTimeBand || {})
              .sort((a: any, b: any) => b[1].impressions - a[1].impressions)
              .map(([band, v]: any) => (
                <tr key={band} className="border-b last:border-b-0">
                  <td className="py-1">{band}</td>
                  <td className="py-1 text-right tabular-nums">×{v.weight}</td>
                  <td className="py-1 text-right tabular-nums">{formatNumber(v.impressions)}</td>
                  <td className="py-1 text-right tabular-nums">{formatHm(v.seconds)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </Section>

      <Section title="Methodology">
        <ul className="space-y-1 text-muted-foreground list-disc list-inside">
          {(n.methodology?.notes || []).map((note: string, i: number) => <li key={i}>{note}</li>)}
        </ul>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-semibold mb-1">{title}</p>
      {children}
    </div>
  );
}

// ── Minimal markdown renderer ────────────────────────────────────────────────
// Handles only what the LLM is asked to produce: headings, bullet/numbered
// lists, **bold**, paragraphs, simple pipe-tables. Keeps dep footprint zero.

function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-3 text-sm">
      {blocks.map((b, i) => renderBlock(b, i))}
    </div>
  );
}

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "table"; header: string[]; rows: string[][] };

function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];

    // Skip blank lines
    if (!ln.trim()) { i++; continue; }

    // Heading
    const h = /^(#{1,4})\s+(.*)$/.exec(ln);
    if (h) {
      out.push({ kind: "heading", level: h[1].length, text: h[2].trim() });
      i++;
      continue;
    }

    // Table
    if (ln.includes("|") && i + 1 < lines.length && /^\s*\|?\s*[-:]+\s*\|/.test(lines[i + 1])) {
      const headerCells = splitTableRow(ln);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|")) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      out.push({ kind: "table", header: headerCells, rows });
      continue;
    }

    // Bullet
    if (/^[-*]\s+/.test(ln)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i++;
      }
      out.push({ kind: "ul", items });
      continue;
    }

    // Numbered
    if (/^\d+\.\s+/.test(ln)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      out.push({ kind: "ol", items });
      continue;
    }

    // Paragraph — consume until blank line
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|[-*]\s|\d+\.\s)/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    if (para.length > 0) out.push({ kind: "p", text: para.join(" ") });
  }
  return out;
}

function splitTableRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

function renderInline(text: string): React.ReactNode {
  // **bold** + `code` + simple
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index));
    const token = m[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      parts.push(<code key={key++} className="bg-muted px-1 rounded text-[11px]">{token.slice(1, -1)}</code>);
    }
    lastIdx = re.lastIndex;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return <>{parts}</>;
}

function renderBlock(b: Block, key: number): React.ReactNode {
  switch (b.kind) {
    case "heading": {
      const sizeCls =
        b.level === 1 ? "text-xl font-bold mt-4 mb-2"
        : b.level === 2 ? "text-lg font-semibold mt-4 mb-2"
        : b.level === 3 ? "text-base font-semibold mt-3 mb-1"
        : "text-sm font-semibold mt-2 mb-1";
      return <div key={key} className={sizeCls}>{renderInline(b.text)}</div>;
    }
    case "p":
      return <p key={key} className="text-sm leading-relaxed">{renderInline(b.text)}</p>;
    case "ul":
      return (
        <ul key={key} className="list-disc list-inside space-y-1 text-sm">
          {b.items.map((it, i) => <li key={i}>{renderInline(it)}</li>)}
        </ul>
      );
    case "ol":
      return (
        <ol key={key} className="list-decimal list-inside space-y-1 text-sm">
          {b.items.map((it, i) => <li key={i}>{renderInline(it)}</li>)}
        </ol>
      );
    case "table":
      return (
        <div key={key} className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b">
                {b.header.map((h, i) => (
                  <th key={i} className="text-left px-2 py-1 font-medium">{renderInline(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri} className="border-b last:border-b-0">
                  {r.map((c, ci) => (
                    <td key={ci} className="px-2 py-1">{renderInline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

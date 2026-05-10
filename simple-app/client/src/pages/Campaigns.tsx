import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState, EmptyState } from "@/components/ui/error-state";
import {
  Plus, Pencil, Trash2, Loader2, Megaphone, Truck, Layers, Film, Image as ImageIcon, ListMusic, Sparkles,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

type CampaignStatus = "draft" | "active" | "paused" | "ended";

interface Campaign {
  id: string;
  client_name: string;
  campaign_name: string;
  status: CampaignStatus;
  start_date: string | null;
  end_date: string | null;
  contracted_bags: number;
  notes: string;
  created: string;
  updated: string;
}

interface OccupancyResponse {
  totalBags: number;
  slotsPerBag: number;
  totalSlots: number;
  slotsSold: number;
  slotsFree: number;
  utilizationPct: number;
  activeCampaigns: {
    id: string;
    client_name: string;
    campaign_name: string;
    contracted_bags: number;
    start_date: string | null;
    end_date: string | null;
    pct_of_fleet: number;
    days_remaining: number | null;
  }[];
  inactiveCampaignCount: number;
  asOf: string;
}

interface AdSlotsResponse {
  slotsPerBag: number;
  totals: {
    totalSlots: number;
    filled: number;
    filler: number;
    empty: number;
  };
  bags: {
    bag_id: string;
    bag_name: string;
    status: string;
    playlist: { id: string; name: string } | null;
    slots: {
      slot: number;
      state: "filled" | "filler" | "empty";
      filename?: string;
      file_type?: string;
      media_id?: string;
    }[];
    filledCount: number;
    fillerCount: number;
    emptyCount: number;
  }[];
}

// ── Status pill ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<CampaignStatus, string> = {
  draft: "bg-gray-100 text-gray-700 border-gray-200",
  active: "bg-green-100 text-green-800 border-green-200",
  paused: "bg-amber-100 text-amber-800 border-amber-200",
  ended: "bg-red-100 text-red-700 border-red-200",
};

function StatusBadge({ status }: { status: CampaignStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

function formatDate(s: string | null) {
  if (!s) return "—";
  return new Date(s + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function Campaigns() {
  return (
    <Tabs defaultValue="campaigns">
      <TabsList className="mb-4">
        <TabsTrigger value="campaigns">
          <Megaphone className="h-3.5 w-3.5 mr-1.5" /> Campaigns
        </TabsTrigger>
        <TabsTrigger value="occupancy">
          <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Occupancy
        </TabsTrigger>
        <TabsTrigger value="slots">
          <Layers className="h-3.5 w-3.5 mr-1.5" /> Ad Slots
        </TabsTrigger>
      </TabsList>

      <TabsContent value="campaigns"><CampaignsTab /></TabsContent>
      <TabsContent value="occupancy"><OccupancyTab /></TabsContent>
      <TabsContent value="slots"><AdSlotsTab /></TabsContent>
    </Tabs>
  );
}

// ── Sub-tab 1: Campaigns CRUD ────────────────────────────────────────────────

function CampaignsTab() {
  const qc = useQueryClient();
  const [editorOpen, setEditorOpen] = useState<{ kind: "new" } | { kind: "edit"; campaign: Campaign } | null>(null);

  const campaignsQ = useQuery<Campaign[]>({
    queryKey: ["campaigns"],
    queryFn: () => api.get("/campaigns"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/campaigns/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["occupancy"] });
    },
  });

  const campaigns = campaignsQ.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-muted-foreground">
          Track contractual deals with clients. Campaign data feeds into the Occupancy tab.
        </p>
        <Button size="sm" onClick={() => setEditorOpen({ kind: "new" })}>
          <Plus className="h-3.5 w-3.5 mr-1" /> New Campaign
        </Button>
      </div>

      {campaignsQ.isError ? (
        <ErrorState
          title="Couldn't load campaigns"
          error={campaignsQ.error}
          onRetry={() => campaignsQ.refetch()}
        />
      ) : campaignsQ.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          message="Add your first campaign to start tracking contracted inventory."
          icon={<Megaphone className="h-5 w-5" />}
          action={
            <Button size="sm" onClick={() => setEditorOpen({ kind: "new" })}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add campaign
            </Button>
          }
        />
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead className="text-right">Bags</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date range</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.client_name}</TableCell>
                  <TableCell>{c.campaign_name}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.contracted_bags}</TableCell>
                  <TableCell><StatusBadge status={c.status} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(c.start_date)} – {formatDate(c.end_date)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setEditorOpen({ kind: "edit", campaign: c })}
                        className="text-muted-foreground hover:text-foreground p-1.5"
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Delete campaign "${c.campaign_name}"?`)) {
                            remove.mutate(c.id);
                          }
                        }}
                        disabled={remove.isPending}
                        className="text-muted-foreground hover:text-destructive p-1.5"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {editorOpen && (
        <CampaignEditor
          mode={editorOpen}
          onClose={() => setEditorOpen(null)}
        />
      )}
    </div>
  );
}

function CampaignEditor({
  mode,
  onClose,
}: {
  mode: { kind: "new" } | { kind: "edit"; campaign: Campaign };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const isEdit = mode.kind === "edit";
  const initial = isEdit ? mode.campaign : null;

  const [form, setForm] = useState({
    client_name: initial?.client_name ?? "",
    campaign_name: initial?.campaign_name ?? "",
    status: initial?.status ?? ("draft" as CampaignStatus),
    start_date: initial?.start_date ?? "",
    end_date: initial?.end_date ?? "",
    contracted_bags: initial?.contracted_bags ?? 0,
    notes: initial?.notes ?? "",
  });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        client_name: form.client_name.trim(),
        campaign_name: form.campaign_name.trim(),
        status: form.status,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        contracted_bags: Number(form.contracted_bags),
        notes: form.notes,
      };
      return isEdit
        ? api.put<Campaign>(`/campaigns/${initial!.id}`, payload)
        : api.post<Campaign>("/campaigns", payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["occupancy"] });
      onClose();
    },
  });

  const canSave = form.client_name.trim() && form.campaign_name.trim();

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit: ${initial!.campaign_name}` : "New Campaign"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Client *</label>
              <Input
                placeholder="e.g. Burger King UK"
                value={form.client_name}
                onChange={(e) => setForm((f) => ({ ...f, client_name: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Campaign name *</label>
              <Input
                placeholder="e.g. Spring Sale 2026"
                value={form.campaign_name}
                onChange={(e) => setForm((f) => ({ ...f, campaign_name: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
              <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v as CampaignStatus }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="ended">Ended</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Bags contracted</label>
              <Input
                type="number"
                min={0}
                value={form.contracted_bags}
                onChange={(e) => setForm((f) => ({ ...f, contracted_bags: Number(e.target.value) }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Start date</label>
              <Input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">End date</label>
              <Input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Notes</label>
            <textarea
              rows={3}
              className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring"
              placeholder="Internal notes (deal terms, contact, etc.)"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>

          <p className="text-xs text-muted-foreground bg-muted/40 rounded px-2 py-1.5">
            <strong>Active rule:</strong> A campaign counts towards Occupancy when its status is <code className="text-[11px]">active</code> AND today is within the start/end date range (when set).
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!canSave || save.isPending}>
            {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            {isEdit ? "Save changes" : "Create campaign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Sub-tab 2: Occupancy (derived KPI view) ──────────────────────────────────

function OccupancyTab() {
  const occQ = useQuery<OccupancyResponse>({
    queryKey: ["occupancy"],
    queryFn: () => api.get("/occupancy"),
  });

  if (occQ.isError) {
    return (
      <ErrorState
        title="Couldn't load occupancy data"
        error={occQ.error}
        onRetry={() => occQ.refetch()}
      />
    );
  }

  if (occQ.isLoading || !occQ.data) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-40" />
      </div>
    );
  }

  const data = occQ.data;
  const freeIsHealthy = data.totalSlots > 0 && data.slotsFree / data.totalSlots > 0.5;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Theoretical capacity view — what's contractually sold vs. free for the sales team to sell.
        This is the commercial truth and may differ from what's actually playing in the Ad Slots tab.
      </p>

      {/* Top stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total fleet slots" value={data.totalSlots} sub={`${data.totalBags} bags × ${data.slotsPerBag}`} />
        <StatCard
          label="Sold (active)"
          value={data.slotsSold}
          sub={`${data.utilizationPct}% utilisation`}
        />
        <StatCard
          label="Free"
          value={data.slotsFree}
          sub="available to sell"
          accent={freeIsHealthy ? "green" : undefined}
        />
        <StatCard label="Active campaigns" value={data.activeCampaigns.length} />
      </div>

      {/* Active campaigns */}
      {data.activeCampaigns.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            No active campaigns currently consuming inventory.
            {data.inactiveCampaignCount > 0 && (
              <p className="text-xs mt-2">
                {data.inactiveCampaignCount} inactive campaign{data.inactiveCampaignCount !== 1 ? "s" : ""}{" "}
                (drafts, paused, or ended) not counted here.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead className="text-right">Bags</TableHead>
                  <TableHead className="w-32">% of fleet</TableHead>
                  <TableHead>Date range</TableHead>
                  <TableHead className="text-right">Days left</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.activeCampaigns.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.client_name}</TableCell>
                    <TableCell>{c.campaign_name}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.contracted_bags}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary/70 rounded-full"
                            style={{ width: `${Math.min(100, c.pct_of_fleet)}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums w-12 text-right">{c.pct_of_fleet}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(c.start_date)} – {formatDate(c.end_date)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {c.days_remaining != null ? `${c.days_remaining}d` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data.inactiveCampaignCount > 0 && (
              <div className="px-4 py-2 text-xs text-muted-foreground border-t bg-muted/30">
                + {data.inactiveCampaignCount} inactive campaign{data.inactiveCampaignCount !== 1 ? "s" : ""}
                {" "}(drafts, paused, or ended) not counted here.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Sales runway callout */}
      {data.slotsFree > 0 && data.totalBags > 0 && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-4 text-sm">
            <strong>Sales runway:</strong>{" "}
            {data.slotsFree} slot{data.slotsFree !== 1 ? "s" : ""} available — could sell up to{" "}
            <strong>{Math.floor(data.slotsFree / 1)}</strong> more bag-equivalents before the fleet is contractually full.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: number | string;
  sub?: string;
  accent?: "green" | "amber" | "red";
}) {
  const accentClass =
    accent === "green" ? "text-green-700"
    : accent === "amber" ? "text-amber-700"
    : accent === "red" ? "text-destructive"
    : "";
  return (
    <div className="border rounded-md p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${accentClass}`}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Sub-tab 3: Ad Slots (operational view, derived from playlists) ───────────

function AdSlotsTab() {
  const slotsQ = useQuery<AdSlotsResponse>({
    queryKey: ["ad-slots"],
    queryFn: () => api.get("/ad-slots"),
  });

  if (slotsQ.isError) {
    return (
      <ErrorState
        title="Couldn't load ad slot data"
        error={slotsQ.error}
        onRetry={() => slotsQ.refetch()}
      />
    );
  }

  if (slotsQ.isLoading || !slotsQ.data) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
      </div>
    );
  }

  const data = slotsQ.data;
  const { totals } = data;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Operational view — what's actually queued to play, derived from current playlist deployments.
        Ads with <strong>"DigiLite"</strong> in the filename are counted as filler (house promos in unsold inventory).
      </p>

      {/* Top stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total slots" value={totals.totalSlots} sub={`${data.bags.length} bags × ${data.slotsPerBag}`} />
        <StatCard label="Filled (paid ads)" value={totals.filled} accent="green" />
        <StatCard label="DigiLite filler" value={totals.filler} accent="amber" sub="capacity disguised as content" />
        <StatCard label="Truly empty" value={totals.empty} />
      </div>

      {/* Per-bag grid */}
      {data.bags.length === 0 ? (
        <EmptyState
          title="No bags found"
          message="Connect at least one terminal to see its ad slots."
          icon={<Truck className="h-5 w-5" />}
        />
      ) : (
        <div className="space-y-3">
          {data.bags.map((bag) => <BagSlotsCard key={bag.bag_id} bag={bag} slotsPerBag={data.slotsPerBag} />)}
        </div>
      )}
    </div>
  );
}

function BagSlotsCard({ bag, slotsPerBag }: { bag: AdSlotsResponse["bags"][number]; slotsPerBag: number }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-muted-foreground shrink-0" />
            <Link to={`/fleet/${bag.bag_id}`} className="text-sm font-semibold text-primary hover:underline">
              {bag.bag_name}
            </Link>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
              bag.status === "active"
                ? "bg-green-50 text-green-700 border-green-200"
                : "bg-gray-100 text-gray-600 border-gray-200"
            }`}>{bag.status}</span>
          </div>

          <div className="flex items-center gap-3 text-xs">
            {bag.playlist ? (
              <Link to="/playlists" className="text-primary hover:underline flex items-center gap-1">
                <ListMusic className="h-3 w-3" /> {bag.playlist.name}
              </Link>
            ) : (
              <span className="text-muted-foreground italic">Not yet managed by CMS</span>
            )}
            <span className="text-muted-foreground">·</span>
            <span className="tabular-nums">
              <span className="text-green-700">{bag.filledCount}</span>
              {" / "}
              <span className="text-amber-700">{bag.fillerCount}</span>
              {" / "}
              <span className="text-muted-foreground">{bag.emptyCount}</span>
            </span>
          </div>
        </div>

        <div className={`grid gap-1.5`} style={{ gridTemplateColumns: `repeat(${slotsPerBag}, minmax(0, 1fr))` }}>
          {bag.slots.map((s) => <SlotCell key={s.slot} slot={s} />)}
        </div>
      </CardContent>
    </Card>
  );
}

function SlotCell({ slot }: { slot: AdSlotsResponse["bags"][number]["slots"][number] }) {
  const { state, slot: idx, filename, file_type } = slot;

  if (state === "empty") {
    return (
      <div className="rounded-md border border-dashed p-2 text-center text-muted-foreground/70 bg-muted/20 text-xs">
        <p className="font-mono">{idx}</p>
        <p className="mt-1">—</p>
      </div>
    );
  }

  const isVideo = file_type === "video" || file_type === "mp4";
  const fillerStyles = "bg-amber-50 border-amber-200 text-amber-900";
  const filledStyles = "bg-green-50 border-green-200 text-green-900";

  return (
    <div className={`rounded-md border p-2 text-xs ${state === "filler" ? fillerStyles : filledStyles}`}>
      <p className="font-mono opacity-70">{idx}</p>
      <div className="flex items-center gap-1 mt-1">
        {isVideo
          ? <Film className="h-3 w-3 shrink-0" />
          : <ImageIcon className="h-3 w-3 shrink-0" />}
        <p className="truncate font-medium" title={filename}>{filename ?? ""}</p>
      </div>
      {state === "filler" && (
        <p className="text-[10px] mt-0.5 opacity-80">DigiLite filler</p>
      )}
    </div>
  );
}

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Rocket, BarChart2, Layers, Film, Image as ImageIcon, Loader2 } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Campaign {
  id: string;
  name: string;
  client_name: string;
  status: "draft" | "active" | "paused" | "ended";
  start_date: string | null;
  end_date: string | null;
  created: string;
}

interface Bag {
  id: string;
  name: string;
  colorlight_device_id: string;
  status: string;
}

interface Media {
  id: string;
  campaign_id: string | null;
  filename: string;
  file_type: string;
  duration_seconds: number;
  fileUrl: string;
}

interface AdSlot {
  id: string;
  bag_id: string;
  slot_number: number;
  media_id: string | null;
  campaign_id: string | null;
  media: Media | null;
  campaign: Campaign | null;
  bag: Bag | null;
}

interface PlayRow {
  media_id: string;
  filename: string;
  file_type: string;
  campaign_id: string | null;
  campaign_name: string | null;
  plays: number;
  total_seconds: number;
}

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-800 border-green-200",
  draft: "bg-gray-100 text-gray-600 border-gray-200",
  paused: "bg-yellow-100 text-yellow-800 border-yellow-200",
  ended: "bg-red-100 text-red-700 border-red-200",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${statusColors[status] ?? statusColors.draft}`}>
      {status}
    </span>
  );
}

const SLOTS_PER_BAG = 6;

// ── Deploy dialog — pick bags and assign slots ────────────────────────────────

function DeployDialog({
  campaign,
  bags,
  allMedia,
  adSlots,
  onClose,
}: {
  campaign: Campaign;
  bags: Bag[];
  allMedia: Media[];
  adSlots: AdSlot[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const campaignMedia = allMedia.filter((m) => m.campaign_id === campaign.id);

  // bagId → slot_number → media_id
  const [assignments, setAssignments] = useState<Record<string, Record<number, string>>>(() => {
    const init: Record<string, Record<number, string>> = {};
    bags.forEach((b) => {
      init[b.id] = {};
      adSlots.filter((s) => s.bag_id === b.id).forEach((s) => {
        if (s.campaign_id === campaign.id && s.media_id) {
          init[b.id][s.slot_number] = s.media_id;
        }
      });
    });
    return init;
  });

  const [selectedBags, setSelectedBags] = useState<Set<string>>(() => {
    const pre = new Set<string>();
    adSlots.filter((s) => s.campaign_id === campaign.id).forEach((s) => pre.add(s.bag_id));
    return pre;
  });

  const deploy = useMutation({
    mutationFn: async () => {
      const promises: Promise<unknown>[] = [];
      for (const bagId of Array.from(selectedBags)) {
        const bag = bags.find((b) => b.id === bagId);
        if (!bag) continue;
        for (let slot = 1; slot <= SLOTS_PER_BAG; slot++) {
          const mediaId = assignments[bagId]?.[slot] ?? null;
          promises.push(
            api.put(`/ad-slots/${bagId}/${slot}`, {
              media_id: mediaId,
              campaign_id: mediaId ? campaign.id : null,
            })
          );
        }
      }
      await Promise.all(promises);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ad-slots"] });
      onClose();
    },
  });

  const toggleBag = (id: string) => {
    setSelectedBags((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setSlot = (bagId: string, slot: number, mediaId: string) => {
    setAssignments((prev) => ({
      ...prev,
      [bagId]: { ...prev[bagId], [slot]: mediaId },
    }));
  };

  if (campaignMedia.length === 0) {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent>
          <DialogHeader><DialogTitle>Deploy — {campaign.name}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground py-4">
            No media uploaded for this campaign yet. Upload media first via the Media page.
          </p>
          <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Deploy — {campaign.name}</DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Select terminals and assign ad slots. Each terminal runs a 1-minute loop with {SLOTS_PER_BAG} slots.
          </p>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {bags.map((bag) => {
            const isSelected = selectedBags.has(bag.id);
            const bagSlots = adSlots.filter((s) => s.bag_id === bag.id);
            const usedByOthers = bagSlots.filter((s) => s.media_id && s.campaign_id !== campaign.id).length;
            const free = SLOTS_PER_BAG - usedByOthers;

            return (
              <div key={bag.id} className={`border rounded-lg p-3 transition-colors ${isSelected ? "border-primary bg-accent/20" : "border-border"}`}>
                <div className="flex items-center gap-3 mb-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleBag(bag.id)}
                    className="h-4 w-4 accent-primary"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{bag.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{bag.colorlight_device_id}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{free}/{SLOTS_PER_BAG} slots free</span>
                  <StatusBadge status={bag.status} />
                </div>

                {isSelected && (
                  <div className="grid grid-cols-3 gap-2">
                    {Array.from({ length: SLOTS_PER_BAG }, (_, i) => i + 1).map((slot) => {
                      const existing = bagSlots.find((s) => s.slot_number === slot);
                      const isOccupied = existing?.media_id && existing.campaign_id !== campaign.id;
                      const selected = assignments[bag.id]?.[slot] ?? "";

                      return (
                        <div key={slot} className={`border rounded p-2 text-xs ${isOccupied ? "bg-muted opacity-60" : "bg-background"}`}>
                          <p className="font-medium text-muted-foreground mb-1">Slot {slot}</p>
                          {isOccupied ? (
                            <p className="text-xs text-muted-foreground truncate" title={existing?.media?.filename ?? ""}>
                              {existing?.campaign?.name ?? "Other campaign"}
                            </p>
                          ) : (
                            <select
                              className="w-full border rounded px-1 py-0.5 text-xs bg-background"
                              value={selected}
                              onChange={(e) => setSlot(bag.id, slot, e.target.value)}
                            >
                              <option value="">— empty —</option>
                              {campaignMedia.map((m) => (
                                <option key={m.id} value={m.id}>{m.filename}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => deploy.mutate()} disabled={deploy.isPending || selectedBags.size === 0}>
            {deploy.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Rocket className="h-4 w-4 mr-1" />}
            Deploy to {selectedBags.size} terminal{selectedBags.size !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Ad Slots grid tab ─────────────────────────────────────────────────────────

function AdSlotsTab({ bags, adSlots, campaigns, media }: { bags: Bag[]; adSlots: AdSlot[]; campaigns: Campaign[]; media: Media[] }) {
  const totalSlots = bags.length * SLOTS_PER_BAG;
  const filledSlots = adSlots.filter((s) => s.media_id).length;
  const freeSlots = totalSlots - filledSlots;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-4">
        <div className="border rounded-lg p-3 text-center">
          <p className="text-2xl font-bold">{totalSlots}</p>
          <p className="text-xs text-muted-foreground">Total slots</p>
        </div>
        <div className="border rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-green-600">{filledSlots}</p>
          <p className="text-xs text-muted-foreground">Filled</p>
        </div>
        <div className="border rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-muted-foreground">{freeSlots}</p>
          <p className="text-xs text-muted-foreground">Available</p>
        </div>
      </div>

      {/* Per-bag slot grids */}
      {bags.map((bag) => {
        const bagSlots = adSlots.filter((s) => s.bag_id === bag.id).sort((a, b) => a.slot_number - b.slot_number);
        const filled = bagSlots.filter((s) => s.media_id).length;

        return (
          <div key={bag.id} className="border rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-muted/40 border-b">
              <div>
                <span className="font-medium text-sm">{bag.name}</span>
                <span className="text-xs text-muted-foreground ml-2 font-mono">{bag.colorlight_device_id}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex h-2 rounded-full overflow-hidden w-24 bg-muted">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${(filled / SLOTS_PER_BAG) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">{filled}/{SLOTS_PER_BAG}</span>
                <StatusBadge status={bag.status} />
              </div>
            </div>

            <div className="grid grid-cols-6 divide-x">
              {Array.from({ length: SLOTS_PER_BAG }, (_, i) => i + 1).map((slot) => {
                const s = bagSlots.find((x) => x.slot_number === slot);
                const m = s?.media ?? null;
                const c = s?.campaign ?? null;

                return (
                  <div key={slot} className={`p-3 min-h-[90px] flex flex-col gap-1 ${m ? "bg-background" : "bg-muted/20"}`}>
                    <p className="text-xs font-semibold text-muted-foreground">Slot {slot}</p>
                    {m ? (
                      <>
                        <div className="flex items-center gap-1">
                          {m.file_type === "video"
                            ? <Film className="h-3 w-3 text-blue-500 shrink-0" />
                            : <ImageIcon className="h-3 w-3 text-purple-500 shrink-0" />}
                          <p className="text-xs font-medium truncate leading-tight">{m.filename}</p>
                        </div>
                        {c && (
                          <p className="text-xs text-muted-foreground truncate">{c.name}</p>
                        )}
                        <p className="text-xs text-muted-foreground">{m.duration_seconds}s</p>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-auto">Empty</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Ad play breakdown */}
      <AdPlayBreakdown campaigns={campaigns} media={media} />
    </div>
  );
}

function AdPlayBreakdown({ campaigns, media }: { campaigns: Campaign[]; media: Media[] }) {
  const { data, isLoading } = useQuery<{ rows: PlayRow[]; total: number }>({
    queryKey: ["ad-plays"],
    queryFn: () => api.get("/reports/ad-plays"),
  });

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (!data || data.rows.length === 0) return null;

  const max = Math.max(...data.rows.map((r) => r.plays));

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-muted/40 border-b">
        <div className="flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm">Ad Play Breakdown</span>
        </div>
        <span className="text-xs text-muted-foreground">{data.total} total plays</span>
      </div>
      <div className="p-4 space-y-3">
        {data.rows.map((row) => (
          <div key={row.media_id} className="flex items-center gap-3">
            <div className="w-40 shrink-0">
              <p className="text-xs font-medium truncate">{row.filename}</p>
              {row.campaign_name && (
                <p className="text-xs text-muted-foreground truncate">{row.campaign_name}</p>
              )}
            </div>
            <div className="flex-1 h-5 bg-muted rounded overflow-hidden">
              <div
                className="h-full bg-primary/70 rounded transition-all"
                style={{ width: `${(row.plays / max) * 100}%` }}
              />
            </div>
            <span className="text-xs font-medium tabular-nums w-12 text-right">{row.plays} plays</span>
            <span className="text-xs text-muted-foreground tabular-nums w-14 text-right">
              {Math.round(row.total_seconds / 60)}m total
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── New Campaign dialog ───────────────────────────────────────────────────────

function NewCampaignDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    client_name: "",
    status: "draft" as Campaign["status"],
    start_date: "",
    end_date: "",
  });
  const [adFile, setAdFile] = useState<File | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const campaign = await api.post<Campaign>("/campaigns", form);
      if (adFile) {
        const fd = new FormData();
        fd.append("file", adFile);
        fd.append("campaign_id", campaign.id);
        fd.append("file_type", adFile.type.startsWith("video") ? "video" : "image");
        fd.append("duration_seconds", "15");
        await api.upload("/media", fd);
      }
      return campaign;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      qc.invalidateQueries({ queryKey: ["media"] });
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New Campaign</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Campaign name *</label>
            <Input placeholder="e.g. Summer Sale 2025" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Client name</label>
            <Input placeholder="e.g. Nike UK" value={form.client_name} onChange={(e) => setForm((f) => ({ ...f, client_name: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Status</label>
            <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v as Campaign["status"] }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Start date</label>
              <Input type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">End date</label>
              <Input type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Upload advert (optional)</label>
            <Input
              type="file"
              accept="image/*,video/*"
              onChange={(e) => setAdFile(e.target.files?.[0] ?? null)}
              className="text-xs"
            />
            <p className="text-xs text-muted-foreground mt-1">MP4, MOV, JPG, PNG accepted</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !form.name}>
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function Campaigns() {
  const { data: campaigns = [], isLoading } = useQuery<Campaign[]>({
    queryKey: ["campaigns"],
    queryFn: () => api.get("/campaigns"),
  });
  const { data: bags = [] } = useQuery<Bag[]>({
    queryKey: ["bags"],
    queryFn: () => api.get("/bags"),
  });
  const { data: allMedia = [] } = useQuery<Media[]>({
    queryKey: ["media"],
    queryFn: () => api.get("/media"),
  });
  const { data: adSlots = [] } = useQuery<AdSlot[]>({
    queryKey: ["ad-slots"],
    queryFn: () => api.get("/ad-slots"),
  });

  const [newOpen, setNewOpen] = useState(false);
  const [deploying, setDeploying] = useState<Campaign | null>(null);

  return (
    <div className="space-y-4">
      <Tabs defaultValue="campaigns">
        <div className="flex items-center justify-between mb-4">
          <TabsList>
            <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
            <TabsTrigger value="slots">
              <Layers className="h-3.5 w-3.5 mr-1.5" />
              Ad Slots
            </TabsTrigger>
          </TabsList>
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />New Campaign
          </Button>
        </div>

        {/* ── Campaigns list ── */}
        <TabsContent value="campaigns">
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Media</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}><TableCell colSpan={6}><Skeleton className="h-4 w-full" /></TableCell></TableRow>
                  ))
                ) : campaigns.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">No campaigns yet</TableCell>
                  </TableRow>
                ) : campaigns.map((c) => {
                  const mediaCount = allMedia.filter((m) => m.campaign_id === c.id).length;
                  const deployedBags = new Set(adSlots.filter((s) => s.campaign_id === c.id).map((s) => s.bag_id)).size;
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="text-muted-foreground">{c.client_name}</TableCell>
                      <TableCell><StatusBadge status={c.status} /></TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {c.start_date ? new Date(c.start_date).toLocaleDateString() : "—"} –{" "}
                        {c.end_date ? new Date(c.end_date).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {mediaCount} file{mediaCount !== 1 ? "s" : ""}
                        {deployedBags > 0 && (
                          <span className="ml-2 text-xs text-green-600">{deployedBags} terminal{deployedBags !== 1 ? "s" : ""}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => setDeploying(c)}
                        >
                          <Rocket className="h-3 w-3 mr-1" />Deploy
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ── Ad Slots tab ── */}
        <TabsContent value="slots">
          <AdSlotsTab bags={bags} adSlots={adSlots} campaigns={campaigns} media={allMedia} />
        </TabsContent>
      </Tabs>

      {newOpen && <NewCampaignDialog onClose={() => setNewOpen(false)} />}

      {deploying && (
        <DeployDialog
          campaign={deploying}
          bags={bags}
          allMedia={allMedia}
          adSlots={adSlots}
          onClose={() => setDeploying(null)}
        />
      )}
    </div>
  );
}

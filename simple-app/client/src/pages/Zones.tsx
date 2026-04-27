import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LiveMap } from "@/components/map/LiveMap";
import { Plus, Trash2, MapPin } from "lucide-react";

interface Zone {
  id: string;
  name: string;
  type: "radius" | "polygon";
  centerLat: number | null;
  centerLng: number | null;
  radiusMeters: number | null;
  active: boolean;
  createdAt: string;
}

export function Zones() {
  const qc = useQueryClient();
  const { data: zones = [] } = useQuery<Zone[]>({
    queryKey: ["zones"],
    queryFn: () => api.get("/zones"),
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", type: "radius" as "radius" | "polygon", centerLat: "", centerLng: "", radiusMeters: "500" });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => api.post<Zone>("/zones", data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["zones"] }); setOpen(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/zones/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["zones"] }),
  });

  const handleCreate = () => {
    createMutation.mutate({
      ...form,
      centerLat: form.centerLat ? Number(form.centerLat) : undefined,
      centerLng: form.centerLng ? Number(form.centerLng) : undefined,
      radiusMeters: form.radiusMeters ? Number(form.radiusMeters) : undefined,
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">{zones.length} Zone{zones.length !== 1 ? "s" : ""}</h2>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5 mr-1" />Add Zone</Button>
        </div>

        <div className="space-y-2">
          {zones.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No zones defined</p>
          ) : zones.map((zone) => (
            <Card key={zone.id}>
              <CardContent className="p-3 flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0">
                  <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{zone.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{zone.type}{zone.radiusMeters ? ` · ${zone.radiusMeters}m` : ""}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Badge variant={zone.active ? "default" : "outline"} className="text-xs">
                    {zone.active ? "active" : "off"}
                  </Badge>
                  <button onClick={() => deleteMutation.mutate(zone.id)} className="text-destructive hover:opacity-70">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <div className="lg:col-span-2">
        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Zone Map</CardTitle>
          </CardHeader>
          <CardContent className="p-0" style={{ height: 520 }}>
            <LiveMap bags={[]} mode="live" showZones={true} />
          </CardContent>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Zone</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <Input placeholder="Zone name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v as "radius" | "polygon" }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="radius">Radius</SelectItem>
                <SelectItem value="polygon">Polygon</SelectItem>
              </SelectContent>
            </Select>
            {form.type === "radius" && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="Center lat" value={form.centerLat} onChange={(e) => setForm((f) => ({ ...f, centerLat: e.target.value }))} />
                  <Input placeholder="Center lng" value={form.centerLng} onChange={(e) => setForm((f) => ({ ...f, centerLng: e.target.value }))} />
                </div>
                <Input placeholder="Radius (metres)" value={form.radiusMeters} onChange={(e) => setForm((f) => ({ ...f, radiusMeters: e.target.value }))} />
              </>
            )}
            {form.type === "polygon" && (
              <p className="text-xs text-muted-foreground">Polygon drawing will be available in V2. For now, supply GeoJSON coordinates via the API.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

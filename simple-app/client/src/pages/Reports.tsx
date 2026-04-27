import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { useAuthStore } from "@/lib/auth";

interface Campaign { id: string; name: string }
interface Zone { id: string; name: string }
interface Rider { id: string; name: string }

interface DayRow { date: string; plays?: number; visits?: number; sessions?: number; totalSeconds?: string | number; avgDwellSeconds?: string | number }

function BarChart({ data, valueKey, label }: { data: DayRow[]; valueKey: string; label: string }) {
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

export function Reports() {
  const token = useAuthStore((s) => s.token);
  const [selectedCampaign, setSelectedCampaign] = useState("");
  const [selectedZone, setSelectedZone] = useState("");
  const [selectedRider, setSelectedRider] = useState("");

  const { data: campaigns = [] } = useQuery<Campaign[]>({ queryKey: ["campaigns"], queryFn: () => api.get("/campaigns") });
  const { data: zones = [] } = useQuery<Zone[]>({ queryKey: ["zones"], queryFn: () => api.get("/zones") });
  const { data: riders = [] } = useQuery<Rider[]>({ queryKey: ["riders"], queryFn: () => api.get("/riders") });

  const { data: campaignReport = [] } = useQuery<DayRow[]>({
    queryKey: ["report", "campaign", selectedCampaign],
    queryFn: () => api.get(`/reports/campaign/${selectedCampaign}`),
    enabled: !!selectedCampaign,
  });
  const { data: zoneReport = [] } = useQuery<DayRow[]>({
    queryKey: ["report", "zone", selectedZone],
    queryFn: () => api.get(`/reports/zone/${selectedZone}`),
    enabled: !!selectedZone,
  });
  const { data: riderReport = [] } = useQuery<DayRow[]>({
    queryKey: ["report", "rider", selectedRider],
    queryFn: () => api.get(`/reports/rider/${selectedRider}`),
    enabled: !!selectedRider,
  });

  const exportCsv = (type: string, id: string) => {
    const url = `/api/reports/export/csv?type=${type}&id=${id}`;
    const a = document.createElement("a");
    a.href = url;
    a.setAttribute("download", `${type}-report.csv`);
    a.click();
  };

  return (
    <Tabs defaultValue="campaign">
      <TabsList className="mb-4">
        <TabsTrigger value="campaign">Campaign</TabsTrigger>
        <TabsTrigger value="zone">Zone</TabsTrigger>
        <TabsTrigger value="rider">Rider</TabsTrigger>
      </TabsList>

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
            <BarChart data={campaignReport} valueKey="plays" label="Plays" />
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
            <BarChart data={zoneReport} valueKey="visits" label="Visits" />
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="rider">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-sm font-medium">Rider Activity</CardTitle>
            <div className="flex items-center gap-2">
              <Select value={selectedRider} onValueChange={setSelectedRider}>
                <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="Select rider" /></SelectTrigger>
                <SelectContent>{riders.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
              </Select>
              {selectedRider && <Button variant="outline" size="sm" className="h-8" onClick={() => exportCsv("rider", selectedRider)}><Download className="h-3.5 w-3.5 mr-1" />CSV</Button>}
            </div>
          </CardHeader>
          <CardContent>
            <BarChart data={riderReport} valueKey="sessions" label="Sessions" />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Pencil, Trash2, Sun, Sunset, Moon, Sunrise } from "lucide-react";

interface BrightnessSchedule {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  brightness_percent: number;
  days_of_week: number[];
  bag_id: string | null;
  enabled: boolean;
  created: string;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function timeToMinutes(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function brightnessIcon(pct: number) {
  if (pct >= 90) return <Sun className="h-4 w-4 text-yellow-500" />;
  if (pct >= 65) return <Sunrise className="h-4 w-4 text-orange-400" />;
  if (pct >= 40) return <Sunset className="h-4 w-4 text-orange-600" />;
  return <Moon className="h-4 w-4 text-indigo-400" />;
}

function BrightnessBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-yellow-400 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-sm font-medium tabular-nums w-9 text-right">{pct}%</span>
    </div>
  );
}

const emptyForm = {
  name: "",
  start_time: "06:00",
  end_time: "09:59",
  brightness_percent: 80,
  days_of_week: ALL_DAYS,
  bag_id: null as string | null,
  enabled: true,
};

export function BrightnessSchedule() {
  const qc = useQueryClient();
  const { data: schedules = [], isLoading } = useQuery<BrightnessSchedule[]>({
    queryKey: ["brightness"],
    queryFn: () => api.get("/brightness"),
  });

  const [open, setOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<BrightnessSchedule | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  function openCreate() {
    setEditTarget(null);
    setForm({ ...emptyForm });
    setOpen(true);
  }

  function openEdit(s: BrightnessSchedule) {
    setEditTarget(s);
    setForm({
      name: s.name,
      start_time: s.start_time,
      end_time: s.end_time,
      brightness_percent: s.brightness_percent,
      days_of_week: s.days_of_week,
      bag_id: s.bag_id,
      enabled: s.enabled,
    });
    setOpen(true);
  }

  const save = useMutation({
    mutationFn: () =>
      editTarget
        ? api.put(`/brightness/${editTarget.id}`, form)
        : api.post("/brightness", form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["brightness"] });
      setOpen(false);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/brightness/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["brightness"] }),
  });

  const toggleDay = (d: number) => {
    setForm((f) => ({
      ...f,
      days_of_week: f.days_of_week.includes(d)
        ? f.days_of_week.filter((x) => x !== d)
        : [...f.days_of_week, d].sort(),
    }));
  };

  const sorted = [...schedules].sort(
    (a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time)
  );

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Brightness Schedules</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Control display brightness by time of day. Rules are applied in time order.
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add schedule
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="border rounded-lg py-12 text-center text-muted-foreground text-sm">
          No brightness schedules. Add one to get started.
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((s) => (
            <div
              key={s.id}
              className="border rounded-lg px-4 py-3 flex items-center gap-4 bg-card hover:bg-accent/30 transition-colors"
            >
              <div className="shrink-0">{brightnessIcon(s.brightness_percent)}</div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm">{s.name}</span>
                  {!s.enabled && <Badge variant="outline" className="text-xs">Disabled</Badge>}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="font-mono">{s.start_time} – {s.end_time}</span>
                  <span className="flex gap-0.5">
                    {DAY_LABELS.map((label, i) => (
                      <span
                        key={i}
                        className={s.days_of_week.includes(i)
                          ? "text-foreground font-medium"
                          : "opacity-30"}
                      >
                        {label.slice(0, 1)}
                      </span>
                    ))}
                  </span>
                  {s.bag_id && <span>Bag: {s.bag_id}</span>}
                </div>
              </div>

              <BrightnessBar pct={s.brightness_percent} />

              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(s)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => remove.mutate(s.id)}
                  disabled={remove.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Timeline preview */}
      {sorted.length > 0 && (
        <div className="border rounded-lg p-4">
          <p className="text-xs font-medium mb-3 text-muted-foreground">24-hour preview</p>
          <div className="relative h-6 rounded-full bg-muted overflow-hidden flex">
            {sorted.filter(s => s.enabled).map((s) => {
              const start = timeToMinutes(s.start_time);
              // handle overnight wrap (e.g. 22:00–05:59)
              let end = timeToMinutes(s.end_time) + 1;
              if (end <= start) end = 1440;
              const leftPct = (start / 1440) * 100;
              const widthPct = ((end - start) / 1440) * 100;
              const opacity = 0.3 + (s.brightness_percent / 100) * 0.7;
              return (
                <div
                  key={s.id}
                  className="absolute h-full bg-yellow-400 flex items-center justify-center"
                  style={{ left: `${leftPct}%`, width: `${widthPct}%`, opacity }}
                  title={`${s.name}: ${s.brightness_percent}%`}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget ? "Edit schedule" : "New brightness schedule"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">Name</label>
              <Input
                placeholder="e.g. Daytime"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">Start time</label>
                <Input
                  type="time"
                  value={form.start_time}
                  onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">End time</label>
                <Input
                  type="time"
                  value={form.end_time}
                  onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-2">
                Brightness — {form.brightness_percent}%
              </label>
              <div className="flex items-center gap-3">
                <Moon className="h-4 w-4 text-indigo-400 shrink-0" />
                <input
                  type="range"
                  min={5}
                  max={100}
                  step={5}
                  value={form.brightness_percent}
                  onChange={(e) => setForm((f) => ({ ...f, brightness_percent: Number(e.target.value) }))}
                  className="flex-1 accent-yellow-400"
                />
                <Sun className="h-4 w-4 text-yellow-500 shrink-0" />
              </div>
              <BrightnessBar pct={form.brightness_percent} />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-2">Days of week</label>
              <div className="flex gap-1">
                {DAY_LABELS.map((label, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDay(i)}
                    className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors border ${
                      form.days_of_week.includes(i)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:bg-accent"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="enabled"
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                className="h-4 w-4"
              />
              <label htmlFor="enabled" className="text-sm">Enabled</label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !form.name}>
              {editTarget ? "Save changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

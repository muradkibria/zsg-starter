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
import { Separator } from "@/components/ui/separator";
import {
  Plus, Phone, Mail, MapPin, FileText, Clock, Download, ChevronRight, Loader2,
} from "lucide-react";

interface Document { type: string; filename: string; url: string }

interface Bag {
  id: string;
  name: string;
  colorlight_device_id: string;
  status: string;
  rider_id: string | null;
  last_lat: number | null;
  last_lng: number | null;
  last_gps_at: string | null;
  expand?: { rider_id?: { name: string } | null };
}

interface Rider {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  status: string;
  bag_id: string | null;
  documents: Document[];
  created: string;
}

interface Session {
  id: string;
  rider_id: string;
  bag_id: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
}

interface SessionsResponse {
  sessions: Session[];
  totalSeconds: number;
  totalHours: number;
}

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

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

// ── Rider detail panel ────────────────────────────────────────────────────────

function RiderPanel({
  rider,
  bags,
  onClose,
}: {
  rider: Rider;
  bags: Bag[];
  onClose: () => void;
}) {
  const allocatedBag = bags.find((b) => b.id === rider.bag_id);

  const { data: sessionsData, isLoading: sessionsLoading } = useQuery<SessionsResponse>({
    queryKey: ["rider-sessions", rider.id],
    queryFn: () => api.get(`/riders/${rider.id}/sessions`),
  });

  function downloadReport() {
    window.location.href = `/api/riders/${rider.id}/sessions/export`;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-base">{rider.name}</h3>
          <StatusBadge status={rider.status} />
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>✕</Button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-5 pr-1">
        {/* Contact */}
        <section>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Contact</p>
          <div className="space-y-2">
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
          </div>
        </section>

        <Separator />

        {/* Allocated bag */}
        <section>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Allocated Terminal
          </p>
          {allocatedBag ? (
            <div className="flex items-center justify-between border rounded-md px-3 py-2 bg-muted/40">
              <div>
                <p className="text-sm font-medium">{allocatedBag.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{allocatedBag.colorlight_device_id}</p>
              </div>
              <StatusBadge status={allocatedBag.status} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No terminal allocated</p>
          )}
        </section>

        <Separator />

        {/* Documents */}
        <section>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Documents</p>
          {rider.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents uploaded</p>
          ) : (
            <div className="space-y-1.5">
              {rider.documents.map((doc, i) => (
                <a
                  key={i}
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 border rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors"
                >
                  <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="flex-1 font-medium">{doc.type}</span>
                  <span className="text-xs text-muted-foreground truncate max-w-[120px]">{doc.filename}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </a>
              ))}
            </div>
          )}
        </section>

        <Separator />

        {/* Online hours */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Online Hours</p>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={downloadReport}
            >
              <Download className="h-3 w-3" />
              Export CSV
            </Button>
          </div>

          {sessionsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : !sessionsData || sessionsData.sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sessions recorded</p>
          ) : (
            <>
              <div className="flex items-center gap-1.5 text-sm mb-3">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{sessionsData.totalHours}h total</span>
                <span className="text-muted-foreground">across {sessionsData.sessions.length} sessions</span>
              </div>
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Started</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Ended</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessionsData.sessions.map((s) => (
                      <tr key={s.id} className="border-t">
                        <td className="px-3 py-2 font-mono">{new Date(s.started_at).toLocaleString()}</td>
                        <td className="px-3 py-2 font-mono">{new Date(s.ended_at).toLocaleString()}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatDuration(s.duration_seconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Register rider form ───────────────────────────────────────────────────────

const DOC_TYPES = ["National ID", "Proof of Address", "DBS Check", "Right to Work", "Other"];

function RegisterRiderDialog({
  open,
  onClose,
  bags,
}: {
  open: boolean;
  onClose: () => void;
  bags: Bag[];
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    bag_id: "",
    status: "active",
  });
  const [docFiles, setDocFiles] = useState<{ type: string; file: File | null }[]>([
    { type: "National ID", file: null },
  ]);

  const create = useMutation({
    mutationFn: () => api.post("/riders", { ...form, bag_id: form.bag_id || null, documents: [] }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["riders"] });
      qc.invalidateQueries({ queryKey: ["bags"] });
      onClose();
      setForm({ name: "", phone: "", email: "", address: "", bag_id: "", status: "active" });
      setDocFiles([{ type: "National ID", file: null }]);
    },
  });

  const availableBags = bags.filter((b) => !b.rider_id || b.id === form.bag_id);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Register New Rider</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
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
                placeholder="+44 7700 900000"
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
                placeholder="Street address"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Allocate terminal (optional)</label>
            <select
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              value={form.bag_id}
              onChange={(e) => setForm((f) => ({ ...f, bag_id: e.target.value }))}
            >
              <option value="">— No terminal —</option>
              {availableBags.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.colorlight_device_id})
                </option>
              ))}
            </select>
          </div>

          <Separator />

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-muted-foreground">Documents</label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setDocFiles((d) => [...d, { type: "National ID", file: null }])}
              >
                <Plus className="h-3 w-3 mr-1" /> Add document
              </Button>
            </div>
            <div className="space-y-2">
              {docFiles.map((doc, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    className="border rounded-md px-2 py-1.5 text-xs bg-background flex-shrink-0 w-40"
                    value={doc.type}
                    onChange={(e) =>
                      setDocFiles((d) => d.map((x, j) => j === i ? { ...x, type: e.target.value } : x))
                    }
                  >
                    {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                  <Input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    className="text-xs flex-1"
                    onChange={(e) =>
                      setDocFiles((d) => d.map((x, j) => j === i ? { ...x, file: e.target.files?.[0] ?? null } : x))
                    }
                  />
                  {docFiles.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => setDocFiles((d) => d.filter((_, j) => j !== i))}
                    >✕</Button>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Accepted: PDF, JPG, PNG (documents saved when backend is live)
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || !form.name}
          >
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Register rider
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Fleet page ───────────────────────────────────────────────────────────

export function Fleet() {
  const qc = useQueryClient();

  const { data: bags = [], isLoading: bagsLoading } = useQuery<Bag[]>({
    queryKey: ["bags"],
    queryFn: () => api.get("/bags"),
  });
  const { data: riders = [], isLoading: ridersLoading } = useQuery<Rider[]>({
    queryKey: ["riders"],
    queryFn: () => api.get("/riders"),
  });

  const [addBagOpen, setAddBagOpen] = useState(false);
  const [registerRiderOpen, setRegisterRiderOpen] = useState(false);
  const [selectedRider, setSelectedRider] = useState<Rider | null>(null);
  const [bagForm, setBagForm] = useState({ name: "", colorlight_device_id: "" });

  const createBag = useMutation({
    mutationFn: (data: typeof bagForm) => api.post("/bags", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bags"] });
      setAddBagOpen(false);
      setBagForm({ name: "", colorlight_device_id: "" });
    },
  });

  return (
    <div className="flex gap-6 h-full">
      {/* Main content */}
      <div className={`flex-1 min-w-0 space-y-4 transition-all ${selectedRider ? "max-w-[calc(100%-340px)]" : ""}`}>
        <Tabs defaultValue="bags">
          <div className="flex items-center justify-between mb-4">
            <TabsList>
              <TabsTrigger value="bags">Terminals ({bags.length})</TabsTrigger>
              <TabsTrigger value="riders">Riders ({riders.length})</TabsTrigger>
            </TabsList>
          </div>

          {/* ── Bags tab ── */}
          <TabsContent value="bags">
            <div className="flex justify-end mb-3">
              <Button size="sm" onClick={() => setAddBagOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" />Add Terminal
              </Button>
            </div>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Device ID</TableHead>
                    <TableHead>Rider</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last GPS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bagsLoading
                    ? Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell colSpan={5}><Skeleton className="h-4 w-full" /></TableCell>
                        </TableRow>
                      ))
                    : bags.length === 0
                    ? (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                            No terminals registered
                          </TableCell>
                        </TableRow>
                      )
                    : bags.map((bag) => (
                        <TableRow key={bag.id}>
                          <TableCell className="font-medium">{bag.name}</TableCell>
                          <TableCell className="text-muted-foreground font-mono text-xs">
                            {bag.colorlight_device_id}
                          </TableCell>
                          <TableCell>
                            {bag.expand?.rider_id?.name ?? (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell><StatusBadge status={bag.status} /></TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {bag.last_gps_at
                              ? new Date(bag.last_gps_at).toLocaleString()
                              : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* ── Riders tab ── */}
          <TabsContent value="riders">
            <div className="flex justify-end mb-3">
              <Button size="sm" onClick={() => setRegisterRiderOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" />Register Rider
              </Button>
            </div>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Terminal</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ridersLoading
                    ? Array.from({ length: 3 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell colSpan={6}><Skeleton className="h-4 w-full" /></TableCell>
                        </TableRow>
                      ))
                    : riders.length === 0
                    ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                            No riders registered
                          </TableCell>
                        </TableRow>
                      )
                    : riders.map((rider) => {
                        const bag = bags.find((b) => b.id === rider.bag_id);
                        const isSelected = selectedRider?.id === rider.id;
                        return (
                          <TableRow
                            key={rider.id}
                            className={`cursor-pointer ${isSelected ? "bg-accent" : "hover:bg-accent/50"}`}
                            onClick={() => setSelectedRider(isSelected ? null : rider)}
                          >
                            <TableCell className="font-medium">{rider.name}</TableCell>
                            <TableCell className="text-muted-foreground">{rider.phone ?? "—"}</TableCell>
                            <TableCell className="text-muted-foreground">{rider.email ?? "—"}</TableCell>
                            <TableCell>
                              {bag ? (
                                <span className="text-xs font-medium">{bag.name}</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell><StatusBadge status={rider.status} /></TableCell>
                            <TableCell className="text-right">
                              <ChevronRight
                                className={`h-4 w-4 text-muted-foreground transition-transform ${isSelected ? "rotate-90" : ""}`}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Rider detail panel */}
      {selectedRider && (
        <div className="w-[320px] shrink-0 border rounded-lg p-4 bg-card overflow-hidden flex flex-col">
          <RiderPanel
            rider={selectedRider}
            bags={bags}
            onClose={() => setSelectedRider(null)}
          />
        </div>
      )}

      {/* Add bag dialog */}
      <Dialog open={addBagOpen} onOpenChange={setAddBagOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Terminal</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              placeholder="Terminal name (e.g. BAG-006)"
              value={bagForm.name}
              onChange={(e) => setBagForm((f) => ({ ...f, name: e.target.value }))}
            />
            <Input
              placeholder="Colorlight Device ID"
              value={bagForm.colorlight_device_id}
              onChange={(e) => setBagForm((f) => ({ ...f, colorlight_device_id: e.target.value }))}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddBagOpen(false)}>Cancel</Button>
            <Button onClick={() => createBag.mutate(bagForm)} disabled={createBag.isPending || !bagForm.name}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Register rider dialog */}
      <RegisterRiderDialog
        open={registerRiderOpen}
        onClose={() => setRegisterRiderOpen(false)}
        bags={bags}
      />
    </div>
  );
}

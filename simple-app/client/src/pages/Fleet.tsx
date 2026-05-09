import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { Plus, ChevronRight, Loader2, Trash2 } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface Bag {
  id: string;
  name: string;
  colorlight_device_id: string;
  status: string;
  rider_id: string | null;
  last_lat: number | null;
  last_lng: number | null;
  last_gps_at: string | null;
  expand?: { rider_id?: { id: string; name: string } | null };
}

interface Rider {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  status: "active" | "inactive";
  bag_id: string | null;
  documents: { id: string }[];
  created: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

// ── Page ─────────────────────────────────────────────────────────────────────

export function Fleet() {
  const qc = useQueryClient();
  const navigate = useNavigate();

  const {
    data: bags = [],
    isLoading: bagsLoading,
    isError: bagsErr,
    error: bagsError,
    refetch: refetchBags,
  } = useQuery<Bag[]>({
    queryKey: ["bags"],
    queryFn: () => api.get("/bags"),
  });
  const {
    data: riders = [],
    isLoading: ridersLoading,
    isError: ridersErr,
    error: ridersError,
    refetch: refetchRiders,
  } = useQuery<Rider[]>({
    queryKey: ["riders"],
    queryFn: () => api.get("/riders"),
  });

  const [addBagOpen, setAddBagOpen] = useState(false);
  const [registerRiderOpen, setRegisterRiderOpen] = useState(false);
  const [bagForm, setBagForm] = useState({ name: "", colorlight_device_id: "" });

  const createBag = useMutation({
    mutationFn: (data: typeof bagForm) => api.post("/bags", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bags"] });
      setAddBagOpen(false);
      setBagForm({ name: "", colorlight_device_id: "" });
    },
  });

  const deleteRider = useMutation({
    mutationFn: (id: string) => api.delete(`/riders/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["riders"] });
      qc.invalidateQueries({ queryKey: ["bags"] });
    },
  });

  return (
    <div className="space-y-4">
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
          {bagsErr ? (
            <ErrorState
              title="Couldn't load terminals"
              error={bagsError}
              onRetry={() => refetchBags()}
            />
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Device ID</TableHead>
                    <TableHead>Rider</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last GPS</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bagsLoading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={6}><Skeleton className="h-4 w-full" /></TableCell>
                      </TableRow>
                    ))
                  ) : bags.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        No terminals registered
                      </TableCell>
                    </TableRow>
                  ) : (
                    bags.map((bag) => (
                      <TableRow
                        key={bag.id}
                        className="cursor-pointer hover:bg-accent/50"
                        onClick={() => navigate(`/fleet/${bag.id}`)}
                      >
                        <TableCell className="font-medium text-primary hover:underline">
                          {bag.name}
                        </TableCell>
                        <TableCell className="text-muted-foreground font-mono text-xs">
                          {bag.colorlight_device_id}
                        </TableCell>
                        <TableCell>
                          {bag.expand?.rider_id?.name ? (
                            <span className="text-sm">{bag.expand.rider_id.name}</span>
                          ) : (
                            <span className="text-muted-foreground text-xs italic">unassigned</span>
                          )}
                        </TableCell>
                        <TableCell><StatusBadge status={bag.status} /></TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {bag.last_gps_at ? new Date(bag.last_gps_at).toLocaleString() : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ── Riders tab ── */}
        <TabsContent value="riders">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-muted-foreground">
              Register riders here, then go to a terminal to assign one.
            </p>
            <Button size="sm" onClick={() => setRegisterRiderOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />Register Rider
            </Button>
          </div>
          {ridersErr ? (
            <ErrorState
              title="Couldn't load riders"
              error={ridersError}
              onRetry={() => refetchRiders()}
            />
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Allocated to</TableHead>
                    <TableHead>Documents</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ridersLoading ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={7}><Skeleton className="h-4 w-full" /></TableCell>
                      </TableRow>
                    ))
                  ) : riders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        No riders registered yet — click "Register Rider" to add one.
                      </TableCell>
                    </TableRow>
                  ) : (
                    riders.map((rider) => {
                      const bag = rider.bag_id ? bags.find((b) => b.id === rider.bag_id) : null;
                      return (
                        <TableRow
                          key={rider.id}
                          className="cursor-pointer hover:bg-accent/50"
                          onClick={() => navigate(`/riders/${rider.id}`)}
                        >
                          <TableCell className="font-medium text-primary hover:underline">
                            {rider.name}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{rider.phone ?? "—"}</TableCell>
                          <TableCell className="text-muted-foreground">{rider.email ?? "—"}</TableCell>
                          <TableCell>
                            {bag ? (
                              <span className="text-xs font-medium">{bag.name}</span>
                            ) : (
                              <span className="text-muted-foreground text-xs italic">unallocated</span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {rider.documents.length}
                          </TableCell>
                          <TableCell><StatusBadge status={rider.status} /></TableCell>
                          <TableCell className="text-right">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (
                                  confirm(
                                    `Delete rider "${rider.name}"?\n\nTheir profile and documents will be removed${
                                      bag ? ` and they'll be unassigned from ${bag.name}` : ""
                                    }. This cannot be undone.`
                                  )
                                ) {
                                  deleteRider.mutate(rider.id);
                                }
                              }}
                              disabled={deleteRider.isPending}
                              className="text-muted-foreground hover:text-destructive p-1.5"
                              title="Delete rider"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>

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

      {/* Register rider dialog (profile only — allocation happens later from a terminal) */}
      <RegisterRiderDialog
        open={registerRiderOpen}
        onClose={() => setRegisterRiderOpen(false)}
      />
    </div>
  );
}

// ── Register rider — profile fields only ─────────────────────────────────────

function RegisterRiderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    notes: "",
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<Rider>("/riders", {
        ...form,
        status: "active",
      }),
    onSuccess: (rider) => {
      qc.invalidateQueries({ queryKey: ["riders"] });
      onClose();
      // Reset form for next time
      setForm({ name: "", phone: "", email: "", address: "", notes: "" });
      // Jump to the new rider's detail page so the user can upload ID docs etc.
      navigate(`/riders/${rider.id}`);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Register New Rider</DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Just the basics. After saving, you'll land on the rider's page where you can upload ID
            documents and any other paperwork. Allocate them to a terminal from the Terminals tab.
          </p>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Full name *</label>
            <Input
              placeholder="e.g. James Okafor"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
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
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Address</label>
            <Input
              placeholder="Street, city, postcode"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Notes</label>
            <textarea
              rows={2}
              className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring"
              placeholder="Internal notes (optional)"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!form.name.trim() || create.isPending}>
            {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
            Register &amp; continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ErrorState } from "@/components/ui/error-state";
import {
  ArrowLeft, Save, Loader2, Phone, Mail, MapPin, FileText, Plus, Trash2,
  Download, ExternalLink, Truck, User,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface RiderDocument {
  id: string;
  type: string;
  filename: string;
  mime_type: string;
  data: string;
  size_bytes: number;
  uploaded: string;
}

interface Rider {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  bag_id: string | null;
  status: "active" | "inactive";
  documents: RiderDocument[];
  notes: string;
  created: string;
  updated: string;
}

interface Bag {
  id: string;
  name: string;
  colorlight_device_id: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const DOC_TYPES = ["National ID", "Passport", "Driving Licence", "Proof of Address", "DBS Check", "Right to Work", "Other"];
const MAX_DOC_SIZE = 5 * 1024 * 1024;

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function RiderDetail() {
  const { riderId } = useParams<{ riderId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const riderQ = useQuery<Rider>({
    queryKey: ["rider", riderId],
    queryFn: () => api.get(`/riders/${riderId}`),
    enabled: !!riderId,
  });

  // Look up the bag (if any) the rider is currently allocated to
  const bagsQ = useQuery<Bag[]>({
    queryKey: ["bags"],
    queryFn: () => api.get("/bags"),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/riders/${riderId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["riders"] });
      qc.invalidateQueries({ queryKey: ["bags"] });
      navigate("/fleet");
    },
  });

  if (!riderId) return null;

  const rider = riderQ.data;
  const allocatedBag = rider?.bag_id ? bagsQ.data?.find((b) => b.id === rider.bag_id) : null;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Top bar */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/fleet")} className="gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Riders
        </Button>
        <span className="text-muted-foreground">/</span>
        {riderQ.isLoading ? (
          <Skeleton className="h-5 w-32" />
        ) : (
          <h2 className="text-base font-semibold flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            {rider?.name ?? riderId}
          </h2>
        )}
      </div>

      {riderQ.isError ? (
        <ErrorState
          title="Couldn't load rider"
          error={riderQ.error}
          onRetry={() => riderQ.refetch()}
        />
      ) : riderQ.isLoading || !rider ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          {/* Allocation banner */}
          <Card>
            <CardContent className="p-4 flex items-center gap-3 text-sm">
              <Truck className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1">
                <p className="font-semibold">Currently allocated</p>
                {allocatedBag ? (
                  <p className="text-xs text-muted-foreground">
                    <Link to={`/fleet/${allocatedBag.id}`} className="text-primary hover:underline">
                      {allocatedBag.name}
                    </Link>{" "}
                    ({allocatedBag.colorlight_device_id})
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Not allocated. Open a terminal from the{" "}
                    <Link to="/fleet" className="text-primary hover:underline">Fleet page</Link>{" "}
                    and assign this rider from there.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <ProfileSection rider={rider} />

          <DocumentsSection rider={rider} />

          {/* Danger zone */}
          <Card className="border-destructive/40">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Delete rider</p>
                <p className="text-xs text-muted-foreground">
                  Permanently removes this rider, their profile, and all uploaded documents.
                  {allocatedBag && " They'll also be unassigned from " + allocatedBag.name + "."}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive border-destructive/40 hover:bg-destructive/5 hover:text-destructive"
                onClick={() => {
                  if (
                    confirm(
                      `Delete rider "${rider.name}"?\n\n` +
                      "Their profile, documents, and any bag allocation will be removed. This cannot be undone."
                    )
                  ) {
                    remove.mutate();
                  }
                }}
                disabled={remove.isPending}
              >
                {remove.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Trash2 className="h-3.5 w-3.5 mr-1" />}
                Delete rider
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ── Profile editor ───────────────────────────────────────────────────────────

function ProfileSection({ rider }: { rider: Rider }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: rider.name,
    phone: rider.phone ?? "",
    email: rider.email ?? "",
    address: rider.address ?? "",
    notes: rider.notes ?? "",
  });

  useEffect(() => {
    setForm({
      name: rider.name,
      phone: rider.phone ?? "",
      email: rider.email ?? "",
      address: rider.address ?? "",
      notes: rider.notes ?? "",
    });
  }, [rider.id, rider.updated]);

  const save = useMutation({
    mutationFn: () =>
      api.put(`/riders/${rider.id}`, {
        name: form.name,
        phone: form.phone || null,
        email: form.email || null,
        address: form.address || null,
        notes: form.notes,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rider", rider.id] });
      qc.invalidateQueries({ queryKey: ["riders"] });
      setEditing(false);
    },
  });

  if (!editing) {
    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-3">
            <h3 className="text-sm font-semibold">Profile</h3>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>Edit</Button>
          </div>
          <div className="space-y-1.5">
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
            {!rider.phone && !rider.email && !rider.address && (
              <p className="text-sm text-muted-foreground italic">No contact details yet</p>
            )}
            {rider.notes && (
              <p className="text-sm text-muted-foreground italic mt-2 whitespace-pre-wrap">
                {rider.notes}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Edit profile</h3>
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="text-xs font-medium text-muted-foreground block mb-1">Full name *</label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Phone</label>
            <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Email</label>
            <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </div>
          <div className="col-span-2">
            <label className="text-xs font-medium text-muted-foreground block mb-1">Address</label>
            <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          </div>
          <div className="col-span-2">
            <label className="text-xs font-medium text-muted-foreground block mb-1">Notes</label>
            <textarea
              rows={3}
              className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 outline-none focus:ring-2 focus:ring-ring"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={() => save.mutate()} disabled={!form.name.trim() || save.isPending}>
            {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            Save changes
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Documents ────────────────────────────────────────────────────────────────

function DocumentsSection({ rider }: { rider: Rider }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [docType, setDocType] = useState(DOC_TYPES[0]);
  const [file, setFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file");
      if (file.size > MAX_DOC_SIZE) throw new Error(`File too large — max ${formatBytes(MAX_DOC_SIZE)}`);
      const data = await readFileAsDataURL(file);
      return api.post(`/riders/${rider.id}/documents`, {
        type: docType,
        filename: file.name,
        mime_type: file.type || "application/octet-stream",
        data,
        size_bytes: file.size,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rider", rider.id] });
      qc.invalidateQueries({ queryKey: ["riders"] });
      setAdding(false);
      setFile(null);
      setDocType(DOC_TYPES[0]);
      setUploadError(null);
    },
    onError: (err) => setUploadError(err instanceof Error ? err.message : "Upload failed"),
  });

  const remove = useMutation({
    mutationFn: (docId: string) => api.delete(`/riders/${rider.id}/documents/${docId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rider", rider.id] }),
  });

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">
            ID Documents
            <span className="text-xs text-muted-foreground font-normal ml-2">
              ({rider.documents.length})
            </span>
          </h3>
          {!adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add document
            </Button>
          )}
        </div>

        {adding && (
          <div className="border rounded-md p-3 mb-3 bg-muted/30 space-y-2">
            <div className="flex gap-2">
              <select
                className="border rounded-md px-2 py-1.5 text-xs bg-background"
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
              >
                {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
              <Input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.heic"
                className="text-xs flex-1"
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setUploadError(null); }}
              />
            </div>
            {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setAdding(false); setFile(null); setUploadError(null); }}>
                Cancel
              </Button>
              <Button size="sm" disabled={!file || add.isPending} onClick={() => add.mutate()}>
                {add.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                Upload
              </Button>
            </div>
          </div>
        )}

        {rider.documents.length === 0 && !adding ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            No documents uploaded
          </p>
        ) : (
          <div className="space-y-1.5">
            {rider.documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center gap-2 border rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors group"
              >
                <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-xs">{doc.type}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {doc.filename} · {formatBytes(doc.size_bytes)} · uploaded {new Date(doc.uploaded).toLocaleDateString()}
                  </p>
                </div>
                <a href={doc.data} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground p-1" title="Open">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <a href={doc.data} download={doc.filename} className="text-muted-foreground hover:text-foreground p-1" title="Download">
                  <Download className="h-3.5 w-3.5" />
                </a>
                <button
                  onClick={() => { if (confirm(`Delete "${doc.filename}"?`)) remove.mutate(doc.id); }}
                  className="text-muted-foreground hover:text-destructive p-1 opacity-0 group-hover:opacity-100"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// A rider's documents: status and expiry for everyone who can see riders;
// opening, uploading and checking only with document access (riders.documents).
// Files stream through our API, which checks permission and audits every open.

import { useRef, useState, type FormEvent } from "react";
import clsx from "clsx";
import { CheckCircle2, Clock3, Download, Eye, FileText, Image as ImageIcon, Lock, Pencil, Upload, XCircle } from "lucide-react";
import {
  addDays,
  DOC_ACCEPT,
  DOC_DUE_DAYS,
  DOC_MAX_BYTES,
  DOC_MIME_TYPES,
  REQUIRED_DOC_KINDS,
  RIDER_DOC_KINDS,
  RIDER_DOC_LABEL,
  todayLondon,
  type RiderDetail,
  type RiderDocKind,
  type RiderDocStatus,
  type RiderDocumentDto,
} from "@digilite/shared";
import { useAuth } from "@/lib/auth";
import { useFeedback } from "@/components/feedback";
import { Button, buttonClass, Card, CardHeader, ErrorState, Field, Input, Select, Spinner, Textarea } from "@/components/ui";
import { shortDate } from "@/lib/format";
import { documentHref, useDeleteDocument, useRiderDocuments, useUpdateDocument, useUploadDocument } from "./api";
import { DocsPill } from "./bits";

const dayText = (day: string) => shortDate(`${day}T12:00:00Z`);

export function DocumentsCard({ rider }: { rider: RiderDetail }) {
  const { can } = useAuth();
  const canOpen = can("riders.documents");
  const docs = useRiderDocuments(rider.id);
  const [uploadKind, setUploadKind] = useState<RiderDocKind | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  // Once a rider has ended, missing or expiring documents need no action.
  const ended = rider.stage === "ended";

  const byKind = new Map<RiderDocKind, RiderDocumentDto[]>();
  for (const d of docs.data ?? []) byKind.set(d.kind, [...(byKind.get(d.kind) ?? []), d]);
  const kinds = RIDER_DOC_KINDS.filter((k) => REQUIRED_DOC_KINDS.includes(k) || byKind.has(k));

  const openUpload = (kind: RiderDocKind) => {
    setUploadKind(kind);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
  };

  return (
    <Card className="p-5">
      <CardHeader
        title="Documents"
        action={
          ended ? (
            <span className="text-[13px] text-muted">{(docs.data ?? []).length} on file</span>
          ) : rider.docs.state === "ok" ? (
            <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-green-ink">
              <CheckCircle2 className="size-4" aria-hidden /> {rider.docs.checked} of {rider.docs.required} checked
            </span>
          ) : (
            <DocsPill docs={rider.docs} />
          )
        }
      />
      {docs.isLoading && <Spinner />}
      {docs.error && <ErrorState error={docs.error} retry={() => void docs.refetch()} />}
      {docs.data && (
        <ul className="m-0 mt-2 list-none p-0">
          {kinds.map((kind) => {
            const list = byKind.get(kind) ?? [];
            if (!list.length) return <MissingRow key={kind} kind={kind} canOpen={canOpen} ended={ended} onUpload={() => openUpload(kind)} />;
            return list.map((d, i) => <DocRow key={d.id} rider={rider} doc={d} older={i > 0} canOpen={canOpen} />);
          })}
        </ul>
      )}
      {canOpen ? (
        <div ref={formRef} className="mt-3">
          {uploadKind ? (
            <UploadForm key={uploadKind} riderId={rider.id} initialKind={uploadKind} onDone={() => setUploadKind(null)} />
          ) : (
            <Button icon={<Upload className="size-4" />} onClick={() => openUpload("right_to_work")} className="w-full sm:w-auto">
              Upload a document
            </Button>
          )}
        </div>
      ) : (
        <p className="m-0 mt-3 flex items-center gap-1.5 text-xs text-muted">
          <Lock className="size-3.5" aria-hidden /> Opening or changing documents needs document access.
        </p>
      )}
    </Card>
  );
}

function MissingRow({ kind, canOpen, ended, onUpload }: { kind: RiderDocKind; canOpen: boolean; ended: boolean; onUpload: () => void }) {
  if (ended)
    return (
      <li className="flex items-center gap-3 border-b border-rule-soft py-3 last:border-b-0">
        <div className="min-w-0 flex-1 text-sm font-semibold">{RIDER_DOC_LABEL[kind]}</div>
        <span className="text-[13px] text-muted">Not on file</span>
      </li>
    );
  return (
    <li className="flex items-center gap-3 border-b border-rule-soft py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{RIDER_DOC_LABEL[kind]}</div>
        <div className="text-xs text-muted">Needed before they carry a bag</div>
      </div>
      <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-amber-ink">
        <XCircle className="size-4" aria-hidden /> Missing
      </span>
      {canOpen && (
        <Button size="sm" onClick={onUpload} aria-label={`Upload ${RIDER_DOC_LABEL[kind]}`}>
          Upload
        </Button>
      )}
    </li>
  );
}

function StatusText({ status, checkedAt }: { status: RiderDocStatus; checkedAt: string | null }) {
  if (status === "checked")
    return (
      <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-green-ink">
        <CheckCircle2 className="size-4" aria-hidden /> Checked{checkedAt ? ` ${shortDate(checkedAt)}` : ""}
      </span>
    );
  if (status === "rejected")
    return (
      <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-red-ink">
        <XCircle className="size-4" aria-hidden /> Rejected
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-amber-ink">
      <Clock3 className="size-4" aria-hidden /> To check
    </span>
  );
}

function ExpiryText({ day }: { day: string | null }) {
  if (!day) return null;
  const today = todayLondon();
  const expired = day < today;
  const soon = !expired && day <= addDays(today, DOC_DUE_DAYS);
  return (
    <span className={clsx("text-xs", expired ? "font-semibold text-red-ink" : soon ? "font-semibold text-amber-ink" : "text-muted")}>
      {expired ? `Expired ${dayText(day)}` : `Expires ${dayText(day)}`}
    </span>
  );
}

function DocRow({ rider, doc, older, canOpen }: { rider: RiderDetail; doc: RiderDocumentDto; older: boolean; canOpen: boolean }) {
  const [editing, setEditing] = useState(false);
  const update = useUpdateDocument(rider.id);
  const { toast } = useFeedback();
  const label = RIDER_DOC_LABEL[doc.kind];
  const markChecked = () =>
    update.mutate(
      { docId: doc.id, status: "checked" },
      { onSuccess: () => toast(`${label} checked`), onError: (e) => toast(e.message, "error") },
    );
  const hasActions = canOpen && (doc.hasFile || doc.status === "pending");
  return (
    <li className={clsx("flex flex-col gap-2 border-b border-rule-soft py-3 last:border-b-0", older && "opacity-70")}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-caption" aria-hidden>
          {doc.fileType === "image" ? <ImageIcon className="size-4" /> : <FileText className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            {label}
            {older && <span className="ml-1.5 text-xs font-normal text-muted">earlier copy</span>}
          </div>
          <div className="text-xs text-muted">{doc.hasFile ? `${doc.fileType === "pdf" ? "PDF" : "Image"} · added ${shortDate(doc.createdAt)}` : "No file attached"}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
          <StatusText status={doc.status} checkedAt={doc.checkedAt} />
          <ExpiryText day={doc.expiresDay} />
        </div>
        {canOpen && (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
            aria-label={`Edit ${label}`}
            className="-mt-1 -mr-1.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-paper-2 hover:text-ink"
          >
            <Pencil className="size-4" />
          </button>
        )}
      </div>
      {hasActions && (
        <div className="flex flex-wrap gap-2 pl-7">
          {doc.hasFile && (
            <>
              <a href={documentHref(rider.id, doc.id)} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>
                <Eye className="size-4" aria-hidden /> View
              </a>
              <a href={documentHref(rider.id, doc.id, true)} className={buttonClass("ghost", "sm")}>
                <Download className="size-4" aria-hidden /> Download
              </a>
            </>
          )}
          {doc.status === "pending" && (
            <Button size="sm" variant="primary" loading={update.isPending} onClick={markChecked}>
              Mark checked
            </Button>
          )}
        </div>
      )}
      {editing && <DocEditor riderId={rider.id} doc={doc} onDone={() => setEditing(false)} />}
    </li>
  );
}

function DocEditor({ riderId, doc, onDone }: { riderId: string; doc: RiderDocumentDto; onDone: () => void }) {
  const [status, setStatus] = useState<RiderDocStatus>(doc.status);
  const [expires, setExpires] = useState(doc.expiresDay ?? "");
  const [notes, setNotes] = useState(doc.notes ?? "");
  const update = useUpdateDocument(riderId);
  const del = useDeleteDocument(riderId);
  const { toast, confirm } = useFeedback();
  const label = RIDER_DOC_LABEL[doc.kind];

  const save = (e: FormEvent) => {
    e.preventDefault();
    update.mutate(
      { docId: doc.id, status, expiresDay: expires || null, notes: notes.trim() },
      {
        onSuccess: () => {
          toast("Saved");
          onDone();
        },
        onError: (err) => toast(err.message, "error"),
      },
    );
  };
  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${label}?`,
      body: "The file and its record are removed for good. The deletion is recorded in the audit log.",
      confirm: "Delete",
      danger: true,
    });
    if (!ok) return;
    del.mutate(doc.id, { onSuccess: () => toast(`${label} deleted`), onError: (err) => toast(err.message, "error") });
  };

  return (
    <form onSubmit={save} className="flex flex-col gap-3 rounded-xl bg-paper p-3.5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as RiderDocStatus)}>
            <option value="pending">To check</option>
            <option value="checked">Checked</option>
            <option value="rejected">Rejected</option>
          </Select>
        </Field>
        <Field label="Expires" hint="Blank if it doesn't expire">
          <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
      </div>
      <Field label="Note" hint="Optional, e.g. the share code reference">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={2} className="min-h-16" />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant="primary" loading={update.isPending}>
          Save
        </Button>
        <Button size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" variant="danger" className="ml-auto" loading={del.isPending} onClick={() => void remove()}>
          Delete
        </Button>
      </div>
    </form>
  );
}

function fileProblem(f: File): string | null {
  if (f.size > DOC_MAX_BYTES) return "That file is over 15 MB";
  const ext = f.name.toLowerCase().split(".").pop() ?? "";
  if (!DOC_MIME_TYPES.includes(f.type) && !["heic", "heif", "pdf", "jpg", "jpeg", "png", "webp"].includes(ext)) {
    return "Upload a PDF, JPG, PNG, HEIC or WebP file";
  }
  return null;
}

function UploadForm({ riderId, initialKind, onDone }: { riderId: string; initialKind: RiderDocKind; onDone: () => void }) {
  const [kind, setKind] = useState<RiderDocKind>(initialKind);
  const [expires, setExpires] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const upload = useUploadDocument(riderId);
  const { toast } = useFeedback();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!file) return setError("Choose a file");
    const problem = fileProblem(file);
    if (problem) return setError(problem);
    const form = new FormData();
    form.set("kind", kind);
    if (expires) form.set("expiresDay", expires);
    form.set("file", file);
    upload.mutate(form, {
      onSuccess: () => {
        toast(`${RIDER_DOC_LABEL[kind]} uploaded. Mark it checked once you've looked at it.`);
        onDone();
      },
      onError: (err) => setError(err.message),
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-rule bg-paper p-3.5" aria-label="Upload a document">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Document">
          <Select value={kind} onChange={(e) => setKind(e.target.value as RiderDocKind)}>
            {RIDER_DOC_KINDS.map((k) => (
              <option key={k} value={k}>
                {RIDER_DOC_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Expires" hint="Blank if it doesn't expire">
          <Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
      </div>
      <Field label="File" hint="PDF, JPG, PNG, HEIC or WebP, up to 15 MB. Only people with document access can open it." error={error}>
        <input
          type="file"
          accept={DOC_ACCEPT}
          onChange={(e) => {
            setError(null);
            setFile(e.target.files?.[0] ?? null);
          }}
          className="block w-full text-sm font-normal text-ink-2 file:mr-3 file:h-10 file:cursor-pointer file:rounded-[10px] file:border file:border-line file:bg-white file:px-3 file:text-sm file:font-semibold file:text-ink hover:file:bg-paper"
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={upload.isPending} icon={<Upload className="size-4" />}>
          Upload
        </Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

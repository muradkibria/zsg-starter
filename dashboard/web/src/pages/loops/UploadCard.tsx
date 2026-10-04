// Upload an ad: pick or drop a file, check it in the browser, name it, add it.
// A clean file gets one line ("Checked · ready to add"); detail only for real problems.

import { useEffect, useRef, useState, type DragEvent } from "react";
import clsx from "clsx";
import { CheckCircle2, TriangleAlert, Upload, XCircle } from "lucide-react";
import { creativeNameFromFile, creativeSizeLabel, type LibraryCreative } from "@digilite/shared";
import { ApiError } from "@/lib/api";
import { Button, Field, Input, Select } from "@/components/ui";
import { useFeedback } from "@/components/feedback";
import { useCampaignOptions, useUploadCreative } from "./api";
import { probeFile, type ProbeResult } from "./mediaProbe";
import { secs, Thumb } from "./bits";

const ACCEPT = "video/mp4,video/quicktime,image/jpeg,image/png,image/gif,.mp4,.mov,.m4v,.jpg,.jpeg,.png,.gif";

export function UploadCard({
  advertisers,
  onUploaded,
  onShowCreative,
}: {
  advertisers: string[];
  onUploaded: (c: LibraryCreative) => void;
  onShowCreative: (id: string) => void;
}) {
  const { toast } = useFeedback();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [over, setOver] = useState(false);
  const [name, setName] = useState("");
  const [advertiser, setAdvertiser] = useState("");
  const [campaign, setCampaign] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<{ text: string; existingId?: string } | null>(null);
  const upload = useUploadCreative();
  const campaigns = useCampaignOptions(!!file);
  const seq = useRef(0);

  useEffect(() => () => {
    if (probe?.thumbUrl) URL.revokeObjectURL(probe.thumbUrl);
  }, [probe]);

  const reset = () => {
    seq.current++;
    setFile(null);
    setProbe(null);
    setProbing(false);
    setName("");
    setAdvertiser("");
    setCampaign("");
    setProgress(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const choose = async (f: File | undefined | null) => {
    if (!f) return;
    const mine = ++seq.current;
    setFile(f);
    setProbe(null);
    setError(null);
    setProgress(null);
    setName(creativeNameFromFile(f.name));
    setProbing(true);
    const r = await probeFile(f);
    if (mine !== seq.current) return;
    setProbe(r);
    setProbing(false);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void choose(e.dataTransfer.files?.[0]);
  };

  const submit = async () => {
    if (!file || !probe || !name.trim()) return;
    setError(null);
    const form = new FormData();
    form.append("name", name.trim());
    form.append("advertiser", advertiser.trim());
    if (campaign) form.append("campaign", campaign);
    if (probe.facts.width) form.append("width", String(probe.facts.width));
    if (probe.facts.height) form.append("height", String(probe.facts.height));
    if (probe.facts.durationS) form.append("durationS", String(Math.round(probe.facts.durationS * 100) / 100));
    if (probe.thumb) form.append("thumb", probe.thumb, "thumb.jpg");
    form.append("file", file, file.name);
    setProgress(0);
    try {
      const c = await upload.mutateAsync({ form, onProgress: setProgress });
      toast(`Added "${c.name}" to the library`);
      onUploaded(c);
      reset();
    } catch (err) {
      setProgress(null);
      const e = err as ApiError;
      setError({ text: e.message, existingId: e.status === 409 ? e.detail : undefined });
    }
  };

  const check = probe?.check;
  const hard = check?.problems.some((p) => p.hard);
  const busy = progress !== null;
  const facts = probe?.facts;
  const meta = [
    creativeSizeLabel(file?.size),
    facts?.durationS && check?.mediaType === "video" ? secs(facts.durationS) : null,
    facts?.width && facts?.height ? `${facts.width} × ${facts.height}` : null,
  ].filter(Boolean);

  return (
    <section aria-label="Upload an ad" className="card flex flex-col gap-4 p-3 md:flex-row md:p-4">
      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={clsx(
          "flex shrink-0 rounded-xl border-[1.5px] border-dashed transition-colors",
          over ? "border-navy bg-tint-2" : "border-[#b9b09c] bg-[#fbfaf6]",
          file
            ? "flex-col items-center justify-center gap-2 px-3 py-2 text-center md:w-[230px] md:px-4 md:py-4"
            : "w-full flex-row items-center gap-3 px-3 py-3 text-left md:gap-4 md:px-4 md:py-5",
        )}
      >
        <span className={clsx("flex size-10 shrink-0 items-center justify-center rounded-xl bg-tint-2", file && "hidden md:flex")}>
          <Upload className="size-5 text-navy" aria-hidden="true" />
        </span>
        <div className={clsx("flex min-w-0 flex-col gap-1", file ? "hidden md:flex" : "flex-1")}>
          <span className="text-sm font-semibold">
            <span className="md:hidden">Upload an ad</span>
            <span className="hidden md:inline">{over ? "Drop it here" : "Drop an ad here"}</span>
          </span>
          <span className="text-xs leading-snug text-muted">MP4, MOV, JPG, PNG or GIF · 160 × 120 · up to 60 s · 100 MB</span>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className={clsx(
            "inline-flex h-11 shrink-0 items-center rounded-[10px] px-3 text-[13px] font-semibold disabled:opacity-50 md:h-10",
            file ? "text-accent hover:bg-tint-2" : "border border-line bg-white text-ink hover:bg-paper md:border-transparent md:bg-transparent md:text-accent md:hover:bg-tint-2",
          )}
        >
          {file ? "Choose another file" : (
            <>
              <span className="md:hidden">Choose a file</span>
              <span className="hidden md:inline">or choose a file</span>
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => void choose(e.target.files?.[0])}
        />
      </div>

      {/* The chosen file */}
      {file && (
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center gap-3">
            <Thumb src={probe?.thumbUrl} className="w-[72px] shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold break-all">{file.name}</div>
              <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
                {meta.map((m, i) => (
                  <span key={i}>
                    {i > 0 && "· "}
                    {m}
                  </span>
                ))}
                {probing && <span>· Checking…</span>}
                {check?.ok && (
                  <span className="inline-flex items-center gap-1 font-semibold text-green-ink">
                    · <CheckCircle2 className="size-3.5" aria-hidden="true" />
                    Checked · ready to add
                  </span>
                )}
              </div>
            </div>
          </div>

          {check && !check.ok && (
            <div className="flex flex-col gap-2">
              {check.problems.map((p) => (
                <div
                  key={p.kind}
                  role={p.hard ? "alert" : undefined}
                  className={clsx(
                    "flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-[13px]",
                    p.hard ? "bg-red-bg text-red-ink" : "bg-amber-bg text-amber-ink",
                  )}
                >
                  {p.hard ? <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
                  <div>
                    <strong>{p.title}.</strong> {p.detail}
                  </div>
                </div>
              ))}
            </div>
          )}

          {check && !hard && (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name">
                  <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={300} required disabled={busy} />
                </Field>
                <Field label="Advertiser">
                  <Input value={advertiser} onChange={(e) => setAdvertiser(e.target.value)} list="loops-advertisers" maxLength={200} placeholder="e.g. Kung Pao Panda" disabled={busy} />
                  <datalist id="loops-advertisers">
                    {advertisers.map((a) => (
                      <option key={a} value={a} />
                    ))}
                  </datalist>
                </Field>
                {!!campaigns.data?.length && (
                  <Field label="Campaign" className="sm:col-span-2">
                    <Select value={campaign} onChange={(e) => setCampaign(e.target.value)} disabled={busy}>
                      <option value="">No campaign</option>
                      {campaigns.data.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.advertiser ? `${c.advertiser}: ${c.name}` : c.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </div>

              {error && (
                <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl bg-red-bg px-3.5 py-2.5 text-[13px] text-red-ink">
                  <span className="flex-1">{error.text}</span>
                  {error.existingId && (
                    <button type="button" className="font-semibold underline" onClick={() => onShowCreative(error.existingId!)}>
                      Show it
                    </button>
                  )}
                </div>
              )}

              {busy ? (
                <div className="flex flex-col gap-1.5" role="status" aria-live="polite">
                  <div className="flex justify-between text-xs text-muted">
                    <span>{progress! < 100 ? "Uploading…" : "Saving…"}</span>
                    <span className="num">{progress}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-paper-2">
                    <div className="h-full rounded-full bg-navy transition-[width]" style={{ width: `${progress}%` }} />
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="ghost" onClick={reset}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" disabled={!name.trim()}>
                    {check.canAddAnyway ? "Add anyway" : "Add to the library"}
                  </Button>
                </div>
              )}
            </form>
          )}

          {check && hard && (
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={reset}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => inputRef.current?.click()}>
                Choose another file
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

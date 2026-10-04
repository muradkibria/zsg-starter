// One loop: its play order (drag, arrows, or keyboard), a live preview, what
// changes against the fleet loop, and sending it — test bag first, then everyone.
// Drafts save as you go; loops from Colorlight (and ones already sent) are read-only.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Copy, Plus, Trash2 } from "lucide-react";
import {
  loopPlaysPerHour,
  loopTotalSeconds,
  moveLoopItem,
  type LibraryCreative,
  type LoopDetail,
} from "@digilite/shared";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFeedback } from "@/components/feedback";
import { Button, Card, CardHeader, EmptyState, ErrorState, Notice, Page, Spinner } from "@/components/ui";
import { date, time, when } from "@/lib/format";
import { lk, useCreateLoop, useCreatives, useDeleteLoop, useLoop, useLoops, useUpdateLoop } from "./api";
import { AgePill, FleetPill, LoopStatusPill, plural, secs } from "./bits";
import { ChangesCard } from "./editor/ChangesCard";
import { ItemsList, type EditRow } from "./editor/ItemsList";
import { LibraryPicker } from "./editor/LibraryPicker";
import { LoopPreview } from "./editor/LoopPreview";
import { DeliveryCard, PublishPanel } from "./editor/PublishPanel";

interface EditItem {
  key: string;
  creative: string;
  seconds: number;
}

let keySeq = 0;
const newKey = () => `i${++keySeq}`;

export default function LoopEditorPage() {
  const { id } = useParams();
  const loop = useLoop(id);
  if (loop.isLoading) {
    return (
      <Page>
        <Spinner label="Loading the loop…" />
      </Page>
    );
  }
  if (loop.error || !loop.data) {
    const missing = loop.error instanceof ApiError && loop.error.status === 404;
    return (
      <Page>
        {missing ? (
          <div className="card">
            <EmptyState
              title="Loop not found"
              body="It may have been deleted."
              action={
                <Link to="/loops?tab=loops" className="font-semibold">
                  Back to loops
                </Link>
              }
            />
          </div>
        ) : (
          <ErrorState error={loop.error} retry={() => void loop.refetch()} />
        )}
      </Page>
    );
  }
  return <Editor key={loop.data.id} loop={loop.data} />;
}

type SaveState = { state: "idle" | "pending" | "saving" | "saved" | "error"; at?: string; error?: string };

function Editor({ loop }: { loop: LoopDetail }) {
  const { can } = useAuth();
  const { toast, confirm } = useFeedback();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const library = useCreatives();
  const loops = useLoops();
  const update = useUpdateLoop(loop.id);
  const createLoop = useCreateLoop();
  const del = useDeleteLoop();
  const editable = can("loops.edit") && !loop.readOnly;

  // Local copy being edited (drafts); read-only loops mirror the server.
  const [name, setName] = useState(loop.name);
  const [items, setItems] = useState<EditItem[]>(() => loop.items.map((i) => ({ key: newKey(), creative: i.creativeId, seconds: i.seconds })));
  const [save, setSave] = useState<SaveState>({ state: "idle" });
  const [picking, setPicking] = useState(false);
  const version = useRef(0);
  const savedVersion = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const inflight = useRef<Promise<boolean> | null>(null);
  const latest = useRef({ name, items });
  latest.current = { name, items };
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editable) return;
    setName(loop.name);
    setItems(loop.items.map((i) => ({ key: newKey(), creative: i.creativeId, seconds: i.seconds })));
  }, [loop, editable]);

  // A brand-new loop: focus its name so it can be typed straight away.
  useEffect(() => {
    if (params.get("new") && editable) {
      nameInput.current?.focus();
      nameInput.current?.select();
      const next = new URLSearchParams(params);
      next.delete("new");
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doSave = useCallback(async (): Promise<boolean> => {
    if (version.current === savedVersion.current) return true;
    const v = version.current;
    const { name: n, items: its } = latest.current;
    setSave({ state: "saving" });
    try {
      const saved = await update.mutateAsync({
        ...(n.trim() ? { name: n.trim() } : {}),
        items: its.map(({ creative, seconds }) => ({ creative, seconds })),
      });
      savedVersion.current = Math.max(savedVersion.current, v);
      qc.setQueryData(lk.loop(loop.id), saved);
      if (version.current === v) {
        // Take the server's tidy-up (videos always play for their own length).
        setItems((prev) => prev.map((it, i) => (saved.items[i]?.creativeId === it.creative ? { ...it, seconds: saved.items[i].seconds } : it)));
      }
      setSave({ state: version.current === v ? "saved" : "pending", at: new Date().toISOString() });
      return true;
    } catch (e) {
      setSave({ state: "error", error: (e as Error).message });
      return false;
    }
  }, [update, qc, loop.id]);

  const runSave = useCallback(async (): Promise<boolean> => {
    while (inflight.current) await inflight.current;
    if (version.current === savedVersion.current) return true;
    const p = doSave();
    inflight.current = p;
    const ok = await p;
    inflight.current = null;
    return ok;
  }, [doSave]);

  const touch = () => {
    version.current++;
    setSave({ state: "pending" });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void runSave(), 700);
  };

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const ok = await runSave();
    return ok && version.current === savedVersion.current;
  }, [runSave]);

  // Don't lose edits on the way out.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (version.current !== savedVersion.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.clearTimeout(timer.current);
      if (version.current !== savedVersion.current) void doSave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const change = (next: EditItem[]) => {
    setItems(next);
    touch();
  };

  // What each item shows: the library (for new additions) plus the loop's own items.
  const info = useMemo(() => {
    const m = new Map<string, Omit<EditRow, "key" | "seconds"> & { fileKey: string; fileUrl: string | null }>();
    for (const c of library.data ?? []) {
      for (const cid of c.copyIds) {
        m.set(cid, {
          creativeId: cid, name: c.name, advertiser: c.advertiser, mediaType: c.mediaType, durationS: c.durationS, width: c.width, height: c.height, thumbUrl: c.thumbUrl,
          missing: false, archived: c.archived, screenShape: c.screenShape, fileKey: c.fileKey, fileUrl: c.fileUrl,
        });
      }
    }
    for (const it of loop.items) {
      const known = m.get(it.creativeId);
      if (!known || it.missing) m.set(it.creativeId, { ...it, fileUrl: null });
      else if (it.thumbUrl) known.thumbUrl = it.thumbUrl;
    }
    return m;
  }, [library.data, loop.items]);

  const rows = items.map((it) => {
    const i = info.get(it.creative);
    return {
      key: it.key,
      seconds: it.seconds,
      creativeId: it.creative,
      name: i?.name ?? (library.isLoading ? "Loading…" : "Ad no longer in the library"),
      advertiser: i?.advertiser ?? "",
      mediaType: i?.mediaType ?? null,
      durationS: i?.durationS ?? null,
      width: i?.width ?? null,
      height: i?.height ?? null,
      thumbUrl: i?.thumbUrl ?? null,
      missing: i ? i.missing : !library.isLoading,
      archived: i?.archived ?? false,
      screenShape: i?.screenShape ?? null,
      fileKey: i?.fileKey ?? `id:${it.creative}`,
      fileUrl: i?.fileUrl ?? null,
    };
  });

  const total = loopTotalSeconds(rows);
  const cycles = total ? Math.floor(3600 / total) : 0;
  const perHour = loopPlaysPerHour(rows);
  const repeats = [...perHour.entries()].filter(([, n]) => n > cycles).map(([k, n]) => ({ name: rows.find((r) => r.fileKey === k)!.name, n }));
  const nameClash = useMemo(() => {
    if (loop.programId || !name.trim()) return null;
    const n = name.trim().toLowerCase();
    return (loops.data ?? []).find((l) => l.id !== loop.id && l.programName && l.programName.trim().toLowerCase() === n)?.name ?? null;
  }, [loops.data, name, loop.id, loop.programId]);

  const onRemove = (index: number) => {
    const removed = items[index];
    const label = rows[index]?.name ?? "the ad";
    const next = items.filter((_, i) => i !== index);
    change(next);
    toast(
      <span>
        Removed "{label}".{" "}
        <button
          type="button"
          className="font-semibold underline"
          onClick={() => {
            setItems((cur) => {
              const copy = cur.slice();
              copy.splice(Math.min(index, copy.length), 0, removed);
              return copy;
            });
            touch();
          }}
        >
          Undo
        </button>
      </span>,
      "info",
    );
  };

  const onAdd = (picked: LibraryCreative[]) => {
    const added = picked.map((c) => ({ key: newKey(), creative: c.id, seconds: c.mediaType === "video" && c.durationS ? Math.round(c.durationS * 10) / 10 : 10 }));
    change([...items, ...added]);
    toast(picked.length === 1 ? `Added "${picked[0].name}"` : `Added ${picked.length} ads`);
  };

  const duplicate = async () => {
    try {
      if (editable && !(await flush())) return;
      const copy = await createLoop.mutateAsync({ from: loop.id });
      nav(`/loops/${copy.id}?new=1`);
      toast(`Made a draft copy of "${loop.name}"`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const remove = async () => {
    const ok = await confirm({ title: `Delete "${name || loop.name}"?`, body: "It's a draft and isn't on any bag.", confirm: "Delete draft", danger: true });
    if (!ok) return;
    try {
      window.clearTimeout(timer.current);
      savedVersion.current = version.current;
      const r = await del.mutateAsync(loop.id);
      toast(r.archived ? "Archived the draft — it was tried on a bag, so its record is kept" : "Deleted the draft");
      nav("/loops?tab=loops");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const saveText =
    save.state === "pending" || save.state === "saving"
      ? "Saving…"
      : save.state === "saved"
        ? `Saved ${time(save.at)}`
        : save.state === "error"
          ? null
          : `Saved ${when(loop.updatedAt)}`;

  return (
    <Page>
      <header className="flex flex-col gap-3">
        <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
          <Link to="/loops" className="text-accent no-underline hover:underline">
            Ads &amp; loops
          </Link>
          <span className="mx-1.5 text-caption">/</span>
          <Link to="/loops?tab=loops" className="text-accent no-underline hover:underline">
            Loops
          </Link>
        </nav>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            {editable ? (
              <h1 className="m-0 min-w-0">
                <label htmlFor="loop-name" className="sr-only">
                  Loop name
                </label>
                <input
                  id="loop-name"
                  ref={nameInput}
                  value={name}
                  maxLength={120}
                  onChange={(e) => {
                    setName(e.target.value);
                    touch();
                  }}
                  onBlur={() => {
                    if (!name.trim()) setName(loop.name);
                  }}
                  className="-ml-1 w-full min-w-0 rounded-lg border border-transparent bg-transparent px-1 font-display text-[28px] leading-tight font-semibold tracking-[-0.02em] outline-none hover:border-line focus:border-navy focus:bg-white md:text-[32px]"
                />
              </h1>
            ) : (
              <h1 className="m-0 font-display text-[28px] leading-tight font-semibold tracking-[-0.02em] [overflow-wrap:anywhere] md:text-[32px]">{loop.name}</h1>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              {loop.isFleetLoop && <FleetPill />}
              <LoopStatusPill status={loop.status} onBags={loop.bagsPlaying.length} />
              {loop.status !== "draft" && <AgePill ageDays={loop.ageDays} fleet={loop.isFleetLoop} />}
            </div>
            <p className="m-0 text-[13px] text-muted">
              {total ? `Loop length ${secs(total)} · ${plural(rows.length, "ad")}` : "No ads yet"}
              {loop.status === "imported" && loop.publishedAt && ` · made in Colorlight ${date(loop.publishedAt)}`}
              {loop.status === "published" && loop.publishedAt && ` · sent ${date(loop.publishedAt)}`}
              {editable && saveText && (
                <span role="status" aria-live="polite">
                  {" "}
                  · {saveText}
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {can("loops.edit") && (
              <Button onClick={() => void duplicate()} loading={createLoop.isPending} icon={<Copy className="size-4" />}>
                Duplicate as a draft
              </Button>
            )}
            {editable && loop.status === "draft" && (
              <Button variant="danger" onClick={() => void remove()} loading={del.isPending} icon={<Trash2 className="size-4" />}>
                Delete draft
              </Button>
            )}
          </div>
        </div>
      </header>

      {save.state === "error" && (
        <Notice
          tone="red"
          action={
            <button type="button" className="font-semibold underline" onClick={() => void runSave()}>
              Try again
            </button>
          }
        >
          Couldn't save: {save.error}
        </Notice>
      )}
      {loop.readOnly && loop.readOnlyReason && <Notice tone="info">{loop.readOnlyReason}</Notice>}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="flex flex-col gap-3 p-4">
            <CardHeader
              title="Play order"
              sub={editable ? "Drag the handle to reorder, or use the arrows." : undefined}
              action={<span className="text-xs text-muted">{plural(rows.length, "ad")}</span>}
            />
            {rows.length ? (
              <ItemsList
                rows={rows}
                readOnly={!editable}
                onMove={(from, to) => change(moveLoopItem(items, from, to))}
                onRemove={onRemove}
                onSeconds={(i, s) => change(items.map((it, j) => (j === i ? { ...it, seconds: s } : it)))}
              />
            ) : (
              <p className="m-0 rounded-xl border border-dashed border-line bg-paper px-4 py-6 text-center text-sm text-muted">
                No ads in this loop yet.
              </p>
            )}
            {editable && (
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="flex h-11 items-center justify-center gap-2 rounded-xl border-[1.5px] border-dashed border-line bg-[#fbfaf6] text-[13px] font-semibold text-ink-2 hover:border-navy hover:text-ink"
              >
                <Plus className="size-4" aria-hidden="true" />
                Add ads from the library
              </button>
            )}
            {total > 0 && (
              <div className="flex flex-col gap-2 border-t border-rule-soft pt-3">
                <Timeline rows={rows} total={total} />
                <p className="m-0 text-[13px] text-ink-2">
                  Loop length <strong>{secs(total)}</strong> · plays through <strong>{cycles}</strong> times an hour of screen time, so each ad shows about{" "}
                  {cycles} times an hour.
                  {repeats.map((r) => (
                    <span key={r.name}>
                      {" "}
                      "{r.name}" is in more than once, so it shows about {r.n} times an hour.
                    </span>
                  ))}
                </p>
              </div>
            )}
          </Card>
          <ChangesCard
            items={rows.map((r) => ({ fileKey: r.fileKey, seconds: r.seconds, name: r.name, thumbUrl: r.thumbUrl, width: r.width, height: r.height }))}
            fleetLoop={loop.fleetLoop}
            isFleetLoop={loop.isFleetLoop}
            fleetLoopName={loop.publish.fleetLoopName}
          />
          <div className="hidden lg:block">
            <DeliveryCard loop={loop} />
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card className="flex flex-col gap-3 p-4">
            <CardHeader title="On the bag" sub="Preview at 160 × 120" />
            <LoopPreview items={rows.map((r) => ({ key: r.key, name: r.name, thumbUrl: r.thumbUrl, fileUrl: r.fileUrl, seconds: r.seconds }))} />
          </Card>
          {loop.status !== "archived" && (
            <PublishPanel loop={loop} itemsCount={rows.length} nameClash={nameClash} flush={editable ? flush : async () => true} />
          )}
          <div className="lg:hidden">
            <DeliveryCard loop={loop} />
          </div>
        </div>
      </div>

      <LibraryPicker open={picking} onClose={() => setPicking(false)} inLoop={new Set(rows.map((r) => r.fileKey))} onAdd={onAdd} />
    </Page>
  );
}

function Timeline({ rows, total }: { rows: { key: string; seconds: number; name: string }[]; total: number }) {
  return (
    <div className="flex flex-col gap-1" aria-hidden="true">
      <div className="flex h-[22px] gap-[2px] overflow-hidden rounded-md">
        {rows.map((r, i) => (
          <span
            key={r.key}
            title={`${i + 1}. ${r.name} · ${secs(r.seconds)}`}
            style={{ flexGrow: r.seconds, flexBasis: 0 }}
            className={`num flex min-w-[3px] items-center justify-center overflow-hidden text-[10px] font-bold text-white ${i % 2 ? "bg-[#3a5ba8]" : "bg-navy"}`}
          >
            {r.seconds / total > 0.04 ? i + 1 : ""}
          </span>
        ))}
      </div>
      <div className="num flex justify-between text-[11px] text-caption">
        <span>0 s</span>
        <span>{secs(total / 2)}</span>
        <span>{secs(total)}</span>
      </div>
    </div>
  );
}

// Zones: a big map of every zone with the time bags spent in each, and an
// editor to add, reshape, rename or delete zones. Time in zones feeds client
// reports and time-in-zone exports, so every saved shape recomputes the last
// 14 days.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useBlocker, useSearchParams } from "react-router";
import type { Map as MLMap } from "maplibre-gl";
import { Circle, Download, MousePointerClick, Pentagon, Undo2 } from "lucide-react";
import { addDays, daysBetween, todayLondon, validateZoneName, validateZoneShape, ZONE_STATS_MAX_DAYS, type ZoneType } from "@digilite/shared";
import { LONDON } from "@/components/map/MapView";
import { useFeedback } from "@/components/feedback";
import { buttonClass, Card, ErrorState, Notice, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useZones } from "@/lib/queries";
import { useCreateZone, useDeleteZone, useUpdateZone, useZoneHeat, useZonePreview, useZoneStats } from "./api";
import { draftFromZone, drawRing, isDirty, newDraft, shapeKey, shapeOfZone, switchKind, toShapeInput, type Draft, type ShapeState } from "./draft";
import { PeriodPicker, usePeriod, type PeriodPreset } from "./PeriodPicker";
import { ZoneEditor } from "./ZoneEditor";
import { ZoneList, zoneHours } from "./ZoneList";
import { ZonesMap } from "./ZonesMap";

const PRESETS: PeriodPreset[] = [
  {
    key: "night",
    label: "Last night",
    range: () => {
      const y = addDays(todayLondon(), -1);
      return { from: y, to: y };
    },
  },
  {
    key: "7d",
    label: "Last 7 days",
    range: () => {
      const y = addDays(todayLondon(), -1);
      return { from: addDays(y, -6), to: y };
    },
  },
];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  const key = JSON.stringify(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ms]);
  return v;
}

const pickShape = (d: ShapeState): ShapeState => ({ kind: d.kind, center: d.center, radiusM: d.radiusM, ring: d.ring });

/** On phones and tablets the map sits above the panel: bring it back into view. */
function showMapOnSmallScreens() {
  if (window.innerWidth >= 1024) return;
  document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
}

export default function ZonesPage() {
  const { can } = useAuth();
  const canEdit = can("zones.edit");
  const { toast, confirm } = useFeedback();
  const [params, setParams] = useSearchParams();
  const [period, setPeriod] = usePeriod(PRESETS);
  const zones = useZones();
  const stats = useZoneStats(period.from!, period.to!);
  const [showHeat, setShowHeat] = useState(true);
  const heat = useZoneHeat(showHeat);
  const create = useCreateZone();
  const update = useUpdateZone();
  const del = useDeleteZone();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [history, setHistory] = useState<ShapeState[]>([]);
  const [vertex, setVertex] = useState<number | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [map, setMap] = useState<MLMap | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const historyRef = useRef(history);
  historyRef.current = history;
  const lastRadiusPush = useRef(0);

  const zoneParam = params.get("zone");
  const list = useMemo(() => zones.data ?? [], [zones.data]);
  const original = draft?.id ? list.find((z) => z.id === draft.id) ?? null : null;
  const dirty = draft ? (draft.id ? !!original && isDirty(draft, original) : draft.name.trim() !== "" || history.length > 0) : false;
  const shapeInput = draft ? toShapeInput(draft) : null;
  const shapeCheck = shapeInput ? validateZoneShape(shapeInput) : null;
  const shapeChanged = !!(draft && original && shapeKey(draft) !== shapeKey(shapeOfZone(original)));

  // ── Selection follows ?zone= ─────────────────────────────────────────────────
  const setZoneParam = useCallback(
    (id: string | null) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set("zone", id);
          else next.delete("zone");
          return next;
        },
        { replace: false },
      );
    },
    [setParams],
  );

  const resetEditing = () => {
    setHistory([]);
    setVertex(null);
    setNameError(null);
  };

  useEffect(() => {
    if (!zones.data) return;
    const cur = draftRef.current;
    if (!zoneParam) {
      if (cur) setDraft(null);
      return;
    }
    if (zoneParam === "new") {
      // A reload of ?zone=new has nothing to show. (Just after saving, the draft
      // already has its id while the URL catches up, so leave that alone.)
      if (!cur) setZoneParam(null);
      return;
    }
    if (cur?.id === zoneParam) return;
    const z = zones.data.find((x) => x.id === zoneParam);
    if (!z) {
      setZoneParam(null);
      return;
    }
    setDraft(draftFromZone(z));
    resetEditing();
  }, [zoneParam, zones.data, setZoneParam]);

  const discardOk = useCallback(async () => {
    if (!dirty) return true;
    return confirm({
      title: "Discard your changes?",
      body: `Your changes to ${original?.name ?? "the new zone"} haven't been saved.`,
      confirm: "Discard changes",
      danger: true,
    });
  }, [dirty, original, confirm]);

  const selectZone = useCallback(
    async (id: string) => {
      if (id === draftRef.current?.id) return;
      if (!(await discardOk())) return;
      setDraft(null);
      setZoneParam(id);
      showMapOnSmallScreens();
    },
    [discardOk, setZoneParam],
  );

  const close = () => {
    setDraft(null);
    resetEditing();
    setZoneParam(null);
  };

  const addZone = async (kind: "circle" | "polygon") => {
    if (!(await discardOk())) return;
    const c = map?.getCenter();
    const d = newDraft(kind, c ? [c.lng, c.lat] : LONDON);
    if (kind === "circle" && map) {
      // Size the new circle to about a fifth of the visible map.
      const b = map.getBounds();
      const widthM = (b.getEast() - b.getWest()) * 111320 * Math.cos((d.center[1] * Math.PI) / 180);
      d.radiusM = Math.min(1500, Math.max(150, Math.round(widthM / 100) * 10));
    }
    setDraft(d);
    resetEditing();
    setZoneParam("new");
    showMapOnSmallScreens();
  };

  // Warn before leaving the page with unsaved changes.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    void discardOk().then((ok) => (ok ? blocker.proceed() : blocker.reset()));
  }, [blocker, discardOk]);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // ── Shape changes & undo ─────────────────────────────────────────────────────
  const beginChange = useCallback(() => {
    const d = draftRef.current;
    if (d) setHistory((h) => [...h.slice(-49), pickShape(d)]);
  }, []);
  const onShape = useCallback((next: ShapeState) => setDraft((d) => (d ? { ...d, ...pickShape(next) } : d)), []);
  const undo = useCallback(() => {
    const h = historyRef.current;
    const prev = h[h.length - 1];
    if (!prev) return;
    setHistory(h.slice(0, -1));
    setDraft((d) => (d ? { ...d, ...prev } : d));
    setVertex(null);
  }, []);
  const removeVertex = useCallback(
    (i: number) => {
      const d = draftRef.current;
      if (!d || d.kind !== "polygon") return;
      if (d.ring.length <= 3) {
        toast("An outline needs at least 3 points", "info");
        return;
      }
      beginChange();
      setDraft({ ...d, ring: d.ring.filter((_, j) => j !== i) });
      setVertex(null);
    },
    [beginChange, toast],
  );

  useEffect(() => {
    if (!draft || !canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, canEdit, undo]);

  // ── Preview of the shape being edited ────────────────────────────────────────
  const previewReq = canEdit && draft && shapeCheck?.ok && shapeInput ? { zoneId: draft.id, shape: shapeInput } : null;
  const preview = useZonePreview(useDebounced(previewReq, 350));
  const pv = previewReq ? preview.data : undefined;

  // ── Save / delete ────────────────────────────────────────────────────────────
  const save = async () => {
    if (!draft || !shapeInput) return;
    const err = validateZoneName(draft.name);
    setNameError(err);
    if (err) return;
    if (shapeCheck && !shapeCheck.ok) {
      toast(shapeCheck.error, "error");
      return;
    }
    const body = { name: draft.name.trim(), type: draft.type, active: draft.active, ...shapeInput };
    try {
      const recomputes = !original || shapeChanged || draft.active !== original.active;
      const saved = draft.id ? await update.mutateAsync({ id: draft.id, patch: body }) : await create.mutateAsync(body);
      setDraft(draftFromZone(saved));
      resetEditing();
      setZoneParam(saved.id);
      toast(
        recomputes
          ? `${original ? "Saved" : "Added"} ${saved.name}. Zone time for the last 14 days is being worked out again.`
          : `Saved ${saved.name}.`,
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save the zone", "error");
    }
  };

  const remove = async () => {
    if (!original) return;
    const ok = await confirm({
      title: `Delete ${original.name}?`,
      body: "Its time is taken out of the last 14 days of zone stats, reports and exports. Older days keep it, listed as “Removed zone”. This can't be undone.",
      confirm: "Delete zone",
      danger: true,
    });
    if (!ok) return;
    try {
      await del.mutateAsync(original.id);
      toast(`Deleted ${original.name}`);
      close();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't delete the zone", "error");
    }
  };

  // ── Map inputs ───────────────────────────────────────────────────────────────
  const statsById = useMemo(() => new Map((stats.data?.zones ?? []).map((s) => [s.zoneId, s])), [stats.data]);
  const labels = useMemo(
    () => new Map(list.map((z) => [z.id, statsById.has(z.id) ? `${z.name}\n${zoneHours(statsById.get(z.id)!.seconds)}` : z.name])),
    [list, statsById],
  );
  const draftLabel = draft
    ? [
        draft.name.trim() || "New zone",
        canEdit && pv
          ? `${zoneHours(pv.shape.seconds)} in ${pv.days} days${original && shapeChanged && pv.current ? ` · was ${zoneHours(pv.current.seconds)}` : ""}`
          : original && statsById.get(original.id)
            ? zoneHours(statsById.get(original.id)!.seconds)
            : "",
      ]
        .filter(Boolean)
        .join("\n")
    : null;
  const saved = useMemo(() => (original && shapeChanged ? shapeOfZone(original) : null), [original, shapeChanged]);
  const originalId = original?.id;
  const fitTo = useMemo(
    () => (original ? { key: original.id, ring: drawRing(shapeOfZone(original)) } : null),
    // Refit only when a different zone is picked, not while it's being reshaped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [originalId],
  );

  const editing = canEdit && !!draft;
  const recompute = stats.data?.recompute;
  const title = draft ? original?.name ?? "the new zone" : "";
  const done = recompute ? recompute.total - recompute.remaining : 0;
  const recomputeDays = recompute ? daysBetween(recompute.fromDay, recompute.toDay).length : 0;
  const recomputeSpan = recomputeDays <= 1 ? "today" : `the last ${recomputeDays} days`;

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 py-5 md:px-8 md:py-6 lg:h-full lg:min-h-0">
      <PageHeader
        title="Zones"
        sub={`${list.length} ${list.length === 1 ? "zone" : "zones"} · time in zones is used in client reports and time-in-zone exports`}
        actions={
          <>
            <PeriodPicker presets={PRESETS} value={period} onChange={setPeriod} maxDays={ZONE_STATS_MAX_DAYS} label="Period" />
            {can("exports.run") && period.from && period.to && (
              <Link
                to={`/exports?type=zones&when=custom&from=${period.from}&to=${period.to}`}
                className={buttonClass("secondary", "md", "self-start")}
              >
                <Download className="size-4" aria-hidden />
                Export time in zones
              </Link>
            )}
          </>
        }
      />

      {recompute && recompute.remaining > 0 && (
        <Notice tone="info">
          <div className="flex flex-col gap-1.5">
            <span>
              Working out zone time again for {recomputeSpan} · {done.toLocaleString("en-GB")} of {recompute.total.toLocaleString("en-GB")} bag-days done.
              The numbers update as it goes.
            </span>
            <span className="block h-1 overflow-hidden rounded-full bg-white/70" aria-hidden>
              <span className="block h-full rounded-full bg-navy transition-all" style={{ width: `${(done / Math.max(1, recompute.total)) * 100}%` }} />
            </span>
          </div>
        </Notice>
      )}
      {zones.error && <ErrorState error={zones.error} retry={() => void zones.refetch()} />}
      {stats.error && <ErrorState error={stats.error} retry={() => void stats.refetch()} />}

      <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row">
        <ZonesMap
          className="h-[380px] shrink-0 rounded-2xl border border-rule bg-paper-3 md:h-[500px] lg:h-auto lg:min-h-[460px] lg:min-w-0 lg:flex-1"
          zones={list}
          labels={labels}
          draft={draft}
          draftLabel={draftLabel}
          saved={saved}
          editable={editing}
          selectedVertex={vertex}
          heat={heat.data ?? null}
          showHeat={showHeat}
          fitTo={fitTo}
          onReady={setMap}
          onSelectZone={(id) => void selectZone(id)}
          onBeginChange={beginChange}
          onShape={onShape}
          onSelectVertex={setVertex}
          onRemoveVertex={removeVertex}
        >
          {/* What you can do right now */}
          <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex md:inset-x-auto md:top-4 md:left-4">
            <div className="pointer-events-auto flex max-w-full items-center gap-2.5 rounded-xl border border-rule bg-white/95 py-2 pr-2 pl-3 shadow-[var(--shadow-float)] backdrop-blur md:max-w-[520px]">
              {editing && draft ? (
                <>
                  {draft.kind === "circle" ? <Circle className="size-4 shrink-0 text-accent" aria-hidden /> : <Pentagon className="size-4 shrink-0 text-accent" aria-hidden />}
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-bold">{original ? `Reshaping ${title}` : "Drawing a new zone"}</span>
                    <span className="text-xs text-muted">
                      {draft.kind === "circle" ? (
                        <>
                          <span className="sm:hidden">Drag the centre or the edge dot</span>
                          <span className="hidden sm:inline">Drag the centre to move it · drag the edge dot to resize</span>
                        </>
                      ) : draft.ring.length < 3 ? (
                        `Tap or click the map to add points · ${3 - draft.ring.length} more needed`
                      ) : (
                        <>
                          <span className="sm:hidden">Tap to add a point · drag one to move it</span>
                          <span className="hidden sm:inline">Click the map to add a point · drag a point to move it</span>
                        </>
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label="Undo"
                    title="Undo"
                    disabled={!history.length}
                    onClick={undo}
                    className="ml-1 flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-white text-ink disabled:opacity-40"
                  >
                    <Undo2 className="size-4" />
                  </button>
                </>
              ) : (
                <>
                  <MousePointerClick className="size-4 shrink-0 text-accent" aria-hidden />
                  <span className="text-[13px] text-ink-2">{canEdit ? "Pick a zone to see or change it, or add one" : "Pick a zone to see its details"}</span>
                </>
              )}
            </div>
          </div>
          {/* Legend */}
          <div className="absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-5rem)] flex-wrap items-center gap-x-3.5 gap-y-1 rounded-[10px] border border-rule bg-white/95 px-3 py-2 text-xs text-ink-2 shadow-sm">
            <span className="hidden items-center gap-1.5 sm:flex">
              <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden>
                <circle cx="9" cy="6" r="5" fill="#3E6FD8" fillOpacity="0.12" stroke="#061B47" strokeWidth="1.4" strokeDasharray="3 2" />
              </svg>
              Zone
            </span>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input type="checkbox" checked={showHeat} onChange={(e) => setShowHeat(e.target.checked)} className="size-4 accent-[var(--color-navy)]" />
              <span
                className="inline-block h-2.5 w-6 shrink-0 rounded-full"
                style={{ background: "linear-gradient(90deg, rgba(62,111,216,.15), rgba(4,61,174,.55), rgba(6,27,71,.75))" }}
                aria-hidden
              />
              <span>
                Where bags spent time<span className="hidden sm:inline">, last 14 days</span>
              </span>
            </label>
          </div>
        </ZonesMap>

        <aside className="flex min-w-0 flex-col gap-4 lg:w-[360px] lg:shrink-0 lg:overflow-y-auto lg:pb-2 xl:w-[400px]">
          {draft && (
            <ZoneEditor
              draft={draft}
              original={original}
              canEdit={canEdit}
              dirty={dirty}
              stat={original ? statsById.get(original.id) : undefined}
              periodLabel={period.label}
              preview={pv}
              previewLoading={preview.isFetching}
              previewError={previewReq && preview.error ? (preview.error as Error).message : null}
              shapeError={shapeCheck && !shapeCheck.ok ? shapeCheck.error : null}
              shapeChanged={shapeChanged}
              nameError={nameError}
              canUndo={history.length > 0}
              selectedVertex={vertex}
              saving={create.isPending || update.isPending}
              deleting={del.isPending}
              onName={(v) => {
                setNameError(null);
                setDraft((d) => (d ? { ...d, name: v } : d));
              }}
              onType={(t: ZoneType) => setDraft((d) => (d ? { ...d, type: t } : d))}
              onActive={(v) => setDraft((d) => (d ? { ...d, active: v } : d))}
              onKind={(k) => {
                const d = draftRef.current;
                if (!d || d.kind === k) return;
                beginChange();
                setDraft({ ...d, ...switchKind(d, k) });
                setVertex(null);
              }}
              onRadiusStart={() => {
                if (Date.now() - lastRadiusPush.current > 800) beginChange();
                lastRadiusPush.current = Date.now();
              }}
              onRadius={(m) => setDraft((d) => (d ? { ...d, radiusM: m } : d))}
              onUndo={undo}
              onRemoveVertex={() => vertex != null && removeVertex(vertex)}
              onSave={() => void save()}
              onCancel={close}
              onDelete={() => void remove()}
            />
          )}
          <ZoneList
            zones={list}
            stats={stats.data}
            loading={stats.isLoading || zones.isLoading}
            selectedId={draft?.id ?? null}
            periodLabel={period.label}
            onSelect={(id) => void selectZone(id)}
          />
          {canEdit ? (
            <Card className="flex flex-col gap-3 p-4 md:p-5" aria-label="Add a zone">
              <h2 className="m-0 font-display text-lg font-semibold">Add a zone</h2>
              <div className="grid grid-cols-2 gap-2">
                {(["circle", "polygon"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => void addZone(k)}
                    className="flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-[11px] border border-line bg-white px-2 text-[13px] font-semibold hover:bg-paper"
                  >
                    {k === "circle" ? <Circle className="size-5 text-accent" aria-hidden /> : <Pentagon className="size-5 text-accent" aria-hidden />}
                    {k === "circle" ? "Circle" : "Outline"}
                  </button>
                ))}
              </div>
              <p className="m-0 text-xs text-muted">A circle starts in the middle of the map, ready to drag into place. For an outline, click around the area on the map.</p>
            </Card>
          ) : (
            <p className="m-0 px-1 text-xs text-muted">Only Owner and Operations can add or change zones.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

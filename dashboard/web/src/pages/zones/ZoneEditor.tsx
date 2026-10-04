// The selected zone: its details, and for people who can edit zones, the
// name, type and shape controls with live "what would this shape record"
// numbers from the last 14 days.

import clsx from "clsx";
import { Circle, Info, Pentagon, Undo2, X } from "lucide-react";
import {
  describeArea,
  describeZoneShape,
  ZONE_RADIUS_MAX,
  ZONE_RADIUS_MIN,
  ZONE_TYPE_LABEL,
  ZONE_TYPES,
  zoneAreaM2,
  type ZoneDto,
  type ZonePreviewResponse,
  type ZoneStat,
  type ZoneType,
} from "@digilite/shared";
import { Button, Card, Field, Input, Notice, Pill, Switch } from "@/components/ui";
import { zoneHours } from "./ZoneList";
import { toShapeInput, type Draft } from "./draft";

export interface ZoneEditorProps {
  draft: Draft;
  original: ZoneDto | null;
  canEdit: boolean;
  dirty: boolean;
  stat: ZoneStat | undefined;
  periodLabel: string;
  preview: ZonePreviewResponse | undefined;
  previewLoading: boolean;
  previewError: string | null;
  shapeError: string | null;
  shapeChanged: boolean;
  nameError: string | null;
  canUndo: boolean;
  selectedVertex: number | null;
  saving: boolean;
  deleting: boolean;
  onName: (v: string) => void;
  onType: (v: ZoneType) => void;
  onActive: (v: boolean) => void;
  onKind: (k: "circle" | "polygon") => void;
  onRadiusStart: () => void;
  onRadius: (m: number) => void;
  onUndo: () => void;
  onRemoveVertex: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

function Delta({ now, next }: { now: number; next: number }) {
  const d = next - now;
  if (Math.abs(d) < 180) return <Pill>about the same</Pill>;
  return <Pill tone={d > 0 ? "green" : "amber"}>{`${d > 0 ? "+" : "−"}${zoneHours(Math.abs(d))}`}</Pill>;
}

function PreviewBox(p: ZoneEditorProps) {
  const { preview, original, shapeChanged } = p;
  if (p.shapeError) {
    return (
      <Notice tone="amber" icon={<Info className="size-4" />}>
        {p.shapeError}
      </Notice>
    );
  }
  if (p.previewError) return <Notice tone="red">{p.previewError}</Notice>;
  if (!preview) {
    return (
      <div className="rounded-[10px] bg-paper px-3 py-2.5 text-[13px] text-muted" role="status">
        Working out the last 14 days for this shape…
      </div>
    );
  }
  const window = preview.days === 14 ? "Last 14 days" : `Last ${preview.days} days`;
  const label = !original ? `${window} with this shape` : shapeChanged ? `${window} with the new shape` : window;
  return (
    <div className={clsx("flex flex-col gap-1 rounded-[10px] bg-paper px-3 py-2.5", p.previewLoading && "opacity-70")} aria-live="polite">
      <span className="text-xs text-muted">{label}</span>
      <span className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
        <strong className="num font-display text-lg font-semibold">{zoneHours(preview.shape.seconds)}</strong>
        <span>
          · {preview.shape.bags} {preview.shape.bags === 1 ? "bag" : "bags"}
        </span>
        {original && shapeChanged && preview.current && <Delta now={preview.current.seconds} next={preview.shape.seconds} />}
      </span>
      {original && shapeChanged && preview.current && (
        <span className="text-xs text-muted">
          Now {zoneHours(preview.current.seconds)} · {preview.current.bags} {preview.current.bags === 1 ? "bag" : "bags"}
        </span>
      )}
      {preview.overlap.length > 0 && (
        <span className="text-xs text-amber-ink">
          Overlaps {preview.overlap.map((o) => `${o.name} (${zoneHours(o.seconds)})`).join(", ")}. Where zones overlap, time counts for the zone
          listed first.
        </span>
      )}
      {preview.capped && <span className="text-xs text-caption">Measured on a sample of {preview.bagDays} bag-days to stay quick.</span>}
    </div>
  );
}

export function ZoneEditor(p: ZoneEditorProps) {
  const { draft, original } = p;
  const shape = toShapeInput(draft);
  const area = zoneAreaM2(shape);
  const title = original ? original.name : "New zone";

  return (
    <Card className="flex flex-col gap-4 p-4 md:p-5" aria-label="Selected zone">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 truncate font-display text-lg font-semibold">{p.canEdit ? (original ? "Zone details" : "New zone") : title}</h2>
            {!original && <Pill tone="info">Not saved yet</Pill>}
            {original && !original.active && <Pill tone="amber">Not counted</Pill>}
            {p.dirty && original && <Pill tone="amber">Unsaved changes</Pill>}
          </div>
          {original && (
            <span className="text-xs text-muted">
              {p.periodLabel}: {p.stat ? `${zoneHours(p.stat.seconds)} · ${p.stat.bags} ${p.stat.bags === 1 ? "bag" : "bags"}` : "—"}
            </span>
          )}
        </div>
        <button type="button" onClick={p.onCancel} aria-label="Close" className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-paper-2 hover:text-ink">
          <X className="size-4" />
        </button>
      </div>

      {!p.canEdit ? (
        <div className="grid gap-3 text-[13px] sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">Type</span>
            <span className="font-semibold">{ZONE_TYPE_LABEL[draft.type]}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">Shape</span>
            <span className="font-semibold">
              {describeZoneShape(shape)} · {describeArea(area)}
            </span>
          </div>
          <p className="m-0 text-xs text-muted sm:col-span-2">Used in client reports and time-in-zone exports. Only Owner and Operations can change zones.</p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-1">
          <div className="flex min-w-0 flex-col gap-3.5">
            <Field label="Name" error={p.nameError}>
              <Input value={draft.name} maxLength={120} placeholder="e.g. Camden High Street" onChange={(e) => p.onName(e.target.value)} />
            </Field>
            <div className="flex flex-col gap-1.5">
              <span id="zone-type" className="text-[13px] font-semibold">
                Type
              </span>
              <div role="radiogroup" aria-labelledby="zone-type" className="grid grid-cols-2 gap-1 rounded-[10px] bg-paper-2 p-[3px]">
                {ZONE_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={draft.type === t}
                    onClick={() => p.onType(t)}
                    className={clsx(
                      "h-9 rounded-lg px-2 text-[13px] font-semibold whitespace-nowrap",
                      draft.type === t ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink",
                    )}
                  >
                    {ZONE_TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span id="zone-shape" className="text-[13px] font-semibold">
                Shape
              </span>
              <div role="radiogroup" aria-labelledby="zone-shape" className="flex gap-2">
                {(["circle", "polygon"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={draft.kind === k}
                    onClick={() => p.onKind(k)}
                    className={clsx(
                      "flex h-10 flex-1 items-center justify-center gap-2 rounded-[10px] border text-[13px] font-semibold",
                      draft.kind === k ? "border-accent bg-tint-2 text-accent" : "border-line bg-white text-ink-2 hover:bg-paper",
                    )}
                  >
                    {k === "circle" ? <Circle className="size-4" aria-hidden /> : <Pentagon className="size-4" aria-hidden />}
                    {k === "circle" ? "Circle" : "Outline"}
                  </button>
                ))}
              </div>
              {draft.kind === "circle" ? (
                <label className="mt-1 flex flex-col gap-1 text-[13px]">
                  <span className="flex items-baseline justify-between">
                    <span className="font-semibold">Radius</span>
                    <span className="num text-ink-2">
                      {Math.round(draft.radiusM).toLocaleString("en-GB")} m · {describeArea(area)}
                    </span>
                  </span>
                  <input
                    type="range"
                    min={ZONE_RADIUS_MIN}
                    max={ZONE_RADIUS_MAX}
                    step={10}
                    value={Math.round(draft.radiusM)}
                    onPointerDown={p.onRadiusStart}
                    onKeyDown={p.onRadiusStart}
                    onChange={(e) => p.onRadius(Number(e.target.value))}
                    className="h-6 w-full accent-[var(--color-navy)]"
                    aria-label="Radius in metres"
                  />
                  <span className="text-xs text-muted">Drag the centre on the map to move it, or the edge dot to resize.</span>
                </label>
              ) : (
                <div className="mt-1 flex flex-col gap-2 text-[13px]">
                  <span className="text-ink-2">
                    {draft.ring.length} {draft.ring.length === 1 ? "point" : "points"}
                    {draft.ring.length >= 3 && ` · ${describeArea(area)}`}
                  </span>
                  <span className="text-xs text-muted">
                    {draft.ring.length < 3
                      ? `Click the map to add points (${3 - draft.ring.length} more needed).`
                      : "Click the map to add a point. Drag a point to move it; select one to remove it."}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={p.onUndo} disabled={!p.canUndo} icon={<Undo2 className="size-3.5" />}>
                      Undo
                    </Button>
                    <Button size="sm" variant="secondary" onClick={p.onRemoveVertex} disabled={p.selectedVertex == null || draft.ring.length <= 3}>
                      Remove point{p.selectedVertex != null ? ` ${p.selectedVertex + 1}` : ""}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <PreviewBox {...p} />
            {original && (
              <div className="flex flex-col gap-1">
                <Switch checked={draft.active} onChange={p.onActive} label="Count time in this zone" />
                {!draft.active && <span className="pl-14 text-xs text-muted">Switched off: no time is recorded here and it's left out of stats and reports.</span>}
              </div>
            )}
            <Notice tone="info" icon={<Info className="size-4" />}>
              Used in client reports and time-in-zone exports. Saving a new shape works out zone time again for the last 14 days.
            </Notice>
            <div className="mt-auto flex flex-col gap-2 pt-1">
              <div className="flex gap-2">
                <Button className="flex-1" onClick={p.onCancel} disabled={p.saving}>
                  Cancel
                </Button>
                <Button
                  className="flex-[1.4]"
                  variant="primary"
                  onClick={p.onSave}
                  loading={p.saving}
                  disabled={!p.dirty || !!p.shapeError || p.deleting}
                >
                  {original ? "Save zone" : "Add zone"}
                </Button>
              </div>
              {original && (
                <button
                  type="button"
                  onClick={p.onDelete}
                  disabled={p.deleting || p.saving}
                  className="self-start py-1 text-[13px] font-semibold text-red-ink hover:underline disabled:opacity-50"
                >
                  {p.deleting ? "Deleting…" : "Delete zone"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

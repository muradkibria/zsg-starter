// The loop's play order. Reorder by dragging the handle (mouse or touch), by the
// up/down buttons, or with the arrow keys on the handle; every move is announced.

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import clsx from "clsx";
import { ChevronDown, ChevronUp, GripVertical, Lock, Minus, Plus, TriangleAlert, X } from "lucide-react";
import { loopSlotTimes } from "@digilite/shared";
import { secs, Thumb } from "../bits";

export interface EditRow {
  key: string;
  creativeId: string;
  seconds: number;
  name: string;
  advertiser: string;
  mediaType: "video" | "image" | null;
  durationS: number | null;
  width: number | null;
  height: number | null;
  thumbUrl: string | null;
  missing: boolean;
  archived: boolean;
  screenShape: boolean | null;
}

const GAP = 8;

export function ItemsList({
  rows,
  readOnly,
  onMove,
  onRemove,
  onSeconds,
}: {
  rows: EditRow[];
  readOnly: boolean;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  onSeconds: (index: number, seconds: number) => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  const rects = useRef<DOMRect[]>([]);
  const startY = useRef(0);
  const [drag, setDrag] = useState<{ from: number; to: number; dy: number; h: number } | null>(null);
  const [announce, setAnnounce] = useState("");
  const [focusAfter, setFocusAfter] = useState<{ key: string; control: "handle" | "up" | "down" } | null>(null);
  const times = loopSlotTimes(rows);

  // Keep focus on the moved row's control after it re-renders in its new place.
  useEffect(() => {
    if (!focusAfter || !list.current) return;
    const el = list.current.querySelector<HTMLElement>(`[data-row="${focusAfter.key}"] [data-control="${focusAfter.control}"]`);
    const fallback = list.current.querySelector<HTMLElement>(`[data-row="${focusAfter.key}"] [data-control="handle"]`);
    (el && !(el as HTMLButtonElement).disabled ? el : fallback)?.focus();
    setFocusAfter(null);
  }, [focusAfter, rows]);

  const move = (from: number, to: number, control: "handle" | "up" | "down") => {
    if (to < 0 || to >= rows.length || from === to) return;
    const row = rows[from];
    onMove(from, to);
    setAnnounce(`Moved "${row.name}" to position ${to + 1} of ${rows.length}.`);
    setFocusAfter({ key: row.key, control });
  };

  const onDown = (e: PointerEvent<HTMLButtonElement>, index: number) => {
    if (readOnly || (e.pointerType === "mouse" && e.button !== 0) || !list.current) return;
    e.preventDefault();
    const els = [...list.current.children] as HTMLElement[];
    rects.current = els.map((el) => el.getBoundingClientRect());
    startY.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ from: index, to: index, dy: 0, h: rects.current[index].height + GAP });
  };

  const onMoveDrag = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const dy = e.clientY - startY.current;
    const r = rects.current[drag.from];
    const centre = r.top + r.height / 2 + dy;
    const to = rects.current.filter((rr, i) => i !== drag.from && rr.top + rr.height / 2 < centre).length;
    if (to !== drag.to || dy !== drag.dy) setDrag({ ...drag, to, dy });
  };

  const onUp = () => {
    if (!drag) return;
    const { from, to } = drag;
    setDrag(null);
    if (from !== to) {
      const row = rows[from];
      onMove(from, to);
      setAnnounce(`Moved "${row.name}" to position ${to + 1} of ${rows.length}.`);
    }
  };

  const shiftFor = (i: number): number => {
    if (!drag || i === drag.from) return 0;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -drag.h;
    if (drag.to < drag.from && i >= drag.to && i < drag.from) return drag.h;
    return 0;
  };

  const onHandleKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      move(i, i - 1, "handle");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(i, i + 1, "handle");
    }
  };

  return (
    <>
      <ol ref={list} aria-label="Ads in play order" className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map((r, i) => {
          const dragging = drag?.from === i;
          const [start, end] = times[i];
          const isImage = r.mediaType === "image";
          const lockedLength = !isImage && !!r.durationS;
          return (
            <li
              key={r.key}
              data-row={r.key}
              style={{ transform: `translateY(${dragging ? drag!.dy : shiftFor(i)}px)` }}
              className={clsx(
                "relative flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-white py-2 pr-2 pl-1.5",
                dragging ? "z-10 border-navy shadow-[var(--shadow-pop)]" : "border-rule-soft",
                !dragging && drag && "transition-transform duration-150",
                r.missing && "border-red-line bg-red-bg",
              )}
            >
              <div className="flex min-w-0 flex-1 basis-[230px] items-center gap-2">
                {!readOnly ? (
                  <button
                    type="button"
                    data-control="handle"
                    aria-label={`Reorder "${r.name}". Drag, or use the up and down arrow keys.`}
                    onPointerDown={(e) => onDown(e, i)}
                    onPointerMove={onMoveDrag}
                    onPointerUp={onUp}
                    onPointerCancel={() => setDrag(null)}
                    onKeyDown={(e) => onHandleKey(e, i)}
                    className="flex h-11 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-caption hover:bg-paper active:cursor-grabbing"
                  >
                    <GripVertical className="size-4" aria-hidden="true" />
                  </button>
                ) : (
                  <span className="w-1" />
                )}
                <span className="num w-5 shrink-0 text-center font-display text-[15px] font-semibold text-caption">{i + 1}</span>
                <Thumb src={r.thumbUrl} className="w-[64px] shrink-0" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="line-clamp-2 text-sm leading-snug font-bold [overflow-wrap:anywhere]">{r.name}</span>
                  <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted">
                    {r.advertiser && <span className="truncate">{r.advertiser}</span>}
                    {r.missing && <span className="font-semibold text-red-ink">No longer in the library — remove it</span>}
                    {r.archived && <span className="font-semibold text-amber-ink">Archived</span>}
                    {r.screenShape === false && (
                      <span className="inline-flex items-center gap-1 font-semibold text-amber-ink">
                        <TriangleAlert className="size-3" aria-hidden="true" />
                        Not 4:3
                      </span>
                    )}
                    <span className="num text-caption">
                      {secs(start)}–{secs(end)}
                    </span>
                  </span>
                </div>
              </div>

              <div className="ml-auto flex items-center gap-1">
                {!readOnly && isImage ? (
                  <SecondsInput value={r.seconds} name={r.name} onChange={(s) => onSeconds(i, s)} />
                ) : (
                  <span
                    className="num inline-flex h-11 items-center gap-1 px-2 text-[13px] font-semibold text-ink-2 md:h-9"
                    title={lockedLength ? "Videos play for their own length" : undefined}
                  >
                    {secs(r.seconds)}
                    {!readOnly && lockedLength && <Lock className="size-3 text-caption" aria-label="Set by the video" />}
                  </span>
                )}
                {!readOnly && (
                  <>
                    <IconButton label={`Move "${r.name}" up`} control="up" disabled={i === 0} onClick={() => move(i, i - 1, "up")}>
                      <ChevronUp className="size-4" />
                    </IconButton>
                    <IconButton label={`Move "${r.name}" down`} control="down" disabled={i === rows.length - 1} onClick={() => move(i, i + 1, "down")}>
                      <ChevronDown className="size-4" />
                    </IconButton>
                    <IconButton label={`Remove "${r.name}" from the loop`} control="remove" onClick={() => onRemove(i)}>
                      <X className="size-4" />
                    </IconButton>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <div aria-live="polite" className="sr-only">
        {announce}
      </div>
    </>
  );
}

function IconButton({
  label,
  control,
  disabled,
  onClick,
  children,
}: {
  label: string;
  control: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      data-control={control}
      disabled={disabled}
      onClick={onClick}
      className="flex size-11 items-center justify-center rounded-lg text-muted hover:bg-paper hover:text-ink disabled:opacity-30 md:size-9"
    >
      {children}
    </button>
  );
}

/** Seconds for an image slot: − [n] + (1 to 600 s). */
function SecondsInput({ value, name, onChange }: { value: number; name: string; onChange: (s: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (raw: string) => {
    const n = Math.round(Number(raw));
    if (Number.isFinite(n) && n >= 1 && n <= 600) onChange(n);
    else setText(String(value));
  };
  return (
    <div className="flex items-center rounded-[10px] border border-line bg-white">
      <button
        type="button"
        aria-label={`Show "${name}" for a second less`}
        disabled={value <= 1}
        onClick={() => onChange(Math.max(1, value - 1))}
        className="flex size-11 items-center justify-center text-muted hover:text-ink disabled:opacity-30 md:size-9"
      >
        <Minus className="size-3.5" />
      </button>
      <label className="flex items-center gap-0.5">
        <span className="sr-only">Seconds for "{name}"</span>
        <input
          inputMode="numeric"
          value={text}
          onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ""))}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
          }}
          className="num w-8 bg-transparent text-center text-[13px] font-semibold outline-none"
        />
        <span className="text-xs text-muted">s</span>
      </label>
      <button
        type="button"
        aria-label={`Show "${name}" for a second more`}
        disabled={value >= 600}
        onClick={() => onChange(Math.min(600, value + 1))}
        className="flex size-11 items-center justify-center text-muted hover:text-ink disabled:opacity-30 md:size-9"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

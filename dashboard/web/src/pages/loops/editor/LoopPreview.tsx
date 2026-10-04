// "On the bag": cycles through the loop at real speed on a 160 × 120 screen.

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { loopSlotTimes } from "@digilite/shared";
import { secs } from "../bits";

export interface PreviewItem {
  key: string;
  name: string;
  thumbUrl: string | null;
  /** Playable file (ads uploaded here) */
  fileUrl?: string | null;
  seconds: number;
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function LoopPreview({ items }: { items: PreviewItem[] }) {
  const [pos, setPos] = useState({ index: 0, elapsed: 0 });
  const [playing, setPlaying] = useState(() => !reducedMotion());
  const count = items.length;
  const i = count ? Math.min(pos.index, count - 1) : 0;
  const cur = items[i];
  const times = loopSlotTimes(items);
  const lengths = items.map((it) => it.seconds || 10);
  const lengthsKey = lengths.join(",");
  const lengthsRef = useRef(lengths);
  lengthsRef.current = lengths;

  useEffect(() => {
    if (!playing || !count) return;
    let before = performance.now();
    const t = setInterval(() => {
      const now = performance.now();
      const dt = (now - before) / 1000;
      before = now;
      setPos((p) => {
        const idx = Math.min(p.index, count - 1);
        const e = p.elapsed + dt;
        return e >= (lengthsRef.current[idx] ?? 10) ? { index: (idx + 1) % count, elapsed: 0 } : { index: idx, elapsed: e };
      });
    }, 200);
    return () => clearInterval(t);
  }, [playing, count, lengthsKey]);

  const go = (d: number) => {
    if (!count) return;
    setPos((p) => ({ index: (Math.min(p.index, count - 1) + d + count) % count, elapsed: 0 }));
  };

  const pct = cur ? Math.min(100, (pos.elapsed / (cur.seconds || 10)) * 100) : 0;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="rounded-xl bg-[#0a0f1c] p-3 shadow-[inset_0_0_0_1px_#1e2638]">
        <div className="relative aspect-[4/3] overflow-hidden rounded-[3px] bg-[#1d2436]">
          {cur?.fileUrl ? (
            <video key={cur.key} src={cur.fileUrl} poster={cur.thumbUrl ?? undefined} muted autoPlay={playing} loop playsInline className="size-full object-cover" />
          ) : cur?.thumbUrl ? (
            <img key={cur.key} src={cur.thumbUrl} alt={`Preview of ${cur.name}`} className="size-full object-cover" style={{ imageRendering: "pixelated" }} />
          ) : (
            <div className="flex size-full items-center justify-center text-xs font-semibold text-white/50">{count ? "No preview for this ad" : "Add ads to see the loop"}</div>
          )}
          {/* LED pixel grid */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: "linear-gradient(rgba(10,15,28,0.22) 1px, transparent 1px), linear-gradient(90deg, rgba(10,15,28,0.22) 1px, transparent 1px)",
              backgroundSize: "3px 3px",
            }}
          />
        </div>
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
          <div className="h-full rounded-full bg-white/70" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 text-xs text-muted" aria-live="off">
          {cur ? (
            <>
              <span className="font-semibold text-ink-2">
                Ad {i + 1} of {count}
              </span>{" "}
              · {secs(times[i][0])}–{secs(times[i][1])}
              <span className="block truncate">{cur.name}</span>
            </>
          ) : (
            "Preview · 160 × 120"
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" aria-label="Previous ad" disabled={count < 2} onClick={() => go(-1)} className="flex size-11 items-center justify-center rounded-lg border border-line bg-white disabled:opacity-40 md:size-9">
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            aria-label={playing ? "Pause the preview" : "Play the loop"}
            disabled={!count}
            onClick={() => setPlaying(!playing)}
            className="flex size-11 items-center justify-center rounded-lg bg-navy text-white disabled:opacity-40 md:size-9"
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
          <button type="button" aria-label="Next ad" disabled={count < 2} onClick={() => go(1)} className="flex size-11 items-center justify-center rounded-lg border border-line bg-white disabled:opacity-40 md:size-9">
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

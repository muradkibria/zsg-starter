// Creatives: upload, filter and browse every ad, with measured plays and where it runs.

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import clsx from "clsx";
import { Search, TriangleAlert } from "lucide-react";
import type { LibraryCreative } from "@digilite/shared";
import { useAuth } from "@/lib/auth";
import { Chip, EmptyState, ErrorState, Input, Spinner } from "@/components/ui";
import { num } from "@/lib/format";
import { useCreatives } from "./api";
import { CreativeSheet } from "./CreativeSheet";
import { UploadCard } from "./UploadCard";
import { plural, secs, Thumb } from "./bits";

type Filter = "all" | "on" | "unused" | "ended" | "archived";

export function CreativesTab() {
  const { can } = useAuth();
  const creatives = useCreatives();
  const [params, setParams] = useSearchParams();
  const filter = (params.get("show") as Filter) || "all";
  const openId = params.get("ad");
  const [q, setQ] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v === null) next.delete(k);
    else next.set(k, v);
    setParams(next, { replace: k === "show" });
  };

  const list = creatives.data ?? [];
  const live = list.filter((c) => !c.archived);
  const counts = {
    all: live.length,
    on: live.filter((c) => c.bagsNow > 0).length,
    unused: live.filter((c) => c.bagsNow === 0).length,
    ended: live.filter((c) => c.endedStillPlaying).length,
    archived: list.length - live.length,
  };
  const advertisers = useMemo(() => [...new Set(list.map((c) => c.advertiser).filter(Boolean))].sort(), [list]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return list.filter((c) => {
      if (filter === "archived" ? !c.archived : c.archived) return false;
      if (filter === "on" && c.bagsNow === 0) return false;
      if (filter === "unused" && c.bagsNow > 0) return false;
      if (filter === "ended" && !c.endedStillPlaying) return false;
      if (term && !`${c.name} ${c.advertiser} ${c.campaign?.name ?? ""}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [list, filter, q]);

  // A new upload is highlighted briefly.
  useEffect(() => {
    if (!fresh) return;
    const t = setTimeout(() => setFresh(null), 6000);
    return () => clearTimeout(t);
  }, [fresh]);

  const open = openId ? (list.find((c) => c.id === openId || c.copyIds.includes(openId)) ?? null) : null;

  return (
    <div className="flex flex-col gap-5">
      {can("loops.edit") && (
        <UploadCard
          advertisers={advertisers}
          onUploaded={(c) => {
            setFresh(c.id);
            if (filter !== "all" && filter !== "unused") setParam("show", null);
          }}
          onShowCreative={(id) => setParam("ad", id)}
        />
      )}

      <section aria-label="Creatives" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0 md:pb-0">
            <Chip active={filter === "all"} onClick={() => setParam("show", null)} count={counts.all}>
              All
            </Chip>
            <Chip active={filter === "on"} onClick={() => setParam("show", "on")} count={counts.on}>
              On bags now
            </Chip>
            <Chip active={filter === "unused"} onClick={() => setParam("show", "unused")} count={counts.unused}>
              Ended or unused
            </Chip>
            {counts.ended > 0 && (
              <Chip active={filter === "ended"} tone="amber" onClick={() => setParam("show", "ended")} count={counts.ended}>
                Campaign ended, still playing
              </Chip>
            )}
            <Chip active={filter === "archived"} onClick={() => setParam("show", "archived")} count={counts.archived}>
              Archived
            </Chip>
          </div>
          <label className="relative w-full sm:w-[240px]">
            <span className="sr-only">Search ads</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-caption" aria-hidden="true" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ads or advertisers" className="pl-9" />
          </label>
        </div>

        {creatives.isLoading ? (
          <Spinner label="Loading ads…" />
        ) : creatives.error ? (
          <ErrorState error={creatives.error} retry={() => void creatives.refetch()} />
        ) : shown.length === 0 ? (
          <div className="card">
            <EmptyState
              title={q ? "No ads match that search" : filter === "archived" ? "Nothing archived" : filter === "on" ? "No ads on bags right now" : "No ads here"}
              body={q ? "Try another name or advertiser." : filter === "all" ? "Upload an ad above to start the library." : undefined}
            />
          </div>
        ) : (
          <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {shown.map((c) => (
              <li key={c.id} className="min-w-0">
                <CreativeTile c={c} highlight={fresh === c.id} onOpen={() => setParam("ad", c.id)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <CreativeSheet creative={open} onClose={() => setParam("ad", null)} advertisers={advertisers} />
    </div>
  );
}

export function CreativeTile({ c, onOpen, highlight }: { c: LibraryCreative; onOpen: () => void; highlight?: boolean }) {
  const flagged = c.endedStillPlaying;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${c.name}${c.advertiser ? `, ${c.advertiser}` : ""}. In ${plural(c.loops.length, "loop")}, on ${plural(c.bagsNow, "bag")}, ${plural(c.plays7d, "play")} in the last 7 days${c.endedStillPlaying ? ". Campaign ended but still playing" : ""}${c.screenShape === false ? ". Not 4:3" : ""}`}
      className={clsx(
        "flex h-full w-full min-w-0 flex-col gap-2 overflow-hidden rounded-[14px] border bg-white p-2.5 text-left transition-shadow hover:shadow-[var(--shadow-float)]",
        flagged ? "border-amber-line ring-2 ring-amber-line" : "border-rule",
        highlight && "ring-2 ring-navy",
        c.archived && "opacity-70",
      )}
    >
      <Thumb src={c.thumbUrl} badge={c.durationS ? secs(c.durationS) : c.mediaType === "image" ? "Image" : null}>
        {flagged && (
          <div className="absolute inset-x-[5%] bottom-[7%] flex items-center gap-1 rounded-[3px] bg-amber-bg px-1.5 py-1 text-[10px] leading-tight font-bold text-amber-ink">
            <TriangleAlert className="size-3 shrink-0" aria-hidden="true" />
            <span className="min-w-0">Campaign ended, still on {c.bagsNow} bags</span>
          </div>
        )}
        {!flagged && c.screenShape === false && (
          <span className="absolute bottom-[9%] left-[8%] rounded-[5px] bg-amber-bg px-1.5 py-px text-[10px] font-bold text-amber-ink">Not 4:3</span>
        )}
      </Thumb>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="line-clamp-2 text-[13px] leading-snug font-bold [overflow-wrap:anywhere]">{c.name}</span>
        {c.advertiser && <span className="truncate text-xs text-muted">{c.advertiser}</span>}
      </div>
      <div className="mt-auto flex flex-wrap gap-1 text-[11px] font-semibold">
        <span className="rounded-md bg-paper-3 px-1.5 py-0.5 text-ink-2">{c.loops.length ? `in ${plural(c.loops.length, "loop")}` : "in no loops"}</span>
        <span className={clsx("rounded-md px-1.5 py-0.5", c.bagsNow ? (flagged ? "bg-amber-bg text-amber-ink" : "bg-green-bg text-green-ink") : "bg-paper-3 text-muted")}>
          {c.bagsNow ? `on ${plural(c.bagsNow, "bag")}` : "on no bags"}
        </span>
      </div>
      <span className="text-xs text-muted">
        <span className="num font-semibold text-ink-2">{num(c.plays7d)}</span> {c.plays7d === 1 ? "play" : "plays"} · last 7 days
      </span>
    </button>
  );
}

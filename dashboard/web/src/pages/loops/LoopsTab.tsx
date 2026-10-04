// Loops: every loop with its ads, where it's playing and how old it is.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import clsx from "clsx";
import { ChevronDown, Copy, FilePlus2, Plus } from "lucide-react";
import { FLEET_LOOP_STALE_DAYS, type LoopListItem } from "@digilite/shared";
import { useAuth } from "@/lib/auth";
import { useFeedback } from "@/components/feedback";
import { Button, Chip, EmptyState, ErrorState, Spinner } from "@/components/ui";
import { shortDate } from "@/lib/format";
import { useCreateLoop, useLoops } from "./api";
import { AgePill, DeploymentPill, FleetPill, LoopStatusPill, plural, secs, ThumbStrip } from "./bits";

type Filter = "all" | "on" | "drafts" | "off";

export function LoopsTab() {
  const loops = useLoops();
  const [params, setParams] = useSearchParams();
  const filter = (params.get("loops") as Filter) || "all";
  const list = loops.data ?? [];
  const counts = {
    all: list.length,
    on: list.filter((l) => l.bagsPlaying.length > 0).length,
    drafts: list.filter((l) => l.status === "draft").length,
    off: list.filter((l) => l.bagsPlaying.length === 0 && l.status !== "draft").length,
  };
  const shown = list.filter((l) =>
    filter === "on" ? l.bagsPlaying.length > 0 : filter === "drafts" ? l.status === "draft" : filter === "off" ? l.bagsPlaying.length === 0 && l.status !== "draft" : true,
  );
  const setFilter = (f: Filter) => {
    const next = new URLSearchParams(params);
    if (f === "all") next.delete("loops");
    else next.set("loops", f);
    setParams(next, { replace: true });
  };

  return (
    <section aria-label="Loops" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0 md:pb-0">
          <Chip active={filter === "all"} onClick={() => setFilter("all")} count={counts.all}>
            All
          </Chip>
          <Chip active={filter === "on"} onClick={() => setFilter("on")} count={counts.on}>
            On bags
          </Chip>
          <Chip active={filter === "drafts"} onClick={() => setFilter("drafts")} count={counts.drafts}>
            Drafts
          </Chip>
          <Chip active={filter === "off"} onClick={() => setFilter("off")} count={counts.off}>
            Not on any bag
          </Chip>
        </div>
        <NewLoopButton fleet={list.find((l) => l.isFleetLoop) ?? null} />
      </div>
      <p className="-mt-1 m-0 text-xs text-muted">"Playing" means the bag itself reported it. Bags that haven't reported for a while may have moved on.</p>

      {loops.isLoading ? (
        <Spinner label="Loading loops…" />
      ) : loops.error ? (
        <ErrorState error={loops.error} retry={() => void loops.refetch()} />
      ) : shown.length === 0 ? (
        <div className="card">
          <EmptyState title={filter === "drafts" ? "No drafts" : "No loops here"} body={filter === "drafts" ? "Start a new loop, or duplicate one as a draft." : undefined} />
        </div>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((l) => (
            <li key={l.id} className="min-w-0">
              <LoopCard loop={l} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LoopCard({ loop: l }: { loop: LoopListItem }) {
  const gone = l.bagsPlaying.filter((b) => b.status === "gone").length;
  const stale = l.isFleetLoop && (l.ageDays ?? 0) > FLEET_LOOP_STALE_DAYS;
  const draft = l.status === "draft";
  return (
    <Link
      to={`/loops/${l.id}`}
      className={clsx(
        "flex h-full flex-col gap-3 rounded-2xl border p-4 text-ink no-underline transition-shadow hover:shadow-[var(--shadow-float)]",
        draft ? "border-dashed border-line bg-[#fbfaf6]" : stale ? "border-amber-line bg-[#fffcf6]" : "border-rule bg-white",
      )}
    >
      <div className="flex flex-col gap-1.5">
        <h3 className="m-0 line-clamp-2 font-display text-base leading-snug font-semibold [overflow-wrap:anywhere]">{l.name}</h3>
        <div className="flex flex-wrap gap-1.5">
          {l.isFleetLoop && <FleetPill />}
          <LoopStatusPill status={l.status} onBags={l.bagsPlaying.length} />
          {l.status !== "draft" && <AgePill ageDays={l.ageDays} fleet={l.isFleetLoop} />}
        </div>
      </div>
      <ThumbStrip items={l.items} />
      <div className="text-xs text-muted">
        {l.items.length ? `${secs(l.totalSeconds)} loop · ${plural(l.items.length, "ad")} · plays through ${l.cyclesPerHour}× an hour` : "Empty — add ads to it"}
      </div>
      <div className="mt-auto flex flex-col gap-1 border-t border-rule-soft pt-2.5 text-[13px]">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className={clsx("font-semibold", l.bagsPlaying.length ? "text-ink" : "text-muted")}>
            {l.bagsPlaying.length ? `Playing on ${plural(l.bagsPlaying.length, "bag")}` : draft ? "Not on any bag yet" : "Not playing on any bag"}
          </span>
          {l.bagsDownloaded > 0 && <span className="text-xs text-muted">downloaded on {l.bagsDownloaded}</span>}
        </div>
        {l.bagsPlaying.length > 0 && l.bagsPlaying.length <= 3 && (
          <span className="text-xs text-muted">{l.bagsPlaying.map((b) => b.name).join(", ")}</span>
        )}
        {gone > 0 && (
          <span className={clsx("text-xs", stale ? "text-amber-ink" : "text-muted")}>
            {gone} of {l.bagsPlaying.length === gone ? "them" : "these bags"} not seen for over a week
          </span>
        )}
        {l.lastDeployment && (
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {l.lastDeployment.status === "sent" || l.lastDeployment.status === "partial" || l.lastDeployment.status === "confirmed" ? "Last sent" : "Last tried"}{" "}
            {shortDate(l.lastDeployment.createdAt)} <DeploymentPill status={l.lastDeployment.status} />
          </span>
        )}
      </div>
    </Link>
  );
}

function NewLoopButton({ fleet }: { fleet: LoopListItem | null }) {
  const { can } = useAuth();
  const { toast } = useFeedback();
  const nav = useNavigate();
  const create = useCreateLoop();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const start = async (from?: string) => {
    setOpen(false);
    try {
      const loop = await create.mutateAsync(from ? { from } : {});
      nav(`/loops/${loop.id}?new=1`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const options = useMemo(
    () => [
      ...(fleet ? [{ key: "fleet", label: `Start from ${fleet.name}`, sub: "The fleet loop, as a draft to change", icon: Copy, run: () => void start(fleet.id) }] : []),
      { key: "empty", label: "Start empty", sub: "Pick every ad yourself", icon: FilePlus2, run: () => void start() },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fleet],
  );

  if (!can("loops.edit")) return null;
  return (
    <div ref={wrap} className="relative">
      <Button variant="primary" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" loading={create.isPending} icon={<Plus className="size-4" />}>
        New loop
        <ChevronDown className="size-4 opacity-80" aria-hidden="true" />
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-[280px] rounded-xl border border-rule bg-white p-1.5 shadow-[var(--shadow-pop)]">
          {options.map((o) => (
            <button
              key={o.key}
              role="menuitem"
              type="button"
              onClick={o.run}
              autoFocus={o.key === options[0].key}
              className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-paper focus:bg-paper"
            >
              <o.icon className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold break-words">{o.label}</span>
                <span className="block text-xs text-muted">{o.sub}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

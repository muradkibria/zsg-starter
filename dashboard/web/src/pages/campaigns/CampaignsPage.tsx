// Campaigns: what's sold, what's running and what's ending. Live inventory at
// the top, then every campaign with its dates, the bags actually carrying it
// and the plays the bags measured.

import { useMemo, useState } from "react";
import { Link } from "react-router";
import clsx from "clsx";
import { AlertTriangle, ChevronRight, Megaphone, Plus } from "lucide-react";
import type { CampaignListResponse, CampaignSummary } from "@digilite/shared";
import { Button, Card, EmptyState, ErrorState, Page, PageHeader, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { londonDay } from "@digilite/shared";
import { time, when } from "@/lib/format";
import { useCampaigns, useInventory } from "./api";
import { CampaignForm } from "./components/CampaignForm";
import { axisFor, CampaignTimeline, monthTicks, type Axis } from "./components/CampaignTimeline";
import { CreativeThumb } from "./components/CreativeThumb";
import { InventoryCard } from "./components/InventoryCard";
import { DemoPill, StatusNote, StatusPill } from "./components/StatusPill";
import { dayRange, dayShort, n } from "./format";

export default function CampaignsPage() {
  const { can } = useAuth();
  const list = useCampaigns();
  const inventory = useInventory();
  const [creating, setCreating] = useState(false);
  const data = list.data;
  const endedOnScreen = data?.campaigns.filter((c) => c.status.phase === "ended_on_screen") ?? [];
  const runningOff = data?.campaigns.filter((c) => (c.status.phase === "live" || c.status.phase === "ending") && c.status.warn) ?? [];

  return (
    <Page>
      <PageHeader
        title="Campaigns"
        sub={
          <>
            What's sold, what's running and what's ending
            {data?.playsTo && <> · plays measured by the bags up to {playsUpTo(data.playsTo, data.today)}</>}
          </>
        }
        actions={
          can("campaigns.edit") && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              New campaign
            </Button>
          )
        }
      />

      {endedOnScreen.length > 0 && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-red-line bg-red-bg px-4 py-3 text-sm text-red-ink">
          <AlertTriangle className="size-5 shrink-0" />
          <p className="m-0 min-w-0 flex-1">
            <strong>
              Ended but still playing on {n(Math.max(...endedOnScreen.map((c) => c.bagsAfterEnd)))} {Math.max(...endedOnScreen.map((c) => c.bagsAfterEnd)) === 1 ? "bag" : "bags"}.
            </strong>{" "}
            {endedOnScreen.map((c, i) => (
              <span key={c.id}>
                {i > 0 && (i === endedOnScreen.length - 1 ? " and " : ", ")}
                <Link to={`/campaigns/${c.id}`} className="font-semibold text-red-ink">
                  {c.advertiser}
                </Link>
              </span>
            ))}{" "}
            {endedOnScreen.length === 1 ? "is" : "are"} still in a loop the bags play — those slots are being given away free.
          </p>
          {can("loops.edit") && (
            <Link to="/loops" className="inline-flex h-9 items-center rounded-lg bg-red-ink px-3 text-[13px] font-bold text-white no-underline">
              Fix the loop
            </Link>
          )}
        </div>
      )}

      {runningOff.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl bg-amber-bg px-4 py-3 text-[13px] text-amber-ink">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p className="m-0">
            <strong>Running but not on screen this week:</strong>{" "}
            {runningOff.map((c, i) => (
              <span key={c.id}>
                {i > 0 && ", "}
                <Link to={`/campaigns/${c.id}`} className="font-semibold text-amber-ink">
                  {c.advertiser}
                </Link>
                {c.creativeFiles === 0 ? " (no creatives linked)" : ""}
              </span>
            ))}
            . The bags haven't played {runningOff.length === 1 ? "its" : "their"} ads in the last 7 days.
          </p>
        </div>
      )}

      <InventoryCard query={inventory} campaigns={data?.campaigns} today={data?.today} />

      {list.isLoading && <Spinner label="Loading campaigns…" />}
      {list.error && <ErrorState error={list.error} retry={() => void list.refetch()} />}
      {data && (data.campaigns.length ? <CampaignList data={data} /> : <NoCampaigns canEdit={can("campaigns.edit")} onNew={() => setCreating(true)} />)}

      <CampaignForm open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}

/** End of the latest hour we hold plays for: "today 20:00", or "Mon 28 Sept" style when older. */
function playsUpTo(latestHour: string, today: string): string {
  const end = new Date(Date.parse(latestHour) + 3600_000);
  return londonDay(end) === today ? `today ${time(end)}` : when(end.toISOString());
}

function NoCampaigns({ canEdit, onNew }: { canEdit: boolean; onNew: () => void }) {
  return (
    <Card>
      <EmptyState
        icon={<Megaphone className="size-8" />}
        title="No campaigns yet"
        body="Add a campaign for each advertiser's contract, then link its creatives to see the plays the bags measure."
        action={canEdit && <Button variant="primary" icon={<Plus className="size-4" />} onClick={onNew}>New campaign</Button>}
      />
    </Card>
  );
}

const COLS = "md:grid md:grid-cols-[minmax(0,2.3fr)_minmax(0,2fr)_minmax(0,1.25fr)_minmax(0,1.25fr)_minmax(0,1.6fr)_20px] md:items-center md:gap-5";

function CampaignList({ data }: { data: CampaignListResponse }) {
  const axis = useMemo(() => axisFor(data.campaigns, data.today), [data]);
  const ticks = useMemo(() => monthTicks(axis), [axis]);
  return (
    <Card className="overflow-hidden" aria-label="Campaign list">
      <div role="table" aria-label="Campaigns">
        <div role="row" className={clsx("hidden border-b border-rule bg-paper/60 px-5 py-2.5 text-xs font-semibold text-muted", COLS)}>
          <span role="columnheader">Advertiser · campaign</span>
          <span role="columnheader" className="flex flex-col gap-0.5">
            <span>Dates</span>
            <span className="relative h-3.5 font-normal" aria-hidden="true">
              {ticks.map((t) => (
                <span key={t.day} className="absolute text-[10px] text-caption" style={{ left: `${t.left}%` }}>
                  {t.label}
                </span>
              ))}
            </span>
          </span>
          <span role="columnheader">Bags carrying it</span>
          <span role="columnheader">Plays · measured</span>
          <span role="columnheader">Status</span>
          <span role="columnheader" aria-label="Open" />
        </div>
        {data.campaigns.map((c) => (
          <CampaignRow key={c.id} c={c} axis={axis} today={data.today} playsFrom={data.playsFrom} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-rule px-5 py-3 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-[2px] rounded bg-ink" aria-hidden="true" /> Today
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-4 rounded-full" style={{ background: "repeating-linear-gradient(135deg, #a1261b 0 2px, #fbecea 2px 4px)" }} aria-hidden="true" /> Playing after the end date
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-[2px] rounded bg-amber-ink" aria-hidden="true" /> Bags contracted
        </span>
        <span className="md:ml-auto">Plays are counted by the bags. Bags carrying it = bags that played it in the last 7 days.</span>
      </div>
    </Card>
  );
}

function playsNote(c: CampaignSummary, playsFrom: string | null): { text: string; tone?: "red" } | null {
  if (c.playsAfterEnd > 0) return { text: `+ ${n(c.playsAfterEnd)} after it ended`, tone: "red" };
  if (c.status.phase === "upcoming" || (c.status.phase === "draft" && c.plays === 0)) return { text: "not started" };
  if (!c.startDay) return null;
  if (c.plays === 0) return { text: c.creativeFiles ? "none recorded" : "no creatives linked" };
  const from = playsFrom && playsFrom > c.startDay ? playsFrom : c.startDay;
  return { text: `since ${dayShort(from)}` };
}

function BagsMeter({ carrying, contracted }: { carrying: number; contracted: number }) {
  const scale = Math.max(contracted, carrying, 1);
  const short = contracted > 0 && carrying < contracted;
  return (
    <div className="relative mt-1.5 h-1.5 rounded-full bg-paper-2" aria-hidden="true">
      <div className={clsx("h-full rounded-full", short ? "bg-amber-ink/70" : "bg-navy")} style={{ width: `${(carrying / scale) * 100}%` }} />
      {contracted > 0 && <div className="absolute -top-1 -bottom-1 w-[2px] -translate-x-1/2 rounded bg-amber-ink" style={{ left: `${(contracted / scale) * 100}%` }} />}
    </div>
  );
}

function CampaignRow({ c, axis, today, playsFrom }: { c: CampaignSummary; axis: Axis; today: string; playsFrom: string | null }) {
  const note = playsNote(c, playsFrom);
  const afterEnd = c.status.phase === "ended_on_screen";
  const plays = c.status.phase === "upcoming" && c.plays === 0 ? "—" : n(c.plays);
  const color = c.status.phase === "ended" || c.status.phase === "ended_on_screen" ? "#8e8778" : c.status.phase === "draft" ? "#cfc8b8" : "#3a67c6";
  return (
    <Link
      role="row"
      to={`/campaigns/${c.id}`}
      className={clsx(
        "flex flex-col gap-3 border-b border-rule-soft px-4 py-4 text-ink no-underline last:border-b-0 hover:bg-paper/70 md:px-5 md:py-3.5",
        COLS,
        afterEnd && "bg-[#fffbfa]",
      )}
    >
      <span role="cell" className="flex min-w-0 items-center gap-3">
        <CreativeThumb id={c.thumbId} name={c.advertiser} size="sm" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[15px] font-bold">{c.advertiser}</span>
            {c.demo && <DemoPill />}
          </span>
          <span className="truncate text-[13px] text-muted">{c.name}</span>
        </span>
        <ChevronRight className="size-5 shrink-0 text-muted md:hidden" />
      </span>

      <span role="cell" className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[13px] text-ink-2">{dayRange(c.startDay, c.endDay)}</span>
        <CampaignTimeline axis={axis} startDay={c.startDay} endDay={c.endDay} today={today} afterEnd={afterEnd} color={color} />
      </span>

      <span className="grid grid-cols-2 gap-3 md:contents">
        <span role="cell" className="flex min-w-0 flex-col">
          <span className="text-[11px] text-muted md:hidden">Bags carrying it</span>
          <span className="text-[13px]">
            <strong className="num text-[15px]">{n(c.bagsCarrying)}</strong> <span className="text-muted">/ {n(c.contractedBags)} contracted</span>
          </span>
          <BagsMeter carrying={c.bagsCarrying} contracted={c.contractedBags} />
        </span>
        <span role="cell" className="flex min-w-0 flex-col">
          <span className="text-[11px] text-muted md:hidden">Plays · measured</span>
          <span className="num text-[15px] font-bold">{plays}</span>
          {note && <span className={clsx("text-xs", note.tone === "red" ? "font-semibold text-red-ink" : "text-muted")}>{note.text}</span>}
        </span>
        <span role="cell" className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 md:col-span-1 md:flex-col md:flex-nowrap md:items-start">
          <StatusPill status={c.status} />
          <StatusNote status={c.status} />
        </span>
      </span>
      <span role="cell" className="hidden md:block">
        <ChevronRight className="size-5 text-muted" />
      </span>
    </Link>
  );
}

// Live inventory: every slot on the bags that were out in the last 7 days —
// sold (a live campaign), house (DigiLite's own ads) or unsold (anything else,
// including ended campaigns still in a loop). Bags not out for a week are
// shown but not counted.

import { Link } from "react-router";
import clsx from "clsx";
import { addDays, type CampaignSummary, type InventoryResponse, type SlotKind } from "@digilite/shared";
import { Card, ErrorState, Spinner } from "@/components/ui";
import { dayShort, n, plural } from "../format";

export const SLOT_STYLE: Record<SlotKind, { bg: string; label: string }> = {
  sold: { bg: "#061b47", label: "Sold" },
  house: { bg: "#b8b0a0", label: "House ad" },
  unsold_ended: { bg: "repeating-linear-gradient(135deg, #d98a80 0 2px, #fbecea 2px 5px)", label: "Ended campaign, still playing" },
  unsold: { bg: "#e3ded3", label: "Unsold" },
};

function Swatch({ kind, className }: { kind: SlotKind; className?: string }) {
  return <span aria-hidden="true" className={clsx("inline-block size-3 shrink-0 rounded-[3px]", className)} style={{ background: SLOT_STYLE[kind].bg }} />;
}

export function InventoryCard({
  query,
  campaigns,
  today,
}: {
  query: { data?: InventoryResponse; isLoading: boolean; error: unknown; refetch: () => unknown };
  campaigns?: CampaignSummary[];
  today?: string;
}) {
  const inv = query.data;
  return (
    <Card className="p-4 md:p-5" aria-label="Live inventory">
      {query.isLoading && <Spinner label="Counting slots…" />}
      {!!query.error && <ErrorState error={query.error} retry={() => void query.refetch()} />}
      {inv && <InventoryBody inv={inv} upcoming={campaigns && today ? comingUp(inv, campaigns, today) : []} />}
    </Card>
  );
}

/** What changes in the next two weeks: sold campaigns ending (slots free up) and campaigns starting. */
function comingUp(inv: InventoryResponse, campaigns: CampaignSummary[], today: string): { key: string; text: string; tone: "amber" | "info" }[] {
  const soon = addDays(today, 14);
  const out: { key: string; day: string; text: string; tone: "amber" | "info" }[] = [];
  for (const s of inv.soldBy) {
    const c = campaigns.find((x) => x.id === s.campaignId);
    if (c?.endDay && c.endDay >= today && c.endDay < soon) {
      out.push({ key: `end-${c.id}`, day: addDays(c.endDay, 1), text: `From ${dayShort(addDays(c.endDay, 1))}: ${c.advertiser} ends — ${plural(s.slots, "slot")} free up`, tone: "amber" });
    }
  }
  for (const c of campaigns) {
    if (c.status.phase === "upcoming" && c.startDay && c.startDay < soon) {
      out.push({
        key: `start-${c.id}`,
        day: c.startDay,
        text: `From ${dayShort(c.startDay)}: ${c.advertiser} starts on ${plural(c.contractedBags, "bag")}${c.bagsCarrying ? "" : " — not in a loop the bags play yet"}`,
        tone: "info",
      });
    }
  }
  return out.sort((a, b) => a.day.localeCompare(b.day)).map(({ key, text, tone }) => ({ key, text, tone }));
}

function InventoryBody({ inv, upcoming }: { inv: InventoryResponse; upcoming: { key: string; text: string; tone: "amber" | "info" }[] }) {
  const segs: { kind: SlotKind; value: number }[] = [
    { kind: "sold", value: inv.sold },
    { kind: "house", value: inv.house },
    { kind: "unsold_ended", value: inv.unsoldEnded },
    { kind: "unsold", value: inv.unsold - inv.unsoldEnded },
  ];
  const total = inv.totalSlots;
  const perBag = inv.loops.length === 1 ? inv.loops[0].slots.length : null;
  const soldNames = inv.soldBy.map((s) => `${s.label}${s.demo ? " (demo)" : ""}`);
  const counted = inv.bags.filter((b) => b.counted);
  const notCounted = inv.bags.filter((b) => !b.counted);
  const maxSlots = Math.max(1, ...inv.bags.map((b) => b.cells.length));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="flex min-w-0 flex-col gap-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="m-0 font-display text-lg font-semibold">Live inventory</h2>
          <span className="text-xs text-muted">bags out in the last {inv.windowDays} days</span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2.5">
          <span className="font-display text-[44px] leading-none font-semibold tracking-[-0.02em]">{n(total)}</span>
          <span className="text-sm text-ink-2">
            slots · {plural(inv.bagsCounted, "bag")}
            {perBag != null && ` × ${perBag} slots`}
          </span>
        </div>

        {total > 0 ? (
          <div
            role="img"
            aria-label={`${total} live slots: ${inv.sold} sold, ${inv.house} house ads, ${inv.unsold} unsold${inv.unsoldEnded ? ` (${inv.unsoldEnded} still showing ended campaigns)` : ""}.`}
            className="flex h-9 gap-[2px] overflow-hidden rounded-lg"
          >
            {segs
              .filter((s) => s.value > 0)
              .map((s) => {
                const pct = (s.value / total) * 100;
                const dark = s.kind === "sold";
                return (
                  <div key={s.kind} className="flex min-w-[3px] items-center justify-center" style={{ width: `${pct}%`, background: SLOT_STYLE[s.kind].bg }} title={`${SLOT_STYLE[s.kind].label}: ${s.value}`}>
                    {pct >= 9 && (
                      <span className={clsx("num rounded px-1 text-[13px] font-bold", dark ? "text-white" : s.kind === "unsold_ended" ? "bg-white/80 text-red-ink" : "text-ink")}>{s.value}</span>
                    )}
                  </div>
                );
              })}
          </div>
        ) : (
          <p className="m-0 rounded-lg bg-paper px-3 py-2.5 text-sm text-muted">No bags have been out in the last {inv.windowDays} days, so there are no live slots to count.</p>
        )}

        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[13px]">
          <LegendRow kind="sold" value={inv.sold} sub={soldNames.length ? soldNames.join(", ") : "No live campaign is in a loop the bags play"} />
          <LegendRow kind="house" value={inv.house} sub="DigiLite's own ads" />
          {inv.unsoldEnded > 0 && (
            <LegendRow kind="unsold_ended" value={inv.unsoldEnded} sub={`${inv.endedBy.map((e) => e.label).join(", ")} — ended, so these slots earn nothing`} />
          )}
          <LegendRow kind="unsold" value={inv.unsold - inv.unsoldEnded} sub="Ads not linked to a live campaign" />
        </ul>

        {inv.loops.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-rule pt-3">
            {inv.loops.map((l) => (
              <div key={l.loopId ?? l.name} className="flex flex-col gap-1.5">
                <div className="text-xs text-muted">
                  <span className="font-semibold text-ink">{l.name}</span> · {plural(l.bags, "bag")} · {plural(l.slots.length, "slot")}
                </div>
                <ol className="m-0 flex list-none flex-col gap-1 p-0">
                  {l.slots.map((s) => (
                    <li key={s.position} className="flex items-center gap-2 text-[13px]">
                      <span className="num w-4 shrink-0 text-right text-xs text-muted">{s.position}</span>
                      <Swatch kind={s.kind} />
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      <span className="shrink-0 text-xs text-muted">
                        {s.campaignId ? (
                          <Link to={`/campaigns/${s.campaignId}`} className="font-semibold">
                            {s.kind === "sold" ? s.campaignLabel : `${s.campaignLabel} (${s.kind === "unsold_ended" ? "ended" : "not live"})`}
                          </Link>
                        ) : (
                          SLOT_STYLE[s.kind].label
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-2.5">
        <div className="flex items-baseline justify-between gap-3 text-[13px]">
          <span className="font-semibold">Every slot in the fleet</span>
          <span className="text-xs text-muted">one column per bag</span>
        </div>
        <div className="flex gap-2">
          <div className="flex shrink-0 flex-col gap-[3px] pt-px text-right text-[10px] text-muted" aria-hidden="true">
            {Array.from({ length: maxSlots }, (_, i) => (
              <span key={i} className="flex h-4 items-center justify-end md:h-5">
                {i === 0 ? "Slot 1" : i + 1}
              </span>
            ))}
          </div>
          <div
            role="img"
            aria-label={`${inv.bags.length} bags by slot: ${counted.length} out in the last ${inv.windowDays} days and counted, ${notCounted.length} not out in a week.`}
            className="flex min-w-0 flex-1 gap-[3px]"
          >
            {inv.bags.map((b, i) => (
              <div
                key={b.bagId}
                title={`${b.bagName} · ${b.loopName ?? "loop unknown"}${b.counted ? "" : " · not out in a week"}`}
                className={clsx("flex max-w-[16px] min-w-0 flex-1 flex-col gap-[3px]", !b.counted && "opacity-45", i === counted.length && counted.length > 0 && "ml-2")}
              >
                {Array.from({ length: maxSlots }, (_, s) => {
                  const kind = b.cells[s];
                  return (
                    <span
                      key={s}
                      className={clsx("block h-4 rounded-[3px] md:h-5", !kind && "border border-dashed border-line")}
                      style={kind ? { background: b.counted ? SLOT_STYLE[kind].bg : "transparent", border: b.counted ? undefined : "1px solid #cfc8b8" } : undefined}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <div className="border-t-2 border-ink pt-1.5">
            <strong>{plural(inv.bagsCounted, "bag")} out in the last {inv.windowDays} days</strong> · counted
            {inv.bagsUnknownLoop > 0 && <span className="block text-amber-ink">{plural(inv.bagsUnknownLoop, "bag")} play a loop we hold no copy of — their slots aren't counted</span>}
          </div>
          {inv.bagsNotCounted > 0 && (
            <div className="border-t-2 border-dashed border-line pt-1.5 text-muted">
              {plural(inv.bagsNotCounted, "bag")} haven't been out in a week · {plural(inv.slotsNotCounted, "slot")} not counted
            </div>
          )}
        </div>
        {inv.testBagExcluded && <p className="m-0 text-[11px] text-muted">The test bag isn't counted.</p>}
        {upcoming.length > 0 && (
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {upcoming.map((u) => (
              <li key={u.key} className={clsx("rounded-lg px-2.5 py-1.5 text-xs font-medium", u.tone === "amber" ? "bg-amber-bg text-amber-ink" : "bg-info-bg text-info-ink")}>
                {u.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const LEGEND_LABEL: Record<SlotKind, string> = { sold: "Sold", house: "House ad", unsold_ended: "Ended", unsold: "Unsold" };

function LegendRow({ kind, value, sub }: { kind: SlotKind; value: number; sub: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <Swatch kind={kind} className="mt-[3px]" />
      <span className="w-16 shrink-0 font-semibold">{LEGEND_LABEL[kind]}</span>
      <span className="num w-8 shrink-0 text-right font-semibold">{n(value)}</span>
      <span className="min-w-0 flex-1 text-muted">{sub}</span>
    </li>
  );
}

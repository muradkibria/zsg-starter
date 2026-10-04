// Who carried it: the bag's assignments as a timeline, newest first, with the
// spells in between when nobody had it.

import type { ReactNode } from "react";
import { Link } from "react-router";
import { bagSpanLabel, londonDay, todayLondon, type BagDetail, type Stint } from "@digilite/shared";
import { useAuth } from "@/lib/auth";
import { cx } from "@/components/ui";
import { date, shortDate } from "@/lib/format";
import { Section } from "../bits";

const DAY = 86400_000;

type Item = { kind: "stint"; stint: Stint } | { kind: "spare"; start: string | null; end: string | null };

/** "14 Jun" this year, "14 Jun 2025" otherwise (London dates). */
function dayText(iso: string): string {
  return londonDay(new Date(iso)).slice(0, 4) === todayLondon().slice(0, 4) ? shortDate(iso) : date(iso);
}

export function StintsSection({ bag, className }: { bag: BagDetail; className?: string }) {
  const { can } = useAuth();
  const canViewRiders = can("riders.view");
  const canGive = can("riders.edit");
  const stints = bag.stints; // newest first

  const items: Item[] = [];
  if (stints.length && stints[0].end) items.push({ kind: "spare", start: stints[0].end, end: null });
  stints.forEach((s, i) => {
    items.push({ kind: "stint", stint: s });
    const older = stints[i + 1];
    if (older?.end && Date.parse(s.start) - Date.parse(older.end) > DAY) items.push({ kind: "spare", start: older.end, end: s.start });
  });

  return (
    <Section
      title="Who carried it"
      action={
        canGive && (
          <Link to={`/riders?give=${bag.id}`} className="text-[13px] font-semibold no-underline hover:underline">
            {bag.rider ? "Change rider" : "Give to a rider"}
          </Link>
        )
      }
      className={className}
    >
      {items.length === 0 ? (
        <p className="m-0 text-sm text-muted">No one has carried this bag yet.</p>
      ) : (
        <ol className="m-0 flex list-none flex-col p-0">
          {items.map((it, i) => {
            const lastItem = i === items.length - 1;
            if (it.kind === "spare") {
              return (
                <TimelineRow key={`spare-${i}`} dot="spare" last={lastItem}>
                  <span className="text-sm font-medium text-ink-2">No rider</span>
                  <span className="text-xs text-muted">
                    {it.end ? `${dayText(it.start!)} – ${dayText(it.end)}` : `since ${dayText(it.start!)} · ${bagSpanLabel(it.start!, null)}`}
                  </span>
                </TimelineRow>
              );
            }
            const s = it.stint;
            const current = !s.end;
            return (
              <TimelineRow key={s.assignmentId} dot={current ? "current" : "past"} last={lastItem}>
                <span className="text-sm font-semibold">
                  {canViewRiders ? (
                    <Link to={`/riders/${s.riderId}`} className="text-ink no-underline hover:text-accent hover:underline">
                      {s.riderName}
                    </Link>
                  ) : (
                    s.riderName
                  )}
                  {s.demo && <span className="ml-1 text-[11px] font-medium text-caption">(demo)</span>}
                </span>
                <span className="text-xs text-muted">
                  {dayText(s.start)} – {current ? "now" : dayText(s.end!)} · {bagSpanLabel(s.start, s.end)}
                </span>
              </TimelineRow>
            );
          })}
        </ol>
      )}
    </Section>
  );
}

function TimelineRow({ dot, last, children }: { dot: "current" | "past" | "spare"; last: boolean; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex w-3 shrink-0 flex-col items-center" aria-hidden="true">
        <span
          className={cx(
            "mt-1 size-3 shrink-0 rounded-full",
            dot === "current" && "bg-navy",
            dot === "past" && "bg-[#8fa3c8]",
            dot === "spare" && "border-2 border-line bg-white",
          )}
        />
        {!last && <span className="w-0.5 flex-1 bg-rule" />}
      </span>
      <span className={cx("flex min-w-0 flex-col gap-0.5", !last && "pb-3")}>{children}</span>
    </li>
  );
}

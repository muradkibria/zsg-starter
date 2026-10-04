// Shifts to check: approve as calculated, change the hours with a note, or
// open the day on the map. Checked items fold away underneath.

import { useState } from "react";
import { Link } from "react-router";
import clsx from "clsx";
import { AlertTriangle, Check, ChevronDown, MapPin } from "lucide-react";
import type { PayRange, PayReviewItem, PayrollResponse } from "@digilite/shared";
import { Button, EmptyState } from "@/components/ui";
import { dayLabel, shortDate } from "@/lib/format";
import { ChangeHoursForm, fmtHours, useDayActions } from "./parts";

const FIRST = 6;

export function ReviewQueue({ data, canChange }: { data: PayrollResponse; canChange: boolean }) {
  const [all, setAll] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const range: PayRange = { startDay: data.startDay, endDay: data.endDay };
  const open = data.review.filter((r) => !r.adjustment);
  const done = data.review.filter((r) => r.adjustment);
  const approved = data.status === "approved";
  const shown = all ? open : open.slice(0, FIRST);
  return (
    <section aria-labelledby="review-title" className="card flex flex-col gap-2.5 p-4 md:p-[18px]">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="review-title" className="m-0 font-display text-lg font-semibold">
          {open.length === 0
            ? "Nothing left to check"
            : `${open.length} ${open.length === 1 ? "shift" : "shifts"} ${approved ? "not checked" : "to check"}`}
        </h2>
        {open.length > 1 && <span className="text-xs text-muted">oldest first</span>}
      </div>
      {open.length > 0 && (
        <p className="m-0 text-xs text-muted">
          {approved
            ? "Not checked before approval, so paid as calculated."
            : "Approve as calculated or change the hours. Every change is saved with your name and a reason."}
        </p>
      )}
      {data.review.length === 0 && (
        <EmptyState title="Nothing odd this period" body="No long signal gaps, long stops or unusual shifts." icon={<Check className="size-6" />} />
      )}
      {shown.map((item) => (
        <ReviewCard key={item.id} item={item} range={range} canChange={canChange && !approved} />
      ))}
      {open.length > FIRST && (
        <Button variant="quiet" size="sm" className="h-11 md:h-8" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show ${open.length - FIRST} more`}
        </Button>
      )}
      {done.length > 0 && (
        <div className="border-t border-rule-soft pt-2">
          <button
            aria-expanded={showDone}
            onClick={() => setShowDone(!showDone)}
            className="flex min-h-11 w-full items-center gap-1.5 text-left text-[13px] font-semibold text-ink-2 md:min-h-9"
          >
            <Check className="size-4 text-green-ink" />
            Checked ({done.length})
            <ChevronDown className={clsx("ml-auto size-4 transition-transform", showDone && "rotate-180")} />
          </button>
          {showDone && (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 pt-1">
              {done.map((item) => (
                <li key={item.id} className="rounded-lg bg-paper px-3 py-2 text-xs text-ink-2">
                  <span className="font-semibold text-ink">{item.riderName}</span> · {dayLabel(item.day)} ·{" "}
                  {Math.abs(item.adjustment!.hours - item.calculatedHours) >= 0.005 ? (
                    <>
                      changed to <strong>{fmtHours(item.adjustment!.hours)}</strong> (was {fmtHours(item.calculatedHours)}) by {item.adjustment!.byName}: “
                      {item.adjustment!.note}”
                    </>
                  ) : (
                    <>
                      {fmtHours(item.hours)} approved as calculated by {item.adjustment!.byName}, {shortDate(item.adjustment!.at)}
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function ReviewCard({ item, range, canChange }: { item: PayReviewItem; range: PayRange; canChange: boolean }) {
  const [editing, setEditing] = useState(false);
  const actions = useDayActions(range);
  return (
    <article className="flex flex-col gap-1.5 rounded-[10px] border border-paper-2 border-l-[3px] border-l-amber-line px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <Link to={`/riders/${item.riderId}`} className="truncate font-bold text-ink no-underline hover:underline">
          {item.riderName}
        </Link>
        <span className="shrink-0 text-xs text-muted">
          {dayLabel(item.day)}
          {item.bagName ? ` · ${item.bagName}` : ""}
        </span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {item.reasons.map((f, i) => (
          <li key={i} className="flex items-start gap-1.5 text-xs leading-snug text-amber-ink">
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
            {f.text}
          </li>
        ))}
      </ul>
      {editing ? (
        <ChangeHoursForm
          initial={item.calculatedHours}
          saving={actions.saving}
          onCancel={() => setEditing(false)}
          onSave={(h, note) => actions.change(item.riderId, item.riderName, item.day, h, note, () => setEditing(false))}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          {canChange && (
            <>
              <Button size="sm" className="h-11 md:h-[30px]" loading={actions.saving} onClick={() => actions.approve(item.riderId, item.riderName, item.day, item.calculatedHours)}>
                Approve {fmtHours(item.calculatedHours)}
              </Button>
              <Button size="sm" className="h-11 md:h-[30px]" onClick={() => setEditing(true)}>
                Change
              </Button>
            </>
          )}
          {!canChange && <span className="text-xs text-muted">Calculated {fmtHours(item.calculatedHours)}</span>}
          {item.bagId && (
            <Link to={`/map?bag=${item.bagId}&day=${item.day}`} className="ml-auto inline-flex min-h-11 items-center gap-1 text-xs font-semibold no-underline md:min-h-0">
              <MapPin className="size-3.5" aria-hidden />
              See the day
            </Link>
          )}
        </div>
      )}
    </article>
  );
}

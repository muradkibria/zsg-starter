// "Before you download" (what's in the file, gaps kept, hand-overs, late
// points), a map of the sample bag-day for routes, and the first rows.

import clsx from "clsx";
import type { ExportPreview } from "@digilite/shared";
import { RouteMap } from "@/components/route/RouteMap";
import { EmptyState, Spinner } from "@/components/ui";
import { useRoute } from "@/lib/queries";
import { num, shortDate } from "@/lib/format";

const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const day = (d: string) => shortDate(`${d}T12:00:00Z`);

interface Check {
  tone: "green" | "amber" | "blue" | "grey";
  strong: string;
  rest: string;
}

export function checksFor(p: ExportPreview): Check[] {
  const out: Check[] = [];
  const across = `from ${plural(p.bags, "bag")} across ${plural(p.days, "day")}.`;
  if (p.type === "routes") out.push({ tone: "green", strong: plural(p.pointCount ?? 0, "location point"), rest: across });
  if (p.type === "shifts") out.push({ tone: "green", strong: plural(p.rowCount, "shift"), rest: across });
  if (p.type === "plays") out.push({ tone: "green", strong: plural(p.rowCount, "row") + " of ad plays", rest: `(per bag, day and ad) ${across}` });
  if (p.type === "zones") out.push({ tone: "green", strong: plural(p.rowCount, "row") + " of zone time", rest: `(per bag, day and zone) ${across}` });
  if (p.type === "routes" && p.gapCount > 0) {
    out.push({
      tone: "amber",
      strong: `${p.approximate ? "About " : ""}${plural(p.gapCount, "signal gap")} over ${p.signalGapMin} min`,
      rest: `${p.gapCount === 1 ? "is kept as a “no signal” row" : "are kept as “no signal” rows"}. Nothing is filled in or guessed.`,
    });
  }
  if (p.type === "shifts" && p.gapCount > 0) {
    out.push({
      tone: "amber",
      strong: `${plural(p.gapCount, "signal gap")} inside these shifts.`,
      rest: "Their time is in the “No signal” column and isn't paid unless your pay rules say so.",
    });
  }
  for (const h of p.handovers) {
    out.push(
      h.toRiderName
        ? {
            tone: "blue",
            strong: `${h.bagName} changed hands on ${day(h.day)}${h.fromRiderName && !p.ridersHidden ? ` (${h.fromRiderName} → ${h.toRiderName})` : ""}.`,
            rest: "Each row goes to whoever had the bag at the time.",
          }
        : {
            tone: "blue",
            strong: `${h.bagName} was handed back after ${day(h.day)}.`,
            rest: "Rows after that have no rider.",
          },
    );
  }
  if (p.lateCount > 0) {
    out.push({
      tone: "grey",
      strong: `${plural(p.lateCount, "point")} arrived late`,
      rest: "in batches after a gap and share one arrival time. Marked “sent late”.",
    });
  }
  if (p.noRiderDays > 0 && !p.ridersHidden) {
    out.push({ tone: "grey", strong: `${plural(p.noRiderDays, "bag-day")} had nobody assigned`, rest: "so the rider column is blank there." });
  }
  if (p.ridersHidden) out.push({ tone: "grey", strong: "Rider names are left out", rest: "because your role can't see riders." });
  return out;
}

const DOT: Record<Check["tone"], string> = { green: "bg-st-now", amber: "bg-st-idle", blue: "bg-logo", grey: "bg-caption" };

export function BeforeYouDownload({ preview, loading, error }: { preview: ExportPreview | undefined; loading: boolean; error: unknown }) {
  const checks = preview ? checksFor(preview) : [];
  const empty = preview && preview.rowCount === 0;
  const thumb = preview?.type === "routes" && preview.sampleBagDay && !empty ? preview.sampleBagDay : null;
  return (
    <section aria-labelledby="before-title" className="card flex flex-col gap-4 p-4 md:flex-row md:p-[18px]">
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 id="before-title" className="m-0 font-display text-lg font-semibold">
            Before you download
          </h2>
          {preview && !loading && (
            <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-semibold", empty ? "bg-amber-bg text-amber-ink" : "bg-green-bg text-green-ink")}>
              {empty ? "Nothing to export" : checks.length > 1 ? `Ready · ${checks.length} things to know` : "Ready"}
            </span>
          )}
          {loading && <span className="text-xs text-muted">Checking…</span>}
        </div>
        {!preview && loading && <Spinner label="Checking what's in the export…" />}
        {!!error && !loading && <p className="m-0 text-sm text-red-ink">{error instanceof Error ? error.message : "Couldn't check this export"}</p>}
        {preview && empty && (
          <p className="m-0 text-sm text-muted">No data for this choice. Try more days, or other bags or riders.</p>
        )}
        {preview && !empty && (
          <ul className={clsx("m-0 flex list-none flex-col gap-2 p-0 transition-opacity", loading && "opacity-60")}>
            {checks.map((c, i) => (
              <li key={i} className="flex items-start gap-2.5 text-[13px] leading-snug text-ink-2">
                <span className={clsx("mt-[5px] size-2 shrink-0 rounded-full", DOT[c.tone])} aria-hidden />
                <span>
                  <strong className="font-bold text-ink">{c.strong}</strong> {c.rest}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {thumb && <RouteThumb bagId={thumb.bagId} day={thumb.day} label={`${thumb.bagName} · ${day(thumb.day)}`} />}
    </section>
  );
}

function RouteThumb({ bagId, day, label }: { bagId: string; day: string; label: string }) {
  const route = useRoute(bagId, day);
  return (
    <div className="relative h-[180px] w-full shrink-0 overflow-hidden rounded-xl border border-rule bg-paper-3 md:h-[176px] md:w-[300px] [&_.maplibregl-ctrl-attrib]:hidden">
      {route.data ? <RouteMap route={route.data} interactive={false} showZones={false} className="absolute inset-0" /> : <Spinner label="Loading the map…" />}
      <span className="absolute top-2 left-2 z-10 rounded-full bg-white/95 px-2 py-0.5 text-[11px] font-bold text-info-ink shadow-sm">{label}</span>
      {/* The map's own credit is too big for a thumbnail; the same credit, small. */}
      <span className="absolute right-1.5 bottom-1 z-10 rounded bg-white/80 px-1 text-[9px] text-caption">© OpenStreetMap · OpenFreeMap</span>
    </div>
  );
}

const STATE_TONE: Record<string, string> = { Moving: "text-green-ink", Stopped: "text-amber-ink", "—": "text-muted" };

export function PreviewTable({ preview, loading }: { preview: ExportPreview | undefined; loading: boolean }) {
  if (!preview) return null;
  const cols = preview.columns;
  const stateCol = cols.findIndex((c) => c.key === "state");
  const lateCol = cols.findIndex((c) => c.key === "late");
  return (
    <section aria-labelledby="preview-title" className={clsx("card overflow-hidden transition-opacity", loading && "opacity-60")}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 pt-3 pb-2.5 md:px-[18px]">
        <h2 id="preview-title" className="m-0 font-display text-base font-semibold">
          Preview
        </h2>
        {preview.sampleNote && <span className="text-xs text-muted">{preview.sampleNote}</span>}
      </div>
      {preview.sample.length === 0 ? (
        <EmptyState title="No rows" body="Nothing was recorded for this choice." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-xs">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={clsx("border-y border-rule px-3 py-2 font-semibold whitespace-nowrap text-muted first:pl-4 md:first:pl-[18px]", c.numeric ? "text-right" : "text-left")}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.sample.map((r, i) => (
                <tr key={i} className={clsx("border-b border-rule-soft", r.tone === "gap" ? "bg-paper text-muted" : "text-ink")}>
                  {r.cells.map((v, j) => (
                    <td
                      key={j}
                      className={clsx(
                        "num h-[29px] px-3 whitespace-nowrap first:pl-4 md:first:pl-[18px]",
                        cols[j]?.numeric && "text-right",
                        j === stateCol && "font-semibold",
                        j === stateCol && (r.tone === "gap" ? "text-muted" : STATE_TONE[String(v)] ?? ""),
                        j === lateCol && v === "Yes" && "font-semibold text-info-ink",
                        cols[j]?.key === "zones" && "max-w-[320px] truncate",
                      )}
                      title={cols[j]?.key === "zones" && v ? String(v) : undefined}
                    >
                      {v === null || v === "" ? (j === lateCol ? "" : "—") : typeof v === "number" ? v.toLocaleString("en-GB", { maximumFractionDigits: 6 }) : v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t border-paper-2 px-4 py-2.5 text-xs text-muted md:px-[18px]">
        Showing {num(preview.sample.length)} of {preview.approximate ? "about " : ""}
        {num(preview.rowCount)} rows · sorted by bag, then {preview.type === "routes" ? "time" : "date"} · times are London time
      </div>
    </section>
  );
}

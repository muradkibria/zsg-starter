// "Needs attention" — every issue links to the view that fixes it.

import { Link } from "react-router";
import clsx from "clsx";
import { AlertTriangle, ChevronRight, Info } from "lucide-react";
import { STATUS_ORDER } from "@digilite/shared";
import { useFleet } from "@/lib/queries";
import { ErrorState, Page, PageHeader, Spinner, StatusIcon, EmptyState } from "@/components/ui";

export default function AlertsPage() {
  const fleet = useFleet();
  const f = fleet.data;
  return (
    <Page width="narrow">
      <PageHeader title="Needs attention" sub="Things across the fleet worth fixing, most urgent first." />
      {fleet.isLoading && <Spinner />}
      {fleet.error && <ErrorState error={fleet.error} retry={() => void fleet.refetch()} />}
      {f && (
        <>
          <Link to="/map" className="card flex items-center gap-4 p-4 no-underline text-ink">
            <div className="flex-1">
              <div className="text-xs text-muted">Out now</div>
              <div className="font-display text-3xl font-semibold">
                {f.counts.now} <span className="text-base font-medium text-muted">of {f.total}</span>
              </div>
            </div>
            <div className="flex h-3 w-40 overflow-hidden rounded-full">
              {STATUS_ORDER.map((s) => (
                <div
                  key={s}
                  style={{ flexGrow: f.counts[s], background: `var(--color-st-${s})` }}
                  className="h-full border-r-2 border-white last:border-r-0"
                />
              ))}
            </div>
            <ChevronRight className="size-5 text-muted" />
          </Link>
          <div className="flex flex-wrap gap-3 text-xs text-ink-2">
            {STATUS_ORDER.map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <StatusIcon status={s} size={14} /> {f.counts[s]}
              </span>
            ))}
          </div>
          {f.attention.length === 0 ? (
            <EmptyState title="Nothing needs attention" body="Every bag is on London time, playing the fleet loop and reporting in." />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {f.attention.map((a) => (
                <li key={a.kind}>
                  <Link to={a.href} className="card flex items-center gap-4 p-4 no-underline text-ink hover:border-navy">
                    <span
                      className={clsx(
                        "num flex size-12 shrink-0 items-center justify-center rounded-xl font-display text-xl font-semibold",
                        a.severity === "red" && "bg-red-bg text-red-ink",
                        a.severity === "amber" && "bg-amber-bg text-amber-ink",
                        a.severity === "info" && "bg-info-bg text-info-ink",
                      )}
                    >
                      {a.count}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[15px] font-semibold">
                        {a.severity === "info" ? <Info className="size-4 text-info-ink" /> : <AlertTriangle className={clsx("size-4", a.severity === "red" ? "text-red-ink" : "text-amber-ink")} />}
                        {a.title}
                      </span>
                      <span className="mt-0.5 block text-[13px] text-muted">{a.body}</span>
                    </span>
                    <ChevronRight className="size-5 shrink-0 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Page>
  );
}

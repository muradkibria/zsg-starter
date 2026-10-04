// Sent: every attempt to send a loop to bags, what the gate decided, and where
// each send has got to now (worked out live from what the bags report).

import { useState } from "react";
import { Link } from "react-router";
import { ChevronDown } from "lucide-react";
import clsx from "clsx";
import type { LoopDeployment } from "@digilite/shared";
import { EmptyState, ErrorState, Spinner } from "@/components/ui";
import { when } from "@/lib/format";
import { useDeployments } from "./api";
import { DeliveryList, DeploymentPill, deliverySummary, targetText } from "./bits";

export function SentTab() {
  const sent = useDeployments();
  if (sent.isLoading) return <Spinner label="Loading sends…" />;
  if (sent.error) return <ErrorState error={sent.error} retry={() => void sent.refetch()} />;
  const list = sent.data ?? [];
  if (!list.length) {
    return (
      <div className="card">
        <EmptyState
          title="Nothing sent yet"
          body="Open a loop and send it — try it on the test bag first. Every send is recorded here, including dry runs and blocked ones."
        />
      </div>
    );
  }
  return (
    <section aria-label="Sent" className="flex flex-col gap-3">
      <p className="m-0 text-xs text-muted">Where each send has got to comes from what the bags report, and updates by itself.</p>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {list.map((d) => (
          <li key={d.id}>
            <DeploymentCard d={d} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DeploymentCard({ d, showLoop = true }: { d: LoopDeployment; showLoop?: boolean }) {
  const [open, setOpen] = useState(false);
  const summary = deliverySummary(d);
  return (
    <article className="card flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <DeploymentPill status={d.status} />
        <span className="min-w-0 text-sm [overflow-wrap:anywhere]">
          {showLoop ? (
            <Link to={`/loops/${d.loopId}`} className="font-semibold text-ink">
              {d.loopName}
            </Link>
          ) : (
            <span className="font-semibold">Sent</span>
          )}{" "}
          <span className="text-muted">to {targetText(d.target, d)}</span>
        </span>
        <span className="ml-auto text-xs text-muted">
          {when(d.createdAt)}
          {d.requestedBy && ` · ${d.requestedBy}`}
        </span>
      </div>
      {d.message && <p className="m-0 text-[13px] text-ink-2">{d.message}</p>}
      {summary && <p className="m-0 text-xs text-muted">{summary}</p>}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-9 items-center gap-1 self-start text-[13px] font-semibold text-accent"
      >
        Bag by bag
        <ChevronDown className={clsx("size-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && <DeliveryList rows={d.delivery} limit={12} />}
    </article>
  );
}

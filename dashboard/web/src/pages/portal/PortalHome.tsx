// The portal's first page: the client's campaigns. With just one, it goes
// straight to it.

import { Link, Navigate } from "react-router";
import { ChevronRight, Megaphone } from "lucide-react";
import type { PortalCampaign } from "@digilite/shared";
import { EmptyState, ErrorState, Page, PageHeader, Spinner } from "@/components/ui";
import { CreativeThumb } from "../campaigns/components/CreativeThumb";
import { StatusPill } from "../campaigns/components/StatusPill";
import { dayRange, n, screenHours } from "../campaigns/format";
import { usePortalOverview } from "./api";

export default function PortalHome() {
  const overview = usePortalOverview();
  const data = overview.data;
  if (data?.campaigns.length === 1) return <Navigate to={`/portal/campaigns/${data.campaigns[0].id}`} replace />;

  return (
    <Page width="narrow">
      <PageHeader title={data ? `Welcome, ${data.client.name}` : "Welcome"} sub="Select a campaign to see its figures and download its reports." />
      {overview.isLoading && <Spinner label="Loading your campaigns…" />}
      {overview.error && <ErrorState error={overview.error} retry={() => void overview.refetch()} />}
      {data && data.campaigns.length === 0 && (
        <EmptyState
          icon={<Megaphone className="size-6" />}
          title="No campaigns to show yet"
          body="Your campaigns appear here once they're confirmed. If you were expecting one, please contact your DigiLite account manager."
        />
      )}
      {data && data.campaigns.length > 1 && (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {data.campaigns.map((c) => (
            <li key={c.id}>
              <CampaignCard c={c} />
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

function CampaignCard({ c }: { c: PortalCampaign }) {
  return (
    <Link
      to={`/portal/campaigns/${c.id}`}
      className="card flex items-center gap-4 p-4 text-ink no-underline transition-shadow hover:shadow-[var(--shadow-float)] md:p-5"
    >
      <CreativeThumb id={c.thumbId} name={c.name} base="/portal/ads" size="lg" className="hidden sm:inline-flex" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display text-lg font-semibold">{c.name}</span>
          <StatusPill status={c.status} />
        </div>
        <span className="text-[13px] text-muted">{dayRange(c.startDay, c.endDay, { long: true })}</span>
        <span className="text-[13px] text-ink-2">
          <span className="num font-semibold text-ink">{n(c.plays)}</span> plays · <span className="font-semibold text-ink">{screenHours(c.playSeconds)}</span> on screen
          {c.bagsCarrying > 0 && <> · on {n(c.bagsCarrying)} {c.bagsCarrying === 1 ? "bag" : "bags"} in the last 7 days</>}
        </span>
      </div>
      <ChevronRight className="size-5 shrink-0 text-caption" />
    </Link>
  );
}

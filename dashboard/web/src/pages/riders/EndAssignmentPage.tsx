// End a rider's assignment, step by step: their last day, what happens to the
// bag, final pay and what happens to their records. Their history stays
// attached to the dates they had the bag.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import clsx from "clsx";
import { Info } from "lucide-react";
import { addDays, londonDay, todayLondon, type RiderDetail } from "@digilite/shared";
import { useAuth } from "@/lib/auth";
import { useFeedback } from "@/components/feedback";
import { Button, Card, Chip, ErrorState, Input, LinkButton, Notice, Page, Spinner } from "@/components/ui";
import { dayLabel, hours, longDay, shortDate } from "@/lib/format";
import { useEndAssignment, useRider, useRiderPay, useRiders } from "./api";
import { DocsPill, firstName, RadioCard } from "./bits";

const REASONS = ["Moved away", "Found other work", "Stopped riding", "Contract ended", "Didn't work out"];

export default function EndAssignmentPage() {
  const { id = "" } = useParams();
  const rider = useRider(id);
  if (rider.isLoading)
    return (
      <Narrow>
        <Spinner />
      </Narrow>
    );
  if (rider.error || !rider.data)
    return (
      <Narrow>
        <ErrorState error={rider.error ?? new Error("Rider not found")} retry={() => void rider.refetch()} />
      </Narrow>
    );
  return <EndView r={rider.data} />;
}

/** A centred, readable column (Page's own max width can't be overridden by a class). */
function Narrow({ children }: { children: ReactNode }) {
  return (
    <Page>
      <div className="mx-auto flex w-full max-w-[860px] flex-col gap-5">{children}</div>
    </Page>
  );
}

function Step({ n, title, children }: { n: number; title: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <span className="num flex size-7 shrink-0 items-center justify-center rounded-full bg-navy text-[13px] font-bold text-white" aria-hidden>
          {n}
        </span>
        <h2 className="m-0 font-display text-lg font-semibold">{title}</h2>
      </div>
      <div className="mt-4 flex flex-col gap-3 md:pl-10">{children}</div>
    </Card>
  );
}

function Row({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-rule-soft py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <span className="text-sm text-ink-2">
        {label}
        {sub && <span className="block text-xs text-muted">{sub}</span>}
      </span>
      <span className="text-sm font-semibold sm:text-right">{value}</span>
    </div>
  );
}

function EndView({ r }: { r: RiderDetail }) {
  const { can } = useAuth();
  const nav = useNavigate();
  const { toast } = useFeedback();
  const today = todayLondon();
  const first = firstName(r.name);
  const bag = r.bag && !r.bag.upcoming ? r.bag : null;
  const minDay = bag ? londonDay(new Date(bag.since)) : addDays(today, -365);

  const [mode, setMode] = useState<"today" | "other">("today");
  const [other, setOther] = useState(addDays(today, -1) < minDay ? today : addDays(today, -1));
  const lastDay = mode === "today" ? today : other;
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);

  const riders = useRiders();
  const waiting = useMemo(
    () =>
      (riders.data?.riders ?? [])
        .filter((x) => x.stage === "waiting" && x.id !== r.id)
        .sort((a, b) => (a.joinedAt ?? "").localeCompare(b.joinedAt ?? "") || a.name.localeCompare(b.name)),
    [riders.data, r.id],
  );
  const [action, setAction] = useState<string | null>(null); // a waiting rider's id, or "spare"
  useEffect(() => {
    if (action === null && riders.data) setAction(waiting[0]?.id ?? "spare");
  }, [riders.data, waiting, action]);
  const next = waiting.find((w) => w.id === action) ?? null;

  const pay = useRiderPay(r.id, lastDay);
  const end = useEndAssignment(r.id);

  const dayOk = lastDay >= minDay && lastDay <= today;
  const reasonError = tried && !reason.trim() ? "Say why the assignment is ending" : null;

  if (r.stage === "ended") {
    return (
      <Narrow>
        <Crumbs r={r} />
        <Notice tone="info" icon={<Info className="size-4" />}>
          {first} already ended{r.endedAt ? ` on ${shortDate(r.endedAt)}` : ""}. <Link to={`/riders/${r.id}`}>Back to {first}'s page</Link>
        </Notice>
      </Narrow>
    );
  }
  if (!can("riders.edit")) {
    return (
      <Narrow>
        <Crumbs r={r} />
        <Notice tone="amber">You can see riders but can't end assignments.</Notice>
      </Narrow>
    );
  }

  const submit = () => {
    setTried(true);
    if (!reason.trim() || !dayOk) return;
    end.mutate(
      {
        lastDay,
        bagAction: bag && next ? "give" : "spare",
        nextRiderId: bag && next ? next.id : undefined,
        reason: reason.trim(),
      },
      {
        onSuccess: (res) => {
          toast(res.message);
          nav(`/riders/${r.id}`);
        },
        onError: (e) => toast(e.message, "error"),
      },
    );
  };

  const confirmLabel = bag
    ? next
      ? `End assignment and give ${bag.name} to ${firstName(next.name)}`
      : `End assignment · ${bag.name} back to the depot`
    : `Mark ${first} as ended`;

  return (
    <Narrow>
      <Crumbs r={r} />
      <header>
        <h1 className="m-0 font-display text-[28px] leading-tight font-semibold tracking-[-0.02em] md:text-[32px]">
          {bag ? `End ${first}'s assignment` : `Mark ${first} as ended`}
        </h1>
        <p className="m-0 mt-1.5 text-sm text-muted">
          {bag
            ? `${first} carries ${bag.name}. Their history stays attached to the dates they had it.`
            : r.bag?.upcoming
              ? `${first} is booked to get ${r.bag.name} from ${shortDate(r.bag.since)}. Ending cancels that booking.`
              : `${first} isn't carrying a bag. This moves them to Ended; their history stays as it is.`}
        </p>
      </header>

      <Step n={1} title="Last day">
        <div className="flex flex-wrap items-center gap-2">
          <ChoiceButton active={mode === "today"} onClick={() => setMode("today")}>
            Today, {shortDate(`${today}T12:00:00Z`)}
          </ChoiceButton>
          <ChoiceButton active={mode === "other"} onClick={() => setMode("other")}>
            Another date
          </ChoiceButton>
          {mode === "other" && (
            <Input
              type="date"
              aria-label="Last day"
              value={other}
              min={minDay}
              max={today}
              onChange={(e) => e.target.value && setOther(e.target.value)}
              className="w-auto"
            />
          )}
        </div>
        {!dayOk ? (
          <p className="m-0 text-[13px] font-semibold text-red-ink">
            {lastDay > today ? "The last day can't be in the future." : `${first} got ${bag?.name ?? "the bag"} on ${dayLabel(minDay)}. Pick that day or later.`}
          </p>
        ) : (
          bag && (
            <p className="m-0 text-[13px] text-muted">
              {bag.name}'s data counts towards {first} until the end of {longDay(lastDay)}.
            </p>
          )
        )}
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 p-0 text-[13px] font-semibold">Why is it ending?</legend>
          <div className="flex flex-wrap gap-2">
            {REASONS.map((x) => (
              <Chip key={x} active={reason === x} onClick={() => setReason(x)}>
                {x}
              </Chip>
            ))}
          </div>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Or write a reason" maxLength={500} aria-label="Reason" />
          {reasonError && <span className="text-xs font-medium text-red-ink">{reasonError}</span>}
        </fieldset>
      </Step>

      {bag && (
        <Step n={2} title={`What happens to ${bag.name}`}>
          {riders.isLoading && <Spinner />}
          {riders.data && (
            <div className="flex flex-col gap-2" role="radiogroup" aria-label={`What happens to ${bag.name}`}>
              {waiting.map((w) => (
                <RadioCard key={w.id} name="bag-next" checked={action === w.id} onChange={() => setAction(w.id)}>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">Give it to {w.name}</span>
                    {w.docs.state !== "ok" && <DocsPill docs={w.docs} />}
                  </span>
                  <span className="block text-xs text-muted">
                    Waiting for a bag{w.joinedAt ? ` · joined ${shortDate(w.joinedAt)}` : ""} · gets it from {dayLabel(addDays(lastDay, 1))}
                  </span>
                </RadioCard>
              ))}
              <RadioCard name="bag-next" checked={action === "spare"} onChange={() => setAction("spare")}>
                <span className="block text-sm font-semibold">Back to the depot as a spare</span>
                <span className="block text-xs text-muted">We'll flag it if it goes out without a rider</span>
              </RadioCard>
              {waiting.length === 0 && <p className="m-0 text-[13px] text-muted">No riders are waiting for a bag right now.</p>}
            </div>
          )}
        </Step>
      )}

      <Step n={bag ? 3 : 2} title="Final pay and records">
        <div className="flex flex-col">
          <Row
            label="Hours since the last pay run"
            sub={pay.data?.lastApproved ? `Since ${shortDate(`${pay.data.fromDay}T12:00:00Z`)}, up to ${shortDate(`${lastDay}T12:00:00Z`)}` : undefined}
            value={
              pay.isLoading
                ? "…"
                : pay.data?.lastApproved && pay.data.paidSeconds != null
                  ? `${hours(pay.data.paidSeconds)}, paid in the next run`
                  : "Paid in the next pay run"
            }
          />
          <Row label={`${first}'s records`} value="Kept permanently" />
        </div>
        <p className="m-0 text-xs text-muted">
          Contact details, documents, routes and hours all stay on record, attached to the dates {first} {bag ? `carried ${bag.name}` : "worked"}.
        </p>
      </Step>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <LinkButton to={`/riders/${r.id}`} size="lg" className="w-full sm:w-auto">
          Cancel
        </LinkButton>
        <Button variant="primary" size="lg" loading={end.isPending} disabled={!dayOk} onClick={submit} className="w-full whitespace-normal sm:w-auto">
          {confirmLabel}
        </Button>
      </div>
    </Narrow>
  );
}

function Crumbs({ r }: { r: RiderDetail }) {
  return (
    <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
      <Link to="/riders" className="text-accent no-underline hover:underline">
        Riders
      </Link>
      <span className="mx-1.5 text-caption">/</span>
      <Link to={`/riders/${r.id}`} className="text-accent no-underline hover:underline">
        {r.name}
      </Link>
    </nav>
  );
}

function ChoiceButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        "h-11 rounded-[10px] border px-4 text-sm font-semibold transition-colors",
        active ? "border-navy bg-tint-2 text-ink ring-1 ring-navy" : "border-line bg-white text-ink hover:bg-paper",
      )}
    >
      {children}
    </button>
  );
}

// "Give a bag": pick a rider for a bag (?give=<bagId>, linked from the bag page)
// or pick a spare bag for a rider (?assign=<riderId>). Both end in one POST
// /riders/:id/assign — the bag's previous rider keeps every day they had it.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { AlertTriangle, Info } from "lucide-react";
import { addDays, STATUS_LABEL, todayLondon, type Lifecycle, type RiderListItem, type SpareBag } from "@digilite/shared";
import { useBag } from "@/lib/queries";
import { useAuth } from "@/lib/auth";
import { useFeedback } from "@/components/feedback";
import { Avatar, Button, ErrorState, Input, Notice, Pill, Segmented, Spinner, StatusIcon } from "@/components/ui";
import { longDay, shortDate, when } from "@/lib/format";
import { useAssignBag, useRider, useRiders, useSpareBags } from "./api";
import { DemoPill, DocsPill, firstName, RadioCard, Sheet, StagePill } from "./bits";

export type GiveMode = { kind: "bag"; bagId: string } | { kind: "rider"; riderId: string };

const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  active: "Active",
  storage: "In storage",
  repair: "In repair",
  lost: "Lost",
  retired: "Retired",
};

export function GiveBagSheet({ mode, onClose }: { mode: GiveMode | null; onClose: () => void }) {
  if (!mode) return null;
  return mode.kind === "bag" ? <ChooseRider bagId={mode.bagId} onClose={onClose} /> : <ChooseBag riderId={mode.riderId} onClose={onClose} />;
}

// ── Shared: when it starts ────────────────────────────────────────────────────
function StartPicker({ value, onChange }: { value: string | null; onChange: (d: string | null) => void }) {
  const today = todayLondon();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] font-semibold">Starts</span>
        <Segmented
          label="When it starts"
          value={value ? "day" : "now"}
          onChange={(v) => onChange(v === "now" ? null : today)}
          options={[
            { value: "now", label: "Now" },
            { value: "day", label: "From a date" },
          ]}
        />
      </div>
      {value && (
        <Input
          type="date"
          aria-label="Start date"
          value={value}
          min={addDays(today, -90)}
          max={addDays(today, 30)}
          onChange={(e) => e.target.value && onChange(e.target.value)}
        />
      )}
    </div>
  );
}

function startWords(startDay: string | null) {
  return startDay ? `the start of ${longDay(startDay)}` : "now";
}

function useGive(onClose: () => void) {
  const assign = useAssignBag();
  const { toast } = useFeedback();
  return {
    pending: assign.isPending,
    give: (riderId: string, bagId: string, startDay: string | null) =>
      assign.mutate(
        { riderId, bagId, startDay: startDay ?? undefined },
        {
          onSuccess: (r) => {
            toast(r.message);
            onClose();
          },
          onError: (e) => toast(e.message, "error"),
        },
      ),
  };
}

// ── A rider for this bag ──────────────────────────────────────────────────────
function riderOrder(a: RiderListItem, b: RiderListItem) {
  return (a.joinedAt ?? "").localeCompare(b.joinedAt ?? "") || a.name.localeCompare(b.name);
}

function ChooseRider({ bagId, onClose }: { bagId: string; onClose: () => void }) {
  const { can } = useAuth();
  const bag = useBag(bagId);
  const riders = useRiders();
  const [riderId, setRiderId] = useState<string | null>(null);
  const [startDay, setStartDay] = useState<string | null>(null);
  const [showMoving, setShowMoving] = useState(false);
  const { give, pending } = useGive(onClose);

  const groups = useMemo(() => {
    const list = riders.data?.riders ?? [];
    return {
      waiting: list.filter((r) => r.stage === "waiting").sort(riderOrder),
      checked: list.filter((r) => r.stage === "checked").sort(riderOrder),
      moving: list.filter((r) => r.stage === "active" && r.bag && r.bag.id !== bagId).sort((a, b) => a.name.localeCompare(b.name)),
      applied: list.filter((r) => r.stage === "applied").length,
    };
  }, [riders.data, bagId]);

  useEffect(() => {
    if (!riderId && groups.waiting[0]) setRiderId(groups.waiting[0].id);
  }, [groups.waiting, riderId]);

  const b = bag.data;
  const chosen = riders.data?.riders.find((r) => r.id === riderId) ?? null;
  const bagName = b?.name ?? "this bag";

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Give ${bagName} to a rider`}
      sub={
        b ? (
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusIcon status={b.status} size={14} />
            {STATUS_LABEL[b.status]} · seen {when(b.lastReportAt)}
            {b.isTestBag && <Pill tone="info">Test bag</Pill>}
          </span>
        ) : null
      }
      footer={
        can("riders.edit") ? (
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={!chosen || !b}
            loading={pending}
            onClick={() => chosen && b && give(chosen.id, b.id, startDay)}
          >
            {chosen ? `Give ${bagName} to ${firstName(chosen.name)}` : "Choose a rider"}
          </Button>
        ) : (
          <p className="m-0 text-sm text-muted">You can see riders but can't give out bags.</p>
        )
      }
    >
      {(bag.isLoading || riders.isLoading) && <Spinner />}
      {bag.error && <ErrorState error={bag.error} retry={() => void bag.refetch()} />}
      {riders.error && <ErrorState error={riders.error} retry={() => void riders.refetch()} />}
      {b && riders.data && (
        <div className="flex flex-col gap-4">
          {b.rider && (
            <Notice tone="info" icon={<Info className="size-4" />}>
              {bagName} is with <strong>{b.rider.name}</strong> now. Their assignment ends when the new one starts; their days stay theirs.
            </Notice>
          )}
          {b.lifecycle !== "active" && (
            <Notice tone="amber" icon={<AlertTriangle className="size-4" />}>
              {bagName} is marked as {LIFECYCLE_LABEL[b.lifecycle].toLowerCase()}. Change that on the bag's page if it's ready to go out.
            </Notice>
          )}

          <RiderGroup title="Waiting for a bag" riders={groups.waiting} value={riderId} onChange={setRiderId} empty="No riders are waiting for a bag." />
          {groups.checked.length > 0 && <RiderGroup title="Documents checked" riders={groups.checked} value={riderId} onChange={setRiderId} />}
          {groups.moving.length > 0 &&
            (showMoving || groups.moving.some((r) => r.id === riderId) ? (
              <RiderGroup title="Move from another bag" riders={groups.moving} value={riderId} onChange={setRiderId} moving bagName={bagName} />
            ) : (
              <button type="button" onClick={() => setShowMoving(true)} className="self-start text-[13px] font-semibold text-accent hover:underline">
                Or move a rider from another bag ({groups.moving.length})
              </button>
            ))}
          {groups.applied > 0 && (
            <p className="m-0 text-[13px] text-muted">
              {groups.applied} {groups.applied === 1 ? "rider is" : "riders are"} still waiting for documents to be checked.{" "}
              <Link to="/riders?stage=applied" onClick={onClose}>
                See them
              </Link>
            </p>
          )}

          <StartPicker value={startDay} onChange={setStartDay} />
          {chosen && (
            <p className="m-0 text-[13px] text-muted">
              {bagName}'s data counts towards {firstName(chosen.name)} from {startWords(startDay)}. Earlier data stays with whoever had it.
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}

function RiderGroup({
  title,
  riders,
  value,
  onChange,
  empty,
  moving,
  bagName,
}: {
  title: string;
  riders: RiderListItem[];
  value: string | null;
  onChange: (id: string) => void;
  empty?: string;
  moving?: boolean;
  bagName?: string;
}) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-2 p-0 text-[13px] font-semibold">{title}</legend>
      {riders.length === 0 && empty && <p className="m-0 text-[13px] text-muted">{empty}</p>}
      {riders.map((r) => (
        <RadioCard key={r.id} name="give-rider" checked={value === r.id} onChange={() => onChange(r.id)}>
          <span className="flex items-center gap-2.5">
            <Avatar name={r.name} size={32} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                <span className="truncate">{r.name}</span>
                {r.demo && <DemoPill />}
              </span>
              <span className="block text-xs text-muted">
                {moving && r.bag
                  ? `Carries ${r.bag.name} now — moves to ${bagName}`
                  : r.joinedAt
                    ? `Joined ${shortDate(r.joinedAt)}`
                    : "Ready for a bag"}
              </span>
              {r.docs.state !== "ok" && (
                <span className="mt-1 flex sm:hidden">
                  <DocsPill docs={r.docs} />
                </span>
              )}
            </span>
            {r.docs.state !== "ok" && (
              <span className="hidden shrink-0 sm:block">
                <DocsPill docs={r.docs} />
              </span>
            )}
          </span>
        </RadioCard>
      ))}
    </fieldset>
  );
}

// ── A bag for this rider ──────────────────────────────────────────────────────
function daysAgo(iso: string | null): number | null {
  return iso ? Math.floor((Date.now() - Date.parse(iso)) / 86_400_000) : null;
}

function ChooseBag({ riderId, onClose }: { riderId: string; onClose: () => void }) {
  const { can } = useAuth();
  const rider = useRider(riderId);
  const spare = useSpareBags();
  const [bagId, setBagId] = useState<string | null>(null);
  const [startDay, setStartDay] = useState<string | null>(null);
  const { give, pending } = useGive(onClose);

  const recent = (spare.data ?? []).filter((b) => b.status !== "gone");
  const old = (spare.data ?? []).filter((b) => b.status === "gone");
  useEffect(() => {
    if (bagId || !spare.data) return;
    const first = spare.data.find((b) => b.status !== "gone" && !b.isTestBag && b.lifecycle === "active");
    if (first) setBagId(first.id);
  }, [spare.data, bagId]);

  const r = rider.data;
  const chosen = spare.data?.find((b) => b.id === bagId) ?? null;
  const first = r ? firstName(r.name) : "";
  const blocked = r && (r.stage === "applied" || r.stage === "ended");

  return (
    <Sheet
      open
      onClose={onClose}
      title={r ? (r.bag && !r.bag.upcoming ? `Move ${first} to another bag` : `Give ${first} a bag`) : "Give a bag"}
      sub={
        r ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            <StagePill stage={r.stage} />
            {r.joinedAt && <span>Joined {shortDate(r.joinedAt)}</span>}
          </span>
        ) : null
      }
      footer={
        can("riders.edit") ? (
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={!chosen || !r || !!blocked}
            loading={pending}
            onClick={() => chosen && r && give(r.id, chosen.id, startDay)}
          >
            {chosen && r ? `Give ${chosen.name} to ${first}` : "Choose a bag"}
          </Button>
        ) : (
          <p className="m-0 text-sm text-muted">You can see riders but can't give out bags.</p>
        )
      }
    >
      {(rider.isLoading || spare.isLoading) && <Spinner />}
      {rider.error && <ErrorState error={rider.error} retry={() => void rider.refetch()} />}
      {spare.error && <ErrorState error={spare.error} retry={() => void spare.refetch()} />}
      {r && spare.data && (
        <div className="flex flex-col gap-4">
          {r.stage === "applied" && (
            <Notice tone="amber" icon={<AlertTriangle className="size-4" />}>
              {first}'s documents haven't been checked yet. Check them on{" "}
              <Link to={`/riders/${r.id}`} onClick={onClose}>
                {first}'s page
              </Link>{" "}
              before giving a bag.
            </Notice>
          )}
          {r.stage === "ended" && (
            <Notice tone="amber" icon={<AlertTriangle className="size-4" />}>
              {first} has ended. Bring them back on their page first.
            </Notice>
          )}
          <div className="flex items-center justify-between gap-3 rounded-xl bg-paper px-3.5 py-2.5 text-[13px]">
            <span className="font-semibold">Documents</span>
            {r.docs.state === "ok" ? (
              <span className="font-semibold text-green-ink">
                {r.docs.checked} of {r.docs.required} checked
              </span>
            ) : (
              <DocsPill docs={r.docs} />
            )}
          </div>
          {r.bag && !r.bag.upcoming && (
            <Notice tone="info" icon={<Info className="size-4" />}>
              {first} carries {r.bag.name} now. That assignment ends when the new one starts.
            </Notice>
          )}

          <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
            <legend className="mb-2 flex w-full items-baseline justify-between p-0 text-[13px] font-semibold">
              Seen in the last week
              <span className="font-normal text-muted">
                {spare.data.length} {spare.data.length === 1 ? "bag has" : "bags have"} no rider
              </span>
            </legend>
            {recent.length === 0 && <p className="m-0 text-[13px] text-muted">No spare bag has reported in the last week.</p>}
            {recent.map((b) => (
              <BagOption key={b.id} bag={b} checked={bagId === b.id} onChange={() => setBagId(b.id)} />
            ))}
          </fieldset>
          {old.length > 0 && (
            <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
              <legend className="mb-2 p-0 text-[13px] font-semibold">Not seen for over a week</legend>
              {old.map((b) => (
                <BagOption key={b.id} bag={b} checked={bagId === b.id} onChange={() => setBagId(b.id)} />
              ))}
            </fieldset>
          )}

          <StartPicker value={startDay} onChange={setStartDay} />
          {chosen && (
            <p className="m-0 text-[13px] text-muted">
              {chosen.name}'s data counts towards {first} from {startWords(startDay)}. Earlier data stays with whoever had it.
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}

function BagOption({ bag, checked, onChange }: { bag: SpareBag; checked: boolean; onChange: () => void }) {
  const gone = bag.status === "gone";
  const days = daysAgo(bag.lastReportAt);
  return (
    <RadioCard name="give-bag" checked={checked} onChange={onChange} tone={gone ? "red" : undefined}>
      <span className="flex items-center gap-2">
        <StatusIcon status={bag.status} size={16} />
        <span className={gone ? "text-sm font-semibold text-red-ink" : "text-sm font-semibold"}>
          {bag.name}
          {gone && ` · not seen for ${days != null ? `${days} days` : "a long time"}`}
        </span>
        {bag.isTestBag && <Pill tone="info">Test bag</Pill>}
        {bag.lifecycle !== "active" && <Pill tone="amber">{LIFECYCLE_LABEL[bag.lifecycle]}</Pill>}
      </span>
      <span className={gone ? "block text-xs text-red-ink" : "block text-xs text-muted"}>
        {gone
          ? bag.lastReportAt
            ? `Last seen ${shortDate(bag.lastReportAt)} · may need charging or a repair first`
            : "Never seen · check it before giving it out"
          : `Seen ${when(bag.lastReportAt)}`}
        {bag.lastRider && !gone ? ` · back from ${firstName(bag.lastRider.name)} since ${shortDate(bag.lastRider.until)}` : ""}
        {bag.isTestBag ? " · kept for trying changes" : ""}
      </span>
    </RadioCard>
  );
}

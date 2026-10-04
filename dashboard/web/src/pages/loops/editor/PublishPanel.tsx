// Send a loop to bags: test bag first, then everyone. The server's write gate
// decides what really happens (send, dry run or block); we show its answer and
// then each bag's delivery, live.

import { useMemo, useState } from "react";
import { Link } from "react-router";
import clsx from "clsx";
import { Ban, CheckCircle2, FlaskConical, Power, Search, Send, TriangleAlert } from "lucide-react";
import type { BagSummary, LoopDeployment, LoopDetail, LoopPublishResult, LoopPublishTarget } from "@digilite/shared";
import { useAuth } from "@/lib/auth";
import { useBags } from "@/lib/queries";
import { useFeedback } from "@/components/feedback";
import { Button, Card, CardHeader, Chip, Input, Notice, Spinner, StatusIcon } from "@/components/ui";
import { when } from "@/lib/format";
import { useLoopDeployments, usePublishLoop } from "../api";
import { DeliveryList, DeploymentPill, deliverySummary, plural, Sheet, targetText } from "../bits";

type Tone = "info" | "amber";

/** What the gate will do, worked out from the same rules the server uses — shown only when it matters. */
function gatePreview(p: LoopDetail["publish"], onlyTestBags: boolean): { tone: Tone; text: string } | null {
  if (p.writeMode === "off") {
    return { tone: "info", text: "Changes are switched off, so this is a dry run: it's recorded, but nothing reaches the bags." };
  }
  if (onlyTestBags) return null;
  if (p.writeMode === "test") return { tone: "amber", text: "Only the test bag can be changed right now, so this would be blocked." };
  if (!p.fleetWritesEnabled) {
    return { tone: "amber", text: "“Allow changes to the whole fleet” is off in Settings, so only the test bag can be changed. This would be blocked." };
  }
  return null;
}

const RESULT_TITLE: Record<LoopDeployment["status"], string> = {
  dry_run: "Dry run — nothing was sent",
  blocked: "Blocked — nothing was sent",
  sending: "Sending…",
  sent: "Sent",
  confirmed: "Sent and confirmed",
  partial: "Sent to some bags",
  failed: "Couldn't send",
};

export function PublishPanel({
  loop,
  itemsCount,
  nameClash,
  flush,
}: {
  loop: LoopDetail;
  itemsCount: number;
  nameClash: string | null;
  flush: () => Promise<boolean>;
}) {
  const { can } = useAuth();
  const { confirm, toast } = useFeedback();
  const publish = usePublishLoop(loop.id);
  const deployments = useLoopDeployments(loop.id);
  const bags = useBags();
  const [target, setTarget] = useState<LoopPublishTarget>("test");
  const [picked, setPicked] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [result, setResult] = useState<LoopPublishResult | null>(null);

  const p = loop.publish;
  const test = p.testBags[0] ?? null;
  const testIds = new Set(p.testBags.map((b) => b.id));
  const onlyTest = target === "test" || (target === "bags" && picked.length > 0 && picked.every((id) => testIds.has(id)));
  const preview = gatePreview(p, onlyTest);
  const lastTest = (deployments.data ?? []).find((d) => d.target === "test_bag" || d.delivery.some((r) => r.isTestBag));
  const testRow = lastTest?.delivery.find((r) => r.isTestBag);

  if (!can("loops.publish")) {
    return (
      <Card className="flex flex-col gap-2 p-4">
        <CardHeader title="Send to bags" />
        <p className="m-0 text-[13px] text-muted">Only the owner or operations can send loops to bags. The loop is saved, so they can send it from here.</p>
      </Card>
    );
  }

  const blockedReason =
    itemsCount === 0
      ? "Add at least one ad first."
      : nameClash
        ? `A loop called "${nameClash}" is already in Colorlight. Rename this one before sending, so bags can tell them apart.`
        : target === "bags" && !picked.length
          ? null
          : null;

  const label =
    target === "test"
      ? "Send to the test bag first"
      : target === "bags"
        ? picked.length
          ? `Send to ${plural(picked.length, "bag")}`
          : "Pick bags to send to"
        : `Send to all ${p.fleetBagCount} bags`;

  const send = async () => {
    if (target === "bags" && !picked.length) {
      setPicking(true);
      return;
    }
    if (target !== "test") {
      const count = target === "fleet" ? p.fleetBagCount : picked.length;
      const ok = await confirm({
        title: `Send "${loop.name}" to ${plural(count, "bag")}?`,
        body: (
          <>
            {preview ? preview.text : "Each bag downloads it the next time it connects and plays it from then on."}
            {target === "fleet" && !preview && " It becomes the fleet loop."}
          </>
        ),
        confirm: "Send",
      });
      if (!ok) return;
    }
    if (!(await flush())) {
      toast("Your latest changes aren't saved yet, so nothing was sent. Try again.", "error");
      return;
    }
    try {
      const r = await publish.mutateAsync(target === "bags" ? { target, bagIds: picked } : { target });
      setResult(r);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const targets: { value: LoopPublishTarget; label: string; right: React.ReactNode }[] = [
    {
      value: "test",
      label: test ? `Test bag (${test.name})` : "Test bag",
      right: test ? (
        <span className={clsx("text-xs font-semibold", test.online ? "text-green-ink" : "text-amber-ink")}>{test.online ? "Online" : "Offline"}</span>
      ) : null,
    },
    {
      value: "bags",
      label: "Pick bags",
      right: <span className="text-xs text-muted">{picked.length ? `${picked.length} picked` : "Choose…"}</span>,
    },
    { value: "fleet", label: "Whole fleet", right: <span className="text-xs text-muted">{plural(p.fleetBagCount, "bag")}</span> },
  ];

  return (
    <Card className="flex flex-col gap-4 p-4">
      <CardHeader title="Send to bags" />

      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className="mb-1.5 p-0 text-xs font-semibold text-muted">Send to</legend>
        {targets.map((t) => (
          <label
            key={t.value}
            className={clsx(
              "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[10px] border px-3 text-[13px]",
              target === t.value ? "border-[1.5px] border-navy bg-tint-2 font-semibold" : "border-rule hover:bg-paper",
            )}
          >
            <input
              type="radio"
              name={`target-${loop.id}`}
              value={t.value}
              checked={target === t.value}
              onChange={() => {
                setTarget(t.value);
                setResult(null);
                if (t.value === "bags" && !picked.length) setPicking(true);
              }}
              className="m-0 accent-navy"
            />
            <span className="flex-1">{t.label}</span>
            {t.right}
          </label>
        ))}
        {target === "bags" && picked.length > 0 && (
          <button type="button" onClick={() => setPicking(true)} className="h-9 self-start text-[13px] font-semibold text-accent">
            Change the bags
          </button>
        )}
      </fieldset>

      <ol aria-label="Steps" className="m-0 flex list-none flex-col p-0">
        <li className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className="flex size-6 items-center justify-center rounded-full bg-navy text-xs font-bold text-white">1</span>
            <span className="my-1 w-0.5 flex-1 bg-rule" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 pb-3">
            <span className="text-sm font-bold">Try on the test bag{test ? ` (${test.name})` : ""}</span>
            {!test ? (
              <Notice tone="amber" icon={<TriangleAlert className="size-4" />}>
                No test bag is set up.
              </Notice>
            ) : !test.online ? (
              <div className="flex gap-2 rounded-[10px] border border-amber-line bg-amber-bg px-2.5 py-2 text-xs leading-snug text-amber-ink">
                <Power className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {test.offlineDays != null && test.offlineDays >= 1 ? `Offline for ${plural(test.offlineDays, "day")}.` : "Offline right now."} Switch it on to test; it downloads the
                  loop as soon as it connects.
                </span>
              </div>
            ) : (
              <span className="text-xs text-green-ink">Online now — it picks up a new loop within a minute or two.</span>
            )}
            {testRow && lastTest && (
              <span className="text-xs text-muted">
                Last try {when(lastTest.createdAt)}: <strong className="text-ink-2">{testRow.label}</strong>
              </span>
            )}
          </div>
        </li>
        <li className="flex gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full border-[1.5px] border-line bg-white text-xs font-bold text-muted">2</span>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-sm font-semibold text-ink-2">Then everyone</span>
            <span className="text-xs leading-snug text-muted">
              Sending to every bag needs changes switched on for the fleet on the server, and the owner's "Allow changes to the whole fleet" switch in{" "}
              <Link to="/settings?section=changes">Settings</Link>.
            </span>
            <span className="text-xs text-ink-2">
              Now: changes {p.writeMode === "off" ? "off (dry run)" : p.writeMode === "test" ? "on for the test bag only" : "on for the fleet"} · fleet switch{" "}
              {p.fleetWritesEnabled ? "on" : "off"}
            </span>
          </div>
        </li>
      </ol>

      {blockedReason && (
        <Notice tone="amber" icon={<TriangleAlert className="size-4" />}>
          {blockedReason}
        </Notice>
      )}
      {!blockedReason && preview && (
        <Notice tone={preview.tone} icon={preview.tone === "info" ? <FlaskConical className="size-4" /> : <Ban className="size-4" />}>
          {preview.text}
        </Notice>
      )}

      <div className="flex flex-col gap-1.5">
        <Button variant="primary" size="lg" onClick={() => void send()} loading={publish.isPending} disabled={!!blockedReason} icon={<Send className="size-4" />}>
          {label}
        </Button>
        <span className="text-center text-xs text-muted">Offline bags update when they next connect.</span>
      </div>

      {result && <ResultBox result={result} />}

      <BagPicker
        open={picking}
        bags={bags.data ?? []}
        loading={bags.isLoading}
        initial={picked}
        onClose={() => {
          setPicking(false);
          if (!picked.length && target === "bags") setTarget("test");
        }}
        onPick={(ids) => {
          setPicked(ids);
          setPicking(false);
          if (!ids.length && target === "bags") setTarget("test");
        }}
      />
    </Card>
  );
}

function ResultBox({ result }: { result: LoopPublishResult }) {
  const d = result.deployment;
  const ok = d.status === "sent" || d.status === "confirmed";
  const tone = ok ? "border-green-bg bg-green-bg text-green-ink" : d.status === "dry_run" ? "border-info-bg bg-info-bg text-info-ink" : d.status === "partial" ? "border-amber-line bg-amber-bg text-amber-ink" : "border-red-line bg-red-bg text-red-ink";
  const Icon = ok ? CheckCircle2 : d.status === "dry_run" ? FlaskConical : d.status === "blocked" ? Ban : TriangleAlert;
  return (
    <div role="status" className={clsx("flex flex-col gap-2 rounded-xl border px-3.5 py-3", tone)}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <div className="text-sm font-bold">
            {RESULT_TITLE[d.status]}
            {ok && ` to ${targetText(d.target, d)}`}
          </div>
          {d.message && <div className="text-[13px]">{d.message}</div>}
        </div>
      </div>
      {d.steps.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0 pl-6 text-xs">
          {d.steps.map((s, i) => (
            <li key={i}>
              {s.label} — <strong>{s.result === "dry_run" ? "dry run" : s.result === "done" ? "done" : s.result}</strong>
            </li>
          ))}
        </ul>
      )}
      <Link to="/loops?tab=sent" className="pl-6 text-xs font-semibold">
        Recorded in Sent
      </Link>
    </div>
  );
}

/** Bag by bag: the latest send for this loop, or where it plays now. */
export function DeliveryCard({ loop }: { loop: LoopDetail }) {
  const deployments = useLoopDeployments(loop.id);
  const latest = deployments.data?.[0] ?? null;
  const earlier = (deployments.data?.length ?? 0) - 1;
  return (
    <Card className="flex flex-col gap-2.5 p-4">
      <CardHeader
        title="Bag by bag"
        sub={latest ? `Last send ${when(latest.createdAt)} to ${targetText(latest.target, latest)}` : undefined}
        action={latest ? <DeploymentPill status={latest.status} /> : undefined}
      />
      {deployments.isLoading ? (
        <Spinner label="Loading…" />
      ) : latest ? (
        <>
          <p className="m-0 text-xs text-muted">{deliverySummary(latest) || latest.message}</p>
          <DeliveryList rows={latest.delivery} />
          {earlier > 0 && (
            <Link to="/loops?tab=sent" className="text-[13px] font-semibold">
              {plural(earlier, "earlier send")}
            </Link>
          )}
        </>
      ) : loop.bagsPlaying.length ? (
        <>
          <p className="m-0 text-xs text-muted">
            Not sent from the Hub yet. {plural(loop.bagsPlaying.length, "bag")} report playing it{loop.bagsDownloaded ? `; ${loop.bagsDownloaded} have it downloaded` : ""}.
          </p>
          <PlayingList bags={loop.bagsPlaying} />
        </>
      ) : (
        <p className="m-0 text-xs text-muted">Nothing sent yet. After you send, each bag reports back here.</p>
      )}
    </Card>
  );
}

function PlayingList({ bags }: { bags: LoopDetail["bagsPlaying"] }) {
  const [all, setAll] = useState(false);
  const shown = all ? bags : bags.slice(0, 8);
  return (
    <div>
      <ul className="m-0 grid list-none grid-cols-2 gap-x-3 p-0">
        {shown.map((b) => (
          <li key={b.id} className="flex min-h-9 items-center gap-2 border-t border-rule-soft text-[13px]">
            <StatusIcon status={b.status} size={14} />
            <span className="font-semibold">{b.name}</span>
            <span className="truncate text-[11px] text-muted">{b.status === "now" ? "out now" : when(b.lastReportAt)}</span>
          </li>
        ))}
      </ul>
      {bags.length > 8 && (
        <button type="button" onClick={() => setAll(!all)} className="mt-1 h-9 text-[13px] font-semibold text-accent">
          {all ? "Show fewer" : `Show all ${bags.length}`}
        </button>
      )}
    </div>
  );
}

function BagPicker({
  open,
  bags,
  loading,
  initial,
  onClose,
  onPick,
}: {
  open: boolean;
  bags: BagSummary[];
  loading: boolean;
  initial: string[];
  onClose: () => void;
  onPick: (ids: string[]) => void;
}) {
  const [sel, setSel] = useState<string[]>(initial);
  const [q, setQ] = useState("");
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) setSel(initial);
  }
  const usable = useMemo(() => bags.filter((b) => b.lifecycle !== "retired"), [bags]);
  const list = usable.filter((b) => !q.trim() || `${b.name} ${b.rider?.name ?? ""} ${b.playing ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Pick bags"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] text-muted">{plural(sel.length, "bag")} picked</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => onPick(sel)} disabled={!sel.length}>
              Use {plural(sel.length, "bag")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="relative">
          <span className="sr-only">Search bags</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-caption" aria-hidden="true" />
          <Input data-autofocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Bag, rider or loop" className="pl-9" />
        </label>
        <div className="flex flex-wrap gap-2">
          <Chip onClick={() => setSel(usable.filter((b) => b.status === "now").map((b) => b.id))}>Bags out now</Chip>
          <Chip onClick={() => setSel(usable.filter((b) => b.isTestBag).map((b) => b.id))}>Test bag</Chip>
          <Chip onClick={() => setSel([])}>Clear</Chip>
        </div>
        {loading ? (
          <Spinner label="Loading bags…" />
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {list.map((b) => (
              <li key={b.id} className="border-t border-rule-soft first:border-t-0">
                <label className="flex min-h-12 cursor-pointer items-center gap-3 py-1.5">
                  <input type="checkbox" checked={sel.includes(b.id)} onChange={() => toggle(b.id)} className="size-4 accent-navy" />
                  <StatusIcon status={b.status} size={16} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-semibold">
                      {b.name}
                      {b.isTestBag && <span className="ml-1.5 rounded-full bg-info-bg px-1.5 text-[10px] font-semibold text-info-ink">Test</span>}
                    </span>
                    <span className="truncate text-xs text-muted">
                      {b.rider?.name ?? "No rider"} · {b.playing ? `playing ${b.playing}` : "nothing reported"}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

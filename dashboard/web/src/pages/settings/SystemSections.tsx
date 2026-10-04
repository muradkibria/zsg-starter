// Colorlight connection (read-only) and Changes to bags (the safety gate).

import { useState } from "react";
import { Link } from "react-router";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, FlaskConical, ShieldCheck } from "lucide-react";
import { STATUS_LABEL, type WriteMode } from "@digilite/shared";
import { useFeedback } from "@/components/feedback";
import { buttonClass, Button, Card, CardHeader, ErrorState, Notice, Pill, Spinner, StatusIcon, Switch } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { pct, when } from "@/lib/format";
import { useBags, useFleet, useSettings } from "@/lib/queries";
import { useSaveSettings, useSystem } from "./api";
import { Modal } from "./Modal";

const exact = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" }) : undefined);

export const MODE_TEXT: Record<WriteMode, { title: string; body: string }> = {
  off: {
    title: "Dry run",
    body: "Nothing is sent to bags. Every change is still recorded, marked as a dry run, so you can check what would have happened.",
  },
  test: {
    title: "Test bag only",
    body: "Changes go only to the test bag. Changes aimed at any other bag are blocked and recorded.",
  },
  fleet: {
    title: "Whole fleet, with the owner's switch",
    body: "Changes can go to any bag, but only while “Allow changes to the whole fleet” below is on. With it off, only the test bag can be changed.",
  },
};

// ── Colorlight connection ─────────────────────────────────────────────────────
export function ColorlightSection() {
  const system = useSystem();
  const fleet = useFleet();
  const s = system.data?.sync;
  const rows: { label: string; at: string | null }[] = s
    ? [
        { label: "Bag status", at: s.lastStatusSync },
        { label: "Live positions", at: s.lastGpsSync },
        { label: "Routes", at: s.lastTrackSync },
        { label: "Plays", at: s.lastPlaysSync },
      ]
    : [];
  return (
    <Card className="flex flex-col gap-4 p-4 md:p-5" aria-label="Colorlight connection">
      <CardHeader
        title="Colorlight connection"
        action={
          s && (
            <Pill tone={s.enabled === false ? "neutral" : s.colorlightOk ? "green" : s.error ? "amber" : "info"}>
              {s.colorlightOk ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
              {s.enabled === false ? "Sync off" : s.colorlightOk ? "Connected" : s.error ? "Not reachable" : "Connecting"}
            </Pill>
          )
        }
      />
      {system.isLoading && <Spinner />}
      {system.error && <ErrorState error={system.error} retry={() => void system.refetch()} />}
      {s && (
        <>
          <p className="m-0 text-[13px] text-ink-2">
            Colorlight is where every bag's data comes from: status every 30 seconds, positions every 20 seconds, routes every 2 minutes and
            plays every 15 minutes. The Hub records all of it permanently, so if Colorlight is slow or down every screen keeps working from the last
            update.
          </p>
          <dl className="m-0 grid grid-cols-[minmax(0,130px)_1fr] gap-x-4 gap-y-2 text-[13px]">
            {rows.map((r) => (
              <div key={r.label} className="contents">
                <dt className="text-muted">{r.label}</dt>
                <dd className="m-0 font-semibold" title={exact(r.at)}>
                  {r.at ? `Updated ${when(r.at)}` : <span className="font-normal text-muted">Not yet</span>}
                </dd>
              </div>
            ))}
            <div className="contents">
              <dt className="text-muted">Bags found</dt>
              <dd className="m-0 font-semibold">{fleet.data?.total ?? "—"}</dd>
            </div>
            <div className="contents">
              <dt className="text-muted">History</dt>
              <dd className="m-0 font-semibold">{s.backfill.note ?? (s.backfill.done ? "Recorded" : "Recording…")}</dd>
            </div>
            <div className="contents">
              <dt className="text-muted">Changes to bags</dt>
              <dd className="m-0 font-semibold">
                <Link to="?section=changes" className="text-accent no-underline hover:underline">
                  {MODE_TEXT[system.data!.writeMode].title}
                </Link>
              </dd>
            </div>
          </dl>
          {s.error ? (
            <Notice tone="red" icon={<AlertTriangle className="size-4" />}>
              <strong>Last error:</strong> {s.error}
            </Notice>
          ) : (
            <Notice tone="green" icon={<CheckCircle2 className="size-4" />}>
              No errors from Colorlight.
            </Notice>
          )}
          <p className="m-0 text-xs text-muted">
            The Colorlight login is set on the server by the administrator, so it can't be changed or disconnected from here.
          </p>
        </>
      )}
    </Card>
  );
}

// ── Changes to bags ───────────────────────────────────────────────────────────
export function ChangesSection() {
  const { can } = useAuth();
  const owner = can("settings.edit");
  const settings = useSettings();
  const bags = useBags();
  const save = useSaveSettings();
  const { toast } = useFeedback();
  const [confirming, setConfirming] = useState(false);
  const mode = settings.data?.writeMode;
  const on = !!settings.data?.fleetWritesEnabled;
  const testBags = (bags.data ?? []).filter((b) => b.isTestBag);

  const setSwitch = async (next: boolean) => {
    if (next) return setConfirming(true);
    try {
      await save.mutateAsync({ fleetWritesEnabled: false });
      toast("Changes to the whole fleet are switched off. Only the test bag can be changed.");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  if (settings.isLoading) return <Spinner />;
  if (settings.error) return <ErrorState error={settings.error} retry={() => void settings.refetch()} />;
  if (!mode) return null;

  const switchEffect =
    mode === "off"
      ? "The server is in dry-run mode, so nothing is sent to any bag whatever this switch says."
      : mode === "test"
        ? "The server only allows the test bag right now, so this switch has no effect until the administrator allows whole-fleet mode."
        : on
          ? "On: any bag can receive changes from the Hub."
          : "Off: only the test bag can receive changes. Turn it on once a change has worked on the test bag.";

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-4 p-4 md:p-5" aria-label="Changes to bags">
        <CardHeader title="Changes to bags" sub="What happens when someone changes a bag's loop, brightness or schedule." />
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {(["off", "test", "fleet"] as const).map((m) => (
            <li
              key={m}
              className={clsx("flex items-start gap-3 rounded-xl border px-3.5 py-3", m === mode ? "border-navy bg-tint-2" : "border-rule-soft bg-white")}
              aria-current={m === mode ? "true" : undefined}
            >
              <span
                className={clsx("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2", m === mode ? "border-navy bg-navy" : "border-line")}
                aria-hidden
              >
                {m === mode && <span className="size-1.5 rounded-full bg-white" />}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {MODE_TEXT[m].title}
                  {m === mode && <Pill tone="navy">Now</Pill>}
                </span>
                <span className="text-[13px] text-ink-2">{MODE_TEXT[m].body}</span>
              </span>
            </li>
          ))}
        </ul>
        <Notice tone="info" icon={<ShieldCheck className="size-4" />}>
          The mode is set by the server administrator (<code>COLORLIGHT_WRITES</code> in the repo's <code>.env</code>, or the host's variables) and can't be changed from
          here. Whatever the mode, a change never goes to a whole group of bags at once, and every attempt is logged.
        </Notice>
      </Card>

      <Card className="flex flex-col gap-3 p-4 md:p-5" aria-label="Test bag">
        <CardHeader title={testBags.length > 1 ? "Test bags" : "Test bag"} sub="Try every change here before it reaches the fleet." />
        {bags.isLoading && <Spinner />}
        {!bags.isLoading && testBags.length === 0 && (
          <Notice tone="amber">
            No test bag found. The administrator sets it with <code>COLORLIGHT_TEST_BAG_IDS</code> (Colorlight id {settings.data!.testBagColorlightIds.join(", ") || "not set"}).
          </Notice>
        )}
        {testBags.map((b) => (
          <div key={b.id} className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-16 shrink-0 items-center justify-center rounded-lg bg-ink p-1.5">
                <div className="flex size-full items-center justify-center rounded-[3px] bg-[#2a3348] text-[8px] font-bold text-[#8e97ab]">
                  {b.status === "now" ? <FlaskConical className="size-4 text-white" /> : "OFF"}
                </div>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-2 text-[15px] font-bold">
                  <StatusIcon status={b.status} size={16} />
                  {b.name}
                </span>
                <span className={clsx("text-xs font-semibold", b.status === "gone" ? "text-red-ink" : "text-ink-2")}>
                  {STATUS_LABEL[b.status]} · last seen {when(b.lastReportAt)}
                </span>
                <span className="truncate text-xs text-muted">
                  {b.playing ? `Showing “${b.playing}”` : "Not reporting what it plays"} · brightness {pct(b.brightnessPct)}
                </span>
              </div>
              <Link to={`/bags/${b.id}`} className={buttonClass("secondary", "sm", "shrink-0")}>
                Open bag
              </Link>
            </div>
            {b.status !== "now" && (
              <Notice tone="red" icon={<AlertTriangle className="size-4" />}>
                {b.name} isn't on. Switch it on to test changes before they reach the fleet.
              </Notice>
            )}
          </div>
        ))}
      </Card>

      <Card className={clsx("flex flex-col gap-3 p-4 md:p-5", on ? "border-red-line" : "border-amber-line")} aria-label="Safety switch">
        <span className="text-[11px] font-bold tracking-[0.06em] text-amber-ink uppercase">Safety switch · owner only</span>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="m-0 font-display text-lg font-semibold">Allow changes to the whole fleet</h2>
            <p className="m-0 text-[13px] text-ink-2">{switchEffect}</p>
          </div>
          <div className="flex shrink-0 flex-col items-center gap-1 pt-1">
            <Switch checked={on} onChange={(v) => void setSwitch(v)} disabled={!owner || save.isPending} label={<span className="sr-only">Allow changes to the whole fleet</span>} />
            <span className={clsx("text-[11px] font-bold", on ? "text-red-ink" : "text-muted")}>{on ? "ON" : "OFF"}</span>
          </div>
        </div>
        {!owner && <p className="m-0 text-xs text-muted">Only the owner can turn this on or off.</p>}
      </Card>

      {confirming && (
        <FleetSwitchConfirm
          mode={mode}
          busy={save.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            try {
              await save.mutateAsync({ fleetWritesEnabled: true });
              setConfirming(false);
              toast("Changes to the whole fleet are switched on.");
            } catch (e) {
              toast((e as Error).message, "error");
            }
          }}
        />
      )}
    </div>
  );
}

const PHRASE = "whole fleet";

function FleetSwitchConfirm({ mode, busy, onCancel, onConfirm }: { mode: WriteMode; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const [typed, setTyped] = useState("");
  const [tested, setTested] = useState(false);
  const ok = typed.trim().toLowerCase() === PHRASE && tested;
  return (
    <Modal
      title="Allow changes to the whole fleet?"
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>Keep it off</Button>
          <Button variant="danger" disabled={!ok} loading={busy} onClick={onConfirm}>
            Turn on for the whole fleet
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="m-0">
          Every bag, not just the test bag, will accept changes sent from the Hub: loops, brightness, schedules, restarts. A mistake would show
          on every screen in the fleet.
        </p>
        {mode !== "fleet" && (
          <Notice tone="info">
            The server is in {mode === "off" ? "dry-run" : "test-bag-only"} mode, so this has no effect until the administrator allows whole-fleet
            mode.
          </Notice>
        )}
        <label className="flex items-start gap-2.5 text-[13px] text-ink">
          <input type="checkbox" checked={tested} onChange={(e) => setTested(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-navy)]" />
          The change I'm about to make has worked on the test bag.
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-ink">
          Type “{PHRASE}” to confirm
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            className="h-10 w-full rounded-[10px] border border-line bg-white px-3 text-sm font-normal outline-none focus:border-navy"
            data-autofocus
          />
        </label>
      </div>
    </Modal>
  );
}

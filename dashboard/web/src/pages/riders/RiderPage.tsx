// One rider: their bag, where they ride, the last 14 days against the fleet
// (all from the bag's data while they carried it), the bags they've carried,
// documents, pay and notes.

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import clsx from "clsx";
import { AlertTriangle, ChevronLeft, Mail, MapPin, MessageSquare, Pencil, Phone } from "lucide-react";
import { addDays, todayLondon, type RiderDetail, type RiderPerformance, type RiderStint } from "@digilite/shared";
import { useAuth } from "@/lib/auth";
import { useSettings } from "@/lib/queries";
import { useFeedback } from "@/components/feedback";
import { RouteMap } from "@/components/route/RouteMap";
import { Avatar, Button, Card, CardHeader, EmptyState, ErrorState, LinkButton, Page, Spinner, Stat, StatusLabel, Textarea } from "@/components/ui";
import { dayLabel, formatDuration, hours, km, pct, shortDate, time, when } from "@/lib/format";
import { useRider, useRiderCoverage, useRiderPerformance, useUpdateRider } from "./api";
import { DemoPill, firstName, StagePill, stoppedWellAbove } from "./bits";
import { DocumentsCard } from "./Documents";
import { GiveBagSheet } from "./GiveBag";
import { HoursChart } from "./HoursChart";
import { EditRiderSheet } from "./RiderForm";

const desktopQuery = "(min-width: 1280px)";
function useIsDesktop() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(desktopQuery);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(desktopQuery).matches,
  );
}

/** "today", "yesterday" or "Mon 28 Sep". */
function dayWord(day: string) {
  const today = todayLondon();
  if (day === today) return "today";
  if (day === addDays(today, -1)) return "yesterday";
  return dayLabel(day);
}

const lastDayOf = (endIso: string) => shortDate(new Date(Date.parse(endIso) - 1));

export default function RiderPage() {
  const { id = "" } = useParams();
  const rider = useRider(id);
  if (rider.isLoading)
    return (
      <Page>
        <Spinner label="Loading rider…" />
      </Page>
    );
  if (rider.error || !rider.data)
    return (
      <Page>
        <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
          <Link to="/riders">Riders</Link>
        </nav>
        <ErrorState error={rider.error ?? new Error("Rider not found")} retry={() => void rider.refetch()} />
      </Page>
    );
  return <RiderView r={rider.data} />;
}

function RiderView({ r }: { r: RiderDetail }) {
  const { can } = useAuth();
  const canEdit = can("riders.edit");
  const desktop = useIsDesktop();
  // Someone who has never carried a bag has no days, routes or pay yet: lead with documents.
  const everCarried = r.stints.some((st) => Date.parse(st.start) <= Date.now());
  const perf = useRiderPerformance(everCarried ? r.id : null, 14);
  const cov = useRiderCoverage(everCarried ? r.id : null, 14);
  const [editing, setEditing] = useState(false);
  const [giving, setGiving] = useState(false);
  const update = useUpdateRider(r.id);
  const { toast, confirm } = useFeedback();
  const first = firstName(r.name);

  const setStage = async (stage: "checked" | "waiting", opts?: { confirmText?: { title: string; body: string; confirm: string } }) => {
    if (opts?.confirmText && !(await confirm(opts.confirmText))) return;
    update.mutate(
      { stage },
      {
        onSuccess: () => toast(stage === "waiting" ? `${first} is now waiting for a bag` : `${first}'s documents are marked as checked`),
        onError: (e) => toast(e.message, "error"),
      },
    );
  };

  // Stage-driven next step.
  let primary: ReactNode = null;
  if (canEdit) {
    if (r.stage === "applied") {
      const complete = r.docs.checked >= r.docs.required;
      primary = (
        <Button
          variant={complete ? "primary" : "secondary"}
          loading={update.isPending}
          onClick={() =>
            void setStage(
              "checked",
              complete
                ? undefined
                : {
                    confirmText: {
                      title: "Not every document is checked",
                      body: `${r.docs.checked} of ${r.docs.required} required documents are checked. Mark ${first} as documents checked anyway?`,
                      confirm: "Mark as checked",
                    },
                  },
            )
          }
        >
          Mark documents checked
        </Button>
      );
    } else if (r.stage === "checked") {
      primary = (
        <Button variant="primary" loading={update.isPending} onClick={() => void setStage("waiting")}>
          Ready for a bag
        </Button>
      );
    } else if (r.stage === "waiting") {
      primary = (
        <Button variant="primary" onClick={() => setGiving(true)}>
          Give a bag
        </Button>
      );
    } else if (r.stage === "active") {
      primary = <Button onClick={() => setGiving(true)}>Move to another bag</Button>;
    } else if (r.stage === "ended") {
      primary = (
        <Button
          variant="primary"
          loading={update.isPending}
          onClick={() =>
            void setStage("waiting", {
              confirmText: {
                title: `Bring ${first} back?`,
                body: `${first} goes back to waiting for a bag. Their earlier days stay as they were.`,
                confirm: "Bring back",
              },
            })
          }
        >
          Bring back
        </Button>
      );
    }
  }
  const endText = r.stage === "active" ? "End assignment" : "Mark as ended";
  const endLink =
    canEdit && r.stage !== "ended" ? (
      <LinkButton to={`/riders/${r.id}/end`} variant="danger">
        {endText}
      </LinkButton>
    ) : null;
  const endLinkPhone = (
    <LinkButton to={`/riders/${r.id}/end`} variant="danger" size="lg" className="w-full">
      {endText}
    </LinkButton>
  );

  const sub = [
    r.stage === "ended" && r.endedAt ? `Ended ${shortDate(r.endedAt)}${r.endedReason ? ` · ${r.endedReason}` : ""}` : r.joinedAt ? `Joined ${shortDate(r.joinedAt)}` : null,
    r.docs.state === "ok" ? "documents complete" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const perfCard = <PerformanceCard r={r} perf={perf.data} loading={perf.isLoading} error={perf.error} retry={() => void perf.refetch()} />;
  const mapCard = (
    <Card className="p-5">
      <CardHeader
        title={`Where ${first} rides`}
        sub={cov.data ? (cov.data.daysWithData ? `${cov.data.daysWithData} ${cov.data.daysWithData === 1 ? "day" : "days"} out in the last 2 weeks` : "Last 2 weeks") : undefined}
      />
      <div className="relative mt-3 h-[240px] overflow-hidden rounded-xl border border-rule bg-paper md:h-[280px]">
        {cov.isLoading && <Spinner label="Loading routes…" />}
        {cov.error && (
          <div className="p-3">
            <ErrorState error={cov.error} retry={() => void cov.refetch()} />
          </div>
        )}
        {cov.data && (cov.data.lines.length || cov.data.last) ? (
          <RouteMap route={cov.data.last} extraLines={cov.data.lines} className="absolute inset-0" />
        ) : cov.data ? (
          <EmptyState title="No routes in the last 2 weeks" body={r.bag ? "Nothing was recorded while they carried the bag." : "They haven't carried a bag in this time."} />
        ) : null}
      </div>
      {cov.data?.last && (
        <p className="m-0 mt-2 text-xs text-muted">
          Bold: {dayWord(cov.data.last.day ?? "")} on {cov.data.last.bagName}, with stops and signal gaps. Faint: their other days. Zones dashed.
        </p>
      )}
    </Card>
  );
  const stintsCard = <StintsCard stints={r.stints} />;
  const payCard = <PayCard perf={perf.data} />;
  const notesCard = <NotesCard r={r} canEdit={canEdit} />;
  const docsCard = <DocumentsCard rider={r} />;

  const call = r.phone.replace(/\s+/g, "");
  const edit = canEdit ? (
    <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
      Edit
    </Button>
  ) : null;

  return (
    <Page>
      <header className="flex flex-col gap-3">
        <nav aria-label="Breadcrumb" className="hidden text-[13px] text-muted md:block">
          <Link to="/riders" className="text-accent no-underline hover:underline">
            Riders
          </Link>
          <span className="mx-1.5 text-caption">/</span>
          {r.name}
        </nav>
        <div className="flex flex-wrap items-center gap-3 md:gap-x-4">
          <Link to="/riders" aria-label="Back to riders" className="-ml-2 flex size-10 shrink-0 items-center justify-center rounded-full text-ink md:hidden">
            <ChevronLeft className="size-6" />
          </Link>
          <span className="md:hidden">
            <Avatar name={r.name} size={48} />
          </span>
          <span className="hidden md:block">
            <Avatar name={r.name} size={60} />
          </span>
          <div className="min-w-0 flex-1 md:min-w-[260px]">
            <div className="flex items-center gap-3">
              <h1 className="m-0 truncate font-display text-[24px] leading-tight font-semibold tracking-[-0.02em] md:text-[32px]">{r.name}</h1>
              <span className="hidden shrink-0 items-center gap-2 md:flex">
                <StagePill stage={r.stage} />
                {r.demo && <DemoPill />}
              </span>
            </div>
            <p className="m-0 mt-1 hidden text-sm text-muted md:block">
              {sub}
              {r.phone && (
                <>
                  {sub && " · "}
                  <a href={`tel:${call}`} className="text-ink-2 no-underline hover:underline">
                    {r.phone}
                  </a>
                </>
              )}
              {r.email && (
                <>
                  {(sub || r.phone) && " · "}
                  <a href={`mailto:${r.email}`} className="text-ink-2 no-underline hover:underline">
                    {r.email}
                  </a>
                </>
              )}
            </p>
          </div>
          {(r.phone || r.email) && (
            <div className="flex shrink-0 gap-2 md:hidden">
              {r.phone && (
                <a href={`tel:${call}`} aria-label={`Call ${first}`} className="flex size-11 items-center justify-center rounded-full border border-line bg-white text-ink">
                  <Phone className="size-5" />
                </a>
              )}
              {r.phone ? (
                <a href={`sms:${call}`} aria-label={`Message ${first}`} className="flex size-11 items-center justify-center rounded-full border border-line bg-white text-ink">
                  <MessageSquare className="size-5" />
                </a>
              ) : (
                <a href={`mailto:${r.email}`} aria-label={`Email ${first}`} className="flex size-11 items-center justify-center rounded-full border border-line bg-white text-ink">
                  <Mail className="size-5" />
                </a>
              )}
            </div>
          )}
          {canEdit && (
            <div className="hidden shrink-0 flex-wrap items-center justify-end gap-2 md:flex">
              {edit}
              {primary}
              {endLink}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3 md:hidden">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StagePill stage={r.stage} />
            {r.demo && <DemoPill />}
            {sub && <span className="text-sm text-muted">{sub}</span>}
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              {primary}
              {edit}
            </div>
          )}
        </div>
      </header>

      <BagCard r={r} onGive={canEdit ? () => setGiving(true) : undefined} />

      {!everCarried ? (
        <div className="grid items-start gap-4 md:gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
          {docsCard}
          <div className="flex min-w-0 flex-col gap-4 md:gap-5">
            {notesCard}
            {endLink && <div className="md:hidden">{endLinkPhone}</div>}
          </div>
        </div>
      ) : desktop ? (
        <div className="grid grid-cols-[minmax(0,1fr)_400px] items-start gap-5">
          <div className="flex min-w-0 flex-col gap-5">
            {perfCard}
            {stintsCard}
            {notesCard}
          </div>
          <div className="flex min-w-0 flex-col gap-5">
            {mapCard}
            {docsCard}
            {payCard}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 md:gap-5">
          {mapCard}
          {perfCard}
          {docsCard}
          {payCard}
          {notesCard}
          {stintsCard}
          {endLink && <div className="md:hidden">{endLinkPhone}</div>}
        </div>
      )}

      {editing && <EditRiderSheet rider={r} open onClose={() => setEditing(false)} />}
      {giving && <GiveBagSheet mode={{ kind: "rider", riderId: r.id }} onClose={() => setGiving(false)} />}
    </Page>
  );
}

// ── The bag ───────────────────────────────────────────────────────────────────
function BagGlyph({ dim }: { dim?: boolean }) {
  return (
    <span className={clsx("flex h-11 w-14 shrink-0 items-center justify-center rounded-lg bg-ink p-1.5", dim && "opacity-40")} aria-hidden>
      <span className="size-full rounded-[3px] bg-[#3a5ba8]" />
    </span>
  );
}

function BagCard({ r, onGive }: { r: RiderDetail; onGive?: () => void }) {
  const b = r.bag;
  if (!b) {
    const lastStint = r.stints.find((s) => s.end);
    const text =
      r.stage === "ended"
        ? lastStint
          ? `Last carried ${lastStint.bagName} until ${lastDayOf(lastStint.end!)}`
          : "Never carried a bag"
        : r.stage === "waiting"
          ? "Waiting for a bag"
          : r.docs.checked < r.docs.required
            ? `${r.docs.checked} of ${r.docs.required} documents checked`
            : "Documents checked";
    return (
      <Card className="flex flex-wrap items-center gap-3 p-4 md:p-5">
        <BagGlyph dim />
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted">{r.stage === "ended" ? "No bag" : "No bag yet"}</div>
          <div className="font-display text-lg font-semibold">{text}</div>
        </div>
        {onGive && r.stage === "waiting" && (
          <Button variant="primary" onClick={onGive}>
            Give a bag
          </Button>
        )}
      </Card>
    );
  }
  const lastOut = r.lastOut;
  const statusText =
    b.status === "now" ? "Out now" : b.status === "day" ? `Seen ${when(b.lastReportAt)}` : b.status === "idle" ? `Idle · seen ${when(b.lastReportAt)}` : `Not seen since ${shortDate(b.lastReportAt)}`;
  return (
    <Card className="flex flex-col gap-4 p-4 md:p-5 lg:flex-row lg:items-center lg:gap-6">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <BagGlyph />
        <div className="min-w-0">
          <div className="text-xs text-muted">{b.upcoming ? `Gets it from ${shortDate(b.since)}` : "Carrying"}</div>
          <Link to={`/bags/${b.id}`} className="font-display text-xl font-semibold text-ink no-underline hover:underline">
            {b.name}
          </Link>
          {!b.upcoming && (
            <div className="mt-0.5">
              <StatusLabel status={b.status} text={statusText} />
            </div>
          )}
        </div>
      </div>
      <dl className="m-0 grid grid-cols-2 gap-4 lg:flex lg:gap-8">
        <div>
          <dt className="text-xs text-muted">{b.until ? "Last day" : "Since"}</dt>
          <dd className="m-0 text-sm font-semibold">{b.until ? lastDayOf(b.until) : shortDate(b.since)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Last out</dt>
          <dd className="num m-0 text-sm font-semibold">
            {lastOut ? `${dayWord(lastOut.day)} ${time(lastOut.start)}–${time(lastOut.end)}` : "Not in the last 2 weeks"}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <LinkButton to={`/map?bag=${b.id}`} icon={<MapPin className="size-4" />} className="flex-1 lg:flex-none">
          See on the map
        </LinkButton>
        {b.isTestBag && <span className="self-center text-xs text-muted">Test bag</span>}
      </div>
    </Card>
  );
}

// ── Last 2 weeks vs the fleet ─────────────────────────────────────────────────
function Flag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <AlertTriangle className="size-3.5 text-amber-ink" aria-label="Well above the fleet" />
      {children}
    </span>
  );
}

function PerformanceCard({
  r,
  perf,
  loading,
  error,
  retry,
}: {
  r: RiderDetail;
  perf: RiderPerformance | undefined;
  loading: boolean;
  error: unknown;
  retry: () => void;
}) {
  const bagNames = [...new Set((perf?.rows ?? []).map((x) => x.bagName).filter(Boolean))];
  return (
    <Card className="p-5">
      <CardHeader
        title="Last 2 weeks"
        sub={bagNames.length ? `From ${bagNames.join(" and ")}'s data while ${firstName(r.name)} carried it` : "From the bag's data while they carried it"}
      />
      {loading && <Spinner />}
      {error ? <ErrorState error={error} retry={retry} /> : null}
      {perf && (
        <div className="mt-4 flex flex-col gap-5">
          <PerfTiles perf={perf} />
          {perf.totals.daysCarrying > 0 ? (
            <HoursChart perf={perf} />
          ) : (
            <p className="m-0 text-sm text-muted">No bag in the last 2 weeks, so there's nothing to show yet.</p>
          )}
        </div>
      )}
    </Card>
  );
}

function PerfTiles({ perf }: { perf: RiderPerformance }) {
  const t = perf.totals;
  const f = perf.fleet;
  const n = perf.rows.length;
  const stopHigh = stoppedWellAbove(t.stoppedPct, f);
  const gapsHigh = t.gapsPerDay != null && f.gapsPerDay != null && t.gapsPerDay >= 1 && t.gapsPerDay >= f.gapsPerDay * 2;
  const dur = (s: number | null) => (s == null ? "—" : formatDuration(s));
  const one = (v: number | null) => (v == null ? "—" : v.toFixed(1));
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
      <Stat label="Days out" value={`${t.daysOut} of ${n}`} sub={t.daysCarrying < n ? `had a bag ${t.daysCarrying} of ${n} days` : `last ${n} days`} />
      <Stat label="Average day out" value={dur(t.avgOnSeconds)} sub={`Fleet ${dur(f.avgOnSeconds)}`} />
      <Stat label={stopHigh ? <Flag>Time stopped</Flag> : "Time stopped"} value={pct(t.stoppedPct)} sub={`Fleet ${pct(f.stoppedPct)}`} tone={stopHigh ? "amber" : undefined} />
      <Stat label={gapsHigh ? <Flag>Signal gaps a day</Flag> : "Signal gaps a day"} value={one(t.gapsPerDay)} sub={`Fleet ${one(f.gapsPerDay)}`} tone={gapsHigh ? "amber" : undefined} />
      <Stat label="Distance a day" value={t.kmPerDay == null ? "—" : km(t.kmPerDay)} sub={`Fleet ${f.kmPerDay == null ? "—" : km(f.kmPerDay)}`} className="col-span-2 sm:col-span-1" />
    </div>
  );
}

// ── Bags carried ──────────────────────────────────────────────────────────────
function span(startIso: string, endIso: string | null): string {
  const days = Math.max(1, Math.round(((endIso ? Date.parse(endIso) : Date.now()) - Date.parse(startIso)) / 86_400_000));
  if (days < 14) return `${days} ${days === 1 ? "day" : "days"}`;
  if (days < 120) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30.4)} months`;
}

function StintsCard({ stints }: { stints: RiderStint[] }) {
  const now = Date.now();
  return (
    <Card className="p-5">
      <CardHeader title="Bags carried" sub="Their days, hours and routes come from each bag between these dates." />
      {stints.length === 0 ? (
        <p className="m-0 mt-3 text-sm text-muted">No bags yet.</p>
      ) : (
        <ul className="m-0 mt-2 list-none p-0">
          {stints.map((s) => {
            const upcoming = Date.parse(s.start) > now;
            const current = !upcoming && (!s.end || Date.parse(s.end) > now);
            return (
              <li key={s.assignmentId} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-rule-soft py-2.5 last:border-b-0">
                <Link to={`/bags/${s.bagId}`} className="w-20 text-sm font-semibold no-underline hover:underline">
                  {s.bagName}
                </Link>
                <span className="num text-[13px] text-ink-2">
                  {shortDate(s.start)} – {upcoming ? "" : s.end ? lastDayOf(s.end) : "now"}
                </span>
                <span className="text-xs text-muted">{upcoming ? "starts soon" : span(s.start, s.end)}</span>
                {current && <span className="text-xs font-semibold text-green-ink">current</span>}
                {s.endReason && <span className="w-full text-xs text-muted sm:ml-auto sm:w-auto">{s.endReason}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ── Pay ───────────────────────────────────────────────────────────────────────
function PayCard({ perf }: { perf: RiderPerformance | undefined }) {
  const { can } = useAuth();
  const settings = useSettings();
  return (
    <Card className="p-5">
      <CardHeader
        title="Pay"
        action={
          can("payroll.view") ? (
            <Link to="/payroll" className="text-[13px] font-semibold">
              Open payroll
            </Link>
          ) : undefined
        }
      />
      {perf ? (
        <dl className="m-0 mt-3 flex flex-col gap-2 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-2">Paid time, last 14 days</dt>
            <dd className="num m-0 font-semibold">{hours(perf.totals.paidSeconds)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-2">Days out</dt>
            <dd className="num m-0 font-semibold">{perf.totals.daysOut}</dd>
          </div>
          {settings.data?.payRate && (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-2">Rate</dt>
              <dd className="m-0 font-semibold">{settings.data.payRate}</dd>
            </div>
          )}
          {perf.payMinHours > 0 && (
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-2">Minimum to qualify</dt>
              <dd className="num m-0 font-semibold">{perf.payMinHours} h a pay period</dd>
            </div>
          )}
          <p className="m-0 text-xs text-muted">
            Paid time is moving time{perf.paySignalGaps ? " plus signal gaps" : ""}, from the bag's data. Pay runs are approved in Payroll.
          </p>
        </dl>
      ) : (
        <Spinner />
      )}
    </Card>
  );
}

// ── Notes ─────────────────────────────────────────────────────────────────────
function NotesCard({ r, canEdit }: { r: RiderDetail; canEdit: boolean }) {
  const [text, setText] = useState(r.notes);
  const [dirty, setDirty] = useState(false);
  const update = useUpdateRider(r.id);
  const { toast } = useFeedback();
  useEffect(() => {
    if (!dirty) setText(r.notes);
  }, [r.notes, dirty]);
  const save = () =>
    update.mutate(
      { notes: text },
      {
        onSuccess: () => {
          setDirty(false);
          toast("Notes saved");
        },
        onError: (e) => toast(e.message, "error"),
      },
    );
  return (
    <Card className="p-5">
      <CardHeader title="Notes" />
      {canEdit ? (
        <div className="mt-3 flex flex-col gap-2">
          <Textarea
            aria-label={`Notes about ${r.name}`}
            value={text}
            maxLength={5000}
            rows={4}
            placeholder="Anything the team should know. Keep documents and personal details out of notes."
            onChange={(e) => {
              setText(e.target.value);
              setDirty(true);
            }}
          />
          <div className="flex justify-end gap-2">
            {dirty && (
              <Button
                size="sm"
                onClick={() => {
                  setText(r.notes);
                  setDirty(false);
                }}
              >
                Undo
              </Button>
            )}
            <Button size="sm" variant="primary" disabled={!dirty} loading={update.isPending} onClick={save}>
              Save notes
            </Button>
          </div>
        </div>
      ) : (
        <p className="m-0 mt-3 text-sm whitespace-pre-wrap text-ink-2">{r.notes || "No notes."}</p>
      )}
    </Card>
  );
}


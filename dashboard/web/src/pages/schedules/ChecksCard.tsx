// "Before you apply": what could go wrong, then the two ways to apply — the
// test bag first, then the fleet — and what happened, bag by bag.

import { useState } from "react";
import { Link } from "react-router";
import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import { shortDay, todayLondon, type ApplyBagStatus, type ApplyResult, type ScheduleApplyAttempt, type ScheduleCheck, type ScheduleChecks } from "@digilite/shared";
import { Button, Card, CardHeader, Spinner } from "@/components/ui";
import { when } from "@/lib/format";

const TONE: Record<ScheduleCheck["tone"], { box: string; icon: typeof Info }> = {
  blocker: { box: "bg-red-bg text-red-ink", icon: OctagonAlert },
  warning: { box: "bg-amber-bg text-amber-ink", icon: AlertTriangle },
  info: { box: "bg-paper text-ink-2", icon: Info },
  ok: { box: "bg-green-bg text-green-ink", icon: CheckCircle2 },
};

function CheckRow({ c }: { c: ScheduleCheck }) {
  const t = TONE[c.tone];
  if (c.tone === "info") {
    // Notes, not problems: one compact line each.
    return (
      <p className="m-0 flex items-start gap-2 px-1 text-[12.5px] leading-snug text-ink-2">
        <t.icon className="mt-px size-3.5 shrink-0 text-muted" aria-hidden="true" />
        <span>
          {c.title}
          {c.body && <span className="text-muted"> {c.body}</span>}
          {c.href && (
            <>
              {" "}
              <Link to={c.href} className="font-semibold">
                {c.hrefLabel ?? "Open"}
              </Link>
            </>
          )}
        </span>
      </p>
    );
  }
  return (
    <div className={clsx("flex items-start gap-2.5 rounded-[10px] px-3 py-2.5 text-[13px]", t.box)}>
      <t.icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-1">
        <span className={clsx(c.tone === "blocker" && "font-semibold")}>
          <span className="sr-only">{c.tone === "blocker" ? "Blocker: " : c.tone === "warning" ? "Warning: " : ""}</span>
          {c.title}
        </span>
        {c.body && <span className="opacity-90">{c.body}</span>}
        {c.bags && c.bags.length > 0 && (
          <span className="flex flex-wrap gap-x-2 gap-y-0.5">
            {c.bags.slice(0, 8).map((b) => (
              <Link key={b.id} to={`/bags/${b.id}`} className="font-semibold text-current underline decoration-1 underline-offset-2">
                {b.name}
              </Link>
            ))}
            {c.bags.length > 8 && <span>and {c.bags.length - 8} more</span>}
          </span>
        )}
        {c.href && (
          <Link to={c.href} className="font-bold text-current">
            {c.hrefLabel ?? "Open"} →
          </Link>
        )}
      </div>
    </div>
  );
}

const RESULT_LABEL: Record<ApplyBagStatus, string> = {
  dry_run: "Dry run",
  sent: "Sent",
  blocked: "Blocked",
  failed: "Failed",
  skipped: "Left out",
};
const RESULT_TONE: Record<ApplyBagStatus, string> = {
  dry_run: "bg-info-bg text-info-ink",
  sent: "bg-green-bg text-green-ink",
  blocked: "bg-red-bg text-red-ink",
  failed: "bg-red-bg text-red-ink",
  skipped: "bg-amber-bg text-amber-ink",
};

export function ApplyResultView({ result, onDismiss }: { result: ApplyResult; onDismiss: () => void }) {
  const [all, setAll] = useState(false);
  const worst: ApplyBagStatus = result.counts.failed
    ? "failed"
    : result.counts.blocked
      ? "blocked"
      : result.counts.skipped
        ? "skipped"
        : result.counts.sent
          ? "sent"
          : "dry_run";
  const shown = all ? result.results : result.results.slice(0, 6);
  return (
    <section aria-label="What happened" aria-live="polite" className="flex flex-col gap-2 rounded-xl border border-rule p-3">
      <div className="flex items-start justify-between gap-2">
        <p className={clsx("m-0 rounded-lg px-2.5 py-1.5 text-[13px] font-semibold", RESULT_TONE[worst])}>{result.summary}</p>
        <button onClick={onDismiss} className="h-8 shrink-0 rounded-lg px-2 text-xs font-semibold text-muted hover:bg-paper-2">
          Hide
        </button>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {shown.map((r) => (
          <li key={r.bagId} className="flex items-start gap-2 text-[13px]">
            <span className={clsx("mt-px inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold", RESULT_TONE[r.status])}>{RESULT_LABEL[r.status]}</span>
            <span className="min-w-0">
              <Link to={`/bags/${r.bagId}`} className="font-semibold">
                {r.bagName}
              </Link>
              {r.scheduleName !== "the fleet schedule" && <span className="text-muted"> · {r.scheduleName}</span>}
              <span className="block text-xs text-muted">{r.message}</span>
            </span>
          </li>
        ))}
      </ul>
      {result.results.length > 6 && (
        <button onClick={() => setAll(!all)} className="self-start text-xs font-semibold text-accent">
          {all ? "Show fewer" : `Show all ${result.results.length} bags`}
        </button>
      )}
      <p className="m-0 text-xs text-muted">
        {result.parts.loops} loop {result.parts.loops === 1 ? "part" : "parts"} · {result.parts.brightness} brightness{" "}
        {result.parts.brightness === 1 ? "change" : "changes"}
        {result.brightnessUntil ? ` · sunrise and sunset set up to ${shortDay(result.brightnessUntil, todayLondon())}` : ""}. Each bag's attempt is on its page.
      </p>
    </section>
  );
}

export function ChecksCard({
  checks,
  loading,
  bag,
  canEdit,
  applying,
  lastAttempt,
  result,
  onTryTest,
  onApply,
  onDismissResult,
}: {
  checks: ScheduleChecks | undefined;
  loading: boolean;
  /** Set when editing a bag's own schedule. */
  bag: { id: string; name: string; isTestBag: boolean } | null;
  canEdit: boolean;
  applying: "test" | "fleet" | "bag" | null;
  lastAttempt: ScheduleApplyAttempt | null;
  result: ApplyResult | null;
  onTryTest: () => void;
  onApply: () => void;
  onDismissResult: () => void;
}) {
  const testName = checks?.testBag?.name ?? "the test bag";
  const applyLabel = bag ? (bag.isTestBag ? `Apply to ${bag.name} (the test bag)` : `Apply to ${bag.name}`) : "Apply to the fleet";
  return (
    <Card className="flex flex-col gap-3 p-4 md:p-5" aria-label="Before you apply">
      <CardHeader title="Before you apply" />
      {loading && !checks ? (
        <Spinner label="Checking…" />
      ) : checks ? (
        <div className="flex flex-col gap-2">
          {checks.checks
            .filter((c) => c.tone !== "info")
            .map((c, i) => (
              <CheckRow key={`${c.kind}-${i}`} c={c} />
            ))}
          {checks.checks.some((c) => c.tone === "info") && (
            <div className="mt-1 flex flex-col gap-2">
              {checks.checks
                .filter((c) => c.tone === "info")
                .map((c, i) => (
                  <CheckRow key={`${c.kind}-${i}`} c={c} />
                ))}
            </div>
          )}
        </div>
      ) : null}

      {canEdit ? (
        <div className="mt-1 flex flex-col gap-2">
          {!(bag?.isTestBag) && (
            <>
              <Button size="lg" onClick={onTryTest} disabled={!checks?.canTryTest || !!applying} loading={applying === "test"}>
                Try on the test bag first ({testName})
              </Button>
              {checks && !checks.canTryTest && checks.tryTestReason && <p className="m-0 text-xs text-muted">{checks.tryTestReason}</p>}
            </>
          )}
          <Button size="lg" variant="primary" onClick={onApply} disabled={!checks?.canApply || !!applying} loading={applying === "fleet" || applying === "bag"}>
            {applyLabel}
          </Button>
          {checks && !checks.canApply && checks.applyReason && <p className="m-0 text-xs text-muted">{checks.applyReason}</p>}
        </div>
      ) : (
        <p className="m-0 text-xs text-muted">You can see the schedule but not change or apply it.</p>
      )}

      {result ? (
        <ApplyResultView result={result} onDismiss={onDismissResult} />
      ) : lastAttempt ? (
        <p className="m-0 text-xs text-muted">
          Last time: {lastAttempt.summary} <span className="whitespace-nowrap">({when(lastAttempt.at)}{lastAttempt.by ? `, ${lastAttempt.by}` : ""})</span>
        </p>
      ) : null}
    </Card>
  );
}

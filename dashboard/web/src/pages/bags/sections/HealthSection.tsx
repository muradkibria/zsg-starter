// Health: the device readings from the bag's last report. Readings from a bag
// that has stopped reporting are shown as last known, not as healthy.

import { CircleCheck, Minus, OctagonAlert, AlertTriangle } from "lucide-react";
import type { BagDetail } from "@digilite/shared";
import { cx } from "@/components/ui";
import { when } from "@/lib/format";
import { Section } from "../bits";

type State = "ok" | "warn" | "bad" | "info";

interface Row {
  label: string;
  value: string;
  state: State;
  /** Shown when the reading needs attention */
  note?: string;
}

const STATE_ICON = { ok: CircleCheck, warn: AlertTriangle, bad: OctagonAlert, info: Minus } as const;
const STATE_TEXT = { ok: "Normal", warn: "Check", bad: "Needs fixing", info: "Last known" } as const;

function networkLabel(n: string | null): string | null {
  if (!n || /unknown/i.test(n)) return null;
  if (/lte|4g/i.test(n)) return "4G";
  if (/nr|5g/i.test(n)) return "5G";
  if (/wcdma|hspa|umts|3g/i.test(n)) return "3G";
  if (/gsm|edge|gprs|2g/i.test(n)) return "2G";
  return n;
}

export function HealthSection({ bag, className }: { bag: BagDetail; className?: string }) {
  const d = bag.device;
  const stale = bag.status === "gone" || bag.status === "idle";
  // Stale readings can't be called healthy: show them as last known.
  const live = (s: State): State => (stale && s === "ok" ? "info" : s);

  const rows: Row[] = [
    {
      label: "Last report",
      value: when(bag.lastReportAt),
      state: bag.status === "now" || bag.status === "day" ? "ok" : bag.lifecycle !== "active" ? "info" : bag.status === "idle" ? "warn" : "bad",
    },
    {
      label: "Location",
      value: d.gpsIntervalS ? `every ${d.gpsIntervalS} s` : "Not sending",
      state: d.gpsIntervalS ? live("ok") : "warn",
      note: d.gpsIntervalS ? undefined : "Its routes and hours can't be recorded",
    },
    {
      label: "Software",
      value: d.firmware ? `${d.firmware}${d.latestFirmware && d.firmware === d.latestFirmware ? " · latest" : ""}` : "Unknown",
      state: !d.firmware ? "info" : d.latestFirmware && d.firmware !== d.latestFirmware ? "warn" : "ok",
      note: d.firmware && d.latestFirmware && d.firmware !== d.latestFirmware ? `Latest in the fleet is ${d.latestFirmware}` : undefined,
    },
    {
      label: "Clock",
      value: bag.clock.label,
      state: bag.clock.ok === false ? "bad" : bag.clock.ok ? "ok" : "info",
      note: bag.clock.ok === false ? "Schedules would run at the wrong time" : undefined,
    },
    {
      label: "Mobile data",
      value: networkLabel(d.network) ?? "Unknown",
      state: networkLabel(d.network) ? live("ok") : "info",
    },
    {
      label: "Storage",
      value: d.storageUsedPct != null ? `${Math.round(d.storageUsedPct)}% used` : "Unknown",
      state: d.storageUsedPct == null ? "info" : d.storageUsedPct >= 85 ? "warn" : live("ok"),
      note: d.storageUsedPct != null && d.storageUsedPct >= 85 ? "Nearly full: new loops may not fit" : undefined,
    },
    {
      label: "Screen",
      value: d.powerOn == null ? "Unknown" : d.powerOn ? "On" : "Off",
      state: d.powerOn == null ? "info" : d.powerOn ? live("ok") : bag.status === "now" ? "warn" : "info",
      note: d.powerOn === false && bag.status === "now" ? "Out with its screen off" : undefined,
    },
    {
      label: "Connected",
      value: d.connected == null ? "Unknown" : d.connected ? "Yes" : "No",
      state: d.connected == null ? "info" : d.connected ? live("ok") : bag.status === "now" ? "warn" : "info",
    },
  ];

  const problems = rows.filter((r) => r.state === "warn" || r.state === "bad").length;

  return (
    <Section
      title="Health"
      sub={stale ? `From its last report, ${when(bag.lastReportAt)}` : undefined}
      action={
        problems === 0 ? (
          stale ? undefined : (
            <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-green-ink">
              <CircleCheck className="size-4" aria-hidden="true" />
              All normal
            </span>
          )
        ) : (
          <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-amber-ink">
            <AlertTriangle className="size-4" aria-hidden="true" />
            {problems} to check
          </span>
        )
      }
      className={className}
    >
      <dl className="m-0 grid grid-cols-2 gap-x-4">
        {rows.map((r) => {
          const Icon = STATE_ICON[r.state];
          return (
            <div key={r.label} className="flex min-w-0 flex-col gap-0.5 border-t border-rule-soft py-2">
              <dt className="flex items-center gap-1.5 text-xs text-muted">
                <Icon
                  className={cx(
                    "size-3.5 shrink-0",
                    r.state === "ok" && "text-green-ink",
                    r.state === "warn" && "text-amber-ink",
                    r.state === "bad" && "text-red-ink",
                    r.state === "info" && "text-caption",
                  )}
                  role="img"
                  aria-label={STATE_TEXT[r.state]}
                />
                {r.label}
              </dt>
              <dd
                className={cx(
                  "num m-0 text-sm font-semibold break-words",
                  r.state === "warn" && "text-amber-ink",
                  r.state === "bad" && "text-red-ink",
                )}
              >
                {r.value}
                {r.note && <span className="block text-xs font-normal text-ink-2">{r.note}</span>}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="m-0 border-t border-rule-soft pt-2.5 text-xs text-muted sm:hidden">
        {[d.model ? d.model.toUpperCase() : null, d.resolution, d.serial ? `Serial ${d.serial}` : null, `Colorlight ${bag.colorlightId}`]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </Section>
  );
}

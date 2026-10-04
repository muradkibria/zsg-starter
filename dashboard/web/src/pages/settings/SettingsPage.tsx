// Settings: one page with sections picked by ?section=. Desktop shows a
// sub-nav on the left; phones get a list of sections, then one section at a
// time. Everyone with settings.view can look; only the owner can change.

import { Link, useSearchParams } from "react-router";
import clsx from "clsx";
import { Cable, ChevronLeft, ChevronRight, ListChecks, Lock, Route, ShieldCheck, SlidersHorizontal, Users, Wallet } from "lucide-react";
import type { Permission } from "@digilite/shared";
import { Notice, Page, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { AuditSection } from "./AuditSection";
import { DefaultsSection, PaySection, PrivacySection, TrackingSection } from "./RuleSections";
import { ChangesSection, ColorlightSection } from "./SystemSections";
import { TeamSection } from "./TeamSection";

interface Section {
  key: string;
  label: string;
  desc: string;
  icon: typeof Users;
  perm?: Permission;
  render: () => React.ReactNode;
}

const SECTIONS: Section[] = [
  { key: "team", label: "Team & roles", desc: "Who can sign in and what they can do", icon: Users, render: () => <TeamSection /> },
  { key: "colorlight", label: "Colorlight connection", desc: "Sync status and errors", icon: Cable, render: () => <ColorlightSection /> },
  { key: "changes", label: "Changes to bags", desc: "Safety switch and the test bag", icon: ShieldCheck, render: () => <ChangesSection /> },
  { key: "defaults", label: "Fleet defaults", desc: "Fleet loop and brightness", icon: SlidersHorizontal, render: () => <DefaultsSection /> },
  { key: "tracking", label: "Tracking rules", desc: "Shifts, signal gaps and stops", icon: Route, render: () => <TrackingSection /> },
  { key: "pay", label: "Pay rules", desc: "Rate, minimum hours, signal gaps", icon: Wallet, render: () => <PaySection /> },
  { key: "privacy", label: "Data & privacy", desc: "Who sees what; everything is kept", icon: Lock, render: () => <PrivacySection /> },
  { key: "audit", label: "Audit log", desc: "Every change, in plain English", icon: ListChecks, perm: "audit.view", render: () => <AuditSection /> },
];

export default function SettingsPage() {
  const { can } = useAuth();
  const [params] = useSearchParams();
  const sections = SECTIONS.filter((s) => !s.perm || can(s.perm));
  const picked = sections.find((s) => s.key === params.get("section")) ?? null;
  const shown = picked ?? sections[0];
  const owner = can("settings.edit");

  return (
    <Page>
      <PageHeader title="Settings" sub="Every change here is written to the audit log." />
      <div className="flex gap-7">
        <nav aria-label="Settings sections" className="hidden w-[210px] shrink-0 flex-col gap-0.5 md:flex">
          {sections.map((s) => {
            const on = s.key === shown.key;
            return (
              <Link
                key={s.key}
                to={`?section=${s.key}`}
                aria-current={on ? "page" : undefined}
                className={clsx(
                  "flex h-10 items-center gap-2.5 rounded-[10px] px-3 text-sm whitespace-nowrap no-underline",
                  on ? "bg-white font-semibold text-navy ring-1 ring-rule" : "font-medium text-ink-2 hover:bg-paper-2",
                )}
              >
                <s.icon className="size-[17px]" strokeWidth={1.9} aria-hidden />
                {s.label}
              </Link>
            );
          })}
          <p className="mt-3 rounded-xl bg-info-bg p-3 text-xs leading-relaxed text-info-ink">
            {owner ? "You're the owner: you can change everything here." : "You can look at these settings. Only the owner can change them."}
          </p>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {/* Phones: a list of sections, then one section at a time */}
          {!picked && (
            <nav aria-label="Settings sections" className="card overflow-hidden md:hidden">
              {sections.map((s) => (
                <Link key={s.key} to={`?section=${s.key}`} className="flex min-h-16 items-center gap-3 border-b border-rule-soft px-4 py-2 text-ink no-underline last:border-b-0">
                  <s.icon className="size-5 shrink-0 text-muted" strokeWidth={1.8} aria-hidden />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[15px] font-semibold">{s.label}</span>
                    <span className="truncate text-xs text-muted">{s.desc}</span>
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-caption" aria-hidden />
                </Link>
              ))}
            </nav>
          )}
          {picked && (
            <Link to="/settings" className="flex h-10 items-center gap-1 self-start text-sm font-semibold text-accent no-underline md:hidden">
              <ChevronLeft className="size-4" aria-hidden />
              All settings
            </Link>
          )}
          {!owner && picked && <div className="md:hidden"><Notice>You can look at these settings. Only the owner can change them.</Notice></div>}
          <div className={clsx("min-w-0 max-w-[820px]", !picked && "hidden md:block")}>{shown.render()}</div>
        </div>
      </div>
    </Page>
  );
}

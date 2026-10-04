// Ads & loops: the ad library, the loops made from it, and what was sent to bags.

import { useRef, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router";
import clsx from "clsx";
import { Page, PageHeader } from "@/components/ui";
import { useCreatives, useLoops } from "./api";
import { CreativesTab } from "./CreativesTab";
import { LoopsTab } from "./LoopsTab";
import { SentTab } from "./SentTab";
import { plural } from "./bits";

type Tab = "creatives" | "loops" | "sent";
const TABS: Tab[] = ["creatives", "loops", "sent"];

export default function LoopsPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.includes(params.get("tab") as Tab) ? (params.get("tab") as Tab) : "creatives";
  const creatives = useCreatives();
  const loops = useLoops();

  const ads = creatives.data?.filter((c) => !c.archived).length;
  const loopCount = loops.data?.length;
  const bagsShowing = loops.data ? new Set(loops.data.flatMap((l) => l.bagsPlaying.map((b) => b.id))).size : undefined;
  const sub =
    ads !== undefined && loopCount !== undefined
      ? `${plural(ads, "ad")} · ${plural(loopCount, "loop")} · ${plural(bagsShowing ?? 0, "bag")} playing these loops`
      : "Your ads, the loops they play in, and what's been sent to bags";

  const go = (t: Tab) => {
    const next = new URLSearchParams();
    if (t !== "creatives") next.set("tab", t);
    setParams(next);
  };

  return (
    <Page>
      <PageHeader
        title="Ads & loops"
        sub={sub}
        actions={
          <AreaTabs
            value={tab}
            onChange={go}
            tabs={[
              { value: "creatives", label: "Creatives", count: ads },
              { value: "loops", label: "Loops", count: loopCount },
              { value: "sent", label: "Sent" },
            ]}
          />
        }
      />
      <div role="tabpanel" id={`loops-panel-${tab}`} aria-labelledby={`loops-tab-${tab}`}>
        {tab === "creatives" && <CreativesTab />}
        {tab === "loops" && <LoopsTab />}
        {tab === "sent" && <SentTab />}
      </div>
    </Page>
  );
}

function AreaTabs({ value, onChange, tabs }: { value: Tab; onChange: (t: Tab) => void; tabs: { value: Tab; label: string; count?: number }[] }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + tabs.length) % tabs.length;
    refs.current[n]?.focus();
    onChange(tabs[n].value);
  };
  return (
    <div role="tablist" aria-label="Ads and loops" className="flex gap-0.5 rounded-xl bg-paper-2 p-1">
      {tabs.map((t, i) => (
        <button
          key={t.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          id={`loops-tab-${t.value}`}
          role="tab"
          type="button"
          aria-selected={t.value === value}
          aria-controls={`loops-panel-${t.value}`}
          tabIndex={t.value === value ? 0 : -1}
          onClick={() => onChange(t.value)}
          onKeyDown={(e) => onKey(e, i)}
          className={clsx(
            "flex h-10 items-center gap-1.5 rounded-[9px] px-4 text-[13px] md:h-[34px]",
            t.value === value ? "bg-white font-semibold text-ink shadow-[0_1px_2px_rgb(16_24_43/0.08)]" : "font-medium text-ink-2 hover:text-ink",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="num font-medium text-caption">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

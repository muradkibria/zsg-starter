// Pick the ad files that belong to a campaign. Likely matches for the
// advertiser come first; library records sharing one file are one choice
// (plays can't tell them apart).

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Check, Search } from "lucide-react";
import type { CampaignCreativeFile, CampaignDetail } from "@digilite/shared";
import { Button, ErrorState, Input, Notice, Spinner } from "@/components/ui";
import { useFeedback } from "@/components/feedback";
import { useLinkCreatives, useSuggestedCreatives } from "../api";
import { n, plural } from "../format";
import { CreativeThumb } from "./CreativeThumb";
import { Sheet } from "./Sheet";

export function CreativePicker({ open, onClose, campaign }: { open: boolean; onClose: () => void; campaign: CampaignDetail }) {
  const q = useSuggestedCreatives(campaign.id, open);
  const link = useLinkCreatives(campaign.id);
  const { toast } = useFeedback();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [term, setTerm] = useState("");

  useEffect(() => {
    if (open) {
      setChosen(new Set(campaign.chain.files.map((f) => f.key)));
      setTerm("");
    }
  }, [open, campaign.chain.files]);

  const all = useMemo(() => [...(q.data?.suggested ?? []), ...(q.data?.others ?? [])], [q.data]);
  const byKey = useMemo(() => new Map(all.map((f) => [f.key, f])), [all]);
  const t = term.trim().toLowerCase();
  const match = (f: CampaignCreativeFile) => !t || f.name.toLowerCase().includes(t) || f.loops.some((l) => l.toLowerCase().includes(t));
  const suggested = (q.data?.suggested ?? []).filter(match);
  const others = (q.data?.others ?? []).filter(match);
  const moving = [...chosen].map((k) => byKey.get(k)).filter((f): f is CampaignCreativeFile => !!f && !!f.campaignId && f.campaignId !== campaign.id);
  const initial = new Set(campaign.chain.files.map((f) => f.key));
  const changed = chosen.size !== initial.size || [...chosen].some((k) => !initial.has(k));

  const toggle = (k: string) =>
    setChosen((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const save = async () => {
    const ids = [...chosen].flatMap((k) => byKey.get(k)?.ids ?? campaign.chain.files.find((f) => f.key === k)?.ids ?? []);
    try {
      const res = await link.mutateAsync(ids);
      const moved = res.moved.length ? ` · moved from ${res.moved.map((m) => m.campaignLabel).join(", ")}` : "";
      toast(`${plural(res.files, "ad")} linked${moved}`);
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't save", "error");
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      wide
      title="Link creatives"
      sub={`${campaign.advertiser} — ${campaign.name}. Plays of the ads you pick are counted for this campaign.`}
      footer={
        <>
          <span className="mr-auto text-[13px] text-muted">{chosen.size ? `${plural(chosen.size, "ad")} picked` : "None picked"}</span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} loading={link.isPending} disabled={!changed || !q.data}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="relative block">
          <span className="sr-only">Search creatives</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search by name or loop" className="pl-9" data-autofocus />
        </label>
        {q.isLoading && <Spinner label="Loading the library…" />}
        {q.error && <ErrorState error={q.error} retry={() => void q.refetch()} />}
        {moving.length > 0 && (
          <Notice tone="amber">
            {moving.length === 1 ? `“${moving[0].name}” is linked to ${moving[0].campaignLabel}.` : `${moving.length} of these are linked to other campaigns.`} Saving moves{" "}
            {moving.length === 1 ? "it" : "them"} here — an ad counts for one campaign only.
          </Notice>
        )}
        {q.data && (
          <>
            <Group
              title={`Likely matches for ${q.data.advertiser}`}
              empty={t ? "No likely matches for that search." : `Nothing in the library looks like ${q.data.advertiser}'s. Search below.`}
              files={suggested}
              chosen={chosen}
              toggle={toggle}
              campaignId={campaign.id}
            />
            <Group title="Everything else in the library" empty="No other creatives match that search." files={others} chosen={chosen} toggle={toggle} campaignId={campaign.id} />
          </>
        )}
      </div>
    </Sheet>
  );
}

function Group({
  title,
  empty,
  files,
  chosen,
  toggle,
  campaignId,
}: {
  title: string;
  empty: string;
  files: CampaignCreativeFile[];
  chosen: Set<string>;
  toggle: (k: string) => void;
  campaignId: string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-[13px] font-semibold text-ink-2">
        {title} <span className="font-normal text-muted">· {files.length}</span>
      </h3>
      {files.length === 0 ? (
        <p className="m-0 text-[13px] text-muted">{empty}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {files.map((f) => {
            const on = chosen.has(f.key);
            const elsewhere = f.campaignId && f.campaignId !== campaignId;
            return (
              <li key={f.key}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggle(f.key)}
                  className={clsx(
                    "flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors",
                    on ? "border-navy bg-tint-2" : "border-rule bg-white hover:border-line",
                  )}
                >
                  <span className={clsx("flex size-5 shrink-0 items-center justify-center rounded-[5px]", on ? "bg-navy text-white" : "border-2 border-line")}>
                    {on && <Check className="size-3.5" strokeWidth={3.5} />}
                  </span>
                  <CreativeThumb id={f.thumbId} name={f.name} size="sm" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold">{f.name}</span>
                    <span className="text-xs text-muted">
                      {[
                        f.durationS ? `${f.durationS} s` : null,
                        f.loops.length ? `in ${f.loops.slice(0, 2).join(", ")}${f.loops.length > 2 ? ` +${f.loops.length - 2}` : ""}` : "in no loop",
                        f.playsLast7 ? `${n(f.playsLast7)} plays this week` : "no plays this week",
                        f.ids.length > 1 ? `${f.ids.length} copies in the library` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {(f.match || elsewhere) && (
                      <span className={clsx("truncate text-xs", elsewhere ? "font-semibold text-amber-ink" : "text-green-ink")}>
                        {elsewhere ? `Linked to ${f.campaignLabel}` : f.match!.reason}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

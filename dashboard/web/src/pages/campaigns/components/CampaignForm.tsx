// New / edit campaign, in a sheet. Dates are London days; the end date is the
// campaign's last day. Start and end both offer presets as well as a calendar.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { addDays, todayLondon, type CampaignDetail, type CampaignInput } from "@digilite/shared";
import { Button, Chip, Field, Input, Notice, Switch, Textarea } from "@/components/ui";
import { useFeedback } from "@/components/feedback";
import { ApiError } from "@/lib/api";
import { useCampaigns, useCreateCampaign, useDeleteCampaign, useUpdateCampaign } from "../api";
import { dayDiff, dayRange } from "../format";
import { Sheet } from "./Sheet";

function nextMonday(today: string): string {
  const wd = new Date(`${today}T12:00:00Z`).getUTCDay();
  return addDays(today, ((8 - wd) % 7) || 7);
}
function firstOfNextMonth(today: string): string {
  const [y, m] = today.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}
function plusMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, d));
  // Same date N months on, minus a day (1 Oct + 3 months → 31 Dec)
  return addDays(`${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`, -1);
}

const DURATIONS = [
  { label: "2 weeks", end: (s: string) => addDays(s, 13) },
  { label: "4 weeks", end: (s: string) => addDays(s, 27) },
  { label: "8 weeks", end: (s: string) => addDays(s, 55) },
  { label: "3 months", end: (s: string) => plusMonths(s, 3) },
];

function blank(): CampaignInput {
  const start = nextMonday(todayLondon());
  return { advertiser: "", name: "", startDay: start, endDay: addDays(start, 27), contractedBags: 10, confirmed: false, notes: "" };
}

export function CampaignForm({ open, onClose, campaign }: { open: boolean; onClose: () => void; campaign?: CampaignDetail }) {
  const editing = !!campaign;
  const nav = useNavigate();
  const { toast, confirm } = useFeedback();
  const list = useCampaigns();
  const create = useCreateCampaign();
  const update = useUpdateCampaign(campaign?.id ?? "");
  const remove = useDeleteCampaign(campaign?.id ?? "");
  const [v, setV] = useState<CampaignInput>(blank);
  const [bagsText, setBagsText] = useState("10");
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (campaign) {
      const start = campaign.startDay ?? todayLondon();
      setV({
        advertiser: campaign.advertiser,
        name: campaign.name,
        startDay: start,
        endDay: campaign.endDay ?? addDays(start, 27),
        contractedBags: campaign.contractedBags,
        confirmed: campaign.confirmed,
        notes: campaign.notes,
      });
      setBagsText(String(campaign.contractedBags));
    } else {
      const b = blank();
      setV(b);
      setBagsText(String(b.contractedBags));
    }
  }, [open, campaign]);

  const advertisers = useMemo(() => [...new Set((list.data?.campaigns ?? []).map((c) => c.advertiser))].sort(), [list.data]);
  const today = todayLondon();
  const set = <K extends keyof CampaignInput>(k: K, value: CampaignInput[K]) => setV((x) => ({ ...x, [k]: value }));
  const setStart = (s: string) => {
    if (!s) return;
    // Keep the same length when the start moves.
    const len = dayDiff(v.startDay, v.endDay);
    setV((x) => ({ ...x, startDay: s, endDay: addDays(s, Math.max(0, len)) }));
  };
  const days = dayDiff(v.startDay, v.endDay) + 1;
  const endBeforeStart = v.endDay < v.startDay;
  const bags = Number(bagsText);
  const bagsBad = !/^\d+$/.test(bagsText.trim()) || bags > 10000;
  const busy = create.isPending || update.isPending || remove.isPending;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (endBeforeStart || bagsBad) return;
    setError(null);
    const body: CampaignInput = { ...v, advertiser: v.advertiser.trim(), name: v.name.trim(), contractedBags: bags };
    try {
      if (editing) {
        await update.mutateAsync(body);
        toast("Campaign saved");
        onClose();
      } else {
        const c = await create.mutateAsync(body);
        toast(`${c.advertiser} — ${c.name} added`);
        onClose();
        nav(`/campaigns/${c.id}`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "Couldn't save the campaign"));
    }
  };

  const del = async () => {
    if (!campaign) return;
    const ok = await confirm({
      title: `Delete ${campaign.advertiser} — ${campaign.name}?`,
      body:
        campaign.creativeFiles > 0
          ? `Its ${campaign.creativeFiles} linked ${campaign.creativeFiles === 1 ? "creative is" : "creatives are"} unlinked but stay in the library, and plays already recorded stay with the bags. This can't be undone.`
          : "Plays already recorded stay with the bags. This can't be undone.",
      confirm: "Delete campaign",
      danger: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync();
      toast("Campaign deleted");
      onClose();
      nav("/campaigns");
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, "Couldn't delete the campaign"));
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={editing ? "Edit campaign" : "New campaign"}
      sub={editing ? `${campaign!.advertiser} — ${campaign!.name}` : "A contract with an advertiser. Link its creatives once it's saved."}
      footer={
        <>
          {editing && (
            <Button variant="danger" onClick={() => void del()} loading={remove.isPending} disabled={busy} className="mr-auto">
              Delete
            </Button>
          )}
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="campaign-form" loading={create.isPending || update.isPending} disabled={busy || endBeforeStart || bagsBad}>
            {editing ? "Save changes" : "Add campaign"}
          </Button>
        </>
      }
    >
      <form id="campaign-form" onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        {error && (
          <Notice tone="red">
            <strong>{error.message}.</strong> {error.detail && <span className="whitespace-pre-line">{error.detail}</span>}
          </Notice>
        )}
        <Field label="Advertiser">
          <Input required list="campaign-advertisers" value={v.advertiser} maxLength={200} onChange={(e) => set("advertiser", e.target.value)} placeholder="e.g. Isla Delice" data-autofocus />
          <datalist id="campaign-advertisers">
            {advertisers.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </Field>
        <Field label="Campaign name">
          <Input required value={v.name} maxLength={200} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Autumn menu" />
        </Field>

        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-3">
            <Field label="First day">
              <Input type="date" required value={v.startDay} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Last day" error={endBeforeStart ? "Before the first day" : undefined}>
              <Input type="date" required value={v.endDay} min={v.startDay} onChange={(e) => e.target.value && set("endDay", e.target.value)} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Start presets">
            <span className="w-12 text-xs text-muted">Starts</span>
            {[
              { label: "Today", day: today },
              { label: "Next Monday", day: nextMonday(today) },
              { label: "1st of next month", day: firstOfNextMonth(today) },
            ].map((p) => (
              <Chip key={p.label} active={v.startDay === p.day} onClick={() => setStart(p.day)}>
                {p.label}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Length presets">
            <span className="w-12 text-xs text-muted">Runs</span>
            {DURATIONS.map((d) => (
              <Chip key={d.label} active={v.endDay === d.end(v.startDay)} onClick={() => set("endDay", d.end(v.startDay))}>
                {d.label}
              </Chip>
            ))}
          </div>
          {!endBeforeStart && (
            <p className="m-0 text-xs text-muted">
              {dayRange(v.startDay, v.endDay)} · {days} {days === 1 ? "day" : "days"}, London time
            </p>
          )}
        </div>

        <Field label="Bags contracted" hint="How many bags the advertiser is paying for." error={bagsBad ? "Enter a whole number" : undefined}>
          <Input inputMode="numeric" value={bagsText} onChange={(e) => setBagsText(e.target.value)} className="w-32" />
        </Field>

        <div className="rounded-xl bg-paper px-3.5 py-3">
          <Switch checked={v.confirmed} onChange={(c) => set("confirmed", c)} label={<span className="font-semibold">Confirmed with the advertiser</span>} />
          <p className="m-0 mt-1.5 pl-14 text-xs text-muted">
            {v.confirmed ? "Counts as sold from its first day." : "Saved as a draft. It isn't counted as sold until it's confirmed."}
          </p>
        </div>

        <Field label="Notes" hint="Internal only — never shown to the advertiser.">
          <Textarea value={v.notes ?? ""} maxLength={5000} onChange={(e) => set("notes", e.target.value)} placeholder="Contact, invoicing, anything to remember" />
        </Field>
      </form>
    </Sheet>
  );
}

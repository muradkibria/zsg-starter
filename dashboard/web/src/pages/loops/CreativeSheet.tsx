// One ad: preview, measured plays, where it's used, details and actions.

import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Plus, Trash2, TriangleAlert } from "lucide-react";
import { creativeSizeLabel, type LibraryCreative, type LoopDetail } from "@digilite/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFeedback } from "@/components/feedback";
import { Button, Field, Input, Notice, Pill, Select, Stat } from "@/components/ui";
import { date, num } from "@/lib/format";
import { lk, useCampaignOptions, useCreateLoop, useDeleteCreative, useLoops, useUpdateCreative } from "./api";
import { FleetPill, LoopStatusPill, secs, Sheet, Thumb } from "./bits";

export function CreativeSheet({ creative, onClose, advertisers }: { creative: LibraryCreative | null; onClose: () => void; advertisers: string[] }) {
  return (
    <Sheet open={!!creative} onClose={onClose} title={creative?.name ?? "Ad"}>
      {creative && <CreativeDetail key={creative.id} c={creative} onClose={onClose} advertisers={advertisers} />}
    </Sheet>
  );
}

function CreativeDetail({ c, onClose, advertisers }: { c: LibraryCreative; onClose: () => void; advertisers: string[] }) {
  const { can } = useAuth();
  const canEdit = can("loops.edit");
  const { toast, confirm } = useFeedback();
  const nav = useNavigate();
  const qc = useQueryClient();
  const update = useUpdateCreative();
  const del = useDeleteCreative();
  const createLoop = useCreateLoop();
  const campaigns = useCampaignOptions(canEdit);
  const loops = useLoops();
  const [name, setName] = useState(c.name);
  const [advertiser, setAdvertiser] = useState(c.advertiser);
  const [campaign, setCampaign] = useState(c.campaign?.id ?? "");
  const [target, setTarget] = useState("");
  const [adding, setAdding] = useState(false);
  const dirty = name.trim() !== c.name || advertiser.trim() !== c.advertiser || campaign !== (c.campaign?.id ?? "");
  const drafts = useMemo(() => (loops.data ?? []).filter((l) => l.status === "draft"), [loops.data]);
  const canDelete = c.source === "uploaded" && !c.onColorlight && c.loops.length === 0;
  const isVideoFile = c.mediaType === "video" && !!c.fileUrl;
  const seconds = c.mediaType === "video" && c.durationS ? c.durationS : 10;

  const save = async () => {
    try {
      await update.mutateAsync({ id: c.id, patch: { name: name.trim(), advertiser: advertiser.trim(), campaign: campaign || null } });
      toast("Saved");
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const setArchived = async (archived: boolean) => {
    if (archived && c.bagsNow > 0) {
      const ok = await confirm({
        title: `Archive "${c.name}"?`,
        body: `It's still on ${c.bagsNow} ${c.bagsNow === 1 ? "bag" : "bags"}. Archiving hides it from the library; it stays on those bags until you send a loop without it.`,
        confirm: "Archive",
      });
      if (!ok) return;
    }
    try {
      await update.mutateAsync({ id: c.id, patch: { archived } });
      toast(archived ? `Archived "${c.name}"` : `"${c.name}" is back in the library`);
      if (archived) onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const remove = async () => {
    const ok = await confirm({ title: `Delete "${c.name}"?`, body: "It was never sent to a bag. This can't be undone.", confirm: "Delete", danger: true });
    if (!ok) return;
    try {
      await del.mutateAsync(c.id);
      toast(`Deleted "${c.name}"`);
      onClose();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  const addToDraft = async () => {
    if (!target) return;
    setAdding(true);
    try {
      if (target === "new") {
        const loop = await createLoop.mutateAsync({ name: `Loop with ${c.name}`.slice(0, 120), items: [{ creative: c.id, seconds }] });
        nav(`/loops/${loop.id}`);
        return;
      }
      const loop = drafts.find((l) => l.id === target);
      if (!loop) return;
      const items = [...loop.items.map((i) => ({ creative: i.creativeId, seconds: i.seconds })), { creative: c.id, seconds }];
      const saved = await api.patch<LoopDetail>(`/loops/${loop.id}`, { items });
      qc.setQueryData(lk.loop(loop.id), saved);
      void qc.invalidateQueries({ queryKey: lk.all });
      toast(
        <span>
          Added to "{loop.name}".{" "}
          <Link to={`/loops/${loop.id}`} className="font-semibold text-white underline">
            Open the loop
          </Link>
        </span>,
      );
      setTarget("");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setAdding(false);
    }
  };

  const facts = [
    c.mediaType === "video" ? "Video" : "Image",
    c.durationS ? secs(c.durationS) : null,
    c.width && c.height ? `${c.width} × ${c.height}` : null,
    c.sizeBytes ? creativeSizeLabel(c.sizeBytes) : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-5">
      {/* Preview */}
      <div className="flex flex-col gap-2">
        {isVideoFile ? (
          <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-ink p-[6%]">
            <video
              src={c.fileUrl!}
              poster={c.thumbUrl ?? undefined}
              muted
              loop
              autoPlay
              playsInline
              controls
              className="size-full rounded-sm bg-[#1d2436] object-cover"
              aria-label={`Preview of ${c.name}`}
            />
          </div>
        ) : (
          <Thumb src={c.thumbUrl} alt={`Preview of ${c.name}`} />
        )}
        <p className="m-0 text-[13px] text-muted">
          {facts.join(" · ")}
          {" · "}
          {c.source === "colorlight" ? "From Colorlight" : c.onColorlight ? "Uploaded here · in Colorlight" : "Uploaded here"}
        </p>
        {c.source === "uploaded" && !c.onColorlight && (
          <p className="m-0 text-xs text-muted">It goes up to Colorlight the first time a loop with it is sent.</p>
        )}
        {c.source === "colorlight" && !c.fileUrl && (
          <p className="m-0 text-xs text-muted">The file hasn't arrived from Colorlight yet; this is its thumbnail.</p>
        )}
      </div>

      {/* Real problems only */}
      {c.endedStillPlaying && c.campaign && (
        <Notice tone="amber" icon={<TriangleAlert className="size-4" />}>
          The {c.campaign.name} campaign ended {date(c.campaign.endDate)}, but this ad is still on {c.bagsNow} {c.bagsNow === 1 ? "bag" : "bags"}. Send a loop without it.
        </Notice>
      )}
      {c.screenShape === false && (
        <Notice tone="amber" icon={<TriangleAlert className="size-4" />}>
          Not the screen's shape: {c.width} × {c.height} isn't 4:3, so it looks squashed on the 160 × 120 screen.
        </Notice>
      )}
      {c.archived && <Notice tone="info">Archived — hidden from the library and the loop editor.</Notice>}

      {/* Measured */}
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Plays, 7 days" value={num(c.plays7d)} />
        <Stat label="On bags now" value={c.bagsNow} tone={c.endedStillPlaying ? "amber" : undefined} />
        <Stat label="In loops" value={c.loops.length} />
      </div>
      {c.copies > 1 && (
        <p className="-mt-3 m-0 text-xs text-muted">
          Colorlight holds {c.copies} identical copies of this file. They're shown here as one ad, and plays are counted once.
        </p>
      )}

      {/* Where it's used */}
      {c.loops.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-sm font-semibold">In these loops</h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {c.loops.map((l) => (
              <li key={l.id}>
                <Link to={`/loops/${l.id}`} className="flex min-h-11 items-center gap-2 rounded-[10px] px-2 py-1.5 text-sm text-ink no-underline hover:bg-paper">
                  <span className="min-w-0 flex-1 font-semibold break-words">{l.name}</span>
                  {l.isFleetLoop && <FleetPill />}
                  {l.status === "draft" && <LoopStatusPill status="draft" onBags={1} />}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canEdit && !c.archived && (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-sm font-semibold">Add to a loop</h3>
          <div className="flex gap-2">
            <Select aria-label="Loop to add this ad to" value={target} onChange={(e) => setTarget(e.target.value)} className="min-w-0 flex-1">
              <option value="">Choose a draft loop…</option>
              {drafts.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
              <option value="new">New loop with this ad</option>
            </Select>
            <Button variant="secondary" onClick={() => void addToDraft()} disabled={!target} loading={adding} icon={<Plus className="size-4" />}>
              Add
            </Button>
          </div>
          {!drafts.length && <p className="m-0 text-xs text-muted">Only draft loops can change. Loops from Colorlight can be duplicated as a draft first.</p>}
        </section>
      )}

      {/* Details */}
      {canEdit ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h3 className="m-0 text-sm font-semibold">Details</h3>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={300} required />
          </Field>
          <Field label="Advertiser">
            <Input value={advertiser} onChange={(e) => setAdvertiser(e.target.value)} list="loops-sheet-advertisers" maxLength={200} placeholder="Who the ad is for" />
            <datalist id="loops-sheet-advertisers">
              {advertisers.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </Field>
          <Field label="Campaign" hint={campaigns.data && !campaigns.data.length ? "No campaigns yet." : undefined}>
            <Select value={campaign} onChange={(e) => setCampaign(e.target.value)}>
              <option value="">No campaign</option>
              {(campaigns.data ?? []).map((k) => (
                <option key={k.id} value={k.id}>
                  {k.advertiser ? `${k.advertiser}: ${k.name}` : k.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={!dirty || !name.trim()} loading={update.isPending && dirty}>
              Save details
            </Button>
          </div>
        </form>
      ) : (
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Advertiser</dt>
          <dd className="m-0">{c.advertiser || "—"}</dd>
          <dt className="text-muted">Campaign</dt>
          <dd className="m-0">{c.campaign?.name ?? "—"}</dd>
        </dl>
      )}

      {canEdit && (
        <div className="flex flex-wrap gap-2 border-t border-rule pt-4">
          {c.archived ? (
            <Button onClick={() => void setArchived(false)} icon={<ArchiveRestore className="size-4" />}>
              Unarchive
            </Button>
          ) : (
            <Button onClick={() => void setArchived(true)} icon={<Archive className="size-4" />}>
              Archive
            </Button>
          )}
          {canDelete && (
            <Button variant="danger" onClick={() => void remove()} icon={<Trash2 className="size-4" />}>
              Delete
            </Button>
          )}
          {c.source === "uploaded" && !canDelete && c.loops.length > 0 && (
            <span className="self-center text-xs text-muted">In a loop, so it can be archived but not deleted.</span>
          )}
          {c.archived && <Pill tone="neutral">Archived</Pill>}
        </div>
      )}
    </div>
  );
}

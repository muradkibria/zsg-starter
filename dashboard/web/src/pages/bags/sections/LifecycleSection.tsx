// Lifecycle: active, in storage, in repair, lost or retired, with a note.
// Anything other than active stops a quiet bag counting as missing.

import { useEffect, useState } from "react";
import { BAG_LIFECYCLE_HINT, BAG_LIFECYCLE_LABEL, BAG_LIFECYCLES, type BagDetail, type Lifecycle } from "@digilite/shared";
import { useAuth } from "@/lib/auth";
import { useBagPatch } from "@/lib/queries";
import { useFeedback } from "@/components/feedback";
import { Button, Textarea, cx } from "@/components/ui";
import { LifecyclePill, Section } from "../bits";

export function LifecycleSection({ bag, className }: { bag: BagDetail; className?: string }) {
  const { can } = useAuth();
  const canEdit = can("bags.edit");
  const patch = useBagPatch(bag.id);
  const { toast, confirm } = useFeedback();
  const [choice, setChoice] = useState<Lifecycle>(bag.lifecycle);
  const [note, setNote] = useState(bag.lifecycleNote);

  // Pick up changes made elsewhere (e.g. the register's bulk action).
  useEffect(() => setChoice(bag.lifecycle), [bag.lifecycle]);
  useEffect(() => setNote(bag.lifecycleNote), [bag.lifecycleNote]);

  const dirty = choice !== bag.lifecycle || note.trim() !== bag.lifecycleNote.trim();

  async function save() {
    if (choice !== bag.lifecycle && (choice === "retired" || choice === "lost")) {
      const ok = await confirm({
        title: choice === "retired" ? `Retire ${bag.name}?` : `Mark ${bag.name} as lost?`,
        body:
          choice === "retired"
            ? "It leaves the fleet: hidden from the map and the counts, and it won't be flagged as missing. Its history stays. You can bring it back by setting it to Active."
            : "It stops counting as missing. If it turns up, set it back to Active.",
        confirm: choice === "retired" ? "Retire" : "Mark as lost",
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await patch.mutateAsync({ lifecycle: choice, lifecycleNote: note.trim() });
      toast(choice !== bag.lifecycle ? `${bag.name} marked as ${BAG_LIFECYCLE_LABEL[choice].toLowerCase()}` : "Note saved");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Couldn't save that", "error");
    }
  }

  if (!canEdit) {
    return (
      <Section title="Lifecycle" className={className}>
        <div className="flex items-center gap-2 text-sm">
          {bag.lifecycle === "active" ? <span className="font-semibold">Active</span> : <LifecyclePill lifecycle={bag.lifecycle} />}
          <span className="text-muted">{BAG_LIFECYCLE_HINT[bag.lifecycle]}</span>
        </div>
        {bag.lifecycleNote && <p className="m-0 rounded-lg bg-paper px-3 py-2 text-[13px] text-ink-2">{bag.lifecycleNote}</p>}
      </Section>
    );
  }

  return (
    <Section title="Lifecycle" sub={BAG_LIFECYCLE_HINT[choice]} className={className}>
      <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
        <legend className="sr-only">Lifecycle of {bag.name}</legend>
        {BAG_LIFECYCLES.map((l) => (
          <label key={l} className="relative">
            <input type="radio" name={`lifecycle-${bag.id}`} value={l} checked={choice === l} onChange={() => setChoice(l)} className="peer sr-only" />
            <span
              className={cx(
                "inline-flex h-11 cursor-pointer items-center rounded-full border px-3.5 text-[13px] font-semibold select-none md:h-9",
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-logo",
                choice === l ? "border-navy bg-navy text-white" : "border-line bg-white text-ink hover:bg-paper",
              )}
            >
              {BAG_LIFECYCLE_LABEL[l]}
            </span>
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
        Note
        <Textarea
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder={choice === "active" ? "Anything worth knowing about this bag" : "Where is it, or what's wrong with it?"}
        />
      </label>
      <div className="flex items-center justify-end gap-2">
        {dirty && (
          <Button
            variant="ghost"
            onClick={() => {
              setChoice(bag.lifecycle);
              setNote(bag.lifecycleNote);
            }}
            className="min-h-11 md:min-h-0"
          >
            Cancel
          </Button>
        )}
        <Button variant="primary" disabled={!dirty} loading={patch.isPending} onClick={() => void save()} className="min-h-11 md:min-h-0">
          Save
        </Button>
      </div>
    </Section>
  );
}

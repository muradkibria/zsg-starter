// Bags with their own schedule (they don't follow the fleet schedule).

import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Plus } from "lucide-react";
import { Button, Card, CardHeader, Field, Select, Spinner, StatusIcon } from "@/components/ui";
import { useFeedback } from "@/components/feedback";
import { when } from "@/lib/format";
import { useSaveSchedule, useScheduleBags } from "./api";
import { Sheet } from "./parts";

export function OverridesCard({ canEdit }: { canEdit: boolean }) {
  const bags = useScheduleBags();
  const [picking, setPicking] = useState(false);
  const own = (bags.data ?? []).filter((b) => b.own);
  return (
    <Card className="flex flex-col gap-3 p-4 md:p-5" aria-label="Bag overrides">
      <CardHeader
        title="Bag overrides"
        sub="Bags with their own schedule instead of this one"
        action={
          canEdit ? (
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setPicking(true)} className="h-11 md:h-8">
              Add
            </Button>
          ) : undefined
        }
      />
      {bags.isLoading ? (
        <Spinner />
      ) : own.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {own.map((b) => (
            <li key={b.id} className="flex items-center gap-2.5 rounded-[10px] border border-paper-2 p-2.5">
              <StatusIcon status={b.status} size={16} />
              <div className="flex min-w-0 flex-1 flex-col">
                <Link to={`/bags/${b.id}`} className="text-[13px] font-semibold">
                  {b.name}
                  {b.isTestBag && <span className="font-normal text-muted"> · test bag</span>}
                </Link>
                <span className="text-xs text-muted">
                  {b.own!.rules} {b.own!.rules === 1 ? "rule" : "rules"}
                  {b.own!.defaultLoop ? ` · ${b.own!.defaultLoop} by default` : ""} · {b.own!.brightness ? "own brightness" : "no brightness plan"}
                  {b.own!.appliedAt ? ` · applied ${when(b.own!.appliedAt)}` : " · not applied yet"}
                </span>
              </div>
              <Link
                to={`/schedules?bag=${b.id}`}
                className="inline-flex h-11 shrink-0 items-center rounded-lg px-3 text-[13px] font-semibold text-accent no-underline hover:bg-paper md:h-8"
              >
                {canEdit ? "Edit" : "View"}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[13px] text-ink-2">No bag has its own schedule. Every bag follows this one.</p>
      )}
      {picking && <PickBagSheet onClose={() => setPicking(false)} />}
    </Card>
  );
}

function PickBagSheet({ onClose }: { onClose: () => void }) {
  const bags = useScheduleBags();
  const [bagId, setBagId] = useState("");
  const save = useSaveSchedule(bagId || null);
  const nav = useNavigate();
  const { toast } = useFeedback();
  const choices = (bags.data ?? []).filter((b) => !b.own && b.lifecycle !== "retired" && b.lifecycle !== "lost");
  const picked = choices.find((b) => b.id === bagId);
  const go = async () => {
    if (!bagId) return;
    try {
      await save.mutateAsync({ copyFleet: true });
      toast(`${picked?.name ?? "The bag"} now has its own schedule, copied from the fleet one`);
      onClose();
      nav(`/schedules?bag=${bagId}`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title="Give a bag its own schedule"
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} className="h-11">
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void go()} disabled={!bagId} loading={save.isPending} className="h-11">
            Copy the fleet schedule
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="m-0 text-sm text-ink-2">
          It starts as a copy of the fleet schedule. Change it, then apply it to that bag. The bag stops following the fleet schedule until you remove its own.
        </p>
        <Field label="Bag">
          <Select value={bagId} onChange={(e) => setBagId(e.target.value)} className="h-11">
            <option value="">Pick a bag</option>
            {choices.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.isTestBag ? " (test bag)" : ""}
                {b.clock.ok === false ? ` · clock on ${b.clock.label}` : ""}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Sheet>
  );
}

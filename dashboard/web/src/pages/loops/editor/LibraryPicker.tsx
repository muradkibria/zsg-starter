// Pick ads from the library to add to the end of the loop.

import { useMemo, useState } from "react";
import clsx from "clsx";
import { Check, Search } from "lucide-react";
import type { LibraryCreative } from "@digilite/shared";
import { Button, Chip, EmptyState, Input, Spinner } from "@/components/ui";
import { num } from "@/lib/format";
import { useCreatives } from "../api";
import { secs, Sheet, Thumb } from "../bits";

export function LibraryPicker({
  open,
  onClose,
  inLoop,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  /** File keys already in the loop */
  inLoop: Set<string>;
  onAdd: (picked: LibraryCreative[]) => void;
}) {
  const library = useCreatives();
  const [q, setQ] = useState("");
  const [onlyOnBags, setOnlyOnBags] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (library.data ?? []).filter(
      (c) => !c.archived && (!onlyOnBags || c.bagsNow > 0) && (!term || `${c.name} ${c.advertiser}`.toLowerCase().includes(term)),
    );
  }, [library.data, q, onlyOnBags]);

  const close = () => {
    setPicked([]);
    setQ("");
    onClose();
  };

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const add = () => {
    const byId = new Map((library.data ?? []).map((c) => [c.id, c]));
    onAdd(picked.map((id) => byId.get(id)!).filter(Boolean));
    close();
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Add ads"
      width={560}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-muted">{picked.length ? `${picked.length} picked · added in the order you picked them` : "Pick one or more"}</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!picked.length} onClick={add}>
              {picked.length > 1 ? `Add ${picked.length}` : "Add"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="relative">
          <span className="sr-only">Search the library</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-caption" aria-hidden="true" />
          <Input data-autofocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ads or advertisers" className="pl-9" />
        </label>
        <div className="flex gap-2">
          <Chip active={!onlyOnBags} onClick={() => setOnlyOnBags(false)}>
            All ads
          </Chip>
          <Chip active={onlyOnBags} onClick={() => setOnlyOnBags(true)}>
            On bags now
          </Chip>
        </div>
        {library.isLoading ? (
          <Spinner label="Loading the library…" />
        ) : !list.length ? (
          <EmptyState title="No ads match" body={q ? "Try another name." : "Upload ads on the Creatives tab first."} />
        ) : (
          <ul className="m-0 grid list-none grid-cols-2 gap-2.5 p-0 sm:grid-cols-3">
            {list.map((c) => {
              const order = picked.indexOf(c.id);
              const on = order >= 0;
              return (
                <li key={c.id} className="min-w-0">
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(c.id)}
                    className={clsx(
                      "flex w-full min-w-0 flex-col gap-1.5 rounded-xl border p-2 text-left",
                      on ? "border-navy bg-tint-2 ring-1 ring-navy" : "border-rule bg-white hover:border-line",
                    )}
                  >
                    <Thumb src={c.thumbUrl} badge={c.durationS ? secs(c.durationS) : null}>
                      {on && (
                        <span className="absolute top-[9%] left-[8%] flex size-6 items-center justify-center rounded-full bg-navy text-[11px] font-bold text-white">
                          {picked.length > 1 ? order + 1 : <Check className="size-3.5" aria-hidden="true" />}
                        </span>
                      )}
                    </Thumb>
                    <span className="line-clamp-2 text-[13px] leading-snug font-bold [overflow-wrap:anywhere]">{c.name}</span>
                    <span className="text-[11px] text-muted">
                      {inLoop.has(c.fileKey) ? <strong className="text-ink-2">In this loop · </strong> : null}
                      {c.screenShape === false ? <span className="font-semibold text-amber-ink">Not 4:3 · </span> : null}
                      {c.width && c.height && (c.width !== 160 || c.height !== 120) ? `${c.width} × ${c.height} · ` : null}
                      {num(c.plays7d)} plays, 7 days
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

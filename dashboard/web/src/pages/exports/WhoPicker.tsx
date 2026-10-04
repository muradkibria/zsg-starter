// "Who": pick riders and/or bags as chips. Type to search; arrow keys and Enter
// work; Backspace in the empty box removes the last chip.

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import type { ExportHandover, ExportOptions } from "@digilite/shared";

type Kind = "riders" | "bags";
interface Option {
  kind: Kind;
  id: string;
  label: string;
  sub: string;
}

const STAGE: Record<string, string> = { applied: "applied", checked: "checked", waiting: "waiting for a bag", active: "no bag now", ended: "left" };

export function WhoPicker({
  options,
  bagIds,
  riderIds,
  handovers,
  onChange,
}: {
  options: ExportOptions;
  bagIds: string[];
  riderIds: string[];
  handovers: ExportHandover[];
  onChange: (next: { bagIds: string[]; riderIds: string[] }) => void;
}) {
  const canRiders = options.riders.length > 0;
  const [tab, setTab] = useState<Kind>(canRiders ? "riders" : "bags");
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const labelId = useId();

  const all = useMemo<Option[]>(
    () => [
      ...options.riders.map((r) => ({ kind: "riders" as const, id: r.id, label: r.name, sub: r.bagName ?? STAGE[r.stage] ?? r.stage })),
      ...options.bags.map((b) => ({
        kind: "bags" as const,
        id: b.id,
        label: b.name,
        sub: b.lifecycle !== "active" ? `in ${b.lifecycle}` : b.riderName ?? (canRiders ? "no rider" : ""),
      })),
    ],
    [options, canRiders],
  );
  const picked = new Set([...bagIds, ...riderIds]);
  const term = text.trim().toLowerCase();
  const matches = all.filter((o) => o.kind === tab && !picked.has(o.id) && (!term || `${o.label} ${o.sub}`.toLowerCase().includes(term)));

  const add = (o: Option) => {
    if (o.kind === "bags") onChange({ bagIds: [...bagIds, o.id], riderIds });
    else onChange({ bagIds, riderIds: [...riderIds, o.id] });
    setText("");
    setActive(0);
    input.current?.focus();
  };
  const remove = (id: string) => onChange({ bagIds: bagIds.filter((x) => x !== id), riderIds: riderIds.filter((x) => x !== id) });

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, Math.max(0, matches.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && matches[active]) add(matches[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && !text) {
      const last = riderIds.length ? riderIds[riderIds.length - 1] : bagIds[bagIds.length - 1];
      if (last) remove(last);
    }
  };

  const chip = (o: Option) => {
    const changed = o.kind === "bags" ? handovers.filter((h) => h.bagId === o.id && h.toRiderName).length : 0;
    const sub = o.kind === "bags" && changed ? `${changed + 1} riders` : o.sub;
    return (
      <span key={o.id} className="inline-flex h-10 max-w-full items-center gap-1.5 rounded-lg bg-tint pr-0.5 pl-2.5 text-[13px] font-semibold text-navy md:h-8 md:pr-1">
        <span className="truncate">{o.label}</span>
        {sub && <span className="truncate font-medium text-ink-2">{sub}</span>}
        <button
          type="button"
          aria-label={`Remove ${o.label}`}
          onClick={() => remove(o.id)}
          className="flex size-10 shrink-0 items-center justify-center rounded-md hover:bg-white/60 md:size-6"
        >
          <X className="size-3.5" strokeWidth={2.4} />
        </button>
      </span>
    );
  };
  const chosen = [...riderIds, ...bagIds].map((id) => all.find((o) => o.id === id)).filter((o): o is Option => !!o);
  const hint =
    !bagIds.length && !riderIds.length
      ? "Nobody picked, so the export covers every bag."
      : riderIds.length && bagIds.length
        ? "The bags you picked, plus each rider's bag while they had it."
        : riderIds.length
          ? "Each rider's bag, only while they had it."
          : "Everything these bags recorded, whoever carried them.";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span id={labelId} className="text-[13px] font-bold">
          Who
        </span>
        {canRiders && (
          <div role="tablist" aria-label="Pick by" className="inline-flex rounded-[10px] bg-paper-2 p-[3px]">
            {(["riders", "bags"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => {
                  setTab(k);
                  setActive(0);
                  input.current?.focus();
                }}
                className={clsx(
                  "inline-flex h-11 items-center rounded-lg px-3.5 text-[13px] font-semibold md:h-[26px] md:px-2.5 md:text-xs",
                  tab === k ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink",
                )}
              >
                {k === "riders" ? "Riders" : "Bags"}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="relative">
        <div
          className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-line bg-white p-1.5 focus-within:border-navy"
          onClick={() => input.current?.focus()}
        >
          {chosen.map(chip)}
          <input
            ref={input}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-labelledby={labelId}
            aria-autocomplete="list"
            aria-activedescendant={open && matches[active] ? `${listId}-${matches[active].id}` : undefined}
            value={text}
            placeholder={tab === "riders" ? "Add a rider" : "Add a bag"}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
              setActive(0);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={onKey}
            className="h-8 min-w-[110px] flex-1 border-0 bg-transparent px-1.5 text-sm outline-none placeholder:text-caption"
          />
        </div>
        {open && (
          <ul id={listId} role="listbox" aria-label={tab === "riders" ? "Riders" : "Bags"} className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-rule bg-white p-1 shadow-[var(--shadow-pop)]">
            {matches.length === 0 && <li className="px-3 py-2.5 text-sm text-muted">{term ? "No match" : `Every ${tab === "riders" ? "rider" : "bag"} is picked`}</li>}
            {matches.slice(0, 60).map((o, i) => (
              <li
                key={o.id}
                id={`${listId}-${o.id}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(o);
                }}
                onMouseEnter={() => setActive(i)}
                className={clsx("flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-sm", i === active && "bg-paper")}
              >
                <span className="font-semibold">{o.label}</span>
                <span className="truncate text-xs text-muted">{o.sub}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="m-0 text-xs text-muted">{hint}</p>
    </div>
  );
}

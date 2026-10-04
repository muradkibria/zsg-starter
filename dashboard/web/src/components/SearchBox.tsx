// ⌘K search across bags, riders and zones (served by our API).

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import clsx from "clsx";
import { Search, ShoppingBag, User, CircleDashed } from "lucide-react";
import { useSearch } from "@/lib/queries";

export function SearchBox({ className, placeholder = "Jump to a bag, rider or place", onPick }: { className?: string; placeholder?: string; onPick?: (href: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const nav = useNavigate();
  const { data = [] } = useSearch(q);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pick = (href: string) => {
    setOpen(false);
    setQ("");
    input.current?.blur();
    if (onPick) onPick(href);
    else nav(href);
  };

  return (
    <div className={clsx("relative", className)}>
      <label className="flex h-10 items-center gap-2 rounded-[10px] border border-line bg-white px-3 shadow-sm">
        <Search className="size-4 shrink-0 text-muted" />
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, data.length - 1));
            if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
            if (e.key === "Enter" && data[active]) pick(data[active].href);
            if (e.key === "Escape") input.current?.blur();
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-caption"
        />
        <kbd className="hidden rounded border border-rule px-1.5 text-[11px] text-caption md:inline">⌘K</kbd>
      </label>
      {open && q.trim() && (
        <div className="absolute inset-x-0 top-12 z-50 overflow-hidden rounded-xl border border-rule bg-white shadow-[var(--shadow-pop)]" role="listbox">
          {data.length === 0 && <div className="px-4 py-3 text-sm text-muted">Nothing matches “{q}”</div>}
          {data.map((r, i) => {
            const Icon = r.kind === "bag" ? ShoppingBag : r.kind === "rider" ? User : CircleDashed;
            return (
              <button
                key={`${r.kind}-${r.id}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(r.href)}
                className={clsx("flex w-full items-center gap-3 px-4 py-2.5 text-left", i === active ? "bg-paper" : "hover:bg-paper")}
              >
                <Icon className="size-4 text-muted" />
                <span className="flex-1">
                  <span className="block text-sm font-semibold">{r.label}</span>
                  <span className="block text-xs text-muted">{r.sublabel}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

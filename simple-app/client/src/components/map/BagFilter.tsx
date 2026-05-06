import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search, Check } from "lucide-react";
import type { BagLiveState } from "@/hooks/use-live-bags";

interface BagFilterProps {
  bags: BagLiveState[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}

export function BagFilter({ bags, selected, onChange }: BagFilterProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const sortedBags = [...bags].sort((a, b) => {
    // Active first, then alphabetical
    if (a.status === "active" && b.status !== "active") return -1;
    if (a.status !== "active" && b.status === "active") return 1;
    return a.name.localeCompare(b.name);
  });

  const filtered = sortedBags.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase())
  );

  // Three-state model:
  //   isAllMode  → empty set, treated as "all bags shown"
  //   isNoneMode → set contains "__none__" sentinel only, "no bags shown"
  //   isSomeMode → set contains real bag IDs, only those shown
  const isAllMode = selected.size === 0;
  const isNoneMode = selected.has("__none__");

  const visibleCount = isAllMode ? bags.length : isNoneMode ? 0 : selected.size;
  const label = isAllMode
    ? `All bags (${bags.length})`
    : isNoneMode
      ? `0 of ${bags.length} selected`
      : `${selected.size} of ${bags.length} selected`;

  const toggleBag = (id: string) => {
    // Coming from "none" → switch to "some" with just this bag.
    if (isNoneMode) {
      onChange(new Set([id]));
      return;
    }

    // Coming from "all" → switch to "some" with everything *except* this bag.
    if (isAllMode) {
      const next = new Set<string>();
      for (const b of bags) {
        if (b.id !== id) next.add(b.id);
      }
      // Edge case: only 1 bag total and user deselected it → go straight to "none"
      onChange(next.size === 0 ? new Set(["__none__"]) : next);
      return;
    }

    // We're in "some" mode — toggle this id in/out
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
      // If we just removed the last one, switch to "none" (not "all")
      onChange(next.size === 0 ? new Set(["__none__"]) : next);
    } else {
      next.add(id);
      onChange(next);
    }
  };

  const selectAll = () => onChange(new Set());
  const selectNone = () => onChange(new Set(["__none__"]));

  const isChecked = (id: string) => {
    if (isAllMode) return true;
    if (isNoneMode) return false;
    return selected.has(id);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 h-8 px-3 rounded-md border border-border bg-background hover:bg-accent text-xs font-medium transition-colors"
      >
        {label}
        <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-[1100] w-72 rounded-lg border bg-popover shadow-lg overflow-hidden">
          {/* Search */}
          <div className="border-b px-2 py-1.5 flex items-center gap-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search bags…"
              className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground"
              autoFocus
            />
          </div>

          {/* Quick actions */}
          <div className="border-b px-3 py-1.5 flex items-center gap-3 text-xs">
            <button
              onClick={selectAll}
              className="text-primary hover:underline disabled:opacity-50 disabled:no-underline"
              disabled={isAllMode}
            >
              All
            </button>
            <span className="text-muted-foreground">·</span>
            <button
              onClick={selectNone}
              className="text-primary hover:underline disabled:opacity-50 disabled:no-underline"
              disabled={isNoneMode}
            >
              None
            </button>
            <span className="ml-auto text-muted-foreground">
              {visibleCount} on map
            </span>
          </div>

          {/* List */}
          <div className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No bags match</p>
            ) : (
              filtered.map((bag) => {
                const checked = isChecked(bag.id);
                const isActive = bag.status === "active";
                return (
                  <button
                    key={bag.id}
                    onClick={() => toggleBag(bag.id)}
                    className={`w-full px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-accent transition-colors ${
                      checked ? "" : "opacity-60"
                    }`}
                  >
                    <span className={`inline-flex items-center justify-center w-4 h-4 rounded border ${
                      checked
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-border"
                    }`}>
                      {checked && <Check className="h-3 w-3" />}
                    </span>

                    <span
                      className={`inline-block w-2 h-2 rounded-full shrink-0 ${
                        isActive ? "bg-green-500" : "bg-gray-400"
                      }`}
                    />

                    <span className="flex-1 text-left truncate">{bag.name}</span>

                    {!bag.gps && (
                      <span className="text-[10px] text-muted-foreground">no GPS</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Helper used by consumers — given the filter state and full bag list, return the "effective" selection.
// Handles the empty-set-means-all and __none__ sentinel cases.
export function applyBagFilter<T extends { id: string }>(items: T[], selected: Set<string>): T[] {
  if (selected.size === 0) return items;             // empty = all
  if (selected.has("__none__")) return [];           // explicit "none"
  return items.filter((i) => selected.has(i.id));
}

// "What changes vs the fleet loop": added and removed ads (by file), kept ads,
// order and length — worked out live as the loop is edited.

import { Link } from "react-router";
import { diffLoopItems, type LoopFleetRef } from "@digilite/shared";
import { Card, CardHeader } from "@/components/ui";
import { secs } from "../bits";

export interface DiffInput {
  fileKey: string;
  seconds: number;
  name: string;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
}

export function ChangesCard({
  items,
  fleetLoop,
  isFleetLoop,
  fleetLoopName,
}: {
  items: DiffInput[];
  fleetLoop: LoopFleetRef | null;
  isFleetLoop: boolean;
  fleetLoopName: string | null;
}) {
  if (isFleetLoop) {
    return (
      <Card className="flex flex-col gap-2 p-4">
        <CardHeader title="The fleet loop" />
        <p className="m-0 text-[13px] text-muted">This is the loop every bag should be playing. Duplicate it as a draft to make the next one.</p>
      </Card>
    );
  }
  if (!fleetLoop) {
    return (
      <Card className="flex flex-col gap-2 p-4">
        <CardHeader title="What changes" />
        <p className="m-0 text-[13px] text-muted">
          {fleetLoopName ? `The fleet loop "${fleetLoopName}" isn't in the loop list, so there's nothing to compare with.` : "No fleet loop is set, so there's nothing to compare with."}{" "}
          <Link to="/settings?section=defaults">Settings</Link>
        </p>
      </Card>
    );
  }
  const base = fleetLoop.items.map((i) => ({ fileKey: i.fileKey, seconds: i.seconds, name: i.name, thumbUrl: i.thumbUrl, width: i.width, height: i.height }));
  const d = diffLoopItems(items, base);
  // Same name, different file (e.g. a bigger export): say which file is which.
  const norm = (n: string) => n.trim().toLowerCase();
  const addedNames = new Set(d.added.map((a) => norm(a.name)));
  const clash = new Set(d.removed.map((r) => norm(r.name)).filter((n) => addedNames.has(n)));
  const why = (verb: string, i: DiffInput) =>
    clash.has(norm(i.name)) && i.width && i.height ? `${verb} · the ${i.width} × ${i.height} file` : verb;
  return (
    <Card className="flex flex-col gap-3 p-4">
      <CardHeader title={`What changes vs ${fleetLoop.name}`} />
      {d.same ? (
        <p className="m-0 text-[13px] text-muted">Same ads, same order as {fleetLoop.name}.</p>
      ) : (
        <>
          {d.added.length + d.removed.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {d.added.map((a) => (
                <Change key={`+${a.fileKey}`} sign="+" item={a} why={why("Added", a)} />
              ))}
              {d.removed.map((r) => (
                <Change key={`-${r.fileKey}`} sign="−" item={r} why={why("Taken out", r)} />
              ))}
            </ul>
          )}
          {(d.orderChanged || d.secondsBefore !== d.secondsAfter) && (
            <p className="m-0 text-[13px] text-ink-2">
              {d.orderChanged && "New play order. "}
              {d.secondsBefore !== d.secondsAfter && (
                <>
                  Loop length {secs(d.secondsBefore)} → <strong>{secs(d.secondsAfter)}</strong>.
                </>
              )}
            </p>
          )}
          <div className="h-px bg-rule-soft" />
          <p className="m-0 text-xs text-muted">{d.kept.length ? `Kept: ${d.kept.map((k) => k.name).join(", ")}` : `Nothing kept from ${fleetLoop.name}.`}</p>
        </>
      )}
    </Card>
  );
}

function Change({ sign, item, why }: { sign: "+" | "−"; item: DiffInput; why: string }) {
  const add = sign === "+";
  return (
    <li className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={`flex size-[22px] shrink-0 items-center justify-center rounded-full text-[15px] leading-none font-bold ${add ? "bg-green-bg text-green-ink" : "bg-red-bg text-red-ink"}`}
      >
        {sign}
      </span>
      <span className="h-[27px] w-9 shrink-0 overflow-hidden rounded-[3px] bg-ink">
        {item.thumbUrl && <img src={item.thumbUrl} alt="" className="size-full object-cover" />}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[13px] font-semibold [overflow-wrap:anywhere]">{item.name}</span>
        <span className="text-[11px] text-muted">{why}</span>
      </span>
    </li>
  );
}

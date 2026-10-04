// Which loop a bag is playing. Bags report the Colorlight file they're playing
// ("June 26_<md5>_7174.vsn") and loops store the same file name
// (`colorlight_vsn`), so the match is exact even when two loops share a name.

import { programNameFromVsn } from "@digilite/shared";

export interface LoopRef {
  id: string;
  name: string;
  status: string;
  colorlight_program_id?: number | null;
  colorlight_program_name?: string;
  colorlight_vsn?: string;
}

export interface PlayingSource {
  playing_vsn?: string | null;
  downloaded_programs?: unknown;
}

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

export function matchPlayingLoop<L extends LoopRef>(bag: PlayingSource, loops: L[]): L | null {
  const vsn = bag.playing_vsn ?? "";
  if (!vsn) return null;
  const exact = loops.find((l) => l.colorlight_vsn && l.colorlight_vsn === vsn);
  if (exact) return exact;

  const name = norm(programNameFromVsn(vsn));
  if (!name) return null;
  // An older copy of a loop (edited since the bag downloaded it): the bag's
  // download list pairs each Colorlight program id with its name.
  const downloaded = Array.isArray(bag.downloaded_programs) ? (bag.downloaded_programs as { id?: unknown; name?: unknown }[]) : [];
  const ids = new Set(
    downloaded
      .filter((p) => norm(p.name) === name)
      .map((p) => Number(p.id))
      .filter((n) => n > 0),
  );
  const byId = loops.filter((l) => l.colorlight_program_id && ids.has(Number(l.colorlight_program_id)));
  if (byId.length === 1) return byId[0];
  const named = loops.filter((l) => l.status !== "archived" && norm(l.colorlight_program_name || l.name) === name);
  return named.length === 1 ? named[0] : null;
}

/** True when the bag plays the loop but not its latest version (it hasn't downloaded the edit yet). */
export function playsOlderCopy(bag: PlayingSource, loop: LoopRef | null): boolean {
  return !!(loop?.colorlight_vsn && bag.playing_vsn && bag.playing_vsn !== loop.colorlight_vsn);
}

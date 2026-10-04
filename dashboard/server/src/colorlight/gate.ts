// The write gate. Every change sent to Colorlight passes through here.
//
// Modes (COLORLIGHT_WRITES):
//   off    nothing is sent; changes are recorded as dry runs
//   test   changes may only target the test bag(s) (COLORLIGHT_TEST_BAG_IDS)
//   fleet  any bag — but only while the owner has also switched on
//          "Allow changes to the whole fleet" in Settings; otherwise as `test`
//
// Payload rules enforced regardless of mode:
//   - never a terminal-group-wide change (no terminalGroupId, `all` must be false)
//   - a non-empty, explicit list of terminal ids

export type WriteMode = "off" | "test" | "fleet";

export interface GateInput {
  mode: WriteMode;
  testBagIds: number[];
  fleetSwitch: boolean;
}

export type GateDecision =
  | { action: "send"; reason: string }
  | { action: "dry_run"; reason: string }
  | { action: "block"; reason: string; blocked: number[] };

export class WriteBlockedError extends Error {
  constructor(message: string, public blocked: number[] = []) {
    super(message);
    this.name = "WriteBlockedError";
  }
}

export function decide(terminalIds: number[], g: GateInput): GateDecision {
  const ids = terminalIds.filter((n) => Number.isFinite(n) && n > 0);
  if (!ids.length || ids.length !== terminalIds.length) {
    return { action: "block", reason: "A change must name at least one valid bag.", blocked: [] };
  }
  if (g.mode === "off") {
    return { action: "dry_run", reason: "Changes are switched off (dry run). Nothing was sent to the bag." };
  }
  const fleetOpen = g.mode === "fleet" && g.fleetSwitch;
  if (fleetOpen) return { action: "send", reason: "Fleet changes are switched on." };
  const blocked = ids.filter((id) => !g.testBagIds.includes(id));
  if (blocked.length) {
    return {
      action: "block",
      reason:
        g.mode === "fleet"
          ? "Changes to the whole fleet are switched off in Settings. Only the test bag can be changed."
          : "Only the test bag can be changed right now.",
      blocked,
    };
  }
  return { action: "send", reason: "Sent to the test bag." };
}

/** Structural safety checks on outgoing payloads. Throws on anything group-wide. */
export function assertSafePayload(kind: string, payload: unknown, allowedIds: number[]): void {
  const json = JSON.stringify(payload ?? {});
  if (/"terminalGroupId"\s*:/.test(json)) {
    throw new WriteBlockedError(`${kind}: payload must not target a terminal group`);
  }
  if (/"to_children"\s*:\s*true/.test(json)) {
    throw new WriteBlockedError(`${kind}: payload must not apply to sub-groups`);
  }
  if (/"all"\s*:\s*true/.test(json)) {
    throw new WriteBlockedError(`${kind}: payload must not publish to a whole group`);
  }
  const p = payload as Record<string, unknown> | null;
  const listed = collectTerminalIds(p);
  const stray = listed.filter((id) => !allowedIds.includes(id));
  if (stray.length) throw new WriteBlockedError(`${kind}: payload names bags that were not approved`, stray);
}

function collectTerminalIds(p: unknown, acc: number[] = []): number[] {
  if (!p || typeof p !== "object") return acc;
  if (Array.isArray(p)) {
    for (const x of p) collectTerminalIds(x, acc);
    return acc;
  }
  for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
    if ((k === "terminalIds" || k === "terminals") && Array.isArray(v)) acc.push(...v.map(Number));
    else if (k === "terminalId" && v != null) acc.push(Number(v));
    else collectTerminalIds(v, acc);
  }
  return acc;
}

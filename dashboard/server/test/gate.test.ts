import { describe, expect, it } from "vitest";
import { assertSafePayload, decide, WriteBlockedError } from "../src/colorlight/gate";
import { commandPayload, publishPayload } from "../src/colorlight/raw-writes";

const TEST = 5786440;
const OTHER = 5257479;

describe("write gate", () => {
  it("off mode never sends", () => {
    expect(decide([TEST], { mode: "off", testBagIds: [TEST], fleetSwitch: true }).action).toBe("dry_run");
  });

  it("test mode sends only to the test bag", () => {
    expect(decide([TEST], { mode: "test", testBagIds: [TEST], fleetSwitch: false }).action).toBe("send");
    const d = decide([TEST, OTHER], { mode: "test", testBagIds: [TEST], fleetSwitch: false });
    expect(d.action).toBe("block");
    expect(d.action === "block" && d.blocked).toEqual([OTHER]);
  });

  it("test mode ignores the fleet switch", () => {
    expect(decide([OTHER], { mode: "test", testBagIds: [TEST], fleetSwitch: true }).action).toBe("block");
  });

  it("fleet mode needs the owner switch too", () => {
    expect(decide([OTHER], { mode: "fleet", testBagIds: [TEST], fleetSwitch: false }).action).toBe("block");
    expect(decide([OTHER], { mode: "fleet", testBagIds: [TEST], fleetSwitch: true }).action).toBe("send");
  });

  it("rejects empty or invalid targets", () => {
    expect(decide([], { mode: "fleet", testBagIds: [TEST], fleetSwitch: true }).action).toBe("block");
    expect(decide([Number.NaN], { mode: "fleet", testBagIds: [TEST], fleetSwitch: true }).action).toBe("block");
  });
});

describe("payload safety", () => {
  it("accepts explicit single-bag payloads", () => {
    expect(() => assertSafePayload("cmd", commandPayload("brightness", [TEST], 70), [TEST])).not.toThrow();
    expect(() => assertSafePayload("publish", publishPayload(7232, [TEST]), [TEST])).not.toThrow();
  });

  it("refuses anything group-wide", () => {
    expect(() => assertSafePayload("sched", { terminalGroupId: 7232, terminalId: TEST }, [TEST])).toThrow(WriteBlockedError);
    expect(() => assertSafePayload("sched", { to_children: true }, [TEST])).toThrow(WriteBlockedError);
    expect(() =>
      assertSafePayload("publish", { to: { terminals_groups: [{ all: true, id: 7232, terminals: [TEST] }] } }, [TEST]),
    ).toThrow(WriteBlockedError);
  });

  it("refuses bags that were not approved", () => {
    expect(() => assertSafePayload("publish", publishPayload(7232, [TEST, OTHER]), [TEST])).toThrow(WriteBlockedError);
    expect(() => assertSafePayload("cmd", commandPayload("reboot", [OTHER]), [TEST])).toThrow(WriteBlockedError);
  });
});

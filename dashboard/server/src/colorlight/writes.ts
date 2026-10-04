// Gated Colorlight writes. The ONLY module allowed to import ./raw-writes.
// Every function decides via the gate first and never sends a group-wide change.

import { config } from "../config";
import { getSettings } from "../domain/settings";
import { logger } from "../log";
import { assertSafePayload, decide, type GateDecision, type GateInput } from "./gate";
import {
  commandPayload,
  publishPayload,
  rawCommand,
  rawCreateProgram,
  rawPublishProgram,
  rawPutTerminalSchedule,
  rawUploadMedia,
  type CommandKind,
  type ProgramMediaItem,
} from "./raw-writes";

const log = logger("writes");

export async function gateInput(): Promise<GateInput> {
  return { mode: config.COLORLIGHT_WRITES, testBagIds: config.testBagIds, fleetSwitch: (await getSettings()).fleetWritesEnabled };
}

export async function decideFor(terminalIds: number[]): Promise<GateDecision> {
  return decide(terminalIds, await gateInput());
}

export interface WriteOutcome<T = unknown> {
  decision: GateDecision;
  response?: T;
}

/** Brightness / restart / screenshot / sleep / wake for explicit bags. */
export async function sendCommand(kind: CommandKind, terminalIds: number[], value?: number): Promise<WriteOutcome> {
  const decision = await decideFor(terminalIds);
  if (decision.action !== "send") return { decision };
  const payload = commandPayload(kind, terminalIds, value);
  assertSafePayload(`command:${kind}`, payload, terminalIds);
  log.info(`sending ${kind} to ${terminalIds.join(",")}`);
  const res = await rawCommand(kind, payload);
  return { decision, response: res.data };
}

/** Replace one bag's device schedule (per-terminal endpoint only). */
export async function putTerminalSchedule(terminalId: number, scheduleJson: Record<string, unknown>): Promise<WriteOutcome> {
  const decision = await decideFor([terminalId]);
  if (decision.action !== "send") return { decision };
  const body = { ...scheduleJson, to_children: false };
  assertSafePayload("schedule", body, [terminalId]);
  log.info(`putting schedule on ${terminalId}`);
  const res = await rawPutTerminalSchedule(terminalId, body);
  return { decision, response: res.data };
}

/**
 * Account-level writes (upload a creative, create a program) change nothing on a
 * bag by themselves; they are allowed whenever writes are not switched off.
 */
export function accountWritesAllowed(): boolean {
  return config.COLORLIGHT_WRITES !== "off";
}

export async function uploadMedia(file: Buffer, filename: string, mimeType: string, title: string) {
  if (!accountWritesAllowed()) return { dryRun: true as const };
  log.info(`uploading creative "${title}" (${Math.round(file.length / 1024)} KB)`);
  return { dryRun: false as const, media: await rawUploadMedia(file, filename, mimeType, title) };
}

export async function createProgram(title: string, items: ProgramMediaItem[]) {
  if (!accountWritesAllowed()) return { dryRun: true as const };
  log.info(`creating program "${title}" with ${items.length} item(s)`);
  return { dryRun: false as const, program: await rawCreateProgram(title, items, config.COLORLIGHT_USERNAME) };
}

/** Publish a program to explicit bags within their terminal group (`all: false`). */
export async function publishProgram(programId: number, groupId: number, terminalIds: number[]): Promise<WriteOutcome> {
  const decision = await decideFor(terminalIds);
  if (decision.action !== "send") return { decision };
  const payload = publishPayload(groupId, terminalIds);
  assertSafePayload("publish", payload, terminalIds);
  log.info(`publishing program ${programId} to ${terminalIds.join(",")}`);
  const res = await rawPublishProgram(programId, payload);
  return { decision, response: res.data };
}

export type { ProgramMediaItem, CommandKind };

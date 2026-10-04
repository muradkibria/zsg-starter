import type { AnalyticsConfig, SettingsDto } from "@digilite/shared";
import { getFirst, pb, type RecordModel } from "../pb";

let cache: { at: number; rec: RecordModel } | null = null;

async function record(): Promise<RecordModel> {
  if (cache && Date.now() - cache.at < 15000) return cache.rec;
  const found = await getFirst<RecordModel>("app_settings", 'key = "main"');
  const rec = found ?? (await pb.collection("app_settings").create<RecordModel>({ key: "main" }));
  cache = { at: Date.now(), rec };
  return rec;
}

export function toSettingsDto(r: RecordModel): SettingsDto {
  return {
    fleetWritesEnabled: !!r.fleet_writes_enabled,
    fleetLoopName: r.fleet_loop_name || "",
    brightnessTargetPct: r.brightness_target_pct || 70,
    brightnessCommandScale: r.brightness_command_scale || 255,
    shiftBreakMin: r.shift_break_min || 45,
    signalGapMin: r.signal_gap_min || 5,
    stopRadiusM: r.stop_radius_m || 50,
    stopMin: r.stop_min || 15,
    payRate: r.pay_rate || "",
    payMinHours: r.pay_min_hours || 0,
    paySignalGaps: !!r.pay_signal_gaps,
  };
}

export async function getSettings(): Promise<SettingsDto> {
  return toSettingsDto(await record());
}

export async function updateSettings(patch: Partial<SettingsDto>): Promise<SettingsDto> {
  const rec = await record();
  const map: Record<string, unknown> = {};
  if (patch.fleetWritesEnabled !== undefined) map.fleet_writes_enabled = patch.fleetWritesEnabled;
  if (patch.fleetLoopName !== undefined) map.fleet_loop_name = patch.fleetLoopName;
  if (patch.brightnessTargetPct !== undefined) map.brightness_target_pct = patch.brightnessTargetPct;
  if (patch.brightnessCommandScale !== undefined) map.brightness_command_scale = patch.brightnessCommandScale;
  if (patch.shiftBreakMin !== undefined) map.shift_break_min = patch.shiftBreakMin;
  if (patch.signalGapMin !== undefined) map.signal_gap_min = patch.signalGapMin;
  if (patch.stopRadiusM !== undefined) map.stop_radius_m = patch.stopRadiusM;
  if (patch.stopMin !== undefined) map.stop_min = patch.stopMin;
  if (patch.payRate !== undefined) map.pay_rate = patch.payRate;
  if (patch.payMinHours !== undefined) map.pay_min_hours = patch.payMinHours;
  if (patch.paySignalGaps !== undefined) map.pay_signal_gaps = patch.paySignalGaps;
  const updated = await pb.collection("app_settings").update(rec.id, map);
  cache = { at: Date.now(), rec: updated };
  return toSettingsDto(updated);
}

export async function analyticsConfig(): Promise<AnalyticsConfig> {
  const s = await getSettings();
  return {
    shiftBreakMin: s.shiftBreakMin,
    signalGapMin: s.signalGapMin,
    stopRadiusM: s.stopRadiusM,
    stopMin: s.stopMin,
    maxSpeedMs: 25,
  };
}

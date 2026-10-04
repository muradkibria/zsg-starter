// Period selector: presets first, then a custom range.

import { todayLondon } from "@digilite/shared";
import { Chip, Input } from "@/components/ui";
import { PRESET_LABEL, presetPeriod, type Period, type PeriodPreset } from "../format";

export function PeriodPicker({
  value,
  onChange,
  campaign,
  presets = ["campaign", "last7", "yesterday", "custom"],
  label = "Period",
}: {
  value: Period;
  onChange: (p: Period) => void;
  campaign: { startDay: string | null; endDay: string | null };
  presets?: PeriodPreset[];
  label?: string;
}) {
  const today = todayLondon();
  const pick = (p: PeriodPreset) => {
    if (p === "custom") onChange({ ...value, preset: "custom" });
    else onChange(presetPeriod(p, campaign, today));
  };
  const setFrom = (fromDay: string) => {
    if (!fromDay) return;
    onChange({ preset: "custom", fromDay, toDay: value.toDay < fromDay ? fromDay : value.toDay });
  };
  const setTo = (toDay: string) => {
    if (!toDay) return;
    onChange({ preset: "custom", toDay, fromDay: value.fromDay > toDay ? toDay : value.fromDay });
  };
  return (
    <div className="flex flex-col gap-2" role="group" aria-label={label}>
      <div className="-mx-1 flex flex-wrap gap-1.5 px-1">
        {presets.map((p) => (
          <Chip key={p} active={value.preset === p} onClick={() => pick(p)}>
            {PRESET_LABEL[p]}
          </Chip>
        ))}
      </div>
      {value.preset === "custom" && (
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <label className="flex items-center gap-2">
            <span className="text-muted">From</span>
            <Input type="date" className="h-9 w-[150px]" value={value.fromDay} max={today} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex items-center gap-2">
            <span className="text-muted">to</span>
            <Input type="date" className="h-9 w-[150px]" value={value.toDay} max={today} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      )}
    </div>
  );
}

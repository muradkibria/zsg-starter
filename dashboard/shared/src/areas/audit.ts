// Contracts for the audit area: the log of every change, in plain English.

export interface AuditEntryDto {
  id: string;
  /** ISO time */
  created: string;
  actorId: string | null;
  /** "System" for changes made by the Hub itself */
  actorName: string;
  action: string;
  /** Plain-English group, e.g. "Zones", "Sign-ins" */
  category: string;
  summary: string;
  entity: { type: string; id: string; href: string | null } | null;
  /** Extra lines, e.g. which settings changed */
  details: string[];
}

/** GET /audit?page&perPage&action&actorId&fromDay&toDay&hideSignIns */
export interface AuditQuery {
  page?: number;
  perPage?: number;
  /** A group ("zone", "rider.document") or an exact action ("zone.update"); matches on whole dot-separated words */
  action?: string;
  /** A user id, or "system" */
  actorId?: string;
  /** Leave out sign-ins (auth.*), which aren't changes */
  hideSignIns?: boolean;
  fromDay?: string;
  toDay?: string;
}

/** GET /audit/facets — what the filters can offer */
export interface AuditFacets {
  groups: { key: string; label: string; count: number }[];
  actors: { id: string; name: string }[];
}

const GROUP_LABEL: Record<string, string> = {
  auth: "Sign-ins",
  bag: "Bags",
  bags: "Bags",
  command: "Bag changes",
  commands: "Bag changes",
  rider: "Riders",
  riders: "Riders",
  "rider.document": "Rider documents",
  document: "Rider documents",
  documents: "Rider documents",
  assignment: "Assignments",
  zone: "Zones",
  zones: "Zones",
  team: "Team",
  settings: "Settings",
  loop: "Loops",
  loops: "Loops",
  creative: "Ads",
  creatives: "Ads",
  deployment: "Loops sent",
  schedule: "Schedules",
  schedules: "Schedules",
  payroll: "Payroll",
  campaign: "Campaigns",
  campaigns: "Campaigns",
  report: "Client reports",
  reports: "Client reports",
  export: "Exports",
  exports: "Exports",
};

/** Groups deeper than the first word, listed separately (document views matter for privacy). */
const SUBGROUPS = ["rider.document"];

/** "zone.update" → "zone"; "rider.document.view" → "rider.document"; "odd" → "odd". */
export function auditGroup(action: string): string {
  for (const g of SUBGROUPS) if (action === g || action.startsWith(`${g}.`)) return g;
  const i = action.indexOf(".");
  return i > 0 ? action.slice(0, i) : action;
}

/** "zone" → "Zones"; unknown groups fall back to the raw name, tidied ("rider_docs" → "Rider docs"). */
export function auditGroupLabel(group: string): string {
  const known = GROUP_LABEL[group];
  if (known) return known;
  const s = group.replace(/[._-]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "Other";
}

const SETTING_LABEL: Record<string, { label: string; unit?: string }> = {
  fleetWritesEnabled: { label: "Allow changes to the whole fleet" },
  fleetLoopName: { label: "Fleet loop" },
  brightnessTargetPct: { label: "Brightness target", unit: "%" },
  brightnessCommandScale: { label: "Brightness command scale" },
  shiftBreakMin: { label: "Shift break", unit: " min" },
  signalGapMin: { label: "Signal gap", unit: " min" },
  stopRadiusM: { label: "Stop radius", unit: " m" },
  stopMin: { label: "Stop length", unit: " min" },
  payRate: { label: "Pay rate" },
  payMinHours: { label: "Minimum hours to qualify", unit: " h" },
  paySignalGaps: { label: "Pay for signal-gap time" },
  retention: { label: "Data retention" },
};

function plainValue(raw: string, unit = ""): string {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (v === true) return "on";
  if (v === false) return "off";
  if (v === null || v === "") return "not set";
  if (typeof v === "number") return `${v}${unit}`;
  if (typeof v === "string") return `"${v}"`;
  if (typeof v === "object") {
    const parts = Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k.replace(/_/g, " ")}: ${x == null ? "not set" : x}`);
    return parts.join(", ") || "none";
  }
  return String(v);
}

/** "shiftBreakMin: 45 → 60" → "Shift break: 45 min → 60 min". Unknown lines pass through. */
export function humaniseSettingChange(line: string): string {
  const m = line.match(/^(\w+): (.*) → (.*)$/);
  if (!m) return line;
  const meta = SETTING_LABEL[m[1]];
  if (!meta) return line;
  return `${meta.label}: ${plainValue(m[2], meta.unit)} → ${plainValue(m[3], meta.unit)}`;
}

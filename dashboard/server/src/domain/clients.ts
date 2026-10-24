// Clients and their portal: which campaigns each client sees, and the figures
// the portal shows. A client only ever sees confirmed campaigns linked to it,
// measured figures plus the estimated impressions, never riders or routes.

import {
  addDays,
  gbDateFormat,
  todayLondon,
  type CampaignStatus,
  type ClientAccount,
  type ClientCampaignRef,
  type PortalCampaign,
  type PortalCampaignDetail,
  type PortalPeriod,
} from "@digilite/shared";
import { getAll, getOneOrNull, parsePbDate, pb, q, type RecordModel } from "../pb";
import { campaignStats, fileKey, filesOf, invalidateCampaigns, listCampaigns, loadCampaignRows, loadCreatives, type CampaignRow } from "./campaigns";

// ── Hub: managing clients ─────────────────────────────────────────────────────

const toRef = (c: CampaignRow): ClientCampaignRef => ({
  id: c.id,
  advertiser: c.advertiser,
  name: c.name,
  startDay: c.startDay,
  endDay: c.endDay,
  confirmed: c.confirmed,
});

export function toClientAccount(r: RecordModel, campaigns: CampaignRow[]): ClientAccount {
  return {
    id: r.id,
    name: r.name ?? "",
    contactName: r.contact_name ?? "",
    contactEmail: r.contact_email ?? "",
    disabled: !!r.disabled,
    // Whether there is one, never the code itself.
    hasCode: !!r.login_code,
    lastSignInAt: parsePbDate(r.last_sign_in)?.toISOString() ?? null,
    created: parsePbDate(r.created)?.toISOString() ?? new Date(0).toISOString(),
    campaigns: campaigns.filter((c) => c.clientId === r.id).map(toRef),
  };
}

const FIELDS = "id,name,contact_name,contact_email,disabled,login_code,last_sign_in,created";

export async function listClients(): Promise<ClientAccount[]> {
  const [rows, campaigns] = await Promise.all([getAll<RecordModel>("clients", { sort: "name", fields: FIELDS }), loadCampaignRows()]);
  return rows.map((r) => toClientAccount(r, campaigns)).sort((a, b) => Number(a.disabled) - Number(b.disabled) || a.name.localeCompare(b.name, "en-GB"));
}

export async function getClientAccount(id: string): Promise<ClientAccount | null> {
  const rec = await getOneOrNull<RecordModel>("clients", id);
  return rec ? toClientAccount(rec, await loadCampaignRows()) : null;
}

/**
 * Point exactly these campaigns at the client: link the new ones (taking them
 * from another client if need be) and unlink the ones left out. Returns what moved.
 */
export async function setClientCampaigns(clientId: string, campaignIds: string[]): Promise<{ added: CampaignRow[]; removed: CampaignRow[]; taken: CampaignRow[] }> {
  const all = await loadCampaignRows();
  const want = new Set(campaignIds);
  const unknown = campaignIds.filter((id) => !all.some((c) => c.id === id));
  if (unknown.length) throw new Error("One of those campaigns doesn't exist any more");
  const added = all.filter((c) => want.has(c.id) && c.clientId !== clientId);
  const removed = all.filter((c) => !want.has(c.id) && c.clientId === clientId);
  for (const c of added) await pb.collection("campaigns").update(c.id, { client: clientId });
  for (const c of removed) await pb.collection("campaigns").update(c.id, { client: "" });
  if (added.length || removed.length) invalidateCampaigns();
  return { added, removed, taken: added.filter((c) => c.clientId) };
}

// ── Portal ────────────────────────────────────────────────────────────────────

/** The campaigns a client can see: linked to them and confirmed. */
export async function portalCampaignRows(clientId: string): Promise<CampaignRow[]> {
  const rows = await getAll<RecordModel>("campaigns", { filter: `client = ${q(clientId)}`, fields: "id" });
  if (!rows.length) return [];
  const ids = new Set(rows.map((r) => r.id));
  return (await loadCampaignRows()).filter((c) => ids.has(c.id) && c.confirmed);
}

export async function portalCampaignRow(clientId: string, campaignId: string): Promise<CampaignRow | null> {
  return (await portalCampaignRows(clientId)).find((c) => c.id === campaignId) ?? null;
}

/** The hub's status, in the client's terms: no internal warnings about what's on screen. */
function clientStatus(s: CampaignStatus): CampaignStatus {
  if (s.phase === "ended" || s.phase === "ended_on_screen") return { phase: "ended", label: "Ended", tone: "neutral", note: null, warn: false };
  return { ...s, note: s.warn ? null : s.note, warn: false };
}

export async function portalCampaigns(clientId: string): Promise<PortalCampaign[]> {
  const rows = await portalCampaignRows(clientId);
  const ids = new Set(rows.map((r) => r.id));
  const list = await listCampaigns();
  return list.campaigns
    .filter((c) => ids.has(c.id))
    .map((c) => ({
      id: c.id,
      advertiser: c.advertiser,
      name: c.name,
      startDay: c.startDay,
      endDay: c.endDay,
      status: clientStatus(c.status),
      thumbId: c.thumbId,
      plays: c.plays,
      playSeconds: c.playSeconds,
      bagsCarrying: c.bagsCarrying,
      lastPlayedAt: c.lastPlayedAt,
    }));
}

const fmtShort = gbDateFormat({ day: "numeric", month: "short" });
const fmtMonth = gbDateFormat({ month: "long", year: "numeric" });
const noon = (day: string) => new Date(`${day}T12:00:00Z`);
/** 0 = Monday … 6 = Sunday */
const weekday = (day: string) => (noon(day).getUTCDay() + 6) % 7;

/**
 * Ready-made report periods for a campaign that has run from `fromDay` to
 * `toDay`: the whole of it, then each week (Monday to Sunday) and each calendar
 * month it touches, latest first, clipped to the campaign. Weeks and months are
 * left out when there's only one (it's the same as the whole campaign).
 */
export function reportPeriods(fromDay: string, toDay: string, ended: boolean): PortalPeriod[] {
  if (toDay < fromDay) return [];
  const out: PortalPeriod[] = [{ key: "campaign", label: ended ? "The whole campaign" : "The campaign so far", fromDay, toDay, kind: "campaign" }];
  const weeks: PortalPeriod[] = [];
  for (let start = addDays(fromDay, -weekday(fromDay)); start <= toDay; start = addDays(start, 7)) {
    const from = start < fromDay ? fromDay : start;
    const end = addDays(start, 6);
    const to = end > toDay ? toDay : end;
    const label = from === to ? fmtShort.format(noon(from)) : `${fmtShort.format(noon(from))} – ${fmtShort.format(noon(to))}`;
    weeks.push({ key: `week:${from}`, label, fromDay: from, toDay: to, kind: "week" });
  }
  const months: PortalPeriod[] = [];
  for (let m = `${fromDay.slice(0, 7)}-01`; m <= toDay; m = `${addDays(m, 32).slice(0, 7)}-01`) {
    const last = addDays(`${addDays(m, 32).slice(0, 7)}-01`, -1);
    const from = m < fromDay ? fromDay : m;
    const to = last > toDay ? toDay : last;
    months.push({ key: `month:${m.slice(0, 7)}`, label: fmtMonth.format(noon(m)), fromDay: from, toDay: to, kind: "month" });
  }
  if (weeks.length > 1) out.push(...weeks.reverse());
  if (months.length > 1) out.push(...months.reverse());
  return out;
}

/** The campaign to date: headline figures, day by day, its ads and report periods. */
export async function portalCampaignDetail(c: CampaignRow, summary: PortalCampaign): Promise<PortalCampaignDetail> {
  const today = todayLondon();
  const fromDay = c.startDay ?? today;
  const toDay = c.endDay && c.endDay < today ? c.endDay : today;
  const creatives = await loadCreatives();
  const { linked } = filesOf(c.id, creatives);
  const started = fromDay <= toDay;
  const stats = started ? await campaignStats(c, fromDay, toDay, { riderNames: null, map: false }) : null;
  const playsByFile = new Map((stats?.files ?? []).map((f) => [f.key, f.plays]));

  const ads = new Map<string, PortalCampaignDetail["ads"][number]>();
  for (const cr of linked) {
    const key = fileKey(cr);
    const have = ads.get(key);
    if (have) {
      if (!have.thumbId && cr.hasThumb) have.thumbId = cr.id;
      continue;
    }
    if (cr.archived) continue;
    ads.set(key, { key, name: cr.name, mediaType: cr.mediaType, thumbId: cr.hasThumb ? cr.id : null, plays: cr.md5 ? playsByFile.get(cr.md5) ?? 0 : 0 });
  }

  return {
    campaign: summary,
    fromDay,
    toDay: started ? toDay : fromDay,
    totals: stats
      ? { plays: stats.totals.plays, seconds: stats.totals.seconds, bags: stats.totals.bags, daysWithPlays: stats.totals.daysWithPlays, km: stats.totals.km, impressions: stats.totals.impressions }
      : { plays: 0, seconds: 0, bags: 0, daysWithPlays: 0, km: 0, impressions: 0 },
    perDay: (stats?.perDay ?? []).filter((d) => !d.noRecords).map((d) => ({ day: d.day, plays: d.plays, seconds: d.seconds, bags: d.bags, impressions: d.impressions })),
    ads: [...ads.values()].sort((a, b) => b.plays - a.plays || a.name.localeCompare(b.name)),
    periods: started ? reportPeriods(fromDay, toDay, !!c.endDay && c.endDay < today) : [],
  };
}

/** Whether a creative belongs to one of the client's campaigns (for its thumbnail). */
export async function clientOwnsCreative(clientId: string, creativeId: string): Promise<RecordModel | null> {
  const cr = await getOneOrNull<RecordModel>("creatives", creativeId);
  if (!cr?.campaign) return null;
  return (await portalCampaignRow(clientId, cr.campaign)) ? cr : null;
}

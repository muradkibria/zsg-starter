// audit area routes (mounted under /api). Owned by the audit feature.
//
//   GET /audit?page&perPage&action&actorId&fromDay&toDay&hideSignIns   newest first   audit.view
//   GET /audit/facets                                       filter options audit.view

import express, { type Router } from "express";
import {
  auditGroup,
  auditGroupLabel,
  humaniseSettingChange,
  isDay,
  londonDayBounds,
  type AuditEntryDto,
  type AuditFacets,
  type Paged,
} from "@digilite/shared";
import { pb, pbDate, parsePbDate, q, type RecordModel } from "../../pb";
import { badRequest, need } from "../http";

const ENTITY_HREF: Record<string, (id: string) => string> = {
  bag: (id) => `/bags/${id}`,
  rider: (id) => `/riders/${id}`,
  zone: (id) => `/zones?zone=${id}`,
  campaign: (id) => `/campaigns/${id}`,
  loop: (id) => `/loops/${id}`,
  creative: () => "/loops",
  schedule: () => "/schedules",
  payroll_period: () => "/payroll",
  export: () => "/exports",
  report: (id) => `/reports/${id}`,
  user: () => "/settings?section=team",
  settings: () => "/settings",
};

function toEntry(r: RecordModel): AuditEntryDto {
  const action = String(r.action || "");
  const group = auditGroup(action);
  const meta = (r.meta ?? {}) as Record<string, unknown>;
  const changes = Array.isArray(meta.changes) ? meta.changes.filter((x): x is string => typeof x === "string").slice(0, 12) : [];
  const type = String(r.entity_type || "");
  const id = String(r.entity_id || "");
  return {
    id: r.id,
    created: parsePbDate(r.created)?.toISOString() ?? new Date(0).toISOString(),
    actorId: r.actor || null,
    actorName: r.actor_name || "System",
    action,
    category: auditGroupLabel(group),
    summary: r.summary || action,
    entity: type && id ? { type, id, href: ENTITY_HREF[type]?.(id) ?? null } : null,
    details: group === "settings" ? changes.map(humaniseSettingChange) : changes,
  };
}

function int(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "string" ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function auditRouter(): Router {
  const r = express.Router();

  r.get("/audit", need("audit.view"), async (req, res) => {
    const qy = req.query as Record<string, unknown>;
    const page = int(qy.page, 1, 1, 100000);
    const perPage = int(qy.perPage, 25, 1, 100);
    const filters: string[] = [];
    if (typeof qy.action === "string" && qy.action) {
      if (!/^[a-z0-9_.-]{1,80}$/i.test(qy.action)) throw badRequest("That filter isn't valid");
      // Whole dot-separated words: "rider" matches rider.create and rider.document.view, not "riders.x".
      filters.push(`(action = ${q(qy.action)} || action ~ ${q(`${qy.action}.%`)})`);
    }
    if (typeof qy.actorId === "string" && qy.actorId) {
      if (qy.actorId === "system") filters.push(`actor = ""`);
      else if (/^[a-z0-9]{1,40}$/i.test(qy.actorId)) filters.push(`actor = ${q(qy.actorId)}`);
      else throw badRequest("That filter isn't valid");
    }
    if (qy.hideSignIns === "true" || qy.hideSignIns === "1") filters.push(`action !~ ${q("auth.%")}`);
    if (isDay(qy.fromDay)) filters.push(`created >= ${q(pbDate(londonDayBounds(qy.fromDay)[0]))}`);
    if (isDay(qy.toDay)) filters.push(`created < ${q(pbDate(londonDayBounds(qy.toDay)[1]))}`);
    if (isDay(qy.fromDay) && isDay(qy.toDay) && qy.toDay < qy.fromDay) throw badRequest("The end date is before the start date");
    const list = await pb.collection("audit_log").getList<RecordModel>(page, perPage, {
      filter: filters.join(" && "),
      sort: "-created",
    });
    const body: Paged<AuditEntryDto> = { items: list.items.map(toEntry), page: list.page, perPage: list.perPage, total: list.totalItems };
    res.json(body);
  });

  r.get("/audit/facets", need("audit.view"), async (_req, res) => {
    // The most recent 5,000 entries are plenty to offer sensible filters.
    const recent: RecordModel[] = [];
    for (let page = 1; page <= 5; page++) {
      const res = await pb.collection("audit_log").getList<RecordModel>(page, 1000, {
        sort: "-created",
        fields: "action,actor,actor_name",
        skipTotal: true,
      });
      recent.push(...res.items);
      if (res.items.length < 1000) break;
    }
    const groups = new Map<string, number>();
    const actors = new Map<string, string>();
    for (const e of recent) {
      const g = auditGroup(String(e.action || ""));
      if (g) groups.set(g, (groups.get(g) ?? 0) + 1);
      const id = e.actor ? String(e.actor) : "system";
      if (!actors.has(id)) actors.set(id, e.actor ? e.actor_name || "Someone" : "System");
    }
    const body: AuditFacets = {
      groups: [...groups.entries()]
        .map(([key, count]) => ({ key, label: auditGroupLabel(key), count }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      actors: [...actors.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    };
    res.json(body);
  });

  return r;
}

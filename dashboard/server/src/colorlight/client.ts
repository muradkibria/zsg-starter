// Colorlight Cloud HTTP client (Basic Auth). READ methods only are exported
// for general use; raw write methods live in ./raw-writes and must only be
// called from ./gate after the safety checks.

import { config } from "../config";
import { logger } from "../log";
import type { ClLatestGps, ClMedia, ClPlayTimes, ClProgram, ClTerminal, ClTrack } from "./types";

const log = logger("colorlight");

export class ColorlightError extends Error {
  constructor(message: string, public status: number | null, public body?: string) {
    super(message);
  }
}

const authHeader = () =>
  "Basic " + Buffer.from(`${config.COLORLIGHT_USERNAME}:${config.COLORLIGHT_PASSWORD}`).toString("base64");

const base = () => config.COLORLIGHT_API_BASE.replace(/\/$/, "");

// Gentle rate limit: at most N concurrent requests to Colorlight.
const MAX_CONCURRENT = 4;
let active = 0;
const queue: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => queue.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    queue.shift()?.();
  }
}

export interface ClResponse<T> {
  status: number;
  headers: Headers;
  data: T;
}

export async function clRequest<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "HEAD",
  path: string,
  body?: unknown,
  opts: { timeoutMs?: number; raw?: boolean; headers?: Record<string, string> } = {},
): Promise<ClResponse<T>> {
  if (!config.colorlightConfigured) throw new ColorlightError("Colorlight login is not configured", null);
  return slot(async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30000);
    try {
      const res = await fetch(base() + path, {
        method,
        headers: {
          authorization: authHeader(),
          accept: opts.raw ? "*/*" : "application/json",
          ...(body !== undefined && !(body instanceof Buffer) && !(body instanceof FormData)
            ? { "content-type": "application/json" }
            : {}),
          ...opts.headers,
        },
        body:
          body === undefined
            ? undefined
            : body instanceof Buffer || body instanceof FormData
              ? (body as unknown as RequestInit["body"])
              : JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new ColorlightError(`${method} ${path} → ${res.status}`, res.status, text.slice(0, 500));
      }
      const data = opts.raw ? ((Buffer.from(await res.arrayBuffer()) as unknown) as T) : ((await res.json()) as T);
      return { status: res.status, headers: res.headers, data };
    } catch (err) {
      if (err instanceof ColorlightError) throw err;
      throw new ColorlightError(`${method} ${path} failed: ${(err as Error).message}`, null);
    } finally {
      clearTimeout(timer);
    }
  });
}

// ── Reads ─────────────────────────────────────────────────────────────────────

/** All terminals with their full status blob (`post_meta._led_status`). One call per 100 bags. */
export async function listTerminals(): Promise<ClTerminal[]> {
  const out: ClTerminal[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await clRequest<ClTerminal[]>("GET", `/wp-json/wp/v2/leds?per_page=100&page=${page}`);
    out.push(...res.data);
    const totalPages = Number(res.headers.get("x-wp-totalpages") ?? 1);
    if (page >= totalPages || res.data.length < 100) break;
  }
  return out;
}

/** Latest GPS fix for many terminals in one call. */
export async function latestGps(terminalIds: number[]): Promise<ClLatestGps[]> {
  if (!terminalIds.length) return [];
  const res = await clRequest<ClLatestGps[] | { data?: ClLatestGps[] }>("POST", "/wp-json/led/v3/monitor/query/latest", {
    terminalIds,
  });
  const d = res.data as ClLatestGps[] | { data?: ClLatestGps[] };
  return Array.isArray(d) ? d : d.data ?? [];
}

/** GPS track between two UTC instants ("YYYY-MM-DDTHH:MM:SS"). */
export async function track(terminalId: number, startTime: string, endTime: string): Promise<ClTrack> {
  const res = await clRequest<ClTrack>("POST", "/wp-json/led/v3/monitor/query/track", {
    terminalId: String(terminalId),
    startTime,
    endTime,
  });
  return { terminalId, data: Array.isArray(res.data?.data) ? res.data.data : [] };
}

export async function playTimes(terminalId: number, startTime: string, endTime: string): Promise<ClPlayTimes> {
  const res = await clRequest<ClPlayTimes>("POST", "/wp-json/led/v3/statistic/media/playTimes", {
    terminalId,
    startTime,
    endTime,
  });
  return { terminalId, totalPlayTimes: res.data?.totalPlayTimes ?? 0, statistic: res.data?.statistic ?? [] };
}

export async function listMedia(): Promise<ClMedia[]> {
  const out: ClMedia[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await clRequest<ClMedia[]>("GET", `/wp-json/wp/v2/media?per_page=100&page=${page}&flag=filter`);
    out.push(...res.data);
    const total = Number(res.headers.get("x-wp-total") ?? out.length);
    if (out.length >= total || res.data.length < 100) break;
  }
  return out;
}

export async function listPrograms(): Promise<ClProgram[]> {
  const out: ClProgram[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await clRequest<ClProgram[]>("GET", `/wp-json/wp/v2/programs?per_page=100&page=${page}`);
    out.push(...res.data);
    const totalPages = Number(res.headers.get("x-wp-totalpages") ?? 1);
    if (page >= totalPages || res.data.length < 100) break;
  }
  return out;
}

export async function getTerminalSchedule(terminalId: number): Promise<unknown> {
  const res = await clRequest<{ data?: unknown }>("GET", `/wp-json/wp/v3/schedules/${terminalId}/terminalSchedules`);
  return (res.data as { data?: unknown })?.data ?? res.data;
}

/** Latest screenshot image of a terminal (JPEG bytes). */
export async function fetchScreenshot(terminalId: number): Promise<Buffer> {
  return (await clRequest<Buffer>("GET", `/wp-content/uploads/screenshot/${terminalId}_led.jpeg`, undefined, { raw: true })).data;
}

/** Fetch a file hosted by Colorlight (media thumbnails). Only same-host URLs. */
export async function fetchColorlightFile(url: string, opts: { timeoutMs?: number } = {}): Promise<Buffer> {
  const u = new URL(url, base());
  if (u.origin !== new URL(base()).origin) throw new ColorlightError("Refusing to fetch a non-Colorlight URL", null);
  return (await clRequest<Buffer>("GET", u.pathname + u.search, undefined, { raw: true, timeoutMs: opts.timeoutMs ?? 60000 })).data;
}

export function colorlightLog() {
  return log;
}

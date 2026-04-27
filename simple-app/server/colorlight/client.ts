// ─────────────────────────────────────────────────────────────────────────────
// Colorlight Cloud client — session-cookie auth, typed read methods.
// Endpoints reverse-engineered from a network capture of beu.colorlightcloud.com.
// ─────────────────────────────────────────────────────────────────────────────

import axios, { AxiosInstance, AxiosError } from "axios";

// ── Types (shapes captured from real responses) ──────────────────────────────

export interface ColorlightTerminal {
  id: number;
  date: string | null;
  title: { rendered: string; raw: string };
  type: string;
  terminalgroup?: { id: number; name: string }[];
  post_meta?: Record<string, unknown>;
  extra?: { author_display_name?: string };
}

export interface ColorlightLatestGps {
  terminalId: number;
  terminalName: string;
  reportTime: string;
  serverTime: string;
  clientTime: string;
  longitude: number;
  latitude: number;
  speed: number | null;
  direct: number | null;
  altitude: number | null;
  accuracy: number | null;
  satellites: number | null;
}

export interface ColorlightTrackPoint {
  longitude: number;
  latitude: number;
  serverTime: string;
  clientTime: string;
}

export interface ColorlightTrackResponse {
  terminalId: number;
  terminalName: string;
  startTime: string;
  endTime: string;
  data: ColorlightTrackPoint[];
}

export interface ColorlightHeatPoint {
  longitude: number;
  latitude: number;
  count: number;
  cellId: string;
}

export interface ColorlightHeatResponse {
  terminalIds: number[];
  startTime: string;
  endTime: string;
  data: ColorlightHeatPoint[];
}

export interface ColorlightOnlineEntry {
  terminalId: number;
  deviceName: string;
  terminalGroupName: string;
  totalOnlineTime: number;
  totalOfflineTime: number;
  isTerminalOnline: boolean;
  lastOnlineTime: string;
  createTime: string;
  description?: string;
}

export interface ColorlightPlayTimes {
  terminalId: number;
  startTime: string;
  endTime: string;
  totalPlayTimes: number;
  statistic: {
    mediaMd5: string;
    mediaName: string;
    mediaType: string;
    totalPlayTimes: number;
    totalPlayDuration: number;
  }[];
}

export interface ColorlightMediaItem {
  id: number;
  title: { rendered: string };
  title_raw?: string;
  source_url: string;
  video_thumbnail_jpg?: string;
  file_type: string;
  mime_type: string;
  date: string;
  date_gmt: string;
  media_details?: {
    width?: number;
    height?: number;
    filesize?: number;
    playtime_seconds?: number;
    length_formatted?: string;
    mime_type?: string;
  };
  attachment_program?: { id: number; name: string }[];
}

// ── Module state ─────────────────────────────────────────────────────────────

let client: AxiosInstance | null = null;
let cookies: string[] = [];           // raw "name=value" pairs
let baseURL = "";
let username = "";
let password = "";
let isAuthenticating = false;
let lastAuthAt = 0;

const AUTH_REFRESH_MS = 60 * 60 * 1000; // re-login hourly to keep session warm

// ── Setup ────────────────────────────────────────────────────────────────────

function buildClient() {
  client = axios.create({
    baseURL,
    timeout: 15_000,
    maxRedirects: 0,
    validateStatus: (s) => s < 400 || s === 302, // allow login 302 manually
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent": "DigiLite-CMS/1.0 (+colorlight-integration)",
    },
  });

  client.interceptors.request.use((cfg) => {
    if (cookies.length > 0) {
      cfg.headers = cfg.headers ?? {};
      cfg.headers["Cookie"] = cookies.join("; ");
    }
    return cfg;
  });

  client.interceptors.response.use(
    (res) => res,
    async (err: AxiosError) => {
      const status = err.response?.status;
      const cfg = err.config as any;
      if ((status === 401 || status === 403) && cfg && !cfg.__isRetry) {
        cfg.__isRetry = true;
        await login();
        return client!.request(cfg);
      }
      throw err;
    }
  );
}

export async function initColorlight() {
  baseURL = process.env.COLORLIGHT_API_BASE ?? "";
  username = process.env.COLORLIGHT_USERNAME ?? "";
  password = process.env.COLORLIGHT_PASSWORD ?? "";

  if (!baseURL || !username || !password) {
    throw new Error(
      "Missing Colorlight credentials. Set COLORLIGHT_API_BASE, COLORLIGHT_USERNAME, COLORLIGHT_PASSWORD in .env"
    );
  }

  buildClient();
  await login();

  // Periodic re-login to refresh session
  setInterval(() => {
    login().catch((err) =>
      console.warn("[colorlight] Background re-login failed:", err.message)
    );
  }, AUTH_REFRESH_MS);
}

// ── Auth ─────────────────────────────────────────────────────────────────────

async function login() {
  if (isAuthenticating) return;
  isAuthenticating = true;
  try {
    const params = new URLSearchParams();
    params.append("log", username);
    params.append("pwd", password);
    params.append("wp-submit", "Log In");
    params.append("redirect_to", "/home");
    params.append("testcookie", "1");

    // First request: GET wp-login.php to seed wordpress_test_cookie if required
    try {
      const seed = await client!.get("/wp-login.php");
      captureCookies(seed.headers["set-cookie"]);
    } catch {
      // Some WP installs return 302 here; cookies still extractable
    }

    const res = await client!.post("/wp-login.php", params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    captureCookies(res.headers["set-cookie"]);

    const hasLoggedInCookie = cookies.some((c) =>
      /^wordpress_logged_in_/.test(c)
    );
    if (!hasLoggedInCookie) {
      throw new Error(
        `Login did not return a wordpress_logged_in_* cookie. Status: ${res.status}. Check credentials and base URL.`
      );
    }

    lastAuthAt = Date.now();
    console.log(
      `[colorlight] authenticated as ${username} @ ${baseURL} (${cookies.length} cookies)`
    );
  } finally {
    isAuthenticating = false;
  }
}

function captureCookies(setCookieHeader: string[] | undefined) {
  if (!setCookieHeader || setCookieHeader.length === 0) return;
  const incoming = setCookieHeader.map((line) => {
    const semi = line.indexOf(";");
    return semi === -1 ? line.trim() : line.slice(0, semi).trim();
  });
  // Replace existing cookies with same name; append new
  const map = new Map<string, string>();
  for (const c of cookies) {
    const eq = c.indexOf("=");
    if (eq > -1) map.set(c.slice(0, eq), c);
  }
  for (const c of incoming) {
    const eq = c.indexOf("=");
    if (eq > -1) {
      const v = c.slice(eq + 1);
      if (v === "" || v === "deleted") map.delete(c.slice(0, eq));
      else map.set(c.slice(0, eq), c);
    }
  }
  cookies = Array.from(map.values());
}

export function isAuthenticated() {
  return cookies.some((c) => /^wordpress_logged_in_/.test(c));
}

// ── API methods ──────────────────────────────────────────────────────────────

export async function listTerminals(): Promise<ColorlightTerminal[]> {
  const res = await client!.get<ColorlightTerminal[]>("/wp-json/wp/v2/leds", {
    params: { per_page: 100, page: 1, status: "any", context: "edit" },
  });
  return res.data ?? [];
}

export async function getTerminal(id: number | string): Promise<ColorlightTerminal> {
  const res = await client!.get<ColorlightTerminal>(`/wp-json/wp/v2/leds/${id}`);
  return res.data;
}

export async function getLatestGpsForAll(
  terminalGroupId = ""
): Promise<ColorlightLatestGps[]> {
  const res = await client!.post<ColorlightLatestGps[] | { data: ColorlightLatestGps[] }>(
    "/wp-json/led/v3/monitor/query/latest",
    { terminalGroupId },
    { headers: { "Content-Type": "application/json" } }
  );
  // Some wrappers return { data: [...] }, others return [...]
  const body: any = res.data;
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

export async function getLatestGpsForTerminal(
  terminalId: number | string
): Promise<ColorlightLatestGps | null> {
  try {
    const res = await client!.post<ColorlightLatestGps>(
      "/wp-json/led/v3/monitor/query/latest/single",
      { terminalId: Number(terminalId) },
      { headers: { "Content-Type": "application/json" } }
    );
    return res.data ?? null;
  } catch {
    return null;
  }
}

export async function getTrack(
  terminalId: number | string,
  startTime: string,
  endTime: string
): Promise<ColorlightTrackResponse> {
  const res = await client!.post<ColorlightTrackResponse>(
    "/wp-json/led/v3/monitor/query/track",
    { terminalId: String(terminalId), startTime, endTime },
    { headers: { "Content-Type": "application/json" } }
  );
  return res.data;
}

export async function getHeatMap(
  terminalGroupId: number,
  startTime: string,
  endTime: string
): Promise<ColorlightHeatResponse> {
  const res = await client!.post<ColorlightHeatResponse>(
    "/wp-json/led/v3/monitor/query/heatMap",
    { terminalGroupId, startTime, endTime },
    { headers: { "Content-Type": "application/json" } }
  );
  return res.data;
}

export async function getOnlineForm(): Promise<ColorlightOnlineEntry[]> {
  const res = await client!.get<ColorlightOnlineEntry[]>("/wp-json/wp/v2/online/form");
  return res.data ?? [];
}

export async function getMediaPlayTimes(
  terminalId: number | string,
  startTime: string,
  endTime: string
): Promise<ColorlightPlayTimes> {
  const res = await client!.post<ColorlightPlayTimes>(
    "/wp-json/led/v3/statistic/media/playTimes",
    { terminalId: Number(terminalId), startTime, endTime },
    { headers: { "Content-Type": "application/json" } }
  );
  return res.data;
}

export async function listMedia(): Promise<ColorlightMediaItem[]> {
  const res = await client!.get<ColorlightMediaItem[]>("/wp-json/wp/v2/media");
  return res.data ?? [];
}

export function getBaseURL() {
  return baseURL;
}

export function getUsername() {
  return username;
}

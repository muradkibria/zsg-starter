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
    // Colorlight uses the WordPress "Login With Ajax" plugin variant,
    // not the standard form. Confirmed from network capture.
    const params = new URLSearchParams();
    params.append("log", username);
    params.append("pwd", password);
    params.append("lwa", "1");
    params.append("login-with-ajax", "login");

    const res = await client!.post<{
      result?: boolean;
      message?: string;
      action?: string;
      user?: { data?: { username?: string; role?: string } };
      cookie?: { cookie_name?: string };
    }>("/wp-login.php", params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    captureCookies(res.headers["set-cookie"]);

    const body = res.data;
    if (!body || body.result !== true) {
      throw new Error(
        `Login rejected by Colorlight. message="${body?.message ?? "(none)"}" status=${res.status}. Check credentials and base URL.`
      );
    }

    if (cookies.length === 0) {
      // Login OK but no cookies received — would still hit 401 on next call.
      throw new Error(
        "Login returned result=true but no Set-Cookie headers were captured. Check that your reverse proxy isn't stripping cookies."
      );
    }

    lastAuthAt = Date.now();
    const userInfo = body.user?.data;
    console.log(
      `[colorlight] authenticated as ${userInfo?.username ?? username} (${userInfo?.role ?? "?"}) @ ${baseURL} — ${cookies.length} cookie(s)`
    );

    // Verify session works by hitting a protected endpoint
    try {
      await client!.get("/wp-json/wp/v2/users/me");
    } catch (err: any) {
      throw new Error(
        `Session cookie was set but verification call to /users/me failed (${err.response?.status ?? err.code}). Cookies may not be valid.`
      );
    }
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

/**
 * Fetch latest GPS for many terminals concurrently (in batches).
 * The bulk `/latest` endpoint with empty terminalGroupId returns
 * inconsistent results, so we fan out to `/latest/single` per terminal.
 */
export async function getLatestGpsBatched(
  terminalIds: number[],
  concurrency = 6
): Promise<ColorlightLatestGps[]> {
  const out: ColorlightLatestGps[] = [];
  for (let i = 0; i < terminalIds.length; i += concurrency) {
    const slice = terminalIds.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      slice.map((id) => getLatestGpsForTerminal(id))
    );
    for (const s of settled) {
      if (s.status === "fulfilled" && s.value) out.push(s.value);
    }
  }
  return out;
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
  // Colorlight's gateway demands the `flag=filter` query param on this endpoint
  // (confirmed by inspecting their own web UI's network calls). Without it the
  // Spring filter rejects every request with a stock 400 before reaching WP.
  // Pagination: walk pages until we've seen X-Wp-Total items (cap 500 to be safe).
  const PER_PAGE = 100;
  const HARD_CAP = 500;
  const all: ColorlightMediaItem[] = [];
  let page = 1;
  while (all.length < HARD_CAP) {
    const res = await client!.get<ColorlightMediaItem[]>("/wp-json/wp/v2/media", {
      params: { page, per_page: PER_PAGE, flag: "filter" },
    });
    const batch = res.data ?? [];
    all.push(...batch);
    const total = Number(res.headers["x-wp-total"] ?? all.length);
    if (all.length >= total || batch.length < PER_PAGE) break;
    page++;
  }
  return all;
}

export function getBaseURL() {
  return baseURL;
}

export function getUsername() {
  return username;
}

// ── Write-mode safety gate ───────────────────────────────────────────────────
//
// Three modes:
//   1. "off"      — COLORLIGHT_WRITES_ENABLED=false and no test-bag allowlist:
//                   All writes are dry-run-only.
//   2. "test-bag" — COLORLIGHT_WRITES_ENABLED=false but COLORLIGHT_TEST_BAG_IDS
//                   is set: uploads + program creation proceed for real, but
//                   program-to-bag assignments only succeed if every target
//                   bag is in the allowlist. Used for safe single-bag testing.
//   3. "on"       — COLORLIGHT_WRITES_ENABLED=true: all writes go through.
//
// `writesEnabled()` returns true in modes 2 and 3 (so uploads/program creation
// happen). `canWriteToBag()` adds the per-bag gate for assignments.

export function getTestBagAllowlist(): string[] {
  const raw = (process.env.COLORLIGHT_TEST_BAG_IDS ?? "").trim();
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function writesEnabled(): boolean {
  if (process.env.COLORLIGHT_WRITES_ENABLED === "true") return true;
  // Test-bag mode also counts as "writes on" for non-bag-specific operations
  // (upload, program creation). Those are harmless on their own — they only
  // affect the world when a program gets assigned to a bag, which is where
  // canWriteToBag() enforces the per-bag check.
  return getTestBagAllowlist().length > 0;
}

export function isMasterWritesEnabled(): boolean {
  return process.env.COLORLIGHT_WRITES_ENABLED === "true";
}

export function isTestBagMode(): boolean {
  return !isMasterWritesEnabled() && getTestBagAllowlist().length > 0;
}

/** Check whether assigning a program to a given bag is currently permitted. */
export function canWriteToBag(bagId: string | number): boolean {
  if (isMasterWritesEnabled()) return true;
  const allow = getTestBagAllowlist();
  return allow.includes(String(bagId));
}

// ── Media upload (TUS resumable protocol) ────────────────────────────────────

export interface TusFileInfo {
  uri: string;          // /wp-content/uploads/Tus/<uuid>
  alreadyExists: boolean;
}

/** Search for an existing file by MD5 checksum (deduplication). */
export async function searchByChecksum(md5: string): Promise<TusFileInfo | null> {
  try {
    const res = await client!.get("/wp-content/uploads/TusFileSearchByChecksum", {
      headers: { "Upload-Checksum": `md5 ${md5}` },
      maxRedirects: 0,
      validateStatus: (s) => s < 500,
    });
    const loc = res.headers["location"];
    if (loc) return { uri: loc, alreadyExists: true };
    return null;
  } catch {
    return null;
  }
}

/**
 * Initiate a fresh TUS upload. Returns the URI to PATCH chunks to.
 * In safety-gate mode, returns a fake URI without contacting Colorlight.
 */
export async function tusCreate(
  filename: string,
  mimeType: string,
  sizeBytes: number
): Promise<TusFileInfo> {
  if (!writesEnabled()) {
    console.warn(`[colorlight DRY-RUN] tusCreate(${filename}, ${sizeBytes}b) — no upload performed`);
    return { uri: `/dryrun/tus/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, alreadyExists: false };
  }
  // Real TUS create uses base64-encoded metadata
  const meta = [
    `filename ${Buffer.from(filename, "utf8").toString("base64")}`,
    `filetype ${Buffer.from(mimeType, "utf8").toString("base64")}`,
  ].join(",");
  const res = await client!.post("/wp-content/uploads/Tus/files", null, {
    headers: {
      "Tus-Resumable": "1.0.0",
      "Upload-Length": String(sizeBytes),
      "Upload-Metadata": meta,
    },
    maxRedirects: 0,
    validateStatus: (s) => s < 500,
  });
  const uri = res.headers["location"];
  if (!uri) throw new Error(`TUS create returned no Location header (status ${res.status})`);
  return { uri, alreadyExists: false };
}

/** Get current Upload-Offset for a TUS upload (for resume). */
export async function tusHead(uri: string): Promise<number> {
  if (!writesEnabled()) return 0;
  const res = await client!.head(uri, {
    headers: { "Tus-Resumable": "1.0.0" },
    validateStatus: (s) => s < 500,
  });
  return Number(res.headers["upload-offset"] ?? 0);
}

/** PATCH a chunk to a TUS upload. */
export async function tusUpload(uri: string, chunk: Buffer, offset: number): Promise<number> {
  if (!writesEnabled()) {
    console.warn(`[colorlight DRY-RUN] tusUpload(${uri}, ${chunk.length}b @ offset ${offset}) — discarded`);
    return offset + chunk.length;
  }
  const res = await client!.patch(uri, chunk, {
    headers: {
      "Tus-Resumable": "1.0.0",
      "Upload-Offset": String(offset),
      "Content-Type": "application/offset+octet-stream",
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: (s) => s < 500,
  });
  return Number(res.headers["upload-offset"] ?? offset + chunk.length);
}

/**
 * After a TUS upload completes, register it as a WordPress media attachment.
 * This is what makes the file appear in the Colorlight Media library and
 * generates the thumbnail / metadata.
 */
export async function registerMedia(tusUri: string, title: string): Promise<ColorlightMediaItem | null> {
  if (!writesEnabled()) {
    console.warn(`[colorlight DRY-RUN] registerMedia(${tusUri}, "${title}") — fake media object returned`);
    return null;
  }
  // The TUS uri is like "/wp-content/uploads/Tus/<uuid>" — Colorlight wants just the uuid
  const uploadURI = tusUri.replace(/^.*\/Tus\//, "").replace(/\?.*$/, "");
  const FormData = (globalThis as any).FormData;
  const form = new FormData();
  form.append("uploadURI", uploadURI);
  const res = await client!.post(
    `/wp-json/wp/v2/media?title=${encodeURIComponent(title)}`,
    form,
    { maxBodyLength: Infinity }
  );
  return res.data as ColorlightMediaItem;
}

// ── Programs (playlists) ─────────────────────────────────────────────────────

export interface ProgramMediaItem {
  fileID: number;
  filename: string;
  source_url: string;          // from registered media
  thumbnail_url?: string;      // video_thumbnail_jpg if video
  file_type: string;           // "mp4" / "jpg" / etc.
  type: "video" | "image";
  duration_seconds: number;    // typically 10
  width: number;               // 160
  height: number;              // 120
}

const SCREEN_WIDTH = 160;
const SCREEN_HEIGHT = 120;
const SCREEN_SCALE = 0.89;

/**
 * Build the VSN program_info payload Colorlight expects.
 * Maps a list of media items to one Page → one File Window → N children.
 */
function buildProgramInfo(name: string, mediaItems: ProgramMediaItem[]) {
  const now = new Date();
  const dateStr = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`;

  return {
    name,
    displayName: name,
    isCrop: 0,
    id: 10,
    type: "contents",
    version: 4,
    selectChild: 0,
    addNum: 1,
    overStage: false,
    info: {
      Information: { Width: SCREEN_WIDTH, Height: SCREEN_HEIGHT, Scale: SCREEN_SCALE },
      Pages: [],
    },
    children: [
      {
        name: "Page1",
        id: 11,
        index: 1,
        type: "page",
        selectChild: 0,
        addNum: 1,
        info: {
          AppointDuration: 3600000,
          Opacity: 1,
          LoopType: 1,
          BgColor: "0xFF000000",
          Regions: [],
        },
        children: [
          {
            name: "File Window",
            id: 12,
            index: 1,
            type: "fileWindow",
            vsnType: 3,
            Rect: {
              X: 0, Y: 0,
              Width: SCREEN_WIDTH, Height: SCREEN_HEIGHT,
              BorderWidth: 0, BorderColor: "#ffff00",
            },
            IsScheduleRegion: 0,
            selectChild: null,
            children: mediaItems.map((m, idx) => ({
              id: Math.random(),
              fileID: m.fileID,
              file_type: m.file_type,
              author: username,
              date: now.toISOString().replace("T", " ").slice(0, 19),
              modified_gmt: now.toISOString().slice(0, 19) + "Z",
              date_gmt: now.toISOString().slice(0, 19) + "Z",
              GMTDate: now.toISOString().slice(0, 19) + "Z",
              name: m.filename,
              type: m.type,
              src: m.thumbnail_url ?? m.source_url,
              source_url: m.source_url,
              format_size: "",
              attachment_program: [],
              attachment_program_detail: [],
              disdelete: false,
              thumbnailSize: { width: "200", height: "150" },
              fullSize: { width: m.width, height: m.height },
              videoSize: m.type === "video" ? { width: m.width, height: m.height } : undefined,
              length: m.duration_seconds * 1000,
              durationInSecond: m.duration_seconds,
              playLength: secondsToHms(m.duration_seconds),
              mshare: [],
              mfolder: null,
              duration: null,
              aws: {},
              IsSchedule: 0,
              Schedule: {
                IsLimitTime: 0,
                StartTime: "00:00:00",
                EndTime: "23:59:59",
                IsLimitDate: 0,
                StartDay: dateStr,
                StartDayTime: "00:00:00",
                EndDay: dateStr,
                EndDayTime: "23:59:59",
                IsLimitWeek: 0,
                LimitWeek: [1, 1, 1, 1, 1, 1, 1],
              },
              shareWithMe: false,
              Trigger: { Type: "lightStrip", Value: "0" },
              customTags: [],
              source: "MEDIA.WEB",
              video_thumbnail_jpg: m.thumbnail_url,
              hover: idx === 0,
              Duration: m.duration_seconds * 1000,
              isShowAspectBtn: false,
              ReserveAS: 0,
              playTime: m.duration_seconds,
              PlayTimes: "1",
              inEffect: { Name: "No Effect", Type: 0, Time: 1500, webTime: 1.5 },
            })),
            badge: String(mediaItems.length),
            icon: "perm_media",
          },
        ],
      },
    ],
  };
}

function secondsToHms(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return [h, m, ss].map((x) => String(x).padStart(2, "0")).join(":");
}

export interface CreateProgramResponse {
  id: number;
  name: string;
  vsn_name?: string;
  dryRun?: boolean;
}

/** Create a program (playlist) from a list of media items. */
export async function createProgram(
  title: string,
  mediaItems: ProgramMediaItem[]
): Promise<CreateProgramResponse> {
  if (!writesEnabled()) {
    console.warn(
      `[colorlight DRY-RUN] createProgram("${title}", ${mediaItems.length} item(s)) ` +
      `— would have created a VSN program with ${mediaItems.length} children`
    );
    return { id: -1, name: title, dryRun: true };
  }
  const program_info = buildProgramInfo(title, mediaItems);
  const res = await client!.post("/wp-json/wp/v2/programs", {
    title,
    Terminalgroup: [],
    program_info,
  });
  return { id: res.data.id, name: res.data.title_raw ?? title, vsn_name: res.data.vsn_name };
}

/** Custom error subclass so callers can return 403 (not 502) for allowlist blocks. */
export class BagWriteBlockedError extends Error {
  blocked: string[];
  allowed: string[];
  constructor(blocked: string[], allowed: string[]) {
    super(
      `Write blocked — bag(s) [${blocked.join(", ")}] are not in COLORLIGHT_TEST_BAG_IDS allowlist. ` +
      `Allowed bags: [${allowed.join(", ") || "(none)"}].`
    );
    this.name = "BagWriteBlockedError";
    this.blocked = blocked;
    this.allowed = allowed;
  }
}

/** Push a created program out to selected terminals. */
export async function assignProgramToTerminals(
  programId: number,
  terminalGroupId: number,
  terminalIds: number[],
  pushToAllInGroup: boolean = false
): Promise<{ success: boolean; dryRun?: boolean; blocked?: string[] }> {
  // Pure dry-run mode (no master flag, no test-bag allowlist)
  if (!writesEnabled()) {
    console.warn(
      `[colorlight DRY-RUN] assignProgramToTerminals(programId=${programId}, group=${terminalGroupId}, ` +
      `terminals=[${terminalIds.join(",")}]${pushToAllInGroup ? ", all" : ""}) — NOT pushed to bags`
    );
    return { success: true, dryRun: true };
  }

  // Test-bag mode — enforce per-bag allowlist
  if (isTestBagMode()) {
    const blocked = terminalIds.filter((id) => !canWriteToBag(id));
    if (blocked.length > 0) {
      throw new BagWriteBlockedError(
        blocked.map(String),
        getTestBagAllowlist()
      );
    }
    console.log(
      `[colorlight TEST-BAG MODE] Assigning program ${programId} to allowlisted bags: [${terminalIds.join(",")}]`
    );
  }

  await client!.put(
    `/wp-json/wp/v2/programs/${programId}?flag=terminalgroup`,
    {
      what: "assign_program_to_terminal_group",
      to: {
        terminals_groups: [
          { all: pushToAllInGroup, id: terminalGroupId, terminals: terminalIds },
        ],
      },
    }
  );
  return { success: true };
}

/** Verify a program's current terminal assignments. */
export async function getProgramDetails(programId: number) {
  if (!writesEnabled()) return { dryRun: true };
  const res = await client!.get(`/wp-json/wp/v2/programs/${programId}/details`);
  return res.data;
}

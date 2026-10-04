// Raw Colorlight write calls. DO NOT import this outside ./writes.ts — every
// call must go through the gate (./gate.ts) first.

import { createHash } from "node:crypto";
import { clRequest } from "./client";

export type CommandKind = "brightness" | "reboot" | "screenshot" | "sleep" | "wakeup";

const COMMAND_PATH: Record<CommandKind, string> = {
  brightness: "brightnessCommand",
  reboot: "rebootCommand",
  screenshot: "screenshotCommand",
  sleep: "sleepCommand",
  wakeup: "wakeupCommand",
};

/** Simplified command API (Colorlight ≥ 2.6.6). Targets an explicit list of terminals only. */
export function commandPayload(kind: CommandKind, terminalIds: number[], value?: number): Record<string, unknown> {
  return value === undefined ? { terminalIds } : { terminalIds, value: String(value) };
}

export async function rawCommand(kind: CommandKind, payload: Record<string, unknown>) {
  return clRequest<unknown>("POST", `/wp-json/wp/v2/comments/${COMMAND_PATH[kind]}`, payload);
}

/** Per-terminal schedule (never the group-wide "simplified" endpoint). */
export async function rawPutTerminalSchedule(terminalId: number, scheduleJson: Record<string, unknown>) {
  return clRequest<unknown>("PUT", `/wp-json/wp/v3/schedules/${terminalId}/terminalSchedules`, scheduleJson);
}

// ── Programs (loops) ──────────────────────────────────────────────────────────

export interface ProgramMediaItem {
  fileID: number;
  filename: string;
  sourceUrl: string;
  thumbnailUrl?: string;
  fileType: string;
  type: "video" | "image";
  durationSeconds: number;
  width: number;
  height: number;
}

const secondsToHms = (s: number) =>
  [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((x) => String(x).padStart(2, "0")).join(":");

/** VSN spec Colorlight ships to bags: one page per item, each a full-screen file window. */
export function buildVsnPrograms(items: ProgramMediaItem[], width = 160, height = 120) {
  const now = new Date();
  const dateStr = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`;
  return {
    Program: {
      Information: { Width: width, Height: height, Scale: 1 },
      Pages: items.map((m) => ({
        AppointDuration: 3600000,
        Opacity: 1,
        LoopType: 1,
        BgColor: "0xFF000000",
        Regions: [
          {
            type: 3,
            Layer: 1,
            Rect: { X: 0, Y: 0, Width: width, Height: height, BorderWidth: 0, BorderColor: "#ffff00" },
            Name: "File_Window",
            IsScheduleRegion: 0,
            Items: [
              {
                Type: 3,
                Duration: m.durationSeconds * 1000,
                PlayTimes: "1",
                Volume: "1.000000",
                Loop: 1,
                PlayLength: m.durationSeconds * 1000,
                Schedule: {
                  IsLimitTime: 0, StartTime: "00:00:00", EndTime: "23:59:59",
                  IsLimitDate: 0, StartDay: dateStr, StartDayTime: "00:00:00", EndDay: dateStr, EndDayTime: "23:59:59",
                  IsLimitWeek: 0, LimitWeek: "1,1,1,1,1,1,1",
                },
                Trigger: { Type: "lightStrip", Value: "0" },
                FileSource: { IsRelative: 1, FilePath: "", Resource_ID: m.fileID, OriginName: m.filename },
                ReserveAS: 0,
              },
            ],
          },
        ],
      })),
    },
  };
}

/** UI metadata Colorlight's own editor stores alongside the VSN spec. */
export function buildProgramInfo(name: string, items: ProgramMediaItem[], author: string, width = 160, height = 120) {
  const now = new Date();
  const iso = now.toISOString().slice(0, 19);
  return {
    name, displayName: name, isCrop: 0, id: 10, type: "contents", version: 4, selectChild: 0, addNum: 1, overStage: false,
    info: { Information: { Width: width, Height: height, Scale: 0.89 }, Pages: [] },
    children: [
      {
        name: "Page1", id: 11, index: 1, type: "page", selectChild: 0, addNum: 1,
        info: { AppointDuration: 3600000, Opacity: 1, LoopType: 1, BgColor: "0xFF000000", Regions: [] },
        children: [
          {
            name: "File Window", id: 12, index: 1, type: "fileWindow", vsnType: 3,
            Rect: { X: 0, Y: 0, Width: width, Height: height, BorderWidth: 0, BorderColor: "#ffff00" },
            IsScheduleRegion: 0, selectChild: null,
            children: items.map((m, idx) => ({
              id: idx + 1, fileID: m.fileID, file_type: m.fileType, author, date: iso.replace("T", " "),
              modified_gmt: iso + "Z", date_gmt: iso + "Z", GMTDate: iso + "Z", name: m.filename, type: m.type,
              src: m.thumbnailUrl ?? m.sourceUrl, source_url: m.sourceUrl, format_size: "", attachment_program: [],
              attachment_program_detail: [], disdelete: false, thumbnailSize: { width: "200", height: "150" },
              fullSize: { width: m.width, height: m.height },
              videoSize: m.type === "video" ? { width: m.width, height: m.height } : undefined,
              length: m.durationSeconds * 1000, durationInSecond: m.durationSeconds, playLength: secondsToHms(m.durationSeconds),
              mshare: [], mfolder: null, duration: null, aws: {}, IsSchedule: 0, shareWithMe: false,
              Trigger: { Type: "lightStrip", Value: "0" }, customTags: [], source: "MEDIA.WEB",
              video_thumbnail_jpg: m.thumbnailUrl, hover: idx === 0, Duration: m.durationSeconds * 1000,
              isShowAspectBtn: false, ReserveAS: 0, playTime: m.durationSeconds, PlayTimes: "1",
              inEffect: { Name: "No Effect", Type: 0, Time: 1500, webTime: 1.5 },
            })),
            badge: String(items.length),
            icon: "perm_media",
          },
        ],
      },
    ],
  };
}

export async function rawCreateProgram(title: string, items: ProgramMediaItem[], author: string) {
  const res = await clRequest<{ id: number; title_raw?: string; vsn_name?: string }>("POST", "/wp-json/wp/v2/programs", {
    title,
    Terminalgroup: [],
    program_info: buildProgramInfo(title, items, author),
    Programs: buildVsnPrograms(items),
    status: "publish",
  });
  return { id: res.data.id, name: res.data.title_raw ?? title, vsn: res.data.vsn_name ?? null };
}

/** Publish payload: always an explicit terminal list with `all: false`. */
export function publishPayload(groupId: number, terminalIds: number[]) {
  return {
    what: "assign_program_to_terminal_group",
    to: { terminals_groups: [{ all: false, id: groupId, terminals: terminalIds }] },
  };
}

export async function rawPublishProgram(programId: number, payload: Record<string, unknown>) {
  return clRequest<unknown>("PUT", `/wp-json/wp/v2/programs/${programId}?flag=terminalgroup`, payload);
}

// ── Media upload (TUS resumable) ──────────────────────────────────────────────

export async function rawUploadMedia(file: Buffer, filename: string, mimeType: string, title: string) {
  const md5 = createHash("md5").update(file).digest("base64");
  // 1. Already on Colorlight? (dedupe by checksum)
  const found = await clRequest<unknown>("GET", "/wp-content/uploads/TusFileSearchByChecksum", undefined, {
    headers: { "Upload-Checksum": `md5 ${md5}` },
  }).catch(() => null);
  let uri = found?.headers.get("location") ?? null;
  // 2. Create + upload in 5 MB chunks
  if (!uri) {
    const meta = [
      `filename ${Buffer.from(filename).toString("base64")}`,
      `filetype ${Buffer.from(mimeType).toString("base64")}`,
    ].join(",");
    const created = await clRequest<unknown>("POST", "/wp-content/uploads/Tus/files", undefined, {
      headers: { "Tus-Resumable": "1.0.0", "Upload-Length": String(file.length), "Upload-Metadata": meta },
    });
    uri = created.headers.get("location");
    if (!uri) throw new Error("Colorlight did not return an upload location");
    const path = new URL(uri, "http://x").pathname;
    const CHUNK = 5 * 1024 * 1024;
    for (let off = 0; off < file.length; off += CHUNK) {
      await clRequest<unknown>("PATCH", path, file.subarray(off, off + CHUNK), {
        timeoutMs: 120000,
        headers: { "Tus-Resumable": "1.0.0", "Upload-Offset": String(off), "content-type": "application/offset+octet-stream" },
      });
    }
  }
  // 3. Register as a media item
  const uploadURI = uri.replace(/^.*\/Tus\//, "").replace(/\?.*$/, "");
  const res = await clRequest<{ id: number; source_url?: string; name?: string; video_thumbnail_jpg?: string }>(
    "POST",
    `/wp-json/wp/v2/media?title=${encodeURIComponent(title)}`,
    (() => {
      const form = new FormData();
      form.append("uploadURI", uploadURI);
      return form;
    })(),
    { timeoutMs: 120000 },
  );
  return res.data;
}

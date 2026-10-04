// Reads a chosen ad file in the browser (size, shape, length) and makes a
// thumbnail, so the check happens before anything is uploaded.

import { CREATIVE_TYPES, checkCreativeFile, creativeTypeOf, type CreativeCheck, type CreativeFileFacts } from "@digilite/shared";

export interface ProbeResult {
  facts: CreativeFileFacts;
  check: CreativeCheck;
  /** JPEG thumbnail made from the file (a frame for videos) */
  thumb: Blob | null;
  /** Object URL of `thumb`, for showing it straight away */
  thumbUrl: string | null;
}

const THUMB_W = 320;

function frameToBlob(source: CanvasImageSource, w: number, h: number): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = THUMB_W;
  canvas.height = Math.max(1, Math.round((THUMB_W * h) / Math.max(1, w)));
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.86));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function probeVideo(url: string): Promise<{ width: number; height: number; durationS: number; thumb: Blob | null }> {
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("unreadable"));
    }),
    20000,
  );
  const width = video.videoWidth;
  const height = video.videoHeight;
  const durationS = Number.isFinite(video.duration) ? video.duration : 0;
  let thumb: Blob | null = null;
  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve();
        video.onerror = () => reject(new Error("seek"));
        video.currentTime = Math.min(1, durationS / 3 || 0);
      }),
      8000,
    );
    if (width && height) thumb = await frameToBlob(video, width, height);
  } catch {
    thumb = null; // the check still stands without a picture
  }
  video.removeAttribute("src");
  video.load();
  return { width, height, durationS, thumb };
}

async function probeImage(url: string): Promise<{ width: number; height: number; thumb: Blob | null }> {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await withTimeout(
    new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("unreadable"));
    }),
    15000,
  );
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  return { width, height, thumb: width && height ? await frameToBlob(img, width, height) : null };
}

export async function probeFile(file: File): Promise<ProbeResult> {
  const type = creativeTypeOf(file.type, file.name);
  const facts: CreativeFileFacts = { filename: file.name, mime: type ?? file.type, sizeBytes: file.size, width: null, height: null, durationS: null };
  let thumb: Blob | null = null;
  if (type) {
    const url = URL.createObjectURL(file);
    try {
      if (CREATIVE_TYPES[type].media === "video") {
        const v = await probeVideo(url);
        facts.width = v.width || null;
        facts.height = v.height || null;
        facts.durationS = v.durationS || null;
        thumb = v.thumb;
        if (!v.width || !v.height) facts.unreadable = true;
      } else {
        const i = await probeImage(url);
        facts.width = i.width || null;
        facts.height = i.height || null;
        thumb = i.thumb;
      }
    } catch {
      facts.unreadable = true;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return { facts, check: checkCreativeFile(facts), thumb, thumbUrl: thumb ? URL.createObjectURL(thumb) : null };
}

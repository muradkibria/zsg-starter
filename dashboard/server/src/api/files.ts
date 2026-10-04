// Stream PocketBase files through the API (PocketBase itself is never exposed).

import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import type { Response } from "express";
import { pb } from "../pb";
import { HttpError } from "./http";

let fileToken: { at: number; token: string } | null = null;

async function token() {
  if (fileToken && Date.now() - fileToken.at < 60000) return fileToken.token;
  fileToken = { at: Date.now(), token: await pb.files.getToken() };
  return fileToken.token;
}

const PASS_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"];

/** `attachment; filename="…"` with a UTF-8 fallback for names like "Zoë's licence.pdf". */
function disposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Stream a stored file to the browser.
 * - `range`: the request's Range header, so video can seek (Safari needs this to play at all).
 * - `cacheSeconds: 0`: never cached (rider documents and other personal files).
 */
export async function pipeFile(
  res: Response,
  collection: string,
  recordId: string,
  filename: string,
  opts: { download?: string; thumb?: string; cacheSeconds?: number; range?: string } = {},
) {
  if (!filename) throw new HttpError(404, "File not found");
  const url = new URL(`${pb.baseURL}/api/files/${collection}/${recordId}/${encodeURIComponent(filename)}`);
  url.searchParams.set("token", await token());
  if (opts.thumb) url.searchParams.set("thumb", opts.thumb);
  const headers: Record<string, string> = {};
  if (opts.range && !opts.thumb) headers.range = opts.range;
  const upstream = await fetch(url, { headers });

  if (upstream.status === 416) {
    res.status(416).setHeader("Content-Range", upstream.headers.get("content-range") ?? "bytes */*");
    return void res.end();
  }
  if (!upstream.ok || !upstream.body) throw new HttpError(404, "File not found");

  res.status(upstream.status);
  for (const h of PASS_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  if (!res.getHeader("content-type")) res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Cache-Control", opts.cacheSeconds === 0 ? "private, no-store" : `private, max-age=${opts.cacheSeconds ?? 300}`);
  if (opts.download) res.setHeader("Content-Disposition", disposition(opts.download));

  const body = Readable.fromWeb(upstream.body as unknown as WebReadableStream<Uint8Array>);
  try {
    await pipeline(body, res);
  } catch (err) {
    // The browser went away mid-file (seeking a video does this all the time).
    if (!res.headersSent) throw err;
  }
}

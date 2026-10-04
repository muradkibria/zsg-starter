#!/usr/bin/env node
// Runs PocketBase locally the same way the image does: the binary sits in the
// repo's pocketbase/ directory (beside dashboard/), so its data (pb_data), hooks
// (pb_hooks) and migrations (pb_migrations) are the folders beside it. The binary
// is downloaded for this platform on first use and is gitignored.
//
//   node scripts/pocketbase.mjs serve                          start it on POCKETBASE_URL's host:port
//                                                              (nothing to start when that's a deployed one)
//   node scripts/pocketbase.mjs superuser upsert EMAIL PASSWORD
//   node scripts/pocketbase.mjs <any other pocketbase command>

import { spawn, execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Keep in step with PB_VERSION in ../pocketbase/Dockerfile.
export const PB_VERSION = "0.40.4";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
/** The repo's pocketbase/ directory, beside dashboard/. */
export const pbDir = join(root, "..", "pocketbase");
const binary = join(pbDir, process.platform === "win32" ? "pocketbase.exe" : "pocketbase");

function platformAsset() {
  const os = { darwin: "darwin", linux: "linux", win32: "windows" }[process.platform];
  const arch = { arm64: "arm64", x64: "amd64" }[process.arch];
  if (!os || !arch) throw new Error(`Unsupported platform ${process.platform}/${process.arch}`);
  return `pocketbase_${PB_VERSION}_${os}_${arch}.zip`;
}

export async function ensureBinary() {
  if (existsSync(binary)) return binary;
  const asset = platformAsset();
  const url = `https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/${asset}`;
  console.log(`[pocketbase] downloading ${asset}…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  const zipPath = join(pbDir, asset);
  await writeFile(zipPath, Buffer.from(await res.arrayBuffer()));
  execFileSync("unzip", ["-o", "-q", zipPath, process.platform === "win32" ? "pocketbase.exe" : "pocketbase", "-d", pbDir]);
  rmSync(zipPath);
  return binary;
}

/** POCKETBASE_URL (environment first, then the repo's .env). */
export function pocketbaseUrl() {
  let url = process.env.POCKETBASE_URL;
  if (!url) {
    try {
      url = readFileSync(join(root, "..", ".env"), "utf8").match(/^POCKETBASE_URL=(.+)$/m)?.[1]?.trim();
    } catch {
      // no .env yet
    }
  }
  return new URL(url || "http://127.0.0.1:8190");
}

/** host:port from POCKETBASE_URL. */
export function pocketbaseHost() {
  return pocketbaseUrl().host;
}

/** Whether POCKETBASE_URL is this machine, rather than a deployed PocketBase. */
export function isLocalPocketBase() {
  return ["127.0.0.1", "localhost", "[::1]", "0.0.0.0"].includes(pocketbaseUrl().hostname);
}

/** Run a PocketBase command. `serve` never writes migration files: the schema is pocketbase/scripts/setup-schema.js. */
export async function runPocketBase(args, opts = {}) {
  if (args[0] === "serve" && !isLocalPocketBase()) {
    console.log(`[pocketbase] POCKETBASE_URL is ${pocketbaseUrl().origin}, not this machine: using that one, no local database`);
    return;
  }
  const bin = await ensureBinary();
  const full = [...args];
  if (args[0] === "serve") {
    if (!full.some((a) => a.startsWith("--http"))) full.push(`--http=${pocketbaseHost()}`);
    full.push("--automigrate=false");
  }
  return new Promise((resolve, reject) => {
    const child = spawn(bin, full, { stdio: opts.stdio ?? "inherit", cwd: pbDir });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`pocketbase ${args[0]} exited with ${code}`))));
    child.on("error", reject);
    opts.onSpawn?.(child);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPocketBase(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

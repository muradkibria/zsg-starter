// ─────────────────────────────────────────────────────────────────────────────
// Playlist endpoints — CRUD plus deploy/unassign.
//
// Deploy assembles all the playlist's items into a single Colorlight VSN
// program and pushes it to the selected bag(s). Per the safety gate this
// is a no-op against real Colorlight when COLORLIGHT_WRITES_ENABLED is false
// (we still log + record locally so the UX flow works end-to-end in dev).
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from "express";
import {
  listPlaylists,
  getPlaylist,
  getPlaylistByBagId,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  recordDeployment,
  unassignFromBag,
  playlistsUsingMedia,
  type PlaylistItem,
} from "./playlist-store.js";
import {
  writesEnabled,
  isTestBagMode,
  getTestBagAllowlist,
  canWriteToBag,
  BagWriteBlockedError,
  createProgram,
  assignProgramToTerminals,
  listTerminals,
  type ProgramMediaItem,
} from "../colorlight/client.js";
import { getDevUpload } from "./dev-upload-store.js";

const router = Router();

// ── CRUD ─────────────────────────────────────────────────────────────────────

router.get("/playlists", (_req, res) => res.json(listPlaylists()));

router.get("/playlists/:id", (req, res) => {
  const p = getPlaylist(req.params.id);
  if (!p) { res.status(404).json({ error: "Playlist not found" }); return; }
  res.json(p);
});

router.post("/playlists", (req, res) => {
  const { name, items } = req.body ?? {};
  if (!name || typeof name !== "string" || name.trim() === "") {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: "Playlist must have at least one item" });
    return;
  }
  const validated = validateItems(items);
  if (typeof validated === "string") {
    res.status(400).json({ error: validated });
    return;
  }
  const playlist = createPlaylist({ name: name.trim(), items: validated });
  res.status(201).json(playlist);
});

router.put("/playlists/:id", (req, res) => {
  const { name, items } = req.body ?? {};
  const update: { name?: string; items?: PlaylistItem[] } = {};
  if (name !== undefined) {
    if (typeof name !== "string" || name.trim() === "") {
      res.status(400).json({ error: "name must be a non-empty string" });
      return;
    }
    update.name = name.trim();
  }
  if (items !== undefined) {
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "Playlist must have at least one item" });
      return;
    }
    const validated = validateItems(items);
    if (typeof validated === "string") {
      res.status(400).json({ error: validated });
      return;
    }
    update.items = validated;
  }
  const updated = updatePlaylist(req.params.id, update);
  if (!updated) { res.status(404).json({ error: "Playlist not found" }); return; }
  res.json(updated);
});

router.delete("/playlists/:id", (req, res) => {
  const p = getPlaylist(req.params.id);
  if (!p) { res.status(404).json({ error: "Playlist not found" }); return; }
  if (p.deployed_to.length > 0) {
    res.status(409).json({
      error: "Cannot delete a playlist that's deployed to bags",
      detail: `Currently on ${p.deployed_to.length} bag(s). Unassign first.`,
      bags: p.deployed_to.map((d) => d.bag_id),
    });
    return;
  }
  const ok = deletePlaylist(req.params.id);
  if (!ok) { res.status(404).json({ error: "Playlist not found" }); return; }
  res.json({ success: true });
});

// ── Deploy / unassign ────────────────────────────────────────────────────────

router.post("/playlists/:id/deploy", async (req, res, next) => {
  try {
    const playlist = getPlaylist(req.params.id);
    if (!playlist) { res.status(404).json({ error: "Playlist not found" }); return; }
    if (playlist.items.length === 0) {
      res.status(400).json({ error: "Playlist is empty" });
      return;
    }

    const bagIds: string[] = Array.isArray(req.body?.bagIds) ? req.body.bagIds : [];
    if (bagIds.length === 0) {
      res.status(400).json({ error: "No bags selected" });
      return;
    }

    // Resolve playlist items into ProgramMediaItem objects suitable for the
    // Colorlight VSN program structure. Resolution differs by source:
    //   - Numeric media_id  → Colorlight live media (use cached source_url)
    //   - "dev_*" media_id  → dev-upload-store entry, only valid in dry-run mode
    const programItems: ProgramMediaItem[] = [];
    for (const item of playlist.items) {
      if (item.media_id.startsWith("dev_")) {
        const dev = getDevUpload(item.media_id);
        if (!dev) {
          res.status(400).json({
            error: `Dev upload "${item.filename}" no longer exists in the queue. Re-add it to the playlist.`,
          });
          return;
        }
        if (writesEnabled()) {
          // Dev uploads can't be deployed live — they were never sent to Colorlight
          res.status(400).json({
            error: `Item "${item.filename}" is a dev-only upload — it was never sent to Colorlight. ` +
              `Either remove it from the playlist or re-upload via the Media page in live mode.`,
          });
          return;
        }
        programItems.push({
          fileID: -1,
          filename: dev.filename,
          source_url: `dryrun://dev/${dev.id}`,
          file_type: item.file_type,
          type: item.file_type === "image" ? "image" : "video",
          duration_seconds: item.duration_seconds,
          width: dev.width,
          height: dev.height,
        });
      } else {
        // Live Colorlight media
        programItems.push({
          fileID: Number(item.media_id),
          filename: item.filename,
          source_url: item.source_url ?? "",
          thumbnail_url: item.thumbnail_url,
          file_type: item.file_type === "image" ? "jpg" : "mp4",
          type: item.file_type === "image" ? "image" : "video",
          duration_seconds: item.duration_seconds,
          width: 160,
          height: 120,
        });
      }
    }

    // Determine the terminal group id. We pick the first terminal's group
    // (typical setup: one tenant = one group containing all bags).
    let terminalGroupId = 0;
    try {
      const terminals = await listTerminals();
      terminalGroupId = terminals[0]?.terminalgroup?.[0]?.id ?? 0;
    } catch (err) {
      if (writesEnabled()) {
        next(err);
        return;
      }
    }

    // Pre-flight allowlist check — in test-bag mode, deploys must target only
    // bags in COLORLIGHT_TEST_BAG_IDS. Reject the whole batch if any bag is
    // out of bounds, so we don't get partial deploys.
    if (isTestBagMode()) {
      const blocked = bagIds.filter((b) => !canWriteToBag(b));
      if (blocked.length > 0) {
        res.status(403).json({
          error: "Some target bags aren't in the test-bag allowlist",
          detail:
            `You're in TEST-BAG mode (COLORLIGHT_TEST_BAG_IDS is set). ` +
            `Deploys must target only those bags. Remove the blocked bags from your selection, or unset ` +
            `COLORLIGHT_TEST_BAG_IDS once you're ready for fleet-wide writes.`,
          blocked,
          allowed: getTestBagAllowlist(),
        });
        return;
      }
    }

    // Create or re-create the program
    const program = await createProgram(playlist.name, programItems);

    // Assign to bags
    const numericBagIds = bagIds.map((b) => Number(b)).filter((n) => Number.isFinite(n));
    try {
      await assignProgramToTerminals(program.id, terminalGroupId, numericBagIds);
    } catch (err) {
      if (err instanceof BagWriteBlockedError) {
        // Defensive — should have been caught by the pre-flight check above
        res.status(403).json({
          error: err.message,
          blocked: err.blocked,
          allowed: err.allowed,
        });
        return;
      }
      throw err;
    }

    // Record deployment locally
    const deployments = bagIds.map((b) => ({
      bag_id: b,
      program_id: program.id,
      program_name: playlist.name,
      dry_run: !writesEnabled(),
    }));
    const updated = recordDeployment(playlist.id, deployments);

    res.json({
      playlistId: playlist.id,
      programId: program.id,
      programName: playlist.name,
      bagIds,
      itemCount: playlist.items.length,
      dryRun: !writesEnabled(),
      message: writesEnabled()
        ? `Playlist "${playlist.name}" deployed to ${bagIds.length} bag(s) (program #${program.id})`
        : `DRY RUN — would have deployed playlist "${playlist.name}" (${playlist.items.length} items) to ${bagIds.length} bag(s). No actual changes made.`,
      playlist: updated,
    });
  } catch (err: any) {
    // Don't fall through to Express's HTML default — surface upstream details
    const upstreamStatus = err?.response?.status;
    const upstreamBody = err?.response?.data;
    console.error("[playlist-deploy]", `upstream=${upstreamStatus}`, "msg:", err?.message,
      "body:", typeof upstreamBody === "string"
        ? upstreamBody.slice(0, 500)
        : JSON.stringify(upstreamBody)?.slice(0, 500));
    res.status(502).json({
      error: "Deploy failed talking to Colorlight",
      detail: err?.message ?? String(err),
      upstreamStatus: upstreamStatus ?? null,
      upstreamBody: typeof upstreamBody === "string" ? upstreamBody : upstreamBody ?? null,
    });
  }
});

router.post("/playlists/:id/unassign", (req, res) => {
  const bagId = req.body?.bagId;
  if (!bagId) { res.status(400).json({ error: "bagId is required" }); return; }
  const updated = unassignFromBag(req.params.id, String(bagId));
  if (!updated) { res.status(404).json({ error: "Playlist not found" }); return; }
  res.json({
    success: true,
    dryRun: !writesEnabled(),
    message: writesEnabled()
      ? `Unassigned from bag ${bagId} (note: this only updates the CMS — the bag may still be playing the last-pushed program until you push something else).`
      : `DRY RUN — unassigned from bag ${bagId} in CMS only.`,
    playlist: updated,
  });
});

// ── Bag → currently-deployed playlist ────────────────────────────────────────

router.get("/bags/:bagId/playlist", (req, res) => {
  const playlist = getPlaylistByBagId(req.params.bagId);
  if (!playlist) { res.status(404).json({ error: "No playlist deployed to this bag from CMS" }); return; }
  res.json(playlist);
});

// ── Media usage check (used by Media page to block deletes) ──────────────────

router.get("/media/:id/playlists", (req, res) => {
  const playlists = playlistsUsingMedia(req.params.id);
  res.json(playlists.map((p) => ({ id: p.id, name: p.name, item_count: p.items.length })));
});

// ── Validation ───────────────────────────────────────────────────────────────

function validateItems(items: any[]): PlaylistItem[] | string {
  const out: PlaylistItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item.media_id !== "string" || !item.media_id) {
      return `Item ${i + 1}: media_id is required`;
    }
    if (typeof item.filename !== "string") return `Item ${i + 1}: filename is required`;
    const dur = Number(item.duration_seconds);
    if (!Number.isFinite(dur) || dur <= 0) return `Item ${i + 1}: duration_seconds must be a positive number`;
    out.push({
      media_id: item.media_id,
      filename: item.filename,
      file_type: item.file_type ?? "video",
      duration_seconds: Math.round(dur),
      source_url: item.source_url,
      thumbnail_url: item.thumbnail_url,
      fileID: typeof item.fileID === "number" ? item.fileID : undefined,
    });
  }
  return out;
}

export { router as playlistRouter };

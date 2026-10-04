---
name: architecture-notes
description: Technical approach agreed for the rebuild — map rendering at scale, data flow from Colorlight, aggregation
updated: 2026-10-04
---

**Map at scale**
- Render with a WebGL vector map (e.g. MapLibre GL) on vector tiles.
- Bags are one GeoJSON source drawn as GPU layers, not individual HTML markers, so thousands cost the same as 42.
- Built-in clustering at low zoom: count bubbles split by status.
- Only the selected bag's callout is an HTML element.

**Data flow**
- A single server-side worker polls Colorlight: one fleet-wide `/leds` call plus GPS and track queries.
- It writes into our own database: time-series GPS, play counts in fine time windows, and device status.
- Browsers never call Colorlight. They read from our API and get live position deltas over a websocket, throttled to about 1/s.
- This removes the prototype's per-browser, per-bag fan-out to Colorlight.

**Send summaries, not raw data**
- Fleet coverage: a fixed hex grid computed server-side, so its cost doesn't grow with the fleet.
- Zone time: precomputed per bag, per zone, per day.
- Routes: simplified per zoom level. Full-resolution points only for the selected bag.

**Days and time**
- All day grouping uses Europe/London.
- Colorlight `serverTime` is UTC without a "Z"; normalise it on ingest.

Related: [[colorlight-api]], [[domain-model]].

**As built (dashboard/, 2026-09-29):** the design above is implemented.
- Map: MapLibre 6 + OpenFreeMap vector tiles (Positron) recoloured to the Ledger palette. Bags are drawn as GPU symbol layers, with canvas-drawn status icons in colour and shape.
- Live updates: SSE on `/api/live`, fed by the Colorlight sync's event bus.
- MapLibre 6 needs its worker served from `/maplibre/` (a Vite plugin copies it there). Its CSS sets `.maplibregl-map { position: relative }`, so position the map container with an inline style.
- Vitest 5 ignores `test.env`; set test env vars in `server/test/setup-env.ts`.

**Source of truth (decided 2026-10-02)**
- PocketBase is DigiLite Hub's record (source of truth) and keeps everything permanently; there are no retention periods.
- Colorlight is the data source, the only one for now, and is treated as a first-class part of the system (direction given 2026-10-02): a top-level server module `server/src/colorlight/` with `client.ts` (reads), `gate.ts` + `writes.ts` (gated changes to bags) and `sync/` (pulls updates on timers and records them). Its ids are first-class fields on our records, its connection status is shown app-wide (map header, sidebar, More page), and there's no generic "data source" abstraction until a second source exists. Our own background work (bag-day rollups, saved progress) is `server/src/jobs/`.
- Updates never erase what we hold: a loop changed in Colorlight's editor becomes a new loop record (`planProgramRecord`), the previous one archived; an ad whose file changed becomes a new creative, the old one archived.
- History import (`colorlight/sync/history.ts`): after the recent days, the sync works back through what Colorlight still holds (about 3 months of GPS, 6 of plays; [[colorlight-api]]), oldest first because that's what is dropped next, in 30-day stretches skipped cheaply when nothing played. Progress is saved per bag; it resumes after a restart.
- Nothing cascades onto history, and a PocketBase hook (`pocketbase/pb_hooks/keep-history.pb.js`) refuses deletes of GPS points, plays, bag days, screenshots, commands, deployments, the audit log and pay periods.

**PocketBase setup**
- `pocketbase/` (repo root, beside `dashboard/`, with its own `package.json`/`node_modules`) is a deployable service: `Dockerfile` (release unzipped to `/pb`, hooks baked in, superuser upserted from `POCKETBASE_EMAIL`/`POCKETBASE_PASSWORD` at boot, persistent volume at `/pb/pb_data`), `pb_hooks/`, an empty `pb_migrations/`, and `scripts/setup-schema.js`.
- The schema is that script, not migrations: idempotent, keeps field ids (so data stays), refuses to drop a field without `--allow-drop`, seeds settings/zones/owner once. It's run from `pocketbase/` (`npm run setup`, or `npm run setup:schema` from `dashboard/`) against an instance before deploying code that needs new fields; the API refuses to start against a schema missing fields it needs (`checkSchema` in `server/src/pb.ts`).
- Locally the binary sits in `pocketbase/` so data, hooks and migrations are beside it, as in the image; it runs with `--automigrate=false` so schema changes never write migration files.
- Environment: see **Environment** below.
- Setting the superuser password (the container does it at every boot; `npm run setup` does it too) revokes all existing superuser tokens. `server/src/pb.ts` signs in again when refused and resends once; without that the API was locked out until restarted.
- Backups: daily at 03:30 (keep 3) unless a schedule exists; point them at S3 so a copy lives off the volume.

**Environment (decided 2026-10-04: as few variables as possible, shared by everything)**
- One `.env` at the repo root, template `.env.example` beside it, shared by `pocketbase/` (container boot + `scripts/setup-schema.js`) and `dashboard/` (server npm scripts use `--env-file-if-exists=../../.env`; `scripts/*.mjs` read `../.env`). Values already in the environment win over the file.
- Five required: `POCKETBASE_URL`, `POCKETBASE_EMAIL`, `POCKETBASE_PASSWORD`, `COLORLIGHT_USERNAME`, `COLORLIGHT_PASSWORD`. Everything else defaults in `server/src/config.ts` and sits commented out in the template (`COLORLIGHT_WRITES`, test bag ids, sync days, `SESSION_SECRET`, `API_PORT`/`API_HOST`, `COLORLIGHT_API_BASE`).
- Retired: `OWNER_EMAIL`/`OWNER_PASSWORD`/`OWNER_NAME` (the schema script seeds the first owner and prints their sign-in code), `COOKIE_SECURE` (Secure whenever the request is HTTPS; `trust proxy` is on), and `SESSION_SECRET` as a required value (HKDF of `POCKETBASE_PASSWORD` unless set, so rotating that password signs everyone out of the dashboard). `npm run setup` drops retired keys and moved the old `dashboard/.env` up.
- `scripts/qa.mjs` mints its own session for the first active owner (same key derivation), so QA needs no sign-in code.
- Hosting: the same five as shared variables on both services; `PORT` stays per service (the API falls back to it).
- A deployed `POCKETBASE_URL` in `.env` (not 127.0.0.1/localhost): `scripts/pocketbase.mjs serve` starts nothing, so `npm run dev` runs against it (sync included unless `SYNC_ENABLED=false`), and `npm run setup` applies the schema there without touching a local binary.

**Integration pass (2026-09-29)**
- **Loops ↔ bags by file name.** Programs carry `vsn_name`; bags report the same name as playing. The sync stores `loops.colorlight_vsn` and `bags.playing_loop` (`domain/playing.ts`). Same-named loops ("MTF" ×2) stay apart; a bag on an old copy of the fleet loop is flagged "Playing an older copy".
- **Loop slots.** Imports keep order, repeats and each slot's length (`programSlots`). An ad can fill several slots, so plays per slot differ; "June 26" is 6 slots, 1 min 3 s.
- **Ad files are ours.** The media sync copies each ad file (≤ 100 MB, 250 MB per run) into PocketBase, so ads play in the dashboard without going to Colorlight. `pipeFile` streams with HTTP Range (needed by Safari) and sends personal files as `no-store`.
- **Late uploads (2026-10-04).** `colorlight/sync/reconcile.ts` compares each bag-day's GPS and play totals with Colorlight and re-reads only what grew (GPS from the same response; plays per 6-hour block, then per hour), after a bag reconnects from 30+ minutes away (20 min and 2 h later), every 2 hours for 2 days and daily for 14. Late GPS batches are placed just before their upload, one fix per GPS interval (`spreadLatePoints`), and days are read with an hour either side (`loadPlacedPoints`). That removed invented long shifts: 14–27 Sep shifts over 10 hours went from about 25 to 18. Approved pay periods report `changedSinceApproval`. `npm run recompute -w server` recomputes stored days (3,194 in 8 s).
- **Downtime is filled in (fixed 2026-10-04).** The regular sync used to fetch only bags reporting in the last 30 min (GPS) or 2 h (plays), and plays jumped ahead after 48 h, so anything a bag did while the server was down and before it went offline was never recorded. It's now driven by each bag's cursor up to its last report (`trackWindow`, `planPlayHours`), runs straight after a start, and the history import retries every 30 minutes and pauses when Colorlight stops answering. Found when a laptop sleep cut the network mid-import.
- **Restarts lose nothing.** The rollup's dirty-day list, the sync's last update times and the history import's progress are saved in `sync_state`. Reads to PocketBase retry once after a dropped connection; writes never retry.
- **Sessions.** The session cookie carries `users.session_version`; a new sign-in code bumps it, which signs that person out elsewhere.
- **Sign-in codes (decided 2026-10-04).** No passwords: everyone signs in with their own six-digit code (`users.login_code`: hidden, `^[0-9]{6}$`, unique via a partial index that ignores empty). The server makes codes at random (invite, "New code", "Get a new code"), shows them once and never logs them; nobody picks one, so codes can't be found by probing which are taken. Wrong guesses: 5 per address per 15 minutes and 50 an hour overall, then 429 (`domain/signin.ts` `SignInGate`, in memory). `users.authRule` is null: nobody can sign in to PocketBase as a dashboard user. A code set by hand in the admin page doesn't bump `session_version`. The web client's global 401 → "Please sign in" skips `/auth/login`, so a wrong code says why.
- **Web kit.** One overlay implementation (`components/overlay.tsx`) gives every sheet and dialog focus trapping, Escape and scroll locking. Phones get 44 px controls and 16 px inputs (no iOS zoom). Dates use `gbDateFormat` ("Sep", not "Sept").

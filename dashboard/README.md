# DigiLite Hub

The admin dashboard for DigiLite's LED bags: where every bag is, who's carrying it and what it's showing. It covers routes, rider records and pay, ads and loops, schedules and brightness, campaigns and client reports.

- **The map is home.** Toggle bags by status, pick one to see only its route, stops, signal gaps and zones.
- **The bag is the asset; riders are contractors.** Hours, routes and pay come from the bag's data within each rider's assignment dates.
- **Colorlight is the data source; PocketBase is the record.** Every bag's status, location, ad plays, ads and loops come from Colorlight, the only data source for now, and its sync is a core part of the server. The Hub records everything it receives in PocketBase and keeps it permanently, so every screen reads its own records through its own API, and they stand even if Colorlight later changes or drops something.
- **Changes to bags are gated.** They are dry runs by default, and only the test bag can receive real changes until the owner opens up the fleet.

## Quick start

```bash
cd dashboard
npm install
npm run setup      # creates the repo's .env, downloads PocketBase, applies the schema, seeds the owner login
npm run dev        # database :8190 · API :4000 · web app http://127.0.0.1:5173
```

Sign in with `POCKETBASE_EMAIL` / `POCKETBASE_PASSWORD` from the repo's `.env`: on a fresh install the first owner gets the PocketBase superuser's login. Change the owner's password in Settings once you're in (that doesn't change the superuser's).

On first start the Colorlight sync:
- adds every bag;
- records the last `SYNC_BACKFILL_DAYS` (default 14) of GPS routes and ad plays;
- records the ad library, including the ad files themselves (about 155 MB today), so ads play in the dashboard;
- then works back through everything older that Colorlight still holds, oldest first, back to `SYNC_HISTORY_DAYS` (default 200). Colorlight keeps only about 3 months of GPS and 6 months of plays and drops older data daily; the Hub keeps it for good. The import resumes after a restart;
- and from then on pulls updates every few seconds to minutes.

`npm run setup` copies the Colorlight login from `../simple-app/.env` if it exists; otherwise fill in `COLORLIGHT_USERNAME` / `COLORLIGHT_PASSWORD` in the repo's `.env`.

**One `.env` for the whole repo.** It sits at the repo root (`../.env`, template `../.env.example`) and is shared by PocketBase, its schema script and the dashboard. Five settings are needed: `POCKETBASE_URL`, `POCKETBASE_EMAIL`, `POCKETBASE_PASSWORD`, `COLORLIGHT_USERNAME`, `COLORLIGHT_PASSWORD`. Everything else has a default and is listed, commented out, in the template. The session-signing key is worked out from `POCKETBASE_PASSWORD` (so changing that password signs everyone out), unless `SESSION_SECRET` is set.

Optional sample data for walkthroughs: `npm run seed:demo` adds sample riders and campaigns, flagged as demo. `npm run seed:demo -- --remove` deletes them. **Don't run it once real riders have been entered.**

## Changes to bags (read this before switching anything on)

`COLORLIGHT_WRITES` (in the repo's `.env`, or the host's variables) controls whether the dashboard may change bags:

| Value | What happens |
|---|---|
| `off` (default) | Nothing is sent. Every change (brightness, restart, schedules, publishing a loop) is recorded as a dry run. |
| `test` | Changes may only go to the test bag(s) in `COLORLIGHT_TEST_BAG_IDS` (Bag 028, `5786440`). Anything else is blocked. |
| `fleet` | Changes may go to any bag, but **only while the owner has also switched on "Allow changes to the whole fleet"** in Settings. |

Rules the code enforces whatever the mode:
- Changes are always sent to an explicit list of bags, never to a whole Colorlight terminal group.
- Every attempt is stored (the `commands` / `deployments` collections) and written to the audit log.

## What's where

```
pocketbase/     (repo root) the database service: Dockerfile, hooks, schema setup script — see
                ../pocketbase/README.md. The binary, node_modules and pb_data/ are gitignored
dashboard/
  shared/       types, London-time + geo helpers, track analytics (shifts, stops, gaps, zones)
  server/       Express API (src/api), domain logic (src/domain), Colorlight (src/colorlight: client,
                write gate, and the sync that records its data), rollups and saved progress (src/jobs)
  web/          React app (src/pages per feature, src/components/ui.tsx design kit, MapLibre maps)
  scripts/      setup, database runner, visual QA (qa.mjs)
  docs/         DEVELOPING.md — architecture, rules and patterns for anyone working on the code
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Database + API (auto-reload) + web app (hot reload) |
| `npm run setup:schema` | Bring the database schema up to date (idempotent; add `-- --check` to preview) |
| `npm run recompute -w server` | Recompute every stored day's routes, hours and zone time from the recorded GPS and plays (`-- --days 31` for recent ones) |
| `npm test` | Unit tests (write gate, London days, track analytics, feature logic) |
| `npm run check` | Type-check shared, server and web |
| `npm run build` | Production build (web → `web/dist`, API → `server/dist`) |
| `npm start` | Run the production build: database + API, with the API also serving the web app on :4000 |
| `node scripts/qa.mjs [routes…]` | Sign in, screenshot every screen at desktop and phone sizes into `qa-screenshots/`, and report errors |

## Deploying

Two services, each with its own Dockerfile:

| service | Dockerfile | notes |
|---|---|---|
| PocketBase | `../pocketbase/Dockerfile` | **mount a persistent volume at `/pb/pb_data`**: it holds every record and file. The API reaches it over the private network; a public domain is only needed for its admin UI and the schema script. Details and the post-deploy check: [pocketbase/README.md](../pocketbase/README.md) |
| DigiLite Hub (API + web app) | `Dockerfile` | `POCKETBASE_URL` points at the service above; HTTPS in front (session cookies are marked Secure automatically). Apply the schema first (`cd pocketbase && npm run setup` against that instance); the API refuses to start against an older schema |

Both services take the same five variables, so set them once and share them (on Railway: Project Settings → Shared Variables, shared with both services). Only `PORT` is per service.

Back up PocketBase off the volume: data is kept permanently, so this matters (admin UI → Settings → Backups → S3).

## Data and privacy

- **Rider location is personal data.** Rider identity is linked to routes only for operations and payroll, behind role permissions.
- **Clients only see bag-level data.** Client reports hide rider names by default.
- **Rider documents** are protected files, streamed through the API to permitted roles only, and every view is logged.
- **Everything is kept permanently.** There are no retention periods. History (routes, plays, changes sent to bags, the audit log, pay periods) can't be deleted at all: the database refuses it.
- **Encryption at rest:** PocketBase files are not encrypted by default. For production, use an encrypted volume or S3 storage with server-side encryption (PocketBase admin → Settings → Files storage).

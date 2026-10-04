---
name: project-overview
description: What DigiLite is, what's in this repo, and the rebuild plan
updated: 2026-10-04
---

DigiLite runs digital out-of-home advertising on LED screens mounted on food-delivery riders' bags in London. The screens are Colorlight A20 players (160×120 px) managed through Colorlight Cloud.

**Repo layout**
- `simple-app/`: the first prototype (Express + React/Vite, Apr–May 2026). Treat it as a reference and spec, not a base to extend. See [[prototype-audit]].
- `dashboard/`: the rebuild ("DigiLite Hub"), started 2026-09-29. It is an npm-workspaces monorepo: `shared/` (types, London-time and geo helpers, track analytics), `server/` (Express API, Colorlight client/gate/sync, background jobs), and `web/` (React + Vite + Tailwind + MapLibre). The handbook is `dashboard/docs/DEVELOPING.md`.
- `pocketbase/`: the database service at the repo root (Dockerfile, hooks, schema setup script, its own package.json); see its README.
- `memory/`: these notes.
- `DL CMS Spec Doc.pdf`: the original V1 specification. See [[spec-analysis]].

**Rebuild plan:** a new admin dashboard ("DigiLite Hub") built from scratch. The prototype is the toolbox for:
- the Colorlight integration;
- GPS session and idle detection;
- the exposure model;
- TfL station data.

Direction and priorities: [[design-direction]], [[product-priorities]], [[domain-model]].

**Foundations as built (dashboard/):**
- **Stack:** PocketBase 0.40 is the database, file store and source of truth (kept permanently), with every collection locked to superuser. The Express API is the only client; it has its own session cookie and role checks. The web app talks only to our API.
- **Colorlight sync** (`server/src/colorlight/sync/`): Colorlight is the data source (the only one for now, first-class); the sync pulls status, live GPS, full tracks, plays, the ad library (files included), loops, screenshots and device schedules and records them in PocketBase, plus a one-off import of all the history Colorlight still holds. Daily rollups (`server/src/jobs/`) go into `bag_days`.
- **Writes** go only through `server/src/colorlight/writes.ts` → `gate.ts`: modes off/test/fleet, the test-bag allowlist, and no group-wide payloads. Covered by unit tests.
- **Local ports:** PocketBase on 8190 (8090 is used by another project on this machine), API on 4000, web on 5173.

**Build status (2026-09-29):** every area in the design is built and running on the real fleet's data: fleet map, bags, riders (documents, assignments, hand-overs), ads & loops (library, editor, publish), schedules (loop rules, sunrise/sunset brightness), payroll (fortnightly, review queue, approval, exports), exports (CSV/Excel/GPX/KML), campaigns and client reports, zones, settings, team and audit log. 241 server unit tests; visual QA clean on 40 screens (desktop and phone, dev and production builds). Changes to bags are still dry runs (see [[open-questions]]).

**Deployment (2026-10-04):** PocketBase runs on Railway at https://digilite-pocketbase.up.railway.app (built from `pocketbase/`). The local database was restored there the same day (PocketBase backup upload + restore; every collection's count matched, stored files included). It includes the walkthrough demo data (20 riders, 5 campaigns, flagged `demo`; `npm run seed:demo -- --remove` deletes it) and the local owner login, which needed changing there. The local sync was stopped at the restore. The API server (`dashboard/Dockerfile`) wasn't deployed yet: once it is, it carries on from the saved cursors (each bag's GPS gap is filled 3 days per run).

**Foundations originally agreed** (PocketBase replaced Postgres in the build):
- real logins with roles, plus an audit log;
- Postgres for business data;
- our own permanent record of GPS and play data (Colorlight keeps only about 3 months of GPS and 6 of plays);
- encrypted object storage for rider documents;
- Colorlight wrapped as its own module.

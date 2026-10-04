---
name: prototype-audit
description: What in simple-app/ is worth keeping, and what is broken or dead (audited 2026-09-29)
updated: 2026-09-29
---

**Keep (port or reuse the logic)**
- `server/colorlight/client.ts`:
  - login;
  - terminals, latest GPS, tracks, heatmap, play counts;
  - TUS upload and media registration;
  - VSN program builder;
  - assigning a program to bags;
  - the three-mode write safety gate (dry run, test bag, full).
- `server/colorlight/sessions.ts`:
  - shifts from GPS gaps (over 5 minutes = offline);
  - stopped-time detection (within 50 m for 15 minutes or more);
  - CSV export;
  - handles UTC timestamps that arrive without a "Z".
- `server/reports/exposure.ts` + `aggregator.ts`: the impression model (TfL station footfall within 250 m, time-of-day weights, 10% visibility, a street foot-traffic baseline, and attribution by airtime share).
- `server/store/tfl-station-coords.json` (461 stations) and the station-name normaliser in `tfl-store.ts`.
- The Claude report prompt in `server/reports/prompt.ts`.
- `tools/api-capture/`: a DevTools extension for capturing Colorlight web UI traffic.

**Broken or risky (do not carry over)**
- **No real authentication:** `/auth/login` issues a token for anything, and no route checks it.
- **Path traversal:** `GET /api/reports/..%2Friders` reads `data/riders.json`.
- **Rider documents** are stored as base64 inside a JSON file.
- **Persistence** is JSON files under `DATA_DIR`, lost on redeploy without a volume.
- **Route order:** `/reports/:id` shadows `/reports/ad-plays-breakdown`.
- **Rider sessions** use the rider's *current* bag for any date range, and days split at UTC midnight.
- **Every deploy creates a new Colorlight program**, and "unassign" only changes local records.
- **Scale problems:** requests fan out one per bag, rider or media item; `listTerminals` fetches a single page capped at 100; the GPS poller makes one request per bag every 10 s.
- **The impression model** double-counts bags near several stations, and the street baseline dominates the totals. Review it before showing figures to clients.
- **UI:** hooks are called after early returns (Reports), `SelectItem value=""` crashes (Audit), and the Zones, Brightness and Audit pages are stubs.
- **Dead code:** 19 unreachable files from an earlier PocketBase design (`server/routes/`, `services/`, `db/`, `middleware/`).
- **No tests.**

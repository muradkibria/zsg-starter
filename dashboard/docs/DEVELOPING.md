# Developing DigiLite Hub

The handbook for working on this codebase: architecture, rules, patterns and how to check your work.

## Architecture in one picture

```
Browser (web/, React)  ──►  Our API (server/, Express, :4000)  ──►  PocketBase (:8190): the record, kept permanently
                                         ▲
                     Colorlight sync (server/src/colorlight/sync/)  ◄──  Colorlight Cloud: the data source
                         pulls updates on timers, records them               (changes to bags go back through the gate)
```

- **Colorlight is the data source**, the only one for now, and a first-class part of the server (`server/src/colorlight/`): the client, the write gate and the sync. Every bag's status, location, ad plays, ads, loops, screenshots and device schedules come from it. Colorlight's own ids are first-class fields on our records (`bags.colorlight_id`, `loops.colorlight_program_id` and `colorlight_vsn`, `creatives.colorlight_media_id` and `colorlight_md5`). Don't wrap it in a generic "data source" layer until there's a second one.
- **PocketBase is the record, and keeps everything permanently.** The sync records what Colorlight sends; screens read those records through the API, never Colorlight itself, so they keep working (showing the last update) when Colorlight is slow or down. There are no retention periods. Every collection is locked to superuser access; the API is the only client and enforces roles.
- **Updates add to the record; they never erase it.** A loop changed in Colorlight's own editor arrives as a new loop record and the previous one is archived (`planProgramRecord`); an ad whose file changed becomes a new creative. Nothing is deleted because Colorlight dropped it.
- **Downtime is filled in.** The sync is driven by each bag's own cursor (`trackWindow`, `planPlayHours`), not by which bags are on right now, so when the server comes back after a restart, a deploy or a sleeping laptop, it records everything bags reported meanwhile, even for bags that have gone offline since. A start catches up GPS and plays straight away.
- **Late uploads are reconciled.** A bag without signal keeps working and uploads what it kept when it reconnects. Its GPS backlog (at most its last ~15 minutes, 30 fixes) arrives stamped with the upload time: the sync records it as new, and `spreadLatePoints` places it back in time just before the upload (spread across the gap only when the gap is short enough), with `loadPlacedPoints` reading either side of a day so a batch straddling midnight splits correctly. Plays are filed under the hour they were played, so past hours can grow: `colorlight/sync/reconcile.ts` compares each bag-day's GPS and play totals with Colorlight and re-reads only what grew, 20 minutes and 2 hours after a bag reconnects from 30+ minutes away, plus sweeps of the last 2 days (every 2 hours) and 14 days (daily). Repairs mark their days for recomputing, so routes, hours, pay drafts, zone time and campaign figures follow; an approved pay period keeps its frozen hours and shows what changed since (`changedSinceApproval`). After changing how tracks are analysed, run `npm run recompute -w server`.
- **History is imported, then kept.** Colorlight holds about 3 months of GPS and 6 months of plays and drops older data daily. After a start the sync records the last `SYNC_BACKFILL_DAYS`, then works back to `SYNC_HISTORY_DAYS` (`colorlight/sync/history.ts`, oldest first, resumable). It repeats every 30 minutes until every bag is complete, and pauses by itself if Colorlight stops answering.
- **History can't be deleted.** No relation cascades onto history, and `pb_hooks/keep-history.pb.js` (in the repo's `pocketbase/`) refuses deletes of GPS points, plays, bag days, screenshots, commands, deployments, the audit log and pay periods.
- **Loops are matched to bags by file name.** Colorlight names each program's file (`vsn_name`, e.g. "June 26_<md5>_7174.vsn") and bags report that exact name as playing. The sync stores it on `loops.colorlight_vsn` and resolves `bags.playing_loop` (`domain/playing.ts`), so same-named loops (there are two "MTF"s) never get mixed up. Imported loops keep Colorlight's order, repeats and slot lengths (`programSlots` in `colorlight/sync/content.ts`).
- **The browser only talks to our API.** It never calls Colorlight or PocketBase directly.
- **Changes to bags** go through `server/src/colorlight/writes.ts` → `gate.ts`. Nothing else may import `raw-writes.ts`.

## Rules that matter

1. **The bag is the asset.** All telemetry (GPS, plays, status, screenshots) belongs to a bag plus a time. Riders are contractors linked to bags by dated `assignments`. A rider's hours, routes and performance come from the bag's data between the assignment's start and end. Never re-attribute history when a bag changes hands. Helper: `activeAt(assignments, bagId, time)`.
2. **Days are London days** (Europe/London, BST-aware). Use `londonDayBounds(day)`, `londonDay(date)` and `addDays` from `@digilite/shared`. Never slice UTC ISO strings to get a day.
3. **Safety.** `COLORLIGHT_WRITES` is `off` (dry run), `test` or `fleet`.
   - Only Colorlight terminal `5786440` (Bag 028, the test bag) may receive changes in `test` mode.
   - `fleet` also requires the owner's "Allow changes to the whole fleet" switch.
   - Never send a terminal-group-wide change.
   - Record every attempted change (the `commands` / `deployments` collections) and write an audit entry.
4. **Measured vs estimated.** Measured figures (plays, time on screen, km, hours, zone time) are shown plainly. Anything modelled, such as reach or impressions, lives in an `EstimateBox`, is labelled "Estimated" and links to its method.
5. **Honest gaps.** Show signal gaps and missing data. Never fill them in or hide them.
6. **No placeholder features.** Don't ship a page or button that looks real but does nothing. If something isn't possible yet, say so plainly in the UI.
7. **Vocabulary.** Bag, rider, creative (an ad file), loop (an ordered set of creatives, a Colorlight "program"), schedule, campaign, zone. Never write "terminal" in the UI. Use British English and short, plain labels.
8. **Keep it lean.** When something checks out, say so in one line ("Checked · ready to add"). Show detail and warnings only when there's a real problem.
9. **Every date or period selector** offers presets and a custom range.
10. **Privacy.** Rider documents are protected files, streamed through the API with a permission check (`riders.documents`), and every view is audited. Never log personal data or credentials.

## Running locally

```bash
npm run setup         # once: the repo's .env, PocketBase, superuser, schema, owner's sign-in code
npm run dev           # PocketBase :8190 + API :4000 (auto-reload) + web :5173
npm run setup:schema  # after changing ../pocketbase/scripts/setup-schema.js
npm run seed:demo     # optional sample riders/campaigns (flagged demo; --remove to delete)
```

Sign in at http://127.0.0.1:5173 with your six-digit code (setup prints the first owner's). The PocketBase admin UI at http://127.0.0.1:8190/_/ takes `POCKETBASE_EMAIL` / `POCKETBASE_PASSWORD` from the repo's `.env`; a code can also be set there, on the person's `users` record (`login_code`).

With `POCKETBASE_URL` pointing at a deployed PocketBase instead, `npm run dev` and `npm start` use that one and start no local database, and `npm run setup` applies the schema there. The local server's Colorlight sync then writes to it too, so add `SYNC_ENABLED=false` while the deployed server is syncing.

**Settings.** There's one `.env`, at the repo root, shared by PocketBase, its schema script and the dashboard (the server's npm scripts load it with `--env-file-if-exists=../../.env`). Keep it to the five it needs today. A new setting gets a default in `server/src/config.ts` and a commented-out line in `../.env.example`, so nobody has to set it; and if it's a secret, consider deriving it from one that exists, as the session key is derived from `POCKETBASE_PASSWORD`.

## Server patterns (`server/src`)

- **Routes.** Each feature area has `api/areas/<area>.ts`, already mounted under `/api` and behind sign-in.

  ```ts
  r.get("/riders/:id", need("riders.view"), async (req, res) => {
    const rider = await getOneOrNull<RecordModel>("riders", param(req, "id"));
    if (!rider) throw notFound("Rider not found");
    res.json(toRiderDto(rider));
  });
  r.post("/riders", need("riders.edit"), async (req, res) => {
    const body = parse(schema, req.body);          // zod; 400 with a readable message on failure
    const rec = await pb.collection("riders").create({ ... });
    await audit(user(req), "rider.create", `Added rider ${rec.name}`, { type: "rider", id: rec.id });
    res.status(201).json(toRiderDto(rec));
  });
  ```

  Errors: throw `badRequest(msg)`, `notFound(msg)`, `forbidden()` or `new HttpError(status, msg)`. Messages are shown to users, so write them in plain English. Permissions are listed in `shared/src/status.ts` (`ROLE_PERMISSIONS`).
- **PocketBase helpers** (`pb.ts`):
  - `getAll(collection, {filter, sort, fields, expand})`, `getFirst`, `getOneOrNull`;
  - `q(value)` safely quotes a filter value; always use it;
  - `pbDate(date)` / `parsePbDate(str)`;
  - `stableId(key)` for idempotent upserts; `batchCreate` / `batchUpsert`.
- **Domain helpers** you can reuse (don't edit them; add your own module under `domain/<area>.ts`):
  - `domain/bags.ts`: `loadBags`, `bagById`, `fleetContext`, `toBagSummary`, `bagSummaries`.
  - `domain/assignments.ts`: `allAssignments`, `activeAt`, `currentRiderByBag`, `stintsForBag`, `assignmentsForRider`, `invalidateAssignments()` (call after changing assignments).
  - `domain/tracks.ts`:
    - `loadPoints(bagId, from, to)` and `buildRoute(bag, from, to, day)`, which returns a `RouteResponse`;
    - `bagDays(bagIds|null, fromDay, toDay)` returns `bag_days` records;
    - `toBagDayDto(record, bagName)` includes shifts with `riderId`/`riderName` attributed by assignment;
    - `computeBagDay(bag, day)` recomputes one day;
    - `recentTrails`.
  - `domain/zones.ts`: `listZones`, `activeZoneShapes`, `zoneNames`, `invalidateZones()`.
  - `domain/settings.ts`: `getSettings`, `updateSettings`, `analyticsConfig`.
  - `domain/commands.ts`: `runBagCommand` (gated).
  - `domain/audit.ts`: `audit(user, action, summary, entity?, meta?)`.
  - `colorlight/writes.ts`: `sendCommand`, `putTerminalSchedule`, `uploadMedia`, `createProgram`, `publishProgram`, `decideFor(ids)`, `accountWritesAllowed()`. Every call returns a gate decision: `send`, `dry_run` or `block`.
  - `jobs/state.ts`: `markDirty(bagId, day)`; `dirtyDays` is processed by the rollup job (`jobs/rollups.ts`) and saved, so a restart doesn't drop it. The Colorlight sync's last update times are saved too.
  - `domain/playing.ts`: `matchPlayingLoop(bag, loops)` and `playsOlderCopy(bag, loop)`.
  - `api/auth.ts`: `setCode(userId, code, keepSignedIn?)` gives someone a new sign-in code and ends their other sessions; `unusedCode()` makes a random one nobody has. Codes are made only by the server, never picked, so nobody can find someone else's by trying codes that are taken.
- **Files.** Uploads use multer with memory storage, then a `FormData` create/update to PocketBase. Serve files with `pipeFile(res, collection, recordId, filename, {download, cacheSeconds, range})`. It streams, uses a superuser file token and never exposes PocketBase URLs. Pass `range: req.headers.range` for video (Safari won't play without it) and `cacheSeconds: 0` for personal files (sent as `no-store`).
- **Contracts.** API request/response types for your area go in `shared/src/areas/<area>.ts` (exported from `@digilite/shared`). Core types (bags, routes, fleet, zones, settings) are in `shared/src/api.ts`.
- **Tests.** Pure logic gets a vitest file in `server/test/<area>.test.ts`. Run `npm test -w server`.

### Collections (see `../pocketbase/scripts/setup-schema.js` for every field)

The schema is that script, not a migration history (`pb_migrations/` is empty on purpose). To change it, edit the script and run `npm run setup:schema` (preview with `npm run setup:schema -- --check`). It's idempotent, keeps field ids so columns keep their data, and refuses to drop a field unless run with `--allow-drop`. When you add a field the server relies on, add it to `EXPECTED` in `server/src/pb.ts` too: the API refuses to start against an older schema rather than have PocketBase silently drop the new field on write. More in `../pocketbase/README.md`.

| Collection | What |
|---|---|
| `bags` | One per Colorlight terminal: device status, position, lifecycle (active / storage / repair / lost / retired) |
| `gps_points` | Every GPS point (bag, ts, seq, lat, lng, late) |
| `plays` | Plays per bag per UTC hour per creative (`media_md5` = `creatives.colorlight_md5`) |
| `bag_days` | Per bag per London day: shifts, stops, gaps, km, moving/stopped seconds, zone seconds, plays |
| `riders`, `rider_documents`, `assignments` | Contractors, their protected documents, and who carried which bag when |
| `zones` | Circle or polygon zones |
| `creatives`, `loops`, `deployments` | Ad files (recorded from Colorlight or uploaded), loops (one record per version), sends of loops to bags |
| `commands` | Every change sent (or dry-run/blocked) to a bag |
| `schedules` | Loop rules and brightness plans |
| `campaigns`, `payroll_periods` | Contracts, and approved pay periods |
| `app_settings` (key "main"), `audit_log`, `screenshots`, `sync_state` | Settings, audit trail, captured screens, saved progress of the Colorlight sync and jobs |

## Web patterns (`web/src`)

- **API.** `api.get/post/patch/put/del/upload` from `lib/api.ts` (`api.upload(path, form, {onProgress})` reports upload progress). Put your React Query hooks in `pages/<area>/api.ts`; core hooks are in `lib/queries.ts`. Invalidate the relevant query keys after mutations.
- **UI kit** (`components/ui.tsx`): `Page` (`width="narrow" | "wide"`; a max-w class can't override it), `PageHeader`, `Card`, `CardHeader`, `Button`, `LinkButton`, `Pill`, `Chip`, `StatusIcon`, `StatusLabel`, `Stat`, `EstimateBox`, `Field`, `Input`, `Select`, `Textarea`, `Switch`, `Segmented`, `Tabs`, `Spinner`, `EmptyState`, `ErrorState`, `Notice`, `Avatar`, `ScreenFrame` (`fit="contain"` for screens that aren't 4:3). Buttons, chips, inputs and tabs are 44 px tall on phones by themselves.
- **Overlays** (`components/overlay.tsx`): `Sheet` (a side panel on desktop, a bottom sheet on phones), `Dialog`, and `useOverlay` for a custom panel. They handle focus, Escape (topmost first), Tab trapping and scroll locking; mark the field to focus with `data-autofocus`. Feedback comes from `components/feedback.tsx`: `useFeedback()` returns `toast(text, tone)` and `confirm({title, body, confirm, danger})`. Never use `alert()` or `confirm()`.
- **Colorlight status** (`components/ColorlightStatus.tsx`): `ColorlightBadge` (the map header) and `ColorlightStatusRow` (sidebar, More page) show whether Colorlight is live and when the last update arrived. Use them where freshness matters.
- **Maps.** `components/route/RouteMap` (one route, with stops, gaps and zones), `components/route/RouteTimeline` (a day's timeline; pass a `useReplay(route)` to give it a playhead, and give the same replay to `RouteMap`'s `replay` prop, or `useReplayOnMap(map, replay)` on your own map, which draws it every frame), and `components/map/MapView` plus `map/layers.ts` for custom maps. Use sources and layers, not DOM markers. The one exception is the fleet map's ads (`map/adPins.ts`): a handful of HTML markers, only for bags out now and only when switched on, because they animate.
- **Formatting** (`lib/format.ts`): `time`, `dayLabel`, `longDay`, `date`, `shortDate`, `when`, `km`, `hours`, `pct`, `num`, `formatDuration`, `initials`, `shortName`. All times are London time. For your own date formats use `gbDateFormat(options)` from `@digilite/shared`, not `Intl.DateTimeFormat`: newer browsers write September as "Sept".
- **Permissions.** `const { can } = useAuth(); can("riders.edit")` hides actions the user can't take. The server enforces them too.
- **Design.** Ledger palette via Tailwind tokens:
  - surfaces and text: `bg-paper`, `bg-paper-2`, `text-ink`, `text-ink-2`, `text-muted`, `text-caption`;
  - brand: `bg-navy`, `text-accent`;
  - lines: `border-rule`, `border-line`;
  - status: `*-amber-ink/bg/line`, `*-red-*`, `*-green-*`, `*-info-*`;
  - bag status: `st-now/day/idle/gone`.
  - Headings use `font-display` (Outfit); body text is Plus Jakarta Sans.
  - Cards: `card` class or `<Card>`. Numbers: `num` class (tabular).
- **Mobile.** Every screen must work at 390 px wide. Stack columns, and let tables become lists or scroll horizontally inside a card. The app shell adds a bottom tab bar; leave `pb-20` space (already on `<main>`). Touch targets are at least 44 px.
- **Accessibility.** Use real `<button>`, `<a>` and `<label>`, and give icon-only buttons an `aria-label`. Never convey status by colour alone (pair it with a shape, icon or text).

## Checking your work

```bash
cd server && npx tsc --noEmit -p .      # server types
cd web && npx tsc --noEmit -p .         # web types
npm test -w server                      # unit tests
node scripts/qa.mjs /your-route         # signs in, full-length screenshots (desktop + phone) into qa-screenshots/, reports console/API errors
node scripts/qa.mjs                     # every screen plus one real bag, rider, loop, campaign and report page
```

Always open the screenshots and look at them: check layout, overflow and empty states on both desktop and phone.

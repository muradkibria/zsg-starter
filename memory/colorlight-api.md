---
name: colorlight-api
description: Colorlight Cloud official API — docs, auth, the endpoints we rely on, and caveats
updated: 2026-10-04
---

**Docs:** https://developer.colorlightcloud.com/cloudServer/en/ (VuePress; page paths are pinyin slugs under `/cloudServer/en/invoke-colorlightcloud-apis/api-list/...`). A full page list is in the site bundle's siteData.

**Auth:** HTTP Basic Auth on every call (`COLORLIGHT_USERNAME`/`COLORLIGHT_PASSWORD` in `simple-app/.env`, gitignored). Our account's role is `editor`. Alternative: a `JSESSIONID` cookie after logging in at `/wp-login.php`, which is what the prototype uses. Base URL: `COLORLIGHT_API_BASE`.

**Read endpoints (confirmed working 2026-09-29)**
- `GET /wp-json/wp/v2/leds?per_page=100`
  - Bags come back with `post_meta._led_status`, which holds brightness (0–255), `info` (model, firmware `vername`, serial, `playing` program, storage), power status, `rtc` timezone, `4ginfo`, `reporttime.gps_report_interval`, and `vsns` (downloaded programs).
  - Also returns `_led_latest_report_time` (online if under about 1 minute old) and `_led_latest_screenshot_time`.
  - One call covers the fleet. Paginate using `X-WP-Total`.
- `GET /wp-json/wp/v2/terminalgroup`: one group in our tenant.
- `POST /wp-json/led/v3/monitor/query/latest/single {terminalId}`: latest GPS.
- `POST /wp-json/led/v3/monitor/query/track {terminalId, startTime, endTime}`: GPS points. `serverTime` is UTC without a "Z"; `reportTime` is local time.
- `POST /wp-json/led/v3/monitor/query/mileage/duration {terminalIds, startTime, endTime}`
- `POST /wp-json/led/v3/statistic/media/playTimes {terminalId, startTime, endTime}`: minute-granular windows work. Fallback: `GET /wp-json/led/flowfee/playtimes/{id}?after&before`.
- `GET /wp-json/wp/v3/schedules/{terminalId}/terminalSchedules`: currently empty for our bags.
- `POST /wp-json/led/v3/monitor/query/default/period`: monitoring data (brightness, temperature and similar).
- Screenshots: `GET /wp-content/uploads/screenshot/{terminalId}_led.jpeg` after a screenshot command.

**Rule for changes: the bags are live.** Reading from any bag is fine. Anything that changes or could break a bag (commands, schedules, program publishes, uploads assigned to bags, settings) goes **only** to the designated test bag:
- Colorlight terminal ID `5786440` ("Terminal 028", shown as Bag 028).
- It is already the only ID in `COLORLIGHT_TEST_BAG_IDS` in `simple-app/.env`, and `COLORLIGHT_WRITES_ENABLED=false`.
- Never write to any other bag without explicit approval.
- As of 2026-09-29 the test bag had not reported for about 60 days, so it must be switched on before a write can be checked.

**Write endpoints (documented, NOT yet exercised)**
- Commands: `POST wp-json/wp/v2/comments/{brightnessCommand|rebootCommand|sleepCommand|wakeupCommand|screenshotCommand|clearCacheCommand} {terminalIds, value?}`.
- Schedules: `PUT /wp-json/wp/v2/terminalgroup/simplifiedSchedule`, with `commandSchedules` (BRIGHTNESS etc. at `operationTime` on `weeks`, between dates) and `programSchedules` (programId, dates, start/end time, weeks, priority, carousel or spot).
- Programs, uploads (TUS) and publishing: see `simple-app/server/colorlight/client.ts` and the docs' "Simplified create program" pages.
- The simplified endpoints need server version 2.6.6-20240611 or later. Not yet confirmed for our tenant (see [[open-questions]]).

**Facts found against the real tenant (2026-09-29)**
- `POST /wp-json/led/v3/monitor/query/latest {terminalIds:[...]}` returns the latest fix for many bags in one call.
- Play-count windows are **UTC** (confirmed: 16:00–17:00 had plays, 22:00–23:00 none, for a bag on 16:47–21:47 UTC).
- Late uploads: after a signal gap, a bag uploads its buffered points in a batch, all with the SAME serverTime/clientTime, in the correct order. Store them with a per-timestamp sequence number, and in analytics spread them across the preceding gap, flagged "late".
- Screenshot images (`/wp-content/uploads/screenshot/{id}_led.jpeg`) return 401 if the request sends `Accept: application/json`. Send `Accept: */*` for raw files.
- Media `name` is the slug that play stats call `mediaMd5` ("F_<HASH>_<size>"), which links plays to creatives.
- Programs (`GET /wp-json/wp/v2/programs?per_page=100`) carry `vsn_name` ("June 26_<md5>_7174.vsn"). That is exactly the file bags report in `info.playing.name`, so bags match loops by file name (`loops.colorlight_vsn` ↔ `bags.playing_vsn` → `bags.playing_loop`). The name changes when a program is edited; the trailing number is not the program id.
- A program's slots are in `program_info.children` (pages) → `children` (file windows) → `children` (files, with `fileID`). Repeats are separate pages: "June 26" has 6 slots, one ad in 3 of them. `durationInSecond` is the slot length that matches measured plays (e.g. 167 plays/hour for the 3× ad, 56 for the others).
- Reading one program (`GET /wp-json/wp/v2/programs/{id}`, with or without `?context=edit`) returns 400 on our tenant; use the list.
- Some programs bags have downloaded (e.g. "deliveroo test 4") aren't visible to our editor account, so a bag can play a loop we can't match.

**Late uploads (measured 2026-10-04)**
- A bag without signal keeps playing ads and recording GPS, and uploads its backlog when it reconnects.
- GPS: only its last ~15 minutes are kept (batches top out at 30 fixes at the 30 s interval), all stamped with the upload time (serverTime = clientTime). After gaps of 10+ minutes, 69 of 206 batches sat next to the first fix after the gap and only 2 next to the last fix before it, so they belong just before the upload, not spread across the gap. 49 of 5,683 late batches crossed London midnight.
- Plays are filed under the hour they were played, so past hours grow after the fact. Over 10 days our hourly reads were 15,085 plays short (3.9%) until a reconcile against Colorlight's day totals; GPS per day matched exactly.
- Bags with no GPS fix still play ads (Bag 013 played thousands a day with no GPS), so never find play hours from GPS.
- Every bag: GPS every 30 s, content (play) reporting on with no fixed interval.

**How much history Colorlight keeps (measured 2026-10-02)**
- GPS tracks: about 90 days (points at 80 days back, none at 100).
- Play statistics: about 175 days (plays at 150 and 175 days back, none at 200).
- Older data is dropped daily, so DigiLite Hub imports everything still there and keeps it (see [[architecture-notes]]).
- `playTimes` accepts long windows (45 days in one call, about 0.4 s), which makes "was anything played in this stretch?" cheap.
- `POST /wp-json/led/v3/monitor/query/mileage/duration` returns 403 for our editor account.

**Caveats**
- Brightness is 0–255 on the device: the docs' command pages say "range 0-255", Colorlight's schedule examples pair 50% with 127, and bags report 0–255 (most report 179 = 70%). The dashboard sends `round(pct × 2.55)` (setting `brightness_command_scale` = 255). Confirm on the test bag with the first real send: 50% should read back as about 127.
- The "device information list" endpoint in the docs returns nothing extra for us; the rich fields are already in `/leds`.
- Always write through a safety gate (dry run, then a test bag, then everything), as the prototype does.

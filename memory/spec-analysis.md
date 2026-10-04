---
name: spec-analysis
description: The original V1 spec (DL CMS Spec Doc.pdf) against current plans, plus the longer-term direction it implies
updated: 2026-09-29
---

**Covered by current plans or the Colorlight API**
- 4.1 Remote upload and deploy. The bag's reported `playing` program gives "last sync" per bag.
- 4.2 Live GPS and stored route history. The ~3 s heartbeat is a device setting (currently 30 s).
- 4.3 Online hours and stationary detection, logged as events rather than enforced.
- 4.4 Scheduling by date range, time and weekday, with priority and a default ad. Colorlight's `simplifiedSchedule` does this natively.
- 4.7 Bag management and hardware metadata (from `_led_status`).
- 7. Rider-activity and campaign CSV exports.

**Missing or to do**
- Logins and an audit log (5, 8).
- A minimum-hours threshold for pay eligibility (4.3).
- Scheduling by date range in the designs (4.4).

**Bring back cheaply later**
- 4.2 Zones and time spent in each, calculated afterwards from stored GPS. The basis for reporting on "time in high-value places" and, later, pricing by zone.

**Deferred**
- 4.5 Swapping ads when a bag enters a zone. Colorlight has no location trigger. It's possible server-side (watch GPS, then switch the loop through the API), but latency is at least the GPS interval plus the 5 s command interval. Test later.
- 4.6 Wi-Fi/Bluetooth counts: new hardware and a way to ingest its data. Leave room in the data model.
- 6. Client portal and approval queue.

**Longer-term direction** (spec §9: "a data-driven AdTech platform, not just a hardware controller"): sell time in specific places as measurable inventory that agencies trust. Roadmap items: automated impression modelling, client dashboards, AI ad optimisation, pricing by zone, a rider app, camera validation, programmatic sales, agency APIs.

**What that means now**
1. Store raw GPS and fine-grained play data ourselves; it can't be recreated later.
2. Keep measured and modelled figures separate.
3. Record which places the fleet covers, and for how long.
4. Build modularly, so new data feeds, a client portal and an agency API plug in without a rebuild.

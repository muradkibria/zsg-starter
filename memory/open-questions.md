---
name: open-questions
description: Unresolved items to check or decide
updated: 2026-10-02
---

**Before any real change goes to a bag**
- **Test bag offline.** Bag 028 (ID 5786440) is the only bag cleared for changes, but it hasn't reported for about 60 days. Switch it on, set `COLORLIGHT_WRITES=test`, then try brightness, restart, a schedule and a loop on it.
- **Brightness scale.** Settled on 0–255 from the docs and what bags report (see [[colorlight-api]]); the dashboard now sends `round(pct × 2.55)`. Confirm with the first real send: 50% should read back as about 127.
- **Server version.** Is the tenant on 2.6.6-20240611 or later (needed for the simplified command endpoints)? The first real test-bag command answers this.
- **Device schedule format.** No bag has a schedule yet, so the reader for what bags report back is untested. Check it after the first real schedule send. Schedule sends are marked "confirmed" when the read-back names the same loop files.
- **Fix two bag clocks.** Bag 001 and Bag 3982 are on China time (+08). Schedules skip them until fixed.

**Decisions for the business**
- **Zones.** The six zones are provisional circles taken from track density. Agree the real set and shapes; they drive client reports and zone exports.
- **Rider pay.** No hourly rate or minimum hours are set, so Payroll shows hours but no money. Review thresholds (long shifts, long stops, silences) are fixed in code (`PAY_REVIEW`) and could move to Settings.
- **Campaign classification.** "Digilite Charity Right" counts as a house ad because of its name, and the MTF ad plays on 24 bags without a campaign, so inventory shows 0 sold. Enter the real campaigns and link their ads.
- **Dormant bags.** 18 bags haven't reported in over a week: mark them in storage, repair or lost on the Bags page so they stop counting as missing.
- **Mid-shift hand-overs.** A shift is credited to whoever held the bag when it started. Fine while hand-overs happen between days; split shifts at assignment boundaries if that changes.
- **GPS interval.** Bags report every 30 s. Shorter means smoother routes but more 4G data and storage.
- **Hosting.** Pick where DigiLite Hub runs (single container, see `dashboard/Dockerfile`), with HTTPS, backups and an encrypted volume. Take the prototype offline if it's deployed: it has no sign-in.

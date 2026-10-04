---
name: domain-model
description: The core domain rule — the bag is the owned asset; riders are replaceable contractors on dated assignments
updated: 2026-10-02
---

**The bag is the permanent entity.** DigiLite owns the bags (Colorlight "terminals").

**The rider is a contractor** paid to carry a bag. They usually keep one bag for a long time, but can be let go and the bag reassigned. One rider per bag at a time.

**Rules**
- **Key all telemetry to the bag plus a timestamp:** GPS points, plays, brightness, power, health and screenshots. Never store telemetry against a rider.
- **Link riders through dated assignments:** `(bag, rider, from, to)`. A rider's hours, pay, routes and performance are derived from the bag's data within their assignment dates.
- **Never re-attribute history when a bag changes hands.** The prototype got this wrong: it used the rider's *current* bag for any date range.
- **Contractor lifecycle:** onboarding (identity documents, right to work, DBS), active assignment, a performance record (hours, stopped time, signal gaps, reliability), then offboarding. Offboarding ends the assignment and returns the bag. The rider's records stay: everything is kept permanently (decided 2026-10-02; there are no retention periods).
- **Days are London calendar days** (Europe/London, including British Summer Time), never UTC days.

**Other entities**
- Creative: an ad file, kept in our own records whether uploaded here or recorded from Colorlight's library.
- Loop: an ordered set of creatives, which becomes a Colorlight program. One record per version: a loop changed in Colorlight's own editor is recorded as a new loop and the old one archived.
- Schedule: which loop plays by date range, time and weekday, with a priority order and brightness commands.
- Campaign: a client contract linked to creatives and the bags carrying them.

**Privacy (GDPR):** rider location is personal data.
- Link identity to movement only for payroll and operations, behind access controls.
- Clients only see bag-level or anonymised data.
- Track only while the bag is on.
- Keep everything permanently; no retention periods. Deletion of history is refused by the database.

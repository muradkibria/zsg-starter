---
name: product-priorities
description: What the dashboard must do first, and what can wait
updated: 2026-09-29
---

**Top priority: rider and bag management together.**
1. Track rider movement accurately, manage it, and export it. Accuracy means:
   - hours and routes go to whoever had the bag at the time;
   - days split at London midnight;
   - signal gaps are shown honestly, never smoothed over.
2. Control the bag: upload ads and build loops, schedule which loop plays when, schedule brightness, see what is actually on screen, and see bag health.

Every main screen answers both "where is this rider?" and "what is this bag doing?". The bag is the primary object (see [[domain-model]]).

**Second tier:** campaigns, client proof-of-play reports, payroll approval, and zones with time spent in each (calculated afterwards from stored GPS, not in real time).

**Deferred:**
- swapping ads when a bag enters a zone (needs a latency test);
- Wi-Fi/Bluetooth audience counting (needs new hardware; leave room in the data model);
- client portal and ad approval queue;
- the rest of the spec's V2+ roadmap (see [[spec-analysis]]).

**Explicitly not wanted:** placeholder pages that look real but do nothing, dark mode as the default look, and technical settings shown to business users.

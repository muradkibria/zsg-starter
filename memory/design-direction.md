---
name: design-direction
description: The chosen visual direction, type and layout principles, and where the design canvas lives
updated: 2026-09-29
---

**Look: "Ledger", light and calm**
- Colours: warm paper background `#F6F4EF`, ink `#10182B`, navy `#061B47`, accent `#043DAE`, logo blue `#0B45C9`, rules `#E3DED3`, muted text `#5E6472`.
- Status colours: amber `#C26A00`/`#7A4300`, green `#1F6B45`, red `#A1261B`.
- Left text navigation with icons.

**Type:** Outfit for headings and numbers (geometric, like the logo's wordmark) and Plus Jakarta Sans for the interface. These were rejected: an editorial serif (Fraunces), and Inter or Roboto as a lead face.

**Not used:** the dark "control room" look (judged not inviting enough). The campaign-first "Campaign Lens" direction is parked as a later reference for client-facing pages.

**The map is the centrepiece.** The home screen is a full map of the fleet:
- every bag at its last position, with status shown by colour and shape;
- routes (a faint web for the whole fleet, one selected route drawn bold);
- zones with the time spent in each;
- a timeline below for the selected bag (movement, zone, what was on screen).

Bag and rider pages each carry their own map (last route, and where the rider usually rides). Graphical over tabular wherever the data allows; lists support the map, never replace it.

**Map interaction model (agreed)**
- The status counts are the map's controls. Out now / Out in the last day / Idle 1–7 days / Not seen for over a week are toggles, each with its count and marker shape, so they also act as the legend.
- **Default:** only "Out now" is on. Those bags are labelled "Bag 003 · Amara O." with a 30-minute trail.
- **Select a bag** (marker, list card or ⌘K search): everything else hides. The map zooms to that bag's route, with its stops, signal gaps and the zones it passed. The bag and rider are pinned top-left with an × back to the fleet, and the timeline sits below.
- Fleet coverage (a hex heat map) and zones are optional layers for reporting, not the default view.
- Each state has its own URL.

**Map styling**
- Basemap: OpenStreetMap data drawn in the Ledger palette (paper `#F1EDE4`, white roads with warm casing, water `#C6D6EA`, parks `#DDE6D2`, buried rivers excluded). Credit "© OpenStreetMap".
- Bag status colours (validated for colour-blind separation and contrast on paper), each with its own shape so colour is never the only signal:
  - out now: `#1F8A55`, filled dot with a halo;
  - out in the last day: `#3E6FD8`, filled dot;
  - idle 1–7 days: `#B7791F`, hollow ring;
  - not seen for over a week: `#B3261E`, square.
- Routes: selected in navy `#061B47` over a white casing; the rest of the fleet in `#3E6FD8` at about 22% opacity; signal gaps as a dotted grey line; stops of 15 min or more as amber rings with labels.
- Zones: dashed navy circles with a light tint, plus a label pill showing the time spent.

**Principles**
- Measured and estimated numbers are always visually separate. Estimates are labelled and linked to their method.
- Show data gaps; never fill them in.
- Plain-English labels. One vocabulary: bag, rider, creative, loop, schedule, campaign. Never "terminal" in the interface.
- Keep it lean: when something checks out, say so in one line ("Checked · ready to add"). Show detail and warnings only when there is a real problem, not a checklist of passes.
- Every date or period selector offers a custom range as well as presets.
- Every view has a URL. Use in-page confirmations and undo instead of browser alerts. Works on a phone.

**Brand assets:** logos are on digilite.co.uk (`/favicon.png` is the D mark; `/assets/digilite-logo-*.png`). Site theme tokens: navy `hsl(220 85% 15%)`, accent `hsl(220 95% 35%)`.

**Design canvas:** a claude.ai Design artifact, "DigiLite Hub — Dashboard Directions".
- **"Round 3 · The app (desktop)"** is the current reference set of 18 screens, in these rows:
  - fleet map (default / toggled / one bag selected);
  - bags (register, bag page, fleet schedule);
  - riders (pipeline, rider, end assignment);
  - ads & loops (creatives, loop editor with publish via the test bag);
  - payroll & exports;
  - campaigns, campaign and client report;
  - zones editor and settings.
- **"Mobile"** has 6 screens at 390×844: map, one bag selected, bag controls, alerts, riders, rider.
- **Rounds 1–2** are history.

Real data comes from the 29 Sep 2026 snapshot (bag states, routes, zones). Rider names, team names, campaign dates/plays and the reach estimate are samples or placeholders.

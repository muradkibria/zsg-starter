---
name: fleet-findings
description: What the real fleet data showed on 2026-09-29 (read-only probe) — a snapshot, re-check before relying on it
updated: 2026-09-29
---

A snapshot from a read-only API probe on 2026-09-29 around 13:00 London time. Re-check before relying on it.

**Fleet size and hardware**
- 42 bags in one terminal group, named "Terminal 001"–"Terminal 042" plus one odd one ("Terminal3982").
- All are model A20, 160×120, power on, WebSocket connected.

**Activity**
- About 10 bags reported in the last few minutes.
- About 22 reported in the last 24 hours, and 2 more in the last week.
- **18 have not reported in over a week, some for months.** Idle and lost bags are a real operational issue, so bag utilisation is a core metric.

**Shifts and GPS**
- Sampled shifts are evenings (e.g. 17:45–22:45 London).
- GPS reports every **30 s** (`gps_report_interval: 30`), not the ~3 s the original spec asked for.
- About 3 gaps over 5 minutes per shift is normal.

**Content**
- 38 bags play the program "June 26" (about 3 months old). 2 play "May 26 – ads v2", 1 "March 26", and 1 "deliveroo test 4".
- The content is stale and mixed, and there's no view of which bag plays what.

**Brightness**
- Values range from 92 to 229 on the 0–255 scale. Most bags sit around 176–184.
- There's no light sensor (`isHasSensor: false`), and no schedules are set. Brightness is inconsistent and never adjusts.

**Configuration problems**
- 2 bags (Terminal 001, Terminal3982) have their clock timezone set to **+08**. Schedules on them would fire 7 hours off.
- The locale is `CN/zh` on the sampled bags.
- Firmware: 37 on 1.83.4, 4 on 1.80.8 (Terminals 002–005), 1 on 1.69.5 (Terminal 001).

**Where the fleet goes (last night's tracks, 28 Sep, 21 bags)**
- Routes span roughly Marylebone to Canary Wharf, concentrated in East and Central London.
- Time by zone: Soho & Covent Garden 19.3 h, Shoreditch & Hoxton 16.4 h, Whitechapel & Aldgate 13.4 h, Stepney & Shadwell 6.2 h, Mayfair & St James's 4.1 h, the City 3.6 h.
- Fleet average per bag: 7.6 h out, 39.8 km, 22% of the time stopped (15 min or more within 50 m), 1.1 signal gaps over 5 minutes.
- Example bag (006), 12 evenings in 14 days: 5.6 h per evening on average, 29 km, 23.5% stopped, 2 gaps. Mostly Shoreditch & Hoxton (22.7 h over the two weeks).
- The zones are provisional circles chosen from where tracks concentrate (see [[open-questions]]).

**Other**
- Storage use is 6–24%, so there's no pressure.
- The last screenshots are 26+ days old. Screenshots are only taken on request.

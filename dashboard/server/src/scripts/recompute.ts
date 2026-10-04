// Recompute bag-days (routes, shifts, stops, zone time and plays per day) from the
// GPS points and plays already recorded. Run it after changing how tracks are
// analysed; the dashboard keeps working meanwhile, and nothing is fetched from
// Colorlight.
//
//   npm run recompute -w server                 every stored day
//   npm run recompute -w server -- --days 31    the last 31 days

import { addDays, todayLondon } from "@digilite/shared";
import { loadBags } from "../domain/bags";
import { computeBagDay } from "../domain/tracks";
import { connectPb, getAll, q, type RecordModel } from "../pb";

const i = process.argv.indexOf("--days");
const days = i > 0 ? Number(process.argv[i + 1]) : null;
const from = days ? addDays(todayLondon(), -(days - 1)) : "0000-00-00";

await connectPb();
const rows = await getAll<RecordModel>("bag_days", { filter: `day >= ${q(from)}`, fields: "bag,day", sort: "day" });
const bags = new Map((await loadBags()).map((b) => [b.id, b]));
console.log(`recomputing ${rows.length.toLocaleString("en-GB")} bag-days${days ? ` from ${from}` : ""}…`);

let done = 0;
let failed = 0;
const queue = [...rows];
const t0 = Date.now();
await Promise.all(
  [1, 2, 3, 4].map(async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      const bag = bags.get(r.bag);
      try {
        if (bag) await computeBagDay(bag, r.day);
      } catch (err) {
        failed++;
        console.warn(`  ${bag?.name ?? r.bag} ${r.day}: ${(err as Error).message}`);
      }
      if (++done % 500 === 0) console.log(`  ${done.toLocaleString("en-GB")} done`);
    }
  }),
);
console.log(`recomputed ${done.toLocaleString("en-GB")} bag-days in ${Math.round((Date.now() - t0) / 1000)} s${failed ? `, ${failed} failed` : ""}`);
process.exit(failed ? 1 : 0);

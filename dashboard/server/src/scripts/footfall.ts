// Fetch TfL's latest station footfall now (it's also refreshed weekly while the
// server runs), then recompute bag-days' estimated impressions with:
//   npm run recompute -w server -- --days 35

import { refreshFootfall } from "../footfall/tfl";
import { connectPb } from "../pb";

await connectPb();
const r = await refreshFootfall();
console.log(`TfL footfall: ${r.stations} stations, up to ${r.latestDay}${r.unmatched.length ? `; ${r.unmatched.length} names without a location` : ""}`);
process.exit(0);

// DEMO data for local development and walkthroughs — NEVER run against the
// real database once real riders are entered. Everything created here is
// flagged `demo: true` and can be removed with:  npm run seed:demo -- --remove
//
// Creates sample riders (contractors) on bags that are actually active,
// one rider waiting for a bag, document records (no files), and sample
// campaigns for DigiLite's advertisers, each linked to the real ads whose names
// match the advertiser. Bags, GPS, plays and zones are real and come from the
// Colorlight sync; this only adds the people and contracts.
//
//   npm run seed:demo                 add the demo data
//   npm run seed:demo -- --link       (re)link the demo campaigns to matching ads
//   npm run seed:demo -- --remove     remove it all (ads are unlinked, not deleted)

import { addDays, londonDayStart, todayLondon } from "@digilite/shared";
import { getCampaignRow, setCampaignCreatives, suggestedCreatives, unlinkAll } from "../domain/campaigns";
import { connectPb, getAll, pb, pbDate, type RecordModel } from "../pb";

const REMOVE = process.argv.includes("--remove");
const LINK = process.argv.includes("--link");

const RIDERS = [
  "Amara Osei", "Joel Kamara", "Priya Nair", "Tomasz Nowak", "Yusuf Ali", "Chloe Mensah", "Dev Patel", "Hana Begum",
  "Luis Ortega", "Sade Adeyemi", "Ravi Shah", "Kofi Boateng", "Ellie Park", "Omar Farouk", "Nadia Rossi", "Ben Carter",
  "Grace Adu", "Sam Rahman", "Leah Moss", "Aziz Khan",
];

async function remove() {
  const riders = await getAll<RecordModel>("riders", { filter: "demo = true", fields: "id" });
  const ids = new Set(riders.map((r) => r.id));
  for (const a of await getAll<RecordModel>("assignments", { fields: "id,rider" })) if (ids.has(a.rider)) await pb.collection("assignments").delete(a.id);
  // Documents don't cascade with their rider (records are kept), so demo ones go explicitly.
  for (const d of await getAll<RecordModel>("rider_documents", { fields: "id,rider" })) if (ids.has(d.rider)) await pb.collection("rider_documents").delete(d.id);
  for (const r of riders) await pb.collection("riders").delete(r.id);
  for (const c of await getAll<RecordModel>("campaigns", { filter: "demo = true", fields: "id" })) {
    await unlinkAll(c.id);
    await pb.collection("campaigns").delete(c.id);
  }
  console.log(`removed ${riders.length} demo riders and their assignments/documents, and demo campaigns`);
}

async function seed() {
  const existing = await getAll<RecordModel>("riders", { filter: "demo = true", fields: "id" });
  if (existing.length) {
    console.log(`demo data already present (${existing.length} riders). Use --remove first to reseed.`);
    return;
  }
  // Bags seen in the last 14 days get a rider; most recent first.
  const bags = (await getAll<RecordModel>("bags", { sort: "-last_report_at" })).filter((b) => {
    const t = b.last_report_at ? Date.parse(b.last_report_at.replace(" ", "T")) : 0;
    return t > Date.now() - 14 * 86400_000 && b.colorlight_id !== 5786440;
  });
  const today = todayLondon();
  let n = 0;
  for (const bag of bags) {
    if (n >= RIDERS.length - 2) break;
    const name = RIDERS[n];
    const joined = addDays(today, -(40 + ((n * 17) % 120)));
    const rider = await pb.collection("riders").create({
      name,
      phone: `07700 900${String(100 + n * 7).padStart(3, "0")}`,
      email: `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`,
      stage: "active",
      joined_at: pbDate(londonDayStart(joined)),
      demo: true,
    });
    await pb.collection("assignments").create({ bag: bag.id, rider: rider.id, start_at: pbDate(londonDayStart(joined)) });
    for (const kind of ["id", "right_to_work", "address", "agreement"]) {
      const due = kind === "right_to_work" && n % 7 === 3;
      await pb.collection("rider_documents").create({
        rider: rider.id,
        kind,
        status: kind === "agreement" && n % 9 === 5 ? "pending" : "checked",
        checked_at: pbDate(londonDayStart(joined)),
        expires_at: due ? pbDate(londonDayStart(addDays(today, 12))) : "",
        notes: "Demo record — no file attached",
      });
    }
    n++;
  }
  // One rider waiting for a bag, one who has left.
  const waiting = await pb.collection("riders").create({
    name: RIDERS[RIDERS.length - 2], phone: "07700 900990", email: "leah.moss@example.com", stage: "waiting",
    joined_at: pbDate(londonDayStart(addDays(today, -7))), demo: true,
  });
  for (const kind of ["id", "right_to_work", "address", "agreement"]) {
    await pb.collection("rider_documents").create({ rider: waiting.id, kind, status: "checked", checked_at: pbDate(new Date()), notes: "Demo record" });
  }
  await pb.collection("riders").create({
    name: RIDERS[RIDERS.length - 1], phone: "07700 900991", stage: "ended",
    joined_at: pbDate(londonDayStart(addDays(today, -200))), ended_at: pbDate(londonDayStart(addDays(today, -60))),
    ended_reason: "Moved away", demo: true,
  });

  const CAMPAIGNS = [
    ["Kung Pao Panda", "Autumn menu", -28, 33, 20, "live"],
    ["Connectbike", "Q4 awareness", -10, 77, 12, "live"],
    ["Isla Delice", "Store openings", -40, 3, 10, "live"],
    ["Pure Mo Ja", "Launch", -120, -29, 15, "ended"],
    ["Oriel IPO", "Weekend test", 4, 60, 8, "draft"],
  ] as const;
  for (const [advertiser, name, s, e, bagsN, status] of CAMPAIGNS) {
    await pb.collection("campaigns").create({
      advertiser, name, status, contracted_bags: bagsN,
      start_date: pbDate(londonDayStart(addDays(today, s))),
      end_date: pbDate(londonDayStart(addDays(today, e))),
      notes: "Demo campaign", demo: true,
    });
  }
  console.log(`seeded ${n} demo riders on active bags, 1 waiting, 1 ended, and ${CAMPAIGNS.length} demo campaigns`);
  await linkDemoCampaigns();
}

/** Link each demo campaign that has started to the ads whose names clearly match its advertiser. */
async function linkDemoCampaigns() {
  for (const rec of await getAll<RecordModel>("campaigns", { filter: 'demo = true && status != "draft"', fields: "id" })) {
    const row = await getCampaignRow(rec.id);
    if (!row) continue;
    const { suggested } = await suggestedCreatives(row);
    const ids = suggested.filter((f) => (f.match?.score ?? 0) >= 0.9).flatMap((f) => f.ids);
    if (!ids.length) continue;
    const out = await setCampaignCreatives(row, ids);
    if (!("error" in out)) console.log(`linked ${out.files} ad file(s) to ${row.advertiser}`);
  }
}

await connectPb();
await (REMOVE ? remove() : LINK ? linkDemoCampaigns() : seed());

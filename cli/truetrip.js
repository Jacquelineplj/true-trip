#!/usr/bin/env node
// TrueTrip command line: enrich a set of Booking-style hotel cards with parking, commute, ratings and true trip cost.
//
//   node cli/truetrip.js --hotels fixtures/boston-cards.json --anchors "MIT Media Lab; Boston Convention and Exhibition Center" --mode drive
//
// Options: --mode drive|ride  --time-value 20  --round-trips 1  --days N  --max-commute MIN  --budget USD
//          --no-parking  --no-ratings  --ratings-fallback llm  --model MODEL  --json out.json  --quiet
import fs from 'node:fs';
import path from 'node:path';
import { enrichHotels, formatBlock } from '../core/pipeline.js';
import { parseAnchors } from '../core/parse.js';
import { closeParkingBrowser } from '../providers/parking-source-reader.js';
import { realProviders } from '../providers/index.js';

function parseArgs(argv) {
  const a = { parking: true, ratings: true, mode: 'drive', timeValue: 20, roundTrips: 1 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    const take = () => { i++; return v; };
    switch (k) {
      case '--hotels': a.hotels = take(); break;
      case '--anchors': a.anchors = take(); break;
      case '--mode': a.mode = take(); break;
      case '--time-value': a.timeValue = Number(take()); break;
      case '--round-trips': a.roundTrips = Number(take()); break;
      case '--days': a.days = Number(take()); break;
      case '--max-commute': a.maxCommuteMin = Number(take()); break;
      case '--budget': a.budget = Number(take()); break;
      case '--no-parking': a.parking = false; break;
      case '--no-ratings': a.ratings = false; break;
      case '--ratings-fallback': a.ratingsFallback = take(); break;
      case '--model': a.model = take(); break;
      case '--json': a.json = take(); break;
      case '--quiet': a.quiet = true; break;
      case '--help': case '-h': a.help = true; break;
      default: console.error(`unknown option ${k}`); process.exit(2);
    }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.hotels || !args.anchors) {
  console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 8).join('\n').replace(/^\/\/ ?/gm, ''));
  process.exit(args.help ? 0 : 2);
}

const file = JSON.parse(fs.readFileSync(path.resolve(args.hotels), 'utf8'));
const input = {
  context: file.context ?? { city: args.city ?? '' },
  hotels: file.hotels ?? file,
  settings: {
    anchors: parseAnchors(args.anchors), mode: args.mode, timeValue: args.timeValue, roundTripsPerDay: args.roundTrips,
    days: args.days, maxCommuteMin: args.maxCommuteMin, budget: args.budget, parking: args.parking, ratings: args.ratings,
  },
};
const log = args.quiet ? () => {} : (m) => console.error(`  ${m}`);
const t0 = Date.now();
const providers = await realProviders({ ratingsFallback: args.ratingsFallback, model: args.model });
let res;
try { res = await enrichHotels(input, providers, { log, concurrency: 3, mapLimit: providers.mapLimit }); }
finally { await closeParkingBrowser(); }

// Table
const byId = Object.fromEntries(res.hotels.map((h) => [h.id, h]));
const rows = res.rankedByTrueCost.map((id) => byId[id]);
const fmt = (x, w) => String(x ?? '').padEnd(w).slice(0, w);
console.log(`\nTrueTrip  |  ${res.context.city}  |  ${res.context.nights} night(s)  |  mode: ${res.settings.mode}  |  time value $${res.settings.timeValue}/h`);
console.log(`Anchors: ${res.anchors.map((a) => `${a.query}${a.location ? '' : ' (NOT FOUND)'}`).join('; ')}\n`);
console.log(fmt('#', 3) + fmt('Hotel', 36) + fmt('Room', 8) + fmt('Parking/n', 11) + fmt('Travel h', 9) + fmt('Rides', 10) + fmt('True cost', 12) + fmt('Booking', 8) + fmt('Google', 7) + 'TripAdv');
console.log('-'.repeat(110));
rows.forEach((h, i) => {
  const p = h.parking.status === 'estimated' ? `~$${h.parking.perNight}` : h.parking.status === 'ok' ? `$${h.parking.perNight}` : h.parking.status === 'flagged' ? `$${h.parking.perNight}!` : '?';
  const rides = h.costRide.breakdown.rides ? `$${Math.round(h.costRide.breakdown.rides.low)}-${Math.round(h.costRide.breakdown.rides.high)}` : '?';
  const tc = h.cost.total ? `$${Math.round(h.cost.total.mid)}` + (h.overLimit.length ? ' (over)' : '') : 'incomplete';
  console.log(fmt(i + 1, 3) + fmt(h.name, 36) + fmt('$' + h.room, 8) + fmt(p, 11) + fmt(h.cost.travelHours?.toFixed(1), 9) + fmt(rides, 10) + fmt(tc, 12) + fmt(h.bookingScore, 8) + fmt(h.ratings.google?.rating, 7) + (h.ratings.tripadvisor?.rating ?? ''));
});
console.log('\nPer-hotel blocks (what the extension shows on each card):');
for (const h of rows) {
  console.log(`\n  ${h.name}  ($${h.room} for ${h.nights} night(s))`);
  for (const l of formatBlock(h, res.settings)) console.log(`    ${l}`);
  for (const c of h.commute) console.log(`    -> ${c.anchor}: ${c.durationMin == null ? 'no route' : `${Math.round(c.durationMin)} min, ${c.distanceKm.toFixed(1)} km${c.estimated ? ' (estimated)' : ''}`}`);
  if (h.warnings.length) console.log(`    warnings: ${h.warnings.join('; ')}`);
}
if (res.notes.length) { console.log('\nBreak-even notes:'); for (const n of res.notes) console.log(`  - ${n.text}`); }
const noteSet = new Set(res.hotels.map((h) => h.ratings.note).filter(Boolean));
if (noteSet.size) console.log(`\nRatings: ${[...noteSet].join(' | ')}`);
const spent = res.hotels.reduce((s, h) => s + (h.parking.cached ? 0 : h.parking.costUsd ?? 0), 0);
const unknownSpend = res.hotels.some(h => !h.parking.cached && h.parking.costUsd == null);
console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s. Parking discovery spend: ${unknownSpend ? 'not returned by provider; see API usage dashboard' : '$'+spent.toFixed(2)}.`);
if (args.json) { fs.mkdirSync(path.dirname(path.resolve(args.json)), { recursive: true }); fs.writeFileSync(args.json, JSON.stringify(res, null, 2)); console.log(`Wrote ${args.json}`); }

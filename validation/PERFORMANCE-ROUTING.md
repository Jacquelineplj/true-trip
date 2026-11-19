# Duplicate blocks, parallel search and routing

2026-11-16 (America/Los_Angeles). Extension 0.2.0. Runtime model: gpt-4o-mini.

## Changes

- Queued hotel records previously received a placeholder on page mutation and then another block when
  processing began. Blocks are now allocated before queueing and reused/deduplicated. A shared DOM
  ownership marker also prevents inline and extension scripts from both initializing. Redrawn cards
  reuse existing results; stale aggregation responses cannot overwrite newer tax results.
- Four hotel requests run concurrently, up from two. The bridge has a global six-request AI limiter
  (`TRUETRIP_AI_CONCURRENCY`, 1–12) exposed in `/health`. Parking and optional searched ratings start
  before city/anchor geocoding; anchor lookups and per-hotel routes run in parallel. API ratings that
  need coordinates wait for the hotel's location. Simultaneous cache misses share a request.
- Default and configured model changed from gpt-4o to gpt-4o-mini. Real Responses API web search works
  with this account. The fresh 30-property request sample has a median model latency of **1.893 s**;
  this excludes browser tax tabs and other geocoding/routing work. It is not a whole-page SLA.
- Two inactive hotel tax tabs run concurrently, with request deduplication. Search results render while
  taxes load. Late cheapest-room prices and taxes go through `/reprice`, recalculating both travel modes,
  budgets and ranking without another search. Parking means are recalculated progressively via `/notes`.
- Free geocode/routing calls time out at 4.5 s instead of 20 s. City bias and hotel-name/address checks
  reject unrelated properties. Hostels are recognized (HI Boston Hostel is mapped to HI Boston at
  19 Stuart Street). Hotel Ivy Boston Common no longer incorrectly resolves to Hotel AKA Boston Common;
  searched street-address discovery handles renamed properties before geocoding their actual address.
- Anchor resolution can retry its venue name and then a searched address. No coordinates are invented.
  OSRM failure falls back to the existing straight-line estimate, labeled ≈. Missing locations still show
  the failed hotel/destination reason instead of pretending there is a route.
- Two inappropriate parking quotes surfaced in the mini audit: a first-person review and a garage
  explicitly not hotel-operated. They are now held and the parking-search cache is versioned to avoid
  reusing the earlier accepted claims. Direct-search answers remain unverified source claims.

## Evidence

| Test | Result | Saved evidence |
| --- | --- | --- |
| Offline suite | 64/64 pass, including cache coalescing, bounded model concurrency, overlapping search/geocoding, late tax repricing and hostel matching | `out/validation/performance-tests.log` |
| Slow-request browser regression | Pass; six requests, peak four in flight, exactly one block on each of six cards; reinjection, redraw, estimates and ranking pass | [UI report](performance-duplicates-browser.json) |
| Real backend six-hotel sample | All 12 routes to MIT Media Lab/Boston convention center returned; 3.622 s mixed-cache batch; observed model peak five/cap six | [Backend report](performance-commute-six.json) |
| Installed extension on real Booking.com | Pass; 30 actual cards captured, three real provider results, one block/card, cheapest-room taxes, sorting and card/banner redraw recovery | [Live extension report](performance-extension-live.json) |
| HI Boston regression | Correct Stuart Street location; this final lookup was cached | [Geocode report](performance-hostel-geocode.json) |
| Fresh mini parking search, 30 properties | 23 numeric, 19/21 comparable exact fee/type matches (90.5%) before final quote guards | [Raw real requests](mini-parking-30-raw.json) |
| Final quote guards on those same responses | 21 numeric (70%); 19/19 comparable matches; existing sample gate passes. This is a replay, not a second network audit | [Replay](mini-parking-30-replay.json) |

The final Booking test sampled HI Boston Hostel, Copley Square FOUND and Seaport Hotel Boston;
all six displayed anchor durations were present, and all three lowest-room tax lines returned.
An earlier real-page test failed because Booking's Genius sign-in modal intercepted the sort click;
the test harness now dismisses that modal using its accessible button, without logging in or booking.

The route sample is six properties, not a citywide guarantee. Free map services and web search can still
fail. A missing location remains incomplete. Ride dollar amounts are formula estimates, not Uber/Lyft
quotes. Parking matching uses the existing saved independent references; search snippets themselves
are not independently fetched. Official Google/Tripadvisor rating APIs still require credentials.

## Reproduce

```sh
npm test
npm run server
# In another terminal:
npm run test:parking-estimate-browser
npm run test:browser -- --live --taxes
```

Browser tests require Playwright/Chrome with extension support and a visible desktop. Set
`TRUETRIP_PLAYWRIGHT` or `TRUETRIP_BROWSER` to preinstalled module/executable paths if needed.
The slow-request browser test uses deterministic provider fixtures and the real `/notes` endpoint;
the live extension test uses actual Booking.com, OpenAI and map services. They are separate evidence.
After installing these changes, reload TrueTrip in `chrome://extensions` and refresh the search tab.

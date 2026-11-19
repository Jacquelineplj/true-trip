# On-demand hotel lookup beyond the automatic cap

2026-11-17 (America/Los_Angeles). Extension/package 0.4.0.

## Behavior

Valid priced hotel cards beyond the automatic limit show a compact SVG magnifier button labeled
**Search this hotel**, with a hotel-specific accessible label, tooltip and keyboard focus styling.
Clicking enqueues that property through the same four-slot queue. Its button becomes disabled Searching
while queued/loading. Duplicate clicks do not trigger another lookup. Results replace the button and
enter normal tax repricing, parking-average estimation, budgets, notes and true-cost sorting.

The automatic counter is independent of total/manual requests. Clicking a hotel cannot accidentally
start all later hotels. Deferred records have unique IDs; freshly scrolled-in cards get buttons. A delegated
click handler still works on a button cloned by page hydration. The date/price requirements remain;
unpriced cards are not queried and selecting new dates clears old records.

## Tests

- `npm test`: **64/64 pass** (`out/validation/manual-search-unit.log`).
- Installed extension + deterministic provider responses on the demo page + real `/notes` aggregation:
  two automatic properties, four deferred buttons; first manual lookup changes the comparison mean
  from $20 to $40; clicking twice only sends one request; a cloned deferred button works; a second manual
  property gets a distinct ID; all four IDs unique; manual properties enter sorting and original order can
  be restored. A newly inserted hotel gets a button without a request. Final total four requests and three
  unqueried buttons. [Fixture browser report](manual-search-browser.json).
- Existing no-date/missing-price/late-price/error/redraw/search-generation browser regression passed
  (`out/validation/manual-search-state-browser.log`).
- Installed extension on **real Booking.com** with actual backend/model/maps/tax requests: three automatic
  properties plus a manual click on **Staypineapple, A Delightful Hotel, South End**. All four results returned,
  tax extraction and sorting/restore/redraw assertions passed, **0 extra browser tabs**. Manual enrichment
  request: **3.462 seconds**; whole browser test **29.282 seconds**, including navigation/capture and checks.
  Existing caches were partly warm; no universal latency guarantee. [Real report](manual-search-live.json).

Reproduce with the bridge running:

```sh
npm run test:manual-search-browser
npm run test:search-state-browser
npm run test:browser -- --live --taxes --manual
```

Set `TRUETRIP_PLAYWRIGHT` / `TRUETRIP_BROWSER` for the installed runtime and Chrome for Testing if needed.
The fixture test uses a visible installed extension but no model calls. The live test uses paid requests when
uncached. Screenshots: `out/validation/manual-search-browser.png`, `booking-extension.png`.

## Ride-price explanation

The existing ride estimate is now explicitly marked **estimated** with a tooltip. No live Uber/Lyft fare API
is used. `core/fare.js` uses a per-leg baseline:

```
base = max(8.50, (2.75 + 0.36 * minutes + 1.45 * miles + 2.95) * cityMultiplier)
```

Boston's configured city multiplier is 1.2; the per-leg range is 0.85–1.6 times that baseline. These are
heuristic coefficients, not a live tariff or statistically calibrated confidence interval. `core/cost.js` sums
both directions for every anchor, multiplied by roundTripsPerDay and travel days (defaults to nights).
With one day and one round trip per anchor, two anchors imply four ride legs. Single directions of 13 and
9 minutes give `2*(13+9)=44 minutes`, displayed as about 0.7 h. Exact dollar reproduction also requires the
route distances, which are not shown in the user's quoted line. Time-value cost is calculated separately.

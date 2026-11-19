# No dates / no room price: endless enriching state

2026-11-16 (America/Los_Angeles). Extension 0.3.2.

## Root cause from the user's screenshot

The Booking search showed blank check-in/check-out dates and Select dates controls instead of room
prices. The earlier browser tests used fixed dates and missed this case. The issue is distinct from the
connection-timeout control test documented previously.

The old scan queued every hotel regardless of a price. `processCard` returned early on a missing price,
but its `finally` handler still counted the job complete and set `enriching 12/12`. `finish` returned when
there were no successful hotels, so that status was never replaced. When Booking redrew the card, the
record had no successful result or saved terminal error; `ensureView` recreated a Loading placeholder.
Waiting longer could not make these completed invalid jobs succeed.

## Fix

- Require real ISO check-in/check-out dates with checkout later than checkin before scanning/queueing.
  Otherwise show **Select check-in and check-out dates on Booking.com to compare trip costs.**
- Cards without a readable name/price show a price-unavailable state; they consume no request slot and
  do not count against maxCards. Hydrated prices can enter the queue on a later scan.
- Terminal errors are stored on records and reapplied after redraw. A fully failed run shows finished
  with errors instead of enriching N/N.
- When the city, dates or currency change, clear the old queues, blocks and original-order markers.
  Each record carries its original context and generation; late results/tax callbacks cannot overwrite
  the new search. Old in-flight requests retain their concurrency slots until they finish.
- Repeated identical status writes do not create an observer-driven redraw loop.

## Tests

1. [Real undated Booking page](search-state-live-undated.json): actual installed extension, 12-card
   limit, ratings enabled. Waited **20 seconds after the choose-dates status appeared**. No .tt-block
   placeholders, sorting disabled, **0 hotel queries / 0 tax queries / 0 extra tabs**. Total harness
   duration 24.651 s including startup/navigation/wait/screenshots.
2. [Real dated Booking regression](search-state-live-dated.json): 30 cards read, **12 real enrichments**,
   cheapest-room tax extraction, no duplicates, sorting, card/banner replacement, original-order restore
   and zero added tabs passed. All results appeared at 14.768 s; total 16.467 s. Caches were partly warm.
3. [Deterministic browser search-state regression](search-state-browser.json): no-date zero-query state,
   select dates without a page reload, two unpriced hotels excluded from queue, late prices processed,
   one provider failure preserved after card/banner replacement, search reset clearing results, and late
   requests from the old search ignored. This uses fixture enrichment and the real /notes endpoint,
   not live AI. Ten requests include a deliberate second generation to test cancellation/late results.
4. Existing slow-request duplicate/parallel/parking-average/reversible-sort browser regression passed.
5. `npm test`: **64/64 pass** (`out/validation/search-state-unit.log`).

Reproduce with the bridge running:

```sh
npm run test:search-state-browser
TRUETRIP_TEST_MAX_CARDS=12 TRUETRIP_TEST_RATINGS=1 npm run test:browser -- --live --taxes --undated
TRUETRIP_TEST_MAX_CARDS=12 TRUETRIP_TEST_RATINGS=1 npm run test:browser -- --live --taxes
```

Real browser tests require Chrome for Testing and Playwright (set TRUETRIP_BROWSER/TRUETRIP_PLAYWRIGHT
if using preinstalled paths). The dated test uses paid model requests when uncached. The undated test
asserts no hotel or tax lookups, even after waiting. Screenshots are under out/validation/booking-undated.png
and booking-extension.png. Reload the unpacked extension, refresh Booking, then select stay dates.

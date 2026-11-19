# Booking parking fallback (0.5.17)

Ramada's parking-only cached answer contained $10/day, while its later combined ratings answer had a null parking fee. Parking lookup now prefers a useful existing parking answer even when ratings are enabled. Ratings still use their independent cache/answer.

The shared detail reader now parses explicit daily/nightly parking statements in fine-print and facilities sections. It keeps the actual quote, capture time and source URL, and checks canonical property identity before accepting a page-derived fee. A direct rate skips model parking lookup and participates in drive costs, tax repricing and sorting. Generic guest-parking rates are labelled “guest parking” when self/valet is unspecified. Late hydrated results can replace an unknown/default price. An unresolved property can receive a bounded browser page fallback without another model call; existing browser attempts are not duplicated.

Live validation on Ramada:

| Method | Results | Estimated model cost |
|---|---|---|
| Direct normal + en-gb Booking page reads | Both returned $10/day | $0 |
| Dedicated GPT-4o-mini Booking fine-print search | $10/day, exact supporting quote | $0.0113800 |
| Dedicated GPT-4o-mini Expedia/Hotels.com search | $10/day, Expedia quote | $0.0113845 |

Two paid validation calls cost an estimated $0.0227645 total and are recorded as `parking_validation` in the usage ledger. Each was limited to one search and 500 output tokens. No repeated calls were added after both succeeded. This single-property result is not a broad hotel coverage benchmark.

138 offline tests passed, plus installed-extension location/parking and economy/time-sort regressions. Browser fixtures cover a fine-print-only rate skipping model work and a late hydrated rate updating totals. Negative fixtures cover deposits, shuttles, hourly/event/package/nearby rates, wrong properties and expired evidence. A live concatenated-paragraph parsing regression preserves the parking sentence separately from the shuttle sentence.

Artifacts: `out/validation/ramada-booking-page-live.json`, `out/validation/ramada-parking-fallback-searches.json`, `out/validation/booking-location-browser.json`, `out/validation/economy-browser.json`.

## Two-version priority (0.5.18)

Direct reads now precede model enrichment: canonical English page, then `.en-gb.html`/`lang=en-gb` on a miss. First-page success avoids the second request. Coordinates or complete taxes alone cannot release the parking lookup early. Existing tax results are preserved while adding an alternate-page parking quote. Model/OTA fallback settings remain unchanged. Installed-extension fixtures include a price found only on the second variant and assert that both HTTP reads finish before enrichment. No paid model calls were used for this update's tests.

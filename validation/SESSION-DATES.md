# Booking session dates omitted from the search URL

2026-11-17 (America/Los_Angeles). Extension/package 0.5.1.

## Root cause and reproduction

The user supplied `https://www.booking.com/searchresults.html?ss=Boston&ssne=Boston&ssne_untouched=Boston`.
Their screenshot showed room prices, but TrueTrip displayed the choose-dates warning. Unlike the earlier
undated/unpriced screenshot, Booking had a selected stay stored in its session. `readContext` only read
checkin/checkout query parameters and incorrectly treated an absent URL parameter as an unselected date.

A diagnostic browser without the extension reproduced three phases:

1. Fresh bare URL: check-in/check-out placeholders, no card prices or dated hotel links. Numerous
   unselected calendar cells have data-date attributes; these must not be mistaken for stay dates.
2. Explicit Dec 10–11 search: priced cards and dated hotel links.
3. Return to the user's exact bare URL in the same session: visible Dec 10–11 labels and room prices,
   no URL date parameters, but each priced hotel link retains checkin=2026-12-10 and checkout=2026-12-11.

[Diagnostic capture](session-dates-diagnostic.json). This uses a test browser session, not the user's
personal browser profile. The recovered dates above are the test stay, not an assertion about their stay.

## Fix

`extension/reader.js` now resolves a complete valid date pair from, in order:

- Explicit search URL parameters.
- Selected search-form inputs or machine-readable start/end date fields.
- A strict majority of consistent date pairs in **priced current property-card hotel links**.

Hotel-link dates must be real ISO calendar dates, checkout must follow checkin, and any displayed night
count must agree. Links must be Booking hotel pages. Unpriced recommendations, arbitrary calendar cells,
invalid dates and ties/conflicting pairs cannot supply a stay. Dates are never guessed from the current
day or a price. readContext includes datesSource to make the decision inspectable.

The content script also watches href/value/datetime/data-date attribute changes and rescans on form
change/popstate. Existing search-generation handling clears results when the recovered stay changes.
The genuinely undated/no-date-evidence path still shows a choose-dates message and makes no hotel calls.

## Validation

- `npm test`: **69/69 pass** (`out/validation/session-dates-unit.log`).
- [Browser DOM regression](session-dates-browser.json): bare URL begins with zero queries even when
  unselected calendar cells exist. Updating only six hotel href attributes starts six fixture lookups
  with datesSource=hotel-links. Changing link dates resets the stay and starts the next six. Hidden form
  dates, explicit URL priority, conflicting pairs, unpriced outliers, invalid dates and night mismatches
  have dedicated assertions. This test uses fixture enrichment and the real local /notes endpoint.
- Prior no-date/missing-price/stale-response browser regression passes
  (`out/validation/session-dates-search-state.log`).
- [Actual installed extension on the exact user URL](session-dates-live.json): the test first seeds a
  Dec 10–11 Booking session with TrueTrip disabled, enables it and navigates to the user's bare URL.
  **20 actual cards read; 3 real hotel results / 3 cheapest-room tax lines returned.** Context correctly
  records Dec 10–11 from hotel-links, despite absent URL dates. Unique panels, sorting, original-order
  restore, card/banner replacement and **0 extra tabs** all pass. Whole run 20.250 s including session
  setup and checks, with mixed caches. This is not a latency guarantee.

Reproduce with the bridge running:

```sh
npm run test:session-dates-browser
npm run test:search-state-browser
TRUETRIP_TEST_CAPTURE_CARDS=3 npm run test:browser -- --live --taxes --session-dates
```

Chrome for Testing and Playwright must be available (set TRUETRIP_BROWSER/TRUETRIP_PLAYWRIGHT when
using preinstalled paths). The live test uses actual Booking/OpenAI/maps and can incur model charges.
Reload TrueTrip in chrome://extensions and refresh the existing Booking tab to load reader.js 0.5.1.

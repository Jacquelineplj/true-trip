# TrueTrip MVP

**Where to stay, given where you need to go.** TrueTrip adds what a Booking.com result card leaves out:
the parking fee (returned by GPT-4o-mini web search, with a source link), the commute to your anchors (map routing),
ratings from other platforms, and the **true trip cost**:

```
C_trip = C_room + C_tax + C_fees + C_parking + C_rides + V x T_travel
```

Parking counts if you drive, rides if you don't. `V` is the value of your time in $/hour (default $20).
Unknown fees are shown as unknown, never as $0, and every parking fee carries a source link.
Hotels reporting no on-site parking trigger a GPT-4o-mini lookup for a named public garage/lot
within approximately 1 km. A sourced overnight/24-hour quote is labeled **nearby public parking**.
If no usable public rate is found, the trip cost includes an explicit **$50/night default estimate**
per vehicle, labeled as an estimate rather than a quoted price. Search failure does not establish
that no garage exists. This replaces the previous comparison-average estimate.
See [public parking behavior and tests](validation/PUBLIC-PARKING.md).

Scope of this MVP (per the proposal and the "single city, single day" decision): Boston, one-night stays,
1-3 anchors, drive or ride, Booking.com results only.

Current extension version: **0.5.9**. The default automatic limit is five hotels; ratings and deeper parking searches are controlled by Settings checkboxes. Cards and controls use a neutral white/gray design with native system typography.
Excluded tax is explained as **Tax not included in room price; added above**; included and unknown taxes
have separate messages. See [visual refresh and verification](validation/MINIMAL-UI.md). Loading progress survives banner replacement; server checks time out with an explicit error. Duplicate blocks are prevented during queued requests, reinjection and
page redraws. Four hotel requests run concurrently, with up to six model requests across the bridge;
parking/rating search overlaps geocoding, and taxes update totals asynchronously without repeating AI calls.
See [performance and routing validation](validation/PERFORMANCE-ROUTING.md). Sort with **Sort by true trip cost** and return with **Restore original order**. Taxes are read
without opening tabs in your browser; see [background reads and sorting tests](validation/RESTORE-BACKGROUND.md).
After updating, reload TrueTrip
in `chrome://extensions` and refresh the Booking.com tab.

## Layout

| Path | What it is |
| --- | --- |
| `core/` | Pure logic, no I/O: `cost.js` (formula, break-even notes, sort), `verify.js` (parking claim checks, double-counting guard), `match.js` (same hotel across platforms), `parse.js` (card text), `fare.js` (ride fare range), `pipeline.js` (orchestration with injected providers) |
| `providers/` | Real data sources: `openai.js` (Responses API + web search), `llm.js` (provider routing), `parking-search.js` (direct searched parking results), `parking-verified.js` (optional independent page evidence), `geocode.js` (Photon / Nominatim / Google), `route.js` (OSRM / Google Directions), `ratings-google.js`, `ratings-tripadvisor.js`, `ratings-llm.js` (opt-in fallback), `cache.js` |
| `cli/truetrip.js` | Command line: cards JSON in, table + per-card blocks + break-even notes out |
| `cli/server.js` | Local HTTP bridge the extension talks to (`/enrich-one`, `/notes`, `/health`, `/demo`) |
| `extension/` | Chrome extension (Manifest V3): content script for Booking.com results, options page, popup |
| `extension/demo/booking-mock.html` | Mock Booking results page with the same `data-testid` structure, for testing without Booking |
| `fixtures/boston-cards.json` | Six real Boston hotels, one night, illustrative prices |
| `test/` | `node --test` unit tests (69) including the proposal's Hotel A $810 vs Hotel B $700 example |

## Run it

Requirements: Node 20.12+ and an OpenAI API key in the local `.env`. Default model: `gpt-4o-mini`; parking comes directly from its web search. Chrome is needed for extension use and the optional verified-page mode. See `.env.example`; this workspace is already configured. The key stays in the Node service.

```bash
cd truetrip
npm ci
npm test                                     # unit tests, no network
npm run demo                                 # CLI on the Boston fixture (drive mode)
node cli/truetrip.js --hotels fixtures/boston-cards.json \
  --anchors "MIT Media Lab, 75 Amherst St, Cambridge MA; Boston Convention and Exhibition Center" \
  --mode ride --time-value 25 --max-commute 20 --ratings-fallback llm --json out/ride.json
```

CLI options: `--mode drive|ride`, `--time-value $/h`, `--round-trips N` (per anchor per day), `--days N`,
`--max-commute MIN`, `--budget USD`, `--no-parking`, `--no-ratings`, `--ratings-fallback llm`,
`--model MODEL` (OpenAI model for source/rating search), `--json file`, `--quiet`.

The server combines parking and address questions into one GPT-4o-mini search per property.
**Load ratings** in Settings is off by default. When enabled, parking, address and both platform
scores share the initial lookup. **Search deeper** in Settings is also off by default; enabling it
permits one dedicated parking-only GPT-4o-mini search targeting Expedia/Hotels.com if the primary
parking answer has no usable numeric price. A successful
primary lookup needs no fallback. Neither control appears on hotel cards. Save Settings and reload
the results page to apply changes. The retry uses its own cache key so an initial missing result cannot
suppress the OTA search. Both stages use at most one search-tool call each. The combined stage allows
1,100 output tokens; the dedicated OTA stage allows 700. The former fallback-model environment setting
is no longer used for this retry.
Each combined request permits one search-tool call and up to 1,100 output tokens.
Useful parking/policy or rating answers are cached for seven days; missing answers for 30 minutes;
provider errors for five minutes (authentication/quota errors: one minute). Cached timestamps are preserved
and parking shows its checked date. In-flight requests for the same property/model/questions share work
across tabs. A cached answer containing ratings can also serve parking/address-only requests.
Hotel identity uses the canonical Booking URL without stay dates or tracking parameters.
No separate local hotel-page fetch is required for parking.

Hotel routing reuses sourced address coordinates and ignores optional chain-name branding such as
`by Hilton`. Street-address results must match the building number before a geocoder can stop the
fallback chain; a street-only result does not suppress the next map provider. Address queries avoid
duplicate city suffixes. See [Hampton Seaport location diagnosis](validation/HAMPTON-LOCATION.md).

Explicit sourced free-parking quotes repair inconsistent model fields before pricing: a missing
amount becomes zero and a self/unknown type becomes free when the quote unambiguously states
free or complimentary guest parking. Missing/expired sources, low-confidence claims, negated or
conditional free offers, off-site parking passed off as hotel parking, guest reviews and conflicting
positive fees remain excluded. Nearby public rates have their own validation and display label.
This repair also applies when reading existing cached claims, avoiding needless OTA retries for
supported free parking. It does not turn a no-on-site-parking policy into a zero parking cost.

Page-load expenses are recorded from this version onward in `.usage/requests.jsonl` (ignored by Git).
Open http://localhost:8787/usage or **Page-load costs** in the popup to see one total per Booking
results-page load. Each refresh gets a new ID. Automatic lookups, manual hotel searches and enabled rating/deeper
lookups on the same page share that total; cache-only page loads cost zero. The view
refreshes every five seconds and shows the latest 200 page loads. All interface text is English.
Low-level usage is retained for accounting, with reported token usage, search calls and a rate snapshot.
Estimates use public standard OpenAI prices; actual invoices may differ. Missing usage and unpriced
models are unknown, never assumed zero. Shared in-flight work is charged only to the page that
initiated the paid request. Keys, full prompts, model answers and full Booking session URLs are not
written to this log. Records persist across server restarts. Earlier queries cannot be assigned to a
page retrospectively. Rates last checked 2026-11-17.
The extension labels these results as GPT web search. Set `TRUETRIP_PARKING_MODE=verified` for the old independent-page-fetch workflow.

The default automatic limit is **5 hotels**. Existing installations migrate once from the old limit of 12
to 5 and turn automatic ratings off; the previous default of 3 also migrates to 5. Other custom limits
are preserved, and this latest migration retains your ratings preference. Settings can override these defaults.
Hotels beyond the automatic limit show a small magnifier **Search this hotel** button. Clicking it
queues that hotel once, with the same background taxes, routes, public-parking fallback and sorting logic.
Manual lookups do not raise the automatic limit; later scrolled-in cards also get the button.
See [manual search validation](validation/MANUAL-SEARCH.md).

Stay dates are read from the search URL, selected form fields, or consistent dated links on priced hotel
cards. Booking session dates need not appear in the search URL. Without any reliable dates, TrueTrip asks
you to choose them and starts no hotel/tax requests. See [session-date fix](validation/SESSION-DATES.md). Unpriced cards wait for a displayed price without consuming the hotel limit.
See [missing-date regression and real browser tests](validation/UNDATED-SEARCH.md).

### Chrome extension

1. Start the bridge: `npm run server` (listens on http://localhost:8787).
2. Open `chrome://extensions`, enable Developer mode, **Load unpacked**, choose the `extension/` folder.
3. Click the TrueTrip icon, open **Settings**, set your anchors (1-3), car or no car, and the value of your time.
4. Open a Booking.com results page (for example Boston, one night). A banner appears above the results and an
   "Added by TrueTrip" block appears under each card as lookups finish. Click **Sort by true trip cost** when done.

To try it without Booking.com, open http://localhost:8787/demo?ss=Boston&checkin=2026-12-10&checkout=2026-12-11
with the extension loaded (or add `&inline=1` to run the content script without the extension).

## Data sources and how to upgrade them

| Need | Current implementation | Optional upgrade |
| --- | --- | --- |
| Parking fee | GPT-4o-mini web search returns amount, type and source directly; results are labeled as searched | Optional `TRUETRIP_PARKING_MODE=verified` adds independent page fetching |
| Geocoding | Photon (komoot), then Nominatim; biased to the city | `GOOGLE_MAPS_API_KEY` enables Google Geocoding as a final map-provider fallback |
| Routing | OSRM demo server (driving) | `GOOGLE_MAPS_API_KEY` switches to Google Directions with traffic |
| Ride fare | Formula (base + time + distance) with city multiplier, shown as a range, wider outside tested cities | Real quotes |
| Ratings | None by default; `--ratings-fallback llm` (or server default) searches with the LLM, labeled unverified | `GOOGLE_MAPS_API_KEY` (Places API New) and `TRIPADVISOR_API_KEY` (Content API) give API ratings matched by name + location |

## Design rules kept from the proposal

- Unknown fees are never silently $0. Unknown hotel parking stays incomplete; confirmed no-on-site-parking
  policies use the separately labeled public quote or $50/night default estimate requested for trip budgeting.
- A parking fee is accepted only with an http(s) source; "$0" needs an explicit "free" statement with a quote.
- Ratings from the LLM are labeled "unverified"; API ratings are matched by name similarity and distance.
- The page's own data is never changed; TrueTrip only adds a block and, on request, reorders cards.
- Passive reading only; no login, no booking.

Google/Tripadvisor searches can use explicitly attributed Google Travel review summaries, including
Tripadvisor scores displayed there. When the model provides a generic score/review quote but omits
the Tripadvisor label or supplies an uncited listing URL, the same hotel’s actually searched Google
Travel page may be used as an indirect source. This requires a matching source title or a supported
Google score linked to that same entity. Such scores show **model-attributed** and remain unverified.
The original quote is preserved; no platform label or listing URL is invented. Conflicting hotel names,
explicitly other-platform quotes, mismatched numeric quotes, star classifications and out-of-range
scores remain rejected. Existing cached raw responses are revalidated without an extra API search. Results keep the actual searched link and show **via Google Travel**.
A missing platform gets at most one focused follow-up; unavailable scores stay n/a with a reason tooltip.
See [rating coverage and tests](validation/RATINGS-COVERAGE.md).

## Validation and current status

See [the test report](validation/TEST-REPORT.md) and [parking accuracy results](validation/PARKING-ACCURACY.md).
Latest source-verification update: [parking fix and measured limits](validation/PARKING-FIX.md).
59 offline tests pass. The direct GPT-4o-mini 30-property test returned 22 accepted numeric fees (73.3% coverage),
with 20/20 independently scorable pairs matching; six more properties returned no on-site parking.
The existing sample quality gate passed. See [direct-search implementation and real tests](validation/GPT4O-DIRECT-SEARCH.md).
Earlier source-access failures below describe the previous verified-page workflow.
The unpacked extension has now been tested in a real browser on Booking.com, including reading 30 public
Boston results, rendering three real provider responses, and sorting. The captured sample is
`fixtures/boston-30.json`; it contains dated live prices, unlike the illustrative six-hotel demo fixture.

The original 30-property provider baseline returned 23 accepted parking fees; 16/21 independently
scorable fee/type pairs matched (76.2%; primary-source-only 73.7%). This misses the 80% accuracy target.
The stricter follow-up returned 0/3 accepted fees; a later search-excerpt variant accepted 1/3, with that fee incorrect. These are recorded failures, not successful accuracy claims.
API ratings still require credentials and remain untested.

The reader preserves missing taxes as unknown. US Booking results that omit tax details show an
incomplete total. Unsupported currencies and per-night prices also stay incomplete. Unrelated geocoding
results and parking claims with missing/mismatched quotes or low confidence are rejected or flagged.
The default parking provider uses GPT-4o-mini's searched answer directly with source links. Basic currency,
plausibility, quotation/amount consistency and seven-day search freshness checks remain. It does not independently
open the source page. Failed parking lookups remain unknown. Hotels with no on-site parking use a sourced nearby public quote or a clearly labeled $50/night default estimate.


```bash
npm ci
npx playwright install chromium
npm test                                  # offline regression tests
npm run server                            # separate terminal; leave running
npm run test:browser                       # installed extension + real backend, local mock page
npm run test:browser -- --live             # installed extension on real Booking.com
npm run test:live -- fixtures/boston-parking-audit.json  # original 30; uncached paid URL discovery + source reads
npm run evaluate:parking                  # evaluate saved baseline against independent references
```

Live tests use network services and incur OpenAI API charges, and can fail when a service is unavailable.
They run separately from the offline test suite. Browser tests use a separate test profile, require a visible
desktop, enrich at most three properties, and save reports/screenshots under `out/validation/`.
`TRUETRIP_PLAYWRIGHT` can point to a preinstalled Playwright module; `TRUETRIP_BROWSER` can point to an
existing Chrome for Testing executable. The live capture preserves an existing `fixtures/boston-30.json`.

## Taxes from hotel availability pages

When a result card omits tax information, the extension first requests the public hotel HTML in its
background worker and reads the cheapest available room from an inert document. If the table is absent,
the local Node service tries a separate headless browser. Neither path opens tabs in your browser.
The reader uses the lowest-priced available room and its explicit Included/Excluded charges. It does not match the search card's room type or
click reservation controls. The trip calculation uses this cheapest room's price, labeled separately
from the original card. Percentage taxes and fixed nightly/person charges are calculated from the
displayed terms; displayed prices may be rounded. Unrecognized charges remain unknown.

The current scope is English/USD, one room, adult guests, and the standard Booking availability table.
The headless fallback runs at most two reads concurrently and caches successful results for five minutes.
If background access is blocked, taxes remain unknown; no visible-tab fallback is used.
Reload the unpacked extension and refresh the Booking page after updating.

`npm run test:tax-browser` exercises cheapest-row selection and taxes in a browser DOM.
`npm run test:browser -- --live --taxes` tests the installed extension's live extraction and card rendering.

Booking detail-page reads now also extract the visible street address and hotel-scoped map/structured coordinates. When the result card lacks a street address or coordinates, enrichment waits for this shared read before geocoding; tax recovery can continue in parallel. Page coordinates bypass geocoding and address research. Address-only results use the existing geocoders before the LLM fallback. Blocked or missing page data retain the existing fallback. This does not eliminate model calls for parking or enabled ratings.

Rating cache policy (0.5.11): accepted Google/Tripadvisor scores live for seven days independently of parking/address research. Missing, invalid or failed scores wait 30 minutes before the next enabled rating lookup makes at most one dedicated GPT-4o-mini search for the missing platforms. Existing good scores remain unchanged, concurrent requests share work, and the cooldown survives service restarts. Older combined answers retain their original timestamps so an old missing score can retry immediately. No background/polling requests are scheduled; Load ratings must be enabled. Dedicated search costs remain attributed to the Booking page load.

Version 0.5.12 also prices legacy/model-reported no-on-site answers with inconclusive availability quotes at the explicit $50/night default. It preserves the original evidence, labels the amount as an estimate, includes it in drive costs and tax repricing, and skips an extra OTA retry for this case.

Version 0.5.13 accepts street abbreviations such as Blvd/Boulevard and given-name + middle-initial expansions such as Morrissey Boulevard/William T. Morrissey Boulevard while retaining the exact house number. A matching street address can validate an older hotel-name cache entry (Ramada Inn versus Ramada by Wyndham Boston), and valid legacy address-cache entries are reused before network geocoding.

Version 0.5.14 adds “Sort by average travel time” alongside true-trip-cost sorting. The metric is the unweighted arithmetic mean of one-way driving times to all configured anchors, displayed on each enriched card. Any missing route makes the average unavailable and places that hotel after complete averages. Equal values preserve Booking order. Newly completed hotels keep the active sort, and Restore original order resets it. Sorting uses existing route data and makes no extra paid/provider queries. Installed-extension fixtures verify unequal anchor times, incomplete routes, restoration and a newly searched hotel joining the active time order.

Version 0.5.15 expands location recovery: Booking header coordinates, map-marker URLs, microdata and linked Hotel JSON-LD are read from the shared detail page. When taxes already require this read, its first response can also supply coordinates before enrichment even when a card has a street address. Each map response checks all returned candidates. Address lookup tries at most three distinct forms (original, expanded street/state abbreviations, street plus city without neighbourhood noise); name lookup also tries a name without the chain suffix. Free Photon and Nominatim precede optional Google Geocoding. Five-minute negative geocode caching and persisted sourced address successes prevent repeated work. The existing combined mini research remains the final address fallback; no extra model-search stages were added.

Version 0.5.16 prioritizes rating coverage: numeric 1–5 scores matched to the property can be displayed even when supporting quotes/links are incomplete, with an explicit “unverified; model-reported” label. Only actual searched platform/Google Travel URLs may be linked; otherwise no source link is displayed. Missing numbers, another property, and ten-point Booking scores remain unavailable. Existing raw answers are reparsed using a new normalized rating-cache namespace, without requiring another paid search.

Version 0.5.17 reads explicit Booking guest-parking rates from The fine print/Important information and parking facilities while reading the room/tax page. An exact-property, fresh page quote takes precedence and skips the model parking lookup; a late hydrated rate updates drive totals through repricing. If a price is still missing and no browser read has run, a bounded browser fallback checks the same page. Existing valid parking-only cache entries are no longer hidden by rating-rich answers with null parking fees. The combined search prompt also points to Booking's Fine print and Facilities sections. The parser excludes hourly, event, package, nearby-garage, shuttle and deposit amounts.

Version 0.5.18 sequences parking discovery before paid lookup: read the canonical English Booking property page, then its `.en-gb.html` variant with `lang=en-gb` only if a usable parking rate was not found. Model enrichment cannot start until this direct parking phase finishes. The first valid rate stops further page-variant requests; complete taxes and coordinates from either read are retained. Existing mini search and optional dedicated OTA recovery remain after these direct reads. No extra paid search stages or changes to the Search deeper setting were introduced.

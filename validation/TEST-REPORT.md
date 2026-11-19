# TrueTrip continuation: real test report

> **Parking average fallback (user decision, 2026-11-16):** Hotels reporting no on-site parking now
> use the average of valid numeric quotes in the current comparison and are labeled **estimated off-site
> parking**, with the sample count. Failed/flagged/previously estimated prices do not enter the average.
> Drive totals, budgets and ranking update together; ride costs remain unchanged. 59 offline tests and
> a browser/real-aggregation fixture regression pass. Saved 30-property response replay: 22 valid quotes
> yield **$51.05/night** for the six no-parking hotels. These remain estimates, not new source quotes.
> Read [parking-average report](PARKING-AVERAGE.md). Reload the extension for the updated labels and aggregation.

> **User-requested direct search (2026-11-16):** Default parking now comes directly from GPT-4o web search,
> without local hotel-page fetching or an official-domain allowlist. Model: `gpt-4o`; mode: `search`.
> **56 offline tests pass. Final 30-property test: 22 numeric returns (73.3% coverage), 20/20 comparable
> fee/type matches, plus six no-on-site-parking results; the existing sample quality gate PASSED.**
> Results are labeled GPT web search and are not independently page-verified. Two inconsistent amount/quote
> returns remain held. See [direct-search report](GPT4O-DIRECT-SEARCH.md). This supersedes older default-provider instructions.

> **OpenAI migration (2026-11-16):** Runtime now defaults to `gpt-5.4-mini` via Responses API.
> The local ignored `.env` is configured; no key is sent to the extension. 51 offline tests and the installed
> extension/real-backend mock-page test pass. Fresh OpenAI audit: **10/10 comparable fees matched,
> 10/30 numeric coverage (33.3%), 12/30 resolved. Overall quality gate FAILED on coverage.**
> Model-request median latency: 3.69 seconds; source fetching takes additional time. Read
> [OpenAI migration report](OPENAI-MIGRATION.md) for reproducible tests, usage, and remaining limits.
> This update supersedes older default-provider instructions below.

> **Parking update (Codex, 2026-11-16):** Start with [PARKING-FIX.md](PARKING-FIX.md).
> Replaced numeric LLM claims with independent source fetches, deterministic fee parsing, property matching,
> and 24-hour official / 6-hour OTA evidence expiry. Old numeric caches are ignored. **44 offline tests pass**,
> plus the tax browser DOM regression. Fresh real 30-property run: **6/6 comparable fees match, but only
> 6/30 numeric coverage (20%); 8/30 resolved including no-parking policies. Quality gate FAILED.**
> Widespread source access failures remain; do not present 6/6 as validated overall accuracy.
> Final identity/section guards passed replay on all eight actual source texts; this was not another fresh run.
> Restart the bridge and reload the extension. Historical claims below are superseded where they differ.

Date: November 16, 2026 (America/Los_Angeles).

## What was actually executed

- `npm test`: **26 passed**, including the existing proposal calculation and new regressions for tax unknowns, discounted prices, foreign currency/per-night guards, three observed wrong geocodes, and unsupported parking evidence.
- Installed unpacked MV3 extension in a separate, visible Chrome for Testing profile. **Live Booking.com check passed**: 30 named/priced/linked Boston cards captured; three real geocoding/routing/parking backend responses rendered; sort put enriched cards first and produced ranks; card/banner replacement recovery also passed live. No browser-side fake transport or fake providers. Missing-tax totals correctly rendered as incomplete. The three lookups can use the real providers' cache; this does not prove fresh parking coverage.
- Installed-extension mock-page run with real backend **passed**, including an explicit regression that replaced a card, removed the banner, and confirmed restoration and sorting.
- Real 30-property CLI batch **completed** using the original provider prompt/verifier. Includes actual uncached web/Claude requests plus existing provider cache. Reference audit: [parking results](PARKING-ACCURACY.md), [machine-readable baseline](parking-baseline.json), [independent references](parking-reference.json).
- Three uncached searches with the stricter evidence prompt: **failed coverage** (0/3 accepted fees; $0.203 reported CLI spend). The properties were Hampton Logan, Westin Copley, and Hilton Garden Inn Logan, selected from the captured sample. Unknown claims remain unknown.
- Follow-up allowing explicitly attributed official search excerpts: **failed quality** (1/3 accepted; the accepted Hilton Garden fee was $20 versus the $25 independent reference). Westin $70 was correctly flagged for low confidence. See `live-search-followup.json`. The test runner now compares accepted fresh claims to independent references and fails below 70% coverage or on a known wrong fee. Prompting and quote checks alone have not solved source accuracy.
- One diagnostic Claude search returned the official Hampton fee from search summaries and explicitly said it did not open the source page. This illustrates why quote/prompt checks are not equivalent to independently checking the current source.
- npm lockfile resolved successfully, audit reported no vulnerabilities. Browser execution used the already available Playwright 1.62.1 and Chrome for Testing 156 executable via documented overrides; the newly npm-resolved dependency itself was not used for these browser runs.

## Fixes driven by the tests

1. Shared card reader used by extension and capture runner; current discounted price is selected, missing tax remains null, unsupported currency/nightly prices cannot produce complete USD totals.
2. Hotel geocoding rejects unrelated named properties. Baseline Boston Lodge was mapped to Homewood Suites in Andover, Bay Village to Embassy Suites in Marlborough, Charles River Inn to Residence Inn on Tudor Wharf. The city-centroid fallback now awaits the first query.
3. Content script recovers blocks and the banner when Booking replaces DOM elements, retains results across replacements, puts enriched cards ahead of untouched results when sorting, stops self-triggered scan loops at the lookup cap, and reports rendering errors.
4. Parking verifier flags low confidence and absent/mismatched quoted fees. Free parking requires an explicit free-parking statement. Prompt requests current overnight rates and excludes event/package prices. Linked claims remain LLM claims, labeled for source verification.
5. Saved repeatable browser, uncached-provider, and independent-reference evaluation scripts with a lockfile.

## Evidence files

Generated (git-ignored, available locally):

- `out/validation/browser-live.json`, `booking-extension.png`, `booking-cards.html`, `booking-live-cards.json`
- `out/validation/browser-mock.json`, `mock-extension.png`
- `out/validation/boston-30-drive.json`, `boston-30-run.log`
- `out/validation/fresh-parking-batch.json`, individual `fresh-card-*.json`

Preserved in project: `fixtures/boston-30.json`, this report, independent references, and the baseline evaluation.
The fixture was captured from a live search, but repeated searches reorder sponsored properties; evaluation joins by name, not the card index.

## Remaining work

- Parking accuracy is below the proposal's 80% target; the stricter follow-up has insufficient coverage. Improve independent source retrieval and remeasure a fresh held-out sample. Never patch evaluation reference prices into the product or treat successful UI rendering as an accuracy pass.
- Two reference cases remain unresolved/conflicting: Hilton Park Plaza self-parking and Hyatt Place Seaport's exact fee. Secondary evidence is labeled and separated in the primary-only metric. Nearby street parking is excluded from on-site parking.
- All cards in the tested US/USD live search omitted explicit tax lines. Totals stay incomplete until explicit taxes/fees are available. No tax percentage was invented.
- Google Places and Tripadvisor API ratings remain untested; credentials were not present. No claim of measured routing/traffic accuracy or validated cross-platform matches is made.
- Geocoding can now reject uncertain matches; resolving them with confirmed street addresses is preferable to using unrelated hotels.

## Reproduce

From `truetrip/`, run `npm ci`, `npx playwright install chromium`, and start `npm run server` separately. Then run `npm test`, `npm run test:browser`, and `npm run test:browser -- --live`.
For uncached paid parking searches use `npm run test:live -- fixtures/boston-30.json`. To evaluate the saved baseline use `npm run evaluate:parking`; pass another enriched-result JSON path to evaluate a later batch against the same references. Generated files are intentionally not committed. The project remains uncommitted, as it was handed off.

## Hotel-tax extraction update

The user requested the cheapest available room's taxes from the hotel's availability page, without matching the search-card room type. Implemented background-tab reading (no reservation clicks), Included/Excluded parsing, and trip recalculation using the detail room's price. Included resort/service fees are not added twice.

- Offline tests: **30/30 passed**. Includes the screenshot case ($85 + 14.75% + $4/night = $101.54) and an ordering reversal caused by extracted taxes.
- Browser DOM tests passed: cheapest row selection with a more expensive row first, sold-out exclusion, mixed percentage/fixed charges, missing-date fallback.
- Installed-extension live test **passed**, reading hotel tables and rendering taxes back on results cards: Hampton Logan $95 with 11.7%, Hilton Logan $201 with 16.45%, Westin Copley $242 with excluded 2.75% + 5.7% + 8% and an included $35 resort fee. Browser sorting and DOM-replacement recovery passed too. Report: `hotel-taxes-live.json`; generated screenshot: `out/validation/booking-enrichment.png`.
- Scope: English/USD standard Booking room table, one room, adult guests. Calculations use displayed prices, which can be rounded. Unrecognized charges or unavailable tables remain unknown. Search-card missing-tax text no longer by itself prevents a usable total when the detail page exposes explicit charges. Parking accuracy remains a separate unresolved limitation.

Run `npm run test:tax-browser` and `npm run test:browser -- --live --taxes`. Reload the unpacked extension for its updated manifest and hotel-page content scripts. Tax tests use a fresh browser profile so Chrome loads new extension permissions and code.

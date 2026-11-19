# TrueTrip MVP: handoff

> **Latest: session dates missing from URL (2026-11-17), extension 0.5.1.** The user's exact bare Boston
> URL had selected dates and prices in Booking's session, but reader.js only checked URL params and
> falsely blocked all cards. Reproduced in a real browser: after a dated search, returning to the bare URL
> keeps date labels, prices and dated hotel links while location.href has no dates. readContext now uses
> URL -> selected machine-readable form dates -> majority agreement among priced property links, with
> valid-date/order/night-count checks. Unselected calendar cells and conflicting date pairs are ignored.
> href/value/date attribute changes, form changes and popstate also rescan. Real installed-extension test
> on the **exact user URL** passes: datesSource=hotel-links, 3 hotel/tax results, sorting/restore/redraw,
> zero extra tabs. 69 offline tests, date-recovery DOM regression and prior search-state browser tests pass.
> Read [SESSION-DATES.md](validation/SESSION-DATES.md). Reload extension AND refresh Booking.


> **Latest: minimal UI and tax wording (2026-11-17), extension 0.5.0.** Replaced teal blocks/dark banner
> with white/gray surfaces, fine borders, light shadows, native SF/system typography and restrained blue
> actions. Cost is emphasized; sorting/search controls, settings and popup are consistent. No font download.
> Positive excluded tax reads **Tax not included in room price; added above**. Included/unknown taxes get
> distinct accurate messages. Original hotel tax terms remain in the source-link tooltip and source page.
> Hidden empty break-even notes reduce banner clutter. 69 offline tests pass. Installed-extension fixture
> checks cover all tax copy states, rating attribution, manual lookup/dedup/means/sort/restore, and narrow
> viewport fit. Actual Booking + tax test passes for three hotels, all three show new copy, zero extra tabs.
> Read [MINIMAL-UI.md](validation/MINIMAL-UI.md). Reload the extension and refresh Booking.com.


> **Latest: rating coverage/source attribution (2026-11-17), extension 0.4.1.** Ratings now accept
> Google Travel entity/reviews evidence for Google user scores and explicitly labeled Tripadvisor scores.
> The previous direct-domain + /maps/place/ + 90%-URL-name checks suppressed valid sourced scores.
> Hotel-name/source matching is relaxed; actual source URL, supporting quote and platform identity remain.
> Display keeps the real link, **via Google Travel**, searched/unverified status and n/a reason tooltips.
> One targeted follow-up can fill a missing platform without overwriting an already supported score.
> Cache namespace v4 bypasses old partial results. **69 offline tests pass**. Fresh 12-hotel audit:
> Google 11/12, Tripadvisor 12/12; separate real Booking 12-hotel browser test: 11/12 for each, all sorting /
> restore / redraw / no-extra-tab checks pass. These are coverage counts, not independently validated
> accuracy rates. Actual Westin Tripadvisor quote replay confirms 4.2 via Google Travel. Read
> [RATINGS-COVERAGE.md](validation/RATINGS-COVERAGE.md). Bridge restarted; reload extension and refresh.


> **Latest: on-demand magnifier search (2026-11-17), extension 0.4.0.** Valid hotel cards beyond the
> automatic cap show a compact magnifier **Search this hotel** button. Clicking starts the existing queue,
> disables the button, and includes the hotel in tax repricing, comparison parking means and sorting.
> Automatic counts are separate from manual records. Unique IDs cover deferred hotels; event delegation
> supports cloned buttons and duplicate clicks are ignored. Lazy-loaded cards get buttons too.
> Offline **64/64 pass**. Installed-extension fixture tests cover two automatic + two manual lookups,
> unique IDs, double clicks, redraw, averaging, sorting and lazy loading. Real Booking test: three automatic
> plus manually clicked **Staypineapple, A Delightful Hotel, South End** returned; manual enrichment
> 3.462 s, whole test 29.282 s, zero extra tabs. [MANUAL-SEARCH.md](validation/MANUAL-SEARCH.md).
> Ride dollars are now explicitly labeled **estimated** with an explanatory tooltip; they use the existing
> distance/time formula, Boston multiplier 1.2, 85–160% range and configured round trips, not live ride quotes.
> Reload the unpacked extension and refresh the Booking page.


> **Latest: screenshot root cause fixed (2026-11-16), extension 0.3.2.** The user's page had no dates
> or room prices. Earlier tests used dated searches, so they missed this. Unpriced cards previously
> consumed the 12-record limit, returned without a result, and left `enriching 12/12`; a redraw recreated
> a Loading placeholder because terminal errors were not retained. Now valid stay dates gate processing,
> unpriced cards wait without entering the queue, errors survive redraw, and all-failed runs finish with
> an explicit message. Search context changes reset results; late responses from an old search are ignored.
> Real installed-extension undated Booking page waited 20 seconds: **0 hotel/tax requests**, no Loading
> panels, clear choose-dates status. Dated 12-hotel real regression passed (14.768 s to all results, mixed
> caches). Offline 64/64 plus search-state and previous duplicate/parking/sort browser regressions pass.
> Read [UNDATED-SEARCH.md](validation/UNDATED-SEARCH.md). Reload extension AND refresh Booking.


> **Latest full browser investigation (2026-11-16).** Read
> [FULL-BROWSER-TIMEOUT.md](validation/FULL-BROWSER-TIMEOUT.md). Real installed-extension test with
> **12 hotels and ratings enabled** passed: 12 tax lines, 24 anchor durations, no duplicates, sorting /
> restore / redraw recovery, zero extra tabs. All enriched at 16.657 s; total 18.861 s with mixed caches.
> No actual timeout reproduced. Separately blocking the real extension's health request reproduces the
> `signal timed out ... Local server: http://localhost:8787` banner at 5.428 s before any GPT request.
> Do not claim this establishes the user's specific failure cause. Harness now supports
> `TRUETRIP_TEST_MAX_CARDS` / `TRUETRIP_TEST_RATINGS`, captures worker request timings and progress;
> `test:startup-browser -- --extension` exercises actual worker connection failure.


> **Latest: starting-state fix (2026-11-16), extension 0.3.1.** A banner removed/recreated by page
> hydration used to reset to `starting…` while all existing records were already queued. The banner now
> retains the last progress/error status. Startup shows settings/connection/waiting phases, settings and
> health checks have seven-second client limits (five seconds for worker health fetch), callback errors and
> initialization exceptions are shown, and scan scheduling cannot be starved by continuous DOM changes.
> Unit suite 64/64 passes. Slow-request browser reproduces pending-banner replacement and passes;
> a deliberately nonresponding health endpoint produces an error instead of starting forever.
> Reports: `validation/starting-banner-browser.json`, `validation/starting-timeout-browser.json`.
> Reload the extension AND refresh the Booking tab to discard the old content script.


> **Latest: reversible sorting and invisible tax reads (2026-11-16).** Extension **0.3.0** adds
> **Restore original order**. Original DOM positions are preserved, including cards beyond the enrichment
> limit; restoring removes ranks and stops automatic true-cost reordering. Tax reads now first fetch hotel
> HTML in the extension worker and parse it inertly. The fallback uses the Node service's headless browser,
> capped at two; it never creates user-browser tabs. Optional parking source browsing is also headless.
> Removed the hotel-page content-script registration and all `chrome.tabs.create/remove` calls.
> **64 offline tests pass**. Fixture browser toggles/redraw/restore pass. Final real Booking.com test:
> 30 cards captured, 3 hotel taxes returned, original order restored after redraw, **0 extra browser tabs**.
> See [new validation](validation/RESTORE-BACKGROUND.md). Direct headless-only experiments failed;
> background HTTP plus headless fallback is the tested final implementation. Reload the extension and
> refresh Booking.com. This supersedes the inactive-tab tax behavior documented below.


> **Latest: duplicate cards, speed and routes (2026-11-16).** Extension **0.2.0**, default model
> **gpt-4o-mini**, 4 hotel requests / 6 global AI requests / 2 tax tabs in parallel. Parking and searched
> ratings start before geocoding; late cheapest-room taxes only reprice the result. DOM ownership and
> placeholder reuse stop duplicate blocks. Geocoding handles hostels, hotel renames, city bias and
> address discovery; OSRM failure yields a labeled estimate. **64/64 offline tests pass**, the slow-request
> browser regression observes peak 4 with exactly 6 requests/6 unique blocks, and the installed extension's
> final real Booking.com + tax + sorting/redraw test passes. Real 6-hotel backend sample: **12/12 routes**,
> 3.622 seconds with mixed warm caches. Read [latest validation](validation/PERFORMANCE-ROUTING.md)
> before older updates below. Mini's raw fresh parking sample matched 19/21 comparable fees; final quote
> safeguards replay retains 19/19 with 21/30 numeric coverage. Replay is not another fresh network audit.
> Reload the extension and refresh existing Booking tabs; bridge is configured on localhost:8787.


> **Parking average fallback (user decision, 2026-11-16):** Hotels reporting no on-site parking now
> use the average of valid numeric quotes in the current comparison and are labeled **estimated off-site
> parking**, with the sample count. Failed/flagged/previously estimated prices do not enter the average.
> Drive totals, budgets and ranking update together; ride costs remain unchanged. 59 offline tests and
> a browser/real-aggregation fixture regression pass. Saved 30-property response replay: 22 valid quotes
> yield **$51.05/night** for the six no-parking hotels. These remain estimates, not new source quotes.
> Read [parking-average report](validation/PARKING-AVERAGE.md). Reload the extension for the updated labels and aggregation.

> **User-requested direct search (2026-11-16):** Default parking now comes directly from GPT-4o web search,
> without local hotel-page fetching or an official-domain allowlist. Model: `gpt-4o`; mode: `search`.
> **56 offline tests pass. Final 30-property test: 22 numeric returns (73.3% coverage), 20/20 comparable
> fee/type matches, plus six no-on-site-parking results; the existing sample quality gate PASSED.**
> Results are labeled GPT web search and are not independently page-verified. Two inconsistent amount/quote
> returns remain held. See [direct-search report](validation/GPT4O-DIRECT-SEARCH.md). This supersedes older default-provider instructions.

> **OpenAI migration (2026-11-16):** Runtime now defaults to `gpt-5.4-mini` via Responses API.
> The local ignored `.env` is configured; no key is sent to the extension. 51 offline tests and the installed
> extension/real-backend mock-page test pass. Fresh OpenAI audit: **10/10 comparable fees matched,
> 10/30 numeric coverage (33.3%), 12/30 resolved. Overall quality gate FAILED on coverage.**
> Model-request median latency: 3.69 seconds; source fetching takes additional time. Read
> [OpenAI migration report](validation/OPENAI-MIGRATION.md) for reproducible tests, usage, and remaining limits.
> This update supersedes older default-provider instructions below.

> **Parking update (Codex, 2026-11-16):** Start with [PARKING-FIX.md](validation/PARKING-FIX.md).
> Replaced numeric LLM claims with independent source fetches, deterministic fee parsing, property matching,
> and 24-hour official / 6-hour OTA evidence expiry. Old numeric caches are ignored. **44 offline tests pass**,
> plus the tax browser DOM regression. Fresh real 30-property run: **6/6 comparable fees match, but only
> 6/30 numeric coverage (20%); 8/30 resolved including no-parking policies. Quality gate FAILED.**
> Widespread source access failures remain; do not present 6/6 as validated overall accuracy.
> Final identity/section guards passed replay on all eight actual source texts; this was not another fresh run.
> Restart the bridge and reload the extension. Historical claims below are superseded where they differ.

> **Hotel-tax update (Codex, 2026-11-16):** Per the user's instruction, missing taxes now come from
> the cheapest available room on each hotel's Booking availability page, without matching the search-card
> room type. The calculation uses that detail room's price and explicit Included/Excluded charges.
> Installed-extension live test passed for Hampton Logan (11.7%), Hilton Logan (16.45%), and Westin Copley
> (2.75% + 5.7% + 8%, with its included resort fee not added again). 30 offline tests pass, plus browser
> DOM and live end-to-end tax tests. See `validation/hotel-taxes-live.json`. Reload the unpacked extension
> to load its new hotel-page access. Tax extraction addresses the missing-card-tax gap; parking quality
> and API-rating gaps below remain.
>
> **Continuation update (Codex, 2026-11-16):** Read `validation/TEST-REPORT.md` and
> `validation/PARKING-ACCURACY.md` first. The historical state below is superseded where it differs.
> The installed extension was tested on live Booking.com in visible Chrome for Testing; 30 actual
> results were captured and three real backend responses rendered and sorted. Offline suite: 26/26.
> Fixed missing-tax handling, foreign/per-night price guards, mismatched hotel geocodes, card/banner
> replacement recovery, swallowed content errors, and acceptance of unsupported parking claims.
> Baseline 30-property run: 29 source links, 23 accepted fees, 16/21 exact reference matches (76.2%);
> primary-only 14/19 (73.7%). **The parking accuracy target is not met.** A stricter fresh three-property
> follow-up returned unknown for all three and failed its coverage assertion. Do not claim final-build
> parking accuracy is validated. A later excerpt-based follow-up accepted 1/3, with that accepted fee wrong; see `validation/live-search-followup.json`. API ratings remain untested without keys.
> Reproducible commands and remaining work are in the new test report.


Date: 2026-11-16. Author of this state: Jacqueline Pan with Claude Code.
Proposal: `../proposal.pdf`. Code: this folder (`truetrip/`). Nothing is committed yet; `git status` shows `truetrip/` as untracked.

## 1. What this is, in one paragraph

A Chrome extension plus a local Node service that adds, under each Booking.com result card, the parking fee (found by
LLM web search with a source link), the commute to 1-3 user "anchors", ratings from other platforms, and the
**true trip cost** `C_trip = C_room + C_tax + C_fees + C_parking + C_rides + V x T_travel` (parking if you drive,
rides if you don't, `V` = value of your time in $/h). The MVP scope was narrowed on 2026-11-16 to **Booking.com,
one city (Boston), one-night stays**.

## 2. Current state

| Area | Status | Evidence |
| --- | --- | --- |
| Core logic (cost, break-evens, verifier, matching, parsers, fare) | Done | `npm test`: 20/20 pass, includes the proposal's Hotel A $810 vs Hotel B $700 case |
| Parking finder via local `claude -p` | Done, real run | 6/6 Boston hotels returned a sourced fee in one pass (~65 s, ~$0.50 total) |
| Geocoding + routing (free services) | Done, real run | Both anchors and all 6 hotels resolved; routes 1-13 min |
| Ratings | Partial | No API keys. LLM fallback (opt-in) found some Google/Tripadvisor scores, labeled "unverified" |
| CLI | Done | `node cli/truetrip.js ...` prints ranked table, per-card blocks, notes; `--json` writes results |
| Local server (bridge for extension) | Done | `/health`, `/enrich-one`, `/notes`, `/enrich`, `/demo`, `/ext/*` |
| Chrome extension (MV3) | Done, tested on mock page only | Content script, banner, sort, options page, popup |
| Mock Booking results page | Done | `extension/demo/booking-mock.html`, served at `/demo`; e2e check passed with screenshot |
| Live check on real Booking.com | **Not done** | Booking serves an interstitial to headless browsers; must be checked in a real Chrome |
| Hand-checked accuracy sample (~30 hotels) | Not started | Success criteria in proposal page 5 |

Example output of the real Boston run (drive mode, anchors MIT Media Lab and the convention center, $20/h):

```
#  Hotel                               Room  Parking/n  Travel h  Rides     True cost
1  Hilton Boston Logan Airport         $219  $58        0.7       $63-118   $291
2  Hyatt Regency Boston / Cambridge    $239  $48        0.6       $55-103   $298
3  The Verb Hotel                      $249  $73        0.6       $51-96    $334
4  Boston Marriott Copley Place        $289  $75        0.5       $48-91    $374
5  The Westin Copley Place, Boston     $305  $70        0.5       $47-89    $385
6  Omni Boston Hotel at the Seaport    $329  $49        0.4       $43-81    $386
Note: Hilton stays ahead of Hyatt only while your time is worth less than about $78/h.
```

Saved runs: `out/boston-drive.json`, `out/boston-ride.json` (ignored by git).

## 3. How to run

Requirements: Node 20+ and the `claude` CLI (Claude Code) logged in. No API keys needed.

```bash
cd truetrip
npm test                 # unit tests, offline
npm run demo             # CLI on fixtures/boston-cards.json, drive mode (first run ~1 min, then cached)
npm run server           # bridge on http://localhost:8787 (leave running while using the extension)
```

Extension: `chrome://extensions` -> Developer mode -> Load unpacked -> choose `extension/`. Click the icon ->
Settings -> set anchors, car/no car, time value. Then open a Booking.com results page (Boston, one night).
Without Booking: open `http://localhost:8787/demo?ss=Boston&checkin=2026-12-10&checkout=2026-12-11`
(add `&inline=1` to run the content script without the extension installed).

## 4. How the pieces fit

```
Booking results page ──content.js──▶ background.js ──POST /enrich-one──▶ cli/server.js
                                                                             │
                                                        core/pipeline.js ◀───┘
                                                          │  geocodeCity/anchors (providers/geocode.js: Photon → Nominatim → Google)
                                                          │  driveRoute          (providers/route.js: OSRM → Google; straight-line fallback, flagged)
                                                          │  findParkingFee      (providers/parking-claude-cli.js: `claude -p`, JSON reply)
                                                          │     └─ core/verify.js  (source required, $0 only if "free" + quote, plausibility)
                                                          │  ratings             (providers/index.js: Google Places / Tripadvisor if keys, else LLM fallback)
                                                          │  tripCost x2 modes   (core/cost.js), estimateFare (core/fare.js), limits
                                                          ▼
                                       enriched hotel ──▶ content.js renders block; after all cards: POST /notes → breakEvenNotes + ranking
```

Providers are injected into the pipeline, so `test/pipeline.test.js` runs it with fakes (no network, no LLM).
All network and LLM results are cached as JSON under `.cache/` (geocode 30 d, routes 7 d, parking 14 d, ratings 7-14 d).
Delete a file there to force a refresh.

## 5. Decisions and why

- **Parking via the local `claude` CLI, not the API.** Decided by the user; the API version is ready in
  `providers/parking-claude-api.js` with the same prompt and return shape. Switch: `TRUETRIP_PARKING_PROVIDER=api`,
  `ANTHROPIC_API_KEY`, `npm i @anthropic-ai/sdk`. Model for the CLI path: `--model` or `TRUETRIP_CLAUDE_MODEL` (default `sonnet`).
- **Photon before Nominatim for geocoding.** Nominatim fails on "name, address" strings and on "and" vs "&"
  (e.g. "Boston Convention and Exhibition Center"); Photon with a city-center bias resolved every test query.
  Misses are not cached.
- **OSRM demo server for routing.** Free, driving only; fine for an MVP. Walking is a straight-line estimate.
- **Ride fares are a formula, not quotes.** Base + per-minute + per-mile with a city multiplier, shown as a range,
  widened outside the listed cities (`core/fare.js`). Proposal risk "ride prices vary" is handled by the range.
- **Unknown is never $0.** If parking is unknown the total shows "incomplete" and lists what is missing; sorting puts
  incomplete hotels last. `$0` is accepted only with `parking_type: free` plus a quote plus a URL.
- **Ratings from the LLM are opt-in and labeled.** The proposal wants API ratings; without keys the server defaults
  to the LLM fallback (`TRUETRIP_RATINGS_FALLBACK=llm`) so the demo shows something. Set `none` to hide them.
- **Extension never edits page data.** It appends a block after each card and, only when the user clicks, reorders
  the card containers.
- **Per-card requests, not one batch.** The extension calls `/enrich-one` with 2 in flight so blocks fill in as
  results arrive (10-20 s per hotel on first lookup).

## 6. Known gaps and risks

1. **Booking.com selectors are unverified live.** The reader uses `[data-testid="property-card"]`, `title`,
   `title-link`, `price-and-discounted-price`, `taxes-and-charges`, `price-for-x-nights`, `review-score`,
   `address`, `distance`, with text-regex fallbacks for name and price. If a block says "Could not read this card",
   copy one card's outer HTML from DevTools and adjust `readCard()` in `extension/content.js`.
2. **Booking price semantics.** The MVP assumes the card price is the stay total and reads "Includes taxes and fees"
   to decide whether to add a tax line. Booking sometimes shows per-night prices or excludes taxes depending on
   region settings; check the first live page.
3. **LLM parking accuracy is unmeasured.** Sources were Expedia/Marriott/Hilton/Omni pages for the 6 test hotels;
   the hand check in the proposal (70% source found, 80% correct) has not been run.
4. **Ratings matching.** The API matchers (`core/match.js`) use name similarity + distance; the LLM fallback relies
   on the model's own matching and is labeled unverified.
5. **Free services have limits.** Nominatim 1 req/s (throttled in code), OSRM demo server is best-effort.
   Google keys switch both to paid APIs automatically.
6. **Cost.** Each uncached parking lookup is one `claude -p` run (about $0.05-0.10 on sonnet, ~12 s).
   `maxCards` in settings (default 12) caps lookups per page.
7. **Booking's infinite scroll** is handled by a MutationObserver, but not tested live.

## 7. Suggested next steps, in order

1. Load the extension in Chrome, open a Boston one-night search, and fix the reader if needed (gap 1-2).
2. Run the accuracy sample: build `fixtures/boston-30.json` from a real results page (the reader output can be
   logged from the content script), run the CLI with `--json`, and check parking fees and matches by hand.
   Record results in a small table for the final report.
3. Add `GOOGLE_MAPS_API_KEY` (Places API New + Geocoding + Directions) and `TRIPADVISOR_API_KEY`; set
   `TRUETRIP_RATINGS_FALLBACK=none` so ratings come only from APIs.
4. Switch parking to the Claude API when ready (section 5); the prompt in `providers/parking-prompt.js` is shared.
5. Nice-to-haves: per-night price handling, a "re-run" button in the popup, transit mode, caching in the extension.

## 8. File map

```
truetrip/
  package.json          scripts: test, demo, cli, server
  README.md             usage and options
  HANDOFF.md            this file
  core/                 cost.js verify.js match.js parse.js fare.js geo.js pipeline.js
  providers/            index.js cache.js http.js geocode.js route.js parking.js parking-prompt.js
                        parking-claude-cli.js parking-claude-api.js ratings-google.js ratings-tripadvisor.js ratings-llm.js
  cli/                  truetrip.js (CLI)  server.js (bridge + demo page)
  extension/            manifest.json content.js content.css background.js options.html/js popup.html/js demo/booking-mock.html
  fixtures/             boston-cards.json (6 real hotels, one night, illustrative prices)
  test/                 cost parse match verify fare pipeline (.test.js)
  .cache/  out/         generated, git-ignored
```

## 9. Troubleshooting

- Banner says the server is not running: `npm run server` in `truetrip/`, then reload the page.
- Blocks stuck on "Looking up…": watch the server terminal; a `claude` call can take up to 3 min before timing out.
  Check `claude --version` works in a plain terminal and that you are logged in.
- "anchor NOT FOUND": add the city to the anchor text, e.g. "Fenway Park, Boston".
- Wrong hotel geocoded: the address query is tried before the name; fix the address in the card data or the fixture.
- Stale parking fee: delete `.cache/parking.json`.

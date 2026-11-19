# Boston parking accuracy sample

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

Captured 30 public Booking.com properties on 2026-11-16 for December 10–11, 2026. Real provider batch; no fake parking or routing providers. Prices are a dated snapshot.

Baseline source links: 29/30 (96.7%). Accepted numeric fees: 23/30 (76.7%).

Exact fee + parking type accuracy among independently scorable numeric returns: 16/21 (76.2%). Using primary sources only: 14/19 (73.7%). Unknown and conflicting references are excluded from fee accuracy, not counted as correct.

The baseline misses the proposal's 80% accuracy target if either measured accuracy is below 80%. The stricter verifier and prompt were added after this run; these figures must not be presented as final-build performance. A fresh three-property run returned 0/3 accepted fees; that run failed its coverage assertion.

| Property | Baseline fee/type | Independent reference | Result |
| --- | --- | --- | --- |
| Hampton Inn Boston Logan Airport | 30 / self | [30; primary](https://www.hilton.com/en/hotels/boslahx-hampton-boston-logan-airport/) | match |
| Omni Boston Hotel at the Seaport | 49 / self | [60; primary](https://www.omnihotels.com/hotels/boston-seaport/property-details/policies) | WRONG |
| Hilton Boston Logan Airport | 58 / self | [58; primary](https://www.hilton.com/en/hotels/boslhhh-hilton-boston-logan-airport/hotel-location/) | match |
| The Westin Copley Place, Boston | 70 / valet | [70; primary](https://www.marriott.com/en-us/hotels/boswi-the-westin-copley-place-boston/overview/) | match |
| Hilton Garden Inn Boston Logan Airport | 20 / self | [25; primary](https://www.hilton.com/en-gb/hotels/boslogi-hilton-garden-inn-boston-logan-airport/hotel-info/) | WRONG |
| citizenM Boston Back Bay | unknown / none | [none; primary](https://www.marriott.com/en-us/hotels/boszb-citizenm-boston-back-bay/overview/) | not scored |
| DoubleTree by Hilton Hotel Boston Bayside | 25 / self | [27; primary](https://www.hilton.com/en/hotels/boschdt-doubletree-boston-bayside/hotel-location/) | WRONG |
| Embassy Suites Boston at Logan Airport | 60 / valet | [60; primary](https://www.hilton.com/en-gb/hotels/bosapes-embassy-suites-boston-at-logan-airport/hotel-info/) | match |
| DoubleTree by Hilton Hotel Boston - Downtown | 63 / valet | [65; primary](https://www.hilton.com/en/hotels/boscodt-doubletree-boston-downtown/hotel-info/) | WRONG |
| The Atlas Hotel Boston Cambridge | 55 / valet | [55; secondary](https://www.expedia.com/Boston-Hotels-The-Atlas-Hotel.h118784552.Hotel-Information) | match |
| Wyndham Boston Beacon Hill | 69 / valet | [70; primary](https://www.wyndhamhotels.com/wyndham/boston-massachusetts/wyndham-boston-beacon-hill/local-area) | WRONG |
| Hotel AKA Back Bay | 68 / valet | [68; primary](https://www.stayaka.com/hotel-aka-backbay/faq) | match |
| Hampton by Hilton at the Boston Seaport District | 62 / valet | [62; primary](https://www.hilton.com/en/hotels/bosbahx-hampton-boston-seaport-district/hotel-info/) | match |
| Hampton Inn & Suites Boston Crosstown Center | 30 / self | [30; primary](https://www.hilton.com/en/hotels/boshshx-hampton-suites-boston-crosstown-center/) | match |
| Boston Lodge and Suites | unknown / none | [none; secondary](https://www.booking.com/hotel/us/boston-luxury-suites.en-gb.html) | not scored |
| The Verb Hotel | 73 / valet | [73; primary](https://www.theverbhotel.com/faq/) | match |
| Hotel Commonwealth | 75 / valet | [75; primary](https://www.hotelcommonwealth.com/faq/) | match |
| Hilton Boston Park Plaza | 42 / self | [unknown; conflicting](https://www.hilton.com/en/hotels/bossrhh-hilton-boston-park-plaza/hotel-location/) | not scored |
| The Midtown Hotel MOD Collection by Sonesta | 45 / self | [45; primary](https://www.midtownhotel.com/parking-garage) | match |
| Hyatt Place Boston/Seaport District | 56 / valet | [valet; unresolved](https://www.hyatt.com/hyatt-place/en-US/boszs-hyatt-place-boston-seaport-district/faqs) | not scored |
| Hyatt Regency Boston Harbor | 49 / self | [49; secondary](https://www.expedia.com/Boston-Hotels-Hyatt-Regency-Boston-Harbor.h26283.Hotel-Information) | match |
| Yotel Boston | 80 / valet | [80; primary](https://helpcenter.yotel.com/hc/en-gb/articles/7005937612445-Is-there-parking-at-the-hotel-at-YOTEL-Boston) | match |
| Hilton Boston Back Bay | 69 / self | [69; primary](https://www.hilton.com/en/hotels/bosbhhh-hilton-boston-back-bay/hotel-location/) | match |
| Holiday Inn Express Boston by IHG | 20 / self | [20; primary](https://www.ihg.com/holidayinnexpress/hotels/us/en/boston/boshj/hoteldetail) | match |
| Copley Square Hotel, a FOUND Hotel | 65 / valet | [65; primary](https://www.foundhotels.com/copley-square/) | match |
| Charles River Inn | unknown / free | [0; secondary](https://www.booking.com/hotel/us/charles-river-motel.html) | not scored |
| Bay Village Suites | unknown / none | [none; secondary](https://www.expedia.com/Rooms-At-Premier-Suites-Bay-Village.h92422919.Hotel-Information) | not scored |
| Kasa Boston at Fenway | unknown / none | [none; primary](https://kasa.com/properties/kasa-boston-at-fenway) | not scored |
| Temple Place Suites 2+3 | unknown / unknown | [none; secondary](https://www.laterooms.com/hotel/boston/temple-place-suites-23/) | not scored |
| Kasa at Boston Common | unknown / none | [none; primary](https://kasa.com/properties/kasa-at-boston-common) | not scored |

Reference methodology and ambiguity notes: `parking-reference.json`. Detailed baseline: `parking-baseline.json`. Raw generated run: `../out/validation/boston-30-drive.json`.

All live cards omitted explicit tax lines in this US/USD search. The hardened build leaves their total incomplete; it does not infer zero tax. Several geocoding mismatches in the baseline are rejected by the final name guard. Ratings API matches and real traffic accuracy remain unmeasured.

Latest search-excerpt follow-up: 1/3 accepted, and that accepted fee was wrong ($20 vs $25 at Hilton Garden Inn). Quality target failed. See `live-search-followup.json`.

# Rating coverage and Google Travel attribution

2026-11-17 (America/Los_Angeles). Extension 0.4.1, model gpt-4o-mini.

## Why valid scores were missing

The running service had no Google/Tripadvisor API credentials; it used GPT web search. The old verifier
required direct platform domains, Google /maps/place/ URLs and 90% of hotel-name tokens in the URL path.
It could not accept an opaque Google Travel entity ID, even when that page clearly supplied the hotel
rating or an explicitly labeled Tripadvisor rating. The earlier 12-hotel browser sample had Google 0/12,
Tripadvisor 5/12; those older and newer samples are not an exact paired accuracy benchmark.

## Revised logic

- Prompt explicitly allows Google Travel hotel/reviews pages for Google user-review scores and separately
  attributed Tripadvisor scores. Scores out of five are distinct from hotel star classifications and
  ratings of other platforms. Ask for the actual evidence URL and a short supporting quote.
- Normalize a Google Travel entity URL across /reviews, tracking/stay query strings and regional Google
  domains. Use an actual search-tool source URL; do not manufacture a Google Maps or Tripadvisor URL.
- An original Tripadvisor link in the answer may be backed by Google Travel when the searched evidence
  quote explicitly identifies Tripadvisor and that numeric score. Returned url/sourceUrl points to the
  actual Google Travel evidence, and via is Google Travel.
- Match hotel names at 0.7 token similarity instead of 0.85 and relax readable URL token coverage from
  90% to 60%. Opaque entities use the matched hotel and, when informative, the source title. Generic Google
  Travel titles are not treated as conflicting hotel names. Clearly different properties stay rejected.
- Reject impossible/non-five-point values, missing actual source links, contradictory quote amounts,
  unrelated platform attribution, star classifications and recognizable sister-property mismatches.
- If only one platform is supported, make at most one focused follow-up for the missing platform. Keep
  the already accepted score. API request provenance/metadata and missing-score reasons are retained.
- Cache namespace ratings-llm-v4 invalidates old partial results. Failed lookups remain retryable.
- Extension displays **Google/Tripadvisor X (via Google Travel)** with the actual source link. Missing
  scores expose a reason tooltip. Searched claims continue to be labeled unverified; no independent
  fetch/API verification is implied by the changed acceptance rules.

## Evidence

| Test | Result | Report |
| --- | --- | --- |
| Offline suite | **69/69 pass**; includes shared intermediary, /reviews canonicalization, platform/amount conflicts, other properties, source links and targeted follow-up preservation | out/validation/ratings-v4-unit.log |
| First fresh 12-property search | Google **7/12**, Tripadvisor **11/12**, one transient fetch failure; exposed a wrong-platform quote for Westin Google | [First audit](ratings-first-12.json) |
| Final fresh 12-property search | Google **11/12**, Tripadvisor **12/12**; 3 focused follow-ups, 18.265 s for rating-only batch | [Final audit](ratings-final-12.json) |
| Actual Westin quote replay | The original Google Travel quote `Tripadvisor 4.2/5 · 5,173 reviews` is accepted as Tripadvisor 4.2 via Google Travel. This is a replay of real search evidence, not another network test | [Replay](ratings-westin-attribution-replay.json) |
| Installed-extension UI fixtures | Both platforms, intermediary labels and actual Google Travel links render; manual button/dedup/parking average/rank/restore/lazy-card tests pass | [UI report](ratings-attribution-ui.json) |
| Separate real Booking browser sample | **12 hotel results**, Google **11/12**, Tripadvisor **11/12**; 11 blocks show Google Travel attribution. Sorting, restore, redraw recovery and zero extra tabs pass; whole run 18.396 s with mixed caches | [Real extension](ratings-v4-extension-live.json) |

The final provider audit's eleven Google scores used Google Travel; its twelve Tripadvisor scores used
direct Tripadvisor sources. Thus that audit alone does not prove live Tripadvisor-via-Google attribution;
the explicit Westin real-evidence replay and UI/unit tests cover that route. A separate source-specific
live probe returned Westin Google 4.4 and Tripadvisor 4.2, but still chose a direct Tripadvisor link, so it
is not claimed as a successful Google-only extraction test.

In the final rating-only audit, Hotel AKA Back Bay still lacked a Google score after the targeted follow-up.
It remains unknown. Returned-score coverage does not measure whether every score is currently correct:
source excerpts are supplied by the model/search workflow, with no independent page read in this mode.

An initial extension attempt stopped at a harness assertion requiring 30 captured cards when Booking
exposed only 15. Background hotel HTML requests also hit their 12-second limit in that attempt. The final
rating-focused run explicitly required 12 captured cards (25 were actually available) and passed; it did
not wait for all hotel-tax tasks and does not establish new tax coverage or reliability.

## Reproduce

```sh
npm test
# With the bridge running, Chrome for Testing and Playwright available:
npm run test:manual-search-browser
TRUETRIP_TEST_MAX_CARDS=12 TRUETRIP_TEST_CAPTURE_CARDS=12 TRUETRIP_TEST_RATINGS=1 npm run test:browser -- --live
```

TRUETRIP_PLAYWRIGHT and TRUETRIP_BROWSER can point to existing runtime/executable paths. Real searches
can incur API charges. Source queries and scores change over time. Reload extension 0.4.1 and refresh
Booking.com to load the new source labels. The local bridge has been restarted with the revised provider.
# Current source-matching update

When a model returns a numeric Tripadvisor score with a matching generic review quote but supplies
an uncited listing URL, it may now use the same hotel's actually searched Google Travel entity.
That entity must be identified by a matching source title or linked to a supported Google score in
the same answer. The displayed link is the searched URL, not the invented listing URL. The original
quote is preserved; the score is marked `model-attributed` and remains unverified. Wrong hotel
names, explicit other-platform labels, mismatched numeric quotes and invalid score ranges remain
excluded. Older experiments below describe the earlier, stricter platform-attribution rule.

The actual cached Yotel response replays as Google 4.0 and model-attributed Tripadvisor 3.9 via
Google Travel without a new paid request. See `out/validation/yotel-relaxed-ratings.json`.


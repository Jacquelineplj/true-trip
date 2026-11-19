> Historical behavior: comparison-average parking estimates have been replaced by sourced nearby public parking or an explicit $50/night default. See [current public parking behavior](PUBLIC-PARKING.md).

# Average parking estimate for hotels without on-site parking

Date: 2026-11-16. User decision: when a hotel does not provide parking, calculate using the average of the other valid returned parking prices and label it as an estimate.

## Behavior

- Calculate the arithmetic mean of the valid numeric parking quotes among the hotels currently enriched in this comparison. Explicitly free parking ($0) is included. Failed, flagged, unknown and previously estimated values are excluded. Round the nightly average to two decimals.
- Apply the mean only to hotels that reported no on-site/managed parking with a source. Their status becomes `estimated`; the original `type:none`, source, quotation and lookup evidence remain. The estimate has a separate method and sample count. It is not a newly discovered off-site quote.
- Show `Parking: estimated off-site $X.XX/night` and `no on-site parking; average of N valid hotel quotes in this search`. Recalculate drive totals, budget checks, ranking and comparisons. Multiply the nightly amount by the stay length. Ride totals do not acquire a parking charge.
- The extension enriches cards individually, then sends the current comparison set to `/notes`. That endpoint returns adjusted hotels, totals and rankings. The cards are rerendered after aggregation, and existing sort/rank state is maintained. Loading more results refreshes the average using actual quotes only.
- Batch/CLI `/enrich` uses the same helper after all results arrive. CLI estimates use `~$` in the table and an explicit estimate label in the detailed block. Estimates never enter the provider's price cache.
- If there are no valid quotes, parking remains unknown. If all donor quotes are explicitly free, the average is zero but is still labeled an off-site estimate rather than a confirmed free-parking offer. Source lookup failures and contradictory prices are not given this fallback.

## Validation

- **59/59 offline tests passed**: average includes zero/free prices, excludes flagged/unknown/estimated prices, updates multi-night costs, ranking and budget alerts, recomputes incremental comparisons without recursive averaging, clears estimates when donors disappear, and preserves ride totals.
- Browser DOM regression **passed** using deterministic provider fixtures and the actual updated localhost `/notes` endpoint: two quotes ($20/$40) produce three $30/night estimates; an unresolved lookup stays unknown; labels, sorting and all rank badges survive DOM replacement. This is a UI/aggregation fixture test, not a fresh GPT or hotel-price accuracy test. [Browser report](parking-average-browser.json).
- Replay of the saved real GPT-4o 30-hotel results: **22 numeric quotes total $1,123; mean $51.05/night**. All six no-on-site-parking results receive that estimate. The two inconsistent quote/amount results remain flagged. Replay uses fixture room prices and synthetic routes solely to exercise calculation; it is not a new source or traffic validation run. [Replay report](parking-average-replay.json).

The raw search benchmark remains 22 numeric quotes, 6 no-parking results, and 2 held results. Estimates do not increase sourced-price coverage or count as correct prices in the benchmark.

```bash
npm test
npm run server
npm run test:parking-estimate-browser
```

The Node bridge was restarted with this aggregation logic. Reload the unpacked extension and refresh the search page to load the updated UI.

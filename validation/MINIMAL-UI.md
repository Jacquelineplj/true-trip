# Minimal visual design and clear tax copy

2026-11-17 (America/Los_Angeles). Extension/package 0.5.0.

Cards, toolbar, on-demand magnifier, settings and popup now share neutral white/gray surfaces, subtle
borders, rounded corners, light shadows and restrained blue controls. Typography uses -apple-system /
BlinkMacSystemFont / SF Pro Text / Helvetica Neue / Segoe UI; no font is downloaded or bundled. Total
trip cost has larger type, with muted supporting detail, a drive/ride chip and a small TrueTrip mark.

The toolbar uses a translucent white surface and hides an empty comparison-notes area. Keyboard focus,
disabled/loading controls, narrow layouts and reduced-motion preferences are styled. CSS stays scoped to
TrueTrip components on Booking pages.

## Tax copy

- A positive tax amount: **Tax not included in room price; added above**.
- Explicit included tax (zero additional tax): **Tax included in room price.**
- Unknown tax: **Tax amount unavailable; total remains incomplete.**
- Zero additional tax without explicit included evidence: **No additional tax shown.**

The raw Included/Excluded source terms are retained in the source link's tooltip and its destination,
not repeated as confusing main card copy. Price/tax calculations, rounding and data access are unchanged.

## Checks and evidence

- `npm test`: **69/69 pass** (`out/validation/minimal-ui-unit.log`).
- [Installed-extension UI fixture](minimal-ui-browser.json): positive/included/unknown tax copy, no
  visible Excluded text for the positive case, Google Travel attribution, manual requests, duplicate clicks,
  parking means, sorting, restore, lazy-loaded cards and unique panels all pass. The card fits a 390 px
  viewport. Data here is illustrative; provider responses are fixtures and /notes is the real local service.
- [Real Booking + taxes](minimal-ui-live.json): three real hotel results, **3/3 tax lines use the new
  wording**, no duplicate cards, sorting / redraw recovery / original-order restore and **0 extra tabs**
  pass. Total run 16.688 s with mixed caches. This run disabled cross-platform ratings to focus on tax/style;
  n/a in its screenshot is not a new rating-coverage finding.
- Screenshots were visually reviewed: `out/validation/minimal-card.png`, `minimal-toolbar.png`,
  `minimal-search.png`, `minimal-card-mobile.png`, `minimal-settings.png`, `minimal-popup.png`, and the
  actual Booking `booking-enrichment.png`. Settings column label heights were aligned after review.
- An initial screenshot harness failed when URL.origin returned null for chrome-extension URLs.
  The harness now uses the explicit extension scheme/host; the corrected test passed. It was a test
  navigation issue, not a product failure.

Reproduce with the bridge running:

```sh
npm test
npm run test:manual-search-browser
TRUETRIP_TEST_CAPTURE_CARDS=3 npm run test:browser -- --live --taxes
```

Set TRUETRIP_PLAYWRIGHT/TRUETRIP_BROWSER for an installed module/Chrome for Testing if needed.
Reload the unpacked extension and refresh Booking.com after this update.

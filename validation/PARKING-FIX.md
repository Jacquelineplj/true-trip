# Parking source verification update — 2026-11-16

The old 16/21 (76.2%) baseline remains a recorded failure. The replacement provider does not accept a model's numeric answer or a matching-looking quotation as proof of the fee.

## Implemented

- Claude discovers property URLs only. The service separately fetches the source with HTTP or visible Chrome, checks the hotel identity, and parses the fetched text.
- Official parking policies, FAQ and transportation pages precede overview pages. Same-page conflicting fees are rejected. Hourly, restaurant, event, oversized-vehicle, package and nearby-garage rates are excluded. Self parking takes priority when both self and valet guest rates are offered.
- Expedia/Hotels.com/Booking are lower-tier fallbacks. Only explicit parking terms/amenities are used; reviews and search snippets are not accepted. Expedia disclosures are expanded read-only where available.
- Legacy numeric parking caches are ignored. Old entries may supply URLs only. New evidence expires after 24 hours for official pages and 6 hours for OTA terms. Unknown results are not cached. Every accepted rate carries a fetch time, method, source tier and text hash; normalized fetched text is archived locally under `.cache/parking-evidence/`.
- HTTP-200 challenge pages are recognized as failures. Privacy links and duplicate anchors cannot consume the source-follow budget. Missing source access leaves the fee unknown and the drive total incomplete.
- The CLI closes its source browser on completion; the server shares a browser context and closes each source tab. Local Chrome and Playwright are required for browser fallback. No reservation/payment controls are clicked.

These are current **published** parking policies, not guaranteed quotes for the selected stay dates. Fetch freshness does not prove the hotel has updated its own page. A higher-priority policy page can differ from an overview page.

## Validation

Results of the full run are recorded below after completion. The acceptance gate stays at 70% numeric coverage, at least 80% exact fee/type accuracy, and at least 10 independently scorable returns for the 30-property audit. Unknowns are abstentions and reduce coverage; they are never counted as correct fees.

The original property population is preserved in `fixtures/boston-parking-audit.json`. Reference amounts live only in validation files and are not read by the runtime provider.

```bash
npm test
npm run test:tax-browser
TRUETRIP_PARKING_REPORT=out/validation/parking-final-batch.json \
  npm run test:live -- fixtures/boston-parking-audit.json
```

Live tests explicitly use network services and paid Claude URL discovery. Reports are saved before a quality assertion fails. Repeated source retrieval can fail even after an earlier successful read, so successful small samples must not be presented as citywide coverage.

## Measured result

- Offline regression suite: **44/44 passed**. Browser DOM tax regression: **passed** (cheapest available room, sold-out exclusion, percentage/fixed charges, missing-date handling).
- Fresh real 30-property run: **6 accepted numeric fees, 6/6 matching the independent fee/type reference**. Numeric coverage **6/30 = 20%**; resolved coverage including two confirmed no-on-site-parking policies **8/30 = 26.7%**. The other 22 remain unknown. The run **failed its quality gate**; six scored prices are too few to establish the target accuracy, and coverage is far below 70%.
- Accepted: Omni $60 self, AKA $68 valet, Verb $73 valet, Commonwealth $75 valet, Yotel $80 valet, Holiday Inn Express $20 self. Kasa Fenway and Kasa Boston Common report no managed parking; neither becomes a $0 drive cost.
- The final sister-property and event/off-site parent-section guards were added after the full network run. All eight accepted/resolved source texts were replayed through those final guards without changing any result. This replay is **not** a second fresh network run.
- An earlier four-property Marriott supplemental run returned **0/4** and failed coverage. This corroborates access failures; it does not validate prices on those properties.
- The full run reported **$2.412297** in Claude URL-discovery cost, excluding subscription accounting, bandwidth and machine time. Runtime discovery URLs are cached 30 days; numeric evidence has the shorter TTLs above.

Reports: [full 30-property run](parking-source-verified.json), [final text replay](parking-source-replay.json), [failed supplemental sample](parking-extra-failed.json). Raw normalized source text is local and ignored by git. The historical baseline remains in [parking-baseline.json](parking-baseline.json).

## Remaining dependency

The code now rejects unsupported/stale claims, but source access is still inadequate for release. Hilton/Marriott/Expedia repeatedly served access/error pages in visible Chrome as well as direct HTTP. A public page-reader diagnostic also failed; no proxy dependency was added. Booking access did not expose unambiguous daily self/valet terms for the unresolved sample. Relaxing the verifier or accepting search snippets would reintroduce the demonstrated old-price errors.

A reliable property/OTA parking data feed, or a supported way to read explicit parking terms from the traveler's permitted hotel-detail session, is still needed. Validate that source on the same 30 properties and a new sample before claiming the 70% coverage / 80% accuracy target. API ratings and traffic accuracy remain outside this parking fix.

Restart the Node bridge and reload the unpacked extension to use this provider. Existing running Node processes retain their old modules until restarted.

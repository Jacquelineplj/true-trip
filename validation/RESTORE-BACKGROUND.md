# Restore original order and invisible hotel reads

2026-11-16 (America/Los_Angeles). Extension/package 0.3.0.

## Behavior

- **Sort by true trip cost** keeps its current action. A separate **Restore original order** button
  returns all observed hotel containers to their original DOM slots, including hotels beyond the
  enrichment limit, and clears TrueTrip ranks. New results no longer reapply true-cost sorting after
  restoration. Sorting can be repeated. The banner and restore state survive page redraws.
- Original-position comment markers stay in the result list while hotel containers move. Redrawn cards
  are associated with the existing slot by property name and URL. TrueTrip does not change Booking's
  own sorting dropdown or reload the search.
- Missing taxes first use an ordinary background-worker HTTP request to the Booking hotel URL. Dates,
  currency and one-room settings are preserved; redirects dropping dates are rejected. Returned HTML
  is parsed in an inert DOMParser document with the existing cheapest-room reader; its scripts are not run.
- If HTML lacks the table, `/hotel-taxes` uses a separate headless Chromium browser in the local bridge,
  with two concurrent reads, shared in-flight requests, five-minute success caching and per-read context
  cleanup. Delayed navigation is retried without accepting an undated price. The bridge closes its browser
  on shutdown. Optional independent parking-page reads are now also headless.
- No `chrome.tabs.create/remove` calls remain and hotel-page content-script registration was removed.
  The extension never falls back to opening a visible tab. A blocked/unreadable hotel stays unknown and
  keeps its total incomplete when taxes are required. This can reduce tax availability on blocked pages.

## Validation

- `npm test`: **64/64 pass** (`out/validation/restore-headless-unit.log`).
- Slow-request fixture browser: pass, six requests / peak four, no duplicate blocks, average parking,
  rank recovery after card replacement, original-order restoration after replacement, repeated sort /
  restore toggles, and restored order unchanged after observer work. This uses deterministic provider
  fixtures and the real localhost aggregation endpoint. [Report](restore-order-browser.json).
- Final installed extension on real Booking.com: **pass**, 30 actual cards captured, 3 real provider
  results, all 3 cheapest-room tax lines returned, sorting, redraw recovery and original-order restoration
  passed; **0 new tabs** in the extension's browser context. No tax tabs were allowed by the new code.
  [Report](restore-headless-extension.json).
- Direct headless-only experiments returned unknown, including navigation losing stay dates. The earlier
  headless-only installed-extension test did not meet the tax assertion. Those are failures, not successful
  tax validation. The final background HTTP path plus invisible fallback passed the real test above;
  headless fallback alone is not claimed reliable on Booking.com.

Reproduce with `npm test`, then `npm run server` in one terminal and
`npm run test:parking-estimate-browser` / `npm run test:browser -- --live --taxes` in another.
Browser tests require Chrome/Playwright. Real tests use Booking, OpenAI and mapping services; their
availability and returned prices vary. Reload TrueTrip in `chrome://extensions` and refresh Booking.com
before testing version 0.3.0.

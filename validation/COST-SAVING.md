# Cost-saving behavior

The extension automatically enriches five hotels. Other cards require Search this hotel.
Load ratings and Search deeper are Settings checkboxes, both off by default; hotel cards have
neither button. Enabling Load ratings includes Google/Tripadvisor scores in hotel lookups.
Enabling Search deeper permits one dedicated parking-only GPT-4o-mini OTA search when the primary parking answer has no
usable numeric price. Usable primary fees need no fallback. Save Settings and reload results
to apply changes. Default lookups never upgrade automatically.

The default server shares one property research response between parking, address resolution
and (when enabled or requested) ratings. Existing parking and rating validators still check the
individual fields and source links. The initial request is capped at one search-tool call and 1,100 output
tokens. Its optional OTA retry has a separate cache key and permits one search-tool call and 700
output tokens. No GPT-4.1 call is made by this retry. This cap reduces research depth; unavailable prices remain unknown.

Successful property data is cached seven days. Completely missing fee/policy/ratings answers
expire after 30 minutes; ordinary request failures after five minutes; auth/quota failures after
one minute. Identical in-flight lookups share a promise. Canonical property links exclude dates
and session/tracking parameters. Search timestamps survive cache reads. Individual prices and
ratings can change during this cache period; the parking checked date is displayed on cards.

Verification: `npm test` covers request sharing, missing-result caching, short TTL expiry,
explicit model selection, retained validation and one-time extension settings migration.
`npm run test:economy-browser` uses an installed extension with intercepted API responses:
five automatic hotels, persisted ratings/deeper-search settings applied after reload,
recomputed costs, sorting, manual sixth hotel and Settings. It makes no paid API requests.
The browser report and screenshot are in `out/validation/economy-browser.json` and `.png`.

This is not a live accuracy comparison of combined vs separate research prompts. Actual
savings depend on cache hits and manual use; model-request reductions do not by themselves
establish an identical percentage reduction in the bill.

The five-hotel update also records every actual OpenAI API attempt in `.usage/requests.jsonl`.
The English dashboard at `/usage` shows one total per Booking results-page load, with the
latest 200 page loads and an overall known estimated USD total. Ratings, manual hotel searches
and deeper searches stay with the originating page. A refresh gets a new ID. Cache-only and
zero-query page loads show zero; unknown charges remain explicit. The Booking banner also
shows the current estimated page cost when results update. Each request internally stores its rate snapshot and reported usage;
cached input tokens use the discounted rate and search content input is not added twice.
Rates are estimates from official public standard prices checked 2026-11-17, not invoice data.
Missing usage and unpriced models are unknown rather than zero. Queries before this update
are not backfilled. Cache-hit events have zero new API expense. Keys, full prompts and answers
are excluded from the expense ledger. The browser test verifies fixture expenses on this page
without adding fabricated records to the real ledger or making paid requests.

Free-parking validation repairs self/unknown/free type and missing/zero numeric amounts only when
there is an explicit, unconditional sourced guest-parking quote. Provenance/freshness, confidence,
on-site scope and positive-fee consistency checks still apply. An offline replay of the fixed random
10-property comparison increased numeric coverage from 5 to 6 for OTA-only and from 5 to 7 for the
cascade. The cascade also skipped two formerly unnecessary OTA calls. The remaining three cascade
properties returned no-on-site-parking policies, not numeric on-site fees. Original live measurements
are preserved; the replay is not a new live accuracy or cost measurement.

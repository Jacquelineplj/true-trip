# Nearby public parking and the $50 default

When a source-backed policy explicitly says that a hotel has no on-site parking,
TrueTrip runs one dedicated GPT-4o-mini search for a named public garage/lot within
approximately 1 km. This happens whenever parking lookup is enabled, independently
of the Search deeper checkbox. A confirmed no-on-site policy goes directly to this
search instead of repeating the hotel-only OTA query.

The query asks for a standard overnight/24-hour price, facility name and address,
approximate distance, actual searched source URL and an amount/rate quote. Hourly,
event, package, subscriber and time-restricted evening-special prices do not qualify.
The public result has separate validation and `type: public`, `scope: off-site`.
It is never represented as hotel-operated parking. Search-derived distances remain
approximate, and searched prices are not independently verified booking quotes.

If no usable public price is returned, including an API error, TrueTrip uses **$50
per vehicle per night**. The card says **default estimate** and **not a quoted rate**.
The hotel policy is preserved separately; its URL is not passed off as evidence
for the $50 amount. Failure to find a rate does not assert that no nearby garage exists.

The sourced public rate or default is included in drive totals, multiplied by stay
nights, and used for budget checks and sorting. Ride totals exclude parking. Tax
repricing and incremental result aggregation preserve the selected public/default
amount. The previous average-of-other-hotels estimate is retired; the legacy
`parkingAverage` response field is empty for compatibility.

Public queries share in-flight work and use an independent property/model cache key.
Usable prices are cached seven days; misses 30 minutes; ordinary errors five minutes;
auth/quota errors one minute. Each query permits one search-tool call and 700 output
tokens. Model usage is recorded under `hotel_public_parking` and grouped with its
originating Booking page load by the existing expense ledger.

Validation includes sourced-price/default branches, rejected distant/hourly/time-restricted/
uncited quotes, concurrency and cache reuse, no unnecessary OTA retry, multi-night
drive/ride totals, tax repricing and incremental notes aggregation. The installed
extension browser regression checks the distinct public-price and default-estimate
labels and sorting without paid requests.

A three-property live public-search experiment reused recorded hotel no-parking
policies to avoid repeating the initial paid lookup. The model returned a $38
10–24-hour Arlington Street Lot quote for Bay Village Suites. The operator page
lists that rate but dates its rate update to 2021, so this is a published searched
quote, not proof of the present charge. For the two Kasa properties the model
returned restricted entry/early-exit specials; these were rejected and the labeled
$50 default applied. The three public searches cost approximately $0.034337 in
model/tool fees. The source search responses and validation results are saved in
`out/validation/public-parking-live.json`. Public coverage and default estimates
must not be combined into a claimed verified-price coverage rate.

# Location fallback coverage (0.5.15)

1. Read coordinates from Booking's hotel header, map-marker link, geo microdata or Hotel JSON-LD (including linked graph nodes), sharing the room/tax response.
2. Reuse sourced address coordinates and validated legacy geocode cache entries.
3. Try the original street address, expanded abbreviations, then street + city without neighbourhood/country noise (at most three distinct forms).
4. For each query, check all candidates from Photon, then Nominatim, then optional Google Geocoding. Validate coordinate bounds, city proximity and building/name evidence before stopping.
5. Try the full hotel name/city, a name without the chain suffix, and the full name alone; the original property identity remains the validation target.
6. Use the existing combined mini research for a sourced address only after map lookup fails, then store successful coordinates for reuse. No second LLM address search was added.

Negative geocode results expire after five minutes. A city centre or a street-only result is not substituted for the hotel's location. No new map credentials are required. Optional configured Google Geocoding retains its own pricing.

Validation: 129 offline tests passed, including second-candidate success, simplified addresses, hotel-name variants, sourced-cache reuse, short negative caching, structured-data references, microdata and marker links. Installed-extension location and economy/time-sort regressions passed with fixture responses and zero paid API requests. These are functional coverage tests, not a measured live-hotel coverage percentage.

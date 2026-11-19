# Booking location reuse (0.5.10)

The shared Booking detail-page reader extracts the visible street address and hotel-scoped map coordinates or Hotel/LodgingBusiness JSON-LD. It returns location metadata even when availability/taxes are missing. Unrelated structured entities and invalid coordinates are ignored.

When a result card has neither coordinates nor a numbered street address, enrichment waits for location evidence from the existing detail-page read. It can start before slower tax recovery finishes. The same HTTP response supplies both tax and location parsing. When taxes are already known, address/coordinates alone stop the lookup without launching tax recovery. If page evidence is unavailable, existing map/name lookup and LLM fallback remain. Parking and optional ratings can still incur their usual costs; no fixed dollar saving per hotel is claimed because research requests/cache hits can already be shared.

Validation: 113 offline tests passed. Installed-extension regression with intercepted Booking/bridge responses passed both included-tax and missing-tax scenarios. Both used one HTML fetch and zero LLM address lookups; only missing taxes triggered the existing browser tax reader. The economy/settings/cost display browser regression also passed. No paid API tests were used.

Reports: `out/validation/booking-location-browser.json`, `out/validation/economy-browser.json`.

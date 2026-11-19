# Hampton Seaport: hotel-location failure

The hotel name used by Booking is Hampton by Hilton at the Boston Seaport District.
Its sourced street address is 670 Summer Street, Boston, MA 02210.

The previous resolution failed in three connected places:

1. The full branded-name query returned no usable point. Name matching treated the
   optional `by Hilton` branding as a required token, rejecting some map-name variants.
2. The address fallback appended Boston to an address that already contained Boston.
   Photon returned a street-level Summer Street point (42.3497722, -71.0492587), not
   house number 670. Generic geocoding accepted and cached that point, so Nominatim
   was not tried. The outer hotel validator then correctly rejected the street point.
3. An older sourced address cache already held the correct building coordinates
   (42.3404878, -71.0354559), but the newer shared-research fallback did not reuse it.

The fix reuses matched, sourced address-cache entries; normalizes optional chain
branding while retaining distinguishing hotel-name tokens; and validates street/
building results inside the geocoder provider loop. Address lookups now use their
own cache key and bypass unsuitable cached street-only results. They avoid duplicate
city suffixes and can expand MA to Massachusetts for an additional address query.

Regression tests reject Homewood sister-property matches, street-only points and
wrong house numbers, and verify provider fallback and sourced-cache reuse.

The free routing verification in `out/validation/hampton-location-fix.json` restored
the building point without any model calls. Its route lookups returned approximately
11.17 minutes to MIT Media Lab and 2.31 minutes to Boston Convention and Exhibition
Center. These are single-direction OSRM route estimates, not live-traffic forecasts.

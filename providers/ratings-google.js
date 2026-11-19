// Google Places API (New) Text Search. Needs GOOGLE_MAPS_API_KEY with Places API (New) enabled.
import { postJSON } from './http.js';
import { makeCache } from './cache.js';
import { bestMatch } from '../core/match.js';

const cache = makeCache('ratings-google', { ttlMs: 7 * 86400000 });

export function available() { return Boolean(process.env.GOOGLE_MAPS_API_KEY); }

/** @returns {{rating, reviews, url, matchedName, match}|null|{error}} */
export async function googleRating(hotel) {
  if (!available()) return { error: 'GOOGLE_MAPS_API_KEY not set' };
  const q = [hotel.name, hotel.city].filter(Boolean).join(', ');
  return cache.wrap(['v1', q], async () => {
    try {
      const body = { textQuery: q, includedType: 'lodging', maxResultCount: 5 };
      if (hotel.location) body.locationBias = { circle: { center: { latitude: hotel.location.lat, longitude: hotel.location.lon }, radius: 2000 } };
      const j = await postJSON('https://places.googleapis.com/v1/places:searchText', body, {
        headers: { 'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY, 'X-Goog-FieldMask': 'places.displayName,places.rating,places.userRatingCount,places.location,places.googleMapsUri,places.formattedAddress' },
      });
      const cands = (j.places ?? []).map((p) => ({ name: p.displayName?.text, location: p.location ? { lat: p.location.latitude, lon: p.location.longitude } : null, rating: p.rating, reviews: p.userRatingCount, url: p.googleMapsUri }));
      const m = bestMatch({ name: hotel.name, location: hotel.location }, cands);
      if (!m) return null;
      return { rating: m.candidate.rating ?? null, reviews: m.candidate.reviews ?? null, url: m.candidate.url, matchedName: m.candidate.name, match: m.result, source: 'google-places' };
    } catch (e) { return { error: String(e.message ?? e) }; }
  });
}

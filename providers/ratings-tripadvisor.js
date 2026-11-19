// Tripadvisor Content API. Needs TRIPADVISOR_API_KEY (free tier: 5,000 calls/month).
import { getJSON } from './http.js';
import { makeCache } from './cache.js';
import { bestMatch } from '../core/match.js';

const cache = makeCache('ratings-tripadvisor', { ttlMs: 7 * 86400000 });

export function available() { return Boolean(process.env.TRIPADVISOR_API_KEY); }

export async function tripadvisorRating(hotel) {
  if (!available()) return { error: 'TRIPADVISOR_API_KEY not set' };
  const key = process.env.TRIPADVISOR_API_KEY;
  const q = [hotel.name, hotel.city].filter(Boolean).join(', ');
  return cache.wrap(['v1', q], async () => {
    try {
      let url = `https://api.content.tripadvisor.com/api/v1/location/search?key=${key}&searchQuery=${encodeURIComponent(q)}&category=hotels&language=en`;
      if (hotel.location) url += `&latLong=${hotel.location.lat},${hotel.location.lon}&radius=3&radiusUnit=km`;
      const s = await getJSON(url, { headers: { Referer: 'https://github.com/Jacquelineplj/ps06' } });
      const cands = (s.data ?? []).map((d) => ({ name: d.name, location: null, id: d.location_id }));
      const m = bestMatch({ name: hotel.name, location: null }, cands);
      if (!m) return null;
      const d = await getJSON(`https://api.content.tripadvisor.com/api/v1/location/${m.candidate.id}/details?key=${key}&language=en&currency=USD`, { headers: { Referer: 'https://github.com/Jacquelineplj/ps06' } });
      return { rating: d.rating != null ? Number(d.rating) : null, reviews: d.num_reviews != null ? Number(d.num_reviews) : null, url: d.web_url, matchedName: d.name, match: m.result, source: 'tripadvisor' };
    } catch (e) { return { error: String(e.message ?? e) }; }
  });
}

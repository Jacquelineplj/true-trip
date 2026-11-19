// Matching the same hotel across platforms: name similarity + location.
import { haversineKm } from './geo.js';

const STOP = new Set(['the', 'a', 'an', 'of', 'and', '&', 'at', 'in', 'on', 'by', 'hotel', 'hotels', 'inn', 'suites', 'resort', 'downtown']);

export function normalizeName(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(name, { keepStop = false } = {}) {
  return normalizeName(name)
    .split(' ')
    .filter((t) => t && (keepStop || !STOP.has(t)));
}

/** Dice coefficient over tokens, 0..1. Falls back to stop-word tokens if nothing else remains. */
export function nameSimilarity(a, b) {
  let ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length) { ta = tokens(a, { keepStop: true }); tb = tokens(b, { keepStop: true }); }
  if (!ta.length || !tb.length) return 0;
  const sa = new Set(ta), sb = new Set(tb);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return (2 * inter) / (sa.size + sb.size);
}

/**
 * Decide whether `candidate` (from Google/Tripadvisor) is the same hotel as `target` (from Booking).
 * Both: { name, location?: {lat, lon} }. Returns { match: boolean, score, distanceKm, reason }.
 */
export function isSameHotel(target, candidate, { maxDistanceKm = 0.5 } = {}) {
  const score = nameSimilarity(target.name, candidate.name);
  const distanceKm = haversineKm(target.location, candidate.location);
  if (distanceKm != null) {
    if (distanceKm > 2) return { match: false, score, distanceKm, reason: 'too far apart' };
    if (score >= 0.5 && distanceKm <= maxDistanceKm) return { match: true, score, distanceKm, reason: 'name+location' };
    if (score >= 0.85 && distanceKm <= 2) return { match: true, score, distanceKm, reason: 'strong name, nearby' };
    return { match: false, score, distanceKm, reason: 'weak name match' };
  }
  if (score >= 0.85) return { match: true, score, distanceKm, reason: 'strong name only' };
  return { match: false, score, distanceKm, reason: 'no location, weak name' };
}

/** Pick the best matching candidate or null. */
export function bestMatch(target, candidates, opts) {
  let best = null;
  for (const c of candidates ?? []) {
    const r = isSameHotel(target, c, opts);
    if (r.match && (!best || r.score > best.result.score)) best = { candidate: c, result: r };
  }
  return best;
}

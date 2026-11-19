// Routing: Google Directions if GOOGLE_MAPS_API_KEY is set, else OSRM demo server (free, car profile only).
// Falls back to a straight-line estimate (flagged) if the router is unreachable.
import { getJSON } from './http.js';
import { makeCache } from './cache.js';
import { haversineKm, estimateDriveFromStraightLine } from '../core/geo.js';

const cache = makeCache('route', { ttlMs: 7 * 86400000 });

async function osrm(a, b) {
  const url = `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`;
  const j = await getJSON(url,{timeoutMs:4500});
  const r = j.routes?.[0];
  if (!r) return null;
  return { distanceKm: r.distance / 1000, durationMin: r.duration / 60, provider: 'osrm', estimated: false };
}

async function googleDirections(a, b, mode) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${a.lat},${a.lon}&destination=${b.lat},${b.lon}&mode=${mode}&key=${key}`;
  const j = await getJSON(url,{timeoutMs:4500});
  const leg = j.routes?.[0]?.legs?.[0];
  if (!leg) return null;
  return { distanceKm: leg.distance.value / 1000, durationMin: (leg.duration_in_traffic ?? leg.duration).value / 60, provider: 'google', estimated: false };
}

/** Driving route between two {lat, lon}. Returns {distanceKm, durationMin, provider, estimated}. */
export async function driveRoute(a, b) {
  if (!a || !b) return null;
  const k = ['drive', a.lat.toFixed(5), a.lon.toFixed(5), b.lat.toFixed(5), b.lon.toFixed(5)];
  return cache.wrap(k, async () => {
    try {
      const r = process.env.GOOGLE_MAPS_API_KEY ? await googleDirections(a, b, 'driving') : await osrm(a, b);
      if (r) return r;
    } catch { /* fall through */ }
    const est = estimateDriveFromStraightLine(haversineKm(a, b));
    return est ? { ...est, provider: 'straight-line' } : null;
  });
}

/** Walking estimate: 1.25x straight line at 4.8 km/h. */
export function walkEstimate(a, b) {
  const km = haversineKm(a, b);
  if (km == null) return null;
  return { distanceKm: km * 1.25, durationMin: (km * 1.25 / 4.8) * 60, provider: 'estimate', estimated: true };
}

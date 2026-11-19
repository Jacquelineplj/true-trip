// Ride-hail fare estimate as a range. Per-leg, in USD.
// Rough UberX-style structure. City multipliers are coarse; outside calibrated cities the range is widened.
// Boston/Cambridge is calibrated against 12 real UberX list prices (fixtures/uber-quotes-boston-2026-11-18.json):
// multiplier 1.7 centers the estimate (median quote/estimate = 1.0) and the 0.7-1.5 range holds 11 of the 12.
// That is one weekday-afternoon snapshot. The other multipliers are uncalibrated guesses.

const CALIBRATED = ['boston', 'cambridge'];
const CITY_MULTIPLIER = {
  'new york': 1.45, 'nyc': 1.45, 'manhattan': 1.45, 'brooklyn': 1.4,
  'san francisco': 1.35, 'boston': 1.7, 'cambridge': 1.7, 'chicago': 1.1,
  'los angeles': 1.1, 'washington': 1.15, 'seattle': 1.2, 'miami': 1.0,
  'las vegas': 0.95, 'austin': 0.95, 'denver': 1.0, 'atlanta': 0.95,
};

export function cityMultiplier(city) {
  const c = String(city ?? '').toLowerCase();
  for (const [k, v] of Object.entries(CITY_MULTIPLIER)) if (c.includes(k)) return { mult: v, tested: CALIBRATED.includes(k) };
  return { mult: 1.0, tested: false };
}

/**
 * @param {{distanceKm:number, durationMin:number, city?:string}} leg
 * @returns {{low:number, high:number, mid:number, tested:boolean}}
 */
export function estimateFare({ distanceKm, durationMin, city }) {
  if (distanceKm == null || durationMin == null) return null;
  const miles = distanceKm / 1.609344;
  const { mult, tested } = cityMultiplier(city);
  const base = 2.75 + 0.36 * durationMin + 1.45 * miles + 2.95; // base + time + distance + booking fee
  const mid = Math.max(8.5, base * mult);
  const spread = tested ? [0.7, 1.5] : [0.7, 1.9]; // observed spread where calibrated, wider elsewhere
  return { low: round2(mid * spread[0]), high: round2(mid * spread[1]), mid: round2(mid), tested };
}

export function round2(x) { return Math.round(x * 100) / 100; }

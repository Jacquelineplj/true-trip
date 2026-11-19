// Parsers for text scraped from a Booking.com results card.
// Pure functions, no I/O.

const CURRENCY_SYMBOLS = { '$': 'USD', 'US$': 'USD', 'USD': 'USD', '€': 'EUR', '£': 'GBP', 'CA$': 'CAD', 'C$': 'CAD', 'A$': 'AUD' };

/** "US$978" | "$1,182" | "€120.50" -> { amount: 978, currency: 'USD' } or null */
export function parseMoney(text) {
  if (text == null) return null;
  const s = String(text).replace(/ /g, ' ').trim();
  const m = s.match(/(US\$|CA\$|C\$|A\$|USD|EUR|GBP|CAD|AUD|[$€£])\s*([\d.,]+)/);
  if (!m) {
    const bare = s.match(/^([\d.,]+)$/);
    if (!bare) return null;
    return { amount: toNumber(bare[1]), currency: null };
  }
  return { amount: toNumber(m[2]), currency: CURRENCY_SYMBOLS[m[1]] ?? null };
}

function toNumber(s) {
  // Handle "1,182" and "1.182,50" (EU) heuristically: if last separator is a comma followed by 2 digits, it's decimal.
  const t = s.replace(/\s/g, '');
  if (/,\d{2}$/.test(t) && !/\.\d{2}$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
  return Number(t.replace(/,/g, ''));
}

/** "Scored 8.7 8.7 Excellent 3,634 reviews" -> { score: 8.7, label: 'Excellent', reviews: 3634 } */
export function parseBookingScore(text) {
  if (!text) return { score: null, label: null, reviews: null };
  const s = String(text).replace(/\s+/g, ' ').trim();
  const score = s.match(/(\d{1,2}(?:\.\d)?)/);
  const reviews = s.match(/([\d,]+)\s+reviews?/i);
  const label = s.match(/(Exceptional|Wonderful|Excellent|Very Good|Good|Pleasant|Review score|Fabulous|Superb)/i);
  return {
    score: score ? Number(score[1]) : null,
    label: label ? label[1] : null,
    reviews: reviews ? Number(reviews[1].replace(/,/g, '')) : null,
  };
}

/** "2 nights, 2 adults" -> 2 ; "1 night, 1 adult" -> 1 */
export function parseNightsText(text) {
  const m = String(text ?? '').match(/(\d+)\s+nights?/i);
  return m ? Number(m[1]) : null;
}

/** ISO dates "2026-03-10", "2026-03-12" -> 2 */
export function nightsBetween(checkin, checkout) {
  if (!checkin || !checkout) return null;
  const a = Date.parse(checkin + 'T00:00:00Z');
  const b = Date.parse(checkout + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const n = Math.round((b - a) / 86400000);
  return n > 0 ? n : null;
}

/** "1.2 km from downtown" | "0.8 miles from center" -> km number or null */
export function parseDistanceKm(text) {
  const m = String(text ?? '').match(/([\d.]+)\s*(km|mi|miles?|m)\b/i);
  if (!m) return null;
  const v = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === 'km') return v;
  if (unit === 'm') return v / 1000;
  return v * 1.609344;
}

/** Split "MIT Media Lab; Boston Convention Center" into trimmed anchor strings (max 3). */
export function parseAnchors(text) {
  return String(text ?? '')
    .split(/;|\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);
}

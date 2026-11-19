// Shared prompt for the parking fee finder (used by both the CLI and the API provider).
export function parkingPrompt({ name, city, address }, asOf = new Date().toISOString().slice(0, 10)) {
  const where = [address, city].filter(Boolean).join(', ');
  return `Find the overnight guest parking fee for the hotel "${name}" (${where}).
Check the current overnight guest rate as of ${asOf}. Open the source page with WebFetch where available. If opening is unavailable, a clearly attributed current official-site search excerpt is acceptable with medium confidence; never imply it was fetched. Exclude old event guides, discounted packages, restaurant/event rates, and reviews. Prefer the most recently updated official rate over older third-party discrepancies. If current official rates conflict and cannot be resolved, use null with low confidence. A positive fee requires a verbatim quote containing that amount and the overnight/daily parking context. Prefer the hotel's own website or brand site, then Booking/Expedia/Tripadvisor "parking" sections. Report the cheapest on-site overnight option (self parking if offered, else valet). If the hotel states parking is free, say so with a quote. If there is no on-site parking, use parking_type "none". If you cannot find a stated fee, use null; never guess a number.
Reply with ONLY a JSON object (no prose, no code fences) with exactly these keys: parking_fee_per_night (number or null), currency ("USD"), parking_type ("self"|"valet"|"free"|"none"|"unknown"), source_url (string or null), source_quote (verbatim sentence or null), confidence ("high"|"medium"|"low").`;
}

/** Pull the first JSON object out of a model reply, tolerant of fences and prose. */
export function extractJSON(text) {
  if (!text) return null;
  const s = String(text).trim();
  try { return JSON.parse(s); } catch { /* continue */ }
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch { /* continue */ } }
  const start = s.indexOf('{'), end = s.lastIndexOf('}');
  if (start >= 0 && end > start) { try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; } }
  return null;
}

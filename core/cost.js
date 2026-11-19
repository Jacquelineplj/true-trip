// C_trip = C_room + C_tax + C_fees + C_parking + C_rides + V x T_travel
// Parking applies if you drive, rides if you don't. V = time value in $/hour (default 20).
// Unknown inputs stay unknown (null) and are listed; they are never silently treated as $0.

import { round2 } from './fare.js';

export const DEFAULT_SETTINGS = {
  mode: 'drive',          // 'drive' | 'ride'
  timeValue: 20,          // $/hour
  roundTripsPerDay: 1,    // round trips to each anchor per day
  days: null,             // days with commute; defaults to nights
};

/**
 * @param {object} h
 * @param {number} h.room  room total for the stay (as shown on the page)
 * @param {number} [h.tax]  tax added on top (0 if the page price already includes taxes)
 * @param {number} [h.fees] mandatory fees (resort etc.) for the stay
 * @param {number} h.nights
 * @param {number|null} h.parkingPerNight  null = unknown
 * @param {Array<{durationMin:number, fare?:{low:number,high:number}}>} h.legs  one entry per anchor (one-way)
 * @param {object} settings
 * @returns {{mode, total:{low,high,mid}|null, breakdown, unknowns:string[], travelHours:number|null}}
 */
export function tripCost(h, settings = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const days = s.days ?? h.nights;
  const unknowns = [];
  const breakdown = { room: num(h.room), tax: num(h.tax === undefined ? 0 : h.tax), fees: num(h.fees === undefined ? 0 : h.fees) };
  if (breakdown.room == null) unknowns.push('room price');
  if (breakdown.tax == null) unknowns.push('taxes and fees');
  if (breakdown.fees == null) unknowns.push('mandatory fees');

  // travel time: each anchor, round trip = 2 legs, roundTripsPerDay per day
  const legs = (h.legs ?? []).filter(Boolean);
  let travelMin = 0;
  let rideLow = 0, rideHigh = 0, rideKnown = legs.length > 0;
  if (!legs.length) unknowns.push('commute (no anchors or no route)');
  for (const leg of legs) {
    if (leg.durationMin == null) { rideKnown = false; unknowns.push('commute time'); continue; }
    const trips = 2 * s.roundTripsPerDay * days;
    travelMin += leg.durationMin * trips;
    if (leg.fare) { rideLow += leg.fare.low * trips; rideHigh += leg.fare.high * trips; }
    else rideKnown = false;
  }
  const travelHours = legs.length && !unknowns.includes('commute time') ? travelMin / 60 : null;
  breakdown.travelHours = travelHours;
  breakdown.timeCost = travelHours == null ? null : round2(travelHours * s.timeValue);
  if (breakdown.timeCost == null) unknowns.push('travel-time cost');

  if (s.mode === 'drive') {
    breakdown.parking = h.parkingPerNight == null ? null : round2(h.parkingPerNight * h.nights);
    breakdown.rides = { low: 0, high: 0 };
    if (breakdown.parking == null) unknowns.push('parking fee');
  } else {
    breakdown.parking = 0;
    breakdown.rides = rideKnown ? { low: round2(rideLow), high: round2(rideHigh) } : null;
    if (breakdown.rides == null) unknowns.push('ride fare');
  }

  const fixed = sum([breakdown.room, breakdown.tax, breakdown.fees, breakdown.parking, breakdown.timeCost]);
  let total = null;
  if (fixed != null && breakdown.rides != null) {
    total = { low: round2(fixed + breakdown.rides.low), high: round2(fixed + breakdown.rides.high) };
    total.mid = round2((total.low + total.high) / 2);
  }
  return { mode: s.mode, total, breakdown, unknowns: dedupe(unknowns), travelHours, days, nights: h.nights };
}

function num(x) { return x == null || Number.isNaN(Number(x)) ? null : Number(x); }
function sum(xs) { let t = 0; for (const x of xs) { if (x == null) return null; t += x; } return round2(t); }
function dedupe(xs) { return [...new Set(xs)]; }

/** Sort key: known totals first (ascending by mid), unknowns last. */
export function sortByTrueCost(items, getCost = (x) => x.cost) {
  return [...items].sort((a, b) => {
    const ca = getCost(a)?.total?.mid, cb = getCost(b)?.total?.mid;
    if (ca == null && cb == null) return 0;
    if (ca == null) return 1;
    if (cb == null) return -1;
    return ca - cb;
  });
}

/**
 * Break-even notes across a set of hotels.
 * Each item: { name, room, costDrive, costRide } where costX = tripCost(...) results.
 * settings.mode decides the primary mode.
 */
export function breakEvenNotes(items, settings = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const notes = [];
  const primary = (it) => (s.mode === 'drive' ? it.costDrive : it.costRide);
  const alt = (it) => (s.mode === 'drive' ? it.costRide : it.costDrive);
  const known = items.filter((it) => primary(it)?.total && it.room != null);
  if (known.length < 2) return notes;

  const byRoom = [...known].sort((a, b) => a.room - b.room);
  const byTrue = [...known].sort((a, b) => primary(a).total.mid - primary(b).total.mid);
  const cheapRoom = byRoom[0], cheapTrue = byTrue[0];

  // Price reversal: cheapest room rate is not the cheapest true cost.
  if (cheapRoom !== cheapTrue) {
    const diffRoom = round2(cheapTrue.room - cheapRoom.room);
    const diffTrue = round2(primary(cheapRoom).total.mid - primary(cheapTrue).total.mid);
    notes.push({
      type: 'price-reversal',
      hotels: [cheapRoom.name, cheapTrue.name],
      text: `${cheapTrue.name} costs $${diffRoom} more in room rate than ${cheapRoom.name}, but about $${diffTrue} less once ${s.mode === 'drive' ? 'parking' : 'rides'} and travel time count.`,
    });
  }

  // Mode break-even for the top-2 by true cost: does the winner change if you switch car/no car?
  const [a, b] = byTrue;
  if (alt(a)?.total && alt(b)?.total) {
    const altWinner = alt(a).total.mid <= alt(b).total.mid ? a : b;
    if (altWinner !== a) {
      notes.push({
        type: 'mode-break-even',
        hotels: [a.name, b.name],
        text: s.mode === 'drive'
          ? `${a.name} wins only if you drive; ${b.name} wins if you skip the car.`
          : `${a.name} wins only if you skip the car; ${b.name} wins if you drive.`,
      });
    }
  }

  // Time-value break-even between top-2: V* where costs are equal.
  const ta = primary(a).travelHours, tb = primary(b).travelHours;
  if (ta != null && tb != null && ta !== tb) {
    const fixedA = primary(a).total.mid - ta * s.timeValue;
    const fixedB = primary(b).total.mid - tb * s.timeValue;
    const vStar = (fixedB - fixedA) / (ta - tb); // cost_a(V) = cost_b(V)
    if (Number.isFinite(vStar) && vStar > 0 && vStar < 200) {
      const slowerIsA = ta > tb;
      notes.push({
        type: 'time-value-break-even',
        hotels: [a.name, b.name],
        text: `${a.name} stays ahead of ${b.name} ${slowerIsA ? 'only while' : 'as long as'} your time is worth ${slowerIsA ? 'less' : 'more'} than about $${Math.round(vStar)}/h.`,
        vStar: round2(vStar),
      });
    }
  }
  return notes;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { tripCost, breakEvenNotes, sortByTrueCost } from '../core/cost.js';

// Proposal example: 3-night trip with rental car, V=$20/h.
// A: room 600, parking 180 total (60/night), travel 1.5h -> 810. B: 640, 0, 3.0h -> 700.
test('tripCost reproduces the proposal example (drive)', () => {
  const settings = { mode: 'drive', timeValue: 20, roundTripsPerDay: 1 };
  // 1.5h over 3 days, 1 round trip/day => 6 legs => 15 min per leg
  const A = tripCost({ room: 600, nights: 3, parkingPerNight: 60, legs: [{ durationMin: 15 }] }, settings);
  const B = tripCost({ room: 640, nights: 3, parkingPerNight: 0, legs: [{ durationMin: 30 }] }, settings);
  assert.equal(A.total.mid, 810);
  assert.equal(B.total.mid, 700);
  assert.equal(A.breakdown.parking, 180);
  assert.equal(A.travelHours, 1.5);
  assert.deepEqual(A.unknowns, []);
});

test('unknown parking is never treated as $0', () => {
  const c = tripCost({ room: 600, nights: 3, parkingPerNight: null, legs: [{ durationMin: 15 }] }, { mode: 'drive' });
  assert.equal(c.total, null);
  assert.ok(c.unknowns.includes('parking fee'));
});

test('ride mode uses fare ranges and ignores parking', () => {
  const c = tripCost({ room: 400, nights: 1, parkingPerNight: 50, legs: [{ durationMin: 12, fare: { low: 10, high: 20 } }] }, { mode: 'ride', timeValue: 20 });
  // 2 legs: rides 20..40, time 24 min = 0.4h = $8
  assert.equal(c.breakdown.parking, 0);
  assert.deepEqual(c.breakdown.rides, { low: 20, high: 40 });
  assert.equal(c.total.low, 428);
  assert.equal(c.total.high, 448);
});

test('missing fare in ride mode is unknown', () => {
  const c = tripCost({ room: 400, nights: 1, legs: [{ durationMin: 12 }] }, { mode: 'ride' });
  assert.equal(c.total, null);
  assert.ok(c.unknowns.includes('ride fare'));
});

test('sortByTrueCost puts unknowns last', () => {
  const items = [{ n: 'x', cost: { total: null } }, { n: 'y', cost: { total: { mid: 300 } } }, { n: 'z', cost: { total: { mid: 200 } } }];
  assert.deepEqual(sortByTrueCost(items).map((i) => i.n), ['z', 'y', 'x']);
});

test('breakEvenNotes finds the price reversal and the mode break-even', () => {
  const settings = { mode: 'drive', timeValue: 20 };
  const mk = (name, room, parking, legMin, fare) => ({
    name, room,
    costDrive: tripCost({ room, nights: 3, parkingPerNight: parking, legs: [{ durationMin: legMin, fare }] }, { ...settings, mode: 'drive' }),
    costRide: tripCost({ room, nights: 3, parkingPerNight: parking, legs: [{ durationMin: legMin, fare }] }, { ...settings, mode: 'ride' }),
  });
  const A = mk('Hotel A', 600, 60, 15, { low: 8, high: 12 });
  const B = mk('Hotel B', 640, 0, 30, { low: 15, high: 25 });
  const notes = breakEvenNotes([A, B], settings);
  const types = notes.map((n) => n.type);
  assert.ok(types.includes('price-reversal'), JSON.stringify(notes));
  const pr = notes.find((n) => n.type === 'price-reversal');
  assert.match(pr.text, /Hotel B costs \$40 more in room rate than Hotel A, but about \$110 less/);
  // Ride mode: A = 600 + 6 legs*(8..12)=48..72 -> mid 660 + 30 = 690 ; B = 640 + 90..150 -> mid 760 + 60 = 820 -> A wins when riding
  assert.ok(types.includes('mode-break-even'));
  assert.ok(types.includes('time-value-break-even'));
  const tv = notes.find((n) => n.type === 'time-value-break-even');
  // B ahead of A while V < V*: fixedA = 780, fixedB = 640 ; (640-780)/(1.5-3.0) = 93.3
  assert.equal(Math.round(tv.vStar), 93);
});

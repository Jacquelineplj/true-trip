import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, parseBookingScore, parseNightsText, nightsBetween, parseDistanceKm, parseAnchors } from '../core/parse.js';

test('parseMoney', () => {
  assert.deepEqual(parseMoney('US$978'), { amount: 978, currency: 'USD' });
  assert.deepEqual(parseMoney('$1,182'), { amount: 1182, currency: 'USD' });
  assert.deepEqual(parseMoney('€120.50'), { amount: 120.5, currency: 'EUR' });
  assert.deepEqual(parseMoney('Price US$ 449'), { amount: 449, currency: 'USD' });
  assert.equal(parseMoney('n/a'), null);
});

test('parseBookingScore', () => {
  assert.deepEqual(parseBookingScore('Scored 8.7 8.7 Excellent 3,634 reviews'), { score: 8.7, label: 'Excellent', reviews: 3634 });
  assert.deepEqual(parseBookingScore('9.1 Wonderful · 512 reviews'), { score: 9.1, label: 'Wonderful', reviews: 512 });
  assert.equal(parseBookingScore('').score, null);
});

test('nights', () => {
  assert.equal(parseNightsText('2 nights, 2 adults'), 2);
  assert.equal(parseNightsText('1 night, 1 adult'), 1);
  assert.equal(nightsBetween('2026-03-10', '2026-03-11'), 1);
  assert.equal(nightsBetween('2026-03-10', '2026-03-13'), 3);
  assert.equal(nightsBetween('2026-03-13', '2026-03-10'), null);
});

test('distance and anchors', () => {
  assert.equal(parseDistanceKm('1.2 km from downtown'), 1.2);
  assert.equal(Math.round(parseDistanceKm('0.5 miles from center') * 1000), 805);
  assert.equal(parseDistanceKm('450 m from center'), 0.45);
  assert.deepEqual(parseAnchors('MIT Media Lab; Boston Convention Center ; ; Fenway Park; Fourth'), ['MIT Media Lab', 'Boston Convention Center', 'Fenway Park']);
});

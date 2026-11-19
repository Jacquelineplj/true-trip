import test from 'node:test';
import assert from 'node:assert/strict';
import { nameSimilarity, isSameHotel, bestMatch } from '../core/match.js';

test('nameSimilarity handles brand variants', () => {
  assert.ok(nameSimilarity('Boston Marriott Copley Place', 'Marriott Copley Place Boston') > 0.9);
  assert.ok(nameSimilarity('The Westin Copley Place, Boston', 'Westin Copley Place') > 0.7);
  assert.ok(nameSimilarity('Hilton Boston Back Bay', 'Hilton Boston Logan Airport') < 0.7);
});

test('isSameHotel uses location to disambiguate', () => {
  const target = { name: 'Hilton Boston Back Bay', location: { lat: 42.3475, lon: -71.0829 } };
  const near = { name: 'Hilton Back Bay', location: { lat: 42.3476, lon: -71.0830 } };
  const far = { name: 'Hilton Boston Back Bay', location: { lat: 42.37, lon: -71.02 } };
  assert.equal(isSameHotel(target, near).match, true);
  assert.equal(isSameHotel(target, far).match, false);
  assert.equal(bestMatch(target, [far, near]).candidate, near);
  assert.equal(bestMatch(target, [far]), null);
});

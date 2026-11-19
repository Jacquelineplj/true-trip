import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateFare } from '../core/fare.js';

test('estimateFare gives a plausible range for a short Boston ride', () => {
  const f = estimateFare({ distanceKm: 3.4, durationMin: 8, city: 'Boston' });
  assert.ok(f.low >= 8 && f.low < f.high, JSON.stringify(f));
  assert.ok(f.mid > 10 && f.mid < 25, JSON.stringify(f));
  assert.equal(f.tested, true);
});

test('Boston range contains at least 80% of the real UberX quotes it was calibrated on', async () => {
  const { readFile } = await import('node:fs/promises');
  const { quotes } = JSON.parse(await readFile(new URL('../fixtures/uber-quotes-boston-2026-11-18.json', import.meta.url), 'utf8'));
  const hits = quotes.filter((q) => {
    const f = estimateFare({ distanceKm: q.distanceKm, durationMin: q.durationMin, city: 'Boston' });
    return q.listUsd >= f.low && q.listUsd <= f.high;
  });
  assert.ok(hits.length / quotes.length >= 0.8, `${hits.length}/${quotes.length} quotes inside the range`);
});

test('estimateFare widens the range in untested cities', () => {
  const a = estimateFare({ distanceKm: 10, durationMin: 20, city: 'Boston' });
  const b = estimateFare({ distanceKm: 10, durationMin: 20, city: 'Boise' });
  assert.equal(b.tested, false);
  assert.ok(b.high / b.low > a.high / a.low);
});

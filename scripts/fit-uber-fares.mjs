// Usage: node scripts/fit-uber-fares.mjs fixtures/uber-quotes-boston-random-110.json fixtures/uber-quotes-boston-2026-11-18.json
// Fit UberX fare models on 110 random Boston-area quotes; evaluate with repeated 5-fold CV
// and on the 12 earlier hotel quotes as an external check.
import fs from 'node:fs';
const [qPath, hotelPath] = process.argv.slice(2);
const Q = JSON.parse(fs.readFileSync(qPath, 'utf8')).quotes;
const H = JSON.parse(fs.readFileSync(hotelPath, 'utf8')).quotes;
const mi = (km) => km / 1.609344;
const rows = Q.map((q) => ({ min: q.durationMin, mi: mi(q.distanceKm), y: q.listUsd, t: q.quotedAtLocal }));
const hot = H.map((q) => ({ min: q.durationMin, mi: mi(q.distanceKm), y: q.listUsd }));

function solve(A, b) { const n = b.length; const M = A.map((r, i) => [...r, b[i]]); for (let i = 0; i < n; i++) { let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r; [M[i], M[p]] = [M[p], M[i]]; for (let r = 0; r < n; r++) if (r !== i) { const f = M[r][i] / M[i][i]; for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c]; } } return M.map((r, i) => r[n] / r[i]); }
function ols(X, y) { const k = X[0].length; const A = Array.from({ length: k }, () => Array(k).fill(0)); const b = Array(k).fill(0); X.forEach((x, r) => { for (let i = 0; i < k; i++) { b[i] += x[i] * y[r]; for (let j = 0; j < k; j++) A[i][j] += x[i] * x[j]; } }); return solve(A, b); }
const base = (r) => 2.75 + 0.36 * r.min + 1.45 * r.mi + 2.95;
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };

// Each model: fit(train) -> predict(row)
const MODELS = {
  'current (x1.7, as shipped)': () => (r) => Math.max(8.5, base(r) * 1.7),
  'old (x1.2, before calibration)': () => (r) => Math.max(8.5, base(r) * 1.2),
  'refit scale only': (tr) => { const k = tr.reduce((s, r) => s + base(r) * r.y, 0) / tr.reduce((s, r) => s + base(r) ** 2, 0); return (r) => Math.max(8.5, base(r) * k); },
  'fit all: a + b*min + c*mile': (tr) => { const w = ols(tr.map((r) => [1, r.min, r.mi]), tr.map((r) => r.y)); return (r) => w[0] + w[1] * r.min + w[2] * r.mi; },
  'fit: a + c*mile (no time)': (tr) => { const w = ols(tr.map((r) => [1, r.mi]), tr.map((r) => r.y)); return (r) => w[0] + w[1] * r.mi; },
  'fit: a + b*min (no distance)': (tr) => { const w = ols(tr.map((r) => [1, r.min]), tr.map((r) => r.y)); return (r) => w[0] + w[1] * r.min; },
};

let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
function cv(fitFn, data, folds = 5, reps = 20) {
  const errs = [], ratios = [];
  for (let rep = 0; rep < reps; rep++) {
    const idx = data.map((_, i) => i).sort(() => rnd() - 0.5);
    for (let f = 0; f < folds; f++) {
      const test = idx.filter((_, j) => j % folds === f), train = idx.filter((_, j) => j % folds !== f);
      const tr = train.map((i) => data[i]); const pred = fitFn(tr);
      // range from training residual ratios (10th-90th pct)
      const rr = tr.map((r) => r.y / pred(r)); const lo = q(rr, 0.1), hi = q(rr, 0.9);
      for (const i of test) { const r = data[i]; const p = pred(r); errs.push({ ae: Math.abs(r.y - p), pe: Math.abs(r.y - p) / r.y, inRange: r.y >= p * lo && r.y <= p * hi }); ratios.push(r.y / p); }
    }
  }
  return summarize(errs);
}
function summarize(errs) { const n = errs.length; return { mae: errs.reduce((s, e) => s + e.ae, 0) / n, mape: 100 * errs.reduce((s, e) => s + e.pe, 0) / n, within20: 100 * errs.filter((e) => e.pe <= 0.2).length / n, rangeHit: 100 * errs.filter((e) => e.inRange).length / n }; }

const out = {};
for (const [name, fit] of Object.entries(MODELS)) {
  const cvr = cv(fit, rows);
  const pred = fit(rows); // full fit for the external check
  const rr = rows.map((r) => r.y / pred(r)); const lo = q(rr, 0.1), hi = q(rr, 0.9);
  const ext = summarize(hot.map((r) => { const p = pred(r); return { ae: Math.abs(r.y - p), pe: Math.abs(r.y - p) / r.y, inRange: r.y >= p * lo && r.y <= p * hi }; }));
  out[name] = { cv: cvr, hotel12: ext, range: [lo, hi] };
}
const full = ols(rows.map((r) => [1, r.min, r.mi]), rows.map((r) => r.y));
const meanY = rows.reduce((s, r) => s + r.y, 0) / rows.length;
console.log(`n=${rows.length}  mean price $${meanY.toFixed(2)}  minutes ${Math.min(...rows.map(r=>r.min)).toFixed(1)}-${Math.max(...rows.map(r=>r.min)).toFixed(1)}  miles ${Math.min(...rows.map(r=>r.mi)).toFixed(1)}-${Math.max(...rows.map(r=>r.mi)).toFixed(1)}`);
console.log('full-data fit: a=%s  b/min=%s  c/mile=%s', full[0].toFixed(2), full[1].toFixed(2), full[2].toFixed(2));
// standard errors for the 3-param fit
{ const X = rows.map((r) => [1, r.min, r.mi]); const res = rows.map((r, i) => r.y - (full[0] + full[1] * X[i][1] + full[2] * X[i][2])); const s2 = res.reduce((s, e) => s + e * e, 0) / (rows.length - 3);
  const A = [[0,0,0],[0,0,0],[0,0,0]]; X.forEach((x) => { for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) A[i][j] += x[i] * x[j]; });
  const inv = [0,1,2].map((c) => solve(A, [0,1,2].map((r) => (r === c ? 1 : 0)))); const se = [0,1,2].map((i) => Math.sqrt(s2 * inv[i][i]));
  const ssTot = rows.reduce((s, r) => s + (r.y - meanY) ** 2, 0); const r2 = 1 - res.reduce((s, e) => s + e * e, 0) / ssTot;
  console.log('  std errors: a±%s b±%s c±%s   R^2=%s', se[0].toFixed(2), se[1].toFixed(2), se[2].toFixed(2), r2.toFixed(3)); }
const corr = (a, b) => { const ma = a.reduce((s, x) => s + x, 0) / a.length, mb = b.reduce((s, x) => s + x, 0) / b.length; let n = 0, da = 0, db = 0; a.forEach((x, i) => { n += (x - ma) * (b[i] - mb); da += (x - ma) ** 2; db += (b[i] - mb) ** 2; }); return n / Math.sqrt(da * db); };
console.log('corr(minutes, miles) = %s', corr(rows.map(r=>r.min), rows.map(r=>r.mi)).toFixed(3));
console.log('\nmodel | CV MAE | CV MAPE | CV within ±20% | CV 10-90% range hit | range | hotel-12 MAE | hotel-12 range hit');
for (const [k, v] of Object.entries(out)) console.log(`${k} | $${v.cv.mae.toFixed(2)} | ${v.cv.mape.toFixed(1)}% | ${v.cv.within20.toFixed(0)}% | ${v.cv.rangeHit.toFixed(0)}% | x${v.range[0].toFixed(2)}-${v.range[1].toFixed(2)} | $${v.hotel12.mae.toFixed(2)} | ${v.hotel12.rangeHit.toFixed(0)}%`);

// Run with: node tests/model.test.js
const assert = require('node:assert/strict');
const Peloton = require('../model.js');
const close = (a, b, tol = 1e-9) => assert(Math.abs(a - b) < tol, `${a} differs from ${b}`);
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('  ✓ ' + name); };

console.log('Physics and coupling');
test('PCR = P_front × d / MSO (Eq. 4)', () => {
  close(Peloton.pcr(350, 0.62, 350), 0.62);
  close(Peloton.pcr(350 / 0.62, 0.62, 350), 1);
});
test('Power–speed uses paper parameters; grade adds m·g·sin(atan(GR))·v (Eqs. 1–2)', () => {
  const v = 40 / 3.6, P = Peloton.PHYS;
  const flat = 0.5 * P.rho * P.cda * v ** 3 + P.crr * P.mass * P.g * v;
  close(Peloton.roadPower(v, 0), flat, 1e-9);
  const th = Math.atan(0.02);
  close(Peloton.roadPower(v, 0.02), 0.5 * P.rho * P.cda * v ** 3 + P.crr * P.mass * P.g * Math.cos(th) * v + P.mass * P.g * Math.sin(th) * v, 1e-9);
  assert(Peloton.roadPower(v, 0.02) / flat > 1.45);   // ~+54 % at 40 km/h
});
test('speedForPower inverts roadPower, with and without shelter', () => {
  for (const [P, d, gr] of [[300, 1, 0], [300, 0.62, 0], [250, 1, 0.02]]) {
    const v = Peloton.speedForPower(P, d, gr);
    close(d * Peloton.roadPower(v, gr), P, 1e-6);
  }
});
test("Olds' drafting coefficient (Eq. 5) and lateral fade", () => {
  close(Peloton.oldsD(0, 0.62), 0.62);
  close(Peloton.oldsD(1, 0.62), 0.62 - 0.0104 + 0.0452);
  assert.equal(Peloton.oldsD(3.5, 0.62), 1);
  assert.equal(Peloton.lateralFactor(0.1), 1);
  assert.equal(Peloton.lateralFactor(1.0), 0);
});
test('Thresholds are ordered: passing < exposed < sheltered limit', () => {
  const t = Peloton.thresholds(300, 0, 0.62);
  assert(t.pass < t.exposed && t.exposed < t.sheltered);
  assert(Peloton.thresholds(300, 0.02, 0.62).sheltered < t.sheltered);
});

console.log('Shelter, counting and complexity');
test('Wheel-spacing shelter is best on the wheel and lost when off it', () => {
  const s = new Peloton({ n: 2, msoMode: 'even', spread: 0 });
  const [a, b] = s.riders;
  const c = { d0: 0.62, draft: 'olds' };
  a.x = 10; a.y = 0; b.x = 10 - Peloton.BIKE - 0.5; b.y = 0;
  close(s.draftCoefficient(b, c), Peloton.oldsD(0.5, 0.62), 1e-12);
  b.y = 1.2; assert.equal(s.draftCoefficient(b, c), 1);
  b.y = 0; b.x = 10 - Peloton.BIKE - 4; assert.equal(s.draftCoefficient(b, c), 1);
  assert.equal(s.draftCoefficient(a, c), 1);
  // v1 fixed rule retained as an option.
  b.x = 5; assert.equal(s.draftCoefficient(b, { d0: 0.62, draft: 'fixed' }), 0.62);
});
test('Ahead-counts use the paper thresholds (> 1 m forward, < 1 m lateral)', () => {
  const s = new Peloton({ n: 3, msoMode: 'even', spread: 0 });
  const R = s.riders;
  R[0].x = 5; R[0].y = 0; R[1].x = 0; R[1].y = 0.5; R[2].x = 4.5; R[2].y = 0;
  assert.deepEqual(s.counts(), [0, 2, 0]);   // 0.5 m forward is "abreast", not ahead
});
test('Cx* normalisation: 1 + ln(1 + X·12/N)', () => {
  const s = new Peloton({ n: 2, msoMode: 'even', spread: 0 });
  s.riders[0].x = 3; s.riders[1].x = 0; s.riders[0].y = s.riders[1].y = 0;
  s.prevCounts = s.counts();
  close(s.sample().cx, 1);
  s.riders[1].x = 6;
  const r = s.sample();
  assert.equal(r.x, 2); close(r.cx, 1 + Math.log1p(2 * 12 / 2));
});

console.log('Phase rules (Section 2.8)');
test('Precedence rules and Scratch-reference thresholds', () => {
  const L = Peloton.phaseLabel, R = Peloton.REF;
  assert.equal(L(1.2, 1.0, 'neutral'), 'Dcp');
  assert.equal(L(0.7, 3.0, 'accel'), 'Da');
  assert.equal(L(0.7, 3.0, 'decel'), 'Dd');
  assert.equal(L(0.8, 1.2, 'neutral'), 'S');
  assert.equal(L(0.6, 1.2, 'decel'), 'Sf');
  assert.equal(L(0.4, 1.2, 'neutral'), 'Cs');
  assert.equal(L(0.8, 3.0, 'neutral'), 'Cch');
  assert.equal(L(0.4, 3.0, 'accel'), 'Ccl');                // Da/Dd need PCR > PCR_low
  assert.equal(L(0.6, 1.9, 'neutral'), 'Transitional');
  close(R.cxLow, 1 + Math.log(2), 1e-4); close(R.cxHigh, 1 + Math.log(3), 1e-4);
});

console.log('MSO assignment');
test('Scratch pool (NetLogo MSOs) spans 215–337 W with mean ≈ 268 W; custom lists and even spreads work', () => {
  const pool = Peloton.SCRATCH_POOL;
  assert.equal(Math.min(...pool), 215); assert.equal(Math.max(...pool), 337);
  close(pool.reduce((a, b) => a + b, 0) / pool.length, 268, 0.5);
  assert.deepEqual(new Peloton({ n: 12, msoMode: 'pool' }).msos, pool);
  const drawn = new Peloton({ n: 25, msoMode: 'pool', seed: 4 }).msos;
  assert(drawn.every(v => pool.includes(v)));
  assert.deepEqual(new Peloton({ n: 3, msoMode: 'custom', custom: [200, 250, 300] }).msos, [200, 250, 300]);
  const ranged = new Peloton({ n: 40, msoMode: 'range', range: [390, 480], seed: 3 }).msos;
  assert(ranged.every(v => v >= 390 && v <= 480) && new Set(ranged).size > 20);
  assert.deepEqual(ranged, new Peloton({ n: 40, msoMode: 'range', range: [390, 480], seed: 3 }).msos);
  const even = new Peloton({ n: 5, msoMode: 'even', centre: 300, spread: 20 }).msos;
  close(even[0], 240); close(even[4], 360);
});

console.log('Behaviour (simulated runs)');
function run(opts, cond, secs = 240) {
  const s = new Peloton(Object.assign({ seed: 1, speedKmh: cond.speedKmh }, opts));
  for (let k = 1; k <= secs * 20; k++) { s.step(0.05, cond); if (k % 20 === 0) s.sample(); }
  assert(s.riders.every(r => Number.isFinite(r.x) && Number.isFinite(r.y) && r.v > 0));
  assert(s.rows.every(r => r.cx >= 1 && r.x >= 0));
  assert(s.riders.every(r => r.wbal >= 0 && r.wbal <= r.wcap + 1e-9));
  return s;
}
const mean = (s, k, from = 60) => { const r = s.rows.slice(from); return r.reduce((a, q) => a + q[k], 0) / r.length; };
const base = { grade: 0, d0: 0.62, draft: 'olds', reserve: true, urge: 0.6 };
const easy = run({ n: 16, msoMode: 'pool' }, Object.assign({}, base, { speedKmh: 34 }));
const hard = run({ n: 16, msoMode: 'pool' }, Object.assign({}, base, { speedKmh: 42 }));
test('Low demand: one compact, mixing group', () => {
  const together = easy.rows.slice(60).filter(r => r.groups === 1).length / easy.rows.slice(60).length;
  assert(together > 0.9, `together ${together}`);                      // brief stragglers (e.g. a rider drifting back after a pull) allowed
  assert(easy.events.every(e => e.type !== 'split'));
  { const easyMix = mean(run({ n: 16, msoMode: 'pool' }, Object.assign({}, base, { speedKmh: 34, lull: false })), 'x');
    assert(easyMix > 2.5 && easyMix > mean(hard, 'x') + 1, `easy X ${easyMix} vs hard ${mean(hard, 'x')}`); }   // without tactical waiting, continuous mixing, far more than near threshold
  assert(mean(easy, 'leadCoreWidth') > 3 && mean(easy, 'leadCoreWidth') > 2 * mean(hard, 'leadCoreWidth'));   // a compact cluster, far wider than the lined-out group's core
});
test('Near threshold: passing stops, the group narrows, lengthens and lines out', () => {
  // Turnover falls on average across seeds (a split in a single run can add turnover).
  const meanX = v => [1, 2, 3].map(seed => mean(run({ n: 16, msoMode: 'pool', seed }, Object.assign({}, base, { speedKmh: v }), 180), 'x')).reduce((a, b) => a + b) / 3;
  assert(meanX(42) < meanX(34));
  assert(mean(hard, 'leadCoreWidth') < mean(easy, 'leadCoreWidth') - 1.5);
  assert(mean(hard, 'leadLength') > mean(easy, 'leadLength') + 5);
  assert(mean(hard, 'singleFile') > mean(easy, 'singleFile') + 0.15);
  assert(mean(hard, 'locked') > 8);
  const occ = hard.rows.filter(r => r.phase === 'S').length;
  assert(occ > 40, 'stretched phase should be common near threshold');
});
test('Above sheltered capacity: weakest riders separate first; the race log records it', () => {
  const shed = run({ n: 16, msoMode: 'even', centre: 300, spread: 30 }, Object.assign({}, base, { speedKmh: 45 }));
  assert(shed.rows.at(-1).groups > 1);
  const lead = shed.groups[0].members.map(r => r.mso);
  const out = shed.riders.filter(r => r.group > 0).map(r => r.mso);
  assert(Math.min(...out) < Math.min(...lead));
  assert(shed.events.some(e => e.type === 'split' || e.type === 'dropped'));
});
test('Surge then ease: stretched (S) at the peak, stretched-fatigued (Sf) while easing (hysteresis branch)', () => {
  const pace = t => (t < 15 ? 34 : t < 45 ? 34 + 8 * (t - 15) / 30 : t < 105 ? 42 : t < 135 ? 42 - 8 * (t - 105) / 30 : 34);
  let S = 0, Sf = 0, SfSteady = 0;
  for (const seed of [1, 2, 3]) {
    const s = new Peloton({ n: 12, msoMode: 'pool', seed, speedKmh: 34 });
    for (let k = 1; k <= 20 * 140; k++) { s.step(0.05, Object.assign({}, base, { speedKmh: pace(s.t), epsFloor: 0.005 })); if (k % 20 === 0) s.sample(); }
    S += s.rows.filter(r => r.t >= 60 && r.t < 105 && r.phase === 'S').length;
    Sf += s.rows.filter(r => r.t >= 105 && r.t < 135 && r.phase === 'Sf').length;
    SfSteady += s.rows.filter(r => r.t >= 60 && r.t < 105 && r.phase === 'Sf').length;
  }
  assert(S > 20, `S at peak: ${S}`);
  assert(Sf > 5 && Sf > SfSteady, `Sf while easing: ${Sf}, at steady peak: ${SfSteady}`);
});
test('No speed collapse: every rider keeps a realistic speed', () => {
  for (const v of [34, 42, 46]) {
    const s = new Peloton({ n: 16, msoMode: 'pool', seed: 4, speedKmh: v });
    for (let k = 1; k <= 20 * 150; k++) { s.step(0.05, Object.assign({}, base, { speedKmh: v })); if (k > 400) assert(s.riders.every(r => r.v * 3.6 > 0.6 * v), `slow rider at ${v} km/h`); }
  }
});
test('Overlap correction never moves a rider backwards (several overlapping riders ahead)', () => {
  const s = new Peloton({ n: 3, msoMode: 'even', spread: 0 });
  const [b1, b2, a] = s.riders;
  b1.x = 10; b1.y = 0; b2.x = 9.9; b2.y = 0.5; a.y = 0.25;
  const start = [b1.x, b2.x, 9.0];
  a.x = 9.5; a.v = 10;                        // a moved 0.5 m this step and now overlaps both riders ahead
  s.resolveOverlaps(start, 0.05);
  assert(a.x >= 9.0 - 1e-12, `rider moved backwards to ${a.x}`);
  for (const v of [32, 45]) {                 // and in full runs
    const r = new Peloton({ n: 60, msoMode: 'pool', seed: 2, speedKmh: v });
    for (let k = 0; k < 20 * 60; k++) { const px = r.riders.map(q => q.x); r.step(0.05, Object.assign({}, base, { speedKmh: v, width: 6 }));
      assert(r.riders.every((q, i) => q.x >= px[i])); }
  }
});
test('W′ off: nobody exceeds MSO', () => {
  const s = run({ n: 12, msoMode: 'pool' }, Object.assign({}, base, { speedKmh: 44, reserve: false }), 60);
  assert(s.riders.every(r => r.P <= r.mso + 1e-6));
});
test('Deterministic for a given seed', () => {
  const a = run({ n: 12, msoMode: 'pool', seed: 7 }, Object.assign({}, base, { speedKmh: 40 }), 60);
  const b = run({ n: 12, msoMode: 'pool', seed: 7 }, Object.assign({}, base, { speedKmh: 40 }), 60);
  assert.deepEqual(a.rows.map(r => [r.pcr, r.x, r.phase]), b.rows.map(r => [r.pcr, r.x, r.phase]));
});
test('Extreme settings stay stable', () => {
  for (const n of [6, 60]) for (const v of [28, 60]) for (const d0 of [0.45, 1]) for (const grade of [-2, 8])
    run({ n, msoMode: 'even', centre: 300, spread: 40 }, Object.assign({}, base, { speedKmh: v, d0, grade }), 30);
  run({ n: 12, msoMode: 'pool' }, Object.assign({}, base, { speedKmh: 40, draft: 'fixed' }), 60);
});
test('Tactical waiting: at easy pace the bunch spends more time locked (low X) than without it', () => {
  let on = 0, off = 0;
  for (const seed of [1, 2, 3]) for (const lull of [true, false]) {
    const s = run({ n: 16, msoMode: 'pool', seed, speedKmh: 32 }, Object.assign({}, base, { speedKmh: 32, urge: 1.2, lull }), 180);
    const q = s.rows.slice(60).filter(r => r.x <= 1).length / (s.rows.length - 60);
    if (lull) on += q; else off += q;
  }
  assert(on > off + 0.3, `quiet share with lull ${(on / 3).toFixed(2)} vs without ${(off / 3).toFixed(2)}`);
});
console.log(`\nPassed ${passed} tests.`);

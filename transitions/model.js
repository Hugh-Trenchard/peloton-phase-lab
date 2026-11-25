/* Peloton Phase Lab — simulation core.
 *
 * Copyright (C) 2026 Hugh Trenchard
 * This program is free software: you can redistribute it and/or modify it under the terms of the GNU General
 * Public License as published by the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version. It is distributed WITHOUT ANY WARRANTY; see the LICENSE file for details.
 *
 * An agent-based model of peloton phases, largely based on the author's NetLogo model and using the measures
 * in Trenchard, Recchia & Perc (2026), "Braid Complexity and Peloton Phase Dynamics" (SportRxiv preprint).
 * Written from scratch rather than ported line by line; written with the assistance of Claude (Anthropic) and
 * directed, tested and reviewed by the author. Units: metres, seconds, watts, kilograms.
 *
 * Main elements (see the ODD document for the full description):
 *  - Power–speed relation with grade (the paper's Eqs. 1–3) and the NetLogo parameters reported in the paper
 *    (CdA 0.32 m², Crr 0.004, air density 1.226 kg/m³, rider + bike 75 kg, no wind).
 *  - Drafting from Olds' formula (Eq. 5) with the NetLogo draft cones (60° / 10°).
 *  - NetLogo cohesion and separation rules, plus a drift toward the middle of the road.
 *  - A short-term anaerobic reserve (W′ balance), so riders can exceed MSO for a while, then must recover.
 *  - Pulls at the front, moving up (with the passing rule behind the stretched phase), gap closing, splits,
 *    chasing, getting back in and tactical waiting: this model's own rider rules.
 *  - PCR (Eq. 4), ahead-counts, X, Cx* and CxP* sampled at 1 Hz, and the paper's Section 2.8 phase labels
 *    (Scratch-standardised thresholds, 5-tick centred smoothing, epsilon = 0.10 × sd(ΔPCR)).
 */
(function (root) {
  'use strict';

  // ---------- Constants -------------------------------------------------------
  const PHYS = { rho: 1.226, cda: 0.32, crr: 0.004, mass: 75, g: 9.81 };
  const BIKE = 1.8;             // centre-to-centre length of a rider-bicycle (m)
  const ROAD = 7.5;             // half-width of the road (m): the road is 15 m wide (cond.width can still override)
  const DRAFT_RANGE = 3.1;      // Olds' d reaches 1 at a wheel gap of ~3.0 m
  const SPLIT_GAP = 6;          // wheel gap (m) at which riders count as separate groups
  const JOIN_GAP = 3;           // wheel gap (m) below which a separated rider rejoins
  const PASS_DV = 0.8;          // speed margin (m/s) needed to move up past riders
  const BRIDGE_DV = 1.2;        // speed margin (m/s) used to bridge a gap
  // NetLogo flocking rules (calculate-position, calculate-average-pos, calculate-separation-factor, calculate-draft).
  // NetLogo ticks are 1 s and its units metres, so its per-tick accelerations are m/s here.
  const COH_ZONE = 20, COH_CONE = 140;    // cohesion neighbourhood: other turtles in-cone 20 140 (riders ahead/ahead-side)
  const COH_KX = 0.11, COH_KY = 0.07;     // x-acc += (mean x − x)·0.11, y-acc += (mean y − y)·0.07
  const SEP_ZONE = 1.5, SEP_CONE = 240;   // separation neighbourhood: other turtles in-cone 1.5 240
  const SEP_K = 0.05;                     // Σ (me − them)/distance × random-float 0.1 (its mean, 0.05: no random noise)
  const DRAFT_CONE_PACK = 60, DRAFT_CONE_SINGLE = 10;   // draft: nearest rider in a 60° cone if > 1 there, else 10°
  const CENTRE_NUDGE = 0.02;    // centre bias toward the middle of the road, m/s (all riders except when passing on the outside;
                                //  NetLogo's put-middle-bias is 0.005 m/s, for local leaders and decelerating riders only)

  // Scratch-standardised thresholds reported in Section 2.8 (Eqs. 19–22).
  const REF = { pcrLow: 0.4882, pcrHigh: 0.7381, cxLow: 1.6931, cxHigh: 2.0986 };

  // The 12 Scratch-race MSOs (W) used in the authors' NetLogo model (setup, July 8 2026 code),
  // estimated from 200-m sprint times: range 215–337 W, mean ≈ 268 W.
  const SCRATCH_POOL = [250, 251, 283, 290, 216, 323, 337, 215, 247, 262, 282, 255];

  const PHASES = ['Cs', 'Ccl', 'Sf', 'Cch', 'S', 'Dd', 'Da', 'Dcp', 'Transitional'];

  // ---------- Helpers ---------------------------------------------------------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

  class Peloton {
    /**
     * @param {object} opts
     *   n          number of riders
     *   msoMode    'pool' | 'range' | 'even' | 'custom'
     *   range      [low, high] MSO bounds (W) for 'range'
     *   centre     centre MSO for 'even' (W)
     *   spread     ± percentage spread for 'even'
     *   custom     array of MSO values for 'custom' (drawn with replacement unless length = n)
     *   seed       integer seed for MSO draws and behavioural jitter
     *   speedKmh   initial speed
     */
    constructor(opts = {}) {
      const o = Object.assign({ n: 12, msoMode: 'pool', centre: 300, spread: 20, custom: null, seed: 1, speedKmh: 40 }, opts);
      this.opts = o;
      this.n = o.n;
      this.rng = mulberry32(o.seed * 9973 + 17);
      this.t = 0;
      this.rows = [];
      this.groups = [];
      this.msos = Peloton.drawMSOs(o, mulberry32(o.seed));
      const v0 = o.speedKmh / 3.6;
      // Starting grid. Up to 30 riders: two staggered rows, half the field in each, side by side 1.1 m apart and
      // centred on the road (closer if a row would not otherwise fit the road). More than 30: spread across the whole
      // usable width of the road, in as few rows as that allows (at least 1.1 m apart). Alternate rows are offset by
      // ±¼ slot. 'narrow' (testing only): the earlier block, 3 abreast (4 above 24 riders) at 1.1 m.
      const halfW = Math.max(1, (o.width || 2 * ROAD) / 2 - 0.6);
      let abreast, slot;
      if (o.grid === 'narrow') { abreast = o.n > 24 ? 4 : 3; slot = 1.1; }
      else if (o.n <= 30) {
        abreast = Math.ceil(o.n / 2);
        slot = abreast > 1 ? Math.min(1.1, (2 * halfW) / (abreast - 0.5)) : 0;
      } else {
        const maxAbreast = Math.max(1, Math.floor((2 * halfW) / 1.1) + 1);
        const rows = Math.ceil(o.n / maxAbreast);
        abreast = Math.ceil(o.n / rows);
        slot = abreast > 1 ? (2 * halfW) / (abreast - 0.5) : 0;   // rows offset ±¼ slot (staggered) still fit
      }
      this.riders = this.msos.map((mso, i) => {
        const row = Math.floor(i / abreast), col = i % abreast;
        const inRow = Math.min(abreast, o.n - row * abreast);              // riders in this row (last may be short)
        const stagger = o.grid === 'narrow' ? 0 : (row % 2 ? 0.25 : -0.25);
        const y0 = clamp((col + stagger - (inRow - 1) / 2) * slot, -halfW, halfW);
        return {
          id: i, mso,
          wcap: 60 * mso, wbal: 60 * mso,               // ≈21 kJ at 350 W
          x: -row * 2.3, y: y0, v: v0,
          homeU: this.rng() * 2 - 1,                    // preferred lateral slot (scaled by group size) when relaxed
          vy: 0, yTs: null, targetId: -1,
          mode: i === 0 ? 'pull' : 'ride', modeT: 0, pullLimit: 20,
          side: 1, bridgeTo: -1,
          d: 1, P: 0, Plim: mso, dw: Infinity, dwPrev: Infinity, dwRate: 0, wheel: -1,
          attached: true, group: 0, status: 'free', canPass: true
        };
      });
      this.prevCounts = this.counts();
      this.prevPos = this.riders.map(r => ({ x: r.x, y: r.y }));
      this.pcrSeries = [];
      this.events = [];
      this.lastGroupOf = null;
      this.metric = { pcr: 0, cx: 1, cxp: 0, delta: 0, x: 0 };
      this.cond = { speedKmh: o.speedKmh, grade: 0, d0: 0.62, draft: 'netlogo', reserve: true, urge: 0.5, width: 15, rejoin: 'auto',
        sRule: 'line', pcrBasis: 'scheduled', lull: true };
      this.road = ROAD - 0.3;
      this.findGroups();
    }

    // ---------- MSO assignment ------------------------------------------------
    static drawMSOs(o, rand) {
      const n = o.n;
      if (o.msoMode === 'even') {
        return Array.from({ length: n }, (_, i) =>
          o.centre * (1 + o.spread / 100 * (n === 1 ? 0 : 2 * i / (n - 1) - 1)));
      }
      if (o.msoMode === 'range') {
        // Seeded uniform draws within [lo, hi], so a field has realistic, uneven variety.
        const [lo, hi] = o.range && o.range.length === 2 ? o.range : [215, 337];
        return Array.from({ length: n }, () => Math.round(lo + rand() * (hi - lo)));
      }
      const pool = (o.msoMode === 'custom' && o.custom && o.custom.length) ? o.custom : SCRATCH_POOL;
      if (pool.length === n) return pool.slice();
      // As in the paper's simulations: random draw with replacement from the pool.
      return Array.from({ length: n }, () => pool[Math.floor(rand() * pool.length)]);
    }

    // ---------- Physics ------------------------------------------------------
    /** Power (W) to ride at v (m/s) on grade (fraction) with no shelter: aero + rolling + gravity (Eqs. 1–2). */
    static roadPower(v, grade = 0) {
      const th = Math.atan(grade);
      return 0.5 * PHYS.rho * PHYS.cda * v * v * v
        + PHYS.crr * PHYS.mass * PHYS.g * Math.cos(th) * v
        + PHYS.mass * PHYS.g * Math.sin(th) * v;
    }
    /** Speed (m/s) at which d × roadPower(v) equals P. */
    static speedForPower(P, d = 1, grade = 0) {
      let lo = 0.3, hi = 30;
      if (d * Peloton.roadPower(lo, grade) >= P) return lo;
      for (let k = 0; k < 50; k++) {
        const mid = (lo + hi) / 2;
        if (d * Peloton.roadPower(mid, grade) > P) hi = mid; else lo = mid;
      }
      return (lo + hi) / 2;
    }
    /** PCR_i = d × P_front / MSO_i (Eq. 4). */
    static pcr(frontPower, d, mso) { return d * frontPower / mso; }

    /** Olds' drafting coefficient (Eq. 5), with the 0.62 intercept replaced by the chosen d0. */
    static oldsD(dw, d0 = 0.62) {
      if (dw < 0) return 1;
      return Math.min(1, d0 - 0.0104 * dw + 0.0452 * dw * dw);
    }
    /** Fraction of the drafting benefit retained at a lateral offset (m). Illustrative. */
    static lateralFactor(dy) {
      const a = Math.abs(dy);
      return a <= 0.25 ? 1 : Math.max(0, 1 - (a - 0.25) / 0.65);
    }
    /** Per-rider capacity thresholds (km/h) at the given grade and d0. */
    static thresholds(mso, grade, d0) {
      const exposed = Peloton.speedForPower(mso, 1, grade);
      return {
        exposed: exposed * 3.6,                                  // can ride alone / lead
        pass: Math.max(0, exposed - PASS_DV) * 3.6,              // pace above which voluntary passing stops
        sheltered: Peloton.speedForPower(mso, d0, grade) * 3.6   // can hold an ideal wheel
      };
    }

    // ---------- Geometry -----------------------------------------------------
    /** Ahead-counts as in the paper: another rider is ahead if > 1 m forward and < 1 m lateral. */
    counts(pos = this.riders, subset = null) {
      const ids = subset || pos.map((_, i) => i);
      return ids.map(i => {
        let c = 0;
        for (const j of ids) if (pos[j].x - pos[i].x > 1 && Math.abs(pos[j].y - pos[i].y) < 1) c++;
        return c;
      });
    }

    draftCoefficient(a, c) {
      if (c.draft === 'fixed') {
        // v1 rule: full fixed-d shelter if anyone is 1–8 m ahead within 1 m laterally.
        const sh = this.riders.some(b => b !== a && b.x - a.x > 1 && b.x - a.x < 8 && Math.abs(b.y - a.y) < 1);
        return sh ? c.d0 : 1;
      }
      if (c.draft !== 'fade') {
        // NetLogo calculate-draft: if more than one rider is ahead within the draft zone in a 60° cone, d follows
        // Olds from the nearest of them; otherwise from the nearest rider in a 10° cone; otherwise no shelter (d = 1).
        // Riders' positions are treated as NetLogo points for the cones; Olds' spacing is the wheel gap, since here
        // riders have a bike length (NetLogo's turtles are points, so its centre distance is the wheel spacing).
        let n60 = 0, near60 = Infinity, near10 = Infinity;
        for (const b of this.riders) {
          if (b === a) continue;
          const dx = b.x - a.x, dy = Math.abs(b.y - a.y);
          const gap = Math.hypot(Math.max(0, dx - BIKE), dy);
          if (dx <= 0 || dx - BIKE < 0 || gap > DRAFT_RANGE) continue;
          const ang = Math.atan2(dy, dx) * 180 / Math.PI;
          if (ang <= DRAFT_CONE_PACK / 2) { n60++; near60 = Math.min(near60, gap); }
          if (ang <= DRAFT_CONE_SINGLE / 2) near10 = Math.min(near10, gap);
        }
        if (n60 > 1) return Peloton.oldsD(near60, c.d0);
        if (near10 < Infinity) return Peloton.oldsD(near10, c.d0);
        return 1;
      }
      let best = 0;
      for (const b of this.riders) {
        if (b === a) continue;
        const dw = b.x - a.x - BIKE;
        if (dw < 0 || dw > DRAFT_RANGE) continue;
        const lat = Peloton.lateralFactor(b.y - a.y);
        if (lat <= 0) continue;
        best = Math.max(best, (1 - Peloton.oldsD(dw, c.d0)) * lat);
      }
      return 1 - best;
    }

    /** Rider directly ahead in the same lane (|dy| < 0.6) within 40 m, or null. */
    wheelOf(a) {
      let w = null, best = 40;
      for (const b of this.riders) {
        if (b === a) continue;
        const dx = b.x - a.x;
        if (dx > 0.3 && dx < best && Math.abs(b.y - a.y) < 0.6) { best = dx; w = b; }
      }
      return w;
    }

    findGroups(dt = 0) {
      const order = [...this.riders].sort((p, q) => q.x - p.x);
      const groups = [];
      order.forEach((r, k) => {
        if (k === 0) { r.attached = true; groups.push([r]); return; }
        const gap = order[k - 1].x - r.x - BIKE;
        // Hysteresis: split once the gap has exceeded SPLIT_GAP for 2 s (or at once beyond 2 × SPLIT_GAP),
        // so a brief straggle (e.g. drifting back after a pull) is not a split; rejoin below JOIN_GAP.
        r.gapOverT = gap > SPLIT_GAP ? (r.gapOverT || 0) + dt : 0;
        if (r.gapOverT > 2 || gap > 2 * SPLIT_GAP) r.attached = false;
        else if (gap < JOIN_GAP) r.attached = true;
        if (r.attached) groups[groups.length - 1].push(r); else groups.push([r]);
      });
      this.groups = groups.map((members, gi) => {
        members.forEach(r => { r.group = gi; });
        const ys = members.map(r => r.y);
        return {
          index: gi, members,
          headX: members[0].x, tailX: members[members.length - 1].x,
          length: members[0].x - members[members.length - 1].x + BIKE,
          width: Math.max(...ys) - Math.min(...ys) + 0.6,
          meanY: ys.reduce((s, y) => s + y, 0) / ys.length
        };
      });
      return this.groups;
    }

    // ---------- Dynamics -----------------------------------------------------
    /**
     * Advance the model by dt seconds.
     * cond: { speedKmh, grade (%), d0, draft: 'netlogo'|'fade'|'fixed', reserve: bool, urge: 0–1 }
     */
    step(dt, cond) {
      const c = Object.assign({}, this.cond, cond);
      this.cond = c;
      const grade = c.grade / 100;
      const vPace = c.speedKmh / 3.6;
      const R = this.riders;
      const ROAD = this.road = Math.max(2, (c.width || 2 * 7.5) / 2 - 0.3);   // usable half-width (m)
      const Pexp = v => Peloton.roadPower(v, grade);
      this.t += dt;

      // Pass 1: shelter, wheels, gaps and groups from the current state.
      for (const a of R) {
        a.d = this.draftCoefficient(a, c);
        const w = this.wheelOf(a);
        a.wheel = w ? w.id : -1;
        a.dwPrev = a.dw;
        a.dw = w ? w.x - a.x - BIKE : Infinity;
        const rate = (isFinite(a.dw) && isFinite(a.dwPrev)) ? (a.dw - a.dwPrev) / dt : 0;
        a.dwRate += (rate - a.dwRate) * Math.min(1, dt * 1.5);
        // Losing the wheel: a gap beyond 2 m that keeps opening for 1 s while the rider is power-limited (detected
        // early, so riders behind can react before the gap becomes a split).
        const strained = isFinite(a.dw) && a.dw > 2 && a.dwRate > 0.05 && a.mode !== 'pulloff' && a.P >= 0.97 * a.Plim;
        a.strainT = strained ? (a.strainT || 0) + dt : 0;
        a.losing = a.strainT > 1.0;                                 // sustained, not a momentary acceleration
        if (!c.reserve) a.wbal = a.wcap;
      }
      this.findGroups(dt);

      // Assign group leaders (front-most rider not swinging off), and each group's "relax" factor: 1 below
      // threshold (group's ideal PCR at its speed under ~0.55, compact phases) falling to 0 at the Scratch
      // high quantile (0.738), where the group lines out.
      for (const g of this.groups) {
        const vg = Math.max(g.members[0].v, vPace);       // the pace the group is trying to ride (chasing groups too)
        const gp = g.members.reduce((t, r) => t + Peloton.pcr(Pexp(vg), c.d0, r.mso), 0) / g.members.length;
        g.relax = 1 - smooth(0.55, REF.pcrHigh, gp);
        // Tactical waiting (positions locking until someone moves) belongs to the compact-static range: full at a
        // group PCR at pace ≤ 0.45, fading to none by 0.55 (about 36 km/h for the Scratch field). Above that a
        // relaxed bunch keeps mixing (convective) rather than locking.
        g.lullK = 1 - smooth(0.45, 0.55, gp);
        // Chase capacity: the speed the group's stronger half (k riders) can hold sharing the front, each spending
        // 1/k of the time exposed and the rest sheltered: Pexp(v) × (1 + d(k − 1)) / k = their mean MSO...
        {
          const ms = g.members.map(r => r.mso).sort((p, q) => q - p);
          const k = Math.max(1, Math.ceil(ms.length / 2));
          const mStrong = ms.slice(0, k).reduce((t, m) => t + m, 0) / k;
          const vRot = Peloton.speedForPower(mStrong, (1 + c.d0 * (k - 1)) / k, grade);
          // ...and no faster than its weakest member can follow in shelter (d ≈ 0.7, within 95 % of MSO), so the
          // group chases as a unit instead of shedding riders and fragmenting.
          const vKeep = Peloton.speedForPower(0.95 * ms[ms.length - 1], Math.max(c.d0, 0.7), grade);
          g.vChase = ms.length > 1 ? Math.min(vRot, vKeep) : vRot;
        }
        const leader = g.members.find(r => r.mode !== 'pulloff') || g.members[0];
        g.leader = leader;
        for (const r of g.members) {
          if (r === leader && r.mode !== 'pull') {
            // In a lull nobody wants to come through: pulls last longer (up to ~3×) when activity is low and the group relaxed.
            const lullPull = c.lull === false ? 1 : 1 + 2 * g.lullK * (1 - (this.activity ?? 1));
            r.mode = 'pull'; r.modeT = 0; r.pullLimit = (15 + 15 * this.rng()) * lullPull;
          } else if (r !== leader && r.mode === 'pull') {
            r.mode = 'ride'; r.modeT = 0;
          }
        }
      }

      // Tactical waiting (compact-static, Cs): at easy paces a group tends to lock into position until someone makes
      // a move. Group "activity" (lead group) decays with a ~10 s time constant; now and then (about once every
      // 40 s) a rider with capacity makes a move unprompted, which lifts activity and sets off a burst of
      // follow-on moves (ordinary moves add only a little, so the burst dies away rather than feeding itself).
      // Move-up and easing-back rates are scaled by activity, more strongly the more relaxed the group.
      if (this.activity === undefined) this.activity = 0.3;
      this.activity *= Math.exp(-dt / 10);
      this.sparkDue = c.lull !== false && this.rng() < dt / 40;

      // NetLogo calculate-position (cohesion and separation), computed for every rider from the current state.
      // Positions are treated as NetLogo points; heading is along the road (+x). Cohesion: toward the mean position of
      // the riders within 20 m in a 140° cone ahead. Separation (only when that neighbourhood is non-empty, as in
      // NetLogo): away from riders within 1.5 m in a 240° cone, each weighted by 1/distance (a unit vector each).
      for (const a of R) {
        let mx = 0, my = 0, nc = 0, sx = 0, sy = 0;
        for (const b of R) {
          if (b === a) continue;
          const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy);
          if (dist <= 0) continue;
          const ang = Math.atan2(Math.abs(dy), dx) * 180 / Math.PI;   // 0 = straight ahead, 180 = straight behind
          if (dist <= COH_ZONE && ang <= COH_CONE / 2) { mx += dx; my += dy; nc++; }
          if (dist <= SEP_ZONE && ang <= SEP_CONE / 2) { sx -= dx / dist; sy -= dy / dist; }
        }
        a.cohX = nc ? COH_KX * mx / nc : 0; a.cohY = nc ? COH_KY * my / nc : 0;
        a.sepX = nc ? SEP_K * sx : 0;       a.sepY = nc ? SEP_K * sy : 0;
      }

      // Pass 2: decide targets for each rider (synchronous update).
      const plan = R.map(a => {
        const g = this.groups[a.group];
        const leader = g.leader;
        const vRef = leader.v;
        a.chasing = false;
        // No random lateral wandering: riders hold their lateral position (a.holdY) except when manoeuvring.
        const wfrac = a.wbal / a.wcap;
        const Pmax = c.reserve ? a.mso * (1 + Math.sqrt(Math.max(0, wfrac))) : a.mso;
        const q = Peloton.pcr(Pexp(vRef), c.d0, a.mso);          // ideal sheltered demand at group speed
        a.isLeader = a === leader;
        // Riders a mover may pass while unsheltered: 10 at compact-static speeds (PCR_i ≤ 0.488, the Scratch low
        // quantile), falling linearly to 0 at PCR_i = d, where the rider could no longer ride the pace exposed.
        // Capacity factor: 1 at compact-static speeds (PCR_i ≤ 0.488), falling linearly to 0 at PCR_i = d. It sets
        // both how many riders a mover may pass unsheltered (up to 10) and how strongly it wants to move up.
        a.capacity = clamp((c.d0 - q) / (c.d0 - REF.pcrLow), 0, 1);
        a.passLimit = Math.round(10 * a.capacity);
        // Reintegration: in a relaxed bunch (group relax factor > 0.3), a rider further behind the group's head than
        // the bunch's compact length (about 2.2 m × √N) is off the back, e.g. after a surge has strung the bunch out.
        // Such riders try to get back in even if it takes them close to their threshold, while the riders at the front
        // simply hold the pace (effectively resting): they move up regardless of lulls, may pass as many riders as it
        // takes to get back within the compact length, and close up in their own lane when there is room.
        const Lc = 2.2 * Math.sqrt(g.members.length);
        a.offBack = (g.relax || 0) > 0.3 && g.members.length > 3 ? Math.max(0, g.members[0].x - a.x - Lc) : 0;
        a.reint = a.offBack > 1 && c.urge > 0;
        if (a.reint) a.passLimit = Math.max(a.passLimit, 1 + g.members.filter(b => b.x > a.x && g.members[0].x - b.x > Lc).length);
        // The passing rule behind the stretched phase: moving up past riders means riding exposed,
        // faster than the group. It is voluntary, so it must be sustainable: roadPower(vRef + 0.8 m/s) <= MSO.
        const Ppass = Pexp(vRef + PASS_DV);
        a.passEase = clamp((1 - Ppass / a.mso) / 0.3, 0, 1);
        // A rider with capacity left (it may pass at least one rider) can also come round on its anaerobic reserve,
        // if the pass is short enough to afford: the extra power over the riders it may pass costs less than half
        // its remaining W′. This applies only in a relaxed bunch (the compact phases, group relax factor > 0.5): near
        // threshold, voluntary passing must be sustainable on MSO alone, which is what produces the stretched phase.
        const passCost = (Ppass - a.mso) * a.passLimit * (BIKE + 0.4) / PASS_DV;
        a.canPass = Ppass <= a.mso ||
          (c.reserve && a.passLimit >= 1 && (g.relax || 0) > 0.5 && Ppass <= Pmax && passCost < 0.5 * a.wbal && (a.fatigue || 0) < 0.05) ||
          (a.reint && c.reserve && Ppass <= Pmax && wfrac > 0.25);   // off the back: get back in, close to threshold if need be
        // Shelter-seeking pressure rises with ideal sheltered demand, and is strong for anyone who needs a wheel.
        const needsWheel = Pexp(vRef) > a.mso;
        // Fatigue (depleted W′) after a hard effort: tired riders keep to wheels and do not move up until
        // they have recovered, so a stretched line can persist while the pace eases (the paper's Sf branch).
        a.fatigue = c.reserve ? smooth(0.3, 0.6, 1 - wfrac) : 0;     // 0 when W′ > 70 %, 1 when W′ < 40 %
        // In a relaxed group (well below threshold) riders stay in the bunch, where the row ahead shelters them,
        // instead of lining out on wheels: wheel-seeking is damped by the group's relax factor (and by the urge
        // to move up), so lines form only as the group approaches threshold.
        const pressRaw = Math.max(smooth(0.6, 0.88, q), needsWheel ? 0.75 : 0, 0.9 * a.fatigue);
        const press = pressRaw * (1 - 0.85 * g.relax);   // (independent of the urge slider, which only sets the move-up rate)
        a.modeT += dt;
        let vT = vRef, yT = a.y, Plim = Pmax;

        if (a.mode === 'pull') {
          // Front of a group: aim for the requested pace. Riding alone, pace yourself at MSO.
          vT = vPace;
          // Leading a group behind another one. Within 80 m, ride hard to bridge (tail speed + 0.4 × gap, 1–3 m/s
          // faster; the power cap decides whether it can). Further back, chase in an organised way (short turns, see
          // pullFor) at any distance, as long as the group has the capacity: its chase speed (g.vChase: stronger half
          // sharing the front, no faster than its weakest member can follow) is above the speed of the group ahead.
          // Without the capacity it rides the requested pace.
          a.chasing = false;
          if (a.group > 0) {
            const aheadG = this.groups[a.group - 1];
            const gapAhead = aheadG.tailX - a.x - BIKE;
            const tailV = aheadG.members[aheadG.members.length - 1].v;
            const capable = g.vChase > tailV + 0.2;
            if (gapAhead < 80) vT = Math.max(vT, tailV + clamp(0.4 * gapAhead, 1.0, 3.0));
            else if (capable) vT = Math.max(vT, Math.min(g.vChase, tailV + 3.0));
            a.chasing = capable;
          }
          a.chaseVT = a.chasing ? vT : 0;   // the chase speed aimed for (riders swinging off use this, not the leader's actual speed)
          if (g.members.length === 1) {
            // Alone: pace yourself at MSO, unless the group ahead is close enough to chase back on with W′.
            const ahead = a.group > 0 ? this.groups[a.group - 1] : null;
            const gapAhead = ahead ? ahead.tailX - a.x - BIKE : Infinity;
            Plim = (c.reserve && gapAhead < 40 && wfrac > 0.25) ? Pmax : a.mso;
            a.chasing = a.chasing || Plim > a.mso;
          }
          // Pull until W′ falls to 70 % in a relaxed bunch, to 40 % when the group is lined out at threshold (strong
          // riders drive for longer, so the line rotates less, as in stretched racing).
          // While chasing, a puller holds its short turn and swings off early only when nearly spent (15 % W′).
          const tooTired = c.reserve && wfrac < (a.chasing ? 0.15 : 0.7 - 0.3 * (1 - g.relax));
          const cantHold = !c.reserve && Pexp(a.v) > a.mso && a.modeT > 6;
          // Riders who cannot sustain the front take only a token turn before swinging off.
          if (Pexp(vPace) > 1.4 * a.mso) a.pullLimit = Math.min(a.pullLimit, 8);   // token turn only if far over MSO
          // While chasing, share the work: through and off after 8–12 s on the front.
          const pullFor = a.chasing ? 8 + 4 * ((a.id * 0.618) % 1) : a.pullLimit;
          if (g.members.length > 1 && a.modeT > 4 && (tooTired || cantHold || a.modeT > pullFor)) {
            a.mode = 'pulloff'; a.modeT = 0; a.pullY = undefined;
            // Where to rejoin: a sheltered slot within the first 10 riders (position 2–10, drawn per pull).
            a.slotRank = 2 + Math.floor(this.rng() * Math.max(1, Math.min(9, g.members.length - 2)));
            const others = g.members.filter(r => r !== a);
            const my = others.reduce((s, r) => s + r.y, 0) / others.length;
            a.side = a.y >= my ? 1 : -1;
          }
          yT = clamp(0, a.y - 1.5, a.y + 1.5);                      // the front rider heads for the middle of the road
        }

        if (a.mode === 'pulloff') {
          // Swing out beyond the edge of the group, then drift back along it and rejoin at the tail.
          const others = g.members.filter(r => r !== a && r.mode !== 'pulloff');
          const tail = g.members[g.members.length - 1];
          if (others.length) {
            // Step just to the side of the line, about 1 m (a rider's width plus a little), to whichever side has
            // fewer riders close behind, rather than out to a free lane at the edge of a wide bunch.
            if (a.pullY === undefined || a.modeT < dt * 1.5) {
              const near = sd => others.filter(r => r.x < a.x + 1 && r.x > a.x - 8 && (r.y - a.y) * sd > 0.3 && (r.y - a.y) * sd < 1.6).length;
              const sd = near(a.side) <= near(-a.side) ? a.side : -a.side;
              a.pullY = clamp(a.y + sd * 1.0, -ROAD, ROAD);
            }
            yT = a.pullY;
          }
          const out = Math.abs(a.y - yT) < 0.35;
          // Hold the requested pace until clear of the line (never take the speed of the rider behind, which
          // could be held up by this rider: that feedback spirals down); once clear, drift back.
          // Reference: the speed the group's leader can actually produce at the front (pace capped by its power
          // limit), which does not depend on whether this rider is momentarily in its way.
          const lead = leader === a ? null : leader;
          const vLead = lead ? Math.min(vPace, Peloton.speedForPower(lead.Plim || lead.mso, 1, grade)) : vPace;
          // Drift back faster along a stretched line; in a chasing group's rotation, only 0.6 m/s slower, so the
          // through-and-off keeps the group together.
          const chasingGroup = g.leader && g.leader !== a && g.leader.chasing;
          // Based on the chase speed the leader aims for, never its actual speed: referencing each other's actual speed
          // lets a leader held up by a rider swinging off and that rider slow each other down in a spiral.
          const vBase = chasingGroup ? Math.max(vLead, g.leader.chaseVT || 0) : vLead;
          // Start easing off as soon as the turn ends, reaching the full drift-back difference within about a second,
          // rather than holding the pace until clear of the line.
          const drop = chasingGroup ? 0.6 : 1.2 + 0.8 * (1 - g.relax);
          vT = vBase - drop * Math.min(1, a.modeT / 1.0);
          Plim = a.mso;
          // Once enough riders have gone past (slotRank), slip back into shelter near the front rather than
          // drifting to the tail: take the first free slot (room for a bike behind a nearby rider). In a tight
          // single-file line at threshold there may be none, so the rider keeps drifting until a gap appears.
          const ahead = others.filter(r => r.x > a.x);
          // Applies below threshold; at threshold only if cond.rejoin === 'front' (forcing riders back into a tight
          // line sends a braking ripple down it that can drop weaker riders, so by default they drift further back).
          const frontOK = c.rejoin === 'front' || (c.rejoin !== 'back' && g.relax > 0.25);
          if (out && frontOK && ahead.length >= Math.min(a.slotRank, others.length)) {
            // Only a slot just ahead (the drifting rider is already almost level with it), so that merging needs
            // almost no change of speed and riders behind are not dragged off the wheel.
            const near = ahead.filter(r => !(r.easeT > 0) && !r.merging && r.x - a.x > BIKE * 0.6 && r.x - a.x < BIKE + 2.5).sort((p, q) => p.x - q.x);
            const free = near.find(j => !g.members.some(k => k !== a && k !== j && k.x < j.x && j.x - k.x < 2 * BIKE + 0.8 && Math.abs(k.y - j.y) < 0.6));
            const slot = free || (c.rejoin === 'front' ? near[0] : null);   // 'front': squeeze in; those behind ease off
            if (slot) { a.mode = 'ride'; a.modeT = 0; a.merging = true; a.mergeTo = slot.id; }
          }
          if (a.mode === 'pulloff' && (tail === a || a.x <= tail.x - 1 || a.modeT > 60 || !others.length)) { a.mode = 'ride'; a.modeT = 0; a.holdY = a.y; a.centreT = 10; }
        }

        if (a.mode === 'advance') {
          // Moving up through an open lane with genuine (exposed) reserve. Abort when reserve disappears.
          // If someone blocks that lane ahead, step one more lane out (towards the flank).
          const laneBlocked = R.some(b => b !== a && b.x > a.x && b.x - a.x < BIKE + 1.5 && Math.abs(b.y - a.advY) < 0.6);
          // Pass close to the riders being passed: step at most one extra lane out; if still blocked, give up.
          if (laneBlocked) {
            if ((a.advSteps || 0) < 1 && Math.abs(a.advY + a.side * 0.9) <= ROAD) { a.advY += a.side * 0.9; a.advSteps = 1; }
            else if (a.modeT > 4) { a.mode = 'ride'; a.modeT = 0; a.holdY = a.y; a.centreT = 10; }
          }
          // Angle in as the move progresses: the passing lane drifts toward the middle (at most 0.25 m/s), hugging
          // the riders being passed, never closer than 0.8 m outside the innermost rider just ahead or alongside.
          // So a rider passing on the outside starts angling toward the front-centre from well back, rather than
          // holding the flank and cutting across near the front.
          if (!laneBlocked && a.mode === 'advance' && a.outside) {   // only when passing on the outside
            const inward = -a.side;
            let limit = g.meanY;                                   // with open road ahead, angle toward the bunch's middle
            for (const b of g.members) {
              if (b === a || b.x - a.x < -BIKE || b.x - a.x > BIKE + 4) continue;
              if ((b.y - a.y) * inward > -0.3) {                   // inside of (or level with) the mover
                const edge = b.y - inward * 0.8;
                if ((edge - limit) * inward < 0) limit = edge;    // the outermost such rider sets the limit
              }
            }
            if ((limit - a.advY) * inward > 0) a.advY += inward * Math.min((limit - a.advY) * inward, 0.25 * dt);
          }
          yT = a.advY;
          vT = vRef + PASS_DV;
          // Pass a limited number of riders while unsheltered, then tuck into the nearest sheltered slot
          // (behind a rider just ahead, towards the middle of the group), from where it may move up again later.
          if (a.d > 0.9 && a.advAhead) {
            for (const id of a.advAhead) if (R[id].x < a.x - 0.5) a.advPassed.add(id);
          }
          // The limit (a.passLimit) falls from 10 riders at compact-static speeds to 0 at PCR_i = d.
          if (a.mode === 'advance' && a.advAhead && a.advPassed.size >= Math.max(1, a.passLimit)) {
            // The slot is a little ahead (behind a rider 1.1–2.4 bike lengths ahead), so the rider angles forward into it.
            const near = g.members.filter(b => b !== a && b.mode === 'ride' && !(b.easeT > 0) && !b.merging && b.x - a.x > BIKE + 0.9 && b.x - a.x < BIKE + 4.5)
              .sort((p, q) => Math.abs(p.y - g.meanY) - Math.abs(q.y - g.meanY));
            const free = near.find(j => !g.members.some(k => k !== a && k !== j && k.x < j.x && j.x - k.x < 2 * BIKE + 0.8 && Math.abs(k.y - j.y) < 0.6));
            a.mode = 'ride'; a.modeT = 0;
            if (free) { a.merging = true; a.mergeTo = free.id; } else { a.holdY = a.y; a.centreT = 10; }
          }
          if (a.mode === 'advance' && (!a.canPass || a.x >= leader.x - 2.5 || a.modeT > 45)) { a.mode = 'ride'; a.modeT = 0; a.holdY = a.y; a.centreT = 10; }   // then ease toward the middle and hold
        }

        if (a.mode === 'bridge') {
          // Coming around a failing wheel to reach the riders ahead.
          const target = R[a.bridgeTo];
          if (!target || (target.group === a.group && a.dw < 3 && a.modeT > 2) || target.mode === 'advance' || target.mode === 'pulloff' || (c.reserve && wfrac < 0.08) || a.modeT > 45) { a.mode = 'ride'; a.modeT = 0; }
          else {
            const passed = R.filter(b => b !== a && b.x > a.x && b.x < target.x - 0.5 && Math.abs(b.y - a.y) < 0.9);
            yT = passed.length ? clamp(a.bridgeY, -ROAD, ROAD) : target.y;
            vT = target.v + BRIDGE_DV;
            if (target.x - a.x - BIKE < 2 && (Math.abs(target.y - a.y) < 0.8 || !passed.length)) { a.mode = 'ride'; a.modeT = 0; }
          }
        }

        if (a.mode === 'ride') {
          let w = a.wheel >= 0 ? R[a.wheel] : null;
          if (w && w.mode === 'pulloff') w = null;
          let stuck = false;

          // A wheel that is losing contact, or with a gap opening in front of it (> 2 m and growing): come around and
          // close the gap if affordable (using up to 90 % of W′), otherwise stay stuck behind it.
          if (w && (w.losing || (isFinite(w.dw) && w.dw > 2 && w.dwRate > 0.1 && w.mode === 'ride' && !w.merging)) && !a.losing) {
            const ahead = w.wheel >= 0 ? R[w.wheel] : leader;
            const gap = Math.max(0, ahead.x - a.x - BIKE);
            const vb = ahead.v + BRIDGE_DV, Pb = Pexp(vb);
            const affordable = c.reserve
              ? (Pb <= a.mso || (Pb <= Pmax && (Pb - a.mso) * gap / BRIDGE_DV < 0.9 * a.wbal))
              : Pb <= a.mso;
            if (affordable && ahead !== w) {
              a.mode = 'bridge'; a.modeT = 0; a.bridgeTo = ahead.id;
              a.bridgeY = w.y + (w.y > g.meanY ? -1.1 : 1.1);
              if (Math.abs(a.bridgeY) > ROAD) a.bridgeY = w.y - Math.sign(a.bridgeY) * 1.1;
            } else stuck = true;
          }

          // Voluntary moving up (convective mixing) needs exposed reserve and motivation.
          // Held up by a slowing wheel: a rider with capacity directly behind a rider who is decelerating (swinging
          // off, easing back, or simply slower than the group) steps out and goes past when there is room, rather
          // than slowing with it and being pushed back down the line.
          const sw = a.wheel >= 0 ? R[a.wheel] : null;
          const heldUp = !stuck && a.mode === 'ride' && !a.merging && a !== leader && sw && sw.group === a.group &&
            isFinite(a.dw) && a.dw < 2.5 && Math.abs(sw.y - a.y) < 0.6 && a.canPass && a.capacity > 0 && !a.losing &&
            (sw.mode === 'pulloff' || sw.easeT > 0 || sw.losing || sw.v < vRef - 0.3);
          if (!stuck && a.mode === 'ride' && a !== leader && a.canPass && !a.losing &&
              (heldUp || (a.passLimit >= 1 && (a.fatigue < 0.05 || (a.reint && a.wbal / a.wcap > 0.35))))) {
            const rank = g.members.indexOf(a) / Math.max(1, g.members.length - 1);
            // Riders with spare capacity want to be near the front: the further back, and the more reserve, the more
            // often they try (with the default urge 0.6, a rider with ample reserve at the back tries about every 4 s).
            // Motivation to move up is proportional to capacity: strongest well below threshold, none at PCR_i = d.
            const lullW = c.lull === false || a.group !== 0 ? 0 : g.lullK;
            const act = a.reint ? 1 : 1 - lullW * (1 - this.activity);   // riders off the back do not wait for a move
            // Rate of starting a move (per second) for a rider who is able to: 0.5 × urge × [position-and-capacity term
            // + back-third term] × lull factor. Urge 0 switches moving up off; the slider only sets this rate.
            // Being near the back is a reason of its own: a rider in the back third wants to move up as long as it
            // has any capacity to do so (it may pass at least one rider), however weak, so this part does not scale
            // with capacity.
            const backUrge = 0.6 * smooth(0.55, 0.85, rank);
            const reintUrge = a.reint ? 1.5 * smooth(1, 6, a.offBack) : 0;   // grows with distance off the back
            const rate = 0.5 * c.urge * ((0.25 + 0.6 * rank) * a.capacity + backUrge) * act + reintUrge;
            const spark = this.sparkDue && a.group === 0 && a.capacity > 0.3 && c.urge > 0;   // urge 0: nobody moves up
            // Room to step out: nobody alongside (within a bike length) between this rider and the lane 0.9 m over.
            const sideFree = sd => Math.abs(a.y + sd * 0.9) <= ROAD && !g.members.some(b => b !== a &&
              Math.abs(b.x - a.x) < BIKE + 0.2 && (b.y - a.y) * sd > 0.05 && (b.y - a.y) * sd < 1.3);
            const offMid = a.y - g.meanY;
            const outSide = Math.abs(offMid) > 0.3 ? Math.sign(offMid) : 0;
            const startSide = outSide && sideFree(outSide) ? outSide
              : outSide && sideFree(-outSide) ? -outSide
              : !outSide && sideFree(1) ? 1 : !outSide && sideFree(-1) ? -1 : 0;
            // A rider boxed in on both sides waits for room rather than starting a move it cannot make.
            if (startSide && (heldUp || (rank > 0.15 && a.x < leader.x - 3 && (spark || this.rng() < rate * dt)))) {
              if (spark) this.sparkDue = false;
              if (a.group === 0) this.activity = Math.min(1, this.activity + (spark ? 0.7 : 0.01));   // a move prompts others
              a.mode = 'advance'; a.modeT = 0; a.merging = false;
              // Move up on the outside: step one rider-width out toward the nearer flank of the bunch (away from its
              // middle); a rider right in the middle takes the side with fewer riders ahead in it.
              const busy = sd => g.members.filter(b => b !== a && b.x > a.x - 1 && b.x < a.x + 10 &&
                Math.abs(b.y - (a.y + sd * 0.9)) < 0.6).length;
              // (Toward the flank where there is room; otherwise through a gap on the inside.)
              a.side = outSide && startSide === outSide ? outSide : !outSide ? (sideFree(1) && sideFree(-1) ? (busy(1) <= busy(-1) ? 1 : -1) : startSide) : startSide;
              a.outside = outSide !== 0 && a.side === outSide;
              if (Math.abs(a.y + a.side * 0.9) > ROAD) a.side = -a.side;
              a.advY = clamp(a.y + a.side * 0.9, -ROAD, ROAD); a.advSteps = 0;
              a.advAhead = g.members.filter(b => b !== a && b.x > a.x + 0.5).map(b => b.id); a.advPassed = new Set();
            }
          }

          // Convective counterpart (Ccl/Cch): in a relaxed bunch, riders near the front (not the leader) now and then
          // ease off for a few seconds and let the bunch flow past them, while riders behind move up the margins.
          a.easeT = Math.max(0, (a.easeT || 0) - dt);
          if (a.mode === 'ride' && a.group === 0 && a !== leader && !a.merging && !stuck && a.easeT === 0 && g.relax > 0.6) {
            const rankF = g.members.indexOf(a) / Math.max(1, g.members.length - 1);
            const actE = c.lull === false ? 1 : 1 - 0.9 * g.lullK * (1 - this.activity);
            if (rankF < 0.4 && this.rng() < 0.06 * g.relax * actE * dt) a.easeT = 4 + 4 * this.rng();
          }

          if (a.mode === 'ride') {
            // Wheel gap: 0.5 m on a wheel under load; relaxed riders with the urge to move up sit closer (bunching).
            const gapGoal = Math.max(0.45, 0.5 + 0.4 * (1 - press) - 0.6 * g.relax);   // stays above the 0.4 m safety distance
            const mt = a.merging ? R[a.mergeTo] : null;
            if (a.merging && (!mt || mt.group !== a.group || mt.mode === 'pulloff' || a.modeT > 6 || mt.x - a.x < BIKE * 0.5 ||
                (Math.abs(a.y - mt.y) < 0.35 && mt.x - a.x < BIKE + 1.2))) { a.merging = false; a.holdY = a.y; a.centreT = 10; }
            if (a.merging) {
              // Rejoining after a pull: move into the slot behind the chosen rider near the front.
              yT = mt.y;
              vT = Math.max(vRef - 0.5, mt.v + clamp(0.5 * (mt.x - a.x - (BIKE + 0.6)), -0.8, 0.6));   // never far below the group's speed
              // Slot in on a diagonal, not straight across: while still well out to the side, keep edging forward
              // (if there is room behind the slot's rider); lateral speed is capped for merging riders (below).
              if (Math.abs(a.y - mt.y) > 0.4 && mt.x - a.x > BIKE + 0.9) vT = Math.max(vT, vRef + 0.3);
            } else if (stuck) {
              // Sheltered behind a failing rider: follow it, cannot get round.
              yT = w.y;
              vT = w.v + clamp(0.6 * (a.dw - gapGoal), -1.5, 1.0);
            } else {
              // Choose a wheel. Under pressure, prefer a free slot directly behind someone.
              const target = this.chooseWheel(a, g, press);
              // Relaxed riders spread across a bunch whose width grows with group size. Below threshold (group's
              // ideal PCR under ~0.55, the compact phases) the bunch spreads wide and short; it narrows as PCR
              // approaches the Scratch high quantile (0.738), where riders line out on wheels.
              // Compact (relax → 1): the bunch can cover the whole usable width of the road; lined out (relax → 0):
              // a narrow core of about 0.25·√N + 0.4 m each side.
              const narrowY = 0.25 * Math.sqrt(g.members.length) + 0.4;
              // Compact: about 0.4·√N + 0.3 m each side (≈ 0.9 m between riders abreast), up to the full road for large groups.
              // (Everyone wants to draft: the compact spread is about 0.25·√N + 0.3 m each side, a tight cluster.)
              const wideY = Math.min(ROAD - 0.4, 0.25 * Math.sqrt(g.members.length) + 0.3); const spreadY = Math.min(ROAD - 0.4, narrowY + Math.max(0, wideY - narrowY) * g.relax);
              // Held lateral position: the rider's starting slot, or where it settled after its last manoeuvre
              // (the centre bias below moves it steadily toward the middle of the road).
              let baseY = a.holdY !== undefined && a.holdY !== null ? clamp(a.holdY, -spreadY, spreadY) : a.homeU * spreadY;
              const freeY = baseY * (1 - press) + g.meanY * press * 0.3;
              if (target) {
                // Everyone wants to draft. A rider who already has shelter (d < 0.85) holds its line: no lateral
                // movement without a reason. A rider in the wind steers to within 0.15 m of its wheel's line (inside the
                // 10° draft cone), or right onto the wheel under pressure.
                const yDraft = target.y + clamp(freeY - target.y, -0.15, 0.15);   // inside NetLogo's 10° single-wheel draft cone
                if (a.d < 0.85 && press < 0.5) { a.holdY = a.y; yT = a.y; }
                else yT = target.y * press + yDraft * (1 - press);
                // In another lane a rider may sit almost level (compact, abreast); in the same lane, a wheel behind.
                const sep = Math.abs(target.y - a.y);
                const inLine = BIKE + gapGoal;
                const dxGoal = inLine - (inLine - (0.7 - 0.5 * g.relax)) * smooth(0.7, 1.1, sep);   // abreast riders can sit level when relaxed
                // Forward pressure: a relaxed rider with capacity to move up closes onto the riders ahead a little
                // more tightly (up to 0.6 m), so the bunch packs up behind the front at low speed.
                const squeeze = a.canPass ? 0.6 * g.relax * a.capacity : 0;
                // Gap closing: stronger pull-in (gain 0.8 /s, up to +2.5 m/s) so gaps behind a wheel close quickly.
                const gapErr = target.x - a.x - Math.max(0.3, dxGoal - squeeze);
                vT = vRef + clamp(gapErr * (gapErr > 0 ? 0.8 : 0.5), -0.8, 2.5);   // gentle braking avoids amplifying waves
                // NetLogo cohesion and separation along the road (x-acc): with room ahead, the pull toward the riders
                // ahead closes up at least that fast; once on the wheel, only separation can still push back. NetLogo
                // moves positions directly at no cost; here speeding up costs power, so the pull is limited to
                // 0.33 m/s per metre of room ahead, to the target and to the wheel in its own lane (it closes gaps without
                // surging into a wheel).
                const room = Math.min(gapErr, isFinite(a.dw) ? a.dw - 0.5 : gapErr);   // room to the target and to the wheel in this lane
                if (room > 0) vT = Math.max(vT, vRef + Math.min(a.cohX + a.sepX, 0.33 * room));
                else vT += Math.min(0, a.sepX);
                // Exposed beside the line (e.g. heading a second column) while needing a wheel: drop back and steer
                // into the line behind the chosen rider rather than staying exposed alongside.
                if (needsWheel && a.d > 0.9 && press > 0.5 && sep > 0.6) { vT = Math.min(vT, target.v - 0.2); yT = target.y; }
              } else {
                // Nobody to follow ahead (e.g. alongside the leader): if shelter is needed, ease back to find a wheel.
                yT = freeY;
                vT = vRef - (press > 0.5 && a.d > 0.9 ? 0.8 * press : 0) + a.cohX + a.sepX;   // NetLogo x-acc
              }
            }
          }
        }

        if (a.mode === 'ride' && a.easeT > 0) vT = Math.min(vT, vRef - 0.5);   // easing back through the bunch

        // Courtesy: a rider merging back in just ahead, into this rider's lane, is given room.
        if (a.mode === 'ride' && !a.merging) {
          const m = R.find(o => o.merging && o !== a && o.x > a.x - 0.5 && o.x - a.x < BIKE + 2.5 &&
            R[o.mergeTo] && Math.abs(R[o.mergeTo].y - a.y) < 0.6 && R[o.mergeTo].x > a.x);
          if (m) vT = Math.min(vT, vRef - 0.4);   // anchored to the group's speed, not the merging rider's (no cascade)
        }

        // Reintegration: off the back of a relaxed bunch, close up in this lane when there is room (up to 1.2 m/s
        // above the group's speed, 0.25 m/s per metre off the back), without running into the wheel ahead.
        if (a.mode === 'ride' && a.reint && !a.merging && !(a.easeT > 0)) {
          const roomL = isFinite(a.dw) ? a.dw - 0.6 : 99;
          if (roomL > 0) vT = Math.max(vT, vRef + Math.min(clamp(0.25 * a.offBack, 0.3, 1.2), 0.5 * roomL));
        }
        // Longitudinal safety: never ride into the wheel ahead in the same lane.
        const w = a.wheel >= 0 ? R[a.wheel] : null;
        if (w && a.dw < 0.4) vT = Math.min(vT, w.v - (0.4 - a.dw));
        // A leader held up by a rider swinging off steers round it rather than slowing with it.
        if (a.mode === 'pull' && w && w.mode === 'pulloff' && a.dw < 3) yT = w.y + (w.y >= a.y ? -1.0 : 1.0);

        // Lateral merging: if the target lane is blocked by a rider alongside, ease off to slot in behind.
        const blocked = R.some(b => b !== a && Math.abs(b.x - a.x) < BIKE + 0.2 &&
          Math.sign(b.y - a.y) === Math.sign(yT - a.y) && Math.abs(b.y - a.y) < Math.abs(yT - a.y) + 0.7 &&
          Math.abs(b.y - a.y) > 0.05);
        if (blocked && Math.abs(yT - a.y) > 0.5) {
          // Ease off to slip in behind: only slightly in a relaxed bunch (riders wait for room rather than drop
          // back), more firmly under pressure when the rider needs that line.
          if (a.mode === 'ride') vT -= 0.1 + 0.5 * press;
          // Moving up but boxed in by a rider alongside: ease off only very slightly (0.15 m/s) to slip out behind
          // it; still boxed in after 3 s, give up the move. Dropping back half a wheel (0.4 m/s), as before, made
          // several boxed-in movers string out the back of the bunch at constant pace.
          else if (a.mode === 'advance') {
            if (a.modeT < 3) vT = Math.min(vT, vRef - 0.15);   // ease off very slightly to slip out behind
            else { a.mode = 'ride'; a.modeT = 0; vT = vRef; }
          }
        }

        return { vT, yT, Plim, blocked };
      });

      // Pass 3: integrate power, speed, W′ and position.
      const startX = R.map(r => r.x);                          // positions before this step (riders never move back past them)
      R.forEach((a, i) => {
        const p = plan[i];
        const v = Math.max(0.5, a.v);
        const Pres = a.d * Pexp(v);
        let Pcmd = Pres + PHYS.mass * v * (p.vT - v) / 1.2;
        let acc;
        if (Pcmd < 0) { Pcmd = 0; acc = Math.max(-3, (p.vT - v) / 0.6); }
        else {
          Pcmd = Math.min(Pcmd, p.Plim);
          acc = (Pcmd - Pres) / (PHYS.mass * v);
          if (p.vT < v - 0.3) acc = Math.min(acc, Math.max(-3, (p.vT - v) / 0.6));
        }
        a.P = Pcmd;
        a.Plim = p.Plim;
        if (c.reserve) {
          if (Pcmd > a.mso) a.wbal -= (Pcmd - a.mso) * dt;
          else a.wbal += (a.mso - Pcmd) * dt * (1 - a.wbal / a.wcap) * 0.8;
          a.wbal = clamp(a.wbal, 0, a.wcap);
        }
        a.v = Math.max(0.5, a.v + acc * dt);
        a.x += a.v * dt;
        // Lateral motion: the target lane is low-pass filtered, and lateral speed (max 1 m/s) changes with
        // limited acceleration (2 m/s²), so riders drift smoothly instead of snapping. Approaching a rider
        // alongside, lateral speed is eased to zero rather than stopped dead.
        a.yTs = a.yTs === null ? p.yT : a.yTs + (p.yT - a.yTs) * Math.min(1, dt * 2);
        // Merging and moving-up riders, and riders settling in after a manoeuvre (centreT, 10 s), move across on a
        // diagonal rather than straight across the bunch.
        if (a.centreT > 0) a.centreT -= dt;
        const vyCap = a.merging || a.centreT > 0 ? 0.45 : a.mode === 'advance' ? 0.5 : 1;
        let vyT = clamp((a.yTs - a.y) * 1.2, -vyCap, vyCap);
        // Look ahead 0.4 s: if that lateral path meets a rider alongside, brake the sideways drift early.
        // Only riders whose bikes overlap longitudinally (side by side) can block a sideways move.
        const blockedAt = yy => R.some(b => b !== a && Math.abs(b.x - a.x) < BIKE + 0.05 &&
          Math.abs(b.y - yy) < 0.7 && Math.abs(b.y - yy) < Math.abs(b.y - a.y));
        // Room available sideways (to 0.75 m spacing from riders alongside): approach it smoothly, stop at it.
        if (vyT !== 0) {
          const dir = Math.sign(vyT);
          let room = Infinity;
          for (const b of R) {
            if (b === a || Math.abs(b.x - a.x) >= BIKE + 0.05) continue;
            const off = (b.y - a.y) * dir;
            if (off > 0) room = Math.min(room, off - 0.75);
          }
          room = Math.max(0, room) / 2;   // both riders may be closing (synchronous update): take half the room each
          vyT = dir * Math.min(Math.abs(vyT), room / 0.4);           // decelerate to stop at the gap
        }
        a.vy += clamp(vyT - a.vy, -3 * dt, 3 * dt);
        if (blockedAt(a.y + a.vy * dt)) a.vy = 0;                    // never step into a rider
        a.y = clamp(a.y + a.vy * dt, -ROAD, ROAD);
        if (Math.abs(a.y) >= ROAD) a.vy = 0;
        // Centre bias, as in the NetLogo put-middle-bias: every rider gravitates toward the middle of the road, at
        // the same steady rate (CENTRE_NUDGE m/s) in every position (front, inside the bunch, at the back, in a
        // trailing group, dropped), except while passing on the outside (moving up, bridging) or swinging off a pull.
        // It is a direct adjustment of lateral position, not of lateral speed, and it also shifts the position the
        // rider holds, so it persists. It only acts when there is room: a rider never steps into a rider alongside.
        const passingOutside = a.mode === 'advance' || a.mode === 'bridge' || a.mode === 'pulloff';
        // NetLogo cohesion and separation across the road (y-acc), applied the same way: a direct position
        // adjustment that also moves the held position, never into a rider alongside.
        // Tactical waiting: in a lull the bunch locks into position, so these lateral drifts (and the centre bias
        // below) pause in proportion to how locked the lead group is; gaps along the road still close.
        const gL = this.groups[a.group];
        const hold = c.lull === false || a.group !== 0 || !gL || a.reint ? 0 : (gL.lullK || 0) * (1 - (this.activity ?? 1));
        if (!passingOutside) {
          const dyf = clamp(a.cohY + a.sepY, -0.3, 0.3) * dt * (1 - hold);
          if (dyf !== 0 && !blockedAt(a.y + dyf)) {
            a.y = clamp(a.y + dyf, -ROAD, ROAD); a.yTs += dyf;
            if (a.holdY !== undefined && a.holdY !== null) a.holdY += dyf;
          }
        }
        if (!passingOutside && a.y !== 0) {
          const dyc = -Math.sign(a.y) * Math.min(Math.abs(a.y), CENTRE_NUDGE * dt * (1 - hold));
          // Gravitating to the middle never means queuing: a rider does not drift into the line directly behind a
          // rider just ahead (within 3 m). Otherwise riders at the back, with no one alongside, all converge on the
          // centre line and file in one behind the other, and the tail strings out backwards at constant pace.
          const queue = R.some(b => b !== a && b.x > a.x && b.x - a.x < BIKE + 3 && Math.abs(b.y - (a.y + dyc)) < 0.45 && Math.abs(b.y - (a.y + dyc)) < Math.abs(b.y - a.y));
          if (!blockedAt(a.y + dyc) && !queue) {
            a.y += dyc; a.yTs += dyc;
            if (a.holdY !== undefined && a.holdY !== null) a.holdY += dyc;
          }
        }
      });

      this.resolveOverlaps(startX, dt);
      this.classify(c);
    }

    /**
     * Non-overlap: process riders front to back; a rider may not occupy the space of a rider ahead in the same lane
     * (lateral offset < 0.6 m). It is placed just behind that rider and slowed to its speed, but never behind its own
     * position at the start of the step: it may slow or stop advancing, never move backwards. (An earlier version
     * subtracted up to one step's travel per overlapping rider; several corrections could add up to a backward step.)
     */
    resolveOverlaps(startX, dt) {
      const R = this.riders;
      const order = [...R].sort((p, q) => q.x - p.x);
      for (let k = 1; k < order.length; k++) {
        const a = order[k];
        for (let j = 0; j < k; j++) {
          const b = order[j];
          if (Math.abs(b.y - a.y) >= 0.6) continue;
          const room = b.x - BIKE - a.x;
          if (room < 0 && b.x - a.x >= 0) {
            a.x = Math.max(startX[a.id], a.x + room);
            a.v = Math.min(a.v, b.v);
          }
        }
      }
    }

    /** Best wheel to follow: nearby rider ahead in the group, penalising lateral moves and occupied slots. */
    chooseWheel(a, g, press) {
      let best = null, bestCost = Infinity;
      for (const b of g.members) {
        if (b === a || b.mode === 'pulloff' || b.easeT > 0) continue;    // never follow a rider swinging off or easing back
        if (b.mode === 'advance' && press < 0.5) continue;               // nor (when relaxed) one moving up the flank
        const dx = b.x - a.x;
        if (dx <= 0.3 || dx > 14) continue;
        const lat = Math.abs(b.y - a.y);
        // A slot is taken if another rider already sits between a and b in b's lane.
        const taken = g.members.some(k => k !== a && k !== b && k.x < b.x && k.x > a.x - 0.2 &&
          b.x - k.x < BIKE + 1.6 && Math.abs(k.y - b.y) < 0.5);
        // Hysteresis: keep the current wheel unless another is clearly better (avoids flip-flopping).
        const cost = dx * 0.35 + lat * (0.4 + 2.2 * press) + (taken ? 3 + 3 * press : 0) - (b.id === a.targetId ? 0.8 : 0);
        if (cost < bestCost) { bestCost = cost; best = b; }
      }
      a.targetId = best ? best.id : -1;
      return best;
    }

    /** Descriptive status for each rider (drawing, table, exports). */
    classify(c) {
      const lead = this.groups[0];
      for (const a of this.riders) {
        const g = this.groups[a.group];
        if (a.group > 0 && g.members.length === 1) a.status = a.chasing ? 'chasing' : 'dropped';
        else if (a.mode === 'pull') a.status = 'pulling';
        else if (a.mode === 'pulloff') a.status = 'swinging off';
        else if (a.merging) a.status = 'rejoining';
        else if (a.easeT > 0) a.status = 'easing back';
        else if (a.mode === 'advance') a.status = 'moving up';
        else if (a.mode === 'bridge') a.status = 'bridging';
        else if (a.losing) a.status = 'losing wheel';
        else if (a.P > a.mso * 1.02) a.status = 'on the limit';
        else if (!a.canPass) a.status = 'cannot pass';
        else if (a.fatigue > 0.3) a.status = 'recovering';
        else a.status = 'free';
        a.subgroup = a.group > 0 && g.members.length > 1;
      }
      return lead;
    }

    /** Read-only energetic summary for a rider (used by table and exports). */
    /** Speed (m/s) of the front rider of the lead group (front-most rider not swinging off). */
    frontSpeed() {
      const g = this.groups[0];
      const f = (g && (g.leader || g.members.find(r => r.mode !== 'pulloff') || g.members[0]));
      return f ? f.v : this.cond.speedKmh / 3.6;
    }
    /**
     * PCR_i = d × P_front / MSO_i (Eq. 4). Basis (cond.pcrBasis):
     *  'scheduled' (default): P_front at the selected (requested) pace for every rider, as in the authors' NetLogo
     *                         code (power at peloton-speed; the small flocking term x-acc is not reproduced) and the
     *                         empirical analysis (observed peloton speed). Riders who cannot hold the pace show PCR > 1.
     *  'front':               P_front at the actual speed of the lead group's front rider.
     * In both, d is the fixed coefficient (0.62 by default), as in the NetLogo code's fixed-draft mode.
     */
    riderState(a, c = this.cond, vFront = this.frontSpeed()) {
      const grade = c.grade / 100;
      const pcrFront = Peloton.pcr(Peloton.roadPower(vFront, grade), c.d0, a.mso);
      const pcrSched = Peloton.pcr(Peloton.roadPower(c.speedKmh / 3.6, grade), c.d0, a.mso);
      const pcr = c.pcrBasis === 'front' ? pcrFront : pcrSched;
      const pacePCR = Peloton.pcr(Peloton.roadPower(c.speedKmh / 3.6, grade), c.d0, a.mso);
      const localRatio = a.P / a.mso;                           // actual power / MSO this instant
      const capacity = pacePCR > 1 ? 'Cannot hold requested pace even sheltered'
        : pacePCR / c.d0 > 1 ? 'Needs drafting at requested pace' : 'Can ride requested pace exposed';
      return {
        pcr, pcrFront, pcrSched, pacePCR, localRatio, capacity,
        sheltered: a.d < 0.95, d: a.d, power: a.P, speedKmh: a.v * 3.6,
        wFrac: a.wbal / a.wcap, group: a.group + 1, status: a.status, canPass: a.canPass
      };
    }

    // ---------- Measurement (1 Hz) --------------------------------------------
    sample() {
      const c = this.cond;
      const R = this.riders, n = this.n;
      const cnt = this.counts();
      // X as in the authors' NetLogo code (calculate-positions): +1 for each rider whose ahead-count changed
      // since the previous tick (not the size of the change).
      const x = cnt.reduce((s, v, i) => s + (v !== this.prevCounts[i] ? 1 : 0), 0);
      const states = R.map(a => this.riderState(a, c));
      const pcr = states.reduce((s, r) => s + r.pcr, 0) / n;
      const pcrFront = states.reduce((s, r) => s + r.pcrFront, 0) / n;
      const pacePCR = states.reduce((s, r) => s + r.pacePCR, 0) / n;
      const cx = 1 + Math.log1p(x * 12 / n);

      // Per-group metrics, counting ahead-changes among current members with old and new positions.
      const groups = this.groups.map(g => {
        const ids = g.members.map(r => r.id);
        let gx = 0, gcx = null;
        if (ids.length > 1) {
          const now = this.counts(R, ids), before = this.counts(this.prevPos, ids);
          gx = now.reduce((s, v, k) => s + (v !== before[k] ? 1 : 0), 0);
          gcx = 1 + Math.log1p(gx * 12 / ids.length);
        }
        // Group PCR: selected-pace basis, the selected pace for all; 'front' basis, each group's own front rider.
        const gFront = (g.leader || g.members[0]).v;
        const gp = c.pcrBasis === 'front'
          ? ids.reduce((s, i) => s + Peloton.pcr(Peloton.roadPower(gFront, c.grade / 100), c.d0, R[i].mso), 0) / ids.length
          : ids.reduce((s, i) => s + states[i].pcrSched, 0) / ids.length;
        const single = this.singleFileShare(g);
        // Core width: lateral spread of the group excluding riders swinging off beside it (+ 0.6 m rider width).
        const core = g.members.filter(r => r.mode !== 'pulloff');
        const coreYs = (core.length ? core : g.members).map(r => r.y);
        const coreWidth = Math.max(...coreYs) - Math.min(...coreYs) + 0.6;
        const line = this.longestLine(g);
        const stretched = this.isStretched(ids.length, single, coreWidth, c, line);
        const ahead = g.index > 0 ? this.groups[g.index - 1] : null;
        const gapM = ahead ? ahead.tailX - g.headX - BIKE : 0;
        const speed = g.members.reduce((s, r) => s + r.v, 0) / ids.length;
        return {
          index: g.index + 1, size: ids.length, riders: ids.map(i => i + 1),
          pcr: gp, cx: gcx, x: gx, length: g.length, width: g.width, coreWidth, stretched, singleFile: single, line,
          gapM, gapS: ahead ? gapM / Math.max(1, speed) : 0, speedKmh: speed * 3.6,
          cxp: gcx === null ? null : gp * gcx,
          label: Peloton.staticLabel(gp, gcx, REF, c.sRule === 'paper' ? null : stretched)
        };
      });

      const lead = groups[0];
      const locked = R.filter(a => a.group === 0 && a.mode === 'ride' && !a.canPass).length;
      const delta = this.pcrSeries.length ? pcr - this.pcrSeries[this.pcrSeries.length - 1] : 0;
      this.pcrSeries.push(pcr);
      this.metric = { pcr, cx, cxp: pcr * cx, delta, x };

      const order = [...R].sort((p, q) => q.x - p.x);
      const ranks = R.map(a => order.indexOf(a) + 1);
      const row = {
        t: Math.round(this.t), seed: this.opts.seed, activity: this.activity, speedKmh: c.speedKmh, grade: c.grade, d: c.d0, n, draft: c.draft, reserve: c.reserve, lull: c.lull !== false,
        pcr, pcrFront, frontKmh: this.frontSpeed() * 3.6, pcrBasis: c.pcrBasis || 'scheduled', pacePCR, cx, cxp: pcr * cx, delta, x,
        groups: groups.length, leadSize: lead.size, dropped: n - lead.size,
        leadLength: lead.length, leadWidth: lead.width, leadCoreWidth: lead.coreWidth, leadLine: lead.line, leadStretched: lead.stretched,
        singleFile: lead.singleFile, leadPCR: lead.pcr, locked,
        phase: null, phasePaper: null, move: null, dPCRs: null,
        rule: 'paper+line@4/0.4',
        ranks, groupData: groups,
        riders: R.map((a, i) => Object.assign({ id: a.id + 1, mso: a.mso, x: a.x, y: a.y }, states[i]))
      };
      this.rows.push(row);
      this.detectEvents(row);
      this.prevCounts = cnt;
      this.prevPos = R.map(r => ({ x: r.x, y: r.y }));
      this.labelPhases();
      return row;
    }

    /**
     * Race log: compares group membership with the previous sample.
     * - "dropped": a rider leaves the lead group alone.
     * - "split": several riders leave the lead group together (a sub-peloton forms);
     *   the front rider of the new group is named, since riders behind were stuck on that wheel.
     * - "rejoined" / "bridged": riders come back into the lead group.
     */
    detectEvents(row) {
      const now = this.riders.map(r => r.group);
      const prev = this.lastGroupOf;
      this.lastGroupOf = now;
      if (!prev) return;
      const t = row.t;
      const left = this.riders.filter(r => prev[r.id] === 0 && now[r.id] > 0);
      const back = this.riders.filter(r => prev[r.id] > 0 && now[r.id] === 0);
      const byGroup = {};
      left.forEach(r => (byGroup[now[r.id]] = byGroup[now[r.id]] || []).push(r));
      for (const gi of Object.keys(byGroup)) {
        const list = byGroup[gi].sort((p, q) => q.x - p.x);
        const g = this.groups[gi];
        const ids = list.map(r => r.id + 1);
        if (list.length === 1) {
          const r = list[0];
          this.events.push({ t, type: 'dropped', riders: ids,
            text: `Rider ${r.id + 1} (${Math.round(r.mso)} W) lost contact with the lead group` +
              (g.members.length > 1 ? ` and is now in group ${+gi + 1} (${g.members.length} riders).` : '.') });
        } else {
          const head = g.members[0];
          this.events.push({ t, type: 'split', riders: ids,
            text: `Split: ${list.length} rider${list.length > 1 ? 's' : ''} (${ids.join(', ')}) separated from the lead group behind rider ${head.id + 1} (${Math.round(head.mso)} W) — those behind could not come round.` });
        }
      }
      if (back.length) {
        const bridged = back.filter(r => r.mode === 'bridge' || r.modeT < 3);
        this.events.push({ t, type: 'rejoined', riders: back.map(r => r.id + 1),
          text: `${back.length === 1 ? 'Rider' : 'Riders'} ${back.map(r => r.id + 1).join(', ')} ${back.length === 1 ? 'is' : 'are'} back in the lead group${bridged.length ? ' after bridging the gap' : ''}.` });
      }
      if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
    }

    /**
     * Formation criterion for a stretched group (a refinement of the paper's S rule; the paper defines S by PCR and
     * Cx* and describes it only qualitatively as a single-file or elongated formation).
     * a group is stretched when its longest single-file line (see longestLine) has at least 4 riders and at least
     * 40 % of the group. This is embedded in the model (no setting).
     */
    isStretched(size, singleFile, coreWidth, c = this.cond, line = 0) {
      return line >= 4 && line >= 0.4 * size;
    }

    /**
     * Longest single-file line in a group, in riders: a chain, front to back, in which each rider is directly behind
     * the one ahead (within 0.5 m laterally, wheel gap at most 3 m, i.e. within drafting range) and has nobody
     * alongside. Riders swinging off a pull are left out.
     */
    longestLine(g) {
      const m = g.members.filter(r => r.mode !== 'pulloff').sort((p, q) => q.x - p.x);
      const alone = r => !m.some(b => b !== r && Math.abs(b.x - r.x) < BIKE && Math.abs(b.y - r.y) < 1.2);
      const len = new Map(); let best = 0;
      for (const a of m) {
        if (!alone(a)) { len.set(a, 0); continue; }
        let pred = null, pdx = Infinity;
        for (const b of m) {
          const dx = b.x - a.x;
          if (b === a || dx < BIKE - 0.1 || dx > BIKE + 3 || Math.abs(b.y - a.y) > 0.5) continue;
          if (dx < pdx) { pdx = dx; pred = b; }
        }
        const l = 1 + (pred ? (len.get(pred) || 0) : 0);
        len.set(a, l); best = Math.max(best, l);
      }
      return best;
    }

    /** Share of a group's riders in a line: on a wheel (< 3 m) with nobody alongside. */
    singleFileShare(g) {
      // Riders swinging off (drifting back beside the line) are excluded on both sides.
      const m = g.members.filter(r => r.mode !== 'pulloff');
      if (m.length < 2) return 1;
      let k = 0;
      for (const a of m) {
        const alongside = m.some(b => b !== a && Math.abs(b.x - a.x) < BIKE && Math.abs(b.y - a.y) < 1.4);
        if (!alongside) k++;
      }
      return k / m.length;
    }

    /**
     * Section 2.8 phase assignment. PCR is smoothed with a 5-tick centred moving mean,
     * ΔPCR is its first difference, epsilon = 0.10 × sd(ΔPCR) over the run so far,
     * and labels use unsmoothed PCR and Cx*. Labels therefore lag by two seconds.
     */
    labelPhases() {
      const rows = this.rows, k = rows.length - 3;              // centre of the latest full window
      if (k < 3) return;
      const sm = j => (rows[j - 2].pcr + rows[j - 1].pcr + rows[j].pcr + rows[j + 1].pcr + rows[j + 2].pcr) / 5;
      if (k - 1 < 2) return;
      const d = sm(k) - sm(k - 1);
      rows[k].dPCRs = d;
      const ds = rows.map(r => r.dPCRs).filter(v => v !== null);
      const mean = ds.reduce((s, v) => s + v, 0) / ds.length;
      const sd = Math.sqrt(ds.reduce((s, v) => s + (v - mean) * (v - mean), 0) / Math.max(1, ds.length - 1));
      // Paper's rule: ε = 0.10 × sd(ΔPCR). Optional absolute floor (cond.epsFloor) stops tick-level noise at a
      // steady pace being read as acceleration/deceleration (and thus as Da, Dd or Sf).
      const eps = Math.max(0.10 * sd, this.cond.epsFloor || 0);
      const move = d > eps ? 'accel' : d < -eps ? 'decel' : 'neutral';
      rows[k].move = move;
      const r = rows[k];
      r.phasePaper = Peloton.phaseLabel(r.pcr, r.cx, move);
      r.phase = this.cond.sRule === 'paper' ? r.phasePaper
        : Peloton.phaseLabelFormation(r.pcr, r.cx, move, r.leadPCR, r.leadStretched);
    }

    /** Operational precedence rules of Section 2.8. */
    static phaseLabel(pcr, cx, move, ref = REF) {
      if (pcr > 1) return 'Dcp';
      if (cx >= ref.cxHigh && pcr > ref.pcrLow) {
        if (move === 'accel') return 'Da';
        if (move === 'decel') return 'Dd';
      }
      if (cx <= ref.cxLow) {
        if (pcr >= ref.pcrHigh) return 'S';
        if (pcr > ref.pcrLow && move === 'decel') return 'Sf';
        if (pcr <= ref.pcrLow) return 'Cs';
      }
      if (cx >= ref.cxHigh) {
        if (pcr >= ref.pcrHigh) return 'Cch';
        if (pcr <= ref.pcrLow) return 'Ccl';
      }
      return 'Transitional';
    }
    /** Direction-free variant used for sub-groups (whose ΔPCR series are not continuous). */
    static staticLabel(pcr, cx, ref = REF, stretched = null) {
      if (pcr > 1) return 'Dcp';
      if (cx === null) return 'Solo';
      if (stretched && pcr > ref.pcrLow) return 'S';
      return Peloton.phaseLabel(pcr, cx, 'neutral', ref);
    }
    /**
     * Formation-augmented rule (optional refinement, not the paper's): after Dcp, if the lead group (≥ 3 riders)
     * is stretched (narrow: see isStretched) and its PCR exceeds PCR_low, the state is stretched: Sf when PCR is
     * below PCR_high and decelerating, otherwise S. Everything else follows the paper's Section 2.8 rules.
     */
    static phaseLabelFormation(pcr, cx, move, leadPCR, stretched, ref = REF) {
      if (pcr > 1) return 'Dcp';
      if (stretched && leadPCR > ref.pcrLow) {
        return (leadPCR < ref.pcrHigh && move === 'decel') ? 'Sf' : 'S';
      }
      return Peloton.phaseLabel(pcr, cx, move, ref);
    }
  }

  Peloton.REF = REF;
  Peloton.PHYS = PHYS;
  Peloton.BIKE = BIKE;
  Peloton.ROAD = ROAD;
  Peloton.PHASES = PHASES;
  Peloton.SCRATCH_POOL = SCRATCH_POOL;

  if (typeof module !== 'undefined' && module.exports) module.exports = Peloton;
  else root.Peloton = Peloton;
})(typeof globalThis !== 'undefined' ? globalThis : this);

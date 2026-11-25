/* Peloton Phase Lab — interface. Drawing, controls, tables and exports.
 * All simulation logic lives in model.js (global Peloton).
 * Copyright (C) 2026 Hugh Trenchard. Licensed under the GNU GPL, version 3 or later; see LICENSE. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const DT = 0.05;

  // Colours. Effort/status: the lab's original teal/amber/red with text labels in the legend.
  const INK = '#12343d', MUTED = '#536d71', GRID = '#e3eae8', TEAL = '#147d80', AMBER = '#e79d36', RED = '#dd6653';
  // Phase colours use the validated categorical order (slots 1–8), Transitional in neutral grey.
  const PHASE_COLOR = { Cs: '#2a78d6', Dd: '#eb6834', Ccl: '#1baf7a', Da: '#eda100', Sf: '#e87ba4', Cch: '#008300', S: '#6250d6', Dcp: '#e34948', Transitional: '#a8b3b1' };
  const PHASE_NAME = {
    Cs: 'Compact-static', Ccl: 'Compact-convective, low output', Cch: 'Compact-convective, high output',
    S: 'Stretched', Sf: 'Stretched-fatigued', Da: 'Collective acceleration', Dd: 'Collective deceleration',
    Dcp: 'Decoupled', Transitional: 'Transitional'
  };
  const PHASE_ORDER = ['Cs', 'Ccl', 'Cch', 'S', 'Sf', 'Da', 'Dd', 'Dcp', 'Transitional'];
  // Groups: first three categorical slots, then grey for all later groups.
  const GROUP_COLOR = ['#2a78d6', '#eb6834', '#1baf7a'];
  const groupColor = i => GROUP_COLOR[i] || '#8a9a98';
  // NetLogo's base colours (red 15 … pink 135, excluding grey), used for rider identity as in the NetLogo view.
  const NETLOGO = ['#d73229', '#f16913', '#9d6e48', '#eded2f', '#59b03c', '#2cd13b', '#1d9f78', '#54c4c4', '#2d8dbe', '#345da9', '#7c50a4', '#a71b6a', '#e07f96'];
  const riderColor = i => NETLOGO[i % NETLOGO.length];

  // Each reset draws a fresh random seed (recorded in exports, so a run can be reproduced in code).
  const TRACK_WIDTH = 15;   // road width (m), fixed
  let currentSeed = 1 + Math.floor(Math.random() * 99998);
  let sim, paused = false, acc = 0, last = 0, nextSample = 1, scenario = null, follow = 0;
  const hits = {};   // hover targets per canvas

  // ---------- Controls ---------------------------------------------------------
  function riderSettings() {
    const custom = $('custom').value.split(/[\s,;]+/).map(Number).filter(v => isFinite(v) && v > 50 && v < 2000);
    return {
      n: +$('count').value, msoMode: $('msoMode').value === 'span' ? 'range' : $('msoMode').value, centre: +$('centre').value,
      range: $('msoMode').value === 'span'
        ? [Math.min(+$('spanLo').value, +$('spanHi').value), Math.max(+$('spanLo').value, +$('spanHi').value)]
        : [Math.min(+$('rangeLo').value, +$('rangeHi').value), Math.max(+$('rangeLo').value, +$('rangeHi').value)],
      spread: +$('spread').value, custom, seed: currentSeed, speedKmh: +$('pace').value, width: TRACK_WIDTH
    };
  }
  function cond() {
    return {
      speedKmh: +$('pace').value, grade: +$('grade').value, d0: +$('draft').value,
      draft: 'netlogo', reserve: true, lull: $('lull').checked, urge: +$('urge').value, width: TRACK_WIDTH,
      epsFloor: 0, rejoin: $('rejoin').value,
      sRule: 'line',   // stretched: single-file line of ≥ 4 riders and ≥ 40 % of the group (embedded, see model.js)
      pcrBasis: $('pcrBasis').value
    };
  }
  function labels() {
    const c = cond();
    $('paceOut').textContent = c.speedKmh.toFixed(1) + ' km/h';
    $('gradeOut').textContent = (c.grade > 0 ? '+' : '') + c.grade.toFixed(1) + ' %';
    $('draftOut').textContent = c.d0.toFixed(2);
    $('urgeOut').textContent = c.urge.toFixed(1);
    $('countOut').textContent = $('count').value;
    $('centreOut').textContent = $('centre').value + ' W';
    $('spreadOut').textContent = '±' + $('spread').value + ' %';
    const Pf = Peloton.roadPower(c.speedKmh / 3.6, c.grade / 100);
    $('paceNote').textContent = `Speed requested at the front. Exposed power at this pace: ${Math.round(Pf)} W; sheltered (×d): ${Math.round(Pf * c.d0)} W.`;
    const mode = $('msoMode').value;
    $('evenBox').hidden = mode !== 'even';
    $('rangeBox').hidden = mode !== 'range';
    $('spanBox').hidden = mode !== 'span';
    $('customBox').hidden = mode !== 'custom';
    $('poolNote').hidden = mode !== 'pool';
  }

  function reset(keepScenario) {
    currentSeed = 1 + Math.floor(Math.random() * 99998);
    sim = new Peloton(riderSettings());
    sim.cond = Object.assign(sim.cond, cond());
    acc = 0; nextSample = 1; follow = 0; paused = false; camX = null; camT = null; trail.buf = []; trail.last = -1; frontShown = null;
    $('play').textContent = 'Pause';
    if (!keepScenario) { scenario = null; clearOn(); endExperiment(); $('scenario').textContent = climbBefore ? 'New race on the 2% climb · click Climb 2% hill again to return to the flat.' : 'Free exploration · adjust any control.'; }
    labels(); update(); renderLegend(); draw();
  }

  // ---------- Experiments ---------------------------------------------------------
  const PRESETS = {
    rhythm: { set: { pace: 34, grade: 0, urge: 1.2 }, text: 'Find a rhythm · 34 km/h on the flat.' },
    stretch: {
      set: { pace: 34, grade: 0, urge: 1.2 },
      run: t => (t < 20 ? 34 : t < 80 ? 34 + 8 * (t - 20) / 60 : 42), end: 80,
      text: t => `Stretch at threshold · pace ${(t < 20 ? 34 : t < 80 ? 34 + 8 * (t - 20) / 60 : 42).toFixed(1)} km/h · ${Math.floor(t)} / 80 s`,
      done: 'Holding 42 km/h · most riders now sit inside their amber band: they need a wheel and cannot pass, so the group lines out.'
    },
    shed: { set: { pace: 45, grade: 0, msoMode: 'even', centre: 300, spread: 30, count: 16, urge: 1.2 }, text: 'Shed the weak · 16 riders, 210–390 W, 45 km/h. Watch the race log.' },
    cycle: {
      set: { pace: 34, grade: 0, urge: 1.2 },
      run: t => (t < 15 ? 34 : t < 45 ? 34 + 8 * (t - 15) / 30 : t < 105 ? 42 : t < 135 ? 42 - 8 * (t - 105) / 30 : 34), end: 165,
      text: t => `Surge, then ease · ${t < 45 ? 'ramping up' : t < 105 ? 'holding 42 km/h: expect S' : t < 135 ? 'easing: the line persists, expect Sf' : 'recovered pace: expect Ccl'} · ${Math.floor(t)} / 165 s`,
      done: 'Cycle complete · look along the phase ribbon for S → Sf → Ccl, or repeat with W′ off.'
    },
    climb: { set: { pace: 38, grade: 2, urge: 1.2 }, text: 'Climb 2% hill · 38 km/h uphill: about +59 % front power. Click again to return to the flat.' }
  };

  // Random pace fluctuations between 25 and 54 km/h, continuing the current run. Holds get shorter as speed rises
  // (about 90 s at 25 km/h, 40 s at 34, 25 s at 40, 8 s at 54; each ×0.6–1.4). The next change is usually a
  // deceleration at high speed (probability rising from 10 % at 28 km/h to 50 % at 38 and 92 % from 48 up) and usually an acceleration
  // at low speed. Accelerations are sometimes a staircase of 2–4 km/h steps with short holds; decelerations drop
  // further from higher speeds. Ramps: +0.6 km/h per s up, −0.4 km/h per s down. Seeded from the run's seed.
  const V_MIN = 25, V_MAX = 54;
  function makeFluctuations(v0, seed) {
    let st = (seed * 2654435761) >>> 0;
    const rnd = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const holdFor = v => 90 * Math.exp(-(v - V_MIN) / 12) * (0.6 + 0.8 * rnd());
    const segs = [];            // { t0, t1, v0, v1, kind }
    let tEnd = 0, v = Math.min(V_MAX, Math.max(V_MIN, v0)), stairs = 0;
    const push = (dur, v1, kind) => { segs.push({ t0: tEnd, t1: tEnd + dur, v0: v, v1, kind }); tEnd += dur; v = v1; };
    function extend() {
      push(holdFor(v) * (stairs > 0 ? 0.4 : 1), v, 'hold');   // short holds between the steps of a staircase
      let target;
      if (stairs > 0 && v > 44 && rnd() < 0.5) stairs = 0;                            // high up, a staircase often breaks off
      if (stairs > 0) { stairs--; target = v + 2 + 2 * rnd(); }                       // next step of a staircase
      else {
        const pDecel = Math.min(0.92, Math.max(0.1, 0.1 + (v - 28) / 20 * 0.8));
        if (rnd() < pDecel) target = v - (3 + (0.15 + 0.35 * rnd()) * (v - V_MIN));   // bigger drops from higher up
        else if (rnd() < 0.35) { stairs = 1 + Math.floor(rnd() * 3); target = v + 2 + 2 * rnd(); }   // step-wise
        else target = v + 3 + 9 * rnd();                                           // a single surge
      }
      target = Math.round(Math.min(V_MAX, Math.max(V_MIN, target)) * 2) / 2;
      if (target >= V_MAX || target <= V_MIN) stairs = 0;
      if (target !== v) push(Math.abs(target - v) / (target > v ? 0.6 : 0.4), target, target > v ? 'up' : 'down');
    }
    const at = t => { while (tEnd <= t) extend(); return segs.find(s => t < s.t1); };
    return {
      fluct: true, end: Infinity,
      run: t => { const s = at(t); return s.v0 + (s.v1 - s.v0) * (t - s.t0) / Math.max(1e-6, s.t1 - s.t0); },
      text: t => {
        const s = at(t), vNow = s.v0 + (s.v1 - s.v0) * (t - s.t0) / Math.max(1e-6, s.t1 - s.t0);
        const what = s.kind === 'hold' ? `holding, next change in about ${Math.max(1, Math.round(s.t1 - t))} s`
          : s.kind === 'down' ? `easing to ${s.v1.toFixed(1)} km/h` : `accelerating to ${s.v1.toFixed(1)} km/h`;
        return `Random fluctuations (25–54 km/h) · ${vNow.toFixed(1)} km/h, ${what} · ${Math.floor(t)} s · click the button again to stop`;
      },
      done: ''
    };
  }
  // Button highlights. The climb is a road condition that can run alongside the pace experiments, so its highlight
  // is kept separately: clearOn() leaves it lit while the climb is on; endClimb() switches it off.
  let climbBefore = null;   // grade and pace before the climb started, restored when it is switched off
  const climbBtn = () => document.querySelector('[data-preset="climb"]');
  function clearOn() { document.querySelectorAll('[data-preset].on').forEach(b => { if (!(climbBefore && b === climbBtn())) b.classList.remove('on'); }); }
  function endClimb() { climbBefore = null; const b = climbBtn(); if (b) b.classList.remove('on'); }
  const isFluct = () => !!(scenario && scenario.p.fluct);

  // Every experiment button is a toggle. Clicking the lit button again puts back the settings from before the first
  // experiment was started (pace, urge, field of riders and, for experiments that change the road, the grade and
  // climb). Moving the pace or grade slider by hand hands control back to you and clears this memory.
  let expBefore = null, expName = null;
  const FIELD = ['count', 'msoMode', 'centre', 'spread'];
  function snapshot() {
    const o = { climb: climbBefore };
    for (const k of ['pace', 'grade', 'urge', ...FIELD]) o[k] = $(k).value;
    return o;
  }
  function endExperiment() { expBefore = null; expName = null; }
  function restoreExperiment() {
    const o = expBefore, wasFluct = expName === 'fluctuate';
    scenario = null; endExperiment();
    const newField = FIELD.some(k => String($(k).value) !== String(o[k]));
    for (const k of ['pace', 'urge', ...FIELD]) $(k).value = o[k];
    if (!wasFluct) {                       // fluctuations never touch the road, so a climb started meanwhile stays
      $('grade').value = o.grade; climbBefore = o.climb;
      const cb = climbBtn(); if (cb) cb.classList.toggle('on', !!o.climb);
    }
    clearOn();
    if (newField) reset(true); else { labels(); renderLegend(); chartsDirty = true; }
    $('scenario').textContent = 'Experiment off · back to ' + $('pace').value + ' km/h' + (climbBefore ? ' on the 2% climb' : '') +
      (newField ? ' with the earlier field of riders (the race restarts).' : '.');
  }

  function applyPreset(name) {
    const btn = document.querySelector(`[data-preset="${name}"]`);
    if (name === 'climb') {
      // Toggle: click again to return to the grade in use before the climb (and to the earlier pace, unless the pace
      // was changed during the climb). During random fluctuations only the grade changes, and the fluctuations go on.
      if (climbBefore) {
        $('grade').value = climbBefore.grade;
        if (!isFluct() && String($('pace').value) === String(PRESETS.climb.set.pace)) $('pace').value = climbBefore.pace;
        endClimb(); labels(); renderLegend(); chartsDirty = true;
        if (!isFluct()) { scenario = null; endExperiment(); clearOn(); $('scenario').textContent = 'Back on the flat at ' + $('pace').value + ' km/h (applied to the race in progress).'; }
        return;
      }
      climbBefore = { grade: $('grade').value, pace: $('pace').value };
      btn.classList.add('on');
      if (isFluct()) { $('grade').value = PRESETS.climb.set.grade; labels(); renderLegend(); chartsDirty = true; return; }
      scenario = null; endExperiment(); clearOn();
      applySettings(PRESETS.climb);
      return;
    }
    // Second click on the lit experiment: switch it off and restore the earlier settings.
    if (btn && btn.classList.contains('on') && expName === name && expBefore) { restoreExperiment(); return; }
    if (!expBefore) expBefore = snapshot();   // switching between experiments keeps the original settings
    expName = name;
    if (name === 'fluctuate') {
      // Starts from the current pace without resetting the run. A climb stays on.
      const p = makeFluctuations(+$('pace').value, currentSeed);
      scenario = { p, start: sim.t };
      clearOn(); btn.classList.add('on');
      $('scenario').textContent = p.text(0);
      return;
    }
    endClimb();   // every other experiment sets the road back to flat
    scenario = null; clearOn();
    if (btn) btn.classList.add('on');   // show which experiment is active
    applySettings(PRESETS[name]);
  }
  function applySettings(p) {
    // Experiments act on the race in progress: pace, grade, urge and model settings change from now on. Only an
    // experiment that needs a different field of riders (count or MSO source) starts a fresh race.
    const fieldKeys = ['count', 'msoMode'].concat(p.set.msoMode === 'even' ? ['centre', 'spread'] : []);
    const newField = fieldKeys.some(k => k in p.set && String($(k).value) !== String(p.set[k]));
    for (const [k, v] of Object.entries(p.set)) $(k).value = v;
    $('draft').value = 0.62; $('lull').checked = true;
    if (newField) reset(true); else { labels(); renderLegend(); chartsDirty = true; }
    scenario = p.run ? { p, start: sim.t } : null;
    const txt = typeof p.text === 'function' ? p.text(0) : p.text;
    $('scenario').textContent = txt + (newField ? ' (new field of riders: the race restarts)' : ' (applied to the race in progress)') +
      (p === PRESETS.climb ? '' : ' · click again to undo');
  }

  // ---------- Text panels -------------------------------------------------------
  const fmt = (v, k = 2) => (v === null || v === undefined || !isFinite(v)) ? '—' : v.toFixed(k);
  function latestPhase() {
    for (let i = sim.rows.length - 1; i >= 0; i--) if (sim.rows[i].phase) return sim.rows[i];
    return null;
  }
  function update() {
    const m = sim.metric, row = sim.rows.at(-1);
    $('clock').textContent = Math.floor(sim.t) + ' s';
    $('pcr').textContent = fmt(m.pcr);
    $('cx').textContent = fmt(m.cx);
    $('cxp').textContent = fmt(m.cxp);
    $('delta').textContent = (m.delta >= 0 ? '+' : '') + m.delta.toFixed(3);
    const ph = latestPhase();
    $('phase').textContent = ph ? ph.phase : '—';
    $('phaseName').textContent = ph ? PHASE_NAME[ph.phase] : "Paper's rule";
    $('phaseNote').textContent = !ph ? 'Labels lag 2 s for the centred smoothing.'
      : `S identified by single-file line and Cx*: longest line in the lead group ${ph.leadLine} of ${ph.leadSize} riders${ph.leadStretched ? ' (stretched)' : ''}. Label by Cx* only: ${ph.phasePaper}. Labels lag 2 s.`;
    $('state').textContent = !row ? 'Finding its rhythm' : ph ? PHASE_NAME[ph.phase] : 'Measuring…';
    if (row) {
      $('pacePcr').textContent = row.pcrBasis === 'front'
        ? `Front rider at ${row.frontKmh.toFixed(1)} km/h. At the default pace: ${row.pacePCR.toFixed(2)}.`
        : `Default pace ${row.speedKmh.toFixed(1)} km/h. On the front rider's actual speed (${row.frontKmh.toFixed(1)} km/h): ${row.pcrFront.toFixed(2)}.`;
      $('groups').textContent = row.groups;
      $('groupsNote').textContent = row.groups > 1
        ? `Lead group ${row.leadSize} of ${row.n}; ${row.dropped} behind. Gaps over 6 m split groups.`
        : 'All riders together. Gaps over 6 m (out of draft) split groups.';
      $('shape').textContent = `${row.leadLength.toFixed(0)} × ${row.leadWidth.toFixed(1)} m`;
      $('singleNote').textContent = `${Math.round(row.singleFile * 100)} % of the lead group riding in single file.`;
      $('locked').textContent = `${row.locked} / ${row.leadSize}`;
      $('explanation').textContent = narrative(row);
    } else {
      ['groups', 'shape', 'locked'].forEach(id => { $(id).textContent = '—'; });
      $('explanation').textContent = 'Press play or change the conditions. Measurements arrive once per simulated second.';
    }
    renderRiders(); renderGroups(); renderGroupCards(); renderLog(); renderOccupancy(); renderFollow();
    chartsDirty = true;
  }

  function narrative(row) {
    const lead = sim.groups[0], c = sim.cond;
    const losing = sim.riders.filter(r => r.status === 'losing wheel').map(r => r.id + 1);
    const parts = [];
    parts.push(`${row.x} local position changes in the last second.`);
    if (row.locked >= Math.max(2, row.leadSize * 0.6)) parts.push(`${row.locked} of ${row.leadSize} lead-group riders cannot afford to move up into the wind, so they hold their wheels: ${Math.round(row.singleFile * 100)} % single file over ${row.leadLength.toFixed(0)} m.`);
    else if (row.locked > 0) parts.push(`${row.locked} rider${row.locked > 1 ? 's are' : ' is'} at the passing threshold; the rest still have room to move up.`);
    else parts.push('Every lead-group rider has capacity to move up: expect convective reordering.');
    if (losing.length) parts.push(`Losing the wheel: ${losing.join(', ')}.`);
    if (row.groups > 1) {
      const g2 = row.groupData[1];
      parts.push(`${row.groups} groups on the road; the next group (${g2.size} rider${g2.size > 1 ? 's' : ''}) is ${g2.gapS.toFixed(1)} s behind.`);
    }
    if (!c.reserve) parts.push('W′ is off: nobody can exceed MSO.');
    return parts.join(' ');
  }

  function renderFollow() {
    const sel = $('follow'), n = sim.groups.length;
    if (sel.options.length !== n + 1) {
      const cur = sel.value;
      sel.innerHTML = '<option value="0">Lead group</option>' +
        Array.from({ length: n - 1 }, (_, i) => `<option value="${i + 1}">Group ${i + 2}</option>`).join('') +
        '<option value="-1">Whole field</option>';
      sel.value = [...sel.options].some(o => o.value === cur) ? cur : '0';
    }
    follow = +sel.value;
  }

  function renderRiders() {
    const c = sim.cond;
    let lockedN = 0, dropped = 0;
    $('riderRows').innerHTML = sim.riders.map(a => {
      const s = sim.riderState(a, c), th = Peloton.thresholds(a.mso, c.grade / 100, c.d0);
      if (a.status === 'cannot pass') lockedN++;
      if (a.group > 0) dropped++;
      return `<tr><td><i style="background:${riderColor(a.id)}"></i>${a.id + 1}</td><td>${a.mso.toFixed(0)}</td>` +
        `<td><i style="background:${groupColor(a.group)}"></i>${a.group + 1}</td><td>${s.status}</td>` +
        `<td>${s.speedKmh.toFixed(1)}</td><td class="${s.localRatio > 1 ? 'over' : ''}">${s.localRatio.toFixed(2)}</td>` +
        `<td>${c.reserve ? Math.round(s.wFrac * 100) + ' %' : '—'}</td><td>${s.d.toFixed(2)}</td>` +
        `<td class="${s.pcr > 1 ? 'over' : ''}">${s.pcr.toFixed(3)}</td><td>${th.pass.toFixed(1)}</td><td>${th.sheltered.toFixed(1)}</td></tr>`;
    }).join('');
    const pace = c.speedKmh;
    const ths = sim.riders.map(a => Peloton.thresholds(a.mso, c.grade / 100, c.d0));
    const free = ths.filter(t => pace <= t.pass).length, over = ths.filter(t => pace > t.sheltered).length;
    $('riderSummary').textContent = `At ${pace.toFixed(1)} km/h: ${free} can move up freely · ${sim.n - free - over} need a wheel and cannot pass on sustainable power · ${over} cannot hold even an ideal wheel. Now: ${lockedN} marked “cannot pass”, ${dropped} outside the lead group.`;
  }

  function renderGroups() {
    const row = sim.rows.at(-1);
    if (!row) { $('groupRows').innerHTML = ''; return; }
    $('groupRows').innerHTML = row.groupData.map(g =>
      `<tr><td><i style="background:${groupColor(g.index - 1)}"></i>${g.index}${g.index === 1 ? ' (lead)' : ''}</td>` +
      `<td title="${g.riders.join(', ')}">${g.size}</td><td>${g.index === 1 ? '—' : '+' + g.gapS.toFixed(1) + ' s'}</td>` +
      `<td>${g.speedKmh.toFixed(1)}</td><td>${g.length.toFixed(0)} × ${g.width.toFixed(1)} m</td>` +
      `<td>${g.size > 1 ? Math.round(g.singleFile * 100) + ' %' : '—'}</td><td>${g.pcr.toFixed(2)}</td>` +
      `<td>${g.cx === null ? '—' : g.cx.toFixed(2)}</td><td>${g.cxp === null ? '—' : g.cxp.toFixed(2)}</td><td>${g.label}</td></tr>`).join('');
  }

  function renderGroupCards() {
    const row = sim.rows.at(-1);
    if (!row) { $('groupCards').innerHTML = '<p class="muted">Measurements arrive once per simulated second.</p>'; return; }
    $('groupCards').innerHTML = row.groupData.slice(0, 6).map(g => {
      const lab = g.label, name = lab === 'Solo' ? 'Single rider' : (PHASE_NAME[lab] || lab);
      const col = PHASE_COLOR[lab] || '#a8b3b1';
      return `<article class="gcard" style="border-top-color:${groupColor(g.index - 1)}">
        <span class="gname">${g.index === 1 ? 'Lead group' : 'Group ' + g.index} · ${g.size} rider${g.size > 1 ? 's' : ''}${g.index > 1 ? ' · +' + g.gapS.toFixed(1) + ' s' : ''}</span>
        <strong style="color:${col}">${lab === 'Solo' ? '—' : lab}</strong><h3>${name}</h3>
        <p>PCR ${g.pcr.toFixed(2)} · Cx* ${g.cx === null ? '—' : g.cx.toFixed(2)} · CxP* ${g.cxp === null ? '—' : g.cxp.toFixed(2)}<br>${g.size > 1 ? g.length.toFixed(0) + ' × ' + g.coreWidth.toFixed(1) + ' m · ' + Math.round(g.singleFile * 100) + ' % single file · ' : ''}${g.speedKmh.toFixed(1)} km/h</p>
      </article>`;
    }).join('') + (row.groupData.length > 6 ? `<p class="muted">+ ${row.groupData.length - 6} more groups (see the table below)</p>` : '');
  }

  function renderLog() {
    const ev = sim.events.slice(-40).reverse();
    $('log').innerHTML = ev.length ? ev.map(e => `<li class="${e.type}"><b>${e.t} s</b> ${e.text}</li>`).join('')
      : '<li class="none">No separations yet.</li>';
  }

  function renderOccupancy() {
    // As in the paper: occupancy is the share of non-transitional labelled seconds in each named phase; the
    // Transitional (residual) share of all labelled seconds is reported separately.
    const counts = {}; let all = 0;
    sim.rows.forEach(r => { if (r.phase) { counts[r.phase] = (counts[r.phase] || 0) + 1; all++; } });
    const trans = counts.Transitional || 0, named = all - trans;
    $('occNote').textContent = all
      ? `Share of non-transitional seconds, as in the paper (${named} of ${all} labelled seconds). Transitional (residual class): ${Math.round(100 * trans / all)} % of labelled seconds, excluded.`
      : 'Share of non-transitional labelled seconds, as in the paper.';
    $('occBars').innerHTML = PHASE_ORDER.filter(p => p !== 'Transitional').map(p => {
      const pct = named ? 100 * (counts[p] || 0) / named : 0;
      return `<div class="occrow"><span class="occlab"><i style="background:${PHASE_COLOR[p]}"></i>${p}${p === 'Transitional' ? '' : ' <em>' + PHASE_NAME[p] + '</em>'}</span>` +
        `<span class="occbar"><b style="width:${pct.toFixed(1)}%;background:${PHASE_COLOR[p]}"></b></span><span class="occval">${pct.toFixed(0)} %</span></div>`;
    }).join('');
  }

  // ---------- Drawing ------------------------------------------------------------
  function canvas(id) {
    const c = $(id), r = c.getBoundingClientRect(), s = devicePixelRatio || 1;
    if (c.width !== Math.round(r.width * s) || c.height !== Math.round(r.height * s)) { c.width = Math.round(r.width * s); c.height = Math.round(r.height * s); }
    const g = c.getContext('2d'); g.setTransform(s, 0, 0, s, 0, 0); g.clearRect(0, 0, r.width, r.height);
    g.font = '12px system-ui'; g.textBaseline = 'alphabetic';
    return [g, r.width, r.height];
  }

  let chartsDirty = true;
  function draw() {
    drawRoad(); drawField();
    if (chartsDirty) { drawStretch(); drawBraid(); drawPhase(); chartsDirty = false; }
  }

  // ---------- Overhead view (NetLogo-style) ----------------------------------------
  // Fixed, isotropic metre scale (like NetLogo's patch grid); riders are 0.8 m discs, slightly ovoid
  // along the direction of travel. The camera pans smoothly to keep the followed group in view.
  const trail = { buf: [], last: -1 };
  let camX = null, camT = null;
  function recordTrails() {
    if (sim.t - trail.last < 0.25) return;
    trail.last = sim.t;
    const head = Math.max(...sim.riders.map(r => r.x));
    trail.buf.push({ head, pts: sim.riders.map(r => [r.x - head, r.y]) });
    if (trail.buf.length > 40) trail.buf.shift();       // 10 s of history
  }
  function viewTheme() {
    const dark = $('dark').checked;
    return dark
      ? { bg: '#000000', road: '#0b0b0b', edge: '#4a4a4a', text: '#e8e8e8', muted: '#9a9a9a', label: '#ffffff', box: 0.75,
          effort: ['#3ccf6e', '#f2c230', '#ff5a4a'], quart: ['#3ccf6e', '#f2c230', '#ff9a3c', '#ff5a4a'], single: '#d9dde0', ring: { locked: '#e8e8e8', up: '#3ddc84', off: '#9a9a9a', lose: '#ff6a55', bridge: '#5aa9ff', rec: '#f0a83c' } }
      : { bg: '#e9f0ee', road: '#dde8e5', edge: '#b9cbc7', text: INK, muted: MUTED, label: INK, box: 0.55,
          effort: ['#1f9a4e', '#d9a514', '#dd4b3a'], quart: ['#1f9a4e', '#d9a514', '#e07b1f', '#dd4b3a'], single: '#345d6a', ring: { locked: '#33494e', up: '#1f9a5a', off: '#6d7f82', lose: RED, bridge: '#2a78d6', rec: '#c77d12' } };
  }
  function fillFor(a, th) {
    const mode = $('colorBy').value;
    if (mode === 'effort') {
      // Smoothed power/MSO (≈1.5 s) so colours reflect the rider's state rather than tick-level control noise.
      const e = a.effShown ?? a.P / a.mso;
      return e > 1.0 ? th.effort[2] : e >= 0.9 ? th.effort[1] : th.effort[0];
    }
    if (mode === 'pcr' || mode === 'pcrq') {
      // Rider PCR (Eq. 4): PCR_i = P_front × d / MSO_i, with P_front at the default pace (NetLogo basis) or the
      // lead group's front rider's speed (smoothed over ~1.5 s).
      const v = sim.cond.pcrBasis === 'front' ? (frontShown ?? sim.frontSpeed()) : sim.cond.speedKmh / 3.6;
      const p = Peloton.pcr(Peloton.roadPower(v, sim.cond.grade / 100), sim.cond.d0, a.mso);
      if (mode === 'pcr') return p > 1 ? th.effort[2] : p > sim.cond.d0 ? th.effort[1] : th.effort[0];
      const R = Peloton.REF;
      return p > 1 ? th.quart[3] : p >= R.pcrHigh ? th.quart[2] : p > R.pcrLow ? th.quart[1] : th.quart[0];
    }
    if (mode === 'single') return th.single;
    if (mode === 'group') return groupColor(a.group);
    return riderColor(a.id);
  }
  function renderLegend() {
    const th = viewTheme(), mode = $('colorBy').value;
    let html = '';
    if (mode === 'pcr') {
      const d = sim ? sim.cond.d0.toFixed(2) : '0.62';
      html += [[`PCR ≤ d (${d}): could ride this speed exposed`, 0], [`d < PCR ≤ 1: coupled, needs drafting`, 1], ['PCR > 1: decoupled, cannot hold even an ideal wheel', 2]]
        .map(([t, i]) => `<span><i class="disc" style="background:${th.effort[i]}"></i>${t}</span>`).join('');
    } else if (mode === 'pcrq') {
      html += [['PCR ≤ 0.488 (low)', 0], ['0.488–0.738 (mid)', 1], ['0.738–1 (high)', 2], ['> 1 (decoupled, Dcp)', 3]]
        .map(([t, i]) => `<span><i class="disc" style="background:${th.quart[i]}"></i>${t}</span>`).join('');
    } else if (mode === 'effort') html += [['Below threshold (< 90 % of MSO)', 0], ['At threshold (90–100 %)', 1], ['Over threshold (> MSO, spending W′)', 2]].map(([t, i]) => `<span><i class="disc" style="background:${th.effort[i]}"></i>${t}</span>`).join('');
    else if (mode === 'single') html += `<span><i class="disc" style="background:${th.single}"></i>All riders</span>`;
    else if (mode === 'group') html += `<span><i class="disc" style="background:${groupColor(0)}"></i>Lead group</span><span><i class="disc" style="background:${groupColor(1)}"></i>Group 2</span><span><i class="disc" style="background:${groupColor(2)}"></i>Group 3</span><span><i class="disc" style="background:${groupColor(3)}"></i>Later groups</span>`;
    else html += `<span>Disc colour identifies each rider (NetLogo colours)</span>`;
    if ($('sizeMso').checked && sim) {
      const m = sim.riders.map(r => r.mso);
      html += `<span><i class="disc" style="width:7px;height:7px;background:${th.muted}"></i>→<i class="disc" style="width:12px;height:12px;margin-left:6px;background:${th.muted}"></i>Size: MSO ${Math.round(Math.min(...m))}–${Math.round(Math.max(...m))} W</span>`;
    }
    html += `<span>Hover a rider for status (pulling, moving up, cannot pass, recovering, losing the wheel…)</span><span><b class="gapmark"></b>Gap opening behind a rider losing the wheel</span>`;
    $('legend').innerHTML = html;
  }

  // Render interpolation: the model steps at 20 Hz but the screen redraws at ~60 Hz. Drawing each rider
  // between its previous and current position (by the fraction of a step elapsed) removes the stutter that a
  // smoothly panning camera would otherwise reveal at high zoom.
  const rx_ = a => (a.px === undefined ? a.x : a.px + (a.x - a.px) * alpha);
  const ry_ = a => (a.py === undefined ? a.y : a.py + (a.y - a.py) * alpha);
  let alpha = 1;
  let frontShown = null;   // lead group's front-rider speed, smoothed over ~1.5 s for colouring

  /** One rider at (x, y), travelling toward +x, filling a box of half-length rx and half-width ry (pixels). */
  function drawRider(g, shape, x, y, rx, ry, th) {
    if (shape === 'chevron') {
      // NetLogo's default turtle shape: an arrowhead with a notched tail.
      g.beginPath();
      g.moveTo(x + rx, y);
      g.lineTo(x - rx, y - ry);
      g.lineTo(x - rx * 0.45, y);
      g.lineTo(x - rx, y + ry);
      g.closePath(); g.fill();
    } else if (shape === 'cyclist') {
      // A cyclist seen from directly above, travelling toward +x, drawn to scale (m × px per m): wheels and frame
      // as one thin line (1.7 m), handlebars 0.42 m wide, arms reaching forward from the shoulders, a back that is
      // broad at the shoulders and narrows to the saddle, and a helmet just ahead of the shoulders. The jersey
      // carries the rider's colour.
      const m = rx / 0.85, jersey = g.fillStyle, dark = $('dark').checked;
      const px = v => Math.max(1, v * m);
      g.lineCap = 'round';
      g.strokeStyle = dark ? '#7d838c' : '#4b5058';
      g.lineWidth = px(0.045);
      g.beginPath(); g.moveTo(x - 0.85 * m, y); g.lineTo(x + 0.85 * m, y); g.stroke();                 // wheels and frame
      g.lineWidth = px(0.035);
      g.beginPath(); g.moveTo(x + 0.5 * m, y - 0.21 * m); g.lineTo(x + 0.5 * m, y + 0.21 * m); g.stroke();   // handlebars
      g.strokeStyle = jersey; g.lineWidth = px(0.075);                                                   // arms
      g.beginPath();
      g.moveTo(x + 0.16 * m, y - 0.17 * m); g.lineTo(x + 0.47 * m, y - 0.19 * m);
      g.moveTo(x + 0.16 * m, y + 0.17 * m); g.lineTo(x + 0.47 * m, y + 0.19 * m);
      g.stroke();
      g.fillStyle = jersey;                                                                              // back
      g.beginPath();
      g.moveTo(x + 0.2 * m, y);
      g.bezierCurveTo(x + 0.22 * m, y - 0.2 * m, x + 0.08 * m, y - 0.23 * m, x - 0.05 * m, y - 0.19 * m);
      g.bezierCurveTo(x - 0.2 * m, y - 0.15 * m, x - 0.3 * m, y - 0.1 * m, x - 0.33 * m, y);
      g.bezierCurveTo(x - 0.3 * m, y + 0.1 * m, x - 0.2 * m, y + 0.15 * m, x - 0.05 * m, y + 0.19 * m);
      g.bezierCurveTo(x + 0.08 * m, y + 0.23 * m, x + 0.22 * m, y + 0.2 * m, x + 0.2 * m, y);
      g.fill();
      g.fillStyle = dark ? '#f1efe9' : '#2b2f36';                                                        // helmet
      g.beginPath(); g.ellipse(x + 0.27 * m, y, Math.max(1, 0.13 * m), Math.max(1, 0.1 * m), 0, 0, 7); g.fill();
      g.lineCap = 'butt'; g.lineWidth = 1;
    } else {
      g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 7); g.fill();
    }
  }

  function drawRoad() {
    const [g, w, h] = canvas('road');
    const ROADW = sim.road || Peloton.ROAD;
    const th = viewTheme();
    const groups = sim.groups;
    const fi = follow >= 0 ? Math.min(follow, groups.length - 1) : -1;
    const allX = sim.riders.map(rx_);
    let k = +$('zoom').value, target;
    if (fi < 0) {
      const lo = Math.min(...allX), hi = Math.max(...allX);
      k = Math.min(k, (w - 60) / Math.max(10, hi - lo + 4));
      target = hi + 2 - (w - 30) / k;                         // left edge of view in metres
    } else {
      const gr = groups[fi];
      const gx = gr.members.map(rx_), gHead = Math.max(...gx), gTail = Math.min(...gx);
      const len = gHead - gTail;
      const span = w / k;
      // Keep the group's head about three-quarters across; if the group is longer than the view, show its front.
      target = len + 8 < span ? gHead - 0.72 * span : gHead + 6 - span;
    }
    // Camera: carried forward at the followed riders' mean speed for the simulated time just rendered, plus a
    // gentle correction towards the framing target. This avoids the steady lag (and its wobble) of pure smoothing.
    const renderT = sim.t - DT * (1 - alpha);
    const followed = fi >= 0 ? groups[fi].members : sim.riders;
    const vMean = followed.reduce((t, r) => t + r.v, 0) / followed.length;
    if (camX === null || Math.abs(target - camX) > 60) camX = target;
    else camX += vMean * Math.max(0, renderT - (camT ?? renderT)) + (target - camX) * (1 - Math.exp(-frameDt * 1.5));
    camT = renderT;
    const X = x => (x - camX) * k, Y = y => h / 2 + 10 - y * k;
    // Background, road band and edges.
    g.fillStyle = th.bg; g.fillRect(0, 0, w, h);
    const top = Y(ROADW + 0.4), bot = Y(-ROADW - 0.4);
    g.fillStyle = th.road; g.fillRect(0, top, w, bot - top);
    // Road markings are fixed to the ground (2 m dashes, 2 m gaps), so they stream past at the group's speed while
    // the camera travels with the group. A rider who merely rides slower than the group then visibly still moves
    // forward relative to the road rather than appearing to go backwards.
    const dashPx = 2 * k, period = 2 * dashPx;
    g.strokeStyle = th.edge; g.lineWidth = 1; g.setLineDash([dashPx, dashPx]);
    g.lineDashOffset = ((camX * k) % period + period) % period;
    for (const y of [top, bot]) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    // Faint ground-fixed cross marks every 10 m along the road.
    g.setLineDash([]); g.lineDashOffset = 0;
    g.strokeStyle = th.edge; g.globalAlpha = 0.35;
    for (let gx = Math.ceil(camX / 10) * 10; gx <= camX + w / k; gx += 10) {
      const px = (gx - camX) * k; g.beginPath(); g.moveTo(px, top); g.lineTo(px, top + 6); g.moveTo(px, bot - 6); g.lineTo(px, bot); g.stroke();
    }
    g.globalAlpha = 1;
    // Distance ticks every 10 m (5 m when zoomed in), labelled relative to the race head.
    const head = Math.max(...allX);
    const step = k >= 14 ? 5 : k >= 5 ? 10 : 25;
    g.fillStyle = th.muted; g.font = '10px system-ui';
    for (let m = Math.ceil((camX - head) / step) * step; head + m <= camX + w / k; m += step) {
      const x = X(head + m);
      g.fillRect(x, bot, 1, 5);
      if (m !== 0) g.fillText(`${m} m`, x + 3, bot + 13);
    }
    g.font = '11px system-ui'; g.fillStyle = th.muted;
    g.fillText(`${fi >= 0 ? (fi === 0 ? 'Lead group' : 'Group ' + (fi + 1)) : 'Whole field'} · ${k.toFixed(k < 10 ? 1 : 0)} px per m · ${{ chevron: 'chevrons', cyclist: 'cyclist icons', disc: 'discs' }[$('riderShape').value]}${$('sizeMso').checked ? ', size by MSO' : ', all the same size'} · view moves with the group; road markings are fixed to the ground · travel →`, 10, 16);
    // Trails, relative to the race head (so passes show as crossing paths and dropped riders slide back).
    if ($('trails').checked && trail.buf.length > 1) {
      g.lineWidth = Math.max(1, k * 0.08);
      sim.riders.forEach((a, i) => {
        g.strokeStyle = fillFor(a, th); g.globalAlpha = 0.35; g.beginPath();
        trail.buf.forEach((f, j) => { const px = X(head + f.pts[i][0]), py = Y(f.pts[i][1]); j ? g.lineTo(px, py) : g.moveTo(px, py); });
        g.lineTo(X(rx_(a)), Y(ry_(a))); g.stroke();
      });
      g.globalAlpha = 1;
    }
    // Group outlines.
    groups.forEach((gr, i) => {
      const xs = gr.members.map(rx_);
      const x0 = X(Math.min(...xs)) - 0.8 * k - 3, x1 = X(Math.max(...xs)) + 0.8 * k + 3;
      if (x1 < 0 || x0 > w || gr.members.length < 2) return;
      const ys = gr.members.map(ry_);
      const y0 = Y(Math.max(...ys)) - 0.6 * k - 4, y1 = Y(Math.min(...ys)) + 0.6 * k + 4;
      g.strokeStyle = groupColor(i); g.globalAlpha = th.box; g.lineWidth = 1; g.setLineDash([4, 3]);
      roundRect(g, x0, y0, x1 - x0, y1 - y0, 6); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
      g.fillStyle = th.text; g.font = '600 11px system-ui';
      g.fillText(`G${i + 1} · ${gr.members.length}`, Math.max(4, x0), y0 - 4);
    });
    // Riders: all the same size by default, drawn as chevrons pointing in the direction of travel (as in the NetLogo
    // view), as overhead cyclist icons, or as discs. With "Size by MSO", size scales ×0.75–1.25 across this field's
    // MSO range. Hover a rider for its MSO.
    const msos = sim.riders.map(r => r.mso), mLo = Math.min(...msos), mHi = Math.max(...msos);
    const sizeBy = $('sizeMso').checked && mHi > mLo;
    const shape = $('riderShape').value;
    const scaleOf = a => sizeBy ? 0.75 + 0.5 * (a.mso - mLo) / (mHi - mLo) : 1;
    // Half-length (along the road) and half-width of each shape, in metres at scale 1.
    const HALF = { chevron: [0.75, 0.38], cyclist: [0.85, 0.23], disc: [0.46, 0.4] }[shape] || [0.46, 0.4];
    const radius = a => Math.max(2, HALF[1] * scaleOf(a) * k);
    const labelBy = $('labelBy').value;
    hits.road = [];
    g.font = `${k >= 8 ? 10 : 9}px system-ui`;
    for (const a of sim.riders) {
      const x = X(rx_(a)), y = Y(ry_(a));
      if (x < -20 || x > w + 20) continue;
      hits.road.push({ x, y, a });
      g.globalAlpha = a.status === 'dropped' ? 0.75 : 1;
      const sc = scaleOf(a), ry = Math.max(2, HALF[1] * sc * k), rx = Math.max(2.5, HALF[0] * sc * k);
      g.fillStyle = fillFor(a, th);
      drawRider(g, shape, x, y, rx, ry, th);
      if (labelBy !== 'none') {
        g.fillStyle = th.label;
        g.fillText(labelBy === 'mso' ? Math.round(a.mso) : a.id + 1, x + rx + 1, y - ry - 1);
      }
      g.globalAlpha = 1;
      if (a.status === 'losing wheel' && a.wheel >= 0 && isFinite(a.dw)) {
        const b = sim.riders[a.wheel];
        g.strokeStyle = th.ring.lose; g.lineWidth = 1; g.setLineDash([3, 3]);
        g.beginPath(); g.moveTo(x + rx + 2, y + ry + 4); g.lineTo(X(rx_(b)) - rx - 2, y + ry + 4); g.stroke(); g.setLineDash([]);
        g.fillStyle = th.ring.lose; g.fillText(`${a.dw.toFixed(1)} m`, (x + X(rx_(b))) / 2 - 10, y + ry + 15);
      }
    }
    // Off-screen groups, stacked at the edges.
    g.font = '600 11px system-ui';
    let nl = 0, nr = 0;
    const row = sim.rows.at(-1);
    groups.forEach((gr, i) => {
      const gd = row && row.groupData[i];
      if (X(gr.headX) < 0 && nl < 4) arrowLabel(g, 8, h - 8 - 20 * nl++, `◂ G${i + 1} · ${gr.members.length}${gd && i ? ' · +' + gd.gapS.toFixed(1) + ' s' : ''}`, groupColor(i), 'left');
      else if (X(gr.tailX) > w && nr < 4) arrowLabel(g, w - 8, 36 + 20 * nr++, `G${i + 1} · ${gr.members.length} ▸`, groupColor(i), 'right');
    });
    g.font = '12px system-ui';
  }
  function arrowLabel(g, x, y, text, col, side) {
    const tw = g.measureText(text).width;
    const xx = side === 'left' ? x : x - tw;
    g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(xx - 4, y - 12, tw + 10, 17);
    g.fillStyle = col; g.fillRect(xx - 4, y - 12, 3, 17);
    g.fillStyle = INK; g.fillText(text, xx + 3, y);
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  function drawField() {
    const [g, w, h] = canvas('field');
    const R = sim.riders, head = Math.max(...R.map(r => r.x)), tail = Math.min(...R.map(r => r.x));
    const span = Math.max(30, head - tail + 4);
    const l = 14, r = w - 14;
    const X = x => r - (head - x) / span * (r - l);
    g.strokeStyle = GRID; g.beginPath(); g.moveTo(l, h / 2); g.lineTo(r, h / 2); g.stroke();
    hits.field = [];
    sim.groups.forEach((gr, i) => {
      const x0 = X(gr.tailX) - 5, x1 = X(gr.headX) + 5;
      g.fillStyle = groupColor(i); g.globalAlpha = 0.12; g.fillRect(x0, 8, Math.max(10, x1 - x0), h - 26); g.globalAlpha = 1;
      hits.field.push({ x0, x1, i });
      gr.members.forEach(m => {
        g.fillStyle = groupColor(i);
        g.beginPath(); g.arc(X(m.x), h / 2 - 2 + m.y * 3, 3.5, 0, 7); g.fill();
      });
      const row = sim.rows.at(-1), gd = row && row.groupData[i];
      g.fillStyle = INK; g.font = (follow === i ? '700 ' : '') + '11px system-ui';
      const lab = `G${i + 1}·${gr.members.length}${i && gd ? ' +' + gd.gapS.toFixed(1) + 's' : ''}`;
      const tw = g.measureText(lab).width;
      g.fillText(lab, Math.min(r - tw, Math.max(l, (x0 + x1) / 2 - tw / 2)), h - 4);
    });
    g.font = '12px system-ui'; g.fillStyle = MUTED;
    g.fillText(`${Math.round(head - tail)} m from first to last`, l, 12);
  }

  function drawStretch() {
    const [g, w, h] = canvas('stretch');
    const rows = sim.rows.slice(-180);
    const l = 40, r = w - 14, t = 26, b = h - 30;
    const ymax = Math.max(10, ...rows.map(q => q.leadLength)) * 1.1;
    const X = i => l + i / 179 * (r - l), Y = v => b - v / ymax * (b - t);
    // Split bands.
    rows.forEach((q, i) => { if (q.groups > 1) { g.fillStyle = `rgba(221,102,83,${Math.min(0.35, 0.08 * (q.groups - 1))})`; g.fillRect(X(i) - (r - l) / 358, t, (r - l) / 179 + 0.5, b - t); } });
    g.strokeStyle = GRID; g.fillStyle = MUTED;
    const stepY = ymax > 60 ? 20 : ymax > 25 ? 10 : 5;
    for (let v = 0; v <= ymax; v += stepY) { g.beginPath(); g.moveTo(l, Y(v)); g.lineTo(r, Y(v)); g.stroke(); g.fillText(v, 10, Y(v) + 4); }
    g.fillText('m', 10, t - 8);
    const line = (key, col) => { g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); rows.forEach((q, i) => i ? g.lineTo(X(i), Y(q[key])) : g.moveTo(X(i), Y(q[key]))); g.stroke(); };
    line('leadLength', '#2a78d6'); line('leadWidth', '#eb6834'); g.lineWidth = 1;
    if (rows.length) { g.fillStyle = MUTED; g.fillText(rows[0].t + ' s', l, h - 10); g.fillText(rows.at(-1).t + ' s', r - 34, h - 10); }
    // Legend + direct labels.
    const leg = [['#2a78d6', 'Lead-group length'], ['#eb6834', 'Width'], ['rgba(221,102,83,.3)', 'Field split']];
    let kx = l + 4; leg.forEach(([col, lab]) => { g.fillStyle = col; g.fillRect(kx, 8, 12, 9); g.fillStyle = MUTED; g.fillText(lab, kx + 16, 17); kx += g.measureText(lab).width + 34; });
    hits.stretch = { rows, X, l, r };
  }

  function drawBraid() {
    const [g, w, h] = canvas('braid');
    const rows = sim.rows.slice(-60), n = sim.n;
    const left = 34, right = w - 18, top = 25, bottom = h - 60;
    g.strokeStyle = GRID;
    if (n <= 40) for (let k = 1; k <= n; k++) { const y = top + (k - 1) / (n - 1) * (bottom - top); g.beginPath(); g.moveTo(left, y); g.lineTo(right, y); g.stroke(); }
    g.fillStyle = MUTED; g.fillText('1', 13, top + 4); g.fillText(n, 6, bottom + 4); g.fillText('front', left, 15);
    if (rows.length) {
      sim.riders.forEach(a => {
        g.strokeStyle = riderColor(a.id); g.lineWidth = n > 40 ? 1 : 1.5; g.beginPath();
        rows.forEach((q, i) => { const x = left + i / 59 * (right - left), y = top + (q.ranks[a.id] - 1) / (n - 1) * (bottom - top); i ? g.lineTo(x, y) : g.moveTo(x, y); });
        g.stroke();
      });
      // Phase ribbon.
      const ry = bottom + 10, rh = 12, cw = (right - left) / 59;
      rows.forEach((q, i) => { g.fillStyle = q.phase ? PHASE_COLOR[q.phase] : '#eef2f1'; g.fillRect(left + i * cw - cw / 2, ry, cw + 0.5, rh); });
      g.fillStyle = MUTED; g.font = '10px system-ui'; g.fillText('phase', 2, ry + 10); g.font = '12px system-ui';
      g.fillText(rows[0].t + ' s', left, h - 6); g.fillText(rows.at(-1).t + ' s', right - 30, h - 6);
      hits.braid = { rows, left, right, ry, rh };
    }
    g.lineWidth = 1;
  }

  function drawPhase() {
    const [g, w, h] = canvas('phasePlot');
    const win = $('phaseWindow').value;   // last minute, last 5 minutes, or the whole run
    const all = sim.rows.filter(q => q.phase);
    const rows = win === 'all' ? all : all.slice(-(+win));
    const dotR = rows.length > 600 ? 2 : rows.length > 150 ? 3 : 4;
    const REF = Peloton.REF, d0 = sim.cond.d0;
    const l = 48, b = h - 37, t = 20, r = w - 20;
    const pmax = Math.max(1.6, ...rows.map(q => q.pcr)) , cmax = Math.max(4, ...rows.map(q => q.cx));
    const px = v => l + v / pmax * (r - l), py = v => b - (v - 1) / (cmax - 1) * (b - t);
    // Region tint for Dcp.
    g.fillStyle = '#fbefed'; g.fillRect(px(1), t, r - px(1), b - t);
    g.strokeStyle = '#b9cbc8'; g.setLineDash([5, 5]); g.beginPath();
    for (const v of [REF.pcrLow, REF.pcrHigh]) { g.moveTo(px(v), t); g.lineTo(px(v), b); }
    for (const v of [REF.cxLow, REF.cxHigh]) { g.moveTo(l, py(v)); g.lineTo(r, py(v)); }
    g.stroke(); g.setLineDash([1, 3]); g.strokeStyle = '#7d9a9a'; g.beginPath();
    for (const v of [d0, 1]) { g.moveTo(px(v), t); g.lineTo(px(v), b); } g.stroke(); g.setLineDash([]);
    g.strokeStyle = '#45686b'; g.beginPath(); g.moveTo(l, t); g.lineTo(l, b); g.lineTo(r, b); g.stroke();
    g.fillStyle = MUTED; g.fillText('Cx*', 8, 16); g.fillText('PCR', r - 25, h - 8);
    for (let v = 0; v <= pmax + 1e-9; v += 0.4) g.fillText(v.toFixed(1), px(v) - 8, b + 16);
    for (let v = 1; v <= cmax; v++) g.fillText(v, 30, py(v) + 4);
    // Region labels.
    g.font = '600 11px system-ui';
    const lab = (txt, x, y) => { g.fillStyle = PHASE_COLOR[txt]; g.fillText(txt, x, y); };
    lab('Cs', px(0.05), py(1) - 6); lab('S', px(REF.pcrHigh) + 6, py(1) - 6);
    lab('Ccl', px(0.05), t + 14); lab('Cch', px(REF.pcrHigh) + 6, t + 14); lab('Dcp', px(1) + 6, t + 14);
    g.font = '12px system-ui';
    // Trail.
    g.strokeStyle = '#c7d6d3'; g.lineWidth = 1; g.beginPath();
    rows.forEach((q, i) => i ? g.lineTo(px(q.pcr), py(q.cx)) : g.moveTo(px(q.pcr), py(q.cx))); g.stroke();
    hits.phase = [];
    rows.forEach((q, i) => {
      g.fillStyle = PHASE_COLOR[q.phase]; g.globalAlpha = 0.35 + 0.65 * (i + 1) / rows.length;
      g.beginPath(); g.arc(px(q.pcr), py(q.cx), dotR, 0, 7); g.fill();
      hits.phase.push({ x: px(q.pcr), y: py(q.cx), q });
    });
    g.globalAlpha = 1;
    if (rows.length) { const q = rows.at(-1); g.strokeStyle = INK; g.lineWidth = 2; g.beginPath(); g.arc(px(q.pcr), py(q.cx), 7, 0, 7); g.stroke(); g.lineWidth = 1; }
  }

  // ---------- Hover tooltips ------------------------------------------------------
  const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; document.body.appendChild(tip);
  function showTip(e, html) { tip.innerHTML = html; tip.hidden = false; tip.style.left = (e.pageX + 14) + 'px'; tip.style.top = (e.pageY + 12) + 'px'; }
  function hover(id, fn) {
    const c = $(id);
    c.addEventListener('mousemove', e => { const r = c.getBoundingClientRect(); const html = fn(e.clientX - r.left, e.clientY - r.top); if (html) showTip(e, html); else tip.hidden = true; });
    c.addEventListener('mouseleave', () => { tip.hidden = true; });
  }
  hover('phasePlot', (x, y) => {
    let best = null, bd = 144;
    for (const o of hits.phase || []) { const d = (o.x - x) ** 2 + (o.y - y) ** 2; if (d < bd) { bd = d; best = o; } }
    if (!best) return null; const q = best.q;
    return `<b>${q.t} s · ${q.phase}</b> ${PHASE_NAME[q.phase]}<br>PCR ${q.pcr.toFixed(3)} · Cx* ${q.cx.toFixed(2)}<br>Movement ${q.move} · CxP* ${q.cxp.toFixed(2)}`;
  });
  hover('stretch', x => {
    const s = hits.stretch; if (!s || !s.rows.length) return null;
    const i = Math.round((x - s.l) / (s.r - s.l) * 179); const q = s.rows[i]; if (!q) return null;
    return `<b>${q.t} s</b> · pace ${q.speedKmh.toFixed(1)} km/h<br>Lead length ${q.leadLength.toFixed(1)} m · width ${q.leadWidth.toFixed(1)} m<br>${q.groups} group${q.groups > 1 ? 's' : ''} · ${q.locked} cannot pass`;
  });
  hover('braid', (x, y) => {
    const s = hits.braid; if (!s || y < s.ry - 4 || y > s.ry + s.rh + 4) return null;
    const i = Math.round((x - s.left) / (s.right - s.left) * 59); const q = s.rows[i]; if (!q) return null;
    return q.phase ? `<b>${q.t} s · ${q.phase}</b> ${PHASE_NAME[q.phase]}` : `<b>${q.t} s</b> label pending (centred smoothing)`;
  });
  const STATUS_TEXT = {
    'pulling': 'Pulling at the front (exposed, sets the pace)',
    'swinging off': 'Swinging off after a pull, drifting back',
    'rejoining': 'Rejoining a sheltered slot near the front after a pull',
    'easing back': 'Easing back through the bunch (convective circulation)',
    'moving up': 'Moving up: has the exposed capacity to pass',
    'cannot pass': 'Cannot pass: moving up into the wind would exceed MSO',
    'recovering': 'Recovering: W′ depleted, holding the wheel',
    'losing wheel': 'Losing the wheel: gap opening',
    'bridging': 'Bridging across a gap',
    'on the limit': 'On the limit: above MSO to hold the wheel',
    'chasing': 'Dropped, chasing back with W′',
    'dropped': 'Dropped, riding alone',
    'free': 'Sheltered, with capacity to move up'
  };
  hover('road', (x, y) => {
    let best = null, bd = 196;
    for (const o of hits.road || []) { const d = (o.x - x) ** 2 + (o.y - y) ** 2; if (d < bd) { bd = d; best = o; } }
    if (!best) return null;
    const a = best.a, st = sim.riderState(a);
    const gap = a.status === 'losing wheel' && isFinite(a.dw) ? ` (${a.dw.toFixed(1)} m)` : '';
    return `<b>Rider ${a.id + 1}</b> · MSO ${Math.round(a.mso)} W · group ${a.group + 1}<br>${STATUS_TEXT[a.status] || a.status}${gap}<br>${st.speedKmh.toFixed(1)} km/h · power/MSO ${st.localRatio.toFixed(2)} · d ${st.d.toFixed(2)}${sim.cond.reserve ? ' · W′ ' + Math.round(st.wFrac * 100) + ' %' : ''}<br>PCR ${st.pcr.toFixed(3)} (${st.pcr > 1 ? 'decoupled: > 1' : st.pcr > sim.cond.d0 ? 'coupled: needs drafting' : 'at or below d'})`;
  });
  $('field').addEventListener('click', e => {
    const r = $('field').getBoundingClientRect(), x = e.clientX - r.left;
    const hit = (hits.field || []).find(o => x >= o.x0 - 4 && x <= o.x1 + 4);
    if (hit) { renderFollow(); $('follow').value = hit.i; follow = hit.i; camX = null; draw(); }
  });

  // ---------- Main loop ------------------------------------------------------------
  let frameDt = 1 / 60;
  function frame(now) {
    const elapsed = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
    if (elapsed > 0) frameDt = elapsed;
    if (!paused) {
      acc += elapsed * +$('speed').value;
      while (acc >= DT) {
        if (scenario) {
          const t = sim.t - scenario.start, p = scenario.p;
          $('pace').value = Math.round(p.run(t) * 2) / 2; labels();
          $('scenario').textContent = p.text(t);
          if (t >= p.end) { scenario = null; $('scenario').textContent = p.done; clearOn(); endExperiment(); }
        }
        for (const r of sim.riders) { r.px = r.x; r.py = r.y; }
        sim.step(DT, cond());
        for (const r of sim.riders) {
          r.effShown = r.effShown === undefined ? r.P / r.mso : r.effShown + (r.P / r.mso - r.effShown) * (DT / 1.5);
          r.vShown = r.vShown === undefined ? r.v : r.vShown + (r.v - r.vShown) * (DT / 1.5);
        }
        { const vf = sim.frontSpeed(); frontShown = frontShown === null ? vf : frontShown + (vf - frontShown) * (DT / 1.5); }
        recordTrails();
        acc -= DT;
        if (sim.t + 1e-8 >= nextSample) { sim.sample(); nextSample++; update(); }
      }
    }
    alpha = paused ? 1 : Math.min(1, acc / DT);
    draw();
    requestAnimationFrame(frame);
  }

  // ---------- Exports ----------------------------------------------------------------
  function download(name, lines) {
    const text = lines.join('\n');
    try {
      const u = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
      const a = document.createElement('a'); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000);
    } catch (e) { /* downloads may be blocked (e.g. in a hosted, sandboxed page) */ }
    // Also copy the CSV to the clipboard, so it can be pasted into a spreadsheet where downloads are blocked.
    const note = msg => {
      let t = document.getElementById('csvNote');
      if (!t) { t = document.createElement('div'); t.id = 'csvNote'; t.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#123;color:#fff;padding:10px 16px;border-radius:8px;font:14px/1.4 system-ui,sans-serif;z-index:99;max-width:90vw'; document.body.appendChild(t); }
      t.textContent = msg; clearTimeout(t._h); t._h = setTimeout(() => t.remove(), 5000);
    };
    try {
      navigator.clipboard.writeText(text).then(
        () => note(name + ': ' + (lines.length - 1) + ' rows copied to the clipboard (paste into a spreadsheet if no download appeared).'),
        () => note(name + ': if no download appeared, downloads are blocked here — use the source package to export.'));
    } catch (e) { note(name + ': if no download appeared, downloads are blocked here.'); }
  }
  function needRows() { if (!sim.rows.length) { $('scenario').textContent = 'Run for at least one simulated second before exporting.'; return false; } return true; }
  $('csv').onclick = () => {
    if (!needRows()) return;
    const keys = ['t', 'seed', 'speedKmh', 'grade', 'd', 'n', 'draft', 'reserve', 'lull', 'activity', 'pcr', 'pacePCR', 'cx', 'cxp', 'delta', 'x', 'dPCRs', 'move', 'phase', 'phasePaper', 'groups', 'leadSize', 'dropped', 'leadLength', 'leadWidth', 'singleFile', 'locked', 'leadPCR', 'leadCoreWidth', 'leadLine', 'leadStretched', 'rule', 'pcrBasis', 'pcrFront', 'frontKmh'];
    download('peloton-experiment.csv', ['time_s,seed,pace_kmh,grade_pct,drafting_coefficient,riders,shelter_model,w_prime,PCR,PCR_at_pace,Cx_star,CxP_star,delta_PCR_raw,local_position_changes,delta_PCR_smoothed,movement,phase,phase_paper_rule,groups,lead_group_size,riders_behind,lead_length_m,lead_width_m,lead_single_file_share,lead_cannot_pass,lead_PCR,lead_core_width_m,lead_stretched,phase_rule,PCR_basis,PCR_front_rider_basis,front_rider_speed_kmh',
      ...sim.rows.map(q => keys.map(k => q[k] === null || q[k] === undefined ? '' : (typeof q[k] === 'number' ? +q[k].toFixed(5) : q[k])).join(','))]);
  };
  $('riderCsv').onclick = () => {
    if (!needRows()) return;
    const lines = ['time_s,cyclist,MSO_W,group,status,x_m,y_m,speed_kmh,power_W,power_over_MSO,w_prime_left,drafting_d,PCR,PCR_front_rider_basis,PCR_selected_pace,can_pass'];
    sim.rows.forEach(q => q.riders.forEach(r => lines.push([q.t, r.id, r.mso.toFixed(1), r.group, r.status, r.x.toFixed(2), r.y.toFixed(2), r.speedKmh.toFixed(2), r.power.toFixed(1), r.localRatio.toFixed(4), r.wFrac.toFixed(3), r.d.toFixed(4), r.pcr.toFixed(4), r.pcrFront.toFixed(4), r.pcrSched.toFixed(4), r.canPass].join(','))));
    download('peloton-rider-history.csv', lines);
  };
  $('groupCsv').onclick = () => {
    if (!needRows()) return;
    const lines = ['time_s,group,size,riders,gap_s,gap_m,speed_kmh,length_m,width_m,core_width_m,single_file_share,PCR,Cx_star,CxP_star,local_position_changes,state'];
    sim.rows.forEach(q => q.groupData.forEach(g => lines.push([q.t, g.index, g.size, '"' + g.riders.join(' ') + '"', g.gapS.toFixed(2), g.gapM.toFixed(1), g.speedKmh.toFixed(2), g.length.toFixed(1), g.width.toFixed(2), g.coreWidth.toFixed(2), g.singleFile.toFixed(3), g.pcr.toFixed(4), g.cx === null ? '' : g.cx.toFixed(4), g.cxp === null ? '' : g.cxp.toFixed(4), g.x, g.label].join(','))));
    lines.push('', 'time_s,event,riders,description');
    sim.events.forEach(e => lines.push([e.t, e.type, '"' + e.riders.join(' ') + '"', '"' + e.text.replace(/"/g, "'") + '"'].join(',')));
    download('peloton-group-history.csv', lines);
  };

  // ---------- Wiring -------------------------------------------------------------------
  $('play').onclick = () => { paused = !paused; $('play').textContent = paused ? 'Play' : 'Pause'; };
  $('reset').onclick = () => reset();
  for (const id of ['pace', 'grade', 'draft', 'urge']) $(id).oninput = () => {
    labels(); chartsDirty = true; if (id === 'draft') renderLegend();
    // Moving the pace slider ends a pace experiment but keeps a climb on; moving the grade slider ends the climb.
    if (id === 'pace' || id === 'grade') {
      scenario = null;
      if (id === 'grade') endClimb();
      clearOn(); endExperiment();
      $('scenario').textContent = climbBefore ? 'Climbing 2% at ' + $('pace').value + ' km/h · click Climb 2% hill again to return to the flat.'
        : 'Free exploration · adjust any control.';
    }
  };
  $('lull').onchange = labels;
  for (const id of ['count', 'centre', 'spread']) $(id).oninput = () => { labels(); reset(); };
  $('msoMode').onchange = () => {
    // "Random within the current riders' range": start from the lowest and highest MSO now on the road.
    if ($('msoMode').value === 'span' && sim && sim.riders.length) {
      const m = sim.riders.map(r => r.mso);
      $('spanLo').value = Math.round(Math.min(...m)); $('spanHi').value = Math.round(Math.max(...m));
    }
    labels(); reset();
  };
  for (const id of ['spanLo', 'spanHi']) $(id).onchange = () => reset();
  $('custom').onchange = () => reset();
  $('rangePreset').onchange = () => { const [lo, hi] = $('rangePreset').value.split(',').map(Number); $('rangeLo').value = lo; $('rangeHi').value = hi; reset(); };
  $('rangeLo').onchange = () => reset(); $('rangeHi').onchange = () => reset();
  $('follow').onchange = () => { follow = +$('follow').value; camX = null; draw(); };
  // The overhead view grows with track width × zoom so the whole road stays visible (within 200–560 px).
  const fitRoad = () => { $('road').style.height = Math.round(Math.max(200, Math.min(560, (TRACK_WIDTH + 1.8) * +$('zoom').value + 70))) + 'px'; };
  const zoomLabel = () => { $('zoomOut').textContent = $('zoom').value + ' px/m'; fitRoad(); };
  $('zoom').oninput = () => { zoomLabel(); draw(); };
  $('pcrBasis').onchange = () => { chartsDirty = true; renderLegend(); };
  for (const id of ['colorBy', 'labelBy', 'trails', 'dark', 'sizeMso', 'riderShape', 'phaseWindow']) $(id).onchange = () => { renderLegend(); chartsDirty = true; draw(); };
  zoomLabel(); renderLegend();
  document.querySelectorAll('[data-preset]').forEach(b => { b.onclick = () => applyPreset(b.dataset.preset); });
  window.addEventListener('resize', () => { chartsDirty = true; draw(); });

  // Read-only hook for automated checks: screen positions of riders drawn in the last frame.
  window.__pelotonScreen = () => (hits.road || []).map(o => ({ id: o.a.id, x: o.x, y: o.y }));

  reset();
  requestAnimationFrame(frame);
})();

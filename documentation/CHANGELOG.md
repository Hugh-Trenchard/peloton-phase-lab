# Peloton Phase Lab: development history

This log was kept while the model was developed (November 2026). Earlier entries describe settings and rules that later revisions replaced; the ODD document describes the current model.

## What changed in v2

The main addition is a mechanism for the three behaviours the paper describes around threshold: weak riders being shed, sub-pelotons forming, and the group stretching out because riders at threshold cannot pass.

### Model (`model.js`)
| Area | v1 | v2 |
| --- | --- | --- |
| Pace and power | Slider set exposed power; speed by cube-root rule | Slider sets **speed** (km/h). Power uses the paper's power–speed relation and NetLogo parameters (CdA 0.32 m², Crr 0.004, ρ 1.226 kg/m³, 75 kg, no wind), plus a **grade** term (Eqs. 1–2) |
| Shelter | Fixed d if anyone is 1–8 m ahead | Default: **Olds' wheel-spacing d (Eq. 5)**, fading to no benefit at 0.9 m lateral offset. Losing the wheel costs shelter, so gaps grow. The v1 rule is still available |
| Effort limits | Speed capped by MSO; optional "recovery loss" | **W′ balance**: riders can exceed MSO to hold a wheel, take a pull or bridge, then must recover. Can be switched off |
| Pace setting | Leader rode at the requested pace | Each group's front rider **pulls**, then **swings off** beyond the edge of the group and drifts back. Riders who cannot sustain the front take only a token turn |
| Passing | Sinusoidal passing intention scaled by reserve | **Passing rule**: moving up into the wind is voluntary, so it is allowed only if riding exposed at the group's speed + 0.8 m/s is sustainable (≤ MSO). Riders at threshold therefore **cannot pass** |
| Formation | Fixed lateral oscillation | **Shelter seeking**: as a rider's ideal sheltered demand (PCR_i) rises from about 0.6 to 0.9, or whenever they cannot ride exposed, they steer into a free slot behind a wheel rather than ride abreast. The group narrows and lengthens into **single file** |
| Separation | Riders slowed if PCR > 1 | A rider who cannot hold the wheel lets a gap open. Riders behind come round **only if bridging is affordable**, otherwise they stay sheltered behind and **go with them**. That is how a **sub-peloton** forms. Dropped riders near a group chase back with W′ |
| Groups | — | Groups are split by a wheel gap above 6 m and rejoin below 3 m. For each group: size, time gap, speed, length × width, single-file share, PCR, Cx* and a state label |
| PCR | Mean of d·P(requested pace)/MSO | As in the authors' NetLogo code: P_front at the **selected pace**, fixed d (alternatively the lead group's front rider's speed) |
| Phase labels | Three illustrative labels | **Section 2.8 rules**: Scratch-reference thresholds (PCR 0.4882/0.7381; Cx* 1.6931/2.0986), 5-tick centred smoothing, ε = 0.10 × sd(ΔPCR). Labels lag by 2 s |
| MSOs | Even spread around 350 W | The **12 Scratch-race MSOs from the NetLogo model** (215–337 W, mean 268 W), drawn with replacement as in the paper; even spread; or a **custom list** |
| Reproducibility | Deterministic | Seeded, so runs can be repeated or varied by seed |
| Race log | — | Records drops, splits (naming the rider whose wheel was lost) and rejoins |

### Interface (`app.js`, `index.html`, `style.css`)
- **Overhead view, NetLogo-style**: a fixed, isotropic metre scale (default 12 px per m, matching the NetLogo patch size; zoom 3–30 px/m). Riders are discs only 15 % longer than wide, on a dark world. By default they are coloured by each rider's PCR (PCR_i = d × P_front / MSO_i, Eq. 4, on the selected basis) against the paper's coupling thresholds: green PCR ≤ d (could ride the speed exposed), yellow d < PCR ≤ 1 (coupled; needs drafting), red PCR > 1 (decoupled). An alternative mode uses the Scratch-reference quantiles (≤ 0.488, 0.488–0.738, 0.738–1, > 1); another shows instantaneous power/MSO (green < 90 %, yellow 90–100 %, red > 100 %) and sized by MSO (0.6–1.0 m diameter across the field's MSO range; off = NetLogo's 0.8 m). Other colour options also include single colour, group, or NetLogo's base colours per rider; “MSO labels” switch (off by default; hover a rider for details; or show rider numbers instead); light view; 10-second trails relative to the race head, which show passes as crossing paths and dropped riders sliding back. The camera pans smoothly with the lead group or any group you choose; distance ticks are metres behind the race head. Status (pulling, moving up, cannot pass, recovering, losing the wheel, bridging, dropped) is shown on hover rather than as rings; the open gap behind a failing wheel is marked in metres; off-screen groups are labelled at the edges with time gaps; hover a rider for details.
- **Whole-field strip**: every rider and group with time gaps. Click a group to follow it.
- **Capacity ladder**: each rider's passing threshold and sheltered limit, set against the current pace and the lead group's actual speed. It shows who can move freely, who needs a wheel and cannot pass, and who will be dropped.
- **Stretch and splits** chart: lead-group length and width over time, with shading for seconds when the field was split.
- **Braid** with a phase ribbon, **phase-plane** coloured by phase with the paper's thresholds, and **phase occupancy** bars.
- **Group table** and **race log**; the rider table adds group, status, speed, power/MSO, W′, drafting d and threshold speeds.
- **Experiments**: Find a rhythm (34 km/h), Stretch at threshold (34 → 42 km/h), Shed the weak (wide spread, 45 km/h), Surge then ease (34 → 42 km/h, hold 60 s, ease: S then Sf then Ccl), and the paper's 2 % grade.
- **Exports**: group observations (including phase, movement, groups, stretch and passing counts), rider history (position, speed, power, W′, d, PCR, status), and group history with the race log.
- Hover tooltips on the ladder, stretch, braid ribbon and phase plane.

## Later revisions (same day)

- **Track width** control (6–20 m, default 10 m; v1 effectively 6.8 m).
- **Wide, short bunch below threshold.** A group's relaxed half-width is (0.25 + 0.4·r)·√N + 0.4 + 0.4·r metres, where r = 1 − smoothstep(0.55, 0.738, group PCR at its speed). Below about PCR 0.55 (compact phases) the bunch spreads wide and riders in neighbouring lanes may sit level; towards the Scratch high quantile (0.738) it narrows into a line. Typical (12 riders): 32 km/h 6.4 m wide × 9 m long; 34 km/h 5.1 × 12 m; 38 km/h 3.4 × 21 m; 42 km/h 2.5 × 23 m, 97 % single file. Trailing groups now close small gaps, and a gap must persist 2 s (or exceed 12 m) to count as a split, so brief straggles are not logged as splits.
- **Smooth motion.** (1) The view interpolates each rider between model steps (model 20 Hz, screen ~60 Hz), and the camera is carried forward at the followed group's speed, so riders no longer stutter against a panning background (measured on-screen jitter at 30 px/m: p95 0.02 px). (2) In the model, sideways movement has limited acceleration and a smoothed target lane, the wheel choice has hysteresis, lateral collisions are anticipated 0.4 s ahead, and overlaps are resolved by speed rather than by teleporting. Frame-to-frame acceleration noise fell from ~8 mm to under 1–5 mm.
- **Bug fix: pull-off speed spiral.** A rider swinging off could, when boxed in, slow the new leader behind him while taking his own speed from that leader, collapsing a group to walking pace. Pull-offs now reference the leader's achievable speed, and a leader steers round a rider swinging off.
- **Stretched-fatigued (Sf) branch.** Riders whose W′ is depleted (below about 60 %) keep to wheels and do not move up until recovered (status “recovering”). After a hard surge the line can therefore persist while the pace eases.
- **Realistic MSO ranges** (MSO source → “Realistic range for a rider category”): recreational/club 180–260 W, junior 220–300 W, amateur/masters 240–330 W, national-level women 260–350 W, national-level men 320–420 W, professional/WorldTour men 390–480 W. The bounds are editable, and riders are drawn uniformly within them for the seed. These are approximate, illustrative values for efforts of about 10–20 min; replace them with measured values where available. The experiment presets assume the Scratch pool; for other ranges, use the capacity ladder to find the threshold pace (WorldTour men, for example, line out at about 48 km/h).
- **Rejoining near the front after a pull** (control “After a pull, rejoin”). A rider swinging off draws a target position 2–10. Once that many riders have passed, they slip into the first free sheltered slot just ahead, alongside, rather than drifting to the tail (status “rejoining”). Default *near the front when below threshold*: in a tight line at threshold there is rarely a free slot, so riders drift further back. *Near the front always* squeezes riders in, and those behind ease off to make room. *At the back* is a classic paceline. Over 6 seeds, 16 riders: at 34 km/h ~82 % of rejoins are within the first 10 in either front mode, with one group throughout. At 42 km/h, “always” puts 96 % within the first 10, but the braking ripple it sends down the line raises the mean group count from 1.6 to 2.6 and cuts S occupancy from 34 % to 10 %.
- **Stronger urge to move up.** Riders with exposed capacity to pass try to move up more often the further back they are: rate = urge × (0.25 + 0.6 × relative position from the front) × reserve, starting from the back 85 % of the group (was 70 %). In relaxed (below-threshold) groups they also sit tighter: wheel gap down to 0.25 m and up to ~0.6 m closer to the riders ahead, scaled by the urge slider. Result, 12 riders at 34 km/h: about 6.6 m wide × 9 m long (was 5.1 × 12 m), about one move-up attempt per rider per minute; at threshold nothing changes, because riders there cannot pass.
- **Centre bias** (fixed), as in the NetLogo `put-middle-bias`, where Δ is added to `y-acc` and so directly to `ycor` each tick. It is a direct adjustment of lateral position (0.05 m per second toward the middle), not of lateral speed. It applies to riders leading their group and to riders moving relative to it (moving up, tucking back in, easing back), and it shifts the position the rider holds, so the effect persists. It is never applied into a rider alongside. Front rider's mean distance from the centre line: about 0.6 m at 34 km/h on a 10 m track.
- **Consistent with the authors' NetLogo code (July 8 2026 version):**
  - **PCR basis** (default *selected pace*, i.e. the Pace slider or an experiment's schedule): PCR_i = d × P(selected pace) / MSO_i with fixed d (0.62), as in the NetLogo `set-speeds`/`power` procedures in fixed-draft mode, and as in the empirical analysis (observed peloton speed). In NetLogo, a rider's deceleration (`new-speed`) never feeds back into PCR, so a rider who cannot hold the pace keeps PCR > 1. The flocking term `x-acc` that NetLogo adds to the speed is not reproduced. Alternative: *front rider's actual speed* (Eq. 4 read literally). The earlier *own speed* option was removed, because it has no counterpart in the NetLogo code.
  - **Positional changes X** are counted as in NetLogo's `calculate-positions`: +1 for each rider whose ahead-count changed since the previous second, not the size of the change. Sub-group X uses the same rule.
  - **Consequence for ΔPCR:** on the selected-pace basis, PCR changes only when the pace (or grade) changes, as in NetLogo, where the speed schedule drives ΔPCR. At a steady pace no seconds are labelled Da, Dd or Sf, so the ΔPCR noise floor is no longer needed, though it is kept as an option.
  - Results, 16 riders, 6 seeds: 32–34 km/h PCR 0.38–0.45, Ccl 74–79 %; 36–38 km/h PCR 0.53–0.61, Transitional; 40 km/h PCR 0.70, S 45 %; 42–44 km/h PCR 0.81–0.92, S 100 %. Surge to 42 km/h and ease: peak S 100 %, ease Sf 31 % / Dd 29 %, after Ccl 62 %.
- **How the stretched phase is identified** (control): *by lead-group width (and Cx\*)* (default), *by single-file share (and Cx\*)*, or *by Cx\* only (paper, Section 2.8)*. All phases come from the paper's rules; the first two options additionally label S/Sf from the lead group's formation. With the width rule, the lead group (3+ riders) counts as stretched when its core width (riders swinging off excluded, + 0.6 m) is at most a set share of the track width (default 20 %, i.e. 2 m on a 10 m track; adjustable 10–40 %), even if some reshuffling continues. Results (16 riders, “Stretch at threshold”, 42 km/h hold, 3 seeds): S 98–100 % with the width rule (core width ~0.9 m); paper-only S 34–88 %. Surge to 42 km/h and ease (5 seeds): peak S 100 %, ease Sf 41 % / Dd 29 %, after Ccl 76 %. Steady 38 km/h: S ~24 % (the group narrows intermittently). With the single-file option: after Dcp, the peloton is labelled S whenever the lead group (3 or more riders) is at least a set share single file (default 80 %, adjustable 50–100 %) and its PCR exceeds PCR_low (0.488); Sf if, in addition, its PCR is below PCR_high (0.738) and ΔPCR is decelerating. Otherwise the paper's Section 2.8 rules apply. Rationale: after a split, dropped riders keep generating ahead-count changes and lower the field's mean PCR, so the whole-field label leaves S even while the lead group rides single file. Sub-groups use the same criterion (direction-free) in the group table. Exports record both labels (`phase` and `phase_paper_rule`), the lead group's PCR and the rule used. *Single-file share* is the share of lead-group riders (excluding riders swinging off) with nobody alongside (within one bike length longitudinally and 1.4 m laterally).
- **Compact bunch covers the road.** The relaxed half-width now runs from a narrow core (0.25·√N + 0.4 m) when lined out to the full usable half-width of the track when compact (r = 1, group PCR below ~0.55). Typical on a 10 m track: 12 riders ~7 m wide, 16 riders ~8.4 m, 30 riders ~9.2 m at 32 km/h.
- **Exposed riders drop into the line.** A rider exposed beside the line while needing a wheel (for example, at the head of a second column) now steers in behind the chosen rider, easing only 0.2 m/s; a stronger 0.6 m/s ease dragged the riders behind off the wheel and raised splitting. This removes stable double-file lines at threshold, which had kept the single-file share near 33 % in some runs.
- In the “Stretch at threshold” preset (16 riders, 5 seeds, 42 km/h hold): S 49–100 % of seconds (Sf 0–49 %) with the formation rule; S 10–87 % with the paper-only rule. The lead group is ≥ 80 % single file in 97–100 % of seconds. The riders shed are mostly the 215–216 W riders, whose sheltered limit is about 42 km/h.
- **Purposeful lateral movement.** Riders no longer wander sideways at random. Each holds its lateral position and moves sideways only to manoeuvre:
  - moving up passes close to the riders being passed (one lane over, at most one extra lane if blocked), then the rider eases toward the middle and holds;
  - swinging off goes into the nearest free corridor beside the riders about to be passed (not out to the bunch edge), then the rider settles toward the middle after rejoining.
  Sideways gaps close smoothly to a 0.75 m spacing, removing a deadlock that left riders stranded at the edge. At 34 km/h, direction reversals fell from 0.28 to about 0.09 per rider per second.
- **Convective circulation.** In a relaxed lead group, riders near the front (not the leader) occasionally ease off for 4–8 s (status “easing back”) while riders with reserve move up the margins (move-up attempts are 2.5× more frequent than before). This produces the paper's Ccl description deliberately rather than through lateral jitter: 34 km/h, 16 riders, Ccl ~77 %.
- **Compact width scales with group size:** about 0.4·√N + 0.3 m either side (≈ 0.9 m between riders abreast), up to the full road for large groups. On a 10 m track: 12 riders ~6–7 m, 16 ~7 m, 50 ~9 m, 100 ~10 m.
- **Urge to move up** now runs 0–3 (default 1.2; presets use 1.2). Spacing effects saturate at 1; higher values add more move-up attempts.
- **No lining out well below threshold.** Wheel-seeking is damped by the group's relax factor, so riders who could not ride the pace exposed stay sheltered inside a compact bunch rather than forming lines. Each group's relax factor uses the pace it is trying to ride, so chasing groups still line up. 16 riders: 34 km/h 7.5 m wide, single file 32 %, Ccl; 36 km/h 5.7 m; 38 km/h 4.2 m (52 %); 40 km/h 2.7 m (79 %, S 55 %); 42 km/h 2.0 m (99 %, S 100 %).
- **Front riders head for the middle.** The front rider steers toward the centre of the road, and riders in positions 2–4 hold positions biased toward it.
- **Track width** up to 20 m. The **Riders** slider is now at the top of the controls.
- **Stronger gap closing.** Followers close an open gap at 0.8 m/s per metre of excess gap, up to +2.5 m/s (was 0.5 per metre, up to +1.5), and brake more gently (−0.8 m/s at most) so braking waves do not amplify. A group just behind another chases at up to +2.5 m/s (0.25 m/s per metre of gap). 16 riders at 42 km/h: about 1.3 groups (was about 1.5–2.0).
- **Move-up pass limit** (intrinsic, no control). A rider moving up passes a limited number of riders while unsheltered, then tucks into the nearest sheltered slot (behind a rider just ahead, toward the group's middle) and may move up again later. The limit depends on the rider's own PCR at the group's speed: 10 riders at compact-static speeds (PCR_i ≤ 0.488, the Scratch low quantile), falling linearly to 0 at PCR_i = d (0.62), where the rider could no longer ride the pace exposed and does not try to pass. Strong riders therefore keep moving up longer than weak ones as the pace rises (16 riders, Scratch pool: about 1,700 move-up attempts in 2 min at 32 km/h, 130 at 38 km/h, none at 42 km/h). Fixes found along the way: riders giving way to a tucking rider (or a rider swinging off) now key their speed to the group's speed rather than to each other's, which had cascaded down to ~24 km/h; tucking ends if its target drops level or behind; riders never choose a rider who is easing back as their wheel, so they go round. In a compact bunch at 34 km/h, momentary dips of more than 3 km/h below pace now affect about 1 % of rider-seconds.
- **Gradual centring after passing.** After moving up, rejoining or easing back, a rider's held lateral position drifts toward the centre at up to 0.15 m/s for about 10 s, but only while there is a gap beside them in that direction. This replaces the earlier instant re-target to 60 % of the current offset. The positional centre bias still applies to group leaders and riders on the move.
- **Phase by group** panel (below the metric cards): each sub-group's phase label, PCR, Cx\*, CxP\*, length × width, single-file share and speed, side by side. Labels use the Section 2.8 thresholds and the chosen stretched-phase rule, without the direction term, because a group's PCR series breaks when riders join or leave. Single riders show PCR only (Dcp when PCR > 1). The group table and group-history export add CxP\* and core width.
- **Seed removed from the controls.** Each reset (and each experiment) draws a fresh random seed, so runs differ. The seed is recorded in the group-observation export, and `new Peloton({ seed })` reproduces a run in code.
- **Road markings fixed to the ground.** The camera travels with the followed group, so a rider who is merely slower than the group (being passed, easing back, dropping off) used to appear to move backwards. The edge dashes (2 m) and 10 m cross marks are now fixed to the ground and stream past at the group's speed, showing that everyone still moves forward. Riders never move backwards in the model (see the overlap fix below), and speeds have a floor. Trails remain relative to the front of the race.
- **Urge to move up proportional to capacity.** Each rider's motivation to move up (and the slight forward pressure in relaxed groups) is scaled by the same capacity factor as the pass limit: 1 at compact-static speeds (PCR_i ≤ 0.488), falling linearly to 0 at PCR_i = d. The slider remains the overall multiplier. 16 riders, 2 min: about 1,900 move-up attempts at 32 km/h, 490 at 36, 176 at 38, 21 at 40, none at 42 km/h.
- **Bug fix: overlap correction could move a rider backwards.** The non-overlap block subtracted up to one step's travel for each overlapping rider ahead, so a rider overlapping two riders at once could end a step behind where it started. Each rider's position at the start of the step is now a floor: `a.x = Math.max(startX[a.id], a.x + room)`, in a separate `resolveOverlaps` method. A rider may slow or stop advancing, never move backwards. A regression test builds the case directly.
- **Optional ΔPCR noise floor** (ε ≥ 0.005; off by default = the paper's rule). At a steady pace, ε = 0.10 × sd(ΔPCR) is tiny, so tick-level noise is labelled acceleration or deceleration, producing spurious Da, Dd and Sf. The floor removes these.

### Do the outputs capture S and Sf?
An earlier version under-produced S: in a stretched line, frequent pull rotations (weak riders taking 5 s token turns) and riders drifting back right at the 1 m lateral counting boundary changed every rider's ahead-count, so Cx* rarely fell below the Scratch low threshold (1.693). Fixes: riders swing 1.4 m clear of the line, beyond the counting window. When the group is lined out at threshold, riders who can sustain the front pull until W′ falls to 40 % (70 % in a relaxed bunch), only riders far over their MSO take short token turns, and swung-off riders drift back faster.

Phase occupancy, 12 riders from the Scratch pool, 3 seeds, the paper's ε rule unless noted:

| Run | Main phases |
| --- | --- |
| Steady 34 km/h | Ccl, then Cs |
| Steady 38 km/h | Transitional, Da/Dd (Sf ~8 %, mostly ΔPCR noise; ~2 % with the noise floor) |
| Steady 40 km/h | Transitional 56 %, Sf 26 % (largely noise at a steady pace; use the noise floor) |
| Steady 41 / 42 / 43 km/h | **S 47 % / 68 % / 79 %** |
| Surge to 42 km/h, hold 60 s, ease (5 seeds) | **Peak: S 60 %. Ease: Sf 26–27 %, Dd ~40 %, S 17 %. After: Ccl 65 %** |
| 16 riders, “Stretch at threshold” preset, 42 km/h hold | S ~73 % (was 11 %) |
| Surge to 46 km/h | The field splits; labels shift to Da/Dd/Cch (cf. the paper's finding that higher demand shifts occupancy to Cch/Dcp rather than S) |
| 50 riders at 42 km/h | Mostly Da/Dd: absolute turnover is high in long lines even after the 12/N normalisation (the paper notes residual size effects at N = 50 and 100) |

### ΔPCR noise-floor checkbox removed; shorter stretched-phase note

- **Noise floor:** the checkbox is gone. Direction (accelerating, decelerating or neutral) always uses the paper's ε = 0.10 × sd(ΔPCR), with no extra floor. The model option remains for the tests.
- **Stretched-phase note:** the note beside the conditions is now one sentence. The full definition (the paper's rule, the single-file-line check, and which columns the exports record) is in the model notes under "What is measured?".

### Starting grid: two rows up to 30 riders

- **Up to 30 riders:** two staggered rows, half the field in each, side by side 1.1 m apart and centred on the road. Each row narrows its spacing (to about 0.95 m) only if it would not otherwise fit the road.
- **More than 30 riders:** spread across the road's whole usable width, in as few rows as that allows, as before.

Starting widths on the 15 m road: 8 riders 3.9 m, 14 riders 7.2 m, 20 riders 10.5 m, 30 riders 13.8 m. 40 riders start in 4 rows and 60 in 5.

### Model notes: terms defined at first use; urge rule marked as the model's own

In "How do the cyclists move?", each term not in common use is now explained in parentheses where it first appears:
- PCR (peloton convergence ratio) and MSO (maximal sustainable output);
- the braid measures: ahead-counts, X, Cx* (with its formula; N is the number of riders) and CxP*;
- d (the drafting coefficient) and the power-equation symbols (CdA, Crr, ρ, m, g, θ);
- Olds' formula (Eq. 5);
- W′ (W-prime, the anaerobic reserve for efforts above MSO);
- "lull", "threshold" (group PCR approaching 0.738) and "relaxed" (group PCR about 0.55 or less);
- the ideal sheltered PCRᵢ;
- the Scratch field (the riders' MSOs from the paper's Scratch-race data);
- N in the compact length.

The "Urge to move up" note now states that this rule is not discussed in the paper and is part of this model's own movement rules.

### Stretch rule embedded; its settings removed

The lab is educational, so the stretch rule is now part of the model rather than a setting. The stretched-phase selector and its sliders were removed: the single-file-line criterion is fixed, a longest line of at least 4 riders and at least 40% of the group (see below). The width rule and the Cx*-only option are gone from the page. The exports still record both the lab's label (`phase`) and the label from the paper's rule alone (`phasePaper`). The road stays a fixed 15 m. The Urge slider stays, since the urge to move up varies with riders' motivation.

### Stretch defined by a single-file line (any track width); shorter urge text

**Stretch rule.** The braid paper defines S operationally by PCR and Cx* alone (Section 2.8: Cx* ≤ 1.693 and PCR ≥ 0.738). Its tables describe it only qualitatively, as a "single-file or elongated formation". The lab's formation test is therefore its own refinement. The previous width test (core width ≤ 20% of the track) fails on narrow tracks, where every group is narrow. The new default:
- **Single-file line:** a chain of riders, front to back, each directly behind the one ahead (within 0.5 m laterally, wheel gap ≤ 3 m) with nobody alongside. Riders swinging off a pull are left out.
- **Stretched:** the group's longest line has at least 4 riders and covers at least 40% of the group. Both values are adjustable with sliders.
- **Narrow roads:** on a road one rider wide every group is one line, and PCR and Cx* then decide between S and the compact phases, as in the paper.
- **Exports:** a new column, `leadLine`, gives the length of the lead group's longest line.
- **Alternatives:** the width rule and the paper's Cx*-only rule remain available.

Results, 16 riders on the 15 m road, 6 seeds, compared with the width rule:
- Unchanged at 32–42 km/h; at 40 km/h, 20% of seconds are Transitional (vs 8%).
- At 45 km/h, S is 42% (vs 71%): the lead group is down to about 6 riders, and its longest line is often only 3.
- On a 1.4 m road at 40 km/h (a clear single file, longest line about 9 of 12 riders), the width rule labels every second Transitional, while the line rule gives S 82%. The model's road cannot currently be narrower than about 4 m, so a true one-lane run is not yet possible.

**Urge slider.** The text under the slider is now one sentence. The formula, the effective rates and the measured moves per minute are in the model notes, under "Urge to move up".

### Phase occupancy as in the paper

The occupancy panel now follows the paper's convention: each named phase's share of non-transitional labelled seconds. Transitional, the paper's residual class for seconds that meet no named phase's full criteria, is no longer a bar. Its share of all labelled seconds is shown in the panel's note instead, e.g. "Transitional (residual class): 5 % of labelled seconds, excluded". Exports are unchanged and still record every second's label, including Transitional.

### Experiments act on the race in progress

Each experiment button used to restart the race, putting the riders back on the starting grid and the clock back to zero, which made the experiments look as if they hadn't triggered mid-race. Now:
- **Find a rhythm, Stretch at threshold, Surge then ease, Climb 2% hill and Random fluctuations** change the pace, grade and urge from the current moment, with whatever field is on the road. They no longer set a rider count or MSO source.
- **Shed the weak** still restarts the race, because it needs its own wide-spread field (16 riders, 210–390 W). The status line says so.
- **The active experiment is highlighted.** The highlight clears when the experiment ends, or when the pace or grade is changed by hand.

### Chasing groups; road width fixed at 15 m

**Chase rule.** Groups separated by a surge used to chase only when within 80 m, with the leader making a hard effort on its own. Groups further back never chased, even when the pace fell to 25–30 km/h. Now:
- **Within 80 m:** the leader still rides hard to bridge, at tail speed + 0.4 × gap (1–3 m/s faster), as far as its power allows.
- **Further back:** the group chases in an organised way at any distance, as long as it has the capacity, i.e. its chase speed is above the speed of the group ahead. The chase speed is the speed its stronger half can hold sharing the front, Pexp(v)·(1 + d(k − 1))/k = their mean MSO, capped at what its weakest member can follow in shelter (d ≈ 0.7, within 95% of MSO).
- **While chasing:** riders take 8–12 s turns and swing off early only below 15% W′. Riders swinging off drift back only 0.6 m/s below the chase speed the leader is aiming for. It is the aimed-for speed, not the leader's actual speed, to avoid the mutual slow-down spiral fixed earlier.

Results, 20 riders, 6 seeds:
- After 60 s at 50 km/h and back to 34 km/h, every run is one group again by 300 s. Before, three of the six never recovered, with gaps growing to 120–150 m.
- Under 15 minutes of random fluctuations: rejoins up from 67 to 145, and time split down from 71% to 65%.
- Steady 40 and 42 km/h are unchanged on the 10 m road (1.28 and 2.10 groups).

**Road width.** The track-width slider was removed; the road is now a fixed 15 m. The stretched rule's threshold becomes 20% × 15 m = 3 m of core width. Results at 15 m, 16 riders, 8 seeds: S 0–1% at 36–38 km/h, 93% at 40 and 100% at 42. Groups are 1.77 at 40 km/h (vs 1.28 at 10 m) and 1.95 at 42, because a relaxed bunch spreads wider on a wider road.

### Tactical waiting limited to the compact-static range

Tactical waiting used to scale with the group's relax factor, which fades only between group PCR 0.55 and 0.74. So a bunch could still lock up at 38 km/h, where riders would normally be mixing. It now has its own strength: full at a group PCR at pace ≤ 0.45, fading to none by 0.55 (about 36 km/h for the Scratch field). At 36–38 km/h the bunch now mixes steadily, with Cx* about 2.4–2.7 (above the 2.099 "high" line); the label is Transitional because PCR sits in the middle band. Cs appears only at 34 km/h and below.

The MSO-source option is now labelled "Random between the current riders' min and max MSO".

### Reintegration: riders off the back of a relaxed bunch get back in

**Problem.** In large pelotons, a bunch strung out by a surge stayed strung out at low speed. Tactical waiting froze whatever shape the bunch was in: the tail sat in a lull with almost no moves, each rider following its wheel. With 30 riders, after 30 s at 42 km/h and back to 32 km/h, the lead group stayed 35–60 m long for the rest of the run and sometimes split. Even at a steady 32 km/h it crept from about 10 m to 20 m.

**Rule.** In a relaxed bunch (group relax factor > 0.3), a rider further behind the group's head than the bunch's compact length (2.2 m × √N) is off the back. Such riders try to get back in, even close to threshold, while the front riders simply hold the pace. A rider off the back:
- moves up regardless of lulls, with an urge that grows with how far back it is (up to 1.5 attempts per second);
- may pass as many riders as it takes to get back within the compact length, using W′ down to 25%;
- closes up in its own lane when there is room, at up to 1.2 m/s above the group's speed;
- keeps drifting sideways during lulls.

**Results.** Lead-group length after the surge (4 seeds):

| | t = 75 s | t = 90 s | t = 120 s | t = 150 s | t = 300 s |
|---|---|---|---|---|---|
| 30 riders, before | 25–44 m | 46–65 m | 11–47 m (splits) | 32–50 m | 27–54 m (splits) |
| 30 riders, after | 26–36 m | 44–52 m | 18–27 m | 14–15 m | 13–17 m |
| 50 riders, after | | 49–66 m | 30–41 m | 20–27 m | 23–28 m |

At a steady 32 km/h, 30 riders now hold 10–15 m (was creeping to 20 m). At 38 km/h a 16-rider bunch stays compact (one group, about 15 m) instead of partly stringing out; 40 and 42 km/h are unchanged.

### Phase-plane window

"Trace the collective state" (PCR × Cx*) has a selector for the last minute (the default), the last 5 minutes, or the whole run. It previously always showed the last 90 s. Dots shrink when there are many, so long runs stay readable.

### Model notes rewritten; the urge slider now only sets the move-up rate

**Model notes.** "How do the cyclists move?" now opens by saying that the browser model is written from scratch but is largely based on the authors' NetLogo model, and lists what follows NetLogo closely and what is this model's own. The rules adjusted in this revision are described as they now stand: power and shelter, cohesion and separation, drafting and gap closing, pulls, moving up, tactical waiting, starting grid and energy. Limits lists the teaching assumptions, and notes that the NetLogo cone and zone sizes come from code comments.

**Urge slider.** It previously did three things: it set the move-up rate, how tightly relaxed riders packed up behind the riders ahead, and how far wheel-seeking was damped in a relaxed bunch. The last two were capped at urge 1. Its effect was therefore not monotonic: at 32 km/h, urge 0.3 gave more moves than 1.2. In addition, the move-up rate constant was so large that every value above about 0.3 meant "immediately, whenever able", and urge 0 still allowed the occasional unprompted move during a lull.

Now the slider sets only the rate at which a rider able to move up starts a move:

0.5 × urge × [(0.25 + 0.6·rank)·capacity + back-third term] × lull factor (per second)

At the default 1.2, a rider at the back with full capacity tries about every 1.2 s once it has room. At 0.3 it tries about every 5 s. At 0, nobody moves up. Packing and wheel-seeking stay at their previous default strength. In 16-rider runs at 32 km/h, moves per rider per minute rise steadily with urge: about 0.6 at 0.3, 0.8 at 1.2 and 1.6 at 3 (with tactical waiting off: 1.6, 3.0 and 3.8). The page explains this under the slider.

### Random pace fluctuations; compact page layout

**Random fluctuations.** A new experiment button drives the pace randomly between 25 and 54 km/h. It continues the current run, and clicking it again stops it; so does moving the pace slider or picking another experiment. The pace slider now goes down to 25 km/h.
- **Holds** shorten with speed: about 70 s at 25–30 km/h, 43 s at 30–35, 27 s at 35–40, 17 s at 40–45, 12 s at 45–50, and 8 s above 50, each ×0.6–1.4.
- **The next change** is usually a deceleration high up: 69% at 45–50 km/h and 82% above 50, against 9–21% below 35 km/h.
- **Accelerations** are sometimes a staircase of 2–4 km/h steps with short holds in between; high up, a staircase often breaks off.
- **Ramps** run at +0.6 km/h per second up and −0.4 km/h per second down. The schedule is seeded from the run's seed.

**Layout.** The page is about 40% shorter: 4,290 px instead of 6,960 at 1440 px wide.
- The large title block is now a one-line header.
- The experiments, metric cards and phase-by-group cards sit in the left column under the road view, beside the conditions panel, instead of below a large empty area.
- The conditions panel stays in view and scrolls on its own.
- Padding and type throughout are tighter.

### MSO source: random within the current riders' range

A new MSO source, **Random within the current riders' range**, draws each rider's MSO uniformly at random between a Min and a Max, fresh on each reset. Choosing it fills Min and Max from the riders currently on the road (215–337 W for the NetLogo Scratch MSOs). Edit them to widen or narrow the range.

### Riders near the back want to move up (if they have any capacity)

**Urge.** The move-up rate now has a position term for the back third: 0.6 × smoothstep(0.55, 0.85, rank), added to the earlier (0.25 + 0.6·rank) × capacity term. The new term does not scale with capacity, so a weak rider near the back with any capacity (a pass limit of at least 1) wants to move up almost as much as a strong one.

**Coming round on W′.** Previously a rider could move up only if riding exposed at 0.8 m/s above the pace was within its MSO. At 34 km/h that ruled out a 215 W rider, even though its capacity (about 0.48) allows passing about 5 riders. Now, in a relaxed bunch (group relax factor > 0.5, the compact phases), a rider with capacity left may also come round on its anaerobic reserve, provided the pass costs less than half its remaining W′:

(P_pass − MSO) × pass limit × 2.2 m / 0.8 m/s < 0.5 W′bal

Near threshold, voluntary passing must still be sustainable on MSO alone, which is what produces the stretched phase.

Results, weakest 4 of 16 riders, 6 seeds:

| Pace | In back third | Moves started per run |
|---|---|---|
| 32 km/h | 35 → 31 % | 27 → 19 |
| 34 km/h | 51 → 30 % | 8 → 23 |
| 36 km/h | 55 → 56 % | 0 → 9 |

40 and 42 km/h are unchanged (40 km/h: 1.09 groups, S 85%). At 38 km/h the bunch is still relaxed enough for W′-funded passing, so it keeps reshuffling: S falls from about 17% to 1%, and the bunch is more compact.

### Single-file-share rule for S removed

The stretched phase (S, Sf) is now identified either by lead-group width (core width ≤ 20% of the track, the default) or by Cx* alone (the paper's Section 2.8 rule). The single-file-share option and its slider were removed: the width rule covers the same situation, and it still counts a narrow line that is reshuffling. Single-file share is still reported as a descriptive measure on the stretch card, the group cards and table, and in the exports.

### Moving up on the outside, angling in gradually

**Before.** A rider moving up chose the side with fewer riders ahead in it, which was often into the bunch. It then held a fixed lane until it had passed its quota or reached the front. At that point it slotted in at up to 1 m/s sideways while matching the slot's speed, which relative to the bunch is a cut almost straight across. Sideways moves during and after a move averaged about 67° to the direction of travel, and riders never angled in while passing.

**Now**
- **Start:** a rider steps out toward the nearer flank. It starts a move only if there is room beside it to step out; failing that, it goes through a gap on the inside. A rider boxed in on both sides waits, instead of starting a move it cannot make. Riders who can start a move do so twice as often as before, so the overall number of moves is about the same.
- **While passing on the outside:** the passing lane drifts toward the middle at up to 0.25 m/s, hugging the riders being passed and staying 0.8 m outside the innermost rider just ahead or alongside. Riders angle toward the front-centre from well back, at about 15° to the direction of travel.
- **Sideways speed caps:** 0.5 m/s when stepping out; 0.45 m/s when tucking in and for 10 s after any manoeuvre. Tucking-in slots are chosen 1.1–2.4 bike lengths ahead, so the rider angles forward into them.
- **Boxed in alongside:** a mover eases off by only 0.15 m/s to slip out behind, and gives up after 3 s.

### Fix: unexpected stretching at low speed; wider starting grid

**Starting grid.** Riders used to start 3 abreast, 1.1 m apart: a block about 2 m wide and 11.5 m long for 16 riders. They now start spread across the whole usable width of the road, in as few rows as that allows, with alternate rows staggered. Sixteen riders on a 10 m road start as two rows of eight. The old block is still available with `grid: 'narrow'`. The grid only affects the first minute or so, after which the bunch settles to the same length either way.

**The real cause of the stretching** was bursts of moving up. During a burst, half the bunch could be "moving up" at once. A mover boxed in by a rider alongside dropped back half a wheel (0.4 m/s below pace, for up to 3 s) to slip out behind, and riders merging sideways eased off by 0.25–0.6 m/s. With several doing this together, the back of the bunch strung out at constant pace. Now:
- A boxed-in mover holds its place, going no faster than the group and not dropping back. If it is still boxed in after 2 s, it gives up the move.
- In a relaxed bunch, a rider merging sideways eases off only slightly (0.1 m/s + 0.5 × pressure).

Results, wide grid, 8 seeds, after the first minute:

| | 30 km/h | 32 km/h | 34 km/h |
|---|---|---|---|
| 16 riders, mean length | 8.0 → 5.4 m | 7.7 → 5.6 m | 9.0 → 8.0 m |
| 16 riders, longest | 14.4 → 9.3 m | 13.0 → 10.6 m | 15.1 → 14.1 m |
| 12 riders, mean length | 6.2 → 4.8 m | 6.2 → 5.3 m | 8.1 → 6.6 m |

At 32 km/h, sideways movement halves (mean |vy| 0.090 → 0.049 m/s), and the locked phase (Cs) rises to 45%. Splits at 38 km/h fall slightly (1.27 → 1.16 groups).

### Fix: slower riders lining up on the centre line and the tail stringing out

**What happened.** The weakest riders cannot come round at easy pace, so they sit at the back; at 34 km/h, riding exposed at 0.8 m/s above the pace needs about 240 W, more than a 215 W MSO. With nobody alongside them, the universal 0.08 m/s centre bias pulled each of them onto the exact centre line, and they filed in one behind the other. NetLogo's ±5° single-wheel draft cone then rewarded sitting exactly in line. As the bunch reshuffled ahead, this tail strung out backwards at constant pace. The weakest quarter sat on the centre line 52% of the time, against 21% before the universal centre bias.

**Changes**
- The centre bias is gentler: 0.02 m/s. That is still universal (except when passing on the outside), and still 4× NetLogo's put-middle-bias.
- A rider never drifts toward the middle into the line directly behind a rider just ahead (within 3 m).
- During a lull (tactical waiting), the lateral drifts pause in proportion to how locked the lead group is. These are cohesion, separation and the centre bias; gaps along the road still close. This also restores the locked (Cs) spells that the NetLogo flocking rules had eroded: quiet time at 32 km/h is 0.33, against 0.13 without this pause and 0.37 before the flocking rules.

Results at 34 km/h, 12 riders, 8 seeds: the weakest quarter sits on the centre line 23% of the time (was 52%). The tail behind the main body averages 3.9 m (was 4.1 m), and it is longer than 5 m 16% of the time (was 20%).

### Riders drawn as overhead cyclists, all the same size

A new **Riders as** control in the road view offers three shapes:
- **Cyclists (overhead)**, the default. Each is drawn to scale from above: wheels and frame as a 1.7 m line, 0.42 m handlebars, arms, a back that narrows from the shoulders to the saddle, and a helmet. The jersey carries the colour mode.
- **Chevrons**, as in the NetLogo view, pointing in the direction of travel.
- **Discs**, the earlier style.

All riders are now the same size by default. **Size by MSO** is still available but off, and hovering a rider shows its MSO.

### NetLogo cohesion, separation and nearest-rider drafting

These rules were checked against the July 8 2026 NetLogo code (`calculate-position`, `calculate-average-pos`, `calculate-separation-factor`, `calculate-draft`) and ported. NetLogo ticks are 1 s and its units are metres, so its per-tick accelerations are used as m/s.

| Rule | NetLogo | This model now |
|---|---|---|
| Cohesion | toward the mean position of other turtles in-cone `cohesion-zone` `in-cone-angle` (20 m, 140°); x-acc += Δx·0.11, y-acc += Δy·0.07 | the same neighbourhood and gains. Across the road it is a direct position adjustment. Along the road the pull is limited to 0.33 m/s per metre of room ahead (to the target and to the wheel in the rider's lane), because here speeding up costs power |
| Separation | only when the cohesion neighbourhood is non-empty: away from turtles in-cone 1.5 240, Σ (me − them)/distance × random-float 0.1 | the same, using the mean factor 0.05 and no random noise |
| Draft (nearest rider) | if more than one turtle is in-cone `draft-zone` 60, Olds d from the nearest of them; otherwise the nearest in-cone `draft-zone` 10; otherwise d = 1 | the same cones and nearest-rider rule (the new default shelter model). Olds' spacing is the wheel gap, because riders here have a bike length; NetLogo's turtles are points |
| `find-nearest-neighbor` | defined but never called (and it uses `turtles`, not `other turtles`, so it would return the rider itself) | not needed |
| Middle bias | `put-middle-bias`, 0.005 m/s, local leader (PCR < 1) and decelerating riders only | 0.08 m/s for every rider except when passing on the outside (as requested) |
| Noise | random-normal 0 0.1 on x and y every tick | omitted (less random lateral movement, as requested) |

To stay inside the 10° single-wheel draft cone, a rider in the wind now steers to within 0.15 m of its wheel's line (was 0.35 m). The earlier lateral-fade shelter rule remains available as an option.

Results over 8 seeds, 16 riders (before → after):

| Pace | Groups | Sheltered | Position changes X |
|---|---|---|---|
| 32 km/h | 1.00 → 1.00 | 38 → 48 % | 2.8 → 3.8 |
| 36 km/h | 1.00 → 1.00 | 62 → 65 % | 2.2 → 3.1 |
| 38 km/h | 1.17 → 1.34 | 66 → 66 % | 2.6 → 3.0 |
| 40 km/h | 1.01 → 1.07 | 87 → 83 % | 0.7 → 0.7 |
| 42 km/h | 1.65 → 2.40 | 84 → 81 % | 1.0 → 1.0 |

### One centre bias for everyone (except when passing on the outside)

There used to be three separate centring rules:
- a road-centre nudge of 0.05 m/s, applied only to the leader, the first four positions (at double rate), riders moving up, merging or easing back;
- a drift of 0.15 m/s for up to 10 s after a manoeuvre;
- a cohesion drift of 0.08 m/s toward the group's middle.

They are now one rule. **Every rider gravitates toward the middle of the road (`CENTRE_NUDGE`, now 0.02 m/s; see the fix above)**, in every position: at the front, inside the bunch, at the back, in a trailing group, or dropped. The rule starts as soon as a manoeuvre ends.

The exceptions are riders passing on the outside (moving up or bridging) and riders swinging off after a pull. The rule adjusts position directly, as in NetLogo's put-middle-bias, and also shifts the position the rider holds. It acts only where there is room, so a rider never steps into someone alongside.

Over 8 seeds and 16 riders, the results are essentially unchanged from before. Groups by pace: 32 km/h 1.00, 36 1.00, 38 1.17, 40 1.01, 42 1.65. Shelter and lateral spread are as in the table below. The lateral spread at easy pace is held by the riders alongside, not by the rule.

### Everyone wants to draft: firmer gap closing, tighter clustering, less lateral drift

**Gap closing**
- A rider now counts as losing a wheel when a gap of more than 2 m keeps opening for 1 s, down from 3 m for 1.5 s.
- Riders behind react as soon as they see a gap of more than 2 m opening in front of their wheel. If they can afford it, they come round and close it, using up to 90% of W′ (up from 70%).
- The leader of a trailing group chases harder: the gap's tail speed + 0.4 × gap, clamped to 1.0–3.0 m/s (was 0.25 × gap, clamped to 0.5–2.5 m/s).

**Clustering**
- A rider in the wind steers to within 0.35 m of its wheel's line: staggered, but still well sheltered.
- Cohesion: riders in the bunch drift toward its middle at 0.08 m/s whenever there is room beside them. Riders left out on a flank after moving up therefore close back in.
- The compact spread is now 0.25·√N + 0.3 m each side (was 0.4·√N + 0.3 m).
- When relaxed, riders don't follow a rider who is moving up the flank.

**Lateral movement**
- A rider who already has shelter (d < 0.85) holds its line and doesn't move sideways without a reason.
- The first few positions are centred by a gradual position nudge. Previously their target lane jumped whenever their rank changed.

Results over 8 seeds, 16 riders, 4 min, before → after. "Lateral speed" is the mean |vy| of riders who are just riding in the bunch; "spread" is the sd of their lateral positions.

| Pace | Groups | Sheltered (d < 0.85) | Lateral speed (m/s) | Spread (m) |
|---|---|---|---|---|
| 32 km/h | 1.00 → 1.00 | 39 → 40 % | 0.026 → 0.022 | 1.97 → 1.77 |
| 36 km/h | 1.00 → 1.03 | 57 → 65 % | 0.007 → 0.007 | 1.21 → 0.65 |
| 38 km/h | 1.07 → 1.18 | 64 → 68 % | 0.011 → 0.007 | 0.83 → 0.39 |
| 40 km/h | 1.54 → 1.01 | 77 → 86 % | 0.008 → 0.008 | 0.41 → 0.18 |
| 42 km/h | 1.73 → 1.52 | 84 → 84 % | 0.006 → 0.007 | 0.06 → 0.06 |

At 40 km/h the group now almost always stays together, because gaps are closed before they become splits. At 38 km/h the bunch lines out on wheels earlier, and the weakest rider (215 W, PCR ≈ 0.75) occasionally still takes a few riders with him. At easy pace the shelter share stays near 40%: a compact bunch of 16 rides in short, wide rows, and riders moving up the flanks are exposed by design.

### Tactical waiting (positions lock at easy pace)

At easy paces a bunch often holds its order until someone makes a move. The new **Tactical waiting** checkbox (on by default; `cond.lull`) models this:

- The lead group carries an *activity* level that decays with a time constant of about 10 s.
- Move-ups and easing back are scaled by activity, weighted by how relaxed the group is (relax = 1 − smoothstep(0.55, 0.738, group PCR at pace)). In a relaxed, quiet bunch almost nobody moves.
- About once every 40 s a rider with spare capacity (capacity > 0.3) makes an unprompted move. This lifts activity sharply and sets off a burst of follow-on moves. Ordinary moves add very little, so each burst dies away instead of feeding itself.
- Pulls on the front last up to three times longer while the bunch is quiet, because nobody wants to come through.
- Near threshold, relax goes to 0 and the rule has no effect. Behaviour there is unchanged.

Results over 16 riders, 6 seeds and 4 min, comparing the rule off and on (quiet means X ≤ 1):

| Pace | Quiet share | Longest quiet spell | Phase split |
|---|---|---|---|
| 30 km/h | 9 % → 37 % | 6 s → 45 s | Ccl 78 / Cs 9 → Ccl 42 / Cs 37 |
| 34 km/h | 13 % → 47 % | 9 s → 58 s | Ccl 69 / Cs 13 → Ccl 31 / Cs 47 |
| 42 km/h | unchanged | | S 100 % |

The braid trace now alternates between locked (Cs) spells and reshuffling (Ccl) bursts. CSV exports include `lull` and `activity`.

## Typical behaviour (16 riders drawn from the Scratch pool, seeds 1–3, 0 % grade)
| Pace | Groups | Lead width | Single file | Riders unable to pass | Position changes / s | Most common phase |
| --- | --- | --- | --- | --- | --- | --- |
| 34 km/h | 1 | ~5.9 m | ~45 % | ~2 | ~4.9 | Ccl, then Cs |
| 38 km/h | 1 | ~4.5 m | ~60 % | ~10 | ~2.1 | Transitional, then Sf |
| 42 km/h | 1.4–2.7 on average; lead group 10–11 of 16 | ~2.1 m | ~98 % | ~9 | ~3.6–6.6 (splits add turnover) | S in 1 of 3 seeds; Da/Dd/Transitional where splits occurred |

## Scope and limitations
This is an original teaching model, not a port of the authors' NetLogo code. The 0.8 m/s passing margin, lateral shelter fade, W′ capacity (60 J per W of MSO), pull rules, wheel-choice costs and group-gap thresholds are illustrative assumptions. No wind, cornering or team tactics. The phase thresholds were calibrated on a 12-rider empirical race, so labels for very different rider counts or settings should be read with care (the paper notes residual size effects at N = 50 and 100). Data are synthetic and stay in the browser until exported.

## Embedding
Host the four `dist` files together and embed `index.html` in an iframe, for example:

```html
<iframe src="/peloton/index.html" title="Interactive peloton phase lab"
        style="width:100%;height:1400px;border:0" loading="lazy"></iframe>
```

Source paper: https://sportrxiv.org/index.php/server/preprint/view/1164/version/1439

### Shelter-model selector removed; experiment buttons toggle; climb at 38 km/h
- The "Shelter model" options are gone. Drafting always uses the NetLogo cones (Olds' d from the nearest rider in a 60° cone if more than one rider is there, otherwise 10°). The older wheel-spacing and fixed-d rules remain in `model.js` (`cond.draft`) but are no longer offered in the page.
- "Paper's 2 % grade" is now "Climb 2% hill", at 38 km/h. It is a toggle and can run alongside Random fluctuations. Stretch at threshold, Surge then ease and Random fluctuations also stop on a second click.
- Headline: "One group, shifting dynamics through speed". The Playback selector sits beneath the track on the right.
- The "Anaerobic reserve (W′)" checkbox is removed; W′ is always on. Without it, a 16-rider field at 38 km/h (group PCR 0.60) split into about 4 groups with 8 riders behind (5 min, 4 seeds), against 1.1 groups with W′. W′ is the model's own rule, not part of the paper's analysis. The rider table's column now reads "MSO (watts)".
- Every experiment button is now a toggle. A second click on the lit button restores the settings from before the first experiment (pace, urge, field of riders and, where the experiment changed the road, the grade and climb); Shed the weak restarts the race with the earlier field. Moving the pace or grade slider, changing the field, or pressing Reset clears that memory.
- Capacity ladder removed to simplify the page. The braid and phase plane sit side by side, with Stretch and splits full width beneath. The longer headline now wraps on phones instead of running off the screen.
- ΔPCR explained: a plain-language paragraph in the model notes (what it is, why the paper needs it for Da/Dd and Sf, the 5 s smoothing and ε), and the ΔPCR card says what the number means (positive: effort rising; negative: easing). A "Random seed" paragraph explains that the seed is not a starting position.
- "Selected pace" is now "Default pace" in the PCR card, the PCR basis control and the notes.

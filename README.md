# Peloton Phase Lab

An agent-based browser model of peloton phases. Each rider tries to draft, stay in contact and move up when it can, within its own maximal sustainable power output (MSO). As the pace or road gradient changes, the group moves through compact, mixing, stretched and fragmented phases. The model tracks these with the peloton convergence ratio (PCR) and braid-based positional complexity (Cx\*).

- **Author:** Hugh Trenchard, independent researcher, Victoria, BC
- **Version:** 1.0 (November 2026)
- **Licence:** GNU General Public License, version 3 or later (see `LICENSE`)
- **Run it in your browser:** https://hugh-trenchard.github.io/peloton-phase-lab/

## How to run

Use the link above, or run it from your own copy:

1. Download the repository (Code → Download ZIP) and unzip it.
2. Open `index.html` in any modern web browser (Chrome, Firefox, Edge or Safari).

No installation, server, build step or internet connection is needed. Keep `index.html`, `model.js`, `app.js` and `style.css` together.

## Files

| File | Contents |
|---|---|
| `index.html` | The page: controls, explanations and model notes |
| `model.js` | The simulation and all calculations (commented) |
| `app.js` | Animation, charts, controls, tables and CSV exports |
| `style.css` | Page styling |
| `tests/model.test.js` | 20 numerical and behavioural checks. Run with Node.js: `node tests/model.test.js` |
| `documentation/Peloton_Phase_Lab_ODD.pdf` | Full model description in the ODD protocol (also as `.md`) |
| `documentation/CHANGELOG.md` | Development history |
| `LICENSE` | GNU GPL version 3 |

## What you can do

- Set the number of riders (6–100), the pace, the road gradient (−2 % to 8 %), the drafting coefficient and the riders' urge to move up.
- Choose the riders' MSOs: the 12 Scratch-race riders from the paper, a rider category, an even spread or a custom list.
- Run experiments: find a rhythm, stretch at threshold, shed the weak, surge then ease, climb a 2 % hill, or random pace fluctuations.
- Watch PCR, Cx\*, CxP\*, the phase label, the braid diagram, a trace of PCR against Cx\*, stretch and splits over time, and per-group and per-rider tables.
- Export group history, rider data and group observations as CSV files. Each export records the run's random seed, so a run can be reproduced.

## Relation to the NetLogo model and the paper

This model is largely based on the author's NetLogo model of peloton dynamics. It follows that model closely for the PCR, the braid-complexity measures, the power parameters, Olds drafting with the NetLogo draft cones, and the cohesion and separation rules. The rules for pulling, moving up, passing, gap closing, chasing, rejoining and tactical waiting are this model's own. Details are in the ODD document.

The measures and phase rules come from:

Trenchard, H., Recchia, D. R., & Perc, M. (2026). Braid complexity and peloton phase dynamics. SportRxiv preprint (under review). https://sportrxiv.org/index.php/server/preprint/view/1164/version/1439

## AI assistance

This JavaScript implementation was written with the assistance of Claude (Anthropic), based on the author's NetLogo model, and was directed, tested and reviewed by the author.

## How to cite

Trenchard, H. (2026). Peloton Phase Lab (Version 1.0) [Computer software]. https://github.com/Hugh-Trenchard/peloton-phase-lab

Add a DOI here if you archive a release (for example on CoMSES Net or Zenodo).

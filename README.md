# VelocityBench v1 (static web)

Local double-clickable port of the WinForms VelocityBench (formerly ForceMetric) vehicle performance simulator.

## Open

Double-click `index.html` (or open it in any modern browser).  
**No server, no Python, no install.** All assets are local.

## Features

- Vehicle inputs: HP, weight, Cd, frontal area, drivetrain loss
- Tire types: Street / Drag Tire / Slick / Perfect Traction (index 3 → Slick physics)
- Modes: Naturally Aspirated, Forced Induction, AWD, EV
- Weather presets + Density Altitude calculator
- **Test** runs an exact JS port of `PerformanceCalc.cs` (CalibrationFactor 0.81, dt=0.01, 1-mile loop)
- **Drag Racing** (`race.html`): dual-lane head-to-head using the same physics; arcade playback to 1/4 mile with live lead, dual charts, and ET/trap cards
- Results panel matching `MainForm.RenderResult`
- Speed gauge (canvas), speed-vs-time chart (Chart.js), distance progress
- Play / Pause / Replay playback timed to real elapsed seconds
- Garage modal: search + load from baked `garage.json` (313 cars). Add/Edit are temporary in the browser session; refresh restores site defaults; no delete; suitable for static hosting.

## Files

| Path | Role |
|------|------|
| `index.html` | UI shell (Test + Drag Racing entry) |
| `race.html` | Drag Racing setup + race view |
| `css/race.css` | Motorsport race UI |
| `js/race.js` | Dual-lane race wiring + playback |
| `css/styles.css` | Dark tool theme |
| `js/physics.js` | `window.ForceMetricPhysics.calculate(...)` |
| `js/gauge.js` | Canvas gauge |
| `js/app.js` | Wiring + garage + playback |
| `js/chart.umd.min.js` | Vendored Chart.js |
| `js/garage-data.js` | `window.GARAGE_DATA` |
| `(removed — garage baked into js/garage-data.js only)` | Source garage copy |
| `VERIFY.txt` | Physics sanity check |
| `VERIFY_RACE.txt` | Sample Mustang vs Camaro ZL1 race |

## Disclaimer

Simulation estimates for comparison only — not dyno or track certified.

## Drivetrain (FWD / RWD / AWD)
Factory `DriveType` is baked into garage data (see `DATA_DRIVETRAIN.txt`). Load Vehicle sets the segmented control; users can override. Physics uses `driveType` for traction compensation (RWD baseline, FWD ×0.92, AWD existing boost).

## Active vehicle label
`#activeVehicleLabel` above the gauge shows make/model/year from the loaded Name (or full Name if year missing). Default: Custom setup.

## Drag Racing
Open via the cyan **Drag Racing** button under Test on `index.html` (or open `race.html` directly).
The active vehicle tune is stashed in `sessionStorage` (`forcemetric-race-vehicle`) before navigate.
On the race page: retune **Your car** and pick an **Opponent** from the baked garage, set shared weather, then **LAUNCH**.
Playback uses `ForceMetricPhysics.calculate` twice; winner is first to 1320 ft (lower 1/4-mile ET). Session-only — does not alter the Test page or persist garage edits.

## Domain (Merovingian)

Point **`https://velocitybench.com/`** at **this tool** (forcemetric-web GitHub Pages root):

| Item | Value |
|------|--------|
| Pages site | `https://01ls1z28-coder.github.io/forcemetric-web/` |
| Pages source | branch `main`, folder `/` (serves `index.html` at site root) |
| Custom domain | `velocitybench.com` + `www.velocitybench.com` |

**Today:** the apex CNAME is still on `guerra-tools-hub` (the tools hub). To make VelocityBench the domain root:

1. Remove `velocitybench.com` / `www` from **guerra-tools-hub** Pages custom domain.
2. Add the same custom domain on **forcemetric-web** Pages (this repo).
3. Keep the hub published at `https://01ls1z28-coder.github.io/guerra-tools-hub/` — the tool footer **More tools** link targets that URL so it keeps working after the cutover (once the hub CNAME is cleared, `/guerra-tools-hub/` no longer redirects to the apex).

Optional: update hub cards so VelocityBench opens `/` (or `https://velocitybench.com/`) after DNS moves.


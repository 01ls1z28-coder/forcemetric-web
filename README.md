# VelocityBench (forcemetric-web)

Static GitHub Pages site for **velocitybench.com** (CNAME in this repo only).

## URL map

| Path | What |
|------|------|
| `/` | **Tool Hub** — brass/dark front door (cards to all live tools) |
| `/bench/` | VelocityBench quarter-mile calculator |
| `/bench/race.html` | Race compare |
| `/bench/admin.html` | Garage admin (obscurity gate) |
| `/race.html` | Redirect stub → `/bench/race.html` |
| `/admin.html` | Redirect stub → `/bench/admin.html` |

Peer tools (separate Pages apps — not nested under this domain):

- PowerCurve: https://01ls1z28-coder.github.io/velocitybench-powercurve/
- SDC: https://01ls1z28-coder.github.io/sound-distance-calculator/
- GSPS: https://01ls1z28-coder.github.io/gunshot-sound-propagation/

## Redirects

GitHub Pages cannot emit HTTP 301. Root `race.html` / `admin.html` are **meta refresh + `location.replace` + canonical** stubs so old bookmarks land under `/bench/`. Old calculator bookmarks to `/` now open the Hub (intentional).

## Shared chrome

`css/vb-chrome.css` (+ copy under `bench/css/`) — Hub link + tool switcher on Hub and Bench pages. Absolute URLs only.

## Holds

Static Pages only · no server/DB/secrets/tracking · disclaimers stay · Family Brass theme · **do not move CNAME**.

## Author

Commits as Sati via env (`GIT_AUTHOR_*` / `GIT_COMMITTER_*`) — never `git config`.

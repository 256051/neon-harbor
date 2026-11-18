# neon-harbor

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/256051/neon-harbor/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/256051/neon-harbor/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Neon Harbor — an original open-world crime game in the browser. You are Mara Voss, a fixer
in a dusk-lit harbor city, working for Del. Steal a car, run a package across town, then
lose a three-star heat and reach the hideout. The city is a full grid of streets and
blocks with traffic, pedestrians, traffic lights, police who chase and ram, and a wanted
system that decays when you break away and hide. All art is built in code (three.js) and
all sound is synthesised with Web Audio; nothing is fetched from the network.

## How to play

- Move / drive: W A S D. Shift: sprint. Drag the mouse to orbit the camera, wheel to zoom.
- E: steal a car (walk up to a traffic or parked car and press E) / exit a car.
- F: punch. Click: shoot the pistol. P or Esc: pause. M: mute.
- Stealing a car, smashing into traffic or hitting a pedestrian raises your wanted level;
  police cars spawn and chase you. Break away and stay out of sight and the stars decay.
- Missions (follow the beacon and the minimap diamond):
  1. **First Wheels** — steal a car and drive to the Docks. +$300.
  2. **Night Run** — pick up the package at the warehouse and deliver it to the Marina
     within 100 seconds. Two thugs guard the pickup. +$500.
  3. **Heat** — you are at 3 stars. Lose the heat, then reach the Hideout. +$800.
- Cash pickups are scattered around the city (+$50 each). Your best cash is kept in this
  browser. Dying costs $200 and clears the wanted level; progress is saved with
  localStorage (cash, position, mission progress, wanted level).

## Run it

```sh
node serve.ts
```

Then open http://localhost:8901 — or open `game/index.html` directly in a desktop
browser. No build step and no network request.

## Layout

- `main.ts` — the entry program: copies `game/` and `screenshots/` to `/output` and
  writes `/output/dossier.json` with the kit's `buildDossier`.
- `game/index.html` — the page: HUD, minimap, title/pause/game-over overlays, import map
  for the vendored three.js.
- `game/src/config.js` — the city, feel table, AI parameter tables, missions, palette.
- `game/src/world.js` — the pure simulation: city, traffic, pedestrians, police, wanted,
  missions, combat, pickups, collisions, save/load.
- `game/src/render.js` — three.js rendering: merged buildings and streetlights,
  instanced wheels and lights, quality tiers.
- `game/src/hud.js` — HUD, 2D minimap, compass strip, radio typewriter, hitmarkers,
  kill feed.
- `game/src/sound.js` — synthesised Web Audio: engine, sirens, crashes, jingles, a
  generative music loop.
- `game/src/input.js` — keyboard, mouse orbit, wheel zoom.
- `game/src/main.js` — boot flow, fixed-step loop, auto-quality, save/load/restart.
- `game/src/shots.js` — the scripted autopilot that takes the screenshots by playing
  the real game (no staging).
- `game/lib/three.module.min.js` — vendored three.js r160.
- `screenshots/` — four screenshots of the game itself: title, driving, a wanted chase,
  a mission moment.
- `vendor/makefun-game.ts` — the kit's dossier library, copied unchanged.

---

<sub>Entered on [make.fun](https://make.fun/?ref=99f6h40a&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>

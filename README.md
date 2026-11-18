# Neon Harbor — Make GTA 6 (gta6-01) entry

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/256051/neon-harbor/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/256051/neon-harbor/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**Neon Harbor** is an original open-world crime game in the browser: Mara Voss, new in a dusk-lit harbor city, needs wheels, money and a way out. Steal a car, outrun the police, run three missions for Del — and try not to get flatlined.

## Play it

```sh
node serve.ts
# open http://localhost:8901
```

No build step, no network: the game is static files (JavaScript + three.js + HTML5) and runs from any static server. Desktop Chrome is the target; keyboard and mouse required.

| Key | Action |
| --- | --- |
| W A S D / arrows | Walk / drive (Shift to sprint) |
| E | Steal a car / get out |
| F | Punch |
| Click | Shoot (hitscan pistol) |
| Mouse drag | Orbit camera, wheel zooms |
| P / Esc | Pause |
| M | Mute |
| C (title screen) | Continue a saved game |

## The game

- **A city to drive**: a 9×9 street grid, 128 buildings, traffic with working traffic lights, pedestrians, streetlights, a low sun and a neon dusk sky. All art is generated in code; all sound is synthesised Web Audio — no audio or image files ship with the game.
- **Wanted system**: crime raises your wanted level; the level is a token budget — stars hand out chase tokens, and a police car without a token only patrols instead of joining the chase. Break line of sight and stay quiet and the heat decays.
- **Three missions**: *First Wheels* (steal a car, reach the Docks), *Night Run* (a timed package delivery with thugs waiting at the warehouse), *Heat* (lose a 3-star wanted level, then reach the Hideout). Finish all three and the harbor is yours.
- **Combat**: punch and a hitscan pistol; thugs telegraph their punches, pedestrians flee a fast car or a gunshot.
- **Save**: progress autosaves every 10 s to localStorage; best cash is kept.
- **Quality tiers**: high / medium / low with auto-degradation when the frame time slips; `?q=low` forces a tier, `?seed=N` picks a city, `?bench` shows live frame stats.

## Run it (for the grader)

```sh
node main.ts            # copies game/ + screenshots/ to /output, writes dossier.json
```

## Files

| Path | What it is |
| --- | --- |
| `main.ts` | Entry program: copies the game and screenshots to /output, writes the dossier |
| `serve.ts` | Tiny static server for local play (`node serve.ts`, port 8901) |
| `game/index.html` | The page; import map points `three` at the vendored build |
| `game/src/main.js` | Game entry: the loop, state transitions, sound and beacon wiring |
| `game/src/world.js` | The simulation: city, cars, traffic, police, peds, thugs, missions, wanted |
| `game/src/render.js` | Three.js renderer: merged static city, cars, people, camera, quality tiers |
| `game/src/hud.js` | Canvas 2D HUD: minimap, compass, health, cash, wanted stars, screens |
| `game/src/shots.js` | The screenshot autopilot: genuinely plays each scene |
| `game/src/config.js` | Every tuning number and colour in one place |
| `game/src/merge.js` | Geometry merging (written for this game; replaces BufferGeometryUtils) |
| `game/src/materials.js` | Cached material factory |
| `game/src/input.js` | Keyboard and mouse input |
| `game/src/sound.js` | Synthesised Web Audio: effects and a generative music loop |
| `game/src/random.js` | Seeded RNG (mulberry32) |
| `game/lib/three.module.min.js` | three.js r160 (vendored library build) |
| `vendor/makefun-game.ts` | make.fun kit library, unchanged |
| `shots.json` | The four screenshot scenes |
| `screenshots/` | Real renders of the game's own code |

## Originality

Neon Harbor is original work: its own city, characters, story and code. It does not copy any commercial game, its assets, or its wording — the death screen says FLATLINED, and car theft is described as vehicle theft in progress.

---

Built by an AI agent for make.fun's "Make GTA 6" bounty.
[make.fun](https://make.fun/r/99f6h40a) · [Bounty](https://make.fun/bounty/gta6-01)

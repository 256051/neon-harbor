# Neon Harbor — dossier

An original open-world crime game for make.fun's gta6-01 bounty ("Make GTA 6").
JavaScript + three.js + HTML5, plain static files under `game/`, desktop Chrome,
keyboard + mouse, no network requests at runtime. Nothing in it comes from Rockstar
Games or any other commercial game: the city, the characters, the vehicles, the names,
the story, the art and the sound are all original.

## The game

You are Mara Voss, a fixer working for Del in a dusk-lit harbor city. The city is a
9×9 grid of streets (42 m pitch) with 128 buildings, streetlights, traffic lights at
four intersections, 14 traffic cars, 8 parked cars and 26 pedestrians. You start on
foot with $150 at the south plaza.

- **Explore on foot and by car.** Third-person camera, drag to orbit, wheel to zoom.
  Camera-relative movement; the camera auto-aligns behind you only while you move
  forward, so strafing never spins the frame.
- **Traffic and pedestrians.** Traffic cars drive street lanes, turn at intersections
  and stop at red lights. Pedestrians walk the sidewalks and flee fast cars and
  gunshots.
- **Car theft.** Walk up to a traffic or parked car and press E. The driver gets out
  (for a traffic car) and the car is yours. Stealing raises your wanted level by one
  star.
- **Wanted level and police.** Crimes raise stars: steal +1, smashing into traffic +1
  (only when a police car is near enough to witness it), hitting a pedestrian +1.
  Police cars spawn up to the star count — the first three chase and ram you, extras
  patrol the perimeter. Police lose sight past 30 m for 3 s, then search your last
  known position. Stay out of sight and more than 35 m from the nearest police car
  for 15 s and the stars decay one per 6 s.
- **Missions and story.** Three missions with on-screen objectives, a beacon and a
  minimap diamond, radio typewriter briefings, success/fail banners:
  1. **First Wheels** — steal a car and drive to the Docks. +$300.
  2. **Night Run** — pick up a package at the warehouse and deliver it to the Marina
     within 100 seconds; two thugs guard the pickup (100 hp, telegraphed punches,
     +$25 each on defeat). +$500. Failing the timer restarts the mission.
  3. **Heat** — you start at 3 stars. Lose the heat, then reach the Hideout. +$800.
  Finishing all three completes the story and opens free roam.
- **Combat.** F punches (34 damage, 2.4 m range); click fires a hitscan pistol
  (50 damage, 32 m, weaker past 20 m). Hitmarkers show hit / weak / kill, kills are
  announced in the feed. Player health 100, regenerates after 10 s without damage.
  Death shows WASTED and respawns you at the clinic, −$200, wanted cleared, the
  current mission restarted (mission 3 re-applies its 3 stars, so dying cannot skip
  the evade).
- **HUD with minimap.** Canvas 2D minimap (streets, player arrow, traffic, flashing
  police, mission diamond), a compass strip sharing the same world→screen projection,
  speed, wanted stars, cash, health and car-health bars, mission objective, clock,
  radio messages, hitmarkers and a kill feed.
- **Start screen, pause, mute, restart, save.** Title screen with a quality selector,
  P/Esc pauses, M mutes, and save/load via localStorage (cash, position, mission
  progress, wanted level; tolerant parse with clamping). Best cash is kept.
- **Sound.** All synthesised Web Audio — engine hum, two-tone sirens, crash, pickup
  and mission jingles, plus a generative 16-step music loop. No audio files.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move / drive (camera-relative) |
| Shift | Sprint |
| Mouse drag | Orbit camera |
| Mouse wheel | Zoom (6–16 m) |
| E | Steal / exit car |
| F | Punch |
| Click | Shoot pistol |
| P / Esc | Pause |
| M | Mute |
| R | Restart (on the WASTED screen) |

## How to run

```sh
node serve.ts          # serves on http://localhost:8901
```

Open http://localhost:8901 in desktop Chrome, or open `game/index.html` directly.
No build step, no network request.

Dev switches (URL parameters): `?seed=` fixes the city layout and traffic,
`?shot=start|drive|wanted|mission` runs the scripted autopilot and takes a
screenshot when it succeeds, `?bench` runs a no-audio auto-start benchmark with a
live stats overlay, `?cam=yaw,pitch,dist` sets the camera, `?q=low|medium|high|ultra`
sets the quality tier, `?noaudio` disables sound, `?autostart` skips the title screen,
`?dt=` scales the simulation step.

## How to test

- `node tools/shots.mjs` (in `../gta6-01/tools/`) — Playwright headless Chromium at
  1280×720: takes the four screenshots via the real autopilot, and fails on any
  console error, page error, failed request or non-local request, or any unsuccessful
  shot. Current result: 4/4 shots pass, zero errors.
- `node tools/playtest.mjs` — a 22-check live keyboard playtest (title → start → walk
  → steal → drive → wanted → police → punch/shoot → pause → mute → save/reload/
  continue → death/respawn → restart). Current result: 22 passed, 0 failed, zero
  errors.
- `node tools/story-test.mjs` — the mission autopilot playing the whole three-mission
  story in node on six seeds. Current result: 3/6 seeds complete the story (seeds 3,
  7, 42); the others stall in mission 2 or the mission-3 evade, mostly by the pilot
  wrecking cars and dying under 5-star heat — the autopilot is a worse driver than a
  person, and small tuning changes swing its trajectories chaotically, so the
  full-story rate is reported as measured rather than tuned to look better.
- `node cli/makefun.mjs check --repo <repo>` from inside the kit — the kit's gate
  check. `transcripts_present` is expected to fail at this stage (transcripts come
  from the sealed session recording, handled by the parent at submission time).

## Techniques applied (from the distillation of a reference game)

Merged static geometry by material (buildings 4 draw calls, merged streetlights,
instanced wheels/lights); cached material factory with precompile; seeded RNG with
`?seed=` and a `?bench` mode with `window.__stats/__ready` hooks and a 0.05 s dt
clamp; config-table AI (police/traffic/pedestrian/thug tables, wanted stars as a
police token budget, thug state machine with a 0.55 s telegraph before a punch);
compass strip and minimap sharing one projection; radio typewriter briefings with a
queue; fully synthesised audio with buses, concurrency gates and a generative music
stepper (sirens are two alternating sine sweeps); quality tiers with auto-quality and
tolerant settings storage; a feel table for driving and camera numbers; hit feedback
(hitmarker hit/weak/kill + kill feed + wanted upgrades on the same feed); a staged
boot flow with progress text and per-module try/catch isolation in the main loop.

New designs (the reference had none of these): arcade car physics, the wanted token
system with decay and last-known-position search, the Canvas 2D minimap, localStorage
save with tolerant parse and clamping, and traffic AI on the street grid with traffic
lights and fleeing pedestrians.

## Known flaws (honest)

- Headless SwiftShader renders at ~2 fps at 1280×720; real hardware is far faster,
  but the game is heavy for software rendering.
- The minimap redraws fully every frame rather than only its changed parts.
- The full-story autopilot completes on 3/6 seeds; the mission-3 evade under 5-star
  heat is the weak point, and the pilot dies and re-steals cars repeatedly there.
- The wanted shot sometimes escalates to 4–5 stars (the pilot rams traffic while
  chasing the shot's conditions).
- The player's car reads dark from directly behind despite its taillights.
- No interior locations; the city is streets, blocks and facades.
- The music is a minimal 16-step bass + lead loop.

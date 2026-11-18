# Neon Harbor — Dossier

## What it is

An original open-world crime game in the browser (JavaScript + three.js + HTML5, static files, no network). Mara Voss arrives in a dusk harbor city and needs wheels, money and a way out: steal a car, outrun the police, run three missions for Del.

## How it plays

- **Explore and drive**: 9×9 street grid, 128 buildings, traffic with working traffic lights, pedestrians, streetlights, a low sun over the harbor. Third-person camera, mouse orbit, wheel zoom.
- **Wanted system**: crime raises the wanted level; stars are a token budget for police chasers (at most 3 chase at once). Break line of sight and stay quiet and the heat decays one star at a time.
- **Missions**: First Wheels — steal any car and reach the Docks ($300). Night Run — pick up a package at the warehouse (thugs are waiting) and deliver it to the Marina in 100 seconds ($500). Heat — lose a 3-star wanted level, then reach the Hideout ($800). Finish all three to win.
- **Combat**: punch (F) and a hitscan pistol (click). Thugs telegraph punches with a windup; pedestrians flee a fast car or a gunshot.
- **Save**: autosaves every 10 s to localStorage; best cash is kept. Pause (P), mute (M), restart from the death or win screens.
- **Feel**: a single feel table (steering, drift, camera alignment, zoom) tunes the handling; quality tiers (high/medium/low) with auto-degradation; `?seed=` picks a city, `?bench` shows live frame stats, `?shot=` plays a screenshot scene with a genuine autopilot.

## Technical notes

- The simulation (`game/src/world.js`) is pure logic — no three.js, no DOM — so it can be stepped headlessly; the screenshot scenes are played by a real autopilot using the same step function as the player.
- Static geometry is merged by material (buildings by facade variant, roads, sidewalks, streetlights), so the city draws in a handful of calls; the merge helper (`game/src/merge.js`) was written for this game and remaps each box's six faces to wall / top / roof materials.
- All art is generated in code (canvas textures for facades and ground); all sound is synthesised Web Audio (effects plus a generative music loop). No audio or image files ship with the game.
- Deterministic: the same seed builds the same city; the entry program's output is byte-identical across runs.

## Screenshots

1. **1-start.jpg** — title screen over the city at dusk.
2. **2-drive.jpg** — driving at speed, minimap and mission HUD live.
3. **3-wanted.jpg** — 1 wanted star, a police cruiser closing in 26 m ahead, just appearing around the building corner at the frame's left edge (HP 100).
4. **4-mission.jpg** — First Wheels complete, $300 (cash $450), Night Run briefing up, driving on from the Docks.

## Controls

WASD / arrows walk and drive (Shift sprints) · E steals a car or gets out · F punches · Click shoots · Mouse drag orbits, wheel zooms · P pauses · M mutes · C continues a saved game from the title screen.

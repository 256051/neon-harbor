# Neon Harbor — dossier

## What it is

Neon Harbor is an original open-world crime game (JavaScript + three.js +
HTML5, static files only). The player is Mara Voss, a fixer in a fictional
dusk-lit harbour city: a 9×9 street grid with 128 buildings, a harbour and
docks on the east side, traffic, pedestrians, car theft, a 0–5 star wanted
system with police chases, and a three-mission story told by radio briefings
from a contact named Del.

## Missions

1. **First Wheels** — steal a car and drive to the Docks. Pays $300.
2. **Night Run** — pick up a package at the warehouse, deliver it to the drop
   point. Pays $500.
3. **Heat** — evade a five-star police chase and reach the safehouse. Pays
   $800. Finishing all three shows the completion screen with total money.

## Controls

WASD / arrow keys — drive and walk. E — steal a car / get out. Mouse — aim
and orbit the camera. Click — shoot the pistol. F — punch. P / Esc — pause.
M — mute. Space or click — start / restart.

## How to run

```sh
node serve.ts
# open http://localhost:8901/game/index.html in desktop Chrome
```

`?seed=` builds a deterministic city from a seed. `?bench` shows live
performance stats and lets auto-quality drop the tier when the frame rate is
low. `?shot=start|drive|wanted|mission` runs a scripted pilot that plays the
game headlessly to produce the screenshots.

## Tech notes

- three.js r160 vendored under `game/lib/`; the game loads nothing over the
  network — every script, image, sound and font is a local file or a data URI.
- Static geometry (buildings, roads, lamps, docks) is merged into a few draw
  calls by the hand-written helper in `game/src/merge.js`.
- All audio is synthesised in Web Audio: engine hum, sirens, gunshots,
  punches, UI clicks and a minimal generative music loop.
- Save/load through localStorage (best money and progress).
- The entry program `main.ts` (Node, standard library only) copies `game/`
  and `screenshots/` into the output directory and writes `dossier.json`
  with the kit's dossier builder. Two runs produce byte-identical output.

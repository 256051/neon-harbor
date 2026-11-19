# Neon Harbor

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/256051/neon-harbor/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/256051/neon-harbor/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

An original open-world crime game in a fictional dusk-lit harbour city. You are
Mara Voss, a fixer with nothing but a stolen set of wheels and a contact named
Del on the radio. Steal a car, run three missions, and stay ahead of every
cruiser in the city.

- A 9×9 street grid with 128 buildings, a harbour and docks on the east side,
  14 traffic cars, 8 parked cars and 26 pedestrians.
- Car theft (E), arcade driving, punch and pistol combat, and a wanted system
  from 0 to 5 stars — the more stars, the more police answer.
- Three missions with radio briefings: First Wheels, Night Run, Heat.
- Minimap, compass, health, money, stars and speed on the HUD; save and load
  through localStorage; quality tiers with auto-quality; fully synthesised
  Web Audio — engine, sirens, gunshots and a generative music loop.
- No real city, no real cars, no real brands. Original work throughout.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8901/game/index.html in desktop Chrome.
`?seed=` picks a deterministic city, `?bench` shows performance stats,
`?shot=start|drive|wanted|mission` runs a scripted pilot for screenshots.

## Controls

WASD / arrows — drive and walk · E — steal car / get out · Mouse — aim and
orbit camera · Click — shoot · F — punch · P / Esc — pause · M — mute ·
Space — start / restart

---

Built by an AI agent for [make.fun](https://make.fun/r/99f6h40a)'s "Make GTA 6" bounty.

// Neon Harbor — the game's rules and state, with no drawing and no browser in it:
// the city, the player on foot and in cars, traffic, pedestrians, police, the
// wanted level, missions, combat and pickups. step() advances one fixed step and
// returns what happened as bit flags, so the caller can react (sound, banners)
// without the world knowing about screens or audio. Nothing here imports three.js,
// which is what lets the screenshot autopilot drive the real simulation.
import {
  AI_PED, AI_POLICE, AI_THUG, AI_TRAFFIC, CAR, CITY_HALF, DEATH_PENALTY, FEEL,
  LIGHT_CYCLE, MISSIONS, PARKED_COUNT, PED_COUNT, PICKUP_COUNT,
  PICKUP_VALUE, PITCH, PLAYER, START_CASH, STREETS,
  THUG_REWARD, TRAFFIC_COUNT, TRAFFIC_LIGHTS, WANTED_DECAY_CRIME_FREE, WANTED_DECAY_EVERY, WANTED_MAX,
} from './config.js';

export const EVENT_STEAL = 1;
export const EVENT_CRIME = 2;
export const EVENT_HIT = 4; // player took damage
export const EVENT_PICKUP = 8;
export const EVENT_MISSION = 16; // a mission stage advanced or a mission completed
export const EVENT_MISSION_FAIL = 32;
export const EVENT_DEATH = 64;
export const EVENT_PUNCH = 128;
export const EVENT_SHOT = 256;
export const EVENT_POLICE = 512; // police spawned
export const EVENT_CRASH = 1024;
export const EVENT_STORY_DONE = 2048;
export const EVENT_HIT_ENEMY = 4096; // a punch or shot connected
export const EVENT_WEAK_HIT = 8192; // a long-range shot connected (half damage)
export const EVENT_KILL = 16384; // a thug went down

const TAU = Math.PI * 2;
const CAR_COLORS = [0xc0392b, 0x2980b9, 0xf1c40f, 0x7f8c8d, 0x8e44ad, 0x16a085, 0xd35400, 0x2c3e50, 0xecf0f1, 0x27ae60];
const PED_COLORS = [0xe74c3c, 0x3498db, 0xf39c12, 0x9b59b6, 0x1abc9c, 0xe67e22, 0xfd79a8, 0x00cec9];

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function dist2(ax, az, bx, bz) { const dx = ax - bx; const dz = az - bz; return dx * dx + dz * dz; }
function angleDiff(a, b) { let d = a - b; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; }
function nearestStreet(v) { return Math.round(v / PITCH) * PITCH; }
function onRoad(x, z) {
  const rx = Math.abs(x - nearestStreet(x));
  const rz = Math.abs(z - nearestStreet(z));
  return rx < 6.5 || rz < 6.5;
}

export function createWorld(random) {
  // ---- static city: buildings fill the blocks between streets ----
  const buildings = [];
  for (let i = -4; i < 4; i += 1) {
    for (let j = -4; j < 4; j += 1) {
      const bx = i * PITCH + PITCH / 2;
      const bz = j * PITCH + PITCH / 2;
      // Two buildings per block, split along x, with a small gap.
      for (let half = 0; half < 2; half += 1) {
        const w = 11 + random() * 5;
        const d = 12 + random() * 14;
        const h = 8 + random() * random() * 34;
        buildings.push({
          x: bx - 7.5 + half * 15, z: bz + (random() - 0.5) * 4,
          w, d, h, color: 0,
        });
      }
    }
  }
  // Building colours are assigned deterministically from the index, not the
  // random stream, so a save/load keeps the city looking the same.
  const palette = [0x5a5f7a, 0x7a5a5f, 0x4f6a72, 0x8a6f4d, 0x6a5a8a, 0x55684f, 0x6e5a7e, 0x4a5a6e];
  buildings.forEach((b, i) => { b.color = palette[i % palette.length]; });

  const state = {
    time: 0,
    clockMin: 18 * 60, // 18:00, dusk
    cash: START_CASH,
    wanted: 0,
    crimeFree: 99,
    decayTimer: 0,
    hitCooldown: 0, // cooldown before another collision can raise wanted
    pedHitCooldown: 0,
    player: {
      x: 0, z: 84, heading: 0, vx: 0, vz: 0, speed: 0,
      health: PLAYER.health, onFoot: true, carId: -1,
      shootCooldown: 0, hurtTimer: 0, punchTimer: 0, punchAnim: 0,
    },
    camYaw: Math.PI, // camera position angle: the camera sits behind the player
    cars: [],
    peds: [],
    pickups: [],
    missionIndex: 0,
    missionStage: 0,
    missionTimer: 0,
    missionBanner: '',
    missionBannerTimer: 0,
    storyDone: false,
    thugsSpawnedFor: -1,
    stats: { stolen: 0, pedsHit: 0, crashes: 0, missionsDone: 0 },
    message: '',
    messageTimer: 0,
    radioText: '',
    radioSeq: 0,
    gunshotTimer: 0,
  };

  let carSeq = 0;
  function addCar(kind, x, z, heading, speed, color) {
    const car = {
      id: carSeq, kind, x, z, heading, speed, color,
      health: CAR.health, active: true, driver: kind === 'traffic',
      // traffic AI
      axis: 'x', dir: 1, street: 0, cruise: 10 + random() * 4,
      wreck: false, sirenPhase: random() * TAU, despawn: 0, ramCooldown: 0,
    };
    carSeq += 1;
    state.cars.push(car);
    return car;
  }

  function spawnTraffic() {
    for (let i = 0; i < TRAFFIC_COUNT; i += 1) {
      const axis = random() < 0.5 ? 'x' : 'z';
      const street = (Math.floor(random() * STREETS) - 4) * PITCH;
      const lane = (random() < 0.5 ? -3 : 3);
      const along = (random() * 2 - 1) * CITY_HALF;
      const car = addCar('traffic', axis === 'x' ? along : street + lane, axis === 'x' ? street + lane : along, 0, 0, CAR_COLORS[i % CAR_COLORS.length]);
      car.axis = axis;
      car.dir = random() < 0.5 ? 1 : -1;
      car.street = street;
      car.cruise = AI_TRAFFIC.cruiseMin + random() * (AI_TRAFFIC.cruiseMax - AI_TRAFFIC.cruiseMin);
      car.speed = car.cruise;
      car.heading = axis === 'x' ? (car.dir > 0 ? 0 : Math.PI) : (car.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
    }
  }

  function spawnParked() {
    const spots = [
      [21, 45], [-63, -39], [105, -45], [-21, 129], [63, 87], [-147, 45],
      [147, -87], [-105, -129],
    ];
    for (let i = 0; i < PARKED_COUNT; i += 1) {
      const [x, z] = spots[i % spots.length];
      const car = addCar('parked', x, z, (i % 2 === 0 ? 0 : Math.PI / 2), 0, CAR_COLORS[(i + 3) % CAR_COLORS.length]);
      car.driver = false;
      car.spot = [x, z];
    }
  }

  function spawnPeds() {
    for (let i = 0; i < PED_COUNT; i += 1) {
      const axis = random() < 0.5 ? 'x' : 'z';
      const street = (Math.floor(random() * STREETS) - 4) * PITCH;
      const side = random() < 0.5 ? -8 : 8;
      const along = (random() * 2 - 1) * CITY_HALF;
      state.peds.push({
        x: axis === 'x' ? along : street + side,
        z: axis === 'x' ? street + side : along,
        heading: random() * TAU, speed: 1 + random() * 1.2,
        axis, street, side, dir: random() < 0.5 ? 1 : -1,
        kind: 'walker', health: 100, color: PED_COLORS[i % PED_COLORS.length],
        active: true, run: false, punchTimer: 0, target: null,
      });
    }
  }

  function spawnPickups() {
    for (let i = 0; i < PICKUP_COUNT; i += 1) {
      const street = (Math.floor(random() * STREETS) - 4) * PITCH;
      const side = random() < 0.5 ? -8 : 8;
      const along = (random() * 2 - 1) * (CITY_HALF - 10);
      const axis = random() < 0.5 ? 'x' : 'z';
      state.pickups.push({
        x: axis === 'x' ? along : street + side,
        z: axis === 'x' ? street + side : along,
        active: true, spin: random() * TAU,
      });
    }
  }

  function spawnThug(x, z) {
    state.peds.push({
      x: x + (random() - 0.5) * 6, z: z + (random() - 0.5) * 6,
      heading: 0, speed: AI_THUG.speed, axis: 'x', street: 0, side: 0, dir: 1,
      kind: 'thug', health: AI_THUG.hp, color: 0x222222, active: true,
      run: true, punchTimer: 0, target: 'player',
      // Thug state machine: wander -> chase -> windup (telegraph) -> punch -> cooldown.
      mode: 'wander', windup: 0, lx: x, lz: z,
    });
  }

  function setMessage(text, seconds = 4) {
    state.message = text;
    state.messageTimer = seconds;
  }

  // Radio line: typed out letter by letter by the HUD (typewriter), queued
  // there. Bumping radioSeq tells the HUD a new line arrived.
  function setRadio(text) {
    state.radioText = text;
    state.radioSeq += 1;
  }

  const POLICE_LINES = [
    'Dispatch: "All units, vehicle theft in progress — Neon Harbor."',
    'Dispatch: "Suspect is mobile. Units, converge on the harbor."',
    'Dispatch: "Heat is rising. Do not let them reach the docks."',
    'Dispatch: "All units be advised: suspect is armed and moving."',
  ];

  function addWanted(n) {
    const before = state.wanted;
    state.wanted = clamp(state.wanted + n, 0, WANTED_MAX);
    state.crimeFree = 0;
    state.decayTimer = 0;
    if (state.wanted > before && state.wanted > 0) {
      setRadio(POLICE_LINES[Math.min(state.wanted - 1, POLICE_LINES.length - 1)]);
    }
    return state.wanted > before;
  }

  function mission() { return MISSIONS[state.missionIndex] || null; }
  function missionStageDef() {
    const m = mission();
    return m ? m.stages[state.missionStage] : null;
  }
  function markerPos() {
    const s = missionStageDef();
    return s && s.target ? { x: s.target[0], z: s.target[1], radius: s.radius || 8 } : null;
  }

  function startMission(index) {
    const m = MISSIONS[index];
    if (!m) return;
    state.missionStage = 0;
    state.missionTimer = 0;
    setRadio(m.intro);
    setMessage(`${m.title} — ${m.stages[0].text}`, 6);
    if (index === 2) {
      // Mission 3 opens with the heat already on.
      addWanted(3);
    }
  }

  function completeMission() {
    const m = mission();
    if (!m) return 0;
    state.cash += m.reward;
    state.stats.missionsDone += 1;
    state.missionBanner = `MISSION COMPLETE — ${m.title}  +$${m.reward}`;
    state.missionBannerTimer = 4;
    let events = EVENT_MISSION;
    state.missionIndex += 1;
    if (state.missionIndex >= MISSIONS.length) {
      state.storyDone = true;
      events |= EVENT_STORY_DONE;
      setMessage('Story complete — Neon Harbor is yours. Free roam: keep the city, keep the cash.', 8);
    } else {
      startMission(state.missionIndex);
    }
    return events;
  }

  function failMission(reason) {
    const m = mission();
    state.missionBanner = `MISSION FAILED — ${reason}`;
    state.missionBannerTimer = 4;
    setMessage(m ? `${m.title} failed: ${reason}. The mission restarts.` : reason, 5);
    // Restart the current mission from its first stage.
    state.missionStage = 0;
    state.missionTimer = 0;
    if (state.missionIndex === 2) addWanted(3);
    return EVENT_MISSION_FAIL;
  }

  // ---- collisions against buildings: move one axis at a time so the
  // player and cars slide along walls instead of sticking on corners. ----
  function collidesBuilding(x, z, r) {
    for (let i = 0; i < buildings.length; i += 1) {
      const b = buildings[i];
      if (Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r) return true;
    }
    return false;
  }
  // Distance to the nearest road centreline: zero on a street, growing into a block.
  function roadDist(x, z) {
    return Math.min(Math.abs(x - nearestStreet(x)), Math.abs(z - nearestStreet(z)));
  }
  // Nudge anything wedged inside a building back out toward the nearest
  // street. Only something shoved in (a ram, a collision push) can be
  // inside at all — the normal collision checks keep everything out — so
  // this is a safety valve, not a way through walls: 0.06 m per step is
  // slower than walking, and it stops the moment the entity is outside.
  function ejectFromBuilding(pos, r) {
    if (!collidesBuilding(pos.x, pos.z, r)) return;
    const dxRoad = nearestStreet(pos.x) - pos.x;
    const dzRoad = nearestStreet(pos.z) - pos.z;
    if (Math.abs(dxRoad) < Math.abs(dzRoad)) pos.x += Math.sign(dxRoad) * 0.06;
    else pos.z += Math.sign(dzRoad) * 0.06;
  }
  function moveWithBuildings(pos, dx, dz, r) {
    const stuckInside = collidesBuilding(pos.x, pos.z, r);
    const nx = pos.x + dx;
    // If already inside a building (shoved or exited there), allow any move
    // that gets closer to a road instead of freezing in the wall.
    if (!collidesBuilding(nx, pos.z, r) || (stuckInside && roadDist(nx, pos.z) < roadDist(pos.x, pos.z))) pos.x = nx;
    const nz = pos.z + dz;
    if (!collidesBuilding(pos.x, nz, r) || (stuckInside && roadDist(pos.x, nz) < roadDist(pos.x, pos.z))) pos.z = nz;
    pos.x = clamp(pos.x, -CITY_HALF - 20, CITY_HALF + 20);
    pos.z = clamp(pos.z, -CITY_HALF - 20, CITY_HALF + 20);
    if (stuckInside) ejectFromBuilding(pos, r);
  }
  // First offset around (x, z) that is not inside a building.
  function freeOffset(x, z, r) {
    const tries = [[2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5], [3.5, 3.5], [-3.5, -3.5]];
    for (const [dx, dz] of tries) {
      if (!collidesBuilding(x + dx, z + dz, r)) return [x + dx, z + dz];
    }
    return [x, z];
  }

  function nearestStealable(maxDist) {
    const p = state.player;
    let best = null;
    let bestD = maxDist * maxDist;
    for (const car of state.cars) {
      if (!car.active || car.wreck || car.kind === 'police') continue;
      if (car.kind !== 'traffic' && car.kind !== 'parked') continue;
      const d = dist2(p.x, p.z, car.x, car.z);
      if (d < bestD) { bestD = d; best = car; }
    }
    return best;
  }

  function stealCar(car) {
    const p = state.player;
    if (car.kind === 'traffic' && car.driver) {
      // The driver bails out and runs off on foot.
      const [dx, dz] = freeOffset(car.x, car.z, PLAYER.radius);
      state.peds.push({
        x: dx, z: dz, heading: random() * TAU, speed: 4.5,
        axis: 'x', street: 0, side: 0, dir: 1, kind: 'driver', health: 100,
        color: 0xf5f5f5, active: true, run: true, punchTimer: 0, target: null,
      });
      car.driver = false;
    }
    car.kind = 'player';
    car.health = Math.max(car.health, 60);
    p.onFoot = false;
    p.carId = car.id;
    p.x = car.x; p.z = car.z; p.heading = car.heading;
    state.stats.stolen += 1;
    addWanted(1);
    setMessage('Car stolen! The cops have been called — 1 star.', 3);
    return EVENT_STEAL | EVENT_CRIME;
  }

  function exitCar() {
    const p = state.player;
    const car = state.cars.find((c) => c.id === p.carId);
    if (!car) { p.onFoot = true; p.carId = -1; return; }
    car.kind = 'parked';
    car.speed = 0;
    p.onFoot = true;
    p.carId = -1;
    const [ex, ez] = freeOffset(car.x, car.z, PLAYER.radius);
    p.x = ex;
    p.z = ez;
    p.speed = 0;
  }

  function damagePlayer(amount) {
    const p = state.player;
    if (p.health <= 0) return 0;
    p.health = Math.max(0, p.health - amount);
    p.hurtTimer = 10;
    if (p.health <= 0) return EVENT_DEATH;
    return EVENT_HIT;
  }

  function spawnPolice() {
    const p = state.player;
    // Wanted stars are a token budget: `wanted` cars in total, but only the
    // first AI_POLICE.maxChasers get a chase token — the rest patrol the
    // perimeter and keep the pressure on without dogpiling the player.
    const want = state.wanted;
    const have = state.cars.filter((c) => c.active && c.kind === 'police').length;
    let spawned = 0;
    for (let i = have; i < want; i += 1) {
      // Spawn on a road 55–70 m away, in a random direction.
      const a = random() * TAU;
      let x = p.x + Math.sin(a) * AI_POLICE.spawnDist;
      let z = p.z + Math.cos(a) * AI_POLICE.spawnDist;
      x = nearestStreet(clamp(x, -CITY_HALF, CITY_HALF));
      z = nearestStreet(clamp(z, -CITY_HALF, CITY_HALF));
      if (!onRoad(x, z)) { x = nearestStreet(x); }
      const car = addCar('police', x, z, random() * TAU, 12, 0xe8e8e8);
      car.cruise = AI_POLICE.chaseSpeed;
      car.role = i < AI_POLICE.maxChasers ? 'chase' : 'patrol';
      car.patrolAngle = random() * TAU;
      car.mode = 'chase';
      car.searchTimer = 0;
      car.lx = p.x;
      car.lz = p.z;
      spawned += 1;
    }
    return spawned > 0 ? EVENT_POLICE : 0;
  }

  function updatePolice(dt) {
    const p = state.player;
    let events = 0;
    for (const car of state.cars) {
      if (!car.active || car.kind !== 'police') continue;
      if (state.wanted === 0) {
        // No heat: the cops peel off and leave.
        car.despawn += dt;
        if (car.despawn > 2 || dist2(car.x, car.z, p.x, p.z) > AI_POLICE.despawnDist * AI_POLICE.despawnDist) car.active = false;
        continue;
      }
      car.despawn = 0;
      let targetX = p.x;
      let targetZ = p.z;
      let targetSpeed = AI_POLICE.chaseSpeed;
      if (car.role === 'patrol') {
        // Perimeter patrol: circle the player at patrol radius, no ramming.
        car.patrolAngle += dt * 0.25;
        targetX = p.x + Math.sin(car.patrolAngle) * AI_POLICE.patrolRadius;
        targetZ = p.z + Math.cos(car.patrolAngle) * AI_POLICE.patrolRadius;
        targetSpeed = 16;
      } else {
        // Chase with a memory: the police home in while they can see the
        // player (within 30 m). Once the player breaks away for 5 s, they
        // fall back to searching the last known position — which is what
        // makes losing the heat possible at all.
        const pd = Math.sqrt(dist2(car.x, car.z, p.x, p.z));
        if (pd < 30) {
          car.mode = 'chase';
          car.searchTimer = 0;
          car.lx = p.x;
          car.lz = p.z;
        } else {
          car.searchTimer += dt;
          if (car.searchTimer > AI_POLICE.searchDelay) car.mode = 'search';
        }
        if (car.mode === 'search') {
          targetX = car.lx;
          targetZ = car.lz;
          targetSpeed = 20;
        }
      }
      const dx = targetX - car.x;
      const dz = targetZ - car.z;
      const d = Math.sqrt(dx * dx + dz * dz) || 1;
      const wantHeading = Math.atan2(dx, dz);
      const diff = angleDiff(wantHeading, car.heading);
      if (car.role === 'chase') {
        targetSpeed = Math.min(AI_POLICE.chaseSpeed, (p.onFoot ? 14 : Math.abs(carSpeedOfPlayer()) + 5));
      }
      car.speed = clamp(car.speed + (targetSpeed - car.speed) * dt * 0.8, 0, AI_POLICE.chaseSpeed);
      car.heading += clamp(diff, -2.4 * dt, 2.4 * dt);
      const nx = car.x + Math.sin(car.heading) * car.speed * dt;
      const nz = car.z + Math.cos(car.heading) * car.speed * dt;
      if (!collidesBuilding(nx, car.z, CAR.radius)) car.x = nx;
      if (!collidesBuilding(car.x, nz, CAR.radius)) car.z = nz;
      ejectFromBuilding(car, CAR.radius);
      car.sirenPhase += dt * 6;
      if (car.ramCooldown > 0) car.ramCooldown -= dt;
      // Ram: contact damages the player (or their car), at most once per cooldown.
      // Patrol cars never ram.
      if (car.role === 'chase' && d < CAR.radius + 1.6 && car.ramCooldown <= 0 && car.speed > AI_POLICE.ramMinSpeed) {
        car.ramCooldown = AI_POLICE.ramCooldown;
        if (p.onFoot) {
          events |= damagePlayer(AI_POLICE.ramDamage);
          // Shove the player away from the ram.
          p.x += (dx / d) * 0.7; p.z += (dz / d) * 0.7;
        } else {
          const pc = state.cars.find((c) => c.id === p.carId);
          if (pc) {
            // The ram hurts the car, but not so much that a chase wrecks it
            // in seconds — the player still takes 6 HP per ram below.
            pc.health -= 4;
            if (pc.health <= 0 && !pc.wreck) {
              pc.wreck = true;
              events |= EVENT_CRASH;
              setMessage('Your car is wrecked! Bail out and find another.', 4);
            }
          }
          events |= damagePlayer(4); // ramming the car hurts the driver, but less than a ram on foot
        }
        car.speed *= 0.6;
      }
    }
    return events;
  }

  function carSpeedOfPlayer() {
    const p = state.player;
    if (p.onFoot) return 0;
    const car = state.cars.find((c) => c.id === p.carId);
    return car ? car.speed : 0;
  }

  // Is the light at intersection (lx, lz) green for traffic travelling
  // along `axis` ('x' = east-west street, 'z' = north-south street)?
  function lightGreen(lx, lz, axis) {
    const light = TRAFFIC_LIGHTS.find((t) => t[0] === lx && t[1] === lz);
    if (!light) return true;
    const nsGreen = ((state.time + light[2]) % LIGHT_CYCLE) < LIGHT_CYCLE / 2;
    return axis === 'z' ? nsGreen : !nsGreen;
  }

  function updateTraffic(dt) {
    for (const car of state.cars) {
      if (!car.active || car.kind !== 'traffic') continue;
      // Traffic lights: ease to a stop behind a red light at an intersection
      // ahead, then go again on green.
      let targetSpeed = car.cruise;
      const streetCoord = car.axis === 'x' ? car.z : car.x;
      for (const [lx, lz] of TRAFFIC_LIGHTS) {
        if (Math.abs(streetCoord - (car.axis === 'x' ? lz : lx)) > 7) continue;
        const inter = car.axis === 'x' ? lx : lz;
        const along = car.axis === 'x' ? car.x : car.z;
        const ahead = (inter - along) * car.dir;
        if (ahead > 0 && ahead < AI_TRAFFIC.stopDist + 3 && !lightGreen(lx, lz, car.axis)) {
          targetSpeed = ahead < AI_TRAFFIC.stopDist ? 0 : car.cruise * (ahead - AI_TRAFFIC.stopDist) / 3;
          break;
        }
      }
      car.speed += clamp(targetSpeed - car.speed, -14 * dt, 8 * dt);
      const stepLen = car.speed * dt;
      if (car.axis === 'x') {
        car.x += car.dir * stepLen;
        if (Math.abs(car.x) > CITY_HALF + 6) {
          car.x = -car.dir * (CITY_HALF + 6);
          car.street = (Math.floor(random() * STREETS) - 4) * PITCH;
          car.z = car.street + (random() < 0.5 ? -3 : 3);
        }
        // At an intersection, sometimes turn onto the cross street.
        if (Math.abs(car.x - nearestStreet(car.x)) < 1.2 && random() < 0.004) {
          car.axis = 'z';
          car.street = nearestStreet(car.x);
          car.heading = car.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
          const lane = car.z > car.street ? 3 : -3;
          car.x = car.street + lane;
        }
      } else {
        car.z += car.dir * stepLen;
        if (Math.abs(car.z) > CITY_HALF + 6) {
          car.z = -car.dir * (CITY_HALF + 6);
          car.street = (Math.floor(random() * STREETS) - 4) * PITCH;
          car.x = car.street + (random() < 0.5 ? -3 : 3);
        }
        if (Math.abs(car.z - nearestStreet(car.z)) < 1.2 && random() < 0.004) {
          car.axis = 'x';
          car.street = nearestStreet(car.z);
          car.heading = car.dir > 0 ? 0 : Math.PI;
          const lane = car.x > car.street ? 3 : -3;
          car.z = car.street + lane;
        }
      }
      car.heading = car.axis === 'x'
        ? (car.dir > 0 ? 0 : Math.PI)
        : (car.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
    }
  }

  function updatePeds(dt) {
    const p = state.player;
    for (const ped of state.peds) {
      if (!ped.active) continue;
      if (ped.kind === 'thug') {
        // Thug state machine: wander -> chase (sensed) -> windup (telegraph)
        // -> punch -> cooldown. Gives up and wanders back past chase range.
        const dx = p.x - ped.x;
        const dz = p.z - ped.z;
        const d = Math.sqrt(dx * dx + dz * dz) || 1;
        if (ped.mode === 'windup') {
          ped.windup -= dt;
          ped.punchAnim = 1; // arms raised: the telegraph the player can read
          if (ped.windup <= 0) {
            ped.punchAnim = 0;
            ped.mode = 'cooldown';
            ped.punchTimer = AI_THUG.punchCooldown;
            if (d < AI_THUG.punchRange + 0.6) {
              return damagePlayer(AI_THUG.punchDamage);
            }
          }
          continue;
        }
        if (ped.mode === 'cooldown') {
          ped.punchTimer -= dt;
          if (ped.punchTimer <= 0) ped.mode = 'chase';
          continue;
        }
        if (d > AI_THUG.chaseRange) {
          ped.mode = 'wander';
          ped.active = false; // gives up and melts back into the crowd
          continue;
        }
        if (d < AI_PED.senseRadius) {
          ped.mode = 'chase';
          ped.lx = p.x; ped.lz = p.z; // last known position
        }
        ped.heading = Math.atan2(dx, dz);
        if (ped.mode === 'chase') {
          if (d > AI_THUG.punchRange) {
            ped.x += (dx / d) * ped.speed * dt;
            ped.z += (dz / d) * ped.speed * dt;
          } else {
            ped.mode = 'windup';
            ped.windup = AI_THUG.windup;
            ped.punchAnim = 1;
          }
        } else {
          // Wander toward the last known position, then mill about.
          const wx = ped.lx - ped.x;
          const wz = ped.lz - ped.z;
          const wd = Math.sqrt(wx * wx + wz * wz) || 1;
          if (wd > 2) {
            ped.x += (wx / wd) * ped.speed * 0.4 * dt;
            ped.z += (wz / wd) * ped.speed * 0.4 * dt;
          }
        }
        continue;
      }
      if (ped.run) {
        // A fleeing driver / scared pedestrian runs away from the player.
        const dx = ped.x - p.x;
        const dz = ped.z - p.z;
        const d = Math.sqrt(dx * dx + dz * dz) || 1;
        ped.heading = Math.atan2(dx, dz);
        ped.x += (dx / d) * ped.speed * dt;
        ped.z += (dz / d) * ped.speed * dt;
        if (d > 60) ped.active = false;
        continue;
      }
      // A walker who is scared — fast car close by, or a gunshot just went
      // off nearby — runs for it.
      const playerSpeed = p.onFoot ? Math.abs(p.speed) : Math.abs(carSpeedOfPlayer());
      const pd = Math.sqrt(dist2(ped.x, ped.z, p.x, p.z));
      if ((playerSpeed > 10 && pd < AI_PED.fleeRadius) || (state.gunshotTimer > 0 && pd < 20)) {
        ped.run = true;
        ped.speed = AI_PED.fleeSpeed;
        continue;
      }
      // Ordinary walker: stroll along a sidewalk, turn at the city edge.
      const stepLen = ped.speed * dt;
      if (ped.axis === 'x') {
        ped.x += ped.dir * stepLen;
        if (Math.abs(ped.x) > CITY_HALF) { ped.dir *= -1; }
      } else {
        ped.z += ped.dir * stepLen;
        if (Math.abs(ped.z) > CITY_HALF) { ped.dir *= -1; }
      }
      ped.heading = ped.axis === 'x' ? (ped.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (ped.dir > 0 ? 0 : Math.PI);
    }
    return 0;
  }

  // Car-vs-car and car-vs-pedestrian collisions for the player's car.
  function updatePlayerCarCollisions(dt) {
    const p = state.player;
    if (p.onFoot) return 0;
    const car = state.cars.find((c) => c.id === p.carId);
    if (!car || car.wreck) return 0;
    let events = 0;
    for (const other of state.cars) {
      if (!other.active || other.id === car.id || other.kind === 'player') continue;
      const d2 = dist2(car.x, car.z, other.x, other.z);
      if (d2 < (CAR.radius * 2) * (CAR.radius * 2)) {
        const d = Math.sqrt(d2) || 1;
        const rel = Math.abs(car.speed - other.speed);
        const push = ((CAR.radius * 2 - d) / 2) * 0.8;
        const nx = (car.x - other.x) / d;
        const nz = (car.z - other.z) / d;
        car.x += nx * push; car.z += nz * push;
        if (other.kind === 'traffic' || other.kind === 'parked') {
          other.x -= nx * push; other.z -= nz * push;
          other.speed *= 0.5;
        }
        if (rel > 7) {
          car.speed *= 0.55;
          // Police damage comes only from the ram event — otherwise a ram
          // would bill the player twice (collision + ram).
          if (other.kind !== 'police') car.health -= rel * 0.8;
          state.stats.crashes += 1;
          events |= EVENT_CRASH;
          if (other.kind === 'traffic' && state.hitCooldown <= 0) {
            // Witness rule: a smash only raises the heat when a police car
            // is close enough to see it. Lets a fleeing driver stay free
            // once they have broken away from the chase.
            const seen = state.cars.some((c) => c.active && c.kind === 'police'
              && dist2(c.x, c.z, p.x, p.z) < 60 * 60);
            if (seen) {
              addWanted(1);
              setMessage('You smashed into traffic! Wanted up.', 3);
              events |= EVENT_CRIME;
            }
            state.hitCooldown = 5;
          }
          if (car.health <= 0 && !car.wreck) {
            car.wreck = true;
            setMessage('Your car is wrecked! Bail out and find another.', 4);
          }
        }
      }
    }
    // Running over pedestrians.
    for (const ped of state.peds) {
      if (!ped.active || ped.kind === 'thug') continue;
      if (dist2(car.x, car.z, ped.x, ped.z) < 2.6 * 2.6 && Math.abs(car.speed) > 3) {
        ped.active = false;
        state.stats.pedsHit += 1;
        car.speed *= 0.85;
        if (state.pedHitCooldown <= 0) {
          addWanted(1);
          state.pedHitCooldown = 6;
          setMessage('You hit a pedestrian! Wanted up.', 3);
          events |= EVENT_CRIME;
        }
      }
    }
    return events;
  }

  function updateMissions(dt) {
    const m = mission();
    if (!m) return 0;
    const s = missionStageDef();
    if (!s) return 0;
    let events = 0;
    const p = state.player;
    // Mission 2: thugs jump the player at the pickup.
    if (state.missionIndex === 1 && state.missionStage === 0 && state.thugsSpawnedFor !== 1) {
      const d = Math.sqrt(dist2(p.x, p.z, -150, -126));
      if (d < 30) {
        state.thugsSpawnedFor = 1;
        spawnThug(-150, -126);
        spawnThug(-144, -120);
        setMessage('Thugs! They want the package — fight them off (F to punch, click to shoot).', 5);
      }
    }
    if (s.timer !== undefined) {
      state.missionTimer += dt;
      if (state.missionTimer > s.timer) {
        return failMission('Out of time on the delivery.');
      }
    }
    if (s.wanted !== undefined && state.missionStage === 0 && state.missionIndex === 2) {
      // Stage 0 of Heat: complete when the wanted level is gone.
      if (state.wanted === 0) {
        state.missionStage = 1;
        state.missionTimer = 0;
        setMessage('Heat is off. Now get to the Hideout.', 4);
        return EVENT_MISSION;
      }
      return 0;
    }
    if (s.target) {
      const d = Math.sqrt(dist2(p.x, p.z, s.target[0], s.target[1]));
      if (d < (s.radius || 8)) {
        if (state.missionIndex === 0 && state.missionStage === 0) {
          // Stage 0 of mission 1 has no target; handled below.
        } else if (state.missionIndex === 1 && state.missionStage === 0) {
          state.missionStage = 1;
          state.missionTimer = 0;
          setMessage('Package secured. Now deliver it to the Marina — fast!', 4);
          return EVENT_MISSION;
        }
        // Reaching a stage target completes the stage or the mission.
        if (state.missionStage + 1 >= m.stages.length) {
          events |= completeMission();
        } else {
          state.missionStage += 1;
          state.missionTimer = 0;
          setMessage(`Objective: ${m.stages[state.missionStage].text}`, 4);
          events |= EVENT_MISSION;
        }
        return events;
      }
    }
    if (state.missionIndex === 0 && state.missionStage === 0 && !p.onFoot) {
      state.missionStage = 1;
      setMessage(`Objective: ${m.stages[1].text}`, 4);
      return EVENT_MISSION;
    }
    return events;
  }

  function reset() {
    state.time = 0;
    state.clockMin = 18 * 60;
    state.cash = START_CASH;
    state.wanted = 0;
    state.crimeFree = 99;
    state.decayTimer = 0;
    state.hitCooldown = 0;
    state.pedHitCooldown = 0;
    const p = state.player;
    p.x = 0; p.z = 84; p.heading = 0; p.vx = 0; p.vz = 0; p.speed = 0;
    p.health = PLAYER.health; p.onFoot = true; p.carId = -1;
    p.shootCooldown = 0; p.hurtTimer = 0; p.punchTimer = 0; p.punchAnim = 0;
    state.camYaw = Math.PI;
    state.cars = [];
    state.peds = [];
    state.pickups = [];
    carSeq = 0;
    state.missionIndex = 0;
    state.missionStage = 0;
    state.missionTimer = 0;
    state.missionBanner = '';
    state.missionBannerTimer = 0;
    state.storyDone = false;
    state.thugsSpawnedFor = -1;
    state.stats = { stolen: 0, pedsHit: 0, crashes: 0, missionsDone: 0 };
    state.message = '';
    state.messageTimer = 0;
    spawnTraffic();
    spawnParked();
    spawnPeds();
    spawnPickups();
    startMission(0);
  }

  function applySave(save) {
    reset();
    // Tolerant parse + clamp: a hand-edited or older save can never put the
    // game in an impossible state.
    const num = (v, d, lo, hi) => {
      const n = Number(v);
      return Number.isFinite(n) ? clamp(n, lo, hi) : d;
    };
    state.cash = num(save.cash, START_CASH, 0, 999999);
    state.player.x = num(save.x, 0, -CITY_HALF - 20, CITY_HALF + 20);
    state.player.z = num(save.z, 84, -CITY_HALF - 20, CITY_HALF + 20);
    state.player.heading = num(save.heading, 0, -Math.PI, Math.PI);
    state.player.health = num(save.health, PLAYER.health, 1, PLAYER.health);
    state.player.onFoot = true;
    state.player.carId = -1;
    state.missionIndex = Math.floor(num(save.missionIndex, 0, 0, MISSIONS.length - 1));
    state.missionStage = Math.floor(num(save.stage, 0, 0, 3));
    state.wanted = Math.floor(num(save.wanted, 0, 0, WANTED_MAX));
    state.clockMin = num(save.clockMin, 18 * 60, 0, 24 * 60);
    state.storyDone = !!save.storyDone;
    state.missionBanner = '';
    state.missionBannerTimer = 0;
    const m = mission();
    if (m) setMessage(`${m.title} — ${m.stages[state.missionStage]?.text ?? ''}`, 5);
  }

  function step(dt, input) {
    let events = 0;
    state.time += dt;
    state.clockMin = (18 * 60 + state.time / 1.5) % (24 * 60);
    if (state.messageTimer > 0) state.messageTimer -= dt;
    if (state.gunshotTimer > 0) state.gunshotTimer -= dt;
    if (state.missionBannerTimer > 0) state.missionBannerTimer -= dt;
    if (state.hitCooldown > 0) state.hitCooldown -= dt;
    if (state.pedHitCooldown > 0) state.pedHitCooldown -= dt;
    state.crimeFree += dt;

    const p = state.player;
    if (p.shootCooldown > 0) p.shootCooldown -= dt;
    if (p.hurtTimer > 0) p.hurtTimer -= dt;
    if (p.punchTimer > 0) p.punchTimer -= dt;
    if (p.punchAnim > 0) p.punchAnim -= dt;
    // Slow health regen when out of trouble for a while.
    if (p.hurtTimer <= 0 && p.health > 0 && p.health < PLAYER.health) {
      p.health = Math.min(PLAYER.health, p.health + 2 * dt);
    }

    // ---- player movement ----
    // The camera yaw (input.camYaw, or the stored one the mouse drags) sets
    // the frame: W walks away from the camera, D strafes right of it. The
    // character then turns toward the movement direction — which is fixed by
    // the camera, never by the character's own heading, so it cannot spin.
    if (input.camYaw !== undefined) state.camYaw = input.camYaw;
    if (p.onFoot) {
      const fwdX = -Math.sin(state.camYaw);
      const fwdZ = -Math.cos(state.camYaw);
      const rightX = Math.cos(state.camYaw);
      const rightZ = -Math.sin(state.camYaw);
      const mx = fwdX * (input.fwd || 0) + rightX * (input.strafe || 0);
      const mz = fwdZ * (input.fwd || 0) + rightZ * (input.strafe || 0);
      const len = Math.sqrt(mx * mx + mz * mz) || 1;
      const maxSpeed = input.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
      const target = (Math.abs(input.fwd || 0) + Math.abs(input.strafe || 0)) > 0 ? maxSpeed : 0;
      p.speed += (target - p.speed) * Math.min(1, dt * 8);
      if (p.speed > 0.1) {
        // Face the movement direction.
        const wantHeading = Math.atan2(mx, mz);
        const diff = angleDiff(wantHeading, p.heading);
        p.heading += clamp(diff, -10 * dt, 10 * dt);
        moveWithBuildings(p, (mx / len) * p.speed * dt, (mz / len) * p.speed * dt, PLAYER.radius);
      }
      if (input.e) {
        const car = nearestStealable(4.5);
        if (car) events |= stealCar(car);
        else if (state.cars.some((c) => c.active && c.kind === 'parked' && dist2(p.x, p.z, c.x, c.z) < 25)) {
          setMessage('Get closer to a car, then press E.', 2);
        }
      }
      if (input.f && p.punchTimer <= 0) {
        p.punchTimer = 0.45;
        p.punchAnim = 0.3;
        events |= EVENT_PUNCH;
        for (const ped of state.peds) {
          if (!ped.active || ped.kind !== 'thug') continue;
          const d = Math.sqrt(dist2(p.x, p.z, ped.x, ped.z));
          if (d < PLAYER.punchRange) {
            const a = angleDiff(Math.atan2(ped.x - p.x, ped.z - p.z), p.heading);
            if (Math.abs(a) < PLAYER.punchArc / 2 + 0.4) {
              ped.health -= PLAYER.punchDamage;
              if (ped.health <= 0) {
                ped.active = false;
                state.cash += THUG_REWARD;
                setMessage(`Thug down! +$${THUG_REWARD}`, 3);
                events |= EVENT_KILL;
              } else {
                events |= EVENT_HIT_ENEMY;
              }
            }
          }
        }
      }
      if (input.shoot && p.shootCooldown <= 0) {
        p.shootCooldown = PLAYER.shootCooldown;
        events |= EVENT_SHOT;
        state.gunshotTimer = 1.5; // nearby walkers hear it and run
        // Hitscan: nearest hostile roughly in front of the player.
        let best = null;
        let bestD = PLAYER.shootRange;
        for (const ped of state.peds) {
          if (!ped.active || ped.kind !== 'thug') continue;
          const d = Math.sqrt(dist2(p.x, p.z, ped.x, ped.z));
          if (d > bestD) continue;
          const a = angleDiff(Math.atan2(ped.x - p.x, ped.z - p.z), p.heading);
          if (Math.abs(a) < 0.5) { best = ped; bestD = d; }
        }
        if (best) {
          // Long-range shots are weak hits: half damage, marked as weak.
          const weak = bestD > 20;
          best.health -= weak ? PLAYER.shootDamage / 2 : PLAYER.shootDamage;
          if (best.health <= 0) {
            best.active = false;
            state.cash += THUG_REWARD;
            setMessage(`Thug down! +$${THUG_REWARD}`, 3);
            events |= EVENT_KILL;
          } else {
            events |= weak ? EVENT_WEAK_HIT : EVENT_HIT_ENEMY;
          }
        }
      }
    } else {
      const car = state.cars.find((c) => c.id === p.carId);
      if (!car || car.wreck) {
        if (car && car.wreck) exitCar();
        else { p.onFoot = true; p.carId = -1; }
      } else {
        if (input.e && Math.abs(car.speed) < 2) exitCar();
        else {
          const steer = clamp(input.steer || 0, -1, 1);
          const accel = input.accel || 0;
          if (accel > 0) car.speed += CAR.accel * accel * dt;
          else if (input.brake) {
            if (car.speed > 0.5) car.speed -= CAR.brake * dt;
            else car.speed -= CAR.reverseAccel * dt;
          } else {
            car.speed -= car.speed * CAR.drag * dt;
            if (Math.abs(car.speed) < 0.2) car.speed = 0;
          }
          car.speed = clamp(car.speed, -CAR.maxReverse, CAR.maxSpeed);
          const turn = steer * CAR.grip * clamp(Math.abs(car.speed) / 10, 0, 1) * (car.speed < 0 ? -1 : 1);
          car.heading += turn * dt;
          const nx = car.x + Math.sin(car.heading) * car.speed * dt;
          const nz = car.z + Math.cos(car.heading) * car.speed * dt;
          const hitX = collidesBuilding(nx, car.z, CAR.radius);
          const hitZ = collidesBuilding(car.x, nz, CAR.radius);
          if (!hitX) car.x = nx; else if (Math.abs(car.speed) > 12) { car.speed *= 0.5; events |= EVENT_CRASH; state.stats.crashes += 1; car.health -= 3; }
          if (!hitZ) car.z = nz; else if (Math.abs(car.speed) > 12) { car.speed *= 0.5; events |= EVENT_CRASH; state.stats.crashes += 1; car.health -= 3; }
          // A ram can shove a car into a wall; eject it so it never wedges.
          ejectFromBuilding(car, CAR.radius);
          car.x = clamp(car.x, -CITY_HALF - 20, CITY_HALF + 20);
          car.z = clamp(car.z, -CITY_HALF - 20, CITY_HALF + 20);
          if (car.health <= 0 && !car.wreck) {
            car.wreck = true;
            setMessage('Your car is wrecked! Bail out and find another.', 4);
            events |= EVENT_CRASH;
          }
          p.x = car.x; p.z = car.z; p.heading = car.heading;
          p.speed = car.speed;
        }
      }
    }

    // The camera drifts back behind the player only while moving forward
    // (on foot, or driving with the throttle down). It must NOT auto-align
    // while strafing: the strafe direction is defined by the camera, so
    // aligning to the character then would rotate the frame itself and the
    // player would walk in circles.
    const forwardish = p.onFoot
      ? (input.fwd || 0) > 0.5 && Math.abs(input.strafe || 0) < 0.5
      : (input.accel || 0) > 0 && Math.abs(input.steer || 0) < 0.5;
    if (forwardish && Math.abs(p.speed) > 0.5) {
      state.camYaw += angleDiff(p.heading + Math.PI, state.camYaw) * Math.min(1, dt * FEEL.camAlign);
    }

    updateTraffic(dt);
    events |= updatePeds(dt);
    events |= updatePlayerCarCollisions(dt);
    events |= updatePolice(dt);

    // Pickups.
    for (const pk of state.pickups) {
      if (!pk.active) continue;
      pk.spin += dt * 3;
      if (dist2(p.x, p.z, pk.x, pk.z) < 3 * 3) {
        pk.active = false;
        state.cash += PICKUP_VALUE;
        events |= EVENT_PICKUP;
        setMessage(`Cash pickup! +$${PICKUP_VALUE}`, 2.5);
      }
    }

    // Wrecked cars get towed away and replaced: a wrecked parked car comes
    // back at its spot after 40 s, a wrecked traffic car comes back where it
    // is. Without this the city runs out of stealable cars after a few
    // wrecks and a long session has nothing left to drive.
    for (const car of state.cars) {
      if (!car.active || !car.wreck) continue;
      car.wreckTimer = (car.wreckTimer || 0) + dt;
      if (car.wreckTimer >= 40) {
        car.wreckTimer = 0;
        car.wreck = false;
        car.health = 100;
        car.speed = 0;
        if (car.spot) { car.x = car.spot[0]; car.z = car.spot[1]; }
      }
    }

    // Wanted: spawn police to match the level (stars = token budget), decay
    // when quiet and unseen.
    if (state.wanted > 0) {
      const have = state.cars.filter((c) => c.active && c.kind === 'police').length;
      if (have < state.wanted) events |= spawnPolice();
      const nearestPolice = state.cars.reduce((best, c) => {
        if (!c.active || c.kind !== 'police') return best;
        return Math.min(best, Math.sqrt(dist2(c.x, c.z, p.x, p.z)));
      }, Infinity);
      if (state.crimeFree > WANTED_DECAY_CRIME_FREE && nearestPolice > 35) {
        state.decayTimer += dt;
        if (state.decayTimer >= WANTED_DECAY_EVERY) {
          state.decayTimer = 0;
          state.wanted = Math.max(0, state.wanted - 1);
          if (state.wanted === 0) setMessage('You lost the cops. Heat is off.', 3);
        }
      }
    }

    events |= updateMissions(dt);

    if (p.health <= 0) {
      events |= EVENT_DEATH;
    }
    return events;
  }

  function respawnAfterDeath() {
    const p = state.player;
    state.cash = Math.max(0, state.cash - DEATH_PENALTY);
    p.health = PLAYER.health;
    p.x = 0; p.z = 126; p.heading = Math.PI;
    p.onFoot = true; p.carId = -1; p.speed = 0;
    state.wanted = 0;
    for (const car of state.cars) if (car.kind === 'police') car.active = false;
    setMessage(`You woke up at the clinic. -$${DEATH_PENALTY}. The mission restarts.`, 5);
    state.missionStage = 0;
    state.missionTimer = 0;
    if (state.missionIndex === 2) addWanted(3); // Heat restarts too — dying must not skip the evade.
  }

  reset();

  return {
    state, buildings, reset, step, applySave, respawnAfterDeath,
    markerPos, mission, missionStageDef, nearestStealable,
    setMessage, setRadio, addWanted, completeMission,
    // Traffic-light state for the renderer: one entry per signalised
    // intersection, with the north-south green flag for this moment.
    lightState() {
      return TRAFFIC_LIGHTS.map(([x, z, off]) => ({
        x, z, nsGreen: ((state.time + off) % LIGHT_CYCLE) < LIGHT_CYCLE / 2,
      }));
    },
  };
}

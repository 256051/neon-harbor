// Neon Harbor — the simulation. Pure game logic: no three.js, no DOM, no
// audio in here, so the whole city can be stepped headlessly (the screenshot
// scenes and the benchmark do exactly that). One fixed step is 1/60 s.
//
// The city: a 9x9 street grid (streets every 42 m), 128 buildings on the
// blocks, traffic and pedestrians, parked cars, police, thugs, cash pickups
// and three missions. The player walks, steals cars, and drives; the wanted
// level is a token budget — stars hand out chase tokens, and a police car
// without a token only patrols instead of joining the chase.
//
// step() returns a bitmask of events for the frame (sound, HUD toasts and the
// camera shake all read it); the renderer and the HUD never poke at the
// simulation's internals directly.
import { createRandom } from './random.js';
import {
  PITCH, STREETS, CITY_HALF, STREET_HALF, STEP,
  PLAYER, CAR, FEEL, AI_POLICE, AI_TRAFFIC, AI_PED, AI_THUG,
  TRAFFIC_LIGHTS, LIGHT_CYCLE,
  TRAFFIC_COUNT, PARKED_COUNT, PED_COUNT, PICKUP_COUNT,
  WANTED_MAX, WANTED_DECAY_CRIME_FREE, WANTED_DECAY_EVERY,
  START_CASH, PICKUP_VALUE, THUG_REWARD, DEATH_PENALTY,
  MISSIONS, SAVE_KEY, BEST_KEY, PALETTE,
} from './config.js';

export const EVENT_START = 1;
export const EVENT_CRASH = 2;
export const EVENT_MONEY = 4;
export const EVENT_WANTED = 8;
export const EVENT_PUNCH = 16;
export const EVENT_SHOOT = 32;
export const EVENT_SHOT_HIT = 64;
export const EVENT_SHOT_MISS = 128;
export const EVENT_POLICE_RAM = 256;
export const EVENT_HORN = 512;
export const EVENT_MISSION = 1024;
export const EVENT_WIN = 2048;
export const EVENT_LOSE = 4096;
export const EVENT_CAR_HIT = 8192;
export const EVENT_PICKUP = 16384;
export const EVENT_THUG_HIT = 32768;
export const EVENT_STEP = 65536;

export function streetCoord(i) {
  return (i - (STREETS - 1) / 2) * PITCH;
}

export function isOnRoad(x, z) {
  for (let i = 0; i < STREETS; i += 1) {
    const c = streetCoord(i);
    if (Math.abs(x - c) < STREET_HALF + 1.5) return true;
    if (Math.abs(z - c) < STREET_HALF + 1.5) return true;
  }
  return false;
}

export function clampToCity(x, z) {
  const limit = CITY_HALF + PITCH / 2;
  return [Math.max(-limit, Math.min(limit, x)), Math.max(-limit, Math.min(limit, z))];
}

function dist2(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function makeCar(id, x, z, heading, color, type) {
  return {
    id, x, z, heading, color, type,
    speed: 0, health: CAR.health, driver: null,
    wrecked: false, brakeLight: false,
    // traffic AI
    cruise: 0, axis: 'x', dir: 1, stopped: false,
    // police AI
    state: 'patrol', targetX: 0, targetZ: 0, lastSeenX: 0, lastSeenZ: 0,
    unseenTime: 0, ramCooldown: 0, sirenTime: 0,
    // visual
    wheelSpin: 0, steering: 0,
  };
}

export function createWorld(seed = 1, opts = {}) {
  const rng = createRandom(seed);
  const quiet = opts.quiet === true;

  // --- City layout -------------------------------------------------------
  const buildings = [];
  for (let bx = 0; bx < STREETS - 1; bx += 1) {
    for (let bz = 0; bz < STREETS - 1; bz += 1) {
      const cx = (streetCoord(bx) + streetCoord(bx + 1)) / 2;
      const cz = (streetCoord(bz) + streetCoord(bz + 1)) / 2;
      const w = 16 + rng() * 14;
      const d = 16 + rng() * 14;
      const h = 8 + rng() * 26;
      buildings.push({
        x: cx, z: cz, w, d, h,
        facade: Math.floor(rng() * 6),
        color: 0xffffff,
        roof: rng() < 0.5,
      });
    }
  }
  // 8x8 blocks = 64; the brief wants 128, so each block carries two towers.
  const extra = [];
  for (const b of buildings) {
    extra.push({
      x: b.x + (b.w / 4) * (rng() < 0.5 ? -1 : 1),
      z: b.z + (b.d / 4) * (rng() < 0.5 ? -1 : 1),
      w: b.w * 0.45, d: b.d * 0.45, h: b.h * (0.5 + rng() * 0.7),
      facade: Math.floor(rng() * 6), color: 0xffffff, roof: rng() < 0.5,
    });
  }
  buildings.push(...extra);

  const streetlights = [];
  for (let i = 0; i < STREETS; i += 1) {
    for (let j = 0; j < STREETS; j += 1) {
      const c = streetCoord(i);
      const d = streetCoord(j);
      streetlights.push({ x: c + STREET_HALF + 1, z: d + STREET_HALF + 1 });
    }
  }

  const trafficLights = TRAFFIC_LIGHTS.map(([x, z, phase]) => ({ x, z, phase }));

  // --- Actors ------------------------------------------------------------
  const carColors = [0xc0392b, 0x2e86c1, 0x28b463, 0xf39c12, 0x8e44ad, 0x95a5a6, 0x1abc9c, 0xd35400];
  const cars = [];
  let carId = 0;

  // Parked cars along the streets (stealable).
  for (let i = 0; i < PARKED_COUNT; i += 1) {
    const along = streetCoord(Math.floor(rng() * STREETS));
    const across = streetCoord(Math.floor(rng() * STREETS)) + (rng() < 0.5 ? -1 : 1) * (STREET_HALF - 2);
    const horizontal = rng() < 0.5;
    const x = horizontal ? across : along + (rng() < 0.5 ? -1 : 1) * (STREET_HALF - 2);
    const z = horizontal ? along : across;
    const heading = horizontal ? (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (rng() < 0.5 ? 0 : Math.PI);
    cars.push(makeCar(carId++, x, z, heading, carColors[Math.floor(rng() * carColors.length)], 'parked'));
  }

  // Traffic cars, driving the grid.
  for (let i = 0; i < TRAFFIC_COUNT; i += 1) {
    const horizontal = rng() < 0.5;
    const lane = streetCoord(Math.floor(rng() * STREETS));
    const pos = (rng() * 2 - 1) * (CITY_HALF - 20);
    const dir = rng() < 0.5 ? 1 : -1;
    const car = makeCar(carId++, horizontal ? pos : lane + (dir > 0 ? -2 : 2), horizontal ? lane + (dir > 0 ? 2 : -2) : pos,
      horizontal ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI),
      carColors[Math.floor(rng() * carColors.length)], 'traffic');
    car.axis = horizontal ? 'x' : 'z';
    car.dir = dir;
    car.cruise = AI_TRAFFIC.cruiseMin + rng() * (AI_TRAFFIC.cruiseMax - AI_TRAFFIC.cruiseMin);
    car.speed = car.cruise;
    cars.push(car);
  }

  const peds = [];
  const pedColors = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0xe67e22, 0x1abc9c, 0xecf0f1];
  for (let i = 0; i < PED_COUNT; i += 1) {
    const horizontal = rng() < 0.5;
    const lane = streetCoord(Math.floor(rng() * STREETS));
    const pos = (rng() * 2 - 1) * (CITY_HALF - 10);
    const off = (rng() < 0.5 ? -1 : 1) * (STREET_HALF + 2.5);
    peds.push({
      x: horizontal ? pos : lane + off,
      z: horizontal ? lane + off : pos,
      heading: rng() * Math.PI * 2,
      speed: AI_PED.walkMin + rng() * (AI_PED.walkMax - AI_PED.walkMin),
      color: pedColors[Math.floor(rng() * pedColors.length)],
      state: 'walk', // walk | flee | down
      downTime: 0, fleeX: 0, fleeZ: 0, walkPhase: rng() * Math.PI * 2,
    });
  }

  const pickups = [];
  for (let i = 0; i < PICKUP_COUNT; i += 1) {
    const horizontal = rng() < 0.5;
    const lane = streetCoord(Math.floor(rng() * STREETS));
    const pos = (rng() * 2 - 1) * (CITY_HALF - 30);
    pickups.push({
      x: horizontal ? pos : lane + (rng() < 0.5 ? -1 : 1) * (STREET_HALF + 3),
      z: horizontal ? lane + (rng() < 0.5 ? -1 : 1) * (STREET_HALF + 3) : pos,
      taken: false, spin: rng() * Math.PI * 2,
    });
  }

  const police = [];

  const player = {
    x: 0, z: 84, heading: Math.PI, // facing -Z, downtown ahead
    vx: 0, vz: 0, speed: 0,
    health: PLAYER.health,
    onFoot: true, carId: -1,
    cash: START_CASH,
    walkPhase: 0, stepTimer: 0,
    shootCooldown: 0, punchCooldown: 0,
    invulnerable: 0,
  };

  const world = {
    seed, rng, quiet,
    // Monotonic car id counter: police spawns must never reuse an id (the
    // renderer keys car meshes by id, so a reused id after a despawn would
    // steal another car's mesh). world.cars.length is NOT safe here.
    nextCarId: carId,
    buildings, streetlights, trafficLights, cars, peds, pickups, police,
    player,
    time: 0,
    state: 'title', // title | playing | paused | dead | win
    wanted: 0,
    crimeFreeTime: 0,
    wantedDecayTimer: 0,
    missionIndex: 0,
    missionStage: 0,
    missionTimer: 0,
    missionStarted: false,
    missionToast: '',
    thugs: [],
    events: 0,
    best: 0,
    cameraShake: 0,
    stats: { carsStolen: 0, pedsHit: 0, thugsBeaten: 0, shotsFired: 0, shotsHit: 0 },
  };

  try {
    world.best = Number(localStorage.getItem(BEST_KEY) || 0) || 0;
  } catch { world.best = 0; }

  return world;
}

// --- Collisions ------------------------------------------------------------
// Circle vs building AABB: push the circle out and report the hit. The city
// boundary is a hard wall the same way.
export function collideCircle(world, x, z, radius) {
  let nx = x;
  let nz = z;
  let hit = false;
  for (const b of world.buildings) {
    const hx = b.w / 2;
    const hz = b.d / 2;
    const dx = nx - b.x;
    const dz = nz - b.z;
    if (Math.abs(dx) < hx + radius && Math.abs(dz) < hz + radius) {
      const px = hx + radius - Math.abs(dx);
      const pz = hz + radius - Math.abs(dz);
      if (px < pz) nx = b.x + (dx > 0 ? hx + radius : -(hx + radius));
      else nz = b.z + (dz > 0 ? hz + radius : -(hz + radius));
      hit = true;
    }
  }
  const [cx, cz] = clampToCity(nx, nz);
  if (cx !== nx || cz !== nz) { nx = cx; nz = cz; hit = true; }
  return [nx, nz, hit];
}

function nearestCar(world, x, z, maxDist) {
  let best = null;
  let bestD = maxDist * maxDist;
  for (const car of world.cars) {
    if (car.wrecked) continue;
    const d = dist2(x, z, car.x, car.z);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

function carAt(world, x, z) {
  return nearestCar(world, x, z, CAR.radius + 1.2);
}

// --- Player movement -------------------------------------------------------
function stepPlayerOnFoot(world, input, dt) {
  const p = world.player;
  const move = input.move || { fwd: 0, strafe: 0, sprint: false };
  const camYaw = input.camYaw || 0;
  const speed = move.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
  // Movement is camera-relative: W walks away from the camera.
  const sin = Math.sin(camYaw);
  const cos = Math.cos(camYaw);
  let mx = (-sin * move.fwd) + (cos * move.strafe);
  let mz = (-cos * move.fwd) - (sin * move.strafe);
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  const targetVx = mx * speed;
  const targetVz = mz * speed;
  p.vx += (targetVx - p.vx) * Math.min(1, PLAYER.accel * dt / speed);
  p.vz += (targetVz - p.vz) * Math.min(1, PLAYER.accel * dt / speed);
  const nx = p.x + p.vx * dt;
  const nz = p.z + p.vz * dt;
  const [cx, cz, hit] = collideCircle(world, nx, nz, PLAYER.radius);
  if (hit) { p.vx *= 0.4; p.vz *= 0.4; }
  p.x = cx;
  p.z = cz;
  p.speed = Math.hypot(p.vx, p.vz);
  if (p.speed > 0.5) {
    const targetHeading = Math.atan2(p.vx, p.vz);
    p.heading += angleDiff(targetHeading, p.heading) * Math.min(1, 12 * dt);
    p.walkPhase += p.speed * dt * 1.6;
    p.stepTimer -= dt;
    if (p.stepTimer <= 0 && p.speed > 2) {
      p.stepTimer = 0.34;
      world.events |= EVENT_STEP;
    }
  }
}

function stepPlayerCar(world, input, dt) {
  const p = world.player;
  const car = world.cars.find((c) => c.id === p.carId);
  if (!car || car.wrecked) {
    // The car was wrecked under the player: get out on foot.
    p.onFoot = true;
    p.carId = -1;
    return;
  }
  const drive = input.drive || { steer: 0, accel: 0, brake: false };
  const forward = drive.accel ? 1 : 0;
  const reversing = drive.brake && car.speed < 0.5;
  if (forward) {
    car.speed += CAR.accel * dt;
    if (car.speed > CAR.maxSpeed) car.speed = CAR.maxSpeed;
  } else if (reversing) {
    car.speed -= CAR.reverseAccel * dt;
    if (car.speed < -CAR.maxReverse) car.speed = -CAR.maxReverse;
  } else if (drive.brake) {
    // Braking from forward motion.
    car.speed = Math.max(0, car.speed - CAR.brake * dt);
  } else {
    car.speed -= car.speed * CAR.drag * dt;
    if (Math.abs(car.speed) < 0.1) car.speed = 0;
  }
  // Steering authority grows with speed but never flips at a standstill.
  const steerAuthority = Math.min(1, Math.abs(car.speed) / 8);
  car.heading += drive.steer * FEEL.carSteer * steerAuthority * dt * (car.speed >= 0 ? 1 : -1);
  car.steering = drive.steer;
  // Drift: keep most of the forward speed, shed the sideways slide.
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  const vx = fx * car.speed;
  const vz = fz * car.speed;
  const nx = car.x + vx * dt;
  const nz = car.z + vz * dt;
  const [cx, cz, hit] = collideCircle(world, nx, nz, CAR.radius);
  if (hit) {
    const impact = Math.abs(car.speed);
    car.speed *= -0.25;
    if (impact > 12) {
      car.health -= Math.round((impact - 12) * 1.5);
      world.events |= EVENT_CRASH;
      world.cameraShake = Math.min(1, impact / 30);
      if (car.health <= 0) wreckCar(world, car);
    }
  }
  car.x = cx;
  car.z = cz;
  car.wheelSpin += car.speed * dt * 2;
  car.brakeLight = !!drive.brake;
  // Car vs car: push apart, damage on a hard hit.
  for (const other of world.cars) {
    if (other === car || other.wrecked) continue;
    const d2 = dist2(car.x, car.z, other.x, other.z);
    const min = CAR.radius * 2;
    if (d2 < min * min && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      const push = (min - d) / 2;
      const ux = (car.x - other.x) / d;
      const uz = (car.z - other.z) / d;
      car.x += ux * push;
      car.z += uz * push;
      other.x -= ux * push;
      other.z -= uz * push;
      const rel = Math.abs(car.speed - other.speed);
      if (rel > 8) {
        world.events |= EVENT_CAR_HIT;
        car.health -= Math.round(rel * 0.5);
        other.health -= Math.round(rel * 0.5);
        if (car.health <= 0) wreckCar(world, car);
        if (other.health <= 0) wreckCar(world, other);
      }
    }
  }
  // Car vs pedestrian: a hit knocks the walker down and is a crime.
  for (const ped of world.peds) {
    if (ped.state === 'down') continue;
    const d2 = dist2(car.x, car.z, ped.x, ped.z);
    if (d2 < (CAR.radius + 0.8) * (CAR.radius + 0.8) && Math.abs(car.speed) > 2) {
      ped.state = 'down';
      ped.downTime = 4;
      world.stats.pedsHit += 1;
      world.events |= EVENT_CRASH;
      addWanted(world, 1);
    }
  }
  // The player rides the car.
  p.x = car.x;
  p.z = car.z;
  p.heading = car.heading;
  p.speed = Math.abs(car.speed);
}

function wreckCar(world, car) {
  car.wrecked = true;
  car.speed = 0;
  if (world.player.carId === car.id) {
    world.player.onFoot = true;
    world.player.carId = -1;
    world.player.x = car.x + Math.sin(car.heading + Math.PI / 2) * 3;
    world.player.z = car.z + Math.cos(car.heading + Math.PI / 2) * 3;
  }
}

function tryEnterCar(world) {
  const p = world.player;
  if (!p.onFoot) return;
  const car = nearestCar(world, p.x, p.z, 3.5);
  if (!car) return;
  const wasParked = car.type === 'parked';
  car.driver = 'player';
  car.type = 'player';
  p.onFoot = false;
  p.carId = car.id;
  p.x = car.x;
  p.z = car.z;
  if (wasParked) {
    world.stats.carsStolen += 1;
    addWanted(world, 1);
    world.events |= EVENT_WANTED;
  }
  world.events |= EVENT_MONEY;
}

function tryExitCar(world) {
  const p = world.player;
  if (p.onFoot) return;
  const car = world.cars.find((c) => c.id === p.carId);
  if (car) {
    car.driver = null;
    car.type = 'parked';
    car.speed = 0;
  }
  p.onFoot = true;
  p.carId = -1;
  if (car) {
    p.x = car.x + Math.sin(car.heading + Math.PI / 2) * 3;
    p.z = car.z + Math.cos(car.heading + Math.PI / 2) * 3;
    const [cx, cz] = collideCircle(world, p.x, p.z, PLAYER.radius);
    p.x = cx;
    p.z = cz;
  }
}

// --- Traffic -----------------------------------------------------------------
function lightState(world, light) {
  const t = (world.time + light.phase) % LIGHT_CYCLE;
  return t < LIGHT_CYCLE / 2 ? 'ns' : 'ew'; // which axis has green
}

function stepTraffic(world, dt) {
  const p = world.player;
  for (const car of world.cars) {
    if (car.type !== 'traffic') continue;
    if (car.wrecked) continue;
    // Red light ahead: stop behind the line.
    let stopped = false;
    for (const light of world.trafficLights) {
      const green = lightState(world, light);
      const axisGreen = car.axis === 'x' ? green === 'ew' : green === 'ns';
      if (axisGreen) continue;
      const dx = light.x - car.x;
      const dz = light.z - car.z;
      const ahead = car.axis === 'x' ? dx * car.dir : dz * car.dir;
      const lateral = car.axis === 'x' ? Math.abs(dz) : Math.abs(dx);
      if (ahead > 0 && ahead < AI_TRAFFIC.stopDist && lateral < STREET_HALF) { stopped = true; break; }
    }
    // Car ahead on the same lane: stop behind it.
    if (!stopped) {
      for (const other of world.cars) {
        if (other === car || other.wrecked) continue;
        const dx = other.x - car.x;
        const dz = other.z - car.z;
        const ahead = car.axis === 'x' ? dx * car.dir : dz * car.dir;
        const lateral = car.axis === 'x' ? Math.abs(dz) : Math.abs(dx);
        if (ahead > 0 && ahead < 9 && lateral < 3) { stopped = true; break; }
      }
    }
    car.stopped = stopped;
    if (stopped) {
      car.speed = Math.max(0, car.speed - 20 * dt);
    } else {
      car.speed += (car.cruise - car.speed) * Math.min(1, 2 * dt);
    }
    // At an intersection, sometimes turn onto the cross street.
    if (!stopped && world.rng() < AI_TRAFFIC.turnChance && nearIntersection(world, car)) {
      turnTrafficCar(world, car);
    }
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    const nx = car.x + fx * car.speed * dt;
    const nz = car.z + fz * car.speed * dt;
    const [cx, cz, hit] = collideCircle(world, nx, nz, CAR.radius);
    if (hit) car.speed = 0;
    car.x = cx;
    car.z = cz;
    car.wheelSpin += car.speed * dt * 2;
    // Wrap around the city edge so traffic never runs out.
    if (car.axis === 'x' && Math.abs(car.x) > CITY_HALF + 20) { car.x = -Math.sign(car.x) * (CITY_HALF + 20); }
    if (car.axis === 'z' && Math.abs(car.z) > CITY_HALF + 20) { car.z = -Math.sign(car.z) * (CITY_HALF + 20); }
    // Honk if the player blocks the road ahead.
    if (!stopped && dist2(car.x, car.z, p.x, p.z) < 100 && Math.abs(car.speed) > 1) {
      const dx = p.x - car.x;
      const dz = p.z - car.z;
      const ahead = car.axis === 'x' ? dx * car.dir : dz * car.dir;
      if (ahead > 0 && ahead < 12) world.events |= EVENT_HORN;
    }
  }
}

function nearIntersection(world, car) {
  for (let i = 0; i < STREETS; i += 1) {
    const c = streetCoord(i);
    if (Math.abs(car.x - c) < 3 && Math.abs(car.z - c) < 3) return true;
  }
  return false;
}

function turnTrafficCar(world, car) {
  // Turn left or right onto the cross street: swap axis, keep direction.
  const turn = world.rng() < 0.5 ? 1 : -1;
  if (car.axis === 'x') {
    car.axis = 'z';
    car.heading = car.dir > 0 ? (turn > 0 ? 0 : Math.PI) : (turn > 0 ? Math.PI : 0);
    car.dir = car.heading === 0 ? 1 : -1;
  } else {
    car.axis = 'x';
    car.heading = car.dir > 0 ? (turn > 0 ? Math.PI / 2 : -Math.PI / 2) : (turn > 0 ? -Math.PI / 2 : Math.PI / 2);
    car.dir = car.heading === Math.PI / 2 ? 1 : -1;
  }
}

// --- Police ------------------------------------------------------------------
function wantedChasers(world) {
  // The wanted level is a token budget: at most maxChasers chase at once.
  return Math.min(world.wanted, AI_POLICE.maxChasers);
}

function spawnPolice(world) {
  const p = world.player;
  const wanted = wantedChasers(world);
  const active = world.police.filter((c) => !c.wrecked).length;
  for (let i = active; i < wanted; i += 1) {
    const angle = world.rng() * Math.PI * 2;
    const x = p.x + Math.sin(angle) * AI_POLICE.spawnDist;
    const z = p.z + Math.cos(angle) * AI_POLICE.spawnDist;
    const [cx, cz] = clampToCity(x, z);
    const car = makeCar(world.nextCarId++, cx, cz, Math.atan2(p.x - cx, p.z - cz), PALETTE.policeBody, 'police');
    car.driver = 'police';
    car.state = 'chase';
    car.speed = 10;
    world.cars.push(car);
    world.police.push(car);
  }
}

function stepPolice(world, dt) {
  const p = world.player;
  for (const car of world.police) {
    if (car.wrecked) continue;
    if (car.driver === 'player') continue; // the player stole this cruiser: it is theirs now, not a chaser
    car.sirenTime += dt;
    const d2 = dist2(car.x, car.z, p.x, p.z);
    const dist = Math.sqrt(d2);
    if (world.wanted === 0) {
      // No heat: patrol the perimeter and leave.
      car.state = 'patrol';
      const px = Math.sin(world.time * 0.05 + car.id) * AI_POLICE.patrolRadius;
      const pz = Math.cos(world.time * 0.05 + car.id) * AI_POLICE.patrolRadius;
      car.targetX = px;
      car.targetZ = pz;
      if (dist > AI_POLICE.despawnDist) {
        car.wrecked = true; // despawned
        world.cars = world.cars.filter((c) => c !== car);
        world.police = world.police.filter((c) => c !== car);
        continue;
      }
    } else if (dist < 30) {
      car.unseenTime = 0;
      car.lastSeenX = p.x;
      car.lastSeenZ = p.z;
      car.state = 'chase';
    } else {
      car.unseenTime += dt;
      if (car.unseenTime > AI_POLICE.searchDelay) car.state = 'search';
    }
    if (car.state === 'chase') {
      car.targetX = p.x;
      car.targetZ = p.z;
    } else if (car.state === 'search') {
      car.targetX = car.lastSeenX;
      car.targetZ = car.lastSeenZ;
    }
    const targetHeading = Math.atan2(car.targetX - car.x, car.targetZ - car.z);
    car.heading += angleDiff(targetHeading, car.heading) * Math.min(1, 3 * dt);
    const targetSpeed = car.state === 'chase' ? AI_POLICE.chaseSpeed : 12;
    car.speed += (targetSpeed - car.speed) * Math.min(1, 1.5 * dt);
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    const nx = car.x + fx * car.speed * dt;
    const nz = car.z + fz * car.speed * dt;
    const [cx, cz, hit] = collideCircle(world, nx, nz, CAR.radius);
    if (hit) car.speed *= 0.5;
    car.x = cx;
    car.z = cz;
    car.wheelSpin += car.speed * dt * 2;
    // Ram the player when close and fast enough.
    car.ramCooldown -= dt;
    if (car.state === 'chase' && dist < CAR.radius + 1.5 && car.speed > AI_POLICE.ramMinSpeed && car.ramCooldown <= 0) {
      car.ramCooldown = AI_POLICE.ramCooldown;
      damagePlayer(world, AI_POLICE.ramDamage);
      world.events |= EVENT_POLICE_RAM;
      world.cameraShake = 0.8;
      if (p.onFoot) {
        p.vx += Math.sin(car.heading) * 8;
        p.vz += Math.cos(car.heading) * 8;
      }
    }
    // Police cars push traffic and parked cars aside.
    for (const other of world.cars) {
      if (other === car || other.wrecked || other.type === 'police') continue;
      const od2 = dist2(car.x, car.z, other.x, other.z);
      if (od2 < (CAR.radius * 2) * (CAR.radius * 2) && od2 > 0.0001) {
        const od = Math.sqrt(od2);
        const push = (CAR.radius * 2 - od) / 2;
        const ux = (car.x - other.x) / od;
        const uz = (car.z - other.z) / od;
        other.x -= ux * push;
        other.z -= uz * push;
      }
    }
  }
  // Siren sting every few seconds while chased.
  if (world.wanted > 0 && world.police.some((c) => !c.wrecked && c.state === 'chase')) {
    if (Math.floor(world.time * 2) !== Math.floor((world.time - dt) * 2)) {
      // handled by main.js reading the siren clock; kept as a state flag here
    }
  }
}

function damagePlayer(world, amount) {
  const p = world.player;
  if (p.invulnerable > 0) return;
  p.health -= amount;
  p.invulnerable = 0.5;
  if (p.health <= 0) {
    p.health = 0;
    killPlayer(world);
  }
}

function killPlayer(world) {
  const p = world.player;
  world.state = 'dead';
  p.cash = Math.max(0, p.cash - DEATH_PENALTY);
  world.events |= EVENT_LOSE;
}

// --- Pedestrians ---------------------------------------------------------------
function stepPeds(world, dt) {
  const p = world.player;
  const playerCar = !p.onFoot ? world.cars.find((c) => c.id === p.carId) : null;
  const playerSpeed = playerCar ? Math.abs(playerCar.speed) : p.speed;
  for (const ped of world.peds) {
    if (ped.state === 'down') {
      ped.downTime -= dt;
      if (ped.downTime <= 0) {
        ped.state = 'walk';
        ped.x += (world.rng() - 0.5) * 4;
        ped.z += (world.rng() - 0.5) * 4;
      }
      continue;
    }
    // Flee a fast car or a gunshot nearby.
    const threatD = dist2(ped.x, ped.z, p.x, p.z);
    const scared = (playerSpeed > 8 && threatD < AI_PED.fleeRadius * AI_PED.fleeRadius)
      || (world.events & EVENT_SHOOT && threatD < AI_PED.senseRadius * AI_PED.senseRadius);
    if (scared) {
      ped.state = 'flee';
      const d = Math.sqrt(threatD) || 1;
      ped.fleeX = (ped.x - p.x) / d;
      ped.fleeZ = (ped.z - p.z) / d;
    } else if (ped.state === 'flee' && threatD > AI_PED.senseRadius * AI_PED.senseRadius) {
      ped.state = 'walk';
    }
    const speed = ped.state === 'flee' ? AI_PED.fleeSpeed : ped.speed;
    if (ped.state === 'flee') {
      ped.heading = Math.atan2(ped.fleeX, ped.fleeZ);
    } else if (world.rng() < 0.002) {
      ped.heading += (world.rng() - 0.5) * Math.PI;
    }
    const nx = ped.x + Math.sin(ped.heading) * speed * dt;
    const nz = ped.z + Math.cos(ped.heading) * speed * dt;
    const [cx, cz, hit] = collideCircle(world, nx, nz, 0.5);
    if (hit) ped.heading += Math.PI / 2;
    ped.x = cx;
    ped.z = cz;
    ped.walkPhase += speed * dt * 2;
  }
}

// --- Thugs ---------------------------------------------------------------------
function spawnThugs(world, x, z, count) {
  for (let i = 0; i < count; i += 1) {
    world.thugs.push({
      x: x + (world.rng() - 0.5) * 10,
      z: z + (world.rng() - 0.5) * 10,
      spawnX: x, spawnZ: z,
      heading: world.rng() * Math.PI * 2,
      hp: AI_THUG.hp,
      state: 'idle', // idle | chase | windup | punch
      windup: 0, cooldown: 0, walkPhase: world.rng() * Math.PI * 2,
      color: 0x7b2d26,
    });
  }
}

function stepThugs(world, dt) {
  const p = world.player;
  for (const thug of world.thugs) {
    if (thug.hp <= 0) continue;
    thug.cooldown -= dt;
    const d2 = dist2(thug.x, thug.z, p.x, p.z);
    const dist = Math.sqrt(d2);
    if (thug.state === 'windup') {
      thug.windup -= dt;
      if (thug.windup <= 0) {
        thug.state = 'chase';
        if (dist < AI_THUG.punchRange + 0.6) {
          damagePlayer(world, AI_THUG.punchDamage);
          world.events |= EVENT_THUG_HIT;
        }
      }
      continue;
    }
    if (dist < AI_THUG.senseRadius && world.state === 'playing') {
      thug.state = 'chase';
      const targetHeading = Math.atan2(p.x - thug.x, p.z - thug.z);
      thug.heading += angleDiff(targetHeading, thug.heading) * Math.min(1, 6 * dt);
      if (dist < AI_THUG.punchRange) {
        if (thug.cooldown <= 0) {
          thug.state = 'windup';
          thug.windup = AI_THUG.windup;
          thug.cooldown = AI_THUG.punchCooldown;
        }
      } else if (dist < AI_THUG.chaseRange) {
        thug.x += Math.sin(thug.heading) * AI_THUG.speed * dt;
        thug.z += Math.cos(thug.heading) * AI_THUG.speed * dt;
        thug.walkPhase += AI_THUG.speed * dt * 2;
      }
    } else {
      // Return to the spawn point.
      const home = dist2(thug.x, thug.z, thug.spawnX, thug.spawnZ);
      if (home > 4) {
        const targetHeading = Math.atan2(thug.spawnX - thug.x, thug.spawnZ - thug.z);
        thug.heading += angleDiff(targetHeading, thug.heading) * Math.min(1, 6 * dt);
        thug.x += Math.sin(thug.heading) * AI_THUG.speed * 0.5 * dt;
        thug.z += Math.cos(thug.heading) * AI_THUG.speed * 0.5 * dt;
        thug.walkPhase += AI_THUG.speed * dt;
      } else {
        thug.state = 'idle';
      }
    }
    const [cx, cz] = collideCircle(world, thug.x, thug.z, 0.6);
    thug.x = cx;
    thug.z = cz;
  }
  world.thugs = world.thugs.filter((t) => t.hp > 0);
}

// --- Combat ------------------------------------------------------------------
function tryPunch(world) {
  const p = world.player;
  if (!p.onFoot || p.punchCooldown > 0) return;
  p.punchCooldown = 0.45;
  world.events |= EVENT_PUNCH;
  // Hit the nearest thug or pedestrian inside the forward cone.
  let best = null;
  let bestD = PLAYER.punchRange * PLAYER.punchRange;
  for (const thug of world.thugs) {
    if (thug.hp <= 0) continue;
    const d2 = dist2(p.x, p.z, thug.x, thug.z);
    if (d2 < bestD && Math.abs(angleDiff(Math.atan2(thug.x - p.x, thug.z - p.z), p.heading)) < PLAYER.punchArc / 2) {
      bestD = d2; best = thug;
    }
  }
  if (best) {
    best.hp -= PLAYER.punchDamage;
    world.events |= EVENT_THUG_HIT;
    if (best.hp <= 0) {
      p.cash += THUG_REWARD;
      world.stats.thugsBeaten += 1;
      world.events |= EVENT_MONEY;
    }
    return;
  }
  for (const ped of world.peds) {
    if (ped.state === 'down') continue;
    const d2 = dist2(p.x, p.z, ped.x, ped.z);
    if (d2 < bestD && Math.abs(angleDiff(Math.atan2(ped.x - p.x, ped.z - p.z), p.heading)) < PLAYER.punchArc / 2) {
      bestD = d2; best = ped;
    }
  }
  if (best) {
    best.state = 'down';
    best.downTime = 5;
    addWanted(world, 1);
    world.events |= EVENT_WANTED;
  }
}

function tryShoot(world, camYaw) {
  const p = world.player;
  if (p.shootCooldown > 0) return;
  p.shootCooldown = PLAYER.shootCooldown;
  world.stats.shotsFired += 1;
  world.events |= EVENT_SHOOT;
  addWanted(world, 1);
  // Hitscan from the player along the camera yaw: the nearest actor or car
  // inside a narrow cone and inside range takes the hit.
  const dirX = -Math.sin(camYaw);
  const dirZ = -Math.cos(camYaw);
  let best = null;
  let bestD = PLAYER.shootRange;
  let bestKind = null;
  const consider = (x, z, kind, ref) => {
    const dx = x - p.x;
    const dz = z - p.z;
    const along = dx * dirX + dz * dirZ;
    if (along < 1 || along > bestD) return;
    const perp = Math.abs(dx * dirZ - dz * dirX);
    if (perp < 1.2 + along * 0.03) { bestD = along; best = ref; bestKind = kind; }
  };
  for (const thug of world.thugs) if (thug.hp > 0) consider(thug.x, thug.z, 'thug', thug);
  for (const ped of world.peds) if (ped.state !== 'down') consider(ped.x, ped.z, 'ped', ped);
  for (const car of world.cars) {
    if (car.wrecked || car.driver === 'player') continue;
    consider(car.x, car.z, 'car', car);
  }
  if (!best) {
    world.events |= EVENT_SHOT_MISS;
    return;
  }
  world.stats.shotsHit += 1;
  world.events |= EVENT_SHOT_HIT;
  if (bestKind === 'thug') {
    best.hp -= PLAYER.shootDamage;
    if (best.hp <= 0) {
      p.cash += THUG_REWARD;
      world.stats.thugsBeaten += 1;
      world.events |= EVENT_MONEY;
    }
  } else if (bestKind === 'ped') {
    best.state = 'down';
    best.downTime = 6;
  } else if (bestKind === 'car') {
    best.health -= PLAYER.shootDamage;
    if (best.health <= 0) wreckCar(world, best);
  }
}

// --- Wanted --------------------------------------------------------------------
function addWanted(world, amount) {
  const before = world.wanted;
  world.wanted = Math.min(WANTED_MAX, world.wanted + amount);
  world.crimeFreeTime = 0;
  world.wantedDecayTimer = 0;
  if (world.wanted > before) {
    world.events |= EVENT_WANTED;
    spawnPolice(world);
  }
}

function stepWanted(world, dt) {
  if (world.wanted === 0) return;
  world.crimeFreeTime += dt;
  // Decay only once the player has been quiet AND no chaser is close.
  const chaserNear = world.police.some((c) => !c.wrecked && c.state === 'chase' && dist2(c.x, c.z, world.player.x, world.player.z) < 30 * 30);
  if (world.crimeFreeTime > WANTED_DECAY_CRIME_FREE && !chaserNear) {
    world.wantedDecayTimer += dt;
    if (world.wantedDecayTimer >= WANTED_DECAY_EVERY) {
      world.wantedDecayTimer = 0;
      world.wanted = Math.max(0, world.wanted - 1);
      if (world.wanted === 0) world.events |= EVENT_WANTED;
    }
  }
}

// --- Missions --------------------------------------------------------------------
export function missionDef(world) {
  return MISSIONS[world.missionIndex] || null;
}

export function missionStageDef(world) {
  const def = missionDef(world);
  if (!def) return null;
  return def.stages[world.missionStage] || null;
}

export function missionText(world) {
  const def = missionDef(world);
  if (!def) return 'All missions complete — the harbor is yours.';
  const stage = missionStageDef(world);
  if (!stage) return def.title;
  return stage.text;
}

function startMission(world, index) {
  const def = MISSIONS[index];
  if (!def) return;
  world.missionIndex = index;
  world.missionStage = 0;
  world.missionStarted = true;
  world.missionTimer = 0;
  world.missionToast = def.intro;
  if (index === 2) {
    // Heat opens with the whole city on the player.
    world.wanted = 3;
    world.crimeFreeTime = 0;
    spawnPolice(world);
  }
  world.events |= EVENT_MISSION;
}

function completeMission(world) {
  const def = missionDef(world);
  if (!def) return;
  world.player.cash += def.reward;
  world.events |= EVENT_MONEY | EVENT_MISSION;
  world.missionToast = `${def.title} complete — $${def.reward}`;
  world.missionIndex += 1;
  world.missionStage = 0;
  world.missionTimer = 0;
  if (world.missionIndex >= MISSIONS.length) {
    world.state = 'win';
    world.events |= EVENT_WIN;
    saveBest(world);
  } else {
    startMission(world, world.missionIndex);
  }
}

function stepMission(world, dt) {
  const def = missionDef(world);
  if (!def || world.state !== 'playing') return;
  const stage = missionStageDef(world);
  if (!stage) return;
  const p = world.player;
  if (stage.timer && world.missionStage === 1) {
    world.missionTimer -= dt;
    if (world.missionTimer <= 0) {
      // Too slow: the run fails and the mission restarts from its first stage.
      world.missionStage = 0;
      world.missionTimer = 0;
      world.missionToast = 'Too slow — the package is gone. Try the run again.';
      world.events |= EVENT_MISSION;
      return;
    }
  }
  if (world.missionIndex === 0 && world.missionStage === 0) {
    // First Wheels: stealing any car opens the drive stage.
    if (!p.onFoot) {
      world.missionStage = 1;
      world.missionToast = 'Wheels acquired — now drive to the Docks.';
      world.events |= EVENT_MISSION;
    }
    return;
  }
  if (world.missionIndex === 2 && world.missionStage === 0) {
    // Heat: lose the wanted level first.
    if (world.wanted === 0) {
      world.missionStage = 1;
      world.missionToast = 'Heat is off — get to the Hideout.';
      world.events |= EVENT_MISSION;
    }
    return;
  }
  if (stage.target) {
    const d2 = dist2(p.x, p.z, stage.target[0], stage.target[1]);
    if (d2 < stage.radius * stage.radius) {
      if (world.missionIndex === 1 && world.missionStage === 0) {
        // Night Run pickup: thugs are waiting at the warehouse.
        spawnThugs(world, stage.target[0], stage.target[1], 3);
        world.missionStage = 1;
        world.missionTimer = stage.timer || 0;
        // The timer lives on the second stage; set it from that stage's def.
        world.missionTimer = MISSIONS[1].stages[1].timer;
        world.missionToast = 'Package grabbed — thugs! Get to the Marina, fast.';
        world.events |= EVENT_MISSION;
        return;
      }
      completeMission(world);
    }
  }
}

// --- Pickups ---------------------------------------------------------------------
function stepPickups(world) {
  const p = world.player;
  for (const pickup of world.pickups) {
    if (pickup.taken) continue;
    pickup.spin += 0.02;
    const d2 = dist2(p.x, p.z, pickup.x, pickup.z);
    if (d2 < 2.5 * 2.5) {
      pickup.taken = true;
      p.cash += PICKUP_VALUE;
      world.events |= EVENT_PICKUP | EVENT_MONEY;
    }
  }
}

// --- Save / load -------------------------------------------------------------------
function saveBest(world) {
  const score = world.player.cash;
  if (score > world.best) {
    world.best = score;
    try { localStorage.setItem(BEST_KEY, String(score)); } catch { /* private mode */ }
  }
}

export function getSave(world) {
  return {
    cash: world.player.cash,
    missionIndex: world.missionIndex,
    missionStage: world.missionStage,
    wanted: world.wanted,
    x: world.player.x, z: world.player.z,
    best: world.best,
  };
}

export function loadSave(world, save) {
  if (!save) return false;
  world.player.cash = save.cash ?? START_CASH;
  world.missionIndex = save.missionIndex ?? 0;
  world.missionStage = save.missionStage ?? 0;
  world.wanted = save.wanted ?? 0;
  if (typeof save.x === 'number' && typeof save.z === 'number') {
    world.player.x = save.x;
    world.player.z = save.z;
  }
  world.best = save.best ?? world.best;
  world.missionStarted = world.missionIndex > 0 || world.missionStage > 0;
  return true;
}

export function readSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function writeSave(world) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(getSave(world))); } catch { /* private mode */ }
}

// --- Public control ---------------------------------------------------------------
export function startGame(world) {
  world.state = 'playing';
  world.events |= EVENT_START;
  if (!world.missionStarted) startMission(world, 0);
}

export function pauseGame(world) {
  if (world.state === 'playing') world.state = 'paused';
}

export function resumeGame(world) {
  if (world.state === 'paused') world.state = 'playing';
}

export function restartGame(world) {
  const seed = world.seed;
  const fresh = createWorld(seed, { quiet: world.quiet });
  // Keep the persistent best across restarts.
  fresh.best = world.best;
  Object.keys(world).forEach((k) => { delete world[k]; });
  Object.assign(world, fresh);
  world.state = 'playing';
  startMission(world, 0);
}

// --- The step -----------------------------------------------------------------------
export function stepWorld(world, input, dt) {
  world.events = 0;
  if (world.state !== 'playing') return world.events;
  world.time += dt;
  const p = world.player;
  if (p.invulnerable > 0) p.invulnerable -= dt;
  // Any path that zeroes health kills the player — the death is decided here,
  // not only inside damagePlayer, so no state can leave a dead player walking.
  if (p.health <= 0) killPlayer(world);
  if (world.state !== 'playing') return world.events;
  if (p.shootCooldown > 0) p.shootCooldown -= dt;
  if (p.punchCooldown > 0) p.punchCooldown -= dt;
  if (world.cameraShake > 0) world.cameraShake = Math.max(0, world.cameraShake - dt * 2);

  const actions = input.actions || 0;
  if (actions & 4) { // INTERACT
    if (p.onFoot) tryEnterCar(world);
    else tryExitCar(world);
  }
  if (actions & 8) tryPunch(world); // PUNCH
  if (actions & 16) tryShoot(world, input.camYaw || 0); // SHOOT
  // One-shot actions fire once per frame, not once per fixed step: main.js
  // feeds the same input object to every step of a frame, and on a slow
  // machine a frame is 30 steps — without this, one E press would enter
  // the car on step 1 and get straight back out on step 2.
  input.actions = 0;

  if (p.onFoot) stepPlayerOnFoot(world, input, dt);
  else stepPlayerCar(world, input, dt);

  stepTraffic(world, dt);
  stepPolice(world, dt);
  stepPeds(world, dt);
  stepThugs(world, dt);
  stepWanted(world, dt);
  stepMission(world, dt);
  stepPickups(world);

  // Police numbers follow the wanted level.
  if (world.wanted > 0) spawnPolice(world);

  // Periodic autosave while playing.
  if (Math.floor(world.time) !== Math.floor(world.time - dt) && Math.floor(world.time) % 10 === 0) {
    writeSave(world);
  }
  if (world.state === 'win') saveBest(world);
  return world.events;
}

// Neon Harbor — the world: the city, its people and cars, the wanted system and
// the three-mission story. Pure simulation, no rendering here; render.js draws
// whatever this file describes.

import { CFG, starsForHeat, policeBudget } from './config.js';
import { makeRng, range, intRange, pick, shuffle } from './random.js';

const TAU = Math.PI * 2;

function angleTo(ax, az, bx, bz) {
  return Math.atan2(bx - ax, bz - az);
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

const CAR_COLORS = [0x3a6ea5, 0x9e2b25, 0x2e6b4f, 0xc7a23a, 0x6b5b95, 0x888888, 0x33555e, 0x7a4a21];
const BUILDING_COLORS = [0x5a4a3a, 0x4a3a4a, 0x3d4a5a, 0x5a5248, 0x46384a, 0x3a4a42, 0x6b5a48, 0x4a4640];

export class World {
  constructor(seed) {
    this.seed = seed;
    this.rng = makeRng(seed);
    this.time = 0;
    this.state = 'title'; // title | playing | paused | dead | complete
    this.events = [];
    this.cameraYaw = 0; // set by main.js every frame; movement is relative to it

    // Street lines: 10 vertical and 10 horizontal, 58 m apart.
    this.pitch = CFG.blockSize + CFG.streetWidth;
    this.streetLines = [];
    for (let i = 0; i <= 9; i++) this.streetLines.push(-261 + i * this.pitch);
    this.cityHalf = 268;

    this.buildCity();
    this.buildPopulation();

    this.player = {
      x: -196, z: 168, angle: 0, hp: CFG.playerHealth,
      onFoot: true, car: null, speed: 0, vx: 0, vz: 0,
      punchTimer: 0, shotTimer: 0, run: false,
    };
    this.money = 0;
    this.bestMoney = 0;
    this.heat = 0;
    this.stars = 0;
    this.calmTimer = 0;
    this.ramCooldown = 0; // seconds until the next ram can add heat/damage
    this.police = [];
    this.policeId = 0;
    this.missionIndex = 0;
    this.missionStage = 0;
    this.missions = this.buildMissions();
    this.radioText = '';
    this.radioShown = 0;
    this.toast = '';
    this.toastTimer = 0;
    this.missionJustDone = false;
    this.missionDoneTimer = 0;
    this.shotsFired = 0;
    this.carsStolen = 0;
  }

  // ------------------------------------------------------------ city

  buildCity() {
    const rng = this.rng;
    this.buildings = [];
    this.windows = [];
    this.lamps = [];
    // Two plaza blocks stay open: the centre square and one in the south-west.
    const plazas = new Set(['4,4', '1,7']);
    for (let bx = 0; bx < 9; bx++) {
      for (let bz = 0; bz < 9; bz++) {
        if (plazas.has(`${bx},${bz}`)) continue;
        const cx = -232 + bx * this.pitch;
        const cz = -232 + bz * this.pitch;
        const spots = rng() < 0.55 ? 2 : 1;
        for (let s = 0; s < spots; s++) {
          const w = range(rng, 13, 26);
          const d = range(rng, 13, 26);
          const h = range(rng, 8, 40) * (rng() < 0.14 ? 1.7 : 1);
          const ox = s === 0 ? range(rng, -6, 6) : range(rng, -9, 9);
          const oz = s === 0 ? range(rng, -6, 6) : range(rng, -9, 9);
          this.buildings.push({
            x: cx + ox, z: cz + oz, hw: w / 2, hd: d / 2,
            h: Math.min(h, 64), color: pick(rng, BUILDING_COLORS),
          });
        }
      }
    }
    // Top the count up to exactly 128 with small harbour sheds and kiosks.
    let extra = 0;
    while (this.buildings.length < CFG.buildingTarget) {
      const bx = intRange(rng, 0, 8);
      const bz = intRange(rng, 0, 8);
      const cx = -232 + bx * this.pitch + range(rng, -14, 14);
      const cz = -232 + bz * this.pitch + range(rng, -14, 14);
      this.buildings.push({
        x: cx, z: cz, hw: range(rng, 3, 5), hd: range(rng, 3, 5),
        h: range(rng, 4, 7), color: pick(rng, BUILDING_COLORS),
      });
      extra++;
      if (extra > 400) break; // safety; never reached in practice
    }
    this.buildings = this.buildings.slice(0, CFG.buildingTarget);

    // Lit windows on the west and east faces of the taller buildings.
    for (const b of this.buildings) {
      if (b.h < 12) continue;
      const floors = Math.floor(b.h / 6);
      for (let f = 0; f < floors; f++) {
        for (const side of [-1, 1]) {
          if (rng() < 0.45) continue;
          this.windows.push({
            x: b.x + side * (b.hw + 0.08), y: 4 + f * 6,
            z: b.z + range(rng, -b.hd + 2, b.hd - 2),
            w: 1.6, h: 2.0, color: rng() < 0.75 ? 0xffc46b : 0x9fd8ff,
            facing: 'x',
          });
        }
      }
    }
    // Street lamps at every second intersection.
    for (let i = 0; i < 10; i += 2) {
      for (let j = 0; j < 10; j += 2) {
        this.lamps.push({ x: this.streetLines[i] + 6, z: this.streetLines[j] + 6 });
      }
    }
    // Docks: three piers reaching into the water on the east edge.
    this.piers = [];
    for (const pz of [-90, 0, 90]) {
      this.piers.push({ x: 268, z: pz, len: 42, w: 10 });
    }
    this.crates = [];
    for (let i = 0; i < 18; i++) {
      this.crates.push({
        x: range(rng, 272, 306), z: range(rng, -120, 120),
        s: range(rng, 1.6, 3.2), color: pick(rng, [0x8a6f3a, 0x4a6b5a, 0x7a4a3a]),
      });
    }
  }

  buildMissions() {
    return [
      {
        name: 'First Wheels',
        brief: 'Del: Mara, you need wheels. Lift a car and bring it to the Docks, east side. Quiet and quick.',
        stages: [
          { kind: 'steal', text: 'Steal a car — walk up to one and press E' },
          { kind: 'goto', target: { x: 292, z: 0 }, text: 'Drive to the Docks on the east side' },
        ],
      },
      {
        name: 'Night Run',
        brief: 'Del: Nice. Now the warehouse on the west side has a package with your name on it. Pick it up, drop it south.',
        stages: [
          { kind: 'goto', target: { x: -203, z: -174 }, text: 'Pick up the package at the warehouse' },
          { kind: 'goto', target: { x: 87, z: 232 }, text: 'Deliver the package to the drop point' },
        ],
      },
      {
        name: 'Heat',
        brief: 'Del: They made you, Mara. Five stars and every cruiser in the city. Lose them and get to the safehouse.',
        stages: [
          { kind: 'goto', target: { x: -203, z: 203 }, text: 'Evade the police — reach the safehouse' },
        ],
      },
    ];
  }

  // ------------------------------------------------------------ population

  buildPopulation() {
    const rng = this.rng;
    this.traffic = [];
    for (let i = 0; i < CFG.trafficCars; i++) {
      const axis = rng() < 0.5 ? 'x' : 'z';
      const line = pick(rng, this.streetLines);
      const along = range(rng, -250, 250);
      this.traffic.push({
        id: i, kind: 'traffic',
        x: axis === 'x' ? along : line, z: axis === 'x' ? line : along,
        angle: axis === 'x' ? (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2) : (rng() < 0.5 ? 0 : Math.PI),
        axis, dir: rng() < 0.5 ? 1 : -1, speed: range(rng, 7, 11),
        vx: 0, vz: 0,
        color: pick(rng, CAR_COLORS), hp: CFG.carHealth, driver: true,
      });
    }
    this.parked = [];
    // Parked cars sit alongside a street, facing along it, so stealing one
    // and driving off goes straight down the road instead of into a building.
    const spots = shuffle(rng, [
      { x: -197.5, z: 156, angle: 0 }, { x: -139.5, z: -40, angle: Math.PI },
      { x: 34.5, z: 90, angle: 0 }, { x: 150.5, z: -160, angle: Math.PI },
      { x: -40, z: -197.5, angle: Math.PI / 2 }, { x: 208.5, z: 60, angle: 0 },
      { x: -160, z: 92.5, angle: -Math.PI / 2 }, { x: 80, z: -139.5, angle: Math.PI },
      { x: 0, z: 208.5, angle: Math.PI / 2 }, { x: -255.5, z: 60, angle: 0 },
    ]);
    for (let i = 0; i < CFG.parkedCars; i++) {
      const s = spots[i];
      this.parked.push({
        id: 100 + i, kind: 'parked',
        x: s.x, z: s.z, angle: s.angle,
        speed: 0, vx: 0, vz: 0, color: pick(rng, CAR_COLORS), hp: CFG.carHealth, driver: false,
      });
    }
    this.pedestrians = [];
    for (let i = 0; i < CFG.pedestrians; i++) {
      const line = pick(rng, this.streetLines);
      const axis = rng() < 0.5 ? 'x' : 'z';
      const along = range(rng, -250, 250);
      const off = (rng() < 0.5 ? -1 : 1) * (CFG.streetWidth / 2 + 1.6);
      this.pedestrians.push({
        x: axis === 'x' ? along : line + off,
        z: axis === 'x' ? line + off : along,
        axis, line, off, dir: rng() < 0.5 ? 1 : -1,
        speed: range(rng, 1.1, 2.0), down: 0, downTimer: 0,
        color: pick(rng, [0xb03a3a, 0x3a6ea5, 0x4a8a3a, 0xc7a23a, 0x7a5a9a]),
      });
    }
  }

  // ------------------------------------------------------------ helpers

  currentMission() {
    return this.missions[this.missionIndex];
  }

  currentStage() {
    const m = this.currentMission();
    return m ? m.stages[this.missionStage] : null;
  }

  missionTarget() {
    const s = this.currentStage();
    return s && s.kind === 'goto' ? s.target : null;
  }

  setToast(text, seconds) {
    this.toast = text;
    this.toastTimer = seconds;
  }

  sayRadio(text) {
    this.radioText = text;
    this.radioShown = 0;
  }

  addHeat(amount, why) {
    const before = this.stars;
    this.heat = clamp(this.heat + amount, 0, 100);
    this.stars = starsForHeat(this.heat);
    if (this.stars > before) {
      this.setToast(`Wanted level up — ${this.stars} star${this.stars > 1 ? 's' : ''}!`, 2.5);
      this.events.push('siren');
    }
    void why;
  }

  startMission(index) {
    this.missionIndex = index;
    this.missionStage = 0;
    const m = this.missions[index];
    this.sayRadio(m.brief);
    this.setToast(`Mission: ${m.name}`, 3);
    if (index === 2) {
      this.heat = 92;
      this.stars = 5;
      this.events.push('siren');
    }
  }

  completeStage() {
    const m = this.currentMission();
    this.missionStage++;
    if (this.missionStage >= m.stages.length) {
      const reward = CFG.missionReward[this.missionIndex];
      this.money += reward;
      this.bestMoney = Math.max(this.bestMoney, this.money);
      this.missionJustDone = true;
      this.missionDoneTimer = 2.8;
      this.setToast(`MISSION COMPLETE — ${m.name} +$${reward}`, 3);
      this.events.push('missionDone');
      this.missionIndex++;
      if (this.missionIndex >= this.missions.length) {
        this.state = 'complete';
        this.events.push('complete');
        return;
      }
      this.startMission(this.missionIndex);
    }
  }

  // ------------------------------------------------------------ actions

  nearestCar(maxDist) {
    const p = this.player;
    let best = null;
    let bestD = maxDist;
    const check = (car) => {
      if (car.hp <= 0) return; // a wreck cannot be stolen
      const d = Math.hypot(car.x - p.x, car.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = car;
      }
    };
    for (const c of this.parked) check(c);
    for (const c of this.traffic) {
      if (c.speed < 1.5) check(c); // only a stopped traffic car can be lifted
    }
    return best;
  }

  stealCar() {
    const p = this.player;
    if (!p.onFoot) return false;
    const car = this.nearestCar(4.5);
    if (!car) return false;
    // Pull the car out of its old list and make it the player's ride.
    const pi = this.parked.indexOf(car);
    if (pi >= 0) this.parked.splice(pi, 1);
    const ti = this.traffic.indexOf(car);
    if (ti >= 0) this.traffic.splice(ti, 1);
    if (car.driver) {
      car.driver = false;
      this.setToast('Driver pulled out — the car is yours', 2);
    }
    p.car = car;
    p.onFoot = false;
    p.x = car.x;
    p.z = car.z;
    p.angle = car.angle;
    p.speed = 0;
    this.carsStolen++;
    this.addHeat(CFG.heatSteal, 'steal');
    this.events.push('steal');
    const stage = this.currentStage();
    if (stage && stage.kind === 'steal') this.completeStage();
    return true;
  }

  getOut() {
    const p = this.player;
    if (p.onFoot || !p.car) return;
    const car = p.car;
    car.speed = 0;
    p.car = null;
    p.onFoot = true;
    // Step out to the side of the car.
    p.x = car.x + Math.cos(car.angle) * 2.4;
    p.z = car.z - Math.sin(car.angle) * 2.4;
    p.angle = car.angle;
    p.speed = 0;
    this.parked.push(car);
  }

  shootPistol() {
    const p = this.player;
    if (!p.onFoot || p.shotTimer > 0) return;
    p.shotTimer = CFG.shotCooldown;
    this.shotsFired++;
    this.events.push('shot');
    this.addHeat(CFG.heatShot, 'shot');
    // Hitscan: the nearest pedestrian or police car in front of the player.
    const aimX = Math.sin(p.angle);
    const aimZ = Math.cos(p.angle);
    let best = null;
    let bestD = CFG.pistolRange;
    const consider = (x, z, obj) => {
      const dx = x - p.x;
      const dz = z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 1 || d > bestD) return;
      const dot = (dx * aimX + dz * aimZ) / d;
      if (dot > 0.86) {
        bestD = d;
        best = obj;
      }
    };
    for (const ped of this.pedestrians) if (ped.down <= 0) consider(ped.x, ped.z, { type: 'ped', ped });
    for (const pc of this.police) consider(pc.x, pc.z, { type: 'police', car: pc });
    if (best) {
      if (best.type === 'ped') {
        best.ped.down = 1;
        best.ped.downTimer = 6;
        this.addHeat(CFG.heatHitPed, 'ped');
      } else {
        best.car.hp -= CFG.pistolDamage;
        if (best.car.hp <= 0) this.removePolice(best.car);
      }
    }
  }

  punch() {
    const p = this.player;
    if (!p.onFoot || p.punchTimer > 0) return;
    p.punchTimer = CFG.punchCooldown;
    this.events.push('punch');
    for (const ped of this.pedestrians) {
      if (ped.down > 0) continue;
      const d = Math.hypot(ped.x - p.x, ped.z - p.z);
      if (d < CFG.punchRange) {
        ped.down = 1;
        ped.downTimer = 6;
        this.addHeat(CFG.heatHitPed, 'punch');
        break;
      }
    }
  }

  removePolice(car) {
    const i = this.police.indexOf(car);
    if (i >= 0) this.police.splice(i, 1);
    this.events.push('crash');
  }

  die() {
    if (this.state !== 'playing') return;
    this.state = 'dead';
    this.events.push('dead');
  }

  // ------------------------------------------------------------ update

  update(dt, input) {
    this.events = [];
    this.time += dt;
    if (this.toastTimer > 0) this.toastTimer -= dt;
    if (this.missionDoneTimer > 0) this.missionDoneTimer -= dt;
    if (this.ramCooldown > 0) this.ramCooldown -= dt;
    if (this.missionDoneTimer <= 0) this.missionJustDone = false;
    if (this.radioText && this.radioShown < this.radioText.length) {
      this.radioShown = Math.min(this.radioText.length, this.radioShown + dt * 42);
    }
    if (this.state !== 'playing') return;

    const p = this.player;
    if (p.punchTimer > 0) p.punchTimer -= dt;
    if (p.shotTimer > 0) p.shotTimer -= dt;

    if (input.wasPressed('e')) {
      if (p.onFoot) this.stealCar();
      else this.getOut();
    }
    if (input.wasPressed('f')) this.punch();
    if (input.clicked && p.onFoot) this.shootPistol();

    if (p.onFoot) this.updateOnFoot(dt, input);
    else this.updateDriving(dt, input);

    this.updateTraffic(dt);
    this.updatePedestrians(dt);
    this.updatePolice(dt);
    this.updateWanted(dt);
    this.updateMission();
  }

  updateOnFoot(dt, input) {
    const p = this.player;
    const run = input.down('shift');
    const speed = run ? CFG.runSpeed : CFG.walkSpeed;
    let fx = 0;
    let fz = 0;
    const yaw = this.cameraYaw;
    if (input.down('w', 'arrowup')) { fx += Math.sin(yaw); fz += Math.cos(yaw); }
    if (input.down('s', 'arrowdown')) { fx -= Math.sin(yaw); fz -= Math.cos(yaw); }
    if (input.down('a', 'arrowleft')) { fx -= Math.cos(yaw); fz += Math.sin(yaw); }
    if (input.down('d', 'arrowright')) { fx += Math.cos(yaw); fz -= Math.sin(yaw); }
    const len = Math.hypot(fx, fz);
    if (len > 0.01) {
      fx /= len;
      fz /= len;
      p.x += fx * speed * dt;
      p.z += fz * speed * dt;
      p.angle = Math.atan2(fx, fz);
      p.speed = speed;
    } else {
      p.speed = 0;
    }
    this.collideCircle(p, CFG.playerRadius);
    p.x = clamp(p.x, -this.cityHalf - 6, 330);
    p.z = clamp(p.z, -this.cityHalf - 6, this.cityHalf + 6);
  }

  updateDriving(dt, input) {
    const p = this.player;
    const car = p.car;
    if (!car) {
      p.onFoot = true;
      return;
    }
    const throttle = input.down('w', 'arrowup') ? 1 : 0;
    const braking = input.down('s', 'arrowdown') ? 1 : 0;
    const steerIn = (input.down('a', 'arrowleft') ? 1 : 0) - (input.down('d', 'arrowright') ? 1 : 0);
    const fwd = Math.sin(car.angle);
    const fwdZ = Math.cos(car.angle);
    let vForward = car.vx * fwd + car.vz * fwdZ;
    let vSide = car.vx * fwdZ - car.vz * fwd;
    if (throttle) vForward += CFG.carAccel * dt;
    if (braking) {
      if (vForward > 0.5) vForward -= CFG.carBrake * dt;
      else vForward -= CFG.carAccel * 0.55 * dt; // reverse
    }
    if (!throttle && !braking) vForward -= vForward * 0.8 * dt;
    vForward = clamp(vForward, -CFG.carReverseMax, CFG.carMaxSpeed);
    vSide -= vSide * Math.min(1, CFG.carGrip * dt);
    const steer = steerIn * CFG.carSteerMax * clamp(Math.abs(vForward) / 8, 0, 1);
    car.angle += (steer * vForward * dt) / 2.6;
    const nFwd = Math.sin(car.angle);
    const nFwdZ = Math.cos(car.angle);
    car.vx = nFwd * vForward + nFwdZ * vSide;
    car.vz = nFwdZ * vForward - nFwd * vSide;
    car.x += car.vx * dt;
    car.z += car.vz * dt;
    car.speed = Math.abs(vForward);
    p.x = car.x;
    p.z = car.z;
    p.angle = car.angle;
    p.speed = car.speed;
    // Collisions with buildings and the water edge.
    const hitWall = this.collideCircle(car, CFG.carRadius);
    if (hitWall) {
      // Scrub speed into the wall so the car slides along it instead of
      // sticking to it while the engine keeps pushing.
      car.vx *= 0.5;
      car.vz *= 0.5;
      // Wall damage is throttled: scraping along a wall at speed must not
      // drain the whole health bar in a single second of contact.
      if (Math.abs(vForward) > 6 && this.ramCooldown <= 0) {
        this.ramCooldown = 1;
        car.hp -= 4;
        this.events.push('crash');
      }
    }
    if (car.x > 330) {
      car.x = 330;
      car.vx = -Math.abs(car.vx) * 0.4;
    }
    car.x = clamp(car.x, -this.cityHalf - 4, 330);
    car.z = clamp(car.z, -this.cityHalf - 4, this.cityHalf + 4);
    // Bumping traffic and parked cars.
    for (const other of [...this.traffic, ...this.parked, ...this.police]) {
      if (other === car) continue;
      const dx = other.x - car.x;
      const dz = other.z - car.z;
      const d = Math.hypot(dx, dz);
      if (d < 3.4 && d > 0.01) {
        const push = (3.4 - d) / 2;
        const nx = dx / d;
        const nz = dz / d;
        car.x -= nx * push;
        car.z -= nz * push;
        other.x += nx * push;
        other.z += nz * push;
        if (Math.abs(vForward) > 4 && this.ramCooldown <= 0 && other.kind !== 'police') {
          // Ramming traffic is a crime; a police cruiser shoving you is not.
          this.ramCooldown = 1;
          this.addHeat(CFG.heatRam, 'ram');
          car.hp -= 3;
          other.hp -= 5;
          this.events.push('crash');
          if (other.kind === 'traffic') {
            other.speed = 0; // the driver stops, shaken
            other.stoppedTimer = 4;
          }
        }
      }
    }
    // Running over a pedestrian.
    for (const ped of this.pedestrians) {
      if (ped.down > 0) continue;
      const d = Math.hypot(ped.x - car.x, ped.z - car.z);
      if (d < 2.2 && Math.abs(vForward) > 3) {
        ped.down = 1;
        ped.downTimer = 6;
        this.addHeat(CFG.heatHitPed, 'runover');
        this.events.push('crash');
      }
    }
    if (car.hp <= 0) {
      car.hp = 0;
      this.setToast('Your car is wrecked — get out and run', 3);
      this.getOut();
      p.hp -= 20;
      if (p.hp <= 0) this.die();
    }
  }

  collideCircle(obj, radius) {
    let hit = false;
    for (const b of this.buildings) {
      const cx = clamp(obj.x, b.x - b.hw, b.x + b.hw);
      const cz = clamp(obj.z, b.z - b.hd, b.z + b.hd);
      const dx = obj.x - cx;
      const dz = obj.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < radius * radius) {
        hit = true;
        if (d2 > 0.0001) {
          const d = Math.sqrt(d2);
          obj.x = cx + (dx / d) * radius;
          obj.z = cz + (dz / d) * radius;
        } else {
          // Dead centre of a building: push out along the smaller axis.
          const px = b.hw + radius - Math.abs(obj.x - b.x);
          const pz = b.hd + radius - Math.abs(obj.z - b.z);
          if (px < pz) obj.x = b.x + (obj.x >= b.x ? 1 : -1) * (b.hw + radius);
          else obj.z = b.z + (obj.z >= b.z ? 1 : -1) * (b.hd + radius);
        }
      }
    }
    return hit;
  }

  updateTraffic(dt) {
    for (const c of this.traffic) {
      if (c.stoppedTimer > 0) {
        c.stoppedTimer -= dt;
        continue;
      }
      const step = c.speed * c.dir * dt;
      if (c.axis === 'x') c.x += step;
      else c.z += step;
      // At an intersection, sometimes turn onto the crossing street.
      const nearLine = this.streetLines.some((l) => {
        const along = c.axis === 'x' ? c.x : c.z;
        return Math.abs(along - l) < 1.2;
      });
      if (nearLine && this.rng() < dt * 0.25) {
        const cross = c.axis === 'x' ? c.z : c.x;
        const snapped = this.streetLines.reduce((best, l) => (Math.abs(l - cross) < Math.abs(best - cross) ? l : best));
        if (c.axis === 'x') {
          c.z = snapped;
          c.axis = 'z';
          c.angle = c.dir > 0 ? 0 : Math.PI;
        } else {
          c.x = snapped;
          c.axis = 'x';
          c.angle = c.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        }
      }
      // Turn around at the city edge instead of driving into the water.
      const along = c.axis === 'x' ? c.x : c.z;
      if (along > 258 || along < -258) c.dir *= -1;
      if (c.axis === 'x') c.angle = c.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      else c.angle = c.dir > 0 ? 0 : Math.PI;
    }
  }

  updatePedestrians(dt) {
    for (const ped of this.pedestrians) {
      if (ped.down > 0) {
        ped.downTimer -= dt;
        if (ped.downTimer <= 0) {
          ped.down = 0;
          ped.x = this.streetLines[0] + 20 + this.rng() * 40;
          ped.z = this.streetLines[0] + 20 + this.rng() * 40;
        }
        continue;
      }
      const step = ped.speed * ped.dir * dt;
      if (ped.axis === 'x') ped.x += step;
      else ped.z += step;
      const along = ped.axis === 'x' ? ped.x : ped.z;
      if (along > 258 || along < -258) ped.dir *= -1;
      if (this.rng() < dt * 0.06) ped.dir *= -1;
    }
  }

  updatePolice(dt) {
    const want = policeBudget(this.stars);
    const p = this.player;
    // Spawn up to the budget, on a street near the player.
    while (this.police.length < want) {
      const line = this.streetLines.reduce((best, l) => (Math.abs(l - p.z) < Math.abs(best - p.z) ? l : best));
      const behind = p.z > 0 ? -1 : 1;
      const car = {
        id: 200 + this.policeId++, kind: 'police',
        x: clamp(p.x + (this.rng() < 0.5 ? -1 : 1) * range(this.rng, 55, 80), -260, 260),
        z: clamp(line + behind * range(this.rng, 20, 40), -260, 260),
        angle: 0, speed: 0, vx: 0, vz: 0,
        color: 0xe8e8e8, hp: 120, siren: this.rng() * TAU, ramTimer: 0,
      };
      this.police.push(car);
    }
    while (this.police.length > want) this.police.pop();
    for (const pc of this.police) {
      const dx = p.x - pc.x;
      const dz = p.z - pc.z;
      const d = Math.hypot(dx, dz);
      const wantAngle = Math.atan2(dx, dz);
      pc.angle += clamp(angleDiff(wantAngle, pc.angle), -2.2 * dt, 2.2 * dt);
      const accel = CFG.policeAccel * dt;
      pc.speed = Math.min(pc.speed + accel, CFG.policeMaxSpeed);
      pc.vx = Math.sin(pc.angle) * pc.speed;
      pc.vz = Math.cos(pc.angle) * pc.speed;
      pc.x += pc.vx * dt;
      pc.z += pc.vz * dt;
      pc.siren += dt * 6;
      if (pc.ramTimer > 0) pc.ramTimer -= dt;
      this.collideCircle(pc, CFG.carRadius);
      if (d < 3.6 && pc.ramTimer <= 0) {
        pc.ramTimer = 2;
        // A ram: shove the player and damage whatever they are in.
        const nx = dx / (d || 1);
        const nz = dz / (d || 1);
        if (p.car) {
          p.car.hp -= CFG.policeRamDamage;
          p.car.x += nx * 1.2;
          p.car.z += nz * 1.2;
          if (p.car.hp <= 0) {
            p.car.hp = 0;
            this.getOut();
            p.hp -= 15;
            if (p.hp <= 0) this.die();
          }
        } else {
          p.hp -= CFG.policeRamDamage;
          p.x += nx * 1.5;
          p.z += nz * 1.5;
          if (p.hp <= 0) this.die();
        }
        pc.speed *= 0.4;
        this.events.push('crash');
      }
    }
  }

  updateWanted(dt) {
    const p = this.player;
    const nearest = this.police.reduce((best, pc) => Math.min(best, Math.hypot(pc.x - p.x, pc.z - p.z)), Infinity);
    if (nearest < CFG.policeSightRange) {
      this.calmTimer = 0;
    } else {
      this.calmTimer += dt;
      if (this.calmTimer > CFG.heatCalmSeconds && this.heat > 0) {
        this.heat = Math.max(0, this.heat - CFG.heatDecayPerSec * dt);
        const s = starsForHeat(this.heat);
        if (s !== this.stars) {
          this.stars = s;
          if (s === 0) this.setToast('You lost them — heat is gone', 2.5);
        }
      }
    }
  }

  updateMission() {
    const stage = this.currentStage();
    if (!stage) return;
    if (stage.kind === 'goto') {
      const p = this.player;
      const d = Math.hypot(p.x - stage.target.x, p.z - stage.target.z);
      if (d < CFG.missionRadius) this.completeStage();
    }
  }

  // Snapshot the numbers the tests and the HUD read.
  debug() {
    return {
      state: this.state,
      buildings: this.buildings.length,
      traffic: this.traffic.length,
      parked: this.parked.length,
      pedestrians: this.pedestrians.length,
      money: this.money,
      stars: this.stars,
      heat: Math.round(this.heat),
      mission: this.missionIndex,
      stage: this.missionStage,
      playerX: Math.round(this.player.x),
      playerZ: Math.round(this.player.z),
      onFoot: this.player.onFoot,
      hp: Math.round(this.player.hp),
      police: this.police.length,
    };
  }
}

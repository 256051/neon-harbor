// Neon Harbor — scripted pilots. Each pilot drives the real game through the
// same virtual keys a player would press, so every screenshot is a genuine
// render of the game being played, never a staged pose.

import { CFG } from './config.js';

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function nearestLine(world, v) {
  return world.streetLines.reduce((best, l) => (Math.abs(l - v) < Math.abs(best - v) ? l : best));
}

// A street-following route from (fx, fz) to (tx, tz): stay on roads the whole
// way, turning only at intersections, then a short hop to the target.
export function streetRoute(world, fx, fz, tx, tz) {
  const lx = nearestLine(world, fx);
  const lzT = nearestLine(world, tz);
  const lxT = nearestLine(world, tx);
  const points = [];
  points.push({ x: lx, z: fz });
  points.push({ x: lx, z: lzT });
  points.push({ x: lxT, z: lzT });
  points.push({ x: tx, z: tz });
  // Drop waypoints we are already standing on.
  return points.filter((p) => Math.hypot(p.x - fx, p.z - fz) > 4);
}

class Driver {
  constructor(world, input) {
    this.world = world;
    this.input = input;
    this.route = [];
    this.stuckTimer = 0;
    this.lastDist = Infinity;
    this.reverseTimer = 0;
    this.lastPos = null;
    this.stillTimer = 0;
    // Drive a little off the street centre line: traffic drives on the line,
    // so hugging the side of the road passes it instead of rear-ending it.
    this.sideOffset = 3.5;
  }

  setRoute(route) {
    this.route = route.slice();
    this.stuckTimer = 0;
    this.reverseTimer = 0;
    this.stillTimer = 0;
    this.lastPos = null;
  }

  // Drive the player's car along the route. Returns true when it arrives.
  update(dt) {
    const world = this.world;
    const p = world.player;
    if (!p.car || this.route.length === 0) return this.route.length === 0;
    const target = this.route[0];
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 7) {
      this.route.shift();
      return this.route.length === 0;
    }
    // Aim a little to the side of the waypoint so the car tracks off the
    // centre line where the traffic drives.
    const aimX = target.x + (dz / dist) * this.sideOffset;
    const aimZ = target.z - (dx / dist) * this.sideOffset;
    const wantAngle = Math.atan2(aimX - p.x, aimZ - p.z);
    const diff = angleDiff(wantAngle, p.car.angle);
    const keys = new Set();
    // Turnaround: facing far from the target at low speed — reverse while
    // steering so the nose swings around without leaving the road. A forward
    // U-turn from a standstill arcs wide into the blocks; reversing turns
    // the car almost in place.
    const speed0 = p.car.speed;
    if (Math.abs(diff) > 1.3 && Math.abs(speed0) < 8) {
      this.turnTimer = (this.turnTimer || 0) + dt;
      keys.add('s');
      if (diff > 0) keys.add('a');
      else keys.add('d');
      this.input.setVirtual([...keys]);
      if (this.turnTimer > 1.5) this.turnTimer = 0;
      return false;
    }
    this.turnTimer = 0;
    // Stuck detection: barely moving while trying to drive.
    if (this.lastPos) {
      const moved = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z);
      if (moved < 0.05) this.stillTimer += dt;
      else this.stillTimer = 0;
    }
    this.lastPos = { x: p.x, z: p.z };
    if (this.reverseTimer > 0) {
      this.reverseTimer -= dt;
      keys.add('s');
      if (diff > 0) keys.add('d');
      else keys.add('a');
      this.input.setVirtual([...keys]);
      return false;
    }
    if (this.stillTimer > 1.6) {
      this.stillTimer = 0;
      this.reverseTimer = 0.9;
      this.input.setVirtual(['s']);
      return false;
    }
    const speed = p.car.speed;
    if (Math.abs(diff) > 1.1 && speed > 4) {
      // Too much angle error at speed: lift off and let the car turn.
      keys.add('s');
    } else if (dist < 14) {
      // Ease in near the waypoint.
      if (speed < 6) keys.add('w');
    } else {
      keys.add('w');
      if (speed > 34) keys.delete('w');
    }
    if (diff > 0.18) keys.add('a');
    else if (diff < -0.18) keys.add('d');
    this.input.setVirtual([...keys]);
    return false;
  }
}

class Walker {
  constructor(world, input) {
    this.world = world;
    this.input = input;
    this.route = [];
    this.routeFor = null;
  }

  // Walk on foot toward (tx, tz) along the streets, so the walker cannot get
  // stuck walking straight into a building. Returns true when close.
  update(dt, tx, tz) {
    const world = this.world;
    const p = world.player;
    const key = `${tx},${tz}`;
    if (this.routeFor !== key || this.route.length === 0) {
      this.route = streetRoute(world, p.x, p.z, tx, tz);
      this.routeFor = key;
    }
    let target = this.route[0];
    if (!target) target = { x: tx, z: tz };
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 3) {
      this.route.shift();
      if (this.route.length === 0) {
        // Final approach: the car itself may sit just off the road.
        const dCar = Math.hypot(tx - p.x, tz - p.z);
        if (dCar < 2.5) {
          this.input.setVirtual([]);
          return true;
        }
        this.route = [{ x: tx, z: tz }];
        this.routeFor = key;
      }
      return false;
    }
    world.cameraYaw = Math.atan2(dx, dz);
    this.input.setVirtual(['w', 'shift']);
    return false;
  }
}

function makePilot(world, input) {
  const driver = new Driver(world, input);
  const walker = new Walker(world, input);
  return { driver, walker };
}

// ------------------------------------------------------------ the four shots

export function createPilot(name, world, input) {
  const { driver, walker } = makePilot(world, input);
  let phase = 0;
  let timer = 0;
  let pressedE = false;
  let routeSet = false;
  let ramTarget = null;

  const stealNearest = () => {
    // Once the player is driving, the steal is done — check this first, or
    // the walker would keep chasing the next parked car and overwrite the
    // driver's keys with plain forward throttle.
    if (!world.player.onFoot) return 'driving';
    const car = world.nearestCar(500);
    if (!car) return 'nocar';
    if (walker.update(1 / 60, car.x, car.z)) {
      if (!pressedE) {
        input.pressVirtual('e');
        pressedE = true;
      }
    }
    return 'walking';
  };

  return {
    frameChase: false,
    update(dt) {
      timer += dt;
      if (name === 'start') {
        return timer > 0.6 ? 'done' : 'running';
      }

      if (name === 'drive') {
        if (phase === 0) {
          const s = stealNearest();
          if (s === 'driving') {
            phase = 1;
            routeSet = false;
            timer = 0;
          } else if (s === 'nocar' || timer > 25) return 'done';
          return 'running';
        }
        if (phase === 1) {
          if (world.player.onFoot) {
            // The car was wrecked mid-drive: steal another one and resume.
            phase = 0;
            pressedE = false;
            routeSet = false;
            timer = 0;
            return 'running';
          }
          if (!routeSet) {
            driver.setRoute(streetRoute(world, world.player.x, world.player.z, 87, 145));
            routeSet = true;
          }
          if (driver.update(dt)) return 'done';
          if (timer > 90) return 'done';
          return 'running';
        }
      }

      if (name === 'wanted') {
        if (phase === 0) {
          const s = stealNearest();
          if (s === 'driving') {
            phase = 1;
            timer = 0;
          } else if (s === 'nocar' || timer > 25) return 'done';
          return 'running';
        }
        if (phase === 1) {
          // Ram traffic until the wanted level hits three stars.
          if (world.player.onFoot) {
            // The car was wrecked mid-ram: steal another one and resume.
            phase = 0;
            pressedE = false;
            timer = 0;
            return 'running';
          }
          if (world.stars >= 3) {
            phase = 2;
            timer = 0;
            return 'running';
          }
          if (!ramTarget || !world.traffic.includes(ramTarget) || ramTarget.speed < 0.5) {
            let best = null;
            let bestD = Infinity;
            for (const c of world.traffic) {
              const d = Math.hypot(c.x - world.player.x, c.z - world.player.z);
              if (d < bestD) {
                bestD = d;
                best = c;
              }
            }
            ramTarget = best;
          }
          if (ramTarget) {
            driver.sideOffset = 0; // ramming wants the centre line, not the side
            if (this._ramRouteFor !== ramTarget) {
              driver.setRoute([{ x: ramTarget.x, z: ramTarget.z }]);
              this._ramRouteFor = ramTarget;
            } else {
              // Keep chasing the moving target without resetting the driver.
              driver.route = [{ x: ramTarget.x, z: ramTarget.z }];
            }
            driver.update(dt);
          }
          if (timer > 70) return 'done';
          return 'running';
        }
        if (phase === 2) {
          // Stop, let the cruisers close in, and frame them with the player.
          input.setVirtual([]);
          const near = world.police.some((pc) => Math.hypot(pc.x - world.player.x, pc.z - world.player.z) < 26);
          if (near && world.police.length >= 2) {
            this.frameChase = true;
            return 'done';
          }
          if (timer > 30) {
            this.frameChase = world.police.length > 0;
            return 'done';
          }
          return 'running';
        }
      }

      if (name === 'mission') {
        if (phase === 0) {
          const s = stealNearest();
          if (s === 'driving') {
            phase = 1;
            routeSet = false;
            timer = 0;
          } else if (s === 'nocar' || timer > 25) return 'done';
          return 'running';
        }
        if (phase === 1) {
          if (world.player.onFoot) {
            // The car was wrecked mid-drive: steal another one and resume.
            phase = 0;
            pressedE = false;
            routeSet = false;
            timer = 0;
            return 'running';
          }
          if (!routeSet) {
            const target = world.missionTarget() || { x: 292, z: 0 };
            driver.setRoute(streetRoute(world, world.player.x, world.player.z, target.x, target.z));
            routeSet = true;
          }
          driver.update(dt);
          if (world.missionIndex >= 1) {
            phase = 2;
            timer = 0;
          }
          if (timer > 120) return 'done';
          return 'running';
        }
        if (phase === 2) {
          // Hold still a moment so the mission-complete toast is on screen.
          input.setVirtual([]);
          if (timer > 1.2) return 'done';
          return 'running';
        }
      }
      return 'running';
    },
  };
}

export const SHOT_DEFS = [
  { id: 'start', file: '1-start.jpg', label: 'Title screen over the city' },
  { id: 'drive', file: '2-drive.jpg', label: 'Driving with traffic, minimap and mission HUD' },
  { id: 'wanted', file: '3-wanted.jpg', label: 'Police chase, wanted stars, cruiser in frame' },
  { id: 'mission', file: '4-mission.jpg', label: 'Mission complete, money and the next mission' },
];

export { CFG };

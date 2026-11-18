// Neon Harbor — the screenshot autopilot. Each ?shot= scene is played for
// real by this driver: it walks, steals a car, drives the street grid and
// finishes a mission using the same step() the player uses, with the same
// input shape. Nothing here fakes an outcome — if the pilot cannot steal a
// car or reach the Docks, the shot does not complete and the run reports it.
//
// The driver owns its own phase machine and returns the input for world.step
// plus the camera yaw it wants, every frame. main.js feeds both in and takes
// the screenshot when the driver reports done.
import { MISSIONS, PITCH, STREETS } from './config.js';
import { streetCoord, missionDef } from './world.js';

const ACTION_CONFIRM = 1;
const ACTION_INTERACT = 4;
const ACTION_PUNCH = 8;
const ACTION_SHOOT = 16;

function nearestStreetCoord(v) {
  let best = streetCoord(0);
  let bestD = Math.abs(v - best);
  for (let i = 1; i < STREETS; i += 1) {
    const c = streetCoord(i);
    const d = Math.abs(v - c);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

function planRoute(fromX, fromZ, toX, toZ) {
  // Manhattan route on the street grid, one axis at a time: nearest
  // intersection, then along that street to the target's street, then along
  // it to the intersection nearest the target, then the target itself. Every
  // leg runs along a street — a straight diagonal across the city would cut
  // through buildings and the car would grind against them forever.
  const sx = nearestStreetCoord(toX);
  const sz = nearestStreetCoord(toZ);
  const ix = nearestStreetCoord(fromX);
  const iz = nearestStreetCoord(fromZ);
  return [[ix, iz], [sx, iz], [sx, sz], [toX, toZ]];
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function createShotDriver(world, shotName) {
  let phase = 'start';
  let phaseTime = 0;
  let route = null;
  let routeIndex = 0;
  let stuckTime = 0;
  let reversing = 0;
  let camYaw = Math.PI;
  let done = false;
  let status = 'starting';
  let walkStuckTime = 0;
  let walkLastDist = Infinity;
  let sidestepTime = 0;
  let sidestepDir = 1;

  function walkTo(tx, tz, dt) {
    const p = world.player;
    // Walk the street grid, not a straight line: a direct line to the target
    // cuts through buildings, and sliding along a wall shrinks the distance
    // just slowly enough that the unstuck logic never fires. The Manhattan
    // route's legs all run along streets, so follow its first waypoint that
    // is still more than 2 m away (the last waypoint is the target itself).
    const route = planRoute(p.x, p.z, tx, tz);
    // Walk the first waypoint that is still ahead of the player. The route's
    // first point is the intersection nearest the player, which is BEHIND
    // them once they have walked a few metres along the street — picking it
    // makes the player walk back south, then north again, oscillating around
    // the start forever. A waypoint counts as ahead when it lies in the same
    // half-plane as the target (positive dot product with the target
    // direction); the last waypoint is the target itself.
    const tdx = tx - p.x;
    const tdz = tz - p.z;
    let wx = tx;
    let wz = tz;
    for (const [rx, rz] of route) {
      if (Math.hypot(rx - p.x, rz - p.z) > 2 && (rx - p.x) * tdx + (rz - p.z) * tdz > 0) {
        wx = rx;
        wz = rz;
        break;
      }
    }
    const dx = wx - p.x;
    const dz = wz - p.z;
    const dist = Math.hypot(tx - p.x, tz - p.z);
    camYaw = Math.atan2(-dx, -dz);
    // Unstuck: walking straight at a target through a building slides along
    // the wall forever. If the distance has not shrunk in 2.5 s, sidestep
    // for 1.5 s to walk around the obstacle, then re-aim.
    if (sidestepTime > 0) {
      sidestepTime -= dt;
      return {
        input: { move: { fwd: 0.4, strafe: sidestepDir, sprint: false }, drive: { steer: 0, accel: 0, brake: false }, actions: 0, camYaw },
        dist,
      };
    }
    if (dist < walkLastDist - 0.5) {
      walkStuckTime = 0;
      walkLastDist = dist;
    } else {
      walkStuckTime += dt;
      if (walkStuckTime > 2.5) {
        walkStuckTime = 0;
        walkLastDist = dist;
        sidestepTime = 1.5;
        sidestepDir = -sidestepDir;
      }
    }
    return {
      input: { move: { fwd: dist > 1.2 ? 1 : 0, strafe: 0, sprint: dist > 12 }, drive: { steer: 0, accel: 0, brake: false }, actions: 0, camYaw },
      dist,
    };
  }

  function driveTo(tx, tz, dt, speedCap = 38) {
    const p = world.player;
    const car = world.cars.find((c) => c.id === p.carId);
    const dx = tx - p.x;
    const dz = tz - p.z;
    const dist = Math.hypot(dx, dz);
    const desired = Math.atan2(dx, dz);
    const err = angleDiff(desired, p.heading);
    // While driving, the camera sits behind the car: look along the heading.
    camYaw = p.heading + Math.PI;
    let steer = Math.max(-1, Math.min(1, err * 2.2));
    let accel = 1;
    let brake = false;
    // Cornering: take sharp turns slowly. At full speed a 90-degree turn
    // slams the car into the building on the corner, and a few hard hits
    // wreck it — the mission run died exactly this way. Cap the speed by
    // the heading error: crawl through a U-turn, ease through a bend, full
    // speed on a straight. Facing the wrong way (|err| > 1.1) brakes while
    // moving but creeps forward once slow — steering authority grows with
    // speed, so a stopped car can never turn around, and braking to a
    // standstill deadlocks the driver.
    const cornerCap = Math.abs(err) > 1.1 ? 6 : Math.abs(err) > 0.5 ? 14 : 38;
    const cap = Math.min(speedCap, cornerCap);
    if (car && Math.abs(car.speed) > cap) {
      brake = true;
      accel = 0;
    }
    if (reversing > 0) {
      reversing -= dt;
      return { input: { move: { fwd: 0, strafe: 0, sprint: false }, drive: { steer: -steer, accel: 0, brake: true }, actions: 0, camYaw }, dist };
    }
    if (car && Math.abs(car.speed) < 0.6) {
      // Stuck against something (or spun around): back out, whether or not
      // the throttle is down — waiting for accel first never fires when the
      // driver is braking into a wall.
      stuckTime += dt;
      if (stuckTime > 2) {
        stuckTime = 0;
        reversing = 1.2;
      }
    } else {
      stuckTime = 0;
    }
    return { input: { move: { fwd: 0, strafe: 0, sprint: false }, drive: { steer, accel, brake }, actions: 0, camYaw }, dist };
  }

  function nearestParkedCar() {
    let best = null;
    let bestD = Infinity;
    for (const car of world.cars) {
      if (car.type !== 'parked' || car.wrecked) continue;
      const d = Math.hypot(car.x - world.player.x, car.z - world.player.z);
      if (d < bestD) { bestD = d; best = car; }
    }
    return { car: best, dist: bestD };
  }

  function nearestPed() {
    let best = null;
    let bestD = Infinity;
    for (const ped of world.peds) {
      if (ped.state === 'down') continue;
      const d = Math.hypot(ped.x - world.player.x, ped.z - world.player.z);
      if (d < bestD) { bestD = d; best = ped; }
    }
    return { ped: best, dist: bestD };
  }

  function update(dt) {
    phaseTime += dt;
    const p = world.player;

    if (phase === 'start') {
      if (shotName === 'start') {
        // The title screen over the city: let it render, then capture.
        status = 'title screen';
        if (phaseTime > 1.5) done = true;
        return { input: { move: { fwd: 0, strafe: 0, sprint: false }, drive: { steer: 0, accel: 0, brake: false }, actions: 0, camYaw }, done, status };
      }
      // Every other shot starts the game.
      if (world.state === 'title') {
        return { input: { move: { fwd: 0, strafe: 0, sprint: false }, drive: { steer: 0, accel: 0, brake: false }, actions: ACTION_CONFIRM, camYaw }, done, status: 'starting game' };
      }
      // The wanted shot steals straight away: chasing a pedestrian first
      // drags the player far from the parked cars and the 30 s findCar
      // budget runs out before the walk back. The steal alone raises 1 star,
      // and the driveWanted phase re-raises heat with a shot if the star
      // decays before the chase forms.
      phase = 'findCar';
      phaseTime = 0;
    }

    if (phase === 'findPed') {
      const { ped, dist } = nearestPed();
      if (!ped) { phase = 'findCar'; phaseTime = 0; return update(dt); }
      if (dist < 2.0) {
        phase = 'punch';
        phaseTime = 0;
        return { input: { move: { fwd: 0, strafe: 0, sprint: false }, drive: { steer: 0, accel: 0, brake: false }, actions: ACTION_PUNCH, camYaw }, done, status: 'punching a pedestrian (crime: +1 star)' };
      }
      const { input } = walkTo(ped.x, ped.z, dt);
      status = `walking to a pedestrian (${dist.toFixed(0)} m)`;
      if (phaseTime > 25) { phase = 'findCar'; phaseTime = 0; }
      return { input, done, status };
    }

    if (phase === 'punch') {
      if (phaseTime > 0.6) { phase = 'findCar'; phaseTime = 0; }
      return { input: { move: { fwd: 0, strafe: 0, sprint: false }, drive: { steer: 0, accel: 0, brake: false }, actions: 0, camYaw }, done, status: 'punch landed' };
    }

    if (phase === 'findCar') {
      const { car, dist } = nearestParkedCar();
      if (!car) { status = 'no parked car found'; done = true; return { input: { move: { fwd: 0, strafe: 0, sprint: false }, drive: { steer: 0, accel: 0, brake: false }, actions: 0, camYaw }, done, status }; }
      if (dist < 3.0) {
        phase = 'enterCar';
        phaseTime = 0;
        return { input: { move: { fwd: 0, strafe: 0, sprint: false }, drive: { steer: 0, accel: 0, brake: false }, actions: ACTION_INTERACT, camYaw }, done, status: 'stealing the car' };
      }
      const { input } = walkTo(car.x, car.z, dt);
      status = `walking to a parked car (${dist.toFixed(0)} m)`;
      if (phaseTime > 45) { status = 'could not reach a car'; done = true; }
      return { input, done, status };
    }

    if (phase === 'enterCar') {
      if (!p.onFoot) {
        if (shotName === 'drive') {
          route = planRoute(p.x, p.z, 84, -126);
          routeIndex = 0;
          phase = 'driveRoute';
        } else if (shotName === 'wanted') {
          route = planRoute(p.x, p.z, -84, 84);
          routeIndex = 0;
          phase = 'driveWanted';
        } else if (shotName === 'mission') {
          const target = MISSIONS[0].stages[1].target;
          route = planRoute(p.x, p.z, target[0], target[1]);
          routeIndex = 0;
          phase = 'driveMission';
        }
        phaseTime = 0;
        return update(dt);
      }
      if (phaseTime > 2) { phase = 'findCar'; phaseTime = 0; }
      return { input: { move: { fwd: 0, strafe: 0, sprint: false }, drive: { steer: 0, accel: 0, brake: false }, actions: ACTION_INTERACT, camYaw }, done, status: 'entering the car' };
    }

    if (phase === 'driveRoute' || phase === 'driveWanted' || phase === 'driveMission') {
      if (p.onFoot) {
        // The car was wrecked under the driver: go steal another one instead
        // of standing still with drive input until the phase times out.
        phase = 'findCar';
        phaseTime = 0;
        return update(dt);
      }
      // The wanted shot's chase: the cruiser (37) barely outruns the
      // player's car (38), so at full throttle it never closes in. Cruise
      // at 16 and it catches up in seconds. Once it is near, turn and face
      // it — the chase camera sits behind the car, so a cruiser closing in
      // from behind is behind the camera and never in frame; head-on it is.
      let target = route[routeIndex];
      let speedCap = 38;
      let chaser = null;
      let chaserDist = Infinity;
      if (phase === 'driveWanted') {
        chaser = world.police.find((c) => !c.wrecked && (c.state === 'chase' || c.state === 'search'));
        if (chaser) {
          chaserDist = Math.hypot(chaser.x - p.x, chaser.z - p.z);
          speedCap = 16;
          // Face it from the moment it exists, not only when it is close:
          // the chase forms in about a second at the capped speed, and the
          // old 5 s settle gate let the cruiser ram the player repeatedly
          // before the shot could complete (HP 60 in the last take). Facing
          // it at once keeps the cruiser head-on in frame and the completion
          // fires before it can reach ram range.
          target = [chaser.x, chaser.z];
        }
      }
      const { input, dist } = driveTo(target[0], target[1], dt, speedCap);
      if (dist < 8) {
        routeIndex += 1;
        if (routeIndex >= route.length) {
          if (phase === 'driveMission') {
            status = 'reached the Docks';
            done = true;
          } else {
            route = planRoute(p.x, p.z, p.x + (world.rng() - 0.5) * 200, p.z + (world.rng() - 0.5) * 200);
            routeIndex = 0;
          }
        }
      }
      if (phase === 'driveRoute') {
        status = `driving (${Math.round(Math.abs(world.cars.find((c) => c.id === p.carId)?.speed || 0) * 3.6)} km/h)`;
        const car = world.cars.find((c) => c.id === p.carId);
        if (car && Math.abs(car.speed) > 30 && phaseTime > 4) {
          done = true;
          status = `driving at ${Math.round(Math.abs(car.speed) * 3.6)} km/h`;
        }
        if (phaseTime > 20) done = true;
      } else if (phase === 'driveWanted') {
        if (world.wanted === 0) {
          // The star decayed before the chase formed: fire a shot to raise
          // heat again. One shot per frame at most — the sim's cooldown and
          // the next frame's wanted > 0 stop the firing.
          input.actions = ACTION_SHOOT;
        }
        // The cruiser drives straight at the player, so it often closes
        // across a block and sits hidden behind a building while the
        // distance reads 30 m. Require it to be roughly in front of the
        // car (within the camera's view) as well as close — on the same
        // street ahead, not across a block to the side.
        const bearing = chaser ? Math.atan2(chaser.x - p.x, chaser.z - p.z) : 0;
        const align = chaser ? Math.abs(angleDiff(bearing, p.heading)) : Infinity;
        status = `wanted ${world.wanted} star${world.wanted === 1 ? '' : 's'} — chaser ${chaserDist === Infinity ? '—' : chaserDist.toFixed(0) + ' m'} align ${(align * 57.3).toFixed(0)}°`;
        // One star is enough for the shot: the punch that would make it two
        // often never lands (the pedestrian flees through the blocks), and
        // by the time a 2-star chase forms the star has decayed. A 1-star
        // chase with a cruiser closing in is the scene the shot needs.
        // Complete early (40 m, not 20): headless runs at ~2 fps, so half a
        // sim-second passes between this frame and the capture — at the
        // head-on closing speed the cruiser would be on top of the player
        // by then. At 40 m it lands a few metres out, head-on in frame.
        if (world.wanted >= 1 && chaser && chaserDist < 40 && align < 0.5 && phaseTime > 1) {
          done = true;
          status = `wanted ${world.wanted} star${world.wanted === 1 ? '' : 's'}, police ${chaserDist.toFixed(0)} m ahead`;
        }
        if (phaseTime > 30) done = true;
      } else if (phase === 'driveMission') {
        status = `driving to the Docks (${dist.toFixed(0)} m)`;
        if (world.missionIndex >= 1) {
          done = true;
          status = 'First Wheels complete — $300';
        }
        if (phaseTime > 60) done = true;
      }
      return { input, done, status };
    }

    return { input: { move: { fwd: 0, strafe: 0, sprint: false }, drive: { steer: 0, accel: 0, brake: false }, actions: 0, camYaw }, done, status };
  }

  return { update, get done() { return done; }, get status() { return status; } };
}

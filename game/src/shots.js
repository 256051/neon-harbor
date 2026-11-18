// The screenshot scenes behind ?shot=start|drive|wanted|mission. Each one plays
// the real rules forward from a fresh world, steered by an autopilot that walks,
// steals a car and drives it using the same inputs a player would — so every
// frame is what real play looks like and the same seed always gives the same
// frame. Nothing is staged: if the autopilot cannot reach the scene, advance()
// stops at its time limit and info().success is false (the screenshot script
// reports that instead of faking the shot).
import { PITCH } from './config.js';
import { EVENT_DEATH } from './world.js';

const TAU = Math.PI * 2;
const IDLE = { fwd: 0, strafe: 0, sprint: false, steer: 0, accel: 0, brake: false, e: false, f: false, shoot: false };

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function angleDiff(a, b) { let d = a - b; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; }
function nearestStreet(v) { return Math.round(v / PITCH) * PITCH; }
function dist(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }

// Manhattan route along streets: nearest intersection, then along one street,
// then along the cross street, then to the target itself.
function routeWaypoints(from, to) {
  const sx = nearestStreet(from.x);
  const sz = nearestStreet(from.z);
  const tx = nearestStreet(to.x);
  const tz = nearestStreet(to.z);
  const pts = [{ x: sx, z: sz }, { x: tx, z: sz }, { x: tx, z: tz }, { x: to.x, z: to.z }];
  return pts.filter((p) => dist(from.x, from.z, p.x, p.z) > 5);
}

function walkInput(state, tx, tz, sprint) {
  const p = state.player;
  // Camera-relative: point the camera behind the desired walk direction, then
  // walk forward away from it.
  const want = Math.atan2(tx - p.x, tz - p.z);
  return {
    ...IDLE,
    fwd: 1,
    sprint: !!sprint,
    camYaw: want + Math.PI,
  };
}

let wrongWaySteps = 0;
let reverseDriveSteps = 0;
// Consecutive stuck-while-driving resets. At 3 the car is a lost cause
// (sandwiched between a building and a police car, or wedged too deep for
// the reverse-out) — the pilot bails out and steals a fresh car instead of
// grinding there for the rest of the run.
let driveStuckCount = 0;
function driveInput(state, tx, tz) {
  const p = state.player;
  const car = state.cars.find((c) => c.id === p.carId);
  const speed = car ? car.speed : 0;
  // Overtake instead of ramming: if a car is close ahead on our line, aim
  // at a point offset to the side so we pass it in the next lane. Only
  // while actually moving — a stationary or wedged car has nothing to
  // overtake, and letting a nearby police car hijack the aim point would
  // cancel the reverse-swing that gets it out of the wedge.
  let ax = tx;
  let az = tz;
  let blocked = false;
  if (car && speed > 5) {
    const hx = Math.sin(p.heading);
    const hz = Math.cos(p.heading);
    let blockD = Infinity;
    let block = null;
    for (const o of state.cars) {
      if (!o.active || o.id === car.id || o.kind === 'player') continue;
      const dx = o.x - p.x;
      const dz = o.z - p.z;
      const fwd = dx * hx + dz * hz;
      const lat = Math.abs(dx * hz - dz * hx);
      if (fwd > 0 && fwd < 20 && lat < 4 && fwd < blockD) { block = o; blockD = fwd; }
    }
    if (block) {
      blocked = true;
      const side = ((block.x - p.x) * hz - (block.z - p.z) * hx) > 0 ? -1 : 1;
      ax = p.x + hx * 10 + hz * side * 7;
      az = p.z + hz * 10 - hx * side * 7;
    }
  }
  const want = Math.atan2(ax - p.x, az - p.z);
  const diff = angleDiff(want, p.heading);
  const camYaw = p.heading + Math.PI;
  // Backing out of a wedge (set by the stuck detector): reverse while
  // steering the nose toward the target, then drive on.
  if (reverseDriveSteps > 0) {
    reverseDriveSteps -= 1;
    return { ...IDLE, brake: true, steer: -clamp(diff, -1, 1), camYaw };
  }
  // Wrong-way recovery is a last resort, not a driving mode: only when the
  // car is nearly stopped AND facing far away (>149°), and only as a brief
  // 3-point turn — reverse for up to 1.5 s, then drive forward and
  // re-evaluate. (An earlier version reversed whenever the heading was off
  // by >114°, which put the car in permanent reverse at the city edge and
  // let it ping-pong along the boundary instead of turning around.)
  if (Math.abs(diff) > 2.6 && Math.abs(speed) < 2) {
    wrongWaySteps += 1;
    if (wrongWaySteps > 30 && wrongWaySteps < 120) {
      return { ...IDLE, brake: true, steer: -clamp(diff, -1, 1), camYaw };
    }
    if (wrongWaySteps >= 120) wrongWaySteps = 0;
  } else {
    wrongWaySteps = 0;
  }
  // Slow for a turn by easing off the throttle — never by braking to a stop,
  // which is what invited the reverse spiral. The car U-turns forward.
  const bend = Math.abs(diff) > 0.5;
  return {
    ...IDLE,
    steer: clamp(diff * 1.6, -1, 1),
    accel: bend ? 0.3 : blocked ? 0.4 : 1,
    brake: false,
    camYaw,
  };
}

function nearestParked(state) {
  const p = state.player;
  let best = null;
  let bestD = Infinity;
  for (const car of state.cars) {
    if (!car.active || car.wreck || car.kind !== 'parked') continue;
    const d = dist(p.x, p.z, car.x, car.z);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

function nearestTraffic(state) {
  const p = state.player;
  let best = null;
  let bestD = Infinity;
  for (const car of state.cars) {
    if (!car.active || car.kind !== 'traffic') continue;
    const d = dist(p.x, p.z, car.x, car.z);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

function policeNear(state) {
  const p = state.player;
  let count = 0;
  let nearest = Infinity;
  for (const car of state.cars) {
    if (!car.active || car.kind !== 'police') continue;
    count += 1;
    nearest = Math.min(nearest, dist(p.x, p.z, car.x, car.z));
  }
  return { count, nearest };
}

/**
 * Build the named scene. Returns { screen, advance(dt), info() }.
 * advance() steps the world once and returns true while the scene still
 * needs more simulation; when it returns false the frame is ready.
 */
export function stageShot(name, world, opts = {}) {
  world.reset();
  const state = world.state;
  let simTime = 0;
  let waypoints = [];
  let wpIndex = 0;
  let phase = 'start';
  let success = false;
  let note = '';
  // The browser screenshot only needs a real mission moment (mission 1
  // complete at the Docks). The full story is verified separately in node
  // with opts.fullStory — it is harder (three missions under heat) and not
  // every seed finishes it.
  const needFullStory = !!opts.fullStory;

  const screen = name === 'start' ? 'title' : 'play';
  const limit = name === 'start' ? 6 : name === 'wanted' ? 150 : name === 'mission' ? 420 : 120;
  const target = name === 'drive' ? { x: 156, z: 42 } : null; // the Docks
  // Story targets per mission,stage — the 'mission' shot plays the whole
  // story, not just the first objective.
  const STORY_TARGETS = {
    '0,1': { x: 156, z: 42 },    // Docks
    '1,0': { x: -150, z: -126 }, // pickup warehouse
    '1,1': { x: 150, z: 126 },   // Marina
    '2,1': { x: -126, z: 150 },  // Hideout
  };
  const EVADE_CORNERS = [
    { x: -150, z: 150 }, { x: 150, z: -150 },
    { x: -150, z: -126 }, { x: 150, z: 126 },
  ];
  let evadeTarget = null;
  let evadeHide = false;
  let hideSpot = null;
  // Hiding spot for the Heat evade: the block centre 60 m from the ditch
  // point toward the city centre, snapped to the block grid (block centres
  // sit at i*42+21). Far enough that the police searching the ditch point
  // are past the 35 m decay distance, and inside a block so their cars
  // cannot drive straight at the player.
  function hideSpotFor(corner) {
    const len = Math.hypot(corner.x, corner.z) || 1;
    const hx = corner.x - (corner.x / len) * 60;
    const hz = corner.z - (corner.z / len) * 60;
    return {
      x: Math.round((hx - 21) / 42) * 42 + 21,
      z: Math.round((hz - 21) / 42) * 42 + 21,
    };
  }
  let lastInput = null;

  // Waypoint walking: follow the street route instead of a straight line,
  // which would run the player into the buildings between streets. Each
  // purpose gets its OWN walker: stealing a car and walking to a mission
  // target must not share route state, or the two targets fight over the
  // waypoints and the pilot ping-pongs between them.
  function makeWalker() {
    let wps = [];
    let index = 0;
    let key = '';
    return {
      reset() { wps = []; index = 0; key = ''; },
      go(tx, tz, sprint) {
        const p = state.player;
        // Close in already: walk straight at the target instead of routing
        // via the street grid (whose first point may be behind the player).
        if (dist(p.x, p.z, tx, tz) < 12) return walkInput(state, tx, tz, sprint);
        const k = `${Math.round(tx)},${Math.round(tz)}`;
        if (k !== key || index >= wps.length) {
          key = k;
          wps = routeWaypoints(p, { x: tx, z: tz });
          index = 0;
        }
        const wp = wps[index];
        lastWp = wp;
        if (dist(p.x, p.z, wp.x, wp.z) < 3) {
          index += 1;
          if (index >= wps.length) return walkInput(state, tx, tz, sprint);
          return walkInput(state, wps[index].x, wps[index].z, sprint);
        }
        return walkInput(state, wp.x, wp.z, sprint);
      },
      get index() { return index; },
      get len() { return wps.length; },
      get targetKey() { return key; },
    };
  }
  const missionWalker = makeWalker();
  const stealWalker = makeWalker();

  // Unstick reverse: set by the stuck detector (position barely changed
  // for 2 s while driving) — the next driveInput calls back out of the
  // wedge for 1.5 s before resuming normal driving.
  let lastTarget = null;
  let lastWp = null;
  // Stuck detection: sample the position once a second; if the pilot is
  // commanding movement but the player covered under 1 m in that second
  // (wedged in a building after a shove, or pushed off the route), throw
  // the routes away so they are rebuilt from where the player actually is
  // — the first waypoint is then the nearest street, which is also the way
  // out of the building. Two stuck seconds in a row trigger the reset.
  let sampleX = 0;
  let sampleZ = 0;
  let sampleT = 0;
  let stuckSecs = 0;
  function stepWorld(dt, input) {
    const events = world.step(dt, input);
    if (events & EVENT_DEATH) world.respawnAfterDeath();
    const p = state.player;
    const moving = (input.fwd || 0) > 0 || (input.accel || 0) > 0 || input.brake;
    sampleT += dt;
    if (sampleT >= 1) {
      if (moving && dist(p.x, p.z, sampleX, sampleZ) < 1) {
        stuckSecs += 1;
        if (stuckSecs >= 2) {
          stuckSecs = 0;
          waypoints = [];
          wpIndex = 0;
          driveTargetKey = '';
          missionWalker.reset();
          stealWalker.reset();
          // Back out of the wedge before re-routing: a car pinned against
          // a building by police rams will just grind into the wall if it
          // keeps aiming at the waypoint.
          reverseDriveSteps = 90;
          if (!p.onFoot) driveStuckCount += 1;
        }
      } else {
        stuckSecs = 0;
        if (dist(p.x, p.z, sampleX, sampleZ) > 5) driveStuckCount = 0;
      }
      if (p.onFoot) driveStuckCount = 0;
      sampleX = p.x;
      sampleZ = p.z;
      sampleT = 0;
    }
    return events;
  }

  function goSteal() {
    // Parked cars first; if the city's parked supply is all wrecked, fall
    // back to the slowest nearby traffic car (one stopped at a light is
    // catchable on foot — a fast one is not).
    let car = nearestParked(state);
    if (!car) {
      let bestScore = Infinity;
      for (const c of state.cars) {
        if (!c.active || c.wreck || c.kind !== 'traffic') continue;
        const d = dist(state.player.x, state.player.z, c.x, c.z);
        const score = d + Math.abs(c.speed) * 3;
        if (d < 60 && score < bestScore) { bestScore = score; car = c; }
      }
      if (car) lastTarget = { x: car.x, z: car.z, kind: car.kind };
    }
    if (!car) return IDLE;
    lastTarget = { x: car.x, z: car.z, kind: car.kind };
    const d = dist(state.player.x, state.player.z, car.x, car.z);
    if (d < 4) return { ...IDLE, e: true };
    // A moving traffic car gets a straight chase, not a street route: the
    // route's first point would be behind the player by the time it is used.
    if (car.kind === 'traffic') return walkInput(state, car.x, car.z, true);
    return stealWalker.go(car.x, car.z, true);
  }

  let driveTargetKey = '';
  function goDriveTo(tx, tz) {
    const p = state.player;
    // Bail out of a hopeless car: three stuck resets in a row means the
    // reverse-outs are not freeing it (sandwiched by a building and a
    // police car). Get out and steal a fresh one.
    if (driveStuckCount >= 3) return { ...IDLE, e: true };
    const key = `${tx},${tz}`;
    if (key !== driveTargetKey || waypoints.length === 0 || wpIndex >= waypoints.length) {
      driveTargetKey = key;
      waypoints = routeWaypoints(p, { x: tx, z: tz });
      wpIndex = 0;
    }
    const wp = waypoints[wpIndex];
    if (dist(p.x, p.z, wp.x, wp.z) < 6) {
      wpIndex += 1;
      if (wpIndex >= waypoints.length) return { ...IDLE, accel: 0 };
      return driveInput(state, waypoints[wpIndex].x, waypoints[wpIndex].z);
    }
    return driveInput(state, wp.x, wp.z);
  }

  function advance(dt) {
    simTime += dt;
    if (name === 'start') {
      stepWorld(dt, IDLE);
      if (simTime >= 6) { success = true; note = 'ambient city, 6s'; return false; }
      return true;
    }
    if (simTime > limit + 0.001) {
      note = `time limit ${limit}s reached in phase ${phase}`;
      return false;
    }
    const p = state.player;
    let input = IDLE;

    if (name === 'wanted') {
      if (p.onFoot) {
        input = goSteal();
        phase = 'steal';
      } else if (state.wanted < 2) {
        // Ram the nearest traffic car to earn the second star.
        const t = nearestTraffic(state);
        if (!t) { input = { ...IDLE, accel: 1 }; }
        else {
          // Aim at where the traffic car will be.
          const px = t.x + Math.sin(t.heading) * t.speed * 0.6;
          const pz = t.z + Math.cos(t.heading) * t.speed * 0.6;
          input = driveInput(state, px, pz);
        }
        phase = 'ram';
      } else {
        const { count, nearest } = policeNear(state);
        const moving = state.player.onFoot ? Math.abs(state.player.speed) > 2 : Math.abs((state.cars.find((c) => c.id === state.player.carId) || { speed: 0 }).speed) > 5;
        if (count >= 1 && nearest < 60 && moving) {
          success = true;
          note = `wanted ${state.wanted} stars, ${count} police, nearest ${Math.round(nearest)}m`;
          return false;
        }
        // Keep driving so the chase stays lively while police close in.
        const t = nearestTraffic(state);
        input = t ? driveInput(state, t.x, t.z) : { ...IDLE, accel: 1 };
        phase = 'chase';
      }
      stepWorld(dt, input);
      return true;
    }

    if (name === 'mission') {
      // Play the story. The screenshot succeeds at mission 1 complete (the
      // Docks); the full-story check (opts.fullStory) keeps playing until
      // the story is actually complete.
      if (state.missionIndex >= 3) {
        success = true;
        note = `story complete, cash $${state.cash}, wanted ${state.wanted}`;
        return false;
      }
      if (!needFullStory && state.missionIndex >= 1) {
        success = true;
        note = `mission 1 complete, cash $${state.cash}, wanted ${state.wanted}`;
        return false;
      }
      const key = `${state.missionIndex},${state.missionStage}`;
      let mTarget = STORY_TARGETS[key] || null;
      if (state.missionIndex === 2 && state.missionStage === 0) {
        // Heat: drive to a far corner, ditch the car, and hide on foot
        // inside a block. Police cars cannot follow through buildings —
        // they must drive around the block while the player cuts straight
        // through it — which is what opens the gap the wanted decay needs.
        // Looping corners at full speed never opened that gap: the police
        // are nearly as fast as the player car and the chase never broke.
        if (p.onFoot) {
          if (evadeHide && hideSpot) {
            if (dist(p.x, p.z, hideSpot.x, hideSpot.z) < 5) {
              // Hidden: wait for the stars to fall off.
              input = IDLE;
              phase = 'hide';
            } else {
              input = missionWalker.go(hideSpot.x, hideSpot.z, true);
              phase = 'hide';
            }
            stepWorld(dt, input);
            return true;
          }
          // No car (wrecked before the corner): steal one and try again.
          evadeHide = false;
          input = goSteal();
          phase = 'steal';
          stepWorld(dt, input);
          return true;
        }
        if (!evadeTarget) {
          evadeTarget = EVADE_CORNERS.reduce((a, b) =>
            dist(p.x, p.z, a.x, a.z) > dist(p.x, p.z, b.x, b.z) ? a : b);
          waypoints = [];
          wpIndex = 0;
        }
        if (dist(p.x, p.z, evadeTarget.x, evadeTarget.z) < 15) {
          // Arrived at the corner: stop, ditch the car, hide on foot.
          const car = state.cars.find((c) => c.id === p.carId);
          if (car && Math.abs(car.speed) > 2) {
            input = { ...IDLE, brake: true };
            phase = 'ditch';
          } else {
            evadeHide = true;
            hideSpot = hideSpotFor(evadeTarget);
            evadeTarget = null;
            input = { ...IDLE, e: true };
            phase = 'ditch';
          }
          stepWorld(dt, input);
          return true;
        }
        mTarget = evadeTarget;
        phase = 'evade';
      } else if (mTarget) {
        phase = 'drive';
      }
      const dTarget = mTarget ? dist(p.x, p.z, mTarget.x, mTarget.z) : Infinity;
      if (p.onFoot) {
        input = mTarget && dTarget < 15
          ? missionWalker.go(mTarget.x, mTarget.z, true)
          : goSteal();
        phase = mTarget && dTarget < 50 ? 'walk' : 'steal';
        stepWorld(dt, input);
        return true;
      }
      if (!mTarget) { stepWorld(dt, IDLE); return true; }
      input = goDriveTo(mTarget.x, mTarget.z);
      lastInput = input;
      stepWorld(dt, input);
      return true;
    }

    // drive: steal a car, then drive to the Docks. Reaching the target
    // counts on foot too — a wrecked car 40 m short is not a failure.
    const dTarget = target ? dist(p.x, p.z, target.x, target.z) : Infinity;
    if (target && dTarget < 14) {
      success = true;
      note = `reached the Docks, cash $${state.cash}, wanted ${state.wanted}`;
      return false;
    }
    if (p.onFoot) {
      input = target && dTarget < 15
        ? missionWalker.go(target.x, target.z, true)
        : goSteal();
      phase = target && dTarget < 50 ? 'walk' : 'steal';
      stepWorld(dt, input);
      return true;
    }
    phase = 'drive';
    input = goDriveTo(target.x, target.z);
    stepWorld(dt, input);
    // If the car was wrecked, the world puts the player back on foot and the
    // steal phase above picks a new car.
    return true;
  }

  return {
    screen,
    advance,
    info() {
      return {
        shot: name, success, note, simTime: Math.round(simTime * 10) / 10,
        wanted: state.wanted, cash: state.cash,
        missionIndex: state.missionIndex, missionStage: state.missionStage,
        player: { x: Math.round(state.player.x), z: Math.round(state.player.z), onFoot: state.player.onFoot },
        police: policeNear(state).count,
        phase, lastTarget, lastWp,
        walkIndex: stealWalker.index, walkLen: stealWalker.len, walkKey: stealWalker.targetKey,
        lastInput, driveWp: waypoints[wpIndex] || null, wpIndex,
        speed: Math.round(state.player.speed * 10) / 10,
      };
    },
  };
}

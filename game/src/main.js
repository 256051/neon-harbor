// Neon Harbor — the game entry. Wires the simulation (world.js), the
// renderer (render.js), the HUD (hud.js), input and sound together and runs
// the fixed-timestep loop. Switches, all read from the URL:
//   ?seed=1          world seed (default 1)
//   ?shot=start|drive|wanted|mission   screenshot mode: the autopilot in
//                    shots.js plays, and window.__shotReady / __shotInfo
//                    report when the scene is ready to capture
//   ?bench           benchmark mode: live stats in #bench-overlay and in
//                    window.__stats()
//   ?q=low|medium|high   starting quality tier (default high)
import { createWorld, stepWorld, startGame, pauseGame, resumeGame, restartGame, missionStageDef, readSave, loadSave, writeSave, getSave,
  EVENT_START, EVENT_CRASH, EVENT_MONEY, EVENT_WANTED, EVENT_PUNCH, EVENT_SHOOT, EVENT_SHOT_HIT, EVENT_SHOT_MISS,
  EVENT_POLICE_RAM, EVENT_HORN, EVENT_MISSION, EVENT_WIN, EVENT_LOSE, EVENT_PICKUP, EVENT_STEP } from './world.js';
import { createRenderer } from './render.js';
import { createHud } from './hud.js';
import { createInput, ACTION_CONFIRM, ACTION_PAUSE, ACTION_INTERACT, ACTION_PUNCH, ACTION_SHOOT, ACTION_MUTE } from './input.js';
import { createSound } from './sound.js';
import { createShotDriver } from './shots.js';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') || 1) || 1;
const shotName = params.get('shot');
const benchMode = params.has('bench');
const qualityParam = params.get('q') || 'high';

const gameCanvas = document.getElementById('game-canvas');
const hudCanvas = document.getElementById('hud-canvas');
const benchOverlay = document.getElementById('bench-overlay');

const world = createWorld(seed);
world.hasSave = !!readSave();
const renderer = createRenderer(gameCanvas, world, { quality: qualityParam, autoQuality: !shotName && !benchMode });
const hud = createHud(hudCanvas, world);
const sound = createSound();

let camYaw = 0;
let camPitch = 0.32;
let camDist = 10.5;
const input = createInput(gameCanvas, (dx, dy, wheel) => {
  camYaw -= dx * 0.005;
  camPitch = Math.max(0.08, Math.min(0.9, camPitch + dy * 0.003));
  if (wheel) camDist = Math.max(6, Math.min(16, camDist + wheel * 0.01));
});

// --- Shot mode: the autopilot plays and reports readiness. ------------------
let shotDriver = null;
if (shotName) {
  shotDriver = createShotDriver(world, shotName);
  window.__shotReady = false;
  window.__shotInfo = null;
}

// --- Bench mode: show the overlay, count frames and steps. ------------------
const bench = { frames: 0, steps: 0, startTime: performance.now(), fps: 0 };
if (benchMode) {
  benchOverlay.style.display = 'block';
}
window.__stats = () => ({
  fps: bench.fps,
  frames: bench.frames,
  steps: bench.steps,
  quality: renderer.getQuality(),
  state: world.state,
  wanted: world.wanted,
  cash: world.player.cash,
  missionIndex: world.missionIndex,
  missionStage: world.missionStage,
});

// --- Sound: unlock on the first gesture, as browsers require. ----------------
let soundUnlocked = false;
function unlockSound() {
  if (soundUnlocked) return;
  soundUnlocked = true;
  sound.init();
  sound.startMusic();
}
window.addEventListener('keydown', unlockSound, { once: true });
window.addEventListener('pointerdown', unlockSound, { once: true });

// --- Events from the simulation become sound and toasts. ---------------------
let lastToast = '';
let sirenTimer = 0;
let engineTimer = 0;
function handleEvents(events, dt) {
  if (events & EVENT_START) sound.click();
  if (events & EVENT_CRASH) sound.crash();
  if (events & EVENT_MONEY) sound.pickup();
  if (events & EVENT_WANTED) sound.wanted();
  if (events & EVENT_PUNCH) sound.punch();
  if (events & EVENT_SHOOT) sound.shoot();
  if (events & EVENT_SHOT_HIT) sound.click();
  if (events & EVENT_SHOT_MISS) { /* a miss is silent */ }
  if (events & EVENT_POLICE_RAM) sound.crash();
  if (events & EVENT_HORN) sound.horn();
  if (events & EVENT_MISSION) sound.mission();
  if (events & EVENT_WIN) sound.win();
  if (events & EVENT_LOSE) sound.fail();
  if (events & EVENT_PICKUP) sound.pickup();
  if (events & EVENT_STEP) sound.step();
  if (world.missionToast && world.missionToast !== lastToast) {
    lastToast = world.missionToast;
    hud.showToast(world.missionToast, 5);
  }
  // Siren sting while chased, engine hum while driving.
  sirenTimer -= dt;
  if (world.wanted > 0 && world.police.some((c) => !c.wrecked && c.state === 'chase') && sirenTimer <= 0) {
    sirenTimer = 2.0;
    sound.siren();
  }
  engineTimer -= dt;
  if (!world.player.onFoot && Math.abs(world.player.speed) > 5 && engineTimer <= 0) {
    engineTimer = 0.35;
    sound.engine();
  }
}

// --- Mission beacon: point at the current target, if it has one. -------------
function updateBeacon() {
  if (world.state !== 'playing') { renderer.setBeacon(0, 0, false); return; }
  const stage = missionStageDef(world);
  if (stage && stage.target) renderer.setBeacon(stage.target[0], stage.target[1], true);
  else renderer.setBeacon(0, 0, false);
}

// --- The loop: fixed 1/60 s simulation steps, render every frame. ------------
const STEP = 1 / 60;
let lastTime = performance.now();
let accumulator = 0;
let firstFrame = true;

function frame(now) {
  requestAnimationFrame(frame);
  // The delta is capped at 0.5 s (30 fixed steps): on a slow machine — a
  // software renderer headless, say — the simulation still keeps up with
  // real time instead of falling behind a frame at a time.
  const dt = Math.min(0.5, (now - lastTime) / 1000);
  lastTime = now;
  bench.frames += 1;

  const actions = input.takeActions();
  if (shotDriver) {
    // Shot mode: the driver supplies the input; the player never touches it.
    const { input: shotInput, done, status } = shotDriver.update(dt);
    if ((shotInput.actions & ACTION_CONFIRM) && (world.state === 'title' || world.state === 'dead' || world.state === 'win')) {
      // The driver's start signal: title -> start, dead/win -> restart.
      // stepWorld never sees CONFIRM, so main.js must act on it here —
      // without this the autopilot waits on the title screen forever.
      if (world.state === 'title') startGame(world);
      else restartGame(world);
    }
    camYaw = shotInput.camYaw;
    renderer.setCameraYaw(camYaw);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP && steps < 30) {
      const events = stepWorld(world, shotInput, STEP);
      handleEvents(events, STEP);
      accumulator -= STEP;
      steps += 1;
      bench.steps += 1;
    }
    updateBeacon();
    renderer.update(dt, null);
    hud.draw(world.state, dt, camYaw);
    if (done && !window.__shotReady) {
      // One more rendered frame, then report: the screenshot catches the
      // finished scene (mission toast, wanted stars, speed) as it stands.
      window.__shotInfo = {
        success: true,
        shot: shotName,
        status,
        state: world.state,
        wanted: world.wanted,
        cash: world.player.cash,
        missionIndex: world.missionIndex,
        missionStage: world.missionStage,
        speedKmh: Math.round(Math.abs(world.player.speed) * 3.6),
      };
      window.__shotReady = true;
    }
  } else {
    // Normal play: keyboard state transitions, then the simulation.
    if (actions & ACTION_MUTE) {
      sound.setMuted(!sound.isMuted());
      hud.showToast(sound.isMuted() ? 'Muted — press M to unmute' : 'Sound on', 2);
    }
    if (world.state === 'title' && (actions & ACTION_CONFIRM)) {
      unlockSound();
      startGame(world);
    } else if (world.state === 'playing' && (actions & ACTION_PAUSE)) {
      pauseGame(world);
      writeSave(world);
    } else if (world.state === 'paused' && (actions & ACTION_PAUSE)) {
      resumeGame(world);
    } else if ((world.state === 'dead' || world.state === 'win') && (actions & ACTION_CONFIRM)) {
      unlockSound();
      restartGame(world);
    }

    const simInput = {
      move: input.move(),
      drive: input.drive(),
      actions: world.state === 'playing' ? actions : 0,
      camYaw,
    };
    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP && steps < 30) {
      if (world.state === 'playing') {
        const events = stepWorld(world, simInput, STEP);
        handleEvents(events, STEP);
        bench.steps += 1;
      }
      accumulator -= STEP;
      steps += 1;
    }
    updateBeacon();
    renderer.setCameraYaw(camYaw);
    renderer.update(dt, { orbit: null });
    hud.draw(world.state, dt, camYaw);
  }

  if (benchMode) {
    const elapsed = (performance.now() - bench.startTime) / 1000;
    bench.fps = elapsed > 0 ? Math.round(bench.frames / elapsed) : 0;
    benchOverlay.textContent = `bench — ${bench.fps} fps · ${bench.frames} frames · ${bench.steps} steps · ${renderer.getQuality()} quality · ${world.state}`;
  }

  if (firstFrame) {
    firstFrame = false;
    window.__ready = true;
  }
}

// A saved game offers a continue: Space on the title screen starts fresh;
// the save is loaded automatically when the player presses C. (Kept simple:
// the title screen shows the hint when a save exists.)
window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyC' && world.state === 'title') {
    const save = readSave();
    if (save) {
      loadSave(world, save);
      unlockSound();
      startGame(world);
      hud.showToast('Save loaded — welcome back to the harbor', 4);
    }
  }
});

window.__game = {
  world, renderer, hud, input, sound,
  get screen() { return world.state; },
  get save() { return getSave(world); },
  restart: () => restartGame(world),
};

requestAnimationFrame(frame);

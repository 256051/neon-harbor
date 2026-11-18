// Neon Harbor — boot and the one loop: input is read every frame, the world
// advances in fixed 1/60 s steps, and the renderer paints what is there. The
// game moves between four screens: title, play, paused and game over (flatlined).
//
// URL switches (development): ?seed=N (fixed city), ?shot=start|drive|
// wanted|mission (screenshot scenes), ?bench (benchmark: no audio, auto
// start, live stats), ?autostart, ?dt=0.016 (fixed step), ?cam=yaw,pitch,dist
// (camera), ?q=low|medium|high|ultra (quality), ?noaudio.
// Debug hooks: window.__stats(), window.__frames, window.__ready, __game.
// Each module's update is wrapped in try/catch: one module throwing logs
// once and never kills the loop.
import { BEST_KEY, FEEL, SAVE_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import {
  createWorld, EVENT_CRASH, EVENT_CRIME, EVENT_DEATH, EVENT_HIT, EVENT_HIT_ENEMY,
  EVENT_KILL, EVENT_MISSION, EVENT_MISSION_FAIL, EVENT_PICKUP, EVENT_POLICE,
  EVENT_PUNCH, EVENT_SHOT, EVENT_STEAL, EVENT_STORY_DONE, EVENT_WEAK_HIT,
} from './world.js';
import {
  ACTION_CONFIRM, ACTION_INTERACT, ACTION_MUTE, ACTION_PAUSE, ACTION_PUNCH, ACTION_SHOOT,
  createInput,
} from './input.js';
import { QUALITY_ORDER, createRenderer } from './render.js';
import { createHud } from './hud.js';
import { createSound } from './sound.js';
import { stageShot } from './shots.js';

// dt clamp: a hitch never lets the simulation tunnel through a wall.
const MAX_FRAME = 0.05;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);
const bench = params.has('bench') || window.location.hash === '#bench';
const autostart = params.has('autostart') || bench;
const noaudio = params.has('noaudio') || bench;
const dtParam = Number.parseFloat(params.get('dt') ?? '');
const fixedDt = Number.isFinite(dtParam) && dtParam > 0 && dtParam <= 0.1 ? dtParam : null;
const camParam = (params.get('cam') ?? '').split(',').map(Number);
const qParam = params.get('q');

const SETTINGS_KEY = 'neon-harbor.settings.v1';
function loadSettings() {
  const fallback = { quality: 'auto' };
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallback;
    const q = typeof parsed.quality === 'string' ? parsed.quality : 'auto';
    const valid = q === 'auto' || QUALITY_ORDER.includes(q);
    return { quality: valid ? q : 'auto' };
  } catch {
    return fallback; // corrupt settings never block the game
  }
}
function saveSettings(settings) {
  try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage off */ }
}
const settings = loadSettings();
if (qParam && (qParam === 'auto' || QUALITY_ORDER.includes(qParam))) settings.quality = qParam;
const initialQuality = settings.quality === 'auto' ? 'high' : settings.quality;

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const bootEl = document.getElementById('boot');
const bootText = document.getElementById('boot-text');
const bootFill = document.getElementById('boot-fill');
const benchEl = document.getElementById('bench-overlay');

function setBoot(text, pct) {
  if (bootText) bootText.textContent = text;
  if (bootFill) bootFill.style.width = `${pct}%`;
}

const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas, world, initialQuality);
const hud = createHud(world);
const sound = createSound({ disabled: noaudio });
if (camParam.length === 3 && camParam.every(Number.isFinite)) {
  world.state.camYaw = camParam[0];
  renderer.cam.pitch = Math.min(0.9, Math.max(0.12, camParam[1]));
  renderer.cam.dist = Math.min(FEEL.camMaxDist, Math.max(FEEL.camMinDist, camParam[2]));
}

const titleScreen = document.getElementById('title-screen');
const pauseScreen = document.getElementById('pause-screen');
const overScreen = document.getElementById('over-screen');

function show(el, on) { el.classList.toggle('hidden', !on); }

// Module isolation: a throwing module logs once and never kills the loop.
const errSeen = new Set();
function safe(name, fn) {
  try {
    fn();
  } catch (err) {
    if (!errSeen.has(name)) {
      errSeen.add(name);
      console.error(`[neon-harbor] ${name} failed (logged once):`, err);
    }
  }
}

function readSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeSave() {
  const s = world.state;
  const p = s.player;
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({
      cash: s.cash, x: p.x, z: p.z, heading: p.heading, health: p.health,
      missionIndex: s.missionIndex, stage: s.missionStage, wanted: s.wanted,
      clockMin: s.clockMin, storyDone: s.storyDone,
    }));
    return true;
  } catch { return false; }
}

function readBest() {
  try { return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0; } catch { return 0; }
}
function saveBest(value) {
  try { window.localStorage.setItem(BEST_KEY, String(value)); } catch { /* storage off */ }
}

let frames = 0;
let fpsEma = 60;
window.__frames = 0;
window.__ready = false;
window.__stats = () => ({
  fps: Math.round(fpsEma * 10) / 10,
  frames,
  quality: renderer.quality(),
  ...renderer.stats(),
  wanted: world.state.wanted,
  cash: world.state.cash,
  mission: `${world.state.missionIndex + 1}.${world.state.missionStage}`,
});

function runShot(name) {
  // Shot mode: drive the real sim in time-sliced chunks so a slow software
  // renderer still finishes quickly, painting as we go.
  show(bootEl, false);
  const scene = stageShot(name, world);
  // The title overlay is real DOM: show it only for the title shot.
  show(titleScreen, scene.screen === 'title');
  show(pauseScreen, false);
  show(overScreen, false);
  renderer.snapCamera(world.state);
  renderer.draw(world.state, scene.screen);
  hud.update(world.state, scene.screen === 'title' ? 'title' : 'play', 0, 0);
  let done = false;
  function tick() {
    if (done) return;
    const t0 = performance.now();
    while (performance.now() - t0 < 12) {
      if (!scene.advance(STEP)) { done = true; break; }
    }
    safe('render', () => renderer.draw(world.state, scene.screen));
    safe('hud', () => hud.update(world.state, scene.screen === 'title' ? 'title' : 'play', world.state.time, 0));
    if (done) {
      renderer.snapCamera(world.state);
      renderer.draw(world.state, scene.screen);
      hud.update(world.state, scene.screen === 'title' ? 'title' : 'play', world.state.time, 0);
      window.__shotReady = true;
      window.__shotInfo = scene.info();
      window.__ready = true;
    } else {
      requestAnimationFrame(tick);
    }
  }
  requestAnimationFrame(tick);
}

async function bootSequence() {
  const stages = [
    ['Starting the renderer…', 15],
    ['Raising Neon Harbor — streets, towers, lamps…', 40],
    ['Parking the traffic, waking the pedestrians…', 60],
    ['Tuning the radio and the engine…', 80],
    ['Ready.', 100],
  ];
  for (const [text, pct] of stages) {
    setBoot(text, pct);
    await new Promise((r) => setTimeout(r, bench ? 0 : 90));
  }
  show(bootEl, false);
  show(titleScreen, true);
  window.__ready = true;
}

function runGame() {
  const input = createInput(canvas, (dx, dy, wheel) => {
    if (wheel !== undefined && wheel !== 0) {
      renderer.cam.dist = Math.min(FEEL.camMaxDist, Math.max(FEEL.camMinDist, renderer.cam.dist + wheel * 0.005));
      return;
    }
    // Drag orbits the camera around the player; the world auto-aligns it
    // back behind the player while moving forward.
    world.state.camYaw -= dx * 0.005;
    renderer.cam.pitch = Math.min(0.9, Math.max(0.12, renderer.cam.pitch + dy * 0.003));
  });
  let screen = 'title';
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();
  let muted = false;
  let deathShown = false;
  let lastRadioSeq = 0;
  let lastWanted = 0;
  let autoQualityDone = false;
  let playSeconds = 0;

  const save = readSave();
  const continueBtn = document.getElementById('continue-btn');
  const saveNote = document.getElementById('save-note');
  if (save) {
    continueBtn.style.display = 'inline-block';
    saveNote.textContent = `Saved game found: $${save.cash}, mission ${save.missionIndex + 1}.`;
  }
  const qualitySelect = document.getElementById('quality-select');
  qualitySelect.value = settings.quality;
  qualitySelect.addEventListener('change', () => {
    settings.quality = qualitySelect.value;
    saveSettings(settings);
    if (settings.quality !== 'auto') {
      renderer.applyQuality(settings.quality);
    } else {
      renderer.applyQuality('high');
    }
    if (!noaudio) sound.click();
  });

  function announce(message) { status.textContent = message; }

  function startGame(fromSave) {
    if (!noaudio) sound.unlock();
    if (fromSave) {
      const s = readSave();
      if (s) world.applySave(s);
    } else {
      world.reset();
    }
    renderer.snapCamera(world.state);
    accumulator = 0;
    deathShown = false;
    lastRadioSeq = world.state.radioSeq;
    lastWanted = world.state.wanted;
    // The current mission briefing types out as the game starts.
    hud.radio(world.state.radioText);
    screen = 'play';
    show(titleScreen, false);
    show(overScreen, false);
    show(pauseScreen, false);
    input.clearActions();
    announce('Playing Neon Harbor.');
  }

  function endGame(title, text) {
    screen = 'over';
    document.getElementById('over-title').textContent = title;
    document.getElementById('over-text').textContent = text;
    show(overScreen, true);
    if (world.state.cash > best) { best = world.state.cash; saveBest(best); }
    announce(`${title}. ${text}`);
  }

  function handleEvents(events) {
    if (events & EVENT_STEAL) sound.steal();
    if (events & EVENT_CRASH) sound.crash();
    if (events & EVENT_PICKUP) sound.pickup();
    if (events & EVENT_PUNCH) sound.punch();
    if (events & EVENT_SHOT) sound.shot();
    if (events & EVENT_HIT) sound.hit();
    if (events & EVENT_HIT_ENEMY) hud.hitmark('hit');
    if (events & EVENT_WEAK_HIT) hud.hitmark('weak');
    if (events & EVENT_KILL) {
      hud.hitmark('kill');
      hud.feed(`Thug down! +$25`);
    }
    if (events & EVENT_MISSION) { sound.jingle(); writeSave(); }
    if (events & EVENT_MISSION_FAIL) sound.fail();
    if (events & EVENT_STORY_DONE) { sound.jingle(); writeSave(); }
    if (events & EVENT_DEATH && !deathShown) {
      deathShown = true;
      sound.fail();
      endGame('FLATLINED', `Mara went down in Neon Harbor. You lost $200 at the clinic — but the city is still yours to take. Cash: $${Math.max(0, world.state.cash - 200)}.`);
    }
  }

  function step() {
    const move = input.move();
    const drive = input.drive();
    const acts = input.takeActions();
    const worldInput = {
      fwd: move.fwd, strafe: move.strafe, sprint: move.sprint,
      steer: -drive.steer, accel: drive.accel, brake: drive.brake,
      e: !!(acts & ACTION_INTERACT),
      f: !!(acts & ACTION_PUNCH),
      shoot: !!(acts & ACTION_SHOOT),
    };
    let events = 0;
    safe('world', () => { events = world.step(STEP, worldInput); });
    // Radio lines and wanted upgrades arrive via world state, not events.
    if (world.state.radioSeq !== lastRadioSeq) {
      lastRadioSeq = world.state.radioSeq;
      hud.radio(world.state.radioText);
    }
    if (world.state.wanted > lastWanted) {
      hud.feed(`WANTED ${'★'.repeat(world.state.wanted)} — police responding`);
    }
    lastWanted = world.state.wanted;
    handleEvents(events);
    return acts;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    frames += 1;
    window.__frames = frames;
    const rawDt = (now - last) / 1000;
    last = now;
    const dt = fixedDt ?? Math.min(rawDt, MAX_FRAME);
    if (rawDt > 0) fpsEma = fpsEma * 0.95 + (1 / Math.max(rawDt, 0.001)) * 0.05;
    if (bench && frames % 10 === 0) {
      const s = window.__stats();
      benchEl.style.display = 'block';
      benchEl.textContent = `NEON HARBOR BENCH\nfps ${s.fps}  calls ${s.calls}  tris ${s.triangles}\nquality ${s.quality}  wanted ${s.wanted}  cash $${s.cash}`;
    }
    if (screen === 'play') {
      playSeconds += dt;
      accumulator += dt;
      let acts = 0;
      let guard = 0;
      while (accumulator >= STEP && guard < 8) {
        acts |= step();
        accumulator -= STEP;
        guard += 1;
      }
      if (guard >= 8) accumulator = 0; // never spiral after a hitch
      if (acts & ACTION_PAUSE) {
        screen = 'paused';
        show(pauseScreen, true);
        announce('Paused.');
      }
      if (acts & ACTION_MUTE) {
        muted = sound.toggleMute();
        hud.setMuted(muted);
      }
      if (acts & ACTION_CONFIRM) sound.unlock();
      // Auto quality: one adjustment after 6 s of play, only in auto mode.
      if (!autoQualityDone && settings.quality === 'auto' && playSeconds > 6) {
        autoQualityDone = true;
        const cur = renderer.quality();
        const idx = QUALITY_ORDER.indexOf(cur);
        if (fpsEma < 25 && idx > 0) renderer.applyQuality(QUALITY_ORDER[idx - 1]);
        else if (fpsEma > 55 && idx < 2) renderer.applyQuality(QUALITY_ORDER[idx + 1]);
      }
    } else if (screen === 'paused') {
      const acts = input.takeActions();
      if (acts & ACTION_PAUSE || acts & ACTION_CONFIRM) {
        screen = 'play';
        show(pauseScreen, false);
        announce('Playing.');
      }
      if (acts & ACTION_MUTE) {
        muted = sound.toggleMute();
        hud.setMuted(muted);
      }
      accumulator = 0;
    } else if (screen === 'title') {
      const acts = input.takeActions();
      if (acts & ACTION_CONFIRM) startGame(false);
      if (acts & ACTION_MUTE) {
        muted = sound.toggleMute();
        hud.setMuted(muted);
      }
      // Ambient city behind the title: traffic and pedestrians keep moving.
      // (Radio lines wait: they type out once the game starts.)
      safe('world', () => world.step(STEP, { fwd: 0, strafe: 0, sprint: false, steer: 0, accel: 0, brake: false, e: false, f: false, shoot: false }));
    } else if (screen === 'over') {
      const acts = input.takeActions();
      if (acts & ACTION_CONFIRM) respawn();
    }
    // Engine hum and sirens follow the live state.
    const p = world.state.player;
    const policeNear = world.state.cars.some((c) => c.active && c.kind === 'police'
      && Math.hypot(c.x - p.x, c.z - p.z) < 70);
    safe('sound', () => {
      sound.setEngine(p.onFoot ? 0 : Math.abs(world.state.cars.find((c) => c.id === p.carId)?.speed ?? 0), !p.onFoot && screen === 'play');
      sound.setSiren(screen === 'play' && world.state.wanted > 0 && policeNear);
      sound.updateSiren(dt);
    });
    safe('render', () => renderer.draw(world.state, screen));
    safe('hud', () => hud.update(world.state, screen, world.state.time, dt));
  }

  function respawn() {
    world.respawnAfterDeath();
    renderer.snapCamera(world.state);
    deathShown = false;
    screen = 'play';
    show(overScreen, false);
    input.clearActions();
    announce('Back on the streets.');
  }

  document.getElementById('start-btn').addEventListener('click', () => startGame(false));
  continueBtn.addEventListener('click', () => startGame(true));
  document.getElementById('resume-btn').addEventListener('click', () => {
    screen = 'play';
    show(pauseScreen, false);
  });
  document.getElementById('save-btn').addEventListener('click', () => {
    const ok = writeSave();
    document.getElementById('pause-note').textContent = ok
      ? `Saved — $${world.state.cash}, mission ${world.state.missionIndex + 1}.`
      : 'Could not save in this browser.';
  });
  document.getElementById('restart-btn').addEventListener('click', () => {
    show(pauseScreen, false);
    startGame(false);
  });
  document.getElementById('respawn-btn').addEventListener('click', respawn);
  document.getElementById('over-restart-btn').addEventListener('click', () => {
    show(overScreen, false);
    startGame(false);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === 'play') {
      screen = 'paused';
      show(pauseScreen, true);
      announce('Paused.');
    }
  });

  announce('Neon Harbor. Press Space or click Start to play.');
  // Debug/testing handle (read-only view of the live state).
  window.__game = { world, renderer, get screen() { return screen; } };
  bootSequence().then(() => {
    if (autostart) startGame(false);
    requestAnimationFrame(frame);
  });
}

if (shot) runShot(shot);
else runGame();

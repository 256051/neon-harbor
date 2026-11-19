// Neon Harbor — the game loop. Wires input, world, render, sound and HUD
// together, runs the title / playing / paused / dead / complete state machine,
// and handles the ?seed=, ?bench and ?shot= switches plus save and load.

import { World } from './world.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { Sound } from './sound.js';
import { Hud } from './hud.js';
import { createPilot } from './shots.js';
import { seedFromString } from './random.js';
import { CFG } from './config.js';

const params = new URLSearchParams(window.location.search);
const seedText = params.get('seed') || 'neon-harbor-1';
const seed = seedFromString(seedText);
const shotName = params.get('shot');
const benchMode = params.has('bench');
const SAVE_KEY = 'neon-harbor-save-v1';

const canvas = document.getElementById('game');
const world = new World(seed);
const renderer = new Renderer(canvas, world);
const input = new Input(canvas);
const sound = new Sound();
const hud = new Hud(world);
const pilot = shotName ? createPilot(shotName, world, input) : null;

let quality = 'high';
let autoQuality = true;
let frameTimes = [];
let lastFpsCheck = performance.now();
let paused = false;
let shotDone = false;
let simTime = 0;

// Save / load: best money and mission progress, nothing else.
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (typeof data.bestMoney === 'number') world.bestMoney = data.bestMoney;
    if (typeof data.money === 'number') world.money = data.money;
  } catch (e) {
    // A corrupt save is ignored; the game starts fresh.
  }
}

function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      bestMoney: world.bestMoney,
      money: world.money,
      mission: world.missionIndex,
    }));
  } catch (e) {
    // Storage may be unavailable headless; the game plays on regardless.
  }
}

function startGame() {
  if (world.state === 'playing') return;
  world.state = 'playing';
  world.startMission(0);
  hud.setTitle(false);
  hud.setDead(false);
  hud.setComplete(false);
  hud.setPaused(false);
  sound.ensure();
  sound.click();
}

function restartGame() {
  const keepBest = world.bestMoney;
  const fresh = new World(seed);
  // Swap the fresh world's state in place so render/hud keep their references.
  for (const key of Object.keys(fresh)) world[key] = fresh[key];
  world.bestMoney = Math.max(keepBest, world.bestMoney);
  world.state = 'playing';
  world.startMission(0);
  hud.setTitle(false);
  hud.setDead(false);
  hud.setComplete(false);
  hud.setPaused(false);
  sound.click();
}

function togglePause() {
  if (world.state !== 'playing' && world.state !== 'paused') return;
  paused = !paused;
  world.state = paused ? 'paused' : 'playing';
  hud.setPaused(paused);
  sound.click();
}

// Fixed-step simulation so the game plays the same at any frame rate.
const STEP = 1 / 60;
let accumulator = 0;
let lastNow = performance.now();

function stepWorld(dt) {
  // Camera: drag with the mouse to orbit. While driving, ease behind the car;
  // on foot the camera stays where the player left it so walking stays true.
  if (input.mouseDown && Math.abs(input.lookDX) > 0) {
    world.cameraYaw += input.lookDX * 0.005;
  } else if (world.state === 'playing' && world.player.car) {
    const p = world.player;
    let diff = p.angle - world.cameraYaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    world.cameraYaw += diff * Math.min(1, dt * 1.6);
  }
  world.update(dt, input);
  for (const ev of world.events) {
    if (ev === 'shot') sound.shot();
    else if (ev === 'punch') sound.punch();
    else if (ev === 'crash') sound.crash();
    else if (ev === 'steal') sound.steal();
    else if (ev === 'missionDone') {
      sound.missionDone();
      saveGame();
    }
  }
  if (world.state === 'dead') {
    hud.setDead(true, world.money);
    saveGame();
  } else if (world.state === 'complete') {
    hud.setComplete(true, world.money);
    saveGame();
  }
  const speedNorm = world.player.car
    ? world.player.car.speed / CFG.carMaxSpeed
    : world.player.speed / CFG.runSpeed;
  sound.update(speedNorm, world.stars);
}

function frame(now) {
  requestAnimationFrame(frame);
  // Wall-clock delta, not the rAF timestamp: headless timestamps can be
  // quantized, which would starve the fixed-step simulation.
  const wallNow = performance.now();
  let dt = Math.min(0.12, (wallNow - lastNow) / 1000);
  lastNow = wallNow;

  // Auto-quality, always on: a slow frame rate steps the tier down.
  frameTimes.push(dt);
  if (wallNow - lastFpsCheck > 2000) {
    const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    frameTimes = [];
    lastFpsCheck = wallNow;
    if (autoQuality && avg > 0.045 && quality !== 'low') {
      quality = quality === 'high' ? 'medium' : 'low';
      renderer.setQuality(quality);
    }
    if (benchMode) {
      const el = document.getElementById('bench');
      el.style.display = 'block';
      el.textContent = `bench seed=${seedText} fps=${Math.round(1 / avg)} draw=${renderer.renderer.info.render.calls} tris=${renderer.renderer.info.render.triangles}`;
    }
  }

  // Global keys.
  if (input.wasPressed('p') || input.wasPressed('escape')) togglePause();
  if (input.wasPressed('m')) {
    sound.setMuted(!sound.muted);
    sound.ensure();
  }
  if (world.state === 'title' && (input.wasPressed(' ') || input.wasPressed('enter') || input.clicked)) {
    startGame();
  } else if ((world.state === 'dead' || world.state === 'complete') && (input.wasPressed(' ') || input.wasPressed('enter') || input.clicked)) {
    restartGame();
  }
  if (world.state === 'title' && input.wasPressed('q')) {
    const sel = document.getElementById('quality-select');
    quality = sel.value;
    renderer.setQuality(quality);
  }

  if (shotName && pilot && !shotDone) {
    // Shot mode: burn through simulation fast, then signal the screenshot.
    // The start shot keeps the title screen; every other shot plays the game.
    if (world.state === 'title' && shotName !== 'start') startGame();
    let guard = 0;
    while (guard < 240) {
      const status = pilot.update(STEP);
      stepWorld(STEP);
      input.clearPresses();
      simTime += STEP;
      guard++;
      if (status === 'done') {
        shotDone = true;
        if (pilot.frameChase) renderer.frameChase();
        hud.update();
        renderer.render(STEP);
        window.__shotReady = true;
        window.__shotInfo = JSON.stringify(world.debug());
        break;
      }
      if (world.state === 'dead' || world.state === 'complete') {
        shotDone = true;
        window.__shotReady = true;
        window.__shotInfo = JSON.stringify(world.debug());
        break;
      }
    }
    input.endFrame();
    return;
  }

  if (shotDone) {
    // Freeze the finished shot: keep rendering the same frame so the
    // screenshot cannot drift while the page waits to be captured.
    hud.update();
    renderer.renderer.render(renderer.scene, renderer.camera);
    input.endFrame();
    return;
  }

  if (!paused && world.state === 'playing') {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP && steps < 8) {
      stepWorld(STEP);
      // One-frame presses (E, click) must not repeat across the steps of
      // a single rendered frame, or one E press steals and re-steals.
      input.clearPresses();
      accumulator -= STEP;
      steps++;
    }
    if (steps === 8) accumulator = 0; // drop backlog after a hitch
  }

  // Quality selector on the title screen.
  const sel = document.getElementById('quality-select');
  if (sel && sel.value !== quality && world.state === 'title') {
    quality = sel.value;
    renderer.setQuality(quality);
  }

  hud.update();
  renderer.render(dt);
  input.endFrame();
}

// Boot.
loadSave();
hud.setTitle(true);
if (benchMode) document.getElementById('bench').style.display = 'block';
window.__game = world;
window.__debug = () => world.debug();
window.__shotReady = false;
renderer.render(0.016);
requestAnimationFrame(frame);

// Neon Harbor — the DOM HUD: cash, stars, health, speed, mission, clock,
// prompts, banners, plus the 2D canvas minimap, a compass strip, the radio
// typewriter, hit markers and the kill feed. The 3D scene is in render.js.
// The compass and the minimap share one projection: world -> screen bearing
// (compass) and world -> map pixel (minimap), both derived from the same
// player position and camera yaw.
import { CITY_HALF, MISSIONS, PITCH } from './config.js';

const COMPASS_NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
// Compass degrees from a world heading (atan2(x, z) radians): 0 = north.
function compassDeg(heading) {
  return (((180 - (heading * 180) / Math.PI) % 360) + 360) % 360;
}
function bearingDiff(a, b) {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

export function createHud(world) {
  const el = (id) => document.getElementById(id);
  const hud = el('hud');
  const cashEl = el('cash');
  const clockEl = el('clock');
  const starsEl = el('stars');
  const healthFill = el('health-fill');
  const carHealthRow = el('car-health-row');
  const carHealthFill = el('car-health-fill');
  const speedEl = el('speed');
  const missionTitle = el('mission-title');
  const missionText = el('mission-text');
  const missionTimer = el('mission-timer');
  const promptEl = el('prompt');
  const messageEl = el('message');
  const bannerEl = el('banner');
  const muteEl = el('mute-indicator');
  const map = el('minimap');
  const mapCtx = map.getContext('2d');
  const compass = el('compass');
  const compassCtx = compass.getContext('2d');
  const radioEl = el('radio');
  const hitEl = el('hitmarker');
  const feedEl = el('feed');

  let lastStars = -1;
  let lastCash = -1;
  let lastHealth = -1;
  let lastMission = '';
  let lastMessage = '';
  let lastBanner = '';

  // Radio typewriter: a queue of lines, typed at 58 chars/s, each held
  // briefly when complete. Cheap storytelling: the mission briefings,
  // police dispatch and tips all come through here.
  const radioQueue = [];
  let radioCurrent = '';
  let radioShown = 0;
  let radioHold = 0;
  const RADIO_CPS = 58;
  function radio(text) {
    if (text) radioQueue.push(text);
  }
  function updateRadio(dt) {
    if (!radioCurrent && radioQueue.length > 0) {
      radioCurrent = radioQueue.shift();
      radioShown = 0;
      radioHold = 0;
    }
    if (radioCurrent) {
      if (radioShown < radioCurrent.length) {
        radioShown = Math.min(radioCurrent.length, radioShown + RADIO_CPS * dt);
        radioEl.textContent = `📻 ${radioCurrent.slice(0, Math.floor(radioShown))}`;
        radioEl.style.display = 'block';
      } else {
        radioHold += dt;
        if (radioHold > 2.2) {
          radioCurrent = '';
          radioEl.style.display = 'none';
        }
      }
    }
  }

  // Hit markers: hit (white), weak (grey, half damage at range), kill (red,
  // 1.5x). One element, re-triggered by swapping the class.
  let hitTimer = 0;
  function hitmark(type) {
    hitEl.className = '';
    void hitEl.offsetWidth; // restart the CSS animation
    hitEl.className = type === 'kill' ? 'kill' : type === 'weak' ? 'weak' : 'hit';
    hitTimer = 0.35;
  }

  // Kill feed: at most 4 lines, each alive 4.2 s. Wanted upgrades use the
  // same feed so the player always sees why the heat rose.
  function feed(text) {
    const div = document.createElement('div');
    div.className = 'feed-line';
    div.textContent = text;
    feedEl.prepend(div);
    while (feedEl.children.length > 4) feedEl.removeChild(feedEl.lastChild);
    setTimeout(() => { if (div.parentNode) div.parentNode.removeChild(div); }, 4200);
  }

  function fmtClock(min) {
    const h = Math.floor(min / 60) % 24;
    const m = Math.floor(min % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function drawCompass(state) {
    const W = compass.width;
    const H = compass.height;
    const ctx = compassCtx;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(10, 12, 24, 0.72)';
    ctx.fillRect(0, 0, W, H);
    const centerDeg = compassDeg(state.camYaw + Math.PI);
    const pxPerDeg = W / 120; // +-60 degrees visible
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.fillStyle = '#eef1f5';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let d = Math.floor(centerDeg - 60); d <= centerDeg + 60; d += 5) {
      const deg = ((d % 360) + 360) % 360;
      const x = W / 2 + bearingDiff(deg, centerDeg) * pxPerDeg;
      const isMajor = deg % 45 === 0;
      const isMid = deg % 15 === 0;
      ctx.beginPath();
      ctx.moveTo(x, isMajor ? 4 : isMid ? 8 : 12);
      ctx.lineTo(x, 18);
      ctx.stroke();
      if (isMajor) {
        ctx.fillText(COMPASS_NAMES[Math.round(deg / 45) % 8], x, 24);
      }
    }
    // Mission marker on the compass, at its bearing from the player.
    const marker = world.markerPos();
    if (marker) {
      const p = state.player;
      const b = compassDeg(Math.atan2(marker.x - p.x, marker.z - p.z));
      const diff = bearingDiff(b, centerDeg);
      if (Math.abs(diff) < 58) {
        const x = W / 2 + diff * pxPerDeg;
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath();
        ctx.moveTo(x, 2);
        ctx.lineTo(x + 5, 8);
        ctx.lineTo(x, 14);
        ctx.lineTo(x - 5, 8);
        ctx.closePath();
        ctx.fill();
      }
    }
    // Centre caret.
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.moveTo(W / 2, H - 2);
    ctx.lineTo(W / 2 - 5, H - 8);
    ctx.lineTo(W / 2 + 5, H - 8);
    ctx.closePath();
    ctx.fill();
  }

  function drawMinimap(state, now) {
    const S = map.width;
    const scale = S / (CITY_HALF * 2 + 30);
    const toMap = (v) => (v + CITY_HALF + 15) * scale;
    mapCtx.fillStyle = 'rgba(12, 14, 26, 0.85)';
    mapCtx.fillRect(0, 0, S, S);
    // Streets.
    mapCtx.strokeStyle = '#565670';
    mapCtx.lineWidth = 3;
    for (let k = -4; k <= 4; k += 1) {
      mapCtx.beginPath();
      mapCtx.moveTo(toMap(k * PITCH), 0);
      mapCtx.lineTo(toMap(k * PITCH), S);
      mapCtx.stroke();
      mapCtx.beginPath();
      mapCtx.moveTo(0, toMap(k * PITCH));
      mapCtx.lineTo(S, toMap(k * PITCH));
      mapCtx.stroke();
    }
    // Cash pickups.
    mapCtx.fillStyle = '#2ecc71';
    for (const pk of state.pickups) {
      if (!pk.active) continue;
      mapCtx.fillRect(toMap(pk.x) - 2, toMap(pk.z) - 2, 4, 4);
    }
    // Traffic (white dots).
    mapCtx.fillStyle = '#dddddd';
    for (const car of state.cars) {
      if (!car.active || car.kind !== 'traffic') continue;
      mapCtx.fillRect(toMap(car.x) - 1.5, toMap(car.z) - 1.5, 3, 3);
    }
    // Police (flashing blue/red).
    const flash = Math.floor(now * 2) % 2 === 0;
    mapCtx.fillStyle = flash ? '#4488ff' : '#ff4444';
    for (const car of state.cars) {
      if (!car.active || car.kind !== 'police') continue;
      mapCtx.beginPath();
      mapCtx.arc(toMap(car.x), toMap(car.z), 4, 0, Math.PI * 2);
      mapCtx.fill();
    }
    // Mission marker.
    const marker = world.markerPos();
    if (marker) {
      const mx = toMap(marker.x);
      const my = toMap(marker.z);
      const pulse = 5 + Math.sin(now * 4) * 1.5;
      mapCtx.fillStyle = '#ffd23f';
      mapCtx.beginPath();
      mapCtx.moveTo(mx, my - pulse);
      mapCtx.lineTo(mx + pulse, my);
      mapCtx.lineTo(mx, my + pulse);
      mapCtx.lineTo(mx - pulse, my);
      mapCtx.closePath();
      mapCtx.fill();
    }
    // Player arrow.
    const p = state.player;
    const px = toMap(p.x);
    const py = toMap(p.z);
    mapCtx.save();
    mapCtx.translate(px, py);
    mapCtx.rotate(p.heading);
    mapCtx.fillStyle = '#2ec4b6';
    mapCtx.beginPath();
    mapCtx.moveTo(0, -7);
    mapCtx.lineTo(5, 6);
    mapCtx.lineTo(-5, 6);
    mapCtx.closePath();
    mapCtx.fill();
    mapCtx.restore();
    // Border.
    mapCtx.strokeStyle = 'rgba(255,255,255,0.35)';
    mapCtx.lineWidth = 1;
    mapCtx.strokeRect(0.5, 0.5, S - 1, S - 1);
  }

  function update(state, screen, now, dt) {
    hud.style.display = screen === 'play' ? 'block' : 'none';
    if (hitTimer > 0) {
      hitTimer -= dt || 0;
      if (hitTimer <= 0) hitEl.className = '';
    }
    updateRadio(dt || 0);
    if (screen !== 'play') return;
    const p = state.player;

    if (state.cash !== lastCash) {
      lastCash = state.cash;
      cashEl.textContent = `$${state.cash}`;
    }
    clockEl.textContent = fmtClock(state.clockMin);
    if (state.wanted !== lastStars) {
      lastStars = state.wanted;
      let stars = '';
      for (let i = 0; i < 5; i += 1) stars += i < state.wanted ? '★' : '☆';
      starsEl.textContent = stars;
      starsEl.classList.toggle('hot', state.wanted > 0);
    }
    const hp = Math.round(p.health);
    if (hp !== lastHealth) {
      lastHealth = hp;
      healthFill.style.width = `${hp}%`;
      healthFill.style.background = hp > 50 ? '#2ecc71' : hp > 25 ? '#f39c12' : '#e74c3c';
    }
    const car = !p.onFoot ? state.cars.find((c) => c.id === p.carId) : null;
    if (car) {
      carHealthRow.style.display = 'flex';
      carHealthFill.style.width = `${Math.max(0, Math.round(car.health))}%`;
    } else {
      carHealthRow.style.display = 'none';
    }
    const kmh = Math.round(Math.abs(p.onFoot ? p.speed : (car ? car.speed : 0)) * 3.6);
    speedEl.textContent = p.onFoot ? '' : `${kmh} km/h`;

    const m = MISSIONS[state.missionIndex];
    const stageText = m ? m.stages[state.missionStage]?.text ?? '' : 'Free roam — Neon Harbor is yours.';
    const missionKey = `${state.missionIndex}:${state.missionStage}:${m ? m.title : ''}`;
    if (missionKey !== lastMission) {
      lastMission = missionKey;
      missionTitle.textContent = m ? `${m.id}. ${m.title}` : 'Free Roam';
      missionText.textContent = stageText;
    }
    const s = world.missionStageDef();
    if (s && s.timer !== undefined && state.missionStage > 0) {
      missionTimer.textContent = `⏱ ${Math.max(0, Math.ceil(s.timer - state.missionTimer))}s`;
      missionTimer.style.display = 'block';
    } else {
      missionTimer.style.display = 'none';
    }

    // Context prompt.
    let prompt = '';
    if (p.onFoot) {
      const near = world.nearestStealable(4.5);
      if (near) prompt = 'Press E to steal this car';
      else if (state.cars.some((c) => c.active && (c.kind === 'traffic' || c.kind === 'parked') && Math.hypot(c.x - p.x, c.z - p.z) < 12)) prompt = 'Get closer to a car — press E to steal';
    } else if (car && Math.abs(car.speed) < 2) {
      prompt = 'Press E to get out';
    }
    if (promptEl.textContent !== prompt) promptEl.textContent = prompt;

    if (state.message !== lastMessage || (state.messageTimer <= 0 && lastMessage !== '')) {
      lastMessage = state.messageTimer > 0 ? state.message : '';
      messageEl.textContent = lastMessage;
    }
    const banner = state.missionBannerTimer > 0 ? state.missionBanner : '';
    if (banner !== lastBanner) {
      lastBanner = banner;
      bannerEl.textContent = banner;
      bannerEl.style.display = banner ? 'block' : 'none';
    }

    drawMinimap(state, now);
    drawCompass(state);
  }

  function setMuted(muted) {
    muteEl.style.display = muted ? 'block' : 'none';
  }

  return { update, setMuted, radio, hitmark, feed };
}

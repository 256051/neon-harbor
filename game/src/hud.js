// Neon Harbor — the HUD, drawn on a Canvas 2D layer over the WebGL canvas:
// a minimap (top-right, same projection as the compass strip below it), a
// compass strip (top-centre), health, cash, wanted stars, the mission line,
// toast messages, and the title / pause / dead / win screens. It reads the
// world every frame and never writes to it.
import { CITY_HALF, PITCH, STREETS } from './config.js';
import { streetCoord, missionDef, missionText } from './world.js';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function createHud(canvas, world) {
  const ctx = canvas.getContext('2d');
  let toastText = '';
  let toastTime = 0;
  let fps = 0;
  let fpsFrames = 0;
  let fpsTime = 0;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  function showToast(text, seconds = 4) {
    toastText = text;
    toastTime = seconds;
  }

  // --- Minimap -------------------------------------------------------------------
  // The compass strip and the minimap share one projection: world north
  // (-Z) is up on the map, and the strip's tick for a heading is placed by
  // the same angle math the 3D camera uses.
  function drawMinimap() {
    const size = 190;
    const x0 = canvas.width - size - 16;
    const y0 = 16;
    const range = CITY_HALF + PITCH / 2;
    const scale = size / (range * 2);
    const toMap = (wx, wz) => [x0 + (wx + range) * scale, y0 + (wz + range) * scale];

    ctx.save();
    ctx.fillStyle = 'rgba(10, 12, 24, 0.78)';
    roundRect(ctx, x0 - 6, y0 - 6, size + 12, size + 12, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    roundRect(ctx, x0, y0, size, size, 6);
    ctx.clip();

    // Roads.
    ctx.strokeStyle = 'rgba(160,170,200,0.55)';
    ctx.lineWidth = Math.max(2, 12 * scale);
    for (let i = 0; i < STREETS; i += 1) {
      const c = streetCoord(i);
      const [ax, ay] = toMap(-range, c);
      const [bx, by] = toMap(range, c);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      const [cx, cy] = toMap(c, -range);
      const [dx, dy] = toMap(c, range);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(dx, dy); ctx.stroke();
    }
    // Buildings.
    ctx.fillStyle = 'rgba(120,130,170,0.8)';
    for (const b of world.buildings) {
      const [bx, by] = toMap(b.x - b.w / 2, b.z - b.d / 2);
      ctx.fillRect(bx, by, Math.max(1.5, b.w * scale), Math.max(1.5, b.d * scale));
    }
    // Cash pickups.
    ctx.fillStyle = '#ffd23f';
    for (const pickup of world.pickups) {
      if (pickup.taken) continue;
      const [px, py] = toMap(pickup.x, pickup.z);
      ctx.fillRect(px - 2, py - 2, 4, 4);
    }
    // Police.
    ctx.fillStyle = '#4da6ff';
    for (const car of world.police) {
      if (car.wrecked) continue;
      const [px, py] = toMap(car.x, car.z);
      ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
    }
    // Mission target.
    const def = missionDef(world);
    if (def && world.state === 'playing') {
      const stage = def.stages[world.missionStage];
      if (stage && stage.target) {
        const [tx, ty] = toMap(stage.target[0], stage.target[1]);
        ctx.fillStyle = '#ffd23f';
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(Math.PI / 4);
        const pulse = 4 + Math.sin(world.time * 4) * 1.5;
        ctx.fillRect(-pulse / 2, -pulse / 2, pulse, pulse);
        ctx.restore();
      }
    }
    // Player arrow.
    const p = world.player;
    const [px, py] = toMap(p.x, p.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.atan2(Math.sin(p.heading), -Math.cos(p.heading)));
    ctx.fillStyle = '#2ec4b6';
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(5, 5); ctx.lineTo(0, 2.5); ctx.lineTo(-5, 5);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('NEON HARBOR', x0, y0 + size + 18);
  }

  // --- Compass strip ---------------------------------------------------------------
  function drawCompass(camYaw) {
    const w = 420;
    const h = 26;
    const x0 = (canvas.width - w) / 2;
    const y0 = 16;
    ctx.save();
    ctx.fillStyle = 'rgba(10, 12, 24, 0.7)';
    roundRect(ctx, x0, y0, w, h, 8);
    ctx.fill();
    ctx.beginPath();
    roundRect(ctx, x0, y0, w, h, 8);
    ctx.clip();
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Headings: N is -Z (heading PI), E is +X (heading PI/2).
    const marks = [
      { label: 'N', heading: Math.PI },
      { label: 'E', heading: Math.PI / 2 },
      { label: 'S', heading: 0 },
      { label: 'W', heading: -Math.PI / 2 },
    ];
    for (const mark of marks) {
      let diff = mark.heading - camYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const x = x0 + w / 2 + (diff / (Math.PI / 2)) * (w / 2);
      if (x < x0 - 20 || x > x0 + w + 20) continue;
      ctx.fillStyle = '#ffd23f';
      ctx.fillText(mark.label, x, y0 + h / 2);
    }
    // Centre caret.
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(x0 + w / 2 - 6, y0 + 2);
    ctx.lineTo(x0 + w / 2 + 6, y0 + 2);
    ctx.lineTo(x0 + w / 2, y0 + 9);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawBar(x, y, w, h, frac, fill, label) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = fill;
    roundRect(ctx, x + 2, y + 2, Math.max(0, (w - 4) * Math.max(0, Math.min(1, frac))), h - 4, (h - 4) / 2);
    ctx.fill();
    if (label) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + 8, y + h / 2 + 0.5);
    }
  }

  function drawStars() {
    const p = world.player;
    const x0 = 16;
    const y0 = 86;
    for (let i = 0; i < 5; i += 1) {
      ctx.font = '22px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = i < world.wanted ? '#ff4444' : 'rgba(255,255,255,0.25)';
      ctx.fillText('★', x0 + i * 26, y0 + 18);
    }
    if (world.wanted > 0) {
      ctx.fillStyle = '#ff6666';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(`WANTED — ${world.wanted} star${world.wanted > 1 ? 's' : ''}`, x0, y0 + 40);
    }
    void p;
  }

  function drawTextBlock(text, x, y, size, color, align = 'left', weight = 'bold') {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, x, y);
  }

  function draw(state, dt, camYaw) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (dt > 0) {
      fpsFrames += 1;
      fpsTime += dt;
      if (fpsTime >= 0.5) {
        fps = Math.round(fpsFrames / fpsTime);
        fpsFrames = 0;
        fpsTime = 0;
      }
    }
    if (toastTime > 0) toastTime -= dt;

    const p = world.player;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    if (state === 'title') {
      ctx.fillStyle = 'rgba(8, 8, 20, 0.55)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawTextBlock('NEON HARBOR', cx, cy - 90, 64, '#ffd23f', 'center');
      drawTextBlock('An open-world crime story in a dusk harbor city', cx, cy - 48, 18, '#e8e8f0', 'center', 'normal');
      drawTextBlock('WASD drive / walk   ·   E steal car   ·   F punch   ·   Click shoot', cx, cy - 8, 16, '#c8c8d8', 'center', 'normal');
      drawTextBlock('Mouse drag orbits   ·   Wheel zooms   ·   P pause   ·   M mute', cx, cy + 18, 16, '#c8c8d8', 'center', 'normal');
      const pulse = 0.7 + Math.sin(world.time * 3) * 0.3;
      ctx.globalAlpha = pulse;
      drawTextBlock('Press SPACE or ENTER to start', cx, cy + 70, 22, '#ffffff', 'center');
      ctx.globalAlpha = 1;
      if (world.hasSave) {
        drawTextBlock('Press C to continue your saved game', cx, cy + 100, 16, '#ffd23f', 'center', 'normal');
      }
      drawTextBlock('Original work — no real city, no real cars, no brands', cx, canvas.height - 24, 12, 'rgba(255,255,255,0.5)', 'center', 'normal');
      return;
    }

    // In-play HUD.
    drawCompass(camYaw);
    drawMinimap();
    drawBar(16, 16, 220, 20, p.health / 100, p.health > 30 ? '#2ecc71' : '#e74c3c', `HP ${Math.ceil(p.health)}`);
    drawTextBlock(`$${p.cash}`, 16, 62, 26, '#ffd23f');
    drawTextBlock(`Best $${world.best}`, 16, 84, 12, 'rgba(255,255,255,0.6)', 'left', 'normal');
    drawStars();

    // Mission line.
    const def = missionDef(world);
    if (def) {
      drawTextBlock(`${def.title} — ${missionText(world)}`, 16, canvas.height - 56, 15, '#ffffff');
      if (world.missionIndex === 1 && world.missionStage === 1 && world.missionTimer > 0) {
        const urgent = world.missionTimer < 20;
        drawTextBlock(`${Math.ceil(world.missionTimer)}s`, 16, canvas.height - 30, 22, urgent ? '#ff5555' : '#ffd23f');
      }
    }
    // Interaction hint.
    if (p.onFoot) {
      const near = world.cars.some((c) => !c.wrecked && Math.hypot(c.x - p.x, c.z - p.z) < 3.5);
      if (near) drawTextBlock('[E] Steal car', cx, canvas.height - 100, 16, '#ffffff', 'center');
    } else {
      drawTextBlock('[E] Get out', cx, canvas.height - 100, 15, 'rgba(255,255,255,0.8)', 'center', 'normal');
    }
    // Crosshair while aiming on foot.
    if (p.onFoot) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 16, cy); ctx.lineTo(cx - 6, cy);
      ctx.moveTo(cx + 6, cy); ctx.lineTo(cx + 16, cy);
      ctx.moveTo(cx, cy - 16); ctx.lineTo(cx, cy - 6);
      ctx.moveTo(cx, cy + 6); ctx.lineTo(cx, cy + 16);
      ctx.stroke();
    }
    // Toast.
    if (toastTime > 0 && toastText) {
      ctx.fillStyle = 'rgba(10, 12, 24, 0.8)';
      const tw = ctx.measureText(toastText).width + 32;
      roundRect(ctx, cx - tw / 2, 64, tw, 36, 8);
      ctx.fill();
      drawTextBlock(toastText, cx, 88, 15, '#ffffff', 'center', 'normal');
    }
    // FPS + quality, small, bottom-right.
    drawTextBlock(`${fps} fps`, canvas.width - 16, canvas.height - 16, 12, 'rgba(255,255,255,0.55)', 'right', 'normal');

    if (state === 'paused') {
      ctx.fillStyle = 'rgba(8, 8, 20, 0.6)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawTextBlock('PAUSED', cx, cy - 20, 44, '#ffffff', 'center');
      drawTextBlock('Press P to resume — progress autosaves every 10 s', cx, cy + 20, 16, '#c8c8d8', 'center', 'normal');
    } else if (state === 'dead') {
      ctx.fillStyle = 'rgba(20, 4, 8, 0.72)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawTextBlock('FLATLINED', cx, cy - 30, 56, '#ff4444', 'center');
      drawTextBlock('Mara Voss is down. The harbor keeps its secrets.', cx, cy + 10, 17, '#e8e8f0', 'center', 'normal');
      drawTextBlock(`You lost $200 — cash now $${p.cash}`, cx, cy + 40, 15, '#c8c8d8', 'center', 'normal');
      drawTextBlock('Press SPACE to start over', cx, cy + 84, 18, '#ffffff', 'center');
    } else if (state === 'win') {
      ctx.fillStyle = 'rgba(8, 20, 12, 0.66)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawTextBlock('THE HARBOR IS YOURS', cx, cy - 30, 46, '#ffd23f', 'center');
      drawTextBlock('All three missions complete. Mara Voss owns the night.', cx, cy + 10, 17, '#e8e8f0', 'center', 'normal');
      drawTextBlock(`Final cash $${p.cash}   ·   Best $${world.best}`, cx, cy + 40, 15, '#c8c8d8', 'center', 'normal');
      drawTextBlock('Press SPACE to play again', cx, cy + 84, 18, '#ffffff', 'center');
    }
  }

  return {
    draw, showToast, resize,
    get fps() { return fps; },
  };
}

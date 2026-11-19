// Neon Harbor — the 2D HUD: health, money, wanted stars, mission text, speed,
// the radio briefing typewriter, message toasts, the compass strip and the
// Canvas 2D minimap. All DOM and canvas; the 3D scene never draws text.

import { CFG } from './config.js';

function el(id) {
  return document.getElementById(id);
}

export class Hud {
  constructor(world) {
    this.world = world;
    this.minimap = el('minimap');
    this.mm = this.minimap.getContext('2d');
    this.lastRadioLen = -1;
  }

  show(id, on) {
    const n = el(id);
    if (n) n.style.display = on ? 'block' : 'none';
  }

  setTitle(on) {
    this.show('title-screen', on);
    this.show('hud', !on);
  }

  setPaused(on) {
    this.show('pause-screen', on);
  }

  setDead(on, money) {
    this.show('dead-screen', on);
    if (on) el('dead-money').textContent = `$${money}`;
  }

  setComplete(on, money) {
    this.show('complete-screen', on);
    if (on) el('complete-money').textContent = `$${money}`;
  }

  // Called every frame while playing.
  update() {
    const w = this.world;
    const p = w.player;
    el('money').textContent = `$${w.money}`;
    el('best-money').textContent = `Best $${w.bestMoney}`;
    const hp = Math.max(0, Math.round(p.hp));
    el('health-fill').style.width = `${hp}%`;
    el('health-fill').style.background = hp > 50 ? '#58c96b' : hp > 25 ? '#e8a13a' : '#d84a3a';
    el('health-num').textContent = `${hp}`;
    let stars = '';
    for (let i = 0; i < 5; i++) stars += i < w.stars ? '★' : '☆';
    el('stars').textContent = stars;
    el('stars').style.color = w.stars > 0 ? '#ffd23a' : '#888888';
    const speed = p.onFoot ? p.speed * 3.6 : (p.car ? p.car.speed * 3.6 : 0);
    el('speed-num').textContent = `${Math.round(speed)}`;
    el('speed-label').textContent = p.onFoot ? 'km/h on foot' : 'km/h';
    const carHp = p.car ? Math.max(0, Math.round(p.car.hp)) : null;
    el('car-health').style.display = carHp === null ? 'none' : 'block';
    if (carHp !== null) {
      el('car-fill').style.width = `${Math.min(100, (carHp / CFG.carHealth) * 100)}%`;
      el('car-num').textContent = `${carHp}`;
    }
    const m = w.currentMission();
    const stage = w.currentStage();
    el('mission-name').textContent = m ? m.name : '—';
    el('mission-text').textContent = stage ? stage.text : w.state === 'complete' ? 'All missions complete!' : '—';
    if (w.toastTimer > 0 && w.toast) {
      el('toast').style.display = 'block';
      el('toast').textContent = w.toast;
    } else {
      el('toast').style.display = 'none';
    }
    // Radio briefing, typed out letter by letter.
    if (w.radioText) {
      el('radio').style.display = 'block';
      const shown = Math.floor(w.radioShown);
      if (shown !== this.lastRadioLen) {
        el('radio').textContent = w.radioText.slice(0, shown);
        this.lastRadioLen = shown;
      }
    } else {
      el('radio').style.display = 'none';
    }
    el('mission-done').style.display = w.missionJustDone ? 'block' : 'none';
    this.drawCompass();
    this.drawMinimap();
  }

  drawCompass() {
    const c = el('compass');
    const ctx = c.getContext('2d');
    const W = c.width;
    const H = c.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(10,14,24,0.55)';
    ctx.fillRect(0, 0, W, H);
    const yaw = this.world.cameraYaw;
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const points = [
      { a: 0, label: 'N' },
      { a: Math.PI / 2, label: 'E' },
      { a: Math.PI, label: 'S' },
      { a: -Math.PI / 2, label: 'W' },
    ];
    for (const pt of points) {
      let d = pt.a - yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const x = W / 2 + (d / (Math.PI / 2)) * (W / 2);
      if (x < -10 || x > W + 10) continue;
      ctx.fillStyle = pt.label === 'N' ? '#ff5a4a' : '#e8e8e8';
      ctx.fillText(pt.label, x, H / 2);
    }
    ctx.fillStyle = '#38e1c6';
    ctx.beginPath();
    ctx.moveTo(W / 2, 2);
    ctx.lineTo(W / 2 - 5, 10);
    ctx.lineTo(W / 2 + 5, 10);
    ctx.closePath();
    ctx.fill();
  }

  drawMinimap() {
    const ctx = this.mm;
    const S = this.minimap.width;
    const w = this.world;
    const range = CFG.minimapRange;
    const toMap = (x, z) => {
      const mx = S / 2 + ((x - w.player.x) / range) * (S / 2);
      const my = S / 2 + ((z - w.player.z) / range) * (S / 2);
      return [mx, my];
    };
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#0d1526';
    ctx.fillRect(0, 0, S, S);
    // Water on the east edge.
    ctx.fillStyle = '#1d3a52';
    const [wx] = toMap(268, 0);
    if (wx < S) ctx.fillRect(Math.max(0, wx), 0, S - Math.max(0, wx), S);
    // Streets.
    ctx.strokeStyle = '#6a7284';
    ctx.lineWidth = 3;
    for (const line of w.streetLines) {
      const [ax] = toMap(line, 0);
      const [, ay] = toMap(0, line);
      ctx.beginPath();
      ctx.moveTo(ax, 0);
      ctx.lineTo(ax, S);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, ay);
      ctx.lineTo(S, ay);
      ctx.stroke();
    }
    // Buildings.
    ctx.fillStyle = '#9a8a68';
    for (const b of w.buildings) {
      const [x, y] = toMap(b.x - b.hw, b.z - b.hd);
      const [x2, y2] = toMap(b.x + b.hw, b.z + b.hd);
      ctx.fillRect(x, y, x2 - x, y2 - y);
    }
    // Mission marker.
    const target = w.missionTarget();
    if (target) {
      const [x, y] = toMap(target.x, target.z);
      ctx.fillStyle = '#38e1c6';
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#38e1c6';
      ctx.beginPath();
      ctx.arc(x, y, 9 + Math.sin(w.time * 3) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Traffic (grey), police (flashing blue/red), pedestrians (tiny dots).
    ctx.fillStyle = '#9aa0aa';
    for (const c of [...w.traffic, ...w.parked]) {
      const [x, y] = toMap(c.x, c.z);
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    for (const pc of w.police) {
      const [x, y] = toMap(pc.x, pc.z);
      ctx.fillStyle = Math.sin(pc.siren) > 0 ? '#ff4040' : '#4060ff';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // The player, a triangle pointing where they face.
    const [px, py] = toMap(w.player.x, w.player.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.PI - w.player.angle);
    ctx.fillStyle = '#ff8a2a';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.5, 5);
    ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

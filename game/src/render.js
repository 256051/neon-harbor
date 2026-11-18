// Neon Harbor — drawing only, with three.js: the world's state in, pixels out.
// Builds the city once, then keeps a pool of meshes for cars, pedestrians and
// the player in sync with the world. The camera is a third-person follow cam;
// the HUD itself lives in hud.js.
//
// Performance: static geometry is merged by material at boot (all buildings
// are 4 draw calls, all streetlight poles/heads/pools 3 more), car wheels and
// traffic-light lamps are InstancedMeshes, and each pedestrian is 3 meshes.
// Materials come from the cached factory in materials.js.
import * as THREE from 'three';
import { mergeGeometries } from '../lib/BufferGeometryUtils.js';
import { CITY_HALF, FEEL, PALETTE, PITCH, TRAFFIC_LIGHTS } from './config.js';
import { basic, facade, lambert } from './materials.js';

const CITY_SIZE = (CITY_HALF + 24) * 2;

// Quality tiers. Antialias is fixed when the renderer is created (the
// initial tier decides it); everything else applies live.
export const QUALITY = {
  low: { pixelRatio: 1, shadows: false, shadowMap: 512, fogNear: 60, fogFar: 260, label: 'Low' },
  medium: { pixelRatio: 1, shadows: true, shadowMap: 1024, fogNear: 90, fogFar: 420, label: 'Medium' },
  high: { pixelRatio: 1.5, shadows: true, shadowMap: 1024, fogNear: 90, fogFar: 420, label: 'High' },
  ultra: { pixelRatio: 2, shadows: true, shadowMap: 2048, fogNear: 110, fogFar: 500, label: 'Ultra' },
};
export const QUALITY_ORDER = ['low', 'medium', 'high', 'ultra'];

function facadeTexture(base, litRatio, seed) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 256);
  // Deterministic pseudo-random windows from the seed.
  let s = seed * 2654435761 >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let y = 10; y < 246; y += 18) {
    for (let x = 10; x < 118; x += 18) {
      const lit = rnd() < litRatio;
      g.fillStyle = lit ? (rnd() < 0.7 ? '#ffd27a' : '#9fd8ff') : '#141824';
      g.fillRect(x, y, 11, 13);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function groundTexture() {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const scale = S / CITY_SIZE;
  const toPx = (v) => (v + CITY_SIZE / 2) * scale;
  g.fillStyle = '#30303e';
  g.fillRect(0, 0, S, S);
  // Blocks: slightly lighter pavement.
  for (let i = -4; i < 4; i += 1) {
    for (let j = -4; j < 4; j += 1) {
      g.fillStyle = '#3d3d4e';
      g.fillRect(toPx(i * PITCH + 6), toPx(j * PITCH + 6), (PITCH - 12) * scale, (PITCH - 12) * scale);
    }
  }
  // Roads.
  g.fillStyle = '#2a2a35';
  for (let k = -4; k <= 4; k += 1) {
    g.fillRect(0, toPx(k * PITCH - 6), S, 12 * scale);
    g.fillRect(toPx(k * PITCH - 6), 0, 12 * scale, S);
  }
  // Centre dashes.
  g.fillStyle = '#c9a227';
  for (let k = -4; k <= 4; k += 1) {
    for (let v = -CITY_HALF; v < CITY_HALF; v += 12) {
      g.fillRect(toPx(v), toPx(k * PITCH - 0.5), 5 * scale, 1 * scale);
      g.fillRect(toPx(k * PITCH - 0.5), toPx(v), 1 * scale, 5 * scale);
    }
  }
  // Sidewalk edges.
  g.strokeStyle = '#3f3f52';
  g.lineWidth = 2;
  for (let k = -4; k <= 4; k += 1) {
    g.strokeRect(toPx(k * PITCH - 6), 0, 12 * scale, S);
    g.strokeRect(0, toPx(k * PITCH - 6), S, 12 * scale);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255, 210, 130, 0.55)');
  grad.addColorStop(1, 'rgba(255, 210, 130, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// One car, as few meshes as possible: body (+cabin merged in as a second
// material group), and wheels/lights live in shared InstancedMeshes.
function makeCarMesh(color, isPolice) {
  const group = new THREE.Group();
  // A little emissive lift so dark paint still reads at dusk.
  const bodyMat = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.28 });
  const darkMat = lambert(0x11131a);
  const bodyGeo = new THREE.BoxGeometry(2.1, 0.65, 4.4);
  bodyGeo.translate(0, 0.55, 0);
  const cabinGeo = new THREE.BoxGeometry(1.8, 0.6, 2.2);
  cabinGeo.translate(0, 1.15, -0.2);
  const merged = mergeGeometries([bodyGeo, cabinGeo], true);
  const body = new THREE.Mesh(merged, [bodyMat, darkMat]);
  body.castShadow = true;
  group.add(body);
  let lightBarRed = null;
  let lightBarBlue = null;
  if (isPolice) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 0.4), lambert(0x111111));
    bar.position.y = 1.55;
    group.add(bar);
    lightBarRed = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.42), basic(0xff2222));
    lightBarRed.position.set(-0.35, 1.55, 0);
    group.add(lightBarRed);
    lightBarBlue = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.42), basic(0x2266ff));
    lightBarBlue.position.set(0.35, 1.55, 0);
    group.add(lightBarBlue);
    // Police livery: a dark stripe along the body.
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.3, 4.42), lambert(0x14161c));
    stripe.position.y = 0.62;
    group.add(stripe);
  }
  return { group, lightBarRed, lightBarBlue, bodyMat };
}

// A person: torso + head + arms merged into one mesh (two material groups),
// legs separate so they can swing. The player's own mesh keeps separate arms
// so the punch animation can raise one.
function makePersonMesh(color, armsSeparate) {
  const group = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({ color });
  const skin = lambert(0xd9a066);
  const pants = lambert(0x2a2f3a);
  const torsoGeo = new THREE.BoxGeometry(0.62, 0.75, 0.36);
  torsoGeo.translate(0, 1.05, 0);
  const headGeo = new THREE.SphereGeometry(0.26, 12, 10);
  headGeo.translate(0, 1.68, 0);
  const bodyGeos = [torsoGeo, headGeo];
  const bodyMats = [shirt, skin];
  let armL = null;
  let armR = null;
  if (!armsSeparate) {
    // Pedestrians: arms merged into the body (they never need to move).
    const armGeoL = new THREE.BoxGeometry(0.18, 0.65, 0.2);
    armGeoL.translate(-0.42, 1.05, 0);
    const armGeoR = new THREE.BoxGeometry(0.18, 0.65, 0.2);
    armGeoR.translate(0.42, 1.05, 0);
    bodyGeos.push(armGeoL, armGeoR);
    bodyMats.push(shirt, shirt);
  }
  const body = new THREE.Mesh(mergeGeometries(bodyGeos, true), bodyMats);
  body.castShadow = true;
  group.add(body);
  if (armsSeparate) {
    // The player's arms stay separate meshes, so the punch can raise one.
    armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.65, 0.2), shirt);
    armL.position.set(-0.42, 1.05, 0);
    group.add(armL);
    armR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.65, 0.2), shirt);
    armR.position.set(0.42, 1.05, 0);
    group.add(armR);
  }
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.7, 0.26), pants);
  legL.position.set(-0.16, 0.35, 0);
  group.add(legL);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.7, 0.26), pants);
  legR.position.set(0.16, 0.35, 0);
  group.add(legR);
  return { group, legL, legR, armL, armR, shirt };
}

export function createRenderer(canvas, world, initialQuality) {
  const qualityName = QUALITY[initialQuality] ? initialQuality : 'high';
  const q = QUALITY[qualityName];
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: qualityName !== 'low' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
  renderer.shadowMap.enabled = q.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, q.fogNear, q.fogFar);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);

  // Dusk light: warm low sun + cool ambient. Bright enough to read at a glance.
  const sun = new THREE.DirectionalLight(0xffb36b, 2.4);
  sun.position.set(-120, 70, -80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
  sun.shadow.camera.left = -90; sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90;
  sun.shadow.camera.far = 400;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0x9a8bd8, 0x3a2c28, 1.3));
  scene.add(new THREE.AmbientLight(0x606080, 0.75));

  // Ground with the painted street grid.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY_SIZE, CITY_SIZE),
    new THREE.MeshLambertMaterial({ map: groundTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Low sun disc on the horizon.
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(26, 32),
    new THREE.MeshBasicMaterial({ color: PALETTE.sun, fog: false }),
  );
  sunDisc.position.set(-320, 42, -260);
  sunDisc.lookAt(0, 42, 0);
  scene.add(sunDisc);

  // Buildings, merged by facade variant: 4 draw calls for the whole city.
  // BoxGeometry carries 6 material groups (px, nx, py, ny, pz, nz); merging
  // with groups keeps them, so [side, side, top, roof, side, side] applies.
  const facadeMats = [];
  for (let i = 0; i < 4; i += 1) {
    facadeMats.push(facade(0, facadeTexture('#4a5070', 0.55, i + 1)));
  }
  const roofMat = lambert(0x1c1e28);
  const topMat = lambert(0x2a2d3a);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const byFacade = [[], [], [], []];
  for (let i = 0; i < world.buildings.length; i += 1) {
    const b = world.buildings[i];
    const g = boxGeo.clone();
    g.scale(b.w, b.h, b.d);
    g.translate(b.x, b.h / 2, b.z);
    byFacade[i % 4].push(g);
  }
  for (let v = 0; v < 4; v += 1) {
    const merged = mergeGeometries(byFacade[v], true);
    const mesh = new THREE.Mesh(merged, [facadeMats[v], facadeMats[v], topMat, roofMat, facadeMats[v], facadeMats[v]]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // Streetlights at intersections, merged: poles, heads, glow pools.
  const glowTex = glowTexture();
  const poleGeos = [];
  const headGeos = [];
  const poolGeos = [];
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5.4, 6);
  const headGeo = new THREE.SphereGeometry(0.22, 8, 6);
  const poolGeo = new THREE.PlaneGeometry(9, 9);
  for (let i = -4; i <= 4; i += 1) {
    for (let j = -4; j <= 4; j += 1) {
      if ((i + j) % 2 !== 0) continue;
      const x = i * PITCH + 7;
      const z = j * PITCH + 7;
      const pg = poleGeo.clone(); pg.translate(x, 2.7, z); poleGeos.push(pg);
      const hg = headGeo.clone(); hg.translate(x, 5.5, z); headGeos.push(hg);
      const og = poolGeo.clone(); og.rotateX(-Math.PI / 2); og.translate(x, 0.05, z); poolGeos.push(og);
    }
  }
  scene.add(new THREE.Mesh(mergeGeometries(poleGeos), lambert(0x22242e)));
  scene.add(new THREE.Mesh(mergeGeometries(headGeos), basic(PALETTE.lamp)));
  const poolMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false });
  scene.add(new THREE.Mesh(mergeGeometries(poolGeos), poolMat));

  // Traffic lights at the four signalised intersections: one merged pole set,
  // and red/green lamps as InstancedMeshes toggled by the world state.
  const lightPoleGeos = [];
  const lampGeo = new THREE.SphereGeometry(0.28, 8, 6);
  for (const [lx, lz] of TRAFFIC_LIGHTS) {
    const pg = poleGeo.clone(); pg.translate(lx + 7, 2.7, lz + 7); lightPoleGeos.push(pg);
  }
  scene.add(new THREE.Mesh(mergeGeometries(lightPoleGeos), lambert(0x22242e)));
  const redLamps = new THREE.InstancedMesh(lampGeo, basic(0xff2a22), TRAFFIC_LIGHTS.length);
  const greenLamps = new THREE.InstancedMesh(lampGeo, basic(0x2ecc71), TRAFFIC_LIGHTS.length);
  scene.add(redLamps);
  scene.add(greenLamps);
  const lampDummy = new THREE.Object3D();
  function syncTrafficLights() {
    const states = world.lightState();
    for (let i = 0; i < states.length; i += 1) {
      const s = states[i];
      // Red lamp on top, green below; the lit one is full size, the other shrunk away.
      lampDummy.position.set(s.x + 7, 5.6, s.z + 7);
      lampDummy.scale.setScalar(s.nsGreen ? 0.001 : 1);
      lampDummy.updateMatrix();
      redLamps.setMatrixAt(i, lampDummy.matrix);
      lampDummy.position.set(s.x + 7, 5.0, s.z + 7);
      lampDummy.scale.setScalar(s.nsGreen ? 1 : 0.001);
      lampDummy.updateMatrix();
      greenLamps.setMatrixAt(i, lampDummy.matrix);
    }
    redLamps.instanceMatrix.needsUpdate = true;
    greenLamps.instanceMatrix.needsUpdate = true;
  }

  // Mission beacon: a light column + a spinning diamond.
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.6, 60, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: PALETTE.mission, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
  );
  beacon.visible = false;
  scene.add(beacon);
  const diamond = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.6),
    new THREE.MeshBasicMaterial({ color: PALETTE.mission }),
  );
  diamond.visible = false;
  scene.add(diamond);

  // Cash pickups: spinning green octahedra.
  const pickupGeo = new THREE.OctahedronGeometry(0.8);
  const pickupMat = basic(0x2ecc71);
  const pickupMeshes = [];
  for (let i = 0; i < world.state.pickups.length; i += 1) {
    const m = new THREE.Mesh(pickupGeo, pickupMat);
    scene.add(m);
    pickupMeshes.push(m);
  }

  // Car wheels: one InstancedMesh for every wheel of every car. Slots are
  // handed out per car id and released when the car goes inactive.
  const WHEEL_CAP = 64 * 4;
  const wheels = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12),
    lambert(0x0a0a0a),
    WHEEL_CAP,
  );
  wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(wheels);
  const wheelSlots = new Map();
  const freeWheelSlots = [];
  let nextWheelSlot = 0;
  const wheelAngle = new Map();
  const wheelDummy = new THREE.Object3D();
  const wheelOffsets = [[-0.95, 1.45], [0.95, 1.45], [-0.95, -1.45], [0.95, -1.45]];
  // Headlights / taillights, also instanced (2 per car each).
  const LIGHT_CAP = 64 * 2;
  const headlights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.15, 0.1), basic(0xfff2b0), LIGHT_CAP);
  const taillights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.16, 0.1), basic(0xff2a22), LIGHT_CAP);
  headlights.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  taillights.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(headlights);
  scene.add(taillights);
  const lightSlots = new Map();
  const freeLightSlots = [];
  let nextLightSlot = 0;

  function allocSlot(map, freeList, nextRef) {
    if (freeList.length > 0) return freeList.pop();
    if (nextRef.value >= 64) return -1;
    const slot = nextRef.value;
    nextRef.value += 1;
    return slot;
  }

  const carMeshes = new Map();
  const pedMeshes = new Map();
  const playerMesh = makePersonMesh(PALETTE.playerJacket, true);
  scene.add(playerMesh.group);

  const cam = { pitch: FEEL.camPitch, dist: FEEL.camDist, smoothYaw: Math.PI };
  let view = { w: 1, h: 1 };
  let lastNow = performance.now() / 1000;

  function angleDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    view = { w, h };
  }
  window.addEventListener('resize', resize);
  resize();

  function syncCar(car, now, dt) {
    let entry = carMeshes.get(car.id);
    if (!entry) {
      entry = makeCarMesh(car.color, car.kind === 'police');
      scene.add(entry.group);
      carMeshes.set(car.id, entry);
    }
    const { group } = entry;
    const active = car.active;
    group.visible = active;
    if (!active) {
      if (wheelSlots.has(car.id)) { freeWheelSlots.push(wheelSlots.get(car.id)); wheelSlots.delete(car.id); }
      if (lightSlots.has(car.id)) { freeLightSlots.push(lightSlots.get(car.id)); lightSlots.delete(car.id); }
      return;
    }
    group.position.set(car.x, car.wreck ? 0.15 : 0, car.z);
    group.rotation.y = car.heading;
    group.rotation.z = car.wreck ? 0.08 : 0;
    if (car.kind === 'police' && entry.lightBarRed) {
      const on = Math.sin(now * 6 + car.sirenPhase) > 0;
      entry.lightBarRed.visible = on;
      entry.lightBarBlue.visible = !on;
    }
    entry.bodyMat.color.setHex(car.wreck ? 0x333333 : car.color);
    entry.bodyMat.emissive.setHex(car.wreck ? 0x000000 : car.color);
    // Wheels: allocate a slot once, then spin them with distance travelled.
    let slot = wheelSlots.get(car.id);
    if (slot === undefined) {
      const ref = { value: nextWheelSlot };
      slot = allocSlot(wheelSlots, freeWheelSlots, ref);
      nextWheelSlot = ref.value;
      if (slot >= 0) wheelSlots.set(car.id, slot);
      wheelAngle.set(car.id, 0);
    }
    if (slot !== undefined && slot >= 0) {
      const angle = (wheelAngle.get(car.id) || 0) + (car.speed * dt) / 0.36;
      wheelAngle.set(car.id, angle);
      // Wheel orientation: spin around the cylinder's own axis, lay the axle
      // across the car, then yaw with the car. One Euler triple cannot say
      // that, so the matrix is composed by hand.
      const rotY = new THREE.Matrix4().makeRotationY(car.heading);
      const rotZ = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
      const spin = new THREE.Matrix4().makeRotationY(angle);
      const wheelMat4 = new THREE.Matrix4().multiplyMatrices(rotY, rotZ).multiply(spin);
      for (let w = 0; w < 4; w += 1) {
        wheelMat4.setPosition(
          car.x + Math.sin(car.heading) * wheelOffsets[w][1] + Math.cos(car.heading) * wheelOffsets[w][0],
          0.36,
          car.z + Math.cos(car.heading) * wheelOffsets[w][1] - Math.sin(car.heading) * wheelOffsets[w][0],
        );
        wheels.setMatrixAt(slot * 4 + w, wheelMat4);
      }
      wheels.instanceMatrix.needsUpdate = true;
    }
    // Headlights (front) and taillights (rear).
    let lslot = lightSlots.get(car.id);
    if (lslot === undefined) {
      const ref = { value: nextLightSlot };
      lslot = allocSlot(lightSlots, freeLightSlots, ref);
      nextLightSlot = ref.value;
      if (lslot >= 0) lightSlots.set(car.id, lslot);
    }
    if (lslot !== undefined && lslot >= 0) {
      for (let s = 0; s < 2; s += 1) {
        const sx = s === 0 ? -0.7 : 0.7;
        wheelDummy.position.set(
          car.x + Math.sin(car.heading) * 2.22 + Math.cos(car.heading) * sx,
          0.6,
          car.z + Math.cos(car.heading) * 2.22 - Math.sin(car.heading) * sx,
        );
        wheelDummy.rotation.set(0, car.heading, 0);
        wheelDummy.updateMatrix();
        headlights.setMatrixAt(lslot * 2 + s, wheelDummy.matrix);
        wheelDummy.position.set(
          car.x - Math.sin(car.heading) * 2.22 + Math.cos(car.heading) * sx,
          0.6,
          car.z - Math.cos(car.heading) * 2.22 - Math.sin(car.heading) * sx,
        );
        wheelDummy.updateMatrix();
        taillights.setMatrixAt(lslot * 2 + s, wheelDummy.matrix);
      }
      headlights.instanceMatrix.needsUpdate = true;
      taillights.instanceMatrix.needsUpdate = true;
    }
  }

  function syncPed(ped, now) {
    let entry = pedMeshes.get(ped);
    if (!entry) {
      entry = makePersonMesh(ped.color, false);
      scene.add(entry.group);
      pedMeshes.set(ped, entry);
    }
    entry.group.visible = ped.active;
    if (!ped.active) return;
    entry.group.position.set(ped.x, 0, ped.z);
    entry.group.rotation.y = ped.heading;
    const swing = Math.sin(now * 8 + ped.x) * 0.5 * Math.min(1, ped.speed / 3);
    entry.legL.rotation.x = swing;
    entry.legR.rotation.x = -swing;
    if (ped.kind === 'thug') {
      entry.group.scale.setScalar(1.15);
      // Telegraph: the shirt glows red while the punch winds up.
      entry.shirt.emissive.setHex(ped.punchAnim > 0 ? 0x881111 : 0x000000);
    }
  }

  function draw(state, screen) {
    const now = performance.now() / 1000;
    const dt = Math.min(0.1, Math.max(0, now - lastNow));
    lastNow = now;
    const p = state.player;
    for (const car of state.cars) syncCar(car, now, dt);
    for (const ped of state.peds) syncPed(ped, now);
    playerMesh.group.visible = p.onFoot && screen !== 'title';
    if (p.onFoot) {
      playerMesh.group.position.set(p.x, 0, p.z);
      playerMesh.group.rotation.y = p.heading;
      const swing = Math.sin(now * 9) * 0.5 * Math.min(1, Math.abs(p.speed) / 5);
      playerMesh.legL.rotation.x = swing;
      playerMesh.legR.rotation.x = -swing;
      if (playerMesh.armL) {
        playerMesh.armL.rotation.x = -swing * 0.7;
        playerMesh.armR.rotation.x = p.punchAnim > 0 ? -1.6 : swing * 0.7;
      }
    }
    for (let i = 0; i < state.pickups.length; i += 1) {
      const pk = state.pickups[i];
      const m = pickupMeshes[i];
      m.visible = pk.active;
      if (pk.active) {
        m.position.set(pk.x, 1.1 + Math.sin(pk.spin) * 0.15, pk.z);
        m.rotation.y = pk.spin;
      }
    }
    const marker = world.markerPos();
    if (marker && screen === 'play') {
      beacon.visible = true;
      diamond.visible = true;
      beacon.position.set(marker.x, 30, marker.z);
      diamond.position.set(marker.x, 9 + Math.sin(now * 2) * 0.6, marker.z);
      diamond.rotation.y = now * 1.5;
    } else {
      beacon.visible = false;
      diamond.visible = false;
    }
    syncTrafficLights();
    sun.position.set(p.x - 120, 70, p.z - 80);
    sun.target.position.set(p.x, 0, p.z);
    sun.target.updateMatrixWorld();

    // Third-person camera: placed at the world's camera yaw, smoothed, looking
    // at the player. The world owns the yaw (mouse orbit + auto-align); this
    // file only smooths it so the view never jumps.
    cam.smoothYaw += angleDiff(state.camYaw, cam.smoothYaw) * 0.2;
    const camYaw = cam.smoothYaw;
    const dist = cam.dist;
    const tx = p.x + Math.sin(camYaw) * dist * Math.cos(cam.pitch);
    const tz = p.z + Math.cos(camYaw) * dist * Math.cos(cam.pitch);
    const ty = 2.2 + dist * Math.sin(cam.pitch);
    camera.position.x += (tx - camera.position.x) * 0.25;
    camera.position.y += (ty - camera.position.y) * 0.25;
    camera.position.z += (tz - camera.position.z) * 0.25;
    camera.lookAt(p.x, 1.6, p.z);
    renderer.render(scene, camera);
  }

  function snapCamera(state) {
    const p = state.player;
    cam.smoothYaw = state.camYaw;
    const camYaw = cam.smoothYaw;
    camera.position.set(
      p.x + Math.sin(camYaw) * cam.dist * Math.cos(cam.pitch),
      2.2 + cam.dist * Math.sin(cam.pitch),
      p.z + Math.cos(camYaw) * cam.dist * Math.cos(cam.pitch),
    );
    camera.lookAt(p.x, 1.6, p.z);
  }

  // Apply a quality tier live. Shadows and fog rebuild; antialias is fixed
  // at renderer creation, so a tier change notes it but cannot flip it.
  let currentQuality = qualityName;
  function applyQuality(name) {
    if (!QUALITY[name] || name === currentQuality) return false;
    const nq = QUALITY[name];
    currentQuality = name;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, nq.pixelRatio));
    renderer.shadowMap.enabled = nq.shadows;
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    sun.shadow.mapSize.set(nq.shadowMap, nq.shadowMap);
    scene.fog.near = nq.fogNear;
    scene.fog.far = nq.fogFar;
    resize();
    return true;
  }

  // Prewarm: compile the scene once so the first real frame does not hitch.
  renderer.compile(scene, camera);

  return {
    draw, snapCamera, cam, scene, renderer, camera, applyQuality,
    quality() { return currentQuality; },
    stats() {
      const info = renderer.info;
      return { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures };
    },
    viewSize() { return view; },
  };
}

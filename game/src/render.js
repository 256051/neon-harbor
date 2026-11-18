// Neon Harbor — the renderer. Three.js r160, one WebGLRenderer, one scene.
// Static geometry (buildings, roads, streetlights) is merged by material so
// the whole city draws in a handful of calls; cars, people and pickups are
// small groups rebuilt or moved per frame. The camera is a third-person
// follow camera owned here; the HUD (minimap, compass, text) is a separate
// Canvas 2D layer in hud.js.
//
// Quality tiers: high keeps shadows and a full pixel ratio, medium drops
// shadows, low halves the pixel ratio as well. Auto-quality watches the frame
// time and steps down when the machine cannot keep up.
import * as THREE from 'three';
import { PITCH, STREETS, CITY_HALF, STREET_HALF, PALETTE, FEEL } from './config.js';
import { streetCoord } from './world.js';
import { mergeGeometries, BOX_FACE_MAP } from './merge.js';
import { lambert, basic, facade } from './materials.js';

function makeFacadeTexture(baseColor, litRatio, seed) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, 128, 256);
  // Windows: a grid, some lit warm, most dark.
  let s = seed;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let row = 0; row < 12; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      const lit = rand() < litRatio;
      ctx.fillStyle = lit ? '#ffd27a' : '#1a2030';
      ctx.fillRect(8 + col * 20, 10 + row * 20, 12, 12);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGroundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#23232e';
  ctx.fillRect(0, 0, 256, 256);
  // Subtle noise so the ground is not a flat void.
  for (let i = 0; i < 800; i += 1) {
    const v = Math.floor(Math.random() * 20);
    ctx.fillStyle = `rgba(255,255,255,${v / 255})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(24, 24);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createRenderer(canvas, world, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 60, 420);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);

  // --- Lights: a low dusk sun, a cool ambient, and the moon's fill. ------
  const sun = new THREE.DirectionalLight(0xffb36b, 1.6);
  sun.position.set(-120, 90, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -220;
  sun.shadow.camera.right = 220;
  sun.shadow.camera.top = 220;
  sun.shadow.camera.bottom = -220;
  sun.shadow.camera.far = 500;
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x8a7fd0, 0.55));
  const moon = new THREE.DirectionalLight(0x9fb4ff, 0.35);
  moon.position.set(80, 120, -100);
  scene.add(moon);

  // --- Sun disc and skyline glow on the horizon. --------------------------
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(26, 32),
    new THREE.MeshBasicMaterial({ color: PALETTE.sun, fog: false }),
  );
  sunDisc.position.set(-260, 42, -40);
  sunDisc.lookAt(0, 42, 0);
  scene.add(sunDisc);

  // --- Ground, roads and sidewalks. ---------------------------------------
  const groundTex = makeGroundTexture();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY_HALF * 2 + PITCH * 2, CITY_HALF * 2 + PITCH * 2),
    new THREE.MeshLambertMaterial({ map: groundTex, color: 0xffffff }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const roadMat = lambert(PALETTE.road);
  const walkMat = lambert(PALETTE.sidewalk);
  const roadGeos = [];
  const walkGeos = [];
  for (let i = 0; i < STREETS; i += 1) {
    const c = streetCoord(i);
    const len = CITY_HALF * 2 + PITCH;
    const roadX = new THREE.BoxGeometry(len, 0.1, STREET_HALF * 2);
    roadX.translate(0, 0.05, c);
    roadGeos.push(roadX);
    const roadZ = new THREE.BoxGeometry(STREET_HALF * 2, 0.1, len);
    roadZ.translate(c, 0.05, 0);
    roadGeos.push(roadZ);
    const walkX1 = new THREE.BoxGeometry(len, 0.12, 3);
    walkX1.translate(0, 0.06, c + STREET_HALF + 1.5);
    walkGeos.push(walkX1);
    const walkX2 = new THREE.BoxGeometry(len, 0.12, 3);
    walkX2.translate(0, 0.06, c - STREET_HALF - 1.5);
    walkGeos.push(walkX2);
    const walkZ1 = new THREE.BoxGeometry(3, 0.12, len);
    walkZ1.translate(c + STREET_HALF + 1.5, 0.06, 0);
    walkGeos.push(walkZ1);
    const walkZ2 = new THREE.BoxGeometry(3, 0.12, len);
    walkZ2.translate(c - STREET_HALF - 1.5, 0.06, 0);
    walkGeos.push(walkZ2);
  }
  const roads = new THREE.Mesh(mergeGeometries(roadGeos), roadMat);
  roads.receiveShadow = true;
  scene.add(roads);
  const walks = new THREE.Mesh(mergeGeometries(walkGeos), walkMat);
  walks.receiveShadow = true;
  scene.add(walks);

  // --- Buildings: merged per facade variant, walls / top / roof separate. --
  const facadeColors = ['#5a5f7a', '#7a5a5f', '#4f6a72', '#8a6f4d', '#6a5a8a', '#55684f'];
  const facadeTextures = facadeColors.map((c, i) => makeFacadeTexture(c, 0.35, 1234 + i * 777));
  const topMat = lambert(0x3a3f55);
  const roofMat = lambert(0x2c2f42);
  const byFacade = [[], [], [], [], [], []];
  for (const b of world.buildings) {
    const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
    geo.translate(b.x, b.h / 2, b.z);
    byFacade[b.facade].push(geo);
  }
  for (let v = 0; v < 6; v += 1) {
    if (!byFacade[v].length) continue;
    // Remap each box's six groups (px, nx, py, ny, pz, nz) to
    // [side, side, top, roof, side, side] so every tower draws fully.
    const merged = mergeGeometries(byFacade[v], true, (gi, k) => BOX_FACE_MAP[k]);
    const mats = [facade(facadeColors[v], facadeTextures[v]), topMat, roofMat];
    const mesh = new THREE.Mesh(merged, mats);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // --- Streetlights: merged poles, merged lamp heads, one glow material. ---
  const poleGeos = [];
  const headGeos = [];
  for (const light of world.streetlights) {
    const pole = new THREE.CylinderGeometry(0.12, 0.16, 5.4, 6);
    pole.translate(light.x, 2.7, light.z);
    poleGeos.push(pole);
    const head = new THREE.SphereGeometry(0.35, 8, 6);
    head.translate(light.x, 5.5, light.z);
    headGeos.push(head);
  }
  const poles = new THREE.Mesh(mergeGeometries(poleGeos), lambert(0x2a2a33));
  scene.add(poles);
  const lampHeads = new THREE.Mesh(
    mergeGeometries(headGeos),
    new THREE.MeshBasicMaterial({ color: PALETTE.lamp }),
  );
  scene.add(lampHeads);
  const lampLights = [];
  for (let i = 0; i < world.streetlights.length; i += 4) {
    const s = world.streetlights[i];
    const point = new THREE.PointLight(0xffd9a0, 12, 26, 1.8);
    point.position.set(s.x, 5.2, s.z);
    scene.add(point);
    lampLights.push(point);
  }

  // --- Traffic lights: a pole, a housing, and two lamp lenses each. --------
  const trafficLightMeshes = [];
  for (const light of world.trafficLights) {
    const group = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 4.6, 6), lambert(0x2a2a33));
    pole.position.y = 2.3;
    group.add(pole);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, 0.5), lambert(0x1a1a20));
    housing.position.y = 4.8;
    group.add(housing);
    const red = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    red.position.set(0, 5.05, 0.28);
    group.add(red);
    const green = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0x22ff66 }));
    green.position.set(0, 4.55, 0.28);
    group.add(green);
    group.position.set(light.x + STREET_HALF + 0.6, 0, light.z + STREET_HALF + 0.6);
    scene.add(group);
    trafficLightMeshes.push({ group, red, green, light });
  }

  // --- Mission beacon: a glowing column + a floating diamond at the target. --
  const beacon = new THREE.Group();
  const beaconBeam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 1.6, 30, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: PALETTE.mission, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }),
  );
  beaconBeam.position.y = 15;
  beacon.add(beaconBeam);
  const beaconDiamond = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.1),
    new THREE.MeshBasicMaterial({ color: PALETTE.mission }),
  );
  beaconDiamond.position.y = 8;
  beacon.add(beaconDiamond);
  beacon.visible = false;
  scene.add(beacon);

  // --- Car factory: one group per car, body + cabin merged, wheels spin. ----
  const carMeshes = new Map();
  function buildCarMesh(car) {
    const group = new THREE.Group();
    const bodyGeo = new THREE.BoxGeometry(2.0, 0.62, 4.4);
    bodyGeo.translate(0, 0.55, 0);
    const cabinGeo = new THREE.BoxGeometry(1.7, 0.55, 2.2);
    cabinGeo.translate(0, 1.08, -0.25);
    const body = new THREE.Mesh(
      mergeGeometries([bodyGeo, cabinGeo], true),
      [lambert(car.color), lambert(0x11131c)],
    );
    body.castShadow = true;
    group.add(body);
    // Police light bar.
    let lightBar = null;
    if (car.type === 'police') {
      lightBar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 0.5), new THREE.MeshBasicMaterial({ color: 0xff2222 }));
      lightBar.position.set(0, 1.42, -0.25);
      group.add(lightBar);
    }
    // Rear lights: a red strip so a car reads from behind — the player's
    // own car used to look dark from the chase camera.
    const tail = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 0.16, 0.08),
      new THREE.MeshBasicMaterial({ color: 0xff2a22 }),
    );
    tail.position.set(0, 0.72, -2.21);
    group.add(tail);
    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = lambert(0x0c0c10);
    const wheels = [];
    for (const [wx, wz] of [[-1.0, 1.45], [1.0, 1.45], [-1.0, -1.45], [1.0, -1.45]]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.set(wx, 0.36, wz);
      wheel.castShadow = true;
      group.add(wheel);
      wheels.push(wheel);
    }
    group.position.set(car.x, 0, car.z);
    group.rotation.y = car.heading;
    scene.add(group);
    const entry = { group, wheels, lightBar, car };
    carMeshes.set(car.id, entry);
    return entry;
  }

  // --- Person factory: merged torso + head + arms, legs swing separately. ---
  const personMeshes = new Map();
  function buildPersonMesh(key, color, jacketColor) {
    const group = new THREE.Group();
    const torsoGeo = new THREE.BoxGeometry(0.62, 0.78, 0.36);
    torsoGeo.translate(0, 1.05, 0);
    const headGeo = new THREE.BoxGeometry(0.36, 0.36, 0.36);
    headGeo.translate(0, 1.66, 0);
    const armLGeo = new THREE.BoxGeometry(0.18, 0.66, 0.18);
    armLGeo.translate(-0.42, 1.05, 0);
    const armRGeo = new THREE.BoxGeometry(0.18, 0.66, 0.18);
    armRGeo.translate(0.42, 1.05, 0);
    const upper = new THREE.Mesh(
      mergeGeometries([torsoGeo, headGeo, armLGeo, armRGeo], true),
      [lambert(jacketColor), lambert(0xd9a066), lambert(jacketColor), lambert(jacketColor)],
    );
    upper.castShadow = true;
    group.add(upper);
    const legMat = lambert(0x2a2d3a);
    const legGeo = new THREE.BoxGeometry(0.22, 0.72, 0.22);
    legGeo.translate(0, -0.36, 0);
    const legL = new THREE.Mesh(legGeo, legMat);
    legL.position.set(-0.16, 0.72, 0);
    legL.castShadow = true;
    group.add(legL);
    const legR = new THREE.Mesh(legGeo, legMat);
    legR.position.set(0.16, 0.72, 0);
    legR.castShadow = true;
    group.add(legR);
    scene.add(group);
    const entry = { group, legL, legR, upper };
    personMeshes.set(key, entry);
    return entry;
  }

  // --- Pickups: floating gold crates that spin. ------------------------------
  const pickupMeshes = [];
  for (const pickup of world.pickups) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.7, 0.7),
      new THREE.MeshBasicMaterial({ color: 0xffd23f }),
    );
    mesh.position.set(pickup.x, 1.0, pickup.z);
    mesh.castShadow = true;
    scene.add(mesh);
    pickupMeshes.push({ mesh, pickup });
  }

  // The player: teal jacket, easy to spot in the crowd.
  const playerEntry = buildPersonMesh('player', PALETTE.playerJacket, PALETTE.playerJacket);
  const pedEntries = new Map();
  world.peds.forEach((ped, i) => {
    pedEntries.set(i, buildPersonMesh(`ped-${i}`, ped.color, ped.color));
  });
  const thugEntries = new Map();

  // --- Camera state. ---------------------------------------------------------
  let camYaw = Math.PI; // behind the player, who starts facing -Z
  let camPitch = FEEL.camPitch;
  let camDist = FEEL.camDist;
  let camPos = new THREE.Vector3(0, 8, 100);
  let camLook = new THREE.Vector3(0, 1.5, 84);

  let quality = opts.quality || 'high';
  let autoQuality = opts.autoQuality !== false;
  let frameTime = 16;
  let slowFrames = 0;

  function applyQuality() {
    if (quality === 'high') {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.shadowMap.enabled = true;
      sun.castShadow = true;
    } else if (quality === 'medium') {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.shadowMap.enabled = false;
      sun.castShadow = false;
    } else {
      renderer.setPixelRatio(1);
      renderer.shadowMap.enabled = false;
      sun.castShadow = false;
    }
    scene.traverse((obj) => {
      if (obj.material) obj.material.needsUpdate = true;
    });
  }
  applyQuality();

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', resize);

  function update(dt, input) {
    const t0 = performance.now();
    const p = world.player;

    // --- Camera: orbit with the mouse, zoom with the wheel, swing back ------
    // behind the direction of travel while driving.
    if (input && input.orbit) {
      camYaw -= input.orbit.dx * 0.005;
      camPitch = Math.max(0.08, Math.min(0.9, camPitch + input.orbit.dy * 0.003));
      camDist = Math.max(FEEL.camMinDist, Math.min(FEEL.camMaxDist, camDist + (input.orbit.wheel || 0) * 0.01));
    }
    const moving = p.speed > 3;
    if (moving && !p.onFoot) {
      // Ease the camera behind the car.
      const behind = Math.atan2(-Math.sin(p.heading), -Math.cos(p.heading));
      let diff = behind - camYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      camYaw += diff * Math.min(1, FEEL.camAlign * dt);
    }
    const camTarget = new THREE.Vector3(
      p.x + Math.sin(camYaw) * Math.cos(camPitch) * camDist,
      2.2 + Math.sin(camPitch) * camDist,
      p.z + Math.cos(camYaw) * Math.cos(camPitch) * camDist,
    );
    camPos.lerp(camTarget, Math.min(1, 8 * dt));
    const lookTarget = new THREE.Vector3(p.x, 1.6, p.z);
    camLook.lerp(lookTarget, Math.min(1, 10 * dt));
    camera.position.copy(camPos);
    if (world.cameraShake > 0) {
      camera.position.x += (Math.random() - 0.5) * world.cameraShake * 0.5;
      camera.position.y += (Math.random() - 0.5) * world.cameraShake * 0.4;
    }
    camera.lookAt(camLook);

    // --- Player. -------------------------------------------------------------
    playerEntry.group.position.set(p.x, 0, p.z);
    playerEntry.group.rotation.y = p.heading;
    const walking = p.onFoot && p.speed > 0.5;
    const swing = walking ? Math.sin(p.walkPhase) * 0.55 : 0;
    playerEntry.legL.rotation.x = swing;
    playerEntry.legR.rotation.x = -swing;
    playerEntry.group.visible = true;

    // --- Cars: sync position, heading, wheels; drop wrecked ones. -----------
    const seenCarIds = new Set();
    for (const car of world.cars) {
      seenCarIds.add(car.id);
      let entry = carMeshes.get(car.id);
      if (!entry) entry = buildCarMesh(car);
      entry.group.position.set(car.x, 0, car.z);
      entry.group.rotation.y = car.heading;
      entry.group.visible = !car.wrecked || car.type === 'player';
      for (const wheel of entry.wheels) wheel.rotation.x = car.wheelSpin;
      if (entry.lightBar) {
        // Alternate red / blue with the siren.
        const phase = Math.floor(world.time * 4) % 2 === 0;
        entry.lightBar.material.color.setHex(phase ? 0xff2222 : 0x2266ff);
      }
      if (car.wrecked) {
        entry.group.rotation.z = 0.12;
        entry.group.position.y = 0.1;
      } else {
        entry.group.rotation.z = 0;
        entry.group.position.y = 0;
      }
    }
    for (const [id, entry] of carMeshes) {
      if (!seenCarIds.has(id)) {
        scene.remove(entry.group);
        carMeshes.delete(id);
      }
    }

    // --- Pedestrians. ---------------------------------------------------------
    world.peds.forEach((ped, i) => {
      const entry = pedEntries.get(i);
      if (!entry) return;
      entry.group.position.set(ped.x, 0, ped.z);
      entry.group.rotation.y = ped.heading;
      entry.group.visible = ped.state !== 'down';
      if (ped.state === 'down') {
        entry.group.rotation.x = Math.PI / 2;
        entry.group.position.y = 0.3;
      } else {
        entry.group.rotation.x = 0;
        entry.group.position.y = 0;
        const swingPed = Math.sin(ped.walkPhase) * 0.5;
        entry.legL.rotation.x = swingPed;
        entry.legR.rotation.x = -swingPed;
      }
    });

    // --- Thugs. ---------------------------------------------------------------
    const seenThugs = new Set();
    world.thugs.forEach((thug, i) => {
      seenThugs.add(i);
      let entry = thugEntries.get(i);
      if (!entry) entry = buildPersonMesh(`thug-${i}`, thug.color, thug.color);
      entry.group.position.set(thug.x, 0, thug.z);
      entry.group.rotation.y = thug.heading;
      const swingThug = Math.sin(thug.walkPhase) * 0.5;
      entry.legL.rotation.x = swingThug;
      entry.legR.rotation.x = -swingThug;
      // Windup telegraph: the thug pulses before the punch lands. (The scale
      // is per-group, so it never touches the shared cached materials.)
      const windupScale = thug.state === 'windup' ? 1 + Math.sin(world.time * 20) * 0.08 : 1;
      entry.group.scale.setScalar(windupScale);
    });
    for (const [i, entry] of thugEntries) {
      if (!seenThugs.has(i)) {
        scene.remove(entry.group);
        thugEntries.delete(i);
      }
    }

    // --- Pickups. ---------------------------------------------------------------
    for (const { mesh, pickup } of pickupMeshes) {
      mesh.visible = !pickup.taken;
      if (!pickup.taken) {
        mesh.rotation.y = pickup.spin;
        mesh.position.y = 1.0 + Math.sin(pickup.spin * 2) * 0.15;
      }
    }

    // --- Traffic lights: red / green follow the same cycle as the sim. --------
    for (const { red, green, light } of trafficLightMeshes) {
      const t = (world.time + light.phase) % 12;
      const nsGreen = t < 6;
      red.material.color.setHex(nsGreen ? 0x551111 : 0xff2222);
      green.material.color.setHex(nsGreen ? 0x22ff66 : 0x115511);
    }

    // --- Mission beacon. ---------------------------------------------------------
    // The beacon position is set by main.js through setBeacon(); here we only
    // spin the diamond and pulse the beam.
    beaconDiamond.rotation.y += dt * 1.5;
    beaconBeam.material.opacity = 0.2 + Math.sin(world.time * 3) * 0.08;

    // --- Frame time → auto-quality. ----------------------------------------------
    renderer.render(scene, camera);
    const elapsed = performance.now() - t0;
    frameTime = frameTime * 0.95 + elapsed * 0.05;
    if (autoQuality && frameTime > 24) {
      slowFrames += 1;
      if (slowFrames > 90) {
        slowFrames = 0;
        if (quality === 'high') setQuality('medium');
        else if (quality === 'medium') setQuality('low');
      }
    } else {
      slowFrames = 0;
    }
    return { frameTime };
  }

  function setQuality(next) {
    if (quality === next) return;
    quality = next;
    applyQuality();
  }

  function setBeacon(x, z, visible) {
    beacon.visible = !!visible;
    if (visible) beacon.position.set(x, 0, z);
  }

  function getCameraState() {
    return { yaw: camYaw, pitch: camPitch, dist: camDist };
  }

  function setCameraYaw(yaw) {
    camYaw = yaw;
  }

  function getQuality() {
    return quality;
  }

  function dispose() {
    window.removeEventListener('resize', resize);
    renderer.dispose();
  }

  return {
    update, setQuality, getQuality, setBeacon,
    getCameraState, setCameraYaw, dispose,
    scene, camera, renderer,
  };
}

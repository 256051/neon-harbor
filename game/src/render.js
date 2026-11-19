// Neon Harbor — rendering. A dusk-lit harbour city in three.js: merged static
// geometry for the buildings, lamps and roads, individual meshes only for the
// things that move, and a third-person follow camera with a mouse orbit.

import * as THREE from 'three';
import { CFG } from './config.js';
import { mergeBoxes, mergeQuads } from './merge.js';

const SKY_TOP = 0x2c3a5e;
const SKY_HORIZON = 0xd98a4a;

export class Renderer {
  constructor(canvas, world) {
    this.world = world;
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2e3a55);
    this.scene.fog = new THREE.Fog(0x35405c, 120, 420);
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 900);
    this.cameraYaw = 0; // orbit offset the player drags with the mouse
    this.cameraPitch = 0.32;
    this.quality = 'high';
    this.frameCount = 0;

    const hemi = new THREE.HemisphereLight(0x8a7aa8, 0x2a2620, 0.85);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffb36b, 1.5);
    sun.position.set(-120, 90, -60);
    this.scene.add(sun);
    const moon = new THREE.DirectionalLight(0x8fa8ff, 0.35);
    moon.position.set(140, 120, 80);
    this.scene.add(moon);

    this.buildStatic();
    this.buildActors();
    window.addEventListener('resize', () => this.onResize());
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  setQuality(q) {
    this.quality = q;
    const ratio = q === 'low' ? 0.7 : q === 'medium' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ------------------------------------------------------------ static city

  buildStatic() {
    const world = this.world;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });

    // Ground: one big asphalt slab under everything.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(760, 640),
      new THREE.MeshLambertMaterial({ color: 0x33302e })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(30, -0.05, 0);
    this.scene.add(ground);

    // Water east of the harbour edge, with a warm dusk reflection tint.
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(140, 640),
      new THREE.MeshLambertMaterial({ color: 0x1d3a52 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(268 + 70, 0.02, 0);
    this.scene.add(water);

    // Roads: dark strips along every street line, merged into one mesh.
    const roadBoxes = [];
    for (const line of world.streetLines) {
      roadBoxes.push({ x: line, y: 0, z: 0, sx: CFG.streetWidth, sy: 0.1, sz: 536, color: 0x24211f });
      roadBoxes.push({ x: 0, y: 0, z: line, sx: 536, sy: 0.1, sz: CFG.streetWidth, color: 0x24211f });
    }
    // Sidewalk ribbons flanking each road, a shade lighter.
    for (const line of world.streetLines) {
      for (const side of [-1, 1]) {
        const off = CFG.streetWidth / 2 + 1.4;
        roadBoxes.push({ x: line + side * off, y: 0.02, z: 0, sx: 2.4, sy: 0.1, sz: 536, color: 0x4a4642 });
        roadBoxes.push({ x: 0, y: 0.02, z: line + side * off, sx: 536, sy: 0.1, sz: 2.4, color: 0x4a4642 });
      }
    }
    const roads = new THREE.Mesh(mergeBoxes(roadBoxes), mat);
    this.scene.add(roads);

    // Buildings, merged into a single draw call.
    const buildingBoxes = world.buildings.map((b) => ({
      x: b.x, y: b.h / 2, z: b.z, sx: b.hw * 2, sy: b.h, sz: b.hd * 2, color: b.color,
    }));
    // Rooftop rims so the skyline reads at dusk.
    for (const b of world.buildings) {
      if (b.h > 26) {
        buildingBoxes.push({ x: b.x, y: b.h + 0.3, z: b.z, sx: b.hw * 2 + 0.6, sy: 0.6, sz: b.hd * 2 + 0.6, color: 0x2a2a33 });
      }
    }
    const buildings = new THREE.Mesh(mergeBoxes(buildingBoxes), mat);
    this.scene.add(buildings);

    // Lit windows, merged into one unlit mesh so they glow against the dusk.
    if (world.windows.length > 0) {
      const winMesh = new THREE.Mesh(
        mergeQuads(world.windows),
        new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })
      );
      this.scene.add(winMesh);
    }

    // Street lamps: dark poles merged, warm heads merged.
    const poles = world.lamps.map((l) => ({ x: l.x, y: 3, z: l.z, sx: 0.25, sy: 6, sz: 0.25, color: 0x222222 }));
    const lampMesh = new THREE.Mesh(mergeBoxes(poles), mat);
    this.scene.add(lampMesh);
    const heads = world.lamps.map((l) => ({ x: l.x, y: 6.1, z: l.z, sx: 0.9, sy: 0.3, sz: 0.9, color: 0xffd28a }));
    const headMesh = new THREE.Mesh(mergeBoxes(heads), new THREE.MeshBasicMaterial({ vertexColors: true }));
    this.scene.add(headMesh);

    // Docks: wooden piers and crates on the east edge.
    const dockBoxes = [];
    for (const pier of world.piers) {
      dockBoxes.push({ x: pier.x + pier.len / 2, y: 0.4, z: pier.z, sx: pier.len, sy: 0.8, sz: pier.w, color: 0x6b4a2a });
    }
    for (const c of world.crates) {
      dockBoxes.push({ x: c.x, y: c.s / 2, z: c.z, sx: c.s, sy: c.s, sz: c.s, color: c.color });
    }
    const docks = new THREE.Mesh(mergeBoxes(dockBoxes), mat);
    this.scene.add(docks);

    // A low sun disc on the horizon so the title screen has a focal point.
    const sunDisc = new THREE.Mesh(
      new THREE.CircleGeometry(26, 24),
      new THREE.MeshBasicMaterial({ color: 0xff9a4a, fog: false })
    );
    sunDisc.position.set(330, 42, -140);
    sunDisc.lookAt(0, 42, 0);
    this.scene.add(sunDisc);
  }

  // ------------------------------------------------------------ moving actors

  makeCarMesh(color, isPolice) {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.75, 4.4), bodyMat);
    body.position.y = 0.65;
    group.add(body);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 0.6, 2.2),
      new THREE.MeshLambertMaterial({ color: 0x1a2028 })
    );
    cabin.position.set(0, 1.25, -0.2);
    group.add(cabin);
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
    for (const [wx, wz] of [[-0.95, 1.4], [0.95, 1.4], [-0.95, -1.4], [0.95, -1.4]]) {
      const wheel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, 0.7), wheelMat);
      wheel.position.set(wx, 0.35, wz);
      group.add(wheel);
    }
    // Red tail-light strip across the rear, so the car reads from behind.
    const tail = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.18, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xff2a22 })
    );
    tail.position.set(0, 0.8, -2.22);
    group.add(tail);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.16, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8 })
    );
    head.position.set(0, 0.8, 2.22);
    group.add(head);
    if (isPolice) {
      const bar = new THREE.Group();
      const red = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.4), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
      red.position.x = -0.45;
      const blue = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.4), new THREE.MeshBasicMaterial({ color: 0x2040ff }));
      blue.position.x = 0.45;
      bar.add(red);
      bar.add(blue);
      bar.position.y = 1.65;
      group.add(bar);
      group.userData.lightBar = bar;
      group.userData.redLight = red;
      group.userData.blueLight = blue;
    }
    return group;
  }

  makePedMesh(color) {
    const group = new THREE.Group();
    const torso = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.9, 0.32),
      new THREE.MeshLambertMaterial({ color })
    );
    torso.position.y = 0.95;
    group.add(torso);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 8),
      new THREE.MeshLambertMaterial({ color: 0xd8a077 })
    );
    head.position.y = 1.6;
    group.add(head);
    const legs = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.55, 0.3),
      new THREE.MeshLambertMaterial({ color: 0x2a2a30 })
    );
    legs.position.y = 0.28;
    group.add(legs);
    return group;
  }

  buildActors() {
    const world = this.world;
    this.carMeshes = new Map();
    const mk = (car, isPolice) => {
      const mesh = this.makeCarMesh(car.color, isPolice);
      this.scene.add(mesh);
      this.carMeshes.set(car, mesh);
      return mesh;
    };
    for (const c of world.traffic) mk(c, false);
    for (const c of world.parked) mk(c, false);
    this.playerMesh = this.makeCarMesh(0xd86a1e, false); // Mara's ride: burnt orange
    this.playerMesh.visible = false;
    this.scene.add(this.playerMesh);
    this.playerFoot = this.makePedMesh(0x8a2f2f); // Mara on foot: dark red jacket
    this.scene.add(this.playerFoot);
    this.pedMeshes = world.pedestrians.map((ped) => {
      const mesh = this.makePedMesh(ped.color);
      this.scene.add(mesh);
      return mesh;
    });
    // Mission beacon: a pulsing ring and a vertical beam at the target.
    this.beacon = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(4, 5, 32),
      new THREE.MeshBasicMaterial({ color: 0x38e1c6, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.15;
    this.beacon.add(ring);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.1, 60, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x38e1c6, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false })
    );
    beam.position.y = 30;
    this.beacon.add(beam);
    this.beacon.userData.ring = ring;
    this.scene.add(this.beacon);
    this.policeMeshes = new Map();
  }

  syncCarMesh(mesh, car) {
    mesh.position.set(car.x, 0, car.z);
    mesh.rotation.y = car.angle;
  }

  // ------------------------------------------------------------ per-frame sync

  render(dt) {
    const world = this.world;
    const p = world.player;
    this.frameCount++;

    // Player meshes: the car when driving, the walker on foot.
    if (p.onFoot) {
      this.playerMesh.visible = false;
      this.playerFoot.visible = true;
      this.playerFoot.position.set(p.x, 0, p.z);
      this.playerFoot.rotation.y = p.angle;
      if (p.car) {
        const m = this.carMeshes.get(p.car);
        if (m) this.syncCarMesh(m, p.car);
      }
    } else if (p.car) {
      this.playerFoot.visible = false;
      this.playerMesh.visible = true;
      this.syncCarMesh(this.playerMesh, p.car);
    }

    for (const c of world.traffic) {
      const m = this.carMeshes.get(c);
      if (m) this.syncCarMesh(m, c);
    }
    for (const c of world.parked) {
      const m = this.carMeshes.get(c);
      if (m) this.syncCarMesh(m, c);
    }
    world.pedestrians.forEach((ped, i) => {
      const mesh = this.pedMeshes[i];
      mesh.position.set(ped.x, ped.down > 0 ? 0.25 : 0, ped.z);
      mesh.rotation.y = ped.axis === 'x' ? (ped.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (ped.dir > 0 ? 0 : Math.PI);
      if (ped.down > 0) mesh.rotation.z = Math.PI / 2;
      else mesh.rotation.z = 0;
      mesh.visible = true;
    });

    // Police: create a mesh the first time each cruiser is seen.
    for (const pc of world.police) {
      let mesh = this.policeMeshes.get(pc);
      if (!mesh) {
        mesh = this.makeCarMesh(pc.color, true);
        this.scene.add(mesh);
        this.policeMeshes.set(pc, mesh);
      }
      this.syncCarMesh(mesh, pc);
      const flash = Math.sin(pc.siren) > 0;
      if (mesh.userData.redLight) {
        mesh.userData.redLight.material.color.setHex(flash ? 0xff2020 : 0x551111);
        mesh.userData.blueLight.material.color.setHex(flash ? 0x111155 : 0x2040ff);
      }
    }
    // Drop meshes for police that left.
    for (const [pc, mesh] of [...this.policeMeshes.entries()]) {
      if (!world.police.includes(pc)) {
        this.scene.remove(mesh);
        this.policeMeshes.delete(pc);
      }
    }

    // Mission beacon.
    const target = world.missionTarget();
    if (target && (world.state === 'playing' || world.state === 'title')) {
      this.beacon.visible = true;
      this.beacon.position.set(target.x, 0, target.z);
      const pulse = 1 + Math.sin(world.time * 3) * 0.15;
      this.beacon.userData.ring.scale.set(pulse, pulse, 1);
    } else {
      this.beacon.visible = false;
    }

    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  }

  updateCamera(dt) {
    const world = this.world;
    const p = world.player;
    if (world.state === 'title') {
      // Establishing shot: high over the city, looking east toward the dusk
      // sun and the harbour, so the title screen has a skyline behind it.
      this.camera.position.set(-70, 52, 215);
      this.camera.lookAt(130, 6, -70);
      return;
    }
    // Mouse drag orbits the camera around the player.
    this.cameraYaw += 0; // yaw is driven from main.js via look input
    const yaw = world.cameraYaw + this.cameraYaw;
    const dist = CFG.cameraDistance;
    const height = CFG.cameraHeight;
    const tx = p.x - Math.sin(yaw) * dist;
    const tz = p.z - Math.cos(yaw) * dist;
    // Snap when far away (first frames, or a shot that renders once): a slow
    // lerp from the origin would leave the camera floating over the city and
    // the player out of frame.
    const far = Math.hypot(this.camera.position.x - tx, this.camera.position.z - tz);
    if (far > 60) {
      this.camera.position.set(tx, height, tz);
    } else {
      const k = 1 - Math.pow(0.001, dt); // smooth follow
      this.camera.position.x += (tx - this.camera.position.x) * k;
      this.camera.position.y += (height - this.camera.position.y) * k;
      this.camera.position.z += (tz - this.camera.position.z) * k;
    }
    this.camera.lookAt(p.x, 2.2, p.z);
  }

  // Frame the player and the nearest police car together (wanted screenshot).
  frameChase() {
    const world = this.world;
    const p = world.player;
    let nearest = null;
    let best = Infinity;
    for (const pc of world.police) {
      const d = Math.hypot(pc.x - p.x, pc.z - p.z);
      if (d < best) {
        best = d;
        nearest = pc;
      }
    }
    if (!nearest) return;
    const mx = (p.x + nearest.x) / 2;
    const mz = (p.z + nearest.z) / 2;
    const dx = nearest.x - p.x;
    const dz = nearest.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    const px = -dz / d;
    const pz = dx / d;
    const off = Math.max(14, d * 0.9);
    this.camera.position.set(mx + px * off, 9, mz + pz * off);
    this.camera.lookAt(mx, 2, mz);
  }
}

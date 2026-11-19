// Neon Harbor — merge helper. Hundreds of static boxes (buildings, lamps, crates)
// become one draw call instead of hundreds: every box is written into a single
// BufferGeometry with a colour per vertex. Written from scratch for this game;
// it does not use any geometry-utils library.

import * as THREE from 'three';

// One unit box, kept as the template every item is stamped from.
const template = new THREE.BoxGeometry(1, 1, 1);

export function mergeBoxes(items) {
  // items: [{ x, y, z, sx, sy, sz, color }] — color is a hex number like 0x8a6f4d.
  const boxCount = items.length;
  const vertsPerBox = template.attributes.position.count; // 24
  const indexPerBox = template.index.count; // 36
  const positions = new Float32Array(boxCount * vertsPerBox * 3);
  const normals = new Float32Array(boxCount * vertsPerBox * 3);
  const colors = new Float32Array(boxCount * vertsPerBox * 3);
  const index = new Uint32Array(boxCount * indexPerBox);

  const srcPos = template.attributes.position.array;
  const srcNor = template.attributes.normal.array;
  const srcIdx = template.index.array;
  const tmpColor = new THREE.Color();

  for (let b = 0; b < boxCount; b++) {
    const item = items[b];
    const hx = item.sx / 2;
    const hy = item.sy / 2;
    const hz = item.sz / 2;
    tmpColor.setHex(item.color);
    const vBase = b * vertsPerBox;
    for (let v = 0; v < vertsPerBox; v++) {
      const o = v * 3;
      const vo = (vBase + v) * 3;
      positions[vo] = item.x + srcPos[o] * item.sx;
      positions[vo + 1] = item.y + srcPos[o + 1] * item.sy;
      positions[vo + 2] = item.z + srcPos[o + 2] * item.sz;
      normals[vo] = srcNor[o];
      normals[vo + 1] = srcNor[o + 1];
      normals[vo + 2] = srcNor[o + 2];
      colors[vo] = tmpColor.r;
      colors[vo + 1] = tmpColor.g;
      colors[vo + 2] = tmpColor.b;
    }
    const iBase = b * indexPerBox;
    for (let k = 0; k < indexPerBox; k++) {
      index[iBase + k] = vBase + srcIdx[k];
    }
    // Keep the half-extents out of the linter's way: they document the transform.
    void hx;
    void hy;
    void hz;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  return geo;
}

// Merge flat quads (window lights, road markings) into one geometry. Each quad
// is { x, y, z, w, h, color, facing } where facing is 'x' (on a west/east wall,
// quad spans z/y) or 'z' (on a north/south wall, spans x/y).
export function mergeQuads(quads) {
  const n = quads.length;
  const positions = new Float32Array(n * 4 * 3);
  const colors = new Float32Array(n * 4 * 3);
  const index = new Uint32Array(n * 6);
  const tmpColor = new THREE.Color();

  for (let q = 0; q < n; q++) {
    const item = quads[q];
    tmpColor.setHex(item.color);
    const v = q * 4;
    const hw = item.w / 2;
    const hh = item.h / 2;
    let corners;
    if (item.facing === 'x') {
      corners = [
        [item.x, item.y - hh, item.z - hw],
        [item.x, item.y - hh, item.z + hw],
        [item.x, item.y + hh, item.z + hw],
        [item.x, item.y + hh, item.z - hw],
      ];
    } else {
      corners = [
        [item.x - hw, item.y - hh, item.z],
        [item.x + hw, item.y - hh, item.z],
        [item.x + hw, item.y + hh, item.z],
        [item.x - hw, item.y + hh, item.z],
      ];
    }
    for (let c = 0; c < 4; c++) {
      const o = (v + c) * 3;
      positions[o] = corners[c][0];
      positions[o + 1] = corners[c][1];
      positions[o + 2] = corners[c][2];
      colors[o] = tmpColor.r;
      colors[o + 1] = tmpColor.g;
      colors[o + 2] = tmpColor.b;
    }
    const ib = q * 6;
    index[ib] = v;
    index[ib + 1] = v + 1;
    index[ib + 2] = v + 2;
    index[ib + 3] = v;
    index[ib + 4] = v + 2;
    index[ib + 5] = v + 3;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  return geo;
}

// Geometry merging, written for this game — the one helper the vendored
// three.js utils used to provide, re-implemented here so the entry carries no
// extra library file. It concatenates indexed geometries that share the same
// attribute set (position / normal / uv on every shape this game builds).
//
// Groups: with useGroups, each input geometry becomes one group whose
// materialIndex is its position in the list — the same rule three.js itself
// uses, which is what the car bodies and the people rely on (body = group 0,
// cabin = group 1; torso = 0, head = 1, arms = 2, 3).
//
// groupFn is the escape hatch for the buildings: a box carries six groups
// (px, nx, py, ny, pz, nz) and the caller remaps them, so one merged city
// mesh can have different materials for walls, roof tops and roof sides.
// Without the remap, groups past the end of the material array are skipped
// by the renderer and most of the city would simply not draw — which is why
// the buildings call mergeGeometries with a remap instead of plain useGroups.
import * as THREE from 'three';

export function mergeGeometries(geometries, useGroups = false, groupFn = null) {
  if (!geometries.length) return null;
  const first = geometries[0];
  const isIndexed = first.index !== null;
  const attrNames = Object.keys(first.attributes);

  for (let i = 0; i < geometries.length; i += 1) {
    const g = geometries[i];
    if ((g.index !== null) !== isIndexed) {
      console.error('mergeGeometries: all geometries must be indexed, or none');
      return null;
    }
    const names = Object.keys(g.attributes);
    if (names.length !== attrNames.length || !names.every((n) => attrNames.includes(n))) {
      console.error('mergeGeometries: geometries must share the same attributes');
      return null;
    }
  }

  const merged = new THREE.BufferGeometry();

  // Attributes: concatenate each attribute's array in order.
  for (const name of attrNames) {
    const itemSize = first.attributes[name].itemSize;
    let total = 0;
    for (const g of geometries) total += g.attributes[name].count;
    const ArrayType = first.attributes[name].array.constructor;
    const out = new ArrayType(total * itemSize);
    let offset = 0;
    for (const g of geometries) {
      out.set(g.attributes[name].array, offset);
      offset += g.attributes[name].array.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(out, itemSize));
  }

  // Index: rebase every index by the vertex offset of its geometry.
  let indexOffset = 0;
  if (isIndexed) {
    const mergedIndex = [];
    for (const g of geometries) {
      const idx = g.index;
      for (let i = 0; i < idx.count; i += 1) mergedIndex.push(idx.getX(i) + indexOffset);
      indexOffset += g.attributes.position.count;
    }
    merged.setIndex(mergedIndex);
  }

  // Groups.
  if (useGroups) {
    let base = 0;
    geometries.forEach((g, gi) => {
      const count = isIndexed ? g.index.count : g.attributes.position.count;
      if (groupFn) {
        // Keep the geometry's own groups, remapping their material index.
        const groups = g.groups.length ? g.groups : [{ start: 0, count, materialIndex: 0 }];
        for (let k = 0; k < groups.length; k += 1) {
          merged.addGroup(groups[k].start + base, groups[k].count, groupFn(gi, k, groups[k]));
        }
      } else {
        merged.addGroup(base, count, gi);
      }
      base += count;
    });
  }

  return merged;
}

// BoxGeometry group order (px, nx, py, ny, pz, nz) mapped to a
// [side, side, top, roof, side, side] material set.
export const BOX_FACE_MAP = [0, 0, 1, 2, 0, 0];

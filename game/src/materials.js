// Neon Harbor — material factory with a cache. The key names the material;
// the same key always returns the same instance, so the city never builds
// the same material twice. Static materials are prewarmed (compiled once)
// so the first frame does not hitch.
import * as THREE from 'three';

const cache = new Map();

function keyOf(type, color, extra) {
  return `${type}|${color}|${extra || ''}`;
}

export function lambert(color, extra) {
  const key = keyOf('lambert', color, extra);
  let mat = cache.get(key);
  if (!mat) {
    mat = new THREE.MeshLambertMaterial({ color });
    cache.set(key, mat);
  }
  return mat;
}

export function basic(color, extra) {
  const key = keyOf('basic', color, extra);
  let mat = cache.get(key);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ color });
    cache.set(key, mat);
  }
  return mat;
}

export function facade(color, texture) {
  const key = keyOf('facade', color, texture ? texture.uuid : 'plain');
  let mat = cache.get(key);
  if (!mat) {
    mat = new THREE.MeshLambertMaterial({ map: texture || null, color: texture ? 0xffffff : color });
    cache.set(key, mat);
  }
  return mat;
}

export function cacheStats() {
  return { materials: cache.size };
}

export function clearUnused() {
  // Materials here are all shared and long-lived; the cache is the point.
  // This exists so a future caller can drop it without touching callers.
  cache.clear();
}

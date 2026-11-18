// Neon Harbor — keyboard and mouse input. Held keys are read every frame;
// one-shot presses (confirm, pause, interact, punch, shoot, mute) are queued as
// bit flags and taken once by the loop, so a press between two frames is never
// lost and never counted twice. Mouse drag orbits the camera, wheel zooms it.
export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_INTERACT = 4;
export const ACTION_PUNCH = 8;
export const ACTION_SHOOT = 16;
export const ACTION_MUTE = 32;

const FWD = new Set(['KeyW', 'ArrowUp']);
const BACK = new Set(['KeyS', 'ArrowDown']);
const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);
const SPRINT = new Set(['ShiftLeft', 'ShiftRight']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const INTERACT = new Set(['KeyE']);
const PUNCH = new Set(['KeyF']);
const MUTE = new Set(['KeyM']);

export function createInput(canvas, onOrbit) {
  const held = new Set();
  let actions = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  window.addEventListener('keydown', (event) => {
    if (event.repeat) {
      if (FWD.has(event.code) || BACK.has(event.code) || LEFT.has(event.code) || RIGHT.has(event.code)) event.preventDefault();
      return;
    }
    held.add(event.code);
    if (CONFIRM.has(event.code)) actions |= ACTION_CONFIRM;
    else if (PAUSE.has(event.code)) actions |= ACTION_PAUSE;
    else if (INTERACT.has(event.code)) actions |= ACTION_INTERACT;
    else if (PUNCH.has(event.code)) actions |= ACTION_PUNCH;
    else if (MUTE.has(event.code)) actions |= ACTION_MUTE;
    if (FWD.has(event.code) || BACK.has(event.code) || LEFT.has(event.code) || RIGHT.has(event.code) || CONFIRM.has(event.code) || event.code === 'Space') {
      event.preventDefault();
    }
  });
  window.addEventListener('keyup', (event) => { held.delete(event.code); });
  window.addEventListener('blur', () => { held.clear(); dragging = false; });

  canvas.addEventListener('pointerdown', (event) => {
    if (event.button === 0) {
      actions |= ACTION_SHOOT;
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
    }
  });
  window.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    if (onOrbit) onOrbit(dx, dy);
  });
  window.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (onOrbit) onOrbit(0, 0, event.deltaY);
  }, { passive: false });

  return {
    /** Forward/back and strafe for on-foot movement. */
    move() {
      const fwd = (FWD.size && [...FWD].some((c) => held.has(c)) ? 1 : 0) - ([...BACK].some((c) => held.has(c)) ? 1 : 0);
      const strafe = ([...RIGHT].some((c) => held.has(c)) ? 1 : 0) - ([...LEFT].some((c) => held.has(c)) ? 1 : 0);
      return { fwd, strafe, sprint: [...SPRINT].some((c) => held.has(c)) };
    },
    /** Steering and throttle for driving. */
    drive() {
      const steer = ([...RIGHT].some((c) => held.has(c)) ? 1 : 0) - ([...LEFT].some((c) => held.has(c)) ? 1 : 0);
      const accel = [...FWD].some((c) => held.has(c)) ? 1 : 0;
      const brake = [...BACK].some((c) => held.has(c));
      return { steer, accel, brake };
    },
    sprint() { return [...SPRINT].some((c) => held.has(c)); },
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    clearActions() { actions = 0; },
  };
}

// Neon Harbor — keyboard and mouse input. Tracks held keys, the mouse aim point
// and click events, and lets scripted pilots inject virtual keys so the game can
// be driven headlessly for screenshots.

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.virtual = new Set(); // keys the pilot pretends to hold
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseDown = false;
    this.clicked = false; // true for one frame after a click
    this.pressed = new Set(); // keys pressed since the last frame was read
    this.lookDX = 0; // accumulated mouse movement for the orbit camera
    this.lookDY = 0;
    this.canvas = canvas;

    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.key.toLowerCase());
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase());
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
    });
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;
      this.lookDX += e.movementX || 0;
      this.lookDY += e.movementY || 0;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.mouseDown = true;
        this.clicked = true;
      }
    });
    window.addEventListener('mouseup', () => {
      this.mouseDown = false;
    });
  }

  down(...names) {
    for (const n of names) {
      if (this.keys.has(n) || this.virtual.has(n)) return true;
    }
    return false;
  }

  // True once, on the frame the key went down (real or virtual).
  wasPressed(name) {
    return this.pressed.has(name);
  }

  // Inject a one-frame key press (used by scripted pilots: E to steal a car).
  pressVirtual(name) {
    this.pressed.add(name);
  }

  // The pilot calls this every frame with the keys it wants held this frame.
  setVirtual(names) {
    this.virtual = new Set(names);
  }

  clearVirtual() {
    this.virtual.clear();
  }

  // Clear one-frame press/click events (the shot runner calls this after
  // every simulated step so a single injected press cannot repeat).
  clearPresses() {
    this.pressed.clear();
    this.clicked = false;
  }

  // Called by the main loop after each frame so one-frame events do not linger.
  endFrame() {
    this.pressed.clear();
    this.clicked = false;
    this.lookDX = 0;
    this.lookDY = 0;
  }

  get lookX() {
    return this.lookDX;
  }
}

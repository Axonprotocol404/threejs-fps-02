// DUSTLINE Sector 7 — input. Keyboard state, mouse look deltas, pointer lock,
// and edge-triggered "pressed this frame" keys (reload, buy, grenade, plant).
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseDown = false;
    this.mouseDownEdge = false;
    this.rightDown = false;
    this.locked = false;
    this.enabled = true; // false while a menu overlay owns the pointer
    this.onLockChange = null;
    this.onFirstGesture = null;
    this._gestured = false;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
      this._gesture();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      this._gesture();
      if (e.button === 0) {
        this.mouseDown = true;
        this.mouseDownEdge = true;
      }
      if (e.button === 2) this.rightDown = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.rightDown = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  _gesture() {
    if (!this._gestured) {
      this._gestured = true;
      if (this.onFirstGesture) this.onFirstGesture();
    }
  }

  requestLock() {
    if (!this.locked) {
      try {
        const p = this.canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch { /* pointer lock unavailable; mouse look stays off */ }
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code) { return this.keys.has(code); }
  wasPressed(code) { return this.pressed.has(code); }

  // Movement axes: forward -1..1, strafe -1..1.
  moveAxes() {
    let f = 0;
    let s = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) f += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) f -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) s += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) s -= 1;
    return { f, s };
  }

  // Call at the end of each rendered frame: consume per-frame edges.
  endFrame() {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseDownEdge = false;
  }
}

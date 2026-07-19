// Keyboard / mouse state with pointer lock. Edge-triggered presses are cleared
// at the end of each frame by endFrame().
export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.pressed = new Set();
    this.buttons = new Set();
    this.pressedButtons = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.pointerLocked = false;
    this.forceLocked = false; // test harness (?test=1): treat input as locked

    window.addEventListener('keydown', (e) => {
      if (this.locked() && ['Space', 'Tab', 'F3', 'F4'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.buttons.clear(); });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked()) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.locked()) return;
      this.buttons.add(e.button);
      this.pressedButtons.add(e.button);
    });
    document.addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.dom;
      if (!this.pointerLocked) { this.keys.clear(); this.buttons.clear(); }
    });
  }

  requestLock() {
    const p = this.dom.requestPointerLock();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }
  locked() { return this.pointerLocked || this.forceLocked; }
  isDown(code) { return this.keys.has(code); }
  wasPressed(code) { return this.pressed.has(code); }
  buttonDown(b) { return this.buttons.has(b); }
  buttonPressed(b) { return this.pressedButtons.has(b); }
  consumeMouse() {
    const d = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = 0; this.mouseDY = 0;
    return d;
  }
  endFrame() {
    this.pressed.clear();
    this.pressedButtons.clear();
  }
}

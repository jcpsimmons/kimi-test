// F3 overlay: fps, frame ms, worst frame, draw calls, triangles.
export class DebugOverlay {
  constructor(renderer) {
    this.renderer = renderer;
    this.el = document.createElement('div');
    this.el.id = 'debug';
    this.el.style.display = 'none';
    document.body.appendChild(this.el);
    this.visible = false;
    this.acc = 0; this.frames = 0; this.worst = 0; this.time = 0;
  }
  toggle() {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }
  frame(dt) {
    if (!this.visible) return;
    this.acc += dt; this.frames++;
    if (dt > this.worst) this.worst = dt;
    this.time += dt;
    if (this.time >= 0.25) {
      const fps = this.frames / this.acc;
      const ms = (this.acc / this.frames) * 1000;
      const worstFps = 1 / this.worst;
      const info = this.renderer.info;
      this.el.textContent =
        `${fps.toFixed(0)} fps  ${ms.toFixed(1)} ms  low ${worstFps.toFixed(0)}\n` +
        `calls ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(1)}k\n` +
        `geo ${info.memory.geometries}  tex ${info.memory.textures}`;
      this.acc = 0; this.frames = 0; this.worst = 0; this.time = 0;
    }
  }
}

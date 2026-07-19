import * as THREE from 'three';

// Pooled spark particles (single Points draw call, ring buffer) + camera shake.
const MAX = 512;

export class Effects {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.base = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.head = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.07, vertexColors: true, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.shakeAmt = 0;
    this._c = new THREE.Color();
  }

  burst(x, y, z, { n = 12, color = 0xffcc66, speed = 3, life = 0.5 } = {}) {
    this._c.setHex(color);
    for (let i = 0; i < n; i++) {
      const k = this.head;
      this.head = (this.head + 1) % MAX;
      this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const b = (Math.random() - 0.3) * Math.PI;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.vel[k * 3] = Math.cos(a) * Math.cos(b) * sp;
      this.vel[k * 3 + 1] = Math.sin(b) * sp + speed * 0.3;
      this.vel[k * 3 + 2] = Math.sin(a) * Math.cos(b) * sp;
      this.life[k] = this.maxLife[k] = life * (0.6 + Math.random() * 0.7);
      this.base[k * 3] = this._c.r; this.base[k * 3 + 1] = this._c.g; this.base[k * 3 + 2] = this._c.b;
    }
  }

  shake(a) { this.shakeAmt = Math.min(0.7, this.shakeAmt + a); }

  update(dt) {
    for (let k = 0; k < MAX; k++) {
      if (this.life[k] <= 0) {
        this.col[k * 3] = this.col[k * 3 + 1] = this.col[k * 3 + 2] = 0;
        continue;
      }
      this.life[k] -= dt;
      this.vel[k * 3 + 1] -= 9 * dt;
      this.pos[k * 3] += this.vel[k * 3] * dt;
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt;
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      if (this.pos[k * 3 + 1] < 0.02) {
        this.pos[k * 3 + 1] = 0.02;
        this.vel[k * 3 + 1] *= -0.4;
      }
      const f = Math.max(0, this.life[k] / this.maxLife[k]);
      this.col[k * 3] = this.base[k * 3] * f;
      this.col[k * 3 + 1] = this.base[k * 3 + 1] * f;
      this.col[k * 3 + 2] = this.base[k * 3 + 2] * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.shakeAmt *= Math.exp(-5.5 * dt);
  }

  applyShake(camera) {
    if (this.shakeAmt < 0.003) return;
    const s = this.shakeAmt;
    camera.position.x += (Math.random() - 0.5) * 0.14 * s;
    camera.position.y += (Math.random() - 0.5) * 0.12 * s;
    camera.rotation.z += (Math.random() - 0.5) * 0.05 * s;
  }
}

// Fog-of-war minimap on a 2D canvas: explored cells, cores, elevator,
// visible drones, and a player arrow. North-up.
export class Minimap {
  constructor(parent) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'minimap';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
  }

  reset(data) {
    this.data = data;
    this.explored = new Uint8Array(data.w * data.h);
    const scale = Math.floor(196 / Math.max(data.w, data.h));
    this.scale = Math.max(3, scale);
    this.canvas.width = data.w * this.scale;
    this.canvas.height = data.h * this.scale;
  }

  mark(px, pz) {
    const s = this.data.cell;
    const cx = Math.floor(px / s), cz = Math.floor(pz / s);
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = cx + dx, z = cz + dz;
        if (x >= 0 && z >= 0 && x < this.data.w && z < this.data.h) this.explored[z * this.data.w + x] = 1;
      }
    }
  }

  draw(px, pz, yaw, cores, elevator, drones, unlocked) {
    const { ctx, scale: k, data } = this;
    const g = ctx;
    g.fillStyle = 'rgba(4,7,12,0.85)';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    for (let cz = 0; cz < data.h; cz++) {
      for (let cx = 0; cx < data.w; cx++) {
        if (!this.explored[cz * data.w + cx]) continue;
        const v = data.grid.getCell(cx, cz);
        g.fillStyle = v === 1 ? '#3a4a63' : v === 2 ? '#1c2536' : '#141d2b';
        g.fillRect(cx * k, cz * k, k, k);
      }
    }
    const wx = (c) => (c + 0.5) * k;
    // elevator
    g.fillStyle = unlocked ? '#30ff88' : '#ff3040';
    g.fillRect(wx(data.elevator.cx) - k * 0.7, wx(data.elevator.cz) - k * 0.7, k * 1.4, k * 1.4);
    // cores
    g.fillStyle = '#35e0ff';
    for (const c of cores) {
      if (c.taken) continue;
      const x = wx(c.cx), z = wx(c.cz);
      g.beginPath();
      g.moveTo(x, z - k * 0.7);
      g.lineTo(x + k * 0.7, z);
      g.lineTo(x, z + k * 0.7);
      g.lineTo(x - k * 0.7, z);
      g.fill();
    }
    // drones (only when near/visible)
    for (const d of drones) {
      if (!d.mapVisible) continue;
      g.fillStyle = d.state === 2 ? '#ff3040' : d.state === 1 ? '#ffb43c' : '#ff7080';
      g.beginPath();
      g.arc((d.pos.x / data.cell) * k, (d.pos.z / data.cell) * k, k * 0.45, 0, 7);
      g.fill();
    }
    // player arrow
    const pxx = (px / data.cell) * k, pzz = (pz / data.cell) * k;
    g.save();
    g.translate(pxx, pzz);
    g.rotate(-yaw);
    g.fillStyle = '#e8f4ff';
    g.beginPath();
    g.moveTo(0, -k * 0.8);
    g.lineTo(k * 0.55, k * 0.6);
    g.lineTo(0, k * 0.25);
    g.lineTo(-k * 0.55, k * 0.6);
    g.closePath();
    g.fill();
    g.restore();
  }
}

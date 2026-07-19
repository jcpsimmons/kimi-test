// Pure collision/raycast/ballistic helpers on a boolean obstacle grid.
// Deliberately three-free so it can be unit-tested in Node (scripts/test-phys.mjs).
// Positions are plain { x, y, z } objects — THREE.Vector3 works too.

export class GridWorld {
  constructor(w, h, cell) {
    this.w = w; this.h = h; this.cell = cell;
    this.cells = new Uint8Array(w * h); // 0 = open, 1 = wall, 2 = rack (any non-zero solid)
  }
  inBounds(cx, cz) { return cx >= 0 && cz >= 0 && cx < this.w && cz < this.h; }
  cellIndex(cx, cz) { return cz * this.w + cx; }
  getCell(cx, cz) { return this.inBounds(cx, cz) ? this.cells[this.cellIndex(cx, cz)] : 1; }
  setCell(cx, cz, v) { if (this.inBounds(cx, cz)) this.cells[this.cellIndex(cx, cz)] = v; }
  fillRect(cx0, cz0, cx1, cz1, v) {
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) this.setCell(cx, cz, v);
  }
  solidCell(cx, cz) { return this.getCell(cx, cz) !== 0; }
  solidAt(x, z) {
    return this.solidCell(Math.floor(x / this.cell), Math.floor(z / this.cell));
  }
}

const EPS = 1e-4;

// Clamp one axis of a circle (capsule footprint / sphere) against solid cells.
function clampAxis(world, x, z, r, axis, delta) {
  if (delta === 0) return { value: axis === 'x' ? x : z, hit: false };
  const nx = axis === 'x' ? x + delta : x;
  const nz = axis === 'z' ? z + delta : z;
  const s = world.cell;
  const c0x = Math.floor((nx - r) / s), c1x = Math.floor((nx + r) / s);
  const c0z = Math.floor((nz - r) / s), c1z = Math.floor((nz + r) / s);
  let best = axis === 'x' ? nx : nz;
  let hit = false;
  for (let cz = c0z; cz <= c1z; cz++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      if (!world.solidCell(cx, cz)) continue;
      const minx = cx * s, maxx = minx + s;
      const minz = cz * s, maxz = minz + s;
      const qx = Math.max(minx, Math.min(nx, maxx));
      const qz = Math.max(minz, Math.min(nz, maxz));
      const ddx = nx - qx, ddz = nz - qz;
      if (ddx * ddx + ddz * ddz >= r * r) continue;
      hit = true;
      if (axis === 'x') {
        const cand = delta > 0 ? minx - r - EPS : maxx + r + EPS;
        best = delta > 0 ? Math.min(best, cand) : Math.max(best, cand);
      } else {
        const cand = delta > 0 ? minz - r - EPS : maxz + r + EPS;
        best = delta > 0 ? Math.min(best, cand) : Math.max(best, cand);
      }
    }
  }
  return { value: best, hit };
}

// Move a capsule's circle footprint by (dx, dz) with axis-separated clamping.
// Mutates pos {x, z}. Returns which axes were blocked.
export function moveCapsule(world, pos, r, dx, dz) {
  const rx = clampAxis(world, pos.x, pos.z, r, 'x', dx);
  pos.x = rx.value;
  const rz = clampAxis(world, pos.x, pos.z, r, 'z', dz);
  pos.z = rz.value;
  return { hitX: rx.hit, hitZ: rz.hit };
}

// Grid DDA raycast on the XZ plane. dir need not be normalized.
// Returns { hit, dist, nx, nz, cx, cz } — dist is along the ray in world units.
export function raycastGrid(world, ox, oz, dx, dz, maxDist) {
  const s = world.cell;
  const len = Math.hypot(dx, dz);
  if (len === 0 || maxDist <= 0) return { hit: false, dist: maxDist, nx: 0, nz: 0, cx: -1, cz: -1 };
  const rdx = dx / len, rdz = dz / len;
  let cx = Math.floor(ox / s), cz = Math.floor(oz / s);
  const stepX = rdx > 0 ? 1 : -1, stepZ = rdz > 0 ? 1 : -1;
  const tDeltaX = rdx !== 0 ? Math.abs(s / rdx) : Infinity;
  const tDeltaZ = rdz !== 0 ? Math.abs(s / rdz) : Infinity;
  let tMaxX = rdx !== 0 ? (rdx > 0 ? (cx + 1) * s - ox : ox - cx * s) / Math.abs(rdx) : Infinity;
  let tMaxZ = rdz !== 0 ? (rdz > 0 ? (cz + 1) * s - oz : oz - cz * s) / Math.abs(rdz) : Infinity;
  if (world.solidCell(cx, cz)) return { hit: true, dist: 0, nx: 0, nz: 0, cx, cz };
  let t = 0, nx = 0, nz = 0;
  while (t <= maxDist) {
    if (tMaxX < tMaxZ) { t = tMaxX; tMaxX += tDeltaX; cx += stepX; nx = -stepX; nz = 0; }
    else { t = tMaxZ; tMaxZ += tDeltaZ; cz += stepZ; nx = 0; nz = -stepZ; }
    if (t > maxDist) break;
    if (world.solidCell(cx, cz)) return { hit: true, dist: t, nx, nz, cx, cz };
  }
  return { hit: false, dist: maxDist, nx: 0, nz: 0, cx: -1, cz: -1 };
}

// True if a straight XZ line between two points crosses no solid cell.
export function lineOfSight(world, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const d = Math.hypot(dx, dz);
  if (d === 0) return true;
  return !raycastGrid(world, ax, az, dx, dz, d - EPS).hit;
}

// Advance a ballistic sphere one step: gravity, wall bounce (XZ), floor and
// ceiling bounce (Y). Mutates state { pos:{x,y,z}, vel:{x,y,z}, r }.
// Returns an array of impacts { type: 'wall'|'floor'|'ceiling', speed } — empty
// when quiet; used later for noise events and impact audio.
export function stepBallistic(state, world, dt, opts = {}) {
  const gravity = opts.gravity ?? 14;
  const restitution = opts.restitution ?? 0.45;
  const groundFriction = opts.groundFriction ?? 0.75;
  const wallHeight = opts.wallHeight ?? 3.2;
  const { pos, vel, r } = state;
  const impacts = [];

  vel.y -= gravity * dt;

  const speedXZ = Math.hypot(vel.x, vel.z);
  const hx = clampAxis(world, pos.x, pos.z, r, 'x', vel.x * dt);
  if (hx.hit) {
    impacts.push({ type: 'wall', speed: Math.abs(vel.x) + 0.3 * speedXZ });
    vel.x = -vel.x * restitution;
    vel.z *= 0.9;
  }
  pos.x = hx.value;
  const hz = clampAxis(world, pos.x, pos.z, r, 'z', vel.z * dt);
  if (hz.hit) {
    impacts.push({ type: 'wall', speed: Math.abs(vel.z) + 0.3 * speedXZ });
    vel.z = -vel.z * restitution;
    vel.x *= 0.9;
  }
  pos.z = hz.value;

  pos.y += vel.y * dt;
  if (pos.y < r) {
    pos.y = r;
    if (vel.y < -0.8) impacts.push({ type: 'floor', speed: -vel.y });
    vel.y = vel.y < -0.8 ? -vel.y * restitution : 0;
    vel.x *= groundFriction; vel.z *= groundFriction;
  }
  const ceil = wallHeight - r;
  if (pos.y > ceil) {
    pos.y = ceil;
    if (vel.y > 0.8) impacts.push({ type: 'ceiling', speed: vel.y });
    if (vel.y > 0) vel.y = -vel.y * restitution;
  }
  return impacts;
}

// A* on the obstacle grid, 4-directional, unit costs. Returns an array of
// { cx, cz } from start to target (inclusive), or null when unreachable.
// Grids are <= 52x52 so a linear-scan open list is plenty fast.
export function astarPath(world, sx, sz, tx, tz) {
  if (world.solidCell(sx, sz) || world.solidCell(tx, tz)) return null;
  const w = world.w, h = world.h;
  const start = sz * w + sx, target = tz * w + tx;
  const g = new Float32Array(w * h).fill(Infinity);
  const f = new Float32Array(w * h).fill(Infinity);
  const from = new Int32Array(w * h).fill(-1);
  const closed = new Uint8Array(w * h);
  g[start] = 0;
  f[start] = Math.abs(tx - sx) + Math.abs(tz - sz);
  const open = [start];
  const DIRS = [1, 0, -1, 0, 0, 1, 0, -1];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur === target) {
      const path = [];
      let n = target;
      while (n !== -1) { path.push({ cx: n % w, cz: (n / w) | 0 }); n = from[n]; }
      path.reverse();
      return path;
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % w, cz = (cur / w) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DIRS[d * 2], nz = cz + DIRS[d * 2 + 1];
      if (world.solidCell(nx, nz)) continue;
      const ni = nz * w + nx;
      if (closed[ni]) continue;
      const ng = g[cur] + 1;
      if (ng < g[ni]) {
        g[ni] = ng;
        from[ni] = cur;
        f[ni] = ng + Math.abs(tx - nx) + Math.abs(tz - nz);
        if (!open.includes(ni)) open.push(ni);
      }
    }
  }
  return null;
}

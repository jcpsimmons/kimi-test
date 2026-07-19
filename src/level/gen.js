// Procedural floor generation. Pure JS (no three) so it runs in Node for tests.
// A floor starts as solid rock; rooms and corridors are carved open, racks are
// placed along room edges, then connectivity is re-validated and any rack row
// that breaks it is rolled back. Everything flows through the seeded rng, so a
// seed fully determines the layout.

import { GridWorld, astarPath } from '../physics.js';
import { WORLD } from '../config.js';

export function cellCenter(c, cell) { return (c + 0.5) * cell; }

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function bfsDistances(grid, sx, sz) {
  const w = grid.w;
  const dist = new Int32Array(w * grid.h).fill(-1);
  const q = [sz * w + sx];
  dist[q[0]] = 0;
  for (let head = 0; head < q.length; head++) {
    const cur = q[head];
    const cx = cur % w, cz = (cur / w) | 0;
    const d = dist[cur] + 1;
    const nb = [[cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1]];
    for (const [nx, nz] of nb) {
      if (grid.solidCell(nx, nz)) continue;
      const ni = nz * w + nx;
      if (dist[ni] !== -1) continue;
      dist[ni] = d;
      q.push(ni);
    }
  }
  return dist;
}

function placeRooms(rng, W, H, target) {
  const rooms = [];
  for (let t = 0; t < 300 && rooms.length < target; t++) {
    const w = rng.int(4, 9), h = rng.int(4, 9);
    const x = rng.int(2, W - 2 - w), z = rng.int(2, H - 2 - h);
    if (rooms.some((r) => x < r.x + r.w + 1 && x + w + 1 > r.x && z < r.z + r.h + 1 && z + h + 1 > r.z)) continue;
    rooms.push({ x, z, w, h, cx: x + (w >> 1), cz: z + (h >> 1) });
  }
  return rooms;
}

function carveCorridor(grid, corridorCells, rng, a, b) {
  let x = a.cx, z = a.cz;
  const dig = (cx, cz) => {
    grid.setCell(cx, cz, 0);
    corridorCells.add(cz * grid.w + cx);
  };
  const digX = (to) => { while (x !== to) { x += Math.sign(to - x); dig(x, z); } };
  const digZ = (to) => { while (z !== to) { z += Math.sign(to - z); dig(x, z); } };
  if (rng.chance(0.5)) { digX(b.cx); digZ(b.cz); } else { digZ(b.cz); digX(b.cx); }
}

function pickElevatorCell(grid, room, dist) {
  const w = grid.w;
  let best = null;
  for (let cz = room.z; cz < room.z + room.h; cz++) {
    for (let cx = room.x; cx < room.x + room.w; cx++) {
      if (grid.getCell(cx, cz) !== 0) continue;
      const solidDirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => grid.solidCell(cx + dx, cz + dz));
      if (solidDirs.length === 0) continue;
      const score = dist[cz * w + cx] + (solidDirs.length >= 2 ? 60 : 0);
      if (!best || score > best.score) best = { cx, cz, wx: solidDirs[0][0], wz: solidDirs[0][1], score };
    }
  }
  // fallback: room center (shouldn't happen)
  return best ?? { cx: room.cx, cz: room.cz, wx: 0, wz: -1, score: 0 };
}

function pickOpenCell(grid, room, rng, margin) {
  for (let t = 0; t < 30; t++) {
    const cx = rng.int(room.x + margin, room.x + room.w - 1 - margin);
    const cz = rng.int(room.z + margin, room.z + room.h - 1 - margin);
    if (grid.getCell(cx, cz) === 0) return { cx, cz };
  }
  return { cx: room.cx, cz: room.cz };
}

function allOpenReachable(grid, sx, sz) {
  const dist = bfsDistances(grid, sx, sz);
  let reachable = 0, open = 0;
  for (let i = 0; i < grid.cells.length; i++) {
    if (grid.cells[i] === 0) {
      open++;
      if (dist[i] >= 0) reachable++;
    }
  }
  return reachable === open;
}

function placeRackRows(grid, corridorCells, reserved, rackRows, room, rng, spawn) {
  const edges = shuffle([
    { dx: 1, dz: 0, fx: room.x + 1, fz: room.z, span: room.w - 2 },                 // north
    { dx: 1, dz: 0, fx: room.x + 1, fz: room.z + room.h - 1, span: room.w - 2 },     // south
    { dx: 0, dz: 1, fx: room.x, fz: room.z + 1, span: room.h - 2 },                  // west
    { dx: 0, dz: 1, fx: room.x + room.w - 1, fz: room.z + 1, span: room.h - 2 },     // east
  ], rng);
  const rowsHere = rng.int(1, 2);
  for (const e of edges) {
    if (rackRows.filter((r) => r.room === room).length >= rowsHere) break;
    if (e.span < 2) continue;
    const len = rng.int(2, Math.min(5, e.span));
    const start = rng.int(0, e.span - len);
    const cells = [];
    for (let i = 0; i < len; i++) cells.push([e.fx + e.dx * (start + i), e.fz + e.dz * (start + i)]);
    const ok = cells.every(([cx, cz]) =>
      grid.getCell(cx, cz) === 0 && !corridorCells.has(cz * grid.w + cx) && !reserved.has(cz * grid.w + cx));
    if (!ok) continue;
    for (const [cx, cz] of cells) grid.setCell(cx, cz, 2);
    // a row may seal off a pocket (e.g. a room corner between two rows) — revert if so
    if (!allOpenReachable(grid, spawn.cx, spawn.cz)) {
      for (const [cx, cz] of cells) grid.setCell(cx, cz, 0);
      continue;
    }
    for (const [cx, cz] of cells) reserved.add(cz * grid.w + cx);
    rackRows.push(Object.assign(cells, { room }));
  }
}

export function generateFloor(rng, cfg) {
  const W = cfg.grid, H = cfg.grid;
  let grid = null, rooms = null;
  for (let attempt = 0; attempt < 50; attempt++) {
    const g = new GridWorld(W, H, WORLD.cell);
    g.cells.fill(1);
    const rs = placeRooms(rng, W, H, cfg.rooms);
    if (rs.length < Math.max(4, cfg.rooms - 2)) continue;
    for (const r of rs) g.fillRect(r.x, r.z, r.x + r.w - 1, r.z + r.h - 1, 0);
    grid = g; rooms = rs;
    break;
  }
  if (!grid) throw new Error('room placement failed');

  // corridors: randomized Prim spanning tree + a few extra loops
  const corridorCells = new Set();
  const connected = new Set([0]);
  while (connected.size < rooms.length) {
    let best = null;
    for (const i of connected) {
      for (let j = 0; j < rooms.length; j++) {
        if (connected.has(j)) continue;
        const d = Math.abs(rooms[i].cx - rooms[j].cx) + Math.abs(rooms[i].cz - rooms[j].cz) + rng.next() * 14;
        if (!best || d < best.d) best = { i, j, d };
      }
    }
    carveCorridor(grid, corridorCells, rng, rooms[best.i], rooms[best.j]);
    connected.add(best.j);
  }
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      if (rng.chance(0.10)) carveCorridor(grid, corridorCells, rng, rooms[i], rooms[j]);
    }
  }

  const spawnRoom = rooms[0];
  const spawn = { cx: spawnRoom.cx, cz: spawnRoom.cz };
  let dist = bfsDistances(grid, spawn.cx, spawn.cz);

  // elevator room: farthest reachable room from spawn
  let elevRoom = null, bestD = -1;
  for (let i = 1; i < rooms.length; i++) {
    const d = dist[rooms[i].cz * W + rooms[i].cx];
    if (d > bestD) { bestD = d; elevRoom = rooms[i]; }
  }
  const elevator = pickElevatorCell(grid, elevRoom, dist);

  // cores: one per random non-spawn, non-elevator room
  const coreRooms = shuffle(rooms.filter((r) => r !== spawnRoom && r !== elevRoom), rng);
  const cores = [];
  for (const r of coreRooms) {
    if (cores.length >= cfg.cores) break;
    cores.push(pickOpenCell(grid, r, rng, 1));
  }

  // racks along room edges, then connectivity re-validation with rollback
  const reserved = new Set([spawn, elevator, ...cores].map((c) => c.cz * W + c.cx));
  const rackRows = [];
  for (const r of rooms) placeRackRows(grid, corridorCells, reserved, rackRows, r, rng, spawn);
  for (let guard = 0; guard < 60; guard++) {
    dist = bfsDistances(grid, spawn.cx, spawn.cz);
    if ([elevator, ...cores].every((c) => dist[c.cz * W + c.cx] >= 0)) break;
    const last = rackRows.pop();
    if (!last) break;
    for (const [cx, cz] of last) if (grid.getCell(cx, cz) === 2) grid.setCell(cx, cz, 0);
  }

  // canisters: random open, unreserved cells
  const canisters = [];
  let guard = 0;
  while (canisters.length < cfg.canisters && guard++ < 400) {
    const cx = rng.int(1, W - 2), cz = rng.int(1, H - 2);
    const key = cz * W + cx;
    if (grid.getCell(cx, cz) !== 0 || reserved.has(key)) continue;
    reserved.add(key);
    canisters.push({ cx, cz });
  }

  // patrol routes through junction cells and room centers
  const junctions = [];
  for (let cz = 1; cz < H - 1; cz++) {
    for (let cx = 1; cx < W - 1; cx++) {
      if (grid.getCell(cx, cz) !== 0) continue;
      let open = 0;
      if (!grid.solidCell(cx + 1, cz)) open++;
      if (!grid.solidCell(cx - 1, cz)) open++;
      if (!grid.solidCell(cx, cz + 1)) open++;
      if (!grid.solidCell(cx, cz - 1)) open++;
      if (open >= 3) junctions.push({ cx, cz });
    }
  }
  const wps = [...junctions, ...rooms.map((r) => ({ cx: r.cx, cz: r.cz }))];
  const patrols = [];
  guard = 0;
  while (patrols.length < cfg.drones && guard++ < 80) {
    const route = [];
    let ok = true;
    for (let k = 0; k < 4; k++) {
      const p = wps[rng.int(0, wps.length - 1)];
      if (k && astarPath(grid, route[k - 1].cx, route[k - 1].cz, p.cx, p.cz) === null) { ok = false; break; }
      route.push(p);
    }
    if (ok && route.length >= 3) patrols.push(route);
  }
  while (patrols.length < cfg.drones) {
    patrols.push(patrols.length ? [...patrols[patrols.length - 1]].reverse() : [spawn, elevator, { cx: elevRoom.cx, cz: elevRoom.cz }]);
  }

  // spawn yaw: face the elevator's general direction
  const dx = elevator.cx - spawn.cx, dz = elevator.cz - spawn.cz;
  const spawnYaw = Math.atan2(-dx, -dz);

  return { grid, rooms, spawn: { ...spawn, yaw: spawnYaw }, elevator, cores, canisters, patrols, w: W, h: H, cell: WORLD.cell, corridorCells };
}

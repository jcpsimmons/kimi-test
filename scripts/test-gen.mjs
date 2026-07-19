// Node validation for procedural floor generation. Run: npm run test:gen
import { makeRng } from '../src/rng.js';
import { generateFloor } from '../src/level/gen.js';
import { FLOORS, WORLD } from '../src/config.js';

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
}

function bfsReach(grid, sx, sz) {
  const w = grid.w;
  const seen = new Uint8Array(w * grid.h);
  const q = [sz * w + sx];
  seen[q[0]] = 1;
  for (let head = 0; head < q.length; head++) {
    const cur = q[head];
    const cx = cur % w, cz = (cur / w) | 0;
    for (const [nx, nz] of [[cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1]]) {
      if (grid.solidCell(nx, nz)) continue;
      const ni = nz * w + nx;
      if (!seen[ni]) { seen[ni] = 1; q.push(ni); }
    }
  }
  return seen;
}

function fingerprint(data) {
  return JSON.stringify({
    cells: Array.from(data.grid.cells),
    cores: data.cores, elevator: data.elevator, canisters: data.canisters, patrols: data.patrols,
  });
}

let anyRacks = false;
for (let f = 0; f < FLOORS.length; f++) {
  const cfg = FLOORS[f];
  for (let seed = 1; seed <= 20; seed++) {
    const data = generateFloor(makeRng(seed * 100 + f), cfg);
    const g = data.grid;
    const tag = `F${f + 1}/seed${seed}`;

    if (g.getCell(data.spawn.cx, data.spawn.cz) !== 0) check(`${tag} spawn open`, false);
    if (g.getCell(data.elevator.cx, data.elevator.cz) !== 0) check(`${tag} elevator open`, false);
    if (data.cores.length !== cfg.cores) check(`${tag} core count`, false);
    if (data.canisters.length !== cfg.canisters) check(`${tag} canister count`, false);
    if (data.patrols.length !== cfg.drones) check(`${tag} patrol count`, false);

    const reach = bfsReach(g, data.spawn.cx, data.spawn.cz);
    const targets = [...data.cores, data.elevator, ...data.canisters, ...data.patrols.flat()];
    const unreachable = targets.filter((c) => !reach[c.cz * g.w + c.cx]);
    if (unreachable.length) check(`${tag} all targets reachable (${unreachable.length} not)`, false);

    if (data.cores.some((c) => g.getCell(c.cx, c.cz) !== 0)) check(`${tag} cores on open cells`, false);
    if (data.patrols.flat().some((c) => g.getCell(c.cx, c.cz) !== 0)) check(`${tag} waypoints on open cells`, false);

    // border must stay solid
    let borderSolid = true;
    for (let i = 0; i < g.w; i++) {
      if (!g.solidCell(i, 0) || !g.solidCell(i, g.h - 1) || !g.solidCell(0, i) || !g.solidCell(g.w - 1, i)) borderSolid = false;
    }
    if (!borderSolid) check(`${tag} border solid`, false);

    if (g.cells.includes(2)) anyRacks = true;
  }

  // determinism: same seed twice -> identical floor
  const a = generateFloor(makeRng(777 + f), cfg);
  const b = generateFloor(makeRng(777 + f), cfg);
  check(`F${f + 1} deterministic`, fingerprint(a) === fingerprint(b));

  // different seeds -> different layouts
  const c = generateFloor(makeRng(778 + f), cfg);
  check(`F${f + 1} seed-sensitive`, fingerprint(a) !== fingerprint(c));
}

check('some floors contain racks', anyRacks);

console.log(failures === 0 ? '\nAll gen tests passed.' : `\n${failures} gen test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

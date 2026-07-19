// Node smoke tests for the pure physics core. Run: npm run test:phys
import { GridWorld, moveCapsule, raycastGrid, lineOfSight, stepBallistic } from '../src/physics.js';

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
}
function approx(a, b, eps = 1e-3) { return Math.abs(a - b) <= eps; }

// World: 10x10 cells of 1 m, wall column at cx=5 full height, wall row at cz=8 (cx 0..4).
const world = new GridWorld(10, 10, 1);
world.fillRect(5, 0, 5, 9, 1);
world.fillRect(0, 8, 4, 8, 1);

check('open cell is not solid', !world.solidAt(2.5, 5.5));
check('wall cell is solid', world.solidAt(5.5, 5.5));
check('out of bounds counts solid', world.solidAt(-1, -1));

// Capsule blocked by wall (+x).
{
  const pos = { x: 4.0, z: 5.5 };
  const r = 0.35;
  const res = moveCapsule(world, pos, r, 1.0, 0);
  check('capsule clamped at wall face', approx(pos.x, 5 - r, 1e-2) && res.hitX);
}
// Slide along wall: x blocked, z free.
{
  const pos = { x: 4.0, z: 5.5 };
  const r = 0.35;
  const res = moveCapsule(world, pos, r, 1.0, 0.3);
  check('slide: x clamped, z advances', approx(pos.x, 5 - r, 1e-2) && approx(pos.z, 5.8, 1e-9) && res.hitX && !res.hitZ);
}
// Free movement in open space.
{
  const pos = { x: 2.0, z: 2.0 };
  const res = moveCapsule(world, pos, 0.35, 0.4, 0.4);
  check('open move unblocked', !res.hitX && !res.hitZ && approx(pos.x, 2.4) && approx(pos.z, 2.4));
}
// Raycast hits walls at expected distances.
{
  const hit = raycastGrid(world, 2.5, 5.5, 1, 0, 20);
  check('ray hits +x wall at 2.5 m', hit.hit && approx(hit.dist, 2.5, 1e-6) && hit.nx === -1);
  const up = raycastGrid(world, 2.5, 5.5, 0, 1, 20);
  check('ray hits +z wall at 2.5 m', up.hit && approx(up.dist, 2.5, 1e-6) && up.nz === -1);
  const miss = raycastGrid(world, 2.5, 2.5, -1, 0, 1.0);
  check('ray beyond maxDist misses', !miss.hit);
}
// LOS.
check('LOS blocked through wall', !lineOfSight(world, 2.5, 5.5, 8.5, 5.5));
check('LOS clear in open', lineOfSight(world, 1.5, 1.5, 3.5, 3.5));

// Ballistic: sphere settles on the floor.
{
  const s = { pos: { x: 2.5, y: 1.0, z: 2.5 }, vel: { x: 0, y: 0, z: 0 }, r: 0.15 };
  for (let i = 0; i < 600; i++) stepBallistic(s, world, 1 / 60, { gravity: 14, restitution: 0.45 });
  check('sphere settles at rest height', approx(s.pos.y, 0.15, 1e-2) && Math.abs(s.vel.y) < 0.1);
}
// Ballistic: wall bounce reverses x velocity, never penetrates.
{
  const s = { pos: { x: 4.0, y: 0.5, z: 5.5 }, vel: { x: 5, y: 0, z: 0 }, r: 0.15 };
  let bounced = false, maxX = 0;
  for (let i = 0; i < 240; i++) {
    stepBallistic(s, world, 1 / 60, { gravity: 14, restitution: 0.45 });
    if (s.vel.x < 0) bounced = true;
    maxX = Math.max(maxX, s.pos.x);
  }
  check('sphere bounced off wall', bounced);
  check('sphere never penetrated wall', maxX <= 5 - 0.15 + 1e-3);
}

console.log(failures === 0 ? '\nAll physics tests passed.' : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

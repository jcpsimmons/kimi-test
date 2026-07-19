import * as THREE from 'three';
import { WORLD } from '../config.js';
import { astarPath } from '../physics.js';
import { cellCenter } from './gen.js';

// Builds all static level geometry from generated floor data: floor/ceiling,
// walls (3 texture variants), base glow strips, wall conduits, ceiling beams,
// light fixtures with fake volumetric shafts, detailed server racks with
// blinking LEDs, cable trays, wayfinding arrows and drifting dust.
// Returns { group, update } — update drives animated materials only.
export function buildLevel(data, mats, rng) {
  const { grid } = data;
  const s = data.cell;
  const wh = WORLD.wallHeight;
  const group = new THREE.Group();
  const tmp = new THREE.Object3D();
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // the wall cell behind the elevator is replaced by the elevator alcove
  const exX = data.elevator.cx + data.elevator.wx;
  const exZ = data.elevator.cz + data.elevator.wz;

  // ---- floor & ceiling ----------------------------------------------------
  const sizeX = data.w * s, sizeZ = data.h * s;
  mats.floor.map.repeat.set(data.w / 2, data.h / 2);
  mats.floor.normalMap.repeat.set(data.w / 2, data.h / 2);
  mats.floor.roughnessMap.repeat.set(data.w / 2, data.h / 2);
  mats.ceiling.map.repeat.set(data.w / 2, data.h / 2);
  const plane = new THREE.PlaneGeometry(sizeX, sizeZ);
  const floor = new THREE.Mesh(plane, mats.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(sizeX / 2, 0, sizeZ / 2);
  const ceil = new THREE.Mesh(plane, mats.ceiling);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(sizeX / 2, wh, sizeZ / 2);
  group.add(floor, ceil);

  // ---- categorize cells ---------------------------------------------------
  const wallVariants = [[], [], []];
  const rackCells = [];
  for (let cz = 0; cz < data.h; cz++) {
    for (let cx = 0; cx < data.w; cx++) {
      const v = grid.getCell(cx, cz);
      if (v === 1) {
        if (cx === exX && cz === exZ) continue;
        wallVariants[(cx * 7 + cz * 13) % 3].push([cx, cz]);
      } else if (v === 2) rackCells.push([cx, cz]);
    }
  }

  // ---- walls: one InstancedMesh per texture variant -----------------------
  const wallGeo = new THREE.BoxGeometry(s, wh, s);
  wallVariants.forEach((cells, vi) => {
    if (!cells.length) return;
    const mesh = new THREE.InstancedMesh(wallGeo, mats.walls[vi], cells.length);
    cells.forEach(([cx, cz], i) => {
      tmp.position.set(cellCenter(cx, s), wh / 2, cellCenter(cz, s));
      tmp.rotation.set(0, 0, 0);
      tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix);
    });
    group.add(mesh);
  });

  // ---- wall-adjacent features: base glow strips + conduits ----------------
  // a "face" is a solid cell side bordering an open cell
  const faces = [];
  for (let cz = 0; cz < data.h; cz++) {
    for (let cx = 0; cx < data.w; cx++) {
      if (!grid.solidCell(cx, cz)) continue;
      if (cx === exX && cz === exZ) continue;
      for (const [dx, dz] of DIRS) {
        if (grid.getCell(cx + dx, cz + dz) === 0) faces.push([cx, cz, dx, dz]);
      }
    }
  }
  const stripMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(s, 0.06, 0.03), mats.baseStrip, faces.length);
  const conduitMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(s, 0.07, 0.07), mats.conduit, faces.length * 2);
  faces.forEach(([cx, cz, dx, dz], i) => {
    const fx = cellCenter(cx, s) + dx * (s / 2 + 0.02);
    const fz = cellCenter(cz, s) + dz * (s / 2 + 0.02);
    const along = dx !== 0 ? Math.PI / 2 : 0; // face runs along z when normal is x
    tmp.rotation.set(0, along, 0);
    tmp.position.set(fx, 0.05, fz);
    tmp.updateMatrix();
    stripMesh.setMatrixAt(i, tmp.matrix);
    tmp.position.set(fx, 2.68, fz);
    tmp.updateMatrix();
    conduitMesh.setMatrixAt(i * 2, tmp.matrix);
    tmp.position.set(fx, 2.84, fz);
    tmp.updateMatrix();
    conduitMesh.setMatrixAt(i * 2 + 1, tmp.matrix);
  });
  group.add(stripMesh, conduitMesh);

  // ---- ceiling beams -------------------------------------------------------
  const beams = [];
  for (let cz = 1; cz < data.h - 1; cz++) {
    for (let cx = 1; cx < data.w - 1; cx++) {
      if (grid.getCell(cx, cz) !== 0) continue;
      if (cx % 4 === 0) beams.push([cx, cz, Math.PI / 2]);
      else if (cz % 4 === 0) beams.push([cx, cz, 0]);
    }
  }
  const beamMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(s, 0.22, 0.16), mats.beam, beams.length);
  beams.forEach(([cx, cz, rot], i) => {
    tmp.position.set(cellCenter(cx, s), wh - 0.12, cellCenter(cz, s));
    tmp.rotation.set(0, rot, 0);
    tmp.updateMatrix();
    beamMesh.setMatrixAt(i, tmp.matrix);
  });
  group.add(beamMesh);

  // ---- light fixtures + volumetric shafts ---------------------------------
  const lightCells = [];
  for (let cz = 1; cz < data.h - 1; cz++) {
    for (let cx = 1; cx < data.w - 1; cx++) {
      if (grid.getCell(cx, cz) !== 0) continue;
      if ((cx + cz * 2) % 5 !== 0) continue;
      lightCells.push([cx, cz]);
    }
  }
  const housing = new THREE.InstancedMesh(new THREE.BoxGeometry(1.7, 0.1, 0.8), mats.fixture, lightCells.length);
  const diffuser = new THREE.InstancedMesh(new THREE.BoxGeometry(1.3, 0.05, 0.55), mats.diffuser, lightCells.length);
  const shaftGeo = new THREE.ConeGeometry(0.85, 2.8, 18, 1, true);
  const shafts = new THREE.InstancedMesh(shaftGeo, mats.shaft, lightCells.length);
  const tint = new THREE.Color();
  lightCells.forEach(([cx, cz], i) => {
    const x = cellCenter(cx, s), z = cellCenter(cz, s);
    tmp.rotation.set(0, 0, 0);
    tmp.position.set(x, wh - 0.06, z);
    tmp.updateMatrix();
    housing.setMatrixAt(i, tmp.matrix);
    tmp.position.set(x, wh - 0.115, z);
    tmp.updateMatrix();
    diffuser.setMatrixAt(i, tmp.matrix);
    tint.setHSL(0.58 + rng.next() * 0.04, 0.25, 0.75 + rng.next() * 0.1);
    diffuser.setColorAt(i, tint);
    tmp.position.set(x, wh - 0.1 - 1.4, z);
    tmp.updateMatrix();
    shafts.setMatrixAt(i, tmp.matrix);
  });
  group.add(housing, diffuser, shafts);

  // ---- server racks ---------------------------------------------------------
  const rackRows = [];
  {
    const seen = new Set();
    for (const [cx, cz] of rackCells) {
      const key = cz * data.w + cx;
      if (seen.has(key)) continue;
      const alongX = grid.getCell(cx + 1, cz) === 2 || grid.getCell(cx - 1, cz) === 2;
      const run = [];
      if (alongX) {
        let x0 = cx;
        while (grid.getCell(x0 - 1, cz) === 2) x0--;
        for (let x = x0; grid.getCell(x, cz) === 2; x++) { run.push([x, cz]); seen.add(cz * data.w + x); }
      } else {
        let z0 = cz;
        while (grid.getCell(cx, z0 - 1) === 2) z0--;
        for (let z = z0; grid.getCell(cx, z) === 2; z++) { run.push([cx, z]); seen.add(z * data.w + cx); }
      }
      rackRows.push({ run, alongX });
    }
  }
  const frameGeo = new THREE.BoxGeometry(2.42, WORLD.rackHeight, 0.52);
  const frames = new THREE.InstancedMesh(frameGeo, mats.rackFrame, rackCells.length);
  const bladeGeo = new THREE.BoxGeometry(2.2, 0.24, 0.03);
  const blades = new THREE.InstancedMesh(bladeGeo, mats.rackBlade, rackCells.length * 6);
  const ledGeo = new THREE.BoxGeometry(0.05, 0.05, 0.02);
  const leds = new THREE.InstancedMesh(ledGeo, mats.led, rackCells.length * 8);
  const blink = new Float32Array(rackCells.length * 8);
  const ledColors = [new THREE.Color(0x35e0ff), new THREE.Color(0x2aff8a), new THREE.Color(0xffa030), new THREE.Color(0xff4050)];
  const rackObj = new THREE.Object3D();
  const part = new THREE.Object3D();
  let bi = 0, li = 0;
  rackCells.forEach(([cx, cz], i) => {
    const x = cellCenter(cx, s), z = cellCenter(cz, s);
    // front = first open neighbor direction
    let fx = 0, fz = 1;
    for (const [dx, dz] of DIRS) {
      if (grid.getCell(cx + dx, cz + dz) === 0) { fx = dx; fz = dz; break; }
    }
    const yaw = Math.atan2(fx, fz);
    rackObj.position.set(x, WORLD.rackHeight / 2, z);
    rackObj.rotation.set(0, yaw, 0);
    rackObj.updateMatrix();
    frames.setMatrixAt(i, rackObj.matrix);
    for (let b = 0; b < 6; b++) {
      part.position.set(0, -WORLD.rackHeight / 2 + 0.28 + b * 0.27, 0.27 + (rng.next() - 0.5) * 0.02);
      part.rotation.set(0, 0, 0);
      part.updateMatrix();
      part.matrix.premultiply(rackObj.matrix);
      blades.setMatrixAt(bi, part.matrix);
      const g = 0.13 + rng.next() * 0.12;
      blades.setColorAt(bi, new THREE.Color(g, g * 1.1, g * 1.35));
      bi++;
    }
    for (let l = 0; l < 8; l++) {
      part.position.set(-1.05, -WORLD.rackHeight / 2 + 0.3 + l * 0.19, 0.28);
      part.rotation.set(0, 0, 0);
      part.updateMatrix();
      part.matrix.premultiply(rackObj.matrix);
      leds.setMatrixAt(li, part.matrix);
      leds.setColorAt(li, ledColors[rng.int(0, ledColors.length - 1)]);
      blink[li] = rng.next() * 4;
      li++;
    }
  });
  ledGeo.setAttribute('blink', new THREE.InstancedBufferAttribute(blink, 1));
  group.add(frames, blades, leds);

  // cable trays over rack runs
  const trayGeoX = new THREE.BoxGeometry(1, 0.07, 0.34);
  const trays = new THREE.InstancedMesh(trayGeoX, mats.conduit, rackRows.length);
  rackRows.forEach(({ run, alongX }, i) => {
    const mid = run[Math.floor(run.length / 2)];
    tmp.position.set(cellCenter(mid[0], s), WORLD.rackHeight + 0.05, cellCenter(mid[1], s));
    tmp.rotation.set(0, alongX ? 0 : Math.PI / 2, 0);
    tmp.scale.set(run.length * s, 1, 1);
    tmp.updateMatrix();
    trays.setMatrixAt(i, tmp.matrix);
  });
  tmp.scale.set(1, 1, 1);
  group.add(trays);

  // ---- wayfinding decals: arrows along the spawn→elevator path --------------
  const path = astarPath(grid, data.spawn.cx, data.spawn.cz, data.elevator.cx, data.elevator.cz) ?? [];
  const arrowCells = [];
  for (let i = 4; i < path.length - 2; i += 5) {
    const dx = path[i + 1].cx - path[i].cx, dz = path[i + 1].cz - path[i].cz;
    if (dx === 0 && dz === 0) continue;
    arrowCells.push([path[i].cx, path[i].cz, Math.atan2(-dx, -dz)]);
  }
  const arrowGeo = new THREE.PlaneGeometry(1.0, 1.0);
  const arrows = new THREE.InstancedMesh(arrowGeo, mats.arrowDecal, arrowCells.length);
  arrowCells.forEach(([cx, cz, yaw], i) => {
    tmp.position.set(cellCenter(cx, s), 0.015, cellCenter(cz, s));
    tmp.rotation.order = 'YXZ';
    tmp.rotation.set(-Math.PI / 2, yaw, 0);
    tmp.updateMatrix();
    arrows.setMatrixAt(i, tmp.matrix);
  });
  tmp.rotation.order = 'XYZ';
  group.add(arrows);
  // hazard chevron in front of the elevator
  const chev = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.55), mats.chevron);
  chev.rotation.order = 'YXZ';
  chev.rotation.set(-Math.PI / 2, Math.atan2(-(-data.elevator.wx), -(-data.elevator.wz)), 0);
  chev.position.set(cellCenter(data.elevator.cx, s) - data.elevator.wx * 0.9, 0.015, cellCenter(data.elevator.cz, s) - data.elevator.wz * 0.9);
  group.add(chev);

  // ---- dust motes -----------------------------------------------------------
  const DUST = 700;
  const dustPos = new Float32Array(DUST * 3);
  const dustPhase = new Float32Array(DUST);
  const openCells = [];
  for (let cz = 1; cz < data.h - 1; cz++) for (let cx = 1; cx < data.w - 1; cx++) {
    if (grid.getCell(cx, cz) === 0) openCells.push([cx, cz]);
  }
  for (let i = 0; i < DUST; i++) {
    const [cx, cz] = openCells[rng.int(0, openCells.length - 1)];
    dustPos[i * 3] = cx * s + rng.next() * s;
    dustPos[i * 3 + 1] = rng.next() * (wh - 0.3);
    dustPos[i * 3 + 2] = cz * s + rng.next() * s;
    dustPhase[i] = rng.next() * 10;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  dustGeo.setAttribute('phase', new THREE.BufferAttribute(dustPhase, 1));
  const dust = new THREE.Points(dustGeo, mats.dust);
  dust.frustumCulled = false;
  group.add(dust);

  function update(dt, t) {
    mats.led.uniforms.uTime.value = t;
    mats.shaft.uniforms.uTime.value = t;
    mats.dust.uniforms.uTime.value = t;
    mats.baseStrip.emissiveIntensity = 1.8 + Math.sin(t * 1.7) * 0.3;
    mats.diffuser.emissiveIntensity = 1.9 + Math.sin(t * 11.3) * 0.06 + Math.sin(t * 37.7) * 0.03;
  }

  return { group, update, lightCells };
}

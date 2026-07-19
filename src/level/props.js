import * as THREE from 'three';
import { GAME, WORLD } from '../config.js';
import { cellCenter } from './gen.js';

// Data cores: holographic icosahedrons on pedestals, collected by proximity.
export class CoreField {
  constructor(parent, cores, data, mats, rng) {
    this.cores = cores.map((c) => {
      const x = cellCenter(c.cx, data.cell), z = cellCenter(c.cz, data.cell);
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.1, 20), mats.rackFrame);
      ped.position.y = 0.05;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.02, 8, 24), mats.baseStrip);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.11;
      const holoMat = mats.holoBase.clone();
      holoMat.userData.owned = true;
      holoMat.uniforms.uPhase.value = rng.next() * 10;
      const holo = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 1), holoMat);
      holo.position.y = 1.15;
      const innerMat = new THREE.MeshBasicMaterial({ color: 0xaff4ff });
      innerMat.userData.owned = true;
      const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 1), innerMat);
      inner.position.y = 1.15;
      const spriteMat = new THREE.SpriteMaterial({
        map: mats.glowSprite, color: 0x35e0ff, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55,
      });
      spriteMat.userData.owned = true;
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.setScalar(1.2);
      sprite.position.y = 1.15;
      g.add(ped, ring, holo, inner, sprite);
      parent.add(g);
      return { x, z, cx: c.cx, cz: c.cz, group: g, holo, inner, holoMat, taken: false, phase: rng.next() * 7 };
    });
    this.remaining = this.cores.length;
  }
  update(dt, t) {
    for (const c of this.cores) {
      if (c.taken) continue;
      c.holo.rotation.y += dt * 0.9;
      c.inner.rotation.y -= dt * 1.4;
      const bob = Math.sin(t * 1.4 + c.phase) * 0.07;
      c.holo.position.y = 1.15 + bob;
      c.inner.position.y = 1.15 + bob;
      c.holoMat.uniforms.uTime.value = t;
    }
  }
  collectAt(x, z, r) {
    for (const c of this.cores) {
      if (c.taken) continue;
      if (Math.hypot(c.x - x, c.z - z) <= r) {
        c.taken = true;
        c.group.visible = false;
        this.remaining--;
        return c;
      }
    }
    return null;
  }
}

// Freight elevator: alcove with sliding doors, state-colored frame glow and a
// sign. Unlocks when all cores are collected; opens when the player is near.
export class Elevator {
  constructor(parent, e, data, mats) {
    const s = data.cell;
    this.x = cellCenter(e.cx, s);
    this.z = cellCenter(e.cz, s);
    this.unlocked = false;
    this.open = 0;
    // structure faces away from its wall, into the room
    const yaw = Math.atan2(-e.wx, -e.wz);
    const g = new THREE.Group();
    g.position.set(this.x, 0, this.z);
    g.rotation.y = yaw;
    const pillarG = new THREE.BoxGeometry(0.24, WORLD.wallHeight, 0.5);
    const pL = new THREE.Mesh(pillarG, mats.conduit);
    pL.position.set(-1.3, WORLD.wallHeight / 2, -0.4);
    const pR = new THREE.Mesh(pillarG, mats.conduit);
    pR.position.set(1.3, WORLD.wallHeight / 2, -0.4);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.84, 0.5, 0.5), mats.conduit);
    lintel.position.set(0, WORLD.wallHeight - 0.25, -0.4);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.5), mats.sign);
    sign.position.set(0, WORLD.wallHeight - 0.72, -0.13);
    const doorG = new THREE.BoxGeometry(1.15, 2.9, 0.09);
    this.doorL = new THREE.Mesh(doorG, mats.door);
    this.doorL.position.set(-0.58, 1.45, -0.42);
    this.doorR = new THREE.Mesh(doorG, mats.door);
    this.doorR.position.set(0.58, 1.45, -0.42);
    const interiorMat = new THREE.MeshStandardMaterial({ color: 0x05070c, metalness: 0.3, roughness: 0.9 });
    interiorMat.userData.owned = true;
    const interior = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.0, 1.2), interiorMat);
    interior.position.set(0, 1.5, -1.05);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.04, 1.1), mats.baseStrip);
    pad.position.set(0, 0.02, -0.55);
    this.glowMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff3040, emissiveIntensity: 1.8 });
    this.glowMat.userData.owned = true;
    const stripG = new THREE.BoxGeometry(0.06, 2.9, 0.06);
    const sL = new THREE.Mesh(stripG, this.glowMat);
    sL.position.set(-1.16, 1.45, -0.15);
    const sR = new THREE.Mesh(stripG, this.glowMat);
    sR.position.set(1.16, 1.45, -0.15);
    g.add(pL, pR, lintel, sign, this.doorL, this.doorR, interior, pad, sL, sR);
    parent.add(g);
    this.group = g;
  }
  setUnlocked(v) {
    this.unlocked = v;
    this.glowMat.emissive.setHex(v ? 0x30ff88 : 0xff3040);
  }
  update(dt, t, playerDist) {
    const target = this.unlocked && playerDist < 2.4 ? 1 : 0;
    this.open += (target - this.open) * (1 - Math.exp(-4 * dt));
    this.doorL.position.x = -0.58 - this.open * 1.08;
    this.doorR.position.x = 0.58 + this.open * 1.08;
    this.glowMat.emissiveIntensity = this.unlocked
      ? 2.2 + Math.sin(t * 4) * 0.7
      : 1.6 + Math.sin(t * 1.5) * 0.4;
  }
  inRange(x, z) {
    return Math.hypot(this.x - x, this.z - z) <= GAME.elevatorRange;
  }
}

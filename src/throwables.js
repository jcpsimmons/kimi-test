import * as THREE from 'three';
import { THROW, WORLD, GAME } from './config.js';
import { stepBallistic } from './physics.js';
import { cellCenter } from './level/gen.js';

// Power canisters: scattered pickups (max carry 3), thrown with LMB. Impacts
// publish noise events that pull drones into ALERT; a fast direct hit stuns.
// Re-hitting an already-stunned drone resets its stun timer (no early wake).
export class Throwables {
  constructor(parent, world, mats) {
    this.world = world;
    this.slots = [];
    const bodyG = new THREE.CapsuleGeometry(0.09, 0.2, 4, 10);
    const ringG = new THREE.TorusGeometry(0.1, 0.02, 6, 16);
    for (let i = 0; i < THROW.poolSize; i++) {
      const grp = new THREE.Group();
      grp.add(new THREE.Mesh(bodyG, mats.canister));
      const ring = new THREE.Mesh(ringG, mats.canisterRing);
      ring.rotation.x = Math.PI / 2;
      grp.add(ring);
      grp.visible = false;
      parent.add(grp);
      this.slots.push({
        state: 'free', mesh: grp,
        pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, r: THROW.radius,
        restT: 0, spin: 0,
      });
    }
  }

  populate(cells, data, rng) {
    for (const s of this.slots) { s.state = 'free'; s.mesh.visible = false; }
    cells.forEach((c, i) => {
      const s = this.slots[i];
      if (!s) return;
      s.state = 'world';
      s.pos = { x: cellCenter(c.cx, data.cell) + (rng.next() - 0.5) * 0.8, y: THROW.radius, z: cellCenter(c.cz, data.cell) + (rng.next() - 0.5) * 0.8 };
      s.vel = { x: 0, y: 0, z: 0 };
      s.restT = 0;
      s.mesh.visible = true;
      s.mesh.position.set(s.pos.x, s.pos.y, s.pos.z);
      s.mesh.rotation.set(Math.PI / 2, 0, rng.next() * 3);
    });
  }

  get carried() {
    return this.slots.filter((s) => s.state === 'carried').length;
  }

  nearestPickup(px, pz) {
    let best = null, bd = Infinity;
    for (const s of this.slots) {
      if (s.state !== 'world' && s.state !== 'rest') continue;
      const d = Math.hypot(s.pos.x - px, s.pos.z - pz);
      if (d < bd) { bd = d; best = s; }
    }
    return bd <= GAME.canisterRange ? best : null;
  }

  tryPickup(px, pz) {
    if (this.carried >= THROW.maxCarry) return false;
    const s = this.nearestPickup(px, pz);
    if (!s) return false;
    s.state = 'carried';
    s.mesh.visible = false;
    return true;
  }

  throwFrom(camera) {
    if (this.carried === 0) return false;
    const s = this.slots.find((x) => x.state === 'carried');
    s.state = 'flying';
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.y += THROW.upBias;
    dir.normalize();
    s.pos = {
      x: camera.position.x + dir.x * 0.4,
      y: camera.position.y - 0.12 + dir.y * 0.4,
      z: camera.position.z + dir.z * 0.4,
    };
    s.vel = { x: dir.x * THROW.speed, y: dir.y * THROW.speed, z: dir.z * THROW.speed };
    s.restT = 0;
    s.mesh.visible = true;
    s.spin = 12;
    return true;
  }

  update(dt, ctx) {
    // ctx: { noise, drones, effects, audio }
    for (const s of this.slots) {
      if (s.state !== 'flying') continue;
      const impacts = stepBallistic(s, this.world, dt, {
        gravity: THROW.gravity, restitution: THROW.restitution,
        groundFriction: THROW.groundFriction, wallHeight: WORLD.wallHeight,
      });
      const speed = Math.hypot(s.vel.x, s.vel.y, s.vel.z);
      if (speed > THROW.stunMinSpeed) {
        for (const d of ctx.drones) {
          const dd = Math.hypot(d.pos.x - s.pos.x, d.pos.y - s.pos.y, d.pos.z - s.pos.z);
          if (dd < 0.55) {
            d.stun();
            ctx.effects.burst(s.pos.x, s.pos.y, s.pos.z, { n: 26, color: 0x9fefff, speed: 4, life: 0.6 });
            ctx.audio?.play('stun');
            d.pos.x += s.vel.x * 0.03;
            d.pos.z += s.vel.z * 0.03;
            s.vel.x *= -0.3;
            s.vel.z *= -0.3;
            s.vel.y = Math.abs(s.vel.y) * 0.4 + 1.5;
            break;
          }
        }
      }
      for (const im of impacts) {
        if (im.speed < 1.2) continue;
        ctx.noise.push({ x: s.pos.x, z: s.pos.z, radius: THROW.noiseRadius });
        ctx.audio?.play('clank');
        ctx.effects.burst(s.pos.x, s.pos.y, s.pos.z, { n: 5, color: 0xffcf7a, speed: 1.6, life: 0.3 });
      }
      if (speed < 0.4 && s.pos.y <= s.r + 0.01) {
        s.restT += dt;
        if (s.restT > 0.4) {
          s.state = 'rest';
          s.mesh.rotation.set(Math.PI / 2, 0, Math.random() * 3);
        }
      } else s.restT = 0;
      s.mesh.position.set(s.pos.x, s.pos.y, s.pos.z);
      if (s.state === 'flying') {
        s.mesh.rotation.x += s.spin * dt;
        s.mesh.rotation.z += s.spin * 0.7 * dt;
      }
    }
  }
}

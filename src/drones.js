import * as THREE from 'three';
import { DRONE, PLAYER, TAUNT } from './config.js';
import { astarPath, lineOfSight } from './physics.js';
import { cellCenter } from './level/gen.js';

// Security drones. State machine: PATROL (waypoint loop) -> ALERT (investigate
// noise / last-seen point) -> CHASE (active pursuit + zap) and STUNNED (timed
// disable with sparks). Detection = view cone + range + grid line of sight,
// plus a small 360-degree proximity sense.

export const STATE = { PATROL: 0, ALERT: 1, CHASE: 2, STUNNED: 3 };
const STATE_COLOR = [0x35e0ff, 0xffb43c, 0xff3040, 0x5a6472];

class Drone {
  constructor(parent, route, data, mats, rng, cfg) {
    this.cfg = cfg;
    this.route = route.map((c) => ({ x: cellCenter(c.cx, data.cell), z: cellCenter(c.cz, data.cell) }));
    this.wp = rng.int(0, this.route.length - 1);
    this.pos = new THREE.Vector3(this.route[this.wp].x, DRONE.hover, this.route[this.wp].z);
    this.yaw = rng.next() * Math.PI * 2;
    this.state = STATE.PATROL;
    this.stateT = 0;
    this.path = null;
    this.pathI = 0;
    this.repathT = 0;
    this.memoryT = 0;
    this.zapT = 0;
    this.stunT = 0;
    this.tauntT = 0;
    this.arrived = false;
    this.speedNow = 0;
    this.investigate = { x: 0, z: 0 };
    this.lastSeen = { x: 0, z: 0 };
    this.phase = rng.next() * 10;

    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 24, 16), mats.droneBody);
    body.scale.set(1, 0.72, 1);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mats.droneBody);
    dome.position.y = 0.2;
    this.eyeMat = new THREE.MeshBasicMaterial({ color: STATE_COLOR[0] });
    this.eyeMat.userData.owned = true;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10), this.eyeMat);
    eye.position.set(0, 0, -0.27);
    const lensRing = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.02, 8, 20), mats.conduit);
    lensRing.position.set(0, 0, -0.28);
    this.ringMat = new THREE.MeshBasicMaterial({ color: STATE_COLOR[0], transparent: true, opacity: 0.7 });
    this.ringMat.userData.owned = true;
    const ringG = new THREE.TorusGeometry(0.14, 0.015, 6, 24);
    this.ringL = new THREE.Mesh(ringG, this.ringMat);
    this.ringL.position.set(-0.38, -0.05, 0);
    this.ringL.rotation.y = Math.PI / 2;
    this.ringR = new THREE.Mesh(ringG, this.ringMat);
    this.ringR.position.set(0.38, -0.05, 0);
    this.ringR.rotation.y = Math.PI / 2;
    this.coneMat = new THREE.MeshBasicMaterial({
      color: STATE_COLOR[0], transparent: true, opacity: 0.09,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.coneMat.userData.owned = true;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.15, 3.4, 20, 1, true), this.coneMat);
    cone.rotation.x = -Math.PI / 2 - 0.35;
    cone.position.set(0, -0.5, -1.9);
    this.glowMat = new THREE.SpriteMaterial({
      map: mats.glowSprite, color: STATE_COLOR[0], transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5,
    });
    this.glowMat.userData.owned = true;
    const glow = new THREE.Sprite(this.glowMat);
    glow.scale.setScalar(1.1);
    glow.position.y = -0.15;
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 2 * 6), 3));
    this.arcs = new THREE.LineSegments(arcGeo, new THREE.LineBasicMaterial({ color: 0x9fefff, transparent: true, opacity: 0.9 }));
    this.arcs.visible = false;
    this.arcs.frustumCulled = false;
    g.add(body, dome, eye, lensRing, this.ringL, this.ringR, cone, glow, this.arcs);
    g.position.copy(this.pos);
    parent.add(g);
    this.group = g;
    this.arcT = 0;
  }

  setState(hex) {
    this.eyeMat.color.setHex(hex);
    this.ringMat.color.setHex(hex);
    this.coneMat.color.setHex(hex);
    this.glowMat.color.setHex(hex);
  }

  seesPlayer(world, px, pz) {
    const dx = px - this.pos.x, dz = pz - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > this.cfg.viewRange) return false;
    if (d > DRONE.proximity) {
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      if ((dx / d) * fx + (dz / d) * fz < DRONE.viewCos) return false;
    }
    return lineOfSight(world, this.pos.x, this.pos.z, px, pz);
  }

  repathTo(world, cx, cz) {
    const sx = Math.floor(this.pos.x / world.cell), sz = Math.floor(this.pos.z / world.cell);
    this.path = astarPath(world, sx, sz, cx, cz);
    this.pathI = 1;
  }

  moveToward(tx, tz, speed, dt) {
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.25) return true;
    const step = Math.min(speed * dt, d);
    this.pos.x += (dx / d) * step;
    this.pos.z += (dz / d) * step;
    this.speedNow = speed;
    return false;
  }

  followPath(world, speed, dt) {
    if (!this.path || this.pathI >= this.path.length) return true;
    const c = this.path[this.pathI];
    const arrived = this.moveToward(cellCenter(c.cx, world.cell), cellCenter(c.cz, world.cell), speed, dt);
    if (arrived) this.pathI++;
    return this.pathI >= this.path.length;
  }

  faceToward(tx, tz, dt, rate) {
    const target = Math.atan2(-(tx - this.pos.x), -(tz - this.pos.z));
    let diff = target - this.yaw;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    this.yaw += diff * Math.min(1, rate * dt);
  }

  toChase(ctx) {
    if (this.state !== STATE.CHASE) ctx.audio?.play('alert');
    this.state = STATE.CHASE;
    this.memoryT = 0;
    this.repathT = 0;
    this.setState(STATE_COLOR[STATE.CHASE]);
    ctx.onTaunt?.(this);
    this.tauntT = TAUNT.reTaunt;
  }

  toAlert(x, z) {
    this.state = STATE.ALERT;
    this.investigate.x = x;
    this.investigate.z = z;
    this.stateT = 0;
    this.arrived = false;
    this.repathT = 0;
    this.setState(STATE_COLOR[STATE.ALERT]);
  }

  toPatrol() {
    this.state = STATE.PATROL;
    this.setState(STATE_COLOR[STATE.PATROL]);
    let best = 0, bd = Infinity;
    this.route.forEach((p, i) => {
      const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
      if (d < bd) { bd = d; best = i; }
    });
    this.wp = best;
  }

  stun() {
    // already down: a re-hit just refreshes the knockout timer
    if (this.state === STATE.STUNNED) { this.stunT = DRONE.stunTime; return; }
    this.state = STATE.STUNNED;
    this.stunT = DRONE.stunTime;
    this.arcs.visible = true;
    this.setState(STATE_COLOR[STATE.STUNNED]);
  }

  hearNoise(ctx) {
    for (const n of ctx.noise) {
      if (Math.hypot(n.x - this.pos.x, n.z - this.pos.z) < n.radius) return n;
    }
    return null;
  }

  jitterArcs() {
    const p = this.arcs.geometry.attributes.position;
    for (let i = 0; i < 6; i++) {
      p.setXYZ(i * 2, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.5);
      p.setXYZ(i * 2 + 1, (Math.random() - 0.5) * 0.5, -0.3 - Math.random() * 0.3, (Math.random() - 0.5) * 0.5);
    }
    p.needsUpdate = true;
  }

  update(dt, ctx) {
    const { world, player } = ctx;
    this.zapT = Math.max(0, this.zapT - dt);
    const px = player.pos.x, pz = player.pos.z;
    const distP = Math.hypot(px - this.pos.x, pz - this.pos.z);
    const seen = this.state !== STATE.STUNNED && this.seesPlayer(world, px, pz);
    this.speedNow = 0;

    switch (this.state) {
      case STATE.PATROL: {
        if (seen) { this.toChase(ctx); break; }
        const n = this.hearNoise(ctx);
        if (n) { this.toAlert(n.x, n.z); break; }
        const wp = this.route[this.wp % this.route.length]; // wp can outlive a replaced route
        if (this.moveToward(wp.x, wp.z, this.cfg.patrol, dt)) this.wp = (this.wp + 1) % this.route.length;
        this.faceToward(wp.x, wp.z, dt, 4);
        break;
      }
      case STATE.ALERT: {
        if (seen) { this.toChase(ctx); break; }
        if (!this.arrived) {
          this.repathT -= dt;
          if (this.repathT <= 0) {
            this.repathTo(world, Math.floor(this.investigate.x / world.cell), Math.floor(this.investigate.z / world.cell));
            this.repathT = DRONE.repath;
          }
          this.arrived = this.followPath(world, this.cfg.patrol * 1.4, dt);
          this.faceToward(this.investigate.x, this.investigate.z, dt, 5);
        } else {
          this.yaw += dt * 1.8; // scan the area
          this.stateT += dt;
          if (this.stateT > DRONE.alertTime) this.toPatrol();
        }
        break;
      }
      case STATE.CHASE: {
        if (seen) {
          this.lastSeen.x = px;
          this.lastSeen.z = pz;
          this.memoryT = 0;
        } else {
          this.memoryT += dt;
          if (this.memoryT > DRONE.loseSight) { this.toAlert(this.lastSeen.x, this.lastSeen.z); break; }
        }
        this.repathT -= dt;
        if (this.repathT <= 0) {
          this.repathTo(world, Math.floor(this.lastSeen.x / world.cell), Math.floor(this.lastSeen.z / world.cell));
          this.repathT = DRONE.repath;
        }
        if (seen && distP < 3.5) this.moveToward(px, pz, this.cfg.chase, dt);
        else this.followPath(world, this.cfg.chase, dt);
        this.faceToward(px, pz, dt, 10);
        if (distP < DRONE.zapRange && this.zapT === 0 && seen) {
          this.zapT = DRONE.zapCooldown;
          ctx.onZap(this);
        }
        this.tauntT -= dt;
        if (this.tauntT <= 0) { // periodic re-taunt while chasing
          this.tauntT = TAUNT.reTaunt;
          ctx.onTaunt?.(this);
        }
        break;
      }
      case STATE.STUNNED: {
        this.stunT -= dt;
        this.arcT -= dt;
        if (this.arcT <= 0) {
          this.arcT = 0.12;
          this.jitterArcs();
          ctx.effects.burst(this.pos.x, this.pos.y, this.pos.z, { n: 6, color: 0x9fefff, speed: 1.6, life: 0.35 });
          ctx.audio?.play('stunCrackle');
        }
        if (this.stunT <= 0) {
          this.arcs.visible = false;
          this.toPatrol();
        }
        break;
      }
    }

    // separation (n <= 6, cheap)
    for (const o of ctx.drones) {
      if (o === this || o.state === STATE.STUNNED) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.001 && d < 0.9) {
        this.pos.x += (dx / d) * (0.9 - d) * 0.5;
        this.pos.z += (dz / d) * (0.9 - d) * 0.5;
      }
    }

    // player body separation (drone yields, every state — stunned is still rigid)
    const pd = Math.hypot(this.pos.x - px, this.pos.z - pz);
    const bodyMin = PLAYER.radius + DRONE.radius;
    if (pd < bodyMin) {
      const ux = pd > 0.001 ? (this.pos.x - px) / pd : 1;
      const uz = pd > 0.001 ? (this.pos.z - pz) / pd : 0;
      this.pos.x = px + ux * bodyMin;
      this.pos.z = pz + uz * bodyMin;
    }

    // visuals
    const stunned = this.state === STATE.STUNNED;
    const targetY = stunned ? 0.55 : DRONE.hover + Math.sin(ctx.t * 2 + this.phase) * 0.05;
    this.pos.y += (targetY - this.pos.y) * Math.min(1, 3 * dt);
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    this.group.rotation.x = stunned ? 0.3 : -Math.min(0.18, this.speedNow * 0.03);
    this.group.rotation.z = stunned ? 0.35 : 0;
    this.ringL.rotation.x += dt * 22;
    this.ringR.rotation.x -= dt * 22;
  }
}

export class DroneManager {
  constructor(parent, data, mats, rng, cfg) {
    this.drones = data.patrols.map((route) => new Drone(parent, route, data, mats, rng, cfg));
  }
  get anyChasing() {
    return this.drones.some((d) => d.state === STATE.CHASE);
  }
  update(dt, ctx) {
    ctx.drones = this.drones;
    for (const d of this.drones) d.update(dt, ctx);
  }
}

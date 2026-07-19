import * as THREE from 'three';
import { PLAYER, RENDER } from './config.js';
import { moveCapsule } from './physics.js';

const PITCH_LIMIT = 1.55; // ~89 deg

// First-person kinematic capsule controller: WASD, mouse look, sprint, jump
// with coyote time + input buffer, head bob, sprint FOV kick, health.
export class Player {
  constructor(camera, world, spawn) {
    this.camera = camera;
    this.world = world;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.health = PLAYER.maxHealth;
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = true;
    this.coyote = 0;
    this.jumpBuf = 0;
    this.bobPhase = 0;
    this.bobY = 0;
    this.stepPulse = false;  // footstep this frame (audio/noise hook)
    this.landed = false;     // landed this frame
    this.jumped = false;     // jumped this frame
    this.sprintingNow = false;
    camera.rotation.order = 'YXZ';
    this.reset(spawn);
  }

  reset(spawn) {
    this.pos.set(spawn.x, 0, spawn.z);
    this.vel.set(0, 0, 0);
    this.yaw = spawn.yaw ?? 0;
    this.pitch = 0;
    this.health = PLAYER.maxHealth;
    this.onGround = true;
    this.bobY = 0;
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }

  // returns true when the hit is lethal
  damage(amount, kx, kz) {
    this.health -= amount;
    this.vel.x += kx * PLAYER.zapKnockback;
    this.vel.z += kz * PLAYER.zapKnockback;
    return this.health <= 0;
  }

  heal(n) {
    this.health = Math.min(PLAYER.maxHealth, this.health + n);
  }

  update(dt, input) {
    this.jumped = false;
    const mouse = input.consumeMouse();
    this.yaw -= mouse.x * PLAYER.mouseSens;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - mouse.y * PLAYER.mouseSens));

    let ix = 0, iz = 0;
    if (input.isDown('KeyW')) iz += 1;
    if (input.isDown('KeyS')) iz -= 1;
    if (input.isDown('KeyA')) ix -= 1;
    if (input.isDown('KeyD')) ix += 1;
    const il = Math.hypot(ix, iz) || 1;
    ix /= il; iz /= il;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = -sin * iz + cos * ix;
    const wz = -cos * iz - sin * ix;

    this.sprintingNow = (input.isDown('ShiftLeft') || input.isDown('ShiftRight')) && iz > 0;
    const target = PLAYER.walkSpeed * (this.sprintingNow ? PLAYER.sprintMul : 1);
    const accel = this.onGround ? PLAYER.groundAccel : PLAYER.airAccel;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (wx * target - this.vel.x) * k;
    this.vel.z += (wz * target - this.vel.z) * k;

    this.coyote = this.onGround ? PLAYER.coyoteTime : Math.max(0, this.coyote - dt);
    if (input.wasPressed('Space')) this.jumpBuf = PLAYER.jumpBuffer;
    else this.jumpBuf = Math.max(0, this.jumpBuf - dt);
    if (this.jumpBuf > 0 && this.coyote > 0) {
      this.vel.y = PLAYER.jumpVel;
      this.coyote = 0;
      this.jumpBuf = 0;
      this.onGround = false;
      this.jumped = true;
    }
    this.vel.y -= PLAYER.gravity * dt;

    moveCapsule(this.world, this.pos, PLAYER.radius, this.vel.x * dt, this.vel.z * dt);
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= 0) {
      if (!this.onGround && this.vel.y < -3) this.landed = true;
      this.pos.y = 0;
      this.vel.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    const hSpeed = this.speed;
    this.stepPulse = false;
    if (this.onGround && hSpeed > 0.5) {
      const prev = Math.sin(this.bobPhase);
      this.bobPhase += dt * PLAYER.bobFreq * (hSpeed / PLAYER.walkSpeed);
      const cur = Math.sin(this.bobPhase);
      if (prev >= 0 && cur < 0) this.stepPulse = true;
      this.bobY = Math.abs(cur) * PLAYER.bobAmp * Math.min(1, hSpeed / PLAYER.walkSpeed);
    } else {
      this.bobY *= Math.exp(-10 * dt);
    }

    this.camera.position.set(this.pos.x, this.pos.y + PLAYER.eyeHeight + this.bobY, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, Math.sin(this.bobPhase) * 0.004);

    const targetFov = this.sprintingNow && hSpeed > PLAYER.walkSpeed * 1.05 ? RENDER.sprintFov : RENDER.fov;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-8 * dt));
      this.camera.updateProjectionMatrix();
    }
  }
}

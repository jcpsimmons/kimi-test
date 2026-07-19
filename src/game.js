import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RENDER, STEP, PLAYER, DRONE, GAME, FLOORS, TAUNT } from './config.js';
import TAUNTS from './taunts.json';
import { makeRng, randomSeed, seedFromUrl } from './rng.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { makeMaterials } from './materials.js';
import { buildLevel } from './level/builder.js';
import { generateFloor, cellCenter } from './level/gen.js';
import { CoreField, Elevator } from './level/props.js';
import { DroneManager } from './drones.js';
import { Throwables } from './throwables.js';
import { Effects } from './effects.js';
import { AudioEngine } from './audio.js';
import { HUD } from './hud.js';
import { Minimap } from './minimap.js';
import { createPost } from './post.js';
import { DebugOverlay } from './debug.js';

const NULL_INPUT = {
  isDown: () => false, wasPressed: () => false,
  buttonPressed: () => false, buttonDown: () => false,
  consumeMouse: () => ({ x: 0, y: 0 }), pointerLocked: true,
};

function disposeGroup(group) {
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    const m = obj.material;
    if (m && m.userData?.owned) m.dispose();
  });
}

export class Game {
  constructor(container) {
    this.params = new URLSearchParams(location.search);
    this.seed = seedFromUrl() ?? randomSeed();
    this.floorIndex = 0;
    this.state = 'title';
    this.t = 0;
    this.runTime = 0;
    this.stats = { hits: 0, cores: 0 };
    this.tauntBag = [];             // shuffled index bag — every taunt once before any repeat
    this.pendingTaunt = null;
    this.lastTauntShownAt = -Infinity;
    this.lastTaunt = null;
    this.shot = this.params.get('shot');
    this.noPost = this.params.get('post') === '0';
    this.testMode = this.params.get('test') === '1';

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = RENDER.exposure;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(RENDER.clearColor);
    scene.fog = new THREE.Fog(RENDER.fogColor, RENDER.fogNear, RENDER.fogFar);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(RENDER.fov, window.innerWidth / window.innerHeight, RENDER.near, RENDER.far);
    scene.add(this.camera);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    scene.add(new THREE.HemisphereLight(0x8fa3c7, 0x0a0d14, 0.22));
    this.lamp = new THREE.SpotLight(0xcfe6ff, 42, 30, 0.62, 0.55, 1.4);
    this.lamp.position.set(0.1, -0.1, 0);
    this.lamp.target.position.set(0, -0.15, -1);
    this.camera.add(this.lamp, this.lamp.target);

    this.mats = makeMaterials(makeRng(this.seed));
    this.input = new Input(renderer.domElement);
    if (this.testMode) {
      this.input.forceLocked = true;
      // test mode has no title overlay to click — init audio on any first click
      document.addEventListener('mousedown', () => this.startFromTitle(), { once: true });
    }
    this.hud = new HUD();
    this.audio = new AudioEngine();
    this.effects = new Effects(scene);
    this.minimap = new Minimap(this.hud.mapParent);
    this.post = createPost(renderer, scene, this.camera);
    this.overlay = new DebugOverlay(renderer);

    this.hud.setSeed(this.seed);
    this.hud.onTitleClick(() => this.startFromTitle());

    this.buildFloor();
    if (this.shot) this.setupShot(this.shot);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      this.post.setSize(window.innerWidth, window.innerHeight);
    });

    this.acc = 0;
    this.last = performance.now();
    // per-frame draw-call totals across all composer passes (harness/debug)
    this.renderer.info.autoReset = false;
    this.frameStats = { calls: 0, tris: 0 };
    window.__cb = this;
  }

  locked() { return this.input.locked() || !!this.shot; }

  startFromTitle() {
    this.audio.init();
    this.audio.resume();
    this.input.requestLock();
  }

  buildFloor() {
    if (this.levelGroup) {
      this.scene.remove(this.levelGroup);
      disposeGroup(this.levelGroup);
    }
    const rng = makeRng((this.seed + this.floorIndex * 0x9e3779b9) >>> 0);
    const cfg = FLOORS[this.floorIndex];
    const data = generateFloor(rng, cfg);
    this.data = data;
    this.world = data.grid;

    this.levelGroup = new THREE.Group();
    this.scene.add(this.levelGroup);
    this.level = buildLevel(data, this.mats, rng);
    this.levelGroup.add(this.level.group);
    this.cores = new CoreField(this.levelGroup, data.cores, data, this.mats, rng);
    this.elevator = new Elevator(this.levelGroup, data.elevator, data, this.mats);
    this.drones = new DroneManager(this.levelGroup, data, this.mats, rng, cfg);
    this.throwables = new Throwables(this.levelGroup, data.grid, this.mats);
    this.throwables.populate(data.canisters, data, rng);

    this.timer = cfg.timer;
    this.collected = 0;
    this.elevatorUnlocked = false;
    this.noise = [];
    this.alarmWas = false;
    this.tauntBag = [];
    this.pendingTaunt = null;
    this.lastTauntShownAt = -Infinity;
    this.lastTaunt = null;

    const spawn = {
      x: cellCenter(data.spawn.cx, data.cell),
      z: cellCenter(data.spawn.cz, data.cell),
      yaw: data.spawn.yaw,
    };
    if (!this.player) this.player = new Player(this.camera, this.world, spawn);
    else { this.player.world = this.world; this.player.reset(spawn); }

    this.minimap.reset(data);
    this.hud.resetFloor(this.floorIndex, FLOORS.length, cfg);
    this.hud.setHealth(this.player.health, PLAYER.maxHealth);
    this.hud.setCanisters(0);
  }

  // ---- state transitions ---------------------------------------------------

  floorClear() {
    this.state = 'clear';
    this.clearT = 2.2;
    this.stats.cores += this.collected;
    this.audio.play('elevator');
    this.audio.setAlarm(false);
    this.audio.setChase(false);
    this.hud.setChase(false);
    this.player.heal(GAME.floorClearHeal);
    this.hud.setHealth(this.player.health, PLAYER.maxHealth);
    this.hud.showClear(this.floorIndex);
  }

  advanceFloor() {
    this.floorIndex++;
    if (this.floorIndex >= FLOORS.length) return this.win();
    this.buildFloor();
    this.state = 'playing';
    this.hud.hideScreens();
    this.hud.startPlaying();
    this.audio.play('clear');
  }

  win() {
    this.state = 'win';
    document.exitPointerLock?.();
    this.audio.play('win');
    this.hud.showWin({ cores: this.stats.cores, time: this.fmtTime(this.runTime), hits: this.stats.hits });
  }

  lose(reason) {
    this.state = 'lose';
    document.exitPointerLock?.();
    this.audio.play('lose');
    this.audio.setAlarm(false);
    this.audio.setChase(false);
    this.hud.setChase(false);
    this.hud.showLose(reason, {
      floor: this.floorIndex + 1,
      cores: this.stats.cores + this.collected,
      time: this.fmtTime(this.runTime),
    });
  }

  restart(newSeed) {
    if (newSeed) {
      this.seed = randomSeed();
      this.hud.setSeed(this.seed);
    }
    this.floorIndex = 0;
    this.runTime = 0;
    this.stats = { hits: 0, cores: 0 };
    this.audio.setAlarm(false);
    this.audio.setChase(false);
    this.hud.setChase(false);
    this.buildFloor();
    this.hud.hideScreens();
    if (this.input.pointerLocked) {
      this.state = 'playing';
      this.hud.startPlaying();
    } else {
      this.state = 'title';
      this.hud.showTitle(true);
    }
  }

  fmtTime(s) {
    const m = Math.floor(s / 60);
    return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }

  // ---- per-frame -----------------------------------------------------------

  start() {
    this.renderer.setAnimationLoop(() => this.frame());
  }

  onZap(d) {
    if (this.shot) return;
    const dx = this.player.pos.x - d.pos.x, dz = this.player.pos.z - d.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    this.stats.hits++;
    const died = this.player.damage(DRONE.zapDamage, dx / len, dz / len);
    this.hud.setHealth(this.player.health, PLAYER.maxHealth);
    this.hud.damageFlash();
    this.effects.shake(0.5);
    this.effects.burst(this.player.pos.x, 1.4, this.player.pos.z, { n: 14, color: 0xff5060, speed: 2.5, life: 0.4 });
    this.audio.play('zap');
    if (died) this.lose('destroyed');
  }

  step(dt, input) {
    this.t += dt;
    if (!this.shot) this.runTime += dt;
    const p = this.player;
    p.update(dt, input);

    // movement audio + noise
    if (p.stepPulse) {
      this.audio.play('step', { loud: p.sprintingNow });
      this.noise.push({ x: p.pos.x, z: p.pos.z, radius: p.sprintingNow ? DRONE.noiseSprint : DRONE.noiseWalk });
    }
    if (p.jumped) this.audio.play('jump');
    if (p.landed) { this.audio.play('land'); p.landed = false; }

    // canisters
    if (this.throwables.tryPickup(p.pos.x, p.pos.z)) {
      this.audio.play('pickup');
      this.hud.setCanisters(this.throwables.carried);
    }
    if (input.buttonPressed(0) && this.throwables.throwFrom(this.camera)) {
      this.audio.play('throw');
      this.hud.setCanisters(this.throwables.carried);
    }
    this.throwables.update(dt, {
      noise: this.noise, drones: this.drones.drones,
      effects: this.effects, audio: this.audio,
    });

    // cores
    const got = this.cores.collectAt(p.pos.x, p.pos.z, GAME.coreRange);
    if (got) {
      this.collected++;
      this.audio.play('core');
      this.hud.setCores(this.collected, this.data.cores.length);
      this.effects.burst(got.x, 1.15, got.z, { n: 30, color: 0x6ff3ff, speed: 3.5, life: 0.7 });
      if (this.cores.remaining === 0) {
        this.elevatorUnlocked = true;
        this.elevator.setUnlocked(true);
        this.audio.play('unlock');
      }
    }

    // drones
    this.drones.update(dt, {
      world: this.world, player: p, noise: this.noise,
      effects: this.effects, audio: this.audio, t: this.t,
      onZap: (d) => this.onZap(d),
      onTaunt: (d) => { this.pendingTaunt = d; }, // latest request wins — no queue buildup
    });
    if (this.pendingTaunt) {
      if (this.t - this.lastTauntShownAt >= TAUNT.minGap) {
        if (this.tauntBag.length === 0) {
          this.tauntBag = TAUNTS.map((_, i) => i);
          for (let i = this.tauntBag.length - 1; i > 0; i--) { // Fisher–Yates
            const j = Math.floor(Math.random() * (i + 1));
            [this.tauntBag[i], this.tauntBag[j]] = [this.tauntBag[j], this.tauntBag[i]];
          }
        }
        const text = TAUNTS[this.tauntBag.pop()];
        this.hud.showTaunt(text);
        this.lastTaunt = text;
        this.lastTauntShownAt = this.t;
      }
      this.pendingTaunt = null; // shown or dropped as stale, either way
    }
    this.noise.length = 0;

    // elevator + prompts
    const pd = Math.hypot(this.elevator.x - p.pos.x, this.elevator.z - p.pos.z);
    this.elevator.update(dt, this.t, pd);
    if (pd < GAME.elevatorRange) {
      if (this.elevatorUnlocked) {
        this.hud.prompt('E — ENTER FREIGHT ELEVATOR');
        if (input.wasPressed('KeyE')) return this.floorClear();
      } else {
        this.hud.prompt(`LOCKED — ${this.cores.remaining} CORE${this.cores.remaining > 1 ? 'S' : ''} REMAINING`);
      }
    } else this.hud.prompt(null);

    // lockdown timer
    if (!this.shot) {
      this.timer -= dt;
      this.hud.setTimer(this.timer);
      const alarm = this.timer < 30;
      if (alarm !== this.alarmWas) {
        this.alarmWas = alarm;
        this.audio.setAlarm(alarm);
      }
      if (this.timer <= 0) return this.lose('lockdown');
    }

    // minimap
    this.minimap.mark(p.pos.x, p.pos.z);
    for (const d of this.drones.drones) {
      d.mapVisible = Math.hypot(d.pos.x - p.pos.x, d.pos.z - p.pos.z) < 10;
    }
    this.minimap.draw(p.pos.x, p.pos.z, p.yaw, this.cores.cores, this.data.elevator, this.drones.drones, this.elevatorUnlocked);

    // audio ambience
    this.audio.update(dt, p.pos, this.drones.drones);
    this.audio.setChase(this.drones.anyChasing);
    this.hud.setChase(this.drones.anyChasing);

    // animated materials + effects
    this.level.update(dt, this.t);
    this.cores.update(dt, this.t);
    this.effects.update(dt);
  }

  frame() {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    this.renderer.info.reset();

    if (this.input.wasPressed('F3')) this.overlay.toggle();
    if (this.input.wasPressed('KeyM')) this.audio.toggleMute();
    if (this.input.wasPressed('KeyR') && this.state !== 'title') this.restart(false);
    if (this.input.wasPressed('KeyN') && (this.state === 'win' || this.state === 'lose')) this.restart(true);

    if (this.state === 'title' && this.locked()) {
      this.state = 'playing';
      this.hud.startPlaying();
    }

    if (this.state === 'playing' && this.locked()) {
      this.hud.startPlaying();
      const input = this.shot ? NULL_INPUT : this.input;
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 3) {
        this.step(STEP, input);
        this.acc -= STEP;
        steps++;
        if (this.state !== 'playing') break;
      }
      if (steps === 3) this.acc = 0;
      this.effects.applyShake(this.camera);
      this.lamp.intensity = 42 + Math.sin(this.t * 13) * 1.2;
    } else if (this.state === 'clear') {
      this.clearT -= dt;
      this.level.update(dt, this.t);
      this.cores.update(dt, this.t);
      this.effects.update(dt);
      if (this.clearT <= 0) this.advanceFloor();
    } else if ((this.state === 'title' || this.state === 'playing') && !this.locked()) {
      // also covers losing pointer lock mid-game: show the overlay to re-lock
      this.hud.showTitle(true);
    }

    this.input.endFrame();
    if (this.noPost) this.renderer.render(this.scene, this.camera);
    else this.post.composer.render();
    this.frameStats.calls = this.renderer.info.render.calls;
    this.frameStats.tris = this.renderer.info.render.triangles;
    this.overlay.frame(dt);
  }

  // ---- headless screenshot / inspection poses (?shot=…) ---------------------

  setupShot(name) {
    this.state = 'playing';
    this.hud.showTitle(false);
    this.hud.startPlaying();
    const data = this.data;
    const cw = (c) => cellCenter(c, data.cell);
    const face = (tx, tz) => Math.atan2(-(tx - this.player.pos.x), -(tz - this.player.pos.z));
    const place = (x, z, yaw) => { this.player.pos.set(x, 0, z); this.player.yaw = yaw; };

    if (name === 'core') {
      let best = null, bd = Infinity;
      for (const c of data.cores) {
        const d = Math.hypot(c.cx - data.spawn.cx, c.cz - data.spawn.cz);
        if (d < bd) { bd = d; best = c; }
      }
      const x = cw(best.cx), z = cw(best.cz);
      place(x + 1.8, z + 1.8, 0);
      this.player.yaw = face(x, z);
    } else if (name === 'drone' || name === 'chase') {
      const d = this.drones.drones[0];
      const fx = -Math.sin(this.player.yaw), fz = -Math.cos(this.player.yaw);
      d.pos.set(this.player.pos.x + fx * 4.5, DRONE.hover, this.player.pos.z + fz * 4.5);
      d.yaw = this.player.yaw + Math.PI;
      if (name === 'chase') d.toChase({ audio: null });
      else d.route = [{ x: d.pos.x, z: d.pos.z }]; // pin it in view for the shot
    } else if (name === 'elevator') {
      const e = data.elevator;
      const x = cw(e.cx) - e.wx * 2.0, z = cw(e.cz) - e.wz * 2.0;
      place(x, z, 0);
      this.player.yaw = face(cw(e.cx), cw(e.cz));
      this.elevatorUnlocked = true;
      this.elevator.setUnlocked(true);
    } else if (name === 'canister') {
      const c = data.canisters[0];
      const x = cw(c.cx), z = cw(c.cz);
      place(x + 1.6, z + 1.6, 0);
      this.player.yaw = face(x, z);
    } else if (name === 'hud') {
      this.timer = 24;
      this.hud.setTimer(24);
      this.hud.setCores(1, this.data.cores.length);
      this.hud.setHealth(68, PLAYER.maxHealth);
      this.hud.setCanisters(2);
    }
    // 'corridor' (default spawn view) needs nothing
  }
}

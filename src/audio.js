// Fully synthesized audio: SFX, ambient bed, per-drone proximity hums, chase
// pulse and lockdown alarm — zero audio files, raw Web Audio API.
// init() must be called from a user gesture (the title-screen click).

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.muted = false;
    this.hums = [];
    this.clankT = 8;
    this.alarmOn = false;
    this.alarmT = 0;
    this.alarmHigh = false;
  }

  init() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.comp = this.ctx.createDynamicsCompressor();
      this.master.connect(this.comp);
      this.comp.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.startAmbient();
      this.enabled = true;
    } catch (e) {
      this.ctx = null;
    }
  }

  resume() { this.ctx?.resume?.(); }

  toggleMute() {
    if (!this.ctx) return;
    this.muted = !this.muted;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  osc({ type = 'sine', f = 440, f2 = null, t = 0, dur = 0.2, g = 0.2, a = 0.005 }) {
    if (!this.enabled) return;
    const c = this.ctx, now = c.currentTime + t;
    const o = c.createOscillator(), gn = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, now);
    if (f2 !== null) o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), now + dur);
    gn.gain.setValueAtTime(0, now);
    gn.gain.linearRampToValueAtTime(g, now + a);
    gn.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(gn);
    gn.connect(this.master);
    o.start(now);
    o.stop(now + dur + 0.05);
  }

  noise({ t = 0, dur = 0.15, g = 0.2, type = 'bandpass', f = 1200, f2 = null, q = 1, a = 0.003 }) {
    if (!this.enabled) return;
    const c = this.ctx, now = c.currentTime + t;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const fl = c.createBiquadFilter();
    fl.type = type;
    fl.frequency.setValueAtTime(f, now);
    fl.Q.value = q;
    if (f2 !== null) fl.frequency.exponentialRampToValueAtTime(Math.max(10, f2), now + dur);
    const gn = c.createGain();
    gn.gain.setValueAtTime(0, now);
    gn.gain.linearRampToValueAtTime(g, now + a);
    gn.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(fl);
    fl.connect(gn);
    gn.connect(this.master);
    src.start(now);
    src.stop(now + dur + 0.05);
  }

  play(name, opts = {}) {
    if (!this.enabled) return;
    switch (name) {
      case 'step':
        this.noise({ dur: 0.07, g: opts.loud ? 0.09 : 0.045, f: 650 + Math.random() * 300, q: 0.8 });
        break;
      case 'jump':
        this.noise({ dur: 0.18, g: 0.07, f: 500, f2: 1800, q: 1.5 });
        break;
      case 'land':
        this.osc({ type: 'sine', f: 90, f2: 45, dur: 0.15, g: 0.16 });
        this.noise({ dur: 0.08, g: 0.06, f: 300 });
        break;
      case 'pickup':
        this.osc({ type: 'square', f: 660, dur: 0.05, g: 0.05 });
        this.osc({ type: 'square', f: 990, t: 0.05, dur: 0.07, g: 0.045 });
        break;
      case 'throw':
        this.noise({ dur: 0.22, g: 0.09, f: 900, f2: 2600, q: 2 });
        break;
      case 'clank':
        this.osc({ type: 'square', f: 1180, f2: 700, dur: 0.09, g: 0.06 });
        this.osc({ type: 'square', f: 1730, f2: 1150, dur: 0.13, g: 0.045 });
        this.noise({ dur: 0.05, g: 0.08, f: 3200, q: 0.7 });
        break;
      case 'core':
        [523, 659, 784, 1047].forEach((f, i) => this.osc({ type: 'sine', f, t: i * 0.07, dur: 0.25, g: 0.08 }));
        break;
      case 'zap':
        this.osc({ type: 'sawtooth', f: 220, f2: 60, dur: 0.22, g: 0.15 });
        this.noise({ dur: 0.15, g: 0.11, f: 4000, q: 0.5 });
        break;
      case 'stun':
        this.osc({ type: 'square', f: 800, f2: 90, dur: 0.4, g: 0.11 });
        this.noise({ dur: 0.3, g: 0.07, f: 2500, f2: 300 });
        break;
      case 'stunCrackle':
        this.noise({ dur: 0.05, g: 0.035, f: 3600, q: 0.6 });
        break;
      case 'alert':
        this.osc({ type: 'square', f: 740, dur: 0.09, g: 0.07 });
        this.osc({ type: 'square', f: 988, t: 0.1, dur: 0.14, g: 0.07 });
        break;
      case 'unlock':
        [392, 523, 659].forEach((f, i) => this.osc({ type: 'triangle', f, t: i * 0.09, dur: 0.3, g: 0.09 }));
        break;
      case 'elevator':
        this.osc({ type: 'sine', f: 140, f2: 420, dur: 0.8, g: 0.11 });
        this.noise({ dur: 0.7, g: 0.05, f: 600, f2: 2000, q: 1 });
        break;
      case 'clear':
        [659, 880].forEach((f, i) => this.osc({ type: 'triangle', f, t: i * 0.1, dur: 0.35, g: 0.09 }));
        break;
      case 'win':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.osc({ type: 'triangle', f, t: i * 0.12, dur: 0.5, g: 0.09 }));
        break;
      case 'lose':
        this.osc({ type: 'sawtooth', f: 220, f2: 55, dur: 1.2, g: 0.13 });
        this.osc({ type: 'sawtooth', f: 233, f2: 58, dur: 1.2, g: 0.11 });
        break;
    }
  }

  startAmbient() {
    const c = this.ctx;
    // brown-noise room tone
    const len = c.sampleRate * 4;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3;
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 160;
    const g = c.createGain();
    g.gain.value = 0.14;
    src.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    src.start();
    // mains hum
    const hum = c.createOscillator();
    hum.type = 'sine';
    hum.frequency.value = 50;
    const hg = c.createGain();
    hg.gain.value = 0.022;
    hum.connect(hg);
    hg.connect(this.master);
    hum.start();
    // chase pulse: 55 Hz square, gated by an LFO, faded in on demand
    const p = c.createOscillator();
    p.type = 'square';
    p.frequency.value = 55;
    const depth = c.createGain();
    depth.gain.value = 0.5;
    const lfo = c.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 4;
    const lg = c.createGain();
    lg.gain.value = 0.5;
    lfo.connect(lg);
    lg.connect(depth.gain);
    this.chaseGain = c.createGain();
    this.chaseGain.gain.value = 0;
    p.connect(depth);
    depth.connect(this.chaseGain);
    this.chaseGain.connect(this.master);
    p.start();
    lfo.start();
  }

  setChase(on) {
    if (this.enabled && this.chaseGain) {
      this.chaseGain.gain.setTargetAtTime(on ? 0.09 : 0, this.ctx.currentTime, 0.4);
    }
  }

  setAlarm(on) { this.alarmOn = on; }

  update(dt, playerPos, drones) {
    if (!this.enabled) return;
    drones.forEach((d, i) => {
      if (!this.hums[i]) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = 78 + i * 9;
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 380;
        const g = this.ctx.createGain();
        g.gain.value = 0;
        o.connect(f);
        f.connect(g);
        g.connect(this.master);
        o.start();
        this.hums[i] = { g };
      }
      const dist = Math.hypot(d.pos.x - playerPos.x, d.pos.z - playerPos.z);
      const target = d.state === 3 ? 0 : Math.max(0, 1 - dist / 15) * 0.1;
      this.hums[i].g.gain.setTargetAtTime(target, this.ctx.currentTime, 0.15);
    });
    // silence hums left over from a floor with more drones
    for (let i = drones.length; i < this.hums.length; i++) {
      this.hums[i].g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    }
    // occasional distant clank
    this.clankT -= dt;
    if (this.clankT <= 0) {
      this.clankT = 9 + Math.random() * 14;
      this.osc({ type: 'square', f: 300 + Math.random() * 500, f2: 120, dur: 0.3, g: 0.018 });
    }
    // lockdown alarm
    if (this.alarmOn) {
      this.alarmT -= dt;
      if (this.alarmT <= 0) {
        this.alarmT = 0.5;
        this.alarmHigh = !this.alarmHigh;
        this.osc({ type: 'square', f: this.alarmHigh ? 620 : 466, dur: 0.42, g: 0.045 });
      }
    }
  }
}

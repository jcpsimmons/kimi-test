// DOM HUD: health, cores, timer, canister pips, prompts, vignette, screens.
// All widgets are built here; index.html only provides #app and #ui roots.

function el(tag, id, parent, text) {
  const e = document.createElement(tag);
  if (id) e.id = id;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

export class HUD {
  constructor() {
    const ui = document.getElementById('ui');

    this.hud = el('div', 'hud', ui);
    this.hud.classList.add('hidden');

    this.crosshair = el('div', 'crosshair', this.hud);

    const top = el('div', 'topbar', this.hud);
    const left = el('div', 'topleft', top);
    this.floorEl = el('div', 'floor', left, 'FLOOR 1/3');
    this.seedEl = el('div', 'seed', left, 'SEED —');
    this.coresEl = el('div', 'cores', left);
    this.timerEl = el('div', 'timer', top, '4:00');
    this.lockdownEl = el('div', 'lockdown', this.hud, 'LOCKDOWN IMMINENT');
    this.lockdownEl.classList.add('hidden');

    const vitals = el('div', 'vitals', this.hud);
    const hpWrap = el('div', 'hpwrap', vitals);
    this.hpFill = el('div', 'hpfill', hpWrap);
    this.hpText = el('div', 'hptext', vitals, '100');
    this.pipsEl = el('div', 'pips', vitals);

    this.promptEl = el('div', 'prompt', this.hud);
    this.tauntEl = el('div', 'taunt', this.hud);
    this.vignette = el('div', 'vignette', ui);
    this.chaseEl = el('div', 'chasevignette', ui);
    this.hitEl = el('div', 'hitflash', ui);

    this.mapParent = el('div', 'mapwrap', this.hud);

    // screens
    this.titleEl = el('div', 'title', ui);
    this.titleEl.innerHTML = `
      <h1>CORE BREACH</h1>
      <p class="sub">MAINTENANCE UNIT 7 // FACILITY LOCKDOWN PROTOCOL</p>
      <p class="brief">Recover every data core on each floor and reach the freight<br/>
      elevator before the facility locks down. Security drones are patroling —<br/>
      stay out of their sight, or throw power canisters to distract and disable them.</p>
      <div class="controls">
        <span>WASD</span><em>move</em><span>MOUSE</span><em>look</em>
        <span>SHIFT</span><em>sprint</em><span>SPACE</span><em>jump</em>
        <span>LMB</span><em>throw canister</em><span>E</span><em>interact</em>
        <span>M</span><em>mute</em><span>R</span><em>restart</em>
      </div>
      <p class="cta">CLICK TO START</p>
      <p class="hint" id="titleSeed">SEED —</p>`;

    this.clearEl = el('div', 'clear screen hidden', ui);
    this.winEl = el('div', 'win screen hidden', ui);
    this.loseEl = el('div', 'lose screen hidden', ui);
  }

  onTitleClick(fn) {
    this.titleEl.addEventListener('click', fn);
  }

  setSeed(seed) {
    this.seedEl.textContent = `SEED ${seed}`;
    const ts = this.titleEl.querySelector('#titleSeed');
    if (ts) ts.textContent = `SEED ${seed} — ?seed=${seed} TO REPLAY`;
  }

  showTitle(show) {
    this.titleEl.classList.toggle('hidden', !show);
  }

  startPlaying() {
    this.hud.classList.remove('hidden');
    this.showTitle(false);
  }

  resetFloor(floorIndex, total, cfg) {
    this.setFloor(floorIndex);
    this.setCores(0, cfg.cores);
    this.setTimer(cfg.timer);
    this.lockdownEl.classList.add('hidden');
    this.prompt(null);
  }

  setFloor(i) { this.floorEl.textContent = `FLOOR ${i + 1}/3`; }

  setHealth(hp, max) {
    const f = Math.max(0, hp / max);
    this.hpFill.style.width = `${(f * 100).toFixed(1)}%`;
    this.hpFill.classList.toggle('low', f < 0.35);
    this.hpText.textContent = Math.ceil(hp);
  }

  setCores(got, total) {
    this.coresEl.innerHTML =
      `<span class="corgot">${got}</span><span class="corgsep">/</span><span class="corgtot">${total}</span> DATA CORES`;
  }

  setCanisters(n) {
    this.pipsEl.innerHTML = 'CANISTERS ' + [0, 1, 2].map((i) =>
      `<span class="pip ${i < n ? 'on' : ''}"></span>`).join('');
  }

  setTimer(s) {
    const t = Math.max(0, s);
    const m = Math.floor(t / 60);
    const sec = Math.floor(t % 60);
    this.timerEl.textContent = `${m}:${String(sec).padStart(2, '0')}`;
    const danger = t < 30;
    this.timerEl.classList.toggle('danger', danger);
    this.lockdownEl.classList.toggle('hidden', !danger);
  }

  prompt(text) {
    this.promptEl.textContent = text ?? '';
    this.promptEl.classList.toggle('hidden', !text);
  }

  damageFlash() {
    this.hitEl.classList.remove('hit');
    void this.hitEl.offsetWidth;
    this.hitEl.classList.add('hit');
  }

  showTaunt(text) {
    this.tauntEl.textContent = text;
    this.tauntEl.classList.remove('on');
    void this.tauntEl.offsetWidth;
    this.tauntEl.classList.add('on');
  }

  setChase(on) {
    this.chaseEl.classList.toggle('on', on);
  }

  showClear(floorIndex) {
    this.clearEl.className = 'screen';
    this.clearEl.innerHTML = `<h2>FLOOR ${floorIndex + 1} SECURED</h2><p>HULL +25 — DESCENDING…</p>`;
  }

  showWin(stats) {
    this.winEl.className = 'screen';
    this.winEl.innerHTML = `
      <h2 class="good">BREACH COMPLETE</h2>
      <p>ALL 3 FLOORS CLEARED — ${stats.cores} CORES RECOVERED</p>
      <p class="dim">TIME ${stats.time} · HITS TAKEN ${stats.hits}</p>
      <p class="cta">R — RUN IT AGAIN &nbsp;&nbsp; N — NEW SEED</p>`;
  }

  showLose(reason, stats) {
    this.loseEl.className = 'screen';
    this.loseEl.innerHTML = `
      <h2 class="bad">${reason === 'lockdown' ? 'LOCKDOWN — FLOOR SEALED' : 'UNIT DESTROYED'}</h2>
      <p class="dim">FLOOR ${stats.floor} · CORES ${stats.cores} · TIME ${stats.time}</p>
      <p class="cta">R — RETRY THIS SEED &nbsp;&nbsp; N — NEW SEED</p>`;
  }

  hideScreens() {
    for (const e of [this.clearEl, this.winEl, this.loseEl]) e.className = 'screen hidden';
  }
}

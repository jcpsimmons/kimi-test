// End-to-end browser test: drives the real game in headless system Chrome via
// playwright-core, using ?test=1 (forceLocked input, no pointer lock needed).
// Real input events + live state assertions through window.__cb.
// Run: npm run test:e2e   (screenshots land in shots/)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = 5199;
const BASE = `http://localhost:${PORT}/?seed=42&test=1`;

let failures = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
}

async function waitPort(url, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('dev server did not start');
}

const vite = spawn('npm', ['run', 'dev', '--', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT, stdio: 'ignore', detached: true,
});
const cleanup = () => { try { process.kill(-vite.pid); } catch {} };
process.on('exit', cleanup);

mkdirSync(new URL('../shots', import.meta.url).pathname, { recursive: true });

// find a horizontal run of open cells with a solid cell at its left end:
// { px, pz } run start, { dx, dz } drone spot 2 cells right, stopX wall-clamp
const FIND_RUN = `(() => {
  const g = __cb.world, s = __cb.data.cell;
  for (let cz = 2; cz < g.h - 2; cz++) {
    let streak = 0;
    for (let cx = 1; cx < g.w - 1; cx++) {
      streak = g.getCell(cx, cz) === 0 ? streak + 1 : 0;
      if (streak >= 4 && g.solidCell(cx - 4, cz)) {
        return {
          px: (cx - 3 + 0.5) * s, pz: (cz + 0.5) * s,
          dx: (cx - 1 + 0.5) * s, dz: (cz + 0.5) * s,
          stopX: (cx - 3) * s + 0.35,
        };
      }
    }
  }
  return null;
})()`;

let browser = null;
let harnessError = null;
try {
  await waitPort(BASE, 20000);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.setDefaultTimeout(15000);
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__cb && window.__cb.state === 'playing');
  check('test mode boots straight into playing', true);

  // demo build: floor 1 spawns 20 drones so one is always nearby
  check('floor 1 spawns 20 demo drones', await page.evaluate(() => __cb.drones.drones.length === 20));
  // park ALL drones far away so the early sections stay deterministic —
  // the stun/chase sections re-setup drones[0]/drones[1] explicitly
  await page.evaluate(() => {
    for (const d of __cb.drones.drones) {
      d.pos.set(d.pos.x + 30, 1.6, d.pos.z + 30);
      d.route = [{ x: d.pos.x, z: d.pos.z }];
      d.wp = 0;
      d.state = 0;
    }
  });

  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  console.log(`   GPU: ${gpu}`);

  await page.screenshot({ path: 'shots/01-playing.png' });

  // audio needs a real gesture
  await page.mouse.click(640, 360);
  await page.waitForTimeout(300);
  check('audio engine initialised on gesture', await page.evaluate(() => window.__cb.audio.ctx !== null));

  // ---- movement -------------------------------------------------------------
  const p0 = await page.evaluate(() => ({ x: __cb.player.pos.x, z: __cb.player.pos.z }));
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(800);
  await page.keyboard.up('KeyW');
  const p1 = await page.evaluate(() => ({ x: __cb.player.pos.x, z: __cb.player.pos.z }));
  const dWalk = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  check('WASD movement', dWalk > 1.5, `${dWalk.toFixed(1)}m in 0.8s`);

  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(800);
  const p2 = await page.evaluate(() => ({ x: __cb.player.pos.x, z: __cb.player.pos.z }));
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  const dSprint = Math.hypot(p2.x - p1.x, p2.z - p1.z);
  check('sprint is faster than walk', dSprint > dWalk * 1.2, `${dSprint.toFixed(1)}m vs ${dWalk.toFixed(1)}m`);

  // ---- jump -----------------------------------------------------------------
  await page.waitForTimeout(300);
  let maxY = 0;
  for (let attempt = 0; attempt < 3 && maxY < 0.4; attempt++) {
    await page.keyboard.press('Space');
    for (let i = 0; i < 14; i++) {
      const y = await page.evaluate(() => __cb.player.pos.y);
      if (y > maxY) maxY = y;
      await page.waitForTimeout(55);
    }
  }
  check('jump leaves the ground and lands', maxY > 0.4, `apex ${maxY.toFixed(2)}m`);

  // ---- wall collision (walk -x into the border) ------------------------------
  const run = await page.evaluate(FIND_RUN);
  check('found an open corridor run for teleports', run !== null);
  await page.evaluate((r) => {
    __cb.player.pos.set(r.px, 0, r.pz);
    __cb.player.vel.set(0, 0, 0);
    __cb.player.yaw = Math.PI / 2; // face -x
  }, run);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(3000);
  await page.keyboard.up('KeyW');
  const px = await page.evaluate(() => __cb.player.pos.x);
  check('wall collision clamps at the face', Math.abs(px - run.stopX) < 0.2, `x=${px.toFixed(3)} expected ~${run.stopX.toFixed(3)}`);

  // ---- canister pickup + throw ------------------------------------------------
  await page.evaluate(() => {
    const c = __cb.data.canisters[0];
    __cb.player.pos.set((c.cx + 0.5) * __cb.data.cell, 0, (c.cz + 0.5) * __cb.data.cell);
    __cb.player.vel.set(0, 0, 0);
  });
  await page.waitForTimeout(300);
  check('canister pickup by walk-over', await page.evaluate(() => __cb.throwables.carried === 1));
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(150);
  check('LMB throws a canister', await page.evaluate(() =>
    __cb.throwables.slots.some((s) => s.state === 'flying') && __cb.throwables.carried === 0));

  // ---- drone stun via direct hit ------------------------------------------------
  // rear approach: drone faces +x (away from the player) so it stays pinned;
  // flat throw (pitch 0.05) intersects hover height at 5 m
  let stunned = false;
  for (let attempt = 0; attempt < 3 && !stunned; attempt++) {
    await page.evaluate((r) => {
      const d = __cb.drones.drones[0];
      if (d.state === 3) return;
      d.pos.set(r.dx, 1.6, r.dz);
      d.yaw = -Math.PI / 2; // face +x — player is behind, no detection
      d.route = [{ x: r.dx, z: r.dz }];
      d.wp = 0;
      d.state = 0;
      __cb.player.pos.set(r.px, 0, r.pz);
      __cb.player.vel.set(0, 0, 0);
      __cb.player.yaw = -Math.PI / 2; // face +x, at the drone's back
      __cb.player.pitch = 0.05;
      if (__cb.throwables.carried === 0) {
        const s = __cb.throwables.slots.find((x) => x.state !== 'carried' && x.state !== 'flying');
        if (s) { s.state = 'carried'; s.mesh.visible = false; }
      }
    }, run);
    await page.waitForTimeout(200);
    await page.mouse.down(); await page.mouse.up();
    try {
      await page.waitForFunction(() => __cb.drones.drones[0].state === 3, null, { timeout: 2500 });
      stunned = true;
    } catch {}
  }
  check('direct canister hit stuns a drone', stunned);
  await page.screenshot({ path: 'shots/02-stunned-drone.png' });

  // ---- re-hit on a stunned drone refreshes the timer (no wake/toggle) ----------
  await page.waitForTimeout(1000); // let stunT visibly decay
  const decayed = await page.evaluate(() => __cb.drones.drones[0].stunT);
  let refreshed = false;
  for (let attempt = 0; attempt < 3 && !refreshed; attempt++) {
    await page.evaluate((r) => {
      __cb.player.pos.set(r.px, 0, r.pz);
      __cb.player.vel.set(0, 0, 0);
      __cb.player.yaw = -Math.PI / 2; // face +x, drone still sleeping at the same spot
      __cb.player.pitch = -0.2; // aim down — a stunned drone sits on the floor (y~0.55)
      if (__cb.throwables.carried === 0) {
        const s = __cb.throwables.slots.find((x) => x.state !== 'carried' && x.state !== 'flying');
        if (s) { s.state = 'carried'; s.mesh.visible = false; }
      }
    }, run);
    await page.waitForTimeout(200);
    await page.mouse.down(); await page.mouse.up();
    try {
      await page.waitForFunction((prev) =>
        __cb.drones.drones[0].state === 3 && __cb.drones.drones[0].stunT > prev,
        decayed, { timeout: 2000 });
      refreshed = true;
    } catch {}
  }
  const stunAfter = await page.evaluate(() => __cb.drones.drones[0].stunT);
  const stillStunned = await page.evaluate(() => __cb.drones.drones[0].state === 3);
  check('re-hit refreshes stun timer, drone stays stunned', refreshed && stillStunned && stunAfter > decayed,
    `stunT ${decayed.toFixed(2)}->${stunAfter.toFixed(2)}`);

  // ---- drone chase + zap --------------------------------------------------------
  await page.evaluate((r) => {
    const d = __cb.drones.drones[1] ?? __cb.drones.drones[0];
    window.__zapDrone = __cb.drones.drones.indexOf(d);
    d.state = 0;
    d.pos.set(r.dx, 1.6, r.dz);
    d.yaw = Math.PI / 2; // face -x, at the player
    d.route = [{ x: r.dx, z: r.dz }];
    d.wp = 0;
    __cb.player.pos.set(r.px, 0, r.pz);
    __cb.player.vel.set(0, 0, 0);
    __cb.player.yaw = -Math.PI / 2;
  }, run);
  let chased = true;
  try {
    await page.waitForFunction(() => __cb.drones.drones[window.__zapDrone].state === 2, null, { timeout: 4000 });
  } catch { chased = false; }
  check('drone detects player and chases', chased);
  let taunted = true;
  try {
    await page.waitForFunction(() => typeof __cb.lastTaunt === 'string' && __cb.lastTaunt.length > 0,
      null, { timeout: 5000 });
    taunted = await page.evaluate(() => document.getElementById('taunt').textContent.length > 0);
  } catch { taunted = false; }
  check('drone taunts on chase', taunted, `taunt=${await page.evaluate(() => __cb.lastTaunt)}`);
  let zapped = true;
  try {
    await page.waitForFunction(() => __cb.player.health < 100, null, { timeout: 6000 });
  } catch { zapped = false; }
  check('drone zap damages the player', zapped, `hp=${await page.evaluate(() => __cb.player.health)}`);
  await page.screenshot({ path: 'shots/03-chase.png' });

  // ---- drone-player body separation --------------------------------------------
  await page.evaluate(() => {
    const d = __cb.drones.drones[window.__zapDrone];
    d.pos.set(__cb.player.pos.x, 1.6, __cb.player.pos.z); // drop it right on the player
    d.state = 2; // CHASE — keeps pushing in, separation must push it back out
  });
  await page.waitForTimeout(400);
  const bodyDist = await page.evaluate(() => {
    const d = __cb.drones.drones[window.__zapDrone];
    return Math.hypot(d.pos.x - __cb.player.pos.x, d.pos.z - __cb.player.pos.z);
  });
  check('drone body never overlaps the player', bodyDist >= 0.75, `xz dist ${bodyDist.toFixed(2)}m (min 0.8)`);

  // god mode: two lethal zaps (15 dmg each) at 10 hp must clamp at 1, never kill
  await page.evaluate(() => {
    __cb.player.health = 10;
    __cb.onZap(__cb.drones.drones[window.__zapDrone]);
    __cb.onZap(__cb.drones.drones[window.__zapDrone]);
  });
  check('god mode: lethal zaps clamp at 1 hp, no death', await page.evaluate(() =>
    __cb.player.health === 1 && __cb.state === 'playing'));

  // restore hp + park ALL drones far away so the core/elevator run is undisturbed
  await page.evaluate(() => {
    __cb.player.health = 100;
    for (const d of __cb.drones.drones) d.pos.set(d.pos.x + 30, 1.6, d.pos.z + 30);
  });

  // ---- collect all cores -> elevator unlocks ------------------------------------
  for (let i = 0; i < 3; i++) {
    await page.evaluate((idx) => {
      const c = __cb.data.cores[idx];
      __cb.player.pos.set((c.cx + 0.5) * __cb.data.cell, 0, (c.cz + 0.5) * __cb.data.cell);
      __cb.player.vel.set(0, 0, 0);
    }, i);
    await page.waitForTimeout(250);
  }
  check('all cores collected', await page.evaluate(() => __cb.collected === 3));
  check('elevator unlocks when cores complete', await page.evaluate(() => __cb.elevatorUnlocked === true));

  // ---- elevator -> next floor -----------------------------------------------------
  await page.evaluate(() => {
    const e = __cb.data.elevator;
    __cb.player.pos.set((e.cx + 0.5) * __cb.data.cell - e.wx * 1.2, 0, (e.cz + 0.5) * __cb.data.cell - e.wz * 1.2);
    __cb.player.vel.set(0, 0, 0);
  });
  await page.waitForTimeout(300);
  const prompt = await page.evaluate(() => document.getElementById('prompt').textContent);
  check('elevator prompt shown', prompt.includes('ENTER FREIGHT ELEVATOR'), prompt);
  await page.keyboard.press('KeyE');
  let advanced = true;
  try {
    await page.waitForFunction(() => window.__cb.floorIndex === 1 && window.__cb.state === 'playing', null, { timeout: 6000 });
  } catch { advanced = false; }
  check('elevator advances to floor 2', advanced);
  await page.screenshot({ path: 'shots/04-floor2.png' });

  // ---- floor 3: fps + draw calls ---------------------------------------------------
  await page.evaluate(() => { __cb.floorIndex = 2; __cb.buildFloor(); });
  await page.waitForTimeout(800);
  await page.keyboard.down('KeyW');
  const fps = await page.evaluate(() => new Promise((res) => {
    let n = 0;
    const t0 = performance.now();
    (function tick() {
      n++;
      if (performance.now() - t0 < 4000) requestAnimationFrame(tick);
      else res(n / 4);
    })();
  }));
  await page.keyboard.up('KeyW');
  const info = await page.evaluate(() => ({
    calls: __cb.frameStats.calls,
    tris: __cb.frameStats.tris,
  }));
  check('floor 3 frame rate (6 drones)', fps >= 55, `${fps.toFixed(1)} fps`);
  check('draw calls within budget', info.calls < 200, `${info.calls} calls, ${(info.tris / 1000).toFixed(0)}k tris`);
  await page.screenshot({ path: 'shots/05-floor3.png' });

  // ---- restart without reload + leak check -------------------------------------------
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(700);
  const g0 = await page.evaluate(() => ({ g: __cb.renderer.info.memory.geometries, t: __cb.renderer.info.memory.textures }));
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(700);
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(700);
  const g1 = await page.evaluate(() => ({ g: __cb.renderer.info.memory.geometries, t: __cb.renderer.info.memory.textures }));
  check('R restarts the run (floor 1, playing)', await page.evaluate(() => __cb.floorIndex === 0 && __cb.state === 'playing'));
  check('no resource leak across restarts', g0.g === g1.g && g0.t === g1.t, `geo ${g0.g}→${g1.g}, tex ${g0.t}→${g1.t}`);

  // ---- lockdown lose + recover --------------------------------------------------------
  await page.evaluate(() => { __cb.timer = 1.0; });
  let lost = true;
  try {
    await page.waitForFunction(() => window.__cb.state === 'lose', null, { timeout: 5000 });
  } catch { lost = false; }
  check('lockdown timer triggers lose', lost);
  await page.screenshot({ path: 'shots/06-lose.png' });
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(1500);
  // test mode: forceLocked makes the title state auto-advance back to playing
  check('R after lose restarts the run', await page.evaluate(() =>
    window.__cb.state === 'playing' && window.__cb.floorIndex === 0 && window.__cb.timer > 200));

  // ---- F3 overlay + win screen ---------------------------------------------------------
  await page.keyboard.press('F3');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shots/07-f3.png' });
  check('F3 debug overlay visible', await page.evaluate(() => document.getElementById('debug').style.display !== 'none'));
  await page.evaluate(() => __cb.win());
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shots/08-win.png' });
  check('win screen shows', await page.evaluate(() => document.querySelector('.screen h2.good') !== null));

  const realErrors = consoleErrors.filter((e) => !/favicon|Autoplay|WebGL.*fallback|404/i.test(e));
  check('zero console errors across the run', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
} catch (e) {
  harnessError = e;
  failures++;
}

if (browser) await browser.close().catch(() => {});
cleanup();
if (harnessError) console.error('HARNESS ERROR:', harnessError.message);
console.log(failures === 0 ? '\nAll e2e checks passed.' : `\n${failures} e2e check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

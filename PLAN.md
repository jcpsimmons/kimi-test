# CORE BREACH — Implementation Plan

A browser-based first-person 3D game in Three.js + vanilla JS, served with Vite.
You are a maintenance robot in a procedurally generated server facility. Collect all
data cores on each floor, reach the freight elevator before lockdown, descend 3 floors.

**Workflow note:** per-milestone confirmation gates were waived by the user on
2026-07-17 ("build the whole thing now, no intervention until finished"), with the
amendment that visuals must be high-end — no lo-poly indie look. M1 was confirmed
before that. This file is the living record of architecture and status.

---

## 1. Decisions (confirmed by user, with amendments)

| # | Question | Decision |
|---|----------|----------|
| 1 | Where does the project live? | Repo root of `kimi-test` |
| 2 | Art direction / assets | **AMENDED ×2:** high-end cinematic look, high definition, refined — no lo-poly. 1024px procedural textures with Sobel-derived normal maps + painted roughness maps, 3 wall variants, PMREM env reflections, custom GLSL (hologram cores, volumetric light shafts, blinking rack LEDs, drifting dust), HDR pipeline with MSAA×4, bloom, ACES. Zero downloaded assets |
| 3 | Audio assets | 100% synthesized via Web Audio API |
| 4 | Throwables | Power canisters; walk-over pickup (max 3), LMB throw; impact noise distracts, direct hit stuns 5 s |
| 5 | Can drones be killed? | No — stun only |
| 6 | Health regen | None mid-floor; +25 HP on floor clear. Drone zap = 15 dmg |
| 7 | Minimap | Fog-of-war reveal; cores always shown; drones only while near |
| 8 | Seeds | Random per run, shown on HUD; `?seed=12345` forces a seed |
| 9 | Platform | Desktop only (pointer lock) |
| 10 | Run length | ~15 min: 3 floors, 240/225/210 s lockdown timers |

## 2. Tech stack

- **Vite 8**, **three 0.185**, no framework, no other runtime deps.
- **No physics library** — grid world (Uint8Array: wall/rack/open) with
  axis-separated capsule collision, DDA raycast LOS, ballistic spheres, A* — all
  pure JS in `physics.js`, unit-tested in Node.
- **Post:** `EffectComposer` (HalfFloat) → `UnrealBloomPass` → `OutputPass` (ACES)
  → FXAA. `three/addons` only — no new deps. Deliberately **no multisampled
  render target**: MSAA HalfFloat targets fail to resolve on some real GPUs
  (black screen on Metal/ANGLE) — FXAA handles smoothing instead.
- **Level gen** (`level/gen.js`): carve-from-solid rooms + randomized-Prim corridors
  + loops; racks along room edges with full-connectivity validation (BFS rollback);
  deterministic from one mulberry32 seed. Node-tested (60 seeds + 600-floor stress).
- Audio: raw Web Audio, synthesized (see `audio.js` header).

## 3. Requirement → implementation mapping

| Hard requirement | Implementation |
|---|---|
| FPS controls | `player.js`: kinematic capsule, pointer lock, coyote+jump buffer, sprint FOV kick, head bob |
| Procedural floors, 3, rising difficulty | `level/gen.js` + `FLOORS` in config: grid 36→52, rooms 7→11, cores 3→5, drones 2→6, timer 240→210 s, drone speed 2.2→3.0 / chase 4.3→4.7, view range 12→15 |
| Drone patrol/chase AI + LOS | `drones.js`: PATROL→ALERT→CHASE→STUNNED; waypoint routes from gen, A* repath 2 Hz; cone 110° + range + grid LOS + 2.5 m proximity; visible scan cone changes color with state |
| Physics: collision, throwables, hit reactions | `physics.js` capsule/sphere vs grid; `throwables.js` ballistic canisters, noise events → ALERT, direct hit → stun+knockback+sparks; zap → damage+knockback+screenshake+vignette |
| Game loop | `game.js` state machine TITLE/PLAYING/CLEAR/WIN/LOSE; health, per-floor lockdown timer, cores gate elevator (E), 3-floor progression, R restart same seed / N new seed — full teardown + rebuild, no reload |
| HUD: health, cores, timer, minimap | `hud.js` DOM widgets + `minimap.js` fog-of-war canvas |
| Sound + ambient | `audio.js`: footsteps/jump/land/pickup/throw/clank/core/zap/stun/alert/unlock/elevator/win/lose, brown-noise room tone, 50 Hz mains hum, per-drone proximity hums, chase pulse, lockdown alarm, distant clanks; M mute |
| High-end visuals (amendment) | See §2; screenshots verified headlessly via `?shot=<scene>` poses |
| 60 fps laptop GPU | See §6 budget; F3 overlay ships in-game for on-hardware verification |

## 4. Architecture

Single `Game` orchestrator; plain entity classes with `update(dt)`; fixed 60 Hz
timestep with accumulator; per-floor content built into one `levelGroup` that is
disposed on transitions (shared materials survive the whole run; per-floor
materials are tagged `userData.owned` and disposed — `renderer.info` stays flat
across restarts).

```
main.js → Game
  ├─ Input / Player (health, inventory via Throwables)
  ├─ level/gen.js (pure data) → level/builder.js (static meshes) + level/props.js (cores, elevator)
  ├─ DroneManager (2–6 drones) · Throwables (pooled 16) · Effects (pooled 512 sparks, shake)
  ├─ AudioEngine (synth) · HUD (DOM) · Minimap (canvas)
  └─ post.js (MSAA HDR composer) · debug.js (F3)
```

Debug/verification hooks: `?seed=N` pins the layout; `?shot=corridor|core|drone|chase|elevator|canister|hud`
boots straight into a posed, timer-frozen scene for headless screenshots;
`?post=0` bypasses the composer (diagnostic); `?test=1` force-locks input so the
playwright harness can drive the game headless; `window.__cb` is the live Game instance.

## 5. File structure

```
kimi-test/
├── PLAN.md · README.md · index.html · style.css · package.json
├── src/
│   ├── main.js            boot
│   ├── config.js          ALL tuning constants (incl. FLOORS difficulty table)
│   ├── rng.js             mulberry32 + seed helpers
│   ├── input.js           keyboard/mouse/pointer lock
│   ├── game.js            state machine, floor flow, restart, shot poses
│   ├── physics.js         grid world, capsule/sphere collision, DDA raycast, A*   [pure]
│   ├── player.js          FPS controller + health
│   ├── drones.js          drone entity, AI states, LOS, stun
│   ├── throwables.js      canister pool, ballistic flight, noise events
│   ├── effects.js         pooled sparks, screenshake
│   ├── audio.js           Web Audio synth engine
│   ├── hud.js             DOM HUD + all screens
│   ├── minimap.js         fog-of-war minimap
│   ├── debug.js           F3 fps/draw-call overlay
│   ├── textures.js        1024px canvas textures + normal/roughness maps
│   ├── materials.js       PBR materials + custom ShaderMaterials
│   ├── post.js            MSAA HalfFloat composer, bloom, ACES output
│   └── level/
│       ├── gen.js         floor generation (rooms/corridors/placement/patrols)    [pure]
│       ├── builder.js     grid → detailed facility meshes (instanced)
│       └── props.js       CoreField + Elevator (animated, stateful)
└── scripts/
    ├── test-phys.mjs      physics tests
    ├── test-gen.mjs       gen validation + determinism
    └── browser-test.mjs   playwright e2e: real input, state assertions, fps, shots/
```

## 6. Performance budget (60 fps @1080p on laptop GPU)

- Draw calls < 150 (everything static is instanced; ~35 for the level, ~45 for
  6 drones, remainder props/effects/post).
- Lights: 1 hemisphere + 1 shadowless headlamp spot; no shadow maps; PMREM env
  baked once at startup; fog far 36 m; pixelRatio ≤ 1.5; MSAA×4.
- Bloom is the main per-frame cost — levers if a machine dips: bloom.strength,
  pixelRatio → 1.25.
- Pooling: canisters 16, sparks 512 ring buffer, noise array reused; no per-frame
  allocations in the hot loop; A* repath ≤ 2 Hz per chasing drone.
- F3 overlay (fps, ms, low, calls, tris) verifies the budget on real hardware.

## 7. Milestones — final status

| # | Milestone | Status |
|---|-----------|--------|
| 1 | Scaffold + FPS controller + render pipeline | done (confirmed) |
| 2 | Procedural floor gen + rendering | done |
| 3 | Drone AI (patrol/alert/chase/stun, LOS) | done — visible state-colored scan cones replace the planned F4 debug view |
| 4 | Throwables + hit reactions | done |
| 5 | Game loop (health, timer, floors, win/lose, restart) | done |
| 6 | HUD + minimap + screens | done |
| 7 | Audio (synth SFX + ambient) | done |
| 8 | Performance + polish | done — FXAA (see §2 note), instancing audit, grade pass #1 (darker/moodier after screenshot review) |

## 8. Verification log

- `npm run test:phys` — 14/14 green (capsule slide, DDA, LOS, ballistic).
- `npm run test:gen` — 3 floors × 20 seeds + determinism/seed-sensitivity, plus a
  600-floor stress run: all layouts fully connected.
- Gen bug found & fixed: rack rows on adjacent room edges could seal a corner
  pocket → per-row BFS rollback in `placeRackRows`.
- Code review fixes: title→playing lock transition, stale drone hums on restart,
  resume overlay on pointer-lock loss, shot-pose pinning.
- `npm run build` — green (~140 kB gzip).
- Headless Chrome (swiftshader): page + WebGL render with zero JS errors.
  Screenshot review of all `?shot` poses (corridor, core, drone, chase, elevator,
  canister, hud): floor/wall detail, holo cores, drone model + state-colored scan
  cones, elevator (sign, green unlocked glow, sliding doors), full HUD (danger
  timer, lockdown banner, cores, health, pips, minimap) — plus an unscripted
  PATROL→CHASE transition and chase vignette captured live during the canister
  pose. Grade pass #1 (darker grade, tighter fixtures, subtler shafts) applied
  after the first corridor shot and re-verified.
- **User-reported black screen on real GPU (fixed):** the custom MSAA×4 HalfFloat
  composer target failed to resolve on Metal/ANGLE — whole 3D scene black, HUD
  fine. Reproduced headlessly on the real GPU (no `--disable-gpu`), bisected with
  the new `?post=0` composer-bypass param (scene renders fine direct), fixed by
  dropping the MSAA target in favor of an FXAA pass at the end of the chain.
  Re-verified corridor/drone/core/elevator shots on the real GPU.
- **Playwright e2e harness (`npm run test:e2e`)** — drives system Chrome headless
  via playwright-core (devDep) with `?test=1` force-locked input, real key/mouse
  events, and live state assertions through `window.__cb`. **26/26 green on real
  GPU (Apple M4 Max / Metal):** boot, audio init on gesture, WASD 3.1 m/0.8 s,
  sprint 5.2 m/0.8 s, jump apex 0.92 m, wall clamp exact to the radius, canister
  pickup/throw, direct-hit stun, detect→chase→zap (−15 hp), 3× core collect →
  elevator unlock → E → floor 2, **floor 3 with 6 drones: 82 fps, 71 draw calls,
  65k tris**, R restart ×3 with zero resource drift (geo/tex flat), lockdown
  lose, R restart, F3 overlay, win screen, zero console errors. Screenshots in
  `shots/`. Bugs found & fixed via the harness: drone patrol `wp` out-of-bounds
  after route replacement (now guarded), minimap cores drawn at NaN (CoreField
  now carries `cx/cz`), F3 overlay sampled draw calls mid-frame (now post-render),
  favicon 404 noise.
- Remaining unverifiable-by-machine: movement *feel* and the audio mix — both are
  one `npm run dev` away; all tuning lives in `src/config.js`.

## 9. Progress log

- **M1 done (confirmed)** — scaffold, controller, physics core, render pipeline.
- **M2–M8 done in one autonomous pass** — procgen floors + detailed facility
  rendering, drones, throwables, game loop, HUD/minimap, audio, perf/polish.
  Awaiting user review.

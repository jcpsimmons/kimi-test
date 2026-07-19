# CORE BREACH

First-person stealth game in a procedurally generated server facility.
Three.js + vanilla JS + Vite, zero downloaded assets (all geometry, textures and
audio are generated at runtime). See PLAN.md for the full design.

You are a maintenance robot. Collect every data core on each floor and reach the
freight elevator before the facility locks down — 3 floors, rising difficulty.
Security drones patrol the halls: stay out of their view cones, or throw power
canisters to distract them / stun them with a direct hit.

## Run

    npm install
    npm run dev        # http://localhost:5173

## Controls

| Input | Action |
|---|---|
| WASD / mouse | move / look |
| Shift | sprint (louder — drones hear it) |
| Space | jump |
| LMB | throw power canister (max 3 carried) |
| E | enter elevator (when unlocked) |
| M | mute |
| R | restart run (same seed) |
| N | new seed (on win/lose screens) |
| F3 | fps / draw-call overlay |

Force a layout seed with `?seed=12345` in the URL.

## Checks

    npm run test:phys  # physics core unit tests (Node, no browser)
    npm run test:gen   # procedural generation validation (connectivity, determinism)
    npm run test:e2e   # full browser playthrough (playwright, real GPU; screenshots in shots/)
    npm run build      # production build

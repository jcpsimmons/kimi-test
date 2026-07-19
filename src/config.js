// CORE BREACH — central tuning. Every gameplay/visual constant lives here.

export const STEP = 1 / 60; // fixed logic timestep (seconds)

export const RENDER = {
  fov: 75,
  sprintFov: 83,
  near: 0.05,
  far: 90,
  maxPixelRatio: 1.5,
  exposure: 1.0,
  bloom: { strength: 0.45, radius: 0.45, threshold: 0.85 },
  clearColor: 0x04060b,
  fogColor: 0x04060b,
  fogNear: 8,
  fogFar: 36,
};

export const PLAYER = {
  eyeHeight: 1.6,
  radius: 0.35,
  walkSpeed: 4.2,      // m/s
  sprintMul: 1.6,
  groundAccel: 14,     // exponential approach rate (1/s)
  airAccel: 3.0,
  gravity: 14,         // m/s^2 (gamey, not 9.8)
  jumpVel: 5.2,        // apex ~0.97 m — cannot vault racks
  coyoteTime: 0.1,
  jumpBuffer: 0.12,
  mouseSens: 0.0022,   // rad per pixel
  bobFreq: 7.5,
  bobAmp: 0.024,
  maxHealth: 100,
  zapKnockback: 3.2,
};

export const WORLD = {
  cell: 2.5,        // metres per grid cell
  wallHeight: 3.2,
  rackHeight: 1.9,
};

export const THROW = {
  maxCarry: 3,
  speed: 12,
  upBias: 0.22,       // fraction of up mixed into the throw direction
  radius: 0.15,
  gravity: 14,
  restitution: 0.45,
  groundFriction: 0.75,
  noiseRadius: 14,    // metres — impact alerts drones in range
  stunMinSpeed: 3,    // m/s needed for a disabling direct hit
  poolSize: 16,
};

export const DRONE = {
  hover: 1.6,          // patrol hover height
  radius: 0.45,
  viewCos: 0.5736,     // cos(55°) — 110° view cone
  proximity: 2.5,      // 360° awareness radius
  loseSight: 4,        // s of no contact before dropping chase
  repath: 0.5,         // s between A* repaths while chasing/alert
  stunTime: 5,
  zapRange: 1.5,
  zapDamage: 15,
  zapCooldown: 1.0,
  alertTime: 3,        // s spent investigating a point
  noiseWalk: 2.5,      // footstep noise radius
  noiseSprint: 6.5,
};

export const GAME = {
  floorClearHeal: 25,
  coreRange: 1.2,
  elevatorRange: 1.8,
  canisterRange: 1.1,
};

// Drone taunts: seconds between a chasing drone's taunts; min seconds between displayed taunts.
export const TAUNT = { reTaunt: 7, minGap: 2.5 };

// Rising difficulty: bigger grid, more rooms/cores/drones, less time, faster drones.
export const FLOORS = [
  { grid: 36, rooms: 7,  cores: 3, canisters: 8,  drones: 2, timer: 240, patrol: 2.2, chase: 4.3, viewRange: 12 },
  { grid: 44, rooms: 9,  cores: 4, canisters: 9,  drones: 4, timer: 225, patrol: 2.6, chase: 4.5, viewRange: 13.5 },
  { grid: 52, rooms: 11, cores: 5, canisters: 10, drones: 6, timer: 210, patrol: 3.0, chase: 4.7, viewRange: 15 },
];

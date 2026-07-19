// Seeded PRNG — mulberry32. All run randomness flows through one of these so a
// seed fully determines floor layout, patrol routes and pickup placement.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    seed,
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)), // inclusive
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}

export function randomSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}

export function seedFromUrl() {
  const s = new URLSearchParams(window.location.search).get('seed');
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n >>> 0 : null;
}

import * as THREE from 'three';

// Procedural surface detail at 1024px, with height-derived normal maps and
// painted roughness maps. Everything is drawn once at startup from the seeded
// rng — no downloaded assets.

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function toTexture(canvas, { srgb = true, repeat = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Sobel height→normal conversion (wrapped edges so textures tile).
function normalFromHeight(heightCanvas, strength = 2.0) {
  const w = heightCanvas.width, h = heightCanvas.height;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const out = makeCanvas(w, h);
  const ctx = out.getContext('2d');
  const img = ctx.createImageData(w, h);
  const lum = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (lum(x - 1, y - 1) + 2 * lum(x - 1, y) + lum(x - 1, y + 1)) -
                 (lum(x + 1, y - 1) + 2 * lum(x + 1, y) + lum(x + 1, y + 1));
      const dy = (lum(x - 1, y - 1) + 2 * lum(x, y - 1) + lum(x + 1, y - 1)) -
                 (lum(x - 1, y + 1) + 2 * lum(x, y + 1) + lum(x + 1, y + 1));
      const nx = (dx / 255) * strength, ny = (dy / 255) * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * w + x) * 4;
      img.data[i] = (nx / l * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz / l * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function grime(g, rng, w, h, n, maxA) {
  for (let i = 0; i < n; i++) {
    const r = 20 + rng.next() * 90;
    const x = rng.next() * w, y = rng.next() * h;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(0,0,0,${(0.05 + rng.next() * maxA).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

function scratches(g, rng, w, h, n) {
  g.strokeStyle = 'rgba(255,255,255,0.05)';
  g.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    const x = rng.next() * w, y = rng.next() * h;
    const a = rng.next() * Math.PI, l = 8 + rng.next() * 40;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
}

// ---- floor: 2x2 large plates per tile (tile spans 2x2 grid cells = 5m) ----
export function makeFloorMaps(rng) {
  const S = 1024, half = S / 2;
  const c = makeCanvas(S), g = c.getContext('2d');
  const hc = makeCanvas(S), hg = hc.getContext('2d');
  const rc = makeCanvas(S), rg = rc.getContext('2d');
  hg.fillStyle = '#808080'; hg.fillRect(0, 0, S, S);
  rg.fillStyle = '#6e6e6e'; rg.fillRect(0, 0, S, S); // ~0.43 roughness base
  g.fillStyle = '#171e2a'; g.fillRect(0, 0, S, S);
  const ventPlate = rng.int(0, 3);
  for (let p = 0; p < 4; p++) {
    const ox = (p % 2) * half, oy = ((p / 2) | 0) * half;
    // plate brightness variance
    const v = (rng.next() - 0.5) * 0.10;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v.toFixed(3)})` : `rgba(0,0,0,${(-v).toFixed(3)})`;
    g.fillRect(ox, oy, half, half);
    // recessed seam around plate
    g.fillStyle = '#090c13';
    g.fillRect(ox, oy, half, 5); g.fillRect(ox, oy + half - 5, half, 5);
    g.fillRect(ox, oy, 5, half); g.fillRect(ox + half - 5, oy, 5, half);
    hg.fillStyle = '#3a3a3a';
    hg.fillRect(ox, oy, half, 6); hg.fillRect(ox, oy + half - 6, half, 6);
    hg.fillRect(ox, oy, 6, half); hg.fillRect(ox + half - 6, oy, 6, half);
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.fillRect(ox + 5, oy + 5, half - 10, 1); g.fillRect(ox + 5, oy + 5, 1, half - 10);
    // corner bolts (raised)
    for (const [bx, by] of [[28, 28], [half - 28, 28], [28, half - 28], [half - 28, half - 28]]) {
      g.fillStyle = '#46536b';
      g.beginPath(); g.arc(ox + bx, oy + by, 6, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.beginPath(); g.arc(ox + bx - 1.5, oy + by - 1.5, 2.2, 0, 7); g.fill();
      hg.fillStyle = '#e8e8e8';
      hg.beginPath(); hg.arc(ox + bx, oy + by, 6, 0, 7); hg.fill();
      rg.fillStyle = '#4a4a4a';
      rg.beginPath(); rg.arc(ox + bx, oy + by, 7, 0, 7); rg.fill();
    }
    // one plate gets a recessed vent
    if (p === ventPlate) {
      const vx = ox + half / 2, vy = oy + half / 2;
      g.fillStyle = '#12161f';
      g.fillRect(vx - 110, vy - 70, 220, 140);
      for (let i = 0; i < 8; i++) {
        const sy = vy - 58 + i * 15;
        g.fillStyle = '#05070b';
        g.fillRect(vx - 96, sy, 192, 8);
        g.fillStyle = 'rgba(255,255,255,0.10)';
        g.fillRect(vx - 96, sy + 8, 192, 1.5);
        hg.fillStyle = '#222222';
        hg.fillRect(vx - 96, sy, 192, 8);
      }
      rg.fillStyle = '#9a9a9a';
      rg.fillRect(vx - 110, vy - 70, 220, 140);
    }
  }
  grime(g, rng, S, S, 46, 0.10);
  scratches(g, rng, S, S, 34);
  // grime raises roughness
  for (let i = 0; i < 26; i++) {
    const r = 30 + rng.next() * 80;
    const x = rng.next() * S, y = rng.next() * S;
    const grad = rg.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(170,170,170,0.35)');
    grad.addColorStop(1, 'rgba(170,170,170,0)');
    rg.fillStyle = grad;
    rg.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return {
    map: toTexture(c),
    normalMap: toTexture(normalFromHeight(hc, 2.2), { srgb: false }),
    roughnessMap: toTexture(rc, { srgb: false }),
  };
}

// ---- wall variants: one texture per cell face (2.5m x 3.2m) ----
function drawWallVariant(rng, kind) {
  const S = 1024;
  const c = makeCanvas(S), g = c.getContext('2d');
  const hc = makeCanvas(S), hg = hc.getContext('2d');
  const rc = makeCanvas(S), rg = rc.getContext('2d');
  hg.fillStyle = '#808080'; hg.fillRect(0, 0, S, S);
  rg.fillStyle = '#8c8c8c'; rg.fillRect(0, 0, S, S); // ~0.55 base roughness
  g.fillStyle = '#131a26'; g.fillRect(0, 0, S, S);
  // vertical panel seams
  const splits = kind === 2 ? [S * 0.5] : [S / 3, (2 * S) / 3];
  for (const sx of splits) {
    g.fillStyle = '#080b12'; g.fillRect(sx - 3, 0, 6, S);
    g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(sx + 3, 0, 1.5, S);
    hg.fillStyle = '#333'; hg.fillRect(sx - 3, 0, 6, S);
  }
  // horizontal trims at ~1.05m and ~2.55m
  for (const ty of [336, 816]) {
    g.fillStyle = '#242e3f'; g.fillRect(0, ty - 14, S, 28);
    g.fillStyle = '#0a0d15'; g.fillRect(0, ty - 16, S, 3); g.fillRect(0, ty + 13, S, 3);
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, ty - 13, S, 1.5);
    hg.fillStyle = '#5a5a5a'; hg.fillRect(0, ty - 14, S, 28);
    hg.fillStyle = '#2c2c2c'; hg.fillRect(0, ty - 16, S, 3); hg.fillRect(0, ty + 13, S, 3);
    rg.fillStyle = '#707070'; rg.fillRect(0, ty - 14, S, 28);
    // rivets on the trim
    for (let x = 40; x < S; x += 80) {
      g.fillStyle = '#3d4a61'; g.beginPath(); g.arc(x, ty, 4, 0, 7); g.fill();
      hg.fillStyle = '#dcdcdc'; hg.beginPath(); hg.arc(x, ty, 4, 0, 7); hg.fill();
    }
  }
  if (kind === 0) {
    // louvered vent, upper left
    const vx = S * 0.17, vy = S * 0.17;
    g.fillStyle = '#10151f'; g.fillRect(vx - 120, vy - 80, 240, 160);
    for (let i = 0; i < 7; i++) {
      const sy = vy - 64 + i * 19;
      g.fillStyle = '#04060a'; g.fillRect(vx - 104, sy, 208, 10);
      g.fillStyle = 'rgba(255,255,255,0.09)'; g.fillRect(vx - 104, sy + 10, 208, 1.5);
      hg.fillStyle = '#1e1e1e'; hg.fillRect(vx - 104, sy, 208, 10);
    }
    rg.fillStyle = '#a5a5a5'; rg.fillRect(vx - 120, vy - 80, 240, 160);
  } else if (kind === 1) {
    // hazard-framed maintenance label
    const lx = S * 0.62, ly = S * 0.13, lw = 250, lh = 120;
    g.fillStyle = '#0d1119'; g.fillRect(lx - 8, ly - 8, lw + 16, lh + 16);
    g.fillStyle = '#c9a222'; g.fillRect(lx, ly, lw, lh);
    g.save();
    g.beginPath(); g.rect(lx, ly, lw, lh); g.clip();
    g.fillStyle = '#151310';
    for (let i = -lh; i < lw + lh; i += 34) {
      g.beginPath();
      g.moveTo(lx + i, ly); g.lineTo(lx + i + 17, ly); g.lineTo(lx + i + 17 - lh, ly + lh); g.lineTo(lx + i - lh, ly + lh);
      g.fill();
    }
    g.restore();
    g.fillStyle = '#e8edf5';
    g.fillRect(lx + 22, ly + 24, lw - 44, lh - 48);
    g.fillStyle = '#232a36';
    for (let i = 0; i < 4; i++) g.fillRect(lx + 38, ly + 38 + i * 14, (lw - 76) * (0.5 + rng.next() * 0.5), 7);
    rg.fillStyle = '#b4b4b4'; rg.fillRect(lx - 8, ly - 8, lw + 16, lh + 16);
  } else {
    // painted conduit runs down the right panel
    const px = S * 0.76;
    g.fillStyle = '#2c3647'; g.fillRect(px - 26, 0, 52, S);
    g.fillStyle = '#0a0d14'; g.fillRect(px - 30, 0, 4, S); g.fillRect(px + 26, 0, 4, S);
    for (let y = 90; y < S; y += 190) {
      g.fillStyle = '#39455c'; g.fillRect(px - 34, y, 68, 22);
      hg.fillStyle = '#c8c8c8'; hg.fillRect(px - 34, y, 68, 22);
    }
    hg.fillStyle = '#6a6a6a'; hg.fillRect(px - 26, 0, 52, S);
  }
  // vertical streaks + grime
  for (let i = 0; i < 26; i++) {
    const x = rng.next() * S;
    g.fillStyle = `rgba(0,0,0,${(0.03 + rng.next() * 0.05).toFixed(3)})`;
    g.fillRect(x, rng.next() * S * 0.4, 2 + rng.next() * 5, S * (0.3 + rng.next() * 0.5));
  }
  grime(g, rng, S, S, 30, 0.08);
  scratches(g, rng, S, S, 22);
  return {
    map: toTexture(c),
    normalMap: toTexture(normalFromHeight(hc, 1.8), { srgb: false }),
    roughnessMap: toTexture(rc, { srgb: false }),
  };
}

export function makeWallMaps(rng) {
  return [drawWallVariant(rng, 0), drawWallVariant(rng, 1), drawWallVariant(rng, 2)];
}

export function makeCeilingMaps(rng) {
  const S = 512;
  const c = makeCanvas(S), g = c.getContext('2d');
  g.fillStyle = '#0b0f17'; g.fillRect(0, 0, S, S);
  for (let p = 0; p < 4; p++) {
    const ox = (p % 2) * 256, oy = ((p / 2) | 0) * 256;
    const v = (rng.next() - 0.5) * 0.06;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v.toFixed(3)})` : `rgba(0,0,0,${(-v).toFixed(3)})`;
    g.fillRect(ox, oy, 256, 256);
    g.fillStyle = '#04060a';
    g.fillRect(ox, oy, 256, 4); g.fillRect(ox, oy + 252, 256, 4);
    g.fillRect(ox, oy, 4, 256); g.fillRect(ox + 252, oy, 4, 256);
  }
  grime(g, rng, S, S, 20, 0.12);
  return { map: toTexture(c) };
}

export function makeDoorMaps() {
  const S = 512;
  const c = makeCanvas(S), g = c.getContext('2d');
  g.fillStyle = '#2a3342'; g.fillRect(0, 0, S, S);
  // vertical brushing
  for (let x = 0; x < S; x += 2) {
    g.fillStyle = `rgba(${Math.random() > 0.5 ? '255,255,255' : '0,0,0'},${(0.02 + Math.random() * 0.05).toFixed(3)})`;
    g.fillRect(x, 0, 1, S);
  }
  // center seam + kick plate
  g.fillStyle = '#0a0d14'; g.fillRect(S / 2 - 3, 0, 6, S);
  g.fillStyle = '#1a212d'; g.fillRect(0, S - 70, S, 70);
  g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(0, S - 70, S, 2);
  return { map: toTexture(c, { repeat: false }) };
}

// emissive floor arrow pointing canvas-up (+y)
export function makeArrowTexture() {
  const S = 256;
  const c = makeCanvas(S), g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  g.fillStyle = '#ffb43c';
  g.shadowColor = '#ffb43c';
  g.shadowBlur = 18;
  for (let i = 0; i < 3; i++) {
    const y = 60 + i * 62;
    g.beginPath();
    g.moveTo(48, y + 44); g.lineTo(128, y); g.lineTo(208, y + 44);
    g.lineTo(208, y + 18); g.lineTo(128, y - 26); g.lineTo(48, y + 18);
    g.closePath(); g.fill();
  }
  return toTexture(c, { repeat: false });
}

export function makeChevronTexture() {
  const S = 256;
  const c = makeCanvas(S), g = c.getContext('2d');
  g.fillStyle = '#151310'; g.fillRect(0, 0, S, S);
  g.fillStyle = '#c9a222';
  for (let i = -S; i < S * 2; i += 56) {
    g.beginPath();
    g.moveTo(i, 0); g.lineTo(i + 28, 0); g.lineTo(i + 28 - S, S); g.lineTo(i - S, S);
    g.fill();
  }
  return toTexture(c);
}

export function makeGlowSprite() {
  const S = 128;
  const c = makeCanvas(S), g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return toTexture(c, { repeat: false });
}

export function makeSignTexture(text) {
  const c = makeCanvas(512, 128);
  const g = c.getContext('2d');
  g.fillStyle = '#0b101b'; g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#35e0ff'; g.lineWidth = 4; g.strokeRect(6, 6, 500, 116);
  g.fillStyle = '#9fdcff';
  g.font = 'bold 44px ui-monospace, Menlo, Consolas, monospace';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = '#35e0ff'; g.shadowBlur = 14;
  g.fillText(text, 256, 66);
  return toTexture(c, { repeat: false });
}

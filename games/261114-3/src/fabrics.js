// Procedural printed-cotton fabrics for the tote-bag cloth.
// Every texture is painted on a canvas at load time (no files, no text).
// Panel maps cover the whole 2.0 x 4.4 panel once (no visible tiling of the print);
// the weave normal map tiles at thread scale.
import * as THREE from 'three';

const PW = 2.0, PL = 4.4;            // panel size (units)
const S = 256;                       // map pixels per unit
const MW = 512, MH = Math.round(PL * S); // 512 x 1126
export const STRAP = { len: 2.91, overlap: 0.2, width: 0.22 }; // keep in sync with cloth.js handle layout

export const FABRICS = [
  { id: 'gingham', base: '#fbf8f1', handleColor: 0xb3302f, chalk: 'rgba(120,170,225,0.85)', hemThread: '#e9e2d6', sheen: 0xfff3f0 },
  { id: 'dots', base: '#86c4ea', handleColor: 0x2b4c84, chalk: 'rgba(255,255,255,0.9)', hemThread: '#6eaedb', sheen: 0xeaf6ff },
  { id: 'flower', base: '#f6e6ad', handleColor: 0x6d9a4a, chalk: 'rgba(110,160,220,0.85)', hemThread: '#e6d394', sheen: 0xfffbe8 },
  { id: 'berry', base: '#f7c5cf', handleColor: 0xc23a5c, chalk: 'rgba(255,255,255,0.92)', hemThread: '#eaaab7', sheen: 0xfff0f3 },
];

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbStr(r, g, b, a = 1) { return `rgba(${r | 0},${g | 0},${b | 0},${a})`; }
function mixHex(h, to, t) { const a = hexToRgb(h), b = hexToRgb(to); return rgbStr(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t); }

// ---------- print painters (pixel coords, S px per unit) ----------
const PRINTS = {
  gingham(ctx, r) {
    const cs = 0.14 * S;                         // check size
    const ox = MW / 2 - cs / 2, oy = MH / 2 - cs / 2;
    ctx.fillStyle = 'rgba(206,46,52,0.52)';
    for (let x = ox - Math.ceil(ox / (2 * cs)) * 2 * cs; x < MW; x += 2 * cs) {
      const j = (r() - 0.5) * 0.8; ctx.fillRect(x + j, 0, cs + (r() - 0.5) * 0.8, MH);
    }
    for (let y = oy - Math.ceil(oy / (2 * cs)) * 2 * cs; y < MH; y += 2 * cs) {
      const j = (r() - 0.5) * 0.8; ctx.fillRect(0, y + j, MW, cs + (r() - 0.5) * 0.8);
    }
    // woven-check look: thin thread lines inside the coloured bands
    ctx.fillStyle = 'rgba(150,20,30,0.10)';
    for (let x = 0; x < MW; x += 3) ctx.fillRect(x, 0, 1, MH);
    for (let y = 0; y < MH; y += 3) ctx.fillRect(0, y, MW, 1);
  },
  dots(ctx, r) {
    const sp = 0.24 * S, rad = 0.056 * S;
    let row = 0;
    for (let y = -sp; y < MH + sp; y += sp * 0.5, row++) {
      const off = (row % 2) * sp * 0.5;
      for (let x = -sp + off; x < MW + sp; x += sp) {
        const cx = x + (r() - 0.5) * 1.2, cy = y + (r() - 0.5) * 1.2, rr = rad * (0.97 + r() * 0.06);
        ctx.fillStyle = 'rgba(255,255,253,0.35)';
        ctx.beginPath(); ctx.arc(cx, cy, rr + 0.8, 0, 6.2832); ctx.fill();
        ctx.fillStyle = `rgba(255,255,252,${0.9 + r() * 0.08})`;
        ctx.beginPath(); ctx.ellipse(cx, cy, rr, rr * (0.97 + r() * 0.05), r() * 3, 0, 6.2832); ctx.fill();
      }
    }
  },
  flower(ctx, r) {
    const pal = ['#ffffff', '#f39ab2', '#f5a06a', '#97c4ea', '#c7a3e2', '#ffffff', '#f39ab2'];
    const cell = 0.3 * S;
    for (let gy = 0; gy < MH / cell + 1; gy++) for (let gx = 0; gx < MW / cell + 1; gx++) {
      const cx = (gx + 0.15 + r() * 0.7) * cell, cy = (gy + 0.15 + r() * 0.7) * cell;
      // leaves
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(r() * 6.28);
      const rad = (0.062 + r() * 0.024) * S;
      ctx.fillStyle = '#7fae62';
      for (let k = 0; k < 2; k++) { ctx.beginPath(); ctx.ellipse(rad * 1.05, (k ? 1 : -1) * rad * 0.35, rad * 0.55, rad * 0.22, (k ? 0.5 : -0.5), 0, 6.2832); ctx.fill(); }
      ctx.fillStyle = pal[(r() * pal.length) | 0];
      for (let k = 0; k < 5; k++) {
        ctx.rotate(6.2832 / 5);
        ctx.beginPath(); ctx.ellipse(0, -rad * 0.56, rad * 0.37, rad * 0.55, 0, 0, 6.2832); ctx.fill();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.06)';
      for (let k = 0; k < 5; k++) { ctx.rotate(6.2832 / 5); ctx.fillRect(-0.4, -rad * 0.95, 0.8, rad * 0.6); }
      ctx.fillStyle = '#f1bf2c'; ctx.beginPath(); ctx.arc(0, 0, rad * 0.27, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#d68e1e'; ctx.beginPath(); ctx.arc(rad * 0.05, rad * 0.05, rad * 0.11, 0, 6.2832); ctx.fill();
      ctx.restore();
      // small buds / dots
      if (r() < 0.8) {
        const bx = cx + (r() - 0.5) * cell * 0.9 + cell * 0.45, by = cy + (r() - 0.5) * cell * 0.9;
        ctx.fillStyle = pal[(r() * pal.length) | 0];
        for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(bx + Math.cos(k * 2.1) * 2.6, by + Math.sin(k * 2.1) * 2.6, 2.3, 0, 6.2832); ctx.fill(); }
        ctx.fillStyle = '#7fae62'; ctx.beginPath(); ctx.arc(bx, by, 1.4, 0, 6.2832); ctx.fill();
      }
    }
  },
  berry(ctx, r) {
    const cell = 0.27 * S;
    for (let gy = 0; gy < MH / cell + 1; gy++) for (let gx = 0; gx < MW / cell + 1; gx++) {
      const cx = (gx + 0.2 + r() * 0.6) * cell, cy = (gy + 0.2 + r() * 0.6) * cell;
      const s = (0.85 + r() * 0.3) * S * 0.0042;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate((r() - 0.5) * 1.6 + (r() < 0.5 ? Math.PI : 0)); ctx.scale(s, s);
      ctx.fillStyle = '#e2394f';
      ctx.beginPath(); ctx.moveTo(0, 11); ctx.bezierCurveTo(-9, 5, -10.5, -5, -5.5, -8); ctx.bezierCurveTo(-2.5, -9.6, 2.5, -9.6, 5.5, -8); ctx.bezierCurveTo(10.5, -5, 9, 5, 0, 11); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.beginPath(); ctx.ellipse(-3.5, -3, 2.2, 4, 0.35, 0, 6.2832); ctx.fill();
      ctx.fillStyle = 'rgba(120,0,20,0.18)'; ctx.beginPath(); ctx.ellipse(3.5, 2, 3, 6, -0.3, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#ffe8a6';
      const seeds = [[-4, -3], [0, -4], [4, -3], [-5, 1.5], [-1.5, 0.5], [2.5, 0.5], [5, 1.8], [-2, 5], [2, 5], [0, 8.5]];
      for (const [sx, sy] of seeds) { ctx.beginPath(); ctx.ellipse(sx, sy, 0.75, 1.05, 0, 0, 6.2832); ctx.fill(); }
      ctx.fillStyle = '#4f9a43';
      for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + (k - 2) * 0.62; ctx.beginPath(); ctx.ellipse(Math.cos(a) * 3.2, -8.3 + Math.sin(a) * 1.6 + 1.6, 3.4, 1.3, a, 0, 6.2832); ctx.fill(); }
      ctx.fillRect(-0.7, -13, 1.4, 4.5);
      ctx.restore();
      if (r() < 0.75) { // tiny white blossoms as filler
        const bx = cx + cell * 0.5 + (r() - 0.5) * cell * 0.5, by = cy + cell * 0.45 + (r() - 0.5) * cell * 0.5;
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(bx + Math.cos(k * 1.571 + 0.4) * 2.2, by + Math.sin(k * 1.571 + 0.4) * 2.2, 1.9, 0, 6.2832); ctx.fill(); }
        ctx.fillStyle = '#f2c24a'; ctx.beginPath(); ctx.arc(bx, by, 1.2, 0, 6.2832); ctx.fill();
      }
    }
  },
};

// ---------- shared cloth texture overlays ----------
let weavePat = null;
function fabricGrain(ctx, w, h, r, strength = 1) {
  // low-frequency mottling (uneven dye / ink)
  const nw = 40, nh = Math.round(40 * h / w), nc = canvas(nw, nh), nx = nc.getContext('2d'), id = nx.createImageData(nw, nh);
  for (let i = 0; i < nw * nh; i++) { const v = 128 + (r() - 0.5) * 40; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
  nx.putImageData(id, 0, 0);
  ctx.save(); ctx.imageSmoothingEnabled = true;
  ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.22 * strength; ctx.drawImage(nc, 0, 0, w, h);
  ctx.restore();
  // thread streaks: slubby weft and warp
  ctx.save();
  for (let y = 0; y < h; y += 1) {
    const v = r(); if (v < 0.55) continue;
    ctx.fillStyle = v < 0.8 ? `rgba(0,0,0,${(0.012 + r() * 0.04) * strength})` : `rgba(255,255,255,${(0.02 + r() * 0.05) * strength})`;
    const x0 = r() * w * 0.7; ctx.fillRect(x0 - w * 0.2, y, w * (0.3 + r() * 0.9), 1);
  }
  for (let x = 0; x < w; x += 1) {
    const v = r(); if (v < 0.6) continue;
    ctx.fillStyle = v < 0.82 ? `rgba(0,0,0,${(0.01 + r() * 0.035) * strength})` : `rgba(255,255,255,${(0.02 + r() * 0.04) * strength})`;
    const y0 = r() * h * 0.7; ctx.fillRect(x, y0 - h * 0.2, 1, h * (0.3 + r() * 0.9));
  }
  // plain-weave micro checker (2 px per thread)
  if (!weavePat) {
    const pc = canvas(4, 4), px = pc.getContext('2d');
    px.fillStyle = 'rgba(0,0,0,0.11)'; px.fillRect(0, 0, 2, 1); px.fillRect(2, 2, 2, 1); px.fillRect(1, 1, 1, 2); px.fillRect(3, 3, 1, 1); px.fillRect(3, 0, 1, 1);
    px.fillStyle = 'rgba(255,255,255,0.10)'; px.fillRect(2, 0, 1, 1); px.fillRect(0, 2, 1, 1);
    weavePat = pc;
  }
  ctx.globalAlpha = strength; ctx.fillStyle = ctx.createPattern(weavePat, 'repeat'); ctx.fillRect(0, 0, w, h);
  ctx.restore();
}
function edgeShade(ctx, w, h, a = 0.18) {
  const n = 4;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = `rgba(40,25,15,${a * (1 - i / n) * (1 - i / n)})`;
    ctx.fillRect(i, 0, 1, h); ctx.fillRect(w - 1 - i, 0, 1, h); ctx.fillRect(0, i, w, 1); ctx.fillRect(0, h - 1 - i, w, 1);
  }
}
function stitchLine(ctx, x0, y0, x1, y1, color, r, len = 5, gap = 2.6, wdt = 1.6) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
  ctx.save(); ctx.lineCap = 'round';
  for (let s = 0; s < L - len * 0.5; s += len + gap) {
    const j = (r() - 0.5) * 0.5;
    const ax = x0 + ux * s - uy * j, ay = y0 + uy * s + ux * j, bx = ax + ux * len, by = ay + uy * len;
    ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = wdt + 0.8; ctx.beginPath(); ctx.moveTo(ax + 0.4, ay + 0.6); ctx.lineTo(bx + 0.4, by + 0.6); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = wdt; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }
  ctx.restore();
}
function boxStitch(ctx, cx, y0, y1, hw, color, r) {
  const x0 = cx - hw, x1 = cx + hw;
  stitchLine(ctx, x0, y0, x1, y0, color, r, 3.4, 1.6, 1.3); stitchLine(ctx, x1, y0, x1, y1, color, r, 3.4, 1.6, 1.3);
  stitchLine(ctx, x1, y1, x0, y1, color, r, 3.4, 1.6, 1.3); stitchLine(ctx, x0, y1, x0, y0, color, r, 3.4, 1.6, 1.3);
  stitchLine(ctx, x0, y0, x1, y1, color, r, 3.4, 1.6, 1.3); stitchLine(ctx, x1, y0, x0, y1, color, r, 3.4, 1.6, 1.3);
}
function hemShading(ctx, y, dir, a) {
  // soft ridge where the turned-under hem edge ends (dir: +1 going down the canvas from the end)
  for (let i = -3; i <= 3; i++) { ctx.fillStyle = `rgba(30,20,10,${a * (1 - Math.abs(i) / 4) * (i * dir > 0 ? 1 : 0.5)})`; ctx.fillRect(0, y + i, MW, 1); }
}

function setupMap(tex, srgb) {
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 4; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true; return tex;
}

// ---------- weave normal map (shared) ----------
let weaveNormal = null;
function getWeaveNormal() {
  if (weaveNormal) return weaveNormal;
  const N = 256, T = 32, P = N / T, r = rng(77);
  const h = new Float32Array(N * N), thW = new Float32Array(T), thF = new Float32Array(T);
  for (let i = 0; i < T; i++) { thW[i] = 0.82 + r() * 0.36; thF[i] = 0.82 + r() * 0.36; }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (x / P) | 0, j = (y / P) | 0, fx = (x % P + 0.5) / P, fy = (y % P + 0.5) / P;
    const pw = Math.sin(Math.PI * fx), pf = Math.sin(Math.PI * fy);
    const uw = 0.5 + 0.5 * Math.cos(Math.PI * ((y + 0.5) / P - 0.5) + Math.PI * i);
    const uf = 0.5 - 0.5 * Math.cos(Math.PI * ((x + 0.5) / P - 0.5) + Math.PI * j);
    const hw = Math.sqrt(pw) * (0.3 + 0.7 * uw) * thW[i], hf = Math.sqrt(pf) * (0.3 + 0.7 * uf) * thF[j];
    h[y * N + x] = Math.max(hw, hf) + (r() - 0.5) * 0.06;
  }
  const c = canvas(N, N), ctx = c.getContext('2d'), id = ctx.createImageData(N, N), d = id.data, k = 1.6;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const hx = h[y * N + ((x + 1) % N)] - h[y * N + ((x + N - 1) % N)];
    const hy = h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x];
    let nx = -hx * k, ny = hy * k, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const o = (y * N + x) * 4; d[o] = (nx * 0.5 + 0.5) * 255; d[o + 1] = (ny * 0.5 + 0.5) * 255; d[o + 2] = (nz * 0.5 + 0.5) * 255; d[o + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  const t = setupMap(new THREE.CanvasTexture(c), false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(PW / 0.25, PL / 0.25);
  return (weaveNormal = t);
}

// ---------- webbing strap ----------
const strapCache = new Map();
let strapNormal = null;
export function getStrapTextures(color) {
  if (strapCache.has(color)) return strapCache.get(color);
  const w = 64, h = 1024, c = canvas(w, h), ctx = c.getContext('2d'), r = rng(color);
  const col = new THREE.Color(color), hex = '#' + col.getHexString();
  ctx.fillStyle = hex; ctx.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 2) { ctx.fillStyle = (x / 2) % 2 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.10)'; ctx.fillRect(x, 0, 1, h); }
  for (let y = 0; y < h; y += 2) { ctx.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.04})`; ctx.fillRect(0, y, w, 1); }
  // folded edges of the webbing: darker rim + highlight line
  ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(0, 0, 3, h); ctx.fillRect(w - 3, 0, 3, h);
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(4, 0, 1, h); ctx.fillRect(w - 5, 0, 1, h);
  const ovPx = Math.round(STRAP.overlap / STRAP.len * h);
  const thread = mixHex(hex, '#ffffff', 0.35);
  for (const [y0, y1] of [[4, ovPx - 4], [h - ovPx + 4, h - 4]]) {
    const x0 = 8, x1 = w - 8;
    const rr = rng(5);
    stitchLine(ctx, x0, y0, x1, y0, thread, rr, 3.2, 1.6, 1.4); stitchLine(ctx, x1, y0, x1, y1, thread, rr, 3.2, 1.6, 1.4);
    stitchLine(ctx, x1, y1, x0, y1, thread, rr, 3.2, 1.6, 1.4); stitchLine(ctx, x0, y1, x0, y0, thread, rr, 3.2, 1.6, 1.4);
    stitchLine(ctx, x0, y0, x1, y1, thread, rr, 3.2, 1.6, 1.4); stitchLine(ctx, x1, y0, x0, y1, thread, rr, 3.2, 1.6, 1.4);
  }
  const map = setupMap(new THREE.CanvasTexture(c), true);
  if (!strapNormal) {
    const n = 32, nc = canvas(n, n), nx = nc.getContext('2d'), id = nx.createImageData(n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const a = Math.cos((x / n) * Math.PI * 2 * 8), bb = Math.sin(((x + y) / n) * Math.PI * 2 * 4) * 0.25; // ribs + faint twill
      const nxv = -Math.sin((x / n) * Math.PI * 2 * 8) * 0.45 + bb * 0.3, nyv = bb * 0.3, l = Math.hypot(nxv, nyv, 1);
      const o = (y * n + x) * 4; id.data[o] = (nxv / l * 0.5 + 0.5) * 255; id.data[o + 1] = (nyv / l * 0.5 + 0.5) * 255; id.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; id.data[o + 3] = 255; void a;
    }
    nx.putImageData(id, 0, 0);
    strapNormal = setupMap(new THREE.CanvasTexture(nc), false);
    strapNormal.wrapS = strapNormal.wrapT = THREE.RepeatWrapping; strapNormal.repeat.set(1, STRAP.len / 0.06);
  }
  const res = { map, normalMap: strapNormal };
  strapCache.set(color, res);
  return res;
}

// ---------- panel maps ----------
const cache = new Map();
export function getFabric(id) {
  const def = FABRICS.find((f) => f.id === id) || FABRICS[0];
  if (cache.has(def.id)) return cache.get(def.id);
  const t0 = performance.now();
  const r = rng([...def.id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7));
  // 1) printed outside (base + print + cloth grain)
  const pc = canvas(MW, MH), p = pc.getContext('2d');
  p.fillStyle = def.base; p.fillRect(0, 0, MW, MH);
  PRINTS[def.id](p, r);
  fabricGrain(p, MW, MH, r, 1);
  // 2) inside: greige reverse with faint show-through and the turned hem (which shows the print)
  const bc = canvas(MW, MH), b = bc.getContext('2d');
  b.fillStyle = mixHex(def.base, '#f3eee4', 0.78); b.fillRect(0, 0, MW, MH);
  const small = canvas(MW / 4, MH / 4); small.getContext('2d').drawImage(pc, 0, 0, MW / 4, MH / 4);
  b.save(); b.globalAlpha = 0.2; b.imageSmoothingEnabled = true; b.drawImage(small, 0, 0, MW, MH); b.restore();
  fabricGrain(b, MW, MH, r, 1.25);
  const hemPx = Math.round(0.12 * S);
  // turned hem band: print side folded over, with its raw edge folded under (a slight ridge)
  b.save(); b.translate(0, hemPx); b.scale(1, -1); b.drawImage(pc, 0, 0, MW, hemPx, 0, 0, MW, hemPx); b.restore();
  b.save(); b.translate(0, MH - hemPx); b.scale(1, -1); b.drawImage(pc, 0, MH - hemPx, MW, hemPx, 0, -hemPx, MW, hemPx); b.restore();
  for (let i = 0; i < 5; i++) {
    b.fillStyle = `rgba(30,20,10,${0.16 * (1 - i / 5)})`; b.fillRect(0, hemPx + i, MW, 1); b.fillRect(0, MH - hemPx - 1 - i, MW, 1);
    b.fillStyle = `rgba(255,255,255,${0.12 * (1 - i / 5)})`; b.fillRect(0, hemPx - 1 - i, MW, 1); b.fillRect(0, MH - hemPx + i, MW, 1);
  }
  const hemY = 0.1 * S;
  stitchLine(b, 6, hemY, MW - 6, hemY, def.hemThread, r); stitchLine(b, 6, MH - hemY, MW - 6, MH - hemY, def.hemThread, r);
  edgeShade(b, MW, MH, 0.14);
  // 3) outside construction details
  stitchLine(p, 4, hemY, MW - 4, hemY, def.hemThread, r); stitchLine(p, 4, MH - hemY, MW - 4, MH - hemY, def.hemThread, r);
  hemShading(p, hemPx + 1, 1, 0.07); hemShading(p, MH - hemPx - 1, -1, 0.07);
  for (let i = 0; i < 3; i++) { p.fillStyle = `rgba(255,255,255,${0.10 * (1 - i / 3)})`; p.fillRect(0, 4 + i, MW, 1); p.fillRect(0, MH - 5 - i, MW, 1); }
  edgeShade(p, MW, MH, 0.2);
  // chalk guide lines (dashed) along both long edges, SEAM_IN from the edge
  const cx = [0.09 * S, MW - 0.09 * S];
  for (const x of cx) {
    for (let y = 0.14 * S; y < MH - 0.14 * S; y += 0.13 * S) {
      const len = 0.075 * S;
      for (let k = 0; k < 7; k++) {
        p.fillStyle = def.chalk.replace(/[\d.]+\)$/, (0.18 + r() * 0.22) + ')');
        const jx = (r() - 0.5) * 2.2, jy = r() * 3;
        p.fillRect(x - 1.3 + jx, y + jy, 2.2 + r() * 1.2, len - jy - r() * 3);
      }
    }
  }
  // box stitches where the handles are sewn on (through all layers)
  const hc = '#' + new THREE.Color(def.handleColor).getHexString();
  for (const u of [0.3, 0.7]) {
    const x = u * MW, hw = 0.075 * S;
    boxStitch(p, x, 0.035 * S, 0.185 * S, hw, hc, r);
    boxStitch(p, x, MH - 0.185 * S, MH - 0.035 * S, hw, hc, r);
  }
  const map = setupMap(new THREE.CanvasTexture(pc), true);
  const backMap = setupMap(new THREE.CanvasTexture(bc), true);
  const strap = getStrapTextures(def.handleColor);
  const res = {
    id: def.id, map, backMap, normalMap: getWeaveNormal(), roughnessMap: null,
    handleColor: def.handleColor, sheenColor: def.sheen, strapMap: strap.map, strapNormalMap: strap.normalMap,
    genMs: performance.now() - t0,
  };
  cache.set(def.id, res);
  return res;
}

// 背景と光: 部屋（ミシン台の朝）と公園（木陰のピクニック）。テクスチャはすべて起動時にcanvasで手描き生成。
// 単位: 1 = 10cm, y上, +z手前。テーブル天板は y=0。
import * as THREE from 'three';

// ---------- 小さな道具 ----------
function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const LAT = (() => { const r = rng(7), a = new Float32Array(256 * 256); for (let i = 0; i < a.length; i++) a[i] = r(); return a; })();
// 周期つき value noise（px,py は格子単位の周期, ≤256）
function vn(x, y, px = 256, py = 256) {
  px = Math.max(1, Math.round(px)); py = Math.max(1, Math.round(py));
  const xf = Math.floor(x), yf = Math.floor(y);
  let fx = x - xf, fy = y - yf;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const x0 = ((xf % px) + px) % px, y0 = ((yf % py) + py) % py;
  const x1 = ((x0 + 1) % px) & 255, y1 = ((y0 + 1) % py) & 255, xa = x0 & 255, ya = y0 & 255;
  const a = LAT[(ya << 8) + xa], b = LAT[(ya << 8) + x1], c = LAT[(y1 << 8) + xa], d = LAT[(y1 << 8) + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(x, y, oct, px = 256, py = 256) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vn(x, y, px, py); n += a; x *= 2; y *= 2; px *= 2; py *= 2; a *= 0.5; }
  return s / n;
}
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, { srgb = true, repeat = false, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  return t;
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;

// ---------- 木目（オーク, 木目は u 方向） ----------
// tileU,tileV: タイルが表す実寸(単位)。planks: 板幅（合計 tileV）。戻り値 {map, data}（data: R=高さ, G=粗さ係数）
function paintWood({ W = 1024, H = 1024, tileU = 6, tileV = 5.5, planks = [1.05, 1.2, 1.1, 1.15, 1.0], seed = 1,
  base = [196, 150, 102], joints = true, pores = 7000 } = {}) {
  const r = rng(seed);
  const cw = W >> 2; // 木目方向（u）は1/4の解像度で計算して拡大（木目はu方向にゆっくり変化）
  const col = canvas(cw, H), dat = canvas(cw, H);
  const ci = col.getContext('2d').createImageData(cw, H), di = dat.getContext('2d').createImageData(cw, H);
  const P = planks.map((w) => ({
    w, c0: (r() - 0.5) * w * 2.2, dens: 7 + r() * 6, k1: 1 + (r() * 2 | 0), ph1: r() * TAU, a1: 0.15 + r() * 0.35,
    k2: 2 + (r() * 2 | 0), ph2: r() * TAU, a2: 0.01 + r() * 0.025, tq: 0.02 + r() * 0.08, k3: 1 + (r() * 2 | 0), ph3: r() * TAU,
    tone: 0.93 + r() * 0.09, warm: (r() - 0.5) * 0.1, off: r() * 200,
  }));
  const starts = []; let acc = 0; for (const p of P) { starts.push(acc); acc += p.w; }
  const pxU = tileU / cw, pxV = tileV / H;
  const fu = (k) => k * TAU / tileU; // 周期的にする角周波数
  for (const p of P) {
    p.cx = new Float32Array(cw); p.tap = new Float32Array(cw);
    for (let i = 0; i < cw; i++) {
      const ux = (i + 0.5) * pxU;
      p.cx[i] = p.c0 + p.a1 * Math.sin(fu(p.k1) * ux + p.ph1) + p.a2 * Math.sin(fu(p.k2) * ux + p.ph2);
      p.tap[i] = p.tq * (1.2 + Math.sin(fu(p.k3) * ux + p.ph3));
    }
  }
  for (let j = 0; j < H; j++) {
    const wz = (j + 0.5) * pxV;
    let pi = 0; while (pi < P.length - 1 && wz >= starts[pi + 1]) pi++;
    const p = P[pi], w = wz - starts[pi];
    const edge = Math.min(w, p.w - w); // 板端までの距離
    for (let i = 0; i < cw; i++) {
      const ux = (i + 0.5) * pxU;
      const cx = p.cx[i], d = w - cx, tap = p.tap[i];
      const warp = (fbm(ux * (1 / 3) + p.off, w * 1.2, 2, tileU / 3, 256) - 0.5) * 1.2 + (vn(ux + p.off, w * 8, tileU, 256) - 0.5) * 0.18;
      const ring = Math.sqrt(d * d + tap) * p.dens + warp;
      const f = ring - Math.floor(ring);
      const late = Math.pow(f, 5) * (1 - sstep(0.94, 1, f)) * 1.25;
      // 細い繊維の筋（u方向に長く, v方向に細かい）
      const streak = vn(ux * 2 + p.off, wz * 90, tileU * 2, 256) * 0.6 + vn(ux * 6 + p.off, wz * 260, tileU * 6, 256) * 0.4;
      const broad = fbm(ux * 0.5 + p.off * 0.3, wz * 0.8, 2, tileU * 0.5, 256);
      let v = p.tone * (1 - 0.14 * late - 0.11 * streak + 0.12 * (broad - 0.5));
      let gap = 1;
      if (joints) { gap = 0.62 + 0.38 * sstep(0.003, 0.016, edge); }
      const o = (j * cw + i) * 4;
      const warmS = p.warm + 0.03 * (broad - 0.5);
      ci.data[o] = Math.min(255, base[0] * v * gap * (1 + warmS));
      ci.data[o + 1] = Math.min(255, base[1] * v * gap);
      ci.data[o + 2] = Math.min(255, base[2] * v * gap * (1 - warmS * 1.5) * (1 - 0.1 * late));
      ci.data[o + 3] = 255;
      di.data[o] = 200 - 55 * late - 20 * streak - (1 - gap) * 300;
      di.data[o + 1] = 205 + 30 * late + 15 * streak + (1 - gap) * 100;
      di.data[o + 2] = 0; di.data[o + 3] = 255;
    }
  }
  col.getContext('2d').putImageData(ci, 0, 0); dat.getContext('2d').putImageData(di, 0, 0);
  const C = canvas(W, H), D = canvas(W, H);
  const cc = C.getContext('2d'), dc = D.getContext('2d');
  cc.imageSmoothingQuality = dc.imageSmoothingQuality = 'high';
  cc.drawImage(col, 0, 0, W, H); dc.drawImage(dat, 0, 0, W, H);
  // 導管（細かい暗いダッシュ）
  cc.fillStyle = 'rgba(90,58,30,0.22)'; dc.fillStyle = 'rgba(40,255,0,0.5)';
  for (let n = 0; n < pores; n++) {
    const x = r() * W, y = r() * H, l = 2 + r() * r() * 9, t = r() < 0.7 ? 1 : 1.6;
    cc.fillRect(x, y, l, t); dc.fillRect(x, y, l, t);
    if (x + l > W) { cc.fillRect(x - W, y, l, t); dc.fillRect(x - W, y, l, t); }
  }
  return { map: C, data: D };
}

// ---------- 漆喰の壁 ----------
function paintWall(winC) {
  const W = 256, H = 176, c = canvas(W, H), x = c.getContext('2d'), im = x.createImageData(W, H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const wx = -14 + 28 * i / W, wy = 16 - 19 * j / H;
    const m = fbm(i / 20, j / 20, 3) - 0.5, m2 = vn(i / 3, j / 3) - 0.5;
    const dw = Math.hypot((wx - winC[0]) / 6, (wy - winC[1]) / 6);
    const glow = 0.07 * Math.exp(-dw * dw * 1.2);
    const fall = -0.07 * sstep(3, 16, wy) - 0.06 * sstep(2, 14, wx) - 0.03 * sstep(8, 14, -wx);
    const v = 1 + m * 0.06 + m2 * 0.015 + glow + fall;
    const o = (j * W + i) * 4;
    im.data[o] = 238 * v; im.data[o + 1] = 231 * v; im.data[o + 2] = 219 * v; im.data[o + 3] = 255;
  }
  x.putImageData(im, 0, 0);
  return c;
}
function paintStucco() {
  const S = 256, c = canvas(S, S), x = c.getContext('2d'), im = x.createImageData(S, S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const v = 0.55 * fbm(i / 8, j / 8, 3, 32, 32) + 0.45 * vn(i / 2, j / 2, 128, 128);
    const o = (j * S + i) * 4; im.data[o] = im.data[o + 1] = im.data[o + 2] = v * 255; im.data[o + 3] = 255;
  }
  x.putImageData(im, 0, 0); return c;
}

// ---------- ぼけた屋外（窓の外 / 公園の背景） ----------
function blob(x, cx, cy, r, col, a) {
  const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${a})`);
  g.addColorStop(0.55, `rgba(${col[0]},${col[1]},${col[2]},${a * 0.75})`);
  g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
  x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2);
}
function paintWindowView() {
  const W = 192, H = 288, c = canvas(W, H), x = c.getContext('2d'), r = rng(31);
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#dfeaf3'); g.addColorStop(0.45, '#eef3f2'); g.addColorStop(1, '#e8eee2');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  // 木の葉のぼけ（下と左右に多い）
  const greens = [[150, 178, 120], [118, 152, 96], [176, 196, 140], [96, 128, 84], [196, 210, 160]];
  for (let n = 0; n < 70; n++) {
    const side = r();
    const cx = side < 0.4 ? r() * W * 0.45 : side < 0.65 ? W * (0.65 + r() * 0.4) : r() * W;
    const cy = side < 0.65 ? H * (0.15 + r() * 0.85) : H * (0.6 + r() * 0.45);
    blob(x, cx, cy, 14 + r() * 30, greens[r() * greens.length | 0], 0.35 + r() * 0.35);
  }
  // 光の抜け（明るい丸ぼけ）
  for (let n = 0; n < 26; n++) blob(x, r() * W, r() * H * 0.8, 5 + r() * 12, [252, 252, 240], 0.5 + r() * 0.4);
  return c;
}
function paintParkBackdrop() {
  // u: 周囲360°, v: 下→上（canvas は上が空）。帯の下部は透明にして芝へ溶け込ませる
  const W = 1024, H = 256, c = canvas(W, H), x = c.getContext('2d'), r = rng(57);
  const sky = x.createLinearGradient(0, 0, 0, H * 0.7);
  sky.addColorStop(0, '#8fb4dc'); sky.addColorStop(0.45, '#bcd3e6'); sky.addColorStop(0.7, '#d4e0dc'); sky.addColorStop(1, '#a9bb92');
  x.fillStyle = sky; x.fillRect(0, 0, W, H);
  const hz = H * 0.83; // 木立の根元
  const greens = [[74, 104, 58], [96, 126, 70], [122, 148, 86], [58, 84, 50], [142, 164, 104], [108, 132, 78]];
  const draw = (cx, cy, rad, col, a) => { for (const o of [-W, 0, W]) if (cx + o + rad > 0 && cx + o - rad < W) blob(x, cx + o, cy, rad, col, a); };
  // 遠い木立（かすんだ緑）
  for (let n = 0; n < 160; n++) {
    const cx = r() * W, top = hz - (30 + 60 * vn(cx / 60, 3, W / 60, 256) + r() * 40);
    const cy = top + r() * (hz - top + 10);
    draw(cx, cy, 10 + r() * 22, [150 + r() * 20, 172 + r() * 15, 140], 0.45);
  }
  // 手前の木立（濃い緑のぼけ）
  for (let n = 0; n < 260; n++) {
    const cx = r() * W, top = hz - (10 + 70 * vn(cx / 90 + 9, 1, W / 90, 256) + r() * 30);
    const cy = top + Math.pow(r(), 0.7) * (hz - top + 14);
    draw(cx, cy, 8 + r() * 22, greens[r() * greens.length | 0], 0.55 + r() * 0.35);
  }
  // 葉の隙間の光
  for (let n = 0; n < 90; n++) {
    const cx = r() * W, cy = hz - r() * 90;
    draw(cx, cy, 2 + r() * 6, [235, 240, 210], 0.35 + r() * 0.4);
  }
  // 根元をかすみに
  const haze = x.createLinearGradient(0, hz - 30, 0, H);
  haze.addColorStop(0, 'rgba(150,170,120,0)'); haze.addColorStop(0.5, 'rgba(128,152,98,0.6)'); haze.addColorStop(1, 'rgba(112,140,80,0.9)');
  x.fillStyle = haze; x.fillRect(0, hz - 30, W, H - hz + 30);
  // 下端を透明に
  const im = x.getImageData(0, 0, W, H);
  for (let j = Math.floor(hz); j < H; j++) {
    const a = 1 - sstep(hz + 4, H - 6, j);
    for (let i = 0; i < W; i++) im.data[(j * W + i) * 4 + 3] = 255 * a;
  }
  x.putImageData(im, 0, 0);
  return c;
}

// ---------- 芝 ----------
function paintGrass() {
  const S = 512, c = canvas(S, S), x = c.getContext('2d'), r = rng(91), im = x.createImageData(S, S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const n = fbm(i / 32, j / 32, 3, 16, 16), m = vn(i / 3, j / 3, 171, 171);
    const o = (j * S + i) * 4;
    const v = 0.55 + 0.5 * n + 0.15 * m;
    im.data[o] = 72 * v + 40 * (n - 0.5); im.data[o + 1] = 112 * v; im.data[o + 2] = 44 * v; im.data[o + 3] = 255;
  }
  x.putImageData(im, 0, 0);
  // 葉の筋（色ごとにまとめて描く）
  const cols = ['#2f4a1f', '#3c5c26', '#4a6e2c', '#587c33', '#668a3a', '#78983f', '#8aa64a', '#9db35a', '#6f8f3c', '#a8b86a', '#3a5222'];
  x.lineCap = 'round';
  for (let pass = 0; pass < 3; pass++) for (let ci = 0; ci < cols.length; ci++) {
    x.strokeStyle = cols[ci]; x.lineWidth = pass === 2 ? 1 : 1.6; x.globalAlpha = pass === 2 ? 0.8 : 0.9;
    x.beginPath();
    const n = pass === 2 ? 450 : 750;
    for (let k = 0; k < n; k++) {
      const px = r() * S, py = r() * S, a = r() * TAU, l = 3 + r() * (pass === 0 ? 10 : 7);
      const ex = px + Math.cos(a) * l, ey = py + Math.sin(a) * l, bx = px + Math.cos(a + 0.4) * l * 0.5, by = py + Math.sin(a + 0.4) * l * 0.5;
      for (const ox of [0, px < 14 ? S : px > S - 14 ? -S : 0]) for (const oy of [0, py < 14 ? S : py > S - 14 ? -S : 0]) {
        x.moveTo(px + ox, py + oy); x.quadraticCurveTo(bx + ox, by + oy, ex + ox, ey + oy);
      }
    }
    x.stroke();
  }
  x.globalAlpha = 1;
  return c;
}
function paintTuft() {
  const W = 128, H = 128, c = canvas(W, H), x = c.getContext('2d'), r = rng(5);
  x.lineCap = 'round';
  for (let k = 0; k < 34; k++) {
    const bx = 30 + r() * 68, lean = (r() - 0.5) * 50, h = 50 + r() * 74;
    const g = x.createLinearGradient(0, H, 0, H - h);
    const lt = 42 + r() * 26;
    g.addColorStop(0, `hsl(95,35%,${lt * 0.85}%)`); g.addColorStop(1, `hsl(${80 + r() * 20},${40 + r() * 15}%,${lt}%)`);
    x.strokeStyle = g; x.lineWidth = 2 + r() * 2.2;
    x.beginPath(); x.moveTo(bx, H); x.quadraticCurveTo(bx + lean * 0.3, H - h * 0.6, bx + lean, H - h); x.stroke();
  }
  return c;
}
function paintDapple() {
  const S = 256, c = canvas(S, S), x = c.getContext('2d'), r = rng(77);
  x.fillStyle = '#fff'; x.fillRect(0, 0, S, S);
  for (let n = 0; n < 30; n++) {
    const cx = r() * S, cy = r() * S, rad = 12 + r() * 30, v = 170 + r() * 45;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) blob(x, cx + ox, cy + oy, rad, [v, v, v - 4], 0.5 + r() * 0.3);
  }
  // 小さな木漏れ日の抜け
  for (let n = 0; n < 40; n++) {
    const cx = r() * S, cy = r() * S;
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) blob(x, cx + ox, cy + oy, 4 + r() * 7, [255, 255, 255], 0.7);
  }
  return c;
}
function paintGingham() {
  // 1周期(2マス)=256px。平織りの糸を1画素ずつ表現。
  const S = 256, c = canvas(S, S), b = canvas(S, S);
  const x = c.getContext('2d'), y = b.getContext('2d'), im = x.createImageData(S, S), bm = y.createImageData(S, S);
  const white = [252, 251, 247], blue = [58, 100, 172];
  const th = 3; // 糸の太さ(px)
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const sx = i < S / 2, sy = j < S / 2; // 縦糸が青 / 横糸が青
    const ti = Math.floor(i / th), tj = Math.floor(j / th);
    const warpTop = ((ti + tj) & 1) === 0;
    const fi = (i % th) / (th - 1), fj = (j % th) / (th - 1);
    const across = warpTop ? fi : fj; // 糸の断面上の位置
    const shade = 0.88 + 0.12 * Math.sin(across * Math.PI);
    const n = 0.96 + 0.08 * vn(warpTop ? i / 3 : j / 3, warpTop ? j / 40 : i / 40, 86, 7);
    const isBlue = warpTop ? sx : sy;
    const col = isBlue ? blue : white;
    const o = (j * S + i) * 4;
    im.data[o] = col[0] * shade * n; im.data[o + 1] = col[1] * shade * n; im.data[o + 2] = col[2] * shade * n; im.data[o + 3] = 255;
    bm.data[o] = bm.data[o + 1] = bm.data[o + 2] = 255 * shade * shade; bm.data[o + 3] = 255;
  }
  x.putImageData(im, 0, 0); y.putImageData(bm, 0, 0);
  return { map: c, bump: b };
}
function paintLeaf(seed) {
  const W = 64, H = 64, c = canvas(W, H), x = c.getContext('2d'), r = rng(seed);
  const hue = 28 + r() * 30, l = 30 + r() * 18;
  x.fillStyle = `hsl(${hue},${45 + r() * 20}%,${l}%)`;
  x.beginPath(); x.moveTo(32, 4); x.bezierCurveTo(56, 18, 54, 44, 32, 60); x.bezierCurveTo(10, 44, 8, 18, 32, 4); x.fill();
  x.strokeStyle = `hsla(${hue},40%,${l - 12}%,0.7)`; x.lineWidth = 1.2;
  x.beginPath(); x.moveTo(32, 6); x.lineTo(32, 60);
  for (let k = 0; k < 5; k++) { const yy = 16 + k * 8; x.moveTo(32, yy + 4); x.lineTo(20, yy - 2); x.moveTo(32, yy + 4); x.lineTo(44, yy - 2); }
  x.stroke();
  return c;
}

// ---------- 光のプリセット ----------
const PRESETS = {
  room: {
    sunDir: [-7, 11, 4], sunCol: 0xfff0dc, sunI: 2.2,
    hemiSky: 0xfff6ea, hemiGround: 0xa88a6c, hemiI: 0.3,
    fillDir: [-6, 5, -6], fillCol: 0xdfe8f5, fillI: 0.35,
    bg: 0xe6ded1, fog: 0xe6ded1, fogNear: 500, fogFar: 1000, env: 0.55,
  },
  park: {
    sunDir: [6, 12, 5], sunCol: 0xfff3df, sunI: 3.3,
    hemiSky: 0xbcd6f5, hemiGround: 0x6e8a46, hemiI: 0.55,
    fillDir: [-5, 4, -6], fillCol: 0xd8e6ff, fillI: 0.25,
    bg: 0x9dbfe2, fog: 0x9fb07e, fogNear: 25, fogFar: 140, env: 0.38,
  },
  evening: {
    sunDir: [9, 6, 3], sunCol: 0xffb46e, sunI: 2.5,
    hemiSky: 0xd9c2b0, hemiGround: 0x5e6a35, hemiI: 0.85,
    fillDir: [-5, 4, -6], fillCol: 0xb8c2ec, fillI: 0.25,
    bg: 0xd8b99a, fog: 0xa8a070, fogNear: 25, fogFar: 140, env: 0.3,
  },
};

export function createWorld(scene, renderer) {
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const room = new THREE.Group(); room.name = 'room';
  const park = new THREE.Group(); park.name = 'park';
  scene.add(room, park);
  // 部屋のミシンにはスポットライトが1つある。公園にも明るさ0の同じ種類の光を置き、
  // 光の構成を揃える（場面の切り替えでシェーダーが作り直されて止まるのを防ぎ、事前コンパイルを効かせる）。
  { const ph = new THREE.SpotLight(0xffffff, 0, 1); ph.castShadow = false; ph.position.set(0, -50, 0); ph.target.position.set(0, -60, 0); park.add(ph, ph.target); }

  // ---- 光（共有） ----
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.025;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1);
  scene.add(hemi);
  const fill = new THREE.DirectionalLight(0xffffff, 0.3);
  scene.add(fill, fill.target);
  if (!scene.fog) scene.fog = new THREE.Fog(0xffffff, 500, 1000);
  if (!(scene.background instanceof THREE.Color)) scene.background = new THREE.Color();

  // 影カメラを箱 x∈[-7,7], y∈[0,3], z∈[-5,6.6] にぴったり合わせる
  const _m = new THREE.Matrix4(), _v = new THREE.Vector3();
  function fitShadow(dir) {
    const d = _v.set(...dir).normalize();
    sun.position.copy(d).multiplyScalar(30); sun.target.position.set(0, 0, 0);
    sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
    _m.lookAt(sun.position, sun.target.position, new THREE.Vector3(0, 1, 0)).setPosition(sun.position).invert();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const X of [-7, 7]) for (const Y of [0, 3]) for (const Z of [-5, 6.6]) {
      const p = new THREE.Vector3(X, Y, Z).applyMatrix4(_m);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
    const c = sun.shadow.camera;
    c.left = x0 - 0.3; c.right = x1 + 0.3; c.bottom = y0 - 0.3; c.top = y1 + 0.3;
    c.near = Math.max(0.5, -z1 - 6); c.far = -z0 + 2;
    c.updateProjectionMatrix();
  }

  // ======================= 部屋 =======================
  const T0 = performance.now();
  const wood = paintWood({ seed: 3 });
  const woodMap = tex(wood.map, { repeat: true, aniso: maxAniso });
  const woodData = tex(wood.data, { srgb: false, repeat: true, aniso: maxAniso });
  const topMat = new THREE.MeshStandardMaterial({
    map: woodMap, roughnessMap: woodData, bumpMap: woodData, bumpScale: 0.3, roughness: 0.62, metalness: 0,
  });
  const TOP = { x0: -6, x1: 6, z0: -4.4, z1: 6.6, th: 0.35 };
  const zMid = (TOP.z0 + TOP.z1) / 2; // 1.1: 前後2枚に分けて鏡映し（繰り返しを目立たせない）
  function topPlane(za, zb, mirror) {
    const g = new THREE.PlaneGeometry(TOP.x1 - TOP.x0, zb - za, 1, 1);
    g.rotateX(-Math.PI / 2); g.translate(0, 0, (za + zb) / 2);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const X = p.getX(i), Z = p.getZ(i);
      const u = (X + 3) / 6;
      uv.setXY(i, mirror ? -u + 0.37 : u, mirror ? (Z - za) / 5.5 : (zb - Z) / 5.5);
    }
    const m = new THREE.Mesh(g, topMat); m.receiveShadow = true; return m;
  }
  room.add(topPlane(zMid, TOP.z1, false), topPlane(TOP.z0, zMid, true));
  // 手前の丸い木口〜前面〜下面（断面を x 方向に掃引）
  {
    const prof = []; const R = 0.11, R2 = 0.05, z1 = TOP.z1, th = TOP.th;
    for (let k = 0; k <= 8; k++) { const a = (k / 8) * Math.PI / 2; prof.push([z1 - R + Math.sin(a) * R, -R + Math.cos(a) * R]); }
    for (let k = 0; k <= 4; k++) { const a = (k / 4) * Math.PI / 2; prof.push([z1 - R2 + Math.cos(a) * R2, -th + R2 - Math.sin(a) * R2]); }
    prof.push([z1 - 0.8, -th]);
    const sx = 48, pos = [], uvs = [], idx = [];
    let arc = [0]; for (let k = 1; k < prof.length; k++) arc.push(arc[k - 1] + Math.hypot(prof[k][0] - prof[k - 1][0], prof[k][1] - prof[k - 1][1]));
    for (let i = 0; i <= sx; i++) {
      const X = TOP.x0 + (TOP.x1 - TOP.x0) * i / sx;
      for (let k = 0; k < prof.length; k++) { pos.push(X, prof[k][1], prof[k][0]); uvs.push((X + 3) / 6, -(arc[k] + R) / 5.5); }
    }
    const n = prof.length;
    for (let i = 0; i < sx; i++) for (let k = 0; k < n - 1; k++) {
      const a = i * n + k, b = (i + 1) * n + k; idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, topMat); m.receiveShadow = true; m.castShadow = false; room.add(m);
    // 両端の木口
    const sh = new THREE.Shape();
    sh.moveTo(TOP.z0, 0); sh.lineTo(z1 - R, 0); sh.absarc(z1 - R, -R, R, Math.PI / 2, 0, true);
    sh.lineTo(z1, -th + R2); sh.absarc(z1 - R2, -th + R2, R2, 0, -Math.PI / 2, true); sh.lineTo(TOP.z0, -th); sh.closePath();
    const endMat = new THREE.MeshStandardMaterial({ color: 0xb48a5e, roughness: 0.7 });
    for (const s of [-1, 1]) {
      const eg = new THREE.ShapeGeometry(sh, 6);
      // shape(x=z, y=y) → 平面 x=±6
      const p = eg.attributes.position;
      for (let i = 0; i < p.count; i++) { const zz = p.getX(i), yy = p.getY(i); p.setXYZ(i, s * 6, yy, zz); }
      if (s > 0) eg.index.array.reverse();
      eg.computeVertexNormals();
      const em = new THREE.Mesh(eg, endMat); em.receiveShadow = true; room.add(em);
    }
    // 幕板と脚（暗がりの中）
    const dark = new THREE.MeshStandardMaterial({ color: 0x8c6a48, roughness: 0.75 });
    const ap = new THREE.Mesh(new THREE.BoxGeometry(11.2, 0.8, 10.2), dark); ap.position.set(0, -0.75, 1.1); room.add(ap);
    for (const X of [-5.5, 5.5]) for (const Z of [-3.9, 6.1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 7.2, 0.6), dark); leg.position.set(X, -3.95, Z); room.add(leg);
    }
  }
  // 床
  {
    const fm = new THREE.MeshStandardMaterial({ map: woodMap, color: 0x6e5a4c, roughness: 0.8 });
    const fg = new THREE.PlaneGeometry(40, 30); fg.rotateX(-Math.PI / 2);
    const uv = fg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 40 / 6 * 0.6, uv.getY(i) * 30 / 5.5 * 0.6);
    const f = new THREE.Mesh(fg, fm); f.position.set(0, -7.55, 8); f.receiveShadow = true; room.add(f);
  }

  // 壁（窓の穴あき）
  const WIN = { x0: -6.9, x1: -2.7, y0: 3.2, y1: 9.6, cx: -4.8 };
  const WALLZ = -4.5;
  {
    const sh = new THREE.Shape();
    sh.moveTo(-14, -8); sh.lineTo(14, -8); sh.lineTo(14, 16); sh.lineTo(-14, 16); sh.closePath();
    const hole = new THREE.Path();
    hole.moveTo(WIN.x0, WIN.y0); hole.lineTo(WIN.x0, WIN.y1); hole.lineTo(WIN.x1, WIN.y1); hole.lineTo(WIN.x1, WIN.y0); hole.closePath();
    sh.holes.push(hole);
    const g = new THREE.ShapeGeometry(sh);
    const p = g.attributes.position, uv = g.attributes.uv;
    const uv2 = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { uv.setXY(i, (p.getX(i) + 14) / 28, Math.max(0, (p.getY(i) + 3) / 19)); uv2[i * 2] = p.getX(i) / 1.6; uv2[i * 2 + 1] = p.getY(i) / 1.6; }
    g.setAttribute('uv1', new THREE.BufferAttribute(uv2, 2));
    const stucco = tex(paintStucco(), { srgb: false, repeat: true });
    stucco.channel = 1;
    const wm = new THREE.MeshStandardMaterial({ map: tex(paintWall([WIN.cx, (WIN.y0 + WIN.y1) / 2])), bumpMap: stucco, bumpScale: 0.35, roughness: 0.93 });
    const wall = new THREE.Mesh(g, wm); wall.position.z = WALLZ; wall.receiveShadow = true; room.add(wall);
    // 窓の抱き（奥行き）
    const reveal = new THREE.MeshStandardMaterial({ color: 0xeee8de, roughness: 0.9 });
    const D = 0.45;
    const mk = (w, h, x, y, z, ry, rx) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), reveal); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0); m.receiveShadow = true; room.add(m); return m; };
    mk(D, WIN.y1 - WIN.y0, WIN.x0, (WIN.y0 + WIN.y1) / 2, WALLZ - D / 2, Math.PI / 2);
    mk(D, WIN.y1 - WIN.y0, WIN.x1, (WIN.y0 + WIN.y1) / 2, WALLZ - D / 2, -Math.PI / 2);
    mk(WIN.x1 - WIN.x0, D, WIN.cx, WIN.y1, WALLZ - D / 2, 0, Math.PI / 2);
    // 外の景色（発光・ぼけ）
    const vt = tex(paintWindowView());
    const glassMat = new THREE.MeshBasicMaterial({ map: vt, color: new THREE.Color(1.12, 1.12, 1.12), fog: false });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(WIN.x1 - WIN.x0, WIN.y1 - WIN.y0), glassMat);
    glass.position.set(WIN.cx, (WIN.y0 + WIN.y1) / 2, WALLZ - 0.36); room.add(glass);
    // 白い木枠
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.45 });
    const fz = WALLZ - 0.3, fw = 0.16, fd = 0.12;
    const bx = (w, h, d, x, y, z, mat = frameMat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; room.add(m); return m; };
    const W2 = WIN.x1 - WIN.x0, H2 = WIN.y1 - WIN.y0, ym = (WIN.y0 + WIN.y1) / 2;
    bx(fw, H2, fd, WIN.x0 + fw / 2, ym, fz); bx(fw, H2, fd, WIN.x1 - fw / 2, ym, fz);
    bx(W2, fw, fd, WIN.cx, WIN.y1 - fw / 2, fz); bx(W2, fw * 1.4, fd, WIN.cx, WIN.y0 + fw * 0.7, fz);
    bx(0.09, H2, 0.08, WIN.cx, ym, fz + 0.01); bx(W2, 0.09, 0.08, WIN.cx, WIN.y0 + H2 * 0.62, fz + 0.01);
    // 額縁（壁面の見切り）
    const tw = 0.24, tz = WALLZ + 0.025;
    bx(tw, H2 + tw, 0.05, WIN.x0 - tw / 2, ym + tw / 2, tz); bx(tw, H2 + tw, 0.05, WIN.x1 + tw / 2, ym + tw / 2, tz);
    bx(W2 + tw * 2, tw, 0.05, WIN.cx, WIN.y1 + tw / 2, tz);
    // 窓台
    bx(W2 + 0.7, 0.16, 0.62, WIN.cx, WIN.y0 - 0.04, WALLZ - 0.08);
    bx(W2 + 0.4, 0.22, 0.04, WIN.cx, WIN.y0 - 0.23, WALLZ + 0.02);
  }
  // カーテンレールとレースのカーテン
  const curtain = {};
  {
    const rodMat = new THREE.MeshStandardMaterial({ color: 0xd9d4cb, roughness: 0.35, metalness: 0.6 });
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 5.8, 12), rodMat);
    rod.rotation.z = Math.PI / 2; rod.position.set(WIN.cx, WIN.y1 + 0.55, WALLZ + 0.38); room.add(rod);
    for (const X of [WIN.x0 - 0.45, WIN.x1 + 0.45]) {
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.38, 8), rodMat);
      br.rotation.x = Math.PI / 2; br.position.set(X, WIN.y1 + 0.55, WALLZ + 0.19); room.add(br);
    }
    // 薄地の織り目
    const S = 128, cv = canvas(S, S), x = cv.getContext('2d'), im = x.createImageData(S, S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const o = (j * S + i) * 4, v = 0.78 + 0.12 * vn(i / 1.5, j / 30, 85, 5) + ((i % 3 === 0) ? 0.06 : 0) + ((j % 3 === 0) ? 0.04 : 0);
      im.data[o] = im.data[o + 1] = im.data[o + 2] = Math.min(255, v * 255); im.data[o + 3] = 255;
    }
    x.putImageData(im, 0, 0);
    const at = tex(cv, { srgb: false, repeat: true }); at.repeat.set(6, 6);
    const cm = new THREE.MeshStandardMaterial({
      color: 0xfbf9f4, emissive: 0xfff8ee, emissiveIntensity: 0.28, roughness: 1, transparent: true, opacity: 0.62,
      alphaMap: at, side: THREE.DoubleSide, depthWrite: false,
    });
    const cw = 1.9, chh = WIN.y1 + 0.5 - 2.7, nx = 40, ny = 14;
    const g = new THREE.PlaneGeometry(cw, chh, nx, ny);
    const base = g.attributes.position.array.slice();
    const mesh = new THREE.Mesh(g, cm);
    const left = WIN.x0 - 0.55;
    mesh.position.set(left + cw / 2, 2.7 + chh / 2, WALLZ + 0.33);
    mesh.renderOrder = 2;
    room.add(mesh);
    Object.assign(curtain, { g, base, mesh, cw, chh });
    curtain.update = (t) => {
      const p = g.attributes.position.array;
      for (let i = 0; i < p.length; i += 3) {
        const X = base[i], Y = base[i + 1];
        const down = (chh / 2 - Y) / chh; // 0 上端 .. 1 裾
        const u = (X + cw / 2) / cw;
        // ひだ（上はきつめ、裾はゆったり右へ流れる）
        const pleat = Math.sin(u * 12.5 * Math.PI + 0.3) * (0.06 + 0.05 * down) + Math.sin(u * 5 * Math.PI + 1) * 0.03;
        const sway = Math.sin(t * 0.55 + u * 2.3) * 0.045 * down * down + Math.sin(t * 0.9 + Y * 0.4) * 0.012 * down;
        p[i] = X * (0.88 + 0.12 * down) + 0.1 * down * down;
        p[i + 2] = pleat + sway + 0.05 * down;
      }
      g.attributes.position.needsUpdate = true;
      g.computeVertexNormals();
    };
    curtain.update(0);
  }
  // 壁のペグレール
  const pegs = [];
  {
    const pw = paintWood({ W: 256, H: 128, tileU: 4.4, tileV: 1, planks: [1], seed: 11, joints: false, pores: 600, base: [205, 165, 118] });
    const pmap = tex(pw.map, { repeat: true });
    const pm = new THREE.MeshStandardMaterial({ map: pmap, roughness: 0.55 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.6, 0.14), pm);
    // 小さな面取り（RoundedBoxの代わりに頂点を少し丸める必要はない程度の寸法）
    board.position.set(2.6, 8.0, WALLZ + 0.07); board.castShadow = true; board.receiveShadow = true; room.add(board);
    const prof = [[0.0001, 0], [0.085, 0], [0.085, 0.03], [0.06, 0.07], [0.045, 0.16], [0.048, 0.24], [0.07, 0.29], [0.078, 0.315], [0.07, 0.34], [0.04, 0.352], [0.0001, 0.355]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const pg = new THREE.LatheGeometry(prof, 20); pg.rotateX(Math.PI / 2);
    for (const X of [1.3, 2.6, 3.9]) {
      const m = new THREE.Mesh(pg, pm); m.position.set(X, 8.0, WALLZ + 0.14); m.castShadow = true; m.receiveShadow = true; room.add(m);
      pegs.push(new THREE.Vector3(X, 8.0, WALLZ + 0.14 + 0.355));
    }
  }
  const tRoom = performance.now() - T0;

  // ======================= 公園 =======================
  // 公園は最初の場面（部屋）では見えないので、起動時には作らない。
  // 遊んでいる間に preparePark() で少しずつ作り、公園を出す直前に足りない分を ensurePark() で仕上げる。
  let tuftMesh = null, dapple = null, parkLow = false, tPark = 0;
  const parkTex = [];
  const ptex = (c, o) => { const t = tex(c, o); parkTex.push(t); return t; };
  const parkSteps = [
    () => { // 芝
      const grassMap = ptex(paintGrass(), { repeat: true, aniso: maxAniso });
      grassMap.repeat.set(160 / 3.2, 160 / 3.2);
      {
        const g = new THREE.PlaneGeometry(160, 160, 64, 64); g.rotateX(-Math.PI / 2);
        const p = g.attributes.position, col = new Float32Array(p.count * 3);
        for (let i = 0; i < p.count; i++) {
          const X = p.getX(i), Z = p.getZ(i);
          const n = fbm(X / 9 + 40, Z / 9 + 40, 3), m = vn(X / 3 + 9, Z / 3 + 9);
          const v = 0.8 + 0.35 * n + 0.08 * m;
          col[i * 3] = v * (1 + 0.12 * (n - 0.5)); col[i * 3 + 1] = v; col[i * 3 + 2] = v * 0.92;
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const gm = new THREE.MeshStandardMaterial({ map: grassMap, bumpMap: grassMap, bumpScale: 1.2, vertexColors: true, roughness: 0.95, color: 0xe6eedd });
        const ground = new THREE.Mesh(g, gm); ground.receiveShadow = true; park.add(ground);
      }
    },
    () => { // 背景（ぼけた木立と空）
      {
        const bt = ptex(paintParkBackdrop()); bt.wrapS = THREE.RepeatWrapping;
        const g = new THREE.CylinderGeometry(36, 36, 34, 48, 1, true);
        g.translate(0, 34 / 2 - 5, 0);
        const bm = new THREE.MeshBasicMaterial({ map: bt, side: THREE.BackSide, fog: false, transparent: true, depthWrite: false });
        const m = new THREE.Mesh(g, bm); m.rotation.y = Math.PI * 0.5; m.renderOrder = -1; park.add(m);
        park.userData.backdrop = bm;
      }
    },
    () => { // ピクニックシート
      {
        const gt = paintGingham();
        const gmap = ptex(gt.map, { repeat: true, aniso: maxAniso }), gb = ptex(gt.bump, { srgb: false, repeat: true, aniso: maxAniso });
        const check = 0.62; // 1マス（6.2cm）
        gmap.repeat.set(11 / (check * 2), 9 / (check * 2)); gb.repeat.copy(gmap.repeat);
        const g = new THREE.PlaneGeometry(11, 9, 88, 72); g.rotateX(-Math.PI / 2);
        const p = g.attributes.position, col = new Float32Array(p.count * 3);
        for (let i = 0; i < p.count; i++) {
          const X = p.getX(i), Z = p.getZ(i);
          const ex = sstep(3.2, 5.3, Math.abs(X)), ez = sstep(2.7, 4.3, Math.abs(Z)), e = Math.max(ex, ez);
          const rum = (fbm(X / 1.3 + 3, Z / 1.3 + 7, 3) - 0.45) * 0.15 * e;
          const edge = Math.max(sstep(5.25, 5.5, Math.abs(X)), sstep(4.25, 4.5, Math.abs(Z)));
          let y = 0.038 + 0.004 * (vn(X * 1.3 + 30, Z * 1.3 + 30) - 0.5) + Math.max(-0.02, rum) - 0.03 * edge;
          // 端の不揃い
          const jx = (vn(Z * 0.9 + 50, 2) - 0.5) * 0.12 * sstep(5.0, 5.5, Math.abs(X));
          const jz = (vn(X * 0.9 + 70, 5) - 0.5) * 0.12 * sstep(4.0, 4.5, Math.abs(Z));
          p.setXYZ(i, X + jx * Math.sign(X), Math.min(0.085, Math.max(0.012, y)), Z + jz * Math.sign(Z));
          const s = 0.95 + 0.07 * fbm(X / 2 + 11, Z / 2, 2);
          col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = s;
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.computeVertexNormals();
        const sm = new THREE.MeshStandardMaterial({ map: gmap, bumpMap: gb, bumpScale: 0.8, roughness: 0.92, vertexColors: true, side: THREE.DoubleSide });
        const sheet = new THREE.Mesh(g, sm); sheet.receiveShadow = true; sheet.castShadow = false; park.add(sheet);
      }
    },
    () => { // 草の房（シートの周り）
      tuftMesh = (() => {
        const tt = ptex(paintTuft());
        const a = new THREE.PlaneGeometry(0.7, 0.55); a.translate(0, 0.275, 0);
        const b = a.clone(); b.rotateY(Math.PI / 2);
        const c2 = a.clone(); c2.rotateY(Math.PI / 4);
        const merged = new THREE.BufferGeometry();
        const pos = [], uv = [], nor = [];
        for (const gg of [a, b, c2]) { pos.push(...gg.attributes.position.array); uv.push(...gg.attributes.uv.array); }
        for (let i = 0; i < pos.length / 3; i++) nor.push(0, 1, 0); // 上向き法線で柔らかく
        merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        merged.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        merged.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        const idx = []; for (let k = 0; k < 3; k++) idx.push(k * 4, k * 4 + 2, k * 4 + 1, k * 4 + 2, k * 4 + 3, k * 4 + 1);
        merged.setIndex(idx);
        const mat = new THREE.MeshStandardMaterial({ map: tt, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, color: 0xdfe8cf });
        const N = 300, im = new THREE.InstancedMesh(merged, mat, N), r = rng(123), o = new THREE.Object3D(), cc = new THREE.Color();
        let k = 0;
        while (k < N) {
          const X = (r() - 0.5) * 26, Z = (r() - 0.5) * 22;
          const inside = Math.abs(X) < 5.6 && Math.abs(Z) < 4.6;
          if (inside) continue;
          const dEdge = Math.max(Math.abs(X) - 5.5, Math.abs(Z) - 4.5);
          if (dEdge > 1.2 && r() < 0.65) continue;
          o.position.set(X, -0.02, Z); o.rotation.set((r() - 0.5) * 0.25, r() * TAU, (r() - 0.5) * 0.25);
          const s = 0.35 + r() * 0.45; o.scale.set(s, s * (0.7 + r() * 0.5), s); o.updateMatrix();
          im.setMatrixAt(k, o.matrix); cc.setHSL(0.2 + r() * 0.06, 0.25, 0.75 + r() * 0.2); im.setColorAt(k, cc); k++;
        }
        im.receiveShadow = true; park.add(im); return im;
      })();
      tuftMesh.visible = !parkLow;
    },
    () => { // 落ち葉
      {
        const r = rng(404), o = new THREE.Object3D();
        for (let k = 0; k < 3; k++) {
          const lm = new THREE.MeshStandardMaterial({ map: ptex(paintLeaf(k + 1)), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
          const lg = new THREE.PlaneGeometry(0.32, 0.32); lg.rotateX(-Math.PI / 2);
          const im = new THREE.InstancedMesh(lg, lm, 5);
          for (let i = 0; i < 5; i++) {
            let X, Z; do { X = (r() - 0.5) * 22; Z = (r() - 0.5) * 18; } while (Math.abs(X) < 6 && Math.abs(Z) < 5);
            o.position.set(X, 0.04, Z); o.rotation.set((r() - 0.5) * 0.3, r() * TAU, (r() - 0.5) * 0.3); const s = 0.8 + r() * 0.6; o.scale.set(s, s, s); o.updateMatrix();
            im.setMatrixAt(i, o.matrix);
          }
          im.receiveShadow = true; park.add(im);
        }
      }
    },
    () => { // 木漏れ日（乗算の薄い板）
      dapple = (() => {
        const dt = ptex(paintDapple(), { srgb: false, repeat: true });
        const mat = new THREE.ShaderMaterial({
          uniforms: { map: { value: dt }, off1: { value: new THREE.Vector2() }, off2: { value: new THREE.Vector2() }, strength: { value: 1 } },
          vertexShader: `varying vec2 vP; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vP = w.xz; gl_Position = projectionMatrix*viewMatrix*w; }`,
          fragmentShader: `uniform sampler2D map; uniform vec2 off1, off2; uniform float strength; varying vec2 vP;
            void main(){
              float a = texture2D(map, vP/9.0 + off1).r;
              float b = texture2D(map, vP*vec2(1.0,-1.0)/6.5 + off2).r;
              float s = mix(1.0, a*mix(1.0,b,0.6), strength);
              float fade = 1.0 - smoothstep(6.0, 11.0, length(vP*vec2(0.85,1.0) - vec2(-1.0,-1.0)));
              s = mix(1.0, s, fade);
              gl_FragColor = vec4(vec3(s), 1.0);
            }`,
          transparent: true, depthWrite: false, blending: THREE.MultiplyBlending, premultipliedAlpha: false,
        });
        const m = new THREE.Mesh(new THREE.PlaneGeometry(28, 24), mat); m.rotation.x = -Math.PI / 2; m.position.y = 0.095; m.renderOrder = 1;
        park.add(m); return m;
      })();
    },
  ];
  let parkStep = 0;
  // 1段ずつ作る。全部できたら true。
  function preparePark(steps = 1) {
    const T1 = performance.now();
    while (parkStep < parkSteps.length && steps-- > 0) parkSteps[parkStep++]();
    tPark += performance.now() - T1;
    if (parkStep >= parkSteps.length && !api.parkReady) { api.parkReady = true; api.timings.park = tPark; if (current === 'park') apply(); }
    return api.parkReady;
  }
  function ensurePark() { return preparePark(parkSteps.length); }

  // ---- 切り替え ----
  const C1 = new THREE.Color(), C2 = new THREE.Color();
  let current = 'room', evening = 0;
  function apply() {
    const P = PRESETS[current];
    const k = current === 'park' ? evening : 0;
    const E = PRESETS.evening;
    const lerp3 = (a, b) => a.map((v, i) => v + (b[i] - v) * k);
    const lc = (a, b) => C1.set(a).lerp(C2.set(b), k);
    fitShadow(lerp3(P.sunDir, E.sunDir));
    sun.color.copy(lc(P.sunCol, E.sunCol)); sun.intensity = P.sunI + (E.sunI - P.sunI) * k;
    hemi.color.copy(lc(P.hemiSky, E.hemiSky)); hemi.groundColor.copy(lc(P.hemiGround, E.hemiGround));
    hemi.intensity = P.hemiI + (E.hemiI - P.hemiI) * k;
    fill.position.set(...P.fillDir); fill.color.copy(lc(P.fillCol, E.fillCol)); fill.intensity = P.fillI;
    scene.background.copy(lc(P.bg, E.bg));
    scene.environmentIntensity = P.env + (E.env - P.env) * k;
    scene.fog.color.copy(lc(P.fog, E.fog)); scene.fog.near = P.fogNear; scene.fog.far = P.fogFar;
    if (park.userData.backdrop) park.userData.backdrop.color.copy(C1.set(0xffffff).lerp(C2.set(0xffd6a8), k * 0.8));
    if (dapple) dapple.material.uniforms.strength.value = 1 - 0.35 * k;
    sun.shadow.needsUpdate = true;
  }
  function show(name) {
    current = name === 'park' ? 'park' : 'room';
    if (current === 'park') ensurePark();
    room.visible = current === 'room'; park.visible = current === 'park';
    api.current = current;
    apply();
  }
  function setEvening(k) { evening = Math.min(1, Math.max(0, k)); if (current === 'park') apply(); }
  function setLow(low) {
    const s = low ? 1024 : 2048;
    if (sun.shadow.mapSize.x !== s) {
      sun.shadow.mapSize.set(s, s);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    parkLow = low;
    if (tuftMesh) tuftMesh.visible = !low;
    curtain.low = low;
  }
  let acc = 0;
  function update(dt, t) {
    if (current === 'room') {
      acc += dt;
      if (!curtain.low || acc > 0.1) { curtain.update(t); acc = 0; }
    } else if (dapple) {
      const u = dapple.material.uniforms;
      u.off1.value.set(t * 0.006 + Math.sin(t * 0.21) * 0.006, t * 0.003 + Math.sin(t * 0.17 + 1) * 0.006);
      u.off2.value.set(-t * 0.004 + Math.sin(t * 0.33) * 0.004, t * 0.005);
    }
  }
  const api = { room, park, show, current, sun, hemi, fill, setLow, setEvening, pegs, update, timings: { room: tRoom, park: 0 },
    parkReady: false, preparePark, ensurePark, parkTextures: parkTex };
  show('room');
  return api;
}

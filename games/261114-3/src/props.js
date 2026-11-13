// 小物: りんご, 水筒, お弁当（ふろしき包み）, ハンカチ, ボタン缶, ボタン。テクスチャは起動時にcanvasで生成。
// 単位: 1 = 10cm。各ファクトリは { group, radius, height } を返す。
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---------- 小さな道具 ----------
function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const LAT = (() => { const r = rng(19), a = new Float32Array(256 * 256); for (let i = 0; i < a.length; i++) a[i] = r(); return a; })();
function vn(x, y, px = 256, py = 256) {
  px = Math.max(1, Math.round(px)); py = Math.max(1, Math.round(py));
  const xf = Math.floor(x), yf = Math.floor(y);
  let fx = x - xf, fy = y - yf;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const x0 = (((xf % px) + px) % px) & 255, y0 = (((yf % py) + py) % py) & 255;
  const x1 = ((x0 + 1) % px) & 255, y1 = ((y0 + 1) % py) & 255;
  const a = LAT[(y0 << 8) + x0], b = LAT[(y0 << 8) + x1], c = LAT[(y1 << 8) + x0], d = LAT[(y1 << 8) + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(x, y, oct, px = 256, py = 256) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vn(x, y, px, py); n += a; x *= 2; y *= 2; px *= 2; py *= 2; a *= 0.5; }
  return s / n;
}
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, { srgb = true, repeat = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;
const V2 = (r, y) => new THREE.Vector2(r, y);
function smoothProfile(pts, n) {
  const c = new THREE.SplineCurve(pts.map(([r, y]) => V2(r, y)));
  return c.getSpacedPoints(n).map((p) => V2(Math.max(0.0001, p.x), p.y));
}
function shadowy(o) { o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); return o; }
const cache = {};
function once(key, f) { return cache[key] || (cache[key] = f()); }

// ---------- 布（織り目）テクスチャ ----------
// 2色ギンガム or 無地。S=1周期のpx。
function paintCloth({ S = 128, a = [250, 248, 240], b = [240, 160, 60], gingham = true, th = 2 } = {}) {
  const c = canvas(S, S), x = c.getContext('2d'), im = x.createImageData(S, S);
  const bm = canvas(S, S), y = bm.getContext('2d'), bi = y.createImageData(S, S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const ti = Math.floor(i / th), tj = Math.floor(j / th);
    const warpTop = ((ti + tj) & 1) === 0;
    const f = ((warpTop ? i : j) % th + 0.5) / th;
    const shade = 0.86 + 0.14 * Math.sin(f * Math.PI);
    const n = 0.95 + 0.1 * vn(warpTop ? i / 2 : j / 2, warpTop ? j / 20 : i / 20, S / 2, Math.max(1, S / 20));
    let col;
    if (gingham) { const isB = warpTop ? i < S / 2 : j < S / 2; col = isB ? b : a; } else col = a;
    const o = (j * S + i) * 4;
    im.data[o] = col[0] * shade * n; im.data[o + 1] = col[1] * shade * n; im.data[o + 2] = col[2] * shade * n; im.data[o + 3] = 255;
    bi.data[o] = bi.data[o + 1] = bi.data[o + 2] = 255 * shade * n; bi.data[o + 3] = 255;
  }
  x.putImageData(im, 0, 0); y.putImageData(bi, 0, 0);
  return { map: tex(c, { repeat: true }), bump: tex(bm, { srgb: false, repeat: true }) };
}

// 細分割した箱を角丸にし、関数で変形する（布もの用）
function softBox(w, h, d, r, seg, fn) {
  const g = new THREE.BoxGeometry(w, h, d, seg[0], seg[1], seg[2]);
  const p = g.attributes.position, v = new THREE.Vector3(), q = new THREE.Vector3();
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    q.set(Math.max(-hx, Math.min(hx, v.x)), Math.max(-hy, Math.min(hy, v.y)), Math.max(-hz, Math.min(hz, v.z)));
    const n = v.clone().sub(q); const L = n.length();
    if (L > 1e-6) v.copy(q).addScaledVector(n, r / L);
    if (fn) fn(v);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  // 面ごとに分かれた頂点を溶接して滑らかな法線に
  g.deleteAttribute('normal');
  const m = mergeVerts(g);
  m.computeVertexNormals();
  return m;
}
function mergeVerts(g) {
  // uv を保ったまま位置の一致する頂点の法線だけ平均する簡易版
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, map = new Map();
  const key = (i) => `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
  for (let i = 0; i < p.count; i++) { const k = key(i); const a = map.get(k); if (a) a.push(i); else map.set(k, [i]); }
  const t = new THREE.Vector3();
  for (const list of map.values()) {
    if (list.length < 2) continue;
    t.set(0, 0, 0); for (const i of list) t.x += n.getX(i), t.y += n.getY(i), t.z += n.getZ(i);
    t.normalize(); for (const i of list) n.setXYZ(i, t.x, t.y, t.z);
  }
  g.computeVertexNormals = () => {}; // 上で決めた法線を保持
  return g;
}

// =====================================================================
// りんご
// =====================================================================
function paintApple() {
  const W = 512, H = 256, c = canvas(W, H), x = c.getContext('2d'), im = x.createImageData(W, H), r = rng(3);
  const bm = canvas(W, H), y = bm.getContext('2d'), bi = y.createImageData(W, H);
  for (let j = 0; j < H; j++) {
    const v = 1 - j / H; // 0 下(がく) .. 1 上(へた)  ※canvasは上が v=1
    for (let i = 0; i < W; i++) {
      const u = i / W;
      // 片側が濃く日焼けしたブラッシュ
      const side = 0.5 + 0.5 * Math.cos((u - 0.15) * TAU);
      const blushN = fbm(u * 6, v * 3, 3, 6, 256);
      let blush = sstep(0.15, 0.75, side * 0.75 + blushN * 0.55);
      // 縦の筋
      const streak = vn(u * 90, v * 4, 90, 256) * 0.6 + vn(u * 180, v * 9, 180, 256) * 0.4;
      blush = Math.min(1, blush * (0.75 + 0.5 * streak));
      // 両端の窪みは黄緑が残る
      const ends = sstep(0.12, 0.0, v) + sstep(0.86, 0.98, v) * 0.7;
      blush *= 1 - 0.75 * ends;
      const base = [196, 186, 86];
      const red = [158 - 40 * streak, 22, 28];
      const dark = [110, 12, 22];
      const deep = sstep(0.75, 1, blush);
      let R = base[0] + (red[0] - base[0]) * blush, G = base[1] + (red[1] - base[1]) * blush, B = base[2] + (red[2] - base[2]) * blush;
      R += (dark[0] - R) * deep * 0.6; G += (dark[1] - G) * deep * 0.6; B += (dark[2] - B) * deep * 0.6;
      // へた周りの茶色いさび
      const rus = sstep(0.95, 1.0, v) * (0.5 + 0.5 * vn(u * 30, v * 30, 30, 256));
      R += (120 - R) * rus * 0.7; G += (96 - G) * rus * 0.7; B += (50 - B) * rus * 0.7;
      const o = (j * W + i) * 4;
      im.data[o] = R; im.data[o + 1] = G; im.data[o + 2] = B; im.data[o + 3] = 255;
      bi.data[o] = bi.data[o + 1] = bi.data[o + 2] = 200; bi.data[o + 3] = 255;
    }
  }
  x.putImageData(im, 0, 0); y.putImageData(bi, 0, 0);
  // 果点（白っぽい細かい点）— 極付近は横に詰まるので密度を下げる
  for (let k = 0; k < 520; k++) {
    const v = 0.08 + r() * 0.84, j = (1 - v) * H, i = r() * W;
    const s = Math.sin(v * Math.PI);
    if (r() > s) continue;
    const rx = 0.6 + r() * 0.7, ry = rx * 2 * s + 0.4;
    x.fillStyle = `rgba(232,214,150,${0.25 + r() * 0.35})`;
    x.beginPath(); x.ellipse(i, j, rx / Math.max(0.3, s), ry * 0.5, 0, 0, TAU); x.fill();
    y.fillStyle = 'rgba(230,230,230,0.8)'; y.beginPath(); y.ellipse(i, j, rx / Math.max(0.3, s), ry * 0.5, 0, 0, TAU); y.fill();
  }
  return { map: tex(c), bump: tex(bm, { srgb: false }) };
}
export function createApple() {
  const T = once('apple', () => {
    const prof = smoothProfile([
      [0.0001, -0.272], [0.03, -0.285], [0.07, -0.312], [0.13, -0.322], [0.2, -0.3], [0.27, -0.245], [0.322, -0.155],
      [0.353, -0.05], [0.362, 0.04], [0.352, 0.13], [0.322, 0.21], [0.27, 0.272], [0.2, 0.31], [0.13, 0.322],
      [0.08, 0.305], [0.04, 0.268], [0.015, 0.238], [0.0001, 0.232],
    ], 44);
    const g = new THREE.LatheGeometry(prof, 56);
    // 少しのいびつさ（5つの肩・傾き）
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const X = p.getX(i), Y = p.getY(i), Z = p.getZ(i);
      const a = Math.atan2(Z, X), rr = Math.hypot(X, Z);
      const k = 1 + 0.025 * Math.sin(a + 0.6) + 0.018 * Math.sin(5 * a) * sstep(-0.05, -0.3, Y) + 0.012 * Math.sin(5 * a + 0.5) * sstep(0.1, 0.3, Y) + 0.01 * Math.sin(2 * a + 1.3);
      p.setXYZ(i, X * k, Y + 0.02 * X * (Y > 0 ? 1 : 0.4), Z * k);
      void rr;
    }
    g.computeVertexNormals();
    const tx = paintApple();
    const mat = new THREE.MeshPhysicalMaterial({
      map: tx.map, bumpMap: tx.bump, bumpScale: 0.6, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.28, sheen: 0,
    });
    const stemCurve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.2, 0), new THREE.Vector3(0.005, 0.33, 0), new THREE.Vector3(0.045, 0.41, 0.01));
    const stemG = new THREE.TubeGeometry(stemCurve, 8, 0.016, 7, false);
    const sp = stemG.attributes.position;
    for (let i = 0; i < sp.count; i++) { const Y = sp.getY(i); const k = 1 + 0.5 * sstep(0.3, 0.2, Y); sp.setX(i, sp.getX(i) * k); sp.setZ(i, sp.getZ(i) * k); }
    stemG.computeVertexNormals();
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x5e4329, roughness: 0.8 });
    const capG = new THREE.SphereGeometry(0.019, 8, 6); capG.translate(0.045, 0.41, 0.01);
    return { g, mat, stemG: mergeGeometries([stemG, capG]), stemMat };
  });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(T.g, T.mat), new THREE.Mesh(T.stemG, T.stemMat));
  shadowy(group);
  return { group, radius: 0.37, height: 0.72 };
}

// =====================================================================
// 水筒
// =====================================================================
export function createBottle() {
  const T = once('bottle', () => {
    const body = new THREE.LatheGeometry(smoothProfile([
      [0.0001, 0], [0.24, 0], [0.285, 0.008], [0.305, 0.035], [0.31, 0.08], [0.31, 0.6], [0.31, 1.02], [0.303, 1.1],
      [0.28, 1.16], [0.24, 1.205], [0.205, 1.23], [0.2, 1.245],
    ], 40), 48);
    // 首の金属リング
    const lip = new THREE.LatheGeometry(smoothProfile([[0.2, 1.235], [0.207, 1.245], [0.207, 1.262], [0.198, 1.27]], 6), 48);
    // キャップ（細かい縦の滑り止め）
    const capProf = smoothProfile([[0.0001, 1.43], [0.12, 1.428], [0.19, 1.418], [0.212, 1.398], [0.218, 1.37], [0.218, 1.29], [0.214, 1.268], [0.2, 1.262]], 16);
    const cap = new THREE.LatheGeometry(capProf, 72);
    const cp = cap.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const X = cp.getX(i), Y = cp.getY(i), Z = cp.getZ(i), a = Math.atan2(Z, X);
      const band = sstep(1.275, 1.29, Y) * sstep(1.395, 1.38, Y);
      const k = 1 + 0.018 * band * Math.max(0, Math.cos(a * 36));
      cp.setX(i, X * k); cp.setZ(i, Z * k);
    }
    cap.computeVertexNormals();
    // 持ち手のループ
    const loop = new THREE.TorusGeometry(0.1, 0.028, 10, 28, Math.PI);
    loop.scale(1, 1.05, 1.25); loop.translate(0, 1.405, 0);
    const loopBase = new THREE.CylinderGeometry(0.125, 0.135, 0.035, 24); loopBase.translate(0, 1.43, 0);
    const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0x9fd3c0, roughness: 0.5, metalness: 0.0, clearcoat: 0.35, clearcoatRoughness: 0.4 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xd8dbdc, roughness: 0.28, metalness: 1 });
    const white = new THREE.MeshPhysicalMaterial({ color: 0xf3f2ee, roughness: 0.45, clearcoat: 0.2, clearcoatRoughness: 0.5 });
    const capAll = mergeGeometries([cap, loop.toNonIndexed(), loopBase.toNonIndexed()].map((q) => (q.index ? q.toNonIndexed() : q)));
    return { body, lip, capAll, bodyMat, steel, white };
  });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(T.body, T.bodyMat), new THREE.Mesh(T.lip, T.steel), new THREE.Mesh(T.capAll, T.white));
  shadowy(group);
  return { group, radius: 0.32, height: 1.55 };
}

// =====================================================================
// お弁当（ふろしき包み）
// =====================================================================
export function createBento() {
  const T = once('bento', () => {
    const cl = paintCloth({ S: 64, a: [250, 238, 205], b: [232, 150, 48], gingham: true, th: 2 });
    cl.map.repeat.set(5, 5); cl.bump.repeat.set(5, 5);
    const mat = new THREE.MeshStandardMaterial({ map: cl.map, bumpMap: cl.bump, bumpScale: 0.5, roughness: 0.92, side: THREE.DoubleSide });
    const H = 0.42;
    const body = softBox(1.22, H, 0.82, 0.07, [22, 8, 16], (v) => {
      const top = sstep(0.05, H / 2, v.y);
      // 結び目に向かって集まるしわ
      const a = Math.atan2(v.z, v.x);
      const cr = 0.012 * Math.sin(a * 11 + 0.7 * Math.sin(a * 3)) * (0.3 + 0.7 * top);
      const rr = Math.hypot(v.x, v.z) || 1;
      v.x += (v.x / rr) * cr; v.z += (v.z / rr) * cr;
      // 上面は中央へ少し盛り上がる
      if (v.y > H / 2 - 0.08) { const d = Math.hypot(v.x / 0.6, v.z / 0.4); v.y += 0.05 * Math.max(0, 1 - d) ** 1.5; }
      v.y += H / 2;
    });
    // 結び目
    const knot = new THREE.SphereGeometry(0.15, 20, 14);
    { const p = knot.attributes.position; for (let i = 0; i < p.count; i++) { const X = p.getX(i), Y = p.getY(i), Z = p.getZ(i); const a = Math.atan2(Z, X); const k = 1 + 0.08 * Math.sin(a * 4 + Y * 20); p.setXYZ(i, X * k * 1.25, Y * 0.62, Z * k); } knot.computeVertexNormals(); }
    knot.translate(0, H + 0.075, 0);
    // 2つの耳（端をひねった三角）
    const ear = (s) => {
      const e = new THREE.SphereGeometry(0.1, 16, 10);
      const p = e.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let X = p.getX(i), Y = p.getY(i), Z = p.getZ(i);
        const t = (Y + 0.1) / 0.2; // 0 根元 .. 1 先端
        const w = 1 - 0.55 * t * t;
        X *= 0.5 * w; Z *= 0.95 * w * (1 + 0.12 * Math.sin(t * 6)); Y *= 1.45;
        p.setXYZ(i, X, Y, Z);
      }
      e.computeVertexNormals();
      e.rotateZ(-s * 1.05); e.rotateY(s * 0.3);
      e.translate(s * 0.19, H + 0.11, 0);
      return e;
    };
    const parts = mergeGeometries([knot, ear(1), ear(-1)]);
    return { body, parts, mat };
  });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(T.body, T.mat), new THREE.Mesh(T.parts, T.mat));
  shadowy(group);
  return { group, radius: 0.68, height: 0.6 };
}

// =====================================================================
// ハンカチ（たたんだ状態）
// =====================================================================
function paintHanky() {
  const S = 512, c = canvas(S, S), x = c.getContext('2d'), im = x.createImageData(S, S);
  const bm = canvas(S, S), y = bm.getContext('2d'), bi = y.createImageData(S, S);
  const base = [238, 196, 204], stripe = [252, 248, 246], line = [214, 150, 166];
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const th = 2, ti = i >> 1, tj = j >> 1, warpTop = ((ti + tj) & 1) === 0;
    const f = ((warpTop ? i : j) % th + 0.5) / th, shade = 0.9 + 0.1 * Math.sin(f * Math.PI);
    const e = Math.min(i, j, S - 1 - i, S - 1 - j) / S; // 端までの距離 (0..0.5)
    let col = base;
    if (e > 0.045 && e < 0.075) col = stripe;
    else if (e > 0.088 && e < 0.098) col = line;
    else if (e < 0.012) col = [228, 182, 192]; // 縁かがり
    const n = 0.96 + 0.07 * vn(i / 2, j / 25, 256, 21);
    const o = (j * S + i) * 4;
    im.data[o] = col[0] * shade * n; im.data[o + 1] = col[1] * shade * n; im.data[o + 2] = col[2] * shade * n; im.data[o + 3] = 255;
    const hem = e < 0.012 ? 0.8 : 1;
    bi.data[o] = bi.data[o + 1] = bi.data[o + 2] = 230 * shade * hem; bi.data[o + 3] = 255;
  }
  x.putImageData(im, 0, 0); y.putImageData(bi, 0, 0);
  return { map: tex(c), bump: tex(bm, { srgb: false }) };
}
export function createHanky() {
  const T = once('hanky', () => {
    const W = 0.95, H = 0.09;
    const g = softBox(W, H, W, 0.04, [24, 3, 24], (v) => {
      const ux = v.x / (W / 2), uz = v.z / (W / 2);
      const puff = (1 - ux ** 4) * (1 - uz ** 4);
      if (v.y > 0) v.y += 0.014 * puff + 0.004 * Math.sin(ux * 7 + uz * 3);
      // 折り山（左右）はふくらみ、開いた辺（手前）は少し薄い
      v.y += H / 2;
    });
    // 上から投影したUV
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / W + 0.5, -p.getZ(i) / W + 0.5);
    const tx = paintHanky();
    const mat = new THREE.MeshStandardMaterial({ map: tx.map, bumpMap: tx.bump, bumpScale: 0.6, roughness: 0.95 });
    // 重なった布の縁（手前・右に段差）
    const layer = softBox(W - 0.04, 0.02, W - 0.04, 0.009, [12, 1, 12]);
    layer.translate(0.012, H * 0.42, 0.012);
    const lp = layer.attributes.position, luv = layer.attributes.uv;
    for (let i = 0; i < lp.count; i++) luv.setXY(i, lp.getX(i) / W + 0.5, -lp.getZ(i) / W + 0.5);
    return { g, layer, mat };
  });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(T.g, T.mat), new THREE.Mesh(T.layer, T.mat));
  shadowy(group);
  return { group, radius: 0.55, height: 0.105 };
}

// =====================================================================
// ボタン
// =====================================================================
export const BUTTON_COLORS = [0xd8463b, 0xf2b630, 0x3f86c9, 0x4fa35a, 0xec8fb0, 0x8c6bc1];
function buttonGeometry(lo = false) {
  return once(lo ? 'btnGeoLo' : 'btnGeo', () => {
    const R = 0.118, shape = new THREE.Shape();
    shape.absarc(0, 0, R, 0, TAU, false);
    for (const [hx, hy] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
      const h = new THREE.Path(); h.absarc(hx * 0.034, hy * 0.034, 0.019, 0, TAU, true); shape.holes.push(h);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.011, bevelSegments: lo ? 1 : 3, curveSegments: lo ? 12 : 28 });
    g.translate(0, 0, -0.015);
    g.rotateX(-Math.PI / 2);
    // 中央をくぼませる
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const X = p.getX(i), Y = p.getY(i), Z = p.getZ(i), rr = Math.hypot(X, Z);
      if (Y > 0.01) p.setY(i, Y - 0.012 * sstep(0.1, 0.06, rr));
    }
    g.deleteAttribute('normal');
    const gm = mergeVertices(g, 1e-4); gm.computeVertexNormals();
    const rim = new THREE.TorusGeometry(0.104, 0.016, lo ? 4 : 8, lo ? 16 : 40); rim.rotateX(Math.PI / 2); rim.scale(1, 0.75, 1); rim.translate(0, 0.022, 0);
    const m = mergeGeometries([gm.toNonIndexed(), rim.toNonIndexed()]);
    return m;
  });
}
const btnMats = [];
export function createButton(i = 0) {
  const k = ((i % 6) + 6) % 6;
  if (!btnMats[k]) btnMats[k] = new THREE.MeshPhysicalMaterial({ color: BUTTON_COLORS[k], roughness: 0.32, clearcoat: 0.9, clearcoatRoughness: 0.12 });
  const group = new THREE.Group();
  const m = new THREE.Mesh(buttonGeometry(), btnMats[k]);
  group.add(m); shadowy(group);
  return { group, radius: 0.13, height: 0.06 };
}

// =====================================================================
// ボタン缶（ふたが開く）
// =====================================================================
export function createTin() {
  const T = once('tin', () => {
    const paint = new THREE.MeshPhysicalMaterial({ color: 0xa9cbd8, roughness: 0.38, metalness: 0.15, clearcoat: 0.6, clearcoatRoughness: 0.25 });
    const metal = new THREE.MeshStandardMaterial({ color: 0xd3d5d4, roughness: 0.32, metalness: 1, side: THREE.DoubleSide });
    // 本体外側（塗装）: 底→上縁の巻き
    const outer = new THREE.LatheGeometry(smoothProfile([
      [0.0001, 0.0], [0.58, 0.0], [0.62, 0.01], [0.638, 0.035], [0.642, 0.07], [0.642, 0.44], [0.645, 0.47], [0.652, 0.495], [0.646, 0.515], [0.632, 0.52],
    ], 30), 64);
    // 内側（金属地）: 上縁から底へ
    const inner = new THREE.LatheGeometry(smoothProfile([[0.632, 0.52], [0.622, 0.505], [0.62, 0.48], [0.62, 0.07], [0.6, 0.045], [0.55, 0.04], [0.0001, 0.04]], 16), 64);
    // ふた（塗装）: 中心上面→外周→スカート→巻き
    const lidOuter = new THREE.LatheGeometry(smoothProfile([
      [0.0001, 0.6], [0.3, 0.598], [0.48, 0.594], [0.5, 0.588], [0.52, 0.594], [0.6, 0.592], [0.645, 0.583], [0.664, 0.565], [0.668, 0.54], [0.668, 0.46], [0.674, 0.448], [0.666, 0.437], [0.655, 0.44],
    ].reverse(), 34), 64);
    const lidInner = new THREE.LatheGeometry(smoothProfile([[0.655, 0.44], [0.652, 0.46], [0.652, 0.565], [0.62, 0.578], [0.0001, 0.582]], 10), 64);
    // 中のボタンの山（簡略形の InstancedMesh）
    const pbMat = new THREE.MeshPhysicalMaterial({ roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.15 });
    return { paint, metal, outer, inner, lidOuter, lidInner, pbMat };
  });
  const group = new THREE.Group();
  const body = new THREE.Group(); group.add(body);
  body.add(new THREE.Mesh(T.outer, T.paint), new THREE.Mesh(T.inner, T.metal));
  // ボタンの山
  const N = 24, pile = new THREE.InstancedMesh(buttonGeometry(true), T.pbMat, N), o = new THREE.Object3D(), r = rng(8), c = new THREE.Color();
  const extra = [0xf4efe2, 0x6b4a33, 0x2d2f36, 0xe3d6b8];
  for (let k = 0; k < N; k++) {
    const a = r() * TAU, rr = Math.sqrt(r()) * 0.47;
    const hgt = 0.07 + 0.28 * (1 - (rr / 0.55) ** 2) * (0.6 + 0.4 * r());
    o.position.set(Math.cos(a) * rr, hgt, Math.sin(a) * rr);
    o.rotation.set((r() - 0.5) * 0.9, r() * TAU, (r() - 0.5) * 0.9);
    const s = 0.9 + r() * 0.5; o.scale.set(s, s, s); o.updateMatrix();
    pile.setMatrixAt(k, o.matrix);
    c.set(r() < 0.75 ? BUTTON_COLORS[k % 6] : extra[k % 4]); pile.setColorAt(k, c);
  }
  body.add(pile);
  // ふた（後ろの縁を蝶番に）
  const hinge = new THREE.Group(); hinge.position.set(0, 0.5, -0.66); body.add(hinge);
  const lid = new THREE.Group(); lid.position.set(0, -0.5, 0.66); hinge.add(lid);
  lid.add(new THREE.Mesh(T.lidOuter, T.paint), new THREE.Mesh(T.lidInner, T.metal));
  shadowy(group);
  pile.castShadow = false;
  const mouth = new THREE.Object3D(); mouth.position.set(0, 0.56, 0.32); body.add(mouth);

  let lidK = 0, rt = -1;
  function pose() {
    let bounce = 0, tilt = 0;
    if (rt >= 0) {
      const e = Math.exp(-rt * 5.5);
      tilt = 0.06 * e * Math.sin(rt * 38);
      bounce = 0.05 * e * Math.max(0, Math.sin(rt * 30 + 1));
      body.position.y = 0.012 * e * Math.abs(Math.sin(rt * 34));
    } else body.position.y = 0;
    body.rotation.z = tilt;
    hinge.rotation.x = -(lidK * 0.61 + bounce); // 前側が持ち上がる
  }
  function setLid(k) { lidK = Math.min(1, Math.max(0, k)); pose(); }
  function rattle() { rt = 0; }
  function update(dt) { if (rt >= 0) { rt += dt; if (rt > 1.2) rt = -1; pose(); } }
  pose();
  return { group, radius: 0.67, height: 0.6, setLid, rattle, update, mouth };
}

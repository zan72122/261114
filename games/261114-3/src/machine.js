// 家庭用ミシンの3Dモデル（three.js）。単位: 1 = 10cm、y上、+zが手前（縫う人の側）。
// createMachine() が group と操作用API を返す。テクスチャはすべてcanvasで生成（外部ファイルなし）。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const PI = Math.PI;
const V3 = THREE.Vector3;
const BED_Y = 0.70;
const NX = -1.25, NZ = 0.10;           // needle position (x,z)
const FRONT = 0.48;                    // front face of the upper body
const BACK = -0.52;
const STROKE = 0.32;
const TIP_UP = 0.90;                   // needle tip height at phi = 0

// ---------- geometry helpers ----------
function prep(g) {
  if (g.index) g = g.toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.clearGroups();
  return g;
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _one = new V3(1, 1, 1);
function xf(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  _q.setFromEuler(_e.set(rx, ry, rz));
  return g.applyMatrix4(_m.compose(new V3(x, y, z), _q, _one));
}
class Bucket {
  constructor() { this.m = {}; }
  add(key, g, x, y, z, rx, ry, rz) { g = prep(g); xf(g, x, y, z, rx, ry, rz); (this.m[key] ||= []).push(g); return g; }
  build(parent, mats, cast = true, receive = true) {
    const out = {};
    for (const k in this.m) {
      const mesh = new THREE.Mesh(mergeGeometries(this.m[k]), mats[k]);
      mesh.castShadow = cast && mats[k].userData.noShadow !== true;
      mesh.receiveShadow = receive;
      parent.add(mesh); out[k] = mesh;
    }
    return out;
  }
}
function rr(target, x0, y0, x1, y1, r) {
  target.moveTo(x0 + r, y0); target.lineTo(x1 - r, y0); target.absarc(x1 - r, y0 + r, r, -PI / 2, 0);
  target.lineTo(x1, y1 - r); target.absarc(x1 - r, y1 - r, r, 0, PI / 2);
  target.lineTo(x0 + r, y1); target.absarc(x0 + r, y1 - r, r, PI / 2, PI);
  target.lineTo(x0, y0 + r); target.absarc(x0 + r, y0 + r, r, PI, 1.5 * PI);
  return target;
}
const rrShape = (x0, y0, x1, y1, r) => rr(new THREE.Shape(), x0, y0, x1, y1, r);
// extrude along z, centred on z=0, total depth incl. rounded bevel; outline stays exactly the shape
function ext(shape, depth, bev, curveSegments = 12, bevelSegments = 3, crease = 0.7) {
  const d = Math.max(0.0001, depth - 2 * bev);
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelOffset: -bev, bevelSegments, curveSegments });
  g.translate(0, 0, -d / 2);
  return toCreasedNormals(g, crease);
}
// flat rounded plate lying on the bed (x0..x1, z0..z1), thickness t, top at yTop
function flatPlate(x0, z0, x1, z1, r, t, bev, holes = []) {
  const s = rrShape(x0, -z1, x1, -z0, r);
  for (const h of holes) s.holes.push(rr(new THREE.Path(), h[0], -h[3], h[2], -h[1], h[4]));
  const g = ext(s, t, bev, 8, 2, 0.3);
  g.rotateX(-PI / 2);
  return g;
}
function rrPts(a0, b0, a1, b1, r, n = 6) {
  const pts = [];
  const c = [[a1 - r, b0 + r, -PI / 2], [a1 - r, b1 - r, 0], [a0 + r, b1 - r, PI / 2], [a0 + r, b0 + r, PI]];
  for (const [ca, cb, s] of c) for (let i = 0; i <= n; i++) { const t = s + (i / n) * PI / 2; pts.push([ca + r * Math.cos(t), cb + r * Math.sin(t)]); }
  return pts;
}
function tube(points, radius, closed = false, segs = 0, radial = 5) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
  return new THREE.TubeGeometry(curve, segs || Math.max(8, points.length * 6), radius, radial, closed);
}
// densify a polyline so that the Catmull-Rom stays straight on long legs
function dense(pts, step = 0.08) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], n = Math.max(1, Math.ceil(a.distanceTo(b) / step));
    for (let j = 0; j < n; j++) out.push(a.clone().lerp(b, j / n));
  }
  out.push(pts[pts.length - 1].clone());
  return out;
}
function lathe(profile, segs = 48) { return new THREE.LatheGeometry(profile.map(p => new THREE.Vector2(p[0], p[1])), segs); }
const cyl = (r0, r1, h, s = 24) => new THREE.CylinderGeometry(r0, r1, h, s);
const rbox = (w, h, d, r, s = 3) => (s <= 1 ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, s, r));

// ---------- procedural textures ----------
function canvasTex(w, h, draw, srgb = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function threadTexture() {
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return canvasTex(4, 256, (g, w, h) => {
    for (let y = 0; y < h; y++) {
      const v = (y % 2 === 0 ? 255 : 175) - rnd() * 30;
      g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, y, w, 1);
    }
  });
}
function ridgeTexture(n) {
  return canvasTex(n * 4, 4, (g, w, h) => {
    for (let x = 0; x < w; x++) { const v = x % 4 < 2 ? 215 : 105; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 1, h); }
  });
}
function brushedTexture() {
  let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = 'rgb(128,128,128)'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y++) { const v = 105 + rnd() * 50 | 0; g.fillStyle = `rgba(${v},${v},${v},0.8)`; g.fillRect(0, y, w, 1); }
  });
}

// ---------- the machine ----------
export function createMachine() {
  const group = new THREE.Group();
  group.name = 'sewingMachine';
  const rig = new THREE.Group(); // bump shake happens here
  group.add(rig);

  const phys = (o) => new THREE.MeshPhysicalMaterial(o);
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const brushed = brushedTexture();
  const mats = {
    body: phys({ color: 0xf3eee5, roughness: 0.36, clearcoat: 0.55, clearcoatRoughness: 0.22 }),
    grey: phys({ color: 0xc5c9cd, roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.3 }),
    dgrey: std({ color: 0x5b5f65, roughness: 0.55 }),
    black: std({ color: 0x232527, roughness: 0.75 }),
    seam: std({ color: 0x9a948a, roughness: 0.7 }),
    accent: phys({ color: 0x9fcfc6, roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.25 }),
    chrome: std({ color: 0xe9ebee, metalness: 1, roughness: 0.13 }),
    brushed: std({ color: 0xcfd2d6, metalness: 1, roughness: 0.34, roughnessMap: brushed }),
    steel: std({ color: 0x8c9096, metalness: 1, roughness: 0.42 }),
    dogs: std({ color: 0x55595e, metalness: 0.9, roughness: 0.5 }),
    clear: phys({ color: 0xe9f2f6, roughness: 0.06, transparent: true, opacity: 0.32, clearcoat: 1, depthWrite: false }),
    lens: std({ color: 0xdfe6ec, emissive: 0xf6f9ff, emissiveIntensity: 0, roughness: 0.25 }),
    thread: std({ color: 0xe0605a, roughness: 0.75 }),
    spoolThread: std({ color: 0xe0605a, roughness: 0.7 }),
    spoolPlastic: phys({ color: 0xf7f4ef, roughness: 0.3, clearcoat: 0.4 }),
    felt: std({ color: 0x8fc4bb, roughness: 0.95 }),
  };
  mats.clear.userData.noShadow = true;
  {
    const rt = ridgeTexture(48); rt.repeat.set(2, 1);
    mats.grip = std({ color: 0x80858b, roughness: 0.62, map: rt, bumpMap: rt, bumpScale: 3 });
  }
  mats.lens.userData.noShadow = true;
  // flat decals sit a hair above surfaces
  for (const k of ['seam', 'black']) { mats[k].polygonOffset = true; mats[k].polygonOffsetFactor = -1; mats[k].polygonOffsetUnits = -1; }
  const tTex = threadTexture(); tTex.repeat.set(1, 0.7);
  mats.spoolThread.map = tTex; mats.spoolThread.bumpMap = tTex; mats.spoolThread.bumpScale = 1.5;

  const S = new Bucket(); // static parts

  // ===== bed =====
  S.add('body', rbox(4.0, 0.50, 1.70, 0.13, 4), 0, 0.45, 0);
  S.add('grey', rbox(3.96, 0.18, 1.66, 0.08, 3), 0, 0.13, 0);           // base tray
  for (const [x, z] of [[-1.72, -0.6], [1.72, -0.6], [-1.72, 0.6], [1.72, 0.6]]) S.add('black', cyl(0.1, 0.11, 0.05, 20), x, 0.025, z);
  // horizontal seam between tray and shell
  {
    const p = rrPts(-2.0, -0.85, 2.0, 0.85, 0.13, 6).map(([x, z]) => new V3(x * 1.0015, 0.215, z * 1.003));
    S.add('seam', tube(dense(p, 0.15), 0.006, true, 220, 4));
  }
  // accessory-box seam on the bed (front + top, at x = 0.35)
  {
    const pts = [];
    const loop = rrPts(-0.85, 0.215, 0.85, 0.70, 0.13, 6); // (z, y)
    for (const [z, y] of loop) if (y > 0.2) pts.push(new V3(0.35, y + (y > 0.69 ? 0.003 : 0), z + Math.sign(z) * 0.003));
    S.add('seam', tube(dense(pts.slice(0, Math.floor(pts.length / 2) + 1), 0.08), 0.005, false, 80, 4));
  }

  // ===== upper body (pillar + arm + head) as one bevelled extrusion =====
  {
    const s = new THREE.Shape();
    s.moveTo(0.58, 0.6); s.lineTo(2.0, 0.6); s.lineTo(2.0, 2.72);
    s.absarc(1.72, 2.72, 0.28, 0, PI / 2);
    s.lineTo(-1.72, 3.0);
    s.absarc(-1.72, 2.72, 0.28, PI / 2, PI);
    s.lineTo(-2.0, 1.72);
    s.absarc(-1.83, 1.72, 0.17, PI, 1.5 * PI);
    s.lineTo(-0.95, 1.55);
    s.absarc(-0.95, 1.70, 0.15, 1.5 * PI, 2 * PI);
    s.lineTo(-0.80, 1.80);
    s.absarc(-0.50, 1.80, 0.30, PI, PI / 2, true);
    s.lineTo(0.72, 2.10);
    s.absarc(0.72, 1.82, 0.28, PI / 2, 0, true);
    s.lineTo(0.96, 1.05);
    s.absarc(0.61, 1.05, 0.35, 0, -PI / 2, true);
    s.lineTo(0.58, 0.70);
    const g = ext(s, FRONT - BACK, 0.13, 16, 5, 0.75);
    S.add('body', g, 0, 0, (FRONT + BACK) / 2);
  }
  // face-plate seam around the head (x = -1.76) and a seam where the arm meets the pillar top
  {
    const loop = rrPts(BACK, 1.55, FRONT, 3.0, 0.13, 6).map(([z, y]) => new V3(-1.76, y + (y > 2.99 ? 0.004 : y < 1.56 ? -0.004 : 0), z + (z > FRONT - 0.01 ? 0.004 : z < BACK + 0.01 ? -0.004 : 0)));
    S.add('seam', tube(dense(loop, 0.1), 0.0065, true, 160, 4));
  }

  // ===== pillar front panel with dials =====
  {
    S.add('grey', ext(rrShape(1.14, 0.98, 1.86, 1.98, 0.1), 0.05, 0.018, 10, 2), 0, 0, FRONT);
    // big stitch selector dial
    const dz = FRONT + 0.025;
    const dial = lathe([[0, 0.14], [0.17, 0.14], [0.20, 0.135], [0.215, 0.12], [0.22, 0.03], [0.225, 0.0]], 48);
    dial.rotateX(PI / 2);
    S.add('body', dial, 1.5, 1.56, dz);
    S.add('grip', new THREE.CylinderGeometry(0.228, 0.228, 0.085, 64, 1, true), 1.5, 1.56, dz + 0.07, PI / 2, 0, 0);
    S.add('accent', rbox(0.03, 0.12, 0.012, 0.005, 1), 1.5, 1.66, dz + 0.141);
    // tick marks around the dial (plain, no numerals)
    for (let i = 0; i <= 10; i++) {
      const a = PI * 1.25 - (i / 10) * PI * 1.5, r = 0.285, L = i % 5 === 0 ? 0.05 : 0.03;
      S.add('dgrey', rbox(0.011, L, 0.006, 0.002, 1), 1.5 + Math.cos(a) * (r + L / 2), 1.56 + Math.sin(a) * (r + L / 2), FRONT + 0.026, 0, 0, a - PI / 2);
    }
    // small stitch-length dial
    const sd = lathe([[0, 0.09], [0.09, 0.09], [0.105, 0.08], [0.11, 0.0]], 36); sd.rotateX(PI / 2);
    S.add('body', sd, 1.5, 1.14, dz);
    S.add('grip', new THREE.CylinderGeometry(0.114, 0.114, 0.055, 40, 1, true), 1.5, 1.14, dz + 0.042, PI / 2, 0, 0);
    S.add('dgrey', rbox(0.016, 0.07, 0.008, 0.003, 1), 1.5, 1.165, dz + 0.091);
    for (let i = 0; i < 5; i++) { const x = 1.36 + i * 0.07; S.add('dgrey', rbox(0.008, 0.025, 0.006, 0.002, 1), x, 1.29 + (i === 2 ? 0.01 : 0), FRONT + 0.026); }
  }
  // accent strip along the arm front
  S.add('accent', rbox(1.92, 0.035, 0.03, 0.012, 2), 0.06, 2.72, FRONT);
  // speed slider
  S.add('dgrey', ext(rrShape(0.08, 2.37, 0.72, 2.43, 0.03), 0.02, 0.006, 8, 2), 0, 0, FRONT + 0.002);
  for (let i = 0; i < 5; i++) S.add('dgrey', rbox(0.008, 0.03, 0.006, 0.002, 1), 0.1 + i * 0.15, 2.475, FRONT + 0.004);
  S.add('grey', rbox(0.08, 0.13, 0.07, 0.025, 3), 0.27, 2.40, FRONT + 0.03);
  S.add('dgrey', rbox(0.012, 0.09, 0.01, 0.002, 1), 0.27, 2.40, FRONT + 0.066);
  // buttons (start/stop with accent ring, needle up/down)
  {
    const b = lathe([[0, 0.05], [0.07, 0.05], [0.085, 0.035], [0.088, 0.0]], 36); b.rotateX(PI / 2);
    S.add('grey', b, -0.32, 2.40, FRONT);
    const ring = new THREE.TorusGeometry(0.1, 0.01, 8, 40); S.add('accent', ring, -0.32, 2.40, FRONT + 0.004);
    const b2 = lathe([[0, 0.04], [0.05, 0.04], [0.06, 0.025], [0.062, 0.0]], 32); b2.rotateX(PI / 2);
    S.add('grey', b2, -0.6, 2.40, FRONT);
  }
  // reverse button on the head front
  S.add('grey', rbox(0.2, 0.085, 0.06, 0.03, 3), -1.52, 1.80, FRONT + 0.01);
  S.add('dgrey', ext(rrShape(-1.64, 1.745, -1.40, 1.855, 0.045), 0.012, 0.004, 8, 1), 0, 0, FRONT + 0.001);

  // threading channel area on the head front
  S.add('dgrey', ext(rrShape(-1.22, 1.84, -0.95, 2.86, 0.06), 0.02, 0.006, 8, 2), 0, 0, FRONT + 0.001);
  S.add('body', rbox(0.04, 0.82, 0.03, 0.012, 2), -1.085, 2.33, FRONT + 0.012);   // divider rib
  S.add('black', ext(rrShape(-1.175, 2.15, -1.125, 2.84, 0.022), 0.01, 0.002, 6, 1), 0, 0, FRONT + 0.012); // take-up slot

  // ===== top: carry-handle recess, spool pin base, bobbin winder, thread guide =====
  {
    const recess = flatPlate(-0.6, -0.16, 0.18, 0.16, 0.15, 0.01, 0.003);
    S.add('grey', recess, 0, 3.0 + 0.001, 0);
    const p = rrPts(-0.6, -0.16, 0.18, 0.16, 0.15, 6).map(([x, z]) => new V3(x, 3.009, z));
    S.add('seam', tube(dense(p, 0.1), 0.007, true, 100, 4));
    S.add('dgrey', flatPlate(-0.48, -0.06, 0.06, 0.06, 0.055, 0.008, 0.002), 0, 3.009, 0);
  }
  // bobbin winder
  S.add('grey', cyl(0.11, 0.12, 0.05, 32), 1.42, 3.02, 0.0);
  S.add('chrome', cyl(0.018, 0.018, 0.22, 12), 1.42, 3.14, 0.0);
  S.add('grey', rbox(0.1, 0.07, 0.14, 0.025, 2), 1.62, 3.03, 0.0);
  // pre-tension guide on the top left front
  S.add('grey', rbox(0.16, 0.07, 0.12, 0.03, 3), -0.78, 3.025, 0.24);
  S.add('chrome', new THREE.TorusGeometry(0.025, 0.007, 6, 16), -0.78, 3.085, 0.24, 0, PI / 2, 0);
  S.add('chrome', cyl(0.045, 0.045, 0.012, 24), -0.62, 3.03, 0.24, PI / 2, 0, 0);
  S.add('chrome', cyl(0.045, 0.045, 0.012, 24), -0.62, 3.03, 0.26, PI / 2, 0, 0);

  // ===== right side: power socket + switch =====
  S.add('black', ext(rrShape(-0.36, 0.86, -0.02, 1.16, 0.04), 0.012, 0.003, 6, 1), 2.0, 0, 0, 0, PI / 2, 0);
  S.add('dgrey', rbox(0.04, 0.1, 0.07, 0.015, 2), 2.01, 1.05, -0.24);
  S.add('dgrey', rbox(0.04, 0.12, 0.08, 0.015, 2), 2.01, 1.04, -0.11);

  // ===== needle plate, feed-dog slots, bobbin cover =====
  const NPX0 = -1.62, NPX1 = -0.88, NPZ0 = -0.34, NPZ1 = 0.30;
  const holes = [
    [NX - 0.05, NZ - 0.024, NX + 0.05, NZ + 0.024, 0.022],          // needle hole (zigzag width)
    [NX - 0.112, NZ - 0.16, NX - 0.07, NZ + 0.14, 0.018],           // feed dog slots
    [NX + 0.07, NZ - 0.16, NX + 0.112, NZ + 0.14, 0.018],
  ];
  S.add('brushed', flatPlate(NPX0, NPZ0, NPX1, NPZ1, 0.05, 0.005, 0.0018, holes), 0, BED_Y + 0.0045, 0);
  S.add('black', flatPlate(NX - 0.13, NZ - 0.18, NX + 0.13, NZ + 0.16, 0.02, 0.0008, 0), 0, BED_Y + 0.0012, 0);
  for (const [x, z] of [[-1.48, -0.27], [-1.02, -0.27]]) {
    S.add('chrome', cyl(0.028, 0.03, 0.006, 20), x, BED_Y + 0.008, z);
    S.add('black', rbox(0.04, 0.003, 0.007, 0.001, 1), x, BED_Y + 0.0113, z, 0, 0.6, 0);
  }
  // seam-guide engraving (plain lines)
  for (const [x, L] of [[-0.99, 0.5], [-0.955, 0.38], [-0.92, 0.5], [-1.51, 0.5], [-1.545, 0.38]]) {
    S.add('black', rbox(0.004, 0.0015, L, 0.0005, 1), x, BED_Y + 0.0068, -0.02);
  }
  for (let i = 0; i < 4; i++) S.add('black', rbox(0.05, 0.0015, 0.004, 0.0005, 1), -0.935, BED_Y + 0.0068, -0.2 + i * 0.12);
  // bobbin cavity + bobbin + clear cover
  const BCX0 = -1.58, BCX1 = -0.92, BCZ0 = 0.315, BCZ1 = 0.63;
  S.add('dgrey', flatPlate(BCX0 + 0.02, BCZ0 + 0.02, BCX1 - 0.02, BCZ1 - 0.02, 0.05, 0.0008, 0), 0, BED_Y + 0.0006, 0);
  {
    const disc = new THREE.CircleGeometry(0.115, 40); disc.rotateX(-PI / 2);
    S.add('thread', disc, -1.25, BED_Y + 0.0016, 0.47);
    const hub = new THREE.RingGeometry(0.03, 0.05, 32); hub.rotateX(-PI / 2);
    S.add('clear', hub, -1.25, BED_Y + 0.0019, 0.47);
    const rim = new THREE.TorusGeometry(0.118, 0.006, 6, 40); rim.rotateX(PI / 2);
    S.add('steel', rim, -1.25, BED_Y + 0.002, 0.47);
  }
  S.add('clear', flatPlate(BCX0, BCZ0, BCX1, BCZ1, 0.07, 0.005, 0.0018), 0, BED_Y + 0.0045, 0);
  S.add('grey', rbox(0.07, 0.008, 0.035, 0.003, 1), BCX1 - 0.06, BED_Y + 0.007, (BCZ0 + BCZ1) / 2);

  // ===== under the head: LED lens housing, bushings =====
  const LED = new V3(-1.56, 1.55, 0.24);
  S.add('dgrey', ext(rrShape(-0.11, -0.045, 0.11, 0.045, 0.04), 0.02, 0.006, 6, 2), LED.x, LED.y - 0.004, LED.z, PI / 2, 0, 0);
  const lensGeo = prep(ext(rrShape(-0.085, -0.028, 0.085, 0.028, 0.026), 0.012, 0.004, 6, 2));
  xf(lensGeo, LED.x, LED.y - 0.014, LED.z, PI / 2, 0, 0);
  const lens = new THREE.Mesh(lensGeo, mats.lens);
  rig.add(lens);
  S.add('grey', cyl(0.07, 0.07, 0.03, 24), NX, 1.54, NZ);
  S.add('grey', cyl(0.06, 0.06, 0.03, 24), NX, 1.54, NZ - 0.22);
  S.add('grey', rbox(0.14, 0.03, 0.08, 0.012, 2), NX + 0.02, 1.545, 0.36);   // lower thread guide
  S.add('chrome', new THREE.TorusGeometry(0.018, 0.005, 6, 14), NX + 0.06, 1.522, 0.38, PI / 2, 0, 0);

  // ===== thread: static path spool -> guide -> down channel -> U-turn =====
  const SP = new V3(0.6, 3.0, -0.2); // spool pin base
  const TH = 0.0075;
  {
    const zc = FRONT + 0.024;
    const pts = [
      new V3(SP.x - 0.2, SP.y + 0.32, SP.z), new V3(-0.62, 3.05, 0.25), new V3(-0.78, 3.09, 0.24),
      new V3(-0.92, 3.06, 0.34), new V3(-0.995, 2.99, FRONT + 0.01), new V3(-1.01, 2.86, zc),
      new V3(-1.01, 1.95, zc), new V3(-1.04, 1.885, zc), new V3(-1.085, 1.87, zc), new V3(-1.13, 1.885, zc), new V3(-1.15, 1.93, zc),
    ];
    S.add('thread', tube(dense(pts, 0.06), TH, false, 260, 5));
    const lower = [new V3(-1.15, 1.66, zc), new V3(-1.165, 1.58, FRONT - 0.01), new V3(NX + 0.06, 1.53, 0.40), new V3(NX + 0.06, 1.522, 0.38)];
    S.add('thread', tube(dense(lower, 0.03), TH, false, 40, 5));
  }

  // ===== spool pin + felt =====
  S.add('felt', cyl(0.17, 0.17, 0.012, 32), SP.x, SP.y + 0.006, SP.z);
  S.add('chrome', cyl(0.017, 0.017, 0.72, 12), SP.x, SP.y + 0.36, SP.z);
  S.add('chrome', new THREE.SphereGeometry(0.017, 12, 8), SP.x, SP.y + 0.72, SP.z);

  const staticMeshes = S.build(rig, mats);

  // ===== needle bar assembly (moves) =====
  const needle = new THREE.Group(); rig.add(needle);
  {
    const B = new Bucket();
    const clampBot = TIP_UP + 0.37;
    B.add('chrome', cyl(0.032, 0.032, 0.8, 20), NX, clampBot + 0.09 + 0.4, NZ);
    B.add('chrome', rbox(0.085, 0.1, 0.085, 0.015, 2), NX, clampBot + 0.05, NZ);
    B.add('chrome', cyl(0.028, 0.028, 0.06, 16), NX + 0.07, clampBot + 0.06, NZ, 0, 0, PI / 2);
    B.add('chrome', cyl(0.034, 0.034, 0.016, 16), NX + 0.105, clampBot + 0.06, NZ, 0, 0, PI / 2);
    B.add('chrome', new THREE.TorusGeometry(0.016, 0.005, 6, 12), NX, clampBot + 0.13, NZ + 0.048, PI / 2, 0, 0);
    // needle: shank, blade, tapered point
    B.add('steel', cyl(0.018, 0.018, 0.12, 12), NX, clampBot - 0.04, NZ);
    B.add('steel', cyl(0.018, 0.009, 0.03, 12), NX, clampBot - 0.115, NZ);
    B.add('steel', cyl(0.009, 0.009, 0.18, 10), NX, TIP_UP + 0.11, NZ);
    B.add('steel', cyl(0.009, 0.0008, 0.04, 10), NX, TIP_UP + 0.0, NZ + 0.0);
    B.add('black', rbox(0.004, 0.022, 0.02, 0.001, 1), NX, TIP_UP + 0.045, NZ);   // eye
    // thread from bar guide down the needle front groove to the eye, then out the back
    const zc = NZ + 0.011;
    const p = [new V3(NX, clampBot + 0.13, NZ + 0.048), new V3(NX, clampBot + 0.02, NZ + 0.05), new V3(NX, clampBot - 0.08, zc + 0.01), new V3(NX, TIP_UP + 0.07, zc), new V3(NX, TIP_UP + 0.045, NZ), new V3(NX, TIP_UP + 0.035, NZ - 0.03), new V3(NX - 0.004, TIP_UP + 0.005, NZ - 0.055)];
    B.add('thread', tube(dense(p, 0.03), 0.0055, false, 60, 5));
    B.build(needle, mats);
  }

  // ===== presser foot assembly (moves) =====
  const foot = new THREE.Group(); rig.add(foot);
  foot.position.set(NX, 0, NZ);
  {
    const B = new Bucket();
    // sole with needle slot (local: sole bottom at y=0, needle at x=z=0)
    const sole = flatPlate(-0.085, -0.14, 0.085, 0.17, 0.035, 0.02, 0.006, [[-0.05, -0.022, 0.05, 0.022, 0.02]]);
    B.add('brushed', sole, 0, 0.01, 0);
    // upturned toe
    const t = new THREE.Shape();
    const c = [0.17, 0.065], ro = 0.065, ri = 0.045;
    t.moveTo(c[0], c[1] - ro); t.absarc(c[0], c[1], ro, -PI / 2, -0.15, false);
    t.lineTo(c[0] + ri * Math.cos(-0.15), c[1] + ri * Math.sin(-0.15)); t.absarc(c[0], c[1], ri, -0.15, -PI / 2, true); t.closePath();
    const toe = ext(t, 0.17, 0.006, 10, 2); toe.rotateY(-PI / 2);
    B.add('brushed', toe, 0, 0, 0);
    // dark snap-on ankle + shank
    B.add('black', rbox(0.11, 0.06, 0.18, 0.02, 2), 0, 0.045, -0.15);
    B.add('dgrey', rbox(0.09, 0.30, 0.1, 0.025, 3), 0, 0.2, -0.22);
    B.add('chrome', cyl(0.012, 0.012, 0.13, 10), 0, 0.03, -0.1, 0, 0, PI / 2);
    // presser bar + screw
    B.add('chrome', cyl(0.028, 0.028, 0.95, 18), 0, 0.33 + 0.475, -0.22);
    B.add('chrome', cyl(0.024, 0.024, 0.07, 14), -0.08, 0.3, -0.22, 0, 0, PI / 2);
    B.add('chrome', cyl(0.036, 0.036, 0.02, 18), -0.12, 0.3, -0.22, 0, 0, PI / 2);
    B.build(foot, mats);
  }

  // ===== take-up lever (moves vertically in its slot) =====
  const takeup = new THREE.Group(); rig.add(takeup);
  const TU = { x: -1.15, z: FRONT + 0.075 };
  {
    const B = new Bucket();
    B.add('chrome', rbox(0.036, 0.05, 0.11, 0.012, 2), TU.x, 0, FRONT + 0.03);
    B.add('chrome', new THREE.TorusGeometry(0.02, 0.007, 8, 16), TU.x, 0, TU.z, PI / 2, 0, 0);
    B.build(takeup, mats);
  }

  // ===== feed dogs (two serrated bars) =====
  const dogs = new THREE.Group(); rig.add(dogs);
  {
    const B = new Bucket();
    const s = new THREE.Shape();
    const z0 = -0.14, z1 = 0.12, n = 7, th = 0.012;
    s.moveTo(z0, -0.05); s.lineTo(z1, -0.05); s.lineTo(z1, 0);
    for (let i = n - 1; i >= 0; i--) { const a = z0 + (z1 - z0) * i / n, b = z0 + (z1 - z0) * (i + 1) / n; s.lineTo(a + (b - a) * 0.25, th); s.lineTo(a, 0); }
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: false }); g.translate(0, 0, -0.015); g.rotateY(-PI / 2);
    B.add('dogs', g.clone(), NX - 0.091, 0, NZ);
    B.add('dogs', g, NX + 0.091, 0, NZ);
    B.build(dogs, mats, false, true);
  }

  // ===== handwheel =====
  const handwheel = new THREE.Group(); rig.add(handwheel);
  handwheel.position.set(2.0, 2.35, -0.03);
  {
    const B = new Bucket();
    const w = lathe([[0.0, 0.112], [0.25, 0.112], [0.33, 0.118], [0.39, 0.135], [0.425, 0.15], [0.442, 0.147], [0.45, 0.135], [0.451, 0.125], [0.451, 0.02], [0.44, 0.003], [0.42, -0.01], [0.0, -0.01]], 72);
    w.rotateZ(-PI / 2);
    B.add('body', w);
    const hub = lathe([[0, 0.15], [0.06, 0.147], [0.085, 0.135], [0.09, 0.11]], 40); hub.rotateZ(-PI / 2);
    B.add('grey', hub);
    const grip = new THREE.CylinderGeometry(0.463, 0.463, 0.09, 96, 1, true); grip.rotateZ(PI / 2); B.add('grip', grip, 0.07, 0, 0);
    // a moulded index notch so rotation reads
    B.add('accent', rbox(0.02, 0.13, 0.03, 0.008, 1), 0.122, 0.33, 0);
    B.build(handwheel, mats);
    const hit = new THREE.Mesh(cyl(0.6, 0.6, 0.45, 16), new THREE.MeshBasicMaterial({ visible: false }));
    hit.rotation.z = PI / 2; hit.position.x = 0.12; hit.name = 'hit'; handwheel.add(hit);
  }

  // ===== spool =====
  const spool = new THREE.Group(); rig.add(spool);
  spool.position.set(SP.x, SP.y + 0.012, SP.z);
  const spoolSpin = new THREE.Group(); spool.add(spoolSpin);
  {
    const B = new Bucket();
    const fl = lathe([[0.03, 0], [0.215, 0], [0.225, 0.008], [0.225, 0.022], [0.215, 0.03], [0.03, 0.03]], 48);
    B.add('spoolPlastic', fl.clone(), 0, 0, 0);
    B.add('spoolPlastic', fl, 0, 0.53, 0);
    B.add('spoolPlastic', cyl(0.05, 0.05, 0.5, 24), 0, 0.28, 0);
    B.add('black', new THREE.RingGeometry(0.018, 0.03, 20), 0, 0.5605, 0, -PI / 2, 0, 0);
    const th = lathe([[0.19, 0.03], [0.2, 0.034], [0.202, 0.05], [0.202, 0.51], [0.2, 0.526], [0.19, 0.53]], 64);
    B.add('spoolThread', th);
    B.build(spoolSpin, mats);
    const hit = new THREE.Mesh(cyl(0.42, 0.42, 1.0, 16), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 0.3; hit.name = 'hit'; spool.add(hit);
  }

  // ===== dynamic thread strands =====
  const segGeo = new THREE.CylinderGeometry(TH, TH, 1, 5, 1, true); segGeo.translate(0, 0.5, 0);
  const strand = () => { const m = new THREE.Mesh(segGeo, mats.thread); m.castShadow = false; rig.add(m); return m; };
  const sA = strand(), sB = strand(), sC = strand();
  const UP = new V3(0, 1, 0), _d = new V3();
  function seg(m, a, b) {
    _d.subVectors(b, a); const L = _d.length();
    m.position.copy(a); m.quaternion.setFromUnitVectors(UP, _d.multiplyScalar(1 / L)); m.scale.set(1, L, 1);
  }
  const pA0 = new V3(-1.15, 1.93, FRONT + 0.024), pB1 = new V3(-1.15, 1.66, FRONT + 0.024), pC0 = new V3(NX + 0.06, 1.522, 0.38);
  const pEye = new V3(), pBar = new V3();

  // ===== LED spotlight =====
  const spot = new THREE.SpotLight(0xf2f6ff, 0, 2.6, 0.62, 0.65, 1.6);
  spot.castShadow = false;
  spot.position.set(LED.x, LED.y - 0.02, LED.z);
  spot.target.position.set(NX, BED_Y, NZ);
  rig.add(spot, spot.target);

  // ===== state & API =====
  let phase = 0, footUp = 0, cloth = 0.03, spoolAcc = 0, lampK = 0;
  let bumpT = 9, bumpS = 0;

  function placeFoot() { foot.position.y = BED_Y + cloth + footUp * 0.13; }
  function setPhase(phi) {
    const d = Math.abs(phi - phase); if (d < 50) spoolAcc += d; phase = phi;
    const c = Math.cos(phi), s = Math.sin(phi);
    const ny = -STROKE * (1 - c) / 2;
    needle.position.y = ny;
    // take-up lever peaks a little before the needle top, dwells low while the needle is down
    const a = phi + 0.75;
    const ty = 2.49 + 0.25 * Math.cos(a) + 0.04 * Math.cos(2 * a);
    takeup.position.y = ty;
    dogs.position.set(0, BED_Y - 0.0015 + 0.0075 * (1 + c), -0.022 * s);
    handwheel.rotation.x = phi;
    spoolSpin.rotation.y = -spoolAcc * 0.05;
    pEye.set(TU.x, ty, TU.z);
    seg(sA, pA0, pEye); seg(sB, pEye, pB1);
    pBar.set(NX, TIP_UP + 0.37 + 0.13 + ny, NZ + 0.048);
    seg(sC, pC0, pBar);
  }
  function setFoot(up) { footUp = THREE.MathUtils.clamp(up, 0, 1); placeFoot(); }
  function setClothThickness(h) { cloth = Math.max(0, h); placeFoot(); }
  function setLamp(k) {
    lampK = THREE.MathUtils.clamp(k, 0, 1);
    mats.lens.emissiveIntensity = 2.2 * lampK;
    spot.intensity = 9 * lampK;
  }
  function setThreadColor(hex) { mats.thread.color.set(hex); mats.spoolThread.color.set(hex); }
  function bump(strength = 1) { bumpT = 0; bumpS = strength; }
  function update(dt) {
    if (bumpT < 0.6) {
      bumpT += dt;
      const k = bumpS * Math.exp(-bumpT * 9) * (bumpT < 0.6 ? 1 : 0);
      rig.position.y = 0.07 * k * Math.abs(Math.sin(bumpT * 26));
      rig.rotation.z = 0.025 * k * Math.sin(bumpT * 33);
      rig.rotation.x = 0.012 * k * Math.sin(bumpT * 24 + 1);
      if (bumpT >= 0.6) { rig.position.y = 0; rig.rotation.set(0, 0, 0); }
    }
  }
  function groundAt(lx, lz) {
    const dx = Math.max(0, Math.abs(lx) - 2.0), dz = Math.max(0, Math.abs(lz) - 0.85);
    const d = Math.hypot(dx, dz);
    if (d <= 0) return BED_Y + 0.008;
    const t = Math.min(1, d / 0.45), sm = t * t * (3 - 2 * t);
    return (BED_Y + 0.008) * (1 - sm);
  }
  const needleLocal = new V3(NX, BED_Y, NZ);
  function lampWorldTarget(out = new V3()) {
    group.updateWorldMatrix(true, false);
    return out.copy(needleLocal).applyMatrix4(group.matrixWorld);
  }

  placeFoot(); setPhase(0); setLamp(0);

  return {
    group, bedY: BED_Y, needleLocal, groundAt, setPhase, setFoot, setLamp, setThreadColor,
    setClothThickness, bump, update, spool, handwheel, lampWorldTarget,
    _debug: { mats, staticMeshes, rig, spot },
  };
}

// Procedural cloth panel -> folded tote bag.
// One continuous analytic model (no cloth solver):
//   * a "strip" (the folded bag seen as a wide band, from the grip through the handles and the
//     opening down to the bottom fold) drops vertically from the grip and runs onto the ground;
//   * the two layers (back = far half, front = near half) are offset from that strip along its
//     normal by bulges (lumps, fill, gape, gaping open sides, drape folds);
//   * while folding, the near half follows a "page" curve hinged at the bottom fold.
// Small springs (pendulum swing, popping lumps, fill/gape/sewn) give secondary motion.
import * as THREE from 'three';
import { getFabric } from './fabrics.js';

export const CLOTH = { W: 2.0, L: 4.4, H: 2.2, HANDLE: 1.0, SEAM_IN: 0.09 };

const H = CLOTH.H, HANDLE = CLOTH.HANDLE;
const HS = 0.016;               // half the gap between the two layers
const EPS = 0.004;              // lift above the ground
const TH = 0.014, SW = 0.22;    // strap thickness / width
const LC2 = Math.PI * HS / 2;   // half the crease arc length
const HEM_A = HANDLE + LC2;     // strip parameter of the hem (top opening)
const ATOT = HANDLE + H;        // strip parameter of the bottom fold
const OV = 0.2, XA = 0.4;       // strap overlap onto the panel, attachment half spacing
const XSEAM = 1 - CLOTH.SEAM_IN / (CLOTH.W / 2);
const K = 72, DA = ATOT / K;    // strip samples
const KD = 13, RD = 0.17;       // ground drape (parabolic dilation) radius in samples / curvature radius
const PM = 100, SIGMAX = ATOT + LC2 + 0.08, DS = SIGMAX / PM; // page samples
const LP = 1.8;                 // pendulum length used for the swing tilt
const NHS = 64;                 // samples along each handle
const A1 = HEM_A + OV;
const LS = 2 * (A1 - XA) + Math.PI * XA; // strap length (lying U layout)
const MAX_ST = 400;

const XS = (() => { const a = [-1, -0.955, -0.91, -0.865]; for (let i = 0; i < 19; i++) a.push(-0.82 + i * (1.64 / 18)); a.push(0.865, 0.91, 0.955, 1); return Float64Array.from(a); })();
const NC = XS.length, JC = 13;
const E = (() => { const e = [0, LC2 * 0.5, LC2, 0.07, 0.13, 0.2]; for (let i = 3; i <= 20; i++) e.push(i / 10); e.push(2.07, 2.135, 2.2); return e; })();
const MID = E.length - 1, NR = 2 * MID + 1;
const SIG = new Float64Array(NR);
for (let r = 0; r <= MID; r++) { SIG[MID + r] = E[r]; SIG[MID - r] = -E[r]; }

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };
function bsearch(arr, v) { let lo = 0, hi = arr.length - 2; if (v <= arr[0]) return 0; if (v >= arr[hi + 1]) return hi; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (arr[m] <= v) lo = m; else hi = m - 1; } return lo; }

function spring(s, target, w, z, dt) { // damped spring step (semi-implicit), s={v,d}
  const n = Math.max(1, Math.ceil(dt / 0.012)), h = dt / n;
  for (let i = 0; i < n; i++) { s.d += (-(s.v - target) * w * w - 2 * z * w * s.d) * h; s.v += s.d * h; }
  return s.v;
}

let stitchGeo = null;

export function createCloth(fabricId) {
  let fab = getFabric(fabricId);
  const group = new THREE.Group(); group.name = 'cloth';

  // ---------- panel geometry ----------
  const NV = NR * NC;
  const pos = new Float32Array(NV * 3), nrm = new Float32Array(NV * 3), uvs = new Float32Array(NV * 2), col = new Float32Array(NV * 3).fill(1);
  for (let i = 0; i < NR; i++) for (let j = 0; j < NC; j++) { const v = i * NC + j; uvs[v * 2] = (XS[j] + 1) / 2; uvs[v * 2 + 1] = (SIG[i] + H) / (2 * H); }
  const idx = [];
  for (let i = 0; i < NR - 1; i++) for (let j = 0; j < NC - 1; j++) {
    const a = i * NC + j, b = a + 1, c = a + NC, d = c + 1; idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  const posA = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const nrmA = new THREE.BufferAttribute(nrm, 3).setUsage(THREE.DynamicDrawUsage);
  const colA = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posA); geo.setAttribute('normal', nrmA); geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2)); geo.setAttribute('color', colA);
  geo.setIndex(idx);

  const matOut = new THREE.MeshPhysicalMaterial({ map: fab.map, normalMap: fab.normalMap, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.88, sheen: 0.7, sheenRoughness: 0.5, sheenColor: new THREE.Color(fab.sheenColor).multiplyScalar(0.55), side: THREE.FrontSide, shadowSide: THREE.DoubleSide });
  const matIn = new THREE.MeshPhysicalMaterial({ map: fab.backMap, normalMap: fab.normalMap, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.9, sheen: 0.6, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffffff).multiplyScalar(0.45), vertexColors: true, side: THREE.BackSide });
  const meshOut = new THREE.Mesh(geo, matOut); meshOut.castShadow = true; meshOut.receiveShadow = true;
  const meshIn = new THREE.Mesh(geo, matIn); meshIn.receiveShadow = true;
  const hitMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, visible: false }));
  meshOut.name = 'cloth-outside'; meshIn.name = 'cloth-inside'; hitMesh.name = 'cloth-hit';
  group.add(meshOut, meshIn, hitMesh);

  // ---------- handles (rectangular webbing ribbons) ----------
  const handles = [0, 1].map((h) => {
    const nv = NHS * 8, hp = new Float32Array(nv * 3), hn = new Float32Array(nv * 3), hu = new Float32Array(nv * 2), hidx = [];
    for (let m = 0; m < NHS; m++) {
      const v = m / (NHS - 1);
      const us = [1, 0, 0, 0, 0, 1, 1, 1]; // u per ring vertex: top(c0,c1) side(c1,c2) bottom(c2,c3) side(c3,c0)
      for (let q = 0; q < 8; q++) { hu[(m * 8 + q) * 2] = us[q] * 0.96 + 0.02; hu[(m * 8 + q) * 2 + 1] = v; }
      if (m < NHS - 1) for (let f = 0; f < 4; f++) {
        const A = m * 8 + f * 2, B = A + 1, C = A + 8, D = B + 8; hidx.push(A, C, B, B, C, D);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(hp, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(hn, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(hu, 2)); g.setIndex(hidx);
    return { g, hp, hn, cx: new Float32Array(NHS * 3), rn: new Float32Array(NHS * 3), layer: h ? 1 : -1 };
  });
  const matStrap = new THREE.MeshStandardMaterial({ map: fab.strapMap, normalMap: fab.strapNormalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.75 });
  const handleMeshes = handles.map((hd) => { const m = new THREE.Mesh(hd.g, matStrap); m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; group.add(m); return m; });

  // ---------- stitches ----------
  if (!stitchGeo) { stitchGeo = new THREE.CapsuleGeometry(0.0062, 0.038, 2, 6); stitchGeo.rotateZ(Math.PI / 2); }
  const matStitch = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.38, metalness: 0.0 });
  const stitchMesh = new THREE.InstancedMesh(stitchGeo, matStitch, MAX_ST);
  stitchMesh.count = 0; stitchMesh.frustumCulled = false; stitchMesh.castShadow = false;
  stitchMesh.setColorAt(0, new THREE.Color(1, 1, 1));
  stitchMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(stitchMesh);

  // ---------- state ----------
  const pose = { fold: 0, nearCurl: 0, grip: new THREE.Vector3(0, 0, -1.3), yaw: 0, gape: 0, handleWiggle: 0, fill: 0 };
  const seams = { R: { sewn: false }, L: { sewn: false } };
  const lumps = [];
  const stitches = [];
  const attached = [];
  let ground = () => 0;
  let frozen = false, time = 0, firstUpdate = true;

  const sp = { fill: { v: 0, d: 0 }, gape: { v: 0, d: 0 }, sewR: { v: 0, d: 0 }, sewL: { v: 0, d: 0 } };
  const lumpVis = new WeakMap();
  const bob = { x: 0, z: 0, vx: 0, vz: 0 }; const lastGrip = new THREE.Vector3(NaN, 0, 0);

  // strip buffers
  const SP = new Float64Array((K + 1) * 3), ST = new Float64Array((K + 1) * 3), SN = new Float64Array((K + 1) * 3), SX = new Float64Array((K + 1) * 3);
  const SWH = new Float64Array(K + 1), SLAT = new Float64Array((K + 1) * NC), RAW = new Float64Array((K + 1) * NC), DIL = new Float64Array((K + 1) * NC), HP = new Float64Array(K + 1);
  let kLie = K + 1; // first lying sample
  // page buffers
  const PU = new Float64Array(PM + 1), PV = new Float64Array(PM + 1), PPSI = new Float64Array(PM + 1);
  const pageF = { P0x: 0, P0y: 0, P0z: 0, Tx: 0, Ty: 0, Tz: 1, Nx: 0, Ny: 1, Nz: 0, Xx: 1, Xz: 0, Ex: 0, Ey: 0, Ez: 0 };
  // per-row temps
  const offF = new Float64Array(NC), offB = new Float64Array(NC), xF = new Float64Array(NC), xB = new Float64Array(NC), dAF = new Float64Array(NC), aoF = new Float64Array(NC);
  let lumpList = []; let lumpMax = 0;
  let wPS = 1;           // weight of the strip model for the front layer (1 = folded)
  let fillV = 0, gapeV = 0, sewR = 0, sewL = 0, foldedness = 0;
  let dX = 1, dZ = 0, fX = 0, fZ = 1; // lateral axis and run direction

  // strip sample result
  const S = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0, nx: 0, ny: 0, nz: 0, xx: 0, xy: 0, xz: 0, wh: 0, k: 0, t: 0 };
  function sampleStrip(a) {
    let k, t, ext = 0;
    if (a <= 0) { k = 0; t = 0; ext = a; } else if (a >= ATOT) { k = K - 1; t = 1; ext = a - ATOT; } else { const f = a / DA; k = Math.min(K - 1, f | 0); t = f - k; }
    const o0 = k * 3, o1 = o0 + 3, u = 1 - t;
    S.tx = ST[o0] * u + ST[o1] * t; S.ty = ST[o0 + 1] * u + ST[o1 + 1] * t; S.tz = ST[o0 + 2] * u + ST[o1 + 2] * t;
    S.px = SP[o0] * u + SP[o1] * t + S.tx * ext; S.py = SP[o0 + 1] * u + SP[o1 + 1] * t + S.ty * ext; S.pz = SP[o0 + 2] * u + SP[o1 + 2] * t + S.tz * ext;
    S.nx = SN[o0] * u + SN[o1] * t; S.ny = SN[o0 + 1] * u + SN[o1 + 1] * t; S.nz = SN[o0 + 2] * u + SN[o1 + 2] * t;
    S.xx = SX[o0] * u + SX[o1] * t; S.xy = SX[o0 + 1] * u + SX[o1 + 1] * t; S.xz = SX[o0 + 2] * u + SX[o1 + 2] * t;
    S.wh = SWH[k] * u + SWH[k + 1] * t; S.k = k; S.t = t;
  }
  function latAt(x) { // lateral ground height offset at last sampled strip position
    const j = bsearch(XS, x), tj = clamp((x - XS[j]) / (XS[j + 1] - XS[j]), 0, 1), k = S.k, t = S.t;
    const a0 = SLAT[k * NC + j] * (1 - tj) + SLAT[k * NC + j + 1] * tj, a1 = SLAT[(k + 1) * NC + j] * (1 - tj) + SLAT[(k + 1) * NC + j + 1] * tj;
    return a0 * (1 - t) + a1 * t;
  }
  // strip-mode world position: layer offset 'off' along the strip normal (signed)
  const _p = new THREE.Vector3();
  function stripPos(a, x, off, out) {
    sampleStrip(a);
    const lat = (1 - S.wh) * latAt(x);
    out.set(S.px + S.xx * x + S.nx * off, S.py + S.xy * x + S.ny * off + lat, S.pz + S.xz * x + S.nz * off);
    return out;
  }

  // ---------- strip build ----------
  function buildStrip() {
    const g = pose.grip; const yaw = pose.yaw;
    dX = Math.cos(yaw); dZ = -Math.sin(yaw); fX = Math.sin(yaw); fZ = Math.cos(yaw);
    const g0 = ground(g.x, g.z);
    const base = g0 + EPS + HS;
    const hDrop = g.y - base;
    let rc = 0, Lv = 0;
    if (hDrop > 0.002) { rc = clamp(hDrop * 0.38, 0.002, 0.5); Lv = Math.max(0, hDrop - rc); }
    const aC = hDrop > 0.002 ? Lv + Math.PI / 2 * rc : 0;
    const hangFrac = clamp(Lv / ATOT, 0, 1);
    const sw = hangFrac * hangFrac / LP;
    let dvx = (bob.x) * sw, dvy = -1, dvz = (bob.z) * sw; const dl = Math.hypot(dvx, dvy, dvz); dvx /= dl; dvy /= dl; dvz /= dl;
    // hanging part (vertical + rounded corner) by tangent integration
    let px = g.x, py = Math.max(g.y, base), pz = g.z;
    kLie = K + 1;
    for (let k = 0; k <= K; k++) {
      const a = k * DA;
      if (k > 0) {
        const am = a - DA * 0.5;
        if (am >= aC) { // reached the ground: integrate exactly to aC and stop
          const ap = (k - 1) * DA, rem = Math.max(0, aC - ap);
          const bm = rc > 0 ? clamp((ap + rem * 0.5 - Lv) / rc, 0, Math.PI / 2) : Math.PI / 2;
          let tx = dvx * Math.cos(bm) + fX * Math.sin(bm), ty = dvy * Math.cos(bm), tz = dvz * Math.cos(bm) + fZ * Math.sin(bm); const tl = Math.hypot(tx, ty, tz) || 1;
          px += tx / tl * rem; py += ty / tl * rem; pz += tz / tl * rem;
          kLie = k; break;
        }
        const b = rc > 0 ? clamp((am - Lv) / rc, 0, Math.PI / 2) : 0;
        let tx = dvx * Math.cos(b) + fX * Math.sin(b), ty = dvy * Math.cos(b), tz = dvz * Math.cos(b) + fZ * Math.sin(b); const tl = Math.hypot(tx, ty, tz) || 1;
        px += tx / tl * DA; py += ty / tl * DA; pz += tz / tl * DA;
      }
      SP[k * 3] = px; SP[k * 3 + 1] = py; SP[k * 3 + 2] = pz;
      for (let j = 0; j < NC; j++) SLAT[k * NC + j] = 0;
      if (k === K) kLie = K + 1;
    }
    if (hDrop <= 0.002) { kLie = 0; }
    // lying part: march along the run direction over the draped ground
    if (kLie <= K) {
      const Fx = px, Fz = pz;           // foot (start of lying part), aC
      for (let k = kLie; k <= K; k++) HP[k] = k * DA - aC;
      for (let it = 0; it < 2; it++) {
        for (let k = kLie; k <= K; k++) {
          const cx = Fx + fX * HP[k], cz = Fz + fZ * HP[k];
          for (let j = 0; j < NC; j++) RAW[k * NC + j] = ground(cx + dX * XS[j], cz + dZ * XS[j]);
        }
        // parabolic dilation along the run, then across (cloth bridges over edges)
        const c = 1 / (2 * RD);
        for (let k = kLie; k <= K; k++) for (let j = 0; j < NC; j++) {
          let m = -1e9;
          for (let q = Math.max(kLie, k - KD); q <= Math.min(K, k + KD); q++) { const d = (q - k) * DA; const v = RAW[q * NC + j] - d * d * c; if (v > m) m = v; }
          DIL[k * NC + j] = m;
        }
        for (let k = kLie; k <= K; k++) {
          for (let j = 0; j < NC; j++) {
            let m = -1e9;
            for (let q = 0; q < NC; q++) { const d = XS[q] - XS[j]; const v = DIL[k * NC + q] - d * d * c; if (v > m) m = v; }
            RAW[k * NC + j] = m;
          }
        }
        // light smoothing along the run
        for (let k = kLie; k <= K; k++) for (let j = 0; j < NC; j++) {
          const a0 = RAW[Math.max(kLie, k - 1) * NC + j], a1 = RAW[k * NC + j], a2 = RAW[Math.min(K, k + 1) * NC + j];
          DIL[k * NC + j] = a0 * 0.25 + a1 * 0.5 + a2 * 0.25;
        }
        if (it === 0) { // arc-length correct horizontal spacing on slopes
          for (let k = kLie + 1; k <= K; k++) {
            const dy = DIL[k * NC + JC] - DIL[(k - 1) * NC + JC];
            HP[k] = HP[k - 1] + Math.sqrt(Math.max(DA * DA - dy * dy, 0.09 * DA * DA));
          }
        }
      }
      for (let k = kLie; k <= K; k++) {
        const yc = DIL[k * NC + JC];
        SP[k * 3] = Fx + fX * HP[k]; SP[k * 3 + 1] = yc + EPS + HS; SP[k * 3 + 2] = Fz + fZ * HP[k];
        for (let j = 0; j < NC; j++) SLAT[k * NC + j] = DIL[k * NC + j] - yc;
      }
      if (kLie > 0) { // smooth the junction height
        const k = kLie; SP[k * 3 + 1] = (SP[k * 3 + 1] + SP[(k - 1) * 3 + 1]) * 0.5;
      }
    }
    // frames
    for (let k = 0; k <= K; k++) {
      const k0 = Math.max(0, k - 1), k1 = Math.min(K, k + 1);
      let tx = SP[k1 * 3] - SP[k0 * 3], ty = SP[k1 * 3 + 1] - SP[k0 * 3 + 1], tz = SP[k1 * 3 + 2] - SP[k0 * 3 + 2];
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      ST[k * 3] = tx; ST[k * 3 + 1] = ty; ST[k * 3 + 2] = tz;
      // lateral axis orthogonal to T
      const d = dX * tx + dZ * tz; let xx = dX - d * tx, xy = -d * ty, xz = dZ - d * tz; const xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
      SX[k * 3] = xx; SX[k * 3 + 1] = xy; SX[k * 3 + 2] = xz;
      // N = T x X
      let nx = ty * xz - tz * xy, ny = tz * xx - tx * xz, nz = tx * xy - ty * xx; const nl = Math.hypot(nx, ny, nz) || 1;
      SN[k * 3] = nx / nl; SN[k * 3 + 1] = ny / nl; SN[k * 3 + 2] = nz / nl;
      const w = clamp(-ty, 0, 1); SWH[k] = w * w * (3 - 2 * w);
    }
    return hangFrac;
  }

  // ---------- page (near half while folding) ----------
  function buildPage() {
    const f = clamp(pose.fold, 0, 1), phi = Math.PI * f;
    const psi0 = Math.PI / 2 * f * f * f;
    const ell = LC2 + 1.9 * Math.pow(1 - f, 1.2);
    const droop = -0.55 * Math.sin(2 * phi) * (1 - f * f);
    const nc = pose.nearCurl * (1 - f) * (1 - f);
    const curl = nc * (0.62 + 0.16 * Math.sin(time * 2.6) + 0.06 * Math.sin(time * 6.1));
    sampleStrip(ATOT);
    pageF.Tx = S.tx; pageF.Ty = S.ty; pageF.Tz = S.tz; pageF.Nx = S.nx; pageF.Ny = S.ny; pageF.Nz = S.nz;
    pageF.Ex = S.px; pageF.Ey = S.py; pageF.Ez = S.pz;
    pageF.P0x = S.px + S.tx * HS; pageF.P0y = S.py + S.ty * HS; pageF.P0z = S.pz + S.tz * HS;
    let u = 0, v = 0, psiH = 0, lift = 0, dangle = 0;
    const psiAt = (s) => {
      const t = s / ell; const G = t < 1 ? 1 - (1 - t) * (1 - t) : 1;
      let p = psi0 + (phi - psi0) * G;
      const D = clamp((s - ell) / Math.max(H - ell, 0.25), 0, 1); p += droop * Math.pow(D, 1.5);
      p += curl * sstep(H - 1.0, H + 0.15, s);
      if (s > H) p += dangle * lift * (1 - Math.exp(-(s - H) / 0.22));
      return p;
    };
    for (let m = 0; m <= PM; m++) {
      const s = m * DS;
      if (m > 0) { const p = psiAt(s - DS * 0.5); u += Math.cos(p) * DS; v += Math.sin(p) * DS; }
      PU[m] = u; PV[m] = v; PPSI[m] = psiAt(s);
      if (s <= H && s + DS > H) { // at the tip: decide how the near handle dangles
        psiH = psiAt(H); lift = sstep(0.12, 0.7, v);
        dangle = -Math.PI / 2 * Math.tanh(2.5 * (Math.cos(psiH) + 0.25));
      }
    }
  }
  const Q = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };
  function samplePage(s) {
    const f = clamp(s / DS, 0, PM - 1e-6), m = Math.min(PM - 1, f | 0), t = f - m;
    const u = PU[m] + (PU[m + 1] - PU[m]) * t, v = PV[m] + (PV[m + 1] - PV[m]) * t, p = PPSI[m] + (PPSI[m + 1] - PPSI[m]) * t;
    const F = pageF;
    Q.x = F.P0x + F.Tx * u + F.Nx * v; Q.y = F.P0y + F.Ty * u + F.Ny * v; Q.z = F.P0z + F.Tz * u + F.Nz * v;
    const sp_ = Math.sin(p), cp = Math.cos(p);
    Q.nx = F.Tx * sp_ - F.Nx * cp; Q.ny = F.Ty * sp_ - F.Ny * cp; Q.nz = F.Tz * sp_ - F.Nz * cp; // printed-side normal
  }
  function pagePos(s, x, off, floorBehind, floorFront, out) {
    samplePage(s);
    const f = clamp(pose.fold, 0, 1);
    const sag = 0.1 * Math.sin(Math.PI * f) * x * x * clamp(s / H, 0, 1);
    let px = Q.x + dX * x + Q.nx * off, py = Q.y + Q.ny * off - sag, pz = Q.z + dZ * x + Q.nz * off;
    const along = (px - pageF.Ex) * pageF.Tx + (pz - pageF.Ez) * pageF.Tz;
    const fl = ground(px, pz) + EPS + floorFront + (floorBehind - floorFront) * sstep(0.04, -0.06, along);
    py = smax(py, fl, 0.03);
    return out.set(px, py, pz);
  }

  // ---------- offsets (bulges) ----------
  function envSide(x) {
    const ax = Math.abs(x), s = x >= 0 ? sewR : sewL, t = ax / XSEAM;
    const open = 1 - 0.18 * Math.min(t * t, 1.3);
    const closed = t >= 1 ? 0 : Math.pow(1 - t * t, 0.6);
    return open + (closed - open) * s;
  }
  function lumpBulge(x, y, wh) {
    let acc = 0;
    for (let i = 0; i < lumpList.length; i++) {
      const L = lumpList[i]; const rr = L.rr; if (rr <= 1e-4) continue;
      const fp = rr * (1.6 + 0.9 * (1 - wh));
      const dx = x - L.x, dy = (y - L.y) * H, d2 = dx * dx + dy * dy; if (d2 >= fp * fp) continue;
      const u2 = d2 / (fp * fp), b = rr * Math.pow(1 - u2, 1.6);
      acc += b * b * b;
    }
    return Math.cbrt(acc);
  }

  // ---------- body ----------
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
  function buildBody() {
    const f = clamp(pose.fold, 0, 1);
    wPS = sstep(0.9, 0.995, f);
    const needPage = wPS < 1;
    const t = time;
    for (let r = 0; r <= MID; r++) {
      const sig = E[r], y = sig / H;
      const crease = sig <= LC2 + 1e-9;
      const a = crease ? ATOT : ATOT - (sig - LC2);
      sampleStrip(a); const wh = S.wh;
      const fy = sstep(0, 0.14, y);
      // --- offsets for both layers (strip mode)
      for (let j = 0; j < NC; j++) {
        const x = XS[j], env = envSide(x), ax = Math.abs(x);
        const sewS = x >= 0 ? sewR : sewL;
        let B = 0;
        if (!crease) {
          const Bl = lumpBulge(x, y, wh) * fy * env;
          const Bf = fillV * 0.4 * sstep(0, 0.32, y) * (1 - 0.32 * sstep(0.45, 1, y)) * env;
          const Bp = wh * 0.022 * env * fy;
          B = Math.cbrt(Bl * Bl * Bl + Bf * Bf * Bf + Bp * Bp * Bp);
        }
        const yTop = Math.pow(sstep(0.42, 1, y), 1.3);
        const arch = Math.pow(Math.max(0, Math.cos(Math.PI / 2 * x / 1.08)), 0.7) * (1 + ((ax >= XSEAM ? 0 : Math.pow(1 - (ax / XSEAM) ** 2, 0.6)) - 1) * sewS);
        const lift = gapeV * 0.36 * (1 - wh) * arch * yTop;
        const mouth = wh * (0.03 + 0.27 * gapeV + 0.08 * fillV) * env * Math.pow(sstep(0.58, 1, y), 1.3);
        const side = wh * (1 - sewS) * (0.05 + 0.75 * lumpMax + 0.22 * fillV) * sstep(0.45, 1.0, ax) * sstep(0.04, 0.55, y);
        const fold1 = wh * fy * (0.4 + 0.6 * (1 - y)) * (0.011 * (0.5 + 0.5 * Math.sin(7.3 * x + 0.6 + 0.25 * Math.sin(0.7 * t))) + 0.006 * (0.5 + 0.5 * Math.sin(15.5 * x + 2.1 + 0.3 * Math.sin(1.13 * t))));
        const fold2 = wh * fy * (0.4 + 0.6 * (1 - y)) * (0.011 * (0.5 + 0.5 * Math.sin(6.1 * x + 2.4 + 0.2 * Math.sin(0.8 * t))) + 0.006 * (0.5 + 0.5 * Math.sin(13.7 * x + 0.3)));
        offF[j] = crease ? 0 : smax(B * (2 - wh), lift, 0.06) + mouth + side + fold1;
        offB[j] = crease ? 0 : B * wh + mouth + side + fold2;
        // hanging: top edge sags between/outside the handle attachments; full bag gets shorter & rounder
        let da = 0;
        if (wh > 0.001) {
          const sagX = ax < XA ? 0.045 * Math.pow(Math.cos(Math.PI / 2 * ax / XA), 2) : 0.11 * Math.pow((ax - XA) / (1 - XA), 1.35) * (1 + 0.6 * fillV);
          da = wh * (sagX * Math.pow(sstep(0.7, 1, y), 1.5) - fillV * (0.2 * (1 - y) * (1 - y) + 0.13 * sstep(0.55, 1, ax) * sstep(0.32, 0, y)) - 0.06 * lumpMax * (1 - y) * (1 - y));
        }
        dAF[j] = da;
        // inside ambient occlusion (darker deep inside the folded bag)
        let ao = 1 - foldedness * 0.6 * sstep(0, 0.42 + 0.35 * gapeV, 1 - y);
        ao += (1 - ao) * (1 - sewS) * sstep(0.72, 1, ax) * 0.65 * wh;
        aoF[j] = ao;
      }
      // --- width contraction (cloth does not stretch: bulging pulls the sides in)
      xF[JC] = 0; xB[JC] = 0;
      for (const dir of [1, -1]) {
        for (let j = JC + dir; j >= 0 && j < NC; j += dir) {
          const dx = Math.abs(XS[j] - XS[j - dir]);
          const dF = offF[j] - offF[j - dir], dB = offB[j] - offB[j - dir];
          xF[j] = xF[j - dir] + dir * Math.sqrt(Math.max(dx * dx - dF * dF, 0.3 * dx * dx));
          xB[j] = xB[j - dir] + dir * Math.sqrt(Math.max(dx * dx - dB * dB, 0.3 * dx * dx));
        }
        const s = dir > 0 ? sewR : sewL;
        if (s > 0) for (let j = JC + dir; j >= 0 && j < NC; j += dir) { const m = (xF[j] + xB[j]) * 0.5; xF[j] += (m - xF[j]) * s; xB[j] += (m - xB[j]) * s; }
      }
      // --- positions
      const iF = MID + r, iB = MID - r;
      for (let j = 0; j < NC; j++) {
        const x = XS[j];
        if (crease) {
          const al = sig / HS;
          stripPos(ATOT + dAF[j], x, 0, _a);
          // front (+) and back (-) halves of the rounded crease
          for (const sg of (r === 0 ? [1] : [1, -1])) {
            const ca = Math.cos(al), sa = Math.sin(al) * sg;
            const i = sg > 0 ? iF : iB, o = (i * NC + j) * 3;
            pos[o] = _a.x + S.tx * HS * ca + S.nx * HS * sa; pos[o + 1] = _a.y + S.ty * HS * ca + S.ny * HS * sa; pos[o + 2] = _a.z + S.tz * HS * ca + S.nz * HS * sa;
            if (sg > 0 && needPage) {
              pagePos(sig, x, 0, 2 * HS, 0, _b);
              pos[o] = _b.x + (pos[o] - _b.x) * wPS; pos[o + 1] = _b.y + (pos[o + 1] - _b.y) * wPS; pos[o + 2] = _b.z + (pos[o + 2] - _b.z) * wPS;
            }
            col[o] = col[o + 1] = col[o + 2] = aoF[j];
          }
          continue;
        }
        // back layer
        stripPos(a + dAF[j], xB[j], -(HS + offB[j]), _a);
        let o = (iB * NC + j) * 3; pos[o] = _a.x; pos[o + 1] = _a.y; pos[o + 2] = _a.z; col[o] = col[o + 1] = col[o + 2] = aoF[j];
        // front layer
        o = (iF * NC + j) * 3;
        if (wPS > 0) stripPos(a + dAF[j], xF[j], HS + offF[j], _a);
        if (needPage) {
          const wig = pose.nearCurl * (1 - f) * 0.045 * Math.sin(3.1 * x + 4.3 * t) * sstep(H - 0.7, H, sig);
          pagePos(sig, x, -wig, 2 * HS, 0, _b);
          if (wPS > 0) _b.lerp(_a, wPS);
          _a.copy(_b);
        }
        pos[o] = _a.x; pos[o + 1] = _a.y; pos[o + 2] = _a.z; col[o] = col[o + 1] = col[o + 2] = aoF[j] + (1 - aoF[j]) * (1 - wPS);
      }
    }
    // normals: n = dU x dV (points to the printed outside)
    for (let i = 0; i < NR; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(NR - 1, i + 1);
      for (let j = 0; j < NC; j++) {
        const j0 = Math.max(0, j - 1), j1 = Math.min(NC - 1, j + 1);
        const a0 = (i * NC + j0) * 3, a1 = (i * NC + j1) * 3, b0 = (i0 * NC + j) * 3, b1 = (i1 * NC + j) * 3;
        const ux = pos[a1] - pos[a0], uy = pos[a1 + 1] - pos[a0 + 1], uz = pos[a1 + 2] - pos[a0 + 2];
        const vx = pos[b1] - pos[b0], vy = pos[b1 + 1] - pos[b0 + 1], vz = pos[b1 + 2] - pos[b0 + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
        const o = (i * NC + j) * 3; nrm[o] = nx / l; nrm[o + 1] = ny / l; nrm[o + 2] = nz / l;
      }
    }
    posA.needsUpdate = true; nrmA.needsUpdate = true; colA.needsUpdate = true;
    geo.computeBoundingSphere();
  }

  // grid lookup on a layer at bag coords (x in [-1,1], y in [0,1]); layer +1 front, -1 back
  function gridSample(layer, x, y, outP, outN) {
    const sig = clamp(y, 0, 1) * H * (layer > 0 ? 1 : -1);
    const i = bsearch(SIG, sig), ti = clamp((sig - SIG[i]) / (SIG[i + 1] - SIG[i]), 0, 1);
    const j = bsearch(XS, clamp(x, -1, 1)), tj = clamp((x - XS[j]) / (XS[j + 1] - XS[j]), 0, 1);
    const o00 = (i * NC + j) * 3, o01 = o00 + 3, o10 = o00 + NC * 3, o11 = o10 + 3;
    const w00 = (1 - ti) * (1 - tj), w01 = (1 - ti) * tj, w10 = ti * (1 - tj), w11 = ti * tj;
    if (outP) outP.set(pos[o00] * w00 + pos[o01] * w01 + pos[o10] * w10 + pos[o11] * w11, pos[o00 + 1] * w00 + pos[o01 + 1] * w01 + pos[o10 + 1] * w10 + pos[o11 + 1] * w11, pos[o00 + 2] * w00 + pos[o01 + 2] * w01 + pos[o10 + 2] * w10 + pos[o11 + 2] * w11);
    if (outN) outN.set(nrm[o00] * w00 + nrm[o01] * w01 + nrm[o10] * w10 + nrm[o11] * w11, nrm[o00 + 1] * w00 + nrm[o01 + 1] * w01 + nrm[o10 + 1] * w10 + nrm[o11 + 1] * w11, nrm[o00 + 2] * w00 + nrm[o01 + 2] * w01 + nrm[o10 + 2] * w10 + nrm[o11 + 2] * w11).normalize();
  }

  // ---------- handles ----------
  const _h0 = new THREE.Vector3(), _hn = new THREE.Vector3(), _corr = [new THREE.Vector3(), new THREE.Vector3()], _m = new THREE.Vector3();
  function handleLayout(s, tau, out) { // returns a (strip param) and x for arc position s along the strap
    // relaxed U lying flat
    let aU, xU;
    const leg = A1 - XA;
    if (s <= leg) { aU = A1 - s; xU = -XA; }
    else if (s <= leg + Math.PI * XA) { const th = (s - leg) / XA; xU = -XA * Math.cos(th); aU = XA - XA * Math.sin(th); }
    else { aU = XA + (s - leg - Math.PI * XA); xU = XA; }
    // taut: two legs converging on the grip
    const half = LS / 2; let aT, xT;
    if (s <= half) { aT = A1 * (1 - s / half); xT = -XA * Math.pow(Math.min(aT / HEM_A, 1), 0.55); }
    else { aT = A1 * ((s - half) / half); xT = XA * Math.pow(Math.min(aT / HEM_A, 1), 0.55); }
    out.a = aU + (aT - aU) * tau; out.x = xU + (xT - xU) * tau;
    return out;
  }
  const HL = { a: 0, x: 0 };
  function buildHandles() {
    sampleStrip(0.5); const tau = S.wh;
    const hw = pose.handleWiggle, t = time;
    for (const hd of handles) {
      const L = hd.layer; // -1 back(far), +1 front(near)
      const page = L > 0 && wPS < 1;
      const offHem = L * (HS - TH / 2 - 0.003);
      const offLie = L > 0 ? -HS + 1.5 * TH + 0.002 : -HS + TH / 2;
      const offHang = L * 0.6 * TH;
      // correction so the free part meets the sewn-on part exactly at the hem
      for (let q = 0; q < 2; q++) {
        const xq = q ? XA : -XA;
        gridSample(L, xq, 1, _h0, _hn); _h0.addScaledVector(_hn, -(TH / 2 + 0.003));
        if (page) { pagePos(ATOT + LC2 - HEM_A, xq, -(TH / 2 + 0.003), 1.5 * TH, TH / 2, _m); if (wPS > 0) _m.lerp(stripPos(HEM_A, xq, offHem, _c), wPS); }
        else stripPos(HEM_A, xq, offHem, _m);
        _corr[q].subVectors(_h0, _m);
      }
      const ph = L * 1.7;
      for (let m = 0; m < NHS; m++) {
        const s = m / (NHS - 1) * LS;
        handleLayout(s, page ? 0 : tau, HL);
        let a = HL.a, x = HL.x;
        const free = clamp(1 - a / HEM_A, 0, 1);
        x += hw * 0.07 * Math.sin(4.1 * t + ph) * free;
        const o = m * 3;
        if (a >= HEM_A) {
          gridSample(L, x, (ATOT + LC2 - a) / H, _h0, _hn);
          _h0.addScaledVector(_hn, -(TH / 2 + 0.003));
          hd.rn[o] = _hn.x * L; hd.rn[o + 1] = _hn.y * L; hd.rn[o + 2] = _hn.z * L;
        } else {
          const tauL = page ? 0 : tau;
          const rampLie = sstep(HEM_A, HEM_A - 0.16, a), rampHang = 1 - a / HEM_A;
          const ramp = rampLie + (rampHang - rampLie) * tauL;
          const target = offLie + (offHang - offLie) * tauL;
          const off = offHem + (target - offHem) * ramp;
          const cw = sstep(HEM_A - 0.35, HEM_A, a) + (a / HEM_A - sstep(HEM_A - 0.35, HEM_A, a)) * tauL;
          const liftH = hw * (0.07 + 0.035 * Math.sin(5.3 * t + ph)) * Math.pow(free, 1.5);
          if (page) {
            pagePos(ATOT + LC2 - a, x, -(TH / 2 + 0.003), 1.5 * TH + 0.003, TH / 2, _h0);
            const pn = Q; let rx = pn.nx, ry = pn.ny, rz = pn.nz;
            if (wPS > 0) { _h0.lerp(stripPos(a, x, off, _c), wPS); rx += (S.nx - rx) * wPS; ry += (S.ny - ry) * wPS; rz += (S.nz - rz) * wPS; }
            hd.rn[o] = rx; hd.rn[o + 1] = ry; hd.rn[o + 2] = rz;
          } else {
            stripPos(a, x, off, _h0);
            hd.rn[o] = S.nx; hd.rn[o + 1] = S.ny; hd.rn[o + 2] = S.nz;
          }
          _h0.addScaledVector(_corr[x < 0 ? 0 : 1], cw);
          _h0.y += liftH * (1 - tauL); _h0.x += S.nx * liftH * tauL * L; _h0.z += S.nz * liftH * tauL * L;
        }
        hd.cx[o] = _h0.x; hd.cx[o + 1] = _h0.y; hd.cx[o + 2] = _h0.z;
      }
      // ribbon
      const hp = hd.hp, hn = hd.hn, cx = hd.cx, rn = hd.rn;
      for (let m = 0; m < NHS; m++) {
        const m0 = Math.max(0, m - 1) * 3, m1 = Math.min(NHS - 1, m + 1) * 3, o = m * 3;
        let tx = cx[m1] - cx[m0], ty = cx[m1 + 1] - cx[m0 + 1], tz = cx[m1 + 2] - cx[m0 + 2]; let l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
        // width dir w = t x n
        let wx = ty * rn[o + 2] - tz * rn[o + 1], wy = tz * rn[o] - tx * rn[o + 2], wz = tx * rn[o + 1] - ty * rn[o]; l = Math.hypot(wx, wy, wz) || 1; wx /= l; wy /= l; wz /= l;
        // thickness dir k = w x t
        const kx = wy * tz - wz * ty, ky = wz * tx - wx * tz, kz = wx * ty - wy * tx;
        const hw2 = SW / 2, ht = TH / 2;
        const C = [[hw2, ht], [-hw2, ht], [-hw2, -ht], [hw2, -ht]];
        const Nf = [[kx, ky, kz], [-wx, -wy, -wz], [-kx, -ky, -kz], [wx, wy, wz]];
        for (let fI = 0; fI < 4; fI++) {
          const c0 = C[fI], c1 = C[(fI + 1) % 4], n = Nf[fI];
          for (let q = 0; q < 2; q++) {
            const c = q ? c1 : c0, v = (m * 8 + fI * 2 + q) * 3;
            hp[v] = cx[o] + wx * c[0] + kx * c[1]; hp[v + 1] = cx[o + 1] + wy * c[0] + ky * c[1]; hp[v + 2] = cx[o + 2] + wz * c[0] + kz * c[1];
            hn[v] = n[0]; hn[v + 1] = n[1]; hn[v + 2] = n[2];
          }
        }
      }
      hd.g.attributes.position.needsUpdate = true; hd.g.attributes.normal.needsUpdate = true;
      hd.g.computeBoundingSphere();
    }
  }

  // ---------- stitches ----------
  const _sp = new THREE.Vector3(), _sn = new THREE.Vector3(), _prev = new THREE.Vector3(), _dir = new THREE.Vector3(), _zA = new THREE.Vector3(), _mat = new THREE.Matrix4(), _col = new THREE.Color();
  const lastStitch = { R: null, L: null };
  function seamXY(side, tt, off) { return { x: (side === 'R' ? 1 : -1) * (XSEAM - clamp(off, -0.12, 0.12)), y: 1 - clamp(tt, 0, 1) }; }
  function buildStitches() {
    const prevBySide = { R: null, L: null };
    const prevPos = { R: new THREE.Vector3(), L: new THREE.Vector3() };
    const n = Math.min(stitches.length, MAX_ST);
    for (let i = 0; i < n; i++) {
      const st = stitches[i]; const q = seamXY(st.side, st.t, st.off);
      gridSample(1, q.x, q.y, _sp, _sn);
      if (prevBySide[st.side]) { _dir.subVectors(_sp, prevPos[st.side]); }
      else { const q2 = seamXY(st.side, st.t + 0.02, st.off); gridSample(1, q2.x, q2.y, _prev, null); _dir.subVectors(_prev, _sp); }
      const dist = _dir.length();
      _dir.addScaledVector(_sn, -_dir.dot(_sn)); if (_dir.lengthSq() < 1e-10) _dir.set(0, -1, 0); _dir.normalize();
      _zA.crossVectors(_dir, _sn).normalize();
      const len = prevBySide[st.side] ? clamp(dist * 0.85, 0.03, 0.056) : 0.045;
      _mat.makeBasis(_dir.multiplyScalar(len / 0.0504), _sn, _zA);
      _mat.setPosition(_sp.x + _sn.x * 0.0032, _sp.y + _sn.y * 0.0032, _sp.z + _sn.z * 0.0032);
      stitchMesh.setMatrixAt(i, _mat);
      prevBySide[st.side] = st; prevPos[st.side].copy(_sp);
    }
    stitchMesh.count = n;
    stitchMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- attachments ----------
  const _m5 = new THREE.Matrix4(), _one = new THREE.Vector3(1, 1, 1), _scl = new THREE.Vector3();
  const _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _ax = new THREE.Vector3(), _m4 = new THREE.Matrix4();
  function buildAttached() {
    for (const at of attached) {
      gridSample(1, at.x, at.y, _sp, _sn);
      gridSample(1, at.x + 0.02, at.y, _prev, null); _ax.subVectors(_prev, _sp); _ax.addScaledVector(_sn, -_ax.dot(_sn)).normalize();
      _zA.crossVectors(_ax, _sn).normalize();
      _m4.makeBasis(_ax, _sn, _zA); _q.setFromRotationMatrix(_m4);
      at.obj.position.copy(_sp).addScaledVector(_sn, 0.002); at.obj.quaternion.copy(_q);
      const par = at.obj.parent;
      if (par && par !== group && !par.isScene) { // convert world -> parent local
        par.updateWorldMatrix(true, false);
        _m4.compose(at.obj.position, _q, _one); _m5.copy(par.matrixWorld).invert().multiply(_m4);
        _m5.decompose(at.obj.position, at.obj.quaternion, _scl);
      }
    }
  }

  // ---------- update ----------
  function update(dt = 1 / 60) {
    if (frozen && !firstUpdate) return;
    dt = clamp(dt || 0, 0, 0.05);
    time += dt;
    // secondary springs
    fillV = spring(sp.fill, clamp(pose.fill, 0, 1), 9, 0.42, firstUpdate ? 10 : dt);
    gapeV = spring(sp.gape, clamp(pose.gape, 0, 1), 10, 0.5, firstUpdate ? 10 : dt);
    sewR = clamp(spring(sp.sewR, seams.R.sewn ? 1 : 0, 7, 0.75, firstUpdate ? 10 : dt), 0, 1);
    sewL = clamp(spring(sp.sewL, seams.L.sewn ? 1 : 0, 7, 0.75, firstUpdate ? 10 : dt), 0, 1);
    foldedness = sstep(0.55, 1, pose.fold);
    lumpList.length = 0; lumpMax = 0;
    for (const L of lumps) {
      let s = lumpVis.get(L); if (!s) { s = { v: firstUpdate ? 1 : 0, d: 0 }; lumpVis.set(L, s); }
      const v = Math.max(0, spring(s, 1, 13, 0.32, dt));
      const rr = (L.r || 0) * v;
      lumpList.push({ x: L.x || 0, y: L.y || 0, rr }); lumpMax = Math.max(lumpMax, rr);
    }
    // pendulum (bob lags behind the grip, only while hanging)
    const g = pose.grip;
    if (!(lastGrip.x === lastGrip.x) || lastGrip.distanceTo(g) > 1.5 || firstUpdate) { bob.x = bob.z = bob.vx = bob.vz = 0; }
    else if (dt > 0) {
      // bob offset (bag below grip) is left behind by grip motion, then springs back (damped pendulum)
      bob.x -= (g.x - lastGrip.x) * 0.9; bob.z -= (g.z - lastGrip.z) * 0.9;
      const n = Math.ceil(dt / 0.008), h = dt / n, k = 26, c = 2.4;
      for (let i = 0; i < n; i++) {
        bob.vx += (-k * bob.x - c * bob.vx) * h; bob.vz += (-k * bob.z - c * bob.vz) * h; bob.x += bob.vx * h; bob.z += bob.vz * h;
      }
      const lim = 1.1, l = Math.hypot(bob.x, bob.z); if (l > lim) { bob.x *= lim / l; bob.z *= lim / l; }
    }
    lastGrip.copy(g);
    const hangFrac = buildStrip();
    if (hangFrac < 0.98) { const d = Math.exp(-dt * 12 * (1 - hangFrac)); bob.x *= d; bob.z *= d; bob.vx *= d; bob.vz *= d; }
    buildPage();
    buildBody();
    buildHandles();
    buildStitches();
    buildAttached();
    firstUpdate = false;
  }

  // ---------- API ----------
  const cloth = {
    group, pose, lumps, seams, stitches,
    get fabricId() { return fab.id; },
    hit: [hitMesh, ...handleMeshes],
    meshes: { outside: meshOut, inside: meshIn, handles: handleMeshes, stitches: stitchMesh },
    setSewn(side, v) { if (seams[side]) seams[side].sewn = !!v; },
    addStitch(side, t, off = 0, color = 0xffffff) {
      if (stitches.length >= MAX_ST) return;
      const st = { side: side === 'L' ? 'L' : 'R', t: clamp(+t || 0, 0, 1), off: clamp(+off || 0, -0.12, 0.12), color: typeof color === 'string' ? new THREE.Color(color).getHex() : color >>> 0 };
      stitches.push(st);
      stitchMesh.setColorAt(stitches.length - 1, _col.setHex(st.color));
      stitchMesh.instanceColor.needsUpdate = true;
      lastStitch[st.side] = st;
    },
    clearStitches() { stitches.length = 0; stitchMesh.count = 0; },
    setStitches(arr) { cloth.clearStitches(); for (const s of arr || []) cloth.addStitch(s.side, s.t, s.off, s.color); },
    setGround(fn) { ground = typeof fn === 'function' ? fn : () => 0; },
    setFabric(id) {
      fab = getFabric(id);
      matOut.map = fab.map; matOut.sheenColor.set(fab.sheenColor).multiplyScalar(0.55); matIn.map = fab.backMap;
      matStrap.map = fab.strapMap; matOut.needsUpdate = matIn.needsUpdate = matStrap.needsUpdate = true;
    },
    surface(x, y, out) { gridSample(1, x, y, out.pos, out.normal); return out; },
    backSurface(x, y, out) { gridSample(-1, x, y, out.pos, out.normal); out.normal.negate(); return out; },
    inside(x, y, out) { gridSample(1, x, y, _sp, null); gridSample(-1, x, y, _prev, null); return out.addVectors(_sp, _prev).multiplyScalar(0.5); },
    attach(obj, x, y) { attached.push({ obj, x, y }); buildAttached(); return obj; },
    detach(obj) { const i = attached.findIndex((a) => a.obj === obj); if (i >= 0) attached.splice(i, 1); },
    detachAll() { attached.length = 0; },
    mouth(out) { gridSample(1, 0, 1, _sp, null); gridSample(-1, 0, 1, _prev, null); return out.addVectors(_sp, _prev).multiplyScalar(0.5); },
    handleTop(out) {
      const mid = ((NHS - 1) >> 1) * 3, mid2 = (NHS >> 1) * 3; const back = handles[0].cx, front = handles[1].cx;
      out.set((back[mid] + back[mid2]) / 2, (back[mid + 1] + back[mid2 + 1]) / 2, (back[mid + 2] + back[mid2 + 2]) / 2);
      if (wPS > 0) { _sp.set((front[mid] + front[mid2]) / 2, (front[mid + 1] + front[mid2 + 1]) / 2, (front[mid + 2] + front[mid2 + 2]) / 2); out.lerp(_sp, 0.5 * wPS); }
      return out;
    },
    nearEnd(out) { gridSample(1, 0, 1, out, null); return out; },
    update,
    settle() { bob.x = bob.z = bob.vx = bob.vz = 0; for (const k in sp) { const s = sp[k]; s.d = 0; } sp.fill.v = pose.fill; sp.gape.v = pose.gape; sp.sewR.v = seams.R.sewn ? 1 : 0; sp.sewL.v = seams.L.sewn ? 1 : 0; for (const L of lumps) lumpVis.set(L, { v: 1, d: 0 }); lastGrip.copy(pose.grip); },
    freeze() { frozen = true; },
    unfreeze() { frozen = false; },
    get frozen() { return frozen; },
    dispose() {
      geo.dispose(); for (const h of handles) h.g.dispose(); matOut.dispose(); matIn.dispose(); matStrap.dispose(); matStitch.dispose(); hitMesh.material.dispose(); stitchMesh.dispose();
      group.removeFromParent();
    },
  };
  update(0);
  return cloth;
}

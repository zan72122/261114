// ことばを使わないヒント: 主役の発光 / 置き場所の光だまり / 半透明の「ゆびさき」デモ
import * as THREE from 'three';

const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const clamp01 = (k) => (k < 0 ? 0 : k > 1 ? 1 : k);

// ------------------------------------------------------------ textures
function haloTexture() {
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,240,205,1)');
  gr.addColorStop(0.35, 'rgba(255,226,170,0.62)');
  gr.addColorStop(0.7, 'rgba(255,210,140,0.2)');
  gr.addColorStop(1, 'rgba(255,200,130,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 子どもの手 (右手の甲側, 右下から入って左上を指す)。指先の位置を返す。
function drawHand(S) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const u = S / 512;            // 512 基準の座標系
  const tipX = 150 * u, tipY = 66 * u, ang = -0.52;

  // ---- 1) 手の形を別キャンバスに描く (局所座標: 指先 (0,0), 指は -y 方向)
  const h = document.createElement('canvas');
  h.width = h.height = S;
  const k = h.getContext('2d');
  k.translate(tipX, tipY); k.rotate(ang); k.scale(u, u);
  const skinL = '#f8d5bb', skinM = '#efbf9f', skinD = '#dca183';
  const cyl = (x0, x1, light = skinL, mid = skinM, dark = skinD) => {
    const gr = k.createLinearGradient(x0, 0, x1, 0);
    gr.addColorStop(0, mid); gr.addColorStop(0.28, light); gr.addColorStop(0.7, mid); gr.addColorStop(1, dark);
    return gr;
  };
  const edge = 'rgba(150,85,60,0.32)';
  const line = (w) => { k.lineWidth = w; k.strokeStyle = edge; k.lineJoin = 'round'; k.lineCap = 'round'; };

  // 人差し指 (根元はこぶしに隠れる)
  k.beginPath();
  k.moveTo(-28, 28);
  k.bezierCurveTo(-29, 8, -16, -1, 0, -1);
  k.bezierCurveTo(16, -1, 29, 8, 29, 28);
  k.bezierCurveTo(31, 90, 35, 150, 37, 215);
  k.lineTo(-35, 215);
  k.bezierCurveTo(-33, 150, -30, 90, -28, 28);
  k.closePath();
  k.fillStyle = cyl(-30, 34); k.fill();
  line(2.2); k.stroke();

  // 爪
  k.beginPath();
  k.moveTo(-15, 22);
  k.bezierCurveTo(-15, 9, -8, 5, 0, 5);
  k.bezierCurveTo(8, 5, 15, 9, 15, 22);
  k.bezierCurveTo(15, 38, 13, 50, 0, 52);
  k.bezierCurveTo(-13, 50, -15, 38, -15, 22);
  k.closePath();
  const ng = k.createLinearGradient(0, 5, 0, 52);
  ng.addColorStop(0, 'rgba(255,240,232,0.85)'); ng.addColorStop(0.25, 'rgba(250,214,200,0.75)'); ng.addColorStop(1, 'rgba(236,178,160,0.7)');
  k.fillStyle = ng; k.fill();
  k.lineWidth = 1.4; k.strokeStyle = 'rgba(170,100,80,0.35)'; k.stroke();
  // 爪のつや
  k.beginPath(); k.ellipse(-5, 20, 3.5, 9, 0.1, 0, Math.PI * 2);
  k.fillStyle = 'rgba(255,255,255,0.45)'; k.fill();

  // 関節のしわ
  line(1.6);
  k.strokeStyle = 'rgba(150,85,60,0.22)';
  for (const [y, w] of [[92, 13], [100, 9], [158, 15]]) {
    k.beginPath(); k.moveTo(-w, y); k.quadraticCurveTo(0, y + 4, w, y); k.stroke();
  }

  // こぶし (曲げた中指・薬指・小指) + 手の甲〜手首 (画面外へ抜ける)
  k.beginPath();
  k.moveTo(-36, 640);
  k.bezierCurveTo(-48, 470, -50, 300, -40, 205);
  k.bezierCurveTo(-42, 180, -20, 172, 10, 176);
  k.bezierCurveTo(30, 150, 75, 148, 88, 166);
  k.bezierCurveTo(110, 160, 130, 172, 132, 192);
  k.bezierCurveTo(152, 195, 162, 214, 158, 236);
  k.bezierCurveTo(166, 290, 156, 420, 152, 640);
  const fist = new Path2D();
  fist.moveTo(-36, 640);
  fist.bezierCurveTo(-48, 470, -50, 300, -40, 205);
  fist.bezierCurveTo(-42, 180, -20, 172, 10, 176);
  fist.bezierCurveTo(30, 150, 75, 148, 88, 166);
  fist.bezierCurveTo(110, 160, 130, 172, 132, 192);
  fist.bezierCurveTo(152, 195, 162, 214, 158, 236);
  fist.bezierCurveTo(166, 290, 156, 420, 152, 640);
  k.closePath();
  k.fillStyle = cyl(-50, 165); k.fill();
  line(2.2); k.stroke(fist);
  // 指の付け根のこぶ (ナックル) のハイライトと指の境目
  for (const [x, y, rx, ry] of [[52, 172, 24, 13], [104, 182, 18, 11], [142, 210, 13, 10]]) {
    const hg = k.createRadialGradient(x - 4, y - 3, 0, x, y, rx);
    hg.addColorStop(0, 'rgba(255,236,222,0.75)'); hg.addColorStop(1, 'rgba(255,236,222,0)');
    k.fillStyle = hg; k.beginPath(); k.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); k.fill();
  }
  line(1.8); k.strokeStyle = 'rgba(150,85,60,0.24)';
  for (const [x0, y0, x1, y1, cx, cy] of [[86, 170, 92, 250, 84, 210], [130, 192, 132, 262, 136, 225]]) {
    k.beginPath(); k.moveTo(x0, y0); k.quadraticCurveTo(cx, cy, x1, y1); k.stroke();
  }
  // 親指 (左側, 人差し指の付け根に沿って折りたたまれている)
  k.save();
  k.translate(-46, 168); k.rotate(-0.1);
  const th = new Path2D();
  th.moveTo(4, 300);
  th.bezierCurveTo(-12, 240, -24, 190, -23, 150);
  th.bezierCurveTo(-25, 90, -24, 40, -20, 20);
  th.bezierCurveTo(-16, 2, -6, -3, 2, -3);
  th.bezierCurveTo(14, -3, 22, 6, 22, 24);
  th.bezierCurveTo(22, 60, 20, 100, 18, 140);
  const thFill = new Path2D(th);
  thFill.bezierCurveTo(26, 200, 30, 250, 30, 300);
  thFill.closePath();
  const tg = k.createLinearGradient(0, 120, 0, 290);
  k.fillStyle = cyl(-25, 24);
  k.fill(thFill);
  // 付け根側は手の甲になじませる
  k.save(); k.clip(thFill);
  tg.addColorStop(0, 'rgba(239,191,159,0)'); tg.addColorStop(1, 'rgba(239,191,159,1)');
  k.fillStyle = tg; k.fillRect(-40, 120, 90, 200);
  k.restore();
  line(2.2); k.stroke(th);
  // 親指の爪
  k.beginPath(); k.ellipse(3, 22, 10, 14, 0.05, 0, Math.PI * 2);
  k.fillStyle = 'rgba(250,218,204,0.7)'; k.fill();
  k.lineWidth = 1.2; k.strokeStyle = 'rgba(170,100,80,0.3)'; k.stroke();
  // 親指の関節しわ
  k.lineWidth = 1.5; k.strokeStyle = 'rgba(150,85,60,0.2)';
  k.beginPath(); k.moveTo(-14, 68); k.quadraticCurveTo(-2, 72, 12, 67); k.stroke();
  k.restore();

  // ---- 2) 手首側を柔らかく消す
  k.setTransform(1, 0, 0, 1, 0, 0);
  k.globalCompositeOperation = 'destination-in';
  const dx = Math.sin(-ang), dy = Math.cos(ang); // 手首方向 (局所 +y)
  const fg = k.createLinearGradient(tipX, tipY, tipX + dx * 470 * u, tipY + dy * 470 * u);
  fg.addColorStop(0, 'rgba(0,0,0,1)'); fg.addColorStop(0.62, 'rgba(0,0,0,1)'); fg.addColorStop(1, 'rgba(0,0,0,0)');
  k.fillStyle = fg; k.fillRect(0, 0, S, S);
  k.globalCompositeOperation = 'source-over';

  // ---- 3) やわらかい影を付けて合成
  g.save();
  g.shadowColor = 'rgba(70,40,25,0.32)';
  g.shadowBlur = 16 * u; g.shadowOffsetX = 7 * u; g.shadowOffsetY = 9 * u;
  g.drawImage(h, 0, 0);
  g.restore();
  return { canvas: c, tipU: tipX / S, tipV: 1 - tipY / S };
}

// ------------------------------------------------------------ main
export function createHints(engine) {
  const scene = engine && engine.scene;
  const camera = engine && engine.camera;
  const listeners = new Set();
  let idle = 0, level = 0, time = 0;

  const hints = {
    t1: 4, t2: 9,
    get level() { return level; },
    get idle() { return idle; },
  };

  function setLevel(l) {
    if (l === level) return;
    level = l;
    for (const fn of [...listeners]) { try { fn(level); } catch (e) { try { console.error(e); } catch (_) { /* */ } } }
  }
  hints.poke = () => { idle = 0; setLevel(0); };
  hints.onLevel = (fn) => { if (typeof fn === 'function') listeners.add(fn); return () => listeners.delete(fn); };

  // ---------------------------------------------------------- glow
  let glowTarget = null, glowOpt = { color: new THREE.Color(0xffe9a8), strength: 1 };
  const glowMats = new Map(); // material -> { e: Color, i: number }
  const _tmpC = new THREE.Color();
  function restoreGlow() {
    for (const [m, rec] of glowMats) {
      try { m.emissive.copy(rec.e); m.emissiveIntensity = rec.i; } catch (_) { /* */ }
    }
    glowMats.clear();
  }
  function collectGlow() {
    if (!glowTarget) return;
    try {
      glowTarget.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) {
          if (!m || !m.isMeshStandardMaterial || !m.emissive || glowMats.has(m)) continue;
          glowMats.set(m, { e: m.emissive.clone(), i: m.emissiveIntensity });
        }
      });
    } catch (_) { /* */ }
  }
  hints.glow = function (target, opt = {}) {
    try {
      const o = opt || {};
      glowOpt = { color: new THREE.Color(o.color != null ? o.color : 0xffe9a8), strength: isFinite(o.strength) ? o.strength : 1 };
      if (target === glowTarget) return;
      restoreGlow();
      glowTarget = target && target.isObject3D ? target : null;
      collectGlow();
    } catch (_) { /* */ }
  };
  let collectTimer = 0;
  function updateGlow(dt) {
    if (!glowTarget) return;
    collectTimer -= dt;
    if (collectTimer <= 0) { collectTimer = 0.4; collectGlow(); }
    const lv = [[0.10, 0.22], [0.18, 0.38], [0.28, 0.6]][level] || [0.1, 0.22];
    const b = 0.5 - 0.5 * Math.cos(time * Math.PI * 2 / (level >= 2 ? 1.1 : 1.6));
    const amt = (lv[0] + (lv[1] - lv[0]) * b) * glowOpt.strength;
    for (const [m, rec] of glowMats) {
      try {
        _tmpC.copy(rec.e).multiplyScalar(rec.i).addScaledVector(glowOpt.color, amt);
        m.emissive.copy(_tmpC); m.emissiveIntensity = 1;
      } catch (_) { /* */ }
    }
  }

  // ---------------------------------------------------------- halos
  let haloTex = null;
  function makeHalo() {
    if (!haloTex) haloTex = haloTexture();
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map: haloTex, color: 0xffe2b0, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      }));
    m.renderOrder = 50; m.visible = false; m.frustumCulled = false;
    m.userData = { a: 0, want: false, r: 1, pos: new THREE.Vector3(), ph: Math.random() * 6 };
    return m;
  }
  const halos = [makeHalo(), makeHalo()];
  function haloSet(h, pos, radius = 1) {
    try {
      const d = h.userData;
      if (!pos) { d.want = false; return; }
      d.want = true; d.r = isFinite(radius) && radius > 0 ? radius : 1;
      d.pos.copy(pos);
    } catch (_) { /* */ }
  }
  hints.halo = (pos, radius) => haloSet(halos[0], pos, radius);
  hints.halo2 = (pos, radius) => haloSet(halos[1], pos, radius);
  function updateHalo(h, dt) {
    const d = h.userData;
    d.a += ((d.want ? 1 : 0) - d.a) * Math.min(1, dt * 5);
    if (!d.want && d.a < 0.01) { d.a = 0; h.visible = false; return; }
    h.visible = true;
    const br = 0.5 + 0.5 * Math.sin(time * 2.6 + d.ph);
    h.position.set(d.pos.x, d.pos.y + 0.02, d.pos.z);
    h.scale.setScalar(d.r * (0.96 + 0.06 * br));
    h.material.opacity = d.a * (0.42 + 0.2 * br + 0.08 * level);
  }

  // ---------------------------------------------------------- ghost finger
  let fingerMesh = null, fingerInfo = null;
  function ensureFinger() {
    if (fingerMesh) return fingerMesh;
    fingerInfo = drawHand(512);
    const tex = new THREE.CanvasTexture(fingerInfo.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 2;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0.5 - fingerInfo.tipU, 0.5 - fingerInfo.tipV, 0); // 指先 = 原点
    fingerMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false,
    }));
    fingerMesh.renderOrder = 1000; fingerMesh.frustumCulled = false; fingerMesh.visible = false;
    return fingerMesh;
  }
  const F = { on: false, hiding: false, fadeMul: 0, cyc: 0, pts: null, fn: null, dur: 1.6, pause: 0.9, tap: false };
  const _pts = [];
  function getPoints() {
    let arr = F.pts;
    if (F.fn) { try { arr = F.fn(); } catch (_) { arr = null; } }
    _pts.length = 0;
    if (Array.isArray(arr)) for (const p of arr) if (p && isFinite(p.x) && isFinite(p.y) && isFinite(p.z)) _pts.push(p);
    return _pts;
  }
  const _pp = new THREE.Vector3();
  function along(pts, k, out) {
    if (pts.length === 1) return out.copy(pts[0]);
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += pts[i].distanceTo(pts[i - 1]);
    if (total <= 1e-6) return out.copy(pts[0]);
    let want = k * total;
    for (let i = 1; i < pts.length; i++) {
      const s = pts[i].distanceTo(pts[i - 1]);
      if (want <= s || i === pts.length - 1) return out.lerpVectors(pts[i - 1], pts[i], s > 0 ? clamp01(want / s) : 1);
      want -= s;
    }
    return out.copy(pts[pts.length - 1]);
  }
  hints.finger = {
    show(points, opt = {}) {
      try {
        const o = opt || {};
        if (typeof points === 'function') { F.fn = points; F.pts = null; } else { F.fn = null; F.pts = Array.isArray(points) ? points : points ? [points] : []; }
        F.dur = isFinite(o.duration) && o.duration > 0 ? o.duration : 1.6;
        F.pause = isFinite(o.pause) && o.pause >= 0 ? o.pause : 0.9;
        F.tap = !!o.tap;
        ensureFinger();
        if (!F.on || F.hiding) { F.cyc = 0; }
        F.on = true; F.hiding = false;
      } catch (_) { /* */ }
    },
    hide() { if (F.on) F.hiding = true; },
    get visible() { return F.on && !F.hiding; },
    get canvas() { ensureFinger(); return fingerInfo.canvas; },
  };
  const BASE_ALPHA = 0.55;
  function updateFinger(dt) {
    if (!fingerMesh) return;
    if (!F.on) { fingerMesh.visible = false; return; }
    F.fadeMul += ((F.hiding ? 0 : 1) - F.fadeMul) * Math.min(1, dt * (F.hiding ? 7 : 20));
    if (F.hiding && F.fadeMul < 0.01) { F.on = false; F.hiding = false; F.fadeMul = 0; fingerMesh.visible = false; return; }
    const pts = getPoints();
    if (!pts.length) { fingerMesh.visible = false; return; }
    const single = pts.length === 1 || F.tap;
    const T = [0.35, 0.2, single ? 0 : F.dur, single ? 0.08 : 0.12, 0.24, 0.35, F.pause];
    const total = T.reduce((a, b) => a + b, 0);
    F.cyc += dt;
    if (F.cyc >= total) F.cyc %= total;
    // フェーズ評価
    let tau = F.cyc, ph = 0;
    while (ph < T.length - 1 && tau >= T[ph]) { tau -= T[ph]; ph++; }
    const kk = T[ph] > 0 ? clamp01(tau / T[ph]) : 1;
    let alpha = 1, scale = 1, dark = 0, pathK = 0;
    switch (ph) {
      case 0: alpha = easeInOut(kk); scale = 1.12 - 0.12 * easeInOut(kk); break;
      case 1: scale = 1 - 0.1 * easeInOut(kk); dark = easeInOut(kk); break;
      case 2: scale = 0.9; dark = 1; pathK = easeInOut(kk); break;
      case 3: scale = 0.9; dark = 1; pathK = 1; break;
      case 4: scale = 0.9 + 0.14 * easeInOut(kk); dark = 1 - easeInOut(kk); pathK = 1; break;
      case 5: alpha = 1 - easeInOut(kk); scale = 1.04 + 0.04 * kk; pathK = 1; break;
      default: alpha = 0; pathK = 1;
    }
    along(pts, single ? 0 : pathK, _pp);
    // カメラ向き・画面上一定サイズ
    const cp = camera.position;
    const toCam = _v1.subVectors(cp, _pp);
    const dist0 = toCam.length();
    if (dist0 < 1e-3) { fingerMesh.visible = false; return; }
    toCam.multiplyScalar(1 / dist0);
    const pull = Math.min(0.3, dist0 * 0.3);
    fingerMesh.position.copy(_pp).addScaledVector(toCam, pull);
    const D = dist0 - pull;
    const w = engine.width || 1, h = engine.height || 1;
    const px = 0.25 * Math.min(w, h); // 手全体のテクスチャ一辺 (手そのものは約18%)
    const worldH = (px / h) * 2 * D * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    fingerMesh.scale.setScalar(worldH * scale);
    fingerMesh.quaternion.copy(camera.quaternion);
    const c = 1 - 0.22 * dark;
    fingerMesh.material.color.setRGB(c, c * 0.97, c * 0.95);
    fingerMesh.material.opacity = BASE_ALPHA * alpha * F.fadeMul;
    fingerMesh.visible = fingerMesh.material.opacity > 0.003;
  }
  const _v1 = new THREE.Vector3();

  // ---------------------------------------------------------- update / clear
  function ensureInScene(o) {
    if (o && scene && o.parent !== scene) { try { if (o.parent) o.parent.remove(o); scene.add(o); } catch (_) { /* */ } }
  }
  hints.update = function (dt) {
    try {
      dt = isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
      time += dt;
      idle += dt;
      setLevel(idle >= hints.t2 ? 2 : idle >= hints.t1 ? 1 : 0);
      updateGlow(dt);
      for (const h of halos) { ensureInScene(h); updateHalo(h, dt); }
      if (fingerMesh) { ensureInScene(fingerMesh); updateFinger(dt); }
    } catch (e) { try { console.error(e); } catch (_) { /* */ } }
  };
  hints.clear = function () {
    try {
      restoreGlow(); glowTarget = null;
      for (const h of halos) { h.userData.want = false; h.userData.a = 0; h.visible = false; }
      F.on = false; F.hiding = false; F.fadeMul = 0;
      if (fingerMesh) fingerMesh.visible = false;
    } catch (_) { /* */ }
  };
  return hints;
}

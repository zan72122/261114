// エンジン: レンダラ / ループ / 入力 / カメラフレーミング / 画質調整 / 保存 / フェード
// 1 unit = 10 cm, y up, テーブル上面 y=0, +x 右, +z 手前
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const STORE_KEY = 'gf-261114-3';
const SCALE_STEPS = [1, 0.85, 0.7, 0.6];
// 描画ピクセル数の上限（CSS px × 解像度²）。iPad など大画面で解像度だけが無駄に増えないようにする。
const PIXEL_BUDGET = 3.0e6;

const clamp01 = (k) => (k < 0 ? 0 : k > 1 ? 1 : k);
export const ease = {
  linear: (k) => k,
  in: (k) => k * k * k,
  out: (k) => 1 - Math.pow(1 - k, 3),
  inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2),
  outBack: (k) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); },
  outBounce: (k) => {
    const n1 = 7.5625, d1 = 2.75;
    if (k < 1 / d1) return n1 * k * k;
    if (k < 2 / d1) return n1 * (k -= 1.5 / d1) * k + 0.75;
    if (k < 2.5 / d1) return n1 * (k -= 2.25 / d1) * k + 0.9375;
    return n1 * (k -= 2.625 / d1) * k + 0.984375;
  },
  outElastic: (k) => {
    if (k <= 0) return 0; if (k >= 1) return 1;
    return Math.pow(2, -10 * k) * Math.sin((k * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
  },
};
const getEase = (e) => (typeof e === 'function' ? e : ease[e] || ease.inOut);

function safeCall(fn, ...a) {
  try { return fn(...a); } catch (err) { try { console.error(err); } catch (_) { /* */ } }
  return undefined;
}
function listenerSet() {
  const set = new Set();
  return {
    add(fn) { if (typeof fn === 'function') set.add(fn); return () => set.delete(fn); },
    emit(...a) { for (const fn of [...set]) safeCall(fn, ...a); },
    get size() { return set.size; },
  };
}

function showFallback(canvas) {
  try {
    const fb = document.getElementById('fb');
    if (fb) {
      const src = fb.getAttribute('data-src') || '';
      if (src && src.indexOf('__FALLBACK__') < 0) fb.style.backgroundImage = 'url("' + src + '")';
      fb.style.display = 'block';
    }
    if (canvas) canvas.style.display = 'none';
  } catch (_) { /* */ }
}

export function createEngine() {
  const canvas = document.getElementById('c');
  let renderer = null;
  try {
    if (!canvas) throw new Error('no canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    if (!renderer.getContext()) throw new Error('no gl');
  } catch (err) {
    try { renderer && renderer.dispose(); } catch (_) { /* */ }
    showFallback(canvas);
    return null;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // 影マップは「影を落とす物か光が動いたときだけ」描き直す（下の shadowDirty）。
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const scene = new THREE.Scene();
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    scene.environment = pmrem.fromScene(room, 0.04).texture;
    scene.environmentIntensity = 0.55;
    room.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    pmrem.dispose();
  } catch (err) { try { console.error(err); } catch (_) { /* */ } }

  const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 400);

  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); }, false);

  const L = {
    frame: listenerSet(), vis: listenerSet(), quality: listenerSet(), resize: listenerSet(),
    first: listenerSet(), down: listenerSet(), move: listenerSet(), up: listenerSet(),
  };

  const engine = {
    renderer, scene, camera, ease,
    quality: { low: false, scale: 1, maxParticles: 60 },
    safe: { top: 0, right: 0, bottom: 0, left: 0 },
    camTarget: new THREE.Vector3(),
    width: 1, height: 1,
    time: 0,
    visible: !document.hidden,
  };

  // ------------------------------------------------------------ page hardening
  const pd = (e) => { if (e.cancelable) e.preventDefault(); };
  const opt = { passive: false };
  document.addEventListener('touchstart', pd, opt);
  document.addEventListener('touchmove', pd, opt);
  document.addEventListener('gesturestart', pd, opt);
  document.addEventListener('gesturechange', pd, opt);
  document.addEventListener('gestureend', pd, opt);
  document.addEventListener('contextmenu', pd, opt);
  document.addEventListener('dblclick', pd, opt);
  document.addEventListener('selectstart', pd, opt);
  document.addEventListener('dragstart', pd, opt);
  document.addEventListener('wheel', (e) => { if (e.ctrlKey) pd(e); }, opt);

  // ------------------------------------------------------------ safe area probe
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);' +
    'padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);';
  document.body.appendChild(probe);
  function readSafe() {
    try {
      const cs = getComputedStyle(probe);
      const n = (v) => { const x = parseFloat(v); return isFinite(x) ? x : 0; };
      engine.safe.top = n(cs.paddingTop); engine.safe.right = n(cs.paddingRight);
      engine.safe.bottom = n(cs.paddingBottom); engine.safe.left = n(cs.paddingLeft);
    } catch (_) { /* */ }
  }

  // ------------------------------------------------------------ size / quality
  let qStep = 0, curPR = 0, curW = 0, curH = 0;
  let rectLeft = 0, rectTop = 0;
  function viewportSize() {
    let w = window.innerWidth | 0, h = window.innerHeight | 0;
    if (canvas.clientWidth > 0 && canvas.clientHeight > 0) { w = canvas.clientWidth; h = canvas.clientHeight; }
    return [Math.max(1, w), Math.max(1, h)];
  }
  function applySize(force) {
    const [w, h] = viewportSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pr = Math.max(1, Math.min(dpr, Math.sqrt(PIXEL_BUDGET / (w * h)))) * engine.quality.scale;
    const prChanged = Math.abs(pr - curPR) > 1e-3;
    const sizeChanged = w !== curW || h !== curH;
    if (!prChanged && !sizeChanged && !force) return false;
    if (prChanged) { curPR = pr; renderer.setPixelRatio(pr); }
    if (sizeChanged || prChanged) renderer.setSize(w, h, false);
    try { const r = canvas.getBoundingClientRect(); rectLeft = r.left; rectTop = r.top; } catch (_) { /* */ }
    if (sizeChanged || force) {
      curW = w; curH = h; engine.width = w; engine.height = h;
      readSafe();
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      reframeOnResize();
      L.resize.emit(w, h);
    }
    return true;
  }
  let resizeTimers = [];
  function onResizeEvent() {
    applySize(false);
    for (const id of resizeTimers) clearTimeout(id);
    resizeTimers = [60, 200, 450, 900].map((ms) => setTimeout(() => applySize(false), ms));
  }
  window.addEventListener('resize', onResizeEvent);
  window.addEventListener('orientationchange', onResizeEvent);
  try { if (window.visualViewport) window.visualViewport.addEventListener('resize', onResizeEvent); } catch (_) { /* */ }

  // dynamic quality
  // 目標は 60fps。下げても速くならない（省電力モードの 30fps 固定など）ときは元に戻して打ち止め。
  let ema = 17, slowAcc = 0, fastAcc = 0, grace = 1.5, downgrades = 0, skipFrames = 10;
  let qProbe = null, capMs = 0; // qProbe: {ema, step} 下げる直前の状態
  function setStep(s) {
    qStep = Math.max(0, Math.min(SCALE_STEPS.length - 1, s));
    engine.quality.scale = SCALE_STEPS[qStep];
    applySize(false);
  }
  function measure(rawMs) {
    if (skipFrames > 0) { skipFrames--; return; }
    if (!(rawMs > 0) || rawMs > 1500) return;
    rawMs = Math.min(rawMs, 250);
    ema = ema * 0.92 + rawMs * 0.08;
    const sec = rawMs / 1000;
    if (grace > 0) { grace -= sec; slowAcc = fastAcc = 0; return; }
    if (qProbe) { // 直前の引き下げが効いたか
      const helped = ema < qProbe.ema * 0.88;
      if (!helped) { capMs = qProbe.ema * 1.15; if (qProbe.step !== qStep) setStep(qProbe.step); else if (qProbe.low) setLow(false); grace = 1.0; }
      qProbe = null;
      if (!helped) return;
    }
    const slowLim = Math.max(23, capMs), fastLim = capMs ? 0 : 17.8;
    if (ema > slowLim) { slowAcc += sec; fastAcc = 0; } else if (ema < fastLim) { fastAcc += sec; slowAcc = 0; } else { slowAcc = fastAcc = 0; }
    if (slowAcc > 1.5) {
      slowAcc = 0; grace = 1.2;
      if (qStep < SCALE_STEPS.length - 1) { qProbe = { ema, step: qStep }; downgrades++; setStep(qStep + 1); }
      else if (!engine.quality.low) { qProbe = { ema, step: qStep, low: true }; setLow(true); }
    } else if (fastAcc > 6 * (1 + downgrades) && qStep > 0) {
      fastAcc = 0; grace = 1.0; setStep(qStep - 1);
    }
  }
  function setLow(v) {
    if (engine.quality.low === v) return;
    engine.quality.low = v; engine.quality.maxParticles = v ? 20 : 60;
    L.quality.emit(engine.quality);
    engine.shadowDirty();
  }

  // ------------------------------------------------------------ camera framing
  // state: target, yaw, pitch, dist, fov
  const cs = { t: new THREE.Vector3(0, 0, 0), yaw: 0, pitch: 0.8, dist: 30, fov: 36 };
  const _e = new THREE.Euler(0, 0, 0, 'YXZ');
  const _q = new THREE.Quaternion();
  const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3(), _c = new THREE.Vector3();
  let req = null;   // last frame request {box, yaw, pitch, fov, pad}
  let trans = null; // {from, to, dur, el, ease, resolve}

  function quatFor(yaw, pitch, out) { _e.set(-pitch, yaw, 0, 'YXZ'); return out.setFromEuler(_e); }
  function applyCam(s) {
    quatFor(s.yaw, s.pitch, camera.quaternion);
    _f.set(0, 0, -1).applyQuaternion(camera.quaternion);
    camera.position.copy(s.t).addScaledVector(_f, -s.dist);
    if (Math.abs(camera.fov - s.fov) > 1e-4) { camera.fov = s.fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    engine.camTarget.copy(s.t);
  }
  function computeTarget(r) {
    const b = r.box;
    const t = new THREE.Vector3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
    quatFor(r.yaw, r.pitch, _q);
    _r.set(1, 0, 0).applyQuaternion(_q); _u.set(0, 1, 0).applyQuaternion(_q); _f.set(0, 0, -1).applyQuaternion(_q);
    const w = curW || 1, h = curH || 1, sf = engine.safe;
    const tanY = Math.tan(THREE.MathUtils.degToRad(r.fov) / 2), tanX = tanY * (w / h);
    const lim = (v) => Math.max(0.08, v);
    const R = lim(1 - 2 * (r.pad * w + sf.right) / w), Lf = -lim(1 - 2 * (r.pad * w + sf.left) / w);
    const T = lim(1 - 2 * (r.pad * h + sf.top) / h), B = -lim(1 - 2 * (r.pad * h + sf.bottom) / h);
    let d = camera.near + 0.5;
    for (let i = 0; i < 8; i++) {
      _c.set(i & 1 ? b[3] : b[0], i & 2 ? b[4] : b[1], i & 4 ? b[5] : b[2]).sub(t);
      const x = _c.dot(_r), y = _c.dot(_u), z = _c.dot(_f);
      d = Math.max(d, camera.near + 0.3 - z);
      if (x > 0) d = Math.max(d, x / (R * tanX) - z); else if (x < 0) d = Math.max(d, x / (Lf * tanX) - z);
      if (y > 0) d = Math.max(d, y / (T * tanY) - z); else if (y < 0) d = Math.max(d, y / (B * tanY) - z);
    }
    return { t, yaw: r.yaw, pitch: r.pitch, dist: Math.min(d, camera.far * 0.8), fov: r.fov };
  }
  function lerpState(a, b, k, out) {
    out.t.lerpVectors(a.t, b.t, k);
    let dy = b.yaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    out.yaw = a.yaw + dy * k;
    out.pitch = a.pitch + (b.pitch - a.pitch) * k;
    out.dist = Math.exp(Math.log(a.dist) + (Math.log(b.dist) - Math.log(a.dist)) * k);
    out.fov = a.fov + (b.fov - a.fov) * k;
  }
  function copyState(s) { return { t: s.t.clone(), yaw: s.yaw, pitch: s.pitch, dist: s.dist, fov: s.fov }; }
  function finishTrans(ok) {
    if (!trans) return;
    const r = trans.resolve; trans = null; safeCall(r, ok);
  }
  function reframeOnResize() {
    if (!req) { applyCam(cs); return; }
    const to = computeTarget(req);
    if (trans) trans.to = to;
    else { cs.t.copy(to.t); cs.yaw = to.yaw; cs.pitch = to.pitch; cs.dist = to.dist; cs.fov = to.fov; }
    applyCam(cs);
  }
  engine.frame = function (o = {}) {
    try {
      const box = Array.isArray(o.box) && o.box.length === 6 && o.box.every((v) => isFinite(v)) ? o.box.slice() : [-1, 0, -1, 1, 1, 1];
      const r = {
        box,
        yaw: isFinite(o.yaw) ? o.yaw : 0,
        pitch: isFinite(o.pitch) ? o.pitch : 0.8,
        fov: isFinite(o.fov) && o.fov > 1 ? o.fov : 36,
        pad: isFinite(o.pad) ? o.pad : 0.06,
      };
      req = r;
      const to = computeTarget(r);
      const dur = isFinite(o.duration) ? Math.max(0, o.duration) : 1.2;
      finishTrans(false);
      if (dur <= 0) {
        cs.t.copy(to.t); cs.yaw = to.yaw; cs.pitch = to.pitch; cs.dist = to.dist; cs.fov = to.fov;
        applyCam(cs);
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        trans = { from: copyState(cs), to, dur, el: 0, ease: getEase(o.ease || 'inOut'), resolve };
      });
    } catch (err) { try { console.error(err); } catch (_) { /* */ } return Promise.resolve(false); }
  };
  engine.isFraming = () => !!trans;
  function updateCam(dt) {
    if (trans) {
      trans.el += dt;
      const k = clamp01(trans.el / trans.dur);
      lerpState(trans.from, trans.to, trans.ease(k), cs);
      applyCam(cs);
      if (k >= 1) finishTrans(true);
    } else applyCam(cs);
  }

  // ------------------------------------------------------------ tasks (tween / wait)
  const tasks = new Set();
  function makeTask(duration, fn, opts) {
    let resolveFn;
    const p = new Promise((res) => { resolveFn = res; });
    const task = {
      dur: Math.max(0, +duration || 0), el: -(Math.max(0, +(opts && opts.delay) || 0)), fn,
      ease: getEase(opts && opts.ease), done: false,
      finish(v) { if (task.done) return; task.done = true; tasks.delete(task); resolveFn(v); },
    };
    p.cancel = () => task.finish(false);
    tasks.add(task);
    return p;
  }
  engine.tween = function (duration, fn, opts = {}) {
    return makeTask(duration, typeof fn === 'function' ? fn : null, { ease: opts.ease || 'inOut', delay: opts.delay });
  };
  engine.wait = function (seconds) { return makeTask(seconds, null, { ease: 'linear' }); };
  function updateTasks(dt) {
    if (!tasks.size) return;
    for (const task of [...tasks]) {
      if (task.done) continue;
      task.el += dt;
      if (task.el < 0) continue;
      const k = task.dur > 0 ? clamp01(task.el / task.dur) : 1;
      if (task.fn) safeCall(task.fn, task.ease(k));
      if (k >= 1) task.finish(true);
    }
  }

  // ------------------------------------------------------------ fade overlay
  const fadeEl = document.getElementById('fade');
  let fadeTask = null, fadeOp = 0;
  engine.fade = function (opacity = 1, duration = 0.6, color = '#fff') {
    if (!fadeEl) return Promise.resolve(false);
    const target = clamp01(+opacity || 0);
    try { fadeEl.style.background = color; } catch (_) { /* */ }
    if (fadeTask) fadeTask.cancel();
    const from = fadeOp;
    const set = (v) => { fadeOp = v; fadeEl.style.opacity = String(v); };
    if (!(duration > 0)) { set(target); fadeTask = null; return Promise.resolve(true); }
    const tw = engine.tween(duration, (k) => set(from + (target - from) * k), { ease: 'inOut' });
    fadeTask = tw;
    return tw;
  };

  // ------------------------------------------------------------ input
  const raycaster = new THREE.Raycaster();
  const P = { x: 0, y: 0, ndc: new THREE.Vector2(), ray: new THREE.Ray(), t: 0, id: -1 };
  let activeId = null, delivered = false, firstDone = false, enabled = true;
  function fillP(e) {
    P.x = e.clientX - rectLeft; P.y = e.clientY - rectTop;
    P.ndc.set((P.x / (curW || 1)) * 2 - 1, -(P.y / (curH || 1)) * 2 + 1);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(P.ndc, camera);
    P.ray.copy(raycaster.ray);
    P.t = engine.time;
    return P;
  }
  function endPointer(e, emit) {
    if (activeId === null) return;
    const id = activeId;
    activeId = null;
    try { if (canvas.hasPointerCapture && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id); } catch (_) { /* */ }
    if (delivered) {
      delivered = false;
      if (e) fillP(e);
      if (emit) L.up.emit(P);
    }
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!firstDone) { firstDone = true; L.first.emit(); }
    if (activeId !== null) return; // 2本目以降は完全無視
    activeId = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* */ }
    if (!enabled || !engine.visible) { delivered = false; return; }
    delivered = true;
    L.down.emit(fillP(e));
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activeId || !delivered) return;
    L.move.emit(fillP(e));
  });
  const upH = (e) => { if (e.pointerId === activeId) endPointer(e, true); };
  canvas.addEventListener('pointerup', upH);
  canvas.addEventListener('pointercancel', upH);
  canvas.addEventListener('lostpointercapture', upH);
  window.addEventListener('pointerup', upH);
  window.addEventListener('pointercancel', upH);
  // 念のため: touchstart で最初のタッチ通知 (pointer events 未対応環境)
  document.addEventListener('touchend', () => { if (!firstDone) { firstDone = true; L.first.emit(); } }, { passive: true });

  engine.input = {
    onDown: (fn) => L.down.add(fn),
    onMove: (fn) => L.move.add(fn),
    onUp: (fn) => L.up.add(fn),
    get isDown() { return delivered; },
    get enabled() { return enabled; },
    set enabled(v) {
      v = !!v;
      if (enabled === v) return;
      enabled = v;
      if (!v && delivered) { delivered = false; L.up.emit(P); } // 進行中のドラッグは即 up 扱い
    },
    get pointer() { return P; },
  };
  engine.onFirstTouch = (fn) => L.first.add(fn);

  // ------------------------------------------------------------ picking helpers
  const _plane = new THREE.Plane(), _n = new THREE.Vector3(), _v = new THREE.Vector3();
  engine.pick = function (p, objects, recursive = true) {
    try {
      if (!p || !p.ray || !objects) return null;
      raycaster.ray.copy(p.ray); raycaster.camera = camera;
      const list = Array.isArray(objects) ? objects.filter(Boolean) : [objects];
      const hits = raycaster.intersectObjects(list, recursive);
      for (const h of hits) { if (h.object && h.object.visible !== false) return h; }
      return null;
    } catch (_) { return null; }
  };
  engine.planePoint = function (p, normal, point, out = new THREE.Vector3()) {
    try {
      if (!p || !p.ray) return null;
      _n.copy(normal).normalize();
      _plane.setFromNormalAndCoplanarPoint(_n, point);
      return p.ray.intersectPlane(_plane, out);
    } catch (_) { return null; }
  };
  engine.groundPoint = function (p, y = 0, out = new THREE.Vector3()) {
    return engine.planePoint(p, _v.set(0, 1, 0), new THREE.Vector3(0, y, 0), out);
  };
  const _s = new THREE.Vector3();
  engine.toScreen = function (v, out = { x: 0, y: 0 }) {
    _s.copy(v).project(camera);
    out.x = (_s.x * 0.5 + 0.5) * curW; out.y = (-_s.y * 0.5 + 0.5) * curH;
    out.behind = _s.z > 1;
    return out;
  };
  const _sp = { x: 0, y: 0 };
  engine.screenDist = function (p, v) {
    engine.toScreen(v, _sp);
    if (_sp.behind) return Infinity;
    return Math.hypot(p.x - _sp.x, p.y - _sp.y);
  };

  // ------------------------------------------------------------ persistence
  let saveTimer = null, pending = null, lastSave = 0;
  function writeNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (pending === null) return;
    const s = pending; pending = null; lastSave = Date.now();
    try { window.localStorage.setItem(STORE_KEY, s); } catch (_) { /* */ }
  }
  engine.store = {
    load() {
      try {
        const s = window.localStorage.getItem(STORE_KEY);
        if (!s) return null;
        const o = JSON.parse(s);
        return o && typeof o === 'object' ? o : null;
      } catch (_) { return null; }
    },
    save(obj) {
      try { pending = JSON.stringify(obj); } catch (_) { return; }
      const since = Date.now() - lastSave;
      if (since >= 300) writeNow();
      else if (!saveTimer) saveTimer = setTimeout(writeNow, 300 - since);
    },
    clear() {
      pending = null;
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      try { window.localStorage.removeItem(STORE_KEY); } catch (_) { /* */ }
    },
    flush: writeNow,
  };

  // ------------------------------------------------------------ shadow map on demand
  // 影を落とす物（castShadow）の行列・形状の版数・表示状態と、影を出す光の行列を毎フレーム並べて前回と比べる。
  // 変わったときだけ影マップを描き直す（止まっている場面では影の描画パスを丸ごと省く）。
  let sig = new Float64Array(2048), sigN = 0, sigPrev = new Float64Array(2048), sigPrevN = -1, forceShadow = 2;
  engine.shadowDirty = () => { forceShadow = 2; };
  function push(v) {
    if (sigN >= sig.length) { const a = new Float64Array(sig.length * 2); a.set(sig); sig = a; }
    sig[sigN++] = v;
  }
  function pushMat(m) { const e = m.elements; for (let i = 0; i < 16; i++) push(e[i]); }
  function geoVer(g) {
    if (!g) return 0;
    const p = g.attributes && g.attributes.position;
    return g.id * 1e6 + (p ? p.version : 0) * 7 + (g.index ? g.index.version : 0) + g.drawRange.count * 1e-3;
  }
  function collect(o) {
    if (!o.visible) return;
    if (o.isLight) {
      if (o.castShadow && o.shadow) {
        push(-1); push(o.id); pushMat(o.matrixWorld);
        if (o.target) pushMat(o.target.matrixWorld);
        pushMat(o.shadow.camera.projectionMatrix); push(o.shadow.mapSize.x); push(o.shadow.map ? 1 : 0);
      }
    } else if (o.castShadow && (o.isMesh || o.isPoints || o.isLine)) {
      const m = o.material;
      push(o.id); pushMat(o.matrixWorld); push(geoVer(o.geometry));
      push(!m ? 0 : Array.isArray(m) ? m.length : (m.visible ? m.id : -m.id));
      if (o.isInstancedMesh) { push(o.count); push(o.instanceMatrix.version); }
    }
    const ch = o.children;
    for (let i = 0; i < ch.length; i++) collect(ch[i]);
  }
  function updateShadowFlag() {
    if (!renderer.shadowMap.enabled) return;
    scene.updateMatrixWorld();
    sigN = 0;
    collect(scene);
    let same = sigN === sigPrevN && forceShadow <= 0;
    if (same) { for (let i = 0; i < sigN; i++) { if (sig[i] !== sigPrev[i]) { same = false; break; } } }
    if (!same) {
      renderer.shadowMap.needsUpdate = true;
      const t = sigPrev; sigPrev = sig; sig = t; sigPrevN = sigN;
      if (sig.length < sigPrev.length) sig = new Float64Array(sigPrev.length);
    }
    if (forceShadow > 0) forceShadow--;
  }
  canvas.addEventListener('webglcontextrestored', () => { engine.shadowDirty(); }, false);

  // ------------------------------------------------------------ loop / visibility
  let started = false, rafId = 0, last = null, paused = false;
  engine.onFrame = (fn) => L.frame.add(fn);
  engine.onVisibility = (fn) => L.vis.add(fn);
  engine.onQuality = (fn) => L.quality.add(fn);
  engine.onResize = (fn) => L.resize.add(fn);

  function tick(now) {
    rafId = 0;
    if (paused) return;
    rafId = requestAnimationFrame(tick);
    let dt = 0;
    if (last !== null) { const raw = now - last; measure(raw); dt = Math.min(0.05, Math.max(0, raw / 1000)); }
    last = now;
    engine.time += dt;
    // サイズ変化の取りこぼし対策 (iOS の回転直後など)
    if ((window.innerWidth | 0) !== (engine._iw | 0) || (window.innerHeight | 0) !== (engine._ih | 0)) {
      engine._iw = window.innerWidth; engine._ih = window.innerHeight; applySize(false);
    }
    updateCam(dt);
    updateTasks(dt);
    L.frame.emit(dt, engine.time);
    try { updateShadowFlag(); } catch (err) { renderer.shadowMap.needsUpdate = true; }
    try { renderer.render(scene, camera); } catch (err) { try { console.error(err); } catch (_) { /* */ } }
  }
  function pause() {
    if (paused) return;
    paused = true;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    endPointer(null, true);
    writeNow();
    engine.visible = false;
    L.vis.emit(false);
  }
  function resume() {
    if (!paused || document.hidden) return;
    paused = false;
    last = null; skipFrames = 10; slowAcc = fastAcc = 0;
    engine.visible = true;
    L.vis.emit(true);
    if (started && !rafId) rafId = requestAnimationFrame(tick);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); else resume(); });
  window.addEventListener('pagehide', () => { writeNow(); pause(); });
  window.addEventListener('pageshow', () => { if (!document.hidden) resume(); });
  window.addEventListener('blur', () => { last = null; skipFrames = 10; });
  window.addEventListener('focus', () => { last = null; skipFrames = 10; if (!document.hidden) resume(); });

  engine.start = function () {
    if (started) return;
    started = true;
    if (document.hidden) { paused = true; engine.visible = false; return; }
    if (!rafId) rafId = requestAnimationFrame(tick);
  };

  applySize(true);
  applyCam(cs);
  return engine;
}

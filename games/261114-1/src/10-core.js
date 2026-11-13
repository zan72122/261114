/* 10-core.js — エンジン: G.core（描画とループ）, G.cam, G.input, G.tw, G.audio, G.hint, G.fx, G.state, G.flow */
(function () {
  'use strict';
  var G = (window.G = window.G || {});
  var U = G.util, E = G.ease;

  function logErr(tag, e) { try { console.error('[' + tag + ']', e); } catch (_) { /* noop */ } }
  function isFn(f) { return typeof f === 'function'; }
  function toV3(v, out) {
    out = out || new THREE.Vector3();
    if (!v) return out.set(0, 0, 0);
    if (isFn(v)) v = v();
    if (!v) return out.set(0, 0, 0);
    if (v.isObject3D) { v.updateWorldMatrix(true, false); return v.getWorldPosition(out); }
    if (Array.isArray(v)) return out.set(+v[0] || 0, +v[1] || 0, +v[2] || 0);
    return out.set(+v.x || 0, +v.y || 0, +v.z || 0);
  }

  /* ======================================================================
   * G.core
   * ==================================================================== */
  var C = (G.core = {
    renderer: null, scene: null, camera: null, canvas: null,
    time: 0, dt: 1 / 60, aspect: 1, size: { w: 1, h: 1 },
    safe: { t: 0, r: 0, b: 0, l: 0 },
    low: false, pixelRatio: 1, exposure: 1, lost: false, started: false
  });
  var updaters = [];          // onUpdate で足されたもの
  var preSys = [], postSys = []; // エンジン内部（tw は前、flow/hint/fx/cam は後）
  var rafId = 0, lastTs = null, running = false;
  var dimMul = 1, lastAppliedExposure = -1;
  var safeProbe = null;
  var prLevels = [1], prLevel = 0, frameEma = 16.7, slowT = 0, fastT = 0, graceT = 1.5;
  // 画素の予算: iPad など大きな画面で devicePixelRatio をそのまま使うと塗りが重すぎるため、
  // 最初は「幅×高さ×pr² ≦ PX_BUDGET」になる段から始め、余裕が続けば上げる。
  var PX_BUDGET = 2.8e6, prCeil = 0, upAt = -1e9, nowT = 0;

  C.init = function (canvas) {
    try {
      if (!window.THREE || !canvas) return false;
      var r = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
      if (!r || !r.getContext()) return false;
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = 1;
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
      // 影マップは「影を落とす物か光が動いたフレームだけ」描き直す（shadowSync）
      r.shadowMap.autoUpdate = false;
      r.shadowMap.needsUpdate = true;
      // シェーダーのエラー確認（getProgramInfoLog 等の同期待ち）を省き、コンパイル時の引っかかりを減らす
      r.debug.checkShaderErrors = false;
      r.localClippingEnabled = true;
      r.setClearColor(0x201812, 1);
      C.renderer = r; C.canvas = canvas;
      C.scene = new THREE.Scene();
      C.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
      C.camera.position.set(0, 8, 6); C.camera.lookAt(0, 0, 0);
      C.scene.add(C.camera);
      canvas.addEventListener('webglcontextlost', function (e) { try { e.preventDefault(); } catch (_) {} C.lost = true; }, false);
      canvas.addEventListener('webglcontextrestored', function () { C.lost = false; sigReady = false; if (C.renderer) C.renderer.shadowMap.needsUpdate = true; }, false);

      var maxPR = Math.min(window.devicePixelRatio || 1, 2), minPR = 0.6;
      prLevels = [];
      for (var pr = maxPR; pr > minPR * 1.05; pr *= 0.82) prLevels.push(pr);
      prLevels.push(Math.min(minPR, maxPR));
      prLevel = 0; prCeil = 0;

      safeProbe = document.createElement('div');
      safeProbe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
        'padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);' +
        'padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left)';
      document.body.appendChild(safeProbe);

      resize(true);
      G.input._bind();
      window.addEventListener('resize', function () { resize(false, true); });
      window.addEventListener('orientationchange', function () { setTimeout(function () { resize(false, true); }, 120); setTimeout(function () { resize(false, true); }, 500); });
      if (window.visualViewport) window.visualViewport.addEventListener('resize', function () { resize(false, true); });
      document.addEventListener('visibilitychange', onVis);
      window.addEventListener('pagehide', function () { G.input && G.input._cancelActive(); });
      window.addEventListener('blur', function () { G.input && G.input._cancelActive(); });
      return true;
    } catch (e) {
      logErr('core.init', e);
      C.renderer = null;
      return false;
    }
  };

  function readSafe() {
    var s = { t: 0, r: 0, b: 0, l: 0 };
    try {
      if (safeProbe) {
        var cs = getComputedStyle(safeProbe);
        s.t = parseFloat(cs.paddingTop) || 0; s.r = parseFloat(cs.paddingRight) || 0;
        s.b = parseFloat(cs.paddingBottom) || 0; s.l = parseFloat(cs.paddingLeft) || 0;
      }
    } catch (_) { /* noop */ }
    return s;
  }
  function viewSize() {
    var w = window.innerWidth || document.documentElement.clientWidth || 1;
    var h = window.innerHeight || document.documentElement.clientHeight || 1;
    return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
  }
  function applyPR() {
    var pr = prLevels[prLevel] || 1;
    C.pixelRatio = pr;
    C.renderer.setPixelRatio(pr);
    C.renderer.setSize(C.size.w, C.size.h, false);
  }
  var safeCheckN = 0;
  function resize(force, checkSafe) {
    if (!C.renderer) return;
    var v = viewSize();
    // safe-area の読み取り（getComputedStyle）は重いので、大きさが変わった時と約0.5秒ごとだけ
    var sizeSame = v.w === C.size.w && v.h === C.size.h;
    if (!force && !checkSafe && sizeSame && ++safeCheckN < 30) return;
    safeCheckN = 0;
    var s = readSafe();
    var changed = force || v.w !== C.size.w || v.h !== C.size.h ||
      s.t !== C.safe.t || s.r !== C.safe.r || s.b !== C.safe.b || s.l !== C.safe.l;
    if (!changed) return;
    C.size.w = v.w; C.size.h = v.h; C.safe = s;
    C.aspect = v.w / v.h;
    budgetLevel();
    applyPR();
    C.camera.aspect = C.aspect;
    C.camera.updateProjectionMatrix();
    if (G.cam && G.cam._onResize) G.cam._onResize();
  }
  C._resize = resize;

  // 画面の大きさに対して予算内に収まる段まで下げる（上げるのは perf に任せる）
  function budgetLevel() {
    var px = C.size.w * C.size.h, lv = prCeil;
    while (lv < prLevels.length - 1 && px * prLevels[lv] * prLevels[lv] > PX_BUDGET) lv++;
    if (lv > prLevel) prLevel = lv;
  }

  function perf(rawMs, dt) {
    nowT += dt;
    // 1回だけの長い停止（コンパイル・GC）で平均が跳ねないよう上限を切る
    frameEma += (Math.min(rawMs, 60) - frameEma) * 0.08;
    if (graceT > 0) { graceT -= dt; slowT = fastT = 0; return; }
    // 約48fps を割る状態が続けば解像度を1段下げ、60fps 近くが長く続けば1段上げる
    if (frameEma > 21) { slowT += dt; fastT = 0; } else if (frameEma < 17.6) { fastT += dt; slowT = 0; } else { slowT = fastT = 0; }
    if (slowT > 1.2 && prLevel < prLevels.length - 1) {
      // 上げてすぐ重くなった段には二度と上がらない（行き来で引っかからないように）
      if (nowT - upAt < 10) prCeil = Math.max(prCeil, prLevel + 1);
      prLevel++; applyPR(); slowT = 0; graceT = 1;
      if (prLevel === prLevels.length - 1) C.low = true;
    } else if (fastT > 6 && prLevel > prCeil) {
      prLevel--; applyPR(); fastT = 0; graceT = 1; upAt = nowT;
    }
  }

  /* 影マップの描き直し判定: 影を落とす見えている物の位置・形・材質と、太陽の位置・影の範囲を
     前のフレームと比べ、変わったときだけ描き直す（カメラだけが動くときは描き直さない）。 */
  var sigReady = false, sigBuf = [], sigN = 0, sigAge = 0, lightPending = false;
  function sigPush(v) { if (sigBuf[sigN] !== v) { sigBuf[sigN] = v; sigChanged = true; } sigN++; }
  var sigChanged = false;
  function sigMat(m) { if (m) { sigPush(m.id); sigPush(m.visible ? 1 : 0); sigPush(m.side); } }
  function sigObj(o) {
    if (!o.visible) return;
    if (o.castShadow && (o.isMesh || o.isLine || o.isPoints)) {
      var e = o.matrixWorld.elements, g = o.geometry, k;
      sigPush(o.id);
      for (k = 0; k < 16; k++) sigPush(e[k]);
      if (g) {
        sigPush(g.id);
        var pa = g.attributes.position; sigPush(pa ? pa.version : -1);
        sigPush(g.index); sigPush(g.index ? g.index.version : -1);
        sigPush(g.drawRange.start); sigPush(g.drawRange.count);
      }
      if (Array.isArray(o.material)) for (k = 0; k < o.material.length; k++) sigMat(o.material[k]); else sigMat(o.material);
      if (o.customDepthMaterial) sigPush(o.customDepthMaterial.id);
      if (o.morphTargetInfluences) for (k = 0; k < o.morphTargetInfluences.length; k++) sigPush(o.morphTargetInfluences[k]);
      if (o.isInstancedMesh) { sigPush(o.count); sigPush(o.instanceMatrix.version); }
    }
    var ch = o.children;
    for (var i = 0; i < ch.length; i++) sigObj(ch[i]);
  }
  function shadowSync() {
    var r = C.renderer, sc = C.scene;
    if (!r.shadowMap.enabled) return;
    // 形の作り直し（ぎょうざは updateMatrixWorld で作り直す）を先に済ませてから比べる
    if (sc.matrixWorldAutoUpdate) sc.updateMatrixWorld();
    sigN = 0; sigChanged = false;
    var hasLight = false, lightJump = false;
    sc.traverseVisible(function (o) {
      if (o.isLight && o.castShadow && o.shadow) {
        hasLight = true;
        var e = o.matrixWorld.elements, t = o.target ? o.target.matrixWorld.elements : null, pm = o.shadow.camera.projectionMatrix.elements, k, b;
        sigPush(o.id);
        for (k = 12; k < 15; k++) { b = sigBuf[sigN]; if (!(Math.abs(e[k] - b) < 0.05)) lightJump = true; sigPush(e[k]); }
        if (t) for (k = 12; k < 15; k++) { b = sigBuf[sigN]; if (!(Math.abs(t[k] - b) < 0.05)) lightJump = true; sigPush(t[k]); }
        for (k = 0; k < 16; k++) { if (sigBuf[sigN] !== pm[k]) lightJump = true; sigPush(pm[k]); }
        sigPush(o.shadow.mapSize.x); sigPush(o.shadow.mapSize.y); sigPush(o.shadow.bias); sigPush(o.shadow.normalBias); sigPush(o.shadow.radius);
      }
    });
    if (!hasLight) return;
    var lightChanged = sigChanged;
    sigChanged = false;
    sigObj(sc);
    if (sigBuf.length !== sigN) { sigBuf.length = sigN; sigChanged = true; }
    sigAge++;
    // 夕方への移り変わりのように光だけがゆっくり動くときは、4フレームに1回で十分（止まったら必ず追いつく）
    if (lightChanged && !lightJump && !sigChanged && sigReady) { lightPending = true; if (sigAge < 4) return; }
    else if (!sigChanged && !lightPending && sigReady) return;
    r.shadowMap.needsUpdate = true; sigReady = true; sigAge = 0; lightPending = false;
  }
  C.shadowDirty = function () { if (C.renderer) C.renderer.shadowMap.needsUpdate = true; };

  function runList(list, dt) {
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      try { f(dt, C.time); } catch (e) { f._errs = (f._errs || 0) + 1; if (f._errs <= 3) logErr('update', e); }
    }
  }

  function frame(ts) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    resize(false);
    var raw = lastTs == null ? 16.7 : ts - lastTs;
    lastTs = ts;
    if (raw < 0) raw = 16.7;
    var dt = Math.min(0.05, raw / 1000);
    C.dt = dt; C.time += dt;
    perf(raw, dt);
    runList(preSys, dt);
    runList(updaters.slice(), dt);
    runList(postSys, dt);
    // 露出: 外から renderer.toneMappingExposure を変えられたらそれを基準として取り込む
    var r = C.renderer;
    if (lastAppliedExposure >= 0 && Math.abs(r.toneMappingExposure - lastAppliedExposure) > 1e-6) {
      C.exposure = r.toneMappingExposure / (dimMul || 1);
    }
    r.toneMappingExposure = lastAppliedExposure = C.exposure * dimMul;
    if (!C.lost) {
      try { shadowSync(); } catch (e) { r.shadowMap.needsUpdate = true; if (!C._sErr) { C._sErr = 1; logErr('shadowSync', e); } }
      try { r.render(C.scene, C.camera); } catch (e) { if (!C._rErr) { C._rErr = 1; logErr('render', e); } }
    }
  }

  function startLoop() {
    if (running || !C.renderer || document.hidden) return;
    running = true; lastTs = null; graceT = Math.max(graceT, 0.8);
    rafId = requestAnimationFrame(frame);
  }
  function stopLoop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }
  function onVis() {
    if (document.hidden) {
      stopLoop();
      if (G.input) G.input._cancelActive();
      if (G.audio) G.audio._suspend();
    } else {
      if (G.audio) G.audio._resume();
      if (C.started) startLoop();
    }
  }

  C.start = function () {
    if (!C.renderer) return;
    C.started = true;
    startLoop();
  };
  C.onUpdate = function (fn) {
    if (!isFn(fn)) return function () {};
    updaters.push(fn);
    return function () { var i = updaters.indexOf(fn); if (i >= 0) updaters.splice(i, 1); };
  };
  C._setDim = function (m) { dimMul = m; };

  var fadeJob = null;
  C.fade = function (to, sec) {
    var el = document.getElementById('fade');
    if (fadeJob) { fadeJob.done(); fadeJob = null; }
    return new Promise(function (resolve) {
      if (!el) { resolve(); return; }
      var from = parseFloat(el.style.opacity);
      if (isNaN(from)) { try { from = parseFloat(getComputedStyle(el).opacity); } catch (_) { from = 1; } }
      if (isNaN(from)) from = 1;
      to = U.clamp01(+to || 0);
      if (!(sec > 0)) { el.style.opacity = String(to); resolve(); return; }
      var t0 = null, finished = false;
      var job = { done: function () { if (!finished) { finished = true; resolve(); } } };
      fadeJob = job;
      var safety = setTimeout(function () { if (!finished) { el.style.opacity = String(to); job.done(); } }, sec * 1000 + 1500);
      function step(ts) {
        if (finished) return;
        if (t0 == null) t0 = ts;
        var k = U.clamp01((ts - t0) / (sec * 1000));
        el.style.opacity = String(U.lerp(from, to, E.inOutQuad(k)));
        if (k >= 1) { clearTimeout(safety); job.done(); if (fadeJob === job) fadeJob = null; return; }
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  };

  /* ======================================================================
   * G.tw — トゥイーン
   * ==================================================================== */
  var TW = (G.tw = {});
  var tweens = [];
  var NEVER = function () { return new Promise(function () {}); };

  function makeTween(obj, props, dur, opts, scope) {
    opts = opts || {};
    var tw = {
      obj: obj, target: props || {}, dur: Math.max(0, +dur || 0), delay: Math.max(0, +opts.delay || 0),
      ease: isFn(opts.ease) ? opts.ease : (typeof opts.ease === 'string' && E[opts.ease]) || E.inOutQuad,
      onUpdate: opts.onUpdate, t: 0, started: false, from: null, keys: null, dead: false, scope: scope, res: null
    };
    var p = new Promise(function (res) { tw.res = res; });
    p.cancel = function () { finishTween(tw, false); };
    tw.promise = p;
    tweens.push(tw);
    return tw;
  }
  function finishTween(tw, ok) {
    if (tw.dead) return;
    tw.dead = true;
    var i = tweens.indexOf(tw);
    if (i >= 0) tweens.splice(i, 1);
    if (tw.scope && !tw.scope.alive) return; // kill 済みの scope は解決しない
    tw.res(ok);
  }
  function startTween(tw) {
    tw.started = true;
    tw.from = {}; tw.keys = [];
    var obj = tw.obj;
    for (var k in tw.target) {
      if (!Object.prototype.hasOwnProperty.call(tw.target, k)) continue;
      var tv = +tw.target[k];
      if (typeof obj[k] !== 'number' || isNaN(tv)) continue;
      tw.keys.push(k); tw.from[k] = obj[k]; tw.target[k] = tv;
    }
    // 同じ obj の同じプロパティを持つ古い tween からそのキーを外す
    for (var j = tweens.length - 1; j >= 0; j--) {
      var o = tweens[j];
      if (o === tw || o.obj !== obj || !o.started || o.dead) continue;
      var rest = [];
      for (var m = 0; m < o.keys.length; m++) if (tw.keys.indexOf(o.keys[m]) < 0) rest.push(o.keys[m]);
      o.keys = rest;
      if (!rest.length) finishTween(o, false);
    }
  }
  function updateTweens(dt) {
    var list = tweens.slice();
    for (var i = 0; i < list.length; i++) {
      var tw = list[i];
      if (tw.dead) continue;
      if (tw.scope && !tw.scope.alive) { finishTween(tw, false); continue; }
      if (!tw.started) {
        tw.delay -= dt;
        if (tw.delay > 0) continue;
        startTween(tw);
      } else tw.t += dt;
      var k = tw.dur > 0 ? U.clamp01(tw.t / tw.dur) : 1;
      var e = tw.ease(k);
      for (var n = 0; n < tw.keys.length; n++) {
        var key = tw.keys[n];
        tw.obj[key] = tw.from[key] + (tw.target[key] - tw.from[key]) * e;
      }
      if (tw.onUpdate) { try { tw.onUpdate(k, tw.obj); } catch (er) { logErr('tw.onUpdate', er); } }
      if (k >= 1) finishTween(tw, true);
    }
  }
  preSys.push(updateTweens);

  TW.to = function (obj, props, sec, opts) { return scopedTo(null, obj, props, sec, opts); };
  function scopedTo(scope, obj, props, sec, opts) {
    if (scope && !scope.alive) { var nv = NEVER(); nv.cancel = function () {}; return nv; }
    if (!obj) { var p0 = Promise.resolve(false); p0.cancel = function () {}; return p0; }
    var copy = {};
    for (var k in props) if (Object.prototype.hasOwnProperty.call(props, k)) copy[k] = props[k];
    return makeTween(obj, copy, sec, opts, scope).promise;
  }
  function scopedWait(scope, sec) {
    if (scope && !scope.alive) { var nv = NEVER(); nv.cancel = function () {}; return nv; }
    var dummy = {};
    var tw = makeTween(dummy, {}, sec, { ease: E.linear }, scope);
    return tw.promise;
  }
  TW.wait = function (sec) { return scopedWait(null, sec); };
  TW.killOf = function (obj) {
    tweens.slice().forEach(function (t) { if (t.obj === obj) finishTween(t, false); });
  };
  TW.scope = function () {
    var sc = { alive: true };
    sc.to = function (obj, props, sec, opts) { return scopedTo(sc, obj, props, sec, opts); };
    sc.wait = function (sec) { return scopedWait(sc, sec); };
    /* 任意の Promise を包む: kill 後は解決しない */
    sc.guard = function (p) {
      return new Promise(function (res, rej) {
        Promise.resolve(p).then(function (v) { if (sc.alive) res(v); }, function (e) { if (sc.alive) rej(e); });
      });
    };
    /* kill されるまで毎フレーム fn(dt) を呼ぶ（fn が true を返すと終わり） */
    sc.every = function (fn) {
      var off = C.onUpdate(function (dt) {
        if (!sc.alive) { off(); return; }
        if (fn(dt) === true) off();
      });
      sc._offs.push(off);
      return off;
    };
    sc._offs = [];
    sc.kill = function () {
      if (!sc.alive) return;
      sc.alive = false;
      tweens.slice().forEach(function (t) { if (t.scope === sc) finishTween(t, false); });
      sc._offs.forEach(function (f) { f(); });
      sc._offs.length = 0;
    };
    return sc;
  };

  /* ======================================================================
   * G.cam
   * ==================================================================== */
  var CAM = (G.cam = { spec: null, target: new THREE.Vector3() });
  var camPos = new THREE.Vector3(0, 8, 6), camTgt = new THREE.Vector3();
  var camFromPos = new THREE.Vector3(), camFromTgt = new THREE.Vector3();
  var camToPos = new THREE.Vector3(), camToTgt = new THREE.Vector3();
  var camT = 1, camDur = 0, camRes = null, camHasPose = false, camSolved = false;
  var shakeAmp = 0, shakeDur = 0, shakeT = 0;
  var shakeOff = new THREE.Vector3();

  function normSpec(s) {
    s = s || {};
    var c = toV3(s.center || [0, 0, 0]);
    return {
      center: c,
      w: Math.max(0.05, +s.w || 3.4), d: Math.max(0.05, +s.d || 3.6),
      pitch: s.pitch != null ? +s.pitch : 56, yaw: s.yaw != null ? +s.yaw : 0, lift: +s.lift || 0,
      margin: s.margin != null ? +s.margin : null
    };
  }
  /* spec を満たすカメラ位置と注視点を求める */
  function solveFrame(spec, outPos, outTgt) {
    var W = C.size.w, H = C.size.h, sa = C.safe;
    var mg = spec.margin != null ? spec.margin : Math.max(10, Math.min(W, H) * 0.035);
    var sx0 = sa.l + mg, sx1 = W - sa.r - mg, sy0 = sa.t + mg, sy1 = H - sa.b - mg;
    if (sx1 - sx0 < 40) { sx0 = 0; sx1 = W; }
    if (sy1 - sy0 < 40) { sy0 = 0; sy1 = H; }
    var nx0 = sx0 / W * 2 - 1, nx1 = sx1 / W * 2 - 1, nyT = 1 - sy0 / H * 2, nyB = 1 - sy1 / H * 2;
    var ncx = (nx0 + nx1) / 2, ncy = (nyT + nyB) / 2, nW = nx1 - nx0, nH = nyT - nyB;
    var p = spec.pitch * Math.PI / 180, y = spec.yaw * Math.PI / 180;
    var f = new THREE.Vector3(-Math.sin(y) * Math.cos(p), -Math.sin(p), -Math.cos(y) * Math.cos(p));
    var r = new THREE.Vector3(Math.cos(y), 0, -Math.sin(y));
    var u = new THREE.Vector3().crossVectors(r, f);
    var back = new THREE.Vector3(Math.sin(y), 0, Math.cos(y));
    var tanH = Math.tan(C.camera.fov * Math.PI / 360), asp = C.aspect;
    var A = [], B = [], Ee = [];
    for (var i = 0; i < 4; i++) {
      var lx = (i & 1 ? 0.5 : -0.5) * spec.w, lz = (i & 2 ? 0.5 : -0.5) * spec.d;
      var cx = r.x * lx + back.x * lz, cy = 0, cz = r.z * lx + back.z * lz;
      A.push(cx * r.x + cy * r.y + cz * r.z);
      B.push(cx * u.x + cy * u.y + cz * u.z);
      Ee.push(cx * f.x + cy * f.y + cz * f.z);
    }
    var res = { px: 0, py: 0 };
    function test(D) {
      var px = 0, py = 0, minX, maxX, minY, maxY;
      for (var it = 0; it < 8; it++) {
        minX = minY = Infinity; maxX = maxY = -Infinity;
        var kx = 0, ky = 0;
        for (var i = 0; i < 4; i++) {
          var depth = Ee[i] + D;
          if (depth < 0.15) return false;
          var X = (A[i] - px) / (depth * tanH * asp), Y = (B[i] - py) / (depth * tanH);
          if (X < minX) minX = X; if (X > maxX) maxX = X; if (Y < minY) minY = Y; if (Y > maxY) maxY = Y;
          kx += depth * tanH * asp; ky += depth * tanH;
        }
        px += ((minX + maxX) / 2 - ncx) * kx / 4;
        py += ((minY + maxY) / 2 - ncy) * ky / 4;
      }
      res.px = px; res.py = py;
      return (maxX - minX) <= nW && (maxY - minY) <= nH;
    }
    var lo = 0.3, hi = 400;
    if (!test(hi)) { lo = hi; }
    for (var k = 0; k < 40 && hi - lo > 0.002; k++) {
      var mid = (lo + hi) / 2;
      if (test(mid)) hi = mid; else lo = mid;
    }
    test(hi);
    var tgt = spec.center.clone();
    tgt.y += spec.lift;
    tgt.addScaledVector(r, res.px).addScaledVector(u, res.py);
    outTgt.copy(tgt);
    outPos.copy(tgt).addScaledVector(f, -hi);
    return hi;
  }

  CAM.frame = function (spec, sec) {
    if (!C.camera) return Promise.resolve();
    CAM.spec = normSpec(spec);
    if (sec == null) sec = 1.2;
    solveFrame(CAM.spec, camToPos, camToTgt);
    camSolved = true;
    if (camRes) { var old = camRes; camRes = null; old(); }
    if (!camHasPose || !(sec > 0)) {
      camPos.copy(camToPos); camTgt.copy(camToTgt); camT = 1; camHasPose = true;
      applyCam();
      return Promise.resolve();
    }
    camFromPos.copy(camPos); camFromTgt.copy(camTgt);
    camT = 0; camDur = sec;
    return new Promise(function (res) { camRes = res; });
  };
  CAM.shake = function (strength, sec) {
    shakeAmp = Math.max(shakeAmp * (1 - shakeT / Math.max(shakeDur, 1e-3)), +strength || 0.04);
    shakeDur = Math.max(0.05, +sec || 0.3); shakeT = 0;
  };
  CAM._onResize = function () {
    if (!CAM.spec) return;
    solveFrame(CAM.spec, camToPos, camToTgt);
    if (camT >= 1) { camPos.copy(camToPos); camTgt.copy(camToTgt); applyCam(); }
  };
  function applyCam() {
    var cam = C.camera;
    cam.position.copy(camPos).add(shakeOff);
    cam.up.set(0, 1, 0);
    cam.lookAt(camTgt.x + shakeOff.x * 0.5, camTgt.y + shakeOff.y * 0.5, camTgt.z + shakeOff.z * 0.5);
    cam.updateMatrixWorld();
    CAM.target.copy(camTgt);
  }
  postSys.push(function camUpdate(dt) {
    if (!camHasPose) return;
    if (camT < 1) {
      camT = Math.min(1, camT + dt / Math.max(camDur, 1e-3));
      var e = E.inOutCubic(camT);
      camPos.lerpVectors(camFromPos, camToPos, e);
      camTgt.lerpVectors(camFromTgt, camToTgt, e);
      if (camT >= 1 && camRes) { var r = camRes; camRes = null; r(); }
    }
    if (shakeT < shakeDur) {
      shakeT += dt;
      var a = shakeAmp * Math.pow(1 - U.clamp01(shakeT / shakeDur), 2);
      var tt = C.time * 38;
      shakeOff.set(Math.sin(tt * 1.13) * a, Math.sin(tt * 1.71 + 1.3) * a * 0.7, Math.sin(tt * 0.93 + 2.1) * a * 0.5);
    } else shakeOff.set(0, 0, 0);
    applyCam();
  });

  /* ======================================================================
   * G.input — 指1本
   * ==================================================================== */
  var IN = (G.input = { active: null, enabled: true });
  var handler = null, activeId = null, activeP = null, orphan = false;
  var raycaster = new THREE.Raycaster();
  var ndcTmp = new THREE.Vector2();

  function makeP(e, prev) {
    var rect = C.canvas.getBoundingClientRect();
    var x = e.clientX - rect.left, y = e.clientY - rect.top;
    var now = performance.now() / 1000;
    var p = prev || { id: e.pointerId, start: { x: x, y: y }, t0: now, moved: 0 };
    p.dt = prev ? now - p.t : 0; p.age = now - p.t0;
    p.x = x; p.y = y; p.t = now;
    var dx = x - p.start.x, dy = y - p.start.y;
    p.moved = Math.max(p.moved, Math.sqrt(dx * dx + dy * dy));
    p.ndc = { x: x / Math.max(1, rect.width) * 2 - 1, y: -(y / Math.max(1, rect.height)) * 2 + 1 };
    C.camera.updateMatrixWorld();
    ndcTmp.set(p.ndc.x, p.ndc.y);
    raycaster.setFromCamera(ndcTmp, C.camera);
    p.ray = raycaster.ray.clone();
    return p;
  }
  function call(name, p) {
    if (!handler || orphan) return;
    var h = handler, f = h[name];
    if (name === 'cancel' && !isFn(f)) f = h.up;
    if (!isFn(f)) return;
    try { f.call(h, p); } catch (e) { logErr('input.' + name, e); }
  }
  function onDown(e) {
    try { e.preventDefault(); } catch (_) {}
    try { if (G.audio) G.audio.unlock(); } catch (er) { logErr('audio.unlock', er); }
    try { if (G.hint) G.hint.poke(); } catch (er2) { logErr('hint.poke', er2); }
    if (activeId != null || !IN.enabled || !C.camera) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    activeId = e.pointerId; orphan = false;
    try { C.canvas.setPointerCapture(e.pointerId); } catch (_) {}
    activeP = makeP(e, null);
    IN.active = activeP;
    call('down', activeP);
  }
  function onMove(e) {
    if (e.pointerId !== activeId || !activeP) return;
    try { e.preventDefault(); } catch (_) {}
    makeP(e, activeP);
    call('move', activeP);
  }
  function endActive(kind, e) {
    var p = activeP;
    activeId = null; activeP = null; IN.active = null;
    var wasOrphan = orphan; orphan = false;
    if (!p) return;
    if (e) { try { makeP(e, p); } catch (_) {} }
    if (!wasOrphan) { orphan = false; call(kind, p); }
  }
  function onUp(e) {
    if (e.pointerId !== activeId) return;
    try { C.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    endActive('up', e);
  }
  function onCancel(e) {
    if (e.pointerId !== activeId) return;
    endActive('cancel', null);
  }
  IN._cancelActive = function () { if (activeId != null) endActive('cancel', null); };
  IN._bind = function () {
    var cv = C.canvas;
    if (!cv || IN._bound) return;
    IN._bound = true;
    cv.addEventListener('pointerdown', onDown, { passive: false });
    cv.addEventListener('pointermove', onMove, { passive: false });
    cv.addEventListener('pointerup', onUp, { passive: false });
    cv.addEventListener('pointercancel', onCancel);
    cv.addEventListener('lostpointercapture', onCancel);
    var pd = function (e) { try { e.preventDefault(); } catch (_) {} };
    document.addEventListener('touchmove', pd, { passive: false });
    document.addEventListener('touchstart', function (e) { if (e.touches && e.touches.length > 1) pd(e); }, { passive: false });
    document.addEventListener('touchend', pd, { passive: false });
    document.addEventListener('gesturestart', pd, { passive: false });
    document.addEventListener('gesturechange', pd, { passive: false });
    document.addEventListener('contextmenu', pd);
    document.addEventListener('selectstart', pd);
    document.addEventListener('dblclick', pd, { passive: false });
    document.addEventListener('wheel', function (e) { if (e.ctrlKey) pd(e); }, { passive: false });
  };
  IN.set = function (h) {
    handler = h || null;
    if (activeId != null) orphan = true; // 進行中の指は新しいハンドラへ渡さない
  };
  IN.clear = function () { handler = null; if (activeId != null) orphan = true; };
  IN.planeHit = function (p, y) {
    if (!p || !p.ray) return null;
    y = +y || 0;
    var d = p.ray.direction.y;
    if (Math.abs(d) < 1e-6) return null;
    var t = (y - p.ray.origin.y) / d;
    if (t < 0) return null;
    return p.ray.origin.clone().addScaledVector(p.ray.direction, t);
  };
  var projTmp = new THREE.Vector3();
  IN.toScreen = function (v) {
    toV3(v, projTmp);
    C.camera.updateMatrixWorld();
    projTmp.project(C.camera);
    return { x: (projTmp.x + 1) / 2 * C.size.w, y: (1 - projTmp.y) / 2 * C.size.h, behind: projTmp.z > 1 };
  };
  IN.screenDist = function (p, v) {
    var s = IN.toScreen(v);
    var dx = s.x - p.x, dy = s.y - p.y;
    return Math.sqrt(dx * dx + dy * dy);
  };
  IN.pxPerUnit = function (v) {
    var a = toV3(v, new THREE.Vector3());
    var right = new THREE.Vector3().setFromMatrixColumn(C.camera.matrixWorld, 0);
    var s0 = IN.toScreen(a), s1 = IN.toScreen(a.clone().add(right));
    return Math.sqrt((s1.x - s0.x) * (s1.x - s0.x) + (s1.y - s0.y) * (s1.y - s0.y));
  };
  function visibleChain(o) {
    while (o) { if (!o.visible) return false; o = o.parent; }
    return true;
  }
  IN.pick = function (p, objects) {
    if (!p || !objects) return null;
    var arr = Array.isArray(objects) ? objects.filter(Boolean) : [objects];
    if (!arr.length) return null;
    raycaster.ray.copy(p.ray);
    raycaster.near = 0; raycaster.far = Infinity;
    raycaster.camera = C.camera;
    var hits = raycaster.intersectObjects(arr, true);
    for (var i = 0; i < hits.length; i++) if (visibleChain(hits[i].object)) return hits[i];
    return null;
  };

  /* ======================================================================
   * G.audio — Web Audio 合成
   * ==================================================================== */
  var AU = (G.audio = { ctx: null, ready: false });
  var actx = null, master, comp, sfxBus, musicBus, loopBus, loopLP, noiseBuf = null;
  var muffleV = 0, voices = {}, totalVoices = 0, liveSrc = [];
  var loopNodes = {}, loopWant = {};
  var unlocked = false;

  function audioInit() {
    if (actx) return true;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try { actx = new AC({ latencyHint: 'interactive' }); } catch (_) { actx = new AC(); }
      comp = actx.createDynamicsCompressor();
      comp.threshold.value = -20; comp.knee.value = 14; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.22;
      master = actx.createGain(); master.gain.value = 0.55;
      master.connect(comp); comp.connect(actx.destination);
      sfxBus = actx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
      musicBus = actx.createGain(); musicBus.gain.value = 0.6; musicBus.connect(master);
      loopLP = actx.createBiquadFilter(); loopLP.type = 'lowpass'; loopLP.frequency.value = 18000; loopLP.Q.value = 0.5;
      loopBus = actx.createGain(); loopBus.gain.value = 0.8;
      loopLP.connect(loopBus); loopBus.connect(master);
      var n = actx.sampleRate * 2, b = actx.createBuffer(1, n, actx.sampleRate), d = b.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      noiseBuf = b;
      AU.ctx = actx; AU.ready = true;
      return true;
    } catch (e) {
      logErr('audio.init', e);
      actx = null; AU.ready = false;
      return false;
    }
  }
  AU.unlock = function () {
    if (!actx && !audioInit()) return;
    try {
      if (actx.state !== 'running' && !document.hidden) { var pr = actx.resume(); if (pr && pr.catch) pr.catch(function () {}); }
      if (!unlocked) {
        unlocked = true;
        var s = actx.createBufferSource(); s.buffer = actx.createBuffer(1, 1, 22050); s.connect(actx.destination); s.start(0);
        for (var k in loopWant) if (loopWant[k] > 0) AU.loop(k, loopWant[k]);
        AU.muffle(muffleV);
      }
    } catch (e) { logErr('audio.unlock', e); }
  };
  AU._suspend = function () { try { if (actx && actx.state === 'running') actx.suspend(); } catch (_) {} };
  AU._resume = function () { try { if (actx && unlocked && actx.state !== 'running') { var p = actx.resume(); if (p && p.catch) p.catch(function () {}); } } catch (_) {} };

  /* --- 小さな部品 --- */
  function envGain(g, t, a, peak, d) {
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function track(src, stopAt) { liveSrc.push(src); src.onended = function () { var i = liveSrc.indexOf(src); if (i >= 0) liveSrc.splice(i, 1); }; src.stop(stopAt); }
  function osc(out, t, o) {
    var os = actx.createOscillator();
    os.type = o.type || 'sine';
    var f0 = o.f, f1 = o.f1 || o.f;
    os.frequency.setValueAtTime(f0, t);
    if (o.path) { for (var i = 0; i < o.path.length; i++) os.frequency.exponentialRampToValueAtTime(o.path[i][0], t + o.path[i][1]); }
    else if (f1 !== f0) os.frequency.exponentialRampToValueAtTime(f1, t + (o.glide || o.d));
    var g = actx.createGain(), a = o.a || 0.004;
    envGain(g.gain, t, a, o.v, o.d);
    os.connect(g); g.connect(out);
    os.start(t); track(os, t + a + o.d + 0.05);
  }
  function noise(out, t, o) {
    var s = actx.createBufferSource(); s.buffer = noiseBuf;
    var f = actx.createBiquadFilter(); f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.f || 1000, t);
    if (o.path) { for (var i = 0; i < o.path.length; i++) f.frequency.exponentialRampToValueAtTime(o.path[i][0], t + o.path[i][1]); }
    else if (o.f1 && o.f1 !== o.f) f.frequency.exponentialRampToValueAtTime(o.f1, t + (o.glide || o.d));
    f.Q.value = o.q != null ? o.q : 1;
    var g = actx.createGain(), a = o.a || 0.003;
    if (o.env) { g.gain.setValueAtTime(0.0001, t); o.env.forEach(function (p) { g.gain[p[2] ? 'exponentialRampToValueAtTime' : 'linearRampToValueAtTime'](Math.max(0.0001, p[0]), t + p[1]); }); }
    else envGain(g.gain, t, a, o.v, o.d);
    s.connect(f); f.connect(g); g.connect(out);
    var off = Math.random() * 1.2;
    s.start(t, off); track(s, t + a + (o.dur || o.d) + 0.08);
  }
  function partials(out, t, fs, vs, ds, p) {
    for (var i = 0; i < fs.length; i++) osc(out, t, { f: fs[i] * p, v: vs[i], d: ds[i], a: 0.002 });
  }
  function grains(out, t, n, span, fLo, fHi, vLo, vHi, type) {
    for (var i = 0; i < n; i++) {
      var tt = t + Math.random() * span;
      noise(out, tt, { type: type || 'bandpass', f: fLo + Math.random() * (fHi - fLo), q: 1.4, v: vLo + Math.random() * (vHi - vLo), d: 0.006 + Math.random() * 0.016, a: 0.001 });
    }
  }
  function mallet(out, f, t, d, v) {
    osc(out, t, { f: f, v: v, d: d, a: 0.005 });
    osc(out, t, { f: f * 3.93, v: v * 0.22, d: d * 0.16, a: 0.002 });
    osc(out, t, { f: f * 2, v: v * 0.08, d: d * 0.4, a: 0.004 });
  }
  function mbox(out, f, t, d, v) {
    osc(out, t, { f: f, v: v, d: d, a: 0.003 });
    osc(out, t, { f: f * 2.01, v: v * 0.3, d: d * 0.45, a: 0.002 });
    osc(out, t, { f: f * 5.4, v: v * 0.06, d: d * 0.12, a: 0.001 });
  }
  var NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function nf(s) { var m = /^([A-G])(#?)(\d)$/.exec(s); var n = NOTE[m[1]] + (m[2] ? 1 : 0) + (+m[3] + 1) * 12; return 440 * Math.pow(2, (n - 69) / 12); }

  var SFX = {
    tap: [0.12, function (o, t, p) { osc(o, t, { f: 880 * p, f1: 640 * p, v: 0.32, d: 0.07 }); noise(o, t, { type: 'highpass', f: 4000, v: 0.08, d: 0.015 }); }],
    pop: [0.15, function (o, t, p) { osc(o, t, { f: 380 * p, f1: 1000 * p, glide: 0.05, v: 0.42, d: 0.09 }); }],
    plop: [0.25, function (o, t, p) {
      osc(o, t, { f: 240 * p, f1: 92 * p, glide: 0.11, v: 0.75, d: 0.17 });
      noise(o, t, { type: 'lowpass', f: 520, v: 0.35, d: 0.07 });
      noise(o, t + 0.005, { type: 'bandpass', f: 1500 * p, q: 2, v: 0.08, d: 0.025 });
    }],
    squish: [0.3, function (o, t, p) {
      noise(o, t, { type: 'bandpass', f: 950 * p, f1: 330 * p, q: 4, a: 0.03, v: 0.55, d: 0.22 });
      osc(o, t, { f: 165 * p, f1: 105 * p, v: 0.22, d: 0.15, a: 0.02 });
    }],
    pinch: [0.16, function (o, t, p) {
      osc(o, t, { type: 'triangle', f: 640 * p, f1: 1380 * p, glide: 0.07, v: 0.28, d: 0.09 });
      osc(o, t + 0.03, { f: 1350 * p, f1: 1750 * p, v: 0.1, d: 0.05 });
    }],
    fold: [0.2, function (o, t, p) {
      osc(o, t, { f: 210 * p, f1: 85 * p, glide: 0.07, v: 0.6, d: 0.12 });
      noise(o, t, { type: 'lowpass', f: 1300, f1: 300, v: 0.38, d: 0.07 });
    }],
    splash: [0.6, function (o, t, p) {
      noise(o, t, { type: 'bandpass', f: 1900 * p, f1: 650 * p, q: 0.9, a: 0.01, v: 0.5, d: 0.42 });
      for (var i = 0; i < 6; i++) { var f = (700 + Math.random() * 1300) * p; osc(o, t + Math.random() * 0.35, { f: f, f1: f * 1.7, v: 0.1, d: 0.05 }); }
    }],
    drip: [0.18, function (o, t, p) {
      osc(o, t, { f: 620 * p, f1: 1550 * p, glide: 0.045, v: 0.38, d: 0.09 });
      osc(o, t + 0.04, { f: 1500 * p, f1: 1800 * p, v: 0.07, d: 0.05 });
    }],
    clink: [0.45, function (o, t, p) {
      partials(o, t, [2350, 3810, 5420, 7100], [0.28, 0.16, 0.09, 0.05], [0.35, 0.25, 0.15, 0.1], p);
      noise(o, t, { type: 'highpass', f: 6000, v: 0.08, d: 0.01 });
    }],
    lid: [0.45, function (o, t, p) {
      [0, 0.075].forEach(function (dt, k) {
        var s = k ? 0.5 : 1;
        partials(o, t + dt, [1650, 2730, 4120, 5900], [0.2 * s, 0.13 * s, 0.08 * s, 0.04 * s], [0.25, 0.18, 0.12, 0.08], p);
        osc(o, t + dt, { f: 420 * p, v: 0.15 * s, d: 0.12 });
        noise(o, t + dt, { type: 'bandpass', f: 3000, v: 0.2 * s, d: 0.015 });
      });
    }],
    ceramic: [0.3, function (o, t, p) {
      partials(o, t, [980, 1630, 2700, 3900], [0.22, 0.14, 0.08, 0.04], [0.22, 0.15, 0.1, 0.06], p);
      osc(o, t, { f: 140 * p, f1: 90 * p, v: 0.3, d: 0.07 });
      noise(o, t, { type: 'lowpass', f: 1500, v: 0.15, d: 0.02 });
    }],
    metal: [0.8, function (o, t, p) {
      partials(o, t, [520, 1370, 2380, 3700, 5100], [0.22, 0.16, 0.11, 0.07, 0.04], [0.7, 0.5, 0.35, 0.25, 0.15], p);
      noise(o, t, { type: 'highpass', f: 3000, v: 0.1, d: 0.015 });
    }],
    whoosh: [0.55, function (o, t, p) {
      noise(o, t, { type: 'bandpass', f: 300 * p, path: [[1400 * p, 0.2], [500 * p, 0.45]], q: 0.8, a: 0.15, v: 0.32, d: 0.32 });
    }],
    click: [0.08, function (o, t, p) {
      noise(o, t, { type: 'highpass', f: 3000, v: 0.45, d: 0.012, a: 0.001 });
      osc(o, t, { f: 1250 * p, v: 0.1, d: 0.02, a: 0.001 });
    }],
    ignite: [1.0, function (o, t, p) {
      [0, 0.14, 0.28].forEach(function (dt) { SFX.click[1](o, t + dt, p * (1 + dt * 0.3)); });
      noise(o, t + 0.42, { type: 'lowpass', f: 180, f1: 900, glide: 0.2, q: 0.7, a: 0.05, v: 0.6, d: 0.45 });
      osc(o, t + 0.42, { f: 72 * p, f1: 52 * p, v: 0.35, d: 0.4, a: 0.03 });
    }],
    crack: [0.2, function (o, t, p) {
      noise(o, t, { type: 'highpass', f: 2500 * p, v: 0.55, d: 0.012, a: 0.001 });
      grains(o, t + 0.01, 7, 0.11, 2500 * p, 5000 * p, 0.2, 0.5);
    }],
    crunch: [0.3, function (o, t, p) {
      grains(o, t, 10, 0.2, 1500 * p, 4000 * p, 0.2, 0.45);
      noise(o, t, { type: 'lowpass', f: 600, v: 0.18, d: 0.1 });
    }],
    bite: [0.3, function (o, t, p) {
      osc(o, t, { f: 320 * p, f1: 160 * p, v: 0.38, d: 0.08 });
      grains(o, t + 0.02, 5, 0.1, 1800 * p, 3800 * p, 0.15, 0.35);
      noise(o, t + 0.12, { type: 'lowpass', f: 800, v: 0.2, d: 0.03 });
    }],
    gulp: [0.3, function (o, t, p) {
      osc(o, t, { f: 260 * p, path: [[140 * p, 0.08], [230 * p, 0.18]], v: 0.42, d: 0.2, a: 0.01 });
    }],
    sparkle: [0.6, function (o, t, p) {
      var sc = [2093, 2349, 2637, 3136, 3520, 4186], st = Math.floor(Math.random() * 2);
      for (var i = 0; i < 5; i++) {
        var f = sc[Math.min(sc.length - 1, st + i)] * p;
        osc(o, t + i * 0.06, { f: f, v: 0.08, d: 0.25, a: 0.003 });
        osc(o, t + i * 0.06, { f: f * 2, v: 0.02, d: 0.1, a: 0.002 });
      }
    }],
    chime: [1.5, function (o, t, p) { mallet(o, 784 * p, t, 0.9, 0.32); mallet(o, 1047 * p, t + 0.18, 1.2, 0.32); }],
    puff: [0.4, function (o, t, p) { noise(o, t, { type: 'bandpass', f: 2600 * p, f1: 1200 * p, q: 0.7, a: 0.02, v: 0.38, d: 0.3 }); }],
    pour: [1.0, function (o, t, p) {
      noise(o, t, { type: 'bandpass', f: 900 * p, f1: 700 * p, q: 1.2, a: 0.08, v: 0.32, d: 0.85 });
      for (var i = 0; i < 8; i++) { var f = (600 + Math.random() * 900) * p; osc(o, t + 0.05 + Math.random() * 0.75, { f: f, f1: f * 1.5, v: 0.06, d: 0.04 }); }
    }],
    sizzleBurst: [1.8, function (o, t, p) {
      noise(o, t, { type: 'bandpass', f: 6500 * p, path: [[2200 * p, 1.4]], q: 0.6, dur: 1.7,
        env: [[0.95, 0.08], [0.7, 0.5], [0.35, 1.0, 1], [0.0005, 1.65, 1]] });
      noise(o, t, { type: 'lowpass', f: 3200 * p, path: [[850 * p, 1.4]], q: 0.5, dur: 1.7,
        env: [[0.5, 0.1], [0.35, 0.6], [0.0005, 1.6, 1]] });
      for (var i = 0; i < 30; i++) {
        var tt = Math.pow(Math.random(), 1.6) * 1.4;
        noise(o, t + tt, { type: 'highpass', f: 3000 + Math.random() * 3000, v: (0.1 + Math.random() * 0.22) * (1 - tt / 1.6), d: 0.006 + Math.random() * 0.01, a: 0.001 });
      }
    }],
    flour: [0.45, function (o, t, p) {
      noise(o, t, { type: 'lowpass', f: 1800 * p, f1: 600 * p, q: 0.5, a: 0.05, v: 0.25, d: 0.32 });
      noise(o, t, { type: 'highpass', f: 5000, a: 0.03, v: 0.05, d: 0.2 });
    }]
  };
  var VOICE_MAX = 3, TOTAL_MAX = 18;

  AU.sfx = function (name, o) {
    if (!actx || !unlocked || actx.state === 'closed' || document.hidden) return;
    var def = SFX[name];
    if (!def) return;
    o = o || {};
    if ((voices[name] || 0) >= VOICE_MAX || totalVoices >= TOTAL_MAX) return;
    try {
      var vol = o.vol != null ? Math.max(0, +o.vol) : 1, pitch = o.pitch > 0 ? +o.pitch : 1, delay = Math.max(0, +o.delay || 0);
      var t = actx.currentTime + 0.005 + delay;
      var out = actx.createGain(); out.gain.value = Math.min(2, vol); out.connect(sfxBus);
      def[1](out, t, pitch);
      voices[name] = (voices[name] || 0) + 1; totalVoices++;
      setTimeout(function () {
        voices[name]--; totalVoices--;
        try { out.disconnect(); } catch (_) {}
      }, (def[0] + delay) * 1000 + 150);
    } catch (e) { logErr('audio.sfx ' + name, e); }
  };

  /* --- 連続音: あらかじめ手続き生成したループバッファ --- */
  function genLoopBuf(name) {
    var sr = actx.sampleRate, n = Math.floor(sr * 4), b = actx.createBuffer(1, n, sr), d = b.getChannelData(0);
    var i, j, rnd = Math.random;
    if (name === 'sizzle') {
      var env = 0.6, tgt = 0.6;
      for (i = 0; i < n; i++) {
        if (i % 400 === 0) tgt = 0.35 + rnd() * 0.65;
        env += (tgt - env) * 0.004;
        d[i] = (rnd() * 2 - 1) * env * 0.6;
      }
      for (j = 0; j < 160; j++) { // まばらな小さなはじけ（毎秒~40）
        var at = Math.floor(rnd() * (n - sr * 0.01)), amp = 0.3 + rnd() * 0.7, len = Math.floor(sr * (0.001 + rnd() * 0.003));
        for (var k = 0; k < len; k++) d[at + k] += (rnd() * 2 - 1) * amp * Math.exp(-k / (len * 0.3));
      }
    } else if (name === 'bubble') {
      var b0 = 0;
      for (i = 0; i < n; i++) { b0 = (b0 + (rnd() * 2 - 1) * 0.02) * 0.995; d[i] = b0 * 0.6; }
      var cnt = 4 * 7;
      for (j = 0; j < cnt; j++) {
        var st = Math.floor(rnd() * (n - sr * 0.12)), f0 = 170 + rnd() * 260, dur = 0.04 + rnd() * 0.06, a = 0.25 + rnd() * 0.5, ph = 0;
        var L = Math.floor(dur * sr);
        for (k = 0; k < L; k++) {
          var tt = k / L, f = f0 * (1 + tt * 0.7);
          ph += 2 * Math.PI * f / sr;
          d[st + k] += Math.sin(ph) * a * Math.min(1, tt * 12) * Math.exp(-tt * 4);
        }
      }
    } else if (name === 'crackle') {
      for (i = 0; i < n; i++) d[i] = (rnd() * 2 - 1) * 0.015;
      for (j = 0; j < 4 * 13; j++) {
        var at2 = Math.floor(rnd() * (n - sr * 0.02)), amp2 = 0.25 + rnd() * 0.75, tau = sr * (0.0005 + rnd() * 0.0018);
        for (k = 0; k < tau * 6; k++) d[at2 + k] += (rnd() * 2 - 1) * amp2 * Math.exp(-k / tau);
        if (rnd() < 0.4) { var at3 = at2 + Math.floor(sr * (0.01 + rnd() * 0.03)); for (k = 0; k < tau * 4 && at3 + k < n; k++) d[at3 + k] += (rnd() * 2 - 1) * amp2 * 0.5 * Math.exp(-k / tau); }
      }
    } else if (name === 'flame') {
      var br = 0, fl = 1, ft = 1;
      for (i = 0; i < n; i++) {
        br = (br + (rnd() * 2 - 1) * 0.04) * 0.996;
        if (i % 2000 === 0) ft = 0.75 + rnd() * 0.35;
        fl += (ft - fl) * 0.0008;
        d[i] = br * 2.2 * fl;
      }
    } else { // steam
      var e2 = 0.8, t2 = 0.8;
      for (i = 0; i < n; i++) {
        if (i % 3000 === 0) t2 = 0.55 + rnd() * 0.45;
        e2 += (t2 - e2) * 0.0006;
        d[i] = (rnd() * 2 - 1) * e2 * 0.6;
      }
    }
    // 継ぎ目をなめらかに（先頭と末尾を短くクロスフェード）
    var xf = Math.floor(sr * 0.05);
    for (i = 0; i < xf; i++) { var w = i / xf; d[i] = d[i] * w + d[n - xf + i] * (1 - w); }
    for (i = 0; i < n; i++) { if (d[i] > 1) d[i] = 1; else if (d[i] < -1) d[i] = -1; }
    return b;
  }
  var LOOP_DEF = {
    sizzle: { base: 0.32, f: [['highpass', 1900, 0.7], ['peaking', 5200, 1, 4]] },
    bubble: { base: 0.6, f: [['lowpass', 1400, 0.7]] },
    crackle: { base: 0.5, f: [['highpass', 1800, 0.7]] },
    flame: { base: 0.42, f: [['lowpass', 380, 0.8]] },
    steam: { base: 0.22, f: [['bandpass', 3800, 0.6]] }
  };
  function ensureLoop(name) {
    if (loopNodes[name]) return loopNodes[name];
    var def = LOOP_DEF[name];
    if (!def || !actx) return null;
    var src = actx.createBufferSource(); src.buffer = genLoopBuf(name); src.loop = true;
    var node = src;
    def.f.forEach(function (fd) {
      var bf = actx.createBiquadFilter(); bf.type = fd[0]; bf.frequency.value = fd[1]; bf.Q.value = fd[2];
      if (fd[3]) bf.gain.value = fd[3];
      node.connect(bf); node = bf;
    });
    var g = actx.createGain(); g.gain.value = 0.0001;
    node.connect(g); g.connect(loopLP);
    src.start(actx.currentTime + 0.01, Math.random() * 3);
    loopNodes[name] = { src: src, gain: g, base: def.base };
    return loopNodes[name];
  }
  AU.loop = function (name, level) {
    if (!LOOP_DEF[name]) return;
    level = U.clamp01(+level || 0);
    loopWant[name] = level;
    if (!actx) return;
    try {
      var ln = level > 0 ? ensureLoop(name) : loopNodes[name];
      if (!ln) return;
      ln.gain.gain.cancelScheduledValues(actx.currentTime);
      ln.gain.gain.setTargetAtTime(Math.max(0.0001, level * ln.base), actx.currentTime, 0.12);
    } catch (e) { logErr('audio.loop', e); }
  };
  AU.muffle = function (m) {
    muffleV = U.clamp01(+m || 0);
    if (!actx) return;
    try {
      var f = 18000 * Math.pow(650 / 18000, muffleV);
      loopLP.frequency.cancelScheduledValues(actx.currentTime);
      loopLP.frequency.setTargetAtTime(f, actx.currentTime, 0.15);
    } catch (e) { logErr('audio.muffle', e); }
  };

  var PHRASES = {
    start: function (o, t) { ['C5', 'E5', 'G5', 'C6'].forEach(function (n, i) { mallet(o, nf(n), t + i * 0.13, i === 3 ? 1.3 : 0.6, 0.3); }); },
    made: function (o, t) {
      ['E5', 'G5', 'A5', 'C6'].forEach(function (n, i) { mallet(o, nf(n), t + i * 0.11, i === 3 ? 1.1 : 0.5, 0.28); });
      mallet(o, nf('E6'), t + 0.44, 1.0, 0.12);
    },
    reveal: function (o, t) {
      ['C5', 'G5', 'C6', 'E6', 'G6', 'C7'].forEach(function (n, i) { mbox(o, nf(n), t + i * 0.09, i === 5 ? 1.6 : 0.8, 0.2); });
      ['C5', 'E5', 'G5'].forEach(function (n) { mallet(o, nf(n), t + 0.6, 1.6, 0.13); });
    },
    ending: function (o, t) {
      var beat = 0.42, mel = [['E5', 1], ['G5', 1], ['A5', 1], ['G5', 1], ['E5', 1], ['D5', 1], ['C5', 2],
        ['D5', 1], ['E5', 1], ['G5', 1], ['E5', 1], ['D5', 2], ['C5', 3]];
      var b = 0;
      mel.forEach(function (m, i) {
        var last = i === mel.length - 1;
        mbox(o, nf(m[0]), t + b * beat, last ? 3.2 : m[1] * beat * 2.2, last ? 0.24 : 0.2);
        b += m[1];
      });
      var bass = ['C4', 'A3', 'F3', 'G3', 'C4', 'F3', 'G3', 'C4'];
      bass.forEach(function (n, i) { mallet(o, nf(n), t + i * 2 * beat, i === bass.length - 1 ? 3.0 : 1.2, 0.13); });
      ['E4', 'G4'].forEach(function (n) { mallet(o, nf(n), t + 14 * beat, 3.0, 0.08); });
    }
  };
  AU.phrase = function (name) {
    if (!actx || !unlocked || actx.state === 'closed' || document.hidden || !PHRASES[name]) return;
    try {
      var out = actx.createGain(); out.gain.value = 1; out.connect(musicBus);
      PHRASES[name](out, actx.currentTime + 0.02);
      setTimeout(function () { try { out.disconnect(); } catch (_) {} }, 12000);
    } catch (e) { logErr('audio.phrase', e); }
  };
  AU.stopAll = function () {
    for (var k in loopWant) loopWant[k] = 0;
    if (!actx) return;
    try {
      for (var n in loopNodes) { var g = loopNodes[n].gain.gain; g.cancelScheduledValues(actx.currentTime); g.setTargetAtTime(0.0001, actx.currentTime, 0.08); }
      liveSrc.slice().forEach(function (s) { try { s.stop(); } catch (_) {} });
      liveSrc.length = 0;
      AU.muffle(0);
    } catch (e) { logErr('audio.stopAll', e); }
  };

  /* ======================================================================
   * G.hint — 次に触る1つを光で示す
   * ==================================================================== */
  var HI = (G.hint = { stage: 0, active: false, spotIntensity: 26, dim: 0.88, fingerScale: 1.15 });
  var hcfg = null, hAlpha = 0, hIdle = 0, hStageT = 0, hBuilt = false;
  var hSpot, hSpotTgt, hRing, hRingMat, hFinger, hFingerMats = [], hFingerA = 0, hDemoT = 0;
  var hPos = new THREE.Vector3(), hWobDelta = { rx: 0, rz: 0, y: 0 }, hWobObj = null;

  function ringTexture() {
    var s = 256, c = U.canvas(s, s), x = c.getContext('2d'), img = x.createImageData(s, s), d = img.data;
    for (var j = 0; j < s; j++) for (var i = 0; i < s; i++) {
      var dx = (i + 0.5) / s * 2 - 1, dy = (j + 0.5) / s * 2 - 1, r = Math.sqrt(dx * dx + dy * dy);
      var ring = Math.exp(-Math.pow((r - 0.72) / 0.11, 2));
      var fill = 0.22 * (1 - U.smooth(0.0, 0.85, r));
      var halo = 0.18 * Math.exp(-Math.pow((r - 0.72) / 0.26, 2));
      var a = Math.min(1, ring + fill + halo) * (1 - U.smooth(0.92, 1.0, r));
      var p = (j * s + i) * 4;
      d[p] = 255; d[p + 1] = 255; d[p + 2] = 255; d[p + 3] = Math.round(a * 255);
    }
    x.putImageData(img, 0, 0);
    return U.canvasTex(c, { srgb: true });
  }

  function buildFinger() {
    var grp = new THREE.Group();
    var R = 0.082, pts = [], i;
    // 指先の丸み
    for (i = 0; i <= 10; i++) { var a = i / 10 * Math.PI / 2; pts.push(new THREE.Vector2(Math.max(0.0005, R * Math.sin(a)), R * (1 - Math.cos(a)))); }
    // 指の胴（第一関節・第二関節のふくらみ、付け根へ太く）
    var prof = [[0.12, 0.084], [0.2, 0.086], [0.26, 0.09], [0.31, 0.087], [0.38, 0.089], [0.47, 0.095], [0.55, 0.099], [0.62, 0.096], [0.72, 0.1], [0.84, 0.106], [0.95, 0.112]];
    prof.forEach(function (q) { pts.push(new THREE.Vector2(q[1], q[0])); });
    pts.push(new THREE.Vector2(0.0005, 0.96));
    var geo = new THREE.LatheGeometry(pts, 32);
    var pos = geo.attributes.position, n = pos.count;
    var col = new Float32Array(n * 4);
    for (i = 0; i < n; i++) {
      var x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      // 断面を少し平たく（腹側 -Z をやや平らに）
      z *= z < 0 ? 0.82 : 0.9;
      // 指の腹側へゆるく曲げる
      if (y > 0.3) z -= 0.11 * Math.pow(y - 0.3, 2);
      pos.setXYZ(i, x, y, z);
      var alpha = 1 - U.smooth(0.62, 0.95, y);
      col[i * 4] = 1; col[i * 4 + 1] = 1; col[i * 4 + 2] = 1; col[i * 4 + 3] = alpha;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    geo.computeVertexNormals();
    var skin = new THREE.MeshStandardMaterial({ color: 0xe9b392, roughness: 0.6, metalness: 0, transparent: true, opacity: 0.78, depthWrite: false, vertexColors: true, emissive: 0x4a2a1c, emissiveIntensity: 0.3 });
    var m = new THREE.Mesh(geo, skin); m.renderOrder = 20;
    grp.add(m);
    // 爪
    var ng = new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    var nail = new THREE.Mesh(ng, new THREE.MeshStandardMaterial({ color: 0xf6d6cc, roughness: 0.28, metalness: 0, transparent: true, opacity: 0.6, depthWrite: false, emissive: 0x3a2a26, emissiveIntensity: 0.3 }));
    nail.scale.set(0.056, 0.02, 0.07);
    nail.rotation.x = Math.PI / 2; // 半球のドームを +Z（背側）へ向け、長手を指の軸に
    nail.position.set(0, 0.125, 0.06);
    nail.renderOrder = 21;
    grp.add(nail);
    hFingerMats = [skin, nail.material];
    grp.visible = false;
    return grp;
  }

  function hintBuild() {
    if (hBuilt || !C.scene) return;
    hBuilt = true;
    hSpot = new THREE.SpotLight(0xffd6a0, 0, 0, 0.35, 0.85, 2);
    hSpot.castShadow = false;
    hSpotTgt = new THREE.Object3D();
    hSpot.target = hSpotTgt;
    C.scene.add(hSpot); C.scene.add(hSpotTgt);
    hRingMat = new THREE.MeshBasicMaterial({ map: ringTexture(), color: 0xffc070, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    hRing = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), hRingMat);
    hRing.rotation.x = -Math.PI / 2; hRing.renderOrder = 10; hRing.visible = false;
    hRing.raycast = function () {};
    C.scene.add(hRing);
    hFinger = buildFinger();
    hFinger.traverse(function (o) { o.raycast = function () {}; });
    C.scene.add(hFinger);
  }

  function unwobble() {
    if (hWobObj) {
      hWobObj.rotation.x -= hWobDelta.rx; hWobObj.rotation.z -= hWobDelta.rz; hWobObj.position.y -= hWobDelta.y;
    }
    hWobDelta.rx = hWobDelta.rz = hWobDelta.y = 0;
  }
  HI.set = function (o) {
    hintBuild();
    unwobble();
    o = o || {};
    hcfg = {
      target: o.target, radius: o.radius > 0 ? +o.radius : 0.5, wobble: o.wobble || null, demo: o.demo || null,
      delays: Array.isArray(o.delays) && o.delays.length >= 2 ? [+o.delays[0], +o.delays[1]] : [4, 9],
      ringY: o.ringY != null ? o.ringY : null
    };
    hWobObj = hcfg.wobble;
    hIdle = 0; HI.stage = 0; HI.active = true; hDemoT = 0;
    if (hcfg.target) toV3(hcfg.target, hPos);
  };
  HI.poke = function () {
    if (!hcfg) return;
    hIdle = 0; HI.stage = 0; hDemoT = 0;
    unwobble();
  };
  HI.clear = function () {
    unwobble();
    hWobObj = null;
    hcfg = null; HI.active = false; HI.stage = 0;
  };

  var tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
  function pathPoints(path) {
    if (isFn(path)) path = path();
    if (!path || !path.length) return null;
    return path.map(function (q) { return toV3(q, new THREE.Vector3()); });
  }
  function pathAt(pts, k, out) {
    if (pts.length === 1) return out.copy(pts[0]);
    var lens = [], tot = 0;
    for (var i = 1; i < pts.length; i++) { var l = pts[i].distanceTo(pts[i - 1]); lens.push(l); tot += l; }
    var dd = k * tot;
    for (i = 0; i < lens.length; i++) {
      if (dd <= lens[i] || i === lens.length - 1) return out.lerpVectors(pts[i], pts[i + 1], lens[i] > 0 ? U.clamp01(dd / lens[i]) : 1);
      dd -= lens[i];
    }
    return out.copy(pts[pts.length - 1]);
  }
  function pathLen(pts) { var t = 0; for (var i = 1; i < pts.length; i++) t += pts[i].distanceTo(pts[i - 1]); return t; }

  /* 指の向き: 右手で手前右から差しだす。tip をワールド位置に置き、hover だけ軸方向に浮かせる */
  var fAxis = new THREE.Vector3(), fNail = new THREE.Vector3(), fX = new THREE.Vector3(), fM = new THREE.Matrix4();
  function placeFinger(tip, hover, press) {
    var cam = C.camera;
    var right = tmpA.setFromMatrixColumn(cam.matrixWorld, 0); right.y = 0; right.normalize();
    var toCam = tmpB.copy(cam.position).sub(tip); toCam.y = 0; toCam.normalize();
    fAxis.set(0, 0.62, 0).addScaledVector(right, 0.55).addScaledVector(toCam, 0.5).normalize();
    var up = tmpC.set(0, 1, 0);
    fNail.copy(up).addScaledVector(fAxis, -up.dot(fAxis)).normalize();
    fX.crossVectors(fAxis, fNail);
    fM.makeBasis(fX, fAxis, fNail);
    hFinger.quaternion.setFromRotationMatrix(fM);
    hFinger.position.copy(tip).addScaledVector(fAxis, hover);
    // 画面上でいつも同じくらいの太さ（約 34px）に見えるよう、その場所の縮尺に合わせる
    var ppu = 0; try { ppu = IN.pxPerUnit(tip) || 0; } catch (_) { ppu = 0; }
    var S = ppu > 1 ? U.clamp(34 / (ppu * 0.17), HI.fingerScale, 3.2) : HI.fingerScale, s = 1 - (press || 0) * 0.04;
    hFinger.scale.set(S * (1 + (press || 0) * 0.03), S * s, S * (1 + (press || 0) * 0.03));
  }

  function updateDemo(dt) {
    var d = hcfg && hcfg.demo;
    if (!d) return 0;
    hDemoT += dt;
    var t = hDemoT, HOV = 0.4;
    var tip = new THREE.Vector3();
    if (d.type === 'tap') {
      toV3(d.at || hcfg.target, tip);
      var cyc = 3.0, k = t % cyc, hov = HOV, press = 0, alpha = 1;
      if (k < 0.35) { alpha = k / 0.35; hov = HOV; }
      else if (k < 1.75) {
        var q = (k - 0.35) % 0.7; // とん・とん
        var w = q < 0.25 ? E.inQuad(q / 0.25) : q < 0.35 ? 1 : 1 - E.outQuad(Math.min(1, (q - 0.35) / 0.3));
        hov = HOV * (1 - w); press = q >= 0.25 && q < 0.35 ? 1 : 0;
      } else if (k < 2.1) { alpha = 1 - (k - 1.75) / 0.35; }
      else alpha = 0;
      placeFinger(tip, hov, press);
      return alpha;
    }
    // drag
    var pts = pathPoints(d.path);
    if (!pts) { toV3(hcfg.target, tip); placeFinger(tip, HOV, 0); return 0; }
    var L = pathLen(pts), mv = U.clamp(L / 1.3, 0.8, 2.4);
    var T = [0.35, 0.4, 0.15, mv, 0.25, 0.4, 0.3, 0.8];
    var tot = T.reduce(function (a, b) { return a + b; }, 0);
    var kk = t % tot, a2 = 1, hv = 0, pr = 0, along = 0, acc = 0, seg = 0;
    for (seg = 0; seg < T.length; seg++) { if (kk < acc + T[seg]) break; acc += T[seg]; }
    var u = U.clamp01((kk - acc) / T[Math.min(seg, T.length - 1)]);
    switch (seg) {
      case 0: a2 = u; hv = HOV; break;                          // あらわれる
      case 1: hv = HOV * (1 - E.inOutQuad(u)); break;            // 降りる
      case 2: hv = 0; pr = 1; break;                             // ふれる
      case 3: along = E.inOutQuad(u); pr = 1; break;             // なぞる
      case 4: along = 1; pr = 1; break;
      case 5: along = 1; hv = HOV * E.inOutQuad(u); break;       // はなれる
      case 6: along = 1; hv = HOV; a2 = 1 - u; break;            // 消える
      default: a2 = 0; along = 1; hv = HOV;
    }
    pathAt(pts, along, tip);
    placeFinger(tip, hv, pr);
    return a2;
  }

  postSys.push(function hintUpdate(dt) {
    if (!hBuilt) return;
    var on = !!hcfg;
    hAlpha = U.damp(hAlpha, on ? 1 : 0, on ? 5 : 6, dt);
    if (!on && hAlpha < 0.004) hAlpha = 0;
    C._setDim(U.lerp(1, HI.dim, hAlpha));
    if (on) {
      if (hcfg.target) toV3(hcfg.target, hPos);
      if (!IN.active) hIdle += dt;
      var ns = hIdle >= hcfg.delays[1] ? 2 : hIdle >= hcfg.delays[0] ? 1 : 0;
      if (ns > HI.stage) { try { AU.sfx('sparkle', { vol: 0.7 }); } catch (_) {} hStageT = 0; }
      if (ns !== HI.stage && ns === 2) hDemoT = 0;
      HI.stage = ns;
    }
    hStageT += dt;
    var vis = hAlpha > 0.001;
    hRing.visible = vis; hSpot.visible = vis;
    if (!vis) { hSpot.intensity = 0; hFinger.visible = false; hFingerA = 0; return; }
    var rad = hcfg ? hcfg.radius : (HI._lastR || 0.5);
    HI._lastR = rad;
    var st = HI.stage, t = C.time;
    var strong = st >= 1 ? 1 : 0;
    HI._strong = U.damp(HI._strong || 0, strong, 4, dt);
    var sg = HI._strong;
    var pulse = Math.sin(t * Math.PI * 2 / U.lerp(1.8, 1.0, sg)) * 0.5 + 0.5;
    var scale = rad * 2.3 * (1 + U.lerp(0.05, 0.16, sg) * pulse) * U.lerp(1, 1.15, sg);
    hRing.scale.set(scale, scale, 1);
    var ry = hcfg && hcfg.ringY != null ? +hcfg.ringY : hPos.y;
    hRing.position.set(hPos.x, ry + 0.01, hPos.z);
    hRingMat.opacity = hAlpha * U.lerp(0.4 + 0.2 * pulse, 0.6 + 0.25 * pulse, sg);
    // スポット光
    var cam = C.camera;
    var toCam = tmpA.copy(cam.position).sub(hPos); toCam.y = 0;
    if (toCam.lengthSq() < 1e-6) toCam.set(0, 0, 1); toCam.normalize();
    var right = tmpB.setFromMatrixColumn(cam.matrixWorld, 0);
    hSpot.position.copy(hPos).addScaledVector(toCam, 1.4).addScaledVector(right, 0.5); hSpot.position.y += 3.2;
    hSpotTgt.position.copy(hPos); hSpotTgt.updateMatrixWorld();
    var dist = hSpot.position.distanceTo(hPos);
    hSpot.angle = U.clamp(Math.atan(rad * 1.7 / dist), 0.06, 0.7);
    hSpot.intensity = HI.spotIntensity * hAlpha * (1 + 0.12 * sg * pulse) * (dist * dist / 12.5);
    // 揺れ（足した分だけを毎フレーム差し替える）
    if (hWobObj && hcfg) {
      var wa = st >= 1 ? 1 : 0;
      var env = wa * Math.min(1, hStageT * 3);
      var ph = t * Math.PI * 2 * 2.2;
      var burst = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 / 1.6)), 3);
      var nrx = Math.sin(ph) * 0.045 * env * burst, nrz = Math.sin(ph + 1.2) * 0.06 * env * burst, ny = Math.abs(Math.sin(ph)) * 0.025 * env * burst;
      hWobObj.rotation.x += nrx - hWobDelta.rx; hWobObj.rotation.z += nrz - hWobDelta.rz; hWobObj.position.y += ny - hWobDelta.y;
      hWobDelta.rx = nrx; hWobDelta.rz = nrz; hWobDelta.y = ny;
    }
    // 指
    var fa = 0;
    if (hcfg && HI.stage >= 2 && hcfg.demo && !IN.active) fa = updateDemo(dt);
    hFingerA = U.damp(hFingerA, fa, 14, dt);
    hFinger.visible = hFingerA > 0.01;
    hFingerMats[0].opacity = 0.78 * hFingerA;
    hFingerMats[1].opacity = 0.82 * hFingerA;
  });

  /* ======================================================================
   * G.fx — 湯気と粒
   * ==================================================================== */
  var FX = (G.fx = {});
  var fxBuilt = false, puffTex = [], glowTex = null;
  var steamPool = [], steamLive = [], burstLive = [], burstPool = { sprite: [], crumb: [], drop: [] };
  var emitters = [];
  var crumbGeos = [], dropGeo = null;

  function makePuff(seed) {
    var s = 128;
    var c = U.pixelCanvas(s, s, function (u, v) {
      var dx = u * 2 - 1, dy = v * 2 - 1, r = Math.sqrt(dx * dx + dy * dy);
      var n = U.fbm(u * 4 + seed * 3.1, v * 4, seed * 7 + 1, 4, 0);
      var a = Math.pow(Math.max(0, 1 - r), 1.6) * (0.45 + 0.85 * n);
      a = U.clamp01(a * 1.1);
      return [255, 255, 255, Math.round(a * 255)];
    });
    return U.canvasTex(c, { srgb: true });
  }
  function fxBuild() {
    if (fxBuilt) return;
    fxBuilt = true;
    for (var i = 0; i < 3; i++) puffTex.push(makePuff(i + 1));
    var gs = 64;
    glowTex = U.canvasTex(U.pixelCanvas(gs, gs, function (u, v) {
      var dx = u * 2 - 1, dy = v * 2 - 1, r = Math.sqrt(dx * dx + dy * dy);
      var a = Math.exp(-r * r * 9) + 0.25 * Math.exp(-r * r * 2.5);
      return [255, 255, 255, Math.round(U.clamp01(a) * 255)];
    }));
    for (i = 0; i < 4; i++) {
      var sh = new THREE.Shape(), rng = U.rng(31 + i), nV = 5 + (i % 3);
      for (var k = 0; k < nV; k++) {
        var a = k / nV * Math.PI * 2, rr = 0.5 + rng() * 0.5;
        var x = Math.cos(a) * rr * (1 + (i % 2) * 0.6), y = Math.sin(a) * rr * 0.7;
        if (k === 0) sh.moveTo(x, y); else sh.lineTo(x, y);
      }
      sh.closePath();
      crumbGeos.push(new THREE.ShapeGeometry(sh));
    }
    dropGeo = new THREE.SphereGeometry(1, 10, 8);
  }
  function capS() { return C.low ? 30 : 60; }
  function capB() { return C.low ? 40 : 80; }

  function getSteam() {
    var p = steamPool.pop();
    if (!p) {
      var mat = new THREE.SpriteMaterial({ map: puffTex[steamLive.length % 3], color: 0xe6eaee, transparent: true, opacity: 0, depthWrite: false });
      var sp = new THREE.Sprite(mat); sp.renderOrder = 30; sp.raycast = function () {};
      p = { o: sp, vel: new THREE.Vector3() };
    }
    if (!p.o.parent) C.scene.add(p.o);
    p.o.visible = true;
    return p;
  }
  function rel(p, live, pool) {
    p.o.visible = false;
    var i = live.indexOf(p); if (i >= 0) live.splice(i, 1);
    pool.push(p);
  }

  FX.steam = function (pos, o) {
    if (!C.scene) return;
    fxBuild();
    o = o || {};
    var base = toV3(pos, new THREE.Vector3());
    var count = o._one ? 1 : Math.max(1, Math.round((o.count || 6) * (C.low ? 0.5 : 1)));
    var spread = o.spread != null ? +o.spread : 0.3, rise = o.rise != null ? +o.rise : 1.2;
    var size = o.size != null ? +o.size : 0.5, life = o.life != null ? +o.life : 2.2, op = o.opacity != null ? +o.opacity : 0.32;
    for (var i = 0; i < count; i++) {
      while (steamLive.length >= capS()) rel(steamLive[0], steamLive, steamPool);
      var p = getSteam();
      var a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
      p.o.position.set(base.x + Math.cos(a) * r, base.y + Math.random() * 0.05, base.z + Math.sin(a) * r);
      p.vel.set((Math.random() - 0.5) * 0.12 + Math.cos(a) * 0.06, rise * (0.7 + Math.random() * 0.5) / life, (Math.random() - 0.5) * 0.12 + Math.sin(a) * 0.06);
      p.t = -Math.random() * 0.25 * Math.min(1, count / 6); p.life = life * (0.8 + Math.random() * 0.4);
      p.size = size * (0.75 + Math.random() * 0.5); p.op = op * (0.7 + Math.random() * 0.4);
      p.o.material.rotation = Math.random() * Math.PI * 2; p.spin = (Math.random() - 0.5) * 0.6;
      p.o.material.map = puffTex[(Math.random() * 3) | 0];
      p.o.material.opacity = 0;
      p.o.scale.set(p.size * 0.4, p.size * 0.4, 1);
      steamLive.push(p);
    }
  };
  FX.emitter = function (posFn, o) {
    o = o || {};
    var em = { rate: o.rate != null ? +o.rate : 4, acc: 0, fn: posFn, o: o, dead: false };
    em.stop = function () { em.dead = true; var i = emitters.indexOf(em); if (i >= 0) emitters.splice(i, 1); };
    emitters.push(em);
    return em;
  };

  function getBurst(kind) {
    var poolKey = kind === 'crumb' ? 'crumb' : kind === 'drop' ? 'drop' : 'sprite';
    var p = burstPool[poolKey].pop();
    if (!p) {
      var obj;
      if (poolKey === 'sprite') {
        obj = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false }));
        obj.renderOrder = 31;
      } else if (poolKey === 'crumb') {
        obj = new THREE.Mesh(crumbGeos[(Math.random() * crumbGeos.length) | 0], new THREE.MeshStandardMaterial({ color: 0xc8893e, roughness: 0.75, metalness: 0, side: THREE.DoubleSide, transparent: true }));
        obj.castShadow = false;
      } else {
        obj = new THREE.Mesh(dropGeo, new THREE.MeshStandardMaterial({ color: 0xe6f2ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.75, envMapIntensity: 1.5 }));
      }
      obj.raycast = function () {};
      p = { o: obj, poolKey: poolKey, vel: new THREE.Vector3(), rv: new THREE.Vector3() };
    }
    if (!p.o.parent) C.scene.add(p.o);
    p.o.visible = true;
    return p;
  }
  FX.burst = function (pos, kind, o) {
    if (!C.scene) return;
    fxBuild();
    o = o || {};
    kind = kind || 'spark';
    var base = toV3(pos, new THREE.Vector3());
    var defs = { flour: [10, 0.5, 0.9], crumb: [10, 1.2, 1.4], drop: [8, 1.4, 1.0], spark: [10, 0.9, 0.8] };
    var df = defs[kind] || defs.spark;
    var count = Math.max(1, Math.round((o.count || df[0]) * (C.low ? 0.5 : 1)));
    var speed = o.speed != null ? +o.speed : df[1], life = o.life != null ? +o.life : df[2];
    var dir = o.dir ? toV3(o.dir, new THREE.Vector3()).normalize() : null;
    for (var i = 0; i < count; i++) {
      while (burstLive.length >= capB()) rel(burstLive[0], burstLive, burstPool[burstLive[0].poolKey]);
      var p = getBurst(kind);
      p.kind = kind; p.t = 0; p.life = life * (0.7 + Math.random() * 0.6);
      p.floor = o.floor != null ? +o.floor : -Infinity; p.landed = false;
      var th = Math.random() * Math.PI * 2, el = Math.random();
      var v = p.vel.set(Math.cos(th) * Math.sqrt(1 - el * el), el, Math.sin(th) * Math.sqrt(1 - el * el));
      if (dir) v.multiplyScalar(0.45).add(dir).normalize();
      v.multiplyScalar(speed * (0.4 + Math.random() * 0.6));
      p.o.position.copy(base).add(tmpC.set((Math.random() - 0.5) * 0.06, Math.random() * 0.03, (Math.random() - 0.5) * 0.06));
      var sz = o.size != null ? +o.size : 1;
      if (kind === 'flour') {
        p.o.material.map = puffTex[(Math.random() * 3) | 0]; p.o.material.blending = THREE.NormalBlending;
        p.o.material.color.set(0xfbf8f2); p.size = 0.14 * sz * (0.7 + Math.random() * 0.6); p.op = 0.55; p.g = -0.15; p.drag = 3.5;
        p.vel.multiplyScalar(0.8); p.vel.y = Math.abs(p.vel.y) * 0.5 + 0.1;
      } else if (kind === 'spark') {
        p.o.material.map = glowTex; p.o.material.blending = THREE.AdditiveBlending;
        p.o.material.color.setHSL(0.11 + Math.random() * 0.04, 0.9, 0.75); p.size = 0.07 * sz * (0.6 + Math.random() * 0.8); p.op = 1; p.g = 0.4; p.drag = 2.2;
      } else if (kind === 'crumb') {
        var sc = 0.035 * sz * (0.6 + Math.random() * 0.8); p.o.scale.set(sc, sc, sc); p.g = 6; p.drag = 0.6; p.op = 1;
        p.o.material.color.setHSL(0.085 + Math.random() * 0.02, 0.62, 0.42 + Math.random() * 0.15);
        p.o.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        p.rv.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
        p.vel.y = Math.abs(p.vel.y) + speed * 0.3;
      } else { // drop
        var ds = 0.022 * sz * (0.6 + Math.random() * 0.7); p.ds = ds; p.o.scale.set(ds, ds, ds); p.g = 7; p.drag = 0.3; p.op = 0.75;
        p.vel.y = Math.abs(p.vel.y) + speed * 0.4;
      }
      p.o.material.opacity = p.op;
      burstLive.push(p);
    }
  };

  postSys.push(function fxUpdate(dt) {
    if (!fxBuilt && !emitters.length) return;
    var i, p;
    for (i = emitters.length - 1; i >= 0; i--) {
      var em = emitters[i];
      if (em.dead) continue;
      em.acc += Math.max(0, em.rate) * dt * (C.low ? 0.5 : 1);
      while (em.acc >= 1) {
        em.acc -= 1;
        var pp = isFn(em.fn) ? em.fn() : em.fn;
        if (pp) {
          var oo = {}; for (var k in em.o) oo[k] = em.o[k];
          oo.count = 1; oo._one = true; // low の半減は rate 側で済ませる
          FX.steam(pp, oo);
        }
      }
    }
    for (i = steamLive.length - 1; i >= 0; i--) {
      p = steamLive[i];
      p.t += dt;
      if (p.t < 0) { p.o.material.opacity = 0; continue; }
      var k2 = p.t / p.life;
      if (k2 >= 1) { rel(p, steamLive, steamPool); continue; }
      p.o.position.addScaledVector(p.vel, dt);
      p.vel.x *= 1 - dt * 0.6; p.vel.z *= 1 - dt * 0.6;
      p.vel.x += (U.noise2(p.o.position.y * 2, p.life * 10, 3) - 0.5) * dt * 0.4;
      var s = p.size * U.lerp(0.4, 1.7, E.outQuad(k2));
      p.o.scale.set(s, s, 1);
      p.o.material.rotation += p.spin * dt;
      p.o.material.opacity = p.op * U.smooth(0, 0.15, k2) * Math.pow(1 - k2, 1.4);
    }
    for (i = burstLive.length - 1; i >= 0; i--) {
      p = burstLive[i];
      p.t += dt;
      var kb = p.t / p.life;
      if (kb >= 1) { rel(p, burstLive, burstPool[p.poolKey]); continue; }
      if (!p.landed) {
        p.vel.y -= p.g * dt;
        p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
        p.o.position.addScaledVector(p.vel, dt);
        if (p.o.position.y < p.floor) {
          p.o.position.y = p.floor + 0.003;
          if (p.kind === 'crumb') { p.landed = true; p.o.rotation.x = -Math.PI / 2 + (Math.random() - 0.5) * 0.3; }
          else p.vel.y = Math.abs(p.vel.y) * 0.25;
        }
      }
      if (p.kind === 'crumb') {
        if (!p.landed) { p.o.rotation.x += p.rv.x * dt; p.o.rotation.y += p.rv.y * dt; p.o.rotation.z += p.rv.z * dt; }
        p.o.material.opacity = p.op * (1 - U.smooth(0.7, 1, kb));
      } else if (p.kind === 'drop') {
        var stretch = 1 + Math.min(1.5, p.vel.length() * 0.25);
        p.o.scale.set(p.ds, p.ds * stretch, p.ds);
        p.o.material.opacity = p.op * (1 - U.smooth(0.6, 1, kb));
      } else {
        var sz2 = p.kind === 'flour' ? p.size * U.lerp(0.6, 2.2, E.outQuad(kb)) : p.size * (1 - kb * 0.5);
        p.o.scale.set(sz2, sz2, 1);
        p.o.material.opacity = p.op * (p.kind === 'flour' ? U.smooth(0, 0.1, kb) * Math.pow(1 - kb, 1.5) : Math.pow(1 - kb, 1.2) * (0.75 + 0.25 * Math.sin(p.t * 40)));
      }
    }
  });

  /* ======================================================================
   * G.state
   * ==================================================================== */
  var KEY = 'gyoza-261114-1', STATIONS = ['wrap', 'fry', 'eat', 'end'];
  var ST = (G.state = { key: KEY });
  function defaults() {
    var g = [];
    for (var i = 0; i < 6; i++) g.push({ pleats: [0, 0, 0, 0, 0, 0, 0].map(function () { return i < 3 ? 1 : 0; }), fill: 1 });
    return { v: 1, station: 'wrap', made: 0, gyoza: g };
  }
  function validate(d) {
    var out = defaults();
    if (!d || typeof d !== 'object' || Array.isArray(d)) return out;
    for (var k in d) {
      if (!Object.prototype.hasOwnProperty.call(d, k) || k === 'v' || k === 'station' || k === 'made' || k === 'gyoza') continue;
      var v = d[k];
      if (v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'object') out[k] = v;
    }
    if (STATIONS.indexOf(d.station) >= 0) out.station = d.station;
    var m = Math.round(+d.made);
    if (isFinite(m)) out.made = U.clamp(m, 0, 3);
    if (Array.isArray(d.gyoza)) {
      for (var i = 3; i < 6; i++) {
        var g = d.gyoza[i];
        if (!g || typeof g !== 'object') continue;
        if (Array.isArray(g.pleats)) for (var j = 0; j < 7; j++) out.gyoza[i].pleats[j] = +g.pleats[j] >= 0.5 ? 1 : 0;
        out.gyoza[i].fill = +g.fill === 2 ? 2 : 1;
      }
    }
    return out;
  }
  ST.data = defaults();
  ST.defaults = defaults;
  ST.load = function () {
    var raw = null;
    try { raw = window.localStorage.getItem(KEY); } catch (_) { raw = null; }
    var parsed = null;
    if (raw) { try { parsed = JSON.parse(raw); } catch (_) { parsed = null; } }
    ST.data = validate(parsed);
    return ST.data;
  };
  ST.save = function () {
    try { ST.data = validate(ST.data); window.localStorage.setItem(KEY, JSON.stringify(ST.data)); return true; } catch (_) { return false; }
  };
  ST.reset = function () { ST.data = defaults(); ST.save(); return ST.data; };

  /* ======================================================================
   * G.flow
   * ==================================================================== */
  var FL = (G.flow = { current: null, stations: {}, scope: null, busy: false });
  FL.register = function (name, st) { if (name && st) FL.stations[name] = st; };
  FL.go = function (name) {
    var st = FL.stations[name];
    if (!st) { logErr('flow.go', new Error('unknown station: ' + name)); return Promise.resolve(false); }
    var prev = FL.current && FL.stations[FL.current];
    if (prev && isFn(prev.exit)) { try { prev.exit(); } catch (e) { logErr('flow.exit ' + FL.current, e); } }
    if (FL.scope) FL.scope.kill();
    try { G.hint.clear(); } catch (_) {}
    G.input.clear();
    FL.current = name;
    ST.data.station = name;
    ST.save();
    var sc = TW.scope();
    FL.scope = sc;
    if (isFn(st.enter)) {
      try {
        var r = st.enter(sc);
        if (r && isFn(r.then)) r.then(null, function (e) { logErr('flow.enter ' + name, e); });
      } catch (e) { logErr('flow.enter ' + name, e); }
    }
    return Promise.resolve(true);
  };
  FL.restart = function () {
    if (FL.busy) return Promise.resolve(false);
    FL.busy = true;
    return C.fade(1, 0.7).then(function () {
      var prev = FL.current && FL.stations[FL.current];
      if (prev && isFn(prev.exit)) { try { prev.exit(); } catch (e) { logErr('flow.exit', e); } }
      if (FL.scope) { FL.scope.kill(); FL.scope = null; }
      FL.current = null;
      try { AU.stopAll(); } catch (_) {}
      try { HI.clear(); } catch (_) {}
      ST.reset();
      for (var k in FL.stations) {
        var s = FL.stations[k];
        if (isFn(s.reset)) { try { s.reset(); } catch (e) { logErr('flow.reset ' + k, e); } }
      }
      return FL.go('wrap');
    }).then(function () {
      return C.fade(0, 0.9);
    }).then(function () { FL.busy = false; return true; }, function (e) { FL.busy = false; logErr('flow.restart', e); return false; });
  };
  postSys.unshift(function flowUpdate(dt) {
    var st = FL.current && FL.stations[FL.current];
    if (st && isFn(st.update)) st.update(dt);
  });
})();

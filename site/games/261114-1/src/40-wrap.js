/* 40-wrap.js — 場面「つつむ」: あんをのせる → ふちに水 → たたむ → ひだ → バットへ「ぴょん、こてん」。3個で fry へ。 */
(function () {
  'use strict';
  var G = window.G;
  var U = G.util, E = G.ease;
  var V3 = function (x, y, z) { return new THREE.Vector3(x, y, z); };
  var PI = Math.PI;

  /* 配置（アンカー wrap = 原点） */
  var BOARD_TOP = 0.15;
  var SKIN = V3(0, BOARD_TOP, 0.3);         // ひらいた皮の中心（底）
  var SKIN_R = 0.45;
  var BOWL = V3(-1.0, 0, 1.6), DISH = V3(1.05, 0, 1.6);
  var STACK = V3(-0.9, BOARD_TOP, 0.2);
  var TRAY = V3(0, 0, -1.25);
  var VIEW = { center: [0, 0, 0.1], w: 3.4, d: 3.8 };
  var NEAR = { center: [0, 0.15, 0.2], w: 1.7, d: 1.5 };
  var HALF_W = 0.185;                        // 立ったぎょうざの半分の幅（こてんの支点）

  var S = {
    built: false, step: null, cur: -1, made: 0,
    drag: null, wetFinger: false, wetPrevA: null, dripT: 0,
    spoonBusy: false, spoonTgt: V3(0, 0, 0), spoonHome: V3(0, 0, 0),
    foldStart: 0, foldZ0: 0, pleatBusy: {}, lastTouch: 0, flapT: 0,
    jig: [], props: {}, sc: null
  };

  /* ───────── 小さな道具 ───────── */
  function snd(name, o) { try { G.audio.sfx(name, o); } catch (e) { /* 音は無くても進む */ } }
  function now() { return G.core.time || 0; }
  function gy(i) { return G.shared && G.shared.gyozas[i]; }

  function glowTexture() {
    var s = 64, c = U.canvas(s, s), x = c.getContext('2d');
    var gr = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, s, s);
    return U.canvasTex(c, { srgb: true });
  }
  function glowSprite(tex, color, size) {
    var m = new THREE.SpriteMaterial({ map: tex, color: color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    var sp = new THREE.Sprite(m);
    sp.scale.set(size, size, 1); sp.renderOrder = 12; sp.visible = false;
    sp.raycast = function () {};
    return sp;
  }

  /* ぷるん: scale を一時的に揺らす（底が原点の物向き）。同じ物は上書き */
  function jiggle(obj, amp, freq, decay) {
    if (!obj) return;
    for (var i = 0; i < S.jig.length; i++) if (S.jig[i].o === obj) { S.jig.splice(i, 1); break; }
    S.jig.push({ o: obj, t: 0, a: amp, f: freq || 7, d: decay || 6 });
  }
  function updateJiggles(dt) {
    for (var i = S.jig.length - 1; i >= 0; i--) {
      var j = S.jig[i];
      j.t += dt;
      var s = j.a * Math.exp(-j.d * j.t) * Math.sin(j.t * j.f * PI * 2);
      if (j.t > 2.5 || (j.t > 0.2 && Math.abs(j.a * Math.exp(-j.d * j.t)) < 0.002)) { j.o.scale.set(1, 1, 1); S.jig.splice(i, 1); continue; }
      j.o.scale.set(1 + s * 0.5, 1 - s, 1 + s * 0.5);
    }
  }
  function clearJiggles() { S.jig.forEach(function (j) { j.o.scale.set(1, 1, 1); }); S.jig.length = 0; }

  /* こてん: 底の端を支点に横（世界の X 方向）へ傾ける。th>0 で -X 側（ママ側）へ */
  function applyLean(g, th, base) {
    var o = g.group;
    o.rotation.order = 'ZYX';
    o.rotation.z = th;
    var s = th >= 0 ? 1 : -1;
    o.position.set(base.x - s * HALF_W * (1 - Math.cos(th)), base.y + HALF_W * Math.abs(Math.sin(th)), base.z);
  }

  function slotWorld(k) {
    var t = G.shared.tray, sl = t.userData.slots[k];
    return V3(TRAY.x + sl.x, TRAY.y + sl.y, TRAY.z + sl.z);
  }
  function arcPoint(a, y) { return V3(SKIN.x - Math.cos(a) * SKIN_R, y == null ? BOARD_TOP + 0.015 : y, SKIN.z - Math.sin(a) * SKIN_R); }
  function flapPoint() { return V3(SKIN.x, BOARD_TOP + 0.02, SKIN.z + SKIN_R - 0.03); }
  function slotPos(g, i) { g.group.updateMatrixWorld(true); return g.group.localToWorld(g.pleatLocal(i)); }
  function seamPos(g) { return slotPos(g, 3); }

  /* ───────── build ───────── */
  function build() {
    if (S.built) return;
    S.built = true;
    var scene = G.core.scene, P = G.props, pr = S.props;
    pr.root = new THREE.Group(); pr.root.name = 'wrapStation';
    scene.add(pr.root);
    pr.board = P.board(); pr.board.position.set(0, 0, 0.22); pr.root.add(pr.board);
    pr.bowl = P.bowl(); pr.bowl.position.copy(BOWL); pr.root.add(pr.bowl);
    pr.spoon = P.spoon(); pr.root.add(pr.spoon);
    // 回避: props.spoon の setLoad は山の scale を半径1基準で上書きしてしまい、山が巨大になる。
    // あんの山は fillingMound(r,h) が scale で大きさを持つので、その基準に掛けて設定し直す。
    (function (ud) {
      var lm = ud.loadMesh;
      if (!lm) return;
      var bx = 0.095, by = 0.075, bz = 0.095 * 1.3;
      ud.setLoad = function (v) {
        v = U.clamp01(v); ud.load = v;
        lm.visible = v > 0.01;
        lm.scale.set(bx * (0.55 + 0.45 * v), by * Math.max(0.01, v), bz * (0.55 + 0.45 * v));
      };
    })(pr.spoon.userData);
    pr.dish = P.waterDish(); pr.dish.position.copy(DISH); pr.dish.rotation.y = 0.4; pr.root.add(pr.dish);
    pr.stack = P.wrapperStack(8); pr.stack.position.copy(STACK); pr.root.add(pr.stack);
    // スプーンの定位置: あんにささり、柄は手前右へ上がってボウルのふちにかかる
    S.spoonHome.set(BOWL.x - 0.08, 0.31, BOWL.z - 0.2);
    pr.spoonRot = { x: -0.16, y: 0.55, z: 0 };
    resetSpoon();

    var tex = glowTexture();
    pr.glint = glowSprite(tex, 0xcfe8ff, 0.09); scene.add(pr.glint);
    pr.slotGlows = [];
    for (var i = 0; i < 7; i++) { var sg = glowSprite(tex, 0xffe2b0, 0.07); scene.add(sg); pr.slotGlows.push(sg); }
    // ふちの光の道筋（奥半分の弧）
    var tg = new THREE.TorusGeometry(SKIN_R - 0.01, 0.012, 6, 64, PI);
    tg.rotateX(-PI / 2);
    pr.arcMat = new THREE.MeshBasicMaterial({ color: 0xfff0cc, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    pr.arc = new THREE.Mesh(tg, pr.arcMat);
    pr.arc.position.set(SKIN.x, BOARD_TOP + 0.016, SKIN.z); pr.arc.renderOrder = 11; pr.arc.visible = false;
    pr.arc.raycast = function () {};
    scene.add(pr.arc);
  }

  function resetSpoon() {
    var sp = S.props.spoon, r = S.props.spoonRot;
    G.tw.killOf(sp.position); G.tw.killOf(sp.rotation);
    sp.position.copy(S.spoonHome);
    sp.rotation.set(r.x, r.y, r.z);
    sp.userData.setLoad(1);
    S.spoonBusy = false;
  }

  /* ───────── enter ───────── */
  function enter(sc) {
    build();
    S.sc = sc;
    var Sh = G.shared, d = G.state.data;
    G.kit.detachAll();
    G.kit.applyState();
    S.made = Math.max(0, Math.min(3, d.made | 0));
    S.cur = 3 + S.made;
    S.drag = null; S.wetFinger = false; S.wetPrevA = null; S.pleatBusy = {};
    clearJiggles();

    var tray = Sh.tray;
    tray.position.copy(TRAY); tray.rotation.set(0, 0, 0); tray.scale.set(1, 1, 1); tray.visible = true;
    if (tray.userData.contact) tray.userData.contact.visible = true;

    for (var i = 0; i < 6; i++) {
      var g = gy(i); if (!g) continue;
      g.setCook(0).setBrown(0).setSauce(0).setBite(0);
      g.group.rotation.order = 'XYZ';
      g.group.rotation.set(0, 0, 0); g.group.scale.set(1, 1, 1);
      if (i < S.cur) {
        g.setShape({ fold: 1, stand: 1 });
        g.group.position.copy(slotWorld(i));
        g.group.rotation.y = PI / 2;
        g.group.visible = true;
      } else if (i === S.cur) {
        prepareSkin(g);
        g.group.position.copy(SKIN);
        g.group.visible = true;
      } else {
        g.group.visible = false;
      }
    }
    S.props.root.visible = true;
    S.props.stack.userData.setCount(Math.max(0, 2 - S.made));
    resetSpoon();

    try { G.world.setMood('day', 0); } catch (e) { /* noop */ }
    try { G.world.setFocus(V3(0, 0, 0.1), 2.8); } catch (e) { /* noop */ }
    try { G.world.stove.setFlame(0); } catch (e) { /* noop */ }
    ['sizzle', 'bubble', 'crackle', 'flame', 'steam'].forEach(function (n) { try { G.audio.loop(n, 0); } catch (e) { /* noop */ } });
    try { G.audio.muffle(0); } catch (e) { /* noop */ }
    G.cam.frame(VIEW, 0);

    G.input.set({ down: onDown, move: onMove, up: onUp, cancel: function (p) { onUp(p, true); } });

    if (S.made >= 3) { S.step = 'busy'; finale(sc); }
    else startFill();
  }

  function prepareSkin(g) {
    for (var j = 0; j < 7; j++) g.setPleat(j, 0);
    g.setFilling(0).clearWet().setShape({ fold: 0, stand: 0 });
    g.setCook(0).setBrown(0).setSauce(0).setBite(0);
    g.group.rotation.order = 'XYZ';
    g.group.rotation.set(0, 0, 0); g.group.scale.set(1, 1, 1);
  }

  /* ───────── ステップとヒント ───────── */
  function startFill() {
    S.step = 'fill';
    var sp = S.props.spoon;
    G.hint.set({
      target: sp, radius: 0.36, wobble: sp, ringY: 0.33,
      demo: { type: 'drag', path: function () { return [sp.getWorldPosition(V3(0, 0, 0)).add(V3(0, 0.08, 0)), V3(SKIN.x - 0.3, 0.45, SKIN.z + 0.4), V3(SKIN.x, 0.25, SKIN.z)]; } }
    });
  }
  function wetDemoPath() {
    var pts = [V3(DISH.x, 0.09, DISH.z), arcPoint(0)];
    for (var k = 1; k <= 8; k++) pts.push(arcPoint(k / 8 * PI));
    return pts;
  }
  function startWet() {
    S.step = 'wet';
    S.wetFinger = false; S.wetPrevA = null;
    G.hint.set({ target: V3(DISH.x, 0.09, DISH.z), radius: 0.42, wobble: S.props.dish, ringY: 0.1, demo: { type: 'drag', path: wetDemoPath } });
  }
  function hintArc() {
    G.hint.set({ target: V3(SKIN.x, BOARD_TOP + 0.02, SKIN.z - 0.2), radius: 0.52, ringY: BOARD_TOP + 0.005, demo: { type: 'drag', path: wetDemoPath } });
  }
  function startFold() {
    S.step = 'fold';
    S.flapT = 0;
    G.hint.set({
      target: flapPoint(), radius: 0.3, ringY: BOARD_TOP + 0.005,
      demo: { type: 'drag', path: [flapPoint(), V3(SKIN.x, 0.2, SKIN.z), V3(SKIN.x, 0.2, SKIN.z - 0.4)] }
    });
  }
  function startPleat(sc) {
    S.step = 'pleatWait';
    var g = gy(S.cur);
    S.lastTouch = now();
    sc.guard(G.cam.frame(NEAR, 0.9)).then(function () {
      if (S.step !== 'pleatWait') return;
      S.step = 'pleat';
      S.lastTouch = now();
      G.hint.set({
        target: function () { var v = seamPos(g); v.z = U.lerp(v.z, SKIN.z, 0.45); return v; }, radius: 0.5, ringY: BOARD_TOP + 0.005,
        demo: { type: 'drag', path: function () { var a = []; for (var i = 0; i < 7; i++) a.push(slotPos(g, i)); return a; } }
      });
    });
  }

  /* ───────── 入力 ───────── */
  function near(p, v, px) { return G.input.screenDist(p, v) <= px; }

  function onDown(p) {
    S.lastTouch = now();
    var g = gy(S.cur), st = S.step;
    // 1) その時の主役
    if (st === 'fold' && g && (near(p, flapPoint(), 80) || inFrontHalf(p))) {
      S.drag = 'flap'; S.flapAnim = false; G.tw.killOf(S._foldO);
      var h = G.input.planeHit(p, BOARD_TOP);
      S.foldZ0 = h ? h.z : SKIN.z + SKIN_R; S.foldStart = Math.max(0.06, g.fold);
      snd('squish', { vol: 0.35, pitch: 1.3 });
      setFold(g, S.foldStart + 0.04);
      return;
    }
    if (st === 'pleat' && g && near(p, seamPos(g), 150)) {
      S.drag = 'pleat';
      if (!tryPleat(p, 80)) { snd('tap', { vol: 0.25, pitch: 0.8 }); jiggle(g.group, 0.03, 8, 8); }
      return;
    }
    if (st === 'wet' && g) {
      if (near(p, V3(DISH.x, 0.09, DISH.z), 75)) { touchDish(p, true); S.drag = 'trace'; return; }
      if (nearArc(p, 60) >= 0) {
        S.drag = 'trace';
        if (S.wetFinger) { S.wetPrevA = null; trace(p); }
        else dryTouch();
        return;
      }
    }
    // スプーン（皮がひらいている間は何度でも）
    if ((st === 'fill' || st === 'wet') && !S.spoonBusy && spoonNear(p, st === 'fill' ? 80 : 55)) { grabSpoon(p); return; }
    // 2) 小さな発見
    discover(p);
  }

  function onMove(p) {
    S.lastTouch = now();
    var g = gy(S.cur);
    if (S.drag === 'spoon') {
      var h = G.input.planeHit(p, 0.45);
      if (h) S.spoonTgt.set(h.x, 0.45, h.z - 0.25);
    } else if (S.drag === 'trace') {
      if (S.step === 'wet') {
        if (!S.wetFinger && near(p, V3(DISH.x, 0.09, DISH.z), 75)) touchDish(p, false);
        if (S.wetFinger) trace(p);
      }
    } else if (S.drag === 'flap' && g && S.step === 'fold') {
      var h2 = G.input.planeHit(p, BOARD_TOP);
      if (h2) setFold(g, U.clamp(S.foldStart + (S.foldZ0 - h2.z) / (2 * SKIN_R), 0.04, 1));
    } else if (S.drag === 'pleat' && S.step === 'pleat') {
      tryPleat(p, 60);
    }
  }

  function onUp(p, cancelled) {
    S.lastTouch = now();
    var d = S.drag, g = gy(S.cur);
    S.drag = null;
    S.props.glint.visible = false;
    if (d === 'spoon') releaseSpoon(cancelled);
    else if (d === 'flap' && g && S.step === 'fold') releaseFlap(g);
    else if (d === 'trace') S.wetPrevA = null;
  }

  function inFrontHalf(p) {
    var h = G.input.planeHit(p, BOARD_TOP);
    if (!h) return false;
    var dx = h.x - SKIN.x, dz = h.z - SKIN.z;
    return dz > 0.05 && Math.sqrt(dx * dx + dz * dz) < SKIN_R + 0.18;
  }

  /* ───────── 1. あん ───────── */
  function spoonNear(p, px) {
    var sp = S.props.spoon;
    sp.updateMatrixWorld(true);
    var a = sp.localToWorld(V3(0, 0.05, 0)), b = sp.localToWorld(sp.userData.grip.clone()), c = sp.localToWorld(V3(0, 0.1, 0.45));
    return near(p, a, px) || near(p, b, px) || near(p, c, px);
  }
  function grabSpoon(p) {
    var sp = S.props.spoon;
    G.tw.killOf(sp.position); G.tw.killOf(sp.rotation);
    S.drag = 'spoon';
    snd('clink', { vol: 0.45, pitch: 1.2 });
    var h = G.input.planeHit(p, 0.45);
    S.spoonTgt.copy(sp.position); S.spoonTgt.y += 0.12;
    if (h) S.spoonTgt.set(U.lerp(sp.position.x, h.x, 0.5), 0.45, U.lerp(sp.position.z, h.z - 0.25, 0.5));
    sp.position.y += 0.06; // その場でちょっと持ち上がる
    // 持っている間は、行き先（皮）を光らせる
    if (S.step === 'fill') G.hint.set({ target: V3(SKIN.x, BOARD_TOP + 0.02, SKIN.z), radius: 0.5, ringY: BOARD_TOP + 0.005 });
    G.tw.to(sp.rotation, { x: 0.05, y: 0.25, z: 0 }, 0.2, { ease: 'outQuad' });
  }
  function releaseSpoon(cancelled) {
    var sp = S.props.spoon, g = gy(S.cur);
    var dx = S.spoonTgt.x - SKIN.x, dz = S.spoonTgt.z - SKIN.z, dist = Math.sqrt(dx * dx + dz * dz);
    var canPlop = !cancelled && g && (S.step === 'fill' || S.step === 'wet') && g.fold < 0.2 && dist < 0.8;
    if (!canPlop) { if (S.step === 'fill') startFill(); spoonHome(0.32); return; }
    if (g.filling >= 1.95) bounceSpoon(); else plop();
  }
  function spoonHome(sec, after) {
    var sp = S.props.spoon, r = S.props.spoonRot, sc = S.sc;
    S.spoonBusy = true;
    var from = sp.position.clone(), to = S.spoonHome, o = { k: 0 };
    G.tw.to(sp.rotation, { x: r.x, y: r.y, z: r.z }, sec, { ease: 'inOutQuad' });
    return sc.to(o, { k: 1 }, sec, {
      ease: 'linear', onUpdate: function () {
        var e = E.inOutQuad(o.k);
        sp.position.lerpVectors(from, to, e); sp.position.y += Math.sin(o.k * PI) * 0.15;
      }
    }).then(function () {
      snd('clink', { vol: 0.3, pitch: 0.9 });
      if (after) return after();
    }).then(function () { S.spoonBusy = false; });
  }
  function plop() {
    var sp = S.props.spoon, g = gy(S.cur), sc = S.sc, idx = S.cur;
    S.spoonBusy = true;
    var over = V3(SKIN.x - 0.02, BOARD_TOP + 0.24, SKIN.z + 0.02);
    sc.to(sp.position, { x: over.x, y: over.y, z: over.z }, 0.14, { ease: 'outQuad' }).then(function () {
      return sc.to(sp.rotation, { z: 1.5 }, 0.12, { ease: 'inQuad' });
    }).then(function () {
      if (S.cur !== idx) return;
      sp.userData.setLoad(0);
      snd('plop', { vol: 0.9 });
      var f0 = g.filling, o = { v: f0 };
      sc.to(o, { v: f0 + 1 }, 0.35, { ease: 'outBack', onUpdate: function () { g.setFilling(Math.max(0, o.v)); } })
        .then(function () { g.setFilling(f0 + 1); });
      // 皮が少し沈んで戻る
      jiggle(g.group, 0.12, 6, 7);
      G.fx.burst(V3(SKIN.x, BOARD_TOP + 0.05, SKIN.z), 'flour', { count: 4, size: 1.2 });
      if (S.step === 'fill') { G.hint.clear(); startWet(); }
      return sc.to(sp.rotation, { z: 0 }, 0.15);
    }).then(function () {
      return spoonHome(0.4, function () { return rescoop(); });
    });
  }
  function rescoop() {
    var sp = S.props.spoon, o = { v: 0 }, sc = S.sc;
    snd('squish', { vol: 0.35, pitch: 0.8 });
    return sc.to(sp.position, { y: S.spoonHome.y - 0.04 }, 0.12).then(function () {
      return Promise.all([
        sc.to(o, { v: 1 }, 0.3, { ease: 'outQuad', onUpdate: function () { sp.userData.setLoad(o.v); } }),
        sc.to(sp.position, { y: S.spoonHome.y }, 0.3, { ease: 'outQuad' })
      ]);
    });
  }
  function bounceSpoon() {
    // 3杯目は「ぽん」と跳ね返される
    var sp = S.props.spoon, g = gy(S.cur), sc = S.sc;
    S.spoonBusy = true;
    sc.to(sp.position, { x: SKIN.x, y: BOARD_TOP + 0.22, z: SKIN.z + 0.05 }, 0.12, { ease: 'outQuad' }).then(function () {
      snd('pop', { vol: 0.8, pitch: 0.9 });
      jiggle(g.group, 0.12, 7, 6);
      return sc.to(sp.position, { y: BOARD_TOP + 0.55 }, 0.16, { ease: 'outQuad' });
    }).then(function () { return spoonHome(0.4); });
  }

  /* ───────── 2. 水 ───────── */
  function touchDish(p, isDown) {
    var dish = S.props.dish, h = G.input.planeHit(p, 0.086);
    var lx = 0, lz = 0;
    if (h) { var l = dish.worldToLocal(h.clone()); lx = U.clamp(l.x, -0.3, 0.3); lz = U.clamp(l.z, -0.3, 0.3); }
    try { dish.userData.ripple(lx, lz); } catch (e) { /* noop */ }
    snd('splash', { vol: isDown ? 0.55 : 0.4 });
    G.fx.burst(h || V3(DISH.x, 0.1, DISH.z), 'drop', { count: 4, speed: 0.7, floor: 0.09 });
    if (S.step === 'wet' && !S.wetFinger) {
      S.wetFinger = true;
      G.hint.clear(); hintArc();
    }
  }
  function dryTouch() {
    snd('tap', { vol: 0.25, pitch: 0.7 });
    G.fx.burst(V3(DISH.x, 0.14, DISH.z), 'spark', { count: 7, size: 2, speed: 0.6 });
    jiggle(S.props.dish, 0.05, 6, 6);
    G.hint.poke();
  }
  var _arcPts = null;
  function nearArc(p, px) {
    if (!_arcPts) { _arcPts = []; for (var k = 0; k <= 32; k++) _arcPts.push(arcPoint(k / 32 * PI)); }
    var best = -1, bd = px;
    for (var i = 0; i <= 32; i++) { var dd = G.input.screenDist(p, _arcPts[i]); if (dd < bd) { bd = dd; best = i; } }
    return best;
  }
  function trace(p) {
    var g = gy(S.cur);
    if (!g || S.step !== 'wet') return;
    var j = nearArc(p, 58);
    var h = G.input.planeHit(p, BOARD_TOP + 0.03);
    var gl = S.props.glint;
    if (h) { gl.position.copy(h); gl.position.y = BOARD_TOP + 0.05; gl.visible = true; }
    if (j < 0) { S.wetPrevA = null; return; }
    var a = j / 32 * PI, before = g.wetCoverage;
    if (S.wetPrevA != null && Math.abs(a - S.wetPrevA) < 1.0) g.setWet(Math.min(a, S.wetPrevA) - 0.04, Math.max(a, S.wetPrevA) + 0.04);
    else g.setWet(a - 0.07, a + 0.07);
    S.wetPrevA = a;
    if (g.wetCoverage > before && now() - S.dripT > 0.14) { S.dripT = now(); snd('drip', { vol: 0.28, pitch: 0.9 + Math.random() * 0.3 }); }
    if (g.wetCoverage >= 0.7) wetDone(g);
  }
  function wetDone(g) {
    S.step = 'busy';
    G.hint.clear();
    g.setWet(0, PI);
    snd('sparkle', { vol: 0.7 });
    var pts = [0.15, 0.5, 0.85];
    pts.forEach(function (k) { G.fx.burst(arcPoint(k * PI, BOARD_TOP + 0.04), 'spark', { count: 3, size: 1.4, speed: 0.4 }); });
    S.sc.wait(0.45).then(function () { startFold(); });
  }

  /* ───────── 3. たたむ ───────── */
  function setFold(g, f) { g.setShape({ fold: f }); }
  function releaseFlap(g) {
    var f = g.fold, sc = S.sc, o = (S._foldO = { v: f });
    if (f >= 0.6) {
      S.step = 'busy';
      G.hint.clear();
      sc.to(o, { v: 1 }, 0.16 * (1 - f) / 0.4 + 0.06, { ease: 'inQuad', onUpdate: function () { setFold(g, o.v); } }).then(function () {
        setFold(g, 1);
        snd('fold', { vol: 0.9 });
        jiggle(g.group, 0.1, 6, 7);
        G.fx.burst(V3(SKIN.x - 0.35, BOARD_TOP + 0.02, SKIN.z - 0.1), 'flour', { count: 4, size: 1.2 });
        G.fx.burst(V3(SKIN.x + 0.35, BOARD_TOP + 0.02, SKIN.z - 0.1), 'flour', { count: 4, size: 1.2 });
        return sc.wait(0.35);
      }).then(function () { startPleat(sc); });
    } else {
      snd('fold', { vol: 0.25, pitch: 1.4 });
      S.flapAnim = true; S.flapT = 0;
      sc.to(o, { v: 0.05 }, 0.45, { ease: 'outBack', onUpdate: function () { setFold(g, Math.max(0, o.v)); } })
        .then(function () { S.flapAnim = false; });
    }
  }

  /* ───────── 4. ひだ ───────── */
  function tryPleat(p, px) {
    var g = gy(S.cur);
    if (!g || S.step !== 'pleat') return false;
    var best = -1, bd = px;
    for (var i = 0; i < 7; i++) {
      if (g.pleats[i] > 0 || S.pleatBusy[i]) continue;
      var dd = G.input.screenDist(p, slotPos(g, i));
      if (dd < bd) { bd = dd; best = i; }
    }
    if (best < 0) return false;
    addPleat(g, best);
    return true;
  }
  function addPleat(g, i) {
    S.pleatBusy[i] = true;
    var o = { v: 0 };
    snd('pinch', { vol: 0.8, pitch: 0.82 + i * 0.07 });
    jiggle(g.group, 0.06, 9, 8);
    S.sc.to(o, { v: 1 }, 0.15, { ease: 'outBack', onUpdate: function () { g.setPleat(i, Math.max(0.02, Math.min(1, o.v))); } })
      .then(function () { g.setPleat(i, 1); S.pleatBusy[i] = false; });
  }
  function pleatCount(g) { var n = 0; for (var i = 0; i < 7; i++) if (g.pleats[i] > 0 || S.pleatBusy[i]) n++; return n; }

  /* ───────── 5. 完成 → バットへ ───────── */
  function finish(sc) {
    var g = gy(S.cur), idx = S.cur;
    S.step = 'busy';
    G.hint.clear();
    var d = G.state.data;
    var pl = []; for (var j = 0; j < 7; j++) pl.push(g.pleats[j] > 0 ? 1 : 0);
    d.gyoza[idx] = { pleats: pl, fill: g.filling > 1.5 ? 2 : 1 };
    d.made = Math.min(3, (d.made | 0) + 1);
    S.made = d.made;
    try { G.state.save(); } catch (e) { /* noop */ }
    for (j = 0; j < 7; j++) g.setPleat(j, pl[j]);

    var o = { s: 0 };
    sc.wait(0.15).then(function () {
      snd('squish', { vol: 0.4, pitch: 1.2 });
      G.cam.frame(VIEW, 1.0);
      return sc.to(o, { s: 1 }, 0.5, { ease: 'outBack', onUpdate: function () { g.setShape({ stand: U.clamp01(o.s) }); } });
    }).then(function () {
      g.setShape({ stand: 1 });
      return sc.wait(0.25);
    }).then(function () {
      return hop(sc, g, idx);
    }).then(function () {
      if (S.made >= 3) return finale(sc);
      return nextSkin(sc);
    });
  }

  function hop(sc, g, idx) {
    var from = g.group.position.clone(), to = slotWorld(idx), o = { k: 0 };
    snd('whoosh', { vol: 0.4, pitch: 1.2 });
    jiggle(g.group, -0.08, 5, 10);
    return sc.to(o, { k: 1 }, 0.62, {
      ease: 'linear', onUpdate: function () {
        var e = E.inOutQuad(o.k);
        g.group.position.lerpVectors(from, to, e);
        g.group.position.y += Math.sin(o.k * PI) * 0.6;
        g.group.rotation.y = PI / 2 * E.inOutCubic(o.k);
      }
    }).then(function () {
      g.group.position.copy(to); g.group.rotation.y = PI / 2;
      snd('tap', { vol: 0.35, pitch: 0.6 });
      jiggle(g.group, 0.1, 6, 7);
      G.fx.burst(V3(to.x, 0.02, to.z), 'flour', { count: 5, size: 2 });
      // こてん: ママ側へもたれる
      var l = { th: 0 }, nb = gy(idx - 1);
      return sc.wait(0.08).then(function () {
        return sc.to(l, { th: 0.27 }, 0.2, { ease: 'outQuad', onUpdate: function () { applyLean(g, l.th, to); } });
      }).then(function () {
        snd('tap', { vol: 0.3, pitch: 1.3 });
        if (nb) jiggle(nb.group, 0.05, 7, 6);
        return sc.wait(0.38);
      }).then(function () {
        snd('pop', { vol: 0.75, pitch: 1.25 });
        jiggle(g.group, 0.08, 7, 6);
        return sc.to(l, { th: 0 }, 0.7, { ease: 'outElastic', onUpdate: function () { applyLean(g, l.th, to); } });
      }).then(function () {
        applyLean(g, 0, to);
        g.group.rotation.order = 'XYZ'; g.group.rotation.set(0, PI / 2, 0);
        snd('chime', { vol: 0.6 });
        G.fx.burst(V3(to.x, 0.42, to.z), 'spark', { count: 6, size: 1.8, speed: 0.5 });
      });
    });
  }

  function nextSkin(sc) {
    S.cur = 3 + S.made;
    var g = gy(S.cur), stack = S.props.stack;
    if (!g) return;
    prepareSkin(g);
    var c = stack.userData.count();
    var top = V3(STACK.x, STACK.y + stack.userData.topY(), STACK.z);
    stack.userData.setCount(Math.max(0, c - 1));
    g.group.position.copy(top);
    g.group.rotation.y = 0.6;
    g.group.visible = true;
    S.wetFinger = false; S.pleatBusy = {};
    snd('fold', { vol: 0.25, pitch: 1.6 });
    var o = { k: 0 }, from = top.clone();
    return sc.to(o, { k: 1 }, 0.6, {
      ease: 'linear', onUpdate: function () {
        var e = E.inOutQuad(o.k);
        g.group.position.lerpVectors(from, SKIN, e);
        g.group.position.y += Math.sin(o.k * PI) * 0.03;
        g.group.rotation.y = 0.6 * (1 - e);
      }
    }).then(function () {
      g.group.position.copy(SKIN); g.group.rotation.y = 0;
      G.fx.burst(V3(SKIN.x, BOARD_TOP + 0.02, SKIN.z + 0.4), 'flour', { count: 3, size: 1.5 });
      startFill();
    });
  }

  function finale(sc) {
    S.step = 'busy';
    G.hint.clear();
    try { G.audio.phrase('made'); } catch (e) { /* noop */ }
    var list = [];
    for (var i = 0; i < 6; i++) list.push(i);
    var ps = list.map(function (i) {
      var g = gy(i), base = slotWorld(i);
      return sc.wait(0.3 + i * 0.13).then(function () {
        snd('pop', { vol: 0.5, pitch: 0.9 + i * 0.08 });
        return sc.to(g.group.position, { y: base.y + 0.09 }, 0.13, { ease: 'outQuad' });
      }).then(function () {
        return sc.to(g.group.position, { y: base.y }, 0.14, { ease: 'inQuad' });
      }).then(function () { jiggle(g.group, 0.06, 7, 7); });
    });
    return Promise.all(ps).then(function () { return sc.wait(0.7); }).then(function () {
      S.step = 'gone';
      G.shared.carry = true;
      G.flow.go('fry');
    });
  }

  /* ───────── 小さな発見 ───────── */
  function discover(p) {
    var Sh = G.shared, pr = S.props;
    // バットのぎょうざ
    var list = [], i;
    for (i = 0; i < 6; i++) { var g = gy(i); if (g && g.group.visible && i !== S.cur) list.push(g.group); }
    var hit = G.input.pick(p, list);
    var tg = null;
    if (hit) { var o = hit.object; while (o && list.indexOf(o) < 0) o = o.parent; tg = o; }
    if (!tg) {
      for (i = 0; i < 6; i++) {
        var g2 = gy(i);
        if (g2 && g2.group.visible && i !== S.cur && g2.stand > 0.9 && near(p, g2.group.position.clone().add(V3(0, 0.2, 0)), 34)) { tg = g2.group; break; }
      }
    }
    if (tg) {
      var gi = 0; for (i = 0; i < 6; i++) if (gy(i).group === tg) gi = i;
      jiggle(tg, 0.1, 7, 5);
      snd('pop', { vol: 0.6, pitch: gi < 3 ? 0.8 : 1.3 });
      return;
    }
    // 小皿（水の時以外）
    if (near(p, V3(DISH.x, 0.09, DISH.z), 60)) {
      try { pr.dish.userData.ripple(0, 0); } catch (e) { /* noop */ }
      snd('splash', { vol: 0.35, pitch: 1.1 });
      return;
    }
    // 皮の束
    var sc2 = pr.stack.userData;
    if (sc2.count() > 0 && near(p, V3(STACK.x, STACK.y + sc2.topY(), STACK.z), 55)) {
      jiggle(pr.stack, 0.12, 9, 6);
      sc2.sheets.forEach(function (m, k) { if (m.visible) m.rotation.y += (k % 2 ? 1 : -1) * 0.06; });
      snd('fold', { vol: 0.3, pitch: 1.7 });
      return;
    }
    // あんのボウル
    if (near(p, V3(BOWL.x, 0.35, BOWL.z), 80) && !S.spoonBusy && S.drag == null) {
      snd('metal', { vol: 0.5, pitch: 1.1 });
      var sp = pr.spoon, rz = sp.rotation.z;
      S.sc.to(sp.rotation, { z: rz + 0.12 }, 0.06).then(function () { return S.sc.to(sp.rotation, { z: S.props.spoonRot.z }, 0.4, { ease: 'outElastic' }); });
      jiggle(pr.bowl, 0.03, 9, 7);
      return;
    }
    // まな板の空いた所
    var h = G.input.planeHit(p, BOARD_TOP);
    if (h && Math.abs(h.x) < 1.25 && Math.abs(h.z - 0.22) < 0.72) {
      G.fx.burst(V3(h.x, BOARD_TOP + 0.01, h.z), 'flour', { count: 6, size: 1.8 });
      snd('flour', { vol: 0.6 });
    }
    void Sh;
  }

  /* ───────── 毎フレーム ───────── */
  function update(dt) {
    if (!S.built || !S.step || S.step === 'gone') return;
    var t = now(), pr = S.props, g = gy(S.cur);
    updateJiggles(dt);

    // スプーンが指についてくる
    if (S.drag === 'spoon') {
      var sp = pr.spoon, k = 1 - Math.exp(-dt * 22);
      sp.position.lerp(S.spoonTgt, k);
    }
    // 手前のふちがぴらぴら
    if (S.step === 'fold' && S.drag !== 'flap' && g && !S.flapAnim) {
      S.flapT += dt;
      var env = Math.pow(Math.max(0, Math.sin(S.flapT * PI * 2 / 2.2)), 2);
      if (g.fold < 0.2) setFold(g, 0.05 + 0.035 * env * (0.6 + 0.4 * Math.sin(S.flapT * 22)));
    }
    // ふちの光の道筋
    var arcOn = S.step === 'wet' && S.wetFinger && g;
    pr.arc.visible = arcOn || pr.arcMat.opacity > 0.01;
    var arcA = arcOn ? (0.45 + 0.2 * Math.sin(t * 3.2)) * (1 - g.wetCoverage) : 0;
    pr.arcMat.opacity = U.damp(pr.arcMat.opacity, arcA, 6, dt);
    // ぬれた指のきらめき
    if (pr.glint.visible) pr.glint.material.opacity = S.wetFinger && G.input.active ? 0.75 + 0.2 * Math.sin(t * 18) : 0;
    // ひだのスロット
    var pOn = S.step === 'pleat' && g;
    for (var i = 0; i < 7; i++) {
      var sg = pr.slotGlows[i];
      var want = pOn && !(g.pleats[i] > 0) && !S.pleatBusy[i];
      if (want) { sg.position.copy(slotPos(g, i)); sg.position.y += 0.012; }
      sg.material.opacity = U.damp(sg.material.opacity, want ? 0.5 + 0.25 * Math.sin(t * 3 + i * 0.6) : 0, 8, dt);
      sg.visible = sg.material.opacity > 0.01;
    }
    // ひだの完成判定
    if (S.step === 'pleat' && g) {
      var n = pleatCount(g), idle = G.input.active ? 0 : t - S.lastTouch;
      var settled = !Object.keys(S.pleatBusy).some(function (k) { return S.pleatBusy[k]; });
      if (settled && (n >= 7 || (n >= 2 && idle >= 2.5))) finish(S.sc);
    }
  }

  function exit() {
    G.input.clear();
    G.hint.clear();
    S.drag = null;
    clearJiggles();
    var pr = S.props;
    if (pr.glint) pr.glint.visible = false;
    if (pr.arc) { pr.arc.visible = false; pr.arcMat.opacity = 0; }
    if (pr.slotGlows) pr.slotGlows.forEach(function (s) { s.visible = false; s.material.opacity = 0; });
    if (G.shared) G.shared.gyozas.forEach(function (g) { var r = g.group.rotation; if (r.order !== 'XYZ') { var y = r.y; r.order = 'XYZ'; r.set(0, y, 0); } });
    if (pr.spoon && S.spoonBusy) resetSpoon();
    S.step = null;
  }

  function reset() {
    S.step = null; S.drag = null; S.cur = -1; S.made = 0;
    S.wetFinger = false; S.wetPrevA = null; S.pleatBusy = {};
    clearJiggles();
  }

  G.flow.register('wrap', { build: build, enter: enter, update: update, exit: exit, reset: reset });
})();

/* 60-eat.js — 場面「たべる」(eat) と、やさしい終わり。
   大皿の羽根つきぎょうざを、羽根ごと「パリッ」と割って取り分け（ひだが上・羽根が下の扇に返る）、
   しょうゆにちょんとつけ、じぶんの取り皿で「ぱくっ」。ママの取り皿へのおすそわけもできる。
   ぜんぶ食べたら夕方の光の中でおしまい。空の大皿をタップすると最初から。 */
(function () {
  'use strict';
  var G = window.G;
  var U = G.util;
  function V3(x, y, z) { return new THREE.Vector3(x || 0, y || 0, z || 0); }
  function logErr(tag, e) { try { console.error('[eat.' + tag + ']', e); } catch (_) { /* noop */ } }
  function sfx(name, o) { try { G.audio.sfx(name, o); } catch (e) { logErr('sfx', e); } }

  /* ───── 配置（アンカーからの相対） ───── */
  var L = {
    plate: [0, -0.1],
    mine: [-0.55, 1.85],
    mama: [0.95, -2.0],
    soy: [0.9, 1.5],
    cup: [-0.85, -2.12],
    myChop: { x: 0.36, z: 2.72, scale: 0.65, flip: false },
    mamaChop: { x: 0.72, z: -2.78, scale: 0.85, flip: true }
  };
  var FRAME = { c: [0, 0, 0.25], w: 3.4, d: 4.6 };
  var FRAME_END = { c: [0, 0, 0.25], w: 4.0, d: 5.4 };
  /* 取り皿の上の並び（皿ローカル）。y は重なりよけの持ち上げ */
  var MINE_SLOTS = [{ x: 0.02, z: 0.1, y: 0, yaw: 0 }, { x: -0.03, z: -0.2, y: 0.025, yaw: 0.14 }];
  var MAMA_SLOTS = [{ x: 0.0, z: 0.15, y: 0, yaw: 0 }, { x: -0.08, z: -0.15, y: 0.025, yaw: 0.18 }, { x: 0.1, z: -0.38, y: 0.05, yaw: -0.16 }];

  var HALF = 0.18;      // 立ったぎょうざの中心の高さ（ピース原点＝ぎょうざの底から）
  var HOLD_Y = 0.62;    // 運ぶときのぎょうざの中心の高さ
  var HOLD_BACK = 0.28; // 指で隠れないよう少し奥へ
  var UP = V3(0, 1, 0);

  var A = null;          // アンカー
  var R = null;          // build で作る道具
  var S = {};            // 実行中の状態
  var scope = null;

  var tq = new THREE.Quaternion(), tq2 = new THREE.Quaternion(), tv = V3(), tv2 = V3(), te = new THREE.Euler();

  function W(rel) { return V3(A.x + rel[0], 0, A.z + rel[1]); }

  /* ───────────── build ───────────── */
  function build() {
    A = G.world.anchors.eat;
    var scene = G.core.scene, P = G.props;
    R = {};
    R.root = new THREE.Group(); R.root.name = 'eatProps';
    scene.add(R.root);
    R.mine = P.smallPlate(); R.mine.position.copy(W(L.mine)); R.root.add(R.mine);
    R.mama = P.smallPlate(); R.mama.position.copy(W(L.mama)); R.root.add(R.mama);
    R.soy = P.soyDish(); R.soy.position.copy(W(L.soy)); R.root.add(R.soy);
    R.cup = P.teaCup(); R.cup.position.copy(W(L.cup)); R.cup.rotation.y = 2.2; R.root.add(R.cup);
    R.myChop = chopSet(L.myChop);
    R.mamaChop = chopSet(L.mamaChop);
    /* 皿に残る羽根のかけら（小さな平たい粒。使い回し） */
    R.crumbs = [];
    var geo = new THREE.DodecahedronGeometry(1, 0);
    var mats = [0xc98b45, 0xb77632, 0xd9a25c].map(function (c) {
      return new THREE.MeshStandardMaterial({ color: c, roughness: 0.72, metalness: 0 });
    });
    for (var i = 0; i < 34; i++) {
      var m = new THREE.Mesh(geo, mats[i % 3]);
      m.castShadow = false; m.receiveShadow = true; m.visible = false;
      m.raycast = function () {};
      R.root.add(m);
      R.crumbs.push(m);
    }
    R.root.visible = false;
  }
  /* はし＋はし置き。内側の枠では先が -X。flip で先を +X に（向かいの席） */
  function chopSet(o) {
    var wrap = new THREE.Group();
    wrap.position.copy(W([o.x, o.z]));
    wrap.rotation.y = o.flip ? Math.PI : 0;
    var ch = G.props.chopsticks(o.scale);
    var Lc = ch.userData.length || 2.2 * o.scale;
    var rest = G.props.rest();
    var rx = -Lc / 2 + 0.2 * o.scale + 0.05;
    rest.position.set(rx, 0, 0); rest.rotation.y = Math.PI / 2;
    var th = Math.asin(U.clamp(0.06 / Math.max(0.3, Lc / 2 - rx), 0, 0.2));
    ch.rotation.z = -th;
    ch.position.y = (Lc / 2) * Math.sin(th);
    wrap.add(rest); wrap.add(ch);
    R.root.add(wrap);
    wrap.userData = { chop: ch, rest: rest, base: wrap.position.clone(), len: Lc, busy: false };
    return wrap;
  }

  /* ───────────── 状態 ───────────── */
  function resetState() {
    S.mode = 'off';       // play | end | ready
    S.pieces = [];
    S.mine = [null, null];
    S.mama = [null, null, null];
    S.drag = null;
    S.restarting = false;
    S.emPlate = null; S.emCup = null;
    S.crumbN = 0;
    S.hintKey = '';
    S.lastDisc = 0;
  }
  resetState();

  /* ───────────── かけら（ぎょうざ＋その羽根）の姿 ───────────── */
  function poseQuat(P, out) {
    var ps = P.pose;
    out.copy(ps.q0);
    tq.setFromAxisAngle(ps.axis, Math.PI * ps.e); out.premultiply(tq);
    tq.setFromAxisAngle(UP, ps.yd * ps.e + ps.yaw); out.premultiply(tq);
    if (ps.tx || ps.tz) { te.set(ps.tx, 0, ps.tz); tq.setFromEuler(te); out.premultiply(tq); }
    return out;
  }
  function applyPose(P) {
    var pc = P.pc;
    poseQuat(P, pc.quaternion);
    tv.set(0, HALF, 0).applyQuaternion(pc.quaternion);
    pc.position.copy(P.pose.c).sub(tv);
  }
  function centerOf(P, out) {
    out = out || V3();
    if (P.pose.live) return out.copy(P.pose.c);
    P.pc.updateWorldMatrix(true, false);
    return P.pc.localToWorld(out.set(0, HALF, 0));
  }
  /* 今の見た目のまま scene 直下へ移し、姿の操作をここから始める */
  function takeToScene(P) {
    var pc = P.pc, scene = G.core.scene;
    pc.updateWorldMatrix(true, false);
    if (pc.parent !== scene) scene.attach(pc);
    pc.updateMatrixWorld(true);
    var ps = P.pose;
    ps.q0.copy(pc.quaternion);
    ps.e = 0; ps.yaw = 0; ps.tx = 0; ps.tz = 0;
    ps.c.copy(pc.position).add(tv.set(0, HALF, 0).applyQuaternion(pc.quaternion));
    P.g.group.getWorldQuaternion(tq2);
    ps.axis.set(1, 0, 0).applyQuaternion(tq2);
    ps.axis.y = 0;
    if (ps.axis.lengthSq() < 1e-6) ps.axis.set(1, 0, 0);
    ps.axis.normalize();
    tq.setFromAxisAngle(ps.axis, Math.PI);
    tq2.premultiply(tq);
    tv.set(1, 0, 0).applyQuaternion(tq2);
    ps.yd = -Math.atan2(-tv.z, tv.x);
    ps.live = true;
  }
  /* 姿を to へ動かす（c, e, yaw, tx, tz）。arc で山なり */
  function animTo(P, to, dur, opt) {
    opt = opt || {};
    var ps = P.pose, tok = ++P.tok;
    if (to.e != null) P.flipTok++;
    var from = { c: ps.c.clone(), e: ps.e, yaw: ps.yaw, tx: ps.tx, tz: ps.tz };
    var o = { t: 0 }, arc = opt.arc || 0;
    ps.live = true;
    function set(t) {
      if (to.c) { ps.c.lerpVectors(from.c, to.c, t); ps.c.y += Math.sin(Math.PI * U.clamp01(t)) * arc; }
      if (to.e != null) ps.e = U.lerp(from.e, to.e, t);
      if (to.yaw != null) ps.yaw = U.lerp(from.yaw, to.yaw, t);
      ps.tx = U.lerp(from.tx, to.tx || 0, t);
      ps.tz = U.lerp(from.tz, to.tz || 0, t);
    }
    return scope.to(o, { t: 1 }, dur, {
      ease: opt.ease || 'inOutQuad',
      onUpdate: function () { if (P.tok === tok) set(o.t); }
    }).then(function (ok) {
      if (P.tok !== tok) return false;
      set(1);
      return ok;
    });
  }
  function flipUp(P, dur) {
    var tok = ++P.flipTok, o = { e: P.pose.e };
    return scope.to(o, { e: 1 }, dur, {
      ease: 'inOutQuad',
      onUpdate: function () { if (P.flipTok === tok) P.pose.e = o.e; }
    });
  }

  /* 取り皿の上の置き場所（ぎょうざの中心、ワールド） */
  function slotPose(P, plate, slot) {
    var ps = P.pose;
    var save = { e: ps.e, yaw: ps.yaw, tx: ps.tx, tz: ps.tz };
    ps.e = 1; ps.yaw = slot.yaw; ps.tx = 0; ps.tz = 0;
    poseQuat(P, tq2);
    ps.e = save.e; ps.yaw = save.yaw; ps.tx = save.tx; ps.tz = save.tz;
    var c = V3(slot.x, plate.userData.topY + 0.012 + slot.y + HALF, slot.z);
    plate.localToWorld(c);
    /* 羽根の広がりの中心が皿の中ほどへ来るよう、半分だけ寄せる */
    var bb = P.bbc;
    if (bb) {
      tv.set(bb.x, 0, bb.z).applyQuaternion(tq2); tv.y = 0;
      c.addScaledVector(tv, -0.5);
    }
    return { c: c, e: 1, yaw: slot.yaw };
  }

  /* ───────────── かけらの粒（皿に残る） ───────────── */
  function addCrumbs(center, radius, n, y) {
    for (var i = 0; i < n; i++) {
      var m = R.crumbs[S.crumbN % R.crumbs.length]; S.crumbN++;
      var a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
      var s = 0.022 + Math.random() * 0.026;
      m.scale.set(s * (0.8 + Math.random() * 0.6), s * 0.28, s);
      m.position.set(center.x + Math.cos(a) * r, y + s * 0.2, center.z + Math.sin(a) * r);
      m.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * 6.28, (Math.random() - 0.5) * 0.4);
      m.visible = true;
    }
  }
  function crumbBurst(pos, o) {
    try { G.fx.burst(pos, 'crumb', o); } catch (e) { logErr('burst', e); }
  }

  /* ───────────── ヒント（いつも1つだけ） ───────────── */
  function plateWorld(obj, y) { var v = obj.position.clone(); v.y = y || 0; return v; }
  function myPlateCenter() { return plateWorld(R.mine, 0.06); }
  function mamaPlateCenter() { return plateWorld(R.mama, 0.06); }
  function freeSlot(arr) { for (var i = 0; i < arr.length; i++) if (arr[i] == null) return i; return -1; }

  function setHint(key, cfg) {
    if (S.hintKey === key) return;
    S.hintKey = key;
    if (!cfg) { G.hint.clear(); return; }
    G.hint.set(cfg);
  }
  function pickNextPlatePiece() {
    var best = null, bd = 1e9, my = R.mine.position;
    S.pieces.forEach(function (P) {
      if (P.where !== 'plate' || P.busy) return;
      var d = Math.hypot(P.home.x - my.x, P.home.z - my.z);
      if (d < bd) { bd = d; best = P; }
    });
    return best;
  }
  function firstMine() {
    for (var i = 0; i < S.mine.length; i++) {
      var P = S.mine[i];
      if (P && P.where === 'mine' && !P.busy) return P;
    }
    return null;
  }
  function refreshHint() {
    if (S.mode === 'ready') {
      setHint('plate-end', {
        target: plateWorld(G.shared.plate, 0.1), radius: 1.15, ringY: 0.09,
        demo: { type: 'tap', at: plateWorld(G.shared.plate, 0.12) }, delays: [5, 10]
      });
      return;
    }
    if (S.mode !== 'play') { setHint('none', null); return; }
    var d = S.drag;
    if (d && d.phase === 'carry') {
      var tgt = freeSlot(S.mine) >= 0 ? R.mine : freeSlot(S.mama) >= 0 ? R.mama : null;
      if (tgt) {
        var dst = tgt;
        setHint('carry-' + (tgt === R.mine ? 'mine' : 'mama'), {
          target: function () { return plateWorld(dst, 0.05); }, radius: 0.6, ringY: 0.05
        });
      } else {
        var P0 = d.P;
        setHint('carry-home', { target: function () { return P0.home; }, radius: 0.45, ringY: 0.49 });
      }
      return;
    }
    var mp = firstMine();
    if (mp) {
      setHint('eat-' + mp.k, {
        target: function () { return centerOf(mp, V3()); }, radius: 0.45, ringY: 0.06,
        wobble: mp.pose.live ? null : mp.pc,
        demo: { type: 'tap', at: function () { return centerOf(mp, V3()).add(tv2.set(0, 0.12, 0.05)); } }
      });
      return;
    }
    var pp = pickNextPlatePiece();
    if (pp) {
      setHint('take-' + pp.k, {
        target: function () { return centerOf(pp, V3()); }, radius: 0.42, ringY: 0.49,
        wobble: pp.pose.live ? null : pp.pc,
        demo: {
          type: 'drag', path: function () {
            var c = centerOf(pp, V3()), s = R.soy.position, m = R.mine.position;
            c.y = 0.5;
            return [c, V3(c.x, 0.65, c.z + 0.2), V3(s.x - 0.1, 0.3, s.z), V3(m.x, 0.22, m.z)];
          }
        }
      });
      return;
    }
    setHint('none', null);
  }

  /* ───────────── 入力 ───────────── */
  function near(p, pos, rUnits, minPx) {
    var d = G.input.screenDist(p, pos);
    var lim = Math.max(minPx || 44, G.input.pxPerUnit(pos) * rUnits);
    return d <= lim ? d : -1;
  }
  function xzDist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

  function onDown(p) {
    if (S.drag || S.restarting) return;
    try {
      if (S.mode === 'play') {
        /* 1) じぶんの取り皿のぎょうざ → たべる */
        var best = null, bd = 1e9;
        S.mine.forEach(function (P) {
          if (!P || P.where !== 'mine' || P.busy) return;
          var d = near(p, centerOf(P, V3()), 0.42, 70);
          if (d >= 0 && d < bd) { bd = d; best = P; }
        });
        if (best) { eat(best); return; }
        /* 2) 大皿のぎょうざ → つかむ（指にいちばん近いかけら） */
        best = null; bd = 1e9;
        S.pieces.forEach(function (P) {
          if (P.where !== 'plate' || P.busy) return;
          var d = G.input.screenDist(p, centerOf(P, V3()));
          if (d < bd) { bd = d; best = P; }
        });
        if (best) {
          var lim = Math.max(70, G.input.pxPerUnit(best.home) * 0.45);
          var h = G.input.planeHit(p, 0.45);
          var onPlate = h && xzDist(h, G.shared.plate.position) < 1.32;
          if (bd <= lim || onPlate) { grab(best, p); return; }
        }
      }
      if (S.mode === 'ready') {
        var hp = G.input.planeHit(p, 0.1);
        if ((hp && xzDist(hp, G.shared.plate.position) < 1.45) || near(p, plateWorld(G.shared.plate, 0.1), 1.2, 80) >= 0) {
          S.restarting = true;
          S.mode = 'off';
          sfx('ceramic', { vol: 0.35 });
          setHint('none', null);
          G.flow.restart();
          return;
        }
      }
      discover(p);
    } catch (e) { logErr('down', e); }
  }
  function onMove(p) {
    var d = S.drag;
    if (!d) return;
    try {
      if (d.phase === 'press' && p.moved > 10) commitCarry();
      if (d.phase === 'carry') holdTarget(p, d.target);
      d.lastP = p;
    } catch (e) { logErr('move', e); }
  }
  function onUp(p) {
    var d = S.drag;
    if (!d) return;
    try {
      if (d.phase === 'press') { tapBounce(d.P); S.drag = null; refreshHint(); return; }
      release(p);
    } catch (e) { logErr('up', e); S.drag = null; }
  }
  function holdTarget(p, out) {
    var h = G.input.planeHit(p, HOLD_Y);
    if (!h) return out;
    out.copy(h); out.z -= HOLD_BACK;
    out.x = U.clamp(out.x, A.x - 2.1, A.x + 2.1);
    out.z = U.clamp(out.z, A.z - 2.7, A.z + 2.6);
    out.y = HOLD_Y;
    return out;
  }

  /* ───────────── とる ───────────── */
  function grab(P, p) {
    takeToScene(P);
    P.busy = true;
    S.hintKey = '';
    S.drag = { P: P, phase: 'press', t0: G.core.time, target: P.pose.c.clone(), vel: V3(), prev: P.pose.c.clone(), dip: { v: 0 }, inSoy: false, lastP: p };
    sfx('crack', { vol: 0.85, pitch: 0.92 + Math.random() * 0.16 });
    crumbBurst(P.pose.c.clone().add(V3(0, 0.12, 0)), { count: 8, size: 1.8, speed: 1.0, floor: G.shared.plate.userData.topY + 0.39 });
    animTo(P, { c: P.pose.c.clone().add(V3(0, 0.06, 0)) }, 0.09, { ease: 'outQuad' });
  }
  function commitCarry() {
    var d = S.drag, P = d.P;
    if (!d || d.phase !== 'press') return;
    d.phase = 'carry';
    P.where = 'hand';
    P.tok++; // 押し上げの動きを止め、指に追従させる
    if (!P.leftCrumbs) {
      P.leftCrumbs = true;
      addCrumbs(V3(P.home.x, 0, P.home.z), 0.28, 3, G.shared.plate.userData.topY + 0.002);
    }
    if (d.lastP) holdTarget(d.lastP, d.target); else d.target.set(P.pose.c.x, HOLD_Y, P.pose.c.z);
    flipUp(P, 0.3);
    sfx('crunch', { vol: 0.25, pitch: 1.3 });
    refreshHint();
  }
  function tapBounce(P) {
    var home = P.home.clone().add(V3((Math.random() - 0.5) * 0.03, 0, (Math.random() - 0.5) * 0.03));
    var jy = P.pose.yaw + (Math.random() - 0.5) * 0.06;
    crumbBurst(P.pose.c.clone().add(V3(0, 0.15, 0)), { count: 6, size: 1.6, speed: 0.8, floor: G.shared.plate.userData.topY + 0.39 });
    animTo(P, { c: home, e: 0, yaw: jy }, 0.32, { arc: 0.1, ease: 'outQuad' }).then(function (ok) {
      if (!ok) return;
      P.home.copy(home); P.busy = false; P.where = 'plate'; P.pose.live = false;
      sfx('crack', { vol: 0.25, pitch: 1.4 });
      refreshHint();
    });
  }

  /* ───────────── たれ ───────────── */
  function startDip(d) {
    var P = d.P, o = d.dip;
    d.dipTok = (d.dipTok || 0) + 1;
    var tok = d.dipTok;
    scope.to(o, { v: 1 }, 0.22, { ease: 'outQuad' }).then(function (ok) {
      if (!ok || d.dipTok !== tok) return;
      P.sauce = Math.min(1, P.sauce + 0.34);
      P.g.setSauce(P.sauce);
      try { R.soy.userData.ripple(0.05, 0); } catch (e) { logErr('ripple', e); }
      sfx('drip', { vol: 0.8 });
      return scope.wait(0.08).then(function () { return scope.to(o, { v: 0 }, 0.3, { ease: 'inOutQuad' }); });
    });
  }

  /* ───────────── おく ───────────── */
  function release(p) {
    var d = S.drag, P = d.P;
    S.drag = null;
    d.dipTok = (d.dipTok || 0) + 1;
    var c = P.pose.c, f = G.input.planeHit(p, 0);
    var dm = Math.min(xzDist(c, R.mine.position), f ? xzDist(f, R.mine.position) : 9);
    var dM = Math.min(xzDist(c, R.mama.position), f ? xzDist(f, R.mama.position) : 9);
    var sm = freeSlot(S.mine), sM = freeSlot(S.mama);
    var to = null;
    if (sm >= 0 && dm < 1.0) to = 'mine';
    if (sM >= 0 && dM < 0.95 && (!to || dM < dm)) to = 'mama';
    if (to === 'mine') placeOn(P, 'mine', sm);
    else if (to === 'mama') placeOn(P, 'mama', sM);
    else goHome(P);
    refreshHint();
  }
  function placeOn(P, which, si) {
    var arr = which === 'mine' ? S.mine : S.mama, plate = which === 'mine' ? R.mine : R.mama;
    var slots = which === 'mine' ? MINE_SLOTS : MAMA_SLOTS;
    arr[si] = P; P.where = which; P.slot = si; P.busy = true;
    var sp = slotPose(P, plate, slots[si]);
    animTo(P, sp, 0.3, { arc: 0.06, ease: 'inOutQuad' }).then(function (ok) {
      if (!ok) return;
      P.busy = false; P.pose.live = false;
      sfx('ceramic', { vol: 0.35, pitch: 1.05 + Math.random() * 0.1 });
      if (which === 'mama') mamaGlad();
      refreshHint();
      checkEnd();
    });
  }
  function mamaGlad() {
    sfx('chime', { vol: 0.55, delay: 0.08 });
    try {
      G.fx.burst(plateWorld(R.mama, 0.35), 'spark', { count: 7, size: 1.6, speed: 0.6 });
      var cp = R.cup.position;
      G.fx.steam(V3(cp.x, 0.8, cp.z), { count: 5, spread: 0.12, rise: 1.0, size: 0.38, life: 2.4, opacity: 0.3 });
    } catch (e) { logErr('glad', e); }
  }
  function goHome(P) {
    P.where = 'plate'; P.busy = true;
    var home = P.home.clone().add(V3((Math.random() - 0.5) * 0.04, 0, (Math.random() - 0.5) * 0.04));
    var jy = (Math.random() - 0.5) * 0.08;
    animTo(P, { c: home, e: 0, yaw: jy }, 0.5, { arc: 0.22, ease: 'inOutQuad' }).then(function (ok) {
      if (!ok) return;
      P.home.copy(home); P.busy = false; P.pose.live = false;
      sfx('crack', { vol: 0.2, pitch: 1.5 });
      refreshHint();
    });
  }

  /* ───────────── たべる ───────────── */
  function eat(P) {
    if (P.busy || P.eating || P.where !== 'mine') return;
    P.eating = true; P.busy = true;
    var n = ++P.bites;
    var base = P.pose.c.clone();
    var lean = base.clone().add(V3(0.04, 0.1, 0.22));
    sfx('bite', { vol: 0.9, pitch: 0.95 + Math.random() * 0.1 });
    var topY = R.mine.userData.topY;
    animTo(P, { c: lean }, 0.11, { ease: 'outQuad' }).then(function (ok) {
      if (!ok) return;
      if (n === 1) {
        P.g.setBite(1);
        P.mesh.visible = false; // 羽根はパリパリと砕けて消える
        sfx('crunch', { vol: 0.75, delay: 0.03 });
        crumbBurst(V3(base.x, topY + 0.08, base.z), { count: 12, size: 1.8, speed: 0.9, floor: R.mine.position.y + topY + 0.01 });
        addCrumbs(V3(R.mine.position.x, 0, R.mine.position.z), 0.3, 3, topY + 0.003);
      } else {
        P.g.setBite(2);
        sfx('gulp', { vol: 0.8, delay: 0.3 });
        crumbBurst(V3(base.x, topY + 0.1, base.z), { count: 5, size: 1.4, speed: 0.6, floor: R.mine.position.y + topY + 0.01 });
        addCrumbs(V3(R.mine.position.x, 0, R.mine.position.z), 0.25, 2, topY + 0.003);
      }
      return animTo(P, { c: base }, 0.22, { ease: 'outQuad' });
    }).then(function (ok) {
      if (ok === undefined || ok === false) { /* 場面を出た等 */ }
      P.pose.live = n < 2 ? false : P.pose.live;
      if (n >= 2) {
        P.where = 'eaten';
        if (S.mine[P.slot] === P) S.mine[P.slot] = null;
      }
      P.eating = false; P.busy = false;
      refreshHint();
      checkEnd();
    });
  }

  /* ───────────── 小さな発見 ───────────── */
  function segDist(pt, a, b) {
    var abx = b.x - a.x, abz = b.z - a.z, l2 = abx * abx + abz * abz || 1;
    var t = U.clamp01(((pt.x - a.x) * abx + (pt.z - a.z) * abz) / l2);
    return Math.hypot(pt.x - (a.x + abx * t), pt.z - (a.z + abz * t));
  }
  function discover(p) {
    var now = G.core.time;
    if (now - S.lastDisc < 0.12) return;
    S.lastDisc = now;
    var cp = R.cup.position;
    if (near(p, V3(cp.x, 0.42, cp.z), 0.45, 50) >= 0) {
      sfx('puff', { vol: 0.35, pitch: 1.2 });
      G.fx.steam(V3(cp.x, 0.82, cp.z), { count: 4, spread: 0.1, rise: 0.9, size: 0.34, life: 2.2, opacity: 0.3 });
      return;
    }
    var sp = R.soy.position;
    var h = G.input.planeHit(p, 0.06);
    if ((h && xzDist(h, sp) < 0.42) || near(p, V3(sp.x, 0.06, sp.z), 0.36, 48) >= 0) {
      var lx = h ? U.clamp(h.x - sp.x, -0.2, 0.2) : 0, lz = h ? U.clamp(h.z - sp.z, -0.2, 0.2) : 0;
      try { R.soy.userData.ripple(lx, lz); } catch (e) { logErr('ripple', e); }
      sfx('drip', { vol: 0.7, pitch: 0.9 + Math.random() * 0.2 });
      return;
    }
    var h0 = G.input.planeHit(p, 0.03);
    var chops = [R.myChop, R.mamaChop];
    for (var i = 0; i < chops.length; i++) {
      var c = chops[i], u = c.userData;
      var a = V3(u.base.x - u.len / 2, 0, u.base.z), b = V3(u.base.x + u.len / 2, 0, u.base.z);
      if (h0 && segDist(h0, a, b) < 0.16) { tapChop(c); return; }
    }
    if (h0) {
      var plates = [[R.mine, S.mine], [R.mama, S.mama]];
      for (var j = 0; j < plates.length; j++) {
        if (xzDist(h0, plates[j][0].position) < 0.58) {
          var empty = plates[j][1].every(function (x) { return !x; });
          if (empty) sfx('clink', { vol: 0.5, pitch: j ? 1.1 : 1.0 });
          return;
        }
      }
    }
  }
  function tapChop(c) {
    var u = c.userData;
    sfx('click', { vol: 0.7, pitch: 0.95 + Math.random() * 0.1 });
    if (u.busy) return;
    u.busy = true;
    var o = { z: 0, r: 0 };
    var ch = u.chop;
    function set() { c.position.z = u.base.z + o.z; ch.rotation.x = o.r; }
    scope.to(o, { z: 0.045, r: 0.22 }, 0.16, { ease: 'outQuad', onUpdate: set }).then(function (ok) {
      if (!ok) return;
      return scope.to(o, { z: 0, r: 0 }, 0.35, { ease: 'inOutQuad', onUpdate: set });
    }).then(function () { set(); u.busy = false; });
  }

  /* ───────────── おしまい ───────────── */
  function checkEnd() {
    if (S.mode !== 'play' || S.drag) return;
    var left = S.pieces.some(function (P) { return P.busy || P.where === 'plate' || P.where === 'mine' || P.where === 'hand'; });
    if (!left) startEnd();
  }
  function startEnd() {
    S.mode = 'end';
    try { G.state.data.station = 'end'; G.state.save(); } catch (e) { logErr('save', e); }
    setHint('none', null);
    if (S.emPlate) { S.emPlate.stop(); S.emPlate = null; }
    if (S.emCup) S.emCup.rate = 0.9;
    try { G.world.setMood('evening', 4); } catch (e) { logErr('mood', e); }
    scope.guard(G.cam.frame({ center: W([FRAME_END.c[0], FRAME_END.c[2]]), w: FRAME_END.w, d: FRAME_END.d }, 6));
    scope.wait(0.6).then(function () {
      try { G.audio.phrase('ending'); } catch (e) { logErr('phrase', e); }
      return scope.wait(8.2);
    }).then(function () {
      if (S.mode !== 'end') return;
      S.mode = 'ready';
      refreshHint();
    });
  }

  /* ───────────── 毎フレーム ───────────── */
  var dipC = V3(), tgt = V3();
  function update(dt) {
    if (S.mode === 'off') return;
    dt = Math.min(0.05, Math.max(0, dt || 0));
    var d = S.drag;
    if (d) {
      var P = d.P, ps = P.pose;
      if (d.phase === 'press' && G.core.time - d.t0 > 0.28) commitCarry();
      if (d.phase === 'carry') {
        /* たれの小皿 */
        var sp = R.soy.position;
        var tipX = ps.c.x + 0.3 * U.clamp01(ps.e), dS = Math.hypot(tipX - sp.x, ps.c.z - sp.z);
        if (!d.inSoy && dS < 0.42 && ps.e > 0.8) { d.inSoy = true; startDip(d); }
        else if (d.inSoy && dS > 0.62) d.inSoy = false;
        var dv = d.dip.v;
        dipC.set(sp.x - 0.29, R.soy.userData.liquidY + 0.25, sp.z);
        tgt.copy(d.target).lerp(dipC, dv);
        var prevX = ps.c.x, prevZ = ps.c.z;
        var lam = 18;
        ps.c.x = U.damp(ps.c.x, tgt.x, lam, dt);
        ps.c.y = U.damp(ps.c.y, tgt.y, dv > 0 ? 30 : 10, dt);
        ps.c.z = U.damp(ps.c.z, tgt.z, lam, dt);
        if (dt > 0) {
          d.vel.x = U.damp(d.vel.x, (ps.c.x - prevX) / dt, 8, dt);
          d.vel.z = U.damp(d.vel.z, (ps.c.z - prevZ) / dt, 8, dt);
        }
        var k = 0.06;
        ps.tx = U.clamp(d.vel.z * k, -0.26, 0.26);
        ps.tz = U.clamp(-d.vel.x * k, -0.26, 0.26) - 0.42 * dv;
      }
    }
    for (var i = 0; i < S.pieces.length; i++) if (S.pieces[i].pose.live) applyPose(S.pieces[i]);
  }

  /* ───────────── 入口・出口 ───────────── */
  function enter(sc) {
    scope = sc;
    resetState();
    if (!R) build();
    var Sh = G.shared, scene = G.core.scene;
    G.kit.detachAll();
    G.kit.assemblePlated();
    var plate = Sh.plate;
    if (plate.parent !== scene) scene.add(plate);
    plate.position.copy(W(L.plate)); plate.rotation.set(0, 0, 0); plate.scale.set(1, 1, 1);
    plate.visible = true;
    if (plate.userData.contact) plate.userData.contact.visible = true;
    R.root.visible = true;
    R.crumbs.forEach(function (m) { m.visible = false; });
    [R.myChop, R.mamaChop].forEach(function (c) { c.position.copy(c.userData.base); c.userData.chop.rotation.x = 0; c.userData.busy = false; });
    plate.updateMatrixWorld(true);

    var w = Sh.wing;
    for (var k = 0; k < 6; k++) {
      var wp = w.pieces[k], g = Sh.gyozas[G.kit.gyozaAtSlot(k)];
      if (!wp || !g) continue;
      wp.mesh.visible = true;
      var bbc = null;
      try {
        var geo = wp.mesh.geometry;
        if (!geo.boundingBox) geo.computeBoundingBox();
        bbc = geo.boundingBox.getCenter(V3());
      } catch (e) { logErr('bbox', e); }
      var P = {
        k: k, pc: wp.group, mesh: wp.mesh, g: g, bbc: bbc,
        where: 'plate', busy: false, eating: false, bites: 0, sauce: 0, slot: -1, tok: 0, flipTok: 0, leftCrumbs: false,
        pose: { live: false, c: V3(), e: 0, yaw: 0, tx: 0, tz: 0, q0: new THREE.Quaternion(), axis: V3(1, 0, 0), yd: 0 },
        home: V3()
      };
      centerOf(P, P.home);
      S.pieces.push(P);
    }

    try {
      G.world.setMood('day', 0);
      G.world.setMood('evening', 30);
      G.world.setFocus(W([0, 0.1]), 3.4);
      if (G.world.stove && G.world.stove.setFlame) G.world.stove.setFlame(0);
    } catch (e) { logErr('world', e); }
    try {
      ['sizzle', 'bubble', 'crackle', 'flame', 'steam'].forEach(function (n) { G.audio.loop(n, 0); });
      G.audio.muffle(0);
    } catch (e) { logErr('audio', e); }
    try { G.cam.frame({ center: W([FRAME.c[0], FRAME.c[2]]), w: FRAME.w, d: FRAME.d }, 0); } catch (e) { logErr('cam', e); }

    S.mode = 'play';
    G.input.set({ down: onDown, move: onMove, up: onUp, cancel: onUp });
    refreshHint();

    var pp = plate.position, cp = R.cup.position;
    S.emCup = G.fx.emitter(function () { return V3(cp.x + (Math.random() - 0.5) * 0.08, 0.8, cp.z + (Math.random() - 0.5) * 0.08); },
      { rate: 0.45, spread: 0.06, rise: 0.8, size: 0.28, life: 2.6, opacity: 0.16 });
    S.emPlate = G.fx.emitter(function () {
      var live = S.pieces.filter(function (P) { return P.where === 'plate'; });
      if (!live.length) return null;
      var P = live[(Math.random() * live.length) | 0];
      return V3(P.home.x, 0.5, P.home.z);
    }, { rate: 0.9, spread: 0.25, rise: 1.0, size: 0.5, life: 2.4, opacity: 0.15 });

    sc.guard(G.core.fade(0, 0.8));
    sc.wait(0.35).then(function () {
      sfx('ceramic', { vol: 0.3, pitch: 0.95 });
      G.fx.steam(V3(pp.x, 0.55, pp.z), { count: 9, spread: 0.7, rise: 1.3, size: 0.6, life: 2.6, opacity: 0.26 });
    });
  }

  function exit() {
    S.mode = 'off';
    try { G.input.clear(); } catch (_) { /* noop */ }
    try { G.hint.clear(); } catch (_) { /* noop */ }
    if (S.emPlate) { S.emPlate.stop(); S.emPlate = null; }
    if (S.emCup) { S.emCup.stop(); S.emCup = null; }
    S.drag = null;
    S.pieces.forEach(function (P) {
      P.tok++; P.flipTok++; P.pose.live = false;
      try { P.mesh.visible = true; P.g.setBite(0); P.g.setSauce(0); P.g.group.visible = true; } catch (e) { logErr('exit', e); }
    });
    try { G.kit.resetPieces(); } catch (e) { logErr('resetPieces', e); }
    if (R) {
      R.crumbs.forEach(function (m) { m.visible = false; });
      [R.myChop, R.mamaChop].forEach(function (c) { c.position.copy(c.userData.base); c.userData.chop.rotation.x = 0; c.userData.busy = false; });
      R.root.visible = false;
    }
    S.pieces = [];
  }

  G.flow.register('eat', {
    build: build,
    enter: enter,
    update: update,
    exit: exit,
    reset: function () { resetState(); }
  });
})();

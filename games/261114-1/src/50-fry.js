/* 50-fry.js — 場面「やく」(fry)。ならべる → 火をつける → 水を入れる(じゅわっ) → ふた → ふたをとる(羽根) → 火をけす → 皿 → ひっくり返す → お披露目 */
(function () {
  'use strict';
  var G = window.G;
  var V3 = function (x, y, z) { return new THREE.Vector3(x || 0, y || 0, z || 0); };
  var PI = Math.PI;

  /* ---------- 定数 ---------- */
  var BASE_FRAME = { center: [6, 0, 0.3], w: 3.4, d: 4.6 };
  var LIFT_G = 0.78;        // 持ち上げたぎょうざの底の高さ
  var LIFT_CUP = 0.95, LIFT_LID = 1.0, LIFT_PLATE = 1.05;
  var PLATE_ON_PAN = 0.675; // 裏返した大皿の原点（鍋の原点から）
  var PIV = 0.3;            // ひっくり返しの回転中心（鍋の原点から上）
  var FLIP_LIFT = 1.35;
  var KNOB_ON = 1.05, KNOB_WEAK = 1.12, KNOB_STRONG = 1.55, KNOB_MAX = 1.62;
  var FLIP_AXIS = V3(-1, 0, 1).normalize();
  var PAN_REST_YAW = PI / 2; // 柄が上へ上がって鍋をこえる向き
  var LOOPS = ['sizzle', 'bubble', 'crackle', 'flame', 'steam'];

  /* ---------- 物 ---------- */
  var pan = null, lid = null, cup = null, flipG = null, built = false;
  var PAN_POS = V3(5.75, 0.12, -0.7);

  /* ---------- 状態 ---------- */
  var st = null;
  function freshState() {
    return {
      step: 'none', busy: false, drag: null, pending: null,
      placed: {}, nPlaced: 0,
      knobRot: 0, lit: false, flame: 0, flameTarget: 0,
      water: 0, cook: 0, frying: false, lidOn: false, lidPlay: false,
      rattleT: 0.6, spatT: 0.3, hop: false,
      flipT: 0, flipping: false,
      aspectCls: null, rest: {}, loops: {}, emitters: [], crackleFade: null
    };
  }
  st = freshState();
  var sc = null;

  function S() { return G.shared; }
  function scene() { return G.core.scene; }
  function A() { return G.world.anchors.fry; }
  function stove() { return G.world.stove; }

  /* ---------- 小道具 ---------- */
  function setContact(o, v) { if (o && o.userData && o.userData.contact) o.userData.contact.visible = v; }
  function sfx(n, o) { try { G.audio.sfx(n, o); } catch (_) {} }
  function loop(n, v) {
    v = Math.max(0, Math.min(1, v));
    if (st.loops[n] != null && Math.abs(st.loops[n] - v) < 0.01) return;
    st.loops[n] = v;
    try { G.audio.loop(n, v); } catch (_) {}
  }
  function anim(sec, fn, ease, delay) {
    var o = { k: 0 };
    return sc.to(o, { k: 1 }, sec, { ease: ease || 'inOutQuad', delay: delay || 0, onUpdate: function () { fn(o.k); } });
  }
  function expect(name) {
    var scope = sc;
    return scope.guard(new Promise(function (res) { st.pending = { name: name, res: res }; }));
  }
  function done(name, v) {
    if (st.pending && st.pending.name === name) { var r = st.pending.res; st.pending = null; r(v); }
  }
  function worldPos(o, out) { o.updateMatrixWorld(true); return o.getWorldPosition(out || V3()); }
  function panCenter(dy) { return PAN_POS.clone().add(V3(0, dy == null ? 0.2 : dy, 0)); }
  function xzDist(a, b) { var dx = a.x - b.x, dz = a.z - b.z; return Math.sqrt(dx * dx + dz * dz); }
  function hitPts(p, pts, px) {
    var best = Infinity;
    for (var i = 0; i < pts.length; i++) { var s = G.input.toScreen(pts[i]); if (s.behind) continue; var d = Math.hypot(s.x - p.x, s.y - p.y); if (d < best) best = d; }
    return best <= (px || 70);
  }
  function lerpAngle(a, b, k) {
    var d = b - a;
    while (d > PI) d -= 2 * PI;
    while (d < -PI) d += 2 * PI;
    return a + d * k;
  }
  function rndRim(r, y) { var a = Math.random() * 2 * PI; return PAN_POS.clone().add(V3(Math.cos(a) * r, y, Math.sin(a) * r)); }
  function rndIn(r, y) { var a = Math.random() * 2 * PI, rr = Math.sqrt(Math.random()) * r; return PAN_POS.clone().add(V3(Math.cos(a) * rr, y, Math.sin(a) * rr)); }
  function emitter(fn, o) { var e = G.fx.emitter(fn, o); st.emitters.push(e); return e; }
  function stopEmitter(e) { if (!e) return; try { e.stop(); } catch (_) {} var i = st.emitters.indexOf(e); if (i >= 0) st.emitters.splice(i, 1); }
  function hint(o) { try { G.hint.set(o); } catch (_) {} }
  function unhint() { try { G.hint.clear(); } catch (_) {} }

  /* ---------- 置き場所（縦横で変える） ---------- */
  /* 横に広い画面（横持ちのスマホなど）だけ、こんろの左右に大きい物を置ける。4:3 の iPad 横では左右の余白が狭いので手前に置く */
  function land() { return (G.core.aspect || 0.5) >= 1.6; }
  function restPos(kind) {
    var L = land();
    switch (kind) {
      // 天板の手前の縁は z=2.6。縦持ちでは大きい物（ふた・大皿）を、鍋に当たらない右手前（こんろのガラスに一部かかる）へ
      case 'tray': return V3(6.0, 0, 2.05);
      case 'cup': return V3(6.95, 0, 2.05);
      case 'lid': return L ? V3(3.05, 0, 0.5) : V3(6.75, 0.013, 1.55);
      case 'plate': return L ? V3(8.45, 0, 0.55) : V3(6.9, 0.013, 1.5);
    }
    return V3(6, 0, 2);
  }
  function offPos(kind) {
    var r = restPos(kind);
    return r.add(V3(kind === 'lid' && land() ? -6.5 : 6.5, 0, 0));
  }

  /* ---------- build ---------- */
  function build() {
    if (built) return;
    built = true;
    var P = G.props;
    pan = P.pan(); pan.name = 'fryPan';
    lid = P.lid(); lid.name = 'fryLid';
    cup = P.cup(); cup.name = 'fryCup';
    flipG = new THREE.Group(); flipG.name = 'fryFlip';
    try { if (G.world.stove && G.world.stove.burnerPos) PAN_POS.copy(G.world.stove.burnerPos); } catch (_) {}
    scene().add(pan); scene().add(lid); scene().add(cup); scene().add(flipG);
    pan.position.copy(PAN_POS);
    lid.visible = false; cup.visible = false;
  }

  /* ---------- 物の初期化 ---------- */
  function resetProps() {
    var sh = S(), sn = scene();
    // ひっくり返しのグループを空に
    sn.attach(pan);
    pan.position.copy(PAN_POS); pan.rotation.set(0, 0, 0); pan.visible = true;
    pan.userData.setWater(0, 0);
    flipG.position.set(0, 0, 0); flipG.rotation.set(0, 0, 0); flipG.quaternion.identity();
    lid.position.copy(offPos('lid')); lid.rotation.set(0, 0, 0); lid.visible = false; lid.userData.setFog(0);
    cup.position.copy(offPos('cup')); cup.rotation.set(0, 0, 0); cup.visible = false;
    cup.userData.setLevel(0.75); cup.userData.stream.visible = false; cup.userData.stream.scale.y = 0.001;
    if (sh.plate) {
      if (sh.plate.parent !== sn) sn.add(sh.plate);
      sh.plate.position.copy(offPos('plate')); sh.plate.rotation.set(0, 0, 0); sh.plate.visible = false;
    }
    var k = stove().knob; k.rotation.set(0, 0, 0);
    stove().setFlame(0);
  }

  function setupGyozas() {
    var sh = S(), K = G.kit;
    K.detachAll();
    K.applyState();
    sh.gyozas.forEach(function (g) {
      g.setShape({ fold: 1, stand: 1 }); g.setCook(0); g.setBrown(0); g.setBite(0); g.setSauce(0);
      g.group.visible = true;
    });
    K.layoutWing(); // 重いので最初に
    var w = sh.wing;
    pan.add(w.group);
    w.group.position.set(0, pan.userData.floorY, 0); w.group.rotation.set(0, 0, 0);
    w.setGrow(0); w.setCrisp(0); w.group.visible = false;
    var tray = sh.tray;
    if (tray.parent !== scene()) scene().add(tray);
    tray.rotation.set(0, 0, 0); tray.visible = true; setContact(tray, true);
    for (var i = 0; i < 6; i++) {
      var g = sh.gyozas[i], s = tray.userData.slots[i];
      tray.add(g.group);
      g.group.position.set(s.x, s.y, s.z);
      g.group.rotation.set(0, PI / 2, 0);
    }
  }

  /* ---------- enter ---------- */
  function enter(scope) {
    sc = scope;
    // 前回の残り
    st.emitters.slice().forEach(stopEmitter);
    st = freshState();
    build();
    resetProps();
    setupGyozas();
    G.world.setMood('day', 0);
    G.world.setFocus(V3(6, 0, 0.6), 4.4);
    LOOPS.forEach(function (n) { loop(n, 0); });
    try { G.audio.muffle(0); } catch (_) {}
    st.aspectCls = land();
    G.input.set({ down: onDown, move: onMove, up: onUp, cancel: onUp });
    run(scope).catch(function (e) { try { console.error('[fry]', e); } catch (_) {} });
  }

  /* ---------- 流れ ---------- */
  async function run(scope) {
    var sh = S(), tray = sh.tray;
    var carry = sh.carry === true;
    sh.carry = false;
    var tp = restPos('tray');
    if (carry) {
      tray.position.set(0, 0, -1.25);
      st.busy = true;
      setContact(tray, false);
      G.cam.frame(BASE_FRAME, 1.6);
      var from = tray.position.clone();
      await anim(1.6, function (k) {
        tray.position.lerpVectors(from, tp, k);
        tray.position.y = Math.sin(PI * Math.min(1, k * 1.05)) * 0.35 * (1 - k * 0.2);
      }, 'inOutCubic');
      tray.position.copy(tp);
      setContact(tray, true);
      sfx('metal', { vol: 0.35 });
    } else {
      tray.position.copy(tp);
      G.cam.frame(BASE_FRAME, 0);
    }
    st.rest.tray = true;
    st.busy = true;
    await scope.wait(0.35);

    /* 0. ママのお手本 */
    for (var i = 0; i < 3; i++) {
      await flyToPan(i, 0.45, 0.55);
      await scope.wait(0.12);
    }
    st.busy = false;

    /* 1. ならべる */
    st.step = 'place';
    hintPlace();
    await expect('placed');
    unhint();
    st.busy = true;
    await scope.wait(0.3);
    st.rest.tray = false;
    var tfrom = tray.position.clone(), tto = tfrom.clone().add(V3(7, 0, 0));
    sfx('whoosh', { vol: 0.35 });
    await anim(0.7, function (k) { tray.position.lerpVectors(tfrom, tto, k); }, 'inQuad');
    tray.visible = false;
    st.busy = false;

    /* 2. 火をつける */
    st.step = 'ignite';
    hintKnob(true);
    await expect('lit');
    unhint();
    st.step = 'frying';
    st.frying = true;
    var fe = emitter(function () { return rndIn(0.8, 0.08); }, { rate: 2.2, spread: 0.1, rise: 0.9, size: 0.32, life: 1.6, opacity: 0.16 });
    await anim(1.8, function (k) { loop('sizzle', (0.25 + 0.35 * st.flame) * k); }, 'outQuad', 0.25);
    st.fryEm = fe;

    /* 3. 水を入れる */
    st.step = 'pour';
    st.busy = true;
    cup.visible = true; cup.position.copy(offPos('cup'));
    var cp = restPos('cup'), cf = cup.position.clone();
    sfx('whoosh', { vol: 0.3 });
    await anim(0.6, function (k) { cup.position.lerpVectors(cf, cp, k); }, 'outCubic');
    st.rest.cup = true;
    st.busy = false;
    hintCup();
    await expect('poured');
    unhint();

    /* 4. ふたをする */
    st.step = 'lid';
    st.busy = true;
    lid.visible = true; lid.position.copy(offPos('lid')); lid.rotation.set(0, 0, 0);
    var lf = lid.position.clone(), lp = restPos('lid');
    sfx('whoosh', { vol: 0.3 });
    await anim(0.6, function (k) { lid.position.lerpVectors(lf, lp, k); }, 'outCubic');
    st.rest.lid = true;
    st.busy = false;
    hintLid();
    await expect('covered');
    unhint();
    // 蒸し焼き
    st.step = 'steaming';
    st.lidOn = true;
    try { G.audio.muffle(1); } catch (_) {}
    stopEmitter(st.fryEm); st.fryEm = null;
    st.rimEm = emitter(function () { return rndRim(1.2, 0.5); }, { rate: 3.5, spread: 0.05, rise: 0.8, size: 0.22, life: 1.4, opacity: 0.2 });
    loop('steam', 0.35);
    anim(1.4, function (k) { lid.userData.setFog(k); });
    var sh0 = st;
    await anim(4.6, function (k) {
      sh0.cook = k;
      sh.gyozas.forEach(function (g) { g.setCook(k); });
      sh0.water = 1 - k;
      loop('bubble', 0.7 * Math.min(1, (1 - k) * 4));
      loop('sizzle', 0.45 + 0.2 * st.flame);
    }, 'linear', 0.3);
    st.water = 0;
    pan.userData.setWater(0);
    loop('bubble', 0);
    loop('crackle', 0.45);
    sfx('crack', { vol: 0.25 });

    /* 5. ふたをとる */
    st.step = 'unlid';
    hintUnlid();
    await expect('uncovered');
    unhint();
    st.step = 'reveal';
    st.busy = true;
    var wing = sh.wing;
    G.cam.frame({ center: [PAN_POS.x, 0.12, PAN_POS.z + 0.2], w: 2.9, d: 2.9 }, 1.1);
    await scope.wait(0.35);
    wing.group.visible = true;
    sfx('sizzleBurst', { vol: 0.25 });
    await anim(3.5, function (k) { wing.setGrow(k); loop('crackle', 0.45 + 0.15 * k); }, 'inOutQuad');
    await anim(3.0, function (k) {
      wing.setCrisp(k);
      sh.gyozas.forEach(function (g) { g.setBrown(k); });
      loop('crackle', 0.6 + 0.35 * k);
      if (Math.random() < 0.08) G.fx.burst(rndIn(0.95, pan.userData.floorY + 0.05), 'spark', { count: 1, size: 1.6, speed: 0.4, life: 0.5 });
    }, 'inOutQuad');
    sfx('crack', { vol: 0.9 });
    G.fx.steam(panCenter(0.15), { count: 5, spread: 0.6, rise: 1.0, size: 0.5, opacity: 0.2 });
    await scope.wait(0.4);
    await scope.guard(G.cam.frame(BASE_FRAME, 1.0));
    st.busy = false;

    /* 6. 火をけす */
    st.step = 'off';
    hintKnob(false);
    await expect('off');
    unhint();
    st.frying = false;
    st.busy = true;
    anim(3.2, function (k) { loop('crackle', 0.35 * (1 - k)); }, 'inQuad', 0.6);
    await scope.wait(0.4);

    /* 7. 皿をかぶせる */
    st.step = 'plate';
    var plate = sh.plate;
    // ふたは退く
    if (lid.visible) {
      st.rest.lid = false;
      var lf2 = lid.position.clone(), lt2 = offPos('lid');
      anim(0.6, function (k) { lid.position.lerpVectors(lf2, lt2, k); }, 'inQuad').then(function () { lid.visible = false; });
    }
    plate.visible = true; plate.rotation.set(0, 0, 0);
    plate.position.copy(offPos('plate'));
    var pf = plate.position.clone(), pt = restPos('plate');
    sfx('whoosh', { vol: 0.3 });
    await anim(0.75, function (k) { plate.position.lerpVectors(pf, pt, k); }, 'outCubic', 0.15);
    st.rest.plate = true;
    st.busy = false;
    hintPlate();
    await expect('plated');
    unhint();

    /* 8. ひっくり返す */
    prepareFlip();
    st.step = 'flip';
    hintFlip();
    await expect('flipped');
    unhint();
    st.step = 'landed';
    st.busy = true;
    sfx('ceramic', { vol: 1 });
    G.cam.shake(0.012, 0.25);
    // 中身が皿に落ち着く
    var tgtW = V3(plate.position.x, 0, plate.position.z);
    // 皿の位置は flipG の中で決まっている: ワールドで確定させる
    var pw = worldPos(plate);
    tgtW.set(pw.x, pw.y + plate.userData.topY + G.kit.platedY, pw.z);
    pan.updateMatrixWorld(true);
    var loc = pan.worldToLocal(tgtW.clone());
    var y0 = wing.group.position.y, y1 = loc.y;
    await anim(0.42, function (k) { wing.group.position.y = y0 + (y1 - y0) * k; }, 'outBounce');
    wing.group.position.set(0, y1, 0);
    sfx('crunch', { vol: 0.3 });
    await scope.wait(0.25);

    /* 9. お披露目: 鍋が離れる */
    scene().attach(plate);
    var eu = new THREE.Euler().setFromQuaternion(plate.quaternion, 'YXZ');
    plate.rotation.set(0, eu.y, 0); plate.position.y = restPos('plate').y;
    G.kit.assemblePlated();
    scene().attach(pan);
    var q0 = pan.quaternion.clone(), p0 = pan.position.clone();
    sfx('metal', { vol: 0.4 });
    var qa = new THREE.Quaternion(), qy = new THREE.Quaternion(), YAX = V3(0, 1, 0);
    await anim(1.1, function (k) {
      var e = k;
      pan.position.lerpVectors(p0, PAN_POS, e);
      pan.position.y += Math.sin(PI * Math.min(1, k * 1.15)) * 1.1;
      // 戻すときは柄を右奥へ向けて置く（盛りつけた大皿に柄がかからないように）
      qy.setFromAxisAngle(YAX, PAN_REST_YAW * e);
      qa.setFromAxisAngle(FLIP_AXIS, PI * (1 - e)).premultiply(qy);
      pan.quaternion.copy(qa);
    }, 'inOutQuad');
    pan.position.copy(PAN_POS); pan.rotation.set(0, PAN_REST_YAW, 0);
    sfx('metal', { vol: 0.25 });
    st.step = 'show';
    var ppos = plate.position.clone();
    sfx('crack', { vol: 1 });
    try { G.audio.phrase('reveal'); } catch (_) {}
    G.fx.steam(ppos.clone().add(V3(0, 0.45, 0)), { count: 9, spread: 0.7, rise: 1.3, size: 0.6, opacity: 0.26 });
    G.fx.burst(ppos.clone().add(V3(0, 0.5, 0)), 'crumb', { count: 8, size: 1.6, speed: 0.9, floor: ppos.y + 0.1 });
    G.cam.frame({ center: [ppos.x - 0.1, 0.2, ppos.z - 0.2], w: 3.5, d: 3.2 }, 1.0);
    st.busy = false;
    await scope.wait(2.6);

    /* 10. 皿を手前へ運びながら暗転 → eat */
    st.step = 'leave';
    st.busy = true;
    var pp0 = plate.position.clone();
    anim(0.9, function (k) { plate.position.set(pp0.x, pp0.y + 0.3 * Math.sin(Math.min(1, k * 1.4) * PI / 2), pp0.z + 0.7 * k); }, 'inOutQuad');
    await scope.guard(G.core.fade(1, 0.6));
    plate.rotation.y = 0;
    G.flow.go('eat');
  }

  /* ---------- 0. ママのぎょうざを鍋へ ---------- */
  function slotWorld(i) {
    var s = G.kit.panSlot(G.kit.slotOf(i));
    return { pos: PAN_POS.clone().add(V3(s.x, pan.userData.floorY, s.z)), rot: s.rot };
  }
  async function flyToPan(i, dur, h) {
    var g = S().gyozas[i];
    scene().attach(g.group);
    var from = g.group.position.clone(), r0 = g.group.rotation.y, tgt = slotWorld(i);
    sfx('pop', { vol: 0.35, pitch: 1 + i * 0.05 });
    await anim(dur, function (k) {
      g.group.position.lerpVectors(from, tgt.pos, k);
      g.group.position.y += Math.sin(PI * k) * h;
      g.group.rotation.set(0, lerpAngle(r0, tgt.rot, k), 0);
    }, 'inOutQuad');
    G.kit.placeInPan(i, pan);
    sfx('plop', { vol: 0.4 });
    G.fx.burst(tgt.pos.clone().add(V3(0, 0.04, 0)), 'spark', { count: 4, size: 1.6, speed: 0.5, life: 0.5 });
  }

  /* ---------- ヒント ---------- */
  function nextOwn() { for (var i = 3; i < 6; i++) if (!st.placed[i]) return i; return -1; }
  function hintPlace() {
    var i = nextOwn();
    if (i < 0) return;
    var g = S().gyozas[i];
    hint({
      target: g.group, radius: 0.36, wobble: g.group,
      demo: { type: 'drag', path: function () { return [worldPos(g.group).add(V3(0, 0.2, 0)), slotWorld(i).pos.add(V3(0, 0.35, 0))]; } }
    });
  }
  function knobArc(from, to) {
    var kp = stove().knobPos, pts = [];
    for (var j = 0; j <= 8; j++) {
      var a = from + (to - from) * j / 8;
      pts.push(V3(kp.x - Math.sin(a) * 0.24, kp.y + 0.12, kp.z - Math.cos(a) * 0.24));
    }
    return pts;
  }
  function hintKnob(on) {
    var kn = stove().knob;
    hint({
      target: kn, radius: 0.36,
      demo: { type: 'drag', path: function () { return on ? knobArc(0, 1.45) : knobArc(st.knobRot, 0); } }
    });
  }
  function hintCup() {
    hint({
      target: cup, radius: 0.42, wobble: cup,
      demo: { type: 'drag', path: function () { return [worldPos(cup).add(V3(0, 0.5, 0)), panCenter(0.75)]; } }
    });
  }
  function hintLid() {
    hint({
      target: lid, radius: 0.95, wobble: lid,
      demo: { type: 'drag', path: function () { return [worldPos(lid).add(V3(0, 0.5, 0)), panCenter(1.0)]; } }
    });
  }
  function lidKnobWorld() { return lid.localToWorld(lid.userData.knobTop.clone().add(V3(0, -0.08, 0))); }
  function hintUnlid() {
    hint({
      target: function () { return lidKnobWorld(); }, radius: 0.32, ringY: PAN_POS.y + 0.78,
      demo: { type: 'drag', path: function () { return [lidKnobWorld(), restPos('lid').add(V3(0, 0.5, 0))]; } }
    });
  }
  function hintPlate() {
    var plate = S().plate;
    hint({
      target: plate, radius: 1.0, wobble: plate,
      demo: { type: 'drag', path: function () { return [worldPos(plate).add(V3(0, 0.1, 0)), panCenter(1.0)]; } }
    });
  }
  function gripAt(t, out) {
    flipPose(t, _fp, _fq);
    out = out || V3();
    out.copy(pan.userData.handleGrip).add(V3(0, -PIV, 0)).applyQuaternion(_fq).add(_fp);
    return out;
  }
  function hintFlip() {
    hint({
      target: function () { return gripAt(st.flipT); }, radius: 0.34,
      demo: { type: 'drag', path: function () { var a = []; for (var j = 0; j <= 10; j++) a.push(gripAt(j / 10)); return a; } }
    });
  }

  /* ---------- 8. ひっくり返し ---------- */
  var _fp = V3(), _fq = new THREE.Quaternion(), FLIP_FROM = V3(), FLIP_TO = V3();
  function flipPose(t, outP, outQ) {
    var e = t * t * (3 - 2 * t);
    outP.lerpVectors(FLIP_FROM, FLIP_TO, e);
    outP.y += Math.sin(PI * t) * FLIP_LIFT;
    outQ.setFromAxisAngle(FLIP_AXIS, PI * t);
  }
  function applyFlip(t) {
    flipPose(t, flipG.position, flipG.quaternion);
  }
  function prepareFlip() {
    var sh = S(), w = sh.wing, plate = sh.plate;
    // ぎょうざを羽根のかけらの中へ（見た目は変わらない）
    for (var k = 0; k < 6; k++) {
      var g = sh.gyozas[G.kit.gyozaAtSlot(k)], s = G.kit.panSlot(k), pc = w.pieces[k].group;
      pc.add(g.group);
      g.group.position.set(0, 0, 0); g.group.rotation.set(0, s.rot, 0);
    }
    FLIP_FROM.copy(PAN_POS).add(V3(0, PIV, 0));
    var pr = restPos('plate');
    FLIP_TO.set(pr.x, PLATE_ON_PAN - PIV + pr.y, pr.z);
    flipG.position.copy(FLIP_FROM); flipG.quaternion.identity();
    flipG.updateMatrixWorld(true);
    flipG.attach(pan); flipG.attach(plate);
    pan.position.set(0, -PIV, 0); pan.rotation.set(0, 0, 0);
    plate.position.set(0, PLATE_ON_PAN - PIV, 0); plate.rotation.set(PI, 0, 0);
    st.flipT = 0;
    st.rest.plate = false;
  }

  /* ---------- 入力 ---------- */
  function onDown(p) {
    if (st.busy || st.drag) {
      // 蒸し焼き中の「ふたタップ」だけは受ける
      if (st.step === 'steaming' && !st.drag) tryHop(p);
      return;
    }
    var sh = S();
    switch (st.step) {
      case 'place': {
        var best = -1, bd = 1e9;
        for (var i = 3; i < 6; i++) {
          if (st.placed[i]) continue;
          var gp = worldPos(sh.gyozas[i].group).add(V3(0, 0.18, 0));
          var d = G.input.screenDist(p, gp);
          if (d < bd) { bd = d; best = i; }
        }
        if (best >= 0 && bd <= 72) startGyozaDrag(best, p);
        break;
      }
      case 'ignite': case 'off':
        if (hitPts(p, [stove().knobPos], 90)) startKnobDrag(p);
        break;
      case 'pour':
        if (hitPts(p, [worldPos(cup).add(V3(0, 0.25, 0)), worldPos(cup).add(V3(0, 0.5, 0))], 72) || G.input.pick(p, cup)) startCarry('cup', cup, LIFT_CUP, p);
        break;
      case 'lid':
        if (hitPts(p, [worldPos(lid).add(V3(0, 0.3, 0))], 90) || G.input.pick(p, lid)) startCarry('lid', lid, LIFT_LID, p);
        break;
      case 'steaming':
        tryHop(p);
        break;
      case 'unlid':
        if (hitPts(p, [lidKnobWorld()], 80) || G.input.pick(p, lid)) startUnlid(p);
        break;
      case 'plate':
        if (hitPts(p, [worldPos(sh.plate).add(V3(0, 0.1, 0))], 90) || G.input.pick(p, sh.plate)) startCarry('plate', sh.plate, LIFT_PLATE, p);
        break;
      case 'flip': {
        var pts = [gripAt(st.flipT), flipG.localToWorld(pan.userData.handleTip.clone().add(V3(0, -PIV, 0))),
          flipG.localToWorld(pan.userData.handleGrip.clone().multiplyScalar(0.75).add(V3(0, -PIV, 0)))];
        if (hitPts(p, pts, 78)) startFlip(p);
        break;
      }
      case 'show':
        if (G.input.pick(p, sh.plate) || hitPts(p, [worldPos(sh.plate).add(V3(0, 0.4, 0))], 120)) {
          sfx('crack', { vol: 0.8, pitch: 0.9 + Math.random() * 0.25 });
          var hp = G.input.planeHit(p, 0.45) || worldPos(sh.plate).add(V3(0, 0.45, 0));
          G.fx.burst(hp, 'crumb', { count: 6, size: 1.5, speed: 0.8, floor: 0.1 });
        }
        break;
    }
  }
  function onMove(p) {
    var d = st.drag;
    if (!d) return;
    if (d.kind === 'gyoza' || d.kind === 'carry' || d.kind === 'unlid') {
      var h = G.input.planeHit(p, d.y);
      if (h) { d.target.copy(h).add(V3(0, 0, -0.3)); }
      if (d.kind === 'carry' && d.name === 'cup') checkPour();
    } else if (d.kind === 'knob') {
      knobMove(p);
    } else if (d.kind === 'flip') {
      flipMove(p);
    }
  }
  function onUp(p) {
    var d = st.drag;
    if (!d) return;
    st.drag = null;
    if (d.kind === 'gyoza') dropGyoza(d);
    else if (d.kind === 'carry') dropCarry(d);
    else if (d.kind === 'unlid') dropUnlid(d);
    else if (d.kind === 'knob') knobUp();
    else if (d.kind === 'flip') flipUp();
    void p;
  }

  /* ---- ぎょうざ ---- */
  function startGyozaDrag(i, p) {
    var g = S().gyozas[i];
    scene().attach(g.group);
    var t = G.input.planeHit(p, LIFT_G) || worldPos(g.group).add(V3(0, LIFT_G, 0));
    st.drag = { kind: 'gyoza', i: i, obj: g.group, y: LIFT_G, target: t.add(V3(0, 0, -0.3)) };
    sfx('pop', { vol: 0.6 });
    unhint();
  }
  function dropGyoza(d) {
    var i = d.i, g = S().gyozas[i];
    st.busy = true;
    var from = g.group.position.clone(), r0 = g.group.rotation.y;
    if (xzDist(from, PAN_POS) < 1.65) {
      var tgt = slotWorld(i);
      anim(0.28, function (k) {
        g.group.position.lerpVectors(from, tgt.pos, k);
        g.group.position.y += Math.sin(PI * k) * 0.12;
        g.group.rotation.set(0, lerpAngle(r0, tgt.rot, k), 0);
      }, 'outQuad').then(function () {
        G.kit.placeInPan(i, pan);
        sfx('plop', { vol: 0.45 });
        G.fx.burst(tgt.pos.clone().add(V3(0, 0.04, 0)), 'spark', { count: 3, size: 1.5, speed: 0.4, life: 0.45 });
        st.placed[i] = true; st.nPlaced++;
        st.busy = false;
        if (st.nPlaced >= 3) done('placed'); else hintPlace();
      });
    } else {
      var tray = S().tray, s = tray.userData.slots[i];
      var tp = tray.localToWorld(V3(s.x, s.y, s.z));
      anim(0.32, function (k) {
        g.group.position.lerpVectors(from, tp, k);
        g.group.position.y += Math.sin(PI * k) * 0.1;
        g.group.rotation.set(0, lerpAngle(r0, PI / 2, k), 0);
      }, 'outQuad').then(function () {
        tray.add(g.group); g.group.position.set(s.x, s.y, s.z); g.group.rotation.set(0, PI / 2, 0);
        sfx('tap', { vol: 0.3 });
        st.busy = false;
        hintPlace();
      });
    }
  }

  /* ---- つまみ ---- */
  function knobScreen() { return G.input.toScreen(stove().knobPos); }
  function startKnobDrag(p) {
    var c = knobScreen();
    st.drag = { kind: 'knob', a: Math.atan2(-(p.y - c.y), p.x - c.x), x: p.x, r0: st.knobRot };
    sfx('click', { vol: 0.35 });
    unhint();
  }
  function knobMove(p) {
    var d = st.drag, c = knobScreen();
    var dx = p.x - c.x, dy = p.y - c.y, r = Math.hypot(dx, dy);
    var a = Math.atan2(-dy, dx), da;
    if (r > 26) {
      da = a - d.a;
      while (da > PI) da -= 2 * PI;
      while (da < -PI) da += 2 * PI;
    } else {
      da = -(p.x - d.x) * 0.02;
    }
    d.a = a; d.x = p.x;
    var nr = Math.max(-KNOB_MAX, Math.min(KNOB_MAX, st.knobRot + da));
    setKnob(nr);
  }
  function strengthOf(r) { return 0.5 + 0.5 * Math.max(0, Math.min(1, (Math.abs(r) - KNOB_ON) / (KNOB_STRONG - KNOB_ON))); }
  function setKnob(r) {
    st.knobRot = r;
    stove().knob.rotation.y = r;
    var ar = Math.abs(r);
    if (st.step === 'ignite') {
      if (!st.lit && ar >= KNOB_ON) {
        st.lit = true;
        sfx('ignite', { vol: 0.9 });
        st.flameDelay = 0.32;
      }
      if (st.lit) st.flameTarget = strengthOf(r);
    } else if (st.step === 'off') {
      if (st.lit) {
        if (ar < 0.5) { knobOff(); } else st.flameTarget = strengthOf(r) * Math.min(1, ar / KNOB_ON);
      }
    }
  }
  function knobUp() {
    var r = st.knobRot, ar = Math.abs(r), sg = r < 0 ? -1 : 1;
    if (st.step === 'ignite') {
      if (st.lit) {
        var tgt = (Math.abs(ar - KNOB_WEAK) < Math.abs(ar - KNOB_STRONG) ? KNOB_WEAK : KNOB_STRONG) * sg;
        st.busy = true;
        anim(0.18, function (k) { stove().knob.rotation.y = r + (tgt - r) * k; }, 'outQuad').then(function () {
          setKnob(tgt);
          sfx('click', { vol: 0.25 });
          st.busy = false;
          done('lit');
        });
      } else {
        st.busy = true;
        anim(0.25, function (k) { stove().knob.rotation.y = r * (1 - k); }, 'outQuad').then(function () { st.knobRot = 0; st.busy = false; hintKnob(true); });
      }
    } else if (st.step === 'off') {
      if (st.lit) {
        // まだ消えていない: 最寄りの弱/強へ戻す
        var tg2 = (ar < (KNOB_WEAK + KNOB_STRONG) / 2 ? KNOB_WEAK : KNOB_STRONG) * sg;
        st.busy = true;
        anim(0.2, function (k) { stove().knob.rotation.y = r + (tg2 - r) * k; }, 'outQuad').then(function () {
          st.knobRot = tg2; st.flameTarget = strengthOf(tg2); st.busy = false; hintKnob(false);
        });
      }
    }
  }
  function knobOff() {
    st.lit = false;
    st.flameTarget = 0;
    var r = st.knobRot;
    st.drag = null;
    st.busy = true;
    sfx('click', { vol: 0.8 });
    anim(0.2, function (k) { stove().knob.rotation.y = r * (1 - k); }, 'outQuad').then(function () {
      st.knobRot = 0; st.busy = false; done('off');
    });
    loop('flame', 0);
    loop('sizzle', 0);
    loop('crackle', 0.35);
    stopEmitter(st.fryEm); st.fryEm = null;
  }

  /* ---- 運ぶ物（カップ・ふた・大皿） ---- */
  function startCarry(name, obj, y, p) {
    var t = G.input.planeHit(p, y) || worldPos(obj).add(V3(0, y, 0));
    st.drag = { kind: 'carry', name: name, obj: obj, y: y, target: t.add(V3(0, 0, -0.3)) };
    st.rest[name] = false;
    setContact(obj, false);
    sfx(name === 'plate' ? 'ceramic' : name === 'lid' ? 'lid' : 'clink', { vol: 0.3 });
    unhint();
  }
  function checkPour() {
    var d = st.drag;
    if (!d || d.name !== 'cup') return;
    if (xzDist(cup.position, PAN_POS) < 1.3) {
      st.drag = null;
      st.busy = true;
      doPour();
    }
  }
  function dropCarry(d) {
    var obj = d.obj, name = d.name;
    if (name === 'cup') {
      if (xzDist(cup.position, PAN_POS) < 1.45) { st.busy = true; doPour(); return; }
      backToRest('cup', hintCup);
    } else if (name === 'lid') {
      if (xzDist(lid.position, PAN_POS) < 1.7) { coverLid(); return; }
      backToRest('lid', hintLid);
    } else if (name === 'plate') {
      if (xzDist(obj.position, PAN_POS) < 1.8) { coverPlate(); return; }
      backToRest('plate', hintPlate);
    }
  }
  function backToRest(name, rehint) {
    var obj = name === 'plate' ? S().plate : name === 'lid' ? lid : cup;
    var from = obj.position.clone(), to = restPos(name);
    st.busy = true;
    anim(0.4, function (k) { obj.position.lerpVectors(from, to, k); obj.position.y += Math.sin(PI * k) * 0.1 * (1 - k); }, 'outQuad').then(function () {
      obj.position.copy(to);
      setContact(obj, true);
      st.rest[name] = true;
      sfx(name === 'plate' ? 'ceramic' : name === 'lid' ? 'lid' : 'clink', { vol: 0.25 });
      st.busy = false;
      rehint();
    });
  }

  /* ---- 3. 注ぐ ---- */
  async function doPour() {
    var ud = cup.userData, from = cup.position.clone(), to = PAN_POS.clone().add(V3(0.42, 1.08, 0.3));
    var stream = ud.stream;
    await anim(0.35, function (k) { cup.position.lerpVectors(from, to, k); cup.rotation.z = 0.5 * k; }, 'outQuad');
    sfx('pour', { vol: 0.8 });
    await anim(0.3, function (k) { cup.rotation.z = 0.5 + 0.85 * k; }, 'inQuad');
    stream.visible = true;
    var sp = V3(), surfY = PAN_POS.y + pan.userData.floorY + 0.01;
    var hit = false;
    await anim(2.2, function (k) {
      cup.updateMatrixWorld(true);
      sp.copy(ud.spout); cup.localToWorld(sp);
      var len = Math.max(0.01, sp.y - (surfY + st.water * 0.05));
      stream.scale.y = Math.min(len, (k * 2.2) / 0.12 * len);
      ud.setLevel(0.75 * (1 - k));
      cup.rotation.z = 1.35 + 0.3 * k;
      if (!hit && k > 0.06) {
        hit = true;
        sfx('sizzleBurst', { vol: 1 });
        var c = V3(sp.x, surfY + 0.1, sp.z);
        G.fx.steam(c, { count: 20, spread: 0.8, rise: 3.6, size: 1.35, life: 3.0, opacity: 0.62 });
        G.fx.steam(panCenter(0.5), { count: 18, spread: 1.6, rise: 2.4, size: 1.3, life: 2.6, opacity: 0.6 });
        // じゅわっ の第二波: 少し遅れて、鍋の上へ高く立ちのぼる（白い壁やこんろの上でも見える大きさ）
        sc.wait(0.35).then(function () { G.fx.steam(panCenter(0.9), { count: 16, spread: 1.2, rise: 4.2, size: 1.7, life: 3.2, opacity: 0.6 }); });
        G.fx.burst(c, 'drop', { count: 10, size: 1.4, speed: 1.4, floor: surfY });
        G.cam.shake(0.015, 0.4);
        loop('sizzle', 1);
        loop('bubble', 0.65);
        stopEmitter(st.fryEm);
        st.fryEm = emitter(function () { return rndIn(0.9, 0.1); }, { rate: 7, spread: 0.15, rise: 1.4, size: 0.55, life: 2.0, opacity: 0.26 });
      }
      st.water = Math.min(1, k * 1.15);
      if (Math.random() < 0.3) G.fx.steam(V3(sp.x, surfY + 0.05, sp.z), { count: 1, spread: 0.2, rise: 1.2, size: 0.5, opacity: 0.25 });
      if (Math.random() < 0.3) G.fx.steam(rndRim(1.1, 0.5), { count: 1, spread: 0.15, rise: 1.4, size: 0.6, opacity: 0.3 });
    }, 'linear');
    st.water = 1;
    stream.visible = false;
    loop('sizzle', 0.7);
    await anim(0.35, function (k) { cup.rotation.z = 1.65 * (1 - k); }, 'inOutQuad');
    var rf = cup.position.clone(), rt = offPos('cup');
    sfx('whoosh', { vol: 0.3 });
    await anim(0.7, function (k) { cup.position.lerpVectors(rf, rt, k); cup.position.y = rf.y * (1 - k); }, 'inOutQuad');
    cup.visible = false;
    st.busy = false;
    done('poured');
  }

  /* ---- 4. ふた ---- */
  function lidOnPos() { return PAN_POS.clone().add(V3(0, pan.userData.rimY + 0.006, 0)); }
  function coverLid() {
    st.busy = true;
    var from = lid.position.clone(), to = lidOnPos();
    anim(0.32, function (k) { lid.position.lerpVectors(from, to, k); }, 'inQuad').then(function () {
      lid.position.copy(to);
      sfx('lid', { vol: 1 });
      G.cam.shake(0.006, 0.15);
      st.busy = false;
      done('covered');
    });
  }
  function tryHop(p) {
    if (!st.lidOn || st.hop) return;
    if (!(G.input.pick(p, lid) || hitPts(p, [lidKnobWorld()], 90))) return;
    st.hop = true;
    var y0 = lidOnPos().y;
    sfx('puff', { vol: 0.9 });
    sfx('lid', { vol: 0.25, delay: 0.24 });
    for (var j = 0; j < 4; j++) G.fx.steam(rndRim(1.15, 0.55), { count: 2, spread: 0.1, rise: 1.3, size: 0.45, life: 1.6, opacity: 0.32 });
    anim(0.32, function (k) { lid.position.y = y0 + Math.sin(PI * k) * 0.16; lid.rotation.z = Math.sin(PI * k) * 0.05; }, 'linear').then(function () {
      lid.position.y = y0; lid.rotation.z = 0; st.hop = false;
    });
  }

  /* ---- 5. ふたをとる ---- */
  function startUnlid(p) {
    var t = G.input.planeHit(p, LIFT_LID) || lidOnPos().add(V3(0, 0.4, 0));
    st.drag = { kind: 'unlid', obj: lid, y: LIFT_LID, target: t.add(V3(0, 0, -0.3)), opened: false };
    st.lidOn = false;
    lid.rotation.set(0, 0, 0);
    sfx('lid', { vol: 0.5 });
    unhint();
    openSteam();
  }
  function openSteam() {
    if (st.opened) return;
    st.opened = true;
    try { G.audio.muffle(0); } catch (_) {}
    stopEmitter(st.rimEm); st.rimEm = null;
    loop('steam', 0.15);
    G.fx.steam(panCenter(0.25), { count: 20, spread: 0.85, rise: 2.0, size: 1.05, life: 2.8, opacity: 0.4 });
    sfx('whoosh', { vol: 0.25 });
    st.fryEm = emitter(function () { return rndIn(0.9, 0.08); }, { rate: 2.5, spread: 0.1, rise: 1.1, size: 0.4, life: 1.8, opacity: 0.18 });
    anim(2.0, function (k) { lid.userData.setFog(1 - 0.7 * k); });
  }
  function dropUnlid(d) {
    st.busy = true;
    if (xzDist(lid.position, PAN_POS) > 1.35) {
      var from = lid.position.clone(), to = restPos('lid');
      anim(0.42, function (k) { lid.position.lerpVectors(from, to, k); }, 'inOutQuad').then(function () {
        lid.position.copy(to); st.rest.lid = true;
        sfx('lid', { vol: 0.45 });
        st.busy = false;
        done('uncovered');
      });
    } else {
      var f2 = lid.position.clone(), t2 = lidOnPos();
      anim(0.3, function (k) { lid.position.lerpVectors(f2, t2, k); }, 'inQuad').then(function () {
        lid.position.copy(t2);
        sfx('lid', { vol: 0.7 });
        st.lidOn = true; st.busy = false;
        hintUnlid();
      });
    }
    void d;
  }

  /* ---- 7. 皿をかぶせる ---- */
  function coverPlate() {
    var plate = S().plate;
    st.busy = true;
    var from = plate.position.clone(), to = PAN_POS.clone().add(V3(0, PLATE_ON_PAN, 0));
    sfx('whoosh', { vol: 0.25 });
    anim(0.7, function (k) {
      plate.position.lerpVectors(from, to, k);
      plate.position.y += Math.sin(PI * k) * 0.55;
      plate.rotation.set(PI * Math.min(1, k * 1.15), 0, 0);
    }, 'inOutQuad').then(function () {
      plate.position.copy(to); plate.rotation.set(PI, 0, 0);
      sfx('ceramic', { vol: 0.8 });
      st.busy = false;
      done('plated');
    });
  }

  /* ---- 8. ひっくり返す ---- */
  var _g = V3();
  function startFlip(p) {
    st.drag = { kind: 'flip' };
    st.flipping = true;
    sfx('metal', { vol: 0.35 });
    unhint();
    flipMove(p);
  }
  function flipMove(p) {
    var t0 = st.flipT, best = t0, bd = Infinity;
    var lo = Math.max(0, t0 - 0.25), hi = Math.min(1, t0 + 0.25);
    for (var j = 0; j <= 20; j++) {
      var t = lo + (hi - lo) * j / 20;
      var s = G.input.toScreen(gripAt(t, _g));
      var d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < bd) { bd = d; best = t; }
    }
    st.flipT = best;
    applyFlip(best);
  }
  function flipUp() {
    var t0 = st.flipT;
    st.busy = true;
    if (t0 >= 0.5) {
      anim(0.5 * (1 - t0) + 0.15, function (k) { st.flipT = t0 + (1 - t0) * k; applyFlip(st.flipT); }, 'inQuad').then(function () {
        st.flipT = 1; applyFlip(1); st.flipping = false;
        done('flipped');
      });
    } else {
      anim(0.4, function (k) { st.flipT = t0 * (1 - k); applyFlip(st.flipT); }, 'outQuad').then(function () {
        st.flipT = 0; applyFlip(0); st.flipping = false; st.busy = false;
        if (t0 > 0.08) sfx('metal', { vol: 0.3 });
        hintFlip();
      });
    }
  }

  /* ---------- update ---------- */
  var _v = V3();
  function update(dt) {
    if (!pan || !sc) return;
    var sh = S();
    // 縦横が変わったら、置いてある物を置き直す
    var cls = land();
    if (cls !== st.aspectCls) {
      st.aspectCls = cls;
      if (!st.drag && !st.busy) {
        if (st.rest.tray && sh.tray) sh.tray.position.copy(restPos('tray'));
        if (st.rest.cup) cup.position.copy(restPos('cup'));
        if (st.rest.lid) lid.position.copy(restPos('lid'));
        if (st.rest.plate && sh.plate) sh.plate.position.copy(restPos('plate'));
      }
    }
    // つかんでいる物
    var d = st.drag;
    if (d && d.obj && d.target) {
      var o = d.obj.position;
      var kk = 1 - Math.exp(-22 * dt);
      o.x += (d.target.x - o.x) * kk; o.z += (d.target.z - o.z) * kk;
      o.y += (d.y - o.y) * (1 - Math.exp(-16 * dt));
      if (d.kind === 'carry' && d.name === 'cup') checkPour();
      if (d.kind === 'carry' && d.name === 'plate') d.obj.rotation.x = 0;
    }
    // 炎
    if (st.flameDelay > 0) st.flameDelay -= dt;
    else {
      var nf = st.flame + (st.flameTarget - st.flame) * (1 - Math.exp(-8 * dt));
      if (Math.abs(nf - st.flame) > 1e-4 || (st.flame > 0 && st.flameTarget === 0)) {
        st.flame = nf < 0.01 && st.flameTarget === 0 ? 0 : nf;
        stove().setFlame(st.flame);
      }
      loop('flame', st.flame > 0.02 ? 0.25 + 0.45 * st.flame : 0);
    }
    // 水位
    var ud = pan.userData;
    if (st.water > 0.003 || ud.waterLevel > 0.003) ud.setWater(st.water);
    // 油はね
    if (st.frying && st.flame > 0.05 && !st.lidOn && st.water < 0.05) {
      st.spatT -= dt * (0.6 + st.flame);
      if (st.spatT <= 0) {
        st.spatT = 0.25 + Math.random() * 0.5;
        var fy = PAN_POS.y + ud.floorY + 0.03;
        G.fx.burst(rndIn(0.95, ud.floorY + 0.03), 'drop', { count: 1 + (Math.random() * 2 | 0), size: 0.5, speed: 0.7, life: 0.45, floor: fy });
      }
    }
    // ふたのカタカタ
    if (st.lidOn && st.step === 'steaming' && !st.hop) {
      st.rattleT -= dt;
      var y0 = lidOnPos().y;
      if (st.rattleT <= 0) {
        st.rattleT = 0.25 + Math.random() * 0.9;
        st.rattle = 0.06 + Math.random() * 0.05;
        st.rattlePh = Math.random() * 6;
        sfx('lid', { vol: 0.06 + Math.random() * 0.08, pitch: 1.1 + Math.random() * 0.3 });
      }
      st.rattle = Math.max(0, (st.rattle || 0) - dt);
      var a = st.rattle > 0 ? 1 : 0;
      lid.position.y = y0 + a * Math.abs(Math.sin(G.core.time * 70)) * 0.012;
      lid.rotation.x = a * Math.sin(G.core.time * 53 + (st.rattlePh || 0)) * 0.006;
      lid.rotation.z = a * Math.sin(G.core.time * 61) * 0.006;
    } else if (st.step === 'unlid' && st.lidOn && !st.drag && !st.busy) {
      lid.rotation.x *= 0.8;
    }
    void _v;
  }

  /* ---------- exit / reset ---------- */
  function exit() {
    try { G.input.clear(); } catch (_) {}
    unhint();
    LOOPS.forEach(function (n) { try { G.audio.loop(n, 0); } catch (_) {} });
    st.loops = {};
    try { G.audio.muffle(0); } catch (_) {}
    st.emitters.slice().forEach(stopEmitter);
    st.emitters = [];
    st.flame = 0; st.flameTarget = 0;
    try { stove().setFlame(0); stove().knob.rotation.set(0, 0, 0); } catch (_) {}
    if (cup) { cup.visible = false; cup.userData.stream.visible = false; }
    if (lid) lid.visible = false;
    if (pan) {
      if (pan.parent !== scene()) scene().attach(pan);
      pan.position.copy(PAN_POS); pan.rotation.set(0, 0, 0); pan.userData.setWater(0, 0);
    }
    st.drag = null; st.pending = null;
    sc = null;
  }
  function reset() {
    st.emitters.slice().forEach(stopEmitter);
    st = freshState();
  }

  G.flow.register('fry', { build: build, enter: enter, update: update, exit: exit, reset: reset });
})();

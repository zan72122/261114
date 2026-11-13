/* 35-kit.js — 場面どうしの受け渡しの約束（鍋の中の並び、羽根の配置、大皿への盛りつけ、状態からの復元）。
   どの場面の enter も、ここを通して「共有の物」を正しい姿に置き直す。何度呼んでも同じ結果になる。 */
(function () {
  'use strict';
  var G = (window.G = window.G || {});
  var K = (G.kit = {});

  /* 鍋の底（半径1.05）での 6 個の風車の並び。鍋ローカル（鍋の中心が原点）。
     偶数 k = ママ（gyozas[0..2]）、奇数 k = じぶん（gyozas[3..5]）。 */
  K.PAN_R = 0.6;
  K.panSlot = function (k) {
    var a = (k / 6) * Math.PI * 2;
    return { x: Math.cos(a) * K.PAN_R, z: -Math.sin(a) * K.PAN_R, rot: a + Math.PI / 2 + 0.35 };
  };
  /* ぎょうざ番号 i(0..5) → 鍋のスロット k。ママ 0,1,2 → 0,2,4 ／ じぶん 3,4,5 → 1,3,5 */
  K.slotOf = function (i) { return i < 3 ? i * 2 : (i - 3) * 2 + 1; };
  K.gyozaAtSlot = function (k) { return k % 2 === 0 ? k / 2 : 3 + (k - 1) / 2; };

  /* 状態（ひだ・あんの量）を共有のぎょうざへ写す */
  K.applyState = function () {
    var S = G.shared, d = G.state && G.state.data;
    if (!S || !d || !d.gyoza) return;
    for (var i = 0; i < S.gyozas.length; i++) {
      var g = S.gyozas[i], gd = d.gyoza[i];
      if (!g || !gd) continue;
      for (var j = 0; j < 7; j++) g.setPleat(j, gd.pleats[j] ? 1 : 0);
      g.setFilling(gd.fill === 2 ? 2 : 1);
    }
  };

  /* ぎょうざを scene 直下へ戻し（羽根のかけらや皿から外す）、姿勢の回転を消す */
  K.detachAll = function () {
    var S = G.shared, scene = G.core.scene;
    if (!S) return;
    S.gyozas.forEach(function (g) {
      if (g.group.parent !== scene) scene.add(g.group);
      g.group.rotation.set(0, 0, 0); g.group.scale.set(1, 1, 1);
    });
    if (S.wing) {
      var w = S.wing;
      if (K._holder && K._holder.parent) K._holder.parent.remove(K._holder);
      if (w.group.parent !== scene) scene.add(w.group);
      w.group.position.set(0, 0, 0); w.group.rotation.set(0, 0, 0); w.group.visible = false;
      K.resetPieces();
    }
  };

  /* 羽根のかけらを、割れる前の位置へ戻す */
  K.resetPieces = function () {
    var w = G.shared && G.shared.wing;
    if (!w || !w.pieces || !K._laid) return;
    for (var i = 0; i < w.pieces.length; i++) {
      var pc = w.pieces[i].group, s = K.panSlot(i);
      if (pc.parent !== w.group) w.group.add(pc);
      pc.position.set(s.x, 0, s.z); pc.rotation.set(0, 0, 0); pc.scale.set(1, 1, 1); pc.visible = true;
    }
  };

  /* 羽根を、いまのひだの状態で配置し直す（重い: 0.4〜0.8 秒。場面の入り口や間で呼ぶ）。
     pieces[k] は鍋スロット k のかけら。ひだが変わっていなければ作り直さない。 */
  K.layoutWing = function () {
    var S = G.shared;
    if (!S || !S.wing) return;
    var list = [], key = '';
    for (var k = 0; k < 6; k++) {
      var g = S.gyozas[K.gyozaAtSlot(k)], s = K.panSlot(k);
      var pl = g ? g.pleats.map(function (v) { return v > 0.5 ? 1 : 0; }) : [1, 1, 1, 1, 1, 1, 1];
      list.push({ x: s.x, z: s.z, rot: s.rot, pleats: pl });
      key += pl.join('') + '|';
    }
    if (K._laid !== key) { S.wing.layout(list); K._laid = key; }
    K.resetPieces();
  };

  /* ぎょうざ i を鍋の中（panGroup のローカル、底 y=floorY）へ置く */
  K.placeInPan = function (i, pan) {
    var g = G.shared.gyozas[i], s = K.panSlot(K.slotOf(i));
    pan.add(g.group);
    g.group.position.set(s.x, pan.userData.floorY, s.z);
    g.group.rotation.set(0, s.rot, 0);
  };

  /* 焼き上がりを大皿へ「ひっくり返して」盛った姿にする（fry の最後と eat の入り口で呼ぶ。冪等）。
     結果: plate の子 K._holder（x 軸で π 回転、羽根が上）→ wing.group → pieces[k].group → ぎょうざ。
     取り分ける時は pieces[k].group ごと動かす（その中にスロット k のぎょうざが入っている）。 */
  K.platedY = 0.39;
  K.assemblePlated = function () {
    var S = G.shared, plate = S.plate, w = S.wing;
    K.applyState();
    K.layoutWing();
    if (!K._holder) K._holder = new THREE.Group();
    var h = K._holder;
    plate.add(h);
    h.position.set(0, plate.userData.topY + K.platedY, 0);
    h.rotation.set(Math.PI, 0, 0);
    h.add(w.group);
    w.group.position.set(0, 0, 0); w.group.rotation.set(0, 0, 0); w.group.visible = true;
    w.setGrow(1); w.setCrisp(1);
    for (var k = 0; k < 6; k++) {
      var g = S.gyozas[K.gyozaAtSlot(k)], s = K.panSlot(k), pc = w.pieces[k].group;
      g.setShape({ fold: 1, stand: 1 }); g.setCook(1); g.setBrown(1); g.setBite(0); g.setSauce(0);
      pc.add(g.group);
      g.group.position.set(0, 0, 0); g.group.rotation.set(0, s.rot, 0); g.group.scale.set(1, 1, 1);
      g.group.visible = true;
    }
    plate.visible = true;
  };
})();

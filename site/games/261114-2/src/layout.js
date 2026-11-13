// layout.js — 世界の配置の唯一の正（司令塔が管理。実装役は編集しない。数値を変えたいときは報告する）
// 単位はメートル。+x = 画面右（東）、+y = 上、+z = カメラ側（南）。床は y=0。原点は「遊ぶ床」の中心。
const L = (() => {
  const D = Math.PI / 180;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

  const L = {
    // ---- 部屋 ----
    room: { xMin: -2.6, xMax: 2.6, zNorth: -2.55, zSouth: 4.2, ceil: 2.4 },
    rug: { xMin: -0.95, xMax: 0.95, zMin: -1.45, zMax: 0.50, pile: 0.012 }, // 房（フリンジ）は南端 z=zMax と北端
    sofa: { x: 0, z: -2.05, w: 2.0, d: 0.9, seatH: 0.42, backH: 0.85 },
    basket: { x: -0.70, z: -0.75, r: 0.21, h: 0.36 },   // 洗濯かご（くつしたを入れる）
    trash: { x: 0.70, z: -0.75, r: 0.16, h: 0.42 },     // ペダル式ごみ箱（ふたが開く）
    // ---- くす玉 3 つ（天井から吊る。ひもを引くと割れる）----
    kusu: {
      xs: [-0.36, 0, 0.36], y: 1.78, z: -0.15, r: 0.13,
      ringY: 1.12,                       // 引きひもの先の輪の高さ（静止時）
      colors: [0xd9a520, 0xe8799a, 0x4aa3e0], // 金・ピンク・水色（ラウンド 0,1,2）
    },
    // ---- 遊ぶ床（紙ふぶきが落ちる台形。縦画面で全部見える範囲）----
    play: { zFar: -0.85, zNear: 0.85, hwFar: 0.80, hwNear: 0.44 },
    // ヘッドが動ける範囲（play より少し広い）
    reach: { zFar: -0.98, zNear: 0.95, hwFar: 0.92, hwNear: 0.52 },
    // ---- そうじき（キャニスター型サイクロン。本体は床に据え置き）----
    canister: { x: 0.07, z: 1.60, yaw: 0 },            // 本体の中心。鼻先は -z（北）向き
    jarMount: { x: 0.07, y: 0.31, z: 1.58, tilt: 45 * D }, // 透明カップの中心。軸は「前上 45°」（上端が -z 側）
    jar: { r: 0.10, h: 0.27 },                         // 透明カップ: 半径・長さ（ローカル +Y が上端=取っ手側）
    hosePort: { x: 0.07, y: 0.20, z: 1.30 },           // 本体前面のホース口
    hoseLen: 2.0,
    user: { x: 0.55, z: 1.75 },                        // 見えない持ち手の立ち位置（延長管はここへ向かって傾く）
    wand: { reach: 0.62, gripH: 0.60 },                // グリップ = ヘッド + 持ち手方向*reach + 上*gripH
    head: { w: 0.28, d: 0.10, h: 0.05, restX: 0.32, restZ: 0.62 }, // 床ヘッド（幅・奥行・高さ）と置き場所
    suckR: 0.17, pullR: 0.34,                          // 吸い込み半径・引き寄せ半径
    socks: [{ x: -0.30, z: -0.30, rot: 0.6 }, { x: 0.38, z: 0.28, rot: -1.1 }],
    // ---- ごみ捨て ----
    carryY: 0.55,                                      // カップを運ぶ高さ（カップ中心）
    dumpPos: { x: 0.70, y: 0.72, z: -0.75 },           // ごみ箱の真上でカップを構える位置（カップ中心・軸は鉛直）
    // ---- カメラ ----
    cam: { x: 0, y: 1.15, z: 2.15 },
  };

  // 縦横比 a = 幅/高さ から 0(縦)〜1(横) の係数
  L.landK = a => clamp((a - 0.62) / (1.30 - 0.62), 0, 1);

  // 遊び中のカメラ（位置固定・見下ろし）。返り値 {pos:[x,y,z], target:[x,y,z], fov}
  L.camPlay = a => {
    const k = L.landK(a);
    const pitch = lerp(42, 39, k) * D, fov = lerp(66, 50, k);
    const p = L.cam;
    return { pos: [p.x, p.y, p.z], target: [p.x, p.y - Math.sin(pitch) * 2, p.z - Math.cos(pitch) * 2], fov };
  };
  // くす玉 i を見上げる「まえ」のカメラ
  L.camBefore = (i, a) => {
    const k = L.landK(a), bx = L.kusu.xs[i];
    return { pos: [bx * 0.7, 1.20, 1.15], target: [bx, 1.42, L.kusu.z], fov: lerp(56, 42, k) };
  };
  // ごみ捨てのアップ
  L.camDump = a => {
    const k = L.landK(a);
    return { pos: [0.40, 0.98, 0.42], target: [0.69, 0.50, -0.75], fov: lerp(52, 40, k) };
  };
  // 透明カップのアップ（遊び中にカップを触ったとき）
  L.camJarClose = a => {
    const k = L.landK(a), m = L.jarMount;
    return { pos: [m.x - 0.05, m.y + 0.52, m.z + 0.36], target: [m.x, m.y + 0.02, m.z - 0.02], fov: lerp(52, 40, k) };
  };

  const hwAt = (o, z) => lerp(o.hwFar, o.hwNear, clamp((z - o.zFar) / (o.zNear - o.zFar), 0, 1));
  L.playHalfW = z => hwAt(L.play, z);
  // (x,z) が紙ふぶきの落ちてよい場所か（かご・ごみ箱・くつしたの近くは除く）
  L.inPlay = (x, z) => {
    if (z < L.play.zFar || z > L.play.zNear) return false;
    if (Math.abs(x) > L.playHalfW(z)) return false;
    const b = L.basket, t = L.trash;
    if (Math.hypot(x - b.x, z - b.z) < b.r + 0.12) return false;
    if (Math.hypot(x - t.x, z - t.z) < t.r + 0.12) return false;
    for (const s of L.socks) if (Math.hypot(x - s.x, z - s.z) < 0.13) return false;
    return true;
  };
  // 落ちてよい場所から 1 点選ぶ（rnd は 0..1 を返す関数）。out = {x,z}
  L.randomPlayPoint = (rnd, out) => {
    out = out || {};
    for (let i = 0; i < 40; i++) {
      const z = lerp(L.play.zFar, L.play.zNear, rnd());
      const x = (rnd() * 2 - 1) * L.playHalfW(z);
      if (L.inPlay(x, z)) { out.x = x; out.z = z; return out; }
    }
    out.x = 0; out.z = 0; return out;
  };
  // ヘッドの位置を動ける範囲に収める（かご・ごみ箱にはめり込まない）。out = {x,z}
  L.clampReach = (x, z, out) => {
    out = out || {};
    z = clamp(z, L.reach.zFar, L.reach.zNear);
    const hw = hwAt(L.reach, z);
    x = clamp(x, -hw, hw);
    for (const o of [L.basket, L.trash]) {
      const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz), min = o.r + 0.10;
      if (d < min) { const k = min / (d || 1e-4); x = o.x + dx * k; z = o.z + dz * k; }
    }
    out.x = x; out.z = z; return out;
  };
  L.onRug = (x, z) => x > L.rug.xMin && x < L.rug.xMax && z > L.rug.zMin && z < L.rug.zMax;

  return L;
})();

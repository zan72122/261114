// jar.js — サイクロン掃除機の透明カップ（ダストカップ）とその中身
// ローカル座標: 原点 = 円筒の中心、+Y = 上端（ふた・取っ手）、-Y = 底（開閉する底ぶた）、+Z = 載せたときカメラ側
const Jar = (() => {
  const R = L.jar.r, H = L.jar.h, HH = H / 2;
  const RIN = R - 0.003;                    // 内壁
  const FLOOR = -HH + 0.004, CEIL = HH - 0.004;
  const CORE_LEN = H * 0.57, CORE_BOT = HH - CORE_LEN, CORE_R0 = 0.045, CORE_R1 = 0.030;
  const coreR = y => CORE_R1 + (CORE_R0 - CORE_R1) * Base.sat((y - CORE_BOT) / CORE_LEN);
  const MAX = 220, MAXS = 16, SEG = 40, NP = SEG + 1;
  const TAU = Math.PI * 2;
  const TYPES = ['paper', 'star', 'bead', 'pom', 'streamer'];
  // 種類ごとの性質: 半径方向の大きさ / 最大角速度 / 気流への追従（角速度）/ 気流の効き方の速さ / 捨てるときの空気抵抗
  const HALF = [0.016, 0.018, 0.0125, 0.026, 0.008];
  const WMAX = [14, 12.5, 9, 7, 8];
  const KTH = [6, 4.5, 1.0, 2.6, 3.2];
  const ARATE = [5, 3.8, 1.1, 2.2, 3];
  const DRAG = [3.6, 2.4, 0.05, 0.9, 2.2];
  const G0 = 7.0; // 筒の中の見かけの重力（遊びやすいよう少し弱め）

  const clamp = Base.clamp, sat = Base.sat, lerp = Base.lerp;
  const rnd = Base.rng(2611142);

  // ---- 粒の状態（固定長配列。毎フレーム new しない）----
  // mode: 0=なし 1=渦 2=山 3=捨て待ち 4=落下 5=引っかかり
  const mode = new Uint8Array(MAX), type = new Uint8Array(MAX), shape = new Uint8Array(MAX);
  const colHex = new Uint32Array(MAX), colR = new Float32Array(MAX), colG = new Float32Array(MAX), colB = new Float32Array(MAX);
  const born = new Float64Array(MAX);
  const th = new Float32Array(MAX), w = new Float32Array(MAX), rr = new Float32Array(MAX);
  const px = new Float32Array(MAX), py = new Float32Array(MAX), pz = new Float32Array(MAX);
  const vx = new Float32Array(MAX), vy = new Float32Array(MAX), vz = new Float32Array(MAX);
  const sup = new Float32Array(MAX), vr = new Float32Array(MAX), ph = new Float32Array(MAX), fq = new Float32Array(MAX), u0 = new Float32Array(MAX);
  const ex = new Float32Array(MAX), ey = new Float32Array(MAX), ez = new Float32Array(MAX);
  const sx = new Float32Array(MAX), sy = new Float32Array(MAX), sz = new Float32Array(MAX);
  const qr = new Float32Array(MAX * 4);     // 山で寝るときの向き（重力系）
  const bl = new Float32Array(MAX), lowT = new Float32Array(MAX), jit = new Float32Array(MAX);
  const rank = new Int16Array(MAX).fill(-1), rib = new Int8Array(MAX).fill(-1);
  const hop = new Float32Array(MAX), hopV = new Float32Array(MAX), delay = new Float32Array(MAX);
  let bornN = 0, alive = 0;

  // ---- 山の候補点 ----
  let NS = 0, slX, slY, slZ, sorted, owner, slKey;
  let nPiled = 0;

  let object = null, body = null, hatchG = null;
  let meshes = [], ribbonMesh = null, ribPos, ribNor, ribCol, ribOwner = new Int16Array(MAXS).fill(-1), ribDirty = new Uint8Array(MAXS);
  let crump = null, crumpW = null; // 紙テープの「くしゃっ」形（rib ごと）
  let streaks = null, streakMat = null, streakPhase = 0;
  let handleMat = null, buttonMat = null;
  let glowHandle = 0, glowButton = 0;
  let hatchOpen = false, hatchA = 0, hatchV = 0;
  let shakeT = 9, st = 'normal', stuckI = -1, stuckN = 0, stuckP = 0, phi = 0, phiV = 0, emptyPending = false;
  let motorS = 0, rattle = 0, simTime = 0;
  const on = { land: null, stuck: null, empty: null };

  // 使い回しの一時オブジェクト
  const g = new THREE.Vector3(0, -0.707, -0.707), gSorted = new THREE.Vector3(0, 0, 0);
  const tq = new THREE.Quaternion(), qG = new THREE.Quaternion(), qS = new THREE.Quaternion(), qP = new THREE.Quaternion();
  const tv = new THREE.Vector3(), tv2 = new THREE.Vector3(), tv3 = new THREE.Vector3(), ZUP = new THREE.Vector3(0, 0, 1);
  const te = new THREE.Euler(0, 0, 0, 'YXZ'), tm = new THREE.Matrix4(), tsc = new THREE.Vector3(1, 1, 1), tc = new THREE.Color();
  const pivot = new THREE.Vector3(0, CORE_BOT - 0.012, 0.032), eDir = new THREE.Vector3(1, 0, 0);
  const counts = new Int32Array(6);

  const fire = (name, a, b) => { try { const f = on[name]; if (typeof f === 'function') f(a, b); } catch (e) { /* 黙って続ける */ } };

  // ================= 見た目 =================
  function lathe(pts, seg) {
    return new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg || 48);
  }
  // 頂点色つきで 1 つのジオメトリにまとめる（ドローコール節約）
  function merge(list) {
    let n = 0; const parts = [];
    for (const it of list) {
      let gg = it.g.index ? it.g.toNonIndexed() : it.g;
      if (it.m) gg.applyMatrix4(it.m);
      if (!gg.attributes.uv) gg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(gg.attributes.position.count * 2), 2));
      parts.push(gg); n += gg.attributes.position.count;
    }
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
    let o = 0; const c = new THREE.Color();
    parts.forEach((gg, k) => {
      const cnt = gg.attributes.position.count;
      c.setHex(list[k].c);
      pos.set(gg.attributes.position.array, o * 3);
      nor.set(gg.attributes.normal.array, o * 3);
      uv.set(gg.attributes.uv.array.subarray(0, cnt * 2), o * 2);
      for (let i = 0; i < cnt; i++) { col[(o + i) * 3] = c.r; col[(o + i) * 3 + 1] = c.g; col[(o + i) * 3 + 2] = c.b; }
      o += cnt;
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return out;
  }
  const M = (x, y, z, rx, ry, rz) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0)), new THREE.Vector3(1, 1, 1));

  // 透明な樹脂: 拡散はうすく、反射（映り込み・縁のハイライト）はそのまま足す
  function clearPlastic(side, tex) {
    const m = new THREE.MeshPhysicalMaterial({
      color: 0xe8f3f3, map: tex, metalness: 0, roughness: 0.06, ior: 1.58, clearcoat: 1, clearcoatRoughness: 0.04,
      transparent: true, opacity: 1, depthWrite: false, side, envMapIntensity: 1.6,
    });
    m.premultipliedAlpha = true;
    m.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <opaque_fragment>', [
          'float jfr = 1.0 - abs( dot( normalize( vViewPosition ), normal ) );',
          'jfr = jfr * jfr * jfr;',
          'float jaa = clamp( diffuseColor.a + jfr * 0.42, 0.0, 1.0 );',
          'vec3 jsp = max( outgoingLight - totalDiffuse, vec3( 0.0 ) );',
          'gl_FragColor = vec4( totalDiffuse * jaa + jsp, jaa );',
        ].join('\n'))
        .replace('#include <premultiplied_alpha_fragment>', '');
    };
    m.customProgramCacheKey = () => 'jarClear';
    return m;
  }

  function buildCup() {
    const low = !!Base.quality.low;
    // 筒の模様: ほぼ透明。成形の合わせ目（縦線 2 本）、両端のくもり帯、ごく薄いむら
    const tubeTex = Base.canvasTex(512, 256, (x, W, Hh) => {
      x.clearRect(0, 0, W, Hh);
      x.fillStyle = 'rgba(255,255,255,0.055)'; x.fillRect(0, 0, W, Hh);
      const r2 = Base.rng(5);
      for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(255,255,255,${0.012 + r2() * 0.02})`; x.fillRect(r2() * W, 0, 2 + r2() * 14, Hh); }
      x.fillStyle = 'rgba(255,255,255,0.22)';
      x.fillRect(W * 0.25 - 1, 0, 2, Hh); x.fillRect(W * 0.75 - 1, 0, 2, Hh);
      const band = (y0, y1, a) => { const gr = x.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, `rgba(240,246,246,${a})`); gr.addColorStop(1, 'rgba(240,246,246,0)'); x.fillStyle = gr; x.fillRect(0, Math.min(y0, y1), W, Math.abs(y1 - y0)); };
      band(0, 14, 0.42); band(Hh, Hh - 12, 0.42);
      x.fillStyle = 'rgba(255,255,255,0.16)'; x.fillRect(0, 22, W, 1); x.fillRect(0, Hh - 20, W, 1);
    });
    const tubeGeo = new THREE.CylinderGeometry(R, R, H, 56, 1, true);
    const back = new THREE.Mesh(tubeGeo, clearPlastic(THREE.BackSide, tubeTex));
    const front = new THREE.Mesh(tubeGeo, clearPlastic(THREE.FrontSide, tubeTex));
    back.renderOrder = 1; front.renderOrder = 3;
    body.add(back, front);

    // 不透明な樹脂部品（頂点色でまとめる）
    const WHITE = 0xf4f2ee, TEAL = 0x1fa39a, DARK = 0x2b2d30, GREY = 0x8d9296, LGREY = 0xd9dad6;
    const parts = [
      // 下のリング（濃灰）
      { g: lathe([[0.1004, -HH - 0.001], [0.1052, -HH - 0.001], [0.1058, -HH + 0.003], [0.1058, -HH + 0.010], [0.1050, -HH + 0.013], [0.1004, -HH + 0.013]]), c: DARK },
      // 上のリング（濃灰）
      { g: lathe([[0.1004, HH - 0.012], [0.1052, HH - 0.012], [0.1058, HH - 0.008], [0.1058, HH + 0.010]]), c: DARK },
      // サイクロンの頭（白）
      { g: lathe([[0.1058, HH + 0.010], [0.1066, HH + 0.014], [0.1066, HH + 0.040], [0.1040, HH + 0.050], [0.0960, HH + 0.056], [0.0700, HH + 0.061], [0.0300, HH + 0.063], [0.0, HH + 0.063]], 56), c: WHITE },
      // ティールの帯
      { g: lathe([[0.1066, HH + 0.019], [0.1076, HH + 0.020], [0.1076, HH + 0.028], [0.1066, HH + 0.029]], 56), c: TEAL },
      // 頭の裏（筒の内側から見える天井）
      { g: new THREE.CircleGeometry(RIN, 40), m: M(0, HH - 0.0005, 0, Math.PI / 2), c: LGREY },
      // 芯の付け根（白い樹脂のつば）
      { g: lathe([[0.0448, HH - 0.015], [0.0465, HH - 0.013], [0.0465, HH - 0.001]], 32), c: WHITE },
      // 芯の下端: ふた + ゴムのスカート
      { g: lathe([[0.0, CORE_BOT + 0.002], [0.0305, CORE_BOT + 0.002], [0.0315, CORE_BOT + 0.006], [0.0305, CORE_BOT + 0.010]], 32), c: GREY },
      { g: lathe([[0.0290, CORE_BOT - 0.001], [0.0330, CORE_BOT - 0.005], [0.0400, CORE_BOT - 0.012], [0.0420, CORE_BOT - 0.010], [0.0350, CORE_BOT - 0.002], [0.0298, CORE_BOT + 0.004]], 32), c: DARK },
      // 吸気口（-Z 側の短い管）とゴムのパッキン
      { g: new THREE.CylinderGeometry(0.019, 0.020, 0.030, 24, 1, false), m: M(0, HH - 0.032, -R - 0.006, Math.PI / 2), c: LGREY },
      { g: new THREE.TorusGeometry(0.0195, 0.0035, 8, 24), m: M(0, HH - 0.032, -R - 0.021), c: DARK },
      // 解除ボタンの台（+Z 側の下）
      { g: new THREE.BoxGeometry(0.046, 0.024, 0.016), m: M(0, -HH + 0.006, R + 0.002), c: DARK },
      // ちょうつがいの軸受け（-Z 側の下）
      { g: new THREE.CylinderGeometry(0.0055, 0.0055, 0.036, 12), m: M(0, -HH - 0.004, -R - 0.004, 0, 0, Math.PI / 2), c: DARK },
      // 取っ手の付け根
      { g: new THREE.BoxGeometry(0.026, 0.012, 0.03), m: M(-0.056, HH + 0.064, 0), c: DARK },
      { g: new THREE.BoxGeometry(0.026, 0.012, 0.03), m: M(0.056, HH + 0.064, 0), c: DARK },
    ];
    const stat = new THREE.Mesh(merge(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0 }));
    stat.castShadow = !low; stat.receiveShadow = !low;
    body.add(stat);

    // 取っ手（アーチ・濃灰ゴム）
    const hc = new THREE.CatmullRomCurve3([
      [-0.056, HH + 0.064], [-0.060, HH + 0.088], [-0.050, HH + 0.110], [-0.022, HH + 0.118], [0, HH + 0.119],
      [0.022, HH + 0.118], [0.050, HH + 0.110], [0.060, HH + 0.088], [0.056, HH + 0.064]].map(p => new THREE.Vector3(p[0], p[1], 0)));
    handleMat = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.62, emissive: 0xfff0d0, emissiveIntensity: 0 });
    const handle = new THREE.Mesh(new THREE.TubeGeometry(hc, 44, 0.0105, 12, false), handleMat);
    handle.scale.set(1, 1, 1.25);
    handle.castShadow = !low;
    body.add(handle);

    // 解除ボタン（オレンジ）
    buttonMat = new THREE.MeshStandardMaterial({ color: 0xf08a24, roughness: 0.38, emissive: 0xff9a40, emissiveIntensity: 0 });
    const btnG = new THREE.CylinderGeometry(0.0085, 0.0095, 0.006, 24);
    btnG.rotateX(Math.PI / 2);
    const btn = new THREE.Mesh(btnG, buttonMat);
    btn.position.set(0, -HH + 0.006, R + 0.012);
    body.add(btn);

    // 金属メッシュの芯（細かい穴の模様）
    const meshTex = Base.canvasTex(128, 512, (x, W, Hh) => {
      x.fillStyle = '#b8bcbf'; x.fillRect(0, 0, W, Hh);
      const r2 = Base.rng(9);
      for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(${r2() < 0.5 ? '255,255,255' : '60,64,68'},0.05)`; x.fillRect(0, r2() * Hh, W, 1 + r2() * 3); }
      x.fillStyle = '#24272a';
      const sp = 8;
      for (let row = 0, y = 26; y < Hh - 10; row++, y += sp * 0.87) {
        for (let xx = (row % 2) * sp / 2; xx < W + sp; xx += sp) { x.beginPath(); x.arc(xx, y, 2.3, 0, TAU); x.fill(); }
      }
      x.fillStyle = '#d6d8d8'; x.fillRect(0, 0, W, 18); x.fillRect(0, Hh - 8, W, 8);
    }, { repeat: [8, 1] });
    meshTex.wrapT = THREE.ClampToEdgeWrapping; meshTex.repeat.set(8, 1);
    const coreLen = CORE_LEN - 0.013;
    const coreG = new THREE.CylinderGeometry(CORE_R0 - 0.0005, CORE_R1, coreLen, 40, 1, true);
    coreG.translate(0, HH - 0.013 - coreLen / 2, 0);
    const core = new THREE.Mesh(coreG, new THREE.MeshStandardMaterial({ map: meshTex, metalness: 0.82, roughness: 0.36 }));
    body.add(core);

    // 底ぶた（ちょうつがいは -Z、留め具は +Z）
    hatchG = new THREE.Group();
    hatchG.position.set(0, -HH - 0.004, -R - 0.004);
    body.add(hatchG);
    const hz = R + 0.004;
    const rim = merge([
      { g: lathe([[R - 0.006, -0.0045], [R + 0.0045, -0.0045], [R + 0.0058, 0.0], [R + 0.0045, 0.0035], [R - 0.006, 0.0035]], 48), m: M(0, 0, hz), c: DARK },
      { g: new THREE.BoxGeometry(0.03, 0.016, 0.008), m: M(0, -0.002, hz + R + 0.007), c: DARK },
      { g: new THREE.BoxGeometry(0.03, 0.006, 0.012), m: M(0, 0, 0.004), c: DARK },
    ]);
    const rimM = new THREE.Mesh(rim, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }));
    rimM.castShadow = !low;
    hatchG.add(rimM);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.004, R - 0.004, 0.004, 40),
      new THREE.MeshStandardMaterial({ color: 0x59656b, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.42, depthWrite: false }));
    disc.position.set(0, 0, hz);
    disc.renderOrder = 2;
    hatchG.add(disc);

    // 空気の筋（ごく薄い）
    const NSTR = 6, SS = 56;
    const sp = new Float32Array(NSTR * SS * 2 * 3), sc = new Float32Array(NSTR * SS * 2 * 4), si = [];
    for (let k = 0; k < NSTR; k++) {
      const a0 = k / NSTR * TAU + rnd(), rad = 0.058 + rnd() * 0.032, y0 = -HH + 0.03 + rnd() * 0.06, span = 0.10 + rnd() * 0.08, turns = 0.9 + rnd() * 0.5;
      for (let j = 0; j < SS; j++) {
        const s = j / (SS - 1), a = a0 - s * turns * TAU, yy = y0 + s * span, rad2 = Math.max(rad, coreR(yy) + 0.012);
        const cx = rad2 * Math.cos(a), cz = rad2 * Math.sin(a);
        for (let e = 0; e < 2; e++) {
          const vi = (k * SS + j) * 2 + e;
          sp[vi * 3] = cx; sp[vi * 3 + 1] = yy + (e ? 0.0025 : -0.0025); sp[vi * 3 + 2] = cz;
          sc[vi * 4] = sc[vi * 4 + 1] = sc[vi * 4 + 2] = 1; sc[vi * 4 + 3] = Math.pow(Math.sin(Math.PI * s), 2);
        }
        if (j < SS - 1) { const b = (k * SS + j) * 2; si.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
      }
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(sc, 4));
    sg.setIndex(si);
    streakMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    streaks = new THREE.Mesh(sg, streakMat);
    streaks.renderOrder = 2; streaks.visible = false; streaks.frustumCulled = false;
    body.add(streaks);
  }

  function buildContents() {
    const paperTex = Base.canvasTex(64, 64, (x, W, Hh) => {
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, Hh);
      const r2 = Base.rng(11);
      for (let i = 0; i < 260; i++) { x.fillStyle = `rgba(0,0,0,${r2() * 0.06})`; x.fillRect(r2() * W, r2() * Hh, 1 + r2() * 3, 1); }
    });
    const fuzzTex = Base.canvasTex(128, 128, (x, W, Hh) => {
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, Hh);
      const r2 = Base.rng(13);
      for (let i = 0; i < 1400; i++) {
        const a = r2() * TAU, l = 2 + r2() * 5, x0 = r2() * W, y0 = r2() * Hh;
        x.strokeStyle = `rgba(${r2() < 0.5 ? '0,0,0' : '255,255,255'},${0.08 + r2() * 0.14})`; x.lineWidth = 1;
        x.beginPath(); x.moveTo(x0, y0); x.lineTo(x0 + Math.cos(a) * l, y0 + Math.sin(a) * l); x.stroke();
      }
    });
    // 星（ホイル）
    const shp = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? 0.0088 : 0.021;
      if (i) shp.lineTo(Math.cos(a) * rad, Math.sin(a) * rad); else shp.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    const starG = new THREE.ExtrudeGeometry(shp, { depth: 0.0012, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0007, bevelSegments: 1, curveSegments: 1 });
    starG.translate(0, 0, -0.0006);
    starG.computeVertexNormals();
    // ポンポン（毛羽立った不規則な球）
    const pomG = new THREE.IcosahedronGeometry(0.025, 2);
    { const p = pomG.attributes.position, r2 = Base.rng(17);
      const seen = new Map();
      for (let i = 0; i < p.count; i++) {
        const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
        let k = seen.get(key); if (k === undefined) { k = 0.93 + r2() * 0.12; seen.set(key, k); }
        p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
      }
      pomG.computeVertexNormals(); }

    const defs = [
      [new THREE.PlaneGeometry(0.035, 0.035), new THREE.MeshStandardMaterial({ map: paperTex, roughness: 0.78, side: THREE.DoubleSide })],
      [new THREE.CircleGeometry(0.019, 14), new THREE.MeshStandardMaterial({ map: paperTex, roughness: 0.78, side: THREE.DoubleSide })],
      [starG, new THREE.MeshStandardMaterial({ metalness: 1, roughness: 0.2, envMapIntensity: 1.4 })],
      [new THREE.SphereGeometry(0.0125, 14, 10), new THREE.MeshPhysicalMaterial({ roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.2 })],
      [pomG, new THREE.MeshPhysicalMaterial({ map: fuzzTex, roughness: 0.95, sheen: 1, sheenRoughness: 0.55, sheenColor: new THREE.Color(0x9a9a9a) })],
    ];
    meshes = defs.map(([geo, mat]) => {
      const m = new THREE.InstancedMesh(geo, mat, MAX);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      tc.setHex(0xffffff);
      for (let i = 0; i < MAX; i++) m.setColorAt(i, tc);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.count = 0; m.visible = false; m.frustumCulled = false;
      body.add(m);
      return m;
    });

    // 紙テープ（リボン、最大 MAXS 本を 1 メッシュで）
    const nv = MAXS * NP * 2;
    ribPos = new Float32Array(nv * 3); ribNor = new Float32Array(nv * 3); ribCol = new Float32Array(nv * 3);
    const idx = [];
    for (let k = 0; k < MAXS; k++) for (let j = 0; j < SEG; j++) { const b = (k * NP + j) * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(ribPos, 3).setUsage(THREE.DynamicDrawUsage));
    rg.setAttribute('normal', new THREE.BufferAttribute(ribNor, 3).setUsage(THREE.DynamicDrawUsage));
    rg.setAttribute('color', new THREE.BufferAttribute(ribCol, 3));
    rg.setIndex(idx);
    ribbonMesh = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, side: THREE.DoubleSide }));
    ribbonMesh.frustumCulled = false; ribbonMesh.visible = false;
    body.add(ribbonMesh);
    crump = new Float32Array(MAXS * NP * 3); crumpW = new Float32Array(MAXS * NP * 3);
  }

  function buildSlots() {
    const d = 0.0195, r2 = Base.rng(23);
    const X = [], Y = [], Z = [];
    let layer = 0;
    for (let y = FLOOR + 0.010; y < CEIL - 0.012; y += d * 0.9, layer++) {
      const off = (layer % 2) * d * 0.5;
      for (let x = -R + off; x <= R; x += d) for (let z = -R + off; z <= R; z += d) {
        const jx = x + (r2() - 0.5) * 0.006, jz = z + (r2() - 0.5) * 0.006, jy = y + (r2() - 0.5) * 0.005;
        const rho = Math.hypot(jx, jz);
        if (rho > RIN - 0.012) continue;
        if (jy > CORE_BOT - 0.016 && rho < coreR(jy) + 0.014) continue;
        X.push(jx); Y.push(jy); Z.push(jz);
      }
    }
    NS = X.length;
    slX = Float32Array.from(X); slY = Float32Array.from(Y); slZ = Float32Array.from(Z);
    sorted = new Int16Array(NS); owner = new Int16Array(NS).fill(-1); slKey = new Float32Array(NS);
    for (let k = 0; k < NS; k++) sorted[k] = k;
  }

  // 重力が変わったら候補点を「低い順」に並べ直し、山の粒を割り当て直す
  const tmpIdx = [];
  function resort() {
    gSorted.copy(g);
    for (let k = 0; k < NS; k++) slKey[k] = slX[k] * g.x + slY[k] * g.y + slZ[k] * g.z;
    const arr = Array.from(sorted);
    arr.sort((a, b) => slKey[b] - slKey[a]);
    for (let k = 0; k < NS; k++) sorted[k] = arr[k];
    owner.fill(-1);
    tmpIdx.length = 0;
    for (let i = 0; i < MAX; i++) if (mode[i] === 2) tmpIdx.push(i);
    tmpIdx.sort((a, b) => (px[b] * g.x + py[b] * g.y + pz[b] * g.z) - (px[a] * g.x + py[a] * g.y + pz[a] * g.z));
    for (let k = 0; k < tmpIdx.length; k++) { rank[tmpIdx[k]] = k; owner[k] = tmpIdx[k]; }
    nPiled = tmpIdx.length;
  }

  function enterPile(i) {
    let f = -1;
    for (let k = 0; k < NS; k++) if (owner[k] < 0) { f = k; break; }
    if (f < 0) { lowT[i] = 0; return; }
    // 山の表面のうち、いまの位置にいちばん近い空き
    let best = f, bd = 1e9;
    for (let k = f, n = 0; k < NS && n < 48; k++) {
      if (owner[k] >= 0) continue;
      n++;
      const s = sorted[k], dx = slX[s] - px[i], dy = slY[s] - py[i], dz = slZ[s] - pz[i], dd = dx * dx + dy * dy + dz * dz;
      if (dd < bd) { bd = dd; best = k; }
    }
    owner[best] = i; rank[i] = best; mode[i] = 2; nPiled++; lowT[i] = 0; w[i] = 0;
  }
  function leavePile(i) {
    if (rank[i] >= 0 && owner[rank[i]] === i) { owner[rank[i]] = -1; nPiled--; }
    rank[i] = -1;
  }

  function freeParticle(i) {
    if (mode[i] === 2) leavePile(i);
    if (rib[i] >= 0) { ribOwner[rib[i]] = -1; ribDirty[rib[i]] = 1; rib[i] = -1; }
    if (mode[i]) alive--;
    mode[i] = 0; rank[i] = -1;
  }

  // ================= API =================
  function init(ctx) {
    if (object) return;
    object = new THREE.Group(); object.name = 'Jar';
    body = new THREE.Group(); object.add(body);
    buildCup();
    buildContents();
    buildSlots();
    object.updateMatrixWorld(true);
    resort();
  }

  function add(t, color) {
    if (!object) return;
    let ti = TYPES.indexOf(t); if (ti < 0) ti = 0;
    if (st === 'empty') st = 'normal';
    // 紙テープのリボン枠
    let rb = -1;
    if (ti === 4) {
      for (let k = 0; k < MAXS; k++) if (ribOwner[k] < 0) { rb = k; break; }
      if (rb < 0) { // いちばん古い紙テープを間引く
        let o = -1; for (let i = 0; i < MAX; i++) if (mode[i] && type[i] === 4 && i !== stuckI && (o < 0 || born[i] < born[o])) o = i;
        if (o >= 0) { rb = rib[o]; freeParticle(o); } else ti = 0;
      }
    }
    let i = -1;
    for (let k = 0; k < MAX; k++) if (!mode[k]) { i = k; break; }
    if (i < 0) { // 上限: 古い紙から間引く
      let o = -1;
      for (let k = 0; k < MAX; k++) if (k !== stuckI && type[k] === 0 && (o < 0 || born[k] < born[o])) o = k;
      if (o < 0) for (let k = 0; k < MAX; k++) if (k !== stuckI && type[k] !== 4 && (o < 0 || born[k] < born[o])) o = k;
      if (o < 0) return;
      freeParticle(o); i = o;
    }
    mode[i] = 1; type[i] = ti; shape[i] = rnd() < 0.5 ? 1 : 0; born[i] = ++bornN; alive++;
    colHex[i] = (color >>> 0) & 0xffffff;
    tc.setHex(colHex[i]); colR[i] = tc.r; colG[i] = tc.g; colB[i] = tc.b;
    const hf = HALF[ti];
    th[i] = -Math.PI / 2 + (rnd() - 0.5) * 0.2;
    rr[i] = RIN - hf; w[i] = 15 + rnd() * 5;
    py[i] = HH - 0.032 + (rnd() - 0.5) * 0.01; vy[i] = -0.2 - rnd() * 0.3;
    px[i] = rr[i] * Math.cos(th[i]); pz[i] = rr[i] * Math.sin(th[i]);
    sup[i] = motorS * 0.9;
    vr[i] = 0.78 + rnd() * 0.4; ph[i] = rnd() * TAU; fq[i] = 0.6 + rnd() * 1.0; u0[i] = rnd();
    ex[i] = rnd() * TAU; ey[i] = rnd() * TAU; ez[i] = rnd() * TAU;
    sx[i] = (rnd() < 0.5 ? -1 : 1) * (4 + rnd() * 6); sy[i] = (rnd() - 0.5) * 6; sz[i] = (rnd() - 0.5) * 8;
    te.set((rnd() - 0.5) * 0.9, rnd() * TAU, (rnd() - 0.5) * 0.9, 'ZXY');
    tq.setFromEuler(te); qr[i * 4] = tq.x; qr[i * 4 + 1] = tq.y; qr[i * 4 + 2] = tq.z; qr[i * 4 + 3] = tq.w;
    te.order = 'YXZ';
    bl[i] = 0; lowT[i] = 0; jit[i] = rnd(); rank[i] = -1; hop[i] = 0; hopV[i] = 0; vx[i] = vz[i] = 0;
    rib[i] = -1;
    if (ti === 4 && rb >= 0) {
      rib[i] = rb; ribOwner[rb] = i;
      for (let j = 0; j < NP; j++) { const v = (rb * NP + j) * 2; for (let e = 0; e < 2; e++) { ribCol[(v + e) * 3] = colR[i]; ribCol[(v + e) * 3 + 1] = colG[i]; ribCol[(v + e) * 3 + 2] = colB[i]; } }
      ribbonMesh.geometry.attributes.color.needsUpdate = true;
      // くしゃっと丸まった輪（重力系: +Z が上）
      const loops = 2 + rnd() * 1.2, r0 = 0.017 + rnd() * 0.008, ra = rnd() * TAU, a0 = rnd() * TAU;
      for (let j = 0; j < NP; j++) {
        const s = j / SEG, a = a0 + s * loops * TAU + 0.4 * Math.sin(j * 0.9 + ra), rad = r0 * (1 + 0.3 * Math.sin(j * 0.55 + ra));
        const o = (rb * NP + j) * 3, cx = Math.cos(a), cz = Math.sin(a);
        crump[o] = rad * cx + 0.004 * Math.sin(j * 0.31); crump[o + 1] = rad * cz; crump[o + 2] = 0.006 + 0.004 * Math.sin(j * 0.47 + ra) + s * 0.006;
        const tw = 0.7 * Math.sin(j * 0.37 + ra);
        crumpW[o] = cx * Math.sin(tw); crumpW[o + 1] = cz * Math.sin(tw); crumpW[o + 2] = Math.cos(tw);
      }
    }
  }

  function count() { return alive; }
  function fill() { return sat(alive / 200); }
  function getRattle() { return rattle; }
  function state() { return st; }
  function setHatch(open) { hatchOpen = !!open; }
  function setGlow(part, a) { if (part === 'handle') glowHandle = sat(+a || 0); else if (part === 'button') glowButton = sat(+a || 0); }

  function clear() {
    for (let i = 0; i < MAX; i++) { mode[i] = 0; rank[i] = -1; rib[i] = -1; }
    if (owner) owner.fill(-1);
    for (let k = 0; k < MAXS; k++) { ribOwner[k] = -1; ribDirty[k] = 1; }
    alive = 0; nPiled = 0; stuckI = -1; stuckN = 0; emptyPending = false; st = 'normal'; rattle = 0;
  }

  const prio = [2, 1, 0, 4, 3]; // paper, star, bead, pom, streamer の引っかかりやすさ（大きいほど優先）
  function dump() {
    if (!object || st === 'dumping' || st === 'stuck') return;
    if (alive === 0) { st = 'empty'; fire('empty'); return; }
    // 引っかかる 1 個（ポンポン > 紙テープ > 紙、同じなら上の方）
    stuckI = -1;
    if (alive >= 2) {
      let best = -1, bs = -1e9;
      for (let i = 0; i < MAX; i++) {
        if (!mode[i]) continue;
        const s = prio[type[i]] * 10 - (px[i] * g.x + py[i] * g.y + pz[i] * g.z);
        if (s > bs) { bs = s; best = i; }
      }
      stuckI = best;
    }
    owner.fill(-1); nPiled = 0;
    tmpIdx.length = 0;
    for (let i = 0; i < MAX; i++) { if (mode[i]) { rank[i] = -1; if (i !== stuckI) tmpIdx.push(i); } }
    tmpIdx.sort((a, b) => (px[b] * g.x + py[b] * g.y + pz[b] * g.z) - (px[a] * g.x + py[a] * g.y + pz[a] * g.z));
    const n = tmpIdx.length, span = clamp(0.35 + n * 0.006, 0.4, 0.95);
    for (let k = 0; k < n; k++) {
      const i = tmpIdx[k];
      mode[i] = 3; delay[i] = span * k / Math.max(1, n) + rnd() * 0.1 + (type[i] <= 1 ? 0.12 : 0);
      vx[i] = vy[i] = vz[i] = 0; hop[i] = hopV[i] = 0;
    }
    if (stuckI >= 0) { mode[stuckI] = 5; stuckP = 0; phi = 0.5; phiV = 0; vx[stuckI] = px[stuckI]; vy[stuckI] = py[stuckI]; vz[stuckI] = pz[stuckI]; }
    stuckN = 0; emptyPending = false;
    st = 'dumping';
  }

  function shake() {
    if (!object) return;
    shakeT = 0;
    if (st === 'stuck' && stuckI >= 0) {
      stuckN++;
      if (stuckN === 1) phiV += 9;
      else {
        const i = stuckI; stuckI = -1;
        mode[i] = 4; vx[i] = vy[i] = vz[i] = 0; delay[i] = 0; emptyPending = true;
      }
      return;
    }
    if (st === 'dumping' && stuckI >= 0) { phiV += 5; return; }
    if (st === 'normal') {
      for (let i = 0; i < MAX; i++) {
        if (mode[i] === 2) hopV[i] = 0.35 + rnd() * 0.45 / (type[i] === 2 ? 1.6 : 1);
        else if (mode[i] === 1) vy[i] += 0.4 + rnd() * 0.4;
      }
    }
  }

  // ================= 毎フレーム =================
  function update(dt, motor, time) {
    if (!object) return;
    dt = clamp(+dt || 0, 0, 0.05);
    motor = sat(+motor || 0);
    simTime = typeof time === 'number' ? time : simTime + dt;
    const T = simTime;
    motorS = Base.damp(motorS, motor, 4, dt);

    // 重力（object の世界姿勢から）
    object.getWorldQuaternion(tq); tq.invert();
    g.set(0, -1, 0).applyQuaternion(tq);
    if (g.dot(gSorted) < 0.9962) resort();
    qG.setFromUnitVectors(ZUP, tv.copy(g).negate());
    const gx = g.x, gy = g.y, gz = g.z;

    // 底ぶた（ばねで少し弾む）
    const tgt = hatchOpen ? 100 * Math.PI / 180 : 0;
    hatchV += (190 * (tgt - hatchA) - 11 * hatchV) * dt; hatchA += hatchV * dt;
    if (!hatchOpen && hatchA < 0) { hatchA = 0; hatchV = -hatchV * 0.2; }
    hatchG.rotation.x = hatchA;

    // とんとん（内側のグループだけ揺らす）
    shakeT += dt;
    if (shakeT < 0.6) {
      const e = Math.exp(-shakeT * 9) * Math.sin(shakeT * 46);
      body.position.set(0, -0.006 * e, 0); body.rotation.z = 0.025 * e;
    } else if (body.position.y !== 0 || body.rotation.z !== 0) { body.position.set(0, 0, 0); body.rotation.z = 0; }

    // 光るヒント（周期 1.2 秒）
    const pulse = 0.5 + 0.5 * Math.sin(T * TAU / 1.2);
    handleMat.emissiveIntensity = glowHandle * (0.18 + 0.32 * pulse);
    buttonMat.emissiveIntensity = glowButton * (0.35 + 0.75 * pulse);

    // 種類ごとの係数
    let rat = 0;
    const kA0 = 1 - Math.exp(-ARATE[0] * dt), kA1 = 1 - Math.exp(-ARATE[1] * dt), kA2 = 1 - Math.exp(-ARATE[2] * dt), kA3 = 1 - Math.exp(-ARATE[3] * dt), kA4 = 1 - Math.exp(-ARATE[4] * dt);
    const kR = 1 - Math.exp(-5 * dt), kP = 1 - Math.exp(-7 * dt), kB = 1 - Math.exp(-4 * dt);
    let waiting = 0;

    for (let i = 0; i < MAX; i++) {
      const m = mode[i];
      if (!m) continue;
      const t = type[i], hf = HALF[t];
      const kA = t === 0 ? kA0 : t === 1 ? kA1 : t === 2 ? kA2 : t === 3 ? kA3 : kA4;
      const rMax = RIN - hf, yLo = FLOOR + (t === 0 || t === 1 ? 0.004 : hf), yHi = CEIL - hf;

      if (m === 1) { // ---- 渦 ----
        const a = (sup[i] += (motor - sup[i]) * kA);
        const ia = 1 - a, G = G0 * ia * Math.sqrt(ia);
        const s = Math.sin(th[i]), c = Math.cos(th[i]);
        const r = rr[i];
        const gt = -gx * s + gz * c;
        const kth = KTH[t] + 1.5 * ia;
        w[i] += (kth * (WMAX[t] * vr[i] * a - w[i]) + G * gt / Math.max(r, 0.02)) * dt;
        th[i] += w[i] * dt;
        if (th[i] > TAU) th[i] -= TAU; else if (th[i] < -TAU) th[i] += TAU;
        // 目標の高さ・半径（竜巻: 外壁沿いに上り、芯のそばを下りる）
        let yT, rT, ky = 6, cy = 3.5;
        const phs = T * fq[i] + ph[i];
        const rMin = py[i] > CORE_BOT - hf ? coreR(py[i]) + hf + 0.003 : 0.012;
        if (t <= 1) {
          const top = t === 0 ? yHi : lerp(yLo, yHi, 0.85);
          yT = lerp(yLo + 0.01, top - 0.01, 0.5 + 0.5 * Math.sin(phs));
          rT = lerp(rMin, rMax, 0.5 + 0.42 * Math.cos(phs));
        } else if (t === 2) {
          yT = yLo + 0.012 + 0.10 * u0[i] + 0.012 * Math.sin(phs * 2.3);
          rT = rMax; ky = 7; cy = 4;
        } else if (t === 3) {
          yT = yLo + 0.008 + 0.09 * u0[i] + 0.04 * Math.abs(Math.sin(T * (2.4 + fq[i]) + ph[i]));
          rT = rMax - 0.002; ky = 12; cy = 3;
        } else {
          yT = lerp(CORE_BOT + 0.045, CEIL - 0.05, u0[i]) + 0.012 * Math.sin(phs);
          rT = coreR(yT) + 0.014;
        }
        rr[i] = r + (lerp(rMax, rT, a) - r) * kR;
        vy[i] += (a * ky * (yT - py[i]) - cy * vy[i] + G * gy) * dt;
        py[i] += vy[i] * dt;
        if (py[i] < yLo) { py[i] = yLo; vy[i] = vy[i] < 0 ? -vy[i] * (t === 3 ? 0.45 : 0.2) : vy[i]; }
        if (py[i] > yHi) { py[i] = yHi; if (vy[i] > 0) vy[i] = 0; }
        const rMin2 = py[i] > CORE_BOT - hf ? coreR(py[i]) + hf + 0.003 : 0.0;
        if (rr[i] < rMin2) rr[i] = rMin2;
        if (rr[i] > rMax) rr[i] = rMax;
        px[i] = rr[i] * Math.cos(th[i]); pz[i] = rr[i] * Math.sin(th[i]);
        const sp = 0.25 + a;
        ex[i] = (ex[i] + sx[i] * sp * dt) % TAU; ey[i] = (ey[i] + sy[i] * sp * dt * 0.3) % TAU; ez[i] = (ez[i] + sz[i] * sp * dt) % TAU;
        bl[i] += (0 - bl[i]) * kB;
        if (t === 2) rat += Math.abs(w[i]) * rr[i];
        // 山へ（気流が弱く、動きがゆっくりになったら）
        if (a < 0.12) {
          lowT[i] += dt;
          if ((Math.abs(w[i]) * rr[i] < 0.12 && Math.abs(vy[i]) < 0.25) || lowT[i] > 3) enterPile(i);
        } else lowT[i] = 0;
      } else if (m === 2) { // ---- 山 ----
        const a = (sup[i] += (motor - sup[i]) * kA);
        const k = rank[i], s = sorted[k];
        let tx = slX[s], ty = slY[s], tz = slZ[s];
        const rho = Math.hypot(tx, tz);
        if (rho > rMax) { tx *= rMax / rho; tz *= rMax / rho; }
        if (ty < yLo) ty = yLo;
        px[i] += (tx - px[i]) * kP; py[i] += (ty - py[i]) * kP; pz[i] += (tz - pz[i]) * kP;
        bl[i] += (1 - bl[i]) * kB;
        if (hopV[i] !== 0 || hop[i] > 0) {
          hopV[i] -= 6 * dt; hop[i] += hopV[i] * dt;
          if (hop[i] <= 0) { hop[i] = 0; hopV[i] = 0; }
        }
        // 気流が戻ったら上の方から順に舞い上がる
        const thr = 0.16 + 0.5 * (1 - k / Math.max(1, nPiled)) + 0.14 * jit[i];
        if (a > thr) {
          leavePile(i); mode[i] = 1;
          rr[i] = Math.max(0.005, Math.hypot(px[i], pz[i])); th[i] = Math.atan2(pz[i], px[i]);
          w[i] = 0; vy[i] = 0.25 + rnd() * 0.3; lowT[i] = 0; hop[i] = 0; hopV[i] = 0;
        }
      } else if (m === 3) { // ---- 捨て待ち ----
        waiting++;
        delay[i] -= dt;
        if (delay[i] <= 0) { mode[i] = 4; vx[i] = (rnd() - 0.5) * 0.12; vz[i] = (rnd() - 0.5) * 0.12; vy[i] = 0; }
      } else if (m === 4) { // ---- 落下 ----
        waiting++;
        const dr = DRAG[t];
        vx[i] += (gx * 9.8 - dr * vx[i]) * dt; vy[i] += (gy * 9.8 - dr * vy[i]) * dt; vz[i] += (gz * 9.8 - dr * vz[i]) * dt;
        if (t <= 1 || t === 4) { const f = Math.sin(T * 7 + ph[i]) * 0.9; vx[i] += f * dt; vz[i] += Math.cos(T * 6 + ph[i]) * 0.6 * dt; }
        px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
        if (py[i] > -HH) { const rho = Math.hypot(px[i], pz[i]); if (rho > rMax) { px[i] *= rMax / rho; pz[i] *= rMax / rho; } }
        ex[i] = (ex[i] + sx[i] * 0.6 * dt) % TAU; ez[i] = (ez[i] + sz[i] * 0.6 * dt) % TAU;
        bl[i] = 1;
        const below = (px[i] * gx + py[i] * gy + pz[i] * gz) - (-HH * gy);
        if (below > 0.32) {
          const tp = TYPES[t], ch = colHex[i];
          freeParticle(i);
          fire('land', tp, ch);
          if (emptyPending) { emptyPending = false; st = 'empty'; fire('empty'); }
        }
      } else if (m === 5) { // ---- 芯の下に引っかかり ----
        // 振り子: 支点から重力方向へ。揺れる面は重力に直交する X 寄り
        eDir.set(1, 0, 0).addScaledVector(g, -gx).normalize();
        const len = t === 4 ? 0.06 : hf + 0.014;
        phiV += (-(9.8 / len) * Math.sin(phi) * 0.35 - 1.1 * phiV) * dt; phi += phiV * dt;
        tv2.copy(pivot).addScaledVector(g, len * Math.cos(phi)).addScaledVector(eDir, len * Math.sin(phi));
        stuckP = Math.min(1, stuckP + dt * 2.2);
        const e = Base.smooth(stuckP);
        px[i] = lerp(vx[i], tv2.x, e); py[i] = lerp(vy[i], tv2.y, e); pz[i] = lerp(vz[i], tv2.z, e);
        bl[i] = 1; ex[i] += phiV * 0.3 * dt;
      }
    }

    // 山のすき間を上から埋める（1 フレーム 1 個）
    if (nPiled > 0) {
      let f = -1;
      for (let k = 0; k < NS; k++) if (owner[k] < 0) { f = k; break; }
      if (f >= 0) {
        let l = -1;
        for (let k = NS - 1; k > f; k--) if (owner[k] >= 0) { l = k; break; }
        if (l > f) { const i = owner[l]; owner[l] = -1; owner[f] = i; rank[i] = f; }
      }
    }

    if (st === 'dumping' && waiting === 0) {
      if (stuckI >= 0 && mode[stuckI] === 5) { st = 'stuck'; fire('stuck'); }
      else { st = 'empty'; fire('empty'); }
    }

    rattle = Base.damp(rattle, sat(rat / 18), 10, dt);

    // 空気の筋
    streakPhase += dt * motorS * 9;
    streakMat.opacity = sat((motorS - 0.08) * 1.4) * 0.16;
    streaks.visible = streakMat.opacity > 0.004;
    streaks.rotation.y = -streakPhase;

    writeInstances(T);
    writeRibbons(T);
  }

  function writeInstances(T) {
    counts.fill(0);
    for (let i = 0; i < MAX; i++) {
      const m = mode[i];
      if (!m) continue;
      const t = type[i];
      if (t === 4) continue;
      const mi = t === 0 ? shape[i] : t + 1;
      const mesh = meshes[mi];
      const b = bl[i];
      // 向き
      if (t === 2) qS.identity();
      else {
        if (t <= 1 && m === 1) te.set(ex[i], Math.PI / 2 - th[i] + 0.3 * Math.sin(ey[i]), ez[i] * 0.25);
        else te.set(ex[i], ey[i], ez[i]);
        qS.setFromEuler(te);
        if (b > 0.001) {
          qP.set(qr[i * 4], qr[i * 4 + 1], qr[i * 4 + 2], qr[i * 4 + 3]).premultiply(qG);
          if (b >= 0.999) qS.copy(qP); else qS.slerp(qP, b);
        }
      }
      tv.set(px[i], py[i], pz[i]);
      if (hop[i] > 0) tv.addScaledVector(g, -hop[i]);
      if (t === 3) { const sq = m === 1 ? 1 + 0.06 * Math.sin(T * 9 + ph[i]) : 1; tsc.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq)); }
      else tsc.set(1, 1, 1);
      tm.compose(tv, qS, tsc);
      const n = counts[mi]++;
      mesh.setMatrixAt(n, tm);
      tc.setRGB(colR[i], colG[i], colB[i], THREE.LinearSRGBColorSpace);
      mesh.setColorAt(n, tc);
    }
    for (let k = 0; k < meshes.length; k++) {
      const mesh = meshes[k];
      mesh.count = counts[k]; mesh.visible = counts[k] > 0;
      if (counts[k]) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; }
    }
  }

  function writeRibbons(T) {
    let any = false, dirty = false;
    for (let k = 0; k < MAXS; k++) {
      const i = ribOwner[k];
      const base = k * NP;
      if (i < 0) {
        if (ribDirty[k]) { ribPos.fill(0, base * 6, (base + NP) * 6); ribDirty[k] = 0; dirty = true; }
        continue;
      }
      any = true; dirty = true;
      const m = mode[i], b = m === 1 || m === 2 ? bl[i] : 1;
      const turns = 2.3 + 0.6 * jit[i], span = 0.075 + 0.03 * jit[i];
      const hop0 = hop[i];
      for (let j = 0; j < NP; j++) {
        const s = j / SEG;
        let cx, cy, cz, wx, wy, wz;
        // らせん（芯に巻きつく）
        let hx = 0, hy = 0, hz = 0;
        if (b < 0.999 && m <= 2) {
          const ang = th[i] - s * turns * TAU;
          const yy = clamp(py[i] + (s - 0.5) * span + 0.004 * Math.sin(s * 11 + T * 3), FLOOR + 0.006, CEIL - 0.006);
          const rad = Math.max(rr[i] + coreR(yy) - coreR(py[i]), yy > CORE_BOT - 0.01 ? coreR(yy) + 0.008 : 0.01) + 0.003 * Math.sin(s * 17 + ph[i]);
          hx = rad * Math.cos(ang); hy = yy; hz = rad * Math.sin(ang);
        }
        // くしゃっ（重力系）/ ぶら下がり
        const o = (k * NP + j) * 3;
        if (m === 5) {
          const hang = Math.min(1, s / 0.65);
          if (s < 0.65) {
            tv2.set(pivot.x + (px[i] - pivot.x) * hang, pivot.y + (py[i] - pivot.y) * hang, pivot.z + (pz[i] - pivot.z) * hang);
            tv2.x += 0.004 * Math.sin(s * 14 + T * 3);
            tv3.set(0, 0, 1);
          } else {
            tv2.set(crump[o] * 0.6, crump[o + 1] * 0.6, crump[o + 2] * 0.6 - 0.006).applyQuaternion(qG);
            tv2.x += px[i]; tv2.y += py[i]; tv2.z += pz[i];
            tv3.set(crumpW[o], crumpW[o + 1], crumpW[o + 2]).applyQuaternion(qG);
          }
          cx = tv2.x; cy = tv2.y; cz = tv2.z; wx = tv3.x; wy = tv3.y; wz = tv3.z;
        } else {
          tv2.set(crump[o], crump[o + 1], crump[o + 2]).applyQuaternion(qG);
          tv3.set(crumpW[o], crumpW[o + 1], crumpW[o + 2]).applyQuaternion(qG);
          cx = px[i] + tv2.x - g.x * hop0; cy = py[i] + tv2.y - g.y * hop0; cz = pz[i] + tv2.z - g.z * hop0;
          wx = tv3.x; wy = tv3.y; wz = tv3.z;
          if (b < 0.999) {
            cx = hx + (cx - hx) * b; cy = hy + (cy - hy) * b; cz = hz + (cz - hz) * b;
            wx = wx * b; wy = wy * b + (1 - b); wz = wz * b;
          }
        }
        const wl = 0.006 / (Math.hypot(wx, wy, wz) || 1);
        const v = (base + j) * 2 * 3;
        ribPos[v] = cx - wx * wl; ribPos[v + 1] = cy - wy * wl; ribPos[v + 2] = cz - wz * wl;
        ribPos[v + 3] = cx + wx * wl; ribPos[v + 4] = cy + wy * wl; ribPos[v + 5] = cz + wz * wl;
      }
      // 法線 = 接線 × 幅方向
      for (let j = 0; j < NP; j++) {
        const v = (base + j) * 6, va = (base + Math.max(0, j - 1)) * 6, vb = (base + Math.min(SEG, j + 1)) * 6;
        const tx = ribPos[vb] - ribPos[va], ty = ribPos[vb + 1] - ribPos[va + 1], tz = ribPos[vb + 2] - ribPos[va + 2];
        const qx = ribPos[v + 3] - ribPos[v], qy = ribPos[v + 4] - ribPos[v + 1], qz = ribPos[v + 5] - ribPos[v + 2];
        let nx = ty * qz - tz * qy, ny = tz * qx - tx * qz, nz = tx * qy - ty * qx;
        const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        ribNor[v] = ribNor[v + 3] = nx; ribNor[v + 1] = ribNor[v + 4] = ny; ribNor[v + 2] = ribNor[v + 5] = nz;
      }
    }
    ribbonMesh.visible = any;
    if (dirty) { ribbonMesh.geometry.attributes.position.needsUpdate = true; ribbonMesh.geometry.attributes.normal.needsUpdate = true; }
  }

  return {
    init, add, count, fill, update, getRattle, setHatch, dump, shake, on, state, clear, setGlow,
    get object() { return object; },
  };
})();

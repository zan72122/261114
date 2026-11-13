// vacuum.js — キャニスター型サイクロンそうじき（本体・受け台・ホース・延長管・グリップ・床ヘッド）
const Vacuum = (() => {
  const PI = Math.PI;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

  // ---------- 小道具 ----------
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();
  // ジオメトリを置く（平行移動 + 回転 XYZ）
  function tf(g, x, y, z, rx, ry, rz) {
    _e.set(rx || 0, ry || 0, rz || 0);
    _q.setFromEuler(_e);
    _p.set(x || 0, y || 0, z || 0);
    _m4.compose(_p, _q, _s);
    g.applyMatrix4(_m4);
    return g;
  }
  // 非インデックスのジオメトリに「折れ角つき」のなめらかな法線を付ける
  function smoothNormals(g, creaseDeg) {
    const p = g.attributes.position.array, nv = p.length / 3, nt = nv / 3;
    const fn = new Float32Array(nt * 3), fa = new Float32Array(nt);
    for (let t = 0; t < nt; t++) {
      const a = t * 9;
      const ux = p[a + 3] - p[a], uy = p[a + 4] - p[a + 1], uz = p[a + 5] - p[a + 2];
      const vx = p[a + 6] - p[a], vy = p[a + 7] - p[a + 1], vz = p[a + 8] - p[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1e-12;
      fn[t * 3] = nx / l; fn[t * 3 + 1] = ny / l; fn[t * 3 + 2] = nz / l; fa[t] = l;
    }
    const map = new Map();
    const key = i => Math.round(p[i * 3] * 2e4) + '_' + Math.round(p[i * 3 + 1] * 2e4) + '_' + Math.round(p[i * 3 + 2] * 2e4);
    const keys = new Array(nv);
    for (let i = 0; i < nv; i++) {
      const k = key(i); keys[i] = k;
      let arr = map.get(k); if (!arr) { arr = []; map.set(k, arr); }
      arr.push((i / 3) | 0);
    }
    const c = Math.cos(creaseDeg * PI / 180);
    const out = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) {
      const t = (i / 3) | 0, arr = map.get(keys[i]);
      let x = 0, y = 0, z = 0;
      for (let j = 0; j < arr.length; j++) {
        const u = arr[j];
        if (fn[u * 3] * fn[t * 3] + fn[u * 3 + 1] * fn[t * 3 + 1] + fn[u * 3 + 2] * fn[t * 3 + 2] < c) continue;
        x += fn[u * 3] * fa[u]; y += fn[u * 3 + 1] * fa[u]; z += fn[u * 3 + 2] * fa[u];
      }
      const l = Math.hypot(x, y, z) || 1;
      out[i * 3] = x / l; out[i * 3 + 1] = y / l; out[i * 3 + 2] = z / l;
    }
    g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
    return g;
  }
  // 複数のジオメトリを 1 つに（position / normal / uv）
  function merge(list) {
    let nv = 0, ni = 0;
    for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array(ni);
    let vo = 0, io = 0;
    for (const g of list) {
      if (!g.attributes.normal) g.computeVertexNormals();
      const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, n = P.count;
      for (let i = 0; i < n; i++) {
        pos[(vo + i) * 3] = P.getX(i); pos[(vo + i) * 3 + 1] = P.getY(i); pos[(vo + i) * 3 + 2] = P.getZ(i);
        nor[(vo + i) * 3] = N.getX(i); nor[(vo + i) * 3 + 1] = N.getY(i); nor[(vo + i) * 3 + 2] = N.getZ(i);
        if (U) { uv[(vo + i) * 2] = U.getX(i); uv[(vo + i) * 2 + 1] = U.getY(i); }
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo;
      else for (let i = 0; i < n; i++) idx[io++] = vo + i;
      vo += n;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    return out;
  }
  // 角丸の長方形 Shape（中心 cx,cy）
  function rrect(w, h, r, cx, cy, path) {
    const s = path || new THREE.Shape(), x0 = (cx || 0) - w / 2, y0 = (cy || 0) - h / 2;
    s.moveTo(x0 + r, y0);
    s.lineTo(x0 + w - r, y0); s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
    s.lineTo(x0 + w, y0 + h - r); s.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
    s.lineTo(x0 + r, y0 + h); s.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
    s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
    return s;
  }
  function extrude(shape, depth, bev, segs, curveSegs) {
    const g = new THREE.ExtrudeGeometry(shape, {
      depth, steps: 1, curveSegments: curveSegs || 10,
      bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelSegments: segs || 3,
    });
    return smoothNormals(g, 50);
  }
  // 平面図の角丸形を y0 から高さ h に立ち上げる（shape の x = x、shape の y = -z）
  function plate(shape, y0, h, bev, segs) {
    const g = extrude(shape, Math.max(0.0005, h - 2 * bev), bev, segs, 8);
    g.rotateX(-PI / 2);
    g.translate(0, y0 + bev, 0);
    return g;
  }
  // Y 軸の円柱を軸 (rx,ry,rz 回転) で置く
  const cyl = (r0, r1, h, seg) => new THREE.CylinderGeometry(r0, r1, h, seg || 24);

  // ---------- 状態 ----------
  let root = null, body = null, bodyBase = new THREE.Vector3();
  const jarMount = new THREE.Object3D();
  let head = null, headLight = null, headRing = null, wand = null, elbow = null, wandCollar = null, grip = null, swivel = null, hoseMesh = null;
  let mats = null;
  const glow = { head: 0, cradle: 0, power: 0 };
  let clock = 0, motor = 0, strainV = 0, flowV = 0;
  const H = { x: 0, z: 0, lift: 0, yaw: 0 };
  const headPos = new THREE.Vector3();

  // 延長管（グリップのばね）
  const gripTarget = new THREE.Vector3(), gripPos = new THREE.Vector3(), gripVel = new THREE.Vector3();
  let gripInit = false;
  const pivotLocal = new THREE.Vector3(0, 0.040, 0.040);  // ヘッド後ろの首の軸
  const pivotW = new THREE.Vector3(), axisA = new THREE.Vector3(), upPerp = new THREE.Vector3(), sideX = new THREE.Vector3();
  const Y_AXIS = new THREE.Vector3(0, 1, 0), UP = new THREE.Vector3(0, 1, 0);
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();
  const gripBasis = new THREE.Matrix4();
  // グリップのローカル: +Z = 管の軸（持ち手へ）、+Y = 上側。握りは -Y 側へ曲がる
  const GRIP_ARC_R = 0.12, GRIP_ARC_B = 0.85, GRIP_STRAIGHT = 0.07;
  const gripEndLocal = new THREE.Vector3(), gripEndDirLocal = new THREE.Vector3();
  const hoseEnd = new THREE.Vector3(), hoseEndDir = new THREE.Vector3();

  // ホース（verlet）
  const NS = 22, HOSE_R = 0.021;
  let SEG = 0.1;
  const P = new Float32Array(NS * 3), PP = new Float32Array(NS * 3);
  const portW = new THREE.Vector3(), portDir = new THREE.Vector3();
  let portYaw = 0;
  const PORT_PITCH = -0.22, CUFF_LEN = 0.055;
  // 描画
  let RINGS = 480; const RS = 12;
  let hosePos = null, hoseNor = null, ringC = null, ringT = null;
  const RIDGE_A = 0.0021, RING_PER_RIDGE = 4;

  // ---------- テクスチャ ----------
  function makeTextures() {
    const rnd = Base.rng(7);
    const plasticRough = Base.canvasTex(256, 256, (c, w, h) => {
      c.fillStyle = 'rgb(128,128,128)'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) {
        const v = 110 + rnd() * 40 | 0;
        c.fillStyle = `rgba(${v},${v},${v},0.35)`;
        c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 3);
      }
    }, { srgb: false, repeat: [3, 3] });
    const hair = Base.canvasTex(512, 8, (c, w, h) => {
      for (let x = 0; x < w; x++) {
        const v = 200 + rnd() * 55 | 0;
        c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(x, 0, 1, h);
      }
    }, { repeat: [2, 1] });
    const hairR = Base.canvasTex(512, 8, (c, w, h) => {
      for (let x = 0; x < w; x++) {
        const v = 70 + rnd() * 60 | 0;
        c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(x, 0, 1, h);
      }
    }, { srgb: false, repeat: [2, 1] });
    const glowTex = Base.canvasTex(128, 128, (c, w, h) => {
      const g = c.createRadialGradient(w / 2, h * 0.62, 2, w / 2, h * 0.55, w * 0.5);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(235,242,255,0.55)');
      g.addColorStop(0.7, 'rgba(220,232,255,0.15)');
      g.addColorStop(1, 'rgba(220,232,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    });
    const rubber = Base.canvasTex(128, 128, (c, w, h) => {
      c.fillStyle = 'rgb(150,150,150)'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) { const v = 120 + rnd() * 60 | 0; c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(rnd() * w, rnd() * h, 1, 1); }
    }, { srgb: false, repeat: [4, 4] });
    return { plasticRough, hair, hairR, glowTex, rubber };
  }

  function makeMaterials() {
    const t = makeTextures();
    const white = new THREE.MeshPhysicalMaterial({
      color: 0xf4f2ee, roughness: 0.34, roughnessMap: t.plasticRough, metalness: 0,
      clearcoat: 0.55, clearcoatRoughness: 0.18, envMapIntensity: 0.9,
    });
    const whiteMatte = new THREE.MeshStandardMaterial({ color: 0xe9e7e3, roughness: 0.5, roughnessMap: t.plasticRough });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.78, roughnessMap: t.rubber, metalness: 0 });
    const darkGloss = new THREE.MeshPhysicalMaterial({ color: 0x26282b, roughness: 0.4, clearcoat: 0.3, clearcoatRoughness: 0.3 });
    const teal = new THREE.MeshPhysicalMaterial({ color: 0x1fa39a, roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.2 });
    const alu = new THREE.MeshStandardMaterial({ color: 0xe2e6eb, map: t.hair, roughnessMap: t.hairR, roughness: 0.5, metalness: 0.45, envMapIntensity: 1.0 });
    const hose = new THREE.MeshStandardMaterial({ color: 0xc4c7ca, roughness: 0.52, metalness: 0 });
    const cradleGlow = new THREE.MeshStandardMaterial({ color: 0x1fa39a, roughness: 0.4, emissive: 0x1fa39a, emissiveIntensity: 0 });
    const powerLed = new THREE.MeshStandardMaterial({ color: 0x8fb8b4, roughness: 0.3, emissive: 0x3fe0d0, emissiveIntensity: 0 });
    const button = new THREE.MeshPhysicalMaterial({ color: 0xf4f2ee, roughness: 0.3, clearcoat: 0.6, emissive: 0x1fa39a, emissiveIntensity: 0 });
    const led = new THREE.MeshStandardMaterial({ color: 0xdfe9f2, roughness: 0.25, emissive: 0xe4f2ff, emissiveIntensity: 0.2 });
    const headRingM = new THREE.MeshBasicMaterial({ color: 0x9ff0e6, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const floorLight = new THREE.MeshBasicMaterial({ map: t.glowTex, color: 0xdceaff, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false });
    return { white, whiteMatte, dark, darkGloss, teal, alu, hose, cradleGlow, powerLed, button, led, headRingM, floorLight };
  }

  const mesh = (g, m, shadow) => { const o = new THREE.Mesh(g, m); o.castShadow = !!shadow && !Base.quality.low; o.receiveShadow = !Base.quality.low; return o; };

  // ---------- 本体 ----------
  function buildBody() {
    const C = L.canister;
    body = new THREE.Group();
    body.position.set(C.x, 0, C.z); body.rotation.y = C.yaw || 0;
    bodyBase.copy(body.position);
    root.add(body);

    const W = 0.23, BEV = 0.02;
    // 側面の輪郭（u = 前後、鼻先が -u。y = 高さ）。ベベルの分だけ内側の「芯」の線
    const s = new THREE.Shape();
    s.moveTo(-0.20, 0.055);
    s.lineTo(0.178, 0.055);
    s.quadraticCurveTo(0.198, 0.055, 0.198, 0.075);
    s.lineTo(0.198, 0.19);
    s.quadraticCurveTo(0.199, 0.245, 0.166, 0.245);
    s.lineTo(0.150, 0.245);
    s.quadraticCurveTo(0.128, 0.245, 0.118, 0.208);
    s.lineTo(0.022, 0.112);                         // 背もたれ（カップの底を受ける斜面）
    s.quadraticCurveTo(0.001, 0.091, -0.020, 0.112);
    s.lineTo(-0.165, 0.257);                        // 受け台の斜面（45°）
    s.quadraticCurveTo(-0.205, 0.297, -0.228, 0.235);
    s.quadraticCurveTo(-0.236, 0.21, -0.236, 0.17);
    s.lineTo(-0.236, 0.09);
    s.quadraticCurveTo(-0.236, 0.055, -0.20, 0.055);
    const shell = extrude(s, W - 2 * BEV, BEV, 5, 16);
    shell.translate(0, 0, -(W - 2 * BEV) / 2);
    shell.rotateY(-PI / 2);

    const whites = [shell], darks = [], teals = [];

    // 下のバンパー（濃灰の帯）
    const skirtS = new THREE.Shape();
    {
      const hw = 0.12, f = -0.256, r = 0.229, rr = 0.06; // shape y = -u
      skirtS.moveTo(-hw + rr, -r);
      skirtS.lineTo(hw - rr, -r); skirtS.quadraticCurveTo(hw, -r, hw, -r + rr);
      skirtS.lineTo(hw, -f - rr); skirtS.quadraticCurveTo(hw, -f, hw - rr, -f);
      skirtS.lineTo(-hw + rr, -f); skirtS.quadraticCurveTo(-hw, -f, -hw, -f - rr);
      skirtS.lineTo(-hw, -r + rr); skirtS.quadraticCurveTo(-hw, -r, -hw + rr, -r);
    }
    darks.push(plate(skirtS, 0.022, 0.05, 0.007, 3));

    // 後輪（濃灰タイヤ + 白いホイール + ティールのハブ）
    const tireProf = [];
    {
      const r0 = 0.062, r1 = 0.085, hw = 0.017, rr = 0.008, n = 4;
      const corner = (cx, cy, a0) => { for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * PI / 2; tireProf.push(new THREE.Vector2(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)); } };
      corner(r1 - rr, -hw + rr, -PI / 2);
      corner(r1 - rr, hw - rr, 0);
      tireProf.push(new THREE.Vector2(r0, hw - 0.002));
      tireProf.push(new THREE.Vector2(r0, -hw + 0.002));
      tireProf.push(tireProf[0].clone());
    }
    const rimProf = [
      new THREE.Vector2(0.0, 0.013), new THREE.Vector2(0.024, 0.013), new THREE.Vector2(0.03, 0.009),
      new THREE.Vector2(0.05, 0.012), new THREE.Vector2(0.061, 0.016), new THREE.Vector2(0.064, 0.012),
      new THREE.Vector2(0.064, -0.012), new THREE.Vector2(0.0, -0.012),
    ];
    for (const sx of [-1, 1]) {
      const x = sx * 0.142, y = 0.085, u = 0.118;
      darks.push(tf(new THREE.LatheGeometry(tireProf, 40), x, y, u, 0, 0, -sx * PI / 2));
      whites.push(tf(new THREE.LatheGeometry(rimProf, 40), x, y, u, 0, 0, -sx * PI / 2));
      teals.push(tf(cyl(0.02, 0.022, 0.012, 24), x + sx * 0.013, y, u, 0, 0, PI / 2));
      darks.push(tf(cyl(0.008, 0.008, 0.006, 12), x + sx * 0.020, y, u, 0, 0, PI / 2));
    }
    // 前のキャスター
    darks.push(tf(cyl(0.03, 0.026, 0.012, 20), 0, 0.03, -0.17));
    darks.push(tf(new THREE.SphereGeometry(0.019, 16, 12), 0, 0.019, -0.17));

    // 後ろの排気グリル（くぼんだ濃灰の窓 + 白い細いルーバー）
    darks.push(tf(plate(rrect(0.15, 0.09, 0.012), 0, 0.004, 0.0015, 2), 0, 0.135, 0.2165, PI / 2, 0, 0));
    for (let i = 0; i < 7; i++) {
      const y = 0.102 + i * 0.011;
      whites.push(tf(new THREE.BoxGeometry(0.138, 0.0032, 0.006), 0, y, 0.2195));
    }

    // 上面: 持ち手のくぼみ（濃灰）と電源ボタンの台座
    darks.push(plate(rrect(0.11, 0.026, 0.013, -0.035, -0.162), 0.2635, 0.003, 0.001, 2));
    whites.push(plate(rrect(0.10, 0.006, 0.003, -0.035, -0.149), 0.2645, 0.003, 0.001, 2)); // くぼみのふちの段
    // 電源ボタン（ドーム） + LED リング
    const btnProf = [new THREE.Vector2(0, 0.010), new THREE.Vector2(0.008, 0.0095), new THREE.Vector2(0.014, 0.0075), new THREE.Vector2(0.0165, 0.004), new THREE.Vector2(0.0165, 0)];
    const btn = mesh(tf(new THREE.LatheGeometry(btnProf, 32), 0.058, 0.262, 0.162), mats.button, false);
    const ledRing = mesh(tf(new THREE.TorusGeometry(0.0205, 0.0022, 8, 40), 0.058, 0.2655, 0.162, PI / 2, 0, 0), mats.powerLed, false);
    body.add(btn, ledRing);

    // ホース口（濃灰の受け口 + ティールのつば）
    const port = L.hosePort, pu = port.z - L.canister.z, px = port.x - L.canister.x;
    darks.push(tf(cyl(0.029, 0.031, 0.06, 28), px, port.y, pu + 0.03, PI / 2, 0, 0));
    teals.push(tf(cyl(0.034, 0.034, 0.012, 28), px, port.y, pu + 0.047, PI / 2, 0, 0));
    teals.push(tf(new THREE.TorusGeometry(0.0335, 0.004, 8, 28), px, port.y, pu + 0.041, 0, 0, 0));
    // 鼻先の側面の細いティールの線
    for (const sx of [-1, 1]) teals.push(tf(new THREE.BoxGeometry(0.003, 0.004, 0.11), sx * 0.1158, 0.17, -0.17));

    // 受け台（サドル）: jarMount の座標で作って本体へ
    const jm = L.jarMount;
    jarMount.position.set(jm.x - L.canister.x, jm.y, jm.z - L.canister.z);
    jarMount.rotation.x = -jm.tilt;
    body.add(jarMount);
    jarMount.updateMatrix();
    const ri = 0.104, ro = 0.116, ph = PI / 3, sad = new THREE.Shape();
    const nA = 24;
    for (let i = 0; i <= nA; i++) { const a = -ph + (2 * ph) * i / nA; const x = Math.sin(a) * ro, y = Math.cos(a) * ro; i ? sad.lineTo(x, y) : sad.moveTo(x, y); }
    for (let i = nA; i >= 0; i--) { const a = -ph + (2 * ph) * i / nA; sad.lineTo(Math.sin(a) * ri, Math.cos(a) * ri); }
    const sadLen = 0.215, sb = 0.003;
    const saddle = extrude(sad, sadLen - 2 * sb, sb, 2, 4);
    saddle.rotateX(-PI / 2);                  // shape y → -z（カップの下面側）, 押し出し → +y
    saddle.translate(0, -0.118 + sb, 0);
    saddle.applyMatrix4(jarMount.matrix);
    whites.push(saddle);
    // 受け台の中のゴムの当て（底面にそって 2 本）
    for (const a of [-0.45, 0.45]) {
      const g = new THREE.BoxGeometry(0.012, 0.18, 0.004);
      tf(g, Math.sin(a) * (ri - 0.0015), -0.012, -Math.cos(a) * (ri - 0.0015), 0, -a, 0);
      // 上の回転は y 軸まわりで、当ての面を円筒の内側に沿わせる
      g.applyMatrix4(jarMount.matrix);
      darks.push(g);
    }
    // 吸気口のパッキン（カップ上端の下側に当たる）
    {
      const g = new THREE.TorusGeometry(0.02, 0.004, 8, 24);
      tf(g, 0, 0.105, -ri + 0.002, 0, 0, 0);
      g.applyMatrix4(jarMount.matrix);
      darks.push(g);
    }
    // 受け台のふち（光る細い帯）
    const rims = [];
    for (const a of [-ph, ph]) {
      const g = cyl(0.0042, 0.0042, sadLen - 0.01, 10);
      tf(g, Math.sin(a) * (ri + ro) / 2, -0.0105, -Math.cos(a) * (ri + ro) / 2 + 0.0005);
      rims.push(g);
    }
    {
      const g = new THREE.TorusGeometry((ri + ro) / 2, 0.0035, 6, 30, 2 * ph);
      tf(g, 0, -0.118 + 0.002, 0, PI / 2, 0, -PI / 2 - ph);
      rims.push(g);
    }
    const rimG = merge(rims); rimG.applyMatrix4(jarMount.matrix);
    const cradleRim = mesh(rimG, mats.cradleGlow, false);
    body.add(cradleRim);

    const wm = mesh(merge(whites), mats.white, true);
    const dm = mesh(merge(darks), mats.dark, true);
    const tm = mesh(merge(teals), mats.teal, true);
    body.add(wm, dm, tm);
  }

  // ---------- 床ヘッド ----------
  function buildHead() {
    const h = L.head;
    head = new THREE.Group();
    head.rotation.order = 'YXZ';
    root.add(head);
    const whites = [], darks = [], teals = [];
    // 底板
    darks.push(plate(rrect(h.w - 0.012, h.d - 0.012, 0.02), 0.003, 0.010, 0.002, 2));
    // バンパー（輪）
    {
      const o = rrect(h.w, h.d, 0.026);
      o.holes.push(rrect(h.w - 0.022, h.d - 0.022, 0.018, 0, 0, new THREE.Path()));
      darks.push(plate(o, 0.008, 0.022, 0.003, 2));
    }
    // 白い上面（角の丸い低いふた）
    whites.push(plate(rrect(h.w - 0.03, h.d - 0.03, 0.017), 0.010, h.h - 0.010, 0.008, 4));
    // 首の台座と軸受け
    whites.push(plate(rrect(0.075, 0.032, 0.012, 0, -0.032), 0.03, 0.022, 0.005, 3));
    darks.push(tf(cyl(0.016, 0.016, 0.062, 20), 0, pivotLocal.y, pivotLocal.z - 0.002, 0, 0, PI / 2));
    // 後ろの小さな車輪
    for (const sx of [-1, 1]) darks.push(tf(cyl(0.012, 0.012, 0.012, 16), sx * 0.105, 0.012, 0.036, 0, 0, PI / 2));
    // ティールの細い帯（上面）
    teals.push(tf(new THREE.BoxGeometry(h.w - 0.06, 0.0016, 0.006), 0, h.h + 0.0002, 0.004));
    // 前縁の LED 帯（前面 + 上面の前寄り）
    const leds = [
      tf(new THREE.BoxGeometry(0.20, 0.006, 0.003), 0, 0.019, -h.d / 2 - 0.0002),
      tf(new THREE.BoxGeometry(0.19, 0.0016, 0.005), 0, h.h + 0.0002, -0.027),
    ];
    const wm = mesh(merge(whites), mats.white, true), dm = mesh(merge(darks), mats.dark, true), tm = mesh(merge(teals), mats.teal, false);
    const lm = mesh(merge(leds), mats.led, false);
    head.add(wm, dm, tm, lm);
    // ふちの光（ヒント）: バンパーの上の細い輪
    const ring = rrect(h.w - 0.001, h.d - 0.001, 0.026);
    ring.holes.push(rrect(h.w - 0.016, h.d - 0.016, 0.019, 0, 0, new THREE.Path()));
    const rg = new THREE.ShapeGeometry(ring, 8); rg.rotateX(-PI / 2); rg.translate(0, 0.0308, 0);
    headRing = new THREE.Mesh(rg, mats.headRingM);
    headRing.visible = false; headRing.renderOrder = 2;
    head.add(headRing);
    // 床の光の楕円
    headLight = new THREE.Mesh(new THREE.PlaneGeometry(0.40, 0.30), mats.floorLight);
    headLight.rotation.order = 'YXZ';
    headLight.renderOrder = 2;
    root.add(headLight);
  }

  // ---------- 延長管・グリップ ----------
  function buildWand() {
    const eg = cyl(0.0205, 0.019, 0.075, 24); eg.translate(0, 0.0375, 0);
    const ep = [eg, tf(cyl(0.022, 0.022, 0.016, 24), 0, 0.068, 0)];
    elbow = mesh(merge(ep), mats.white, true); root.add(elbow);
    const wg = cyl(0.017, 0.017, 1, 24, 1); wg.translate(0, 0.5, 0);
    wand = mesh(wg, mats.alu, true); root.add(wand);
    wandCollar = mesh(merge([cyl(0.0195, 0.0195, 0.032, 24), tf(cyl(0.006, 0.006, 0.012, 12), 0, 0, 0.018, PI / 2, 0, 0)]), mats.darkGloss, true);
    root.add(wandCollar);

    grip = new THREE.Group(); grip.matrixAutoUpdate = false; root.add(grip);
    // 中心線（ローカル）: 0..STRAIGHT はまっすぐ +Z、その先 -Y 側へ弧
    const pts = [];
    const pathAt = (s, out) => {
      if (s <= GRIP_STRAIGHT) return out.set(0, 0, s);
      const b = Math.min((s - GRIP_STRAIGHT) / GRIP_ARC_R, GRIP_ARC_B);
      out.set(0, -GRIP_ARC_R + GRIP_ARC_R * Math.cos(b), GRIP_STRAIGHT + GRIP_ARC_R * Math.sin(b));
      const extra = s - GRIP_STRAIGHT - GRIP_ARC_R * GRIP_ARC_B;
      if (extra > 0) { out.y += -Math.sin(GRIP_ARC_B) * extra; out.z += Math.cos(GRIP_ARC_B) * extra; }
      return out;
    };
    const total = GRIP_STRAIGHT + GRIP_ARC_R * GRIP_ARC_B + 0.035;
    for (let i = 0; i <= 16; i++) pts.push(pathAt(-0.03 + (total + 0.03) * i / 16, new THREE.Vector3()));
    const curve = new THREE.CatmullRomCurve3(pts);
    const tubeG = new THREE.TubeGeometry(curve, 40, 0.0215, 20, false);
    const rubPts = [];
    for (let i = 0; i <= 10; i++) rubPts.push(pathAt(GRIP_STRAIGHT + 0.012 + (GRIP_ARC_R * GRIP_ARC_B - 0.01) * i / 10, new THREE.Vector3()));
    const rub = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rubPts), 24, 0.0245, 20, false);
    gripEndLocal.copy(pathAt(total, new THREE.Vector3()));
    gripEndDirLocal.set(0, -Math.sin(GRIP_ARC_B), Math.cos(GRIP_ARC_B));
    // 末端のカフ（ホースをくわえる）
    const cuff = cyl(0.0255, 0.0245, 0.05, 24); cuff.translate(0, 0.02, 0);
    _q.setFromUnitVectors(Y_AXIS, gripEndDirLocal); _m4.compose(gripEndLocal, _q, _s); cuff.applyMatrix4(_m4);
    const cuffRing = new THREE.TorusGeometry(0.0255, 0.0025, 6, 24); cuffRing.rotateX(PI / 2); cuffRing.translate(0, 0.044, 0); cuffRing.applyMatrix4(_m4);
    // 管を受けるつば
    const sock = tf(cyl(0.0225, 0.0225, 0.05, 24), 0, 0, -0.015, PI / 2, 0, 0);
    const wm = mesh(merge([tubeG, cuff, sock]), mats.white, true);
    const rm = mesh(rub, mats.dark, true);
    // 手元の操作部（小さなスライドボタン）
    const ctl = merge([
      tf(new THREE.CapsuleGeometry(0.0065, 0.022, 4, 12), 0, 0.0205, 0.035, PI / 2, 0, 0),
      tf(cyl(0.0025, 0.0025, 0.003, 10), 0, 0.0275, 0.03),
    ]);
    const cm = mesh(ctl, mats.teal, false);
    const cr = mesh(merge([cuffRing, tf(plate(rrect(0.016, 0.04, 0.006), 0, 0.0018, 0.0006, 1), 0, 0.0195, 0.035)]), mats.dark, false);
    grip.add(wm, rm, cm, cr);

    // ホース口のスイベルカフ（向きが少し回る）
    const sg = merge([
      (() => { const g = cyl(0.026, 0.0245, CUFF_LEN, 24); g.translate(0, CUFF_LEN / 2, 0); return g; })(),
      tf(new THREE.TorusGeometry(0.026, 0.0028, 6, 24), 0, 0.012, 0, PI / 2, 0, 0),
    ]);
    swivel = mesh(sg, mats.whiteMatte, true); root.add(swivel);
  }

  // ---------- ホース ----------
  function buildHose() {
    if (Base.quality.low) RINGS = 300;
    hosePos = new Float32Array(RINGS * RS * 3);
    hoseNor = new Float32Array(RINGS * RS * 3);
    ringC = new Float32Array(RINGS * 3);
    ringT = new Float32Array(RINGS * 3);
    const idx = new Uint32Array((RINGS - 1) * RS * 6);
    let o = 0;
    for (let k = 0; k < RINGS - 1; k++) for (let j = 0; j < RS; j++) {
      const a = k * RS + j, b = k * RS + (j + 1) % RS, c = (k + 1) * RS + j, d = (k + 1) * RS + (j + 1) % RS;
      idx[o++] = a; idx[o++] = b; idx[o++] = c;
      idx[o++] = b; idx[o++] = d; idx[o++] = c;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(hosePos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(hoseNor, 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    hoseMesh = mesh(g, mats.hose, true);
    hoseMesh.frustumCulled = false;
    root.add(hoseMesh);
    SEG = L.hoseLen / (NS - 1);
  }

  // ---------- 姿勢の計算 ----------
  function computeHeadAndWand(dt) {
    // ヘッド
    const ux = L.user.x - H.x, uz = L.user.z - H.z, ul = Math.hypot(ux, uz) || 1;
    const dx = ux / ul, dz = uz / ul;
    H.yaw = Math.atan2(dx, dz);
    head.position.set(H.x, H.lift, H.z);
    head.rotation.set(-Math.min(H.lift * 1.6, 0.32), H.yaw, 0);
    head.updateMatrix(); head.updateMatrixWorld(true);
    // 床の光
    const fl = 0.17;
    headLight.position.set(H.x - dx * fl, 0.013, H.z - dz * fl);
    headLight.rotation.set(-PI / 2, H.yaw, 0);

    // グリップ（ばねで少し遅れる）
    gripTarget.set(H.x + dx * L.wand.reach, L.wand.gripH + H.lift, H.z + dz * L.wand.reach);
    if (!gripInit || gripPos.distanceTo(gripTarget) > 0.5) { gripPos.copy(gripTarget); gripVel.set(0, 0, 0); gripInit = true; }
    else if (dt > 0) {
      const k = 520, c = 30;
      let t = dt; const h = 1 / 240;
      while (t > 1e-6) {
        const st = Math.min(h, t); t -= st;
        tmpA.subVectors(gripTarget, gripPos).multiplyScalar(k).addScaledVector(gripVel, -c);
        gripVel.addScaledVector(tmpA, st);
        gripPos.addScaledVector(gripVel, st);
      }
    }
    // 首と管
    pivotW.copy(pivotLocal).applyMatrix4(head.matrixWorld);
    axisA.subVectors(gripPos, pivotW);
    const len = axisA.length(); axisA.divideScalar(len || 1);
    _q.setFromUnitVectors(Y_AXIS, axisA);
    elbow.position.copy(pivotW); elbow.quaternion.copy(_q);
    const w0 = 0.07;
    wand.position.copy(pivotW).addScaledVector(axisA, w0); wand.quaternion.copy(_q);
    wand.scale.set(1, Math.max(0.05, len - w0 + 0.01), 1);
    wandCollar.position.copy(pivotW).addScaledVector(axisA, w0 + (len - w0) * 0.52); wandCollar.quaternion.copy(_q);
    // グリップの基底
    upPerp.copy(UP).addScaledVector(axisA, -UP.dot(axisA)).normalize();
    sideX.crossVectors(upPerp, axisA);
    gripBasis.makeBasis(sideX, upPerp, axisA).setPosition(gripPos);
    grip.matrix.copy(gripBasis); grip.matrixWorldNeedsUpdate = true;
    hoseEnd.copy(gripEndLocal).applyMatrix4(gripBasis);
    hoseEndDir.copy(gripEndDirLocal).transformDirection(gripBasis);
    hoseEnd.addScaledVector(hoseEndDir, 0.045);
  }

  function computePort(dt, snap) {
    const port = L.hosePort;
    const gx = gripPos.x - port.x, gz = gripPos.z - port.z;
    const target = clamp(Math.atan2(gx, -gz), -1.1, 1.1);
    portYaw = snap ? target : Base.damp(portYaw, target, 3, dt);
    const cp = Math.cos(PORT_PITCH);
    portDir.set(Math.sin(portYaw) * cp, Math.sin(PORT_PITCH), -Math.cos(portYaw) * cp);
    swivel.position.set(port.x, port.y, port.z);
    _q.setFromUnitVectors(Y_AXIS, portDir); swivel.quaternion.copy(_q);
    portW.set(port.x, port.y, port.z).addScaledVector(portDir, CUFF_LEN - 0.012);
  }

  // ---------- ホースの物理 ----------
  function pinEnds() {
    const n = NS - 1;
    P[0] = portW.x; P[1] = portW.y; P[2] = portW.z;
    P[3] = portW.x + portDir.x * SEG; P[4] = portW.y + portDir.y * SEG; P[5] = portW.z + portDir.z * SEG;
    P[n * 3] = hoseEnd.x; P[n * 3 + 1] = hoseEnd.y; P[n * 3 + 2] = hoseEnd.z;
    P[(n - 1) * 3] = hoseEnd.x + hoseEndDir.x * SEG; P[(n - 1) * 3 + 1] = hoseEnd.y + hoseEndDir.y * SEG; P[(n - 1) * 3 + 2] = hoseEnd.z + hoseEndDir.z * SEG;
    for (const i of [0, 1, n - 1, n]) { PP[i * 3] = P[i * 3]; PP[i * 3 + 1] = P[i * 3 + 1]; PP[i * 3 + 2] = P[i * 3 + 2]; }
  }
  function resetHose() {
    pinEnds();
    const a = 1, b = NS - 2;
    for (let i = a + 1; i < b; i++) {
      const t = (i - a) / (b - a);
      for (let c = 0; c < 3; c++) P[i * 3 + c] = P[a * 3 + c] + (P[b * 3 + c] - P[a * 3 + c]) * t;
      P[i * 3] += Math.sin(t * PI) * 0.35;
      P[i * 3 + 1] = Math.max(HOSE_R, P[i * 3 + 1] - Math.sin(t * PI) * 0.4);
      PP[i * 3] = P[i * 3]; PP[i * 3 + 1] = P[i * 3 + 1]; PP[i * 3 + 2] = P[i * 3 + 2];
    }
  }
  // 本体とカップの箱（ワールド、余裕つき）
  const C0 = L.canister;
  const BOXES = [
    [C0.x - 0.165, C0.x + 0.165, 0, 0.27, C0.z - 0.25, C0.z + 0.23],
    [C0.x - 0.11, C0.x + 0.11, 0.27, 0.47, C0.z - 0.21, C0.z + 0.17],
  ];
  function pushOutBoxes(i) {
    const o = i * 3, r = HOSE_R;
    for (const b of BOXES) {
      const x = P[o], y = P[o + 1], z = P[o + 2];
      if (x < b[0] - r || x > b[1] + r || y > b[3] + r || z < b[4] - r || z > b[5] + r) continue;
      const dxm = x - (b[0] - r), dxp = (b[1] + r) - x, dyp = (b[3] + r) - y, dzm = z - (b[4] - r), dzp = (b[5] + r) - z;
      const m = Math.min(dxm, dxp, dyp, dzm, dzp);
      if (m === dyp) P[o + 1] += dyp;
      else if (m === dxm) P[o] -= dxm;
      else if (m === dxp) P[o] += dxp;
      else if (m === dzm) P[o + 2] -= dzm;
      else P[o + 2] += dzp;
    }
  }
  function simStep(h) {
    const n = NS - 1, g = -9.8 * h * h;
    const shake = flowV * 0.9 + strainV * 0.4;
    for (let i = 2; i < n - 1; i++) {
      const o = i * 3;
      const x = P[o], y = P[o + 1], z = P[o + 2];
      let vx = (x - PP[o]) * 0.975, vy = (y - PP[o + 1]) * 0.975, vz = (z - PP[o + 2]) * 0.975;
      if (y <= HOSE_R + 0.002) { vx *= 0.82; vz *= 0.82; } // 床の摩擦
      PP[o] = x; PP[o + 1] = y; PP[o + 2] = z;
      let ax = 0, ay = g, az = 0;
      if (shake > 0) {
        const t = clock * 31 + i * 1.7, hh = h * h * shake;
        ax += Math.sin(t) * 1.6 * hh; ay += Math.sin(t * 1.31 + 1) * 2.2 * hh; az += Math.cos(t * 0.87) * 1.6 * hh;
      }
      P[o] = x + vx + ax; P[o + 1] = y + vy + ay; P[o + 2] = z + vz + az;
    }
    for (let it = 0; it < 10; it++) {
      // 節の長さ
      for (let i = 0; i < n; i++) {
        const a = i * 3, b = a + 3;
        const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const wa = (i <= 1 || i >= n - 1) ? 0 : 1, wb = (i + 1 <= 1 || i + 1 >= n - 1) ? 0 : 1;
        const ws = wa + wb; if (!ws) continue;
        const k = (d - SEG) / d / ws;
        P[a] += dx * k * wa; P[a + 1] += dy * k * wa; P[a + 2] += dz * k * wa;
        P[b] -= dx * k * wb; P[b + 1] -= dy * k * wb; P[b + 2] -= dz * k * wb;
      }
      // 曲げのかたさ（i と i+2 が近づきすぎない）
      {
        const minD = SEG * 1.85;
        for (let i = 0; i < n - 1; i++) {
          const a = i * 3, b = a + 6;
          const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
          if (d >= minD) continue;
          const wa = (i <= 1 || i >= n - 1) ? 0 : 1, wb = (i + 2 <= 1 || i + 2 >= n - 1) ? 0 : 1;
          const ws = wa + wb; if (!ws) continue;
          const k = (d - minD) / d / ws * 0.5;
          P[a] += dx * k * wa; P[a + 1] += dy * k * wa; P[a + 2] += dz * k * wa;
          P[b] -= dx * k * wb; P[b + 1] -= dy * k * wb; P[b + 2] -= dz * k * wb;
        }
      }
      for (let i = 2; i < n - 1; i++) {
        const o = i * 3;
        if (P[o + 1] < HOSE_R) P[o + 1] = HOSE_R;
        pushOutBoxes(i);
      }
    }
  }

  // ---------- ホースの描画 ----------
  function cr(p0, p1, p2, p3, f) {
    const f2 = f * f, f3 = f2 * f;
    return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (-p0 + 3 * p1 - 3 * p2 + p3) * f3);
  }
  const nV = new THREE.Vector3(), bV = new THREE.Vector3(), tV = new THREE.Vector3();
  // 前回描いたときの節の位置。ホースが止まっているときは頂点の作り直し・転送（約 14 万バイト/フレーム）を省く
  const DP = new Float32Array(NS * 3).fill(1e9);
  function drawHose() {
    let moved = false;
    for (let i = 0; i < DP.length; i++) if (Math.abs(P[i] - DP[i]) > 1e-5) { moved = true; break; }
    if (!moved) return;
    DP.set(P);
    const n = NS - 1;
    const at = (i, c) => {
      if (i < 0) return 2 * P[c] - P[3 + c];
      if (i > n) return 2 * P[n * 3 + c] - P[(n - 1) * 3 + c];
      return P[i * 3 + c];
    };
    for (let k = 0; k < RINGS; k++) {
      const t = k / (RINGS - 1) * n;
      let i = Math.floor(t); if (i > n - 1) i = n - 1;
      const f = t - i;
      for (let c = 0; c < 3; c++) ringC[k * 3 + c] = cr(at(i - 1, c), at(i, c), at(i + 1, c), at(i + 2, c), f);
    }
    let len = 0;
    for (let k = 1; k < RINGS; k++) len += Math.hypot(ringC[k * 3] - ringC[k * 3 - 3], ringC[k * 3 + 1] - ringC[k * 3 - 2], ringC[k * 3 + 2] - ringC[k * 3 - 1]);
    const ds = len / (RINGS - 1);
    for (let k = 0; k < RINGS; k++) {
      const a = Math.max(0, k - 1), b = Math.min(RINGS - 1, k + 1);
      tV.set(ringC[b * 3] - ringC[a * 3], ringC[b * 3 + 1] - ringC[a * 3 + 1], ringC[b * 3 + 2] - ringC[a * 3 + 2]).normalize();
      ringT[k * 3] = tV.x; ringT[k * 3 + 1] = tV.y; ringT[k * 3 + 2] = tV.z;
    }
    // 平行移送の枠
    tV.set(ringT[0], ringT[1], ringT[2]);
    nV.set(0, 1, 0); if (Math.abs(tV.y) > 0.9) nV.set(1, 0, 0);
    nV.addScaledVector(tV, -nV.dot(tV)).normalize();
    const w = 2 * PI / RING_PER_RIDGE;
    const slopeK = RIDGE_A * w / ds;
    for (let k = 0; k < RINGS; k++) {
      tV.set(ringT[k * 3], ringT[k * 3 + 1], ringT[k * 3 + 2]);
      nV.addScaledVector(tV, -nV.dot(tV)).normalize();
      bV.crossVectors(tV, nV);
      // 端は蛇腹を弱める（カフに入る部分）
      const edge = Math.min(k, RINGS - 1 - k) < 6 ? 0.3 : 1;
      const r = HOSE_R - RIDGE_A + RIDGE_A * Math.cos(k * w) * edge;
      const drds = -slopeK * Math.sin(k * w) * edge;
      const cx = ringC[k * 3], cy = ringC[k * 3 + 1], cz = ringC[k * 3 + 2];
      for (let j = 0; j < RS; j++) {
        const th = j / RS * 2 * PI, cs = Math.cos(th), sn = Math.sin(th);
        const rx = nV.x * cs + bV.x * sn, ry = nV.y * cs + bV.y * sn, rz = nV.z * cs + bV.z * sn;
        const o = (k * RS + j) * 3;
        hosePos[o] = cx + rx * r; hosePos[o + 1] = cy + ry * r; hosePos[o + 2] = cz + rz * r;
        let nx = rx - drds * tV.x, ny = ry - drds * tV.y, nz = rz - drds * tV.z;
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        hoseNor[o] = nx / l; hoseNor[o + 1] = ny / l; hoseNor[o + 2] = nz / l;
      }
    }
    const g = hoseMesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
  }

  // ---------- 公開 API ----------
  function init(ctx) {
    mats = makeMaterials();
    root = new THREE.Group();
    root.name = 'Vacuum';
    buildBody();
    buildHead();
    buildWand();
    buildHose();
    ctx.scene.add(root);
    H.x = L.head.restX; H.z = L.head.restZ; H.lift = 0;
    computeHeadAndWand(0);
    computePort(0, true);
    resetHose();
    for (let i = 0; i < 600; i++) { pinEnds(); simStep(1 / 120); }
    drawHose();
  }

  function attachJar(obj) {
    jarMount.add(obj);
    obj.position.set(0, 0, 0);
    obj.rotation.set(0, 0, 0);
    obj.quaternion.identity();
  }
  function detachJar(obj, scene) {
    if (scene) scene.attach(obj);
  }
  function setHead(x, z, lift) {
    H.x = x; H.z = z; H.lift = Math.max(0, lift || 0);
  }
  function getHeadYaw() { return H.yaw; }
  function getMouth(out) {
    out = out || new THREE.Vector3();
    return out.set(H.x, H.lift, H.z);
  }
  function setGlow(part, a) {
    if (part in glow) glow[part] = clamp(a || 0, 0, 1);
  }

  let acc = 0;
  function update(dt, s) {
    if (!root) return;
    dt = clamp(dt || 0, 0, 0.05);
    s = s || {};
    clock += dt;
    motor = Base.damp(motor, clamp(s.motor || 0, 0, 1), 10, dt);
    strainV = Base.damp(strainV, clamp(s.strain || 0, 0, 1), 6, dt);
    flowV = Base.damp(flowV, clamp(s.flow || 0, 0, 1), 8, dt);

    // 本体のこまかい震え（0.5mm 程度）
    const amp = 0.0005 * motor * (1 + strainV * 0.8);
    body.position.set(
      bodyBase.x + Math.sin(clock * 151) * amp * 0.7,
      bodyBase.y + Math.sin(clock * 197 + 1.3) * amp * 0.5,
      bodyBase.z + Math.sin(clock * 173 + 2.1) * amp * 0.6);

    // 光
    const pulse = 0.5 - 0.5 * Math.cos(clock * 2 * PI / 1.2);
    mats.powerLed.emissiveIntensity = Math.max(motor * 1.8, glow.power * (0.4 + 1.2 * pulse));
    mats.button.emissiveIntensity = glow.power * pulse * 0.25;
    mats.cradleGlow.emissiveIntensity = glow.cradle * (0.25 + 1.1 * pulse);
    mats.cradleGlow.emissive.setHex(0x1fa39a).lerp(tmpColor.setHex(0xe8fffb), glow.cradle * pulse * 0.6);
    mats.led.emissiveIntensity = 0.25 + motor * 1.6 + glow.head * pulse * 0.9;
    mats.headRingM.opacity = glow.head * (0.15 + 0.55 * pulse);
    headRing.visible = glow.head > 0.01;
    const liftFade = clamp(1 - H.lift / 0.12, 0, 1);
    mats.floorLight.opacity = (0.10 + 0.32 * motor + 0.12 * glow.head * pulse) * liftFade;
    headLight.visible = mats.floorLight.opacity > 0.005;

    computeHeadAndWand(dt);
    computePort(dt, false);
    // ホース（固定刻み）
    acc += dt;
    let steps = 0;
    const h = 1 / 120;
    while (acc >= h && steps < 6) { pinEnds(); simStep(h); acc -= h; steps++; }
    if (steps >= 6) acc = 0;
    pinEnds();
    drawHose();
  }
  const tmpColor = new THREE.Color();

  function applyQuality() {
    if (!root) return;
    const on = !Base.quality.low;
    root.traverse(o => { if (o.isMesh && o.material !== mats.headRingM && o.material !== mats.floorLight) { o.receiveShadow = on; } });
    for (const m of [elbow, wand, wandCollar, hoseMesh, swivel]) m.castShadow = on;
    body.children.forEach(o => { if (o.isMesh && (o.material === mats.white || o.material === mats.dark || o.material === mats.teal)) o.castShadow = on; });
    head.children.forEach(o => { if (o.isMesh && (o.material === mats.white || o.material === mats.dark)) o.castShadow = on; });
    grip.children.forEach(o => { if (o.isMesh) o.castShadow = on; });
  }

  return { init, jarMount, attachJar, detachJar, setHead, getHeadYaw, getMouth, update, setGlow, applyQuality };
})();

// debris.js — くす玉から降って床に散らばるもの（紙ふぶき・ホイルの星・ビーズ・ポンポン・紙テープ）とくつした
const Debris = (() => {
  const TAU = Math.PI * 2;
  const clamp = Base.clamp, sat = Base.sat, lerp = Base.lerp, smooth = Base.smooth, damp = Base.damp;
  const MAXP = 250, MAXS = 6, NMAX = 16, SUB = 3, SECMAX = (NMAX - 1) * SUB + 1;
  const G = 9.8;
  const DEAD = 0, FLY = 1, BALL = 2, FLOOR = 3, SUCK = 4;
  const K_PC = 0, K_PS = 1, K_STAR = 2, K_BEAD = 3, K_POM = 4, NK = 5;
  const TYPE = ['paper', 'paper', 'star', 'bead', 'pom'];
  const BEAD_R = 0.0125, POM_R = 0.025;
  const BLOB = [0.036, 0.036, 0.04, 0.036, 0.074];
  const RIB_HW = 0.006;

  // 色（本物の色紙・ホイル・樹脂・毛糸の色。彩度は控えめ）
  const PAPER_COLS = [0xd23a36, 0xe97a22, 0xf0c22e, 0x3f9c4f, 0x2f6fc6, 0xe7799f, 0xf4f0e6, 0x7b58b8];
  const STAR_COLS = [0xe2b955, 0xd6dbe0, 0xc8343e, 0x3f68cc, 0x3c9a60];
  const BEAD_COLS = [0xef6a7a, 0x5cb6e6, 0xf6cf4f, 0x78cc8a, 0xb48be0, 0xf5f2ec, 0xf29a3e, 0x2f6ecf];
  const POM_COLS = [0xe2506a, 0xf3b236, 0x56b6d6, 0x8ccb58, 0xf09ac0, 0xf6f3ee, 0x9a7ed6];
  const RIB_COLS = [0xd83a4c, 0x2f7fd2, 0xf0bb2c, 0x43a35c, 0xe6779f, 0x7d5cc4, 0xea7a2a];

  const on = { suck: null, land: null, sockStick: null, sockDrop: null, sockBasket: null };
  const fire = (fn, a, b) => { if (typeof fn === 'function') { try { fn(a, b); } catch (e) { /* 黙って続ける */ } } };
  const fy = (x, z) => (L.onRug(x, z) ? L.rug.pile : 0);
  const wrapA = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

  // ---- 粒の状態（配列で持つ。粒 i は各 InstancedMesh のスロット i を使う）----
  const state = new Uint8Array(MAXP), kind = new Uint8Array(MAXP), bounces = new Uint8Array(MAXP);
  const color = new Int32Array(MAXP);
  const F = () => new Float32Array(MAXP);
  const px = F(), py = F(), pz = F(), vx = F(), vy = F(), vz = F();
  const ox = F(), oy = F(), oz = F(), tx = F(), tz = F(), bx = F(), bz = F(), bup = F();
  const tt = F(), TT = F(), rx = F(), ry = F(), rz = F(), ry0 = F(), yawSpd = F(), flips = F();
  const rockA = F(), swA = F(), swW = F(), ph = F(), sdx = F(), sdz = F();
  const qx = F(), qy = F(), qz = F(), qw = F(), scl = F(), restOff = F(), sq = F(), sqv = F(), lift = F();
  const sx0 = F(), sy0 = F(), sz0 = F(), dist = F();
  let hi = 0;

  // ---- 紙テープ ----
  const streamers = [];
  for (let s = 0; s < MAXS; s++) {
    const A = () => new Float32Array(NMAX);
    streamers.push({
      st: 0, n: 14, seg: 0.05, len: 0.7, color: 0xffffff, px: A(), py: A(), pz: A(), rx: A(), rz: A(), tw: A(),
      t: 0, d0: 0, dstep: 0.05, Tb: 1.6, Tstep: 0.03, ox: 0, oy: 0, oz: 0, bx: 0, bz: 0,
      swA: 0.05, swW: 3, ph: 0, sdx: 1, sdz: 0, cut: 0, h: 0, restOff: 0.0016, landed: false, cleared: true,
    });
  }
  const csx = new Float32Array(SECMAX), csy = new Float32Array(SECMAX), csz = new Float32Array(SECMAX), ctw = new Float32Array(SECMAX);

  // ---- 描画物 ----
  let scene = null, camera = null;
  const meshes = [];
  let blobMesh = null, twMesh = null, ribMesh = null, ribPos = null, ribNor = null, ribCol = null;
  const socks = [];

  // ---- 作業用（毎フレーム new しない）----
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
  const _s = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _ax = new THREE.Vector3(), _c = new THREE.Color();
  const _camQ = new THREE.Quaternion(), _camP = new THREE.Vector3();
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const tmpPt = { x: 0, z: 0 };
  const hd = { ok: false, x: 0, z: 0, lift: 0, yaw: 0, motor: 0, mx: 0, my: 0, mz: 0, vx: 0, vz: 0 };

  let rnd = Base.rng(9157), time = 0, tokens = 0, twAmp = 0, slurpIdx = -1, slurpAmt = 0, slurpEat = 0, burstNo = 0;
  let stuck = -1, low = false;

  // =====================================================================
  // ジオメトリ・素材
  // =====================================================================
  function curl(g, k, k2) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      p.setY(i, k * x * x + k2 * z * z);
    }
    g.computeVertexNormals();
    return g;
  }
  function paperTex() {
    return Base.canvasTex(128, 128, (c, w, h) => {
      const r = Base.rng(31);
      c.fillStyle = '#f6f4f0'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) {
        const v = 200 + Math.floor(r() * 55);
        c.fillStyle = `rgba(${v},${v},${v - 4},0.35)`;
        c.fillRect(r() * w, r() * h, 1 + r() * 2, 1);
      }
      c.strokeStyle = 'rgba(255,255,255,0.25)';
      for (let i = 0; i < 60; i++) { c.beginPath(); const x = r() * w, y = r() * h; c.moveTo(x, y); c.lineTo(x + (r() - 0.5) * 14, y + (r() - 0.5) * 14); c.stroke(); }
    });
  }
  function starGeo() {
    const R = 0.021, r = 0.0088, pos = [];
    const rr = Base.rng(77);
    const outer = [];
    for (let j = 0; j < 10; j++) {
      const a = j / 10 * TAU + Math.PI / 2, rad = j % 2 ? r : R;
      outer.push([Math.cos(a) * rad, j % 2 ? 0.0007 : 0, -Math.sin(a) * rad]);
    }
    const C = [0, 0.0019, 0];
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + (rr() - 0.5) * 0.0011, (a[2] + b[2]) / 2];
    const tri = (a, b, c) => pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let j = 0; j < 10; j++) {
      const a = outer[j], b = outer[(j + 1) % 10];
      const ab = mid(a, b), ca = mid(C, a), cb = mid(C, b);
      // 上向きの面（反時計回りを上から見て）
      tri(C, cb, ca); tri(ca, cb, ab); tri(ca, ab, a); tri(cb, b, ab);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    // 上向きにそろえる
    const n = g.attributes.normal, p = g.attributes.position;
    for (let i = 0; i < p.count; i += 3) {
      if (n.getY(i) < 0) {
        for (let k = 0; k < 3; k++) n.setXYZ(i + k, -n.getX(i + k), -n.getY(i + k), -n.getZ(i + k));
        const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1);
        p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)); p.setXYZ(i + 2, x, y, z);
      }
    }
    g.computeVertexNormals();
    return g;
  }
  function pomGeo() {
    const g = new THREE.SphereGeometry(POM_R, 22, 16);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = Math.sin(x * 830 + y * 410) * Math.cos(z * 760 - x * 520) + 0.6 * Math.sin(y * 1500 + z * 1100);
      const k = 1 + n * 0.035;
      p.setXYZ(i, x * k, y * k, z * k);
    }
    g.computeVertexNormals();
    return g;
  }
  function pomNormalTex() {
    const N = 128, hgt = new Float32Array(N * N), r = Base.rng(5);
    for (let i = 0; i < 2600; i++) { // 短い毛の筋
      let x = r() * N, y = r() * N; const a = r() * TAU, l = 3 + r() * 7, v = 0.4 + r() * 0.6;
      for (let s = 0; s < l; s++) {
        const ix = ((x | 0) % N + N) % N, iy = ((y | 0) % N + N) % N;
        hgt[iy * N + ix] += v; x += Math.cos(a); y += Math.sin(a);
      }
    }
    return Base.canvasTex(N, N, (c) => {
      const img = c.createImageData(N, N);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const hx = hgt[y * N + (x + 1) % N] - hgt[y * N + (x + N - 1) % N];
        const hy = hgt[((y + 1) % N) * N + x] - hgt[((y + N - 1) % N) * N + x];
        let nx = -hx * 0.5, ny = -hy * 0.5, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
        const o = (y * N + x) * 4;
        img.data[o] = (nx * 0.5 + 0.5) * 255; img.data[o + 1] = (ny * 0.5 + 0.5) * 255; img.data[o + 2] = (nz * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
      }
      c.putImageData(img, 0, 0);
    }, { srgb: false, repeat: [3, 2] });
  }
  function blobTex() {
    return Base.canvasTex(64, 64, (c, w) => {
      const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      g.addColorStop(0, 'rgba(38,26,14,0.62)'); g.addColorStop(0.45, 'rgba(38,26,14,0.36)'); g.addColorStop(1, 'rgba(38,26,14,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, w);
    });
  }
  function sparkTex() {
    return Base.canvasTex(64, 64, (c, w) => {
      const m = w / 2;
      const g = c.createRadialGradient(m, m, 0, m, m, m * 0.5);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,246,220,0.55)'); g.addColorStop(1, 'rgba(255,240,200,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, w);
      const ray = (ang, len, wd) => {
        c.save(); c.translate(m, m); c.rotate(ang);
        const lg = c.createLinearGradient(-len, 0, len, 0);
        lg.addColorStop(0, 'rgba(255,245,220,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,1)'); lg.addColorStop(1, 'rgba(255,245,220,0)');
        c.fillStyle = lg; c.beginPath(); c.moveTo(-len, 0); c.lineTo(0, -wd); c.lineTo(len, 0); c.lineTo(0, wd); c.closePath(); c.fill();
        c.restore();
      };
      ray(0, m, 2.2); ray(Math.PI / 2, m, 2.2); ray(Math.PI / 4, m * 0.5, 1.4); ray(-Math.PI / 4, m * 0.5, 1.4);
    });
  }

  // くつした: 足首側の口（cuff）が原点、主軸（口→重心）が +X。底が y=0
  function sockTex(base, stripe, accent, seed) {
    return Base.canvasTex(512, 128, (c, w, h) => {
      const r = Base.rng(seed);
      const hex = n => '#' + n.toString(16).padStart(6, '0');
      c.fillStyle = hex(base); c.fillRect(0, 0, w, h);
      // しま（長さ方向に輪のしま）
      c.fillStyle = hex(stripe);
      for (let u = 0.13; u < 0.86; u += 0.07) c.fillRect(u * w, 0, 0.034 * w, h);
      // 口のゴム（リブ）とつま先
      c.fillStyle = hex(accent); c.fillRect(0, 0, 0.11 * w, h); c.fillRect(0.885 * w, 0, w * 0.12, h);
      c.fillStyle = 'rgba(0,0,0,0.13)';
      for (let y = 0; y < h; y += 4) c.fillRect(0, y, 0.11 * w, 1.5);
      // かかと（側面の片側にだけ: v の一部）
      c.fillStyle = hex(accent); c.globalAlpha = 0.95;
      c.beginPath(); c.ellipse(0.585 * w, 0.30 * h, 0.05 * w, 0.20 * h, 0, 0, TAU); c.fill();
      c.globalAlpha = 1;
      // 編み目
      for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 4) {
        const v = r();
        c.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.07)';
        c.fillRect(x + ((y / 3) % 2) * 2, y, 2, 2);
      }
    }, { aniso: 4 });
  }
  function sockGeo() {
    const pts = [[0, 0], [0.045, 0.0], [0.084, 0.004], [0.106, 0.02], [0.117, 0.046], [0.12, 0.075], [0.118, 0.1]];
    const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], 0, p[1])), false, 'centripetal');
    const NS = 40, NA = 16;
    const P = curve.getSpacedPoints(NS);
    // 重心と主軸
    let cx = 0, cz = 0; for (const p of P) { cx += p.x; cz += p.z; } cx /= P.length; cz /= P.length;
    const ang = Math.atan2(cz, cx); // 主軸方向
    const ca = Math.cos(-ang), sa = Math.sin(-ang);
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= NS; i++) {
      const s = i / NS, p = P[i], t = curve.getTangentAt(Math.min(s, 0.999));
      const side = new THREE.Vector3(-t.z, 0, t.x).normalize();
      let w = 0.029 + 0.003 * Math.exp(-Math.pow((s - 0.55) / 0.08, 2)), h = 0.0072 + 0.0022 * Math.exp(-Math.pow((s - 0.55) / 0.08, 2));
      if (s < 0.08) { w += 0.0015; h += 0.0006; }
      if (s > 0.86) { const k = Math.sqrt(Math.max(0, 1 - Math.pow((s - 0.86) / 0.14, 2))); w *= 0.25 + 0.75 * k; h *= 0.2 + 0.8 * k; }
      if (i === NS) { w *= 0.05; h *= 0.3; }
      const fold = 1 + 0.07 * Math.sin(s * 47);
      for (let j = 0; j <= NA; j++) {
        const a = -Math.PI / 2 + j / NA * TAU, sn = Math.sin(a), cs = Math.cos(a);
        const cx2 = Math.sign(cs) * Math.pow(Math.abs(cs), 0.75);
        const yy = sn >= 0 ? h * fold * (1 + sn) : h * (1 - Math.pow(-sn, 0.55));
        const x = p.x + side.x * cx2 * w, z = p.z + side.z * cx2 * w;
        pos.push(x * ca - z * sa, yy + 0.0004, x * sa + z * ca);
        uv.push(s, j / NA);
      }
    }
    for (let i = 0; i < NS; i++) for (let j = 0; j < NA; j++) {
      const a = i * (NA + 1) + j, b = a + NA + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    // 口のふた（少し奥まった平らな面）
    const c0 = pos.length / 3; pos.push(0.003, 0.0075, 0); uv.push(0.0, 0.5);
    for (let j = 0; j < NA; j++) idx.push(c0, j, j + 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return { geo: g, centerDist: Math.hypot(cx, cz) };
  }

  // =====================================================================
  // init
  // =====================================================================
  function init(ctx) {
    scene = ctx && ctx.scene; camera = ctx && ctx.camera;
    if (!scene) return;
    low = !!(Base.quality && Base.quality.low);
    const ptex = paperTex();
    const paperMat = new THREE.MeshStandardMaterial({ map: ptex, roughness: 0.74, metalness: 0, side: THREE.DoubleSide });
    const starMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.88, roughness: 0.3, side: THREE.DoubleSide, envMapIntensity: 1.3 });
    const beadMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 });
    const pomMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 1, metalness: 0, sheen: 1, sheenRoughness: 0.55, sheenColor: new THREE.Color(0xd8d8d8),
      normalMap: low ? null : pomNormalTex(), normalScale: new THREE.Vector2(1.3, 1.3),
    });
    const circ = curl(new THREE.CircleGeometry(0.019, 18).rotateX(-Math.PI / 2), 6.5, 0.8);
    const sqr = curl(new THREE.PlaneGeometry(0.036, 0.036, 4, 4).rotateX(-Math.PI / 2), 5.5, 0.6);
    const geos = [circ, sqr, starGeo(), new THREE.SphereGeometry(BEAD_R, 14, 10), pomGeo()];
    const mats = [paperMat, paperMat, starMat, beadMat, pomMat];
    for (let k = 0; k < NK; k++) {
      const m = new THREE.InstancedMesh(geos[k], mats[k], MAXP);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 3).fill(1), 3);
      for (let i = 0; i < MAXP; i++) m.setMatrixAt(i, ZERO);
      m.count = 0; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = !low && k >= K_BEAD;
      scene.add(m); meshes.push(m);
    }
    // 接地の影の丸
    blobMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false }), MAXP);
    blobMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAXP; i++) blobMesh.setMatrixAt(i, ZERO);
    blobMesh.count = 0; blobMesh.frustumCulled = false; blobMesh.renderOrder = 1;
    scene.add(blobMesh);
    // きらめき
    const twc = new THREE.Color(1.5, 1.38, 1.15);
    twMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: sparkTex(), color: twc, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), 64);
    twMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    twMesh.count = 0; twMesh.frustumCulled = false; twMesh.visible = false; twMesh.renderOrder = 3;
    scene.add(twMesh);
    // 紙テープ（6 本を 1 つのジオメトリに）
    const NV = MAXS * SECMAX * 2;
    ribPos = new THREE.BufferAttribute(new Float32Array(NV * 3), 3); ribPos.setUsage(THREE.DynamicDrawUsage);
    ribNor = new THREE.BufferAttribute(new Float32Array(NV * 3), 3); ribNor.setUsage(THREE.DynamicDrawUsage);
    ribCol = new THREE.BufferAttribute(new Float32Array(NV * 3).fill(1), 3);
    const idx = [];
    for (let s = 0; s < MAXS; s++) for (let k = 0; k < SECMAX - 1; k++) {
      const a = (s * SECMAX + k) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', ribPos); rg.setAttribute('normal', ribNor); rg.setAttribute('color', ribCol); rg.setIndex(idx);
    ribMesh = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68, side: THREE.DoubleSide, map: ptex }));
    ribMesh.frustumCulled = false;
    scene.add(ribMesh);
    // くつした
    const sg = sockGeo();
    const SC = [[0xf2ebdf, 0xdf6d5c, 0xd2544a, 11], [0xdde5ea, 0x3a7db8, 0xeeb43c, 23]];
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.MeshPhysicalMaterial({ map: sockTex(SC[i][0], SC[i][1], SC[i][2], SC[i][3]), roughness: 0.93, sheen: 0.6, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xffffff) });
      const mesh = new THREE.Mesh(sg.geo, mat);
      mesh.castShadow = !low; mesh.receiveShadow = !low;
      const pivot = new THREE.Group(); pivot.add(mesh); scene.add(pivot);
      socks.push({ pivot, cd: sg.centerDist, st: 'floor', x: 0, y: 0, z: 0, psi: 0, tilt: 0, roll: 0, t: 0, cool: 0, order: 0, f: { x: 0, y: 0, z: 0, psi: 0, tilt: 0 }, g: { x: 0, y: 0, z: 0, psi: 0, tilt: 0 } });
    }
    resetSocks(true);
  }

  // =====================================================================
  // 粒の生成
  // =====================================================================
  function alloc() {
    for (let i = 0; i < MAXP; i++) if (state[i] === DEAD) return i;
    return -1;
  }
  function setup(i, k, col) {
    kind[i] = k; color[i] = col; bounces[i] = 0;
    _c.setHex(col);
    meshes[k].setColorAt(i, _c); meshes[k].instanceColor.needsUpdate = true;
    vx[i] = vy[i] = vz[i] = 0; sq[i] = sqv[i] = 0; lift[i] = 0; rx[i] = rz[i] = 0;
    ph[i] = rnd() * TAU;
    if (i + 1 > hi) hi = i + 1;
  }
  function kill(i) {
    state[i] = DEAD;
    meshes[kind[i]].setMatrixAt(i, ZERO);
    blobMesh.setMatrixAt(i, ZERO);
  }
  const pick = a => a[Math.floor(rnd() * a.length) % a.length];

  // 紙・星（ひらひら）
  function spawnFlutter(k, col, o, tgx, tgz, T, delay, gentle) {
    const i = alloc(); if (i < 0) return -1;
    setup(i, k, col);
    state[i] = FLY; tt[i] = -delay; TT[i] = T;
    ox[i] = o.x + (rnd() - 0.5) * (gentle ? 0.01 : 0.12); oy[i] = o.y + (rnd() - 0.5) * (gentle ? 0.01 : 0.1); oz[i] = o.z + (rnd() - 0.5) * (gentle ? 0.01 : 0.12);
    tx[i] = tgx; tz[i] = tgz;
    const a = rnd() * TAU, mag = gentle ? 0.02 : 0.1 + rnd() * 0.28;
    bx[i] = Math.cos(a) * mag + (tgx - ox[i]) * 0.25; bz[i] = Math.sin(a) * mag + (tgz - oz[i]) * 0.25;
    bup[i] = gentle ? 0 : 0.04 + rnd() * 0.16;
    const sa = rnd() * TAU; sdx[i] = Math.cos(sa); sdz[i] = Math.sin(sa);
    swA[i] = gentle ? 0.09 : 0.025 + rnd() * 0.06; swW[i] = gentle ? 2.4 : 2.6 + rnd() * 3;
    flips[i] = 2 * (1 + Math.floor(rnd() * (k === K_STAR ? 4 : 3)));
    ry0[i] = rnd() * TAU; yawSpd[i] = (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 2);
    rockA[i] = 0.3 + rnd() * 0.45;
    scl[i] = 0.86 + rnd() * 0.28;
    restOff[i] = (k === K_STAR ? 0.0012 : 0.0014) + rnd() * 0.0013;
    px[i] = ox[i]; py[i] = oy[i]; pz[i] = oz[i];
    return i;
  }
  // ビーズ・ポンポン（放物線 → 跳ねる）
  function spawnBall(k, col, o, tgx, tgz, T, delay) {
    const i = alloc(); if (i < 0) return -1;
    setup(i, k, col);
    state[i] = BALL; tt[i] = -delay;
    px[i] = o.x + (rnd() - 0.5) * 0.1; py[i] = o.y + (rnd() - 0.5) * 0.08; pz[i] = o.z + (rnd() - 0.5) * 0.1;
    scl[i] = k === K_BEAD ? 0.92 + rnd() * 0.16 : 0.9 + rnd() * 0.2;
    restOff[i] = k === K_BEAD ? BEAD_R * scl[i] : POM_R * scl[i] * 0.95;
    const rest = fy(tgx, tgz) + restOff[i];
    tx[i] = tgx; tz[i] = tgz;
    vx[i] = (tgx - px[i]) / T; vz[i] = (tgz - pz[i]) / T;
    vy[i] = (rest - py[i] + 0.5 * G * T * T) / T;
    _q.setFromEuler(_e.set(rnd() * TAU, rnd() * TAU, rnd() * TAU));
    qx[i] = _q.x; qy[i] = _q.y; qz[i] = _q.z; qw[i] = _q.w;
    const sa = rnd() * TAU; sdx[i] = Math.cos(sa); sdz[i] = Math.sin(sa); swW[i] = 4 + rnd() * 8;
    return i;
  }
  // 紙テープ（ほどけながら降りる）
  function spawnStreamer(o, col) {
    let S = null;
    for (const s of streamers) if (s.st === 0) { S = s; break; }
    if (!S) return;
    S.n = 12 + Math.floor(rnd() * 5); S.len = 0.6 + rnd() * 0.3; S.seg = S.len / (S.n - 1);
    S.color = col; S.cut = 0; S.h = 0; S.t = 0; S.landed = false; S.cleared = false;
    S.ox = o.x + (rnd() - 0.5) * 0.08; S.oy = o.y - 0.02; S.oz = o.z + (rnd() - 0.5) * 0.08;
    S.d0 = 0.03 + rnd() * 0.15; S.dstep = 0.045 + rnd() * 0.02; S.Tb = 1.45 + rnd() * 0.45; S.Tstep = 0.025 + rnd() * 0.015;
    const a = rnd() * TAU; S.bx = Math.cos(a) * 0.15; S.bz = Math.sin(a) * 0.15;
    S.swA = 0.04 + rnd() * 0.05; S.swW = 2.4 + rnd() * 1.6; S.ph = rnd() * TAU;
    const sa = rnd() * TAU; S.sdx = Math.cos(sa); S.sdz = Math.sin(sa);
    S.restOff = 0.0017 + streamers.indexOf(S) * 0.0004;
    restCurve(S);
    for (let j = 0; j < S.n; j++) { S.px[j] = S.ox; S.py[j] = S.oy; S.pz[j] = S.oz; S.tw[j] = 0; }
    S.st = 1;
    const base = streamers.indexOf(S) * SECMAX * 2;
    _c.setHex(col);
    for (let v = 0; v < SECMAX * 2; v++) { // 端にかけてほんの少し明暗
      const k = v % 2 ? 0.94 : 1;
      ribCol.setXYZ(base + v, _c.r * k, _c.g * k, _c.b * k);
    }
    ribCol.needsUpdate = true;
  }
  // 床でゆるく曲がった帯の形（必ず L.inPlay の中）
  function restCurve(S) {
    for (let att = 0; att < 16; att++) {
      L.randomPlayPoint(rnd, tmpPt);
      let x = tmpPt.x, z = tmpPt.z, th = rnd() * TAU;
      const sgn = rnd() < 0.5 ? -1 : 1, k0 = sgn * (1.0 + rnd() * 2.4), k1 = 1.5 + rnd() * 3, p0 = rnd() * TAU;
      S.rx[0] = x; S.rz[0] = z;
      let ok = true;
      for (let j = 1; j < S.n && ok; j++) {
        th += (k0 + k1 * Math.sin(j / (S.n - 1) * 5 + p0)) * S.seg;
        let found = false;
        for (let tr = 0; tr < 9; tr++) {
          const nx = x + Math.cos(th) * S.seg, nz = z + Math.sin(th) * S.seg;
          if (L.inPlay(nx, nz)) { x = nx; z = nz; found = true; break; }
          th += sgn * 0.42;
        }
        if (!found) ok = false;
        S.rx[j] = x; S.rz[j] = z;
      }
      if (ok) return;
    }
  }

  function burst(round, origin) {
    if (!scene) return;
    const o = origin || { x: 0, y: 1.7, z: -0.15 };
    rnd = Base.rng(4001 + (round | 0) * 977 + burstNo * 131); burstNo++;
    const TAB = [[110, 0, 0, 0, 3], [30, 60, 45, 0, 2], [60, 30, 20, 22, 3]];
    const c = TAB[clamp(round | 0, 0, 2)];
    for (let s = 0; s < c[4]; s++) spawnStreamer(o, RIB_COLS[(s * 3 + (round | 0) * 2 + Math.floor(rnd() * 2)) % RIB_COLS.length]);
    const pt = tmpPt;
    for (let n = 0; n < c[3]; n++) { L.randomPlayPoint(rnd, pt); spawnBall(K_POM, pick(POM_COLS), o, pt.x, pt.z, 0.68 + rnd() * 0.2, rnd() * 0.1); }
    for (let n = 0; n < c[2]; n++) { L.randomPlayPoint(rnd, pt); spawnBall(K_BEAD, pick(BEAD_COLS), o, pt.x, pt.z, 0.6 + rnd() * 0.27, rnd() * 0.08); }
    for (let n = 0; n < c[1]; n++) { L.randomPlayPoint(rnd, pt); spawnFlutter(K_STAR, pick(STAR_COLS), o, pt.x, pt.z, 1.5 + rnd() * 1.4, rnd() * 0.12, false); }
    for (let n = 0; n < c[0]; n++) {
      L.randomPlayPoint(rnd, pt);
      spawnFlutter(rnd() < 0.5 ? K_PC : K_PS, pick(PAPER_COLS), o, pt.x, pt.z, 1.5 + rnd() * 1.7, rnd() * 0.15, false);
    }
  }
  function spawnLast(origin, target) {
    if (!scene || !origin || !target) return;
    spawnFlutter(rnd() < 0.5 ? K_PC : K_PS, pick(PAPER_COLS), origin, target.x, target.z, 3.0, 0, true);
  }
  function clear() {
    for (let i = 0; i < MAXP; i++) if (state[i] !== DEAD) kill(i);
    for (const S of streamers) S.st = 0;
    slurpIdx = -1; slurpAmt = 0; hi = 0;
    for (const m of meshes) { m.count = 0; m.instanceMatrix.needsUpdate = true; }
    if (blobMesh) { blobMesh.count = 0; blobMesh.instanceMatrix.needsUpdate = true; }
    if (ribPos) writeRibbons();
  }

  // =====================================================================
  // update
  // =====================================================================
  function readHead(head) {
    if (!head) { hd.ok = false; return; }
    hd.ok = true;
    hd.x = +head.x || 0; hd.z = +head.z || 0; hd.lift = +head.lift || 0; hd.yaw = +head.yaw || 0;
    hd.motor = sat(+head.motor || 0); hd.vx = +head.vx || 0; hd.vz = +head.vz || 0;
    if (head.mouth) { hd.mx = head.mouth.x; hd.my = head.mouth.y; hd.mz = head.mouth.z; }
    else { hd.mx = hd.x; hd.my = fy(hd.x, hd.z); hd.mz = hd.z; }
  }

  function update(dt, head) {
    if (!scene) return;
    dt = clamp(+dt || 0, 0, 0.05);
    time += dt;
    readHead(head);
    const canSuck = hd.ok && hd.motor > 0.25 && hd.lift <= 0.05 && stuck < 0;
    updParticles(dt, canSuck);
    updStreamers(dt, canSuck);
    updSocks(dt);
    drawParticles();
    writeRibbons();
    drawTwinkle();
  }

  function moveOnFloor(i, dt, free) {
    const nx = px[i] + vx[i] * dt, nz = pz[i] + vz[i] * dt;
    if (free || !L.inPlay(px[i], pz[i]) || L.inPlay(nx, nz)) { px[i] = nx; pz[i] = nz; return; }
    // L.inPlay の境界でやわらかく跳ね返す
    const okx = L.inPlay(nx, pz[i]), okz = L.inPlay(px[i], nz);
    if (!okx) vx[i] *= -0.45;
    if (!okz) vz[i] *= -0.45;
    if (okx && okz) { vx[i] *= -0.45; vz[i] *= -0.45; }
  }
  function rollQ(i, dt, r) {
    const sp = Math.hypot(vx[i], vz[i]);
    if (sp < 1e-4) return;
    _ax.set(vz[i] / sp, 0, -vx[i] / sp);
    _q2.setFromAxisAngle(_ax, sp * dt / r);
    _q.set(qx[i], qy[i], qz[i], qw[i]).premultiply(_q2).normalize();
    qx[i] = _q.x; qy[i] = _q.y; qz[i] = _q.z; qw[i] = _q.w;
  }
  function headPush(i, dt) {
    if (!hd.ok || hd.lift > 0.03) return false;
    const c = Math.cos(hd.yaw), s = Math.sin(hd.yaw);
    const dx = px[i] - hd.x, dz = pz[i] - hd.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    const rr = kind[i] === K_POM ? 0.02 : 0.01;
    const hw = L.head.w / 2 + rr, hdp = L.head.d / 2 + rr;
    if (Math.abs(lx) > hw || Math.abs(lz) > hdp) return false;
    const penZ = hdp - Math.abs(lz), penX = hw - Math.abs(lx);
    if (penZ < penX) { const sg = lz < 0 ? -1 : 1; px[i] += s * sg * penZ; pz[i] += c * sg * penZ; }
    else { const sg = lx < 0 ? -1 : 1; px[i] += c * sg * penX; pz[i] -= s * sg * penX; }
    const k = kind[i];
    if (k === K_BEAD || k === K_POM) { vx[i] = hd.vx * 1.05; vz[i] = hd.vz * 1.05; }
    return true;
  }

  function updParticles(dt, canSuck) {
    const pullR = L.pullR, suckR = L.suckR;
    for (let i = 0; i < hi; i++) {
      const st = state[i]; if (st === DEAD) continue;
      const k = kind[i];
      dist[i] = 9;
      if (st === FLY) {
        tt[i] += dt; const t = tt[i]; if (t < 0) continue;
        const T = TT[i], s = Math.min(1, t / T);
        const e1 = 1 - Math.exp(-t / 0.09), w = smooth(s), om = 1 - s;
        const sway = swA[i] * Math.sin(swW[i] * t + ph[i]) * om * Math.min(1, t / 0.35);
        px[i] = ox[i] + bx[i] * e1 * (1 - w) + (tx[i] - ox[i]) * w + sdx[i] * sway;
        pz[i] = oz[i] + bz[i] * e1 * (1 - w) + (tz[i] - oz[i]) * w + sdz[i] * sway;
        const f = clamp((t - 0.12) / (T - 0.12), 0, 1), fall = Math.pow(f, 1.25);
        const rest = fy(tx[i], tz[i]) + restOff[i];
        py[i] = oy[i] + (rest - oy[i]) * fall + bup[i] * e1 * (1 - fall) * (1 - fall) + 0.012 * Math.sin(swW[i] * 2 * t) * om * om;
        const g = 1 - om * om;
        rx[i] = flips[i] * Math.PI * g;
        ry[i] = ry0[i] + yawSpd[i] * T * g * 0.5;
        rz[i] = rockA[i] * Math.sin(swW[i] * t + ph[i] + 1.2) * Math.pow(om, 1.5);
        if (s >= 1) {
          state[i] = FLOOR; px[i] = tx[i]; pz[i] = tz[i]; py[i] = rest; rx[i] = 0; rz[i] = 0; vx[i] = vz[i] = 0;
          fire(on.land, TYPE[k], k === K_STAR ? 0.13 : 0.08 + rnd() * 0.04);
        }
        continue;
      }
      if (st === BALL) {
        tt[i] += dt; if (tt[i] < 0) continue;
        vy[i] -= G * dt;
        if (bounces[i] > 0) moveOnFloor(i, dt, false); else { px[i] += vx[i] * dt; pz[i] += vz[i] * dt; }
        py[i] += vy[i] * dt;
        _ax.set(sdx[i], 0, sdz[i]); _q2.setFromAxisAngle(_ax, swW[i] * dt);
        _q.set(qx[i], qy[i], qz[i], qw[i]).premultiply(_q2); qx[i] = _q.x; qy[i] = _q.y; qz[i] = _q.z; qw[i] = _q.w;
        if (k === K_POM) { sqv[i] += (-260 * sq[i] - 9 * sqv[i]) * dt; sq[i] += sqv[i] * dt; }
        const rest = fy(px[i], pz[i]) + restOff[i];
        if (py[i] <= rest && vy[i] < 0) {
          py[i] = rest; const imp = -vy[i]; bounces[i]++;
          if (bounces[i] === 1) { px[i] = tx[i]; pz[i] = tz[i]; py[i] = fy(px[i], pz[i]) + restOff[i]; }
          if (k === K_BEAD) {
            fire(on.land, 'bead', sat(imp / 5.5));
            vy[i] = imp * 0.42;
            if (bounces[i] === 1) { vx[i] = vx[i] * 0.2 + (rnd() - 0.5) * 0.5; vz[i] = vz[i] * 0.2 + (rnd() - 0.5) * 0.5; }
            else { vx[i] *= 0.75; vz[i] *= 0.75; }
            if (vy[i] < 0.5) { vy[i] = 0; state[i] = FLOOR; }
          } else {
            fire(on.land, 'pom', sat(imp / 6) * 0.5);
            vy[i] = imp * 0.3; sqv[i] -= imp * 1.6;
            if (bounces[i] === 1) { vx[i] = vx[i] * 0.12 + (rnd() - 0.5) * 0.16; vz[i] = vz[i] * 0.12 + (rnd() - 0.5) * 0.16; }
            else { vx[i] *= 0.6; vz[i] *= 0.6; }
            if (vy[i] < 0.6) { vy[i] = 0; state[i] = FLOOR; }
          }
        }
        continue;
      }
      if (st === FLOOR) {
        let pulled = false, c = 0, dx = 0, dz = 0, d = 9;
        if (canSuck) {
          dx = hd.mx - px[i]; dz = hd.mz - pz[i]; d = Math.hypot(dx, dz) || 1e-4;
          dist[i] = d;
          if (d < pullR) {
            pulled = true; c = 1 - d / pullR;
            const a = hd.motor * (1.6 + 11 * c * c) * (k <= K_STAR ? 1.35 : k === K_BEAD ? 1.0 : 0.8);
            vx[i] += dx / d * a * dt; vz[i] += dz / d * a * dt;
            if (k <= K_STAR) { vx[i] += (rnd() - 0.5) * 0.6 * dt * c; vz[i] += (rnd() - 0.5) * 0.6 * dt * c; }
            if (d < 0.03) { vx[i] *= 0.6; vz[i] *= 0.6; }
          }
        }
        const rug = L.onRug(px[i], pz[i]);
        let kf;
        if (k <= K_STAR) kf = pulled ? 3.5 : 7;
        else if (k === K_BEAD) kf = pulled ? 1.4 : rug ? 3.2 : 1.1;
        else kf = pulled ? 2 : rug ? 5 : 3.2;
        const ef = Math.exp(-kf * dt); vx[i] *= ef; vz[i] *= ef;
        if (!pulled) {
          const sp = Math.hypot(vx[i], vz[i]);
          if (sp < 0.006) { vx[i] = 0; vz[i] = 0; }
          else if (k === K_BEAD) { const r = Math.max(0, sp - 0.25 * dt) / sp; vx[i] *= r; vz[i] *= r; }
        }
        if (vx[i] !== 0 || vz[i] !== 0) moveOnFloor(i, dt, pulled);
        if (!pulled) {
          headPush(i, dt);
          // 動ける範囲（かご・ごみ箱の外）からは出さない
          L.clampReach(px[i], pz[i], tmpPt);
          if (tmpPt.x !== px[i] || tmpPt.z !== pz[i]) { px[i] = tmpPt.x; pz[i] = tmpPt.z; vx[i] *= -0.3; vz[i] *= -0.3; }
        }
        if (k === K_BEAD) { rollQ(i, dt, BEAD_R * scl[i]); py[i] = fy(px[i], pz[i]) + restOff[i]; }
        else if (k === K_POM) {
          rollQ(i, dt, POM_R * scl[i]);
          sqv[i] += (-260 * sq[i] - 9 * sqv[i]) * dt; sq[i] += sqv[i] * dt;
          py[i] = fy(px[i], pz[i]) + restOff[i] + (pulled ? 0.002 * Math.max(0, Math.sin(time * 30 + ph[i])) * c : 0);
        } else {
          // 紙・星: 立ち上がってひらひら
          const lt = pulled ? c * 0.008 + 0.004 * c * (0.5 + 0.5 * Math.sin(time * 47 + ph[i])) : 0;
          lift[i] = damp(lift[i], lt, 20, dt);
          const rxt = pulled ? c * (0.85 + 0.4 * Math.sin(time * 38 + ph[i])) : 0;
          rx[i] = damp(rx[i], rxt, 16, dt);
          rz[i] = pulled ? 0.3 * c * Math.sin(time * 29 + ph[i] * 2) : damp(rz[i], 0, 10, dt);
          if (pulled) ry[i] += wrapA(Math.atan2(-dx, -dz) - ry[i]) * Math.min(1, 8 * dt);
          py[i] = fy(px[i], pz[i]) + restOff[i] + lift[i] + 0.02 * scl[i] * Math.abs(Math.sin(rx[i])) + 0.006 * Math.abs(Math.sin(rz[i]));
        }
        continue;
      }
      if (st === SUCK) {
        tt[i] += dt; const s = Math.min(1, tt[i] / 0.1), e = s * s;
        px[i] = sx0[i] + (hd.mx - sx0[i]) * e; py[i] = sy0[i] + (hd.my + 0.022 - sy0[i]) * e; pz[i] = sz0[i] + (hd.mz - sz0[i]) * e;
        rx[i] += dt * 9; ry[i] += dt * 20;
        if (s >= 1) { kill(i); fire(on.suck, TYPE[k], color[i]); }
      }
    }
    // 吸い込み: 近い順に少しずつ
    if (canSuck) {
      tokens = Math.min(3.5, tokens + dt * 55 * hd.motor);
      let n = 0;
      while (tokens >= 1 && n < 4) {
        let best = -1, bd = L.suckR;
        for (let i = 0; i < hi; i++) if (state[i] === FLOOR && dist[i] < bd) { bd = dist[i]; best = i; }
        if (best < 0) break;
        state[best] = SUCK; tt[best] = 0; sx0[best] = px[best]; sy0[best] = py[best]; sz0[best] = pz[best];
        tokens -= 1; n++;
      }
    } else tokens = Math.min(tokens, 1);
    while (hi > 0 && state[hi - 1] === DEAD) hi--;
  }

  function drawParticles() {
    for (let i = 0; i < hi; i++) {
      const st = state[i]; if (st === DEAD) continue;
      const k = kind[i];
      if ((st === FLY || st === BALL) && tt[i] < 0) { meshes[k].setMatrixAt(i, ZERO); blobMesh.setMatrixAt(i, ZERO); continue; }
      let sc = scl[i], sfade = 1;
      if (st === SUCK) { const s = Math.min(1, tt[i] / 0.1); sc *= 1 - 0.55 * s; sfade = 1 - s; }
      if (k <= K_STAR) _q.setFromEuler(_e.set(rx[i], ry[i], rz[i]));
      else _q.set(qx[i], qy[i], qz[i], qw[i]);
      _s.set(sc, sc, sc);
      if (k === K_POM) { const q = clamp(sq[i], -0.3, 0.25); _s.y *= 1 + q; _s.x *= 1 - q * 0.5; _s.z *= 1 - q * 0.5; }
      _p.set(px[i], py[i], pz[i]);
      _m.compose(_p, _q, _s); meshes[k].setMatrixAt(i, _m);
      const gnd = fy(px[i], pz[i]);
      const hgt = py[i] - gnd - restOff[i];
      const fade = sat(1 - hgt / 0.45) * sfade;
      if (fade < 0.03) { blobMesh.setMatrixAt(i, ZERO); continue; }
      const b = BLOB[k] * scl[i] * Math.sqrt(fade);
      _p.set(px[i], gnd + 0.0004, pz[i]); _q.identity(); _s.set(b, 1, b);
      _m.compose(_p, _q, _s); blobMesh.setMatrixAt(i, _m);
    }
    for (const m of meshes) { m.count = hi; m.instanceMatrix.needsUpdate = true; }
    blobMesh.count = hi; blobMesh.instanceMatrix.needsUpdate = true;
  }

  // ---- 紙テープ ----
  function updStreamers(dt, canSuck) {
    let eating = false;
    for (let si = 0; si < MAXS; si++) {
      const S = streamers[si];
      if (S.st === 1) {
        S.t += dt;
        let all = true;
        for (let j = 0; j < S.n; j++) {
          const ti = S.t - (S.d0 + j * S.dstep);
          if (ti <= 0) { S.px[j] = S.ox; S.py[j] = S.oy; S.pz[j] = S.oz; S.tw[j] = 0; all = false; continue; }
          const Ti = S.Tb + j * S.Tstep, s = Math.min(1, ti / Ti), om = 1 - s;
          if (s < 1) all = false;
          const w = smooth(s), e1 = 1 - Math.exp(-ti / 0.12);
          const sway = S.swA * Math.sin(S.swW * S.t - j * 0.55 + S.ph) * om * Math.min(1, ti / 0.3);
          S.px[j] = S.ox + S.bx * e1 * (1 - w) + (S.rx[j] - S.ox) * w + S.sdx * sway;
          S.pz[j] = S.oz + S.bz * e1 * (1 - w) + (S.rz[j] - S.oz) * w + S.sdz * sway;
          const f = clamp((ti - 0.1) / (Ti - 0.1), 0, 1), fall = Math.pow(f, 1.2);
          const rest = fy(S.rx[j], S.rz[j]) + S.restOff;
          S.py[j] = S.oy + (rest - S.oy) * fall + 0.07 * e1 * (1 - fall) * (1 - fall);
          S.tw[j] = om * 2.3 * Math.sin(S.t * 3.1 + j * 0.7 + S.ph);
          if (j === 0 && s >= 1 && !S.landed) { S.landed = true; fire(on.land, 'streamer', 0.07); }
        }
        if (all) {
          S.st = 2;
          for (let j = 0; j < S.n; j++) { S.px[j] = S.rx[j]; S.pz[j] = S.rz[j]; S.py[j] = fy(S.rx[j], S.rz[j]) + S.restOff; S.tw[j] = 0; }
        }
        continue;
      }
      if (S.st !== 2) continue;
      if (slurpIdx === si) {
        if (!canSuck) {
          slurpIdx = -1;
          // 床に残す
          const h = S.h; S.py[h] = fy(S.px[h], S.pz[h]) + S.restOff;
          continue;
        }
        const h0 = S.h;
        const nearMouth = Math.hypot(S.px[h0] - hd.mx, S.pz[h0] - hd.mz) < 0.035;
        S.px[h0] = damp(S.px[h0], hd.mx, 22, dt); S.pz[h0] = damp(S.pz[h0], hd.mz, 22, dt);
        S.py[h0] = damp(S.py[h0], hd.my + 0.004, 22, dt);
        if (nearMouth) {
          eating = true;
          S.cut += S.len / 0.75 * Math.min(1, 0.4 + hd.motor) * dt;
          let h = Math.floor(S.cut / S.seg);
          if (h >= S.n - 1) {
            S.st = 0; slurpIdx = -1; fire(on.suck, 'streamer', S.color);
            continue;
          }
          if (h > h0) { S.px[h] = S.px[h0]; S.py[h] = S.py[h0]; S.pz[h] = S.pz[h0]; }
          S.h = h;
        }
        // 後ろの節がついてくる（床の上をすべる）
        const h = S.h, frac = S.cut / S.seg - h;
        for (let j = h + 1; j < S.n; j++) {
          const rest = j === h + 1 ? S.seg * (1 - frac) : S.seg;
          const dx = S.px[j] - S.px[j - 1], dz = S.pz[j] - S.pz[j - 1], d = Math.hypot(dx, dz);
          if (d > rest && d > 1e-5) { S.px[j] = S.px[j - 1] + dx / d * rest; S.pz[j] = S.pz[j - 1] + dz / d * rest; }
          S.py[j] = fy(S.px[j], S.pz[j]) + S.restOff;
        }
        continue;
      }
      if (canSuck && slurpIdx < 0) {
        let best = -1, bd = L.suckR;
        for (let j = S.h; j < S.n; j++) { const d = Math.hypot(S.px[j] - hd.mx, S.pz[j] - hd.mz); if (d < bd) { bd = d; best = j; } }
        if (best >= 0) {
          if (S.cut === 0 && best > (S.n - 1) / 2) { // 近い方の端から
            for (let a = 0, b = S.n - 1; a < b; a++, b--) {
              let t = S.px[a]; S.px[a] = S.px[b]; S.px[b] = t;
              t = S.py[a]; S.py[a] = S.py[b]; S.py[b] = t;
              t = S.pz[a]; S.pz[a] = S.pz[b]; S.pz[b] = t;
            }
          }
          slurpIdx = si;
        }
      }
    }
    slurpAmt = damp(slurpAmt, eating ? 1 : 0, eating ? 14 : 6, dt);
    if (slurpAmt < 0.002) slurpAmt = 0;
  }

  function writeRibbons() {
    const P = ribPos.array, N = ribNor.array;
    for (let si = 0; si < MAXS; si++) {
      const S = streamers[si], base = si * SECMAX * 2 * 3;
      if (S.st === 0) {
        if (!S.cleared) { for (let v = 0; v < SECMAX * 6; v++) { P[base + v] = 0; N[base + v] = 0; } S.cleared = true; }
        continue;
      }
      const h = S.st === 2 ? S.h : 0, n = S.n;
      let ns = 0;
      for (let j = h; j < n - 1; j++) {
        const i0 = Math.max(h, j - 1), i1 = j, i2 = j + 1, i3 = Math.min(n - 1, j + 2);
        for (let k = 0; k < SUB; k++) {
          const u = k / SUB, u2 = u * u, u3 = u2 * u;
          const c0 = -0.5 * u3 + u2 - 0.5 * u, c1 = 1.5 * u3 - 2.5 * u2 + 1, c2 = -1.5 * u3 + 2 * u2 + 0.5 * u, c3 = 0.5 * u3 - 0.5 * u2;
          csx[ns] = c0 * S.px[i0] + c1 * S.px[i1] + c2 * S.px[i2] + c3 * S.px[i3];
          csy[ns] = c0 * S.py[i0] + c1 * S.py[i1] + c2 * S.py[i2] + c3 * S.py[i3];
          csz[ns] = c0 * S.pz[i0] + c1 * S.pz[i1] + c2 * S.pz[i2] + c3 * S.pz[i3];
          ctw[ns] = S.tw[i1] + (S.tw[i2] - S.tw[i1]) * u;
          if (S.st === 2) csy[ns] = Math.max(csy[ns], fy(csx[ns], csz[ns]) + S.restOff - 0.0004);
          ns++;
        }
      }
      csx[ns] = S.px[n - 1]; csy[ns] = S.py[n - 1]; csz[ns] = S.pz[n - 1]; ctw[ns] = S.tw[n - 1]; ns++;
      let tX = 0, tY = -1, tZ = 0, hx = 1, hz = 0;
      for (let q = 0; q < SECMAX; q++) {
        const o = base + q * 6;
        if (q >= ns) { for (let v = 0; v < 6; v++) { P[o + v] = P[o - 6 + v]; N[o + v] = N[o - 6 + v]; } continue; }
        let dx, dy, dz;
        if (q < ns - 1) { dx = csx[q + 1] - csx[q]; dy = csy[q + 1] - csy[q]; dz = csz[q + 1] - csz[q]; }
        else if (q > 0) { dx = csx[q] - csx[q - 1]; dy = csy[q] - csy[q - 1]; dz = csz[q] - csz[q - 1]; }
        else { dx = tX; dy = tY; dz = tZ; }
        const l = Math.hypot(dx, dy, dz);
        if (l > 1e-6) { tX = dx / l; tY = dy / l; tZ = dz / l; }
        let nhx = -tZ, nhz = tX; const hl = Math.hypot(nhx, nhz);
        if (hl > 0.15) { nhx /= hl; nhz /= hl; if (nhx * hx + nhz * hz < 0) { nhx = -nhx; nhz = -nhz; } hx = nhx; hz = nhz; }
        else { // ほぼ鉛直: 前の向きを接線に直交化
          const dp = hx * tX + hz * tZ; let ax = hx - tX * dp, ay = -tY * dp, az = hz - tZ * dp; const al = Math.hypot(ax, ay, az) || 1;
          ax /= al; ay /= al; az /= al; hx = ax; hz = az;
        }
        // hp=(hx,0,hz) を接線まわりに twist だけ回す
        const hpx = hx, hpz = hz, hpy = 0;
        const bxv = tY * hpz - tZ * hpy, byv = tZ * hpx - tX * hpz, bzv = tX * hpy - tY * hpx;
        const ct = Math.cos(ctw[q]), st = Math.sin(ctw[q]);
        let sx = hpx * ct + bxv * st, sy = hpy * ct + byv * st, sz = hpz * ct + bzv * st;
        const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
        let nx = sy * tZ - sz * tY, ny = sz * tX - sx * tZ, nz = sx * tY - sy * tX;
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; sx = -sx; sy = -sy; sz = -sz; } // 表面（巻き順）を上に
        P[o] = csx[q] + sx * RIB_HW; P[o + 1] = csy[q] + sy * RIB_HW; P[o + 2] = csz[q] + sz * RIB_HW;
        P[o + 3] = csx[q] - sx * RIB_HW; P[o + 4] = csy[q] - sy * RIB_HW; P[o + 5] = csz[q] - sz * RIB_HW;
        N[o] = N[o + 3] = nx; N[o + 1] = N[o + 4] = ny; N[o + 2] = N[o + 5] = nz;
      }
    }
    ribPos.needsUpdate = true; ribNor.needsUpdate = true;
  }

  // ---- きらめき ----
  function drawTwinkle() {
    if (twAmp < 0.01) { twMesh.visible = false; return; }
    twMesh.visible = true;
    if (camera) { camera.getWorldQuaternion(_camQ); camera.getWorldPosition(_camP); } else { _camQ.identity(); _camP.set(0, 1.15, 2.15); }
    let R = 0;
    for (let i = 0; i < hi; i++) if (state[i] === FLOOR) R++;
    for (const S of streamers) if (S.st === 2) R++;
    const step = Math.max(1, Math.ceil(R / 56));
    const few = R <= 20, size = (few ? 0.085 : 0.055) * twAmp;
    let n = 0, c = 0;
    const put = (x, y, z, phase) => {
      if (n >= 64) return;
      let p = Math.sin(time * (few ? 3.0 : 2.2) + phase); p = p > 0 ? p * p * p * p : 0;
      const sc = size * ((few ? 0.45 : 0.12) + 0.9 * p);
      // カメラ側へ少し寄せる
      let dx = _camP.x - x, dy = _camP.y - y, dz = _camP.z - z; const l = Math.hypot(dx, dy, dz) || 1;
      _p.set(x + dx / l * 0.02, y + 0.012 + dy / l * 0.02, z + dz / l * 0.02);
      _s.set(sc, sc, sc); _m.compose(_p, _camQ, _s); twMesh.setMatrixAt(n++, _m);
    };
    for (let i = 0; i < hi && n < 64; i++) {
      if (state[i] !== FLOOR) continue;
      if ((c++ % step) !== 0) continue;
      put(px[i], py[i], pz[i], ph[i] * 3.7);
    }
    for (let si = 0; si < MAXS; si++) {
      const S = streamers[si]; if (S.st !== 2) continue;
      const j = Math.floor((S.h + S.n) / 2); put(S.px[j], S.py[j], S.pz[j], si * 1.9);
    }
    twMesh.count = n; twMesh.instanceMatrix.needsUpdate = true;
  }

  // =====================================================================
  // くつした
  // =====================================================================
  const dirX = psi => Math.cos(psi), dirZ = psi => -Math.sin(psi);
  function sockCenter(k, out) { out.x = k.x + dirX(k.psi) * k.cd; out.z = k.z + dirZ(k.psi) * k.cd; return out; }
  function setFloorPose(k, cx, cz, psi) {
    k.psi = psi; k.x = cx - dirX(psi) * k.cd; k.z = cz - dirZ(psi) * k.cd; k.y = fy(cx, cz); k.tilt = 0; k.roll = 0;
  }
  function basketPose(k, order, g) {
    const b = L.basket, psi = 0.5 + order * 1.9;
    const cx = b.x + (order ? 0.014 : -0.008), cz = b.z + (order ? 0.012 : -0.004);
    g.psi = psi; g.x = cx - dirX(psi) * k.cd; g.z = cz - dirZ(psi) * k.cd; g.y = 0.028 + order * 0.017; g.tilt = order ? 0.08 : 0.03;
  }
  function stuckPose(k, g, jit) {
    const fx = -Math.sin(hd.yaw), fz = -Math.cos(hd.yaw);
    const ex = hd.mx + fx * L.head.d / 2, ez = hd.mz + fz * L.head.d / 2;
    g.x = ex - fx * 0.035; g.z = ez - fz * 0.035; g.y = hd.my + hd.lift + 0.003;
    g.psi = hd.yaw + Math.PI / 2 + (jit ? 0.06 * Math.sin(time * 23) + 0.03 * Math.sin(time * 41 + 1) : 0);
    g.tilt = 0.12 + (jit ? 0.06 * Math.sin(time * 31) + 0.035 * Math.sin(time * 53 + 1.3) : 0);
  }
  function applySock(k) {
    const p = k.pivot;
    p.position.set(k.x, k.y, k.z);
    p.rotation.set(k.roll, k.psi, k.tilt, 'YXZ');
    // 'YXZ' だと tilt(z) は主軸 +X を持ち上げる
  }
  function updSocks(dt) {
    for (let i = 0; i < socks.length; i++) {
      const k = socks[i];
      k.cool = Math.max(0, k.cool - dt);
      if (k.st === 'floor') {
        if (stuck < 0 && k.cool <= 0 && hd.ok && hd.motor > 0.5 && hd.lift <= 0.05) {
          sockCenter(k, tmpPt);
          if (Math.hypot(tmpPt.x - hd.mx, tmpPt.z - hd.mz) <= 0.15) { k.st = 'stuck'; k.t = 0; stuck = i; fire(on.sockStick, i); }
        }
      }
      if (k.st === 'stuck') {
        k.t += dt;
        stuckPose(k, k.g, true);
        const a = Math.min(1, k.t / 0.08);
        if (a < 1) { k.x = lerp(k.x, k.g.x, a); k.y = lerp(k.y, k.g.y, a); k.z = lerp(k.z, k.g.z, a); k.psi += wrapA(k.g.psi - k.psi) * a; k.tilt = lerp(k.tilt, k.g.tilt, a); }
        else { k.x = k.g.x; k.y = k.g.y; k.z = k.g.z; k.psi = k.g.psi; k.tilt = k.g.tilt; }
        k.roll = 0.07 * Math.sin(time * 27) + 0.04 * Math.sin(time * 61);
      } else if (k.st === 'drop' || k.st === 'toBasket') {
        k.t += dt;
        const D = k.st === 'drop' ? 0.25 : 0.4, s = Math.min(1, k.t / D), f = k.f, g = k.g;
        const e = k.st === 'drop' ? s : smooth(s);
        k.x = lerp(f.x, g.x, e); k.z = lerp(f.z, g.z, e);
        k.y = k.st === 'drop' ? lerp(f.y, g.y, s * s) : lerp(f.y, g.y, e) + 0.22 * Math.sin(Math.PI * s);
        k.psi = f.psi + wrapA(g.psi - f.psi) * e; k.tilt = lerp(f.tilt, g.tilt, e); k.roll = lerp(k.roll, 0, Math.min(1, dt * 12));
        if (s >= 1) {
          k.roll = 0;
          if (k.st === 'drop') { k.st = 'floor'; k.cool = 0.6; fire(on.sockDrop, i); }
          else { k.st = 'basket'; fire(on.sockBasket, i); }
        }
      }
      applySock(k);
    }
  }
  function snapFrom(k) { k.f.x = k.x; k.f.y = k.y; k.f.z = k.z; k.f.psi = k.psi; k.f.tilt = k.tilt; }
  function dropSock() {
    if (stuck < 0) return;
    const i = stuck, k = socks[i]; stuck = -1;
    snapFrom(k);
    const fx = -Math.sin(hd.yaw), fz = -Math.cos(hd.yaw);
    const ex = hd.mx + fx * L.head.d / 2, ez = hd.mz + fz * L.head.d / 2;
    k.g.x = ex + fx * 0.02; k.g.z = ez + fz * 0.02; k.g.psi = hd.yaw + Math.PI / 2; k.g.tilt = 0;
    sockCenter({ x: k.g.x, z: k.g.z, psi: k.g.psi, cd: k.cd }, tmpPt);
    k.g.y = fy(tmpPt.x, tmpPt.z);
    k.st = 'drop'; k.t = 0;
  }
  function sockToBasket() {
    if (stuck < 0) return;
    const i = stuck, k = socks[i]; stuck = -1;
    let order = 0; for (let j = 0; j < socks.length; j++) if (j !== i && (socks[j].st === 'basket' || socks[j].st === 'toBasket')) order++;
    k.order = order; snapFrom(k); basketPose(k, order, k.g);
    k.st = 'toBasket'; k.t = 0;
  }
  function resetSocks(onFloor) {
    stuck = -1;
    for (let i = 0; i < socks.length; i++) {
      const k = socks[i], s = L.socks[i];
      k.cool = 0; k.t = 0; k.roll = 0;
      if (onFloor) { setFloorPose(k, s.x, s.z, s.rot); k.st = 'floor'; }
      else { basketPose(k, i, k.g); k.x = k.g.x; k.y = k.g.y; k.z = k.g.z; k.psi = k.g.psi; k.tilt = k.g.tilt; k.st = 'basket'; k.order = i; }
      applySock(k);
    }
  }

  // =====================================================================
  // 問い合わせ
  // =====================================================================
  function remaining() {
    let n = 0;
    for (let i = 0; i < hi; i++) if (state[i] !== DEAD) n++;
    for (const S of streamers) if (S.st) n++;
    return n;
  }
  function falling() {
    let n = 0;
    for (let i = 0; i < hi; i++) if (state[i] === FLY || state[i] === BALL) n++;
    for (const S of streamers) if (S.st === 1) n++;
    return n;
  }
  function nearest(x, z, out) {
    let bd = 1e9, bx_ = 0, bz_ = 0;
    for (let i = 0; i < hi; i++) {
      if (state[i] !== FLOOR) continue;
      const d = (px[i] - x) * (px[i] - x) + (pz[i] - z) * (pz[i] - z);
      if (d < bd) { bd = d; bx_ = px[i]; bz_ = pz[i]; }
    }
    for (const S of streamers) {
      if (S.st !== 2) continue;
      for (let j = S.h; j < S.n; j++) {
        const d = (S.px[j] - x) * (S.px[j] - x) + (S.pz[j] - z) * (S.pz[j] - z);
        if (d < bd) { bd = d; bx_ = S.px[j]; bz_ = S.pz[j]; }
      }
    }
    if (bd >= 1e9) return false;
    if (out) { out.x = bx_; out.z = bz_; }
    return true;
  }
  const setTwinkle = a => { twAmp = sat(+a || 0); };
  const slurp = () => slurpAmt;
  const stuckSock = () => stuck;
  const socksLeft = () => { let n = 0; for (const k of socks) if (k.st !== 'basket' && k.st !== 'toBasket') n++; return n; };

  return {
    init, on, burst, update, remaining, falling, nearest, setTwinkle, slurp,
    stuckSock, socksLeft, dropSock, sockToBasket, resetSocks, spawnLast, clear,
  };
})();

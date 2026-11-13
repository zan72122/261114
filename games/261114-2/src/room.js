// room.js — 部屋・照明・くす玉・洗濯かご・ごみ箱・ラグ（昼のふつうの日本のリビング）
const Room = (() => {
  const D = Math.PI / 180;
  const clamp = Base.clamp, sat = Base.sat, lerp = Base.lerp, damp = Base.damp, smooth = Base.smooth;
  const V3 = THREE.Vector3;
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
  const _v = new V3(), _v2 = new V3(), _v3 = new V3(), _s = new V3(), _e = new THREE.Euler();
  const UP = new V3(0, 1, 0);

  let scene = null, ready = false, T = 0, timeT = 0;
  let sun = null, hemi = null, fillLight = null, lampLight = null;
  const sunDir = new V3(), sunTarget = new V3(-0.5, 0, -0.4);
  const envMats = []; // envMapIntensity を夜に下げる自分の材質
  let lampShadeMat = null, bulbMat = null, outsideMat = null;

  // ------------------------------------------------------------ 小道具
  function std(o) { const m = new THREE.MeshStandardMaterial(o); envMats.push(m); return m; }
  function mtx(x, y, z, rx, ry, rz, sx, sy, sz) {
    _e.set(rx || 0, ry || 0, rz || 0);
    return new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromEuler(_e),
      new V3(sx == null ? 1 : sx, sy == null ? 1 : sy, sz == null ? 1 : sz));
  }
  // parts: [geometry, matrix|null, color|null] → 1 つの非インデックス BufferGeometry
  function merge(parts) {
    let n = 0; const list = [];
    let useCol = false;
    for (const p of parts) {
      const g = p[0].index ? p[0].toNonIndexed() : p[0].clone();
      if (p[1]) g.applyMatrix4(p[1]);
      list.push([g, p[2]]); n += g.attributes.position.count;
      if (p[2] != null) useCol = true;
    }
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    const col = useCol ? new Float32Array(n * 3) : null;
    let o = 0; const c = new THREE.Color();
    for (const [g, cc] of list) {
      const k = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3);
      if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
      if (col) {
        if (cc != null) c.set(cc); else c.setRGB(1, 1, 1);
        for (let i = 0; i < k; i++) { col[(o + i) * 3] = c.r; col[(o + i) * 3 + 1] = c.g; col[(o + i) * 3 + 2] = c.b; }
      }
      o += k; g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.computeBoundingSphere();
    return out;
  }
  // 角の丸い箱（s = 丸み部分の分割数）
  function rbox(w, h, d, r, s) {
    s = s || 3;
    const n = 2 * s + 2;
    const g = new THREE.BoxGeometry(w, h, d, n, n, n);
    const p = g.attributes.position, no = g.attributes.normal;
    const hs = [w / 2, h / 2, d / 2];
    r = Math.min(r, hs[0], hs[1], hs[2]) * 0.999;
    const v = [0, 0, 0], c = [0, 0, 0];
    for (let i = 0; i < p.count; i++) {
      for (let a = 0; a < 3; a++) {
        const x = p.getComponent(i, a);
        const idx = Math.round((x / hs[a] + 1) / 2 * n);
        let y;
        if (idx <= s) y = -hs[a] + r * (1 - Math.cos(idx / s * Math.PI / 2));
        else if (idx >= n - s) y = hs[a] - r * (1 - Math.cos((n - idx) / s * Math.PI / 2));
        else y = lerp(-hs[a] + r, hs[a] - r, (idx - s) / (n - 2 * s));
        v[a] = y; c[a] = clamp(y, -hs[a] + r, hs[a] - r);
      }
      let dx = v[0] - c[0], dy = v[1] - c[1], dz = v[2] - c[2];
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-7) { dx = no.getX(i); dy = no.getY(i); dz = no.getZ(i); }
      else { dx /= len; dy /= len; dz /= len; }
      p.setXYZ(i, c[0] + dx * r, c[1] + dy * r, c[2] + dz * r);
      no.setXYZ(i, dx, dy, dz);
    }
    return g;
  }
  // 枕（スーパー楕円体を中ほど厚く）
  function pillow(w, h, d) {
    const g = new THREE.SphereGeometry(1, 28, 20);
    const p = g.attributes.position;
    const pw = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);
    for (let i = 0; i < p.count; i++) {
      const ux = p.getX(i), uy = p.getY(i), uz = p.getZ(i);
      const x = pw(ux, 0.28), y = pw(uy, 0.28);
      const thick = 0.22 + 0.78 * Math.sqrt(Math.max(0, (1 - Math.pow(Math.abs(x), 3)) * (1 - Math.pow(Math.abs(y), 3))));
      p.setXYZ(i, x * w / 2, y * h / 2, uz * d / 2 * thick);
    }
    g.computeVertexNormals();
    return g;
  }
  function lathe(pts, seg) { return new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg || 32); }
  // タイルできる値ノイズ
  function tileNoise(rnd, n) {
    const g = new Float32Array(n * n); for (let i = 0; i < g.length; i++) g[i] = rnd();
    const at = (x, y) => g[(((y % n) + n) % n) * n + (((x % n) + n) % n)];
    return (u, v) => {
      const x = u * n, y = v * n, xi = Math.floor(x), yi = Math.floor(y);
      let fx = x - xi, fy = y - yi; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      return lerp(lerp(at(xi, yi), at(xi + 1, yi), fx), lerp(at(xi, yi + 1), at(xi + 1, yi + 1), fx), fy);
    };
  }
  function pixTex(w, h, fn, o) {
    return Base.canvasTex(w, h, ctx => {
      const id = ctx.createImageData(w, h), d = id.data, px = [0, 0, 0, 255];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        px[3] = 255; fn(x, y, px);
        const i = (y * w + x) * 4; d[i] = px[0]; d[i + 1] = px[1]; d[i + 2] = px[2]; d[i + 3] = px[3];
      }
      ctx.putImageData(id, 0, 0);
    }, o);
  }

  // ------------------------------------------------------------ テクスチャ
  const TX = {};
  function makeTextures() {
    // 床（オークの板張り）: 幅 1.04m（板 8 枚）× 長さ 2.08m
    TX.floor = Base.canvasTex(1024, 1024, (ctx, W, H) => {
      const rnd = Base.rng(11), NB = 8, BW = W / NB;
      ctx.fillStyle = '#5a3f28'; ctx.fillRect(0, 0, W, H);
      const board = (x, y, w, h, r) => {
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
        const hue = 27 + r() * 6, s = 24 + r() * 10, l = 40 + r() * 9;
        ctx.fillStyle = `hsl(${hue},${s}%,${l}%)`; ctx.fillRect(x, y, w, h);
        const g = ctx.createLinearGradient(x, y, x, y + h);
        g.addColorStop(0, `rgba(70,40,18,${r() * 0.14})`); g.addColorStop(0.5, `rgba(255,232,195,${r() * 0.08})`); g.addColorStop(1, `rgba(70,40,18,${r() * 0.14})`);
        ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
        const nl = 30 + (r() * 22 | 0);
        for (let k = 0; k < nl; k++) {
          const gx = x + r() * w, amp = 1 + r() * 5, f = 0.003 + r() * 0.01, ph = r() * 6.28, dr = (r() - 0.5) * 0.03;
          ctx.strokeStyle = r() < 0.78 ? `rgba(72,42,20,${0.05 + r() * 0.16})` : `rgba(245,218,178,${0.05 + r() * 0.08})`;
          ctx.lineWidth = 0.6 + r() * 2.4; ctx.beginPath();
          for (let yy = 0; yy <= h + 16; yy += 16) { const px = gx + Math.sin(yy * f + ph) * amp + yy * dr; if (yy === 0) ctx.moveTo(px, y + yy); else ctx.lineTo(px, y + yy); }
          ctx.stroke();
        }
        for (let k = 0; k < 40; k++) { ctx.fillStyle = `rgba(238,210,165,${0.06 + r() * 0.1})`; ctx.fillRect(x + r() * w, y + r() * h, 1 + r() * 2, 4 + r() * 14); }
        for (let k = 0; k < 160; k++) { ctx.fillStyle = `rgba(48,28,12,${0.08 + r() * 0.12})`; ctx.fillRect(x + r() * w, y + r() * h, 1, 2 + r() * 5); }
        if (r() < 0.12) { // 小さな節
          const kx = x + 15 + r() * (w - 30), ky = y + r() * h;
          ctx.fillStyle = 'rgba(80,48,22,0.35)'; ctx.beginPath(); ctx.ellipse(kx, ky, 3 + r() * 3, 6 + r() * 6, 0, 0, 6.29); ctx.fill();
        }
        ctx.fillStyle = 'rgba(38,22,10,0.6)'; ctx.fillRect(x, y, 1.6, h); ctx.fillRect(x, y, w, 1.6);
        ctx.fillStyle = 'rgba(255,236,205,0.12)'; ctx.fillRect(x + 1.6, y, 1, h); ctx.fillRect(x, y + 1.6, w, 1);
        ctx.restore();
      };
      for (let c = 0; c < NB; c++) {
        const m = rnd() < 0.55 ? 1 : 2, off = rnd() * H, cuts = [];
        for (let k = 0; k < m; k++) cuts.push(off + k * H / m + (k ? (rnd() - 0.5) * 0.3 * H : 0));
        for (let k = 0; k < m; k++) {
          const a = cuts[k], b = k + 1 < m ? cuts[k + 1] : cuts[0] + H, seed = (rnd() * 1e9) | 0;
          for (const sh of [0, -H, H]) board(c * BW, a + sh, BW, b - a, Base.rng(seed));
        }
      }
    }, { repeat: [5, 3.25], aniso: 8 });

    // ラグの毛並み（グレー。色は材質で）
    const rr = Base.rng(21), n1 = tileNoise(rr, 16), n2 = tileNoise(rr, 64);
    TX.rug = pixTex(512, 512, (x, y, px) => {
      const u = x / 512, v = y / 512;
      const g = 0.86 + 0.06 * (n1(u, v) - 0.5) + 0.07 * (n2(u, v) - 0.5) + 0.12 * (rr() - 0.5);
      const c = clamp(g, 0, 1) * 255; px[0] = c; px[1] = c; px[2] = c;
    }, { repeat: [4, 4], aniso: 8 });

    // 壁紙（細かい凹凸）
    const wr = Base.rng(31), w1 = tileNoise(wr, 32);
    TX.wall = pixTex(256, 256, (x, y, px) => {
      const g = 0.93 + 0.05 * (w1(x / 256, y / 256) - 0.5) + 0.06 * (wr() - 0.5);
      const c = clamp(g, 0, 1) * 255; px[0] = c; px[1] = c; px[2] = c;
    }, { repeat: [10, 5] });

    // 布の織り目
    const fr = Base.rng(41), f1 = tileNoise(fr, 8);
    TX.fabric = pixTex(256, 256, (x, y, px) => {
      const wv = 0.5 + 0.5 * Math.sin(x * Math.PI / 2) * Math.sin(y * Math.PI / 2 + ((x >> 1) & 1) * Math.PI);
      const g = 0.82 + 0.08 * wv + 0.06 * (f1(x / 256, y / 256) - 0.5) + 0.06 * (fr() - 0.5);
      const c = clamp(g, 0, 1) * 255; px[0] = c; px[1] = c; px[2] = c;
    }, { repeat: [3, 3] });

    // 和紙（繊維）
    TX.washi = Base.canvasTex(256, 256, (ctx, W, H) => {
      const r = Base.rng(51);
      ctx.fillStyle = '#e6e6e6'; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 520; i++) {
        const x = r() * W, y = r() * H, a = r() * 6.28, l = 6 + r() * 26;
        ctx.strokeStyle = r() < 0.6 ? `rgba(255,255,255,${0.25 + r() * 0.4})` : `rgba(150,150,150,${0.1 + r() * 0.2})`;
        ctx.lineWidth = 0.5 + r() * 1.2; ctx.beginPath(); ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + Math.cos(a + 0.7) * l * 0.5, y + Math.sin(a + 0.7) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
      }
      for (let i = 0; i < 70; i++) { ctx.fillStyle = `rgba(255,255,255,${0.08 + r() * 0.12})`; ctx.beginPath(); ctx.arc(r() * W, r() * H, 3 + r() * 10, 0, 6.29); ctx.fill(); }
    }, { srgb: true });
    // 金箔のしわ
    TX.crinkle = Base.canvasTex(256, 256, (ctx, W, H) => {
      const r = Base.rng(61);
      ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 900; i++) {
        const x = r() * W, y = r() * H, a = r() * 6.28, l = 3 + r() * 16;
        const c = r() < 0.5 ? 255 : 0;
        ctx.strokeStyle = `rgba(${c},${c},${c},${0.15 + r() * 0.35})`; ctx.lineWidth = 0.6 + r() * 1.4;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
      }
      for (let i = 0; i < 120; i++) {
        const c = r() < 0.5 ? 255 : 0; ctx.fillStyle = `rgba(${c},${c},${c},${0.08 + r() * 0.12})`;
        ctx.beginPath(); const x = r() * W, y = r() * H; ctx.moveTo(x, y);
        for (let k = 0; k < 3; k++) ctx.lineTo(x + (r() - 0.5) * 30, y + (r() - 0.5) * 30); ctx.fill();
      }
    }, { srgb: false });

    // 籐の編み目（すき間は透明）
    TX.weave = Base.canvasTex(256, 256, (ctx, W, H) => {
      const r = Base.rng(71);
      ctx.clearRect(0, 0, W, H);
      const rowH = 32, gap = 7, stakeW = 10, stakeSp = 64;
      for (let row = 0; row < H / rowH; row++) {
        const y = row * rowH;
        for (let x = 0; x < W; x += 2) {
          const t = r();
          const base = [176 + t * 22, 136 + t * 18, 92 + t * 14];
          for (let yy = 0; yy < rowH - gap; yy++) {
            const sh = 0.72 + 0.32 * Math.sin((yy + 0.5) / (rowH - gap) * Math.PI);
            ctx.fillStyle = `rgb(${base[0] * sh | 0},${base[1] * sh | 0},${base[2] * sh | 0})`;
            ctx.fillRect(x, y + yy, 2, 1);
          }
        }
        // 縦の芯（交互に上・下）
        for (let sx = 0; sx < W; sx += stakeSp) {
          const over = ((row + sx / stakeSp) & 1) === 0;
          const x0 = sx + (row & 1 ? stakeSp / 2 : 0) - stakeW / 2;
          ctx.fillStyle = over ? 'rgba(120,88,54,1)' : 'rgba(90,64,38,0.55)';
          ctx.fillRect(((x0 % W) + W) % W, y - 1, stakeW, rowH - gap + 2);
          ctx.fillStyle = over ? 'rgba(215,180,130,0.6)' : 'rgba(0,0,0,0)';
          ctx.fillRect(((x0 % W) + W) % W + 2, y, 2, rowH - gap);
        }
        // すき間に縦芯だけ見える
        for (let sx = 0; sx < W; sx += stakeSp / 2) {
          ctx.fillStyle = 'rgb(112,82,50)'; ctx.fillRect(sx + stakeSp / 4 - stakeW / 2, y + rowH - gap, stakeW, gap);
        }
      }
    }, { repeat: [10, 7] });

    // 葉
    TX.leaf = Base.canvasTex(64, 128, (ctx, W, H) => {
      const g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, '#3f6a2c'); g.addColorStop(0.5, '#5b8a3c'); g.addColorStop(1, '#3f6a2c');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(200,230,150,0.55)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
      ctx.strokeStyle = 'rgba(200,230,150,0.22)'; ctx.lineWidth = 0.8;
      for (let y = 8; y < H; y += 9) { ctx.beginPath(); ctx.moveTo(W / 2, y); ctx.lineTo(4, y - 10); ctx.moveTo(W / 2, y); ctx.lineTo(W - 4, y - 10); ctx.stroke(); }
    });

    // やわらかい影の丸
    TX.blob = Base.canvasTex(64, 64, (ctx, W, H) => {
      const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.45, 'rgba(0,0,0,0.75)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }, { srgb: false });
    // 内側から光るグラデーション（v=0 が下）
    TX.glow = Base.canvasTex(4, 64, (ctx, W, H) => {
      const g = ctx.createLinearGradient(0, H, 0, 0);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.55, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    });
    // 房の糸
    TX.thread = pixTex(64, 16, (x, y, px) => {
      const g = 0.7 + 0.3 * Math.abs(Math.sin(x * 0.9)) + 0.08 * Math.sin(x * 2.3);
      const c = clamp(g, 0, 1) * 255; px[0] = c; px[1] = c; px[2] = c;
    }, { repeat: [3, 1] });
    // 窓の外（明るい空と緑のぼかし）
    TX.outside = Base.canvasTex(256, 128, (ctx, W, H) => {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#dcebf6'); g.addColorStop(0.55, '#f8fbfc'); g.addColorStop(1, '#eef2ea');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.filter = 'blur(7px)';
      const r = Base.rng(81);
      for (let i = 0; i < 26; i++) {
        ctx.fillStyle = `rgba(${90 + r() * 50 | 0},${135 + r() * 45 | 0},${70 + r() * 30 | 0},${0.5 + r() * 0.3})`;
        ctx.beginPath(); ctx.arc(r() * W, H * (0.55 + r() * 0.45), 10 + r() * 26, 0, 6.29); ctx.fill();
      }
      ctx.filter = 'none';
    });
  }

  // ------------------------------------------------------------ 照明
  function sunDirFor(t) {
    const e = lerp(40, 13, t) * D, az = lerp(22, 9, t) * D;
    return sunDir.set(Math.cos(e) * Math.cos(az), -Math.sin(e), -Math.cos(e) * Math.sin(az)).normalize();
  }
  const RX = [[-2.6, 2.6], [0, 2.4], [-2.6, 2.3]];         // 影を受ける範囲（見える部屋全体: 窓以外は日が当たらないため）
  const CX = [[-2.8, 2.6], [0, 2.45], [-2.6, 4.2]];        // 影を落とす範囲（窓の壁・天井を含む）
  function fitShadow() {
    sun.position.copy(sunTarget).addScaledVector(sunDir, -14);
    sun.target.position.copy(sunTarget);
    sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
    const cam = sun.shadow.camera;
    cam.position.copy(sun.position); cam.lookAt(sunTarget); cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < 8; i++) {
      _v.set(RX[0][i & 1], RX[1][(i >> 1) & 1], RX[2][(i >> 2) & 1]).applyMatrix4(inv);
      x0 = Math.min(x0, _v.x); x1 = Math.max(x1, _v.x); y0 = Math.min(y0, _v.y); y1 = Math.max(y1, _v.y);
      _v.set(CX[0][i & 1], CX[1][(i >> 1) & 1], CX[2][(i >> 2) & 1]).applyMatrix4(inv);
      z0 = Math.min(z0, _v.z); z1 = Math.max(z1, _v.z);
    }
    cam.left = x0; cam.right = x1; cam.bottom = y0; cam.top = y1;
    cam.near = Math.max(0.1, -z1 - 0.2); cam.far = -z0 + 0.2;
    cam.updateProjectionMatrix();
  }
  function buildLights() {
    hemi = new THREE.HemisphereLight(0xf6f2ec, 0xb9a284, 0.75);
    sun = new THREE.DirectionalLight(0xfff0dc, 3.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.025;
    fillLight = new THREE.DirectionalLight(0xfff7ee, 0.35);
    fillLight.position.set(1.5, 3.2, 4.0);
    lampLight = new THREE.PointLight(0xffb870, 0, 6, 2);
    scene.add(hemi, sun, sun.target, fillLight, lampLight);
    sunDirFor(0); fitShadow();
  }

  // ------------------------------------------------------------ 部屋
  let floorMat = null, wallMat = null, ceilEmis = null;
  function buildRoom() {
    const R = L.room, W = R.xMax - R.xMin, Dp = R.zSouth - R.zNorth, cz = (R.zNorth + R.zSouth) / 2;
    floorMat = std({ map: TX.floor, bumpMap: TX.floor, bumpScale: 0.8, roughness: 0.46, metalness: 0, color: 0xe6dccf });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, Dp), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, cz); floor.receiveShadow = true;
    scene.add(floor);

    wallMat = std({ color: 0xf2eee7, map: TX.wall, bumpMap: TX.wall, bumpScale: 0.6, roughness: 0.93 });
    const north = new THREE.Mesh(new THREE.PlaneGeometry(W, R.ceil), wallMat);
    north.position.set(0, R.ceil / 2, R.zNorth); north.receiveShadow = true; scene.add(north);
    const east = new THREE.Mesh(new THREE.PlaneGeometry(Dp, R.ceil), wallMat);
    east.rotation.y = -Math.PI / 2; east.position.set(R.xMax, R.ceil / 2, cz); east.receiveShadow = true; scene.add(east);
    // 西の壁（掃き出し窓の穴あき。影も落とす）
    const wz0 = -1.3, wz1 = 0.8, wy1 = 2.0, wy0 = 0.04, th = 0.12, wx = R.xMin - th / 2;
    const B = new THREE.BoxGeometry(1, 1, 1);
    const westG = merge([
      [B, mtx(wx, (wy1 + R.ceil) / 2, cz, 0, 0, 0, th, R.ceil - wy1, Dp)],
      [B, mtx(wx, wy1 / 2, (R.zNorth + wz0) / 2, 0, 0, 0, th, wy1, wz0 - R.zNorth)],
      [B, mtx(wx, wy1 / 2, (wz1 + R.zSouth) / 2, 0, 0, 0, th, wy1, R.zSouth - wz1)],
      [B, mtx(wx, wy0 / 2, (wz0 + wz1) / 2, 0, 0, 0, th, wy0, wz1 - wz0)],
    ]);
    const west = new THREE.Mesh(westG, wallMat); west.castShadow = true; west.receiveShadow = true; scene.add(west);
    // 天井（窓より上の光をさえぎる）
    const ceilMat = std({ color: 0xf7f5f1, map: TX.wall, roughness: 0.95, emissive: 0xf4efe6, emissiveIntensity: 0.32 });
    ceilEmis = ceilMat;
    ceilMat.shadowSide = THREE.DoubleSide;
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.3, Dp), ceilMat);
    ceil.rotation.x = Math.PI / 2; ceil.position.set(0, R.ceil, cz); ceil.castShadow = true; scene.add(ceil);
    // 巾木・回り縁
    const trimG = merge([
      [B, mtx(0, 0.035, R.zNorth + 0.006, 0, 0, 0, W, 0.07, 0.012), 0x8a6a4c],
      [B, mtx(R.xMax - 0.006, 0.035, cz, 0, 0, 0, 0.012, 0.07, Dp), 0x8a6a4c],
      [B, mtx(R.xMin + 0.006, 0.035, (R.zNorth + wz0) / 2, 0, 0, 0, 0.012, 0.07, wz0 - R.zNorth), 0x8a6a4c],
      [B, mtx(R.xMin + 0.006, 0.035, (wz1 + R.zSouth) / 2, 0, 0, 0, 0.012, 0.07, R.zSouth - wz1), 0x8a6a4c],
      [B, mtx(0, R.ceil - 0.015, R.zNorth + 0.008, 0, 0, 0, W, 0.03, 0.016), 0xf4f1ea],
    ]);
    const trim = new THREE.Mesh(trimG, std({ vertexColors: true, roughness: 0.55 }));
    trim.receiveShadow = true; scene.add(trim);
    // サッシ（アルミ）とガラス、外の景色
    const fx = R.xMin - 0.05, fw = 0.045, mz = (wz0 + wz1) / 2;
    const frameG = merge([
      [B, mtx(fx, wy1 - fw / 2, mz, 0, 0, 0, 0.07, fw, wz1 - wz0)],
      [B, mtx(fx, wy0 + fw / 2, mz, 0, 0, 0, 0.07, fw, wz1 - wz0)],
      [B, mtx(fx, (wy0 + wy1) / 2, wz0 + fw / 2, 0, 0, 0, 0.07, wy1 - wy0, fw)],
      [B, mtx(fx, (wy0 + wy1) / 2, wz1 - fw / 2, 0, 0, 0, 0.07, wy1 - wy0, fw)],
      [B, mtx(fx - 0.015, (wy0 + wy1) / 2, mz - 0.02, 0, 0, 0, 0.03, wy1 - wy0, 0.035)],
      [B, mtx(fx + 0.015, (wy0 + wy1) / 2, mz + 0.02, 0, 0, 0, 0.03, wy1 - wy0, 0.035)],
    ]);
    const frame = new THREE.Mesh(frameG, std({ color: 0xb9b7b1, metalness: 0.7, roughness: 0.38 }));
    frame.castShadow = true; scene.add(frame);
    const glassG = merge([
      [new THREE.PlaneGeometry(1, 1), mtx(fx - 0.015, (wy0 + wy1) / 2, (wz0 + mz) / 2, 0, Math.PI / 2, 0, (mz - wz0), wy1 - wy0, 1)],
      [new THREE.PlaneGeometry(1, 1), mtx(fx + 0.015, (wy0 + wy1) / 2, (mz + wz1) / 2, 0, Math.PI / 2, 0, (wz1 - mz), wy1 - wy0, 1)],
    ]);
    const glass = new THREE.Mesh(glassG, new THREE.MeshStandardMaterial({ color: 0xdfeceb, transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0, depthWrite: false }));
    scene.add(glass);
    outsideMat = new THREE.MeshBasicMaterial({ map: TX.outside, color: 0xffffff });
    const out = new THREE.Mesh(new THREE.PlaneGeometry(7, 4.4), outsideMat);
    out.rotation.y = Math.PI / 2; out.position.set(R.xMin - 1.0, 1.4, mz); scene.add(out);
  }

  // ------------------------------------------------------------ ラグ・跡・房
  let trackCtx = null, trackTex = null;
  const TRK = 1024;
  let fringe = null;
  const NF = 88, fX = new Float32Array(NF), fJit = new Float32Array(NF), fLen = new Float32Array(NF), fPh = new Float32Array(NF), fA = new Float32Array(NF);
  let fHx = 0, fHz = 99, fSuc = 0, fMax = 0;
  function buildRug() {
    const g = L.rug, w = g.xMax - g.xMin, d = g.zMax - g.zMin, cx = (g.xMin + g.xMax) / 2, cz = (g.zMin + g.zMax) / 2;
    const rugMat = std({ color: 0xc8bdac, map: TX.rug, bumpMap: TX.rug, bumpScale: 2.2, roughness: 0.97 });
    const rug = new THREE.Mesh(rbox(w, g.pile * 2, d, 0.006, 2), rugMat);
    rug.position.set(cx, 0, cz); rug.receiveShadow = true; scene.add(rug);
    // 掃除機の跡（透明オーバーレイ）
    trackTex = Base.canvasTex(TRK, TRK, (ctx, W, H) => { ctx.clearRect(0, 0, W, H); trackCtx = ctx; });
    trackTex.anisotropy = 8;
    const trMat = new THREE.MeshStandardMaterial({ map: trackTex, transparent: true, depthWrite: false, roughness: 1, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    envMats.push(trMat);
    const tr = new THREE.Mesh(new THREE.PlaneGeometry(w, d), trMat);
    tr.rotation.x = -Math.PI / 2; tr.position.set(cx, g.pile + 0.0006, cz); tr.renderOrder = 1; tr.receiveShadow = true;
    scene.add(tr);
    // 房（南端 NF 本 + 北端 NF 本）
    const fg = new THREE.CylinderGeometry(0.0028, 0.002, 1, 5, 1);
    fg.rotateX(Math.PI / 2); fg.translate(0, 0, 0.5);
    const fm = std({ color: 0xe6ddcf, map: TX.thread, roughness: 0.95 });
    fringe = new THREE.InstancedMesh(fg, fm, NF * 2);
    fringe.frustumCulled = false;
    const r = Base.rng(91);
    for (let i = 0; i < NF; i++) {
      fX[i] = lerp(g.xMin + 0.012, g.xMax - 0.012, i / (NF - 1));
      fJit[i] = (r() - 0.5) * 0.22; fLen[i] = 0.058 + r() * 0.016; fPh[i] = r() * 6.28;
      _e.set(-0.02, Math.PI + (r() - 0.5) * 0.22, 0, 'YXZ'); _q.setFromEuler(_e);
      _m.compose(_v.set(fX[i] + (r() - 0.5) * 0.004, 0.0035, g.zMin - 0.003), _q, _s.set(1, 1, 0.056 + r() * 0.018));
      fringe.setMatrixAt(NF + i, _m);
    }
    _e.order = 'XYZ';
    scene.add(fringe);
    updateFringe(0);
  }
  function updateFringe(dt) {
    const g = L.rug;
    let mx = 0;
    for (let i = 0; i < NF; i++) {
      const dx = fHx - fX[i], dz = fHz - g.zMax, dd = Math.hypot(dx, dz);
      const tgt = fSuc > 0 && dd < 0.28 ? fSuc * smooth(1 - dd / 0.28) : 0;
      fA[i] = dt > 0 ? damp(fA[i], tgt, tgt > fA[i] ? 14 : 3.5, dt) : tgt;
      const a = fA[i];
      if (a > mx) mx = a;
      let ang = Math.atan2(dx, dz) - fJit[i];
      while (ang > Math.PI) ang -= 2 * Math.PI; while (ang < -Math.PI) ang += 2 * Math.PI;
      const yaw = fJit[i] + a * ang * 0.85 + a * 0.32 * Math.sin(T * 31 + fPh[i]);
      const lift = a * 0.5 + a * 0.28 * Math.sin(T * 43 + fPh[i] * 1.7);
      _e.set(-lift - 0.02, yaw, 0, 'YXZ'); _q.setFromEuler(_e);
      _m.compose(_v.set(fX[i], 0.0035 + a * 0.004, g.zMax + 0.003), _q, _s.set(1, 1, fLen[i] * (1 - a * 0.12)));
      fringe.setMatrixAt(i, _m);
    }
    _e.order = 'XYZ';
    fringe.instanceMatrix.needsUpdate = true;
    fMax = mx;
  }
  function paintTrack(x0, z0, x1, z1) {
    if (!ready || !trackCtx) return;
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    if (!(len > 0.0015) || len > 0.6) return;
    if (!L.onRug((x0 + x1) / 2, (z0 + z1) / 2)) return;
    const g = L.rug, sx = TRK / (g.xMax - g.xMin), sz = TRK / (g.zMax - g.zMin);
    const nx = -dz / len, nz = dx / len, hw = L.head.w / 2, ex = dx / len * 0.004, ez = dz / len * 0.004;
    const P = (x, z) => [(x - g.xMin) * sx, (z - g.zMin) * sz];
    const a = P(x0 - nx * hw - ex, z0 - nz * hw - ez), b = P(x0 + nx * hw - ex, z0 + nz * hw - ez);
    const c = P(x1 + nx * hw + ex, z1 + nz * hw + ez), d = P(x1 - nx * hw + ex, z1 - nz * hw + ez);
    const ctx = trackCtx;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath();
    ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = '#000'; ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    const t = -dz / len; // + = 奥へ押す
    ctx.fillStyle = t >= 0 ? `rgba(255,253,248,${(0.06 + 0.06 * t).toFixed(3)})` : `rgba(96,86,74,${(0.05 + 0.06 * -t).toFixed(3)})`;
    ctx.fill();
    trackTex.needsUpdate = true;
  }
  function setFringe(hx, hz, suction) {
    fHx = +hx || 0; fHz = +hz || 0; fSuc = sat(+suction || 0);
    return fMax;
  }

  // ------------------------------------------------------------ ソファ・ランプ・植物・ガーランド
  const blobs = [];
  function buildSofa() {
    const S = L.sofa, x = S.x, z = S.z;
    const fab = std({ color: 0x7f8c95, map: TX.fabric, bumpMap: TX.fabric, bumpScale: 1.2, roughness: 0.92 });
    fab.map = TX.fabric.clone(); fab.map.needsUpdate = true; fab.map.repeat.set(5, 5);
    const legH = 0.08, baseTop = 0.29, armW = 0.18, backD = 0.2;
    const zf = z + S.d / 2, zb = z - S.d / 2;
    const sofaG = merge([
      [rbox(S.w, baseTop - legH, S.d - 0.02, 0.04), mtx(x, (legH + baseTop) / 2, z)],
      [rbox((S.w - 2 * armW) / 2 - 0.01, 0.15, S.d - backD - 0.02, 0.05), mtx(x - (S.w - 2 * armW) / 4, baseTop + 0.07, z + backD / 2 - 0.0)],
      [rbox((S.w - 2 * armW) / 2 - 0.01, 0.15, S.d - backD - 0.02, 0.05), mtx(x + (S.w - 2 * armW) / 4, baseTop + 0.07, z + backD / 2 - 0.0)],
      [rbox(S.w - 2 * armW + 0.02, S.backH - baseTop + 0.01, backD, 0.06), mtx(x, (baseTop + S.backH) / 2 - 0.01, zb + backD / 2)],
      [rbox(armW, 0.62 - legH, S.d, 0.065), mtx(x - S.w / 2 + armW / 2, (legH + 0.62) / 2, z)],
      [rbox(armW, 0.62 - legH, S.d, 0.065), mtx(x + S.w / 2 - armW / 2, (legH + 0.62) / 2, z)],
      [rbox((S.w - 2 * armW) / 2 - 0.015, 0.40, 0.17, 0.07), mtx(x - (S.w - 2 * armW) / 4, baseTop + 0.15 + 0.2, zb + backD + 0.07, -0.13)],
      [rbox((S.w - 2 * armW) / 2 - 0.015, 0.40, 0.17, 0.07), mtx(x + (S.w - 2 * armW) / 4, baseTop + 0.15 + 0.2, zb + backD + 0.07, -0.13)],
    ]);
    const sofa = new THREE.Mesh(sofaG, fab); sofa.castShadow = true; sofa.receiveShadow = true; scene.add(sofa);
    // 脚
    const lg = new THREE.CylinderGeometry(0.018, 0.013, legH, 10);
    const legs = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) legs.push([lg, mtx(x + sx * (S.w / 2 - 0.08), legH / 2, z + sz * (S.d / 2 - 0.08))]);
    const legM = new THREE.Mesh(merge(legs), std({ color: 0x5b3f2a, roughness: 0.5 }));
    legM.castShadow = true; scene.add(legM);
    // クッション（頂点色）
    const cush = merge([
      [pillow(0.44, 0.44, 0.15), mtx(x - 0.55, 0.62, zb + backD + 0.2, -0.32, 0.18, 0.05), 0xc7a55f],
      [pillow(0.42, 0.42, 0.14), mtx(x + 0.52, 0.61, zb + backD + 0.2, -0.3, -0.22, -0.06), 0xe4ddd0],
      [pillow(0.36, 0.34, 0.12), mtx(x + 0.18, 0.58, zb + backD + 0.24, -0.34, -0.05, 0.04), 0xb27a62],
    ]);
    const cm = std({ vertexColors: true, map: TX.fabric, bumpMap: TX.fabric, bumpScale: 1.0, roughness: 0.9 });
    const cushM = new THREE.Mesh(cush, cm); cushM.castShadow = true; cushM.receiveShadow = true; scene.add(cushM);
    blobs.push([x, 0.0015, z + 0.02, S.w + 0.35, S.d + 0.3, 0.42]);
  }
  function buildLamp() {
    const x = -1.42, z = -2.2;
    const metal = std({ color: 0x34312d, metalness: 0.6, roughness: 0.42 });
    const lampG = merge([
      [new THREE.CylinderGeometry(0.13, 0.14, 0.022, 32), mtx(x, 0.011, z)],
      [new THREE.CylinderGeometry(0.011, 0.011, 1.40, 10), mtx(x, 0.72, z)],
      [new THREE.CylinderGeometry(0.02, 0.02, 0.05, 12), mtx(x, 1.42, z)],
    ]);
    const lamp = new THREE.Mesh(lampG, metal); lamp.castShadow = true; scene.add(lamp);
    lampShadeMat = std({ color: 0xeee6d6, map: TX.fabric, roughness: 0.9, side: THREE.DoubleSide, emissive: 0xffb466, emissiveMap: TX.fabric, emissiveIntensity: 0 });
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.3, 40, 1, true), lampShadeMat);
    shade.position.set(x, 1.55, z); shade.castShadow = true; scene.add(shade);
    bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff4e0, emissive: 0xffc27a, emissiveIntensity: 0, roughness: 0.3 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), bulbMat);
    bulb.position.set(x, 1.49, z); scene.add(bulb);
    lampLight.position.set(x, 1.5, z + 0.05);
    blobs.push([x, 0.0015, z, 0.36, 0.36, 0.45]);
  }
  function buildPlant() {
    const x = 1.42, z = -2.12, r = Base.rng(101);
    const pot = merge([
      [lathe([[0, 0.005], [0.112, 0.0], [0.122, 0.012], [0.152, 0.30], [0.163, 0.305], [0.165, 0.322], [0.152, 0.324], [0.146, 0.30], [0.14, 0.27], [0, 0.27]], 40), mtx(x, 0, z)],
    ]);
    const potM = new THREE.Mesh(pot, std({ color: 0xd9d3c8, map: TX.wall, roughness: 0.6 }));
    potM.castShadow = true; potM.receiveShadow = true; scene.add(potM);
    const soil = new THREE.Mesh(new THREE.CircleGeometry(0.143, 32), std({ color: 0x4a3626, roughness: 1 }));
    soil.rotation.x = -Math.PI / 2; soil.position.set(x, 0.296, z); scene.add(soil);
    // 幹（3 本編み）と葉柄
    const parts = [];
    const tops = [];
    for (let k = 0; k < 3; k++) {
      const pts = [];
      const hTop = 0.95 + k * 0.08;
      for (let i = 0; i <= 12; i++) {
        const h = 0.29 + (hTop - 0.29) * i / 12, a = h * 9 + k * 2.09, rr = 0.022 * (1 - i / 16);
        pts.push(new V3(Math.cos(a) * rr, h, Math.sin(a) * rr));
      }
      parts.push([new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.013 - k * 0.0015, 6), mtx(x, 0, z), 0x8c7a60]);
      tops.push(pts[12]);
    }
    const leafM = [];
    const nCl = 10;
    for (let j = 0; j < nCl; j++) {
      const t = tops[j % 3];
      let phi;
      do { phi = r() * Math.PI * 2; } while (Math.sin(phi) < -0.35);
      const el = (25 + r() * 40) * D, ln = 0.14 + r() * 0.14;
      const sx = x + t.x, sy = t.y - r() * 0.12, sz = z + t.z;
      const dir = _v.set(Math.cos(phi) * Math.cos(el), Math.sin(el), Math.sin(phi) * Math.cos(el));
      const ex = sx + dir.x * ln, ey = sy + dir.y * ln, ez = sz + dir.z * ln;
      _q.setFromUnitVectors(UP, dir);
      parts.push([new THREE.CylinderGeometry(0.0028, 0.0035, ln, 5), new THREE.Matrix4().compose(new V3((sx + ex) / 2, (sy + ey) / 2, (sz + ez) / 2), _q.clone(), new V3(1, 1, 1)), 0x5d7a3a]);
      for (let k = 0; k < 5; k++) {
        const p2 = phi + (k - 2) * 0.55 + (r() - 0.5) * 0.2, droop = (10 + r() * 30) * D;
        const len = (k === 2 ? 0.2 : k === 1 || k === 3 ? 0.17 : 0.13) * (0.85 + r() * 0.3);
        leafM.push([ex, ey, ez, p2, droop, len, 0.38 * len, r()]);
      }
    }
    const stems = new THREE.Mesh(merge(parts), std({ vertexColors: true, roughness: 0.8 }));
    stems.castShadow = true; scene.add(stems);
    // 葉（InstancedMesh）
    const sh = new THREE.Shape();
    const NP = 14;
    for (let i = 0; i <= NP; i++) { const t = i / NP, w = 0.5 * Math.pow(Math.sin(Math.PI * t), 0.75) * (1 - 0.25 * t); if (i === 0) sh.moveTo(w, t); else sh.lineTo(w, t); }
    for (let i = NP; i >= 0; i--) { const t = i / NP, w = 0.5 * Math.pow(Math.sin(Math.PI * t), 0.75) * (1 - 0.25 * t); sh.lineTo(-w, t); }
    const lg = new THREE.ShapeGeometry(sh, 6);
    const lp = lg.attributes.position, luv = lg.attributes.uv;
    for (let i = 0; i < lp.count; i++) {
      const lx = lp.getX(i), ly = lp.getY(i);
      lp.setZ(i, Math.abs(lx) * 0.12 - 0.12 * ly * ly);
      luv.setXY(i, lx + 0.5, ly);
    }
    lg.computeVertexNormals();
    const leafMat = std({ map: TX.leaf, roughness: 0.55, side: THREE.DoubleSide });
    const leaves = new THREE.InstancedMesh(lg, leafMat, leafM.length);
    const col = new THREE.Color();
    const yA = new V3(), zA = new V3(), xA = new V3();
    leafM.forEach((L0, i) => {
      const [lx, ly, lz, phi, droop, len, wid, rv] = L0;
      yA.set(Math.cos(phi) * Math.cos(droop), -Math.sin(droop), Math.sin(phi) * Math.cos(droop)).normalize();
      zA.copy(UP).addScaledVector(yA, -UP.dot(yA)).normalize();
      xA.crossVectors(yA, zA);
      _m.makeBasis(xA, yA, zA);
      _m.scale(_s.set(wid, len, len));
      _m.setPosition(lx, ly, lz);
      leaves.setMatrixAt(i, _m);
      leaves.setColorAt(i, col.setHSL(0.27 + rv * 0.04, 0.35, 0.78 + rv * 0.2));
    });
    leaves.castShadow = true; leaves.frustumCulled = false;
    scene.add(leaves);
    blobs.push([x, 0.0015, z, 0.42, 0.42, 0.5]);
  }
  function buildGarland() {
    const R = L.room, zW = R.zNorth + 0.03, x0 = -1.15, x1 = 1.15, y0 = 2.02, sag = 0.2;
    const yAt = x => y0 - sag * (1 - Math.pow((x - (x0 + x1) / 2) / ((x1 - x0) / 2), 2));
    const pts = [];
    for (let i = 0; i <= 30; i++) { const xx = lerp(x0, x1, i / 30); pts.push(new V3(xx, yAt(xx), zW)); }
    const str = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.0018, 5), std({ color: 0xe9e2d4, roughness: 0.9 }));
    scene.add(str);
    // 旗
    const fw = 0.15, fh = 0.19;
    const fg = new THREE.PlaneGeometry(fw, fh, 4, 6);
    const p = fg.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i), py = p.getY(i), t = (fh / 2 - py) / fh; // 0 上 → 1 下
      p.setXYZ(i, px * (1 - t), -t * fh, Math.sin(px * 30) * 0.004 + t * t * 0.01);
    }
    fg.computeVertexNormals();
    const flagMat = std({ map: TX.fabric, bumpMap: TX.fabric, bumpScale: 0.8, roughness: 0.92, side: THREE.DoubleSide });
    const NFl = 11, cols = [0xc9a85f, 0x8fa58a, 0xd39a8f, 0x6e8aa3, 0xe8e0d0, 0xb5745a];
    const flags = new THREE.InstancedMesh(fg, flagMat, NFl);
    const c = new THREE.Color(), r = Base.rng(111);
    for (let i = 0; i < NFl; i++) {
      const xx = lerp(x0 + 0.1, x1 - 0.1, i / (NFl - 1));
      const slope = (yAt(xx + 0.01) - yAt(xx - 0.01)) / 0.02;
      _e.set(-0.06 + (r() - 0.5) * 0.06, (r() - 0.5) * 0.1, Math.atan(slope) * 0.6);
      _q.setFromEuler(_e);
      _m.compose(_v.set(xx, yAt(xx) + 0.004, zW + 0.004), _q, _s.set(1, 1, 1));
      flags.setMatrixAt(i, _m);
      flags.setColorAt(i, c.set(cols[i % cols.length]));
    }
    flags.frustumCulled = false; flags.castShadow = false;
    scene.add(flags);
  }

  // ------------------------------------------------------------ 洗濯かご
  let haloB = null, haloT = null;
  function halo(x, z, size) {
    const m = new THREE.MeshBasicMaterial({ color: 0xffc78a, alphaMap: TX.blob, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    const h = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m);
    h.rotation.x = -Math.PI / 2; h.position.set(x, L.rug.pile * 2 + 0.002, z); h.renderOrder = 3; h.visible = false; scene.add(h);
    return h;
  }
  let basketRimMat = null, basketGlowMat = null, basketGlow = null;
  function buildBasket() {
    const b = L.basket, y = L.rug.pile * 2;
    const grp = new THREE.Group(); grp.position.set(b.x, y, b.z); grp.rotation.y = 0.4;
    const prof = [[0, 0.006], [0.15, 0.006], [0.168, 0.02]];
    for (let i = 1; i <= 14; i++) { const t = i / 14; prof.push([lerp(0.168, b.r - 0.005, t), lerp(0.02, b.h - 0.006, t)]); }
    const wv = std({ map: TX.weave, bumpMap: TX.weave, bumpScale: 1.6, roughness: 0.78, alphaTest: 0.5, side: THREE.DoubleSide, color: 0xfff3e2 });
    const body = new THREE.Mesh(lathe(prof, 56), wv); body.castShadow = true; body.receiveShadow = true; grp.add(body);
    basketRimMat = std({ color: 0xbd9562, map: TX.fabric, roughness: 0.7, emissive: 0xffc98a, emissiveIntensity: 0 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(b.r - 0.004, 0.011, 10, 64), basketRimMat);
    rim.rotation.x = Math.PI / 2; rim.position.y = b.h - 0.004; rim.castShadow = true; grp.add(rim);
    basketGlowMat = new THREE.MeshBasicMaterial({ color: 0xffd7a0, map: TX.glow, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    basketGlow = new THREE.Mesh(lathe([[0, 0.02], [0.14, 0.02], [0.162, 0.03], [b.r - 0.02, b.h - 0.02]], 40), basketGlowMat);
    basketGlow.renderOrder = 3; basketGlow.visible = false; grp.add(basketGlow);
    scene.add(grp);
    haloB = halo(b.x, b.z, b.r * 3.6);
    blobs.push([b.x, L.rug.pile * 2 + 0.0012, b.z, b.r * 2.5, b.r * 2.5, 0.55]);
  }

  // ------------------------------------------------------------ ごみ箱
  let lidGrp = null, pedalGrp = null, lidA = 0, lidT = 0;
  let trashRimMat = null, trashGlowMat = null, trashGlow = null;
  let fillCtx = null, fillTex = null, fillMesh = null, fillLevel = 0.08;
  const FILL0 = 0.22, FILLMAX = 0.345;
  function drawFillBase() {
    const ctx = fillCtx, W = 256, r = Base.rng(121);
    ctx.fillStyle = '#9b948a'; ctx.fillRect(0, 0, W, W);
    for (let i = 0; i < 260; i++) {
      const g = 110 + r() * 110 | 0;
      ctx.fillStyle = `rgba(${g},${g - 6},${g - 14},${0.5 + r() * 0.5})`;
      ctx.save(); ctx.translate(r() * W, r() * W); ctx.rotate(r() * 6.28); ctx.fillRect(-4, -2, 4 + r() * 10, 2 + r() * 5); ctx.restore();
    }
  }
  function buildTrash() {
    const t = L.trash, y = L.rug.pile * 2, R = t.r, H = t.h;
    const grp = new THREE.Group(); grp.position.set(t.x, y, t.z); grp.rotation.y = -0.15;
    const steel = std({ color: 0xd5d6d4, metalness: 1, roughness: 0.3, bumpMap: TX.thread, bumpScale: 0.3 });
    const bodyProf = [[0, 0.012], [R - 0.012, 0.012], [R - 0.004, 0.02], [R, 0.04], [R, H - 0.03], [R - 0.002, H - 0.022], [R - 0.008, H - 0.022], [R - 0.008, 0.04], [0, 0.04]];
    const paint = std({ color: 0xeeece8, roughness: 0.38, metalness: 0 });
    const body = new THREE.Mesh(lathe(bodyProf, 48), paint); body.castShadow = true; body.receiveShadow = true; grp.add(body);
    trashRimMat = std({ color: 0xcfd0ce, metalness: 1, roughness: 0.25, emissive: 0xffc98a, emissiveIntensity: 0 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R - 0.004, 0.005, 8, 56), trashRimMat);
    rim.rotation.x = Math.PI / 2; rim.position.y = H - 0.034; rim.scale.setScalar((R + 0.0015) / (R - 0.004)); grp.add(rim);
    // 黒い樹脂（足のリング・ちょうつがい・ペダル受け）
    const dark = std({ color: 0x2b2d30, roughness: 0.55 });
    const darkG = merge([
      [new THREE.CylinderGeometry(R - 0.002, R - 0.01, 0.014, 40), mtx(0, 0.007, 0)],
      [new THREE.BoxGeometry(0.07, 0.022, 0.018), mtx(0, H - 0.012, -R - 0.004)],
      [new THREE.BoxGeometry(0.06, 0.03, 0.03), mtx(0, 0.03, R - 0.004)],
    ]);
    const darkM = new THREE.Mesh(darkG, dark); darkM.castShadow = true; grp.add(darkM);
    // 内バケツ
    const ib = std({ color: 0x5e6266, roughness: 0.6, side: THREE.DoubleSide });
    const bucket = new THREE.Mesh(lathe([[0, 0.045], [R - 0.024, 0.045], [R - 0.018, 0.06], [R - 0.012, H - 0.04], [R - 0.008, H - 0.032]], 40), ib);
    bucket.receiveShadow = true; grp.add(bucket);
    // ごみの山
    fillTex = Base.canvasTex(256, 256, ctx => { fillCtx = ctx; drawFillBase(); });
    const fg = new THREE.SphereGeometry(R - 0.026, 28, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const fp = fg.attributes.position, fu = fg.attributes.uv, rr = R - 0.026;
    for (let i = 0; i < fp.count; i++) { fu.setXY(i, fp.getX(i) / rr * 0.5 + 0.5, fp.getZ(i) / rr * 0.5 + 0.5); }
    fillMesh = new THREE.Mesh(fg, std({ map: fillTex, roughness: 0.95 }));
    fillMesh.scale.y = 0.25; grp.add(fillMesh);
    setFillLevel(FILL0);
    // 内側の光
    trashGlowMat = new THREE.MeshBasicMaterial({ color: 0xffd7a0, map: TX.glow, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    trashGlow = new THREE.Mesh(lathe([[0, 0.06], [R - 0.03, 0.06], [R - 0.016, H - 0.05]], 36), trashGlowMat);
    trashGlow.renderOrder = 3; trashGlow.visible = false; grp.add(trashGlow);
    // ふた（奥 = -z のちょうつがい）
    lidGrp = new THREE.Group(); lidGrp.position.set(0, H - 0.024, -R + 0.002); grp.add(lidGrp);
    const lid = new THREE.Mesh(lathe([[0, 0.0], [R - 0.01, 0.0], [R - 0.004, -0.005], [R + 0.004, -0.004], [R + 0.003, 0.002], [R - 0.012, 0.01], [0.11, 0.024], [0.06, 0.032], [0, 0.034]], 48), steel);
    lid.material = paint; lid.position.z = R - 0.002; lid.castShadow = true; lidGrp.add(lid);
    // ペダル
    pedalGrp = new THREE.Group(); pedalGrp.position.set(0, 0.03, R + 0.008); grp.add(pedalGrp);
    const pedal = new THREE.Mesh(rbox(0.085, 0.012, 0.055, 0.005, 2), steel);
    pedal.position.set(0, 0.0, 0.026); pedal.rotation.x = 0.08; pedal.castShadow = true; pedalGrp.add(pedal);
    scene.add(grp);
    haloT = halo(t.x, t.z, R * 4.0);
    blobs.push([t.x, L.rug.pile * 2 + 0.0012, t.z, R * 2.6, R * 2.6, 0.55]);
  }
  function setFillLevel(h) {
    fillLevel = clamp(h, FILL0, FILLMAX);
    fillMesh.position.y = fillLevel;
    fillMesh.scale.y = 0.25 + 0.2 * (fillLevel - FILL0) / (FILLMAX - FILL0);
  }
  const fillRnd = Base.rng(131), _fc = new THREE.Color();
  const trash = {
    setLid(o) { lidT = sat(+o || 0); },
    addFill(color) {
      if (!fillCtx) return;
      _fc.setHex((color >>> 0) & 0xffffff);
      const ctx = fillCtx, r = fillRnd;
      for (let i = 0; i < 6; i++) {
        const k = 0.75 + r() * 0.35;
        ctx.fillStyle = `rgb(${clamp(_fc.r * 255 * k, 0, 255) | 0},${clamp(_fc.g * 255 * k, 0, 255) | 0},${clamp(_fc.b * 255 * k, 0, 255) | 0})`;
        const a = r() * 6.28, rad = Math.sqrt(r()) * 118;
        ctx.save(); ctx.translate(128 + Math.cos(a) * rad, 128 + Math.sin(a) * rad); ctx.rotate(r() * 6.28);
        ctx.fillRect(-4, -3, 5 + r() * 9, 3 + r() * 6); ctx.restore();
      }
      fillTex.needsUpdate = true;
      setFillLevel(fillLevel + 0.0004);
    },
    reset() { if (!fillCtx) return; drawFillBase(); fillTex.needsUpdate = true; setFillLevel(FILL0); },
  };

  // ------------------------------------------------------------ くす玉
  const kusu = [];
  let strings = null, fittings = null, streamers = null, bits = null;
  const NSTR = 4, NBIT = 12;
  const bitState = [];
  const PAPER = [0xe25b5b, 0xf2c14e, 0xfaf6ee, 0x6fb38a, 0x6aa3d8, 0xe88fb0];
  function kusuMaterial(i) {
    const col = L.kusu.colors[i];
    const m = i === 0
      ? std({ color: col, metalness: 0.9, roughness: 0.34, bumpMap: TX.crinkle, bumpScale: 3.5, side: THREE.DoubleSide })
      : std({ color: col, map: TX.washi, bumpMap: TX.washi, bumpScale: 1.6, roughness: 0.84, side: THREE.DoubleSide });
    m.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <metalnessmap_fragment>',
        '#include <metalnessmap_fragment>\n if (!gl_FrontFacing) { diffuseColor.rgb = vec3(0.80, 0.78, 0.74); metalnessFactor = 0.0; roughnessFactor = 0.9; }');
    };
    m.customProgramCacheKey = () => 'kusuInner';
    return m;
  }
  function buildKusu() {
    const K = L.kusu, r = K.r, ceil = L.room.ceil;
    const strMat = std({ color: 0xffffff, roughness: 0.85 });
    strings = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1), strMat, 6);
    strings.frustumCulled = false; strings.castShadow = true;
    const fitG = new THREE.CylinderGeometry(0.011, 0.016, 0.014, 14);
    fittings = new THREE.InstancedMesh(fitG, std({ color: 0xc9a86a, metalness: 0.9, roughness: 0.35 }), 6);
    fittings.frustumCulled = false;
    const c = new THREE.Color();
    // 紙テープ（開いたあとにぶら下がる）
    const sg = new THREE.PlaneGeometry(0.013, 1, 1, 14); sg.translate(0, -0.5, 0);
    const sp = sg.attributes.position;
    for (let i = 0; i < sp.count; i++) {
      const yy = sp.getY(i), xx = sp.getX(i), a = -yy * 5.5;
      sp.setXYZ(i, xx * Math.cos(a) + Math.sin(-yy * 9) * 0.006, yy, xx * Math.sin(a) + yy * yy * 0.03);
    }
    sg.computeVertexNormals();
    streamers = new THREE.InstancedMesh(sg, std({ roughness: 0.75, side: THREE.DoubleSide }), 3 * NSTR);
    streamers.frustumCulled = false;
    // こぼれる紙
    bits = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.032, 0.032), std({ roughness: 0.7, side: THREE.DoubleSide }), NBIT);
    bits.frustumCulled = false;
    for (let i = 0; i < NBIT; i++) {
      bitState.push({ on: false, p: new V3(), v: new V3(), age: 0, ph: 0, rx: 0, rz: 0, sx: 0, sz: 0 });
      bits.setColorAt(i, c.set(PAPER[i % PAPER.length]));
      _m.makeScale(0, 0, 0); bits.setMatrixAt(i, _m);
    }
    const rr = Base.rng(141);
    for (let i = 0; i < 3; i++) {
      const x = K.xs[i], z = K.z;
      const pivot = new THREE.Group(); pivot.position.set(x, ceil, z);
      const ball = new THREE.Group(); ball.position.y = -(ceil - K.y); pivot.add(ball);
      const mat = kusuMaterial(i);
      const gL = new THREE.SphereGeometry(r, 40, 26, -Math.PI / 2, Math.PI);
      const gR = new THREE.SphereGeometry(r, 40, 26, Math.PI / 2, Math.PI);
      const hL = new THREE.Group(), hR = new THREE.Group();
      hL.position.y = r; hR.position.y = r; ball.add(hL, hR);
      const mL = new THREE.Mesh(gL, mat), mR = new THREE.Mesh(gR, mat);
      mL.position.set(-0.0008, -r, 0); mR.position.set(0.0008, -r, 0);
      hL.add(mL); hR.add(mR);
      scene.add(pivot);
      const ringMat = std({ color: 0xb08656, roughness: 0.5, emissive: 0xffe0a8, emissiveIntensity: 0 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.029, 0.0062, 12, 40), ringMat);
      ring.castShadow = true; scene.add(ring);
      const tCol = new THREE.Color(K.colors[i]).lerp(new THREE.Color(0xf0e8da), 0.15);
      const tasMat = std({ color: tCol, map: TX.thread, roughness: 0.8, emissive: 0xffe0a8, emissiveIntensity: 0 });
      const tas = new THREE.Mesh(lathe([[0, -0.087], [0.012, -0.086], [0.0155, -0.082], [0.014, -0.06], [0.0105, -0.03], [0.008, -0.021], [0.0065, -0.017], [0.009, -0.01], [0.007, -0.002], [0, 0]], 20), tasMat);
      scene.add(tas);
      for (let k = 0; k < NSTR; k++) streamers.setColorAt(i * NSTR + k, c.set(PAPER[(i * 2 + k) % PAPER.length]));
      strings.setColorAt(i * 2, c.set(0xece6da));
      strings.setColorAt(i * 2 + 1, c.set(0xb8413c));
      const st = {
        pullT: 0, drop: 0, dropV: 0, sink: 0, sinkV: 0, swX: 0, swXV: 0, swZ: 0, swZV: 0,
        rX: 0, rXV: 0, rZ: 0, rZV: 0, open: false, ang: 0, angV: 0, stream: 0, glint: 0, glintT: 0,
        sLen: [0.16 + rr() * 0.1, 0.2 + rr() * 0.1, 0.13 + rr() * 0.08, 0.18 + rr() * 0.1],
        sOff: [rr(), rr(), rr(), rr()].map(v => v * 6.28),
      };
      const k = { i, pivot, ball, hL, hR, ring, ringMat, tas, tasMat, st, center: new V3(), ringC: new V3(), orig: new V3(), ringTop: new V3() };
      k.api = {
        setPull(p) { st.pullT = sat(+p || 0); },
        touch() {
          st.rXV += 1.0 * (rr() < 0.5 ? -1 : 1); st.rZV += 0.8 * (rr() - 0.5);
          st.sinkV += 0.25; st.swXV += 0.12;
          if (!st.open) spawnBits(k, 2 + (rr() < 0.5 ? 1 : 0));
        },
        open() {
          if (st.open) return;
          st.open = true; st.angV = 3.0; st.sinkV -= 0.35; st.swZV += 0.35 * (rr() - 0.5); st.swXV += 0.25;
        },
        isOpen() { return st.open; },
        reset() {
          st.open = false; st.ang = 0; st.angV = 0; st.stream = 0; st.pullT = 0; st.drop = 0; st.dropV = 0;
          st.sink = 0; st.sinkV = 0; st.swX = st.swXV = st.swZ = st.swZV = 0; st.rX = st.rXV = st.rZ = st.rZV = 0; st.glintT = 0;
          poseKusu(k);
        },
        setGlint(a) { st.glintT = sat(+a || 0); },
        getRing(out) { return (out || new V3()).copy(k.ringC); },
        getBall(out) { return (out || new V3()).copy(k.center); },
      };
      kusu.push(k);
    }
    scene.add(strings, fittings, streamers, bits);
    for (const k of kusu) poseKusu(k);
  }
  function setSeg(idx, a, b, rad) {
    _v.subVectors(b, a); const len = _v.length() || 1e-4;
    _q.setFromUnitVectors(UP, _v.multiplyScalar(1 / len));
    _m.compose(_v2.addVectors(a, b).multiplyScalar(0.5), _q, _s.set(rad, len, rad));
    strings.setMatrixAt(idx, _m);
  }
  const RING_R = 0.0352, L0 = (L.kusu.y - L.kusu.r) - (L.kusu.ringY + RING_R);
  function poseKusu(k) {
    const st = k.st, r = L.kusu.r, i = k.i;
    k.pivot.rotation.set(st.swX, 0, st.swZ);
    k.ball.position.y = -(L.room.ceil - L.kusu.y) - st.sink;
    k.hL.rotation.z = -st.ang; k.hR.rotation.z = st.ang;
    k.pivot.updateMatrixWorld(true);
    k.ball.getWorldPosition(k.center);
    // 吊りひも
    k.ball.localToWorld(_v3.set(0, r + 0.012, 0));
    setSeg(i * 2, k.pivot.position, _v3, 0.0015);
    // 金具（天井・球の上）
    _m.compose(_v.copy(k.pivot.position).setY(L.room.ceil - 0.004), _q.identity(), _s.set(1.2, 0.6, 1.2)); fittings.setMatrixAt(i * 2, _m);
    k.pivot.getWorldQuaternion(_q2);
    _m.compose(k.ball.localToWorld(_v.set(0, r + 0.004, 0)), _q2, _s.set(1, 1, 1)); fittings.setMatrixAt(i * 2 + 1, _m);
    // 引きひもと輪
    const of = clamp(st.ang / (75 * D), 0, 1);
    const oy = lerp(-r * 0.96, r * 0.7, of);
    k.ball.localToWorld(k.orig.set(0, oy, 0));
    const len = L0 + st.drop - st.sink + (oy + r * 0.96);
    _e.set(st.rX, 0, st.rZ); _q.setFromEuler(_e);
    _v.set(0, -1, 0).applyQuaternion(_q);
    k.ringTop.copy(k.orig).addScaledVector(_v, len);
    k.ringC.copy(k.ringTop).addScaledVector(_v, RING_R - 0.006);
    setSeg(i * 2 + 1, k.orig, k.ringTop, 0.0019);
    k.ring.position.copy(k.ringC);
    _q2.setFromAxisAngle(UP, 0.35); k.ring.quaternion.copy(_q).multiply(_q2);
    k.tas.position.copy(k.ringC).addScaledVector(_v, RING_R - 0.002);
    _e.set(st.rX * 1.3, 0, st.rZ * 1.3); k.tas.quaternion.setFromEuler(_e);
    // 紙テープ
    for (let s = 0; s < NSTR; s++) {
      const idx = i * NSTR + s;
      if (st.stream < 0.002) { _m.makeScale(0, 0, 0); streamers.setMatrixAt(idx, _m); continue; }
      k.ball.localToWorld(_v.set((s - 1.5) * 0.012, r * 0.62, (s & 1 ? 0.012 : -0.012)));
      const sw = Math.sin(T * (2.1 + s * 0.37) + st.sOff[s]);
      _e.set(sw * 0.12 + st.swX, st.sOff[s], Math.cos(T * 1.7 + st.sOff[s]) * 0.1 + st.swZ); _q.setFromEuler(_e);
      _m.compose(_v, _q, _s.set(1, st.sLen[s] * st.stream, 1));
      streamers.setMatrixAt(idx, _m);
    }
  }
  const SUB = 2;
  function stepKusu(k, dt) {
    const st = k.st;
    st.glint = damp(st.glint, st.glintT, 6, dt);
    const gs = st.glint * Math.sin(T * 2.4 + k.i * 1.3) * 0.07;
    const h = dt / SUB;
    for (let n = 0; n < SUB; n++) {
      st.dropV += (260 * (st.pullT * 0.14 - st.drop) - 9 * st.dropV) * h; st.drop += st.dropV * h;
      st.sinkV += (180 * (st.pullT * 0.025 - st.sink) - 6 * st.sinkV) * h; st.sink += st.sinkV * h;
      st.swXV += (-16 * st.swX - 0.6 * st.swXV) * h; st.swX += st.swXV * h;
      st.swZV += (-16 * st.swZ - 0.6 * st.swZV) * h; st.swZ += st.swZV * h;
      st.rXV += (-18.5 * (st.rX - gs) - 0.75 * st.rXV) * h; st.rX += st.rXV * h;
      st.rZV += (-18.5 * (st.rZ - gs * 0.5) - 0.75 * st.rZV) * h; st.rZ += st.rZV * h;
      if (st.open) { st.angV += (130 * (76 * D - st.ang) - 7.5 * st.angV) * h; st.ang += st.angV * h; }
    }
    st.ang = clamp(st.ang, 0, 92 * D);
    if (st.open) st.stream = Math.min(1, st.stream + dt / 0.45);
    const p = st.glint * (0.55 + 0.45 * Math.sin(T * 5.0 + k.i));
    k.ringMat.emissiveIntensity = p * 0.55; k.tasMat.emissiveIntensity = p * 0.4;
    poseKusu(k);
  }
  function spawnBits(k, n) {
    for (let j = 0, i = 0; i < NBIT && j < n; i++) {
      const b = bitState[i]; if (b.on) continue;
      b.on = true; b.age = 0; b.ph = Math.random() * 6.28;
      k.ball.localToWorld(b.p.set((Math.random() - 0.5) * 0.02, -L.kusu.r * (0.1 + Math.random() * 0.4), L.kusu.r * 0.95));
      b.v.set((Math.random() - 0.5) * 0.15, -0.05, 0.12 + Math.random() * 0.1);
      b.rx = Math.random() * 6; b.rz = Math.random() * 6; b.sx = 3 + Math.random() * 4; b.sz = 2 + Math.random() * 4;
      j++;
    }
  }
  function stepBits(dt) {
    for (let i = 0; i < NBIT; i++) {
      const b = bitState[i];
      if (!b.on) continue;
      b.age += dt;
      b.v.y = damp(b.v.y, -0.42, 2.2, dt);
      b.v.x = damp(b.v.x, Math.sin(T * 4.3 + b.ph) * 0.25, 2, dt);
      b.v.z = damp(b.v.z, Math.cos(T * 3.1 + b.ph) * 0.15, 2, dt);
      b.p.addScaledVector(b.v, dt);
      let sc = 1;
      if (b.p.y < 0.03) { b.p.y = 0.03; b.v.set(0, 0, 0); b.sx = b.sz = 0; }
      if (b.age > 2.6) sc = Math.max(0, 1 - (b.age - 2.6) / 0.5);
      if (sc <= 0) { b.on = false; _m.makeScale(0, 0, 0); bits.setMatrixAt(i, _m); continue; }
      b.rx += b.sx * dt; b.rz += b.sz * dt;
      _e.set(b.rx, b.ph, b.rz); _q.setFromEuler(_e);
      _m.compose(b.p, _q, _s.set(sc, sc, sc)); bits.setMatrixAt(i, _m);
    }
    bits.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------ 接地の影
  function buildBlobs() {
    const m = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: TX.blob, transparent: true, depthWrite: false, opacity: 1,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
    const im = new THREE.InstancedMesh(g, m, blobs.length);
    const c = new THREE.Color();
    blobs.forEach((b, i) => {
      _m.compose(_v.set(b[0], b[1], b[2]), _q.identity(), _s.set(b[3], 1, b[4])); im.setMatrixAt(i, _m);
      im.setColorAt(i, c.setScalar(b[5]));
    });
    // alpha は instanceColor で弱める（色は黒なので掛け算で効かない → 透明度として使う）
    m.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <alphamap_fragment>',
        '#include <alphamap_fragment>\n#ifdef USE_INSTANCING_COLOR\n diffuseColor.a *= vColor.r;\n#endif\n diffuseColor.rgb = vec3(0.0);');
    };
    m.customProgramCacheKey = () => 'roomBlob';
    im.frustumCulled = false; im.renderOrder = 2;
    scene.add(im);
  }

  // ------------------------------------------------------------ 光る・時間
  const glow = { basket: { a: 0, t: 0 }, trash: { a: 0, t: 0 } };
  function setGlow(name, a) { const g = glow[name]; if (g) g.t = sat(+a || 0); }
  const _c1 = new THREE.Color(), _c2 = new THREE.Color();
  const BG_DAY = new THREE.Color(0xe9e4dc), BG_EVE = new THREE.Color(0x4a4048);
  function setTime(t) {
    timeT = sat(+t || 0);
    if (!ready) return;
    const t1 = timeT, ts = smooth(t1);
    sunDirFor(t1);
    sun.color.set(0xfff0dc).lerp(_c1.set(0xff9a4e), ts);
    sun.intensity = lerp(3.2, 1.7, ts);
    hemi.color.set(0xf6f2ec).lerp(_c1.set(0x8f93b4), ts);
    hemi.groundColor.set(0xb9a284).lerp(_c1.set(0x4e3d32), ts);
    hemi.intensity = lerp(0.75, 0.3, ts);
    fillLight.intensity = lerp(0.35, 0.06, ts);
    const lamp = smooth((t1 - 0.25) / 0.75);
    lampLight.intensity = 5.5 * lamp;
    lampShadeMat.emissiveIntensity = 1.1 * lamp;
    bulbMat.emissiveIntensity = 6 * lamp;
    outsideMat.color.setRGB(1, 1, 1).lerp(_c1.setRGB(0.95, 0.55, 0.35), ts);
    if (scene.background && scene.background.isColor) scene.background.copy(BG_DAY).lerp(BG_EVE, ts);
    const ei = lerp(0.8, 0.3, ts);
    for (const m of envMats) m.envMapIntensity = ei;
    ceilEmis.emissiveIntensity = lerp(0.32, 0.06, ts);
    fitShadow();
  }
  function applyQuality() {
    if (!sun) return;
    const q = Base.quality;
    sun.castShadow = !!q.shadows;
    const ms = q.low ? 1024 : 2048;
    if (sun.shadow.mapSize.x !== ms) {
      sun.shadow.mapSize.set(ms, ms);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
  }

  // ------------------------------------------------------------ 公開
  function init(ctx) {
    if (ready) return;
    scene = ctx.scene;
    const n0 = scene.children.length;
    makeTextures();
    scene.background = BG_DAY.clone();
    buildLights();
    buildRoom();
    buildRug();
    buildSofa();
    buildLamp();
    buildPlant();
    buildGarland();
    buildBasket();
    buildTrash();
    buildKusu();
    buildBlobs();
    // 日は窓からしか入らないので、受ける側はすべて影を受ける
    for (let i = n0; i < scene.children.length; i++) scene.children[i].traverse(o => {
      if (o.isMesh && o.material && o.material.isMeshStandardMaterial) o.receiveShadow = true;
    });
    ready = true;
    applyQuality();
    setTime(timeT);
  }
  function update(dt, time) {
    if (!ready) return;
    dt = clamp(+dt || 0, 0, 0.05);
    T = typeof time === 'number' && isFinite(time) ? time : T + dt;
    for (const k of kusu) stepKusu(k, dt);
    strings.instanceMatrix.needsUpdate = true; fittings.instanceMatrix.needsUpdate = true; streamers.instanceMatrix.needsUpdate = true;
    stepBits(dt);
    updateFringe(dt);
    fSuc = 0;
    // ごみ箱のふた
    lidA = damp(lidA, lidT, 7, dt);
    lidGrp.rotation.x = -lidA * 75 * D;
    pedalGrp.rotation.x = lidA * 0.16;
    // 光るヒント
    const pulse = 0.72 + 0.28 * Math.sin(T * Math.PI * 2 / 1.2);
    const gb = glow.basket, gt = glow.trash;
    gb.a = damp(gb.a, gb.t, 5, dt); gt.a = damp(gt.a, gt.t, 5, dt);
    basketGlow.visible = gb.a > 0.003; basketGlowMat.opacity = gb.a * pulse * 0.85; basketRimMat.emissiveIntensity = gb.a * pulse * 2.0; haloB.visible = basketGlow.visible; haloB.material.opacity = gb.a * pulse * 0.35;
    trashGlow.visible = gt.a > 0.003; trashGlowMat.opacity = gt.a * pulse * 0.8; trashRimMat.emissiveIntensity = gt.a * pulse * 2.2; haloT.visible = trashGlow.visible; haloT.material.opacity = gt.a * pulse * 0.35;
  }

  return {
    init, update, paintTrack, setFringe, setGlow, setTime, applyQuality, trash,
    kusu: [0, 1, 2].map(i => ({
      setPull: p => kusu[i] && kusu[i].api.setPull(p),
      touch: () => kusu[i] && kusu[i].api.touch(),
      open: () => kusu[i] && kusu[i].api.open(),
      isOpen: () => !!(kusu[i] && kusu[i].api.isOpen()),
      reset: () => kusu[i] && kusu[i].api.reset(),
      setGlint: a => kusu[i] && kusu[i].api.setGlint(a),
      getRing: out => kusu[i] ? kusu[i].api.getRing(out) : (out || new THREE.Vector3()).set(L.kusu.xs[i], L.kusu.ringY, L.kusu.z),
      getBall: out => kusu[i] ? kusu[i].api.getBall(out) : (out || new THREE.Vector3()).set(L.kusu.xs[i], L.kusu.y, L.kusu.z),
    })),
  };
})();

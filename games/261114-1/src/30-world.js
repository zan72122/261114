/* 30-world.js — 台所の世界（カウンター・壁・こんろ・食卓・照明・環境マップ）と道具の3Dモデル。
   公開: G.world, G.props。依存: THREE(r160), G.util, G.ease。任意: G.foodTex, G.core。
   単位 1=10cm、Y上、天板の上面 y=0。テクスチャはすべて Canvas の手続き生成。 */
(function () {
  'use strict';
  var G = (window.G = window.G || {});
  var U = G.util;
  var PI = Math.PI, TAU = PI * 2;

  function V3(x, y, z) { return new THREE.Vector3(x, y, z); }
  function isLow() { return !!(G.core && G.core.low); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sm(a, b, v) { return U.smooth(a, b, v); }
  function cl01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function hashi(x, y, s) {
    var h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /* ───────────── 材質の登録（環境の強さを夕方に合わせて変えるため） ───────────── */
  var MATS = [];
  var envScale = 1;
  function reg(m, env) {
    m.userData.envBase = env == null ? 1 : env;
    m.envMapIntensity = m.userData.envBase * envScale;
    MATS.push(m);
    return m;
  }
  function std(o, env) { return reg(new THREE.MeshStandardMaterial(o), env); }
  function phys(o, env) { return reg(new THREE.MeshPhysicalMaterial(o), env); }

  /* ───────────── Canvas テクスチャ ───────────── */
  var TX = {};
  function cached(key, fn) { return TX[key] || (TX[key] = fn()); }

  /* fn(u,v,x,y,o): o=[r,g,b, height, rough, alpha]（0..1） */
  function paint(w, h, fn, wantH, wantR) {
    var cc = U.canvas(w, h), cx = cc.getContext('2d'), ci = cx.createImageData(w, h), cd = ci.data;
    var hc, hx, hi, hd, rc, rx, ri, rd;
    if (wantH) { hc = U.canvas(w, h); hx = hc.getContext('2d'); hi = hx.createImageData(w, h); hd = hi.data; }
    if (wantR) { rc = U.canvas(w, h); rx = rc.getContext('2d'); ri = rx.createImageData(w, h); rd = ri.data; }
    var o = [0, 0, 0, 0.5, 0.5, 1], p = 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++, p += 4) {
        o[3] = 0.5; o[4] = 0.5; o[5] = 1;
        fn(x / w, y / h, x, y, o);
        cd[p] = o[0] * 255; cd[p + 1] = o[1] * 255; cd[p + 2] = o[2] * 255; cd[p + 3] = o[5] * 255;
        if (hd) { var hv = o[3] * 255; hd[p] = hd[p + 1] = hd[p + 2] = hv; hd[p + 3] = 255; }
        if (rd) { var rv = o[4] * 255; rd[p] = rd[p + 1] = rd[p + 2] = rv; rd[p + 3] = 255; }
      }
    }
    cx.putImageData(ci, 0, 0);
    if (hd) hx.putImageData(hi, 0, 0);
    if (rd) rx.putImageData(ri, 0, 0);
    return { color: cc, height: hc, rough: rc };
  }
  function tex(canvas, rep, srgb) {
    return U.canvasTex(canvas, { srgb: srgb !== false, repeat: rep || [1, 1], aniso: 8 });
  }

  /* 人工大理石（クオーツ）: ベージュの地に細かな粒と淡い雲・筋 */
  function stoneTex() {
    return cached('stone', function () {
      var S = isLow() ? 512 : 1024, P = 4;
      var r = paint(S, S, function (u, v, x, y, o) {
        var cloud = U.fbm(u * P, v * P, 11, 4, P);
        var cloud2 = U.fbm(u * 2, v * 2, 91, 3, 2);
        var vein = Math.abs(U.fbm(u * 2 + cloud * 0.9, v * 2, 23, 4, 2) - 0.5);
        var vl = sm(0.03, 0.0, vein);
        var g1 = U.noise2(u * S / 2, v * S / 2, 5, S / 2);
        var g2 = U.noise2(u * S / 16, v * S / 16, 8, S / 16);
        var k = 0.95 + (cloud - 0.5) * 0.1 + (cloud2 - 0.5) * 0.07;
        var R = 0.80 * k, Gc = 0.755 * k, B = 0.675 * k, t;
        R -= vl * 0.07; Gc -= vl * 0.07; B -= vl * 0.055;
        if (g1 > 0.72) { t = sm(0.72, 0.82, g1) * 0.4; R = lerp(R, 0.62, t); Gc = lerp(Gc, 0.56, t); B = lerp(B, 0.48, t); }
        else if (g1 < 0.26) { t = sm(0.26, 0.16, g1) * 0.45; R = lerp(R, 0.9, t); Gc = lerp(Gc, 0.88, t); B = lerp(B, 0.83, t); }
        if (g2 > 0.8) { t = sm(0.8, 0.86, g2) * 0.18; R = lerp(R, 0.56, t); Gc = lerp(Gc, 0.52, t); B = lerp(B, 0.46, t); }
        var sp = hashi(x, y, 3);
        if (sp > 0.9965) { R *= 0.62; Gc *= 0.6; B *= 0.58; }
        else if (sp < 0.003) { R = Gc = B = 0.99; }
        o[0] = R; o[1] = Gc; o[2] = B;
        o[4] = 0.26 + (cloud - 0.5) * 0.14 + (g1 > 0.7 ? 0.06 : 0);
      }, false, true);
      return { map: tex(r.color, [0.25, 0.25]), rough: tex(r.rough, [0.25, 0.25], false) };
    });
  }

  /* 白い正方形タイル（4×4枚で1枚のテクスチャ） */
  function tileTex() {
    return cached('tile', function () {
      var S = isLow() ? 256 : 512, N = 4, g = 0.026;
      var r = paint(S, S, function (u, v, x, y, o) {
        var tx = u * N, ty = v * N, ix = Math.floor(tx), iy = Math.floor(ty), fx = tx - ix, fy = ty - iy;
        var d = Math.min(fx, 1 - fx, fy, 1 - fy);
        var tv = hashi(ix, iy, 7), tv2 = hashi(ix, iy, 9);
        var n = U.noise2(u * 64, v * 64, 4, 64);
        if (d < g) {
          var gc = 0.76 + (n - 0.5) * 0.06;
          o[0] = gc; o[1] = gc * 0.99; o[2] = gc * 0.96;
          o[3] = 0.12 + n * 0.05; o[4] = 0.9;
        } else {
          var e = sm(g, g + 0.07, d);
          var wave = U.noise2(u * 12, v * 12, 3, 12);
          var c = 0.925 + (tv - 0.5) * 0.035 + (wave - 0.5) * 0.02;
          o[0] = c; o[1] = c * 0.992; o[2] = c * 0.972;
          o[3] = 0.32 + e * 0.6 + (wave - 0.5) * 0.06;
          o[4] = 0.1 + tv2 * 0.07 + (1 - e) * 0.12;
        }
      }, true, true);
      return {
        map: tex(r.color), rough: tex(r.rough, null, false),
        normal: tex(U.normalFromHeight(r.height, 3.5), null, false)
      };
    });
  }

  /* 木目。P: {seed, light, dark, boards, rings, warp, fiber, plank, gap, pores} */
  function woodPaint(w, h, P) {
    return paint(w, h, function (u, v, x, y, o) {
      var bf = v * P.boards, b = Math.floor(bf), bv = bf - b, bs = P.seed + b * 131;
      var off = hashi(b, 0, bs) * 10, endD = 1;
      if (P.plank) {
        var pu = u * P.plank + hashi(b, 1, P.seed), pi = Math.floor(pu), fu = pu - pi;
        bs += pi * 17; off += hashi(pi, b, 3) * 10; endD = Math.min(fu, 1 - fu) / P.plank;
      }
      var warp = U.fbm(u * 3, bv * 1.2 + b * 2.3, bs, 3, 3);
      var warp2 = U.fbm(u * 6, bv * 2 + b * 5.1, bs + 7, 3, 6);
      var rings = P.cathedral ? Math.abs(bv - 0.35 - hashi(b, 4, P.seed) * 0.3) * P.rings + Math.sin(u * PI * P.cathedral + off) * 1.1 + (warp - 0.5) * P.warp + off
        : bv * P.rings + (warp - 0.5) * P.warp + off;
      var t = rings - Math.floor(rings);
      var lw = Math.pow(t, 2.5) * (1 - sm(0.94, 1.0, t));
      var fib = U.noise2(u * 24, v * h / 1.6, bs + 3);
      var pore = U.noise2(u * 160, v * h / 1.3, bs + 5);
      var pr = P.pores ? sm(0.74, 0.86, pore) * P.pores * (1 - lw) : 0;
      var k = cl01(lw * (P.ringC || 0.6) + (fib - 0.5) * P.fiber + (warp2 - 0.5) * 0.3 + pr * 0.3);
      var L = P.light, D = P.dark;
      var tone = 1 + (hashi(b, 9, P.seed) - 0.5) * (P.boardTone || 0.1);
      o[0] = lerp(L[0], D[0], k) * tone; o[1] = lerp(L[1], D[1], k) * tone; o[2] = lerp(L[2], D[2], k) * tone;
      var hgt = 0.6 - lw * 0.12 - pr * 0.25 + (fib - 0.5) * 0.06;
      var rough = (P.rough || 0.55) + lw * 0.06 + pr * 0.15;
      if (P.gap) {
        var gd = Math.min(bv, 1 - bv) / P.boards;
        var gg = Math.min(gd, endD);
        if (gg < P.gap) { var gk = 1 - gg / P.gap; o[0] *= 1 - 0.55 * gk; o[1] *= 1 - 0.55 * gk; o[2] *= 1 - 0.55 * gk; hgt -= 0.4 * gk; rough += 0.2 * gk; }
      }
      o[3] = hgt; o[4] = rough;
    }, true, true);
  }
  function woodTex(kind) {
    return cached('wood_' + kind, function () {
      var lo = isLow(), P, w, h, ns = 1.2;
      if (kind === 'hinoki') { w = h = lo ? 256 : 512; P = { seed: 3, light: [0.92, 0.84, 0.69], dark: [0.8, 0.68, 0.5], boards: 1, rings: 26, warp: 0.6, fiber: 0.14, rough: 0.7, pores: 0, ringC: 0.5 }; ns = 0.6; }
      else if (kind === 'oak') { w = h = lo ? 512 : 1024; P = { seed: 21, light: [0.71, 0.54, 0.37], dark: [0.47, 0.32, 0.19], boards: 6, rings: 9, warp: 1.8, fiber: 0.22, rough: 0.42, pores: 0.6, gap: 0.0014, boardTone: 0.12, ringC: 0.55, cathedral: 2 }; }
      else if (kind === 'floor') { w = h = lo ? 256 : 512; P = { seed: 41, light: [0.6, 0.43, 0.29], dark: [0.4, 0.27, 0.17], boards: 4, rings: 7, warp: 2.0, fiber: 0.22, rough: 0.5, pores: 0.5, plank: 1, gap: 0.004, boardTone: 0.25 }; }
      else { w = h = lo ? 256 : 512; P = { seed: 63, light: [0.74, 0.62, 0.48], dark: [0.56, 0.43, 0.3], boards: 1, rings: 16, warp: 1.2, fiber: 0.2, rough: 0.55, pores: 0.3, ringC: 0.55 }; }
      var r = woodPaint(w, h, P);
      return { map: tex(r.color), rough: tex(r.rough, null, false), normal: tex(U.normalFromHeight(r.height, ns), null, false) };
    });
  }

  /* ステンレスのヘアライン（u 方向に流れる） */
  function steelTex() {
    return cached('steel', function () {
      var S = 512;
      var r = paint(S, S, function (u, v, x, y, o) {
        var row = hashi(0, y, 5), row2 = hashi(0, y >> 2, 6);
        var n = U.noise2(u * 6, v * 96, 9);
        var l = 0.5 + (row - 0.5) * 0.4 + (row2 - 0.5) * 0.22 + (n - 0.5) * 0.25;
        var c = 0.82 + l * 0.12;
        o[0] = c; o[1] = c; o[2] = c * 1.01;
        o[4] = 0.2 + l * 0.14;
      }, false, true);
      return { map: tex(r.color), rough: tex(r.rough, null, false) };
    });
  }

  /* 打ち粉（アルファ） */
  function flourTex() {
    return cached('flour', function () {
      var S = 256;
      var r = paint(S, S, function (u, v, x, y, o) {
        var f = U.fbm(u * 5, v * 5, 31, 4, 5);
        var d = sm(0.42, 0.75, f);
        var sp = hashi(x, y, 13);
        var a = d * (0.35 + 0.65 * sp) + (sp > 0.985 ? 0.6 : 0);
        o[0] = o[1] = o[2] = cl01(a);
      });
      return tex(r.color, null, false);
    });
  }

  /* 足もとのやわらかい接地影（角丸の箱 SDF） */
  function contactTex(rr) {
    var key = 'contact' + rr.toFixed(2);
    return cached(key, function () {
      var S = 64;
      var r = paint(S, S, function (u, v, x, y, o) {
        var px = u * 2 - 1, py = v * 2 - 1, hb = 0.6, rad = rr * hb;
        var qx = Math.abs(px) - (hb - rad), qy = Math.abs(py) - (hb - rad);
        var mx = Math.max(qx, 0), my = Math.max(qy, 0);
        var sdf = Math.sqrt(mx * mx + my * my) + Math.min(Math.max(qx, qy), 0) - rad;
        var a = 1 - sm(-0.2, 0.38, sdf);
        o[0] = o[1] = o[2] = 0; o[5] = a * a;
      });
      var t = tex(r.color);
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      return t;
    });
  }
  function contact(w, d, rr, opacity) {
    var m = new THREE.Mesh(new THREE.PlaneGeometry(w / 0.6, d / 0.6),
      new THREE.MeshBasicMaterial({ map: contactTex(rr), transparent: true, opacity: opacity == null ? 0.5 : opacity, depthWrite: false }));
    m.rotation.x = -PI / 2;
    m.position.y = 0.0015;
    m.renderOrder = -1;
    m.castShadow = m.receiveShadow = false;
    return m;
  }

  /* 水滴（ふたのくもり用）の法線 */
  function dropletTex() {
    return cached('drops', function () {
      var S = 256, c = U.canvas(S, S), x = c.getContext('2d');
      x.fillStyle = '#000'; x.fillRect(0, 0, S, S);
      var rnd = U.rng(77);
      for (var i = 0; i < 520; i++) {
        var px = rnd() * S, py = rnd() * S, r = 1 + Math.pow(rnd(), 3) * 7;
        for (var ox = -1; ox <= 1; ox++) for (var oy = -1; oy <= 1; oy++) {
          var gx = px + ox * S, gy = py + oy * S;
          if (gx < -r || gy < -r || gx > S + r || gy > S + r) continue;
          var gr = x.createRadialGradient(gx, gy, 0, gx, gy, r);
          gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
          x.fillStyle = gr; x.beginPath(); x.arc(gx, gy, r, 0, TAU); x.fill();
        }
      }
      return { normal: tex(U.normalFromHeight(c, 3), [3, 3], false), alpha: tex(c, [3, 3], false) };
    });
  }

  /* ───────────── 共通の材質 ───────────── */
  function steelMat(rough, env) {
    var t = steelTex();
    return std({ color: 0xdadcdf, metalness: 1, roughness: rough == null ? 1 : rough, map: t.map, roughnessMap: rough == null ? t.rough : null }, env == null ? 1 : env);
  }
  function porcelainMat(color) {
    return phys({ color: color == null ? 0xf3f1ec : color, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 }, 1);
  }
  /* ガラス: 映り込みが強い所ほど不透明に（sRGB 後のブレンドで白飛びしないよう、反射の強さをアルファへ） */
  function glassCompile(sh) {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>',
      'vec3 gC = totalDiffuse * diffuseColor.a + totalSpecular + totalEmissiveRadiance;\n' +
      'float gA = clamp( diffuseColor.a + max( max( totalSpecular.r, totalSpecular.g ), totalSpecular.b ) * 1.3, 0.0, 0.95 );\n' +
      'gl_FragColor = vec4( gC / max( gA, 0.001 ), gA );');
  }
  function glassMat(o) {
    o = o || {};
    var m = phys({
      color: o.color == null ? 0xffffff : o.color, roughness: o.roughness == null ? 0.03 : o.roughness, metalness: 0,
      transparent: true, opacity: o.opacity == null ? 0.07 : o.opacity, side: THREE.DoubleSide, depthWrite: false,
      specularIntensity: 1, ior: 1.5
    }, o.env == null ? 1.3 : o.env);
    m.onBeforeCompile = glassCompile;
    return m;
  }

  /* ───────────── 形の道具 ───────────── */
  function mesh(geo, mat, cast, recv) {
    var m = new THREE.Mesh(geo, mat);
    m.castShadow = cast !== false; m.receiveShadow = recv !== false;
    return m;
  }
  function lathe(pts, segs, phiStart) {
    return new THREE.LatheGeometry(pts.map(function (p) { return new THREE.Vector2(p[0], p[1]); }), segs || 48, phiStart || 0, TAU);
  }
  /* 円弧の点列（(y,z) 平面）。角度 a: z=cz+r cos a, y=cy+r sin a */
  function arcYZ(cy, cz, r, a0, a1, n, out) {
    for (var i = 0; i <= n; i++) { var a = a0 + (a1 - a0) * i / n; out.push([cy + r * Math.sin(a), cz + r * Math.cos(a)]); }
    return out;
  }
  /* 断面 (y,z) を X 方向に掃引。uv は世界単位 (x, 断面の弧長)。法線は断面から解析的に */
  function sweepX(runs, x0, x1) {
    var pos = [], nor = [], uv = [], idx = [];
    runs.forEach(function (run) {
      var n = run.length, s = 0, base = pos.length / 3, i;
      for (i = 0; i < n; i++) {
        var p = run[i], a = run[Math.max(0, i - 1)], b = run[Math.min(n - 1, i + 1)];
        var ty = b[0] - a[0], tz = b[1] - a[1], l = Math.hypot(ty, tz) || 1;
        if (i > 0) s += Math.hypot(p[0] - run[i - 1][0], p[1] - run[i - 1][1]);
        pos.push(x0, p[0], p[1], x1, p[0], p[1]);
        nor.push(0, tz / l, -ty / l, 0, tz / l, -ty / l);
        uv.push(x0, s, x1, s);
      }
      for (i = 0; i < n - 1; i++) {
        var a0 = base + i * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3;
        idx.push(a0, b0, a1, a1, b0, b1);
      }
    });
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }
  /* 断面の端のふた（断面多角形を YZ 面に） */
  function capYZ(run, x, flip) {
    var shape = new THREE.Shape();
    run.forEach(function (p, i) { if (i === 0) shape.moveTo(p[1], p[0]); else shape.lineTo(p[1], p[0]); });
    var g = new THREE.ShapeGeometry(shape);
    g.rotateY(flip ? PI / 2 : -PI / 2);
    if (flip) g.scale(1, 1, -1);
    g.translate(x, 0, 0);
    return g;
  }
  /* 曲線に沿った楕円断面の管。radFn(t)→[幅方向, 厚み方向]。up は断面の「上」 */
  function tubeAlong(pts, radFn, segs, up, caps) {
    var curve = new THREE.CatmullRomCurve3(pts), N = Math.max(8, pts.length * 8), R = segs || 10;
    var pos = [], uv = [], idx = [], i, j;
    var upv = up || V3(0, 1, 0), T = V3(), Nn = V3(), B = V3(), P = V3();
    for (i = 0; i <= N; i++) {
      var t = i / N;
      curve.getPointAt(t, P); curve.getTangentAt(t, T);
      Nn.crossVectors(upv, T); if (Nn.lengthSq() < 1e-6) Nn.set(1, 0, 0); Nn.normalize();
      B.crossVectors(T, Nn).normalize();
      var rr = radFn(t);
      for (j = 0; j <= R; j++) {
        var a = j / R * TAU, c = Math.cos(a), s = Math.sin(a);
        pos.push(P.x + Nn.x * c * rr[0] + B.x * s * rr[1], P.y + Nn.y * c * rr[0] + B.y * s * rr[1], P.z + Nn.z * c * rr[0] + B.z * s * rr[1]);
        uv.push(t, j / R);
      }
    }
    for (i = 0; i < N; i++) for (j = 0; j < R; j++) {
      var a0 = i * (R + 1) + j, a1 = a0 + 1, b0 = a0 + R + 1, b1 = b0 + 1;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
    if (caps !== false) {
      [0, N].forEach(function (ii, k) {
        var p = curve.getPointAt(ii / N), c0 = pos.length / 3;
        pos.push(p.x, p.y, p.z); uv.push(ii / N, 0.5);
        for (j = 0; j < R; j++) {
          var q0 = ii * (R + 1) + j, q1 = q0 + 1;
          if (k === 0) idx.push(c0, q1, q0); else idx.push(c0, q0, q1);
        }
      });
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  /* 角丸長方形の輪郭（XZ） */
  function rrPath(hw, hd, r, n) {
    var out = [], cs = [[hw - r, hd - r, 0], [-hw + r, hd - r, PI / 2], [-hw + r, -hd + r, PI], [hw - r, -hd + r, PI * 1.5]];
    cs.forEach(function (c) { for (var i = 0; i <= n; i++) { var a = c[2] + i / n * PI / 2; out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); } });
    return out;
  }
  /* 角丸長方形の段（levels: [{inset, y}]）を順につないだ壁（両面） */
  function roundedLoft(w, d, rc, levels, n) {
    var rings = levels.map(function (L) { return rrPath(w / 2 - L.inset, d / 2 - L.inset, Math.max(0.01, rc - L.inset), n); });
    var M = rings[0].length, pos = [], uv = [], idx = [], vAcc = 0;
    for (var k = 0; k < rings.length; k++) {
      if (k > 0) vAcc += Math.hypot(levels[k].inset - levels[k - 1].inset, levels[k].y - levels[k - 1].y);
      var uAcc = 0;
      for (var i = 0; i <= M; i++) {
        var p = rings[k][i % M];
        if (i > 0) { var q = rings[k][i - 1]; uAcc += Math.hypot(p[0] - q[0], p[1] - q[1]); }
        pos.push(p[0], levels[k].y, p[1]); uv.push(uAcc, vAcc);
      }
    }
    for (k = 0; k < rings.length - 1; k++) for (i = 0; i < M; i++) {
      var a0 = k * (M + 1) + i, a1 = a0 + 1, b0 = a0 + M + 1, b1 = b0 + 1;
      idx.push(a0, a1, b0, a1, b1, b0);
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  function roundedRectShape(w, d, r) {
    var s = new THREE.Shape(), hw = w / 2, hd = d / 2;
    s.moveTo(-hw + r, -hd); s.lineTo(hw - r, -hd); s.quadraticCurveTo(hw, -hd, hw, -hd + r);
    s.lineTo(hw, hd - r); s.quadraticCurveTo(hw, hd, hw - r, hd); s.lineTo(-hw + r, hd);
    s.quadraticCurveTo(-hw, hd, -hw, hd - r); s.lineTo(-hw, -hd + r); s.quadraticCurveTo(-hw, -hd, -hw + r, -hd);
    return s;
  }
  /* 平らな面（XZ）の角丸板。下面 y=0。uv は世界単位を scale で割った値 */
  function roundedSlab(w, d, h, r, bevel, uvScale) {
    var g = new THREE.ExtrudeGeometry(roundedRectShape(w - bevel * 2, d - bevel * 2, Math.max(0.01, r - bevel)), {
      depth: h - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 6
    });
    g.rotateX(-PI / 2); g.translate(0, bevel, 0);
    g.computeVertexNormals();
    var p = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv, s = uvScale || 1;
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      if (Math.abs(nrm.getY(i)) > 0.6) uv.setXY(i, x / s, z / s);
      else if (Math.abs(nrm.getX(i)) > Math.abs(nrm.getZ(i))) uv.setXY(i, z / s, y / s);
      else uv.setXY(i, x / s, y / s);
    }
    return g;
  }
  /* 箱の uv を世界単位に（木目の向きを揃える） */
  function boxWorldUV(g, s, ox, oy) {
    var p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i) + ox, y = p.getY(i) + oy, z = p.getZ(i);
      if (Math.abs(n.getY(i)) > 0.5) uv.setXY(i, x / s, z / s);
      else if (Math.abs(n.getX(i)) > 0.5) uv.setXY(i, z / s, y / s);
      else uv.setXY(i, x / s, y / s);
    }
    return g;
  }

  /* ───────────── 液面（波紋つき） ───────────── */
  var ANIM = [];
  var clock = { t: 0 };
  function inScene(o) {
    var d = 0;
    while (o && d < 20) { if (!o.visible) return false; if (o.isScene) return true; o = o.parent; d++; }
    return false;
  }
  function liquid(radius, y, mat, idleAmp) {
    var geo = new THREE.RingGeometry(0.0005, radius, 48, 10);
    geo.rotateX(-PI / 2);
    var m = mesh(geo, mat, false, true);
    m.position.y = y;
    var pos = geo.attributes.position, base = new Float32Array(pos.array);
    var ripples = [];
    var amp0 = idleAmp == null ? 0.0012 : idleAmp;
    var dirty = false;
    function step() {
      if (!inScene(m)) return;
      var t = clock.t;
      for (var k = ripples.length - 1; k >= 0; k--) if (t - ripples[k].t0 > 3) ripples.splice(k, 1);
      for (var i = 0; i < pos.count; i++) {
        var x = base[i * 3], z = base[i * 3 + 2], r = Math.hypot(x, z), edge = 1 - sm(radius * 0.8, radius, r);
        var h = amp0 * (Math.sin(x * 9 + t * 1.7) * 0.6 + Math.sin(z * 11 - t * 1.3) * 0.4);
        for (var q = 0; q < ripples.length; q++) {
          var R = ripples[q], age = t - R.t0, dd = Math.hypot(x - R.x, z - R.z), front = age * 0.55;
          var env = Math.exp(-age * 1.6) * Math.exp(-Math.pow((dd - front) / 0.09, 2));
          h += R.amp * env * Math.cos((dd - front) * 55);
        }
        pos.array[i * 3 + 1] = h * edge;
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      dirty = true;
    }
    ANIM.push(step);
    m.userData.ripple = function (x, z, amp) {
      ripples.push({ t0: clock.t, x: x || 0, z: z || 0, amp: amp == null ? 0.012 : amp });
      if (ripples.length > 4) ripples.shift();
    };
    return m;
  }

  /* ───────────── G.props ───────────── */
  var P = (G.props = {});

  P.board = function () {
    var g = new THREE.Group(), W = 2.6, D = 1.55, H = 0.15;
    var t = woodTex('hinoki');
    var mat = std({ map: t.map, roughnessMap: t.rough, normalMap: t.normal, normalScale: new THREE.Vector2(0.4, 0.4), roughness: 1, color: 0xffffff }, 0.6);
    var body = mesh(roundedSlab(W, D, H, 0.1, 0.02, 2.8), mat);
    g.add(body);
    var fl = mesh(new THREE.PlaneGeometry(W - 0.2, D - 0.2), std({ color: 0xfbf8f2, roughness: 0.95, alphaMap: flourTex(), transparent: true, opacity: 0.5, depthWrite: false }, 0.3), false, true);
    fl.rotation.x = -PI / 2; fl.position.y = H + 0.002;
    g.add(fl);
    var c = contact(W, D, 0.15, 0.55); g.add(c);
    g.userData = { w: W, d: D, h: H, topY: H, contact: c };
    return g;
  };

  P.tray = function () {
    var g = new THREE.Group(), W = 3.0, D = 1.0, H = 0.12, rc = 0.1;
    var mat = steelMat(null, 1.0);
    mat.roughness = 1.7;
    mat.side = THREE.DoubleSide;
    var walls = mesh(roundedLoft(W, D, rc, [{ inset: 0.05, y: 0.006 }, { inset: 0.012, y: H - 0.01 }, { inset: 0, y: H }, { inset: -0.014, y: H + 0.004 }, { inset: -0.022, y: H - 0.008 }], 6), mat);
    g.add(walls);
    var fg = new THREE.ShapeGeometry(roundedRectShape(W - 0.1, D - 0.1, rc - 0.05), 6);
    fg.rotateX(-PI / 2); fg.translate(0, 0.006, 0);
    var uv = fg.attributes.uv, p = fg.attributes.position;
    for (var i = 0; i < p.count; i++) uv.setXY(i, p.getX(i), p.getZ(i));
    var floor = mesh(fg, mat);
    g.add(floor);
    var fl = mesh(new THREE.PlaneGeometry(W - 0.2, D - 0.15), std({ color: 0xfbf8f2, roughness: 0.95, alphaMap: flourTex(), transparent: true, opacity: 0.22, depthWrite: false }, 0.3), false, true);
    fl.rotation.x = -PI / 2; fl.position.y = 0.009;
    g.add(fl);
    var c = contact(W, D, 0.2, 0.5); g.add(c);
    var slots = [];
    for (i = 0; i < 6; i++) slots.push(V3(-1.25 + i * 0.5, 0.008, 0));
    g.userData = { w: W, d: D, h: H, floorY: 0.008, rimY: H, slots: slots, contact: c };
    return g;
  };

  function fallbackMound(r, h, seed) {
    var geo = new THREE.SphereGeometry(1, 40, 14, 0, TAU, 0, PI / 2);
    var p = geo.attributes.position;
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      var n = U.fbm(x * 3 + 5, z * 3 + y * 2, seed || 1, 3);
      var k = 1 + (n - 0.5) * 0.25 * (y > 0.02 ? 1 : 0);
      p.setXYZ(i, x * r * k, Math.pow(y, 0.9) * h * k, z * r * k);
    }
    geo.computeVertexNormals();
    var col = [];
    for (i = 0; i < p.count; i++) {
      var nx = p.getX(i) * 40, nz = p.getZ(i) * 40 + p.getY(i) * 30, n1 = U.noise2(nx, nz, 3), n2 = U.noise2(nx * 0.6 + 9, nz * 0.6, 7);
      var c = n2 > 0.68 ? [0.22, 0.42, 0.12] : [0.7 + (n1 - 0.5) * 0.2, 0.47 + (n1 - 0.5) * 0.15, 0.4 + (n1 - 0.5) * 0.1];
      col.push(c[0], c[1], c[2]);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return mesh(geo, cached('fillMatV', function () { return std({ vertexColors: true, roughness: 0.55 }, 0.6); }));
  }
  function fillingMatFallback() {
    return cached('fillMat', function () {
      var r = paint(256, 256, function (u, v, x, y, o) {
        var n = U.noise2(u * 64, v * 64, 3, 64), n2 = U.noise2(u * 24, v * 24, 9, 24);
        var R = 0.72 + (n - 0.5) * 0.2, Gc = 0.5 + (n - 0.5) * 0.15, B = 0.43 + (n - 0.5) * 0.12;
        if (n2 > 0.66) { var t = sm(0.66, 0.72, n2); R = lerp(R, 0.25, t); Gc = lerp(Gc, 0.45, t); B = lerp(B, 0.15, t); }
        o[0] = R; o[1] = Gc; o[2] = B; o[3] = n;
      }, true);
      return std({ map: tex(r.color), normalMap: tex(U.normalFromHeight(r.height, 4), null, false), roughness: 0.5 }, 0.6);
    });
  }
  function mound(r, h, seed) {
    var m = null;
    try { if (G.foodTex && G.foodTex.fillingMound) m = G.foodTex.fillingMound(r, h, seed); } catch (e) { m = null; }
    if (!m) m = fallbackMound(r, h, seed);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function fillingMat() {
    try { if (G.foodTex && G.foodTex.fillingMaterial) return G.foodTex.fillingMaterial(); } catch (e) { /* 代わりを使う */ }
    return fillingMatFallback();
  }

  P.bowl = function () {
    var g = new THREE.Group();
    var pts = [[0, 0], [0.22, 0], [0.26, 0.004], [0.3, 0.02], [0.38, 0.07], [0.45, 0.15], [0.505, 0.26], [0.54, 0.36], [0.552, 0.396],
      [0.562, 0.404], [0.565, 0.412], [0.556, 0.418], [0.545, 0.41], [0.538, 0.396],
      [0.528, 0.36], [0.493, 0.26], [0.438, 0.155], [0.37, 0.08], [0.29, 0.033], [0.25, 0.017], [0.2, 0.013], [0, 0.013]];
    var bm = steelMat(0.14, 1.1);
    g.add(mesh(lathe(pts, 56), bm));
    var fy = 0.2;
    var disc = mesh(new THREE.CircleGeometry(0.47, 40).rotateX(-PI / 2), fillingMat());
    disc.position.y = fy;
    g.add(disc);
    var md = mound(0.43, 0.13, 7);
    md.position.y = fy - 0.005;
    g.add(md);
    var c = contact(1.0, 1.0, 1.0, 0.55); g.add(c);
    g.userData = { r: 0.55, h: 0.4, rimY: 0.41, fillY: fy, fillTop: V3(0, fy + 0.125, 0), mound: md, contact: c };
    return g;
  };

  P.spoon = function () {
    var g = new THREE.Group();
    var m = steelMat(0.12, 1.2);
    m.side = THREE.DoubleSide;
    var bowlGeo = new THREE.SphereGeometry(1, 28, 10, 0, TAU, PI / 2, PI / 2);
    bowlGeo.scale(0.12, 0.055, 0.17);
    g.add(mesh(bowlGeo, m));
    var rim = mesh(new THREE.TorusGeometry(1, 0.05, 6, 40).rotateX(PI / 2), m);
    rim.scale.set(0.12, 0.12, 0.17);
    g.add(rim);
    var hp = [V3(0, 0.004, 0.13), V3(0, 0.03, 0.3), V3(0, 0.1, 0.55), V3(0, 0.17, 0.78), V3(0, 0.2, 0.93)];
    var handle = mesh(tubeAlong(hp, function (t) {
      var w = t < 0.25 ? lerp(0.03, 0.02, t / 0.25) : t < 0.8 ? lerp(0.02, 0.05, (t - 0.25) / 0.55) : lerp(0.05, 0.035, (t - 0.8) / 0.2);
      return [w, 0.011];
    }, 10), m);
    g.add(handle);
    var load = mound(0.095, 0.075, 11);
    load.scale.set(1, 1, 1.3);
    load.position.y = -0.022;
    load.visible = false;
    g.add(load);
    g.userData = {
      length: 1.1, bowlDepth: 0.055, handleEnd: V3(0, 0.2, 0.93), grip: V3(0, 0.17, 0.75), load: 0, loadMesh: load,
      setLoad: function (v) {
        v = cl01(v); g.userData.load = v;
        load.visible = v > 0.01;
        load.scale.set(0.55 + 0.45 * v, Math.max(0.01, v), (0.55 + 0.45 * v) * 1.3);
      }
    };
    return g;
  };

  P.waterDish = function () {
    var g = new THREE.Group();
    var pts = [[0, 0.012], [0.2, 0.012], [0.21, 0.0], [0.245, 0.0], [0.255, 0.018], [0.33, 0.06], [0.385, 0.108], [0.4, 0.12],
      [0.398, 0.127], [0.388, 0.125], [0.32, 0.077], [0.22, 0.036], [0.1, 0.03], [0, 0.03]];
    g.add(mesh(lathe(pts, 48), porcelainMat()));
    var wm = glassMat({ color: 0x55707a, opacity: 0.3, roughness: 0.02, env: 1.8 });
    wm.side = THREE.FrontSide;
    var w = liquid(0.336, 0.086, wm, 0.0008);
    g.add(w);
    var c = contact(0.8, 0.8, 1.0, 0.5); g.add(c);
    g.userData = { r: 0.4, h: 0.12, waterY: 0.086, water: w, contact: c, ripple: function (x, z) { w.userData.ripple(x, z, 0.01); } };
    return g;
  };

  function doughMat() {
    try { if (G.foodTex && G.foodTex.doughMaterial) return G.foodTex.doughMaterial(); } catch (e) { /* 代わり */ }
    return cached('doughMat', function () {
      var r = paint(256, 256, function (u, v, x, y, o) {
        var n = U.fbm(u * 8, v * 8, 5, 3, 8), sp = hashi(x, y, 21);
        var c = 0.93 + (n - 0.5) * 0.05 + (sp > 0.97 ? 0.04 : 0);
        o[0] = c; o[1] = c * 0.975; o[2] = c * 0.92; o[3] = n;
      }, true);
      return std({ map: tex(r.color), normalMap: tex(U.normalFromHeight(r.height, 1.5), null, false), roughness: 0.85 }, 0.5);
    });
  }
  P.wrapperStack = function (n) {
    n = n == null ? 8 : n;
    var g = new THREE.Group(), mat = doughMat(), rnd = U.rng(1234), sheets = [], T = 0.011;
    for (var i = 0; i < n; i++) {
      var geo = new THREE.CylinderGeometry(0.45, 0.45, T, 48, 1);
      var p = geo.attributes.position, ph = rnd() * 10;
      for (var k = 0; k < p.count; k++) {
        var x = p.getX(k), z = p.getZ(k), r = Math.hypot(x, z);
        if (r > 0.3) { var a = Math.atan2(z, x), s = 1 + (U.noise2(Math.cos(a) * 2 + ph, Math.sin(a) * 2, 3) - 0.5) * 0.03; p.setX(k, x * s); p.setZ(k, z * s); }
      }
      geo.computeVertexNormals();
      var m = mesh(geo, mat);
      m.position.set((rnd() - 0.5) * 0.05, T / 2 + i * T, (rnd() - 0.5) * 0.05);
      m.rotation.set((rnd() - 0.5) * 0.02, rnd() * TAU, (rnd() - 0.5) * 0.02);
      g.add(m); sheets.push(m);
    }
    var count = n;
    var c = contact(0.95, 0.95, 1.0, 0.35); g.add(c);
    g.userData = {
      r: 0.45, sheetT: T, max: n, sheets: sheets, contact: c,
      setCount: function (k) { count = Math.max(0, Math.min(n, k | 0)); for (var j = 0; j < n; j++) sheets[j].visible = j < count; c.visible = count > 0; },
      count: function () { return count; },
      topY: function () { return count * T; }
    };
    return g;
  };

  /* 水溶き粉の層（泡と覆う範囲はシェーダで） */
  function panWaterMat() {
    var m = phys({ color: 0xf1eee6, roughness: 0.1, metalness: 0, transparent: true, depthWrite: false, opacity: 1, clearcoat: 0.6, clearcoatRoughness: 0.05 }, 1);
    m.userData.u = { uTime: { value: 0 }, uLevel: { value: 0 } };
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uTime = m.userData.u.uTime; sh.uniforms.uLevel = m.userData.u.uLevel;
      sh.vertexShader = 'varying vec2 vWP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = position.xz;');
      sh.fragmentShader = [
        'uniform float uTime; uniform float uLevel; varying vec2 vWP; float gHH;',
        'float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }',
        'float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x), mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x), f.y); }',
        'vec3 pnArb(vec3 sp, vec3 sn, vec2 dH, float fd){ vec3 sx=dFdx(sp), sy=dFdy(sp); vec3 r1=cross(sy,sn), r2=cross(sn,sx); float det=dot(sx,r1)*fd; vec3 gr=sign(det)*(dH.x*r1+dH.y*r2); return normalize(abs(det)*sn-gr); }',
        'float bubbles(vec2 p, float t, float rate, out float rim){ float h=0.; rim=0.; vec2 c=floor(p), f=fract(p);',
        ' for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 o=vec2(float(i),float(j)); vec2 cc=c+o;',
        '  float r1=h21(cc), r2=h21(cc+17.3), r3=h21(cc+41.7); vec2 ctr=o+vec2(r1,r2)*0.7+0.15;',
        '  float ph=fract(t*(0.5+r3)*rate+r3*7.0); float R=(0.08+0.17*r1)*smoothstep(0.,0.3,ph); float alive=1.-smoothstep(0.72,0.8,ph);',
        '  float on=step(0.45,h21(cc+5.1)); alive*=on; float d=length(f-ctr); h+=sqrt(max(R*R-d*d,0.))*alive;',
        '  float pr=smoothstep(0.78,1.,ph); float rr=R*(1.+pr*1.2); rim+=(1.-smoothstep(0.,0.035,abs(d-rr)))*(1.-pr)*step(0.78,ph)*on; }',
        ' return h; }',
        sh.fragmentShader
      ].join('\n');
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', [
        '#include <color_fragment>',
        'float r01=length(vWP)/1.05;',
        'float nn=vn(vWP*2.4+3.0)*0.6+vn(vWP*6.0)*0.4;',
        'float fld=nn*0.5+r01*0.5;',
        'float thr=smoothstep(0.0,0.75,uLevel)*1.15; float cover=smoothstep(thr, thr-0.08, fld);',
        'float rimv; float bh=bubbles(vWP*7.0, uTime, 0.4+0.8*smoothstep(0.,0.7,uLevel), rimv);',
        'gHH=(bh*0.9+(vn(vWP*11.0+vec2(uTime*0.9,-uTime*0.7))-0.5)*0.05)/7.0;',
        'diffuseColor.rgb=mix(diffuseColor.rgb, vec3(1.0), clamp(rimv*0.5+bh*0.6,0.,1.)*0.3);',
        'diffuseColor.a*=cover*(0.42+0.3*smoothstep(0.0,0.7,uLevel)+0.25*clamp(bh*3.0+rimv,0.,1.))*smoothstep(1.06,1.0,r01);'
      ].join('\n'));
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>',
        '#include <normal_fragment_maps>\nnormal = pnArb(-vViewPosition, normal, vec2(dFdx(gHH), dFdy(gHH))*1.6, faceDirection);');
    };
    return m;
  }

  P.pan = function () {
    var g = new THREE.Group();
    var floorY = 0.035, rimY = 0.455;
    var outer = [[0, 0], [0.95, 0], [1.0, 0.006], [1.04, 0.02], [1.08, 0.06], [1.14, 0.18], [1.19, 0.32], [1.224, 0.44], [1.234, 0.452], [1.232, 0.46], [1.224, 0.463]];
    var inner = [[1.224, 0.463], [1.212, 0.456], [1.18, 0.33], [1.13, 0.2], [1.09, 0.09], [1.066, 0.05], [1.05, floorY]];
    var outM = std({ color: 0x1c1c1f, metalness: 0.5, roughness: 0.48 }, 0.9);
    var speck = cached('panSpeck', function () {
      var r = paint(512, 512, function (u, v, x, y, o) {
        var s = hashi(x, y, 41), n = U.fbm(u * 6, v * 6, 2, 3, 6);
        var c = 0.15 + (s > 0.93 ? 0.12 : 0) + (n - 0.5) * 0.02;
        o[0] = c; o[1] = c; o[2] = c * 1.05;
        var oil = sm(0.35, 0.65, U.fbm(u * 3, v * 3, 17, 4, 3));
        o[4] = 0.32 - oil * 0.22 + (s > 0.93 ? -0.05 : 0);
      }, false, true);
      return { map: tex(r.color), rough: tex(r.rough, null, false) };
    });
    var inM = std({ color: 0xffffff, map: speck.map, metalness: 0.15, roughness: 0.32 }, 1);
    var floorM = std({ color: 0xffffff, map: speck.map, roughnessMap: speck.rough, metalness: 0.15, roughness: 1 }, 1.2);
    g.add(mesh(lathe(outer, 64), outM));
    g.add(mesh(lathe(inner, 64), inM));
    var fl = mesh(new THREE.CircleGeometry(1.052, 64).rotateX(-PI / 2), floorM);
    fl.position.y = floorY;
    g.add(fl);
    /* 柄（ローカル +X に作って -45° 回す → +X+Z 方向） */
    var hg = new THREE.Group();
    var steel = steelMat(0.3, 1);
    var brk = mesh(new THREE.BoxGeometry(0.34, 0.07, 0.13), steel);
    brk.position.set(1.33, 0.37, 0); brk.rotation.z = 0.18;
    hg.add(brk);
    [-0.035, 0.035].forEach(function (z) {
      var rv = mesh(new THREE.SphereGeometry(0.022, 10, 6), steel);
      rv.position.set(1.205, 0.39, z); rv.scale.set(0.5, 1, 1); hg.add(rv);
    });
    var grip = std({ color: 0x0e0e0f, roughness: 0.42, metalness: 0 }, 0.8);
    var hp = [V3(1.42, 0.395, 0), V3(1.75, 0.45, 0), V3(2.15, 0.53, 0), V3(2.5, 0.6, 0)];
    hg.add(mesh(tubeAlong(hp, function (t) { var w = lerp(0.055, 0.075, sm(0, 0.5, t)) - sm(0.85, 1, t) * 0.01; return [w * 0.75, w]; }, 14, V3(0, 0, 1)), grip));
    var ring = mesh(new THREE.TorusGeometry(0.035, 0.012, 6, 16), steel);
    ring.position.set(2.42, 0.585, 0); ring.rotation.x = PI / 2;
    hg.add(ring);
    hg.rotation.y = -PI / 4;
    g.add(hg);
    /* 水溶き粉 */
    var wm = panWaterMat();
    var water = mesh(new THREE.CircleGeometry(1.06, 72).rotateX(-PI / 2), wm, false, false);
    water.position.y = floorY + 0.004;
    water.visible = false;
    water.renderOrder = 2;
    g.add(water);
    var tip = V3(2.5, 0.6, 0).applyAxisAngle(V3(0, 1, 0), -PI / 4);
    g.userData = {
      innerR: 1.05, rimR: 1.22, rimY: rimY, floorY: floorY, handleTip: tip, handleDir: V3(Math.SQRT1_2, 0, Math.SQRT1_2),
      handleGrip: V3(2.0, 0.51, 0).applyAxisAngle(V3(0, 1, 0), -PI / 4), water: water, waterLevel: 0,
      setWater: function (level, time) {
        level = cl01(level || 0);
        g.userData.waterLevel = level;
        water.visible = level > 0.003;
        wm.userData.u.uLevel.value = level;
        wm.userData.u.uTime.value = time == null ? clock.t : time;
        water.position.y = floorY + 0.004 + level * 0.05;
        var s = 1 + (level * 0.05) * 0.05; water.scale.set(s, 1, s);
      }
    };
    return g;
  };

  P.lid = function () {
    var g = new THREE.Group();
    var R0 = 1.2, Hd = 0.27, y0 = 0.04;
    var SR = (R0 * R0 + Hd * Hd) / (2 * Hd), th = Math.asin(R0 / SR);
    var gm = glassMat({ opacity: 0.06, roughness: 0.03, env: 1.5 });
    var drops = dropletTex();
    gm.normalMap = drops.normal; gm.normalScale = new THREE.Vector2(0, 0);
    var dome = mesh(new THREE.SphereGeometry(SR, 64, 12, 0, TAU, 0, th), gm, false, false);
    dome.position.y = y0 + Hd - SR;
    dome.renderOrder = 3;
    g.add(dome);
    var steel = steelMat(0.18, 1.2);
    var band = [[1.19, 0.06], [1.2, 0.0], [1.235, 0.0], [1.245, 0.02], [1.24, 0.05], [1.21, 0.068], [1.19, 0.06]];
    g.add(mesh(lathe(band, 64), steel));
    var knobM = std({ color: 0x111112, roughness: 0.35 }, 0.9);
    var topY = y0 + Hd;
    var washer = mesh(new THREE.CylinderGeometry(0.14, 0.15, 0.02, 24), steel);
    washer.position.y = topY + 0.005; g.add(washer);
    var kp = [[0, 0], [0.09, 0], [0.075, 0.05], [0.07, 0.09], [0.12, 0.13], [0.13, 0.16], [0.11, 0.185], [0.05, 0.2], [0, 0.2]];
    var knob = mesh(lathe(kp, 32), knobM);
    knob.position.y = topY + 0.012; g.add(knob);
    var hx = 0.78, hy = Math.sqrt(SR * SR - hx * hx) + (y0 + Hd - SR);
    var hole = mesh(new THREE.TorusGeometry(0.04, 0.012, 8, 20), steel);
    hole.position.set(hx, hy + 0.004, 0);
    var nrm = V3(hx, hy - (y0 + Hd - SR), 0).normalize();
    hole.quaternion.setFromUnitVectors(V3(0, 0, 1), nrm);
    g.add(hole);
    g.userData = {
      r: 1.22, rimY: 0, knobTop: V3(0, topY + 0.21, 0), knob: knob, fog: 0,
      setFog: function (f) {
        f = cl01(f); g.userData.fog = f;
        gm.opacity = 0.06 + f * 0.42;
        gm.color.setRGB(1, 1, 1);
        gm.roughness = 0.03 + f * 0.25;
        gm.normalScale.set(f * 0.9, f * 0.9);
      }
    };
    return g;
  };

  P.cup = function () {
    var g = new THREE.Group();
    var H = 0.5;
    var pts = [[0, 0], [0.255, 0], [0.272, 0.008], [0.28, 0.03], [0.29, 0.46], [0.296, 0.49], [0.294, 0.503], [0.284, 0.505], [0.278, 0.49], [0.268, 0.05], [0.25, 0.028], [0, 0.026]];
    var geo = lathe(pts, 48, PI / 2);
    var p = geo.attributes.position;
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, -x);
      var k = Math.exp(-Math.pow(a / 0.38, 2)) * sm(0.36, 0.5, y);
      var r = Math.hypot(x, z);
      if (r > 0.01) { var s = (r + k * 0.075) / r; p.setX(i, x * s); p.setZ(i, z * s); p.setY(i, y + k * 0.025); }
    }
    geo.computeVertexNormals();
    var gm = glassMat({ color: 0xeef4f2, opacity: 0.1, roughness: 0.03, env: 1.8 });
    var glass = mesh(geo, gm, false, false);
    glass.renderOrder = 3;
    g.add(glass);
    var hp = [V3(0.285, 0.43, 0), V3(0.43, 0.42, 0), V3(0.46, 0.27, 0), V3(0.42, 0.12, 0), V3(0.285, 0.1, 0)];
    var handle = mesh(tubeAlong(hp, function () { return [0.028, 0.02]; }, 10, V3(0, 0, 1)), gm, false, false);
    handle.renderOrder = 3;
    g.add(handle);
    var tickM = std({ color: 0xc8463c, roughness: 0.6 }, 0.5);
    [0.15, 0.25, 0.35].forEach(function (y, j) {
      var tk = mesh(new THREE.BoxGeometry(j === 1 ? 0.09 : 0.06, 0.009, 0.004), tickM, false, false);
      var r = 0.282 + (y - 0.03) * 0.01 / 0.43 + 0.002;
      tk.position.set(0, y, r);
      g.add(tk);
    });
    var lm = phys({ color: 0xf2efe7, roughness: 0.15, transparent: true, opacity: 0.88, clearcoat: 0.5 }, 0.8);
    var liq = new THREE.Group();
    var lgeo = new THREE.CylinderGeometry(0.262, 0.255, 1, 40, 1, false);
    lgeo.translate(0, 0.5, 0);
    var lmesh = mesh(lgeo, lm, false, false);
    lmesh.renderOrder = 2;
    liq.add(lmesh);
    liq.position.y = 0.028;
    g.add(liq);
    var streamM = phys({ color: 0xf4f1ea, roughness: 0.12, transparent: true, opacity: 0.85 }, 0.8);
    var sgeo = new THREE.CylinderGeometry(0.045, 0.032, 1, 12, 4, true);
    sgeo.translate(0, -0.5, 0);
    var stream = mesh(sgeo, streamM, false, false);
    var spout = V3(-0.37, 0.53, 0);
    stream.position.copy(spout);
    stream.visible = false;
    var _wp = V3(), _q = new THREE.Quaternion(), _s = V3();
    stream.onBeforeRender = function () {
      g.updateMatrixWorld();
      _wp.copy(spout); g.localToWorld(_wp);
      _s.set(1, stream.scale.y, 1);
      stream.matrixWorld.compose(_wp, _q.identity(), _s);
    };
    g.add(stream);
    var level = 0.75;
    function setLevel(v) {
      level = cl01(v);
      liq.visible = level > 0.01;
      liq.scale.y = Math.max(0.001, level * 0.43);
    }
    setLevel(level);
    g.userData = {
      r: 0.28, h: H, spout: spout, stream: stream, handle: V3(0.45, 0.27, 0), liquid: liq,
      pourAxis: V3(0, 0, 1), level: function () { return level }, setLevel: setLevel
    };
    return g;
  };

  P.plate = function () {
    var g = new THREE.Group();
    var pts = [[0, 0.032], [0.5, 0.032], [0.72, 0.03], [0.735, 0.006], [0.745, 0.0], [0.79, 0.0], [0.8, 0.008], [0.815, 0.03], [0.95, 0.07], [1.08, 0.13], [1.18, 0.19], [1.25, 0.225], [1.29, 0.24],
      [1.3, 0.25], [1.292, 0.258], [1.276, 0.255], [1.22, 0.228], [1.12, 0.175], [1.0, 0.115], [0.9, 0.085], [0.8, 0.077], [0.5, 0.075], [0, 0.075]];
    g.add(mesh(lathe(pts, 72), porcelainMat(0xebe9e3)));
    g.userData = { r: 1.3, topY: 0.075, rimY: 0.258 };
    return g;
  };

  function lineTex(key, n, lines, base, lineCol) {
    return cached(key, function () {
      var H = 512, c = U.canvas(4, H), x = c.getContext('2d');
      x.fillStyle = base; x.fillRect(0, 0, 4, H);
      x.fillStyle = lineCol;
      lines.forEach(function (L) {
        var v0 = L[0] / (n - 1), v1 = L[1] / (n - 1);
        x.fillRect(0, (1 - v1) * H, 4, Math.max(1, (v1 - v0) * H));
      });
      var t = tex(c);
      t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
      return t;
    });
  }
  P.smallPlate = function () {
    var g = new THREE.Group();
    var pts = [[0, 0.016], [0.29, 0.016], [0.3, 0.0], [0.34, 0.0], [0.35, 0.016], [0.44, 0.04], [0.52, 0.078], [0.546, 0.094],
      [0.55, 0.1], [0.544, 0.104], [0.532, 0.1], [0.52, 0.094], [0.5, 0.086], [0.43, 0.06], [0.36, 0.048], [0.355, 0.0475], [0.345, 0.047], [0.2, 0.045], [0, 0.045]];
    var t = lineTex('smallPlateLines', pts.length, [[10, 11], [15, 16]], '#f4f2ed', '#24427a');
    var m = phys({ color: 0xffffff, map: t, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 }, 1);
    g.add(mesh(lathe(pts, 56), m));
    g.userData = { r: 0.55, topY: 0.045, rimY: 0.104 };
    return g;
  };

  P.soyDish = function () {
    var g = new THREE.Group();
    var pts = [[0, 0.012], [0.17, 0.012], [0.18, 0.0], [0.215, 0.0], [0.225, 0.015], [0.3, 0.05], [0.35, 0.09], [0.362, 0.1],
      [0.36, 0.106], [0.35, 0.104], [0.3, 0.07], [0.22, 0.04], [0.1, 0.032], [0, 0.032]];
    var t = lineTex('soyDishLines', pts.length, [[7, 8]], '#f4f2ed', '#2c4d86');
    g.add(mesh(lathe(pts, 48), phys({ color: 0xffffff, map: t, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 }, 1)));
    var sm2 = phys({ color: 0x1e0903, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03 }, 1.1);
    var ly = 0.06;
    var s = liquid(0.272, ly, sm2, 0.0005);
    g.add(s);
    var c = contact(0.72, 0.72, 1.0, 0.45); g.add(c);
    g.userData = { r: 0.36, liquidY: ly, liquid: s, contact: c, ripple: function (x, z) { s.userData.ripple(x, z, 0.008); } };
    return g;
  };

  P.chopsticks = function (scale) {
    scale = scale || 1;
    var g = new THREE.Group();
    var t = cached('chopTex', function () {
      var r = paint(512, 8, function (u, v, x, y, o) {
        var n = U.noise2(u * 80, v * 4, 6);
        if (u < 0.27) { var w = 0.72 + (n - 0.5) * 0.08; o[0] = w; o[1] = w * 0.78; o[2] = w * 0.55; o[4] = 0.55; }
        else { var c = 0.2 + (n - 0.5) * 0.03; o[0] = c * 1.25; o[1] = c * 0.45; o[2] = c * 0.3; o[4] = 0.18; }
      }, false, true);
      return { map: tex(r.color), rough: tex(r.rough, null, false) };
    });
    var m = phys({ color: 0xffffff, map: t.map, roughnessMap: t.rough, roughness: 1, clearcoat: 0.7, clearcoatRoughness: 0.15 }, 0.9);
    var L = 2.2 * scale;
    [-0.055, 0.055].forEach(function (z, i) {
      var pts = [V3(-L / 2, 0.022 * scale, z * scale * (i ? 1 : 0.8)), V3(L / 2, 0.034 * scale, z * scale * 1.3)];
      pts.splice(1, 0, pts[0].clone().lerp(pts[1], 0.5));
      var st = mesh(tubeAlong(pts, function (tt) { var r = lerp(0.011, 0.033, Math.pow(tt, 0.8)) * scale; return [r, r]; }, 8), m);
      g.add(st);
    });
    g.userData = { length: L, tip: V3(-L / 2, 0.02 * scale, 0), back: V3(L / 2, 0.03 * scale, 0), dir: V3(-1, 0, 0) };
    return g;
  };

  P.rest = function () {
    var g = new THREE.Group();
    var geo = new THREE.CapsuleGeometry(0.06, 0.32, 6, 14);
    geo.rotateZ(PI / 2);
    var p = geo.attributes.position;
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i), y = p.getY(i);
      var dip = Math.exp(-Math.pow(x / 0.12, 2)) * 0.03;
      p.setY(i, y * 0.85 - (y > 0 ? dip : dip * 0.5));
    }
    geo.computeVertexNormals();
    geo.translate(0, 0.055, 0);
    g.add(mesh(geo, phys({ color: 0x9fb8b0, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 }, 1)));
    g.userData = { length: 0.44, topY: 0.08 };
    return g;
  };

  P.teaCup = function () {
    var g = new THREE.Group();
    var pts = [[0, 0.035], [0.2, 0.035], [0.215, 0.0], [0.26, 0.0], [0.275, 0.03], [0.31, 0.12], [0.33, 0.32], [0.345, 0.58], [0.355, 0.76], [0.352, 0.79],
      [0.34, 0.795], [0.33, 0.77], [0.32, 0.56], [0.305, 0.3], [0.28, 0.13], [0.22, 0.08], [0, 0.07]];
    var n = pts.length;
    var gt = cached('teaGlaze', function () {
      var r = paint(256, 256, function (u, v, x, y, o) {
        var vv = 1 - v, idx = vv * (n - 1);
        var nz = U.fbm(u * 12, vv * 6, 8, 4, 12), sp = hashi(x, y, 4);
        if (idx < 4.1) { var c = 0.72 + (nz - 0.5) * 0.1; o[0] = c; o[1] = c * 0.86; o[2] = c * 0.7; o[4] = 0.8; }
        else {
          var drip = sm(0.4, 0.7, nz) * sm(4.1, 6, idx);
          var R = lerp(0.47, 0.32, drip), Gc = lerp(0.52, 0.4, drip), B = lerp(0.44, 0.33, drip);
          if (idx > 9.5) { R = 0.62; Gc = 0.66; B = 0.56; }
          if (sp > 0.985) { R *= 0.6; Gc *= 0.6; B *= 0.6; }
          o[0] = R; o[1] = Gc; o[2] = B; o[4] = 0.22;
        }
      }, false, true);
      return { map: tex(r.color), rough: tex(r.rough, null, false) };
    });
    g.add(mesh(lathe(pts, 48), phys({ color: 0xffffff, map: gt.map, roughnessMap: gt.rough, roughness: 1, clearcoat: 0.8, clearcoatRoughness: 0.1 }, 1)));
    var tea = phys({ color: 0x8a8a2a, roughness: 0.03, transparent: true, opacity: 0.9, clearcoat: 1 }, 1.2);
    var tm = mesh(new THREE.CircleGeometry(0.322, 40).rotateX(-PI / 2), tea, false, true);
    tm.position.y = 0.6;
    g.add(tm);
    var c = contact(0.62, 0.62, 1.0, 0.45); g.add(c);
    g.userData = { r: 0.355, h: 0.795, liquidY: 0.6, contact: c };
    return g;
  };

  /* ───────────── 環境マップ用の「明るい部屋」 ───────────── */
  var ENV = null;
  function buildEnvScene() {
    var s = new THREE.Scene(), M = {};
    function plane(w, h, pos, rot, key) {
      var mat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.position.copy(pos); m.rotation.set(rot[0], rot[1], rot[2]);
      s.add(m);
      (M[key] = M[key] || []).push(mat);
      return m;
    }
    plane(30, 30, V3(0, -4, 0), [-PI / 2, 0, 0], 'floor');
    plane(30, 30, V3(0, 7, 0), [PI / 2, 0, 0], 'ceil');
    plane(30, 11, V3(0, 1.5, -12), [0, 0, 0], 'wall');
    plane(30, 11, V3(0, 1.5, 12), [0, PI, 0], 'wallB');
    plane(30, 11, V3(12, 1.5, 0), [0, -PI / 2, 0], 'wall');
    plane(30, 11, V3(-12, 1.5, 0), [0, PI / 2, 0], 'wall');
    plane(16, 6.5, V3(-11.9, 2.6, -1), [0, PI / 2, 0], 'win');
    plane(16, 2.0, V3(-11.85, 5.0, -1), [0, PI / 2, 0], 'sky');
    plane(30, 3, V3(0, -2.5, -11.9), [0, 0, 0], 'band');
    plane(30, 3, V3(11.9, -2.5, 0), [0, -PI / 2, 0], 'band');
    plane(30, 3, V3(0, -2.5, 11.9), [0, PI, 0], 'band');
    plane(7, 1.6, V3(1, 6.9, -4.6), [PI / 2, 0, 0], 'lamp');
    plane(30, 2.5, V3(0, 6.8, -9), [PI / 2, 0, 0], 'band');
    plane(30, 4, V3(0, 4.5, -11.9), [0, 0, 0], 'band');
    plane(1.2, 1.2, V3(6, 2.5, 11.8), [0, PI, 0], 'lampB');
    return { scene: s, M: M };
  }
  var MOOD = {
    day: {
      floor: [0.22, 0.15, 0.1], ceil: [0.78, 0.77, 0.75], wall: [0.95, 0.92, 0.86], wallB: [0.9, 0.84, 0.76], band: [0.32, 0.23, 0.15],
      win: [7.5, 7.4, 7.0], sky: [5.0, 5.6, 6.6], lamp: [3.4, 3.35, 3.2], lampB: [0.9, 0.85, 0.8],
      sunCol: [1.0, 0.95, 0.88], sunInt: 1.9, sunDir: [-0.62, 1.0, -0.32], hemiSky: [0.85, 0.9, 1.0], hemiGnd: [0.5, 0.42, 0.34], hemiInt: 0.15,
      env: 0.62, pend: 0, wallLM: 1.0, wallLMCol: [1.0, 0.98, 0.95], exposure: 1
    },
    evening: {
      floor: [0.12, 0.07, 0.04], ceil: [0.55, 0.42, 0.32], wall: [0.5, 0.36, 0.25], wallB: [0.6, 0.42, 0.28], band: [0.2, 0.12, 0.07],
      win: [6.0, 3.0, 1.1], sky: [3.2, 1.6, 0.9], lamp: [2.6, 1.7, 0.9], lampB: [2.0, 1.2, 0.55],
      sunCol: [1.0, 0.74, 0.48], sunInt: 1.6, sunDir: [-0.9, 0.42, -0.2], hemiSky: [1.0, 0.75, 0.55], hemiGnd: [0.35, 0.24, 0.15], hemiInt: 0.1,
      env: 0.45, pend: 1, wallLM: 0.7, wallLMCol: [1.0, 0.72, 0.45], exposure: 1
    }
  };
  function mixMood(k) {
    var a = MOOD.day, b = MOOD.evening, o = {};
    Object.keys(a).forEach(function (key) {
      var x = a[key], y = b[key];
      if (Array.isArray(x)) o[key] = x.map(function (v, i) { return lerp(v, y[i], k); });
      else o[key] = lerp(x, y, k);
    });
    return o;
  }

  /* ───────────── G.world ───────────── */
  var W = (G.world = {
    anchors: { wrap: V3(0, 0, 0), fry: V3(6, 0, 0), eat: V3(14, 0, 0) },
    stove: null, lights: null, group: null
  });
  var S = {};

  W.build = function (scene, renderer) {
    renderer = renderer || (G.core && G.core.renderer);
    var root = new THREE.Group();
    root.name = 'world';
    scene.add(root);
    W.group = root;
    S.scene = scene; S.renderer = renderer;

    if (renderer) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
    }
    if (!scene.background) scene.background = new THREE.Color(0x2a221c);

    /* 環境マップ */
    if (renderer) {
      try {
        ENV = buildEnvScene();
        S.pmrem = new THREE.PMREMGenerator(renderer);
        regenEnv(0);
      } catch (e) { ENV = null; }
    }

    /* 光 */
    var sun = new THREE.DirectionalLight(0xffffff, 2.7);
    sun.castShadow = true;
    var ms = isLow() ? 1024 : 2048;
    sun.shadow.mapSize.set(ms, ms);
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.012;
    sun.shadow.radius = isLow() ? 2 : 3.5;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 60;
    scene.add(sun); scene.add(sun.target);
    var hemi = new THREE.HemisphereLight(0xdde6ff, 0x6b5848, 0.35);
    scene.add(hemi);
    var pend = new THREE.PointLight(0xffb070, 0, 0, 2);
    pend.position.set(14, 7.5, -0.6);
    scene.add(pend);
    var pend2 = new THREE.PointLight(0xffb070, 0, 0, 2);
    pend2.position.set(2.5, 8.5, 0.5);
    scene.add(pend2);
    W.lights = { sun: sun, hemi: hemi, pendant: pend, kitchen: pend2 };
    S.sunDir = V3(-0.62, 1.0, -0.32).normalize();
    S.focus = V3(0, 0, 0); S.focusR = 4;

    buildKitchen(root);
    buildStove(root);
    buildDining(root);

    W.setFocus(W.anchors.wrap, 4);
    S.mood = { k: 0, from: 0, to: 0, dur: 1, el: 1, envK: 0 };
    applyMood(0, true);

    if (G.core && typeof G.core.onUpdate === 'function') {
      S.hooked = true;
      G.core.onUpdate(function (a) { W.update(typeof a === 'number' ? a : (G.core.dt || 1 / 60)); });
    }
    return root;
  };

  function regenEnv(k) {
    if (!ENV || !S.pmrem) return;
    var m = mixMood(k);
    Object.keys(ENV.M).forEach(function (key) {
      var c = m[key]; if (!c) return;
      ENV.M[key].forEach(function (mat) { mat.color.setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace); });
    });
    var rt = S.pmrem.fromScene(ENV.scene, 0.035, 0.1, 100);
    var old = S.envRT;
    S.envRT = rt;
    S.scene.environment = rt.texture;
    W.envMap = rt.texture;
    if (old) old.dispose();
  }

  W.setFocus = function (v, r) {
    var sun = W.lights && W.lights.sun;
    if (!sun) return;
    if (v) S.focus.copy(v);
    if (r) S.focusR = r;
    var R = S.focusR * 1.25;
    sun.target.position.copy(S.focus);
    sun.position.copy(S.focus).addScaledVector(S.sunDir, 25);
    var cam = sun.shadow.camera;
    cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R;
    cam.near = 25 - R * 2.5; cam.far = 25 + R * 2.5;
    cam.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
  };

  function applyMood(k, forceEnv) {
    var m = mixMood(k), L = W.lights;
    L.sun.color.setRGB(m.sunCol[0], m.sunCol[1], m.sunCol[2]);
    L.sun.intensity = m.sunInt;
    S.sunDir.set(m.sunDir[0], m.sunDir[1], m.sunDir[2]).normalize();
    W.setFocus();
    L.hemi.color.setRGB(m.hemiSky[0], m.hemiSky[1], m.hemiSky[2]);
    L.hemi.groundColor.setRGB(m.hemiGnd[0], m.hemiGnd[1], m.hemiGnd[2]);
    L.hemi.intensity = m.hemiInt;
    L.pendant.intensity = m.pend * 45;
    L.kitchen.intensity = m.pend * 25;
    envScale = m.env;
    for (var i = 0; i < MATS.length; i++) MATS[i].envMapIntensity = MATS[i].userData.envBase * envScale;
    if (S.wallMat) {
      S.wallMat.lightMapIntensity = m.wallLM * 1.6;
      S.wallMat.color.setRGB(m.wallLMCol[0], m.wallLMCol[1], m.wallLMCol[2]);
    }
    if (forceEnv || Math.abs(k - S.mood.envK) > 0.14) { S.mood.envK = k; regenEnv(k); }
  }

  W.setMood = function (name, sec) {
    var to = name === 'evening' ? 1 : 0;
    if (!S.mood) return;
    S.mood.from = S.mood.k; S.mood.to = to; S.mood.el = 0;
    S.mood.dur = sec == null ? 2 : sec;
    if (S.mood.dur <= 0) { S.mood.k = to; S.mood.el = 1; applyMood(to, true); }
  };

  W.update = function (dt) {
    dt = Math.min(0.1, Math.max(0, dt || 0));
    clock.t += dt;
    var md = S.mood;
    if (md && md.el < 1) {
      md.el = Math.min(1, md.el + dt / Math.max(0.001, md.dur));
      var e = G.ease && G.ease.inOutQuad ? G.ease.inOutQuad(md.el) : md.el;
      md.k = lerp(md.from, md.to, e);
      applyMood(md.k, md.el >= 1);
    }
    if (S.flame) S.flame.update(dt);
    for (var i = 0; i < ANIM.length; i++) ANIM[i](dt);
  };
  W.time = function () { return clock.t; };

  /* ───────────── 台所 ───────────── */
  var CX0 = -7.5, CX1 = 9.7;
  function buildKitchen(root) {
    var st = stoneTex();
    var stoneM = std({ map: st.map, roughnessMap: st.rough, roughness: 1, color: 0xffffff }, 0.9);
    /* 天板（手前の縁は丸い面取り） */
    var r1 = 0.1, r2 = 0.035, T = 0.4, Z = 2.6;
    var run = [[0, -2.6]];
    arcYZ(-r1, Z - r1, r1, PI / 2, 0, 8, run);
    arcYZ(-T + r2, Z - r2, r2, 0, -PI / 2, 4, run);
    run.push([-T, 2.3]);
    var top = mesh(sweepX([run], CX0, CX1), stoneM);
    root.add(top);
    var capRun = run.concat([[-T, -2.6]]);
    root.add(mesh(capYZ(capRun, CX0, false), stoneM));
    root.add(mesh(capYZ(capRun, CX1, true), stoneM));

    /* 下の収納（木の前板＋取っ手） */
    var cw = woodTex('cab');
    var cabM = std({ map: cw.map, roughnessMap: cw.rough, normalMap: cw.normal, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 1 }, 0.7);
    var carc = mesh(new THREE.BoxGeometry(CX1 - CX0, 8.0, 4.9), std({ color: 0x1b1612, roughness: 0.9 }, 0.3), false, true);
    carc.position.set((CX0 + CX1) / 2, -4.4, -0.1);
    root.add(carc);
    var handleM = steelMat(0.25, 1);
    var mods = [[CX0, -2.4], [-2.4, 2.4], [2.4, 4.1], [4.1, 7.9], [7.9, CX1]];
    var rows = [[-0.46, -1.85], [-1.885, -4.9], [-4.935, -8.42]];
    var gap = 0.035, fz = 2.47;
    mods.forEach(function (md, mi) {
      rows.forEach(function (rw, ri) {
        var w = md[1] - md[0] - gap, h = rw[0] - rw[1], cx = (md[0] + md[1]) / 2, cy = (rw[0] + rw[1]) / 2;
        if (mi === 3 && ri === 0) {
          /* こんろの下: 魚焼きグリルの扉（黒いガラス） */
          var gd = mesh(new THREE.BoxGeometry(w, h, 0.14), phys({ color: 0x0b0b0c, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03 }, 1));
          gd.position.set(cx, cy, fz - 0.07);
          root.add(gd);
          var gh = mesh(new THREE.BoxGeometry(w * 0.55, 0.12, 0.1), steelMat(0.3, 1));
          gh.position.set(cx, rw[0] - 0.2, fz + 0.05);
          root.add(gh);
          return;
        }
        var geo = new THREE.BoxGeometry(w, h, 0.16);
        boxWorldUV(geo, 4, cx + mi * 1.7, cy + ri * 2.3);
        var f = mesh(geo, cabM);
        f.position.set(cx, cy, fz - 0.08);
        root.add(f);
        var hl = Math.min(2.2, w * 0.55), hy = rw[0] - 0.36;
        var bar = mesh(new THREE.CylinderGeometry(0.05, 0.05, hl, 12).rotateZ(PI / 2), handleM);
        bar.position.set(cx, hy, fz + 0.25);
        root.add(bar);
        [-1, 1].forEach(function (s) {
          var post = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.26, 10).rotateX(PI / 2), handleM);
          post.position.set(cx + s * (hl / 2 - 0.12), hy, fz + 0.12);
          root.add(post);
        });
      });
    });
    var kick = mesh(new THREE.BoxGeometry(CX1 - CX0, 0.6, 0.1), std({ color: 0x15110e, roughness: 0.8 }, 0.3), false, true);
    kick.position.set((CX0 + CX1) / 2, -8.7, 1.95);
    root.add(kick);

    /* 床 */
    var fw = woodTex('floor');
    var floorM = std({ map: fw.map, roughnessMap: fw.rough, normalMap: fw.normal, roughness: 1 }, 0.6);
    [fw.map, fw.rough, fw.normal].forEach(function (t) { t.repeat.set(1 / 4.8, 1 / 4.8); });
    var fg = new THREE.PlaneGeometry(CX1 - CX0 + 2.5, 15);
    fg.rotateX(-PI / 2);
    var fl = mesh(fg, floorM, false, true);
    fl.position.set((CX0 + CX1) / 2 - 1.25, -9, 4.9);
    worldUVxz(fg, fl.position);
    root.add(fl);

    /* 壁（白いタイル、窓の光のグラデーションは lightMap で） */
    var tt = tileTex();
    var lm = cached('wallLM', function () {
      var r = paint(128, 64, function (u, v, x, y, o) {
        var X = lerp(-10, CX1, u), Y = lerp(9, 0, v);
        var b = 0.55 + 0.45 * Math.exp(-Math.pow((X + 9) / 11, 2)) + 0.12 * sm(0, 6, Y);
        b *= 1 - 0.28 * Math.exp(-Y / 0.35);
        b *= 1 - 0.12 * Math.exp(-Math.pow((Y - 3.2) / 0.5, 2)) * (X > -3.9 && X < -0.3 ? 1 : 0) * sm(4.4, 4.0, Y);
        o[0] = b; o[1] = b * 0.985; o[2] = b * 0.96;
      });
      var t = tex(r.color); t.channel = 1;
      return t;
    });
    var wallM = std({ map: tt.map, roughnessMap: tt.rough, normalMap: tt.normal, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 1, lightMap: lm, lightMapIntensity: 1.6 }, 0.8);
    S.wallMat = wallM;
    var WX0 = -10, WH = 9;
    var wg = new THREE.PlaneGeometry(CX1 - WX0, WH, 1, 1);
    var wall = mesh(wg, wallM, false, true);
    wall.position.set((WX0 + CX1) / 2, WH / 2, -2.6);
    var uv = wg.attributes.uv, p = wg.attributes.position, uv1 = [];
    for (var i = 0; i < p.count; i++) {
      uv1.push(uv.getX(i), uv.getY(i));
      uv.setXY(i, (p.getX(i) + wall.position.x) / 4, (p.getY(i) + wall.position.y) / 4);
    }
    wg.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
    root.add(wall);
    var caulk = mesh(new THREE.CylinderGeometry(0.03, 0.03, CX1 - CX0, 6).rotateZ(PI / 2), std({ color: 0xe9e6df, roughness: 0.4 }, 0.6), false, true);
    caulk.position.set((CX0 + CX1) / 2, 0.0, -2.6);
    root.add(caulk);
    /* 左の窓側の壁（部屋の奥行き） */
    var side = mesh(new THREE.PlaneGeometry(18, 18), std({ color: 0xe8e0d4, roughness: 0.9 }, 0.5), false, true);
    side.rotation.y = PI / 2; side.position.set(WX0, 0, 6.4);
    root.add(side);

    buildKitchenDecor(root, cabM);
  }
  function worldUVxz(geo, off) {
    var p = geo.attributes.position, uv = geo.attributes.uv;
    for (var i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) + off.x, -(p.getZ(i) + off.z));
  }

  function canister(h, r, bodyMat, lidMat) {
    var g = new THREE.Group();
    var pts = [[0, 0], [r - 0.03, 0], [r, 0.03], [r, h - 0.05], [r - 0.02, h - 0.02], [r - 0.06, h - 0.02]];
    g.add(mesh(lathe(pts, 40), bodyMat));
    var lid = mesh(new THREE.CylinderGeometry(r + 0.01, r + 0.01, 0.16, 40), lidMat);
    lid.position.y = h + 0.03;
    g.add(lid);
    g.add(contact(r * 2, r * 2, 1, 0.5));
    return g;
  }
  function buildKitchenDecor(root0, woodM) {
    var root = new THREE.Group();
    root0.add(root);
    var porc = porcelainMat(0xf0ede6);
    var hw = woodTex('hinoki');
    var lidW = std({ map: hw.map, roughness: 0.6 }, 0.5);
    /* wrap の奥: 白い陶器のキャニスター */
    var c1 = canister(0.95, 0.34, porc, lidW);
    c1.position.set(-2.45, 0, -2.12);
    root.add(c1);
    var c2 = canister(0.7, 0.26, porc, lidW);
    c2.position.set(-3.15, 0, -2.2);
    root.add(c2);
    /* 木の棚板と瓶 */
    var shelf = mesh(new THREE.BoxGeometry(3.6, 0.22, 1.3), woodM);
    boxWorldUV(shelf.geometry, 4, 1.3, 0.4);
    shelf.position.set(-2.1, 4.45, -1.95);
    root.add(shelf);
    var brM = std({ color: 0x1a1a1a, roughness: 0.5, metalness: 0.6 }, 0.6);
    [-3.4, -0.8].forEach(function (x) {
      var b = mesh(new THREE.BoxGeometry(0.08, 0.7, 0.08), brM); b.position.set(x, 4.0, -2.55); root.add(b);
      var b2 = mesh(new THREE.BoxGeometry(0.08, 0.08, 1.0), brM); b2.position.set(x, 4.3, -2.1); root.add(b2);
    });
    var jar = new THREE.Group();
    var jg = glassMat({ opacity: 0.06, env: 1.3 });
    jar.add(mesh(lathe([[0, 0], [0.3, 0], [0.32, 0.03], [0.32, 0.9], [0.27, 0.98], [0.2, 1.0], [0.19, 1.05]], 32), jg, false, false));
    var beans = cached('beans', function () {
      var r = paint(256, 256, function (u, v, x, y, o) {
        var cx = u * 24, cy = v * 24, ix = Math.floor(cx), iy = Math.floor(cy);
        var n = hashi(ix, iy, 2), d = Math.hypot(cx - ix - 0.5, cy - iy - 0.5);
        var k = 0.55 + n * 0.25 - d * 0.5;
        o[0] = 0.55 * k; o[1] = 0.12 * k; o[2] = 0.1 * k; o[3] = 1 - d;
      }, true);
      return { map: tex(r.color), normal: tex(U.normalFromHeight(r.height, 3), null, false) };
    });
    var bm = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.62, 32), std({ map: beans.map, normalMap: beans.normal, roughness: 0.4 }, 0.6), false, true);
    bm.position.y = 0.33; jar.add(bm);
    var jl = mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.14, 32), lidW); jl.position.y = 1.08; jar.add(jl);
    jar.position.set(-1.35, 4.56, -1.95);
    root.add(jar);
    var bowlS = new THREE.Group();
    for (var i = 0; i < 2; i++) {
      var b = mesh(lathe([[0, 0], [0.18, 0], [0.2, 0.02], [0.35, 0.12], [0.43, 0.24], [0.42, 0.25], [0.33, 0.14], [0.18, 0.05], [0, 0.045]], 40), porc);
      b.position.y = i * 0.07; bowlS.add(b);
    }
    bowlS.position.set(-2.6, 4.56, -1.95);
    root.add(bowlS);
    var c3 = canister(0.6, 0.24, phys({ color: 0x3b4f6e, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 }, 1), lidW);
    c3.position.set(-3.25, 4.56, -2.0);
    root.add(c3);

    /* 掛かったおたま（レール） */
    var steel = steelMat(0.18, 1.1);
    var rail = mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.6, 10).rotateZ(PI / 2), steel);
    rail.position.set(2.4, 4.6, -2.25);
    root.add(rail);
    [0.8, 4.0].forEach(function (x) { var b = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.35, 10).rotateX(PI / 2), steel); b.position.set(x, 4.6, -2.42); root.add(b); });
    var lad = new THREE.Group();
    lad.add(mesh(tubeAlong([V3(0, 4.62, -2.2), V3(0, 4.45, -2.12), V3(0, 3.0, -2.2), V3(0, 1.95, -2.25)], function (t) { return [lerp(0.04, 0.025, t), 0.01]; }, 8, V3(0, 0, 1)), steel));
    var lb = new THREE.SphereGeometry(0.34, 28, 12, 0, TAU, PI / 2, PI / 2);
    var lbm = steelMat(0.12, 1.2); lbm.side = THREE.DoubleSide;
    var lbowl = mesh(lb, lbm);
    lbowl.rotation.x = -PI / 2 + 0.25;
    lbowl.position.set(0, 1.72, -2.12);
    lad.add(lbowl);
    lad.position.x = 1.6;
    root.add(lad);
    var spat = new THREE.Group();
    spat.add(mesh(tubeAlong([V3(0, 4.62, -2.2), V3(0, 4.4, -2.15), V3(0, 2.5, -2.25)], function () { return [0.04, 0.025]; }, 8, V3(0, 0, 1)), std({ map: hw.map, roughness: 0.6, color: 0xc8a882 }, 0.5)));
    var blade = mesh(new THREE.BoxGeometry(0.34, 0.75, 0.04), std({ map: hw.map, roughness: 0.6, color: 0xc8a882 }, 0.5));
    blade.position.set(0, 2.15, -2.26);
    spat.add(blade);
    spat.position.x = 2.5;
    root.add(spat);

    /* fry の左奥: 木べら立て。右奥: 油のびん */
    var crock = new THREE.Group();
    crock.add(mesh(lathe([[0, 0], [0.32, 0], [0.36, 0.05], [0.38, 0.6], [0.36, 0.95], [0.34, 0.95], [0.35, 0.6], [0.33, 0.1], [0, 0.08]], 36), phys({ color: 0x7c6a58, roughness: 0.35, clearcoat: 0.8 }, 1)));
    [[-0.1, 0.05, 0.12], [0.1, -0.06, -0.1], [0.02, 0.1, 0.02]].forEach(function (q, k) {
      var s = mesh(tubeAlong([V3(q[0] * 0.5, 0.1, q[1] * 0.5), V3(q[0] * 2, 1.9 + k * 0.12, q[1] * 2)], function () { return [0.04, 0.02]; }, 8, V3(0, 0, 1)), lidW);
      crock.add(s);
    });
    crock.add(contact(0.76, 0.76, 1, 0.5));
    crock.position.set(3.5, 0, -2.05);
    root.add(crock);
    var bottle = new THREE.Group();
    var bg = glassMat({ color: 0xffffff, opacity: 0.08, env: 1.3 });
    bottle.add(mesh(lathe([[0, 0], [0.22, 0], [0.24, 0.03], [0.24, 1.1], [0.16, 1.3], [0.08, 1.4], [0.08, 1.62]], 32), bg, false, false));
    var oil = mesh(lathe([[0, 0.02], [0.225, 0.02], [0.225, 1.0], [0.0, 1.0]], 32), phys({ color: 0xc89a2a, roughness: 0.05, transparent: true, opacity: 0.75 }, 1), false, false);
    oil.renderOrder = -0.5;
    bottle.add(oil);
    var cap = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.14, 20), std({ color: 0xa8231c, roughness: 0.4 }, 0.6)); cap.position.y = 1.68; bottle.add(cap);
    bottle.add(contact(0.48, 0.48, 1, 0.45));
    bottle.position.set(8.35, 0, -2.15);
    root.add(bottle);
    var salt = canister(0.55, 0.22, porc, lidW);
    salt.position.set(8.95, 0, -1.85);
    root.add(salt);
    /* 壁の上の物は影を落とさない（調理台に大きな影を作らないため） */
    root.updateMatrixWorld(true);
    var c = V3();
    root.traverse(function (o) {
      if (!o.isMesh) return;
      o.geometry.computeBoundingSphere();
      c.copy(o.geometry.boundingSphere.center).applyMatrix4(o.matrixWorld);
      if (c.y > 1.3) o.castShadow = false;
    });
  }

  /* ───────────── こんろ ───────────── */
  function buildStove(root) {
    var A = W.anchors.fry;
    var g = new THREE.Group();
    g.position.copy(A);
    root.add(g);
    var X0 = -1.7, X1 = 1.5, Z0 = -2.1, Z1 = 1.45, GW = X1 - X0, GD = Z1 - Z0, GY = 0.012;
    var BX = -0.25, BZ = -0.7;
    var print = cached('stovePrint', function () {
      var S2 = isLow() ? 512 : 1024;
      var r = paint(S2, Math.round(S2 * GD / GW), function (u, v, x, y, o) {
        var X = X0 + u * GW, Z = Z0 + v * GD;
        var c = 0.022;
        var fx = X / 0.05 - Math.floor(X / 0.05) - 0.5, fz = Z / 0.05 - Math.floor(Z / 0.05) - 0.5;
        if (fx * fx + fz * fz < 0.04) c += 0.035;
        var dr = Math.hypot(X - BX, Z - BZ);
        if (Math.abs(dr - 1.2) < 0.008) c = 0.28;
        var kx = X + 0.9, kz = Z - 1.15, kr = Math.hypot(kx, kz);
        if (Math.abs(kr - 0.3) < 0.007 && Math.atan2(kx, -kz) > -1.6 && Math.atan2(kx, -kz) < 1.6) c = 0.35;
        if (Math.abs(Z - 0.75) < 0.006 && X > -1.55 && X < 1.35) c = 0.12;
        [[0.2, 1.1], [0.45, 1.1], [0.7, 1.1]].forEach(function (q) { if (Math.hypot(X - q[0], Z - q[1]) < 0.045) c = q[0] === 0.2 ? 0.18 : 0.12; });
        o[0] = c; o[1] = c; o[2] = c * 1.05;
      });
      return tex(r.color);
    });
    var glassM = phys({ color: 0xffffff, map: print, roughness: 0.07, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03 }, 1);
    var gtop = mesh(new THREE.PlaneGeometry(GW, GD).rotateX(-PI / 2), glassM, false, true);
    gtop.position.set((X0 + X1) / 2, GY, (Z0 + Z1) / 2);
    g.add(gtop);
    var frameM = steelMat(0.22, 1.1);
    var fw = 0.05, fh = 0.022;
    [[X0 - fw / 2, (Z0 + Z1) / 2, fw, GD + fw * 2], [X1 + fw / 2, (Z0 + Z1) / 2, fw, GD + fw * 2], [(X0 + X1) / 2, Z0 - fw / 2, GW, fw], [(X0 + X1) / 2, Z1 + fw / 2, GW, fw]].forEach(function (q) {
      var b = mesh(new THREE.BoxGeometry(q[2], fh, q[3]), frameM, false, true);
      b.position.set(q[0], fh / 2, q[1]);
      g.add(b);
    });
    /* バーナー */
    var bg = new THREE.Group();
    bg.position.set(BX, 0, BZ);
    g.add(bg);
    var alu = std({ color: 0xb9bbbd, metalness: 1, roughness: 0.42 }, 1);
    bg.add(mesh(lathe([[0.3, GY - 0.004], [0.58, GY + 0.002], [0.64, GY + 0.014], [0.655, GY + 0.01], [0.655, GY]], 48), steelMat(0.25, 1)));
    var crown = lathe([[0, 0.012], [0.3, 0.012], [0.36, 0.02], [0.385, 0.04], [0.38, 0.058], [0.33, 0.066], [0.26, 0.068], [0, 0.068]], 40);
    bg.add(mesh(crown, alu));
    var capM = std({ color: 0x141414, roughness: 0.45, metalness: 0.3 }, 0.8);
    var bcap = mesh(new THREE.CylinderGeometry(0.25, 0.26, 0.02, 36), capM);
    bcap.position.y = 0.078; bg.add(bcap);
    var sensor = mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.045, 18), alu);
    sensor.position.y = 0.105; bg.add(sensor);
    /* 五徳（黒い鋳物） */
    var iron = std({ color: 0x151414, roughness: 0.72, metalness: 0.4 }, 0.6);
    var ring = mesh(new THREE.TorusGeometry(0.98, 0.035, 8, 64).rotateX(PI / 2), iron);
    ring.position.y = GY + 0.025;
    bg.add(ring);
    for (var i = 0; i < 5; i++) {
      var a = i / 5 * TAU + 0.3;
      var claw = new THREE.Shape();
      claw.moveTo(0, 0); claw.lineTo(0.48, 0); claw.lineTo(0.48, 0.11 - GY); claw.lineTo(0.06, 0.12 - GY); claw.lineTo(0.0, 0.07);
      var cg = new THREE.ExtrudeGeometry(claw, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1 });
      cg.translate(0, 0, -0.02);
      var cm = mesh(cg, iron);
      cm.position.set(Math.cos(a) * 0.53, GY, Math.sin(a) * 0.53);
      cm.rotation.y = -a;
      bg.add(cm);
    }
    /* 炎 */
    S.flame = makeFlames(bg, GY);
    /* つまみ */
    var knob = new THREE.Group();
    knob.position.set(-0.9, GY, 1.15);
    g.add(knob);
    var kb = std({ color: 0x2a2b2e, roughness: 0.38, metalness: 0.2 }, 0.9);
    var body = mesh(lathe([[0, 0], [0.22, 0], [0.225, 0.01], [0.22, 0.13], [0.2, 0.165], [0.17, 0.18], [0, 0.18]], 40), kb);
    knob.add(body);
    var chrome = mesh(new THREE.TorusGeometry(0.218, 0.012, 6, 40).rotateX(PI / 2), steelMat(0.12, 1.2));
    chrome.position.y = 0.02;
    knob.add(chrome);
    var fin = mesh(new THREE.BoxGeometry(0.075, 0.08, 0.36), kb);
    fin.position.y = 0.2;
    knob.add(fin);
    var mark = mesh(new THREE.BoxGeometry(0.022, 0.006, 0.13), std({ color: 0xf0eee8, roughness: 0.5 }, 0.5), false, false);
    mark.position.set(0, 0.242, -0.1);
    knob.add(mark);
    var markTop = mesh(new THREE.BoxGeometry(0.03, 0.01, 0.03), std({ color: 0xe03c2c, roughness: 0.5 }, 0.5), false, false);
    markTop.position.set(0, 0.242, -0.16);
    knob.add(markTop);
    g.updateMatrixWorld(true);
    W.stove = {
      group: g, knob: knob, glassY: GY,
      knobPos: knob.getWorldPosition(V3()).add(V3(0, 0.12, 0)),
      burnerPos: bg.getWorldPosition(V3()).add(V3(0, 0.12, 0)),
      flame: 0,
      setFlame: function (v) { W.stove.flame = cl01(v); S.flame.set(W.stove.flame); }
    };
  }

  function makeFlames(parent, GY) {
    var N = isLow() ? 22 : 30;
    var geo = new THREE.ConeGeometry(1, 1, 8, 4, true);
    geo.translate(0, 0.5, 0);
    var phase = new Float32Array(N);
    for (var i = 0; i < N; i++) phase[i] = Math.random();
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    var uni = { uTime: { value: 0 }, uLevel: { value: 0 } };
    var mat = new THREE.ShaderMaterial({
      uniforms: uni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: [
        'attribute float aPhase; uniform float uTime; uniform float uLevel; varying float vH; varying vec3 vN; varying vec3 vV;',
        'void main(){ vec3 p = position; vH = p.y;',
        ' float fl = 0.82 + 0.12*sin(uTime*21.0 + aPhase*6.283) + 0.08*sin(uTime*34.0 + aPhase*19.0);',
        ' p.y *= (0.3 + 0.7*uLevel) * fl; p.xz *= (0.75 + 0.25*uLevel) * (1.0 - 0.35*vH);',
        ' p.x += sin(uTime*13.0 + aPhase*9.0) * 0.08 * vH * vH;',
        ' vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);',
        ' vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal); vV = normalize(cameraPosition - wp.xyz);',
        ' gl_Position = projectionMatrix * viewMatrix * wp; }'
      ].join('\n'),
      fragmentShader: [
        'uniform float uLevel; varying float vH; varying vec3 vN; varying vec3 vV;',
        'void main(){ float e = abs(dot(normalize(vN), normalize(vV)));',
        ' vec3 base = vec3(0.06, 0.16, 0.95); vec3 tip = vec3(0.45, 0.6, 1.0);',
        ' vec3 col = mix(base, tip, smoothstep(0.15, 0.85, vH));',
        ' float a = (0.35 + 0.65*pow(1.0 - e, 1.5)) * smoothstep(0.0, 0.12, vH) * (1.0 - smoothstep(0.65, 1.0, vH));',
        ' a += 0.6 * smoothstep(0.55, 0.0, abs(vH - 0.35)) * pow(e, 3.0) * 0.4;',
        ' gl_FragColor = vec4(col * a * 1.5 * smoothstep(0.0, 0.08, uLevel), 1.0); }'
      ].join('\n')
    });
    var im = new THREE.InstancedMesh(geo, mat, N);
    im.frustumCulled = false;
    im.castShadow = im.receiveShadow = false;
    var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = V3(), ps = V3();
    for (i = 0; i < N; i++) {
      var a = i / N * TAU;
      ps.set(Math.cos(a) * 0.37, 0.042, Math.sin(a) * 0.37);
      e.set(0, -a, -1.0, 'YXZ');
      q.setFromEuler(e);
      sc.set(0.022, 0.085, 0.022);
      m4.compose(ps, q, sc);
      im.setMatrixAt(i, m4);
    }
    im.visible = false;
    parent.add(im);
    /* バーナーの青い輝き（平面） */
    var gc = U.canvas(128, 128), gx = gc.getContext('2d');
    var gr = gx.createRadialGradient(64, 64, 30, 64, 64, 64);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.55, 'rgba(60,110,255,0.9)'); gr.addColorStop(0.75, 'rgba(30,60,220,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    gx.fillStyle = gr; gx.fillRect(0, 0, 128, 128);
    var glow = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.25).rotateX(-PI / 2), new THREE.MeshBasicMaterial({ map: tex(gc), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    glow.position.y = 0.05;
    glow.visible = false;
    parent.add(glow);
    /* 鍋のふちの外へ少しだけ漏れる青い照り返し（黒いガラスに映る） */
    var hc = U.canvas(256, 256), hx = hc.getContext('2d');
    var hg = hx.createRadialGradient(128, 128, 60, 128, 128, 128);
    hg.addColorStop(0, 'rgba(0,0,0,0)'); hg.addColorStop(0.72, 'rgba(40,80,255,0.55)'); hg.addColorStop(0.8, 'rgba(30,60,230,0.3)'); hg.addColorStop(1, 'rgba(0,0,0,0)');
    hx.fillStyle = hg; hx.fillRect(0, 0, 256, 256);
    var halo = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 3.3).rotateX(-PI / 2), new THREE.MeshBasicMaterial({ map: tex(hc), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    halo.position.y = 0.016;
    halo.visible = false;
    parent.add(halo);
    var light = new THREE.PointLight(0x4f74ff, 0, 2.2, 2);
    light.position.set(0, 0.09, 0);
    parent.add(light);
    var level = 0;
    return {
      set: function (v) { level = v; uni.uLevel.value = v; im.visible = glow.visible = halo.visible = v > 0.001; if (v <= 0.001) light.intensity = 0; },
      update: function (dt) {
        uni.uTime.value += dt;
        if (level > 0.001) {
          var t = uni.uTime.value;
          var fl = 0.85 + 0.1 * Math.sin(t * 17) + 0.05 * Math.sin(t * 31 + 1.3);
          light.intensity = level * 0.7 * fl;
          glow.material.opacity = (0.35 + 0.65 * level) * (0.9 + 0.1 * Math.sin(t * 23));
          halo.material.opacity = level * 0.5 * fl;
        }
      }
    };
  }

  /* ───────────── 食卓 ───────────── */
  function buildDining(root) {
    var A = W.anchors.eat;
    var TX0 = A.x - 4, TX1 = A.x + 4, Z0 = -5, Z1 = 4.2, T = 0.38, r = 0.12;
    var ot = woodTex('oak');
    var tw = 8, td = Z1 - Z0 + 0.8;
    [ot.map, ot.rough, ot.normal].forEach(function (t) { t.repeat.set(1 / tw, 1 / td); t.offset.set(-TX0 / tw, 0); });
    var oakM = phys({ map: ot.map, roughnessMap: ot.rough, normalMap: ot.normal, normalScale: new THREE.Vector2(0.45, 0.45), roughness: 1, clearcoat: 0.35, clearcoatRoughness: 0.35 }, 0.8);
    var run = [];
    arcYZ(-T + r, Z0 + r, r, -PI / 2, -PI, 4, run);
    arcYZ(-r, Z0 + r, r, PI, PI / 2, 6, run);
    arcYZ(-r, Z1 - r, r, PI / 2, 0, 6, run);
    arcYZ(-T + r, Z1 - r, r, 0, -PI / 2, 4, run);
    run = [[-T, Z0 + 0.3]].concat(run.slice(0)).concat([[-T, Z1 - 0.3]]);
    var top = mesh(sweepX([run], TX0, TX1), oakM);
    root.add(top);
    root.add(mesh(capYZ(run, TX0, false), oakM));
    root.add(mesh(capYZ(run, TX1, true), oakM));
    var bot = mesh(new THREE.BoxGeometry(TX1 - TX0, 0.02, Z1 - Z0 - 0.6), oakM);
    bot.position.set(A.x, -T + 0.01, (Z0 + Z1) / 2);
    root.add(bot);
    /* 脚と幕板 */
    var legM = phys({ map: ot.map, roughness: 0.5, clearcoat: 0.3, color: 0xe8d8c8 }, 0.7);
    [[TX0 + 0.5, Z0 + 0.5], [TX1 - 0.5, Z0 + 0.5], [TX0 + 0.5, Z1 - 0.5], [TX1 - 0.5, Z1 - 0.5]].forEach(function (q) {
      var l = mesh(new THREE.BoxGeometry(0.55, 6.85, 0.55), legM);
      l.position.set(q[0], -T - 3.42, q[1]);
      root.add(l);
    });
    [[A.x, Z0 + 0.5, TX1 - TX0 - 1.2, 0.2], [A.x, Z1 - 0.5, TX1 - TX0 - 1.2, 0.2]].forEach(function (q) {
      var ap = mesh(new THREE.BoxGeometry(q[2], 0.7, q[3]), legM);
      ap.position.set(q[0], -T - 0.35, q[1]);
      root.add(ap);
    });
    /* 床 */
    var fw = woodTex('floor');
    var fm = std({ map: fw.map, roughnessMap: fw.rough, normalMap: fw.normal, roughness: 1 }, 0.6);
    var fg = new THREE.PlaneGeometry(16, 20); fg.rotateX(-PI / 2);
    var fl = mesh(fg, fm, false, true);
    fl.position.set(A.x + 2, -7.2, 4.8);
    worldUVxz(fg, fl.position);
    root.add(fl);
    /* 奥の暖色の壁（しっくい） */
    var pl = cached('plaster', function () {
      var rr = paint(512, 512, function (u, v, x, y, o) {
        var n = U.fbm(u * 8, v * 8, 61, 5, 8), n2 = U.noise2(u * 96, v * 96, 4, 96);
        var c = 0.9 + (n - 0.5) * 0.1 + (n2 - 0.5) * 0.03;
        o[0] = c * 0.93; o[1] = c * 0.8; o[2] = c * 0.64; o[3] = n * 0.7 + n2 * 0.3; o[4] = 0.85;
      }, true);
      return { map: tex(rr.color, [1 / 6, 1 / 6]), normal: tex(U.normalFromHeight(rr.height, 2), [1 / 6, 1 / 6], false) };
    });
    var wm = std({ map: pl.map, normalMap: pl.normal, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.9 }, 0.6);
    var wg = new THREE.PlaneGeometry(18, 17);
    var p = wg.attributes.position, uv = wg.attributes.uv;
    var wall = mesh(wg, wm, false, true);
    wall.position.set(A.x + 1, 1.3, -5.2);
    for (var i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) + wall.position.x, p.getY(i) + wall.position.y);
    root.add(wall);
    var base = mesh(new THREE.BoxGeometry(18, 0.8, 0.12), std({ color: 0xf2ece2, roughness: 0.6 }, 0.6));
    base.position.set(A.x + 1, -6.8, -5.14);
    root.add(base);
  }
})();

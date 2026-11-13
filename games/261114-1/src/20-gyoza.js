/* 20-gyoza.js — 主役のぎょうざ（G.Gyoza）、焼くとできる羽根（G.Wing）、あん・皮の材質（G.foodTex）。
   依存: THREE(r160), G.util, G.ease だけ。renderer には依存しない。テクスチャはすべて Canvas/DataTexture の手続き生成。
   単位 1 = 10cm、Y 上。 */
(function () {
  'use strict';
  var G = window.G;
  var U = G.util;
  var PI = Math.PI;

  function srgbLin(c) { return Math.pow(c, 2.2); }
  function smooth01(v) { v = v < 0 ? 0 : v > 1 ? 1 : v; return v * v * (3 - 2 * v); }

  /* ------------------------------------------------------------------ */
  /*  共有テクスチャ                                                      */
  /* ------------------------------------------------------------------ */
  var TEX = {};

  /* あんの色/高さ Canvas（ひき肉の粒＋ニラ＋キャベツ） */
  function makeFillingCanvases() {
    var S = 512, rnd = U.rng(9127);
    var col = U.canvas(S), hgt = U.canvas(S);
    var c = col.getContext('2d'), h = hgt.getContext('2d');
    c.fillStyle = 'rgb(186,138,118)'; c.fillRect(0, 0, S, S);
    h.fillStyle = 'rgb(110,110,110)'; h.fillRect(0, 0, S, S);
    function wrapDraw(fn, x, y, r) { // タイル可能にするため端は4方向に複製
      fn(x, y);
      if (x < r) fn(x + S, y); if (x > S - r) fn(x - S, y);
      if (y < r) fn(x, y + S); if (y > S - r) fn(x, y - S);
    }
    var i, x, y, r, k;
    // ひき肉の粒（明暗の小さな塊）
    for (i = 0; i < 5200; i++) {
      x = rnd() * S; y = rnd() * S; r = 1.5 + rnd() * 4.5;
      k = rnd();
      var cr = k < 0.3 ? [214, 172, 150] : k < 0.65 ? [160, 106, 88] : [196, 146, 124];
      var j = (rnd() - 0.5) * 22;
      (function (cr, j, r, hv) {
        wrapDraw(function (px, py) {
          c.fillStyle = 'rgb(' + ((cr[0] + j) | 0) + ',' + ((cr[1] + j) | 0) + ',' + ((cr[2] + j) | 0) + ')';
          c.beginPath(); c.ellipse(px, py, r, r * (0.6 + rnd() * 0.4), rnd() * PI, 0, PI * 2); c.fill();
          h.fillStyle = 'rgba(' + hv + ',' + hv + ',' + hv + ',0.8)';
          h.beginPath(); h.arc(px, py, r * 0.9, 0, PI * 2); h.fill();
        }, x, y, r + 2);
      })(cr, j, r, (90 + rnd() * 110) | 0);
    }
    // 脂の白い点
    for (i = 0; i < 700; i++) {
      x = rnd() * S; y = rnd() * S; r = 0.8 + rnd() * 1.6;
      c.fillStyle = 'rgba(240,222,210,0.85)';
      c.beginPath(); c.arc(x, y, r, 0, PI * 2); c.fill();
    }
    // キャベツ（うす緑〜白っぽい、小さな角ばった片）
    for (i = 0; i < 260; i++) {
      x = rnd() * S; y = rnd() * S; r = 4 + rnd() * 7;
      var g1 = rnd();
      (function (r, g1, a0) {
        wrapDraw(function (px, py) {
          c.fillStyle = g1 < 0.5 ? 'rgb(196,214,150)' : 'rgb(222,228,184)';
          c.beginPath();
          for (var q = 0; q < 5; q++) {
            var a = a0 + q * 1.256 + rnd() * 0.5, rr = r * (0.6 + rnd() * 0.5);
            c.lineTo(px + Math.cos(a) * rr, py + Math.sin(a) * rr);
          }
          c.closePath(); c.fill();
          h.fillStyle = 'rgb(170,170,170)'; h.beginPath(); h.arc(px, py, r * 0.7, 0, PI * 2); h.fill();
        }, x, y, r + 2);
      })(r, g1, rnd() * 6.28);
    }
    // ニラ（濃い緑の細い切れ端）
    for (i = 0; i < 520; i++) {
      x = rnd() * S; y = rnd() * S;
      var len = 6 + rnd() * 16, wdt = 2.2 + rnd() * 2.6, ang = rnd() * PI;
      var gg = rnd();
      (function (len, wdt, ang, gg) {
        wrapDraw(function (px, py) {
          c.save(); c.translate(px, py); c.rotate(ang);
          c.fillStyle = gg < 0.6 ? 'rgb(46,98,34)' : gg < 0.85 ? 'rgb(70,128,44)' : 'rgb(120,160,70)';
          c.fillRect(-len / 2, -wdt / 2, len, wdt);
          c.fillStyle = 'rgba(150,190,100,0.6)'; c.fillRect(-len / 2, -wdt / 2, len, wdt * 0.3);
          c.restore();
          h.save(); h.translate(px, py); h.rotate(ang); h.fillStyle = 'rgb(200,200,200)'; h.fillRect(-len / 2, -wdt / 2, len, wdt); h.restore();
        }, x, y, len);
      })(len, wdt, ang, gg);
    }
    return { col: col, hgt: hgt };
  }

  function fillingTextures() {
    if (TEX.fillCol) return TEX;
    var cv = makeFillingCanvases();
    TEX.fillCol = U.canvasTex(cv.col, { repeat: [1, 1] });
    TEX.fillNrm = U.canvasTex(U.normalFromHeight(cv.hgt, 3.5), { srgb: false, repeat: [1, 1] });
    return TEX;
  }

  /* 皮の共有テクスチャ: 色(粉の細かいムラ)、法線(細かな凹凸)、ノイズ(R低周波 G高周波 B焼き斑点 A粉だまり) */
  function doughTextures() {
    if (TEX.doughCol) return TEX;
    var S = 256;
    var col = U.pixelCanvas(S, S, function (u, v) {
      var n = U.fbm(u * 16, v * 16, 11, 4, 16), m = U.fbm(u * 64, v * 64, 12, 2, 64);
      var b = 236 + (n - 0.5) * 14 + (m - 0.5) * 10;
      return [b, b - 6 + (n - 0.5) * 4, b - 22 + (n - 0.5) * 6];
    });
    var hgt = U.pixelCanvas(S, S, function (u, v) {
      var n = U.fbm(u * 24, v * 24, 21, 3, 24) * 0.6 + U.noise2(u * 96, v * 96, 22, 96) * 0.4;
      var b = n * 255; return [b, b, b];
    });
    var noise = U.pixelCanvas(S, S, function (u, v) {
      var r = U.fbm(u * 4, v * 4, 31, 4, 4);
      var g = U.fbm(u * 16, v * 16, 32, 3, 16);
      var sp = U.fbm(u * 10, v * 10, 33, 3, 10), dot = U.noise2(u * 48, v * 48, 34, 48);
      var b = U.smooth(0.45, 0.8, sp) * 0.6 + U.smooth(0.7, 0.95, dot) * 0.6;
      var a = U.fbm(u * 6, v * 6, 35, 4, 6);
      return [r * 255, g * 255, Math.min(1, b) * 255, a * 255];
    });
    TEX.doughCol = U.canvasTex(col, { repeat: [1, 1] });
    TEX.doughNrm = U.canvasTex(U.normalFromHeight(hgt, 1.6), { srgb: false, repeat: [1, 1] });
    var nt = U.canvasTex(noise, { srgb: false, repeat: [1, 1] });
    TEX.noise = nt;
    return TEX;
  }

  /* ------------------------------------------------------------------ */
  /*  G.foodTex                                                          */
  /* ------------------------------------------------------------------ */
  var fillMatCache = null, doughMatCache = null;
  var foodTex = {
    fillingMaterial: function () {
      if (fillMatCache) return fillMatCache;
      var t = fillingTextures();
      var tc = t.fillCol, tn = t.fillNrm;
      fillMatCache = new THREE.MeshPhysicalMaterial({
        map: tc, normalMap: tn, normalScale: new THREE.Vector2(0.9, 0.9),
        roughness: 0.48, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.35
      });
      return fillMatCache;
    },
    fillingMound: function (radius, height, seed) {
      var geo = moundGeometry(seed || 1, radius * 2.4);
      var m = new THREE.Mesh(geo, foodTex.fillingMaterial());
      m.scale.set(radius, height, radius);
      m.castShadow = true; m.receiveShadow = true;
      return m;
    },
    /* 火の通ったあん（断面用）。灰色がかった薄茶の肉に、くすんだ緑 */
    cookedFillingMaterial: function () {
      if (TEX.cookedMat) return TEX.cookedMat;
      var t = fillingTextures();
      var src = t.fillCol.image, S = src.width;
      var out = U.canvas(S), ctx = out.getContext('2d');
      ctx.drawImage(src, 0, 0);
      var img = ctx.getImageData(0, 0, S, S), d = img.data;
      for (var i = 0; i < d.length; i += 4) {
        var r = d[i], g = d[i + 1], b = d[i + 2];
        if (g > r * 0.9) { d[i] = r * 0.5 + 14; d[i + 1] = g * 0.72 + 22; d[i + 2] = b * 0.35 + 6; continue; } // ニラの緑ははっきり残す
        var l = (r * 0.5 + g * 0.35 + b * 0.15);
        d[i] = l * 0.78 + 24; d[i + 1] = l * 0.60 + 14; d[i + 2] = l * 0.44 + 8; // 火の通った肉の茶色（皮の白とはっきり違う）
      }
      ctx.putImageData(img, 0, 0);
      TEX.cookedMat = new THREE.MeshPhysicalMaterial({
        map: U.canvasTex(out, { repeat: [1, 1] }), normalMap: t.fillNrm, normalScale: new THREE.Vector2(1.2, 1.2),
        roughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.3
      });
      return TEX.cookedMat;
    },
    doughMaterial: function () {
      if (doughMatCache) return doughMatCache;
      var t = doughTextures();
      doughMatCache = new THREE.MeshPhysicalMaterial({
        color: 0xffffff, map: t.doughCol, normalMap: t.doughNrm, normalScale: new THREE.Vector2(0.35, 0.35),
        roughness: 0.88, metalness: 0, sheen: 1, sheenColor: new THREE.Color(0.42, 0.41, 0.39), sheenRoughness: 0.75
      });
      return doughMatCache;
    }
  };
  G.foodTex = foodTex;

  /* 単位のでこぼこした山（半径1、高さ1、底 y=0） */
  function moundGeometry(seed, uvScale) {
    uvScale = uvScale || 1;
    var RINGS = 13, SEG = 30, rnd = U.rng(seed * 7 + 3);
    var pos = [], uv = [], idx = [];
    var ph = rnd() * 10;
    pos.push(0, 1, 0); uv.push(0.5 * uvScale, 0.5 * uvScale);
    for (var r = 1; r <= RINGS; r++) {
      var rho = r / RINGS;
      for (var s = 0; s < SEG; s++) {
        var a = s / SEG * PI * 2;
        var ca = Math.cos(a), sa = Math.sin(a);
        var lump = 1 + 0.14 * (U.noise2(ca * rho * 2.2 + ph, sa * rho * 2.2, seed, 0) - 0.5) * 2;
        var edgeW = 1 + 0.12 * (U.noise2(ca * 1.6 + 5, sa * 1.6 + ph, seed + 3, 0) - 0.5) * 2;
        var rr = rho * edgeW;
        var y = Math.pow(Math.max(0, 1 - rho * rho), 0.72) * lump;
        y += (U.noise2(ca * rho * 7 + ph, sa * rho * 7, seed + 9, 0) - 0.5) * 0.12 * (1 - rho * 0.6);
        if (r === RINGS) y = 0;
        pos.push(ca * rr, Math.max(0, y), sa * rr);
        uv.push((0.5 + ca * rr * 0.5) * uvScale, (0.5 + sa * rr * 0.5) * uvScale);
      }
    }
    for (s = 0; s < SEG; s++) idx.push(0, 1 + (s + 1) % SEG, 1 + s);
    for (r = 1; r < RINGS; r++) {
      var b0 = 1 + (r - 1) * SEG, b1 = 1 + r * SEG;
      for (s = 0; s < SEG; s++) {
        var s1 = (s + 1) % SEG;
        idx.push(b0 + s, b0 + s1, b1 + s, b0 + s1, b1 + s1, b1 + s);
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /* ------------------------------------------------------------------ */
  /*  皮のシェーダ（MeshPhysicalMaterial を onBeforeCompile で拡張）       */
  /* ------------------------------------------------------------------ */
  var SKIN_FRAG_DECL = [
    'uniform float uCook, uBrown, uSauce, uBite, uClosed, uFill, uWetOn, uSeed, uFrontOut;',
    'uniform float uWet[32];',
    'uniform sampler2D uNoise, uFillTex;',
    'varying vec3 vLocal; varying float vAO;',
    'float gR, gCC, gCCR, gSheen;',
    'vec3 sl(vec3 c){ return pow(c, vec3(2.2)); }'
  ].join('\n');

  var SKIN_FRAG_MAP = [
    'vec2 fuv = vMapUv;',
    'float xf = (fuv.x - 0.5) * 2.0, zf = (fuv.y - 0.5) * 2.0;',
    'float ccx = sqrt(max(1e-4, 1.0 - xf * xf));',
    'float tt = clamp(zf / ccx, -1.0, 1.0);',
    'float lam = 1.0 - abs(tt);',
    'float isOut = (gl_FrontFacing == (uFrontOut > 0.5)) ? 1.0 : 0.0;',
    'vec4 nz = texture2D(uNoise, fuv * 1.3 + uSeed);',
    'vec4 nz2 = texture2D(uNoise, fuv * 4.1 + uSeed * 1.7);',
    'if (uBite > 0.5) {',
    '  float bump = 0.010 + 0.012 * abs(sin(vLocal.y * 70.0 + vLocal.z * 40.0)) + 0.01 * nz2.g;',
    '  if (vLocal.x > bump) discard;',
    '}',
    'vec3 col = diffuseColor.rgb;',
    // 生: 粉だまり。薄い皮なので、あんの上は生でもわずかに色が透ける
    'float flour = smoothstep(0.42, 0.75, nz.a) * (1.0 - uCook);',
    'col = mix(col, sl(vec3(0.97, 0.965, 0.945)), flour * 0.55);',
    'col *= 0.97 + 0.06 * nz2.g;',
    'float body = smoothstep(0.16, 0.42, lam) * uFill * uClosed;',
    'vec3 fillC = texture2D(uFillTex, fuv * 1.6 + uSeed, 2.5).rgb;',
    'col = mix(col, col * mix(vec3(1.0), fillC * 2.2, 0.5), body * 0.10 * isOut * (1.0 - flour));',
    // 蒸し上がり: しっとり半透明。あんの上は色が透け、とじ目・ひだ（2枚重ね）は白っぽく不透明
    'vec3 ck = sl(vec3(0.80, 0.745, 0.60)) * (0.95 + 0.10 * nz.g);',
    'vec3 thru = mix(ck * 0.74, fillC * 0.85, 0.62);',
    'float tr = body * (0.58 + 0.35 * nz.r) * (0.4 + 0.6 * isOut);',
    'ck = mix(ck, thru, tr);',
    'ck = mix(ck, sl(vec3(0.95, 0.93, 0.87)), (1.0 - smoothstep(0.06, 0.24, lam)) * 0.7);',
    'col = mix(col, ck, uCook);',
    // ぬれ: 奥半分のふちの帯
    'float wet = 0.0;',
    'if (zf < 0.0 && uWetOn > 0.001) {',
    '  float ang = atan(-zf, -xf);',
    '  float fi = clamp(ang / 3.14159 * 32.0 - 0.5, 0.0, 31.0);',
    '  int i0 = int(floor(fi)); int i1 = min(i0 + 1, 31);',
    '  float wv = mix(uWet[i0], uWet[i1], fi - floor(fi));',
    '  float rr = length(vec2(xf, zf));',
    '  wet = wv * smoothstep(0.68, 0.80, rr + (nz2.g - 0.5) * 0.08) * uWetOn;',
    '}',
    'col = mix(col, col * sl(vec3(0.84, 0.83, 0.80)), wet);',
    // 焼き色: 底（おなか側の端 lam→1）と底に近い縁。底の面に沿った座標でムラを作る
    'vec2 bq = vec2(vLocal.x * 1.3, (vLocal.z + vLocal.y) * 1.3) + uSeed;',
    'vec4 bn = texture2D(uNoise, bq * 1.6);',
    'vec4 bn2 = texture2D(uNoise, bq * 4.3 + 0.37);',
    'float bedge = 0.76 + 0.09 * (bn.r - 0.5) + 0.05 * (bn2.g - 0.5);',
    'float bmask = smoothstep(bedge - 0.06, bedge + 0.05, lam) * isOut;',
    'float bAmt = bmask * smoothstep(0.0, 0.35, uBrown);',
    'float lv = clamp(uBrown * (0.35 + 0.9 * bn.r) * smoothstep(bedge - 0.02, bedge + 0.16, lam), 0.0, 1.0);',
    'vec3 pale = sl(vec3(0.88, 0.74, 0.50));',
    'vec3 gold = sl(vec3(0.75, 0.52, 0.27));',
    'vec3 deep = sl(vec3(0.52, 0.31, 0.13));',
    'vec3 dark = sl(vec3(0.33, 0.17, 0.06));',
    'vec3 bc = lv < 0.5 ? mix(pale, gold, lv * 2.0) : mix(gold, deep, lv * 2.0 - 1.0);',
    'float spots = bn2.b * smoothstep(0.3, 1.0, uBrown);',
    'bc = mix(bc, dark, spots * 0.85);',
    'bc = mix(bc, deep, smoothstep(0.0, 0.03, lam - bedge) * (1.0 - smoothstep(0.03, 0.08, lam - bedge)) * uBrown * 0.5);',
    'col = mix(col, bc, bAmt);',
    'float edgeRing = smoothstep(bedge - 0.14, bedge - 0.04, lam) * (1.0 - bmask) * isOut * uBrown;',
    'col = mix(col, col * sl(vec3(0.95, 0.84, 0.66)), edgeRing * 0.6);',
    // しょうゆ: +X 側 1/3（あめ色のつやのある染み）
    'float sm = smoothstep(0.28, 0.40, xf + (nz2.r - 0.5) * 0.2) * uSauce * isOut;',
    'col = mix(col, col * sl(vec3(0.60, 0.36, 0.19)), sm * (0.8 + 0.2 * nz.g));',
    'col *= vAO;',
    'diffuseColor.rgb = col;',
    'gR = mix(0.90, 0.30, uCook);',
    'gR = mix(gR, 0.12, wet);',
    'gR = mix(gR, 0.34 - 0.12 * bn2.g, bAmt);',
    'gR = mix(gR, 0.16, sm);',
    'gCC = mix(0.0, 0.6, uCook) * (0.7 + 0.3 * nz.g);',
    'gCC = max(gCC, wet);',
    'gCC = max(gCC, bAmt * 0.45);',
    'gCC = max(gCC, sm * 0.9);',
    'gCCR = mix(0.32, 0.06, max(wet, sm));',
    'gSheen = (1.0 - uCook) * (1.0 - wet) * 0.45;'
  ].join('\n');

  function skinOnBeforeCompile(shader) {
    var u = this.userData.uniforms;
    for (var k in u) shader.uniforms[k] = u[k];
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aAO;\nvarying vec3 vLocal;\nvarying float vAO;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position; vAO = aAO;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + SKIN_FRAG_DECL)
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + SKIN_FRAG_MAP)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gR;')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n' +
        '#ifdef USE_CLEARCOAT\nmaterial.clearcoat = gCC; material.clearcoatRoughness = max(gCCR, 0.0525);\n#endif\n' +
        '#ifdef USE_SHEEN\nmaterial.sheenColor = vec3(gSheen);\n#endif\n');
  }
  function skinCacheKey() { return 'gyoza-skin-v1'; }

  function depthOnBeforeCompile(shader) {
    shader.uniforms.uBite = this.userData.uniforms.uBite;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;\nuniform float uBite;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (uBite > 0.5 && vLocal.x > 0.012) discard;');
  }
  function depthCacheKey() { return 'gyoza-depth-v1'; }
  function skinDepthMaterial(uniforms) {
    // 薄い両面の皮が自分に落とす影のちらつき（アクネ）を、影マップ側の深度をずらして防ぐ。かじった半分は影も消す
    var m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, polygonOffset: true, polygonOffsetFactor: 2.5, polygonOffsetUnits: 6 });
    m.userData.uniforms = uniforms;
    m.onBeforeCompile = depthOnBeforeCompile;
    m.customProgramCacheKey = depthCacheKey;
    return m;
  }
  function makeSkinMaterial(uniforms) {
    var t = doughTextures(); fillingTextures();
    var m = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, map: t.doughCol, normalMap: t.doughNrm, normalScale: new THREE.Vector2(0.45, 0.45),
      roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
      clearcoat: 1, clearcoatRoughness: 0.3, sheen: 1, sheenRoughness: 0.7, sheenColor: new THREE.Color(1, 1, 1)
    });
    m.userData.uniforms = uniforms;
    m.onBeforeCompile = skinOnBeforeCompile;
    m.customProgramCacheKey = skinCacheKey;
    return m;
  }

  /* ------------------------------------------------------------------ */
  /*  G.Gyoza                                                            */
  /* ------------------------------------------------------------------ */
  var R = 0.45;            // ひらいた皮の半径
  var NX = 53, NT = 35;    // 格子（長手 × 横断）
  var PMAX = 1.0;
  var BASE = 0.010;        // 板の上の皮の高さ（ふちの厚み分だけ浮かす）
  var THICK = 0.009;       // ふちの厚み
  var UB = 0.13;           // 横断パラメータのうち、とじ目の帯の割合
  var SLOT_DX = 0.098;     // ひだスロットの間隔（ひらいた皮の X）

  function Gyoza(opts) {
    opts = opts || {};
    this.seed = opts.seed != null ? opts.seed : ((Math.random() * 1e6) | 0);
    this.mama = !!opts.mama;
    var rnd = U.rng(this.seed * 13 + 5);
    this.pleats = [0, 0, 0, 0, 0, 0, 0];
    this._fold = 0; this._stand = 0; this._fill = opts.fill != null ? opts.fill : 1;
    this._cook = 0; this._cookGeo = 0; this._brown = 0; this._sauce = 0; this._bite = 0;
    this._wet = new Float32Array(32);
    this.wetCoverage = 0;
    this._dirty = true;
    // 個体差
    var jit = this.mama ? 0.35 : 1;
    this._var = {
      h: 1 + (rnd() - 0.5) * 0.08 * jit,
      lean: (rnd() - 0.5) * 0.14 * jit,
      wobA: (rnd() - 0.5) * 0.010 * jit, wobF: 6 + rnd() * 5, wobP: rnd() * 6.28,
      edgeP: rnd() * 6.28, edgeA: 0.0045 + rnd() * 0.002,
      bend: (rnd() - 0.5) * 0.012 * jit
    };
    this._slot = [];
    for (var j = 0; j < 7; j++) {
      this._slot.push({
        slant: this.mama ? 0.55 : 0.35 + rnd() * 0.45,
        depth: this.mama ? 1 : 0.75 + rnd() * 0.5,
        off: this.mama ? 0 : (rnd() - 0.5) * 0.18
      });
    }

    this.uniforms = {
      uCook: { value: 0 }, uBrown: { value: 0 }, uSauce: { value: 0 }, uBite: { value: 0 },
      uClosed: { value: 0 }, uFill: { value: 1 }, uWetOn: { value: 1 }, uFrontOut: { value: 0 }, uSeed: { value: (this.seed % 97) / 97 },
      uWet: { value: this._wet },
      uNoise: { value: doughTextures().noise }, uFillTex: { value: fillingTextures().fillCol }
    };

    this.group = new THREE.Group();
    this.group.name = 'gyoza';
    // renderer は描画の最初に scene.updateMatrixWorld() を呼ぶ。そこで形の作り直しをまとめて行う（同じフレームに反映）
    var selfG = this, umw = this.group.updateMatrixWorld;
    this.group.updateMatrixWorld = function (force) { if (selfG._dirty) selfG._rebuild(); return umw.call(this, force); };
    this._buildMesh();
    this._buildFilling();
    this._buildCaps();

    if (opts.pleats) for (j = 0; j < 7; j++) this.pleats[j] = opts.pleats[j] || 0;
    this.setFilling(this._fill);
    this._rebuild();
  }

  Gyoza.prototype._buildMesh = function () {
    var nv = NX * NT, nr = NX * 2;
    var pos = new Float32Array((nv + nr) * 3), uv = new Float32Array((nv + nr) * 2), ao = new Float32Array(nv + nr);
    var idx = [], i, k;
    for (i = 0; i < NX; i++) {
      var p = -PMAX + 2 * PMAX * i / (NX - 1), c = Math.sqrt(Math.max(0, 1 - p * p));
      for (k = 0; k < NT; k++) {
        var t = -1 + 2 * k / (NT - 1), v = i * NT + k;
        uv[v * 2] = p * 0.5 + 0.5; uv[v * 2 + 1] = t * c * 0.5 + 0.5;
        ao[v] = 1;
      }
    }
    for (i = 0; i < NX - 1; i++) {
      for (k = 0; k < NT - 1; k++) {
        var a = i * NT + k, b = (i + 1) * NT + k, cc = i * NT + k + 1, d = (i + 1) * NT + k + 1;
        idx.push(a, b, cc, b, d, cc);
      }
    }
    // ふちの厚み（境界の行 k=0 と k=NT-1 から下がる帯）
    for (var e = 0; e < 2; e++) {
      var kk = e === 0 ? 0 : NT - 1;
      for (i = 0; i < NX; i++) {
        var src = i * NT + kk, dst = nv + e * NX + i;
        uv[dst * 2] = uv[src * 2]; uv[dst * 2 + 1] = uv[src * 2 + 1]; ao[dst] = 0.9;
      }
      for (i = 0; i < NX - 1; i++) {
        var s0 = i * NT + kk, s1 = (i + 1) * NT + kk, r0 = nv + e * NX + i, r1 = r0 + 1;
        if (e === 0) idx.push(s0, r0, s1, s1, r0, r1); else idx.push(s0, s1, r0, s1, r1, r0);
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aAO', new THREE.BufferAttribute(ao, 1).setUsage(THREE.DynamicDrawUsage));
    // 2通りの面の向き: ひらいている間は上向きの面を表に（影の normalBias が正しく効くように）、閉じたら外側を表に
    var idxIn = idx.slice();
    for (var q = 0; q < idxIn.length; q += 3) { var tq = idxIn[q + 1]; idxIn[q + 1] = idxIn[q + 2]; idxIn[q + 2] = tq; }
    this._idxOut = new THREE.Uint16BufferAttribute(idx, 1);
    this._idxIn = new THREE.Uint16BufferAttribute(idxIn, 1);
    this._frontOut = false;
    g.setIndex(this._idxIn);
    g.computeVertexNormals();
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.15, -0.1), 0.62);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-0.5, -0.05, -0.55), new THREE.Vector3(0.5, 0.5, 0.55));
    this._geo = g; this._nv = nv;
    this._wr = new Float32Array(nv);
    for (i = 0; i < NX; i++) for (k = 0; k < NT; k++) {
      var tt2 = -1 + 2 * k / (NT - 1);
      this._wr[i * NT + k] = (U.fbm(i * 0.11 + this.seed * 0.1, tt2 * 3.4 + 20, this.seed, 3) - 0.5) * 2;
    }
    this.material = makeSkinMaterial(this.uniforms);
    var mesh = new THREE.Mesh(g, this.material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.customDepthMaterial = skinDepthMaterial(this.uniforms);
    var self = this;
    mesh.onBeforeRender = function () { if (self._dirty) self._rebuild(); };
    mesh.onBeforeShadow = function () { if (self._dirty) self._rebuild(); };
    var rc = mesh.raycast;
    mesh.raycast = function (a, b) { if (self._dirty) self._rebuild(); return rc.call(this, a, b); };
    this.mesh = mesh;
    this.group.add(mesh);
  };

  Gyoza.prototype._buildFilling = function () {
    this.fillMesh = foodTex.fillingMound(1, 1, this.seed % 1000 + 1);
    this.fillMesh.geometry.dispose(); this.fillMesh.geometry = moundGeometry(this.seed % 1000 + 1, 0.5);
    this.group.add(this.fillMesh);
  };

  Gyoza.prototype._buildCaps = function () {
    // かじった断面: 皮の断面（外周）とあん（内側）。位置は _rebuild で更新
    function fan(count) {
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((count + 1) * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((count + 1) * 2), 2).setUsage(THREE.DynamicDrawUsage));
      var idx = [];
      for (var i = 0; i < count; i++) idx.push(count, (i + 1) % count, i);
      g.setIndex(idx);
      return g;
    }
    this._capSkin = new THREE.Mesh(fan(NT), new THREE.MeshPhysicalMaterial({ color: 0xe8dcc0, roughness: 0.55, side: THREE.DoubleSide }));
    this._capFill = new THREE.Mesh(fan(NT), foodTex.cookedFillingMaterial());
    this._capSkin.visible = this._capFill.visible = false;
    this._capSkin.receiveShadow = this._capFill.receiveShadow = true;
    this.group.add(this._capSkin, this._capFill);
  };

  /* --- セッター --- */
  Gyoza.prototype.setShape = function (o) {
    o = o || {};
    var f = o.fold != null ? U.clamp01(o.fold) : this._fold;
    var s = o.stand != null ? U.clamp01(o.stand) : this._stand;
    if (f !== this._fold || s !== this._stand) { this._fold = f; this._stand = s; this._dirty = true; }
    return this;
  };
  Gyoza.prototype.setFilling = function (v) {
    v = U.clamp(v, 0, 2);
    if (v !== this._fill) { this._fill = v; this._dirty = true; }
    return this;
  };
  Gyoza.prototype.setWet = function (a0, a1) {
    if (a1 < a0) { var t = a0; a0 = a1; a1 = t; }
    var ch = false;
    for (var i = 0; i < 32; i++) {
      var c0 = i / 32 * PI, c1 = (i + 1) / 32 * PI;
      if (c1 >= a0 && c0 <= a1 && this._wet[i] < 1) { this._wet[i] = 1; ch = true; }
    }
    if (ch) {
      var s = 0; for (i = 0; i < 32; i++) s += this._wet[i];
      this.wetCoverage = s / 32;
    }
    return this;
  };
  Gyoza.prototype.clearWet = function () { for (var i = 0; i < 32; i++) this._wet[i] = 0; this.wetCoverage = 0; return this; };
  Gyoza.prototype.setPleat = function (i, v) {
    if (i < 0 || i > 6) return this;
    v = U.clamp01(v);
    if (this.pleats[i] !== v) { this.pleats[i] = v; this._dirty = true; }
    return this;
  };
  Gyoza.prototype.setCook = function (v) {
    v = U.clamp01(v);
    if (Math.abs(v - this._cookGeo) > 0.04 || (v !== this._cookGeo && (v === 0 || v === 1))) { this._cookGeo = v; this._dirty = true; }
    this._cook = v; this.uniforms.uCook.value = v;
    return this;
  };
  Gyoza.prototype.setBrown = function (v) { this._brown = U.clamp01(v); this.uniforms.uBrown.value = this._brown; return this; };
  Gyoza.prototype.setSauce = function (v) { this._sauce = U.clamp01(v); this.uniforms.uSauce.value = this._sauce; return this; };
  Gyoza.prototype.setBite = function (v) {
    v = v | 0;
    if (v !== this._bite) { this._bite = v; this._dirty = true; }
    this.uniforms.uBite.value = v === 1 ? 1 : 0;
    this.group.visible = v !== 2;
    return this;
  };
  Object.defineProperty(Gyoza.prototype, 'fold', { get: function () { return this._fold; } });
  Object.defineProperty(Gyoza.prototype, 'stand', { get: function () { return this._stand; } });
  Object.defineProperty(Gyoza.prototype, 'filling', { get: function () { return this._fill; } });
  Gyoza.prototype.update = function () { if (this._dirty) this._rebuild(); return this; };

  /* スロット i の位置（寝ている時、とじ目の上、ローカル） */
  Gyoza.prototype.pleatLocal = function (i) {
    var P = this._shapeParams();
    var xf = (i - 3) * SLOT_DX;
    var p = xf / R, c = Math.sqrt(Math.max(0, 1 - p * p));
    var col = this._colParams(P, xf, c);
    var cs = crossSection(UB * 0.6, 1, col.Wl, col.Al, col.Hl, 1);
    var out = new THREE.Vector3(xf * P.shrinkX + col.wob, BASE + 2 * Math.abs(cs.b) + 0.004, col.zFront - (col.Wl + col.Al - cs.a));
    return out;
  };

  /* 形の共通パラメータ */
  Gyoza.prototype._shapeParams = function () {
    var np = 0; for (var j = 0; j < 7; j++) np += this.pleats[j];
    var F = this._fill;
    var fF = F <= 1 ? 0.45 + 0.55 * F : 1 + 0.32 * (F - 1);
    return {
      np: np, fF: fF,
      shrinkX: 1 - 0.045 * np / 7,
      belly: 1 + 0.10 * np / 7
    };
  };
  Gyoza.prototype._colParams = function (P, xf, c) {
    var V = this._var;
        var lean = 1 + V.lean * xf / R;
    var wob = V.wobA * Math.sin(xf * V.wobF + V.wobP);
    var Wl = 0.068 * Math.pow(c, 0.3);
    var depth = 0.44 * Math.pow(c, 0.9) * (1 - 0.07 * P.np / 7);
    return {
      wob: wob,
      zFront: 0.045,
      Wl: Wl, Al: Math.max(0.001, depth - Wl),
      Hl: 0.122 * Math.pow(c, 1.15) * P.fF * V.h * lean * P.belly,
      Ws: 0.075 * Math.pow(c, 0.25),
      As: Math.max(0.001, 0.36 * Math.pow(c, 0.7) * (1 - 0.04 * P.np / 7) - 0.075 * Math.pow(c, 0.25)),
      Hs: 0.215 * Math.pow(c, 1.3) * P.fF * V.h * lean * P.belly
    };
  };

  /* 横断面: lam 0=とじ目の先 → 1=おなかの端。返り値 a=とじ目からの距離, b=横（上の皮側が +） */
  var _cs = { a: 0, b: 0, th: 0 };
  function crossSection(lam, sgn, W, A, H, q) {
    var THIN = 0.0055;
    if (lam < UB) {
      _cs.a = W * lam / UB; _cs.b = sgn * THIN; _cs.th = 0;
      return _cs;
    }
    var sq = (lam - UB) / (1 - UB), th = PI * (1 - Math.pow(1 - sq, 1.7));
    var s = Math.sin(th), env = Math.pow(Math.max(0, s), q) * Math.sin(th * 0.5);
    _cs.a = W + A * (1 - Math.cos(th)) * 0.5;
    _cs.b = sgn * (THIN * (1 - th / PI) + H * env);
    _cs.th = th;
    return _cs;
  }

  Gyoza.prototype._pleatField = function (xf, lam, out) {
    // 上の皮（sgn>0）の、とじ目側に、斜めに折り重ねたひだの段差
    var disp = 0, ao = 1, gather = 0;
    if (lam > 0.62) { out.d = 0; out.ao = 1; out.g = 0; return out; }
    var fade = lam < UB ? 1.25 : 1.25 - 1.25 * smooth01((lam - UB) / (0.46 - UB));
    for (var j = 0; j < 7; j++) {
      var pj = this.pleats[j]; if (pj <= 0) continue;
      var sl = this._slot[j];
      var xc = (j - 3) * SLOT_DX + sl.off * SLOT_DX * 0.5;
      var d = (xf - xc) / SLOT_DX - sl.slant * 1.5 * (lam / 0.45) + 0.1;
      if (d < -0.62 || d > 0.62) continue;
      var f;
      if (d < 0.22) f = smooth01((d + 0.62) / 0.84);
      else f = smooth01((0.62 - d) / 0.40);
      var amp = pj * sl.depth * fade;
      disp += 0.026 * f * amp;
      gather += 0.25 * f * amp;
      // 段差の谷（折り目の影）
      if (d > 0.25) ao -= 0.42 * amp * smooth01(1 - Math.abs(d - 0.48) / 0.16);
      else if (d < -0.3) ao -= 0.18 * amp * smooth01(1 - Math.abs(d + 0.5) / 0.14);
    }
    out.d = disp; out.ao = Math.max(0.45, ao); out.g = gather;
    return out;
  };

  Gyoza.prototype._rebuild = function () {
    this._dirty = false;
    var pos = this._geo.attributes.position.array, aoA = this._geo.attributes.aAO.array;
    var fold = this._fold, st = fold >= 0.999 ? this._stand : 0;
    var P = this._shapeParams(), V = this._var;
    var stE = G.ease.inOutQuad(st), phi = st * PI * 0.5, cph = Math.cos(phi), sph = Math.sin(phi);
    var pf = { d: 0, ao: 1, g: 0 };
    var bendS = 0.05 + 0.04 * P.np / 7 + V.bend;
    var minY = 1e9;
    var i, k;
    for (i = 0; i < NX; i++) {
      var p = -PMAX + 2 * PMAX * i / (NX - 1), c = Math.sqrt(Math.max(0, 1 - p * p));
      var xf = R * p;
      var col = this._colParams(P, xf, c);
      var AtotL = col.Wl + col.Al, AtotS = col.Ws + col.As;
      var pivY = BASE + col.Hl * 0.75, pivZ = col.zFront - AtotL * 0.42;
      var xs = xf * 0.91 * P.shrinkX;
      var xn = Math.abs(xs) / 0.41;
      var liftS = 0.05 * Math.pow(Math.max(0, xn - 0.45) / 0.55, 2);
      for (k = 0; k < NT; k++) {
        var v = i * NT + k, o = v * 3;
        var t = -1 + 2 * k / (NT - 1), u = 1 - Math.abs(t), sgn = t > 1e-6 ? 1 : t < -1e-6 ? -1 : 0;
        var lam = u;
        var zf = t * c * R;
        // ひらいた皮
        var rr = Math.sqrt(xf * xf + zf * zf) / R, ang = Math.atan2(zf, xf);
        var Fy = BASE + V.edgeA * Math.sin(ang * 7 + V.edgeP) * smooth01((rr - 0.72) / 0.28) +
          0.0025 * Math.sin(ang * 13 + V.edgeP * 2) * smooth01((rr - 0.85) / 0.15);
        var X = xf, Y = Fy, Z = zf, ao = 1;
        if (fold > 0) {
          // 寝た半月
          var csL = crossSection(lam, sgn, col.Wl, col.Al, col.Hl, 1);
          var aL = csL.a, bL = csL.b, gth = 0, pd = 0;
          var wr = this._wr[v] * this._cookGeo * smooth01((lam - 0.2) / 0.3);
          bL += sgn * wr * 0.007;
          if (sgn > 0) {
            this._pleatField(xf, lam, pf);
            pd = pf.d; ao = pf.ao; gth = pf.g;
          }
          var Lx = xf * P.shrinkX + col.wob * (1 - lam) - gth * 0.012 * P.shrinkX;
          var Ly = BASE + Math.abs(bL) + bL + pd;
          var Lz = col.zFront - (AtotL - aL);
          if (st > 0) {
            var csS = crossSection(lam, sgn, col.Ws, col.As, col.Hs, 0.5);
            var bS = csS.b + sgn * wr * 0.008;
            if (sgn > 0) bS += pd * 0.9;
            var Sx = xs - gth * 0.011;
            var Sy = 0.003 + (AtotS - csS.a) + liftS;
            var Sz = bS + bendS * xn * xn - 0.01;
            // 立った形を寝た向きに戻して混ぜ、起き上がりの回転をかける
            var Mx = Lx + (Sx - Lx) * stE, My = Ly + (Sz - Ly) * stE, Mz = Lz + (-Sy - Lz) * stE;
            Lx = Mx; Ly = My * cph - Mz * sph; Lz = My * sph + Mz * cph;
          }
          if (fold >= 1) { X = Lx; Y = Ly; Z = Lz; }
          else if (sgn > 0) {
            // 上の半分: あんのまわりを回りこむように極座標で補間
            var dyF = Fy - pivY, dzF = zf - pivZ, dyL = Ly - pivY, dzL = Lz - pivZ;
            var aF = Math.atan2(dyF, dzF), aLL = Math.atan2(dyL, dzL);
            if (aLL < -PI * 0.5) aLL += PI * 2;
            var rF = Math.sqrt(dyF * dyF + dzF * dzF), rL = Math.sqrt(dyL * dyL + dzL * dzL);
            var fe = fold, an = aF + (aLL - aF) * fe;
            var rad = rF + (rL - rF) * fe;
            rad = Math.max(rad, (col.Hl * 0.9 + 0.02) * Math.sin(fe * PI) * (1 - lam * 0.0));
            X = xf + (Lx - xf) * fe;
            Y = pivY + Math.sin(an) * rad; Z = pivZ + Math.cos(an) * rad;
            ao = 1 + (ao - 1) * fe;
          } else {
            var fe2 = smooth01(fold);
            X = xf + (Lx - xf) * fe2; Y = Fy + (Ly - Fy) * fe2; Z = zf + (Lz - zf) * fe2;
          }
        }
        pos[o] = X; pos[o + 1] = Y; pos[o + 2] = Z; aoA[v] = ao;
        if (Y < minY) minY = Y;
      }
    }
    // 起き上がり途中に床へめりこまないよう持ち上げる
    if (st > 0 && st < 1 && minY < 0.003) {
      var lift = 0.003 - minY;
      for (i = 0; i < this._nv; i++) pos[i * 3 + 1] += lift;
    }
    var g = this._geo;
    var fo = fold >= 0.5;
    if (fo !== this._frontOut) { this._frontOut = fo; g.setIndex(fo ? this._idxOut : this._idxIn); this.uniforms.uFrontOut.value = fo ? 1 : 0; }
    var thk = THICK * (fo ? 1 - 0.75 * fold : -1);
    g.computeVertexNormals();
    // ふちの厚み: 境界の点を外側の面の法線方向へ
    var nrm = g.attributes.normal.array, nv = this._nv;
    for (var e = 0; e < 2; e++) {
      var kk = e === 0 ? 0 : NT - 1;
      for (i = 0; i < NX; i++) {
        var s = (i * NT + kk) * 3, d = (nv + e * NX + i) * 3;
        pos[d] = pos[s] + nrm[s] * thk; pos[d + 1] = pos[s + 1] + nrm[s + 1] * thk; pos[d + 2] = pos[s + 2] + nrm[s + 2] * thk;
        if (pos[d + 1] < 0.0005) pos[d + 1] = 0.0005;
      }
    }
    g.computeVertexNormals();
    g.attributes.position.needsUpdate = true;
    g.attributes.aAO.needsUpdate = true;

    this.uniforms.uClosed.value = smooth01((fold - 0.6) / 0.4);
    this.uniforms.uWetOn.value = 1 - smooth01((fold - 0.3) / 0.5);
    this.uniforms.uFill.value = Math.min(1, this._fill);

    // あんの山（ひらいた皮の上）。たたむと奥へ寄ってつつまれる
    var fm = this.fillMesh;
    var F = this._fill;
    if (F <= 0.01 || fold > 0.97) fm.visible = false;
    else {
      fm.visible = true;
      var r0 = 0.15 + 0.045 * Math.min(F, 2), h0 = 0.075 + 0.05 * Math.min(F, 2);
      var c0 = this._colParams(P, 0, 1);
      var tz = c0.zFront - (c0.Wl + c0.Al) * 0.45, ty = BASE;
      var fe3 = smooth01(fold);
      fm.position.set(0, BASE * 0.6 + (ty - BASE * 0.6) * fe3, tz * fe3);
      var sc = 1 - 0.25 * fe3;
      fm.scale.set(r0 * (1 + 0.5 * fe3) * sc, h0 * (1 - 0.15 * fe3), r0 * sc * (1 - 0.15 * fe3));
    }

    // かじった断面
    var showCap = this._bite === 1;
    this._capSkin.visible = this._capFill.visible = showCap;
    if (showCap) this._updateCaps();
  };

  var KC = Math.round(0.14 * (NT - 1));
  Gyoza.prototype._updateCaps = function () {
    var pos = this._geo.attributes.position.array;
    var mid = (NX - 1) >> 1;
    var cs = this._capSkin.geometry, cf = this._capFill.geometry;
    var sp = cs.attributes.position.array, su = cs.attributes.uv.array;
    var fp = cf.attributes.position.array, fu = cf.attributes.uv.array;
    var cy = 0, cz = 0, n = NT, k;
    for (k = 0; k < n; k++) { var o = (mid * NT + k) * 3; cy += pos[o + 1]; cz += pos[o + 2]; }
    cy /= n; cz /= n;
    // あんの中心は、おなか側（lam の大きい所）に寄せる
    var fy = 0, fz = 0, wsum = 0;
    for (k = 0; k < n; k++) {
      var t = -1 + 2 * k / (NT - 1), lam = 1 - Math.abs(t), w = smooth01((lam - 0.2) / 0.5);
      var o2 = (mid * NT + k) * 3; fy += pos[o2 + 1] * w; fz += pos[o2 + 2] * w; wsum += w;
    }
    fy /= wsum; fz /= wsum;
    for (k = 0; k < n; k++) {
      var o3 = (mid * NT + k) * 3;
      var y = pos[o3 + 1], z = pos[o3 + 2];
      sp[k * 3] = 0.0; sp[k * 3 + 1] = y; sp[k * 3 + 2] = z;
      su[k * 2] = z * 3; su[k * 2 + 1] = y * 3;
      // あんは皮の厚みの分だけ内側に、とじ目の帯にはない
      // あんはとじ目の帯には入らない: 帯の手前（lam≈0.28）の点で止める
      var kc = Math.min(Math.max(k, KC), NT - 1 - KC), o4 = (mid * NT + kc) * 3;
      var yy = pos[o4 + 1], zz = pos[o4 + 2];
      var dy = fy - yy, dz = fz - zz, dl = Math.sqrt(dy * dy + dz * dz) || 1;
      var inset = Math.min(dl * 0.9, 0.014);
      var iy = yy + dy / dl * inset, iz = zz + dz / dl * inset;
      fp[k * 3] = 0.0025; fp[k * 3 + 1] = iy; fp[k * 3 + 2] = iz;
      fu[k * 2] = iz * 2.2 + 0.3; fu[k * 2 + 1] = iy * 2.2 + 0.1;
    }
    sp[n * 3] = 0; sp[n * 3 + 1] = cy; sp[n * 3 + 2] = cz; su[n * 2] = cz * 3; su[n * 2 + 1] = cy * 3;
    fp[n * 3] = 0.0025; fp[n * 3 + 1] = fy; fp[n * 3 + 2] = fz; fu[n * 2] = fz * 2.2 + 0.3; fu[n * 2 + 1] = fy * 2.2 + 0.1;
    cs.attributes.position.needsUpdate = true; cs.attributes.uv.needsUpdate = true;
    cf.attributes.position.needsUpdate = true; cf.attributes.uv.needsUpdate = true;
    cs.computeVertexNormals(); cf.computeVertexNormals();
    cs.computeBoundingSphere(); cf.computeBoundingSphere();
    // 断面の皮は蒸した色
    var ck = this._cook;
    this._capSkin.material.color.setRGB(srgbLin(0.93 - 0.02 * ck), srgbLin(0.90 - 0.03 * ck), srgbLin(0.82 - 0.04 * ck));
  };

  Gyoza.prototype.dispose = function () {
    this._geo.dispose(); this.material.dispose();
    this.fillMesh.geometry.dispose();
    this._capSkin.geometry.dispose(); this._capFill.geometry.dispose(); this._capSkin.material.dispose();
  };

  G.Gyoza = Gyoza;

  /* ------------------------------------------------------------------ */
  /*  G.Wing — パリパリの羽根                                             */
  /* ------------------------------------------------------------------ */
  var WING_FRAG_DECL = [
    'uniform float uGrow, uCrisp;',
    'float gWR, gWN;',
    'vec3 wl(vec3 c){ return pow(c, vec3(2.2)); }'
  ].join('\n');
  var WING_FRAG_MAP = [
    'vec4 wd = texture2D(map, vMapUv);',
    'float T = wd.r, th = wd.g, vein = wd.b, mot = wd.a;',
    'if (T > 0.985 || T > uGrow) discard;',
    'float age = clamp((uGrow - T) / 0.2, 0.0, 1.0);',
    'float cr = clamp(uCrisp * 1.45 - T * 0.45, 0.0, 1.0);',
    'float back = gl_FrontFacing ? 0.0 : 1.0;',
    // 穴: パリパリになるほど開く。羽の前線のほうが薄く穴が多い
    'float thr = cr * (0.38 + 0.32 * T + 0.10 * (1.0 - age));',
    'if (th < thr) discard;',
    'float lip = 1.0 - smoothstep(thr, thr + 0.07, th);',
    // 白い水溶き粉の膜（ぬれて光る、前線は薄くて灰色がかる）
    'vec3 film = mix(wl(vec3(0.55, 0.55, 0.55)), wl(vec3(0.86, 0.855, 0.84)), smoothstep(0.0, 0.6, age) * (0.9 + 0.1 * th));',
    'gWN = 0.3 + 0.7 * smoothstep(0.0, 0.6, cr);',
    // パリパリ: きつね色〜こんがり。筋・穴のふち・鍋のふち・ムラが濃い
    'vec3 c0 = wl(vec3(0.93, 0.80, 0.55));',
    'vec3 c1 = wl(vec3(0.84, 0.60, 0.29));',
    'vec3 c2 = wl(vec3(0.64, 0.38, 0.14));',
    'vec3 c3 = wl(vec3(0.38, 0.19, 0.06));',
    'float br = 0.24 + 0.6 * vein + 0.18 * lip + 0.7 * (mot - 0.35) + 0.15 * back;',
    'br = clamp(br * (0.6 + 0.4 * cr), 0.0, 1.0);',
    'vec3 crisp = br < 0.33 ? mix(c0, c1, br * 3.0) : br < 0.66 ? mix(c1, c2, br * 3.0 - 1.0) : mix(c2, c3, br * 3.0 - 2.0);',
    'vec3 mid = wl(vec3(0.93, 0.88, 0.76));',
    'vec3 col = cr < 0.5 ? mix(film, mid, cr * 2.0) : mix(mid, crisp, cr * 2.0 - 1.0);',
    'diffuseColor.rgb = col;',
    'gWR = mix(0.07, 0.50 - 0.15 * vein, smoothstep(0.0, 0.7, cr));'
  ].join('\n');

  function wingOnBeforeCompile(shader) {
    var u = this.userData.uniforms;
    for (var k in u) shader.uniforms[k] = u[k];
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WING_FRAG_DECL)
      .replace('#include <map_fragment>', WING_FRAG_MAP)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gWR;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mix(nonPerturbedNormal, normal, gWN));');
  }
  function wingCacheKey() { return 'gyoza-wing-v1'; }

  var WS = 512;      // 羽根のデータテクスチャの解像度
  var WN = 64;       // 円盤の格子

  function Wing(opts) {
    opts = opts || {};
    this.radius = opts.radius || 1.12;
    this.group = new THREE.Group();
    this.group.name = 'wing';
    this.pieces = [];
    this.uniforms = { uGrow: { value: 0 }, uCrisp: { value: 0 } };
    this._data = new Uint8Array(WS * WS * 4);
    this.dataTex = new THREE.DataTexture(this._data, WS, WS, THREE.RGBAFormat);
    this.dataTex.magFilter = THREE.LinearFilter; this.dataTex.minFilter = THREE.LinearFilter;
    this.dataTex.generateMipmaps = false;
    this.dataTex.needsUpdate = true;
    this._nCanvas = U.canvas(WS);
    this.normalTex = U.canvasTex(this._nCanvas, { srgb: false });
    this.material = new THREE.MeshStandardMaterial({
      map: this.dataTex, normalMap: this.normalTex, normalScale: new THREE.Vector2(1.0, 1.0),
      roughness: 0.5, metalness: 0, side: THREE.DoubleSide
    });
    this.material.userData.uniforms = this.uniforms;
    this.material.onBeforeCompile = wingOnBeforeCompile;
    this.material.customProgramCacheKey = wingCacheKey;
  }

  Wing.prototype.setGrow = function (v) { this.uniforms.uGrow.value = U.clamp01(v); return this; };
  Wing.prototype.setCrisp = function (v) { this.uniforms.uCrisp.value = U.clamp01(v); return this; };

  /* 6個のぎょうざの配置から、羽根のパターンとかけらを作る（1回だけ） */
  Wing.prototype.layout = function (list) {
    var Rw = this.radius, self = this;
    this._list = list.map(function (g) {
      return { x: g.x, z: g.z, rot: g.rot || 0, pleats: (g.pleats || [1, 1, 1, 1, 1, 1, 1]).slice() };
    });
    this._makeData();
    // かけら
    for (var i = 0; i < this.pieces.length; i++) {
      this.group.remove(this.pieces[i].group);
      this.pieces[i].mesh.geometry.dispose();
    }
    this.pieces = [];
    var L = this._list, n = L.length;
    var cellOf = function (x, z) {
      var best = 0, bd = 1e9;
      var jx = (U.fbm(x * 5 + 3, z * 5 + 7, 71, 3) - 0.5) * 0.16, jz = (U.fbm(x * 5 + 11, z * 5 + 1, 72, 3) - 0.5) * 0.16;
      for (var j = 0; j < n; j++) {
        var dx = x + jx - L[j].x, dz = z + jz - L[j].z, d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = j; }
      }
      return best;
    };
    var h = (2 * Rw) / WN;
    var vy = function (x, z) {
      var r = Math.sqrt(x * x + z * z) / Rw;
      return 0.006 + (U.fbm(x * 2.5 + 1, z * 2.5 + 2, 81, 3) - 0.5) * 0.012 + 0.03 * Math.pow(Math.max(0, r - 0.86) / 0.14, 2);
    };
    var buckets = [];
    for (i = 0; i < n; i++) buckets.push({ pos: [], uv: [], idx: [], map: {} });
    function vid(b, gx, gz, cx, cz) {
      var key = gx * 1000 + gz;
      if (b.map[key] != null) return b.map[key];
      var x = -Rw + gx * h, z = -Rw + gz * h;
      var id = b.pos.length / 3;
      b.pos.push(x - cx, vy(x, z), z - cz);
      b.uv.push(x / (2 * Rw) + 0.5, 1 - (z / (2 * Rw) + 0.5));
      b.map[key] = id;
      return id;
    }
    for (var gz = 0; gz < WN; gz++) {
      for (var gx = 0; gx < WN; gx++) {
        var x0 = -Rw + gx * h, z0 = -Rw + gz * h;
        for (var tri = 0; tri < 2; tri++) {
          var cx = x0 + h * (tri ? 0.66 : 0.33), cz = z0 + h * (tri ? 0.66 : 0.33);
          if (Math.sqrt(cx * cx + cz * cz) > Rw * 1.01) continue;
          var ci = cellOf(cx, cz), b = buckets[ci];
          var ox = L[ci].x, oz = L[ci].z;
          var a, bb, c;
          if (tri === 0) { a = vid(b, gx, gz, ox, oz); bb = vid(b, gx, gz + 1, ox, oz); c = vid(b, gx + 1, gz, ox, oz); }
          else { a = vid(b, gx + 1, gz, ox, oz); bb = vid(b, gx, gz + 1, ox, oz); c = vid(b, gx + 1, gz + 1, ox, oz); }
          b.idx.push(a, bb, c);
        }
      }
    }
    for (i = 0; i < n; i++) {
      var B = buckets[i];
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
      geo.setIndex(B.idx);
      geo.computeVertexNormals();
      var mesh = new THREE.Mesh(geo, this.material);
      mesh.receiveShadow = true; mesh.castShadow = false;
      var grp = new THREE.Group();
      grp.position.set(L[i].x, 0, L[i].z);
      grp.add(mesh);
      this.group.add(grp);
      self.pieces.push({ group: grp, mesh: mesh, center: new THREE.Vector3(L[i].x, 0, L[i].z) });
    }
    return this;
  };

  Wing.prototype._makeData = function () {
    var Rw = this.radius, S = WS, L = this._list, n = L.length;
    var px = 2 * Rw / S;
    var N = S * S;
    var T = new Float32Array(N), TH = new Float32Array(N), VE = new Float32Array(N), FW = new Float32Array(N), FT = new Float32Array(N), BR = new Float32Array(N);
    var HG = new Float32Array(N);
    var i, x, y, j, idx;
    var rnd = U.rng(4242);
    // 低解像度の fbm を前計算して双線形に読む（速さのため）
    function fbmGrid(res, freq, seed, oct) {
      var a = new Float32Array((res + 1) * (res + 1));
      for (var gy = 0; gy <= res; gy++) for (var gx = 0; gx <= res; gx++) a[gy * (res + 1) + gx] = U.fbm(gx / res * freq, gy / res * freq, seed, oct);
      return function (wx, wz) {
        var fx = U.clamp((wx + Rw) / (2 * Rw), 0, 0.9999) * res, fz = U.clamp((wz + Rw) / (2 * Rw), 0, 0.9999) * res;
        var ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, w = res + 1, k = iz * w + ix;
        var a0 = a[k] + (a[k + 1] - a[k]) * tx, a1 = a[k + w] + (a[k + w + 1] - a[k + w]) * tx;
        return a0 + (a1 - a0) * tz;
      };
    }
    var fLow = fbmGrid(64, 6, 91, 4), fMid = fbmGrid(128, 22, 92, 3), fHi = fbmGrid(256, 60, 95, 2);
    // 穴（泡の跡）: セルごとに大きさの違う丸い穴。min(距離/半径) を返す（<1 で穴の中）
    function holeField(cell, rmin, rmax, seed) {
      var gn = Math.ceil(2 * Rw / cell) + 3, pts = new Float32Array(gn * gn * 3), r2 = U.rng(seed);
      for (var q = 0; q < gn * gn; q++) { pts[q * 3] = r2(); pts[q * 3 + 1] = r2(); pts[q * 3 + 2] = (rmin + (rmax - rmin) * Math.pow(r2(), 1.6)) * cell; }
      return function (fx, fz) { // fx,fz はセル単位の座標（引き伸ばし済み）
        var ix = Math.floor(fx), iz = Math.floor(fz), m = 9;
        for (var dz = -1; dz <= 1; dz++) for (var dx = -1; dx <= 1; dx++) {
          var cx = ((ix + dx) % gn + gn) % gn, cz = ((iz + dz) % gn + gn) % gn;
          var k = (cz * gn + cx) * 3, ex = ix + dx + pts[k] - fx, ez = iz + dz + pts[k + 1] - fz;
          var d = Math.sqrt(ex * ex + ez * ez) * cell / pts[k + 2];
          if (d < m) m = d;
        }
        return m;
      };
    }
    var CA = 0.075, CB = 0.038, CF = 0.026;
    var hA = holeField(CA, 0.36, 0.72, 13), hB = holeField(CB, 0.40, 0.72, 14), hF = holeField(CF, 0.45, 0.75, 15), hBub = holeField(0.02, 0.15, 0.4, 16);
    // 1) ぎょうざの足あと・距離・一般の到達時刻・基本のレース
    var gy = L.map(function (g) { return { x: g.x, z: g.z, c: Math.cos(g.rot), s: Math.sin(g.rot) }; });
    var pleatSparse = L.map(function (g) { var c = 0; for (var q = 0; q < 7; q++) c += (g.pleats[q] || 0) > 0 ? 1 : 0; return 1 - c / 7; });
    for (y = 0; y < S; y++) {
      var wz = -Rw + (y + 0.5) * px;
      for (x = 0; x < S; x++) {
        var wx = -Rw + (x + 0.5) * px;
        idx = y * S + x;
        var rr = Math.sqrt(wx * wx + wz * wz) / Rw;
        var dmin = 9, inside = false, jmin = 0;
        for (j = 0; j < n; j++) {
          var dx = wx - gy[j].x, dz = wz - gy[j].z;
          var lx = dx * gy[j].c - dz * gy[j].s, lz = dx * gy[j].s + dz * gy[j].c;
          var ex = lx / 0.39, ez = lz / 0.155, e = Math.sqrt(ex * ex + ez * ez);
          if (e < 0.9) inside = true;
          var dd = (e - 1) * 0.155; if (dd < dmin) { dmin = dd; jmin = j; }
        }
        var nl = fLow(wx, wz), nm = fMid(wx, wz), nh = fHi(wx, wz);
        var tg = 0.60 + 0.34 * smooth01(Math.max(0, dmin) / 0.75) + (nl - 0.5) * 0.16 + (nm - 0.5) * 0.05;
        if (inside || rr > 0.985) tg = 2;
        T[idx] = tg;
        // 基本のレース（ひだの少ない所＝穴が大きくまばら）
        var mA = hA(wx / CA + 50, wz / CA + 50), mB = hB(wx / CB + 50, wz / CB + 50);
        var th = Math.min(mA, mB * 1.12) * 0.62 + (nm - 0.5) * 0.30 + (nh - 0.5) * 0.12;
        var near = smooth01(1 - Math.max(0, dmin) / 0.07);
        // ひだの少ないぎょうざの周りは、地のレースがまばら（穴が大きい）。羽のふさだけがはっきり残る
        th -= pleatSparse[jmin] * 0.5 * (1 - near) * (1 - smooth01((rr - 0.9) / 0.07));
        th += 0.7 * near + 0.5 * smooth01((rr - 0.9) / 0.07);
        TH[idx] = th;
        BR[idx] = smooth01((rr - 0.82) / 0.15) * 0.8 + (nl - 0.5) * 0.7 + (nm - 0.5) * 0.3 + near * 0.25;
        var mb = hBub(wx / 0.02 + 7, wz / 0.02 + 7);
        HG[idx] = (mb < 1 ? (1 - mb) * 0.3 : 0) + nh * 0.08;
      }
    }
    // 2) ひだのスロットから伸びる羽（鳥の羽/葉の形のふさ）
    for (j = 0; j < n; j++) {
      var g = L[j], cR = Math.cos(g.rot), sR = Math.sin(g.rot);
      for (var sl = 0; sl < 7; sl++) {
        var pv = g.pleats[sl] || 0; if (pv <= 0) continue;
        for (var side = -1; side <= 1; side += 2) {
          var lx0 = (sl - 3) * SLOT_DX * 0.91 + (rnd() - 0.5) * 0.02;
          var lz0 = side * 0.12;
          var fan = (lx0 / 0.41) * 0.6 + (rnd() - 0.5) * 0.25;
          var ldx = Math.sin(fan), ldz = side * Math.cos(fan);
          // ローカル → 羽根の座標（rotation.y = rot）
          var bx = g.x + lx0 * cR + lz0 * sR, bz = g.z - lx0 * sR + lz0 * cR;
          var dxw = ldx * cR + ldz * sR, dzw = -ldx * sR + ldz * cR;
          var pxw = -dzw, pzw = dxw;
          var Lf = (side > 0 ? 0.64 : 0.52) * (0.85 + 0.3 * rnd()) * (0.6 + 0.4 * pv);
          var Wf = 0.09 * (0.85 + 0.3 * rnd());
          var bend = (rnd() - 0.5) * 0.4;
          var spacing = 0.036 + rnd() * 0.008, bAng = 0.8 + rnd() * 0.4;
          var bbR = Math.max(Lf, Wf) + 0.05;
          var x0 = Math.max(0, Math.floor((bx - bbR + Rw) / px)), x1 = Math.min(S - 1, Math.ceil((bx + bbR + Rw) / px));
          var y0 = Math.max(0, Math.floor((bz - bbR + Rw) / px)), y1 = Math.min(S - 1, Math.ceil((bz + bbR + Rw) / px));
          var ph = rnd() * 10, offA = rnd() * 40, offC = rnd() * 40;
          for (y = y0; y <= y1; y++) {
            var wz2 = -Rw + (y + 0.5) * px;
            for (x = x0; x <= x1; x++) {
              idx = y * S + x;
              if (T[idx] > 1.5) continue;
              var wx2 = -Rw + (x + 0.5) * px;
              var rx = wx2 - bx, rz = wz2 - bz;
              var al = rx * dxw + rz * dzw;
              var v = al / Lf;
              if (v < 0 || v > 1) continue;
              var ac = rx * pxw + rz * pzw - bend * v * v * Lf;
              var hw = Wf * Math.pow(Math.sin(PI * Math.min(1, v * 0.9 + 0.1)), 0.6) * (1.1 - 0.35 * v);
              var r = Math.abs(ac) / hw;
              var edgeN = fMid(wx2 * 1.7, wz2 * 1.7);
              if (r > 1.05 - 0.3 * edgeN) continue;
              var tf = 0.03 + 0.40 * v + 0.16 * r * r + (edgeN - 0.5) * 0.03;
              if (tf < T[idx]) T[idx] = tf;
              var rach = Math.exp(-(ac * ac) / (0.011 * 0.011)) * (0.75 - 0.45 * v);
              var phs = (al - Math.abs(ac) * bAng) / spacing + ph + (fMid(wx2 * 2.3, wz2 * 2.3) - 0.5) * 1.2;
              var fp = phs - Math.floor(phs), dl = Math.min(fp, 1 - fp);
              var barb = smooth01(1 - dl / 0.24) * (1 - 0.5 * r) * (0.55 + 0.45 * fHi(wx2 * 0.5, wz2 * 0.5));
              var vein = Math.max(rach, barb * 0.8);
              if (vein > VE[idx]) VE[idx] = vein;
              // 羽の中の網目: 羽の向きに細長い穴。筋（barb）の所は穴があかない
              var mF = hF((al + offA) / (CF * 2.0), (ac + offC) / CF);
              var thf = mF * 0.6 + (edgeN - 0.5) * 0.2;
              thf = Math.max(thf, vein * 0.95) + 0.25 * (1 - v) * (1 - v);
              var w = smooth01((1 - r) / 0.4);
              if (w > FW[idx]) { FW[idx] = w; FT[idx] = thf; }
              else if (w > 0.25) FT[idx] = Math.min(FT[idx], thf) * 0.5 + FT[idx] * 0.5;
            }
          }
        }
      }
    }
    // 3) まとめてテクスチャへ
    var d = this._data, hc = this._nCanvas.getContext('2d'), himg = hc.createImageData(S, S), hd = himg.data;
    for (i = 0; i < N; i++) {
      var th2 = TH[i] * (1 - FW[i]) + FT[i] * FW[i];
      if (FW[i] > 0) th2 += (TH[i] > 1.2 ? (TH[i] - 1.2) * FW[i] : 0);
      th2 = Math.max(0, Math.min(1, th2));
      var hgt = th2 * 0.5 + VE[i] * 0.3 + HG[i];
      var tt = T[i] > 1.5 ? 1 : Math.min(0.97, Math.max(0, T[i]));
      d[i * 4] = tt * 255;
      d[i * 4 + 1] = th2 * 255;
      d[i * 4 + 2] = Math.min(1, VE[i]) * 255;
      d[i * 4 + 3] = U.clamp01(0.35 + BR[i]) * 255;
      var hv = Math.min(255, hgt * 220);
      hd[i * 4] = hd[i * 4 + 1] = hd[i * 4 + 2] = hv; hd[i * 4 + 3] = 255;
    }
    // DataTexture は flipY なし: 行 0 が v=0。uv の v = 1 - (z 正規化) にあわせて上下反転して入れる
    var tmp = new Uint8Array(S * 4);
    for (y = 0; y < S / 2; y++) {
      var a0 = y * S * 4, a1 = (S - 1 - y) * S * 4;
      tmp.set(d.subarray(a0, a0 + S * 4)); d.copyWithin(a0, a1, a1 + S * 4); d.set(tmp, a1);
    }
    this.dataTex.needsUpdate = true;
    hc.putImageData(himg, 0, 0);
    var nc = U.normalFromHeight(this._nCanvas, 2.0);
    this._nCanvas.getContext('2d').drawImage(nc, 0, 0);
    this.normalTex.needsUpdate = true;
  };

  Wing.prototype.dispose = function () {
    this.pieces.forEach(function (p) { p.mesh.geometry.dispose(); });
    this.dataTex.dispose(); this.normalTex.dispose(); this.material.dispose();
  };

  G.Wing = Wing;
})();

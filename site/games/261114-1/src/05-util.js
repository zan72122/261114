/* 05-util.js — 共有の小道具（乱数・ノイズ・Canvasテクスチャ・イージング）。全モジュールがここだけに依存してよい。 */
(function () {
  'use strict';
  var G = (window.G = window.G || {});
  var U = (G.util = {});

  U.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  U.clamp01 = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  U.lerp = function (a, b, t) { return a + (b - a) * t; };
  U.invLerp = function (a, b, v) { return U.clamp01((v - a) / (b - a)); };
  U.smooth = function (a, b, v) { var t = U.clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  U.damp = function (cur, target, lambda, dt) { return U.lerp(cur, target, 1 - Math.exp(-lambda * dt)); };

  /* 種つき乱数（mulberry32）。rng() は [0,1) */
  U.rng = function (seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  function hash2(ix, iy, seed) {
    var h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  /* 値ノイズ [0,1]。period を渡すとその周期でタイル可能 */
  U.noise2 = function (x, y, seed, period) {
    var ix = Math.floor(x), iy = Math.floor(y);
    var fx = x - ix, fy = y - iy;
    var ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    var x0 = ix, x1 = ix + 1, y0 = iy, y1 = iy + 1;
    if (period) {
      x0 = ((x0 % period) + period) % period; x1 = ((x1 % period) + period) % period;
      y0 = ((y0 % period) + period) % period; y1 = ((y1 % period) + period) % period;
    }
    var a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  /* fbm [0,1]。period を渡すとタイル可能（各オクターブで周期を倍に） */
  U.fbm = function (x, y, seed, octaves, period) {
    var sum = 0, amp = 0.5, norm = 0, f = 1;
    for (var i = 0; i < (octaves || 4); i++) {
      sum += amp * U.noise2(x * f, y * f, (seed | 0) + i * 17, period ? period * f : 0);
      norm += amp; amp *= 0.5; f *= 2;
    }
    return sum / norm;
  };

  U.canvas = function (w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h || w;
    return c;
  };

  /* ───── 裏の読み込み（起動を速くする） ─────
     起動中（BG.draft=true）に作る重い手続きテクスチャは、まず縦横 1/2〜1/4 の粗い版を同じ大きさの Canvas に
     引き伸ばして出し、本番の解像度は遊んでいる間に少しずつ（1フレーム数ミリ秒まで）描いて同じ Canvas に書き戻す。
     Canvas の大きさは変えないので、それを使うテクスチャは needsUpdate だけで差し替わる。 */
  var BG = (U.bg = { jobs: [], draft: false, busy: false, deadline: 0 });
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
  BG.add = function (it, first) { if (first) BG.jobs.unshift(it); else BG.jobs.push(it); BG.busy = true; };
  BG.over = function () { return now() >= BG.deadline; };
  /* ms ミリ秒まで仕事を進める。残りがあれば true */
  BG.run = function (ms) {
    BG.deadline = now() + ms;
    while (BG.jobs.length) {
      var it = BG.jobs[0], r;
      try { r = it.next(); } catch (e) { r = { done: true }; try { console.error('[bg]', e); } catch (_) { /* noop */ } }
      if (r.done) BG.jobs.shift();
      if (BG.over()) break;
    }
    BG.busy = BG.jobs.length > 0;
    return BG.busy;
  };
  /* 粗い版の間引き幅（1=そのまま）。短い辺が 128px を下回らない範囲で 2 か 4 */
  U.draftStep = function (w, h) {
    if (!BG.draft) return 1;
    var m = Math.min(w, h);
    return m >= 512 ? 4 : m >= 256 ? 2 : 1;
  };
  /* Canvas を使うテクスチャに描き直しを知らせる */
  U.touchCanvas = function (c) {
    var ts = c && c._texs;
    if (ts) for (var i = 0; i < ts.length; i++) ts[i].needsUpdate = true;
  };
  function stretchInto(dst, src) {
    var x = dst.getContext('2d');
    x.imageSmoothingEnabled = true;
    try { x.imageSmoothingQuality = 'high'; } catch (_) { /* noop */ }
    x.drawImage(src, 0, 0, dst.width, dst.height);
  }
  /* 画素ごとに描く Canvas を「今すぐ粗く＋裏で本番」で作る共通部。
     rows(datas, bw, y0, y1, d): 幅 bw の画像の y0..y1 行を、元の画素 (x*d, y*d) の値で埋める */
  U.progressivePixels = function (w, h, n, rows, keep) {
    var outs = [], i;
    for (i = 0; i < n; i++) outs.push(U.canvas(w, h));
    var d = U.draftStep(w, h);
    if (d <= 1) {
      var ds = outs.map(function (c) { return c.getContext('2d').createImageData(w, h); });
      rows(ds.map(function (im) { return im.data; }), w, 0, h, 1);
      for (i = 0; i < n; i++) outs[i].getContext('2d').putImageData(ds[i], 0, 0);
      if (keep >= 0) outs[keep]._px = { d: ds[keep].data, w: w, h: h };
      return outs;
    }
    var sw = Math.ceil(w / d), sh = Math.ceil(h / d);
    var smalls = [], sd = [];
    for (i = 0; i < n; i++) { smalls.push(U.canvas(sw, sh)); sd.push(smalls[i].getContext('2d').createImageData(sw, sh)); }
    rows(sd.map(function (im) { return im.data; }), sw, 0, sh, d);
    for (i = 0; i < n; i++) { smalls[i].getContext('2d').putImageData(sd[i], 0, 0); stretchInto(outs[i], smalls[i]); }
    if (keep >= 0) outs[keep]._px = { d: sd[keep].data, w: sw, h: sh };
    BG.add((function* () {
      var fd = outs.map(function (c) { return c.getContext('2d').createImageData(w, h); });
      var arr = fd.map(function (im) { return im.data; });
      for (var y = 0; y < h; y++) { rows(arr, w, y, y + 1, 1); if (BG.over()) yield; }
      for (var k = 0; k < n; k++) { outs[k].getContext('2d').putImageData(fd[k], 0, 0); U.touchCanvas(outs[k]); }
      if (keep >= 0) outs[keep]._px = { d: fd[keep].data, w: w, h: h };
    })());
    return outs;
  };

  /* Canvas → THREE.CanvasTexture。opts: {srgb:true(色), repeat:[u,v], aniso:4} */
  U.canvasTex = function (canvas, opts) {
    opts = opts || {};
    var t = new THREE.CanvasTexture(canvas);
    if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
    if (opts.repeat) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(opts.repeat[0], opts.repeat[1]);
    }
    t.anisotropy = opts.aniso || 4;
    t.needsUpdate = true;
    (canvas._texs || (canvas._texs = [])).push(t);
    return t;
  };
  /* ピクセル関数から Canvas を作る: fn(u,v,x,y) → [r,g,b,a] (0..255) */
  U.pixelCanvas = function (w, h, fn) {
    return U.progressivePixels(w, h, 1, function (D, bw, y0, y1, d) {
      var dd = D[0];
      for (var y = y0; y < y1; y++) {
        var Y = Math.min(h - 1, y * d), p = y * bw * 4;
        for (var x = 0; x < bw; x++) {
          var X = Math.min(w - 1, x * d);
          var px = fn(X / w, Y / h, X, Y);
          dd[p++] = px[0]; dd[p++] = px[1]; dd[p++] = px[2]; dd[p++] = px.length > 3 ? px[3] : 255;
        }
      }
    }, 0)[0];
  };
  function normalRows(src, w, h, strength, d, y0, y1) {
    function H(x, y) { x = (x + w) % w; y = (y + h) % h; return src[(y * w + x) * 4] / 255; }
    for (var y = y0; y < y1; y++) {
      for (var x = 0; x < w; x++) {
        var dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
        var l = 1 / Math.sqrt(dx * dx + dy * dy + 1), p = (y * w + x) * 4;
        d[p] = (-dx * l * 0.5 + 0.5) * 255; d[p + 1] = (dy * l * 0.5 + 0.5) * 255; d[p + 2] = (l * 0.5 + 0.5) * 255; d[p + 3] = 255;
      }
    }
  }
  /* Canvas の画素を読む。作った時の画素が残っていればそれを使う（GPU からの読み戻し getImageData は遅い） */
  function pixelsOf(c) {
    var px = c._px;
    if (px && px.w === c.width && px.h === c.height) return px.d;
    return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  }
  /* 高さ Canvas(グレースケール) → 法線マップ Canvas。strength は凹凸の強さ。
     起動中は粗い版を返し、本番は裏で（高さ Canvas の本番が描けた後に）書き戻す。exact=true なら必ず今すぐ本番 */
  U.normalFromHeight = function (heightCanvas, strength, exact) {
    var w = heightCanvas.width, h = heightCanvas.height;
    var out = U.canvas(w, h), octx = out.getContext('2d');
    strength = strength || 2;
    var d = exact ? 1 : U.draftStep(w, h);
    if (d <= 1) {
      var src = pixelsOf(heightCanvas);
      heightCanvas._px = null;
      var img = octx.createImageData(w, h);
      normalRows(src, w, h, strength, img.data, 0, h);
      octx.putImageData(img, 0, 0);
      return out;
    }
    // 粗い版: 作った時の粗い画素があればそれから。無い（Canvas に線や円で描いた）高さは、読み戻しが重いので
    // 起動中は平らな法線にしておき、本番を裏の仕事の先頭に積む（元の Canvas はもう出来上がっている）
    var px = heightCanvas._px, first = !(px && px.w < w);
    if (!first) {
      var sw = px.w, sh = px.h;
      var sc = U.canvas(sw, sh), sx = sc.getContext('2d'), simg = sx.createImageData(sw, sh);
      normalRows(px.d, sw, sh, strength * sw / w, simg.data, 0, sh);
      sx.putImageData(simg, 0, 0);
      stretchInto(out, sc);
    } else {
      octx.fillStyle = 'rgb(128,128,255)'; octx.fillRect(0, 0, w, h);
    }
    // 高さ Canvas の本番は先に積まれているので、順に進めればこの時点で描けている
    BG.add((function* () {
      var src2 = pixelsOf(heightCanvas);
      heightCanvas._px = null;
      var img2 = octx.createImageData(w, h);
      for (var y = 0; y < h; y += 8) { normalRows(src2, w, h, strength, img2.data, y, Math.min(h, y + 8)); if (BG.over()) yield; }
      octx.putImageData(img2, 0, 0);
      U.touchCanvas(out);
    })(), first);
    return out;
  };

  G.ease = {
    linear: function (t) { return t; },
    inQuad: function (t) { return t * t; },
    outQuad: function (t) { return t * (2 - t); },
    inOutQuad: function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; },
    outCubic: function (t) { return 1 - Math.pow(1 - t, 3); },
    inCubic: function (t) { return t * t * t; },
    inOutCubic: function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; },
    outBack: function (t) { var c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
    outElastic: function (t) { return t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1; },
    outBounce: function (t) {
      var n = 7.5625, d = 2.75;
      if (t < 1 / d) return n * t * t;
      if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
      if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
      return n * (t -= 2.625 / d) * t + 0.984375;
    }
  };
})();

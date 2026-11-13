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
    return t;
  };
  /* ピクセル関数から Canvas を作る: fn(u,v,x,y) → [r,g,b,a] (0..255) */
  U.pixelCanvas = function (w, h, fn) {
    var c = U.canvas(w, h), ctx = c.getContext('2d');
    var img = ctx.createImageData(w, h), d = img.data, p = 0;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var px = fn(x / w, y / h, x, y);
        d[p++] = px[0]; d[p++] = px[1]; d[p++] = px[2]; d[p++] = px.length > 3 ? px[3] : 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  };
  /* 高さ Canvas(グレースケール) → 法線マップ Canvas。strength は凹凸の強さ */
  U.normalFromHeight = function (heightCanvas, strength) {
    var w = heightCanvas.width, h = heightCanvas.height;
    var src = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;
    var out = U.canvas(w, h), octx = out.getContext('2d');
    var img = octx.createImageData(w, h), d = img.data;
    strength = strength || 2;
    function H(x, y) { x = (x + w) % w; y = (y + h) % h; return src[(y * w + x) * 4] / 255; }
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
        var l = 1 / Math.sqrt(dx * dx + dy * dy + 1), p = (y * w + x) * 4;
        d[p] = (-dx * l * 0.5 + 0.5) * 255; d[p + 1] = (dy * l * 0.5 + 0.5) * 255; d[p + 2] = (l * 0.5 + 0.5) * 255; d[p + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
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

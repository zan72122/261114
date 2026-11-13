/* 90-main.js — 起動 */
(function () {
  'use strict';
  var G = (window.G = window.G || {});

  function err(tag, e) { try { console.error('[main.' + tag + ']', e); } catch (_) { /* noop */ } }
  function tryDo(tag, fn) { try { return fn(); } catch (e) { err(tag, e); return undefined; } }

  function fallback() {
    try {
      var c = document.getElementById('c');
      if (c) c.style.display = 'none';
      var f = document.getElementById('fade');
      if (f) f.style.display = 'none';
      var src = window.G_FALLBACK_IMG;
      var img = document.getElementById('fb');
      if (src && img) { img.src = src; img.style.display = 'block'; }
    } catch (e) { err('fallback', e); }
  }

  function boot() {
    var ok = false;
    try { ok = !!(G.core && G.core.init(document.getElementById('c'))); } catch (e) { err('init', e); ok = false; }
    if (!ok) { fallback(); return; }

    tryDo('state', function () { G.state.load(); });
    tryDo('world', function () { if (G.world && G.world.build) G.world.build(G.core.scene, G.core.renderer); });

    var scene = G.core.scene;
    var shared = (G.shared = { gyozas: [], wing: null, tray: null, plate: null });
    function hideAdd(obj) { if (obj && obj.isObject3D) { obj.visible = false; if (!obj.parent) scene.add(obj); } }
    tryDo('gyozas', function () {
      if (!G.Gyoza) return;
      var data = G.state.data;
      for (var i = 0; i < 6; i++) {
        var gd = (data.gyoza && data.gyoza[i]) || { pleats: [0, 0, 0, 0, 0, 0, 0], fill: 1 };
        var g = tryDo('gyoza' + i, function () { return new G.Gyoza({ pleats: gd.pleats.slice(), fill: gd.fill, seed: i + 1, mama: i < 3 }); });
        if (g) { shared.gyozas.push(g); hideAdd(g.group); }
      }
    });
    tryDo('wing', function () { if (G.Wing) { shared.wing = new G.Wing({ radius: 1.05 }); hideAdd(shared.wing.group); } });
    tryDo('tray', function () { if (G.props && G.props.tray) { shared.tray = G.props.tray(); hideAdd(shared.tray); } });
    tryDo('plate', function () { if (G.props && G.props.plate) { shared.plate = G.props.plate(); hideAdd(shared.plate); } });

    var st = G.flow.stations;
    Object.keys(st).forEach(function (k) { if (st[k] && typeof st[k].build === 'function') tryDo('build.' + k, function () { st[k].build(); }); });

    var first = null, hash = (location.hash || '').replace('#', '');
    if (hash && st[hash] && hash !== 'end') first = hash;
    if (!first) {
      var s = G.state.data.station;
      if (s && st[s] && s !== 'end') first = s;
      else { tryDo('reset', function () { G.state.reset(); }); first = 'wrap'; }
    }

    G.core.start();
    tryDo('go', function () { G.flow.go(first); });
    G.core.fade(0, 0.8);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

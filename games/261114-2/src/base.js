// base.js — 全モジュール共通の小道具（司令塔が管理。実装役は編集しない）
// 前提: THREE (r160) と ASSETS が同じスコープにある。
const Base = (() => {
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const sat = x => clamp(x, 0, 1);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = t => { t = sat(t); return t * t * (3 - 2 * t); };
  // フレームレートに依らない追従: a を b へ（lambda が大きいほど速い）
  const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
  // 種つき乱数（mulberry32）
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 品質設定（game.js が書き換える。各モジュールは init 時と update 時に参照してよい）
  const quality = { low: false, shadows: true, maxDpr: 2 };

  // 本番・確認用で共通のレンダラ設定。失敗時は null を返す（例外を投げない）
  function makeRenderer(canvas) {
    let r = null;
    try {
      r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch (e) { return null; }
    if (!r || !r.getContext()) return null;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.setClearColor(0xd9d2c5, 1);
    // シェーダーのエラー確認（getProgramInfoLog 等）は GPU と同期して止まるので本番では行わない
    r.debug.checkShaderErrors = false;
    return r;
  }

  // 写り込み用の環境マップ（手続き生成の「昼のリビング」）。scene.environment に入れる
  function makeEnv(renderer) {
    const s = new THREE.Scene();
    const box = (w, h, d, x, y, z, color, k) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.set(x, y, z); s.add(m); return m;
    };
    box(8, 0.1, 8, 0, 2.6, 0, 0xfff6ea, 1.25);   // 天井
    box(8, 0.1, 8, 0, -0.05, 0, 0x9a7650, 0.55); // 床（木）
    box(0.1, 3, 8, -4, 1.3, 0, 0xf2ece2, 0.9);   // 西の壁
    box(0.1, 3, 8, 4, 1.3, 0, 0xf2ece2, 0.75);   // 東の壁
    box(8, 3, 0.1, 0, 1.3, -4, 0xf2ece2, 0.85);  // 北の壁
    box(8, 3, 0.1, 0, 1.3, 4, 0xefe6d8, 0.7);    // 南の壁
    box(0.05, 1.5, 2.2, -3.9, 1.45, -0.6, 0xffffff, 9.0); // 西の窓（明るい）
    box(0.05, 1.3, 1.4, -3.9, 1.45, 2.0, 0xffffff, 6.0);  // 窓その2
    box(1.6, 0.04, 1.0, 0.4, 2.52, 0.6, 0xfff1dc, 3.0);   // 天井の照明
    const pm = new THREE.PMREMGenerator(renderer);
    const tex = pm.fromScene(s, 0.035).texture;
    pm.dispose();
    s.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    return tex;
  }

  // Canvas で描くテクスチャ。o: {srgb=true, repeat:[u,v], aniso}
  function canvasTex(w, h, draw, o) {
    o = o || {};
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = o.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    if (o.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(o.repeat[0], o.repeat[1]); }
    t.anisotropy = o.aniso || 4;
    return t;
  }

  // 確認用（preview）専用の仮ライト。本番の照明は Room が持つ
  function previewLights(scene) {
    const hemi = new THREE.HemisphereLight(0xfff4e6, 0x8a6f55, 1.1);
    const sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
    sun.position.set(-2.2, 3.2, 1.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const c = sun.shadow.camera; c.left = -2.2; c.right = 2.2; c.top = 2.6; c.bottom = -2.6; c.near = 0.5; c.far = 9;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02; sun.shadow.radius = 4;
    scene.add(hemi, sun);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ color: 0xb08a62, roughness: 0.6 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    return { hemi, sun, floor };
  }

  return { clamp, sat, lerp, smooth, damp, rng, quality, makeRenderer, makeEnv, canvasTex, previewLights };
})();

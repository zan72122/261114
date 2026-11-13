// Small visual helpers for the game: tiny additive glints (sparkles).
import * as THREE from 'three';

function glintTexture() {
  const S = 64, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.18, 'rgba(255,246,220,0.85)');
  gr.addColorStop(0.45, 'rgba(255,226,170,0.22)');
  gr.addColorStop(1, 'rgba(255,220,160,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  // faint four-point star
  g.globalCompositeOperation = 'lighter';
  for (const [w, h] of [[S, 3], [3, S]]) {
    const lg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    lg.addColorStop(0, 'rgba(255,255,255,0.7)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg; g.fillRect((S - w) / 2, (S - h) / 2, w, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Pool of point glints. emit() never allocates.
export function createSparkles(scene, cap = 60) {
  const CAP = 80;
  const pos = new Float32Array(CAP * 3), col = new Float32Array(CAP * 3), vel = new Float32Array(CAP * 3);
  const life = new Float32Array(CAP), max = new Float32Array(CAP);
  const geo = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const ca = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', pa); geo.setAttribute('color', ca);
  const mat = new THREE.PointsMaterial({
    size: 0.5, map: glintTexture(), vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false, sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false; pts.renderOrder = 60; pts.visible = false;
  scene.add(pts);
  let limit = Math.max(4, Math.min(CAP, cap | 0)), alive = 0, cursor = 0;

  function emit(p, n = 1, spread = 0.1, up = 0.5, dur = 0.8) {
    for (let k = 0; k < n; k++) {
      let i = -1;
      for (let s = 0; s < limit; s++) { const j = (cursor + s) % limit; if (life[j] <= 0) { i = j; break; } }
      if (i < 0) return;
      cursor = (i + 1) % limit;
      const o = i * 3;
      pos[o] = p.x + (Math.random() - 0.5) * 2 * spread;
      pos[o + 1] = p.y + (Math.random() - 0.5) * 2 * spread * 0.6;
      pos[o + 2] = p.z + (Math.random() - 0.5) * 2 * spread;
      vel[o] = (Math.random() - 0.5) * up * 0.6; vel[o + 1] = up * (0.4 + Math.random() * 0.6); vel[o + 2] = (Math.random() - 0.5) * up * 0.6;
      max[i] = life[i] = dur * (0.7 + Math.random() * 0.6);
      alive++;
    }
    pts.visible = true;
  }
  function update(dt) {
    if (!alive) return;
    let n = 0;
    for (let i = 0; i < CAP; i++) {
      const o = i * 3;
      if (life[i] <= 0) { col[o] = col[o + 1] = col[o + 2] = 0; continue; }
      life[i] -= dt;
      if (life[i] <= 0) { life[i] = 0; col[o] = col[o + 1] = col[o + 2] = 0; continue; }
      n++;
      vel[o + 1] -= 0.5 * dt;
      pos[o] += vel[o] * dt; pos[o + 1] += vel[o + 1] * dt; pos[o + 2] += vel[o + 2] * dt;
      const k = 1 - life[i] / max[i];
      const a = Math.sin(Math.PI * Math.min(1, k * 1.3)) * (0.75 + 0.25 * Math.sin(life[i] * 40));
      col[o] = a; col[o + 1] = a * 0.93; col[o + 2] = a * 0.76;
    }
    alive = n;
    pa.needsUpdate = true; ca.needsUpdate = true;
    if (!alive) pts.visible = false;
  }
  function clear() { life.fill(0); col.fill(0); alive = 0; ca.needsUpdate = true; pts.visible = false; }
  return {
    emit, update, clear,
    setLimit(n) { limit = Math.max(4, Math.min(CAP, n | 0)); },
    setSize(s) { mat.size = s; },
  };
}

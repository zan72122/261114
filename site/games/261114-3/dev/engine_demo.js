// 使い捨てデモ: engine / audio / hints の動作確認
import * as THREE from 'three';
import { createEngine } from '../src/engine.js';
import { createAudio } from '../src/audio.js';
import { createHints } from '../src/hints.js';

const engine = createEngine();
if (engine) {
  const audio = createAudio();
  const hints = createHints(engine);
  const { scene } = engine;
  scene.background = new THREE.Color(0xd9d2c6);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
  sun.position.set(-6, 10, 5); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 });
  scene.add(sun);
  const table = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0xc9a77c, roughness: 0.6 }));
  table.rotation.x = -Math.PI / 2; table.receiveShadow = true; scene.add(table);
  const mk = (c, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }));
    m.position.set(x, 0.7, z); m.castShadow = true; scene.add(m); return m;
  };
  const a = mk(0xd2553f, -2, 0), b = mk(0x4f7fb8, 2.2, 1.2);
  engine.frame({ box: [-3.5, 0, -2, 3.5, 1.5, 2.5], pitch: 0.75, duration: 0 });
  hints.glow(a);
  hints.halo(new THREE.Vector3(2.2, 0, 1.2), 1.6);
  hints.finger.show(() => [a.position.clone().setY(1.4), b.position.clone().setY(1.4)], { duration: 1.6 });
  engine.onFirstTouch(() => audio.unlock());
  engine.input.onDown((p) => {
    hints.poke();
    const hit = engine.pick(p, [a, b]);
    if (hit) { audio.play('pop'); hints.glow(hit.object); } else audio.play('tap');
  });
  engine.onFrame((dt, t) => { a.rotation.y = t * 0.3; hints.update(dt); });
  engine.start();
  window.__demo = { engine, audio, hints };
}

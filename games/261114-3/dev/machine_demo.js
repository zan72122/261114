// ミシン単体の見た目確認用（製品には入らない）
import { preview } from './preview.js';
import { createMachine } from '../src/machine.js';
const { THREE, scene, camera, renderer, onFrame } = preview({ cam: [3.2, 6.2, 8.6], look: [0, 1.4, 0], fov: 35 });
const m = createMachine();
scene.add(m.group);
m.setLamp(1);
let tris = 0, calls = 0;
m.group.traverse(o => { if (o.isMesh && o.material.visible !== false) { calls++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
console.log('machine tris', tris | 0, 'meshes', calls);
window.__stats = { tris: tris | 0, calls };
const N = new THREE.Vector3(-1.25, 0.7, 0.1);
const views = {
  front: () => { camera.position.set(3.0, 6.0, 8.8); camera.lookAt(0, 1.4, 0); },
  sewer: () => { camera.position.set(-1.55, 3.2, 4.2); camera.lookAt(N); },
  close: () => { camera.position.set(-0.4, 1.6, 1.7); camera.lookAt(-1.2, 1.0, 0.1); },
  left: () => { camera.position.set(-7, 3.5, 5); camera.lookAt(0, 1.4, 0); },
  head: () => { camera.position.set(-0.2, 2.9, 3.2); camera.lookAt(-1.1, 2.3, 0.3); },
  wheel: () => { camera.position.set(4.6, 3.0, 1.6); camera.lookAt(1.6, 2.0, 0); },
  right: () => { camera.position.set(7, 4, 5); camera.lookAt(0, 1.6, 0); },
};
window.setView = (v) => { views[v](); camera.updateMatrixWorld(); };
window.M = m; window.cam = (p, l) => { camera.position.set(...p); camera.lookAt(...l); };
window.phi = null;
let t = 0;
onFrame((dt) => {
  t += dt;
  m.setPhase(window.phi ?? t * 4);
  m.update(dt);
});

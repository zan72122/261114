import { preview } from './preview.js';
import { createApple, createBottle, createBento, createHanky, createTin, createButton } from '../src/props.js';
const P = preview({ cam: [0, 7, 7.5], look: [0, 0.4, 0], fov: 36 });
const { scene, camera, onFrame } = P;
const t0 = performance.now();
const items = [];
const put = (o, x, z, ry = 0) => { o.group.position.set(x, o.group.position.y, z); o.group.rotation.y = ry; scene.add(o.group); items.push(o); return o; };
const apple = put(createApple(), -1.2, -1.3); apple.group.position.y = 0.36;
put(createBottle(), 0.3, -1.6);
put(createBento(), 1.5, -0.9, -0.2);
put(createHanky(), -1.4, 0.5, 0.1);
const tin = put(createTin(), 0.6, 0.7);
for (let i = 0; i < 6; i++) { const b = put(createButton(i), -1.6 + i * 0.4, 2.0); b.group.position.y = 0.03; }
console.error('props ms', (performance.now() - t0).toFixed(0));
window.tin = tin; window.apple = apple; window.cam = (x, y, z, lx, ly, lz) => { camera.position.set(x, y, z); camera.lookAt(lx, ly, lz); };
tin.setLid(+(location.hash.slice(1) || 0));
onFrame((dt) => tin.update(dt));

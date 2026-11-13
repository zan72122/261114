// 部屋/公園プレビュー（製品には入らない）
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createWorld } from '../src/world.js';
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
const t0 = performance.now();
const world = createWorld(scene, renderer);
console.log('world ms', (performance.now() - t0).toFixed(0), JSON.stringify(world.timings));
const camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.1, 300);
const views = {
  table: [[0, 13, 14.5], [0, 0.6, -0.4]],
  home: [[0, 12.5, 15.5], [0, 4.2, -2]],
  start: [[0, 14, 17], [0, 0.4, 1.6]],
  park: [[0, 13, 14.5], [0, 0.4, -0.4]],
  parkhome: [[0, 9, 17], [0, 2.5, -3]],
};
window.view = (n) => { const [p, l] = views[n]; camera.position.set(...p); camera.lookAt(...l); };
window.view('table');
// テスト用の物体
const probe = new THREE.Group();
const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.6 }));
box.position.set(1.5, 0.6, 0.5); box.castShadow = true; probe.add(box);
const ball = new THREE.Mesh(new THREE.SphereGeometry(0.4, 32, 16), new THREE.MeshStandardMaterial({ color: 0xc03030, roughness: 0.4 }));
ball.position.set(-1.2, 0.4, 1.5); ball.castShadow = true; probe.add(ball);
scene.add(probe);
window.probe = probe;
window.world = world;
const params = new URLSearchParams(location.hash.slice(1));
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  world.update(dt, (now - t0) / 1000);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

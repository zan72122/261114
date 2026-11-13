// 見た目確認用の共通ハーネス（製品には入らない）。本番と同じレンダラ設定・環境光で1物体を映す。
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
export function preview({ cam = [0, 6, 8], look = [0, 0.5, 0], fov = 35, ground = true, bg = 0xd9d2c6 } = {}) {
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
  scene.background = new THREE.Color(bg);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sun.position.set(-6, 10, 5); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  const s = sun.shadow.camera; s.left = -8; s.right = 8; s.top = 8; s.bottom = -8; s.near = 1; s.far = 30;
  scene.add(sun);
  if (ground) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0xc9a77c, roughness: 0.6 }));
    g.rotation.x = -Math.PI / 2; g.receiveShadow = true; scene.add(g);
  }
  const camera = new THREE.PerspectiveCamera(fov, innerWidth / innerHeight, 0.1, 200);
  camera.position.set(...cam); camera.lookAt(...look);
  const updates = [];
  let t0 = performance.now(), last = t0;
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    for (const u of updates) u(dt, (now - t0) / 1000);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  window.__ready = true;
  return { THREE, renderer, scene, camera, sun, onFrame: (f) => updates.push(f) };
}

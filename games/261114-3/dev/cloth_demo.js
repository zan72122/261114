// Throwaway preview for src/cloth.js. window.setPose(name) selects a state.
import { preview } from './preview.js';
import { createCloth } from '../src/cloth.js';
import { FABRICS, getFabric } from '../src/fabrics.js';

const P = preview({ cam: [0, 13, 14.5], look: [0, 0.6, -0.4], fov: 35 });
const { THREE, scene, camera } = P;
const times = FABRICS.map((f) => { getFabric(f.id); return f.id + ':' + getFabric(f.id).genMs.toFixed(0) + 'ms'; });
console.log('fabric gen', times.join(' '));

let cloth = createCloth('flower');
scene.add(cloth.group);
const apple = new THREE.Mesh(new THREE.SphereGeometry(0.29, 32, 20), new THREE.MeshStandardMaterial({ color: 0xc8242c, roughness: 0.35 }));
apple.castShadow = true; apple.visible = false; scene.add(apple);
const plateau = new THREE.Mesh(new THREE.BoxGeometry(6, 0.7, 3), new THREE.MeshStandardMaterial({ color: 0x8b8f96, roughness: 0.5 }));
plateau.position.set(0, 0.35, -0.8); plateau.receiveShadow = true; plateau.castShadow = true; plateau.visible = false; scene.add(plateau);
const button = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 24), new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.4 }));
button.castShadow = true; scene.add(button); button.visible = false;
let appleLump = null; let anim = null;

function reset(fab) {
  if (fab && fab !== cloth.fabricId) { cloth.dispose(); cloth = createCloth(fab); scene.add(cloth.group); }
  const p = cloth.pose;
  p.fold = 0; p.nearCurl = 0; p.grip.set(0, 0, -1.3); p.yaw = 0; p.gape = 0; p.handleWiggle = 0; p.fill = 0;
  cloth.lumps.length = 0; cloth.clearStitches(); cloth.setSewn('R', false); cloth.setSewn('L', false);
  cloth.setGround(() => 0); cloth.detachAll(); apple.visible = false; plateau.visible = false; button.visible = false; appleLump = null; anim = null;
  camera.position.set(0, 13, 14.5); camera.lookAt(0, 0.6, -0.4);
}
function sew(side, n, color, wob) {
  for (let i = 0; i < n; i++) cloth.addStitch(side, i / (n - 1), wob * (Math.sin(i * 0.7) * 0.6 + Math.sin(i * 1.9) * 0.4), color);
}
const poses = {
  flat() { cloth.pose.nearCurl = 1; },
  mid25() { cloth.pose.fold = 0.25; },
  mid() { cloth.pose.fold = 0.5; },
  mid75() { cloth.pose.fold = 0.75; },
  mid9() { cloth.pose.fold = 0.92; },
  folded() { cloth.pose.fold = 1; },
  apple() { cloth.pose.fold = 1; cloth.pose.gape = 1; appleLump = { x: 0, y: 0.5, r: 0.36 }; cloth.lumps.push(appleLump); apple.visible = true; },
  half() { cloth.pose.fold = 1; cloth.pose.grip.set(0, 1.6, -1.3); },
  hang() { cloth.pose.fold = 1; cloth.pose.grip.set(0, 4.4, -0.6); appleLump = { x: 0.15, y: 0.2, r: 0.34 }; cloth.lumps.push(appleLump); apple.visible = true; },
  hangR() { poses.hang(); cloth.setSewn('R', true); sew('R', 45, 0xe03a5a, 0.05); },
  full() {
    cloth.pose.fold = 1; cloth.pose.grip.set(0, 4.4, -0.6); cloth.pose.fill = 0.8; cloth.pose.gape = 0.3;
    cloth.setSewn('R', true); cloth.setSewn('L', true); sew('R', 45, 0x2a7de1, 0.04); sew('L', 45, 0x2a7de1, 0.05);
    cloth.lumps.push({ x: -0.3, y: 0.25, r: 0.35 }, { x: 0.35, y: 0.3, r: 0.3 }, { x: 0, y: 0.55, r: 0.3 });
  },
  plateau() {
    cloth.pose.fold = 1; plateau.visible = true;
    cloth.setGround((x, z) => 0.7 * (1 - THREE.MathUtils.smootherstep(z, 0.62, 0.72)));
  },
  sewing() { // lying folded, partly sewn, with a button
    cloth.pose.fold = 1; sew('R', 20, 0xe03a5a, 0.05); button.visible = true; cloth.attach(button, -0.3, 0.6);
  },
  swing() { poses.hang(); cloth.settle(); let t = 0; anim = (dt) => { t += dt; cloth.pose.grip.x = t < 0.25 ? t * 6 : 1.5; }; },
  yaw() { cloth.pose.fold = 1; cloth.pose.grip.set(0.5, 2.6, -0.8); cloth.pose.yaw = 0.6; },
  wiggle() { cloth.pose.fold = 1; cloth.pose.handleWiggle = 1; },
};
window.setPose = (name, fab, cam) => {
  reset(fab); poses[name](); cloth.settle(); cloth.update(0);
  if (cam) { camera.position.set(...cam[0]); camera.lookAt(...cam[1]); }
};
window.cloth = () => cloth;
P.onFrame((dt) => {
  if (anim) anim(dt);
  cloth.update(dt);
  if (appleLump) { cloth.inside(appleLump.x, appleLump.y, apple.position); }
});
window.setPose(new URLSearchParams(location.search).get('pose') || 'flat');

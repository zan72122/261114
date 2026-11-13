import { preview } from './preview.js';
const { THREE, scene } = preview();
const m = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.3, clearcoat: 0.6 }));
m.position.y = 1; m.castShadow = true; scene.add(m);

/* 星云漫游 Nebula Drift —— three.js 场景骨架
 *
 * 结构对齐 KPanel 官方 scene-packs/_template：把原生 WebGL2 着色器换成了 three.js，
 * 完整实现宿主协议（ready / camera / error；pause / resume / camera）+ 三件套：
 *   1. 进场淡入（从近景拉远 + 粒子渐显）
 *   2. 待机呼吸（粒子大小 + 星核明灭）
 *   3. 机位缓动转场（position/target/fov 三次缓动）
 *
 * 复制本目录为新场景后，改 manifest.json 的 id/name/theme/cameras，
 * 再把 buildNebula() 换成你自己的世界即可。完整规范见 docs/kpanel-scene-pack-spec-zh.md
 */
import * as THREE from 'three';

/* 机位：id 必须与 manifest.json 的 cameras 保持一致 */
const SHOTS = [
  { id: 'panorama', position: new THREE.Vector3(0, 5, 26), target: new THREE.Vector3(0, 0, 0), fov: 55 },
  { id: 'core', position: new THREE.Vector3(0, 2, 11), target: new THREE.Vector3(0, 0, 0), fov: 50 },
  { id: 'closeup', position: new THREE.Vector3(3.2, 1, 5.5), target: new THREE.Vector3(0, 0.4, 0), fov: 62 },
];

const ENTRANCE_SECONDS = 4;
const HOLD_SECONDS = 30;       // 待机多久自动轮换机位
const TRANSITION_SECONDS = 4;  // 机位转场时长
const MAX_PIXEL_RATIO = 1.5;
const PARTICLE_COUNT = 2600;

function post(event) {
  // 桌面把场景跑在不透明源沙箱里，'*' 是唯一可用 targetOrigin
  if (window.parent !== window) window.parent.postMessage({ source: 'kpanel-scene-pack', ...event }, '*');
}

/* ---------- 渲染器 / 场景 / 相机 ---------- */
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);

/* ---------- 星云粒子（可替换成你的世界） ---------- */
function buildNebula() {
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const colors = new Float32Array(PARTICLE_COUNT * 3);
  const c1 = new THREE.Color('#7b5cd6');
  const c2 = new THREE.Color('#6ec6ff');
  const c3 = new THREE.Color('#f2a6ff');
  const tmp = new THREE.Color();
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const r = 6 + Math.pow(Math.random(), 0.5) * 14;   // 球壳 + 稀疏外延，造云状层次
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.55; // 垂直压扁
    positions[i * 3 + 2] = r * Math.cos(phi);
    const t = Math.random();
    tmp.copy(c1).lerp(c2, Math.random()).lerp(c3, Math.random() * t);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.16, vertexColors: true, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  return new THREE.Points(geo, mat);
}
const nebula = buildNebula();
scene.add(nebula);

/* 中央星核 + 光晕 */
const core = new THREE.Mesh(new THREE.SphereGeometry(0.8, 32, 32), new THREE.MeshBasicMaterial({ color: 0xffffff }));
scene.add(core);
const glow = new THREE.Mesh(
  new THREE.SphereGeometry(1.4, 32, 32),
  new THREE.MeshBasicMaterial({ color: 0x6ec6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
);
scene.add(glow);

/* ---------- 机位状态 ---------- */
// ?entrance=off&shot=N 跳过进场、直接看第 N 个机位（截 poster 用）
const params = new URLSearchParams(location.search);
const entrance = params.get('entrance') !== 'off';
let shotIndex = Math.min(SHOTS.length - 1, Math.max(0, Number(params.get('shot')) || 0));

const view = {
  position: SHOTS[shotIndex].position.clone(),
  target: SHOTS[shotIndex].target.clone(),
  fov: SHOTS[shotIndex].fov,
};
let from = { position: view.position.clone(), target: view.target.clone(), fov: view.fov };
let to = SHOTS[shotIndex];
let transitionStart = -Infinity;
let lastCut = 0;
let time = 0;
let last = performance.now();
let frame = 0;
let readySent = false;

const clamp = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function cut(index) {
  shotIndex = ((index % SHOTS.length) + SHOTS.length) % SHOTS.length;
  from = { position: view.position.clone(), target: view.target.clone(), fov: view.fov };
  to = SHOTS[shotIndex];
  transitionStart = time;
  lastCut = time;
  post({ type: 'camera', index: shotIndex });
}

function resize() {
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  renderer.setPixelRatio(ratio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

function render(now) {
  frame = requestAnimationFrame(render);
  // rAF 时间戳可能早于之前取的 performance.now()：永不让时间倒流
  time += Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  if (time - lastCut > HOLD_SECONDS) cut(shotIndex + 1);

  const k = ease(clamp((time - transitionStart) / TRANSITION_SECONDS));
  view.position.lerpVectors(from.position, to.position, k);
  view.target.lerpVectors(from.target, to.target, k);
  view.fov = lerp(from.fov, to.fov, k);
  camera.position.copy(view.position);
  camera.lookAt(view.target);
  camera.fov = view.fov;
  camera.updateProjectionMatrix();

  // 进场：淡入 + 从近景拉远
  const arrival = entrance ? ease(clamp(time / ENTRANCE_SECONDS)) : 1;
  const arriveZoom = lerp(0.35, 1, arrival);
  camera.fov = view.fov / arriveZoom;
  camera.updateProjectionMatrix();
  nebula.material.opacity = 0.85 * arrival;
  glow.material.opacity = 0.35 * arrival;

  // 待机呼吸 + 星云自转
  const breath = 0.5 + 0.5 * Math.sin(time * 0.35);
  nebula.material.size = 0.13 + 0.05 * breath;
  nebula.rotation.y = time * 0.03;
  glow.scale.setScalar(1 + 0.08 * breath);

  renderer.render(scene, camera);
  if (!readySent) {
    readySent = true;
    post({ type: 'ready', cameras: SHOTS.map((s) => s.id) });
  }
}

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  const command = event.data;
  if (!command || command.source !== 'kpanel-desktop') return;
  if (command.type === 'pause' && frame) {
    cancelAnimationFrame(frame);
    frame = 0;
  } else if (command.type === 'resume' && !frame) {
    last = performance.now(); // 恢复不跳时间
    frame = requestAnimationFrame(render);
  } else if (command.type === 'camera') {
    cut(Number.isInteger(command.index) ? command.index : shotIndex + 1);
  }
});

renderer.domElement.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  cancelAnimationFrame(frame);
  post({ type: 'error', reason: 'context-lost' });
});
window.addEventListener('resize', resize);
resize();
frame = requestAnimationFrame(render);

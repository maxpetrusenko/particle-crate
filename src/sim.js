import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { palette } from "./constants.js";
import { clamp, rand } from "./math.js";

const canvas = document.querySelector("#sim");
const bodyCount = document.querySelector("#bodyCount");
const particleCount = document.querySelector("#particleCount");
const gridCount = document.querySelector("#gridCount");
const fpsEl = document.querySelector("#fps");
const engineStatus = document.querySelector("#engineStatus");
const stepTime = document.querySelector("#stepTime");

const world = {
  halfX: 9.4,
  halfZ: 5.1,
  floorY: 0,
  wallHeight: 1.85,
  wallThickness: 0.16,
  gravity: 18,
  limit: 560,
};

const state = {
  bodies: [],
  selected: null,
  dragTarget: new THREE.Vector3(),
  dragPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
  pointer: new THREE.Vector2(),
  lastTime: performance.now(),
  fps: 60,
  stepMs: 0,
  contacts: 0,
  cameraMoved: false,
};

const scene = new THREE.Scene();
scene.background = new THREE.Color("#07110f");
scene.fog = new THREE.Fog("#07110f", 16, 32);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 80);
camera.position.set(9, 7, 10);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.9, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.minDistance = 5.5;
controls.maxDistance = 22;
controls.maxPolarAngle = Math.PI * 0.49;
controls.addEventListener("change", () => {
  state.cameraMoved = true;
});

const raycaster = new THREE.Raycaster();
const pointerHit = new THREE.Vector3();
const scratch = new THREE.Vector3();
const clock = new THREE.Clock();

const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const wallMaterial = new THREE.MeshStandardMaterial({ color: "#3e9984", roughness: 0.74, metalness: 0.06 });
const floorMaterial = new THREE.MeshStandardMaterial({ color: "#0b1a16", roughness: 0.94, metalness: 0.02 });
const pullMaterial = new THREE.MeshBasicMaterial({ color: "#f4efe2", transparent: true, opacity: 0.2, depthWrite: false });
const edgeMaterial = new THREE.LineBasicMaterial({ color: "#0b1915", transparent: true, opacity: 0.72 });
const bodyMaterials = palette.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.04 }));

setupLights();
setupCrate();
reset();
resize();
requestAnimationFrame(frame);

function setupLights() {
  scene.add(new THREE.HemisphereLight("#d9fff1", "#07110f", 2.2));

  const key = new THREE.DirectionalLight("#fff4d8", 3.6);
  key.position.set(-4, 10, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -12;
  key.shadow.camera.right = 12;
  key.shadow.camera.top = 10;
  key.shadow.camera.bottom = -8;
  scene.add(key);

  const rim = new THREE.DirectionalLight("#50d2c8", 1.2);
  rim.position.set(7, 5, -6);
  scene.add(rim);
}

function setupCrate() {
  const floor = new THREE.Mesh(new THREE.BoxGeometry(world.halfX * 2.08, 0.16, world.halfZ * 2.08), floorMaterial);
  floor.position.y = -0.08;
  floor.receiveShadow = true;
  scene.add(floor);

  addWall(-world.halfX - world.wallThickness / 2, world.wallHeight / 2, 0, world.wallThickness, world.wallHeight, world.halfZ * 2.08);
  addWall(world.halfX + world.wallThickness / 2, world.wallHeight / 2, 0, world.wallThickness, world.wallHeight, world.halfZ * 2.08);
  addWall(0, world.wallHeight / 2, -world.halfZ - world.wallThickness / 2, world.halfX * 2.08, world.wallHeight, world.wallThickness);
  addWall(0, world.wallHeight / 2, world.halfZ + world.wallThickness / 2, world.halfX * 2.08, world.wallHeight, world.wallThickness);

  const grid = new THREE.GridHelper(20, 20, "#2a695d", "#14372f");
  grid.position.y = 0.006;
  grid.material.transparent = true;
  grid.material.opacity = 0.28;
  scene.add(grid);
}

function addWall(x, y, z, sx, sy, sz) {
  const wall = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), wallMaterial);
  wall.position.set(x, y, z);
  wall.castShadow = true;
  wall.receiveShadow = true;
  scene.add(wall);

  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(wall.geometry), edgeMaterial);
  edges.position.copy(wall.position);
  scene.add(edges);
}

function makeBody(index, highDrop = false) {
  const wide = Math.random() > 0.32;
  const size = new THREE.Vector3(wide ? rand(0.48, 0.72) : rand(0.34, 0.48), rand(0.18, 0.34), wide ? rand(0.24, 0.38) : rand(0.42, 0.66));
  const mesh = new THREE.Mesh(boxGeometry, bodyMaterials[index % bodyMaterials.length]);
  mesh.scale.copy(size);
  mesh.position.set(rand(-world.halfX + 0.7, world.halfX - 0.7), highDrop ? rand(4.2, 8.5) : rand(1.8, 5.2), rand(-world.halfZ + 0.65, world.halfZ - 0.65));
  mesh.rotation.set(rand(-0.8, 0.8), rand(-Math.PI, Math.PI), rand(-0.8, 0.8));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  return {
    mesh,
    size,
    velocity: new THREE.Vector3(rand(-0.7, 0.7), rand(-0.3, 0.3), rand(-0.5, 0.5)),
    angular: new THREE.Vector3(rand(-1.6, 1.6), rand(-1.2, 1.2), rand(-1.6, 1.6)),
    sleeping: false,
  };
}

function reset() {
  for (const body of state.bodies) scene.remove(body.mesh);
  state.bodies = [];
  state.selected = null;
  for (let i = 0; i < 420; i += 1) state.bodies.push(makeBody(i));
}

function dropBatch(count = 80) {
  const start = state.bodies.length;
  for (let i = 0; i < count; i += 1) state.bodies.push(makeBody(start + i, true));
  while (state.bodies.length > world.limit) {
    const removed = state.bodies.shift();
    scene.remove(removed.mesh);
  }
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
}

function pointerFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  state.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  state.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function pickBody(event) {
  pointerFromEvent(event);
  raycaster.setFromCamera(state.pointer, camera);
  const hits = raycaster.intersectObjects(state.bodies.map((body) => body.mesh), false);
  if (!hits.length) return null;
  const mesh = hits[0].object;
  return state.bodies.find((body) => body.mesh === mesh) ?? null;
}

function updateDragTarget(event) {
  pointerFromEvent(event);
  raycaster.setFromCamera(state.pointer, camera);
  raycaster.ray.intersectPlane(state.dragPlane, pointerHit);
  state.dragTarget.copy(pointerHit);
  state.dragTarget.y = clamp(state.dragTarget.y, 0.4, 5.2);
}

canvas.addEventListener("pointerdown", (event) => {
  const body = pickBody(event);
  if (!body) return;
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  state.selected = body;
  controls.enabled = false;
  state.dragPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(scratch).normalize(), body.mesh.position);
  updateDragTarget(event);
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.selected) return;
  event.preventDefault();
  updateDragTarget(event);
});

canvas.addEventListener("pointerup", (event) => {
  if (!state.selected) return;
  canvas.releasePointerCapture(event.pointerId);
  state.selected = null;
  controls.enabled = true;
});

canvas.addEventListener("pointercancel", () => {
  state.selected = null;
  controls.enabled = true;
});

window.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    dropBatch();
  }
  if (event.key.toLowerCase() === "r") reset();
});

window.addEventListener("resize", resize);

function frame(now) {
  const dt = Math.min(clock.getDelta(), 0.026);
  const startedAt = performance.now();
  stepPhysics(dt);
  controls.update();
  renderer.render(scene, camera);
  state.fps = state.fps * 0.92 + (1 / Math.max(dt, 0.001)) * 0.08;
  state.stepMs = state.stepMs * 0.9 + (performance.now() - startedAt) * 0.1;
  updateHud();
  requestAnimationFrame(frame);
}

function stepPhysics(dt) {
  state.contacts = 0;
  for (const body of state.bodies) {
    if (body === state.selected) applyDrag(body, dt);
    integrate(body, dt);
    collideCrate(body);
  }
  collideBodies();
  for (const body of state.bodies) collideCrate(body);
}

function applyDrag(body, dt) {
  scratch.copy(state.dragTarget).sub(body.mesh.position);
  const pull = scratch.multiplyScalar(18 * dt);
  body.velocity.add(pull);
  body.velocity.multiplyScalar(0.9);
  body.angular.add(new THREE.Vector3(-scratch.z, 0, scratch.x).multiplyScalar(0.035));
}

function integrate(body, dt) {
  body.velocity.y -= world.gravity * dt;
  body.velocity.multiplyScalar(body.mesh.position.y <= 0.28 ? 0.985 : 0.996);
  body.mesh.position.addScaledVector(body.velocity, dt);
  body.mesh.rotation.x += body.angular.x * dt;
  body.mesh.rotation.y += body.angular.y * dt;
  body.mesh.rotation.z += body.angular.z * dt;
  body.angular.multiplyScalar(0.992);
}

function collideCrate(body) {
  const half = body.size.clone().multiplyScalar(0.5);
  const p = body.mesh.position;

  if (p.y - half.y < world.floorY) {
    p.y = world.floorY + half.y;
    if (body.velocity.y < 0) body.velocity.y *= -0.18;
    body.velocity.x *= 0.82;
    body.velocity.z *= 0.82;
    body.angular.multiplyScalar(0.82);
  }

  if (p.y - half.y > world.wallHeight) return;

  if (p.x - half.x < -world.halfX) {
    p.x = -world.halfX + half.x;
    body.velocity.x = Math.abs(body.velocity.x) * 0.2;
  }
  if (p.x + half.x > world.halfX) {
    p.x = world.halfX - half.x;
    body.velocity.x = -Math.abs(body.velocity.x) * 0.2;
  }
  if (p.z - half.z < -world.halfZ) {
    p.z = -world.halfZ + half.z;
    body.velocity.z = Math.abs(body.velocity.z) * 0.2;
  }
  if (p.z + half.z > world.halfZ) {
    p.z = world.halfZ - half.z;
    body.velocity.z = -Math.abs(body.velocity.z) * 0.2;
  }
}

function collideBodies() {
  const cellSize = 0.75;
  const grid = new Map();

  for (const body of state.bodies) {
    const key = `${Math.floor(body.mesh.position.x / cellSize)}:${Math.floor(body.mesh.position.z / cellSize)}:${Math.floor(body.mesh.position.y / cellSize)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(body);
  }

  for (const bucket of grid.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        collidePair(bucket[i], bucket[j]);
      }
    }
  }
}

function collidePair(a, b) {
  const pa = a.mesh.position;
  const pb = b.mesh.position;
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const dz = pb.z - pa.z;
  const sx = (a.size.x + b.size.x) * 0.5 - Math.abs(dx);
  const sy = (a.size.y + b.size.y) * 0.5 - Math.abs(dy);
  const sz = (a.size.z + b.size.z) * 0.5 - Math.abs(dz);
  if (sx <= 0 || sy <= 0 || sz <= 0) return;

  state.contacts += 1;
  if (sx < sy && sx < sz) separate(a, b, Math.sign(dx || 1), 0, 0, sx);
  else if (sy < sz) separate(a, b, 0, Math.sign(dy || 1), 0, sy);
  else separate(a, b, 0, 0, Math.sign(dz || 1), sz);
}

function separate(a, b, nx, ny, nz, overlap) {
  const amount = overlap * 0.52;
  a.mesh.position.addScaledVector(scratch.set(nx, ny, nz), -amount);
  b.mesh.position.addScaledVector(scratch.set(nx, ny, nz), amount);

  const va = a.velocity.dot(scratch);
  const vb = b.velocity.dot(scratch);
  const impulse = (vb - va) * 0.34;
  a.velocity.addScaledVector(scratch, impulse);
  b.velocity.addScaledVector(scratch, -impulse);
  a.angular.add(new THREE.Vector3(nz, nx, ny).multiplyScalar(0.04));
  b.angular.add(new THREE.Vector3(-nz, -nx, -ny).multiplyScalar(0.04));
}

function updateHud() {
  bodyCount.textContent = `${state.bodies.length} bodies`;
  particleCount.textContent = state.selected ? "1 pulled" : "0 pulled";
  gridCount.textContent = `${state.contacts} contacts`;
  fpsEl.textContent = `${Math.round(state.fps)} fps`;
  engineStatus.textContent = "Three.js 3D";
  stepTime.textContent = `${state.stepMs.toFixed(1)} ms`;
}

function sceneMetrics() {
  const positions = state.bodies.map((body) => body.mesh.position);
  const escapedLow = positions.filter((p, index) => {
    const half = state.bodies[index].size.clone().multiplyScalar(0.5);
    if (p.y - half.y > world.wallHeight) return false;
    return p.x - half.x < -world.halfX - 0.02 || p.x + half.x > world.halfX + 0.02 || p.z - half.z < -world.halfZ - 0.02 || p.z + half.z > world.halfZ + 0.02 || p.y - half.y < world.floorY - 0.02;
  }).length;
  const avgY = positions.reduce((sum, p) => sum + p.y, 0) / positions.length;
  return {
    engine: "three-3d",
    bodies: state.bodies.length,
    fps: Math.round(state.fps),
    stepMs: Number(state.stepMs.toFixed(2)),
    contacts: state.contacts,
    selected: Boolean(state.selected),
    camera: camera.position.toArray().map((value) => Number(value.toFixed(2))),
    firstBody: state.bodies[0].mesh.position.toArray().map((value) => Number(value.toFixed(2))),
    cameraMoved: state.cameraMoved,
    avgY: Number(avgY.toFixed(3)),
    escapedLow,
  };
}

window.__particleCrateDebug = {
  metrics: sceneMetrics,
  reset,
  dropBatch,
  orbit(deltaAzimuth = 0.35, deltaPolar = 0.08) {
    camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), deltaAzimuth);
    camera.position.y = clamp(camera.position.y + deltaPolar * 8, 3.2, 11);
    camera.lookAt(controls.target);
    controls.update();
    state.cameraMoved = true;
    return sceneMetrics();
  },
  pullFirstBody(x = 0, y = 3.5, z = 0) {
    const body = state.bodies[0];
    state.selected = body;
    state.dragTarget.set(x, y, z);
    for (let i = 0; i < 44; i += 1) stepPhysics(1 / 60);
    state.selected = null;
    return sceneMetrics();
  },
  sampleHeights() {
    return state.bodies.slice(0, 16).map((body) => Number(body.mesh.position.y.toFixed(2)));
  },
};

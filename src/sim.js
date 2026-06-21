import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { palette } from "./constants.js";
import { clamp, rand } from "./math.js";
import { create2dMode } from "./mode2d.js";

const canvas = document.querySelector("#sim");
const canvas2d = document.querySelector("#sim2d");
const stage = document.querySelector(".stage");
const modeTabs = [...document.querySelectorAll(".mode-tab")];
const bodyCount = document.querySelector("#bodyCount");
const particleCount = document.querySelector("#particleCount");
const gridCount = document.querySelector("#gridCount");
const fpsEl = document.querySelector("#fps");
const engineStatus = document.querySelector("#engineStatus");
const stepTime = document.querySelector("#stepTime");

const app = {
  mode: "3d",
};

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
  stirring: false,
  dragTarget: new THREE.Vector3(),
  stirTarget: new THREE.Vector3(),
  stirPrevious: new THREE.Vector3(),
  stirDelta: new THREE.Vector3(),
  dragPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
  floorPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.16),
  pointer: new THREE.Vector2(),
  lastTime: performance.now(),
  fps: 60,
  stepMs: 0,
  contacts: 0,
  stirHits: 0,
  stirEvents: 0,
  idleFrames: 0,
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
const stirGeometry = new THREE.SphereGeometry(0.28, 24, 12);
const wallMaterial = new THREE.MeshStandardMaterial({ color: "#3e9984", roughness: 0.74, metalness: 0.06 });
const floorMaterial = new THREE.MeshStandardMaterial({ color: "#0b1a16", roughness: 0.94, metalness: 0.02 });
const pullMaterial = new THREE.MeshBasicMaterial({ color: "#f4efe2", transparent: true, opacity: 0.38, depthWrite: false });
const edgeMaterial = new THREE.LineBasicMaterial({ color: "#0b1915", transparent: true, opacity: 0.72 });
const bodyMaterials = palette.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.04 }));
const stirCursor = new THREE.Mesh(stirGeometry, pullMaterial);
stirCursor.visible = false;
scene.add(stirCursor);

const mode2d = create2dMode({
  canvas: canvas2d,
  hud: {
    bodyCount,
    particleCount,
    gridCount,
    fps: fpsEl,
    engineStatus,
    stepTime,
  },
});

setupLights();
setupCrate();
reset();
resize();
setMode("3d");
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
    id: index,
    mesh,
    size,
    velocity: new THREE.Vector3(rand(-0.7, 0.7), rand(-0.3, 0.3), rand(-0.5, 0.5)),
    angular: new THREE.Vector3(rand(-1.6, 1.6), rand(-1.2, 1.2), rand(-1.6, 1.6)),
    sleeping: false,
    sleepFrames: 0,
  };
}

function reset() {
  for (const body of state.bodies) scene.remove(body.mesh);
  state.bodies = [];
  state.selected = null;
  state.stirring = false;
  state.stirEvents = 0;
  state.idleFrames = 0;
  stirCursor.visible = false;
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

function setMode(nextMode) {
  app.mode = nextMode === "2d" ? "2d" : "3d";
  stage.dataset.mode = app.mode;
  canvas2d.setAttribute("aria-hidden", app.mode === "2d" ? "false" : "true");
  canvas.setAttribute("aria-hidden", app.mode === "3d" ? "false" : "true");
  for (const tab of modeTabs) {
    const active = tab.dataset.mode === app.mode;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-pressed", String(active));
  }
  state.selected = null;
  state.stirring = false;
  stirCursor.visible = false;
  controls.enabled = app.mode === "3d";
  if (app.mode === "2d") {
    mode2d.resize();
    mode2d.render();
  } else {
    resize();
  }
  return app.mode;
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

function cratePointFromEvent(event) {
  pointerFromEvent(event);
  raycaster.setFromCamera(state.pointer, camera);
  if (!raycaster.ray.intersectPlane(state.floorPlane, pointerHit)) return null;
  if (Math.abs(pointerHit.x) > world.halfX || Math.abs(pointerHit.z) > world.halfZ) return null;
  pointerHit.y = 0.34;
  return pointerHit.clone();
}

function updateDragTarget(event) {
  pointerFromEvent(event);
  raycaster.setFromCamera(state.pointer, camera);
  raycaster.ray.intersectPlane(state.dragPlane, pointerHit);
  state.dragTarget.copy(pointerHit);
  state.dragTarget.y = clamp(state.dragTarget.y, 0.4, 5.2);
}

function updateStirTarget(event) {
  const point = cratePointFromEvent(event);
  if (!point) return false;
  state.stirDelta.copy(point).sub(state.stirTarget);
  state.stirPrevious.copy(state.stirTarget);
  state.stirTarget.copy(point);
  stirCursor.position.copy(point);
  stirCursor.visible = true;
  return true;
}

for (const tab of modeTabs) {
  tab.addEventListener("click", () => setMode(tab.dataset.mode));
}

canvas.addEventListener("pointerdown", (event) => {
  if (app.mode !== "3d") return;
  const body = pickBody(event);
  if (!body) {
    const point = cratePointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    state.stirring = true;
    state.selected = null;
    controls.enabled = false;
    state.stirTarget.copy(point);
    state.stirPrevious.copy(point);
    state.stirDelta.set(0, 0, 0);
    state.stirEvents = 0;
    stirCursor.position.copy(point);
    stirCursor.visible = true;
    return;
  }
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  state.selected = body;
  state.stirring = false;
  controls.enabled = false;
  state.dragPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(scratch).normalize(), body.mesh.position);
  updateDragTarget(event);
});

canvas.addEventListener("pointermove", (event) => {
  if (app.mode !== "3d") return;
  if (!state.selected && !state.stirring) return;
  event.preventDefault();
  if (state.stirring) {
    updateStirTarget(event);
    return;
  }
  updateDragTarget(event);
});

canvas.addEventListener("pointerup", (event) => {
  if (app.mode !== "3d") return;
  if (!state.selected && !state.stirring) return;
  canvas.releasePointerCapture(event.pointerId);
  state.selected = null;
  state.stirring = false;
  stirCursor.visible = false;
  controls.enabled = true;
});

canvas.addEventListener("pointercancel", () => {
  if (app.mode !== "3d") return;
  state.selected = null;
  state.stirring = false;
  stirCursor.visible = false;
  controls.enabled = true;
});

window.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    if (app.mode === "2d") mode2d.dropBatch();
    else dropBatch();
  }
  if (event.key.toLowerCase() === "r") {
    if (app.mode === "2d") mode2d.reset();
    else reset();
  }
});

window.addEventListener("resize", () => {
  resize();
  mode2d.resize();
});

function frame(now) {
  const dt = Math.min(clock.getDelta(), 0.026);
  if (app.mode === "2d") {
    mode2d.step(dt);
    requestAnimationFrame(frame);
    return;
  }

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
  state.stirHits = 0;
  if (state.selected || state.stirring) state.idleFrames = 0;
  else state.idleFrames += 1;
  for (const body of state.bodies) {
    if (body === state.selected) applyDrag(body, dt);
    if (state.stirring) applyStir(body, dt);
    integrate(body, dt);
    collideCrate(body);
  }
  if (state.stirring) state.stirDelta.multiplyScalar(0.72);
  collideBodies();
  for (const body of state.bodies) collideCrate(body);
  applyIdleSettling();
}

function applyDrag(body, dt) {
  wake(body);
  scratch.copy(state.dragTarget).sub(body.mesh.position);
  const pull = scratch.multiplyScalar(18 * dt);
  body.velocity.add(pull);
  body.velocity.multiplyScalar(0.9);
  body.angular.add(new THREE.Vector3(-scratch.z, 0, scratch.x).multiplyScalar(0.035));
}

function applyStir(body, dt) {
  const p = body.mesh.position;
  const dx = p.x - state.stirTarget.x;
  const dz = p.z - state.stirTarget.z;
  const radius = 1.25;
  const distance = Math.hypot(dx, dz);
  if (distance > radius || p.y > 2.4) return;

  wake(body);
  state.stirHits += 1;
  state.stirEvents += 1;
  const falloff = 1 - distance / radius;
  const nx = distance > 0.001 ? dx / distance : 0;
  const nz = distance > 0.001 ? dz / distance : 1;
  body.velocity.x += nx * falloff * 18 * dt + state.stirDelta.x * falloff * 20;
  body.velocity.z += nz * falloff * 18 * dt + state.stirDelta.z * falloff * 20;
  body.velocity.y += falloff * 3.6 * dt;
  body.angular.x += state.stirDelta.z * falloff * 2.6;
  body.angular.z -= state.stirDelta.x * falloff * 2.6;
}

function integrate(body, dt) {
  if (body.sleeping) return;
  body.velocity.y -= world.gravity * dt;
  body.velocity.multiplyScalar(body.mesh.position.y <= 0.32 ? 0.96 : 0.992);
  body.mesh.position.addScaledVector(body.velocity, dt);
  body.mesh.rotation.x += body.angular.x * dt;
  body.mesh.rotation.y += body.angular.y * dt;
  body.mesh.rotation.z += body.angular.z * dt;
  body.angular.multiplyScalar(body.mesh.position.y <= 0.32 ? 0.94 : 0.985);
  updateSleep(body);
}

function wake(body) {
  body.sleeping = false;
  body.sleepFrames = 0;
}

function updateSleep(body) {
  const insideSettledPile = body.mesh.position.y <= world.wallHeight + 0.7;
  const speed = body.velocity.length();
  const spin = body.angular.length();
  if (insideSettledPile && speed < 0.52 && spin < 0.72) body.sleepFrames += 1;
  else body.sleepFrames = 0;

  if (body.sleepFrames > 16) {
    body.velocity.set(0, 0, 0);
    body.angular.set(0, 0, 0);
    body.sleeping = true;
  }
}

function applyIdleSettling() {
  if (state.idleFrames < 90) return;
  for (const body of state.bodies) {
    if (body.sleeping || body.mesh.position.y > world.wallHeight + 0.85) continue;
    if (state.idleFrames > 240) {
      body.velocity.set(0, 0, 0);
      body.angular.set(0, 0, 0);
      body.sleeping = true;
      body.sleepFrames = 999;
      continue;
    }
    const speed = body.velocity.length();
    const spin = body.angular.length();
    if (speed < 0.95 && spin < 1.2) {
      body.velocity.multiplyScalar(0.35);
      body.angular.multiplyScalar(0.25);
      body.sleepFrames += 4;
      updateSleep(body);
    }
  }
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

  if (p.x - half.x < -world.halfX) {
    const impact = Math.abs(body.velocity.x);
    p.x = -world.halfX + half.x;
    body.velocity.x = Math.abs(body.velocity.x) * 0.2;
    if (impact > 0.18) wake(body);
  }
  if (p.x + half.x > world.halfX) {
    const impact = Math.abs(body.velocity.x);
    p.x = world.halfX - half.x;
    body.velocity.x = -Math.abs(body.velocity.x) * 0.2;
    if (impact > 0.18) wake(body);
  }
  if (p.z - half.z < -world.halfZ) {
    const impact = Math.abs(body.velocity.z);
    p.z = -world.halfZ + half.z;
    body.velocity.z = Math.abs(body.velocity.z) * 0.2;
    if (impact > 0.18) wake(body);
  }
  if (p.z + half.z > world.halfZ) {
    const impact = Math.abs(body.velocity.z);
    p.z = world.halfZ - half.z;
    body.velocity.z = -Math.abs(body.velocity.z) * 0.2;
    if (impact > 0.18) wake(body);
  }
}

function collideBodies() {
  const cellSize = 0.75;
  const grid = new Map();
  const seen = new Set();

  for (const body of state.bodies) {
    const key = `${Math.floor(body.mesh.position.x / cellSize)}:${Math.floor(body.mesh.position.z / cellSize)}:${Math.floor(body.mesh.position.y / cellSize)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(body);
  }

  for (const [key, bucket] of grid.entries()) {
    const [gx, gz, gy] = key.split(":").map(Number);
    for (let oy = -1; oy <= 1; oy += 1) {
      for (let oz = -1; oz <= 1; oz += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          const neighbor = grid.get(`${gx + ox}:${gz + oz}:${gy + oy}`);
          if (!neighbor) continue;

          for (const a of bucket) {
            for (const b of neighbor) {
              if (a.id >= b.id) continue;
              const pairKey = `${a.id}:${b.id}`;
              if (seen.has(pairKey)) continue;
              seen.add(pairKey);
              collidePair(a, b);
            }
          }
        }
      }
    }
  }
}

function collidePair(a, b) {
  if (a.sleeping && b.sleeping) return;
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
  if ((a.sleeping || b.sleeping) && overlap < 0.08) return;
  const amount = overlap * 0.52;
  a.mesh.position.addScaledVector(scratch.set(nx, ny, nz), -amount);
  b.mesh.position.addScaledVector(scratch.set(nx, ny, nz), amount);

  const va = a.velocity.dot(scratch);
  const vb = b.velocity.dot(scratch);
  const impulse = (vb - va) * 0.34;
  if (Math.abs(vb - va) > 0.34 || overlap > 0.3) {
    wake(a);
    wake(b);
  }
  a.velocity.addScaledVector(scratch, impulse);
  b.velocity.addScaledVector(scratch, -impulse);
  a.angular.add(new THREE.Vector3(nz, nx, ny).multiplyScalar(0.04));
  b.angular.add(new THREE.Vector3(-nz, -nx, -ny).multiplyScalar(0.04));
}

function updateHud() {
  bodyCount.textContent = `${state.bodies.length} bodies`;
  particleCount.textContent = state.selected ? "1 pulled" : state.stirring ? `${state.stirHits} stirred` : "0 pulled";
  gridCount.textContent = `${state.contacts} contacts`;
  fpsEl.textContent = `${Math.round(state.fps)} fps`;
  engineStatus.textContent = "Three.js 3D";
  stepTime.textContent = `${state.stepMs.toFixed(1)} ms`;
}

function sceneMetrics() {
  const positions = state.bodies.map((body) => body.mesh.position);
  const escapedLow = positions.filter((p, index) => {
    const half = state.bodies[index].size.clone().multiplyScalar(0.5);
    return p.x - half.x < -world.halfX - 0.02 || p.x + half.x > world.halfX + 0.02 || p.z - half.z < -world.halfZ - 0.02 || p.z + half.z > world.halfZ + 0.02 || p.y - half.y < world.floorY - 0.02;
  }).length;
  const sleeping = state.bodies.filter((body) => body.sleeping).length;
  const avgY = positions.reduce((sum, p) => sum + p.y, 0) / positions.length;
  return {
    mode: "3d",
    engine: "three-3d",
    bodies: state.bodies.length,
    fps: Math.round(state.fps),
    stepMs: Number(state.stepMs.toFixed(2)),
    contacts: state.contacts,
    stirHits: state.stirHits,
    stirEvents: state.stirEvents,
    idleFrames: state.idleFrames,
    selected: Boolean(state.selected),
    stirring: state.stirring,
    sleeping,
    camera: camera.position.toArray().map((value) => Number(value.toFixed(2))),
    firstBody: state.bodies[0].mesh.position.toArray().map((value) => Number(value.toFixed(2))),
    cameraMoved: state.cameraMoved,
    avgY: Number(avgY.toFixed(3)),
    escapedLow,
  };
}

window.__particleCrateDebug = {
  metrics() {
    return app.mode === "2d" ? mode2d.metrics() : sceneMetrics();
  },
  setMode,
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
  stirAt(x = 0, z = 0, dx = 1.6, dz = 0) {
    state.stirring = true;
    state.selected = null;
    state.stirEvents = 0;
    state.stirTarget.set(x, 0.34, z);
    state.stirPrevious.copy(state.stirTarget);
    stirCursor.visible = true;
    stirCursor.position.copy(state.stirTarget);
    for (let i = 0; i < 16; i += 1) {
      state.stirDelta.set(dx / 16, 0, dz / 16);
      state.stirTarget.x = clamp(state.stirTarget.x + state.stirDelta.x, -world.halfX + 0.4, world.halfX - 0.4);
      state.stirTarget.z = clamp(state.stirTarget.z + state.stirDelta.z, -world.halfZ + 0.4, world.halfZ - 0.4);
      stirCursor.position.copy(state.stirTarget);
      stepPhysics(1 / 60);
    }
    state.stirring = false;
    stirCursor.visible = false;
    return sceneMetrics();
  },
  stirFirstBody(dx = 1.4, dz = 0.2) {
    const body = state.bodies[0];
    return this.stirAt(body.mesh.position.x, body.mesh.position.z, dx, dz);
  },
  push2dAt(x = 600, y = 650, vx = 24, vy = -16) {
    setMode("2d");
    return mode2d.pushAt(x, y, vx, vy);
  },
  launch2dOut() {
    setMode("2d");
    return mode2d.launchOut();
  },
  settle3d(frames = 360) {
    setMode("3d");
    state.selected = null;
    state.stirring = false;
    for (let i = 0; i < frames; i += 1) stepPhysics(1 / 60);
    return sceneMetrics();
  },
  sampleHeights() {
    return state.bodies.slice(0, 16).map((body) => Number(body.mesh.position.y.toFixed(2)));
  },
};

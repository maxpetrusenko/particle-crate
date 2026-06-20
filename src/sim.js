import { config, crateTop, palette, wallMargin, wallStroke } from "./constants.js";
import { createHandmadeEngine } from "./engines/handmade.js";
import { clamp } from "./math.js";
import { createMetrics, sampleStep } from "./metrics.js";
import { createRenderer } from "./render.js";

const canvas = document.querySelector("#sim");
const ctx = canvas.getContext("2d");
const bodyCount = document.querySelector("#bodyCount");
const particleCount = document.querySelector("#particleCount");
const gridCount = document.querySelector("#gridCount");
const fps = document.querySelector("#fps");
const engineStatus = document.querySelector("#engineStatus");
const stepTime = document.querySelector("#stepTime");

const state = {
  bodies: [],
  particles: [],
  grid: new Map(),
  pointer: null,
  lastTime: performance.now(),
  dripClock: 0,
  fps: 60,
  scale: 1,
  engine: { id: "loading", label: "loading" },
  metrics: createMetrics(),
  world: { width: 1200, height: 820, floor: 720, left: 80, right: 1120 },
};

const render = createRenderer({
  ctx,
  state,
  config,
  wallStroke,
  crateTop,
  bodyCount,
  particleCount,
  gridCount,
  fps,
  engineStatus,
  stepTime,
});

const bounds = () => ({
  left: state.world.left + wallStroke / 2 + wallMargin,
  right: state.world.right - wallStroke / 2 - wallMargin,
  top: crateTop + wallStroke / 2 + wallMargin,
  floor: state.world.floor - wallStroke / 2 - wallMargin,
});

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.scale = rect.width / state.world.width;
  state.world.height = rect.height / state.scale;
  state.world.floor = state.world.height - 78;
}

function engineParams() {
  return { state, config, palette, bounds };
}

async function makeEngine(id) {
  if (id === "rapier") {
    const { createRapierEngine } = await import("./engines/rapier.js");
    return createRapierEngine(engineParams());
  }
  return createHandmadeEngine(engineParams());
}

async function switchEngine(id) {
  const previousPointer = state.pointer;
  state.engine.dispose?.();
  state.engine = { id: "loading", label: "loading" };
  render();

  const engine = await makeEngine(id);
  state.engine = engine;
  state.metrics.engine = engine.id;
  state.metrics.label = engine.label;
  state.metrics.resetCount += 1;
  state.pointer = previousPointer;
  engine.reset();
  return metrics();
}

async function toggleEngine() {
  return switchEngine(state.engine.id === "rapier" ? "handmade" : "rapier");
}

function step(now) {
  const rawDt = (now - state.lastTime) / 1000;
  const dt = Math.max(0.001, Math.min(rawDt, 0.024));
  state.lastTime = now;
  state.fps = state.fps * 0.92 + (1 / dt) * 0.08;

  if (state.engine.step) {
    const startedAt = performance.now();
    const details = state.engine.step(dt);
    sampleStep(state.metrics, startedAt, details);
  }

  render();
  requestAnimationFrame(step);
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return constrainPointer({
    x: (event.clientX - rect.left) / state.scale,
    y: (event.clientY - rect.top) / state.scale,
  });
}

function constrainPointer(point) {
  const bin = bounds();
  const radius = config.obstacleRadius + 4;
  return {
    x: clamp(point.x, bin.left + radius, bin.right - radius),
    y: clamp(point.y, bin.top + radius, bin.floor - radius),
  };
}

canvas.addEventListener("pointerdown", (event) => {
  canvas.setPointerCapture(event.pointerId);
  const point = canvasPoint(event);
  state.pointer = { ...point, vx: 0, vy: 0 };
});

canvas.addEventListener("pointermove", (event) => {
  const point = canvasPoint(event);
  const previous = state.pointer;
  state.pointer = {
    ...point,
    vx: previous ? point.x - previous.x : 0,
    vy: previous ? point.y - previous.y : 0,
  };
});

canvas.addEventListener("pointerup", () => {
  // Keep the hover obstacle active after drag release.
});

canvas.addEventListener("pointercancel", () => {
  state.pointer = null;
});

canvas.addEventListener("pointerleave", () => {
  state.pointer = null;
});

window.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    state.engine.dropBatch?.();
  }
  if (event.key.toLowerCase() === "r") state.engine.reset?.();
  if (event.key.toLowerCase() === "d") config.showDiscs = !config.showDiscs;
  if (event.key.toLowerCase() === "e") {
    event.preventDefault();
    void toggleEngine();
  }
});

window.addEventListener("resize", () => {
  resize();
  state.engine.reset?.();
});

function metrics() {
  return {
    engine: state.engine.id,
    label: state.engine.label,
    bodies: state.bodies.length,
    particles: state.particles.length,
    cells: state.grid.size,
    fps: Math.round(state.fps),
    stepMs: Number(state.metrics.stepMs.toFixed(2)),
    contacts: state.metrics.contacts,
    obstacleHits: state.metrics.obstacleHits,
    hasPointer: Boolean(state.pointer),
  };
}

async function compareEngines(sampleMs = 2500) {
  const original = state.engine.id === "rapier" ? "rapier" : "handmade";
  const results = {};

  for (const id of ["handmade", "rapier"]) {
    await switchEngine(id);
    await new Promise((resolve) => setTimeout(resolve, sampleMs));
    results[id] = {
      ...metrics(),
      containment: state.engine.checkContainment(),
    };
  }

  await switchEngine(original);
  state.metrics.lastComparison = results;
  return results;
}

window.__particleCrateDebug = {
  setPointer(x, y, vx = 0, vy = 0) {
    state.pointer = { ...constrainPointer({ x, y }), vx, vy };
  },
  clearPointer() {
    state.pointer = null;
  },
  async setEngine(id) {
    if (!["handmade", "rapier"].includes(id)) throw new Error(`Unknown engine: ${id}`);
    return switchEngine(id);
  },
  async toggleEngine() {
    return toggleEngine();
  },
  checkContainment() {
    return state.engine.checkContainment?.() ?? { bodies: 0, leaks: 0, worst: 0, bounds: bounds() };
  },
  metrics,
  compareEngines,
};

resize();
await switchEngine("handmade");
requestAnimationFrame(step);

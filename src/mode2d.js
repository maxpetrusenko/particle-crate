import { config, crateTop, palette, wallMargin, wallStroke } from "./constants.js";
import { createHandmadeEngine } from "./engines/handmade.js";
import { clamp } from "./math.js";
import { createMetrics, sampleStep } from "./metrics.js";
import { createRenderer } from "./render.js";

config.density = 180;

export function create2dMode({ canvas, hud }) {
  const ctx = canvas.getContext("2d");
  const state = {
    bodies: [],
    particles: [],
    grid: new Map(),
    pointer: null,
    dripClock: 0,
    activeFrames: 0,
    fps: 60,
    scale: 1,
    engine: { id: "loading", label: "loading" },
    metrics: createMetrics(),
    world: { width: 1200, height: 820, floor: 720, left: 80, right: 1120 },
  };

  const bounds = () => ({
    left: state.world.left + wallStroke / 2 + wallMargin,
    right: state.world.right - wallStroke / 2 - wallMargin,
    top: crateTop + wallStroke / 2 + wallMargin,
    floor: state.world.floor - wallStroke / 2 - wallMargin,
  });

  const render = createRenderer({
    ctx,
    state,
    config,
    wallStroke,
    crateTop,
    bodyCount: hud.bodyCount,
    particleCount: hud.particleCount,
    gridCount: hud.gridCount,
    fps: hud.fps,
    engineStatus: hud.engineStatus,
    stepTime: hud.stepTime,
  });

  const engine = createHandmadeEngine({ state, config, palette, bounds });
  state.engine = engine;
  state.metrics.engine = engine.id;
  state.metrics.label = engine.label;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.scale = rect.width / state.world.width;
    state.world.height = rect.height / state.scale;
    state.world.floor = state.world.height - 78;
  }

  function constrainPointer(point) {
    const bin = bounds();
    const radius = config.obstacleRadius + 4;
    return {
      x: clamp(point.x, bin.left + radius, bin.right - radius),
      y: clamp(point.y, bin.top + radius, bin.floor - radius),
    };
  }

  function setPointer(point, vx = 0, vy = 0) {
    state.pointer = { ...constrainPointer(point), vx, vy };
    if (Math.hypot(vx, vy) > 0.01) activate(120);
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return constrainPointer({
      x: (event.clientX - rect.left) / state.scale,
      y: (event.clientY - rect.top) / state.scale,
    });
  }

  function step(dt) {
    const startedAt = performance.now();
    let details = { contacts: 0, obstacleHits: 0 };
    if (state.pointer || state.activeFrames > 0) {
      details = engine.step(dt);
      if (!state.pointer && state.activeFrames > 0) state.activeFrames -= 1;
      if (!state.pointer && state.activeFrames <= 0) {
        state.activeFrames = 0;
        details = engine.freeze();
      }
    }
    sampleStep(state.metrics, startedAt, details);
    state.fps = state.fps * 0.92 + (1 / Math.max(dt, 0.001)) * 0.08;
    render();
  }

  function activate(frames = 120) {
    state.activeFrames = Math.max(state.activeFrames, frames);
  }

  function metrics() {
    const containment = engine.checkContainment();
    return {
      mode: "2d",
      engine: "js-discs-2d",
      bodies: state.bodies.length,
      particles: state.particles.length,
      fps: Math.round(state.fps),
      stepMs: Number(state.metrics.stepMs.toFixed(2)),
      contacts: state.metrics.contacts,
      obstacleHits: state.metrics.obstacleHits,
      hasPointer: Boolean(state.pointer),
      activeFrames: state.activeFrames,
      driven: Boolean(state.pointer) || state.activeFrames > 0,
      leaks: containment.leaks,
    };
  }

  function escapedCount() {
    const bin = bounds();
    return state.bodies.filter((body) => body.x < bin.left - body.w || body.x > bin.right + body.w || body.y < bin.top - body.h).length;
  }

  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    setPointer(canvasPoint(event), 0, 0);
    activate(90);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!state.pointer) return;
    event.preventDefault();
    const point = canvasPoint(event);
    setPointer(point, point.x - state.pointer.x, point.y - state.pointer.y);
  });

  canvas.addEventListener("pointerup", (event) => {
    canvas.releasePointerCapture(event.pointerId);
    state.pointer = null;
  });

  canvas.addEventListener("pointercancel", () => {
    state.pointer = null;
  });

  resize();
  engine.reset();
  engine.freeze();
  render();

  return {
    resize,
    render,
    step,
    reset() {
      state.activeFrames = 0;
      state.pointer = null;
      const result = engine.reset();
      engine.freeze();
      render();
      return result;
    },
    dropBatch(size) {
      activate(180);
      return engine.dropBatch(size);
    },
    metrics,
    samplePositions(limit = 16) {
      return state.bodies.slice(0, limit).map((body) => [
        Number(body.x.toFixed(2)),
        Number(body.y.toFixed(2)),
        Number(body.angle.toFixed(3)),
      ]);
    },
    run(frames = 60) {
      for (let i = 0; i < frames; i += 1) step(1 / 60);
      return metrics();
    },
    pushAt(x = 600, y = 650, vx = 24, vy = -16) {
      setPointer({ x, y }, vx, vy);
      for (let i = 0; i < 40; i += 1) step(1 / 60);
      state.pointer = null;
      return metrics();
    },
    launchOut() {
      const bin = bounds();
      state.pointer = null;
      activate(80);
      const body = state.bodies[0];
      body.x = bin.right - 8;
      body.y = bin.top - 90;
      body.vx = 1500;
      body.vy = -620;
      body.omega = 8;
      for (let i = 0; i < 24; i += 1) step(1 / 60);
      return { ...metrics(), escaped: escapedCount(), launched: [Number(body.x.toFixed(1)), Number(body.y.toFixed(1))] };
    },
  };
}

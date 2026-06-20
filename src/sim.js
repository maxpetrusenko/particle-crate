import { createRenderer } from "./render.js";

const canvas = document.querySelector("#sim");
const ctx = canvas.getContext("2d");
const bodyCount = document.querySelector("#bodyCount");
const particleCount = document.querySelector("#particleCount");
const gridCount = document.querySelector("#gridCount");
const fps = document.querySelector("#fps");

const palette = ["#ef455d", "#2dc49e", "#f1b43d", "#9862e5", "#50d2c8"];
const wallStroke = 10;
const wallMargin = 7;
const config = {
  density: 900,
  gravity: 980,
  bounce: 0.08,
  friction: 0.42,
  obstacleRadius: 56,
  showDiscs: false,
};

const state = {
  bodies: [],
  particles: [],
  grid: new Map(),
  pointer: null,
  lastTime: performance.now(),
  dripClock: 0,
  fps: 60,
  scale: 1,
  world: { width: 1200, height: 820, floor: 720, left: 80, right: 1120 },
};
const render = createRenderer({ ctx, state, config, wallStroke, bodyCount, particleCount, gridCount, fps });

const rand = (min, max) => min + Math.random() * (max - min);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const bounds = () => ({
  left: state.world.left + wallStroke / 2 + wallMargin,
  right: state.world.right - wallStroke / 2 - wallMargin,
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

function makeBody(x, y, color) {
  const wide = Math.random() > 0.34;
  const w = wide ? rand(23, 35) : rand(16, 24);
  const h = wide ? rand(10, 15) : rand(18, 28);
  const radius = 5.2;
  const cols = Math.max(2, Math.round(w / 8));
  const rows = Math.max(2, Math.round(h / 8));
  const discs = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      discs.push({
        ox: cols === 1 ? 0 : (col / (cols - 1) - 0.5) * (w - radius),
        oy: rows === 1 ? 0 : (row / (rows - 1) - 0.5) * (h - radius),
        radius,
      });
    }
  }

  const mass = discs.length;
  return {
    x,
    y,
    angle: rand(-0.8, 0.8),
    vx: rand(-28, 28),
    vy: rand(-18, 28),
    omega: rand(-3.2, 3.2),
    w,
    h,
    invMass: 1 / mass,
    invInertia: 12 / (mass * (w * w + h * h)),
    color,
    discs,
    sleep: 0,
  };
}

function reset() {
  state.bodies = [];
  const count = config.density;
  const bin = bounds();
  const pileTop = Math.max(190, bin.floor - 430);

  for (let i = 0; i < count; i += 1) {
    const x = rand(bin.left + 36, bin.right - 36);
    const y = rand(pileTop, bin.floor - 34);
    const color = palette[Math.floor(rand(0, palette.length))];
    state.bodies.push(makeBody(x, y, color));
  }
}

function dropBatch(size = 120) {
  const start = state.bodies.length;
  const bin = bounds();
  for (let i = 0; i < size; i += 1) {
    const x = rand(bin.left + 40, bin.right - 40);
    const y = rand(10, 130);
    state.bodies.push(makeBody(x, y, palette[(start + i) % palette.length]));
  }
}

function trimOverflow() {
  if (state.bodies.length <= 1420) return;
  state.bodies.splice(0, state.bodies.length - 1420);
}

function worldDisc(body, disc, bodyIndex) {
  const cos = Math.cos(body.angle);
  const sin = Math.sin(body.angle);
  const rx = disc.ox * cos - disc.oy * sin;
  const ry = disc.ox * sin + disc.oy * cos;
  return {
    bodyIndex,
    x: body.x + rx,
    y: body.y + ry,
    ox: rx,
    oy: ry,
    radius: disc.radius,
  };
}

function rebuildGrid() {
  state.grid.clear();
  state.particles = [];
  const cell = 15;

  state.bodies.forEach((body, bodyIndex) => {
    for (const disc of body.discs) {
      const p = worldDisc(body, disc, bodyIndex);
      state.particles.push(p);
      const gx = Math.floor(p.x / cell);
      const gy = Math.floor(p.y / cell);
      const key = `${gx}:${gy}`;
      if (!state.grid.has(key)) state.grid.set(key, []);
      state.grid.get(key).push(p);
    }
  });
}

function applyPush(body, px, py, nx, ny, strength) {
  body.x += nx * strength * body.invMass;
  body.y += ny * strength * body.invMass;
}

function velocityAt(body, px, py) {
  return {
    x: body.vx - body.omega * py,
    y: body.vy + body.omega * px,
  };
}

function applyImpulse(body, px, py, ix, iy) {
  body.vx += ix * body.invMass;
  body.vy += iy * body.invMass;
  body.omega += (px * iy - py * ix) * body.invInertia;
}

function collideParticles() {
  const cell = 15;
  const seen = new Set();

  for (const p of state.particles) {
    const gx = Math.floor(p.x / cell);
    const gy = Math.floor(p.y / cell);

    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        const bucket = state.grid.get(`${gx + ox}:${gy + oy}`);
        if (!bucket) continue;

        for (const q of bucket) {
          if (p.bodyIndex >= q.bodyIndex) continue;
          const pairKey = `${p.bodyIndex}:${q.bodyIndex}:${p.x | 0}:${q.x | 0}:${p.y | 0}:${q.y | 0}`;
          if (seen.has(pairKey)) continue;
          seen.add(pairKey);

          const dx = q.x - p.x;
          const dy = q.y - p.y;
          const limit = p.radius + q.radius;
          const d2 = dx * dx + dy * dy;
          if (d2 <= 0.0001 || d2 > limit * limit) continue;

          const dist = Math.sqrt(d2);
          const overlap = (limit - dist) * 0.56;
          const nx = dx / dist;
          const ny = dy / dist;
          const a = state.bodies[p.bodyIndex];
          const b = state.bodies[q.bodyIndex];
          applyPush(a, p.ox, p.oy, -nx, -ny, overlap);
          applyPush(b, q.ox, q.oy, nx, ny, overlap);

          const va = velocityAt(a, p.ox, p.oy);
          const vb = velocityAt(b, q.ox, q.oy);
          const rvx = vb.x - va.x;
          const rvy = vb.y - va.y;
          const normalVelocity = rvx * nx + rvy * ny;
          const raCrossN = p.ox * ny - p.oy * nx;
          const rbCrossN = q.ox * ny - q.oy * nx;
          const normalMass =
            a.invMass +
            b.invMass +
            raCrossN * raCrossN * a.invInertia +
            rbCrossN * rbCrossN * b.invInertia;

          if (normalVelocity < 0 && normalMass > 0) {
            const j = (-(1 + config.bounce) * normalVelocity) / normalMass;
            const ix = j * nx;
            const iy = j * ny;
            applyImpulse(a, p.ox, p.oy, -ix, -iy);
            applyImpulse(b, q.ox, q.oy, ix, iy);

            let tx = rvx - normalVelocity * nx;
            let ty = rvy - normalVelocity * ny;
            const tangentLength = Math.hypot(tx, ty);
            if (tangentLength > 0.001) {
              tx /= tangentLength;
              ty /= tangentLength;
              const raCrossT = p.ox * ty - p.oy * tx;
              const rbCrossT = q.ox * ty - q.oy * tx;
              const tangentMass =
                a.invMass +
                b.invMass +
                raCrossT * raCrossT * a.invInertia +
                rbCrossT * rbCrossT * b.invInertia;
              const jt = clamp(-(rvx * tx + rvy * ty) / tangentMass, -j * config.friction, j * config.friction);
              applyImpulse(a, p.ox, p.oy, -jt * tx, -jt * ty);
              applyImpulse(b, q.ox, q.oy, jt * tx, jt * ty);
            }
          }
        }
      }
    }
  }
}

function collideWalls(body) {
  const bounce = config.bounce;
  const bin = bounds();
  for (const disc of body.discs) {
    const p = worldDisc(body, disc, -1);
    const floorOverlap = p.y + p.radius - bin.floor;
    const leftOverlap = bin.left - (p.x - p.radius);
    const rightOverlap = p.x + p.radius - bin.right;

    if (floorOverlap > 0) {
      body.y -= floorOverlap * 0.62;
      const v = velocityAt(body, p.ox, p.oy);
      const raCrossN = p.ox;
      const denom = body.invMass + raCrossN * raCrossN * body.invInertia;
      const impulse = Math.max(0, ((1 + bounce) * v.y) / denom);
      applyImpulse(body, p.ox, p.oy, 0, -impulse);
      const friction = clamp(v.x / denom, -impulse * config.friction, impulse * config.friction);
      applyImpulse(body, p.ox, p.oy, -friction, 0);
    }
    if (leftOverlap > 0) {
      body.x += leftOverlap;
      body.vx = Math.abs(body.vx) * bounce;
    }
    if (rightOverlap > 0) {
      body.x -= rightOverlap;
      body.vx = -Math.abs(body.vx) * bounce;
    }
  }
  clampVisibleHull(body, bin);
}

function collideObstacle(body) {
  if (!state.pointer) return 0;
  let hits = 0;

  for (const disc of body.discs) {
    const p = worldDisc(body, disc, -1);
    const dx = p.x - state.pointer.x;
    const dy = p.y - state.pointer.y;
    const limit = disc.radius + config.obstacleRadius;
    const d2 = dx * dx + dy * dy;
    if (d2 <= 0.0001 || d2 > limit * limit) continue;

    const dist = Math.sqrt(d2);
    const nx = dx / dist;
    const ny = dy / dist;
    const overlap = limit - dist;
    body.x += nx * overlap * 0.72;
    body.y += ny * overlap * 0.72;

    const v = velocityAt(body, p.ox, p.oy);
    const rvx = v.x - state.pointer.vx * 22;
    const rvy = v.y - state.pointer.vy * 22;
    const normalVelocity = rvx * nx + rvy * ny;
    const rCrossN = p.ox * ny - p.oy * nx;
    const normalMass = body.invMass + rCrossN * rCrossN * body.invInertia;

    if (normalMass > 0) {
      const j = Math.max(0, (-(1 + 0.18) * normalVelocity) / normalMass);
      applyImpulse(body, p.ox, p.oy, j * nx, j * ny);
      const tx = -ny;
      const ty = nx;
      const tangentVelocity = rvx * tx + rvy * ty;
      const rCrossT = p.ox * ty - p.oy * tx;
      const tangentMass = body.invMass + rCrossT * rCrossT * body.invInertia;
      const jt = clamp(-tangentVelocity / tangentMass, -j * 0.55, j * 0.55);
      applyImpulse(body, p.ox, p.oy, jt * tx, jt * ty);
    }
    body.omega += clamp((state.pointer.vx * ny - state.pointer.vy * nx) * 0.018, -3.6, 3.6);
    hits += 1;
  }

  return hits;
}

function clampVisibleHull(body, bin) {
  const cos = Math.cos(body.angle);
  const sin = Math.sin(body.angle);
  const corners = [
    [-body.w / 2, -body.h / 2],
    [body.w / 2, -body.h / 2],
    [body.w / 2, body.h / 2],
    [-body.w / 2, body.h / 2],
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const [x, y] of corners) {
    const wx = body.x + x * cos - y * sin;
    const wy = body.y + x * sin + y * cos;
    minX = Math.min(minX, wx);
    maxX = Math.max(maxX, wx);
    maxY = Math.max(maxY, wy);
  }

  if (minX < bin.left) {
    body.x += bin.left - minX;
    body.vx = Math.max(0, body.vx) * config.bounce;
  }
  if (maxX > bin.right) {
    body.x -= maxX - bin.right;
    body.vx = Math.min(0, body.vx) * config.bounce;
  }
  if (maxY > bin.floor) {
    body.y -= maxY - bin.floor;
    body.vy = Math.min(0, body.vy) * config.bounce;
    body.vx *= 0.96;
    body.omega *= 0.9;
  }
}

function step(now) {
  const rawDt = (now - state.lastTime) / 1000;
  const dt = clamp(rawDt, 0.001, 0.024);
  state.lastTime = now;
  state.fps = state.fps * 0.92 + (1 / dt) * 0.08;

  const gravity = config.gravity;
  state.dripClock += dt;
  if (state.dripClock > 0.72 && state.bodies.length < 1420) {
    state.dripClock = 0;
    dropBatch(12);
    trimOverflow();
  }

  for (const body of state.bodies) {
    body.vy += gravity * dt;
    body.x += body.vx * dt;
    body.y += body.vy * dt;
    body.angle += body.omega * dt;
    body.vx *= 0.999;
    body.vy *= 0.999;
    body.omega *= 0.993;
    collideWalls(body);
  }

  for (let i = 0; i < 3; i += 1) {
    rebuildGrid();
    collideParticles();
    for (const body of state.bodies) {
      collideObstacle(body);
      collideWalls(body);
    }
  }

  render();
  requestAnimationFrame(step);
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / state.scale,
    y: (event.clientY - rect.top) / state.scale,
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
    dropBatch();
  }
  if (event.key.toLowerCase() === "r") reset();
  if (event.key.toLowerCase() === "d") config.showDiscs = !config.showDiscs;
});
window.addEventListener("resize", () => {
  resize();
  reset();
});

resize();
reset();
requestAnimationFrame(step);

function bodyHull(body) {
  const cos = Math.cos(body.angle);
  const sin = Math.sin(body.angle);
  const corners = [
    [-body.w / 2, -body.h / 2],
    [body.w / 2, -body.h / 2],
    [body.w / 2, body.h / 2],
    [-body.w / 2, body.h / 2],
  ];
  return corners.map(([x, y]) => ({
    x: body.x + x * cos - y * sin,
    y: body.y + x * sin + y * cos,
  }));
}

window.__particleCrateDebug = {
  setPointer(x, y, vx = 0, vy = 0) {
    state.pointer = { x, y, vx, vy };
  },
  clearPointer() {
    state.pointer = null;
  },
  checkContainment() {
    const bin = bounds();
    let leaks = 0;
    let worst = 0;
    for (const body of state.bodies) {
      for (const point of bodyHull(body)) {
        const over = Math.max(bin.left - point.x, point.x - bin.right, point.y - bin.floor, 0);
        if (over > 0.75) leaks += 1;
        worst = Math.max(worst, over);
      }
    }
    return { bodies: state.bodies.length, leaks, worst: Number(worst.toFixed(2)), bounds: bin };
  },
  metrics() {
    return {
      bodies: state.bodies.length,
      particles: state.particles.length,
      cells: state.grid.size,
      fps: Math.round(state.fps),
      hasPointer: Boolean(state.pointer),
    };
  },
};

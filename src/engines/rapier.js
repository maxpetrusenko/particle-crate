import RAPIER from "../../vendor/rapier2d-compat/rapier.mjs";
import { bodyLimit } from "../constants.js";
import { bodyHull, clamp, rand } from "../math.js";

let rapierReady;

export async function createRapierEngine({ state, config, palette, bounds }) {
  rapierReady ||= RAPIER.init();
  await rapierReady;

  let world;
  let obstacleBody;
  let obstacleCollider;

  const engine = {
    id: "rapier",
    label: "Rapier WASM",
    ready: Promise.resolve(),
    reset,
    dropBatch,
    step,
    checkContainment,
    dispose,
  };

  function createWorld() {
    world?.free?.();
    world = new RAPIER.World({ x: 0, y: config.gravity });
    world.lengthUnit = 100;
    world.numSolverIterations = 10;
    world.numInternalPgsIterations = 3;
    createStaticCrate();
    createObstacle();
  }

  function createStaticCrate() {
    const bin = bounds();
    const thickness = 18;
    const wallHeight = bin.floor - bin.top + thickness;
    const wallCenterY = bin.top + wallHeight / 2;
    const crateWidth = bin.right - bin.left;

    world.createCollider(
      RAPIER.ColliderDesc.cuboid(crateWidth / 2, thickness / 2)
        .setTranslation((bin.left + bin.right) / 2, bin.top - thickness / 2)
        .setFriction(config.friction)
        .setRestitution(config.bounce),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(crateWidth / 2, thickness / 2)
        .setTranslation((bin.left + bin.right) / 2, bin.floor + thickness / 2)
        .setFriction(config.friction)
        .setRestitution(config.bounce),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(thickness / 2, wallHeight / 2)
        .setTranslation(bin.left - thickness / 2, wallCenterY)
        .setFriction(config.friction)
        .setRestitution(config.bounce),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(thickness / 2, wallHeight / 2)
        .setTranslation(bin.right + thickness / 2, wallCenterY)
        .setFriction(config.friction)
        .setRestitution(config.bounce),
    );
  }

  function createObstacle() {
    obstacleBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(-500, -500));
    obstacleCollider = world.createCollider(
      RAPIER.ColliderDesc.ball(config.obstacleRadius)
        .setFriction(0.72)
        .setRestitution(0.28),
      obstacleBody,
    );
  }

  function makeBody(x, y, color) {
    const wide = Math.random() > 0.34;
    const w = wide ? rand(23, 35) : rand(16, 24);
    const h = wide ? rand(10, 15) : rand(18, 28);
    const angle = rand(-0.8, 0.8);
    const rigid = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y)
        .setRotation(angle)
        .setLinvel(rand(-28, 28), rand(-18, 28))
        .setAngvel(rand(-3.2, 3.2))
        .setLinearDamping(0.001)
        .setAngularDamping(0.18)
        .setCcdEnabled(true),
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(w / 2, h / 2, 2.2)
        .setDensity(0.86)
        .setFriction(config.friction)
        .setRestitution(config.bounce),
      rigid,
    );

    return { x, y, angle, w, h, color, rigid, collider, discs: [] };
  }

  function syncBody(body) {
    const t = body.rigid.translation();
    body.x = t.x;
    body.y = t.y;
    body.angle = body.rigid.rotation();
  }

  function reset() {
    createWorld();
    state.bodies = [];
    state.particles = [];
    state.grid.clear();
    state.dripClock = 0;
    const bin = bounds();
    const pileTop = Math.max(bin.top + 30, bin.floor - 430);

    for (let i = 0; i < config.density; i += 1) {
      const x = rand(bin.left + 36, bin.right - 36);
      const y = rand(pileTop, bin.floor - 34);
      state.bodies.push(makeBody(x, y, palette[Math.floor(rand(0, palette.length))]));
    }
    updateParticleCount();
  }

  function dropBatch(size = 120) {
    const start = state.bodies.length;
    const bin = bounds();
    for (let i = 0; i < size; i += 1) {
      const x = rand(bin.left + 40, bin.right - 40);
      const y = rand(bin.top + 28, bin.top + 150);
      state.bodies.push(makeBody(x, y, palette[(start + i) % palette.length]));
    }
    trimOverflow();
    updateParticleCount();
  }

  function trimOverflow() {
    while (state.bodies.length > bodyLimit) {
      const removed = state.bodies.shift();
      world.removeRigidBody(removed.rigid);
    }
  }

  function updateObstacle() {
    if (!state.pointer) {
      obstacleBody.setNextKinematicTranslation({ x: -500, y: -500 });
      obstacleCollider.setEnabled(false);
      return 0;
    }

    obstacleCollider.setEnabled(true);
    obstacleBody.setNextKinematicTranslation({ x: state.pointer.x, y: state.pointer.y });
    return applyPointerImpulse();
  }

  function applyPointerImpulse() {
    let hits = 0;
    const px = state.pointer.x;
    const py = state.pointer.y;
    const radius = config.obstacleRadius + 28;
    const speed = Math.hypot(state.pointer.vx, state.pointer.vy);

    for (const body of state.bodies) {
      const dx = body.x - px;
      const dy = body.y - py;
      const d = Math.hypot(dx, dy);
      if (d <= 0.001 || d > radius) continue;

      const nx = dx / d;
      const ny = dy / d;
      const pressure = (1 - d / radius) * (220 + speed * 18);
      body.rigid.applyImpulseAtPoint({ x: nx * pressure, y: ny * pressure }, { x: body.x, y: body.y }, true);
      body.rigid.applyTorqueImpulse(clamp((state.pointer.vx * ny - state.pointer.vy * nx) * 4.5, -1200, 1200), true);
      hits += 1;
    }

    return hits;
  }

  function clampVisibleHull(body, bin) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const point of bodyHull(body)) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }

    let dx = 0;
    let dy = 0;
    if (minX < bin.left) dx = bin.left - minX;
    if (maxX > bin.right) dx = bin.right - maxX;
    if (minY < bin.top) dy = bin.top - minY;
    if (maxY > bin.floor) dy = bin.floor - maxY;
    if (dx === 0 && dy === 0) return;

    body.rigid.setTranslation({ x: body.x + dx, y: body.y + dy }, true);
    const velocity = body.rigid.linvel();
    body.rigid.setLinvel({ x: dx ? 0 : velocity.x * 0.96, y: dy ? 0 : velocity.y }, true);
    syncBody(body);
  }

  function updateParticleCount() {
    state.particles = state.bodies.map((body, bodyIndex) => ({ bodyIndex, x: body.x, y: body.y, radius: Math.max(body.w, body.h) / 2 }));
    state.grid.clear();
  }

  function step(dt) {
    state.dripClock += dt;
    if (state.dripClock > 0.72 && state.bodies.length < bodyLimit) {
      state.dripClock = 0;
      dropBatch(12);
    }

    const obstacleHits = updateObstacle();
    world.timestep = dt;
    world.step();

    const bin = bounds();
    for (const body of state.bodies) {
      syncBody(body);
      clampVisibleHull(body, bin);
    }
    updateParticleCount();

    return { contacts: state.bodies.length, obstacleHits };
  }

  function checkContainment() {
    const bin = bounds();
    let leaks = 0;
    let worst = 0;
    for (const body of state.bodies) {
      for (const point of bodyHull(body)) {
        const over = Math.max(bin.left - point.x, point.x - bin.right, bin.top - point.y, point.y - bin.floor, 0);
        if (over > 0.75) leaks += 1;
        worst = Math.max(worst, over);
      }
    }
    return { bodies: state.bodies.length, leaks, worst: Number(worst.toFixed(2)), bounds: bin };
  }

  function dispose() {
    world?.free?.();
    world = null;
  }

  return engine;
}

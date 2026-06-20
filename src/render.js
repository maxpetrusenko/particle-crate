export function createRenderer({ ctx, state, config, wallStroke, bodyCount, particleCount, gridCount, fps, engineStatus, stepTime }) {
  function roundRectPath(x, y, w, h, radius) {
    const r = Math.min(radius, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function renderBody(body) {
    ctx.save();
    ctx.translate(body.x, body.y);
    ctx.rotate(body.angle);
    roundRectPath(-body.w / 2, -body.h / 2, body.w, body.h, 3);
    ctx.fillStyle = body.color;
    ctx.fill();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = "#06100d";
    ctx.stroke();

    if (config.showDiscs) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = "#f7ffe8";
      for (const disc of body.discs) {
        ctx.beginPath();
        ctx.arc(disc.ox, disc.oy, disc.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function renderWall(alpha) {
    ctx.strokeStyle = `rgba(62, 153, 132, ${alpha})`;
    ctx.lineWidth = wallStroke;
    ctx.beginPath();
    ctx.moveTo(state.world.left, 170);
    ctx.lineTo(state.world.left, state.world.floor);
    ctx.lineTo(state.world.right, state.world.floor);
    ctx.lineTo(state.world.right, 170);
    ctx.stroke();
  }

  function renderObstacle() {
    if (!state.pointer) return;
    ctx.save();
    ctx.translate(state.pointer.x, state.pointer.y);
    ctx.beginPath();
    ctx.arc(0, 0, config.obstacleRadius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(244, 239, 226, 0.08)";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(244, 239, 226, 0.78)";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#f4efe2";
    ctx.fill();
    ctx.restore();
  }

  return function render() {
    ctx.save();
    ctx.scale(state.scale, state.scale);
    ctx.clearRect(0, 0, state.world.width, state.world.height);
    ctx.fillStyle = "#07110f";
    ctx.fillRect(0, 0, state.world.width, state.world.height);

    renderWall(0.75);
    for (const body of state.bodies) renderBody(body);
    renderObstacle();
    renderWall(0.95);
    ctx.restore();

    bodyCount.textContent = `${state.bodies.length} bodies`;
    particleCount.textContent = `${state.particles.length} ${state.engine.id === "rapier" ? "colliders" : "discs"}`;
    gridCount.textContent = `${state.engine.id === "rapier" ? state.metrics.obstacleHits : state.grid.size} ${state.engine.id === "rapier" ? "cursor hits" : "cells"}`;
    fps.textContent = `${Math.round(state.fps)} fps`;
    engineStatus.textContent = state.engine.label;
    stepTime.textContent = `${state.metrics.stepMs.toFixed(1)} ms`;
  };
}

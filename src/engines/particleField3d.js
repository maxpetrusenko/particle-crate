import * as THREE from "three";
import { clamp, rand } from "../math.js";

const FIXED_DT = 1 / 90;

export function createParticleField3D({ scene, palette, world }) {
  const maxParticles = 960;
  const radius = 0.115;
  const diameter = radius * 2;
  const cellSize = diameter * 1.45;
  const positions = new Float32Array(maxParticles * 3);
  const previous = new Float32Array(maxParticles * 3);
  const velocities = new Float32Array(maxParticles * 3);
  const colors = new Float32Array(maxParticles * 3);
  const localOffsets = new Float32Array(maxParticles * 3);
  const objectIds = new Int16Array(maxParticles);
  const locked = new Uint8Array(maxParticles);
  const clusters = [];
  const grid = new Map();
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const geometry = new THREE.IcosahedronGeometry(radius, 1);
  const material = new THREE.MeshStandardMaterial({ roughness: 0.66, metalness: 0.03 });
  const mesh = new THREE.InstancedMesh(geometry, material, maxParticles);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
  scene.add(mesh);

  const state = {
    count: 0,
    accumulator: 0,
    collisions: 0,
    active: 0,
    stepMs: 0,
    substeps: 2,
    iterations: 2,
    exciteEvents: 0,
    stirHits: 0,
    visible: true,
  };

  reset();

  function reset() {
    state.count = 0;
    state.accumulator = 0;
    state.collisions = 0;
    state.active = 0;
    state.exciteEvents = 0;
    state.stirHits = 0;
    clusters.length = 0;
    addFreeBed();
    addVoxelCluster({ x: -2.8, y: 0.55, z: -0.6, columns: 4, rows: 4, layers: 4, colorIndex: 0, lockStrength: 0.34 });
    addVoxelCluster({ x: 1.2, y: 0.7, z: 0.9, columns: 5, rows: 3, layers: 4, colorIndex: 3, lockStrength: 0.3 });
    addVoxelCluster({ x: 4.3, y: 0.52, z: -1.8, columns: 3, rows: 5, layers: 3, colorIndex: 2, lockStrength: 0.38 });
    mesh.count = state.count;
    render();
    return metrics();
  }

  function addFreeBed() {
    const columns = 28;
    const rows = 15;
    const xSpan = world.halfX * 2 - 1.1;
    const zSpan = world.halfZ * 2 - 1.0;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < columns; col += 1) {
        const x = -world.halfX + 0.55 + (col / (columns - 1)) * xSpan + rand(-0.035, 0.035);
        const z = -world.halfZ + 0.5 + (row / (rows - 1)) * zSpan + rand(-0.035, 0.035);
        const y = world.floorY + radius + rand(0, 0.08);
        addParticle({ x, y, z, colorIndex: (row + col) % palette.length });
      }
    }
  }

  function addVoxelCluster({ x, y, z, columns, rows, layers, colorIndex, lockStrength }) {
    const id = clusters.length;
    const indices = [];
    const spacing = diameter * 0.92;
    for (let layer = 0; layer < layers; layer += 1) {
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < columns; col += 1) {
          const ox = (col - (columns - 1) / 2) * spacing;
          const oy = (layer - (layers - 1) / 2) * spacing;
          const oz = (row - (rows - 1) / 2) * spacing;
          const index = addParticle({ x: x + ox, y: y + oy, z: z + oz, colorIndex, objectId: id, lockStrength });
          localOffsets[index * 3] = ox;
          localOffsets[index * 3 + 1] = oy;
          localOffsets[index * 3 + 2] = oz;
          indices.push(index);
        }
      }
    }
    clusters.push({ id, indices, lockStrength });
  }

  function addParticle({ x, y, z, colorIndex = 0, objectId = -1, lockStrength = 0 }) {
    const index = state.count;
    if (index >= maxParticles) return maxParticles - 1;
    setVec(positions, index, x, y, z);
    setVec(previous, index, x, y, z);
    setVec(velocities, index, 0, 0, 0);
    color.set(palette[colorIndex % palette.length]);
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
    objectIds[index] = objectId;
    locked[index] = lockStrength > 0 ? Math.round(lockStrength * 255) : 0;
    state.count += 1;
    return index;
  }

  function step(dt) {
    const startedAt = performance.now();
    state.accumulator += Math.min(dt, 0.05);
    let ran = 0;
    while (state.accumulator >= FIXED_DT && ran < state.substeps) {
      substep(FIXED_DT);
      state.accumulator -= FIXED_DT;
      ran += 1;
    }
    state.stepMs = state.stepMs * 0.86 + (performance.now() - startedAt) * 0.14;
  }

  function substep(dt) {
    state.collisions = 0;
    state.active = 0;
    for (let i = 0; i < state.count; i += 1) {
      const base = i * 3;
      previous[base] = positions[base];
      previous[base + 1] = positions[base + 1];
      previous[base + 2] = positions[base + 2];
      velocities[base + 1] -= world.gravity * 0.42 * dt;
      velocities[base] *= 0.992;
      velocities[base + 1] *= 0.991;
      velocities[base + 2] *= 0.992;
      positions[base] += velocities[base] * dt;
      positions[base + 1] += velocities[base + 1] * dt;
      positions[base + 2] += velocities[base + 2] * dt;
      constrainCrate(i);
      if (kineticEnergy(i) > 0.0005) state.active += 1;
    }

    for (let i = 0; i < state.iterations; i += 1) {
      buildGrid();
      collideParticles();
      applyShapeLocks();
      for (let p = 0; p < state.count; p += 1) constrainCrate(p);
    }

    for (let i = 0; i < state.count; i += 1) {
      const base = i * 3;
      velocities[base] = (positions[base] - previous[base]) / dt;
      velocities[base + 1] = (positions[base + 1] - previous[base + 1]) / dt;
      velocities[base + 2] = (positions[base + 2] - previous[base + 2]) / dt;
    }
  }

  function buildGrid() {
    grid.clear();
    for (let i = 0; i < state.count; i += 1) {
      const key = gridKey(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      let bucket = grid.get(key);
      if (!bucket) {
        bucket = [];
        grid.set(key, bucket);
      }
      bucket.push(i);
    }
  }

  function collideParticles() {
    const seen = new Set();
    for (const [key, bucket] of grid.entries()) {
      const [gx, gy, gz] = key.split(":").map(Number);
      for (let oz = -1; oz <= 1; oz += 1) {
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            const neighbor = grid.get(`${gx + ox}:${gy + oy}:${gz + oz}`);
            if (!neighbor) continue;
            for (const a of bucket) {
              for (const b of neighbor) {
                if (a >= b) continue;
                const pair = `${a}:${b}`;
                if (seen.has(pair)) continue;
                seen.add(pair);
                collidePair(a, b);
              }
            }
          }
        }
      }
    }
  }

  function collidePair(a, b) {
    const ia = a * 3;
    const ib = b * 3;
    const dx = positions[ib] - positions[ia];
    const dy = positions[ib + 1] - positions[ia + 1];
    const dz = positions[ib + 2] - positions[ia + 2];
    const distance = Math.hypot(dx, dy, dz);
    const minDistance = diameter * (objectIds[a] === objectIds[b] && objectIds[a] >= 0 ? 0.72 : 0.98);
    if (distance >= minDistance || distance <= 0.0001) return;
    const overlap = (minDistance - distance) * 0.5;
    const nx = dx / distance;
    const ny = dy / distance;
    const nz = dz / distance;
    positions[ia] -= nx * overlap;
    positions[ia + 1] -= ny * overlap;
    positions[ia + 2] -= nz * overlap;
    positions[ib] += nx * overlap;
    positions[ib + 1] += ny * overlap;
    positions[ib + 2] += nz * overlap;
    state.collisions += 1;
  }

  function applyShapeLocks() {
    for (const cluster of clusters) {
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (const index of cluster.indices) {
        cx += positions[index * 3];
        cy += positions[index * 3 + 1];
        cz += positions[index * 3 + 2];
      }
      cx /= cluster.indices.length;
      cy /= cluster.indices.length;
      cz /= cluster.indices.length;
      for (const index of cluster.indices) {
        const base = index * 3;
        const targetX = cx + localOffsets[base];
        const targetY = cy + localOffsets[base + 1];
        const targetZ = cz + localOffsets[base + 2];
        positions[base] += (targetX - positions[base]) * cluster.lockStrength;
        positions[base + 1] += (targetY - positions[base + 1]) * cluster.lockStrength;
        positions[base + 2] += (targetZ - positions[base + 2]) * cluster.lockStrength;
      }
    }
  }

  function constrainCrate(index) {
    const base = index * 3;
    if (positions[base] < -world.halfX + radius) {
      positions[base] = -world.halfX + radius;
      velocities[base] = Math.abs(velocities[base]) * 0.22;
    }
    if (positions[base] > world.halfX - radius) {
      positions[base] = world.halfX - radius;
      velocities[base] = -Math.abs(velocities[base]) * 0.22;
    }
    if (positions[base + 2] < -world.halfZ + radius) {
      positions[base + 2] = -world.halfZ + radius;
      velocities[base + 2] = Math.abs(velocities[base + 2]) * 0.22;
    }
    if (positions[base + 2] > world.halfZ - radius) {
      positions[base + 2] = world.halfZ - radius;
      velocities[base + 2] = -Math.abs(velocities[base + 2]) * 0.22;
    }
    if (positions[base + 1] < world.floorY + radius) {
      positions[base + 1] = world.floorY + radius;
      velocities[base + 1] = Math.max(0, velocities[base + 1]) * 0.14;
      velocities[base] *= 0.82;
      velocities[base + 2] *= 0.82;
    }
  }

  function excite({ x = 0, y = 0.2, z = 0, count = 180, strength = 3.4 } = {}) {
    state.exciteEvents += 1;
    for (let i = 0; i < count; i += 1) {
      const index = Math.floor(Math.random() * state.count);
      impulse(index, x, y, z, strength * rand(0.65, 1.35));
    }
    return metrics();
  }

  function stir({ x = 0, y = 0.25, z = 0, dx = 0, dz = 0, strength = 1 } = {}) {
    state.stirHits = 0;
    for (let i = 0; i < state.count; i += 1) {
      const base = i * 3;
      const px = positions[base] - x;
      const py = positions[base + 1] - y;
      const pz = positions[base + 2] - z;
      const distance = Math.hypot(px, py * 1.8, pz);
      const radius = 1.25;
      if (distance > radius) continue;
      const falloff = 1 - distance / radius;
      velocities[base] += dx * 42 * falloff * strength + px * 0.7 * falloff;
      velocities[base + 1] += 2.2 * falloff * strength;
      velocities[base + 2] += dz * 42 * falloff * strength + pz * 0.7 * falloff;
      state.stirHits += 1;
    }
    return metrics();
  }

  function impulse(index, x, y, z, strength) {
    const base = index * 3;
    const dx = positions[base] - x;
    const dy = positions[base + 1] - y;
    const dz = positions[base + 2] - z;
    const distance = Math.max(0.001, Math.hypot(dx, dy, dz));
    const falloff = clamp(1 - distance / 7.5, 0.18, 1);
    velocities[base] += (dx / distance) * strength * falloff;
    velocities[base + 1] += rand(0.5, 1.8) * strength * falloff;
    velocities[base + 2] += (dz / distance) * strength * falloff;
  }

  function render() {
    if (!state.visible) return;
    for (let i = 0; i < state.count; i += 1) {
      dummy.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.count = state.count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  function setVisible(visible) {
    state.visible = visible;
    mesh.visible = visible;
  }

  function metrics() {
    let escapedLow = 0;
    let avgY = 0;
    let avgKE = 0;
    let freeMaxY = 0;
    for (let i = 0; i < state.count; i += 1) {
      const base = i * 3;
      const x = positions[base];
      const y = positions[base + 1];
      const z = positions[base + 2];
      avgY += y;
      avgKE += kineticEnergy(i);
      if (objectIds[i] < 0) freeMaxY = Math.max(freeMaxY, y);
      if (x < -world.halfX - 0.02 || x > world.halfX + 0.02 || z < -world.halfZ - 0.02 || z > world.halfZ + 0.02 || y < world.floorY - 0.02) escapedLow += 1;
    }
    return {
      mode: "field",
      engine: "particle-field-3d",
      particles: state.count,
      active: state.active,
      clusters: clusters.length,
      collisions: state.collisions,
      avgY: Number((avgY / state.count).toFixed(3)),
      avgKE: Number((avgKE / state.count).toFixed(4)),
      freeMaxY: Number(freeMaxY.toFixed(3)),
      stepMs: Number(state.stepMs.toFixed(2)),
      substeps: state.substeps,
      iterations: state.iterations,
      stirHits: state.stirHits,
      exciteEvents: state.exciteEvents,
      escapedLow,
    };
  }

  function sampleHeights() {
    return Array.from({ length: Math.min(16, state.count) }, (_, i) => Number(positions[i * 3 + 1].toFixed(2)));
  }

  function kineticEnergy(index) {
    const base = index * 3;
    return velocities[base] * velocities[base] + velocities[base + 1] * velocities[base + 1] + velocities[base + 2] * velocities[base + 2];
  }

  function gridKey(x, y, z) {
    return `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}:${Math.floor(z / cellSize)}`;
  }

  function setVec(array, index, x, y, z) {
    const base = index * 3;
    array[base] = x;
    array[base + 1] = y;
    array[base + 2] = z;
  }

  return {
    reset,
    step,
    render,
    excite,
    stir,
    metrics,
    sampleHeights,
    setVisible,
  };
}

# Particle Crate

Browser physics sketch inspired by Yacine's rigid body and voxel-particle posts:

https://x.com/yacineMTB/status/2068358519460360637
https://x.com/yacineMTB/status/2068699495102108131

Stage 5 has three modes:

- `FIELD`: default 3D particle-field sketch. Free crate material and locked voxel clusters are both represented as particles, rendered with `THREE.InstancedMesh`, stepped with a fixed timestep, uniform particle radius, grid neighbor search, sphere separation, finite-height crate walls, an outside apron, tilt gravity, recycle, and translation-only shape locks.
- `3D`: visual crate scene with a packed in-crate bed, camera orbit, block pull, floor-drag stirring, side containment, and sleep thresholds so settled blocks stop jittering.
- `2D`: fast compound-disc open-crate mode with mouse shove controls. Pieces can clear the rim instead of bouncing off an invisible lid.
- Press Space to excite the packed bed from inside the crate.
- Reset with R.

This is still a CPU browser slice, not CUDA. The API is shaped so the particle state lives in fixed typed-array buffers and can later move toward a WebGPU compute backend.

Three.js source/docs:

- https://threejs.org/
- https://github.com/mrdoob/three.js

## Run

```sh
npm install
npm run dev -- --port 4173
```

Then open `http://127.0.0.1:4173`.

The app still works as static files on GitHub Pages. Three.js and OrbitControls are vendored from the pinned npm package so the live site does not depend on a CDN or build server.

## Controls

- Use the `FIELD` / `3D` / `2D` tabs to switch modes.
- In `FIELD`, drag the heap, rim, or outside apron to stir particles and locked voxel clusters, drag empty background to orbit, and wheel to zoom.
- In `FIELD`, press `O` to lower or raise the front wall, `G` to toggle agitation, and WASD or arrow keys to tilt gravity.
- In `3D`, drag empty background to orbit, drag the crate floor to stir nearby blocks, drag a block to pull it, and wheel to zoom.
- In `2D`, drag inside the crate to shove particles.
- Press Space to pulse the packed bed.
- Press R to reset the crate.

## Verification

```sh
npm run check
```

`npm run check` runs syntax checks, a production build, and headless browser QA over desktop and mobile viewports. The browser QA asserts no console errors, a nonblank WebGL canvas, default `FIELD` mode with free particles plus locked voxel clusters, low initial free-particle heights instead of falling-rain spawn, closed-wall containment, rim/outside field control, open-front spill to the apron, recycle, field settling, camera orbit, legacy 3D block pull/stir/settling, 2D tab switching, 2D pointer shove, and 2D open-rim escape.

The `FIELD` API design was reviewed through Hermes on maxiclaw using `claude -p --model opus`; the review recommended fixed timestep, fixed allocation, uniform particle radius, explicit metrics, and translation-only shape locks before rotation.

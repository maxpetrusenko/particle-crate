# Particle Crate

Browser physics sketch inspired by the rigid body pile in this X post:

https://x.com/yacineMTB/status/2068358519460360637

Stage 3 has two modes:

- `3D`: visual crate scene with camera orbit, block pull, floor-drag stirring, side containment, and sleep thresholds so settled blocks stop jittering.
- `2D`: fast compound-disc open-crate mode with mouse shove controls. Pieces can clear the rim instead of bouncing off an invisible lid.
- Drop more blocks with Space.
- Reset with R.

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

- Use the `3D` / `2D` tabs to switch modes.
- In `3D`, drag empty background to orbit, drag the crate floor to stir nearby blocks, drag a block to pull it, and wheel to zoom.
- In `2D`, drag inside the crate to shove particles.
- Press Space to drop another batch.
- Press R to reset the crate.

## Verification

```sh
npm run check
```

`npm run check` runs syntax checks, a production build, and headless browser QA over desktop and mobile viewports. The browser QA asserts no console errors, a nonblank WebGL canvas, camera orbit, block pull, 3D floor stirring, 3D containment and settling, 2D tab switching, 2D pointer shove, and 2D open-rim escape.

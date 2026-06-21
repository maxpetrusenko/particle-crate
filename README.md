# Particle Crate

Browser physics sketch inspired by the rigid body pile in this X post:

https://x.com/yacineMTB/status/2068358519460360637

Stage 3 is a 3D open-crate scene:

- Orbit the camera with mouse/touch.
- Drag a block to pull it through the crate.
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

- Drag empty space to orbit.
- Wheel to zoom.
- Drag a block to pull it.
- Press Space to drop another batch.
- Press R to reset the crate.

## Verification

```sh
npm run check
```

`npm run check` runs syntax checks, a production build, and headless browser QA over desktop and mobile viewports. The browser QA asserts no console errors, a nonblank WebGL canvas, camera orbit, block pull interaction, and crate floor/side containment for bodies below wall height.

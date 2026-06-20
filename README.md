# Particle Crate

Browser physics sketch inspired by the compound-disc rigid body pile in this X post:

https://x.com/yacineMTB/status/2068358519460360637

The demo now has two local physics modes:

- `JS discs`: the original handmade compound-disc rigid body solver.
- `Rapier WASM`: a real physics-engine baseline using vendored `@dimforge/rapier2d-compat` 0.19.3.

Rapier source/docs:

- https://rapier.rs/docs/user_guides/javascript/getting_started_js
- https://github.com/dimforge/rapier.js

## Run

```sh
npm install
npm run dev -- --port 4173
```

Then open `http://127.0.0.1:4173`.

The app still works as static files on GitHub Pages. The Rapier bundle is vendored from the pinned npm package so the `E` engine toggle does not depend on a build server or CDN.

## Controls

- Drag across the canvas to push bodies.
- Press Space to drop another batch.
- Press E to switch between `JS discs` and `Rapier WASM`.
- Press D to toggle the collision discs.
- Press R to reset the crate.

## Verification

```sh
npm run check
```

`npm run check` runs syntax checks, a production build, and headless browser QA over desktop and mobile viewports. The browser QA asserts no console errors, zero crate containment leaks, working pointer collisions in both engines, and a faster Rapier step sample than the handmade solver.

# Three.js vendor

Files here are copied from `three@0.184.0`:

- `build/three.module.js`
- `build/three.core.js`
- `examples/jsm/controls/OrbitControls.js`

The app uses an import map so GitHub Pages can serve the project directly from repo root without a build pipeline or CDN. Vite still resolves the same imports from `node_modules` during local builds.

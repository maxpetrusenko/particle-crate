# Rapier 2D compat vendor

`rapier.mjs` is copied from `@dimforge/rapier2d-compat@0.19.3`.

Particle Crate is served from GitHub Pages as static root files, so the Rapier engine cannot rely on a bare npm import at runtime. The package remains pinned in `package-lock.json`; re-vendor by reinstalling the same package version and copying:

```sh
cp node_modules/@dimforge/rapier2d-compat/rapier.mjs vendor/rapier2d-compat/rapier.mjs
```

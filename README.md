# Particle Crate

Browser physics sketch inspired by the compound-disc rigid body pile in this X post:

https://x.com/yacineMTB/status/2068358519460360637

The demo models each tiny rectangle as a small rigid body backed by a set of collision discs. A spatial hash finds nearby discs, applies collision correction, and renders the resulting pile in a canvas.

## Run

Open `index.html`, or serve the folder:

```sh
python3 -m http.server 4173
```

Then open `http://127.0.0.1:4173`.

## Controls

- Drag across the canvas to push bodies.
- Press Space to drop another batch.
- Press D to toggle the collision discs.
- Press R to reset the crate.

## Verification

```sh
node --check src/sim.js
```

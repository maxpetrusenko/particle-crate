import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chromium } from "playwright";

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}/`;
const server = spawn("npm", ["run", "dev", "--", "--port", String(port), "--strictPort"], {
  stdio: ["ignore", "pipe", "pipe"],
});

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
    probe.on("error", reject);
  });
}

async function waitForServer() {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error("Vite server did not become ready");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function loadPage(page, errors) {
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: "load" });
  await page.waitForFunction(() => Boolean(window.__particleCrateDebug), null, { timeout: 10_000 });
  await page.waitForTimeout(1_400);
}

async function canvasProof(page, selector = "#sim") {
  return page.evaluate((canvasSelector) => {
    const canvas = document.querySelector(canvasSelector);
    const ctx = document.createElement("canvas").getContext("2d");
    const sample = 48;
    ctx.canvas.width = sample;
    ctx.canvas.height = sample;
    ctx.drawImage(canvas, 0, 0, sample, sample);
    const pixels = ctx.getImageData(0, 0, sample, sample).data;
    let lit = 0;
    let min = 765;
    let max = 0;
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const luma = pixels[i] + pixels[i + 1] + pixels[i + 2];
      if (luma > 35) lit += 1;
      if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) - Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) > 18) colored += 1;
      min = Math.min(min, luma);
      max = Math.max(max, luma);
    }
    return {
      width: canvas.width,
      height: canvas.height,
      lit,
      colored,
      contrast: max - min,
      ratio: lit / (sample * sample),
    };
  }, selector);
}

async function desktopProof(browser) {
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await loadPage(page, errors);

  const firstCanvas = await canvasProof(page);
  const before = await page.evaluate(() => ({
    metrics: window.__particleCrateDebug.metrics(),
    heights: window.__particleCrateDebug.sampleHeights(),
  }));
  const orbit = await page.evaluate(() => window.__particleCrateDebug.orbit(0.42, 0.05));
  const legacyMode = await page.evaluate(() => window.__particleCrateDebug.setMode("3d"));
  const pulled = await page.evaluate(() => window.__particleCrateDebug.pullFirstBody(0, 4.5, 0));
  const stirred = await page.evaluate(() => window.__particleCrateDebug.stirFirstBody(1.4, 0.2));
  await page.waitForTimeout(1_800);
  const after = await page.evaluate(() => ({
    metrics: window.__particleCrateDebug.metrics(),
    heights: window.__particleCrateDebug.sampleHeights(),
  }));
  const secondCanvas = await canvasProof(page);
  const fieldClosed = await page.evaluate(() => {
    window.__particleCrateDebug.setMode("field");
    window.__particleCrateDebug.reset();
    return {
      start: window.__particleCrateDebug.metrics(),
      after: window.__particleCrateDebug.runField(140),
    };
  });
  const fieldRim = await page.evaluate(() => {
    window.__particleCrateDebug.setMode("field");
    window.__particleCrateDebug.reset();
    const pulse = window.__particleCrateDebug.exciteField({ x: 0, y: 1.4, z: 4.7, count: 360, strength: 7.4 });
    const preStir = window.__particleCrateDebug.runField(45);
    const stir = window.__particleCrateDebug.stirFieldAt({ x: 0, y: 0.32, z: 4.2, dx: 0.1, dz: 1.2, strength: 2.4 });
    const after = window.__particleCrateDebug.runField(190);
    return { pulse, preStir, stir, after };
  });
  const fieldSpill = await page.evaluate(() => {
    window.__particleCrateDebug.setMode("field");
    window.__particleCrateDebug.reset();
    const open = window.__particleCrateDebug.setFieldWallOpen(true);
    const tilt = window.__particleCrateDebug.setFieldTilt(0, 1);
    const agitation = window.__particleCrateDebug.setFieldAgitation(true);
    const pulse = window.__particleCrateDebug.exciteField({ x: 0, y: 0.8, z: 4.8, count: 520, strength: 9.5 });
    const preStir = window.__particleCrateDebug.runField(130);
    const stir = window.__particleCrateDebug.stirFieldAt({ x: 0, y: 0.34, z: 5.35, dx: 0.2, dz: 1.5, strength: 3 });
    const after = window.__particleCrateDebug.runField(520);
    return { open, tilt, agitation, pulse, preStir, stir, after };
  });
  const mode2d = await page.evaluate(() => window.__particleCrateDebug.setMode("2d"));
  await page.waitForTimeout(1_200);
  const canvas2d = await canvasProof(page, "#sim2d");
  const push2d = await page.evaluate(() => window.__particleCrateDebug.push2dAt(620, 650, 26, -18));
  const launched2d = await page.evaluate(() => window.__particleCrateDebug.launch2dOut());
  const settled3d = await page.evaluate(() => window.__particleCrateDebug.settle3d(420));

  assert(errors.length === 0, `console errors: ${errors.join("; ")}`);
  assert(firstCanvas.width >= 1200 && firstCanvas.height >= 700, `canvas too small: ${JSON.stringify(firstCanvas)}`);
  assert(firstCanvas.contrast > 40 && firstCanvas.colored > 120, `blank WebGL canvas: ${JSON.stringify({ firstCanvas, secondCanvas })}`);
  assert(secondCanvas.contrast > 40 && secondCanvas.colored > 120, `stale WebGL canvas: ${JSON.stringify({ firstCanvas, secondCanvas })}`);
  assert(before.metrics.engine === "particle-field-3d", `wrong engine: ${JSON.stringify(before.metrics)}`);
  assert(before.metrics.particles >= 560, `not enough particles: ${before.metrics.particles}`);
  assert(before.metrics.clusters >= 3, `missing locked voxel clusters: ${JSON.stringify(before.metrics)}`);
  assert(before.metrics.freeMaxY < 0.35, `free particles start as rain instead of a crate bed: ${JSON.stringify(before.metrics)}`);
  assert(before.metrics.outside === 0 && before.metrics.escapedLow === 0, `field starts outside crate: ${JSON.stringify(before.metrics)}`);
  assert(orbit.cameraMoved, `orbit did not move camera: ${JSON.stringify(orbit)}`);
  assert(legacyMode === "3d", `legacy 3D tab did not activate: ${legacyMode}`);
  assert(pulled.engine === "three-3d", `legacy 3D fallback did not run: ${JSON.stringify(pulled)}`);
  assert(stirred.stirEvents > 0, `legacy 3D stir did not hit bodies: ${JSON.stringify(stirred)}`);
  assert(fieldClosed.start.engine === "particle-field-3d", `field wrong engine: ${JSON.stringify(fieldClosed.start)}`);
  assert(fieldClosed.after.outside === 0, `closed field leaked on settle: ${JSON.stringify(fieldClosed)}`);
  assert(fieldClosed.after.escapedLow === 0, `closed field invalid escape: ${JSON.stringify(fieldClosed)}`);
  assert(fieldClosed.after.avgKE < 0.08, `closed field did not settle: ${JSON.stringify(fieldClosed)}`);
  assert(fieldRim.stir.stirHits > 0, `field rim/outside control did not hit particles: ${JSON.stringify(fieldRim)}`);
  assert(fieldRim.preStir.overRim > 0 || fieldRim.after.overRim > 0 || fieldRim.after.outside > 0, `field rim control did not move material over finite wall: ${JSON.stringify(fieldRim)}`);
  assert(fieldRim.after.escapedLow === 0, `field rim movement escaped legal world: ${JSON.stringify(fieldRim)}`);
  assert(fieldSpill.after.wallOpen && fieldSpill.after.agitation, `field open/agitation controls not reflected: ${JSON.stringify(fieldSpill)}`);
  assert(fieldSpill.after.tilt[1] > 0.9, `field tilt control not reflected: ${JSON.stringify(fieldSpill)}`);
  assert(fieldSpill.stir.stirHits > 0, `field apron control did not hit spilled particles: ${JSON.stringify(fieldSpill)}`);
  assert(fieldSpill.after.apron > 0 && fieldSpill.after.outside > 0, `field open wall did not spill to apron: ${JSON.stringify(fieldSpill)}`);
  assert(fieldSpill.after.recycled > 0, `field spill did not recycle outside particles: ${JSON.stringify(fieldSpill)}`);
  assert(fieldSpill.after.escapedLow === 0, `field spill escaped legal world: ${JSON.stringify(fieldSpill)}`);
  assert(fieldSpill.after.stepMs < 16, `field step too slow: ${JSON.stringify(fieldSpill.after)}`);
  assert(mode2d === "2d", `mode switch failed: ${mode2d}`);
  assert(canvas2d.contrast > 40 && canvas2d.colored > 120, `blank 2D canvas: ${JSON.stringify(canvas2d)}`);
  assert(push2d.engine === "js-discs-2d", `wrong 2D engine: ${JSON.stringify(push2d)}`);
  assert(push2d.bodies >= 180 && push2d.particles > push2d.bodies, `2D particles not running: ${JSON.stringify(push2d)}`);
  assert(push2d.obstacleHits > 0, `2D pointer shove did not hit bodies: ${JSON.stringify(push2d)}`);
  assert(push2d.leaks === 0, `2D containment leak: ${JSON.stringify(push2d)}`);
  assert(launched2d.escaped > 0, `2D open crate did not let bodies leave: ${JSON.stringify(launched2d)}`);
  assert(settled3d.escapedLow === 0, `3D bodies escaped through crate: ${JSON.stringify(settled3d)}`);
  assert(settled3d.sleeping > 360, `3D did not settle enough: ${JSON.stringify(settled3d)}`);
  await page.close();

  return { firstCanvas, secondCanvas, before, orbit, legacyMode, pulled, stirred, after, fieldClosed, fieldRim, fieldSpill, mode2d, canvas2d, push2d, launched2d, settled3d };
}

async function mobileProof(browser) {
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await loadPage(page, errors);
  const proof = await page.evaluate(() => ({
    metrics: window.__particleCrateDebug.metrics(),
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
  }));
  const canvas = await canvasProof(page);

  assert(errors.length === 0, `mobile console errors: ${errors.join("; ")}`);
  assert(canvas.height >= 800, `mobile canvas not full height: ${JSON.stringify(canvas)}`);
  assert(canvas.contrast > 40 && canvas.colored > 80, `mobile blank WebGL canvas: ${JSON.stringify(canvas)}`);
  assert(proof.metrics.outside === 0 && proof.metrics.escapedLow === 0, `mobile crate leak: ${JSON.stringify(proof.metrics)}`);
  assert(proof.overflowX <= 1, `mobile horizontal overflow: ${proof.overflowX}`);
  await page.close();
  return { proof, canvas };
}

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  const desktop = await desktopProof(browser);
  const mobile = await mobileProof(browser);
  await browser.close();
  console.log(JSON.stringify({ desktop, mobile }, null, 2));
} finally {
  server.kill("SIGTERM");
}

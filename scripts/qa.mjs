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

function distanceTo(point, target) {
  return Math.hypot(point[0] - target[0], point[1] - target[1], point[2] - target[2]);
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
  const pulled = await page.evaluate(() => window.__particleCrateDebug.pullFirstBody(0, 4.5, 0));
  const stirred = await page.evaluate(() => window.__particleCrateDebug.stirFirstBody(1.4, 0.2));
  await page.waitForTimeout(1_800);
  const after = await page.evaluate(() => ({
    metrics: window.__particleCrateDebug.metrics(),
    heights: window.__particleCrateDebug.sampleHeights(),
  }));
  const secondCanvas = await canvasProof(page);
  const mode2d = await page.evaluate(() => window.__particleCrateDebug.setMode("2d"));
  await page.waitForTimeout(1_200);
  const canvas2d = await canvasProof(page, "#sim2d");
  const push2d = await page.evaluate(() => window.__particleCrateDebug.push2dAt(620, 650, 26, -18));

  assert(errors.length === 0, `console errors: ${errors.join("; ")}`);
  assert(firstCanvas.width >= 1200 && firstCanvas.height >= 700, `canvas too small: ${JSON.stringify(firstCanvas)}`);
  assert(firstCanvas.contrast > 40 && firstCanvas.colored > 120, `blank WebGL canvas: ${JSON.stringify({ firstCanvas, secondCanvas })}`);
  assert(secondCanvas.contrast > 40 && secondCanvas.colored > 120, `stale WebGL canvas: ${JSON.stringify({ firstCanvas, secondCanvas })}`);
  assert(before.metrics.engine === "three-3d", `wrong engine: ${JSON.stringify(before.metrics)}`);
  assert(before.metrics.bodies >= 400, `not enough bodies: ${before.metrics.bodies}`);
  assert(orbit.cameraMoved, `orbit did not move camera: ${JSON.stringify(orbit)}`);
  assert(
    distanceTo(pulled.firstBody, [0, 4.5, 0]) < distanceTo(before.metrics.firstBody, [0, 4.5, 0]) - 0.5,
    `pull did not move first body toward target: ${JSON.stringify({ before: before.metrics.firstBody, pulled: pulled.firstBody })}`,
  );
  assert(stirred.stirEvents > 0, `3D stir did not hit bodies: ${JSON.stringify(stirred)}`);
  assert(after.metrics.escapedLow === 0, `bodies leaked through floor/side walls: ${JSON.stringify(after.metrics)}`);
  assert(mode2d === "2d", `mode switch failed: ${mode2d}`);
  assert(canvas2d.contrast > 40 && canvas2d.colored > 120, `blank 2D canvas: ${JSON.stringify(canvas2d)}`);
  assert(push2d.engine === "js-discs-2d", `wrong 2D engine: ${JSON.stringify(push2d)}`);
  assert(push2d.bodies >= 180 && push2d.particles > push2d.bodies, `2D particles not running: ${JSON.stringify(push2d)}`);
  assert(push2d.obstacleHits > 0, `2D pointer shove did not hit bodies: ${JSON.stringify(push2d)}`);
  assert(push2d.leaks === 0, `2D containment leak: ${JSON.stringify(push2d)}`);
  await page.close();

  return { firstCanvas, secondCanvas, before, orbit, pulled, stirred, after, mode2d, canvas2d, push2d };
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
  assert(proof.metrics.escapedLow === 0, `mobile crate leak: ${JSON.stringify(proof.metrics)}`);
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

import { spawn } from "node:child_process";
import { chromium } from "playwright";

const port = 4174;
const baseUrl = `http://127.0.0.1:${port}/`;
const server = spawn("npm", ["run", "dev", "--", "--port", String(port), "--strictPort"], {
  stdio: ["ignore", "pipe", "pipe"],
});

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
}

async function desktopProof(browser) {
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await loadPage(page, errors);
  await page.waitForTimeout(1_800);

  const handmade = await page.evaluate(() => ({
    metrics: window.__particleCrateDebug.metrics(),
    containment: window.__particleCrateDebug.checkContainment(),
  }));
  await page.evaluate(() => window.__particleCrateDebug.setPointer(620, 620, 18, -12));
  await page.waitForTimeout(800);
  const handmadePointer = await page.evaluate(() => window.__particleCrateDebug.metrics());

  await page.evaluate(() => window.__particleCrateDebug.setEngine("rapier"));
  await page.waitForTimeout(2_200);
  const rapier = await page.evaluate(() => ({
    metrics: window.__particleCrateDebug.metrics(),
    containment: window.__particleCrateDebug.checkContainment(),
  }));
  await page.evaluate(() => window.__particleCrateDebug.setPointer(620, 620, 22, -16));
  await page.waitForTimeout(900);
  const rapierPointer = await page.evaluate(() => window.__particleCrateDebug.metrics());

  assert(errors.length === 0, `console errors: ${errors.join("; ")}`);
  assert(handmade.containment.leaks === 0, `handmade leaks: ${JSON.stringify(handmade.containment)}`);
  assert(rapier.containment.leaks === 0, `rapier leaks: ${JSON.stringify(rapier.containment)}`);
  assert(handmadePointer.obstacleHits > 0, "handmade pointer did not hit bodies");
  assert(rapierPointer.obstacleHits > 0, "rapier pointer did not hit bodies");
  assert(rapier.metrics.stepMs < handmade.metrics.stepMs, "rapier baseline is not faster than handmade sample");
  await page.close();

  return { handmade, handmadePointer, rapier, rapierPointer };
}

async function mobileProof(browser) {
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await loadPage(page, errors);
  await page.waitForTimeout(1_200);
  const proof = await page.evaluate(() => ({
    metrics: window.__particleCrateDebug.metrics(),
    containment: window.__particleCrateDebug.checkContainment(),
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
  }));

  assert(errors.length === 0, `mobile console errors: ${errors.join("; ")}`);
  assert(proof.containment.leaks === 0, `mobile leaks: ${JSON.stringify(proof.containment)}`);
  assert(proof.overflowX <= 1, `mobile horizontal overflow: ${proof.overflowX}`);
  await page.close();
  return proof;
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

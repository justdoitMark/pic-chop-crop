// Startup when Windows launches the app with a file ("Open with"): the start
// screen must not flash before the image, and a photo-sized PNG must open
// fast. The mock can't reproduce WebView2 start-up or real IPC, so the time
// budget only covers what the page itself does with the bytes.
import { test, expect } from "@playwright/test";
import { APP_URL, installTauriMock, makePng, waitForImage } from "./helpers.mjs";

const A = "C:\\pics\\photo.png";
const W = 2400, H = 1600;

// Gradient with per-pixel noise: compresses about as badly as a photo, so the
// file lands near the ~2 MB PNG that was reported as slow.
let seed = 1;
const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 16) & 15;
const PHOTO = makePng(W, H, (x, y) => [(x >> 4) + noise(), (y >> 3) + noise(), ((x + y) >> 5) + noise(), 255]);

test("photo-sized PNG fixture is about 2 MB or more", () => {
  expect(PHOTO.length).toBeGreaterThan(1.5e6);
});

test("launching with a file never shows the start screen", async ({ page }) => {
  await installTauriMock(page, { initialFile: A, siblings: [A], files: { [A]: { raw: PHOTO, delayMs: 300 } } });
  // Samples every frame from the very first one, before the page's own script runs.
  await page.addInitScript(() => {
    window.__dropzoneSeen = false;
    (function tick(){
      const d = document.getElementById("dropzone");
      if (d && d.checkVisibility()) window.__dropzoneSeen = true;
      requestAnimationFrame(tick);
    })();
  });
  await page.goto(APP_URL);
  await waitForImage(page, W, H);
  expect(await page.evaluate(() => window.__dropzoneSeen)).toBe(false);
});

test("the start screen still appears when launched without a file", async ({ page }) => {
  await installTauriMock(page, { initialFile: null });
  await page.goto(APP_URL);
  await expect(page.locator("#dropzone")).toBeVisible();
});

test("the start screen appears if the launch file fails to open", async ({ page }) => {
  await installTauriMock(page, { initialFile: "C:\\pics\\missing.png", files: {} });
  await page.goto(APP_URL);
  await expect(page.locator("#dropzone")).toBeVisible();
});

test("a 2 MB PNG is on screen quickly after its bytes arrive", async ({ page }) => {
  await installTauriMock(page, { initialFile: A, siblings: [A], files: { [A]: { raw: PHOTO } } });
  await page.goto(APP_URL);
  await waitForImage(page, W, H);
  const ms = await page.evaluate(() => {
    const read = performance.getEntriesByName("mock:read_file_bytes")[0];
    return performance.now() - read.startTime;
  });
  console.log(`bytes → image on screen: ${ms.toFixed(0)} ms`);
  expect(ms).toBeLessThan(400);
});

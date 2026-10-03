// Edge runs the same Chromium engine as WebView2. These tests check that it
// shows a JPEG turned by an Orientation tag laid out exactly as the Rust side
// writes it (exif::insert_app1), and that a turn starts from what is shown.
import { test, expect } from "@playwright/test";
import { APP_URL, installTauriMock, waitForImage, exportPixels, expectColors, withOrientation, RED, GREEN, BLUE, YELLOW } from "./helpers.mjs";

const J = "C:\\pics\\phone.jpg";
const CORNERS = [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]];

/** A 64×48 JPEG with four solid quadrants, encoded by the browser itself. */
async function quadrantJpeg(browser) {
  const gen = await browser.newPage();
  const b64 = await gen.evaluate(async (colors) => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 48;
    const ctx = c.getContext("2d");
    [[0, 0], [32, 0], [0, 24], [32, 24]].forEach(([x, y], i) => {
      ctx.fillStyle = `rgb(${colors[i].slice(0, 3).join(",")})`;
      ctx.fillRect(x, y, 32, 24);
    });
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.95));
    let s = "";
    for (const b of new Uint8Array(await blob.arrayBuffer())) s += String.fromCharCode(b);
    return btoa(s);
  }, [RED, GREEN, BLUE, YELLOW]);
  await gen.close();
  return Buffer.from(b64, "base64");
}

test("WebView2's engine applies the Orientation tag the app writes", async ({ page, browser }) => {
  const jpeg = withOrientation(await quadrantJpeg(browser), 6);
  await installTauriMock(page, { initialFile: J, files: { [J]: { raw: jpeg } } });
  await page.goto(APP_URL);
  await waitForImage(page, 48, 64); // Orientation 6: shown a quarter turn clockwise
  await expect(page.locator("#fileSize")).toHaveText("48 × 64");
  await page.keyboard.press("Escape");
  expectColors(await exportPixels(page, CORNERS, { w: 48, h: 64 }), [BLUE, RED, YELLOW, GREEN], 40);
});

test("a phone photo (Orientation 6) turns from what is on screen", async ({ page, browser }) => {
  const jpeg = withOrientation(await quadrantJpeg(browser), 6);
  await installTauriMock(page, { initialFile: J, files: { [J]: { raw: jpeg } } });
  await page.goto(APP_URL);
  await waitForImage(page, 48, 64);
  await page.keyboard.press("Escape");
  await page.keyboard.press("r");
  await expect(page.locator("#fileSize")).toHaveText("64 × 48");
  expect(await page.evaluate(() => window.__mockLog.rotations)).toEqual([{ path: J, quarterTurns: 1 }]);
  // shown turned once by the tag and once more by us: half a turn from the stored pixels
  expectColors(await exportPixels(page, CORNERS, { w: 64, h: 48 }), [YELLOW, BLUE, GREEN, RED], 40);
});

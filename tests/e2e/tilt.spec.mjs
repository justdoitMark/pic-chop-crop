// Tilt: the picture leans by whole degrees, the frame never leaves it, the
// export never contains background, and the angle never reaches the file.
import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { APP_URL, installTauriMock, waitForImage, exportPixels, expectColors } from "./helpers.mjs";

const G = createRequire(import.meta.url)("../../frontend/geometry.js");
const A = "C:\\pics\\a.png";
const B = "C:\\pics\\b.png";
const SOLID = [20, 160, 90, 255];

async function open(page, opts = {}) {
  await installTauriMock(page, { initialFile: A, files: { [A]: { width: 400, height: 300, rgba: SOLID } }, ...opts });
  await page.goto(APP_URL);
  await waitForImage(page, 400, 300);
  await page.keyboard.press("Escape");
}

// keyboard.press knows only US-layout keys ("Unknown key: ъ"), so a Russian
// letter is sent as the keydown WebView2 gives with a Russian layout: the
// physical ] key arrives as key "ъ", code "BracketRight".
const RU_CODES = { "ъ": "BracketRight", "х": "BracketLeft" };
async function press(page, key) {
  if (!RU_CODES[key]) return page.keyboard.press(key);
  await page.evaluate(([k, code]) => {
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keydown", { key: k, code, bubbles: true, cancelable: true }));
  }, [key, RU_CODES[key]]);
}

async function pressTimes(page, key, n) {
  for (let i = 0; i < n; i++) await page.keyboard.press(key);
}

/** The frame and the tilted picture, read from the page (no quarter turns in these tests). */
async function frameState(page) {
  return page.evaluate(() => {
    const px = (el, p) => parseFloat(el.style[p]);
    const st = document.getElementById("stage"), img = document.getElementById("img"), cb = document.getElementById("cropBox");
    const deg = parseFloat(/rotate\((-?[\d.]+)deg\)/.exec(img.style.transform)[1]);
    return {
      box: { x: px(cb, "left"), y: px(cb, "top"), w: px(cb, "width"), h: px(cb, "height") },
      rect: { cx: px(st, "width") / 2, cy: px(st, "height") / 2, w: px(img, "width"), h: px(img, "height"), deg },
    };
  });
}

async function expectFrameInside(page) {
  const { box, rect } = await frameState(page);
  // 0.01 px slack for rounding in the style strings
  const inset = { x: box.x + 0.01, y: box.y + 0.01, w: box.w - 0.02, h: box.h - 0.02 };
  expect(G.isBoxInside(inset, rect), JSON.stringify({ box, rect })).toBe(true);
}

/** The frame's centre and size relative to the picture: [cx, cy, w, h] in picture widths/heights. */
function relFrame({ box, rect }) {
  return [(box.x + box.w / 2 - rect.cx) / rect.w, (box.y + box.h / 2 - rect.cy) / rect.h, box.w / rect.w, box.h / rect.h];
}

function expectSameFrame(after, before) {
  relFrame(after).forEach((v, i) => expect(v, `component ${i}: ${relFrame(after)} vs ${relFrame(before)}`).toBeCloseTo(relFrame(before)[i], 3));
}

async function drag(page, selector, dx, dy) {
  const bb = await page.locator(selector).boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2 + dx, bb.y + bb.height / 2 + dy, { steps: 5 });
  await page.mouse.up();
}

test("] and [ change the angle; the button turns cyan away from 0°", async ({ page }) => {
  await open(page);
  await page.keyboard.press("]");
  await expect(page.locator("#tiltLbl")).toHaveText("+1°");
  await expect(page.locator("#tiltBtn")).toHaveClass(/\bon\b/);
  await page.keyboard.press("[");
  await expect(page.locator("#tiltLbl")).toHaveText("0°");
  await expect(page.locator("#tiltBtn")).not.toHaveClass(/\bon\b/);
  await page.keyboard.press("[");
  await expect(page.locator("#tiltLbl")).toHaveText("−1°");
  await press(page, "ъ");
  await expect(page.locator("#tiltLbl")).toHaveText("0°");
  await press(page, "х");
  await expect(page.locator("#tiltLbl")).toHaveText("−1°");
});

test("the angle stops at ±45°", async ({ page }) => {
  await open(page);
  await pressTimes(page, "]", 50);
  await expect(page.locator("#tiltLbl")).toHaveText("+45°");
  await pressTimes(page, "[", 100);
  await expect(page.locator("#tiltLbl")).toHaveText("−45°");
});

test("the grid shows while adjusting and fades after a second", async ({ page }) => {
  await open(page);
  await page.keyboard.press("]");
  await expect(page.locator("#stage")).toHaveClass(/\btilting\b/);
  await expect(page.locator("#stage")).not.toHaveClass(/\btilting\b/, { timeout: 2500 });
});

test("at 45° the export never contains background, even with the frame pushed to a corner", async ({ page }) => {
  await open(page);
  await page.fill("#inputW", "200");
  await page.fill("#inputH", "200");
  await page.locator("#inputH").blur();
  await pressTimes(page, "]", 45);
  await drag(page, "#cropBox", -3000, -3000);
  await expectFrameInside(page);
  const px = await exportPixels(page, [[0, 0], [0.999, 0], [0, 0.999], [0.999, 0.999], [0.5, 0.5]]);
  expectColors(px, [SOLID, SOLID, SOLID, SOLID, SOLID], 10);
});

test("dragging and resizing keep the frame inside the tilted image", async ({ page }) => {
  await open(page);
  await page.fill("#inputW", "100");
  await page.fill("#inputH", "100");
  await page.locator("#inputH").blur();
  await pressTimes(page, "]", 10);
  for (const [dx, dy] of [[3000, 3000], [-3000, 3000], [3000, -3000]]) {
    await drag(page, "#cropBox", dx, dy);
    await expectFrameInside(page);
  }
  for (const corner of ["br", "tl", "tr", "bl"]) {
    await drag(page, `.handle[data-corner="${corner}"]`, corner.includes("r") ? 3000 : -3000, corner.includes("b") ? 3000 : -3000);
    await expectFrameInside(page);
    const { box } = await frameState(page);
    expect(box.w / box.h).toBeCloseTo(1, 2);
  }
});

test("zoom and window resize keep the frame inside", async ({ page }) => {
  await open(page);
  await pressTimes(page, "]", 20);
  // A frame already inside, pushed hard into a corner, must be neither moved nor shrunk.
  await drag(page, "#cropBox", -3000, -3000);
  await expectFrameInside(page);
  const before = await frameState(page);
  const vp = await page.locator("#viewport").boundingBox();
  await page.mouse.move(vp.x + vp.width / 2, vp.y + vp.height / 2);
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -100);
  await expectFrameInside(page);
  expectSameFrame(await frameState(page), before);
  await page.setViewportSize({ width: 700, height: 500 });
  await page.waitForTimeout(100);
  await expectFrameInside(page);
  expectSameFrame(await frameState(page), before);
});

test("a tilt change keeps the frame where it was and does not resize it when it fits", async ({ page }) => {
  await open(page);
  await page.fill("#inputW", "100");
  await page.fill("#inputH", "100");
  await page.locator("#inputH").blur();
  // a smaller frame, off centre, with room to spare at +1°
  await drag(page, '.handle[data-corner="br"]', -120, -120);
  await drag(page, "#cropBox", -60, -40);
  const before = await frameState(page);
  const [cx, cy] = relFrame(before);
  expect(Math.abs(cx)).toBeGreaterThan(0.05);
  expect(Math.abs(cy)).toBeGreaterThan(0.05);
  await page.keyboard.press("]");
  const after = await frameState(page);
  expectSameFrame(after, before);
  await expectFrameInside(page);
});

test("a tilt change shrinks the frame when it no longer fits", async ({ page }) => {
  await open(page);
  // the picture's own aspect: the frame nearly fills it
  await page.fill("#inputW", "400");
  await page.fill("#inputH", "300");
  await page.locator("#inputH").blur();
  const before = relFrame(await frameState(page));
  await pressTimes(page, "]", 30);
  const after = relFrame(await frameState(page));
  expect(after[2]).toBeLessThan(before[2] * 0.9);
  expect(after[3]).toBeLessThan(before[3] * 0.9);
  expect(after[2] / after[3]).toBeCloseTo(before[2] / before[3], 3);
  await expectFrameInside(page);
});

test("tilt never reaches Rust and resets on the next file", async ({ page }) => {
  await open(page, { siblings: [A, B], files: { [A]: { width: 400, height: 300, rgba: SOLID }, [B]: { width: 200, height: 100 } } });
  await pressTimes(page, "]", 2);
  expect(await page.evaluate(() => window.__mockLog.invokes.some((i) => i.cmd === "rotate_image"))).toBe(false);
  await page.keyboard.press("ArrowRight");
  await waitForImage(page, 200, 100);
  await expect(page.locator("#tiltLbl")).toHaveText("0°");
});

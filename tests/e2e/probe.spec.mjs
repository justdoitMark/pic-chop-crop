// Exploratory probes: each test states the behaviour we'd EXPECT from a
// correct app. For a confirmed bug that is not fixed yet, mark the probe
// test.fail(...): the suite stays green, and Playwright reports
// "unexpectedly passed" once the bug is fixed — then switch it back to test(...).
import { test, expect } from "@playwright/test";
import { APP_URL, installTauriMock, decodeInPage, waitForImage, boxRect } from "./helpers.mjs";

const A = "C:\\pics\\a.png";
const B = "C:\\pics\\b.png";

// r follows x, g follows y — any shift of the crop region changes the colour.
const gradient = (w, h) => (x, y) => [Math.round((x * 255) / (w - 1)), Math.round((y * 255) / (h - 1)), 0, 255];

async function open(page, opts) {
  await installTauriMock(page, opts);
  await page.goto(APP_URL);
}

async function exportCenter(page) {
  const n = await page.evaluate(() => window.__mockLog.writes.length);
  await page.click("#downloadBtn");
  await page.waitForFunction((n) => window.__mockLog.writes.length > n, n);
  const w = await page.evaluate(() => window.__mockLog.writes.at(-1));
  return (await decodeInPage(page, w.dataBase64, "image/png")).center;
}

const cropVisible = (page) => page.locator("#cropBox").isVisible();

test("P1: failed read on Next keeps the counter in sync with the shown image", async ({ page }) => {
  // b.png is listed in the folder but cannot be read (deleted, locked…)
  await open(page, { initialFile: A, siblings: [A, B], files: { [A]: { width: 400, height: 300 } } });
  await waitForImage(page, 400, 300);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  await expect(page.locator("#navPos")).toHaveText("1 / 2");
});

test("P2: a failed native save is reported, not silently turned into a browser download", async ({ page }) => {
  await open(page, { initialFile: A, files: { [A]: { width: 400, height: 300 } }, writeError: "Access denied" });
  await waitForImage(page, 400, 300);
  await page.keyboard.press("c");
  let downloaded = false;
  page.on("download", () => { downloaded = true; });
  await page.click("#downloadBtn");
  await expect(page.locator("#notice")).toContainText("Не удалось сохранить файл: Access denied");
  expect(downloaded).toBe(false);
});

test("P3: Ctrl+C does not toggle the crop frame", async ({ page }) => {
  await open(page, { initialFile: A, files: { [A]: { width: 400, height: 300 } } });
  await waitForImage(page, 400, 300);
  await page.keyboard.press("c");
  expect(await cropVisible(page)).toBe(true);
  await page.keyboard.press("Control+c");
  expect(await cropVisible(page)).toBe(true);
});

test("P4: clearing the width field does not switch the target to 1 px", async ({ page }) => {
  await open(page, { initialFile: A, files: { [A]: { width: 400, height: 300 } } });
  await waitForImage(page, 400, 300);
  await page.keyboard.press("c");
  await page.fill("#inputW", "");
  await expect(page.locator("#downloadBtn")).toHaveAttribute("aria-label", "Сохранить 1920×1080");
  await page.locator("#inputW").blur();
  await expect(page.locator("#inputW")).toHaveValue("1920");
});

test("P5: an out-of-range width shows the value that will actually be used", async ({ page }) => {
  await open(page, { initialFile: A, files: { [A]: { width: 400, height: 300 } } });
  await waitForImage(page, 400, 300);
  await page.keyboard.press("c");
  await page.fill("#inputW", "99999");
  const label = await page.locator("#downloadBtn").getAttribute("aria-label");
  const field = await page.inputValue("#inputW");
  expect(label).toBe(`Сохранить ${field}×1080`);
});

test("P6: exported region does not shift after wheel zoom and window resize", async ({ page }) => {
  await open(page, { initialFile: A, files: { [A]: { width: 1000, height: 500, rgba: gradient(1000, 500) } } });
  await waitForImage(page, 1000, 500);
  await page.keyboard.press("c");
  const before = await exportCenter(page);

  const vp = await page.locator("#viewport").boundingBox();
  await page.mouse.move(vp.x + vp.width * 0.3, vp.y + vp.height * 0.4);
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -100);
  await page.waitForTimeout(100);
  const zoomed = await exportCenter(page);

  await page.setViewportSize({ width: 900, height: 700 });
  await page.waitForTimeout(200);
  const resized = await exportCenter(page);

  for (const got of [zoomed, resized]) {
    expect(Math.abs(got[0] - before[0])).toBeLessThanOrEqual(3);
    expect(Math.abs(got[1] - before[1])).toBeLessThanOrEqual(3);
  }
});

test("P7: wheel zoom keeps the image point under the cursor", async ({ page }) => {
  await open(page, { initialFile: A, files: { [A]: { width: 1000, height: 500 } } });
  await waitForImage(page, 1000, 500);
  const vp = await page.locator("#viewport").boundingBox();
  const cx = vp.x + vp.width * 0.3, cy = vp.y + vp.height * 0.45;
  const imgPoint = () => page.evaluate(([cx, cy]) => {
    const r = document.getElementById("stage").getBoundingClientRect();
    const scale = r.width / 1000;
    return { x: (cx - r.left) / scale, y: (cy - r.top) / scale };
  }, [cx, cy]);

  // Zoom until the image overflows the viewport on both axes first: while it
  // is smaller than the viewport on an axis it is centred there by design.
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -100);
  await page.waitForTimeout(100);
  const p0 = await imgPoint();
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(100);
  const p1 = await imgPoint();
  expect(Math.abs(p1.x - p0.x)).toBeLessThan(2);
  expect(Math.abs(p1.y - p0.y)).toBeLessThan(2);
});

test("P8: resizing by a corner handle keeps the frame inside the image and on ratio", async ({ page }) => {
  await open(page, { initialFile: A, files: { [A]: { width: 800, height: 600 } } });
  await waitForImage(page, 800, 600);
  await page.keyboard.press("c");
  const stage = await page.evaluate(() => {
    const s = document.getElementById("stage").style;
    return { w: parseFloat(s.width), h: parseFloat(s.height) };
  });

  for (const [dx, dy] of [[3000, 3000], [-3000, -3000]]) {
    const h = await page.locator('.handle[data-corner="br"]').boundingBox();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + dx, h.y + dy, { steps: 5 });
    await page.mouse.up();
    const r = await boxRect(page);
    expect(r.x).toBeGreaterThanOrEqual(-0.5);
    expect(r.y).toBeGreaterThanOrEqual(-0.5);
    expect(r.x + r.w).toBeLessThanOrEqual(stage.w + 0.5);
    expect(r.y + r.h).toBeLessThanOrEqual(stage.h + 0.5);
    expect(r.w / r.h).toBeCloseTo(1920 / 1080, 1);
  }
});

test("P9: changing the size while zoomed in keeps the frame on screen", async ({ page }) => {
  await open(page, { initialFile: A, files: { [A]: { width: 800, height: 600 } } });
  await waitForImage(page, 800, 600);
  await page.keyboard.press("c");
  const vp = await page.locator("#viewport").boundingBox();
  await page.mouse.move(vp.x + vp.width / 2, vp.y + vp.height / 2);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -100);
  await page.waitForTimeout(100);

  await page.fill("#inputW", "1000");
  const box = await page.locator("#cropBox").boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(vp.x - 1);
  expect(box.y).toBeGreaterThanOrEqual(vp.y - 1);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.x + vp.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.y + vp.height + 1);
});

test("P10: extreme ratio 8000×1 still exports exactly 8000×1", async ({ page }) => {
  await open(page, { initialFile: A, files: { [A]: { width: 800, height: 600 } } });
  await waitForImage(page, 800, 600);
  await page.keyboard.press("c");
  await page.fill("#inputW", "8000");
  await page.fill("#inputH", "1");
  await page.click("#downloadBtn");
  await page.waitForFunction(() => window.__mockLog.writes.length > 0);
  const w = await page.evaluate(() => window.__mockLog.writes.at(-1));
  const out = await decodeInPage(page, w.dataBase64, "image/png");
  expect(out).toMatchObject({ width: 8000, height: 1 });
});

test("P11: Next after zooming in shows the new image fitted, not zoomed", async ({ page }) => {
  await open(page, {
    initialFile: A, siblings: [A, B],
    files: { [A]: { width: 800, height: 600 }, [B]: { width: 600, height: 800 } },
  });
  await waitForImage(page, 800, 600);
  const vp = await page.locator("#viewport").boundingBox();
  await page.mouse.move(vp.x + vp.width / 2, vp.y + vp.height / 2);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -100);
  await page.keyboard.press("ArrowRight");
  await waitForImage(page, 600, 800);
  const st = await page.locator("#stage").boundingBox();
  expect(st.width).toBeLessThanOrEqual(vp.width + 1);
  expect(st.height).toBeLessThanOrEqual(vp.height + 1);
});

test("P12: opening another file during a slow Next load does not let the late load win", async ({ page }) => {
  const { makePng } = await import("./helpers.mjs");
  await open(page, {
    initialFile: A, siblings: [A, B],
    files: { [A]: { width: 400, height: 300 }, [B]: { width: 300, height: 400, delayMs: 400 } },
  });
  await waitForImage(page, 400, 300);
  await page.keyboard.press("ArrowRight");
  await page.setInputFiles("#fileInput", { name: "other.png", mimeType: "image/png", buffer: makePng(200, 100) });
  await waitForImage(page, 200, 100);
  await page.waitForTimeout(700);
  await waitForImage(page, 200, 100);
  await expect(page.locator("#fileName")).toHaveText("other.png");
  await expect(page.locator("#navRow")).toBeHidden();
});

test("P13: a broken image file shows an error instead of silently doing nothing", async ({ page }) => {
  await page.goto(APP_URL);
  const { makePng } = await import("./helpers.mjs");
  await page.setInputFiles("#fileInput", { name: "good.png", mimeType: "image/png", buffer: makePng(400, 300) });
  await waitForImage(page, 400, 300);
  await page.keyboard.press("c");
  await page.setInputFiles("#fileInput", { name: "broken.png", mimeType: "image/png", buffer: Buffer.from("not a png") });
  await expect(page.locator("#notice")).toContainText("Не удалось открыть «broken»");
  // the image that was open stays open
  await waitForImage(page, 400, 300);
  await expect(page.locator("#workspace")).toBeVisible();
});

test("P14: a broken file in the folder shows an error and Prev/Next stays on the current image", async ({ page }) => {
  await open(page, {
    initialFile: A, siblings: [A, B],
    files: { [A]: { width: 400, height: 300 }, [B]: { raw: Buffer.from("not a png") } },
  });
  await waitForImage(page, 400, 300);
  await expect(page.locator("#navPos")).toHaveText("1 / 2");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#notice")).toContainText("Не удалось открыть «b»");
  await expect(page.locator("#navPos")).toHaveText("1 / 2");
  await waitForImage(page, 400, 300);
  // counter was reset, so → tries b again instead of being stuck past the end
  await page.evaluate(() => { window.__mockLog.invokes.length = 0; });
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => window.__mockLog.invokes.some((i) => i.cmd === "read_file_bytes"));
});

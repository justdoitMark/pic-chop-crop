// The same page with no window.__TAURI__ — the plain-browser fallback path
// (file picker in, normal download out) that the desktop build also relies on
// when the native dialog fails.
import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { APP_URL, makePng, pngSize, waitForImage, QUADRANTS } from "./helpers.mjs";

test.beforeEach(async ({ page }) => {
  await page.goto(APP_URL);
});

test("file picker loads the image and Download saves a W×H PNG", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "photo.png",
    mimeType: "image/png",
    buffer: makePng(800, 600),
  });
  await waitForImage(page, 800, 600);
  await expect(page.locator("#navRow")).toBeHidden();

  await page.keyboard.press("c");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#downloadBtn"),
  ]);
  expect(download.suggestedFilename()).toBe("photo_1920x1080.png");
  const buf = await readFile(await download.path());
  expect(pngSize(buf)).toEqual({ width: 1920, height: 1080 });
});

test("non-image files are rejected with a message", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello"),
  });
  await expect(page.locator("#notice")).toContainText("Это не изображение");
  await expect(page.locator("#dropzone")).toBeVisible();
  await expect(page.locator("#workspace")).toBeHidden();
});

test("in a plain browser a turn changes the view and the download, not a file", async ({ page }) => {
  await page.setInputFiles("#fileInput", {
    name: "photo.png",
    mimeType: "image/png",
    buffer: makePng(400, 300, QUADRANTS(400, 300)),
  });
  await waitForImage(page, 400, 300);
  await page.keyboard.press("r");
  await expect(page.locator("#fileSize")).toHaveText("300 × 400");
  await expect(page.locator("#hint")).toContainText("открыт без пути");

  await page.keyboard.press("Escape");
  await page.fill("#inputW", "300");
  await page.fill("#inputH", "400");
  await page.locator("#inputH").blur();
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#downloadBtn")]);
  const buf = await readFile(await download.path());
  expect(pngSize(buf)).toEqual({ width: 300, height: 400 });
});

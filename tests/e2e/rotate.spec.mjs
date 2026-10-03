// Quarter turns: shown at once, saved into the file through rotate_image, and
// nothing else from the session ever reaches the original.
import { test, expect } from "@playwright/test";
import { APP_URL, installTauriMock, waitForImage, exportPixels, expectColors, makePng, QUADRANTS, RED, GREEN, BLUE, YELLOW } from "./helpers.mjs";

const A = "C:\\pics\\a.png";
const B = "C:\\pics\\b.png";
const CORNERS = [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]]; // TL, TR, BL, BR
const quad = { width: 400, height: 300, rgba: QUADRANTS(400, 300) };

async function openWith(page, opts) {
  await installTauriMock(page, opts);
  await page.goto(APP_URL);
}
const rotations = (page) => page.evaluate(() => window.__mockLog.rotations);

// keyboard.press knows only US-layout keys ("Unknown key: к"), so a Russian
// letter is sent as the keydown WebView2 gives with a Russian layout: key "к".
async function press(page, key) {
  if (!/^[а-яё]$/i.test(key)) return page.keyboard.press(key);
  await page.evaluate((k) => {
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  }, key);
}

test("⟳ turns the view and the export, and saves exactly one turn", async ({ page }) => {
  await openWith(page, { initialFile: A, files: { [A]: quad } });
  await waitForImage(page, 400, 300);
  await page.keyboard.press("Escape");

  await page.click("#rotateRightBtn");
  await expect(page.locator("#fileSize")).toHaveText("300 × 400");
  expect(await rotations(page)).toEqual([{ path: A, quarterTurns: 1 }]);
  // clockwise: the old bottom-left (blue) is now top-left
  expectColors(await exportPixels(page, CORNERS, { w: 300, h: 400 }), [BLUE, RED, YELLOW, GREEN]);
});

test("⟲ turns the other way", async ({ page }) => {
  await openWith(page, { initialFile: A, files: { [A]: quad } });
  await waitForImage(page, 400, 300);
  await page.keyboard.press("Escape");

  await page.click("#rotateLeftBtn");
  await expect(page.locator("#fileSize")).toHaveText("300 × 400");
  expect(await rotations(page)).toEqual([{ path: A, quarterTurns: -1 }]);
  expectColors(await exportPixels(page, CORNERS, { w: 300, h: 400 }), [GREEN, YELLOW, RED, BLUE]);
});

test("R, L, Ctrl+R and the Russian К, Д rotate; Ctrl+R does not reload", async ({ page }) => {
  await openWith(page, { initialFile: A, files: { [A]: quad } });
  await waitForImage(page, 400, 300);
  await page.evaluate(() => { window.__notReloaded = true; });

  for (const key of ["r", "l", "Control+r", "к", "д"]) await press(page, key);
  // Headless Edge never reloads on a synthetic Ctrl+R, so surviving proves
  // little: the keydown itself must be cancelled (dispatchEvent → false).
  const notCancelled = await page.evaluate(() =>
    ["r", "к"].map((key) => document.dispatchEvent(
      new KeyboardEvent("keydown", { key, code: "KeyR", ctrlKey: true, bubbles: true, cancelable: true }))));
  expect(notCancelled).toEqual([false, false]);
  expect((await rotations(page)).map((r) => r.quarterTurns)).toEqual([1, -1, 1, 1, -1, 1, 1]);
  expect(await page.evaluate(() => window.__notReloaded)).toBe(true);
  await expect(page.locator("#fileSize")).toHaveText("300 × 400");
});

test("four turns bring the picture back", async ({ page }) => {
  await openWith(page, { initialFile: A, files: { [A]: quad } });
  await waitForImage(page, 400, 300);
  for (let i = 0; i < 4; i++) await page.keyboard.press("r");
  await expect(page.locator("#fileSize")).toHaveText("400 × 300");
  expect(await rotations(page)).toHaveLength(4);
});

test("only the turn reaches the file: size, frame and format stay in the app", async ({ page }) => {
  await openWith(page, { initialFile: A, files: { [A]: quad } });
  await waitForImage(page, 400, 300);
  await page.keyboard.press("Escape");
  await page.click("#rotateRightBtn");
  await page.fill("#inputW", "640");
  await page.locator("#inputW").blur();
  await page.click("#fmtBtn");
  await page.click('.fmt[data-fmt="jpeg"]');
  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+ArrowRight");

  const log = await page.evaluate(() => window.__mockLog);
  expect(log.writes).toHaveLength(0);
  const sent = log.invokes.map((i) => i.cmd).filter((c) => !["get_initial_file", "read_file_bytes", "list_siblings", "app_ready"].includes(c));
  expect(sent).toEqual(["rotate_image"]);

  await page.reload(); // closing the window reloads the page; the file opens again
  await waitForImage(page, 300, 400);
  await expect(page.locator("#fileSize")).toHaveText("300 × 400");
});

test("a failed save is reported and the view stays turned", async ({ page }) => {
  await openWith(page, { initialFile: A, files: { [A]: quad }, rotateError: "read-only" });
  await waitForImage(page, 400, 300);
  await page.keyboard.press("r");
  await expect(page.locator("#notice")).toHaveText("Поворот не сохранён: файл только для чтения. Снимите галочку «Только чтение» в свойствах файла");
  await expect(page.locator("#fileSize")).toHaveText("300 × 400");
});

test("an unknown error is shown with its text", async ({ page }) => {
  await openWith(page, { initialFile: A, files: { [A]: quad }, rotateError: "disk full" });
  await waitForImage(page, 400, 300);
  await page.keyboard.press("r");
  await expect(page.locator("#notice")).toHaveText("Поворот не сохранён: disk full");
});

test("a turned file stays turned when you come back to it", async ({ page }) => {
  await openWith(page, { initialFile: A, siblings: [A, B], files: { [A]: quad, [B]: { width: 200, height: 100 } } });
  await waitForImage(page, 400, 300);
  await page.keyboard.press("r");
  await page.keyboard.press("ArrowRight");
  await waitForImage(page, 200, 100);
  await expect(page.locator("#fileSize")).toHaveText("200 × 100");
  await page.keyboard.press("ArrowLeft");
  await waitForImage(page, 300, 400); // the saved file comes back turned
  await expect(page.locator("#fileSize")).toHaveText("300 × 400");
});

test("a turn during a slow Next load goes to the file on screen", async ({ page }) => {
  await openWith(page, {
    initialFile: A, siblings: [A, B],
    files: { [A]: quad, [B]: { width: 200, height: 100, delayMs: 400 } },
  });
  await waitForImage(page, 400, 300);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("r");
  await waitForImage(page, 200, 100);
  expect(await rotations(page)).toEqual([{ path: A, quarterTurns: 1 }]);
  await expect(page.locator("#fileSize")).toHaveText("200 × 100");
});

test("the first turn explains that it is saved; later turns stay quiet", async ({ page }) => {
  await openWith(page, { initialFile: A, files: { [A]: quad } });
  await waitForImage(page, 400, 300);
  await page.keyboard.press("r");
  await expect(page.locator("#hint")).toHaveText("Поворот сразу сохраняется в файл");
  await page.evaluate(() => { document.getElementById("hint").style.display = "none"; });
  await page.keyboard.press("r");
  await page.waitForTimeout(200);
  expect(await page.locator("#hint").isVisible()).toBe(false); // one-shot, see desktop.spec
});

test("a dropped file (no path) turns on screen only and says so", async ({ page }) => {
  await openWith(page, { initialFile: A, files: { [A]: quad } });
  await waitForImage(page, 400, 300);
  await page.evaluate((b64) => {
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, makePng(200, 100).toString("base64"));
  await waitForImage(page, 200, 100);

  await page.keyboard.press("r");
  await expect(page.locator("#fileSize")).toHaveText("100 × 200");
  await expect(page.locator("#hint")).toHaveText("Этот файл открыт без пути — поворот виден только здесь, в файл не сохраняется");
  expect(await rotations(page)).toEqual([]);
});

test.describe("Ctrl+O opens through the native dialog", () => {
  const files = { [A]: quad, [B]: { width: 200, height: 100 } };

  test("the chosen file opens with its path: turns are saved and Prev/Next works", async ({ page }) => {
    await openWith(page, { initialFile: A, siblings: [A, B], files, openResult: B });
    await waitForImage(page, 400, 300);
    await page.keyboard.press("Control+o");
    await waitForImage(page, 200, 100);
    const opens = await page.evaluate(() => window.__mockLog.opens);
    expect(opens).toHaveLength(1);
    expect(opens[0]).toMatchObject({ multiple: false, directory: false, filters: [{ name: "Изображения", extensions: ["jpg", "jpeg", "png"] }] });
    await expect(page.locator("#navPos")).toHaveText("2 / 2");
    await page.keyboard.press("r");
    expect(await rotations(page)).toEqual([{ path: B, quarterTurns: 1 }]);
  });

  test("the folder button uses the same dialog", async ({ page }) => {
    await openWith(page, { initialFile: A, siblings: [A, B], files, openResult: B });
    await waitForImage(page, 400, 300);
    await page.keyboard.press("Escape");
    await page.click("#openBtn");
    await waitForImage(page, 200, 100);
  });

  test("cancelling the dialog keeps the current image", async ({ page }) => {
    await openWith(page, { initialFile: A, siblings: [A, B], files, openResult: null });
    await waitForImage(page, 400, 300);
    await page.keyboard.press("Control+o");
    await page.waitForFunction(() => window.__mockLog.opens.length === 1);
    await page.waitForTimeout(200);
    await expect(page.locator("#fileName")).toHaveText("a.png");
    await expect(page.locator("#navPos")).toHaveText("1 / 2");
  });

  test("a chosen file that fails to load leaves the picture on screen with its path and folder", async ({ page }) => {
    await openWith(page, { initialFile: A, siblings: [A, B], files, openResult: "C:\\pics\\missing.png" });
    await waitForImage(page, 400, 300);
    await page.keyboard.press("Control+o");
    await expect(page.locator("#notice")).toContainText("missing");
    await expect(page.locator("#fileName")).toHaveText("a.png");
    await expect(page.locator("#navPos")).toHaveText("1 / 2");
    await page.keyboard.press("r");
    expect(await rotations(page)).toEqual([{ path: A, quarterTurns: 1 }]);
    await page.keyboard.press("ArrowRight");
    await waitForImage(page, 200, 100);
  });

  test("a turn while the chosen file is still loading goes to the file on screen", async ({ page }) => {
    await openWith(page, {
      initialFile: A, siblings: [A, B], openResult: B,
      files: { [A]: quad, [B]: { width: 200, height: 100, delayMs: 400 } },
    });
    await waitForImage(page, 400, 300);
    await page.keyboard.press("Control+o");
    await page.waitForFunction(() => window.__mockLog.opens.length === 1);
    await page.keyboard.press("r");
    await waitForImage(page, 200, 100);
    expect(await rotations(page)).toEqual([{ path: A, quarterTurns: 1 }]);
    await expect(page.locator("#navPos")).toHaveText("2 / 2");
  });
  test("a second request while the dialog is open does not stack another dialog", async ({ page }) => {
    await openWith(page, { initialFile: A, siblings: [A, B], files, openResult: B, openDelayMs: 300 });
    await waitForImage(page, 400, 300);
    // all four requests land within the 300 ms the first dialog stays open
    await page.keyboard.press("Control+o");
    await page.keyboard.press("Control+o");
    await page.evaluate(() => { const b = document.getElementById("openBtn"); b.click(); b.click(); });
    await waitForImage(page, 200, 100);
    expect(await page.evaluate(() => window.__mockLog.opens)).toHaveLength(1);
    // once it has answered, the next request opens a dialog again
    await page.keyboard.press("Control+o");
    await page.waitForFunction(() => window.__mockLog.opens.length === 2);
  });

  test("a failed folder listing keeps the path, so turns are still saved", async ({ page }) => {
    await openWith(page, { initialFile: A, siblings: [A, B], files, openResult: B, siblingsError: "denied" });
    await waitForImage(page, 400, 300);
    await page.keyboard.press("Control+o");
    await waitForImage(page, 200, 100);
    await page.waitForFunction(() => window.__mockLog.invokes.filter((i) => i.cmd === "list_siblings").length === 2);
    await page.keyboard.press("r");
    expect(await rotations(page)).toEqual([{ path: B, quarterTurns: 1 }]);
    await expect(page.locator("#navRow")).toBeHidden();
  });
});

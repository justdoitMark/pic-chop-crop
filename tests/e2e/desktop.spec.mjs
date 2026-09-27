// The app as the desktop build runs it: window.__TAURI__ is present (faked
// here), the file comes from get_initial_file, saving goes through the
// native dialog + write_file_bytes.
import { test, expect } from "@playwright/test";
import { APP_URL, installTauriMock, decodeInPage, waitForImage, boxRect } from "./helpers.mjs";

const A = "C:\\pics\\a.png";
const B = "C:\\pics\\b.png";
const C = "C:\\pics\\c.png";

async function openWith(page, opts) {
  await installTauriMock(page, opts);
  await page.goto(APP_URL);
}

async function lastWrite(page) {
  await page.waitForFunction(() => window.__mockLog.writes.length > 0);
  return page.evaluate(() => window.__mockLog.writes.at(-1));
}

test.describe("opening a file", () => {
  test("opens in focus mode with the crop frame hidden; C shows it", async ({ page }) => {
    await openWith(page, { initialFile: A, files: { [A]: { width: 800, height: 600 } } });
    await waitForImage(page, 800, 600);

    await expect(page.locator("body")).toHaveClass(/focusMode/);
    await expect(page.locator("#cropBox")).toBeHidden();
    await expect(page.locator("#fileName")).toHaveText("a.png");
    await expect(page.locator("#fileSize")).toHaveText("800 × 600");
    await expect(page.locator("#hint")).toBeVisible();

    await page.keyboard.press("c");
    await expect(page.locator("#cropBox")).toBeVisible();
    await expect(page.locator("body")).not.toHaveClass(/focusMode/);
    await expect(page.locator("#hint")).toBeHidden();
  });

  // A warm open (the resident app gets another "Open with") reloads the page
  // in the same window; the hint is for the cold start only.
  test("the Esc hint shows on a cold start only, not on warm reopens", async ({ page }) => {
    await openWith(page, { initialFile: A, files: { [A]: { width: 800, height: 600 } } });
    await waitForImage(page, 800, 600);
    await expect(page.locator("#hint")).toBeVisible();

    await page.reload();
    await waitForImage(page, 800, 600);
    await page.waitForTimeout(300);
    // A one-shot check: toBeHidden() would retry past the hint's own 4 s timeout.
    expect(await page.locator("#hint").isVisible()).toBe(false);
  });
});

test.describe("export", () => {
  test("output is exactly the target W×H with a matching file name", async ({ page }) => {
    await openWith(page, { initialFile: A, files: { [A]: { width: 800, height: 600 } } });
    await waitForImage(page, 800, 600);
    await page.keyboard.press("c"); // leave focus mode so the panel is visible

    await page.fill("#inputW", "640");
    await page.fill("#inputH", "360");
    await page.click("#downloadBtn");

    const write = await lastWrite(page);
    const save = await page.evaluate(() => window.__mockLog.saves.at(-1));
    expect(save.defaultPath).toBe("a_640x360.png");
    const out = await decodeInPage(page, write.dataBase64, "image/png");
    expect(out).toMatchObject({ width: 640, height: 360 });
  });

  test("leaving focus mode shows the frame, and Save works on the first click", async ({ page }) => {
    await openWith(page, { initialFile: A, files: { [A]: { width: 800, height: 600 } } });
    await waitForImage(page, 800, 600);
    await page.keyboard.press("Escape");

    await expect(page.locator("#cropBox")).toBeVisible();
    await page.click("#downloadBtn");
    await lastWrite(page);
  });

  test("Ctrl+S in focus mode only reveals the frame; the next Ctrl+S saves", async ({ page }) => {
    await openWith(page, { initialFile: A, files: { [A]: { width: 800, height: 600 } } });
    await waitForImage(page, 800, 600);

    await page.keyboard.press("Control+s");
    await expect(page.locator("#cropBox")).toBeVisible();
    await expect(page.locator("body")).not.toHaveClass(/focusMode/);
    expect(await page.evaluate(() => window.__mockLog.saves.length)).toBe(0);

    await page.keyboard.press("Control+s");
    await lastWrite(page);
  });

  test("hiding the frame with C: Save first brings the frame back instead of saving", async ({ page }) => {
    await openWith(page, { initialFile: A, files: { [A]: { width: 800, height: 600 } } });
    await waitForImage(page, 800, 600);
    await page.keyboard.press("Escape");
    await page.keyboard.press("c");
    await expect(page.locator("#cropBox")).toBeHidden();

    await page.click("#downloadBtn");
    await expect(page.locator("#cropBox")).toBeVisible();
    expect(await page.evaluate(() => window.__mockLog.saves.length)).toBe(0);
  });

  test("JPEG export of a transparent PNG has a white background, not black", async ({ page }) => {
    await openWith(page, {
      initialFile: A,
      files: { [A]: { width: 400, height: 400, rgba: [0, 0, 0, 0] } },
    });
    await waitForImage(page, 400, 400);
    await page.keyboard.press("c");
    await page.click("#fmtBtn");
    await page.click('.fmt[data-fmt="jpeg"]');
    await page.click("#downloadBtn");

    const write = await lastWrite(page);
    const save = await page.evaluate(() => window.__mockLog.saves.at(-1));
    expect(save.defaultPath).toMatch(/\.jpg$/);
    const out = await decodeInPage(page, write.dataBase64, "image/jpeg");
    const [r, g, b] = out.center;
    expect(Math.min(r, g, b)).toBeGreaterThan(245);
  });

  test("cancelling the Save As dialog writes nothing", async ({ page }) => {
    await openWith(page, {
      initialFile: A,
      files: { [A]: { width: 800, height: 600 } },
      saveResult: null,
    });
    await waitForImage(page, 800, 600);
    await page.keyboard.press("c");
    await page.click("#downloadBtn");

    await page.waitForFunction(() => window.__mockLog.saves.length === 1);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__mockLog.writes.length)).toBe(0);
  });
});

test.describe("target size controls", () => {
  test.beforeEach(async ({ page }) => {
    await openWith(page, { initialFile: A, files: { [A]: { width: 800, height: 600 } } });
    await waitForImage(page, 800, 600);
    await page.keyboard.press("c");
  });

  const pickRatio = async (page, label) => {
    await page.click("#ratioBtn");
    await page.locator(".ratioCard", { has: page.locator(".rTitle", { hasText: new RegExp(`^${label}$`) }) }).click();
  };
  const pickPreset = async (page, label) => {
    await page.click("#ratioBtn");
    await page.locator(".preset", { hasText: new RegExp(`^${label}$`) }).click();
  };
  const size = async (page) => [await page.inputValue("#inputW"), await page.inputValue("#inputH")];

  test("a ratio keeps the long side: landscape stays landscape, portrait turns it", async ({ page }) => {
    await page.fill("#inputW", "2000"); // 2000×1080
    await pickRatio(page, "16:9");
    expect(await size(page)).toEqual(["2000", "1125"]);
    await pickRatio(page, "9:16");
    expect(await size(page)).toEqual(["1125", "2000"]);
    await pickRatio(page, "1:1");
    expect(await size(page)).toEqual(["2000", "2000"]);
    await expect(page.locator("#ratioLbl")).toHaveText("1:1");
  });

  test("square presets 2560×2560 and 3840×3840 are offered", async ({ page }) => {
    await pickPreset(page, "2560×2560");
    expect(await size(page)).toEqual(["2560", "2560"]);
    await pickPreset(page, "3840×3840");
    expect(await size(page)).toEqual(["3840", "3840"]);
  });

  test("a size outside the presets shows its reduced ratio", async ({ page }) => {
    await page.fill("#inputW", "3840"); // 3840×1080
    await expect(page.locator("#ratioLbl")).toHaveText("32:9");
  });

  test("flip swaps width and height", async ({ page }) => {
    await page.click("#flipBtn");
    await expect(page.locator("#inputW")).toHaveValue("1080");
    await expect(page.locator("#inputH")).toHaveValue("1920");
    await expect(page.locator("#downloadBtn")).toHaveAttribute("aria-label", "Сохранить 1080×1920");
  });

  test("Shift+arrow moves the frame by exactly one source pixel", async ({ page }) => {
    await page.fill("#inputW", "400");
    await page.fill("#inputH", "400");
    await page.locator("#inputH").blur();
    const srcX = () => page.evaluate(() => {
      const st = document.getElementById("stage");
      return parseFloat(document.getElementById("cropBox").style.left) * 800 / parseFloat(st.style.width);
    });
    await page.keyboard.press("Shift+ArrowRight"); // snaps to a whole source pixel
    const x0 = await srcX();
    await page.keyboard.press("Shift+ArrowRight");
    expect((await srcX()) - x0).toBeCloseTo(1, 5);
    await page.keyboard.press("Control+Shift+ArrowLeft");
    expect(x0 - (await srcX())).toBeCloseTo(9, 5);
  });

  test("crop frame keeps the target aspect ratio", async ({ page }) => {
    await page.fill("#inputW", "300");
    await page.fill("#inputH", "100");
    const r = await boxRect(page);
    expect(r.w / r.h).toBeCloseTo(3, 1);
  });
});

test.describe("crop frame dragging", () => {
  test.beforeEach(async ({ page }) => {
    await openWith(page, { initialFile: A, files: { [A]: { width: 800, height: 600 } } });
    await waitForImage(page, 800, 600);
    await page.keyboard.press("c");
    await page.fill("#inputW", "100");
    await page.fill("#inputH", "100"); // square frame leaves room to move sideways
  });

  test("frame cannot be dragged outside the image", async ({ page }) => {
    const bb = await page.locator("#cropBox").boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.mouse.down();
    await page.mouse.move(bb.x + 3000, bb.y + 3000, { steps: 5 });
    await page.mouse.up();

    const r = await boxRect(page);
    const stage = await page.evaluate(() => {
      const s = document.getElementById("stage");
      return { w: parseFloat(s.style.width), h: parseFloat(s.style.height) };
    });
    expect(r.x + r.w).toBeLessThanOrEqual(stage.w + 0.5);
    expect(r.y + r.h).toBeLessThanOrEqual(stage.h + 0.5);
  });

  test("pointercancel ends the drag, so the frame stops following the mouse", async ({ page }) => {
    const bb = await page.locator("#cropBox").boundingBox();
    const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
    const start = await boxRect(page);

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 15, cy, { steps: 3 });
    const moved = await boxRect(page);
    expect(moved.x).toBeGreaterThan(start.x);

    await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointercancel")));
    await page.mouse.move(cx + 60, cy, { steps: 3 });
    const after = await boxRect(page);
    expect(after.x).toBeCloseTo(moved.x, 1);
    await page.mouse.up();
  });
});

test.describe("Prev/Next through the folder", () => {
  const files = {
    [A]: { width: 400, height: 300 },
    [B]: { width: 300, height: 400 },
    [C]: { width: 250, height: 250 },
  };

  test("arrows step through siblings and stop at the ends", async ({ page }) => {
    await openWith(page, { initialFile: B, siblings: [A, B, C], files });
    await waitForImage(page, 300, 400);
    await expect(page.locator("#navPos")).toHaveText("2 / 3");

    await page.keyboard.press("ArrowRight");
    await waitForImage(page, 250, 250);
    await expect(page.locator("#navPos")).toHaveText("3 / 3");
    await expect(page.locator("#nextBtn")).toBeDisabled();

    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await waitForImage(page, 400, 300);
    await expect(page.locator("#navPos")).toHaveText("1 / 3");
    await expect(page.locator("#prevBtn")).toBeDisabled();
  });

  test("a slow earlier load cannot overwrite a newer one (fast arrow presses)", async ({ page }) => {
    // C -> A is slow, A -> B is instant. Pressing → twice must end on B: the
    // late answer for A has to be thrown away, not shown over B.
    await openWith(page, {
      initialFile: C,
      siblings: [C, A, B],
      files: { ...files, [A]: { ...files[A], delayMs: 400 } },
    });
    await waitForImage(page, 250, 250);

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction((a) => window.__mockLog.resolvedReads.includes(a), A);
    await page.waitForTimeout(400); // give a stale load time to (wrongly) finish decoding

    await waitForImage(page, 300, 400);
    await expect(page.locator("#navPos")).toHaveText("3 / 3");

    await page.keyboard.press("c");
    await page.click("#downloadBtn");
    await page.waitForFunction(() => window.__mockLog.saves.length > 0);
    const save = await page.evaluate(() => window.__mockLog.saves.at(-1));
    expect(save.defaultPath).toMatch(/^b_/);
  });

  test("single file in the folder hides the nav row", async ({ page }) => {
    await openWith(page, { initialFile: A, siblings: [A], files });
    await waitForImage(page, 400, 300);
    await expect(page.locator("#navRow")).toBeHidden();
  });
});

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
  await expect(page.locator("#tiltBtn")).toHaveAttribute("aria-label", "Наклон, 0 градусов");
  await expect(page.locator("#tiltBtn")).toHaveAttribute("title", "Наклон (клавиши [ и ]). Только для сохраняемой обрезки");
  await page.keyboard.press("]");
  await expect(page.locator("#tiltLbl")).toHaveText("+1°");
  await expect(page.locator("#tiltBtn")).toHaveClass(/\bon\b/);
  await expect(page.locator("#tiltBtn")).toHaveAttribute("aria-label", "Наклон, плюс 1 градус"); // the angle reaches screen readers
  await page.keyboard.press("[");
  await expect(page.locator("#tiltLbl")).toHaveText("0°");
  await expect(page.locator("#tiltBtn")).not.toHaveClass(/\bon\b/);
  await page.keyboard.press("[");
  await expect(page.locator("#tiltLbl")).toHaveText("−1°");
  await expect(page.locator("#tiltBtn")).toHaveAttribute("aria-label", "Наклон, минус 1 градус");
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

// A turn, tilt or zoom while a corner is held moves the picture under the
// frame; the drag must end there, or its next move builds the frame from the
// old position — outside the picture — and Save exports background.
async function holdCornerDuring(page, corner, action) {
  const bb = await page.locator(`.handle[data-corner="${corner}"]`).boundingBox();
  const x = bb.x + bb.width / 2, y = bb.y + bb.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 20, y - 20, { steps: 3 });
  await action(page);
  await page.mouse.move(x + 60, y + 60, { steps: 5 });
  await page.mouse.up();
}

const CORNERS_AND_CENTRE = [[0, 0], [0.999, 0], [0, 0.999], [0.999, 0.999], [0.5, 0.5]];

// Each case is set up so that the held drag's old fixed corner (bottom-right
// for a tl drag) is off the picture afterwards.
const wheelTimes = (dy) => async (page) => { for (let i = 0; i < 2; i++) await page.mouse.wheel(0, dy); };
for (const [what, setup, action] of [
  // a landscape frame's bottom-right lies right of the turned, narrower picture
  ["a turn (R)", null, (page) => page.keyboard.press("r")],
  // the frame fills the picture: its corner is off it at 1°
  ["a tilt (])", (page) => drag(page, '.handle[data-corner="br"]', 3000, 3000), (page) => page.keyboard.press("]")],
  // zoomed in, then back out under the held corner: the picture shrinks
  ["a wheel zoom", async (page) => {
    const vp = await page.locator("#viewport").boundingBox();
    await page.mouse.move(vp.x + vp.width / 2, vp.y + vp.height / 2);
    await wheelTimes(-100)(page);
  }, wheelTimes(100)],
]) {
  test(`${what} during a corner drag keeps the frame on the picture and the export free of background`, async ({ page }) => {
    await open(page);
    if (setup) await setup(page);
    await holdCornerDuring(page, "tl", action);
    await expectFrameInside(page);
    const px = await exportPixels(page, CORNERS_AND_CENTRE);
    expectColors(px, CORNERS_AND_CENTRE.map(() => SOLID), 10);
  });
}

test("tilt never reaches Rust and resets on the next file", async ({ page }) => {
  await open(page, { siblings: [A, B], files: { [A]: { width: 400, height: 300, rgba: SOLID }, [B]: { width: 200, height: 100 } } });
  await pressTimes(page, "]", 2);
  expect(await page.evaluate(() => window.__mockLog.invokes.some((i) => i.cmd === "rotate_image"))).toBe(false);
  await page.keyboard.press("ArrowRight");
  await waitForImage(page, 200, 100);
  await expect(page.locator("#tiltLbl")).toHaveText("0°");
});

test.describe("the tilt ruler", () => {
  const PX_PER_DEG = 8; // frontend/index.html: PX_PER_DEG and --deg

  test("opens from the angle button and closes with Esc", async ({ page }) => {
    await open(page);
    await page.click("#tiltBtn");
    await expect(page.locator("#tiltPop")).toBeVisible();
    await expect(page.locator("#tiltBtn")).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(page.locator("#tiltPop")).toBeHidden();
    await expect(page.locator("#tiltBtn")).toHaveAttribute("aria-expanded", "false");
    // a second click on the angle button closes the ruler too
    await page.click("#tiltBtn");
    await expect(page.locator("#tiltPop")).toBeVisible();
    await page.click("#tiltBtn");
    await expect(page.locator("#tiltPop")).toBeHidden();
    await expect(page.locator("#tiltBtn")).toHaveAttribute("aria-expanded", "false");
  });

  test("dragging the scale changes the angle by whole degrees", async ({ page }) => {
    await open(page);
    await page.click("#tiltBtn");
    await drag(page, "#tiltRuler", -3 * PX_PER_DEG, 0); // the scale moves left: bigger angles come under the mark
    await expect(page.locator("#tiltValue")).toHaveText("+3°");
    await expect(page.locator("#tiltLbl")).toHaveText("+3°");
  });

  test("wheel, double-click and the buttons", async ({ page }) => {
    await open(page);
    await page.click("#tiltBtn");
    const bb = await page.locator("#tiltRuler").boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.mouse.wheel(0, -100);
    await expect(page.locator("#tiltValue")).toHaveText("+1°");
    await page.mouse.dblclick(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await expect(page.locator("#tiltValue")).toHaveText("0°");
    await page.click("#tiltPlus");
    await page.click("#tiltPlus");
    await expect(page.locator("#tiltValue")).toHaveText("+2°");
    await page.click("#tiltMinus");
    await expect(page.locator("#tiltValue")).toHaveText("+1°");
    await page.click("#tiltReset");
    await expect(page.locator("#tiltValue")).toHaveText("0°");
  });

  test("the wheel turns one degree per notch, not per event, and ignores sideways scroll", async ({ page }) => {
    await open(page);
    await page.click("#tiltBtn");
    const bb = await page.locator("#tiltRuler").boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -10); // a touchpad: many small events
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(page.locator("#tiltValue")).toHaveText("+1°"); // 50 px of scroll is one degree, not five
    await page.mouse.wheel(100, 0); // sideways swipe or Shift+wheel: deltaY is 0
    await page.mouse.wheel(0, -100); // one notch up
    await expect(page.locator("#tiltValue")).toHaveText("+2°"); // the sideways scroll did not count as −1°
  });

  test("keyboard on the ruler, announced for screen readers, without paging files", async ({ page }) => {
    await open(page, { siblings: [A, B], files: { [A]: { width: 400, height: 300, rgba: SOLID }, [B]: { width: 200, height: 100 } } });
    await page.click("#tiltBtn");
    await page.locator("#tiltRuler").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#tiltRuler")).toHaveAttribute("aria-valuenow", "1");
    await expect(page.locator("#tiltRuler")).toHaveAttribute("aria-valuetext", "плюс 1 градус");
    await pressTimes(page, "ArrowLeft", 3);
    await expect(page.locator("#tiltRuler")).toHaveAttribute("aria-valuetext", "минус 2 градуса");
    await page.keyboard.press("Home");
    await expect(page.locator("#tiltRuler")).toHaveAttribute("aria-valuetext", "0 градусов");
    await expect(page.locator("#navPos")).toHaveText("1 / 2"); // arrows on the ruler did not change file
    // ← after → would page back to 1 / 2, so also check that B was never asked for
    const readB = await page.evaluate((b) => window.__mockLog.invokes.some((c) => c.cmd === "read_file_bytes" && c.args.path === b), B);
    expect(readB).toBe(false);
  });

  // A press on the ruler focuses it; once it is closed, ← → must page files
  // again. The browser drops focus from a hidden element only at its next
  // frame, so the → here comes in the same frame as the close, as a quick
  // keypress can.
  for (const how of ["Esc", "a click beside the picture"]) {
    test(`after closing with ${how}, the arrows page files instead of tilting`, async ({ page }) => {
      await open(page, { siblings: [A, B], files: { [A]: { width: 400, height: 300, rgba: SOLID }, [B]: { width: 200, height: 100 } } });
      await page.click("#tiltBtn");
      await page.click("#tiltRuler"); // a press without a move: the angle stays 0°
      await expect(page.locator("#tiltRuler")).toBeFocused();
      const after = await page.evaluate((how) => {
        const key = (k) => (document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
        if (how === "Esc") key("Escape");
        else document.getElementById("viewport").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }));
        const open = document.getElementById("tiltPop").classList.contains("open");
        key("ArrowRight");
        return { open, focused: document.activeElement.id, tilt: document.getElementById("tiltLbl").textContent };
      }, how);
      expect(after).toEqual({ open: false, focused: expect.not.stringMatching(/^tiltRuler$/), tilt: "0°" });
      await expect(page.locator("#navPos")).toHaveText("2 / 2");
      await waitForImage(page, 200, 100);
    });
  }

  test("in focus mode the bar stays visible while the ruler is open", async ({ page }) => {
    await installTauriMock(page, { initialFile: A, files: { [A]: { width: 400, height: 300, rgba: SOLID } } });
    await page.goto(APP_URL);
    await waitForImage(page, 400, 300); // opens in focus mode
    await page.click("#tiltBtn");
    await page.locator("#tiltRuler").focus(); // as after a drag: the bar no longer holds focus
    await page.mouse.move(400, 500); // away from the bar
    await expect(page.locator("#bar")).toHaveCSS("opacity", "1");
  });
});

test("leaving focus mode with the ruler open moves it off the pill", async ({ page }) => {
  // A low window: in focus mode the ruler may reach down to the window edge;
  // once the pill is back it must stop above it.
  await page.setViewportSize({ width: 800, height: 190 });
  await installTauriMock(page, { initialFile: A, files: { [A]: { width: 400, height: 300, rgba: SOLID } } });
  await page.goto(APP_URL);
  await waitForImage(page, 400, 300); // opens in focus mode
  await page.click("#tiltBtn");
  await expect(page.locator("#tiltPop")).toBeVisible();
  await page.keyboard.press("f"); // leave focus mode, the ruler stays open
  await expect(page.locator("body")).not.toHaveClass(/\bfocusMode\b/);
  await expect(page.locator("#tiltPop")).toBeVisible();
  const pop = await page.locator("#tiltPop").boundingBox();
  const pill = await page.locator("#pill").boundingBox();
  expect(pop.y + pop.height).toBeLessThanOrEqual(pill.y);
});

test.describe("touch in focus mode", () => {
  test.use({ hasTouch: true });

  test("the first tap on the hidden bar only reveals it; the next one presses", async ({ page }) => {
    await installTauriMock(page, { initialFile: A, files: { [A]: { width: 400, height: 300, rgba: SOLID } } });
    await page.goto(APP_URL);
    await waitForImage(page, 400, 300); // opens in focus mode, bar transparent
    const bb = await page.locator("#rotateRightBtn").boundingBox();
    const tap = () => page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);

    await tap();
    await expect(page.locator("body")).toHaveClass(/\bbarPeek\b/);
    expect(await page.evaluate(() => window.__mockLog.rotations)).toEqual([]);

    await tap();
    await page.waitForFunction(() => window.__mockLog.rotations.length === 1);

    await expect(page.locator("body")).not.toHaveClass(/\bbarPeek\b/, { timeout: 4000 });
    // really hidden: neither the pressed button's focus nor the hover a tap leaves behind keeps it
    await expect(page.locator("#bar")).toHaveCSS("opacity", "0");
    await tap(); // hidden again, so this tap only reveals it
    await expect(page.locator("body")).toHaveClass(/\bbarPeek\b/);
    expect(await page.evaluate(() => window.__mockLog.rotations.length)).toBe(1);
  });

  test("a tap on the picture below hides the revealed bar", async ({ page }) => {
    await installTauriMock(page, { initialFile: A, files: { [A]: { width: 400, height: 300, rgba: SOLID } } });
    await page.goto(APP_URL);
    await waitForImage(page, 400, 300);
    await page.touchscreen.tap(640, 10);
    await expect(page.locator("body")).toHaveClass(/\bbarPeek\b/);
    await page.touchscreen.tap(640, 400);
    await expect(page.locator("body")).not.toHaveClass(/\bbarPeek\b/);
    await expect(page.locator("#bar")).toHaveCSS("opacity", "0");
  });

  test("taps are never swallowed while the open ruler keeps the bar visible", async ({ page }) => {
    // A narrow window: the 44 px touch sizes are off, so the ruler starts right under the 36 px bar.
    await page.setViewportSize({ width: 540, height: 600 });
    await installTauriMock(page, { initialFile: A, files: { [A]: { width: 400, height: 300, rgba: SOLID } } });
    await page.goto(APP_URL);
    await waitForImage(page, 400, 300); // focus mode
    await page.click("#tiltBtn"); // mouse: the bar is not hidden from it
    await page.locator("#tiltRuler").focus(); // the bar no longer holds focus; the open ruler keeps it visible
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished))); // popIn slides the ruler
    const plus = await page.locator("#tiltPlus").boundingBox();
    expect(plus.y).toBeLessThan(56); // the button's top edge lies in the strip (PEEK_ZONE)
    await page.touchscreen.tap(plus.x + plus.width / 2, plus.y + 0.5);
    await expect(page.locator("#tiltValue")).toHaveText("+1°");

    const rot = await page.locator("#rotateRightBtn").boundingBox();
    await page.touchscreen.tap(rot.x + rot.width / 2, rot.y + rot.height / 2);
    await page.waitForFunction(() => window.__mockLog.rotations.length === 1); // the first tap pressed
  });

  /** Raw touch through CDP: points is a list of [x, y]; the finger rests holdMs on the first one. */
  async function touchPath(page, points, holdMs = 0) {
    const cdp = await page.context().newCDPSession(page);
    const pt = ([x, y]) => [{ x, y, id: 1 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(points[0]) });
    if (holdMs) await page.waitForTimeout(holdMs);
    for (const p of points.slice(1)) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(p) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
  }

  test("a long first touch on the hidden bar still only reveals it", async ({ page }) => {
    await installTauriMock(page, { initialFile: A, files: { [A]: { width: 400, height: 300, rgba: SOLID } } });
    await page.goto(APP_URL);
    await waitForImage(page, 400, 300); // focus mode, bar hidden
    const bb = await page.locator("#rotateRightBtn").boundingBox();
    await touchPath(page, [[bb.x + bb.width / 2, bb.y + bb.height / 2]], 700);
    await page.evaluate(() => new Promise((r) => setTimeout(r, 100))); // let a late click arrive
    await expect(page.locator("body")).toHaveClass(/\bbarPeek\b/);
    expect(await page.evaluate(() => window.__mockLog.rotations)).toEqual([]);
  });

  test("a mouse click right after a touch swipe in the strip is not eaten", async ({ page }) => {
    await installTauriMock(page, { initialFile: A, files: { [A]: { width: 400, height: 300, rgba: SOLID } } });
    await page.goto(APP_URL);
    await waitForImage(page, 400, 300);
    await touchPath(page, [[600, 10], [650, 10], [700, 10]]); // a swipe: no click follows it
    await expect(page.locator("body")).toHaveClass(/\bbarPeek\b/);
    await page.click("#rotateRightBtn"); // the mouse, at once
    await page.waitForFunction(() => window.__mockLog.rotations.length === 1);
  });

  test("focus mode entered by a tap hides the bar after 3 s", async ({ page }) => {
    await installTauriMock(page, { initialFile: A, files: { [A]: { width: 400, height: 300, rgba: SOLID } } });
    await page.goto(APP_URL);
    await waitForImage(page, 400, 300);
    await page.keyboard.press("Escape"); // leave focus mode: the bar is plainly visible
    const bb = await page.locator("#focusToggleBtn").boundingBox();
    await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await expect(page.locator("body")).toHaveClass(/\bfocusMode\b/);
    await expect(page.locator("#bar")).toHaveCSS("opacity", "0", { timeout: 4500 });
  });

  test("a tap on the open help is never swallowed", async ({ page }) => {
    await installTauriMock(page, { initialFile: A, files: { [A]: { width: 400, height: 300, rgba: SOLID } } });
    await page.goto(APP_URL);
    await waitForImage(page, 400, 300); // focus mode, bar hidden
    await page.keyboard.press("?");
    await expect(page.locator("#help")).toHaveClass(/\bopen\b/);
    await page.touchscreen.tap(20, 10); // the dark backdrop, inside the top strip
    await expect(page.locator("#help")).not.toHaveClass(/\bopen\b/);
    expect(await page.evaluate(() => document.body.classList.contains("barPeek"))).toBe(false);
  });
});

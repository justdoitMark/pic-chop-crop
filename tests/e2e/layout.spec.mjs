// Layout across window sizes: every CSS viewport here is a maximized window on
// a real monitor at some Windows display scale (or a small unmaximized window).
// Nothing may leave the window, popovers must not cover the Save pill, and the
// crop frame's dimension labels must stay on screen.
import { test, expect } from "@playwright/test";
import { APP_URL, installTauriMock, waitForImage } from "./helpers.mjs";

const A = "C:\\pics\\a.png";

const SIZES = [
  { name: "1920x1080 @100%", width: 1920, height: 1000 },
  { name: "1920x1080 @150% / 2560x1440 @200%", width: 1280, height: 640 },
  { name: "1366x768 @125%", width: 1092, height: 534 },
  { name: "2560x1440 @200% + browser zoom", width: 924, height: 480 },
  { name: "small window", width: 720, height: 480 },
  { name: "tiny window", width: 480, height: 360 },
  { name: "very tiny window", width: 320, height: 240 },
];

// Returns human-readable layout violations for the current page state.
function audit() {
  const out = [];
  const W = innerWidth, H = innerHeight, T = 1;
  const R = (el) => el.getBoundingClientRect();
  // offsetParent is always null for position:fixed (the pill), so it can't tell hidden from shown
  const shown = (el) => el && el.checkVisibility() && R(el).width > 0;
  const inside = (el, tag) => {
    const r = R(el);
    if (r.left < -T || r.top < -T || r.right > W + T || r.bottom > H + T)
      out.push(`${tag} outside window [${r.left | 0},${r.top | 0} → ${r.right | 0},${r.bottom | 0}] in ${W}x${H}`);
  };
  const overlap = (a, b) => {
    const x = R(a), y = R(b);
    return x.left < y.right - T && y.left < x.right - T && x.top < y.bottom - T && y.top < x.bottom - T;
  };
  if (document.documentElement.scrollWidth > W + T || document.documentElement.scrollHeight > H + T) out.push("page scrolls");
  const pill = document.getElementById("pill");
  if (shown(pill)) {
    inside(pill, "pill");
    if (pill.scrollWidth > pill.clientWidth + T) out.push("pill content overflows");
  }
  document.querySelectorAll(".pop.open").forEach((p) => {
    inside(p, p.id);
    if (overlap(p, pill)) out.push(`${p.id} covers the pill`);
  });
  document.querySelectorAll(".dim").forEach((d) => {
    if (shown(d)) inside(d.querySelector(".lbl"), `${d.id} label`);
  });
  const bar = document.getElementById("bar");
  const groups = [bar.querySelector(".meta"), document.getElementById("navRow"), bar.querySelector(".tools")].filter(shown);
  for (let i = 0; i < groups.length; i++)
    for (let j = i + 1; j < groups.length; j++)
      if (overlap(groups[i], groups[j])) out.push("status bar items overlap");
  // the file name may be cut short, but never squeezed to nothing
  const fileName = document.getElementById("fileName");
  if (fileName.checkVisibility() && R(fileName).width === 0) out.push("file name has no room");
  return out;
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    // reducedMotion switches off the popover's slide-in, so geometry is measured
    // at rest rather than mid-animation (6 px of slide hid real overflow).
    test.use({ viewport: { width: size.width, height: size.height }, reducedMotion: "reduce" });

    test.beforeEach(async ({ page }) => {
      await installTauriMock(page, {
        initialFile: A, siblings: [A, "C:\\pics\\b.png"],
        files: { [A]: { width: 1600, height: 1000 } },
      });
      await page.goto(APP_URL);
      await waitForImage(page, 1600, 1000);
      await page.keyboard.press("Escape");
    });

    test("main view fits", async ({ page }) => {
      expect(await page.evaluate(audit)).toEqual([]);
    });

    test("ratio popover fits above the pill", async ({ page }) => {
      await page.click("#ratioBtn");
      expect(await page.evaluate(audit)).toEqual([]);
    });

    test("format popover still fits after it grows (JPEG quality)", async ({ page }) => {
      await page.click("#fmtBtn");
      await page.click('.fmt[data-fmt="jpeg"]');
      await page.waitForTimeout(50);
      expect(await page.evaluate(audit)).toEqual([]);
    });

    test("tilt ruler fits under the bar", async ({ page }) => {
      await page.click("#tiltBtn");
      expect(await page.evaluate(audit)).toEqual([]);
    });

    test("dimension labels stay on screen at 100 % zoom", async ({ page }) => {
      await page.keyboard.press("1");
      expect(await page.evaluate(audit)).toEqual([]);
    });

    test("help fits", async ({ page }) => {
      await page.keyboard.press("?");
      const r = await page.locator("#help .card").boundingBox();
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.y + r.height).toBeLessThanOrEqual(size.height + 1);
    });
  });
}

// A window so short that the ruler's natural height does not fit between the
// bar and the pill: the ruler gets shorter (and scrolls) instead of covering it.
test.describe("short window 480x190", () => {
  test.use({ viewport: { width: 480, height: 190 }, reducedMotion: "reduce" });

  test("tilt ruler never covers the pill", async ({ page }) => {
    await installTauriMock(page, { initialFile: A, files: { [A]: { width: 1600, height: 1000 } } });
    await page.goto(APP_URL);
    await waitForImage(page, 1600, 1000);
    await page.keyboard.press("Escape");
    await page.click("#tiltBtn");
    expect(await page.evaluate(audit)).toEqual([]);
  });
});

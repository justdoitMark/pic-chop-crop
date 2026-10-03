// Pure geometry behind rotation and tilt (frontend/geometry.js), run in Node.
import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";

const G = createRequire(import.meta.url)("../../frontend/geometry.js");

// Small seeded PRNG (mulberry32) so failures reproduce.
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rect = (deg) => ({ cx: 300, cy: 250, w: 400, h: 300, deg });

test("quarter turns are exact", () => {
  expect(G.cosSin(90)).toEqual({ c: 0, s: 1 });
  expect(G.cosSin(-90)).toEqual({ c: 0, s: -1 });
  expect(G.orientedSize(400, 300, 1)).toEqual({ w: 300, h: 400 });
  expect(G.orientedSize(400, 300, 2)).toEqual({ w: 400, h: 300 });
  expect(G.boundingSize(400, 300, 90)).toEqual({ w: 300, h: 400 });
  const b = G.boundingSize(100, 100, 45);
  expect(b.w).toBeCloseTo(141.421, 2);
  expect(b.h).toBeCloseTo(141.421, 2);
});

test("at 0° the frame is clamped to the image edges exactly as before", () => {
  const r = { cx: 200, cy: 150, w: 400, h: 300, deg: 0 };
  expect(G.clampBoxCenter({ x: -50, y: 280, w: 100, h: 50 }, r)).toEqual({ x: 0, y: 250, w: 100, h: 50 });
  expect(G.maxBoxSize(16 / 9, r)).toEqual({ w: 400, h: 225 });
  expect(G.maxWidthFromAnchor(100, 100, 1, 1, 1, r)).toBeCloseTo(200, 6); // right edge at 400, bottom at 300
});

for (const deg of [10, 30, 45, -20]) {
  test(`at ${deg}° clamped frames are always inside and inside frames stay put`, () => {
    const r = rect(deg), next = rng(deg + 100);
    for (let i = 0; i < 1000; i++) {
      const aspect = 0.3 + next() * 3;
      const max = G.maxBoxSize(aspect, r);
      const k = 0.05 + next() * 0.95;
      const box = { x: next() * 800 - 200, y: next() * 700 - 200, w: max.w * k, h: max.h * k };
      const c = G.clampBoxCenter(box, r);
      expect(G.isBoxInside(c, r)).toBe(true);
      const again = G.clampBoxCenter(c, r);
      expect(again.x).toBeCloseTo(c.x, 9);
      expect(again.y).toBeCloseTo(c.y, 9);
    }
  });
}

test("maxBoxSize is the largest frame that fits", () => {
  for (const deg of [0, 10, 45]) {
    const r = rect(deg), m = G.maxBoxSize(16 / 9, r);
    const centred = (k) => ({ x: r.cx - (m.w * k) / 2, y: r.cy - (m.h * k) / 2, w: m.w * k, h: m.h * k });
    expect(G.isBoxInside(centred(1), r)).toBe(true);
    expect(G.isBoxInside(centred(1.01), r)).toBe(false);
  }
});

test("maxWidthFromAnchor stops at the tilted edge for every corner", () => {
  const r = rect(20);
  for (const [gx, gy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const w = G.maxWidthFromAnchor(r.cx, r.cy, gx, gy, 1.5, r);
    const box = (w) => ({ x: gx > 0 ? r.cx : r.cx - w, y: gy > 0 ? r.cy : r.cy - w / 1.5, w, h: w / 1.5 });
    expect(w).toBeGreaterThan(10);
    expect(G.isBoxInside(box(w), r)).toBe(true);
    expect(G.isBoxInside(box(w + 0.5), r)).toBe(false);
  }
  expect(G.maxWidthFromAnchor(0, 0, 1, 1, 1, r)).toBe(0); // anchor outside the image
});

test("maxWidthFromAnchor tolerates float noise at an anchor sitting on the tilted edge", () => {
  const r = rect(20), t = G.cosSin(20);
  const u = r.w / 2 + 1e-12, v = 0; // on the right edge, nudged outward by float noise
  const ax = r.cx + u * t.c - v * t.s, ay = r.cy + u * t.s + v * t.c;
  expect(G.maxWidthFromAnchor(ax, ay, -1, -1, 1, r)).toBeGreaterThan(1);
});

test("fitInside shrinks an oversized frame around its centre, then clamps it", () => {
  const r = rect(30);
  const out = G.fitInside({ x: 0, y: 0, w: 800, h: 450 }, r);
  expect(G.isBoxInside(out, r)).toBe(true);
  expect(out.w / out.h).toBeCloseTo(800 / 450, 9);
  expect(out.w).toBeCloseTo(G.maxBoxSize(800 / 450, r).w, 6);
});

// Shared test helpers: tiny PNG encoder for fixtures, a fake window.__TAURI__,
// and a decoder that reads back what the app "saved".
import { deflateSync } from "node:zlib";
import { expect } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// APP_URL lets a test run point at a modified copy of the page (e.g. to check
// that a test really fails when a fix is reverted).
export const APP_URL =
  process.env.APP_URL || pathToFileURL(join(root, "frontend", "index.html")).href;

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(tag, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(tag, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/**
 * RGBA PNG of the given size. rgba is either a solid colour (default opaque
 * grey) or a function (x, y) => [r, g, b, a] for gradients and patterns.
 */
export function makePng(width, height, rgba = [128, 128, 128, 255]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const pixel = typeof rgba === "function" ? rgba : () => rgba;
  const rows = Array.from({ length: height }, (_, y) => {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x++) row.set(pixel(x, y), 1 + x * 4);
    return row;
  });
  const raw = Buffer.concat(rows);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Width/height straight from a PNG's IHDR chunk. */
export function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export const RED = [220, 40, 40, 255];
export const GREEN = [40, 200, 60, 255];
export const BLUE = [40, 80, 220, 255];
export const YELLOW = [230, 210, 40, 255];

/** Four solid quadrants: red top-left, green top-right, blue bottom-left, yellow bottom-right. */
export const QUADRANTS = (w, h) => (x, y) =>
  y < h / 2 ? (x < w / 2 ? RED : GREEN) : x < w / 2 ? BLUE : YELLOW;

/** The same picture turned clockwise quarterTurns times: new (x, y) shows old (y, h-1-x). */
export function rotatePixels(width, height, rgba = [128, 128, 128, 255], quarterTurns = 0) {
  let w = width, h = height;
  let at = typeof rgba === "function" ? rgba : () => rgba;
  for (let i = 0; i < ((quarterTurns % 4) + 4) % 4; i++) {
    const prev = at, ph = h;
    at = (x, y) => prev(y, ph - 1 - x);
    [w, h] = [h, w];
  }
  return { width: w, height: h, rgba: at };
}

/** RGBA at each [fx, fy] point (fractions of the size) of an encoded image. */
export async function pixelsInPage(page, base64, mime, points) {
  return page.evaluate(async ({ base64, mime, points }) => {
    const img = new Image();
    img.src = `data:${mime};base64,${base64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return points.map(([fx, fy]) => {
      const x = Math.min(c.width - 1, Math.floor(fx * c.width));
      const y = Math.min(c.height - 1, Math.floor(fy * c.height));
      return Array.from(ctx.getImageData(x, y, 1, 1).data);
    });
  }, { base64, mime, points });
}

/**
 * Saves the current crop as PNG (optionally setting W×H first) and returns
 * the RGBA at each point. The pill must be visible (not in focus mode).
 */
export async function exportPixels(page, points, size) {
  if (size) {
    await page.fill("#inputW", String(size.w));
    await page.fill("#inputH", String(size.h));
    await page.locator("#inputH").blur();
  }
  const n = await page.evaluate(() => window.__mockLog.writes.length);
  await page.click("#downloadBtn");
  await page.waitForFunction((n) => window.__mockLog.writes.length > n, n);
  const { dataBase64 } = await page.evaluate(() => window.__mockLog.writes.at(-1));
  return pixelsInPage(page, dataBase64, "image/png", points);
}

export function expectColors(actual, expected, tolerance = 8) {
  actual.forEach((px, i) => {
    px.forEach((v, ch) => {
      expect(Math.abs(v - expected[i][ch]), `point ${i} channel ${ch}: got ${px}, want ${expected[i]}`).toBeLessThanOrEqual(tolerance);
    });
  });
}

/**
 * Adds an EXIF block with this Orientation right after SOI and JFIF, with the
 * same byte layout as the Rust side (exif::insert_app1).
 */
export function withOrientation(jpeg, value) {
  let at = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + jpeg.readUInt16BE(4);
  const tiff = Buffer.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, value, 0, 0, 0, 0, 0, 0, 0]);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(payload.length + 2);
  return Buffer.concat([jpeg.subarray(0, at), Buffer.from([0xff, 0xe1]), len, payload, jpeg.subarray(at)]);
}

/**
 * Installs a fake window.__TAURI__ before the page's own script runs.
 *
 * files:    { [path]: { width, height, rgba?, delayMs? } }  — what read_file_bytes serves
 *           (rgba may be a function, see makePng; raw: Buffer serves exact bytes)
 * initialFile / siblings: what get_initial_file / list_siblings return
 * saveResult: path the "Save As" dialog returns (null = user cancelled)
 * writeError: if set, write_file_bytes rejects with it
 * rotateError: if set, rotate_image rejects with it
 * openResult: path the "Open" dialog returns (default null = cancelled)
 * openDelayMs: the "Open" dialog answers only after this many ms (default 0)
 * siblingsError: if set, list_siblings rejects with it
 *
 * rotate_image keeps each file's turns in sessionStorage (it survives the
 * reload that closing the window does), and read_file_bytes then serves the
 * turned picture — like the real file after a saved turn.
 *
 * Every call is recorded in window.__mockLog for assertions.
 */
export async function installTauriMock(page, opts) {
  const files = {};
  for (const [path, f] of Object.entries(opts.files || {})) {
    // raw bytes are served as they are; generated pictures in all four turns
    const versions = f.raw
      ? [f.raw]
      : [0, 1, 2, 3].map((q) => {
          const r = rotatePixels(f.width, f.height, f.rgba, q);
          return makePng(r.width, r.height, r.rgba);
        });
    files[path] = { base64: versions.map((b) => b.toString("base64")), delayMs: f.delayMs || 0 };
  }
  const cfg = {
    files,
    initialFile: opts.initialFile ?? null,
    siblings: opts.siblings ?? [],
    saveResult: opts.saveResult === undefined ? "C:\\out\\saved" : opts.saveResult,
    writeError: opts.writeError ?? null,
    rotateError: opts.rotateError ?? null,
    openResult: opts.openResult ?? null,
    openDelayMs: opts.openDelayMs ?? 0,
    siblingsError: opts.siblingsError ?? null,
  };

  await page.addInitScript((cfg) => {
    const log = { invokes: [], resolvedReads: [], saves: [], writes: [], rotations: [], opens: [] };
    window.__mockLog = log;
    const later = (ms, fn) => new Promise((res, rej) => setTimeout(() => {
      try { res(fn()); } catch (e) { rej(e); }
    }, ms));

    const turnsOf = (path) => Number(sessionStorage.getItem("__mockTurns:" + path) || 0);

    window.__TAURI__ = {
      core: {
        invoke(cmd, args) {
          log.invokes.push({ cmd, args });
          switch (cmd) {
            case "get_initial_file":
              return Promise.resolve(cfg.initialFile);
            case "list_siblings":
              if (cfg.siblingsError) return Promise.reject(cfg.siblingsError);
              return Promise.resolve(cfg.siblings);
            case "app_ready":
              return Promise.resolve(null);
            case "read_file_bytes": {
              const f = cfg.files[args.path];
              if (!f) return Promise.reject("not found: " + args.path);
              return later(f.delayMs, () => {
                log.resolvedReads.push(args.path);
                // Like the Rust command (tauri::ipc::Response): raw bytes as an ArrayBuffer.
                const bin = atob(f.base64[turnsOf(args.path) % f.base64.length]);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                performance.mark("mock:read_file_bytes");
                return bytes.buffer;
              });
            }
            case "write_file_bytes":
              if (cfg.writeError) return Promise.reject(cfg.writeError);
              log.writes.push({ path: args.path, dataBase64: args.dataBase64 });
              return Promise.resolve(null);
            case "rotate_image": {
              log.rotations.push({ path: args.path, quarterTurns: args.quarterTurns });
              if (cfg.rotateError) return Promise.reject(cfg.rotateError);
              const t = (((turnsOf(args.path) + args.quarterTurns) % 4) + 4) % 4;
              sessionStorage.setItem("__mockTurns:" + args.path, String(t));
              return Promise.resolve(null);
            }
            default:
              return Promise.reject("unknown command " + cmd);
          }
        },
      },
      dialog: {
        save(options) {
          log.saves.push(options);
          return Promise.resolve(cfg.saveResult);
        },
        open(options) {
          log.opens.push(options);
          return later(cfg.openDelayMs, () => cfg.openResult);
        },
      },
    };
  }, cfg);
}

/** Decodes an exported base64 image inside the page: size + centre pixel. */
export async function decodeInPage(page, base64, mime) {
  return page.evaluate(async ({ base64, mime }) => {
    const img = new Image();
    img.src = `data:${mime};base64,${base64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(c.width >> 1, c.height >> 1, 1, 1).data;
    return { width: c.width, height: c.height, center: Array.from(px) };
  }, { base64, mime });
}

/** Waits until the on-screen image has the given natural size. */
export async function waitForImage(page, width, height) {
  await page.waitForFunction(
    ([w, h]) => {
      const img = document.getElementById("img");
      return img.naturalWidth === w && img.naturalHeight === h;
    },
    [width, height],
  );
}

export async function boxRect(page) {
  return page.evaluate(() => {
    const s = document.getElementById("cropBox").style;
    return { x: parseFloat(s.left), y: parseFloat(s.top), w: parseFloat(s.width), h: parseFloat(s.height) };
  });
}

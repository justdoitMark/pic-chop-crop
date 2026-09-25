// Shared test helpers: tiny PNG encoder for fixtures, a fake window.__TAURI__,
// and a decoder that reads back what the app "saved".
import { deflateSync } from "node:zlib";
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

/**
 * Installs a fake window.__TAURI__ before the page's own script runs.
 *
 * files:    { [path]: { width, height, rgba?, delayMs? } }  — what read_file_bytes serves
 *           (rgba may be a function, see makePng; raw: Buffer serves exact bytes)
 * initialFile / siblings: what get_initial_file / list_siblings return
 * saveResult: path the "Save As" dialog returns (null = user cancelled)
 * writeError: if set, write_file_bytes rejects with it
 *
 * Every call is recorded in window.__mockLog for assertions.
 */
export async function installTauriMock(page, opts) {
  const files = {};
  for (const [path, f] of Object.entries(opts.files || {})) {
    files[path] = {
      base64: (f.raw || makePng(f.width, f.height, f.rgba)).toString("base64"),
      mime: "image/png",
      delayMs: f.delayMs || 0,
    };
  }
  const cfg = {
    files,
    initialFile: opts.initialFile ?? null,
    siblings: opts.siblings ?? [],
    saveResult: opts.saveResult === undefined ? "C:\\out\\saved" : opts.saveResult,
    writeError: opts.writeError ?? null,
  };

  await page.addInitScript((cfg) => {
    const log = { invokes: [], resolvedReads: [], saves: [], writes: [] };
    window.__mockLog = log;
    const later = (ms, fn) => new Promise((res, rej) => setTimeout(() => {
      try { res(fn()); } catch (e) { rej(e); }
    }, ms));

    window.__TAURI__ = {
      core: {
        invoke(cmd, args) {
          log.invokes.push({ cmd, args });
          switch (cmd) {
            case "get_initial_file":
              return Promise.resolve(cfg.initialFile);
            case "list_siblings":
              return Promise.resolve(cfg.siblings);
            case "read_file_bytes": {
              const f = cfg.files[args.path];
              if (!f) return Promise.reject("not found: " + args.path);
              return later(f.delayMs, () => {
                log.resolvedReads.push(args.path);
                return { base64: f.base64, mime: f.mime };
              });
            }
            case "write_file_bytes":
              if (cfg.writeError) return Promise.reject(cfg.writeError);
              log.writes.push({ path: args.path, dataBase64: args.dataBase64 });
              return Promise.resolve(null);
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

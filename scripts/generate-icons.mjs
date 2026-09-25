// Generates the placeholder app icons (navy background, cyan corner
// brackets) as real PNG/ICO files. Runs in CI right before the Tauri build,
// so no binary icon data has to be committed to the repo at all — just this
// script. Swap for `npx tauri icon <your-image.png>` any time you want a
// hand-made icon instead; this only exists so a fresh checkout can build.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "src-tauri", "icons");
mkdirSync(outDir, { recursive: true });

const VOID = [10, 18, 32];
const CYAN = [79, 216, 232];

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(tag, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const tagBuf = Buffer.from(tag, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([tagBuf, data])), 0);
  return Buffer.concat([len, tagBuf, data, crcBuf]);
}

function nearCornerBracket(x, y, w, h, margin, bracket, arm) {
  const corners = [
    [margin, margin, 1, 1],
    [w - 1 - margin, margin, -1, 1],
    [margin, h - 1 - margin, 1, -1],
    [w - 1 - margin, h - 1 - margin, -1, -1],
  ];
  for (const [ccx, ccy, sx, sy] of corners) {
    const horiz = Math.abs(y - ccy) <= bracket && sx * (x - ccx) >= 0 && sx * (x - ccx) <= arm;
    const vert = Math.abs(x - ccx) <= bracket && sy * (y - ccy) >= 0 && sy * (y - ccy) <= arm;
    if (horiz || vert) return true;
  }
  return false;
}

function makePng(size) {
  const margin = Math.max(2, Math.floor(size / 8));
  const bracket = Math.max(1, Math.floor(size / 12));
  const arm = Math.max(2, Math.floor(size / 3));

  const raw = Buffer.alloc((size * 4 + 1) * size);
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const on = nearCornerBracket(x, y, size, size, margin, bracket, arm);
      const [r, g, b] = on ? CYAN : VOID;
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
      raw[offset++] = 255;
    }
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

function makeIco(entries) {
  // entries: [{ size, png }]
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  let offset = 6 + 16 * count;
  const dirEntries = [];
  const blobs = [];
  for (const { size, png } of entries) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0;
    e[3] = 0;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    dirEntries.push(e);
    blobs.push(png);
    offset += png.length;
  }
  return Buffer.concat([header, ...dirEntries, ...blobs]);
}

const png32 = makePng(32);
const png128 = makePng(128);
const png256 = makePng(256);

writeFileSync(join(outDir, "32x32.png"), png32);
writeFileSync(join(outDir, "128x128.png"), png128);
writeFileSync(join(outDir, "128x128@2x.png"), png256);
writeFileSync(join(outDir, "icon.ico"), makeIco([{ size: 32, png: png32 }, { size: 256, png: png256 }]));

console.log("Generated icons in", outDir);

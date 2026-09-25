// Checks that the release tag matches the app version in all three places it
// is duplicated (package.json, Cargo.toml, tauri.conf.json). Without this a
// tag like v1.3.0 happily ships an installer that is still built as 1.2.0.
//
//   node scripts/check-version.mjs v1.2.0
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const tag = process.argv[2];
if (!tag) {
  console.error("usage: node scripts/check-version.mjs <tag>");
  process.exit(1);
}
const expected = tag.replace(/^v/, "");

const cargoMatch = read("src-tauri/Cargo.toml").match(/^version\s*=\s*"([^"]+)"/m);
const versions = {
  "package.json": JSON.parse(read("package.json")).version,
  "src-tauri/Cargo.toml": cargoMatch ? cargoMatch[1] : "(not found)",
  "src-tauri/tauri.conf.json": JSON.parse(read("src-tauri/tauri.conf.json")).version,
};

const mismatched = Object.entries(versions).filter(([, v]) => v !== expected);
if (mismatched.length > 0) {
  console.error(`Tag ${tag} expects version ${expected}, but:`);
  for (const [file, v] of mismatched) console.error(`  ${file}: ${v}`);
  process.exit(1);
}
console.log(`Version ${expected} matches in all files.`);

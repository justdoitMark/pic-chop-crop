// Regenerates src-tauri/icons/ from the source image src-tauri/app-icon.png.
// The generated icons are committed, so run this only after replacing
// app-icon.png. `tauri icon` also writes Android/iOS/macOS/Store variants;
// the app doesn't use them and .gitignore keeps them out of the repo.
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join("src-tauri", "app-icon.png");
const out = join("src-tauri", "icons");

execSync(`npx tauri icon "${src}" -o "${out}"`, { cwd: root, stdio: "inherit" });
console.log("Generated icons in", join(root, out));

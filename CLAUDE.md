# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Pic Chop Crop (formerly Exact Crop) is a Windows desktop image cropper built on Tauri v2. It crops an image to an exact W×H and exports exactly that size. The frontend is a single hand-written HTML file with no bundler and no framework. The Rust side is a thin shell around it. README.md is in Russian and is the user-facing doc. It covers features, hotkeys, uninstall steps and troubleshooting.

## Commands

```powershell
npm install
node scripts/generate-icons.mjs   # only after replacing src-tauri/app-icon.png; regenerates the committed src-tauri/icons/
npm run tauri dev                 # live run
npm run tauri build               # NSIS installer -> src-tauri/target/release/bundle/nsis/
```

### Tests

```powershell
npm test                                         # Playwright E2E, ~10 s, no GUI needed
npx playwright test -g "JPEG"                    # single test by name
cargo test --manifest-path src-tauri/Cargo.toml  # Rust unit tests
```

- **E2E** (`tests/e2e/`): opens `frontend/index.html` from disk in headless Edge. Edge uses the same Chromium engine as WebView2, so no browser download is needed; install with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`.
  - `desktop.spec.mjs` fakes `window.__TAURI__` with `installTauriMock` from `helpers.mjs`. The fake serves generated PNG fixtures, supports per-file `delayMs` for race tests, and records every call in `window.__mockLog`.
  - `browser.spec.mjs` covers the no-Tauri fallback.
  - `perf.spec.mjs` guards the "Open with" launch: no start-screen flash before the image (`html.booting`), and a ~2 MB PNG on screen within 400 ms of its bytes arriving. It can't measure WebView2 start-up or real IPC.
  - `layout.spec.mjs` checks that nothing leaves the window (popovers, pill, dimension labels) at viewports matching common monitor × Windows-scale combinations, down to a 320×240 window (the window has no minimum size).
  - Set `APP_URL` to run the suite against a modified copy of the page, e.g. to confirm a test fails when a fix is reverted.
- **Rust** (`#[cfg(test)] mod tests` in `main.rs`): calls the commands directly as plain functions, using real temp dirs.
- **CI**: `.github/workflows/test.yml` runs both suites on every push and PR.
- There is no linter and no JS build step.

Prereqs: Rust ≥ 1.77 via rustup, VS Build Tools with "Desktop development with C++", and Node.

## Architecture

- **`frontend/index.html`** (~1250 lines) holds the whole UI: CSS, markup and one inline `<script>` in ES5 style (`var`, `function`). Layout: full-window canvas, a top status bar, and a floating bottom "pill" (ratio popover, W×H inputs, format popover, Save). That script does all the image work on a `<canvas>`: crop box, dimension lines, zoom/pan, presets, focus mode and export resampling. Files open in focus mode; leaving it shows the crop frame. The same code also runs as a plain web page. `window.__TAURI__` (enabled by `withGlobalTauri`) is feature-detected (`var tauri = window.__TAURI__ || null`), and every desktop-only path falls back to browser behavior. Keep that dual-mode contract when you edit.
- **`src-tauri/src/main.rs`** exposes exactly four commands, called via `tauri.core.invoke`:
  - `get_initial_file`: returns `argv[1]`, which Windows passes on an "Open with" launch.
  - `read_file_bytes`: returns the raw bytes (`tauri::ipc::Response`, an ArrayBuffer in JS; no base64/JSON, which cost ~1.4 s on a 2 MB PNG). Only jpg/jpeg/png are allowed; the frontend derives the MIME type from the extension.
  - `list_siblings`: lists the jpg/png files in the same folder, natural-sorted to match Explorer order. Prev/Next navigation uses it.
  - `write_file_bytes`: base64 → disk. The save path comes from the `tauri-plugin-dialog` save dialog.
  
  A new command must be registered in `generate_handler!`. If it needs plugin APIs, check `src-tauri/capabilities/default.json` (currently `core:default` + `dialog:default`).
- **`tauri.conf.json`**:
  - `dragDropEnabled: false` is required. Without it, Tauri swallows file drops natively and the page's `drop` event never fires.
  - `csp: null`.
  - `frontendDist` points straight at `../frontend`, and there is no dev server.
  - File associations for jpg/jpeg/png are set here.
- Prev/Next and open-from-file only work when the exe is launched with a file path argument. They can't be exercised through plain `tauri dev`.

## Releases and versioning

- `.github/workflows/release.yml` builds on `windows-latest` with `tauri-action`. It runs on a `v*.*.*` tag push or on a manual `workflow_dispatch` with a version input. The app icons are committed in `src-tauri/icons/` (source: `src-tauri/app-icon.png`), so CI doesn't generate them.
- The version is duplicated in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, so bump all three together.
- The Tauri `identifier` is `com.picchopcrop.desktop` (it was `com.markbelov.exactcrop` before the rename). Changing it makes Windows treat the build as a different app: an old install is not upgraded and has to be uninstalled separately.

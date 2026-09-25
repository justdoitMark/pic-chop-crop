import { defineConfig } from "@playwright/test";

// The frontend is a single static page that also runs without Tauri, so the
// tests open it straight from disk in Edge (same Chromium engine as the
// WebView2 the desktop app uses) and fake window.__TAURI__ where needed.
// No browser download needed: Edge ships with Windows and GitHub runners.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 15_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    channel: "msedge",
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
});

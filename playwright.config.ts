import { defineConfig, devices } from "@playwright/test";

/**
 * Two lanes, split by whether a test needs the 23 MB model.
 *
 * The fast lane is everything the page does before any model exists: loading skills,
 * reporting lint findings, and failing legibly. It runs in seconds on every push.
 *
 * The model lane is tagged @model and downloads the real thing. It is slow, but it is the
 * only lane that can catch a broken backend: the WebGPU load path failed for weeks while
 * every unit test stayed green, because nothing ever asked a browser to run it.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Bind the host explicitly. Vite defaults to "localhost", which resolves to ::1 on some
    // machines, and then the 127.0.0.1 health check below waits out its whole timeout
    // against a server that is up and listening somewhere else.
    command: "npm run dev -- --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Vitest would otherwise collect e2e/*.spec.ts, which uses Playwright's runner and
  // fails to load. A red file beside green ones trains you to skim the summary.
  test: { include: ["src/**/*.test.ts"] },
  // Served from a repo subpath on GitHub Pages, so asset URLs must be relative.
  base: "./",
  plugins: [react()],
});

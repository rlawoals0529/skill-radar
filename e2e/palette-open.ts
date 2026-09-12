// Vendored from yozora/js/palette-open.ts. Refresh with `node scripts/vendor.mjs` there,
// never edit here.
import type { Page } from "@playwright/test";

/**
 * Get the palette options on screen.
 *
 * The seam between the picker's own tests and the page they run on. Most apps put the picker
 * at the bottom of the work behind its own disclosure, which is what this does; an app that
 * keeps it somewhere else - a settings tab, a sidebar - replaces this file and the vendored
 * spec keeps working.
 *
 * Vendored ONCE: `vendor.mjs` will not overwrite a copy that already exists, because this is
 * the one file in the set a project is meant to edit.
 */
export async function openPalette(page: Page): Promise<void> {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: /^Palette:/ });
  if (await toggle.count()) await toggle.click();
  await page.getByRole("radio").first().waitFor();
}

import { expect, test } from "@playwright/test";
import { describeFailures, probeContrast } from "./contrast-probe.js";

/**
 * The palette picker, and the page it paints.
 *
 * Both tests here exist because of a bug that was on the page for months and that no unit
 * test could have seen: one about what `hidden` actually does when a class sets `display`,
 * and one about what `data-theme` scopes when it is put on the wrong element.
 */

/* The picker itself is covered by e2e/palette-picker.spec.ts, vendored with the component,
   so the same guard runs in every app that uses it rather than in this one. */

test("no text on the page is below AA contrast, in any palette", async ({ page }) => {
  await page.goto("/");
  // Open the picker, so its own fifteen options are measured too. They paint a chip in
  // another palette, which is the exact shape of mistake that puts foreign colours on a page.
  await page.getByRole("button", { name: /^Palette:/ }).click();

  const probe = await probeContrast(page);

  // A selector that stopped matching would make this pass by measuring nothing.
  expect(probe.styles).toBeGreaterThan(9);
  expect(probe.measured).toBeGreaterThan(140);

  expect(probe.failures, describeFailures(probe.failures)).toEqual([]);
});

import { expect, test } from "@playwright/test";
import { describeFailures, probeContrast } from "./contrast-probe.js";

/**
 * The palette picker, and the page it paints.
 *
 * Both tests here exist because of a bug that was on the page for months and that no unit
 * test could have seen: one about what `hidden` actually does when a class sets `display`,
 * and one about what `data-theme` scopes when it is put on the wrong element.
 */

test("the palette list is closed until asked for, not merely marked closed", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: /^Palette:/ });
  const list = page.locator("#palette-list");

  // `hidden` alone was not enough: a `display: grid` on the class beat the user agent's
  // `[hidden] { display: none }`, because author styles win over the UA sheet whatever the
  // specificity. The page was shipping fifteen visible, tabbable options under a button
  // that said aria-expanded="false".
  await expect(list).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(await page.getByRole("button", { name: "Sakura Lake" }).isVisible()).toBe(false);

  await toggle.click();
  await expect(list).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Sakura Lake" })).toBeVisible();
});

test("each palette option is legible in the palette you are actually looking at", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Palette:/ }).click();
  const option = page.getByRole("button", { name: "Sakura Lake" });

  // The chip shows another palette's accent; the LABEL must not also be painted in that
  // palette's foreground, which is what putting data-theme on the button did.
  const colours = await option.evaluate((el) => ({
    label: getComputedStyle(el).color,
    root: getComputedStyle(document.documentElement).getPropertyValue("--dim").trim(),
    chip: getComputedStyle(el.querySelector(".palette-chip")!).backgroundColor,
  }));
  const rgb = (hex: string) => {
    const n = hex.replace("#", "");
    return `rgb(${[0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)).join(", ")})`;
  };
  expect(colours.label).toBe(rgb(colours.root));
  // And the chip is still showing the other palette, or the fix traded one bug for another.
  expect(colours.chip).not.toBe(colours.label);
});

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

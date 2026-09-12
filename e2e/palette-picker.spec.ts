// Vendored from yozora/js/palette.spec.ts. Refresh with `node scripts/vendor.mjs` there,
// never edit here.
import { expect, test } from "@playwright/test";
import { openPalette } from "./palette-open.js";

/**
 * The palette picker, as a control rather than as a list of colours.
 *
 * Vendored with the picker itself, because the component is shared and a guard that lives in
 * one of the five apps using it is a guard for one of them. Everything here is behaviour the
 * component owns; nothing is about the page it happens to be on.
 */

const toggle = (page: import("@playwright/test").Page) => page.getByRole("button", { name: /^Palette:/ });

test("the list is closed until asked for, not merely marked closed", async ({ page }) => {
  await page.goto("/");
  // An app can render the picker inline, with no disclosure to check. Detected rather than
  // configured, so nothing has to be kept in step with how a given page lays itself out.
  test.skip((await toggle(page).count()) === 0, "this app shows the picker inline");
  const list = page.locator(".palette-list");

  // `hidden` alone was not enough: a `display` on the class beats the user agent's
  // `[hidden] { display: none }` whatever the specificity, so the page shipped fifteen
  // visible, tabbable options under a button that said aria-expanded="false".
  await expect(list).toBeHidden();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");

  await toggle(page).click();
  await expect(list).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
});

test("the whole group is one tab stop, and the arrows move inside it", async ({ page }) => {
  await openPalette(page);

  const options = page.getByRole("radio");
  expect(await options.count()).toBeGreaterThan(10);
  // Fifteen tab stops to get past a preference is fifteen too many. One is the standard
  // radio-group behaviour, and it is the reason the arrows have to work.
  const tabbable = await options.evaluateAll((els) => els.filter((e) => (e as HTMLElement).tabIndex === 0).length);
  expect(tabbable).toBe(1);
});

test("arrowing tries each palette on the page, and Escape puts back the one you arrived with", async ({ page }) => {
  await openPalette(page);

  const started = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  const paint = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const paintedBefore = await paint();
  await page.locator('[role="radio"][aria-checked="true"]').focus();
  await page.keyboard.press("ArrowRight");

  // Selection follows focus, which is what makes arrowing a preview rather than a survey.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme")))
    .not.toBe(started);
  await expect(page.locator('[role="radio"][aria-checked="true"]')).toBeFocused();
  // And the PAGE changed, not just the attribute. An attribute that nothing is scoped to is a
  // picker that looks like it works.
  await expect.poll(paint).not.toBe(paintedBefore);

  await page.keyboard.press("Escape");
  // Without this, sweeping through fifteen palettes to look at them leaves you on whichever
  // one you happened to stop at.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme")))
    .toBe(started);
  // A disclosure also closes and hands focus back to the thing that opened it. Inline there
  // is nothing to close, and Escape is only the undo.
  if (await toggle(page).count()) {
    await expect(page.locator(".palette-list")).toBeHidden();
    await expect(toggle(page)).toBeFocused();
  }
});

test("a chosen palette survives a reload, colour scheme and all", async ({ page }) => {
  await openPalette(page);
  await page.getByRole("radio", { name: "Sakura Lake" }).click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "sakura-lake");
  // color-scheme travels with the palette, or the browser paints scrollbars and form controls
  // for the other one.
  expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe("light");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "sakura-lake");
  // Before first paint, or the page shows one palette and swaps to another in front of you.
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
});

test("each option is a specimen of its own palette, and its name is not", async ({ page }) => {
  await openPalette(page);
  const option = page.getByRole("radio", { name: "Sakura Lake" });

  const seen = await option.evaluate((el) => ({
    swatchBg: getComputedStyle(el).backgroundColor,
    pageBg: getComputedStyle(document.body).backgroundColor,
    name: getComputedStyle(el.querySelector(".swatch-name")!).color,
    nameBg: getComputedStyle(el).backgroundColor,
  }));

  // The swatch paints itself in the palette it offers: that is the whole design, and it is
  // what makes fifteen options tellable apart without trying them one at a time.
  expect(seen.swatchBg).not.toBe(seen.pageBg);
  // And the name is painted on THAT ground rather than on the page's, which is the mistake
  // that put a foreign palette's foreground on the current background.
  expect(seen.nameBg).toBe(seen.swatchBg);
});

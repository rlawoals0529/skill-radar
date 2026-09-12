import { test, expect } from "@playwright/test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));
const skillFiles = readdirSync(FIXTURES).map((d) => join(FIXTURES, d, "SKILL.md"));

/**
 * The lane that actually loads the model.
 *
 * Everything here is slow and none of it can be faked, which is the point: the load path is
 * the part that broke, and it broke in a way no unit test could see. A mocked model would
 * re-create exactly the blind spot this suite exists to close.
 */
test.describe("@model", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(300_000);

  test("ranks on meaning rather than on shared words", async ({ page }) => {
    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles(skillFiles);
    await page.getByRole("button", { name: "Load model and embed" }).click();

    await expect(page.getByRole("tab", { name: "Routing" })).toBeVisible({ timeout: 280_000 });

    // Whichever backend it landed on, it has to say which one rather than guess from a
    // capability check, so a run on wasm cannot report itself as webgpu.
    await expect(page.getByText(/Ran on (webgpu|wasm)\./)).toBeVisible();

    await page
      .getByRole("textbox", { name: "What a user would say" })
      .fill("the PR came back with comments I need to address");
    await page.getByRole("button", { name: "Rank" }).click();

    const readings = page.locator(".reading");
    await expect(readings).toHaveCount(skillFiles.length);

    // "PR" never appears in any description and "pull request" never appears in the
    // utterance, so a string match cannot get this right. changelog-writer is the decoy:
    // it shares "changes" with the utterance and means something else entirely.
    await expect(readings.first()).toContainText("pr-review-followup");

    const scoreOf = async (name: string) =>
      Number(await readings.filter({ hasText: name }).locator("code").innerText());
    expect(await scoreOf("pr-review-followup")).toBeGreaterThan(await scoreOf("changelog-writer"));

    // Every skill on one axis: a higher score is further right, and the marks are what says
    // so. A column of bars from a shared left edge cannot show two skills landing together.
    const marks = await readings.evaluateAll((els) =>
      els.map((el) => ({
        name: el.querySelector(".reading-name")!.textContent!.trim(),
        score: Number(el.querySelector("code")!.textContent),
        x: (el.querySelector(".mark") as HTMLElement).getBoundingClientRect().left,
      })),
    );
    for (let i = 1; i < marks.length; i++) {
      if (marks[i]!.score < marks[i - 1]!.score) {
        expect(marks[i]!.x, `${marks[i]!.name} scores lower but sits further right`).toBeLessThan(marks[i - 1]!.x);
      }
    }

    // And the axis says what it is zoomed to, or a gap of 0.02 and a gap of 0.4 look alike.
    const ends = await page.locator(".axis-ends span").allTextContents();
    expect(ends).toHaveLength(2);
    expect(Number(ends[0])).toBeLessThan(Number(ends[1]));
    expect(Number(ends[0])).toBeLessThanOrEqual(Math.min(...marks.map((m) => m.score)));
    expect(Number(ends[1])).toBeGreaterThanOrEqual(Math.max(...marks.map((m) => m.score)));

    /*
     * The axis is ZOOMED, and that is the part worth checking.
     *
     * Ordering alone does not check it: marks plotted at their raw score on a fixed 0 to 1
     * axis come out in the same order, so the assertions above pass either way. What zooming
     * buys is that the scores fill the axis instead of huddling in a tenth of it, and that is
     * what to measure - the spread of the readings against the span the ends report.
     */
    const spread = Math.max(...marks.map((m) => m.score)) - Math.min(...marks.map((m) => m.score));
    const span = Number(ends[1]) - Number(ends[0]);
    expect(span).toBeGreaterThan(0);
    expect(spread / span, `the readings use ${((spread / span) * 100).toFixed(0)}% of the axis`)
      .toBeGreaterThan(0.5);
  });

  test("a contested pair lands inside a window you can see, not just a word", async ({ page }) => {
    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles(skillFiles);
    await page.getByRole("button", { name: "Load model and embed" }).click();
    await expect(page.getByRole("tab", { name: "Routing" })).toBeVisible({ timeout: 280_000 });

    // Deliberately vague: an utterance that names no skill is the one that splits the field,
    // which is the state this whole view exists to make visible.
    await page.getByRole("textbox", { name: "What a user would say" }).fill("help me with this");
    await page.getByRole("button", { name: "Rank" }).click();
    await expect(page.locator(".reading").first()).toBeVisible();

    const seen = await page.evaluate(() => {
      const readings = [...document.querySelectorAll(".reading")].map((el) => ({
        contested: el.getAttribute("data-contested") === "true",
        mark: (el.querySelector(".mark") as HTMLElement).getBoundingClientRect(),
      }));
      const window = document.querySelector(".window") as HTMLElement | null;
      const w = window?.getBoundingClientRect();
      return {
        anyContested: readings.some((r) => r.contested),
        hasWindow: window !== null,
        rows: readings.map((r) => ({
          contested: r.contested,
          // The centre of the mark, against the window it is meant to fall in or out of.
          inside: w ? r.mark.left + r.mark.width / 2 >= w.left - 1 && r.mark.left + r.mark.width / 2 <= w.right + 1 : false,
        })),
      };
    });

    /*
     * Skipped only when the DATA has nothing contested, never when the window is missing.
     *
     * The first version keyed the skip off the element, so deleting the window turned this
     * green-by-skipping - a guard that disappears along with the thing it guards.
     */
    test.skip(!seen.anyContested, "nothing was contested for this utterance, so there is nothing to see");

    expect(seen.hasWindow, "skills are contested but no window is drawn").toBe(true);
    // Every skill marked contested is inside the window, and nothing else is. The word and
    // the picture have to agree, or one of them is decoration.
    for (const r of seen.rows) expect(r.inside).toBe(r.contested);
  });

  test("counts tokens with the model's own tokenizer", async ({ page }) => {
    await page.goto("/");
    await page.locator('input[type="file"]').setInputFiles(skillFiles);
    await page.getByRole("button", { name: "Load model and embed" }).click();
    await expect(page.getByRole("tab", { name: "Cost" })).toBeVisible({ timeout: 280_000 });

    await page.getByRole("tab", { name: "Cost" }).click();

    // Scope to this panel. The lint findings render their own table, so a bare "tbody tr"
    // silently counts both and the number it reports is not about cost at all.
    const cost = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: "Context cost" }) });

    // One row per skill plus the total row.
    await expect(cost.locator("tbody tr")).toHaveCount(skillFiles.length + 1);

    const nums = await cost.locator("tbody tr td.num").allInnerTexts();
    const counts = nums.map(Number);
    const total = counts.pop() as number;

    // Real counts from a real tokenizer: every fixture description is a full sentence, so
    // none can be zero, and the table is sorted so the largest is first.
    expect(counts).toHaveLength(skillFiles.length);
    expect(Math.min(...counts)).toBeGreaterThan(0);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));

    // The footer is the sum, not a separate estimate. This is the number a reader is going
    // to quote, so it has to be arithmetic rather than a second guess at the same thing.
    expect(total).toBe(counts.reduce((n, c) => n + c, 0));
  });
});

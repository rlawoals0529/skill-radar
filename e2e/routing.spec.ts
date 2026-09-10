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

    const bars = page.locator(".bar");
    await expect(bars).toHaveCount(skillFiles.length);

    // "PR" never appears in any description and "pull request" never appears in the
    // utterance, so a string match cannot get this right. changelog-writer is the decoy:
    // it shares "changes" with the utterance and means something else entirely.
    await expect(bars.first()).toContainText("pr-review-followup");

    const scoreOf = async (name: string) =>
      Number(await bars.filter({ hasText: name }).locator("code").innerText());
    expect(await scoreOf("pr-review-followup")).toBeGreaterThan(await scoreOf("changelog-writer"));
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

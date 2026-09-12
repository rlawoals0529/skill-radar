import { test, expect } from "@playwright/test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));
const skillFiles = readdirSync(FIXTURES).map((d) => join(FIXTURES, d, "SKILL.md"));

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("says what it does and what it does not, before anything is loaded", async ({ page }) => {
  await expect(page.getByRole("heading", { name: /skill.radar/i })).toBeVisible();
  await expect(page.getByText(/nothing uploaded/)).toBeVisible();
  // The honesty panel is the point of the tool, so it is present from the first paint
  // rather than appearing only once there is a result to qualify.
  await expect(page.getByRole("heading", { name: "What this is not" })).toBeVisible();
  // Nothing downstream exists yet.
  await expect(page.getByRole("heading", { name: /Embed/ })).toBeHidden();
  await expect(page.getByRole("tab")).toHaveCount(0);
});

test("picking files loads the skills and only then offers to embed", async ({ page }) => {
  await expect(page.getByRole("heading", { name: /Embed/ })).toBeHidden();

  await page.locator('input[type="file"]').setInputFiles(skillFiles);

  await expect(page.getByText(`${skillFiles.length} skills from`)).toBeVisible();
  await expect(page.getByRole("heading", { name: /Embed/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Load model and embed" })).toBeEnabled();
  // Loading skills must not have loaded a model. The two steps are deliberately separate,
  // because 23 MB on page open is the thing the whole lazy path exists to avoid.
  await expect(page.getByRole("tab")).toHaveCount(0);
});

test("a pasted skill needs an explicit action, not a blur", async ({ page }) => {
  await page.getByText("or paste one skill").click();
  const box = page.getByRole("textbox", { name: /^$/ }).or(page.locator("textarea"));
  await expect(page.getByRole("button", { name: "Load pasted skill" })).toBeDisabled();

  await box.fill("---\nname: pasted-one\ndescription: A skill typed straight into the box.\n---\n\nBody.");
  await expect(page.getByRole("button", { name: "Load pasted skill" })).toBeEnabled();

  // Blurring is not an action. Loading on blur was invisible: nothing said it had happened,
  // and nothing happened at all if you never clicked away.
  await page.getByRole("heading", { name: /skill.radar/i }).click();
  await expect(page.getByText(/skills? from/)).toBeHidden();

  await page.getByRole("button", { name: "Load pasted skill" }).click();
  await expect(page.getByText("1 skill from")).toBeVisible();
});

test("a failed repo fetch is reported where you are looking", async ({ page }) => {
  await page.route("https://api.github.com/**", (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: '{"message":"Not Found"}' }),
  );

  await page.getByRole("button", { name: "Load public repo" }).click();

  // The error belongs in the panel you acted in. It used to render inside a results panel
  // that only exists after a successful load, so a first-time failure showed nothing at all.
  await expect(page.locator(".err")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Embed/ })).toBeHidden();
});

test("the server under test is this app, not another app on the same port", async ({ page }) => {
  await page.goto("/");
  /*
   * playwright.config.ts reuses a server that is already listening, so a port two projects
   * share means one project's running preview quietly answers the other's tests. That has
   * happened here twice, and once it produced a completely green run against the wrong page.
   * Ports are unique now; this is what catches the next way it goes wrong.
   */
  await expect(page).toHaveTitle(/^skill-radar/);
});

import { expect, test } from "@playwright/test";
import { gotoApp, openMenuCommand, resetStorageBeforeNavigation } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

test("settings modal opens and category navigation works", async ({ page }) => {
  await gotoApp(page);
  await openMenuCommand(page, "file", "file.open-settings");

  await expect(page.getByTestId("settings-modal")).toBeVisible();
  await expect(page.getByTestId("settings-category-general")).toBeVisible();
  await expect(page.getByTestId("settings-category-editor")).toBeVisible();
  await expect(page.getByTestId("settings-category-canvas")).toBeVisible();

  await page.getByTestId("settings-category-editor").click();
  await expect(page.locator("#setting-word-wrap")).toBeVisible();

  await page.getByTestId("settings-category-canvas").click();
  await expect(page.locator("#setting-grid-size")).toBeVisible();

  await page.getByTestId("settings-modal").getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("settings-modal")).toHaveCount(0);
});

test("settings persist across reload and formatter line length is clamped", async ({ page }) => {
  await gotoApp(page);
  await openMenuCommand(page, "file", "file.open-settings");

  await page.selectOption("#setting-ui-font-size", "14");
  await page.selectOption("#setting-color-scheme", "dark");
  await page.getByTestId("settings-category-editor").click();
  await page.click("#setting-word-wrap");
  await page.selectOption("#setting-font-size", "16");

  await page.fill("#setting-formatter-max-line-length", "999");
  await page.locator("#setting-formatter-max-line-length").blur();
  await expect(page.locator("#setting-formatter-max-line-length")).toHaveValue("240");

  await page.getByTestId("settings-category-canvas").click();
  await page.selectOption("#setting-grid-size", "coarse");
  await page.selectOption("#setting-handle-size", "11");

  await page.getByTestId("settings-modal").getByRole("button", { name: "Close" }).click();
  await page.reload();

  await openMenuCommand(page, "file", "file.open-settings");
  await expect(page.locator("#setting-ui-font-size")).toHaveValue("14");
  await expect(page.locator("#setting-color-scheme")).toHaveValue("dark");
  await page.getByTestId("settings-category-editor").click();
  await expect(page.locator("#setting-word-wrap")).toBeChecked();
  await expect(page.locator("#setting-font-size")).toHaveValue("16");
  await expect(page.locator("#setting-formatter-max-line-length")).toHaveValue("240");

  await page.getByTestId("settings-category-canvas").click();
  await expect(page.locator("#setting-grid-size")).toHaveValue("coarse");
  await expect(page.locator("#setting-handle-size")).toHaveValue("11");
});

test("settings reset buttons restore defaults for the active page only", async ({ page }) => {
  await gotoApp(page);
  await openMenuCommand(page, "file", "file.open-settings");

  await page.selectOption("#setting-ui-font-size", "14");
  await page.selectOption("#setting-color-scheme", "dark");
  await page.getByTestId("settings-category-editor").click();
  await page.click("#setting-word-wrap");
  await page.selectOption("#setting-font-size", "16");
  await page.getByTestId("settings-category-canvas").click();
  await page.selectOption("#setting-grid-size", "coarse");
  await page.selectOption("#setting-handle-size", "11");

  await page.getByTestId("settings-reset-canvas").click();
  await expect(page.locator("#setting-grid-size")).toHaveValue("standard");
  await expect(page.locator("#setting-handle-size")).toHaveValue("9");

  await page.getByTestId("settings-category-editor").click();
  await expect(page.locator("#setting-word-wrap")).toBeChecked();
  await expect(page.locator("#setting-font-size")).toHaveValue("16");
  await page.getByTestId("settings-reset-editor").click();
  await expect(page.locator("#setting-word-wrap")).not.toBeChecked();
  await expect(page.locator("#setting-font-size")).toHaveValue("12");

  await page.getByTestId("settings-category-general").click();
  await expect(page.locator("#setting-ui-font-size")).toHaveValue("14");
  await expect(page.locator("#setting-color-scheme")).toHaveValue("dark");
  await page.getByTestId("settings-reset-general").click();
  await expect(page.locator("#setting-ui-font-size")).toHaveValue("11");
  await expect(page.locator("#setting-color-scheme")).toHaveValue("system");
});

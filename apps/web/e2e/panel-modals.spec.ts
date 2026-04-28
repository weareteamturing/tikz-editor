import { expect, test } from "@playwright/test";
import {
  gotoApp,
  openMenuCommand,
  resetStorageBeforeNavigation,
  selectAllSceneElements,
  setSource
} from "./helpers";

const SAMPLE_SOURCE = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
  \node[draw] at (2,0) {B};
\end{tikzpicture}`;

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
});

test("panel modal closes on Escape even when focus is outside the panel", async ({ page }) => {
  await openMenuCommand(page, "insert", "insert.equation");
  await expect(page.getByTestId("equation-modal")).toBeVisible();

  await page.getByTestId("menu-section-file").focus();
  await expect(page.getByTestId("menu-section-file")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("equation-modal")).toHaveCount(0);
});

test("repeat panel closes on outside click without activating background UI", async ({ page }) => {
  await setSource(page, SAMPLE_SOURCE);
  await selectAllSceneElements(page);
  await openMenuCommand(page, "edit", "edit.repeat");
  await expect(page.getByTestId("repeat-modal")).toBeVisible();

  const fileMenuTrigger = page.getByTestId("menu-section-file");
  await expect(fileMenuTrigger).toHaveAttribute("aria-expanded", "false");

  const triggerBox = await fileMenuTrigger.boundingBox();
  if (!triggerBox) {
    throw new Error("Expected File menu trigger bounds.");
  }
  await page.mouse.click(triggerBox.x + triggerBox.width / 2, triggerBox.y + triggerBox.height / 2);

  await expect(page.getByTestId("repeat-modal")).toHaveCount(0);
  await expect(fileMenuTrigger).toHaveAttribute("aria-expanded", "false");
});

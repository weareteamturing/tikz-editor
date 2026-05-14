import { expect, test } from "@playwright/test";
import {
  clickTextHitRegionByTargetId,
  gotoApp,
  readSelectedSourceIds,
  readSource,
  resetStorageBeforeNavigation,
  selectFirstCanvasElement,
  setSource,
  waitForHitRegions
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

test("node stroke color inspector writes draw option", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \node at (0,3) {node};
\end{tikzpicture}`);
  await waitForHitRegions(page, 1);

  await clickTextHitRegionByTargetId(page, "path:0");
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["path:0"]);

  const strokeSection = page.getByText("Stroke", { exact: true }).first();
  await expect(strokeSection).toBeVisible();
  await strokeSection.locator("xpath=following::button[@aria-label='Color'][1]").click();
  await page.getByRole("button", { name: "Color red" }).click();

  await expect.poll(async () => readSource(page)).toBe(String.raw`\begin{tikzpicture}
  \node[draw=red] at (0,3) {node};
\end{tikzpicture}`);
  await expect(page.getByText(/fallback \(/)).toHaveCount(0);
});

test("preview dropdown mouseout keeps dropdown open", async ({ page }) => {
  const source = String.raw`\begin{tikzpicture}
  \draw[thin] (0,0) rectangle (2,1);
\end{tikzpicture}`;

  await gotoApp(page);
  await setSource(page, source);
  await selectFirstCanvasElement(page);

  const lineWidthDropdown = page.getByRole("button", { name: "Line width preset" });
  await expect(lineWidthDropdown).toBeVisible();
  await lineWidthDropdown.click();

  await page.getByRole("option", { name: "thick", exact: true }).hover();
  await page.getByRole("option", { name: "Custom line width" }).hover();
  await page.mouse.move(5, 5);

  await expect(lineWidthDropdown).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("option", { name: "Custom line width" })).toBeVisible();
  await expect.poll(async () => readSource(page)).toBe(source);

  await page.keyboard.press("Escape");

  const dashStyleDropdown = page.getByRole("button", { name: "Dash style" });
  await expect(dashStyleDropdown).toBeVisible();
  await dashStyleDropdown.click();
  await page.getByRole("option", { name: "Dotted", exact: true }).hover();
  await page.mouse.move(5, 5);

  await expect(dashStyleDropdown).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("option", { name: "Dotted", exact: true })).toBeVisible();
  await expect.poll(async () => readSource(page)).toBe(source);
});

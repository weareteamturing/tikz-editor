import { expect, test } from "@playwright/test";
import {
  clickTextHitRegionByTargetId,
  gotoApp,
  readSelectedSourceIds,
  readSource,
  resetStorageBeforeNavigation,
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

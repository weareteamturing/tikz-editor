/**
 * CDP profiling test for drag interactions (move & resize).
 *
 * Run (production build, recommended):
 *   npx playwright test --config profiling/playwright.config.ts profiling/profile-drag.spec.ts
 *
 * Run (dev mode, includes React dev overhead):
 *   npx playwright test profiling/profile-drag.spec.ts
 *
 * Produces JSON trace files in apps/web/profiling/traces/ that can be:
 *  - Opened in Chrome DevTools → Performance → Load profile
 *  - Inspected programmatically
 */
import { expect, test } from "@playwright/test";
import {
  clickHitRegion,
  gotoApp,
  interactionLayer,
  resetStorageBeforeNavigation,
  setSource,
  waitForHitRegions
} from "../e2e/helpers";
import { startCDPProfile, stopCDPProfile } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

test("profile: move element drag", async ({ page }) => {
  await gotoApp(page);
  await setSource(
    page,
    String.raw`\begin{tikzpicture}
\filldraw[fill=blue!20] (0,0) rectangle (4,2);
\draw[red, thick] (1,1) circle (0.5);
\draw[->] (5,0) -- (7,2);
\end{tikzpicture}`
  );
  await page.getByRole("button", { name: "Select" }).click();

  // Select the rectangle
  await clickHitRegion(page, 0);
  await waitForHitRegions(page);

  const client = await startCDPProfile(page);

  // Drag the selected element around with many steps to stress the system
  const hitRegion = page.locator("[data-hit-region-target-id]").first();
  const box = await hitRegion.boundingBox();
  expect(box).toBeTruthy();
  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Drag in a square pattern with fine-grained steps
  for (const [dx, dy] of [
    [80, 0],
    [0, 80],
    [-80, 0],
    [0, -80]
  ]) {
    await page.mouse.move(startX + dx, startY + dy, { steps: 20 });
  }
  await page.mouse.up();

  await stopCDPProfile(client, "move-element.cpuprofile");
});

test("profile: resize element drag", async ({ page }) => {
  await gotoApp(page);
  await setSource(
    page,
    String.raw`\begin{tikzpicture}
\filldraw[fill=blue!20] (0,0) rectangle (4,2);
\end{tikzpicture}`
  );
  await page.getByRole("button", { name: "Select" }).click();

  // Select and find resize handle
  await clickHitRegion(page, 0);
  const resizeHandle = page
    .locator('[data-handle-kind="resize-element"]')
    .first();
  await expect(resizeHandle).toBeVisible();

  const client = await startCDPProfile(page);

  // Drag resize handle back and forth
  const box = await resizeHandle.boundingBox();
  expect(box).toBeTruthy();
  const cx = box!.x + box!.width / 2;
  const cy = box!.y + box!.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(cx + 60, cy + 40, { steps: 15 });
    await page.mouse.move(cx - 30, cy - 20, { steps: 15 });
  }
  await page.mouse.up();

  await stopCDPProfile(client, "resize-element.cpuprofile");
});

test("profile: create rectangle via tool drag", async ({ page }) => {
  await gotoApp(page);
  await setSource(
    page,
    String.raw`\begin{tikzpicture}
\end{tikzpicture}`
  );

  await page.getByRole("button", { name: "Rect" }).click();
  const layer = interactionLayer(page);

  const client = await startCDPProfile(page);

  const layerBox = await layer.boundingBox();
  expect(layerBox).toBeTruthy();
  await page.mouse.move(layerBox!.x + 100, layerBox!.y + 100);
  await page.mouse.down();
  await page.mouse.move(layerBox!.x + 300, layerBox!.y + 250, { steps: 30 });
  await page.mouse.up();

  await stopCDPProfile(client, "create-rectangle.cpuprofile");
});

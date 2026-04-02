import { expect, test } from "@playwright/test";
import {
  clickHitRegion,
  gotoApp,
  interactionLayer,
  resetStorageBeforeNavigation,
  setSource,
  waitForHitRegions
} from "../e2e/helpers";
import { captureProfileVariant, readSourceRevision, writeScenarioReport } from "./framework";
import { getProfilingScenarioById } from "./scenario-registry";

const MANIFEST = getProfilingScenarioById("basic-drag");

if (!MANIFEST) {
  throw new Error("Missing profiling manifest for basic-drag.");
}

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

test("profile basic canvas drags", async ({ page }, testInfo) => {
  const variants = [];

  await gotoApp(page, "/editor/");
  await setSource(
    page,
    String.raw`\begin{tikzpicture}
\filldraw[fill=blue!20] (0,0) rectangle (4,2);
\draw[red, thick] (1,1) circle (0.5);
\draw[->] (5,0) -- (7,2);
\end{tikzpicture}`
  );
  await page.getByRole("button", { name: "Select" }).click();
  await clickHitRegion(page, 0);
  await waitForHitRegions(page);
  variants.push(await captureProfileVariant({
    page,
    scenarioId: MANIFEST.id,
    variantId: "move-element",
    label: "Move Element Drag",
    dimensions: {
      interaction: "drag-element"
    },
    run: async () => {
      const sourceRevisionBefore = await readSourceRevision(page);
      const hitRegion = page.locator("[data-hit-region-target-id]").first();
      const box = await hitRegion.boundingBox();
      expect(box).toBeTruthy();
      const startX = box!.x + box!.width / 2;
      const startY = box!.y + box!.height / 2;
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      for (const [dx, dy] of [
        [80, 0],
        [0, 80],
        [-80, 0],
        [0, -80]
      ] as const) {
        await page.mouse.move(startX + dx, startY + dy, { steps: 20 });
      }
      await page.mouse.up();
      await page.waitForTimeout(300);
      const sourceRevisionAfter = await readSourceRevision(page);
      return {
        metrics: {
          sourceRevisionDelta: sourceRevisionAfter - sourceRevisionBefore
        },
        frameStats: null,
        probeSnapshot: {
          sourceRevisionBefore,
          sourceRevisionAfter
        }
      };
    }
  }));

  await gotoApp(page, "/editor/");
  await setSource(
    page,
    String.raw`\begin{tikzpicture}
\filldraw[fill=blue!20] (0,0) rectangle (4,2);
\end{tikzpicture}`
  );
  await page.getByRole("button", { name: "Select" }).click();
  await clickHitRegion(page, 0);
  variants.push(await captureProfileVariant({
    page,
    scenarioId: MANIFEST.id,
    variantId: "resize-element",
    label: "Resize Element Drag",
    dimensions: {
      interaction: "resize-element"
    },
    run: async () => {
      const resizeHandle = page.locator('[data-handle-kind="resize-element"]').first();
      await expect(resizeHandle).toBeVisible();
      const sourceRevisionBefore = await readSourceRevision(page);
      const box = await resizeHandle.boundingBox();
      expect(box).toBeTruthy();
      const centerX = box!.x + box!.width / 2;
      const centerY = box!.y + box!.height / 2;
      await page.mouse.move(centerX, centerY);
      await page.mouse.down();
      for (let index = 0; index < 3; index += 1) {
        await page.mouse.move(centerX + 60, centerY + 40, { steps: 15 });
        await page.mouse.move(centerX - 30, centerY - 20, { steps: 15 });
      }
      await page.mouse.up();
      await page.waitForTimeout(300);
      const sourceRevisionAfter = await readSourceRevision(page);
      return {
        metrics: {
          sourceRevisionDelta: sourceRevisionAfter - sourceRevisionBefore
        },
        frameStats: null,
        probeSnapshot: {
          sourceRevisionBefore,
          sourceRevisionAfter
        }
      };
    }
  }));

  await gotoApp(page, "/editor/");
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);
  await page.getByRole("button", { name: "Rect" }).click();
  variants.push(await captureProfileVariant({
    page,
    scenarioId: MANIFEST.id,
    variantId: "create-rectangle",
    label: "Create Rectangle Drag",
    dimensions: {
      interaction: "tool-create"
    },
    run: async () => {
      const layer = interactionLayer(page);
      const sourceRevisionBefore = await readSourceRevision(page);
      const box = await layer.boundingBox();
      expect(box).toBeTruthy();
      await page.mouse.move(box!.x + 100, box!.y + 100);
      await page.mouse.down();
      await page.mouse.move(box!.x + 300, box!.y + 250, { steps: 30 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      const sourceRevisionAfter = await readSourceRevision(page);
      return {
        metrics: {
          sourceRevisionDelta: sourceRevisionAfter - sourceRevisionBefore
        },
        frameStats: null,
        probeSnapshot: {
          sourceRevisionBefore,
          sourceRevisionAfter
        }
      };
    }
  }));

  const reportPath = writeScenarioReport(MANIFEST, testInfo, variants);
  console.log(`[profiling] wrote ${reportPath}`);
});

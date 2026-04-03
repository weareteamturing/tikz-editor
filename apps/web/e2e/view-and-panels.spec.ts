import { expect, test } from "@playwright/test";
import { canvasViewport, gotoApp, openMenuCommand, openMenuSection, resetStorageBeforeNavigation } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

test("view menu toggles source and inspector panels", async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator(".cm-editor").first()).toBeVisible();
  const stylesTab = page.locator(".flexlayout__tab_button_content:has-text('Styles')");
  await expect(stylesTab.first()).toBeVisible();

  await openMenuCommand(page, "view", "view.toggle-source-panel");
  await expect(page.locator(".cm-editor")).toHaveCount(0);

  await openMenuCommand(page, "view", "view.toggle-inspector-panel");

  await openMenuSection(page, "view");
  await expect(page.getByTestId("menu-cmd-view.toggle-source-panel")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("menu-cmd-view.toggle-inspector-panel")).toHaveAttribute("aria-checked", "false");

  await openMenuCommand(page, "view", "view.toggle-source-panel");
  await openMenuCommand(page, "view", "view.toggle-inspector-panel");
  await expect(page.locator(".cm-editor").first()).toBeVisible();
  await expect(stylesTab.first()).toBeVisible();
});

test("left and right splitters resize layout panes", async ({ page }) => {
  await gotoApp(page);
  const viewport = canvasViewport(page);
  const splitters = page.locator(".flexlayout__splitter");
  await expect(splitters).toHaveCount(2);
  const leftSplitter = splitters.first();
  const rightSplitter = splitters.nth(1);

  const initialViewportBox = await viewport.boundingBox();
  const leftBox = await leftSplitter.boundingBox();
  const rightBox = await rightSplitter.boundingBox();
  if (!initialViewportBox || !leftBox || !rightBox) {
    throw new Error("Missing bounds for resize test.");
  }

  await page.mouse.move(leftBox.x + leftBox.width / 2, leftBox.y + leftBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(leftBox.x + 80, leftBox.y + leftBox.height / 2, { steps: 8 });
  await page.mouse.up();

  const afterLeftResizeBox = await viewport.boundingBox();
  if (!afterLeftResizeBox) {
    throw new Error("Viewport bounds missing after left resize.");
  }
  expect(afterLeftResizeBox.width).toBeLessThan(initialViewportBox.width);

  await page.mouse.move(rightBox.x + rightBox.width / 2, rightBox.y + rightBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(rightBox.x - 80, rightBox.y + rightBox.height / 2, { steps: 8 });
  await page.mouse.up();

  const afterRightResizeBox = await viewport.boundingBox();
  if (!afterRightResizeBox) {
    throw new Error("Viewport bounds missing after right resize.");
  }
  expect(afterRightResizeBox.width).toBeLessThan(afterLeftResizeBox.width);
});

test("developer panel toggles from shortcut and menu checked state", async ({ page }) => {
  await gotoApp(page);

  await page.keyboard.press("ControlOrMeta+Shift+D");
  await expect(page.getByText("Dev Panel")).toBeVisible();

  await openMenuSection(page, "view");
  await expect(page.getByTestId("menu-cmd-view.toggle-dev-panel")).toHaveAttribute("aria-checked", "true");

  await openMenuCommand(page, "view", "view.toggle-dev-panel");
  await expect(page.getByText("Dev Panel")).toHaveCount(0);

  await openMenuSection(page, "view");
  await expect(page.getByTestId("menu-cmd-view.toggle-dev-panel")).toHaveAttribute("aria-checked", "false");
});

test("view menu toggles transparency grid and infinite canvas, then marquee starts from viewport background", async ({ page }) => {
  await gotoApp(page);
  await expect(page.getByTestId("canvas-svg-layer")).toBeVisible();

  await openMenuCommand(page, "view", "view.toggle-transparency-grid");
  await openMenuCommand(page, "view", "view.toggle-infinite-canvas");
  await openMenuSection(page, "view");
  await expect(page.getByTestId("menu-cmd-view.toggle-transparency-grid")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("menu-cmd-view.toggle-infinite-canvas")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("canvas-svg-layer")).toHaveAttribute("data-show-transparency-grid", "true");
  await expect(page.getByTestId("canvas-svg-layer")).toHaveAttribute("data-show-document-bounds", "false");

  await page.evaluate(() => {
    const api = (globalThis as unknown as {
      __TIKZ_EDITOR_APP_TEST_API__?: {
        clearSelection?: () => void;
        getSelectedSourceIds?: () => string[];
      };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    api?.clearSelection?.();
  });

  const viewport = page.getByTestId("canvas-viewport");
  const worldStage = page.getByTestId("canvas-world-stage");
  const viewportBox = await viewport.boundingBox();
  const worldStageBox = await worldStage.boundingBox();
  if (!viewportBox || !worldStageBox) {
    throw new Error("Missing canvas bounds for marquee test.");
  }

  const startX = viewportBox.x + 8;
  const startY = viewportBox.y + 8;
  const endX = worldStageBox.x + worldStageBox.width * 0.5;
  const endY = worldStageBox.y + worldStageBox.height * 0.5;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const api = (globalThis as unknown as {
        __TIKZ_EDITOR_APP_TEST_API__?: {
          getActiveCanvasDragKind?: () => string | null;
        };
      }).__TIKZ_EDITOR_APP_TEST_API__;
      return api?.getActiveCanvasDragKind?.() ?? null;
    });
  }).toBe("marquee");
  await page.mouse.move(endX, endY, { steps: 10 });
  const dragKindAfterMove = await page.evaluate(() => {
    const api = (globalThis as unknown as {
      __TIKZ_EDITOR_APP_TEST_API__?: {
        getActiveCanvasDragKind?: () => string | null;
      };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    return api?.getActiveCanvasDragKind?.() ?? null;
  });
  expect(dragKindAfterMove).toBe("marquee");
  await page.mouse.up();
});

test("magnify tool shows a temporary lens while the pointer is held down", async ({ page }) => {
  await gotoApp(page);

  await page.locator('[data-tauri-drag-region] button[aria-label="Magnify"]').click();
  await expect(page.locator('[data-tauri-drag-region] button[aria-label="Magnify"]')).toHaveClass(/btnActive/);

  const interactionLayer = page.getByTestId("canvas-interaction-layer");
  await expect(interactionLayer).toBeVisible();
  const viewportBox = await interactionLayer.boundingBox();
  if (!viewportBox) {
    throw new Error("Missing canvas bounds for magnify test.");
  }

  const startX = viewportBox.x + viewportBox.width * 0.5;
  const startY = viewportBox.y + viewportBox.height * 0.5;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  const magnifier = page.getByTestId("canvas-magnifier-shell");
  await expect(magnifier).toBeVisible();
  const shellBoxBefore = await magnifier.boundingBox();
  if (!shellBoxBefore) {
    throw new Error("Missing magnifier bounds before drag.");
  }

  await page.mouse.move(startX + 40, startY + 30);
  await expect(magnifier).toBeVisible();
  const shellBoxAfter = await magnifier.boundingBox();
  if (!shellBoxAfter) {
    throw new Error("Missing magnifier bounds after drag.");
  }
  expect(Math.abs(shellBoxAfter.x - shellBoxBefore.x)).toBeGreaterThan(5);
  expect(Math.abs(shellBoxAfter.y - shellBoxBefore.y)).toBeGreaterThan(5);

  await page.mouse.up();
  await expect(magnifier).toHaveCount(0);
});

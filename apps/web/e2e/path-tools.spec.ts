import { expect, test } from "@playwright/test";
import {
  canvasViewport,
  dragBetweenPoints,
  dragLocatorBy,
  gotoApp,
  interactionLayer,
  openMenuCommand,
  openMenuSection,
  readSource,
  resetStorageBeforeNavigation,
  setSource
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

test("resize drag shows and hides metric tooltip", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\filldraw[fill=blue!20] (0,0) rectangle (4,2);
\end{tikzpicture}`);

  await page.locator("[data-hit-region-target-id]").first().click();
  const resizeHandle = page.locator('[data-handle-kind="resize-element"]').first();
  await expect(resizeHandle).toBeVisible();

  await dragLocatorBy(page, resizeHandle, 40, 30);
  const tooltip = page.getByTestId("canvas-drag-tooltip-shell");
  await expect(tooltip).toBeVisible();
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText("Width:");
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText("Height:");
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText("pt");
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText("cm");

  await page.mouse.up();
  await expect(tooltip).toHaveCount(0);
});

test("rotate drag shows degree tooltip", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\filldraw[fill=blue!20] (0,0) rectangle (4,2);
\end{tikzpicture}`);

  await page.locator("[data-hit-region-target-id]").first().click();
  const rotateHandle = page.getByTestId("canvas-rotate-handle");
  await expect(rotateHandle).toBeVisible();

  await dragLocatorBy(page, rotateHandle, 30, 35);
  await expect(page.getByTestId("canvas-drag-tooltip-shell")).toBeVisible();
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText("Angle:");
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText("°");

  await page.mouse.up();
  await expect(page.getByTestId("canvas-drag-tooltip-shell")).toHaveCount(0);
});

test("rectangle and grid creation show tooltips and keep tooltip in viewport bounds", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);
  await page.getByRole("button", { name: "Rect" }).click();

  const layer = interactionLayer(page);
  await dragBetweenPoints(page, layer, { x: 120, y: 120 }, { x: 280, y: 240 });
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText("Width:");
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText("Height:");
  await page.mouse.up();

  await page.getByRole("button", { name: "Grid" }).click();
  const viewport = canvasViewport(page);
  const viewportBox = await viewport.boundingBox();
  const layerBox = await layer.boundingBox();
  if (!viewportBox || !layerBox) {
    throw new Error("Canvas bounds missing.");
  }

  await dragBetweenPoints(page, layer, { x: layerBox.width - 90, y: layerBox.height - 90 }, { x: layerBox.width - 10, y: layerBox.height - 10 });
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText("Cells:");

  const tooltipBox = await page.getByTestId("canvas-drag-tooltip-shell").boundingBox();
  if (!tooltipBox) {
    throw new Error("Tooltip bounds missing.");
  }
  expect(tooltipBox.x).toBeGreaterThanOrEqual(viewportBox.x);
  expect(tooltipBox.y).toBeGreaterThanOrEqual(viewportBox.y);
  expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(viewportBox.x + viewportBox.width);
  expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(viewportBox.y + viewportBox.height);

  await page.mouse.up();
});

test("insert menu commands switch tool modes and expose checked state", async ({ page }) => {
  await gotoApp(page);
  const insertCommands = [
    "insert.node",
    "insert.path",
    "insert.freehand",
    "insert.line",
    "insert.arrow",
    "insert.bezier",
    "insert.grid",
    "insert.rect",
    "insert.ellipse",
    "insert.circle"
  ] as const;

  for (const commandId of insertCommands) {
    await openMenuSection(page, "insert");
    const command = page.getByTestId(`menu-cmd-${commandId}`);
    await expect(command).toBeEnabled();
    await command.click();

    await openMenuSection(page, "insert");
    await expect(page.getByTestId(`menu-cmd-${commandId}`)).toHaveAttribute("aria-checked", "true");
  }
});

test("path menu commands stay disabled when selection has no editable path point", async ({ page }) => {
  await gotoApp(page);
  await openMenuSection(page, "path");
  await expect(page.getByTestId("menu-cmd-path.split")).toBeDisabled();
  await expect(page.getByTestId("menu-cmd-path.join")).toBeDisabled();
  await expect(page.getByTestId("menu-cmd-path.close")).toBeDisabled();
  await expect(page.getByTestId("menu-cmd-path.open")).toBeDisabled();
  await expect(page.getByTestId("menu-cmd-path.delete-point")).toBeDisabled();
  await expect(page.getByTestId("menu-cmd-path.point-corner")).toBeDisabled();
  await expect(page.getByTestId("menu-cmd-path.point-smooth")).toBeDisabled();
});

test("fit-to-content command is available when svg is rendered", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\draw (0,0) rectangle (4,2);
\end{tikzpicture}`);

  await openMenuSection(page, "view");
  await expect(page.getByTestId("menu-cmd-view.fit-to-content")).toBeEnabled();
  await openMenuCommand(page, "view", "view.fit-to-content");

  await expect.poll(async () => readSource(page)).toContain("rectangle");
});

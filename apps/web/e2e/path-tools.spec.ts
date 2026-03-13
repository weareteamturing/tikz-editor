import { expect, test } from "@playwright/test";
import {
  canvasViewport,
  clickHitRegion,
  dragBetweenPoints,
  dragLocatorBy,
  gotoApp,
  interactionLayer,
  openMenuCommand,
  openMenuSection,
  readSource,
  resetStorageBeforeNavigation,
  setSource,
  waitForHitRegions
} from "./helpers";

function toolbarButton(page: import("@playwright/test").Page, label: string) {
  return page.locator(`[data-tauri-drag-region] button[aria-label="${label}"]`).first();
}

async function drawFreehandStroke(
  page: import("@playwright/test").Page,
  layer: import("@playwright/test").Locator
): Promise<void> {
  const box = await layer.boundingBox();
  if (!box) {
    throw new Error("Canvas interaction layer bounds missing.");
  }
  const points = [
    { x: 120, y: 120 },
    { x: 136, y: 106 },
    { x: 152, y: 128 },
    { x: 168, y: 110 },
    { x: 184, y: 132 },
    { x: 200, y: 114 },
    { x: 216, y: 136 },
    { x: 232, y: 118 },
    { x: 248, y: 140 }
  ];

  await page.mouse.move(box.x + points[0]!.x, box.y + points[0]!.y);
  await page.mouse.down();
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i]!;
    await page.mouse.move(box.x + point.x, box.y + point.y, { steps: 2 });
  }
  await page.mouse.up();
}

function countBezierControls(source: string): number {
  return (source.match(/\.\. controls/g) ?? []).length;
}

async function doubleClickHitRegion(
  page: import("@playwright/test").Page,
  index: number
): Promise<void> {
  const region = page.locator("[data-hit-region-target-id]").nth(index);
  await expect(region).toBeVisible();
  const target = await region.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.dblclick(target.x, target.y);
}

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

test("resize drag shows and hides metric tooltip", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\filldraw[fill=blue!20] (0,0) rectangle (4,2);
\end{tikzpicture}`);
  await page.getByRole("button", { name: "Select" }).click();

  await clickHitRegion(page, 0);
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
  await page.getByRole("button", { name: "Select" }).click();

  await clickHitRegion(page, 0);
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
  await toolbarButton(page, "Rect").click();

  const layer = interactionLayer(page);
  await dragBetweenPoints(page, layer, { x: 120, y: 120 }, { x: 280, y: 240 });
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText("Width:");
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText("Height:");
  await page.mouse.up();

  await toolbarButton(page, "Grid").click();
  const viewport = canvasViewport(page);
  const viewportBox = await viewport.boundingBox();
  const layerBox = await layer.boundingBox();
  if (!viewportBox || !layerBox) {
    throw new Error("Canvas bounds missing.");
  }

  const gridStart = {
    x: Math.max(16, layerBox.width - 140),
    y: Math.max(16, layerBox.height - 140)
  };
  const gridEnd = {
    x: Math.max(gridStart.x + 40, layerBox.width - 24),
    y: Math.max(gridStart.y + 40, layerBox.height - 24)
  };
  await dragBetweenPoints(page, layer, gridStart, gridEnd);
  const tooltipShell = page.getByTestId("canvas-drag-tooltip-shell");
  const tooltipCount = await tooltipShell.count();
  if (tooltipCount > 0) {
    const tooltipBox = await tooltipShell.boundingBox();
    if (!tooltipBox) {
      throw new Error("Tooltip bounds missing.");
    }
    expect(tooltipBox.x).toBeGreaterThanOrEqual(viewportBox.x);
    expect(tooltipBox.y).toBeGreaterThanOrEqual(viewportBox.y);
    expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(viewportBox.x + viewportBox.width);
    expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(viewportBox.y + viewportBox.height);
  }

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

test("freehand toolbar popup opens on activation and closes on outside click or escape", async ({ page }) => {
  await gotoApp(page);

  await toolbarButton(page, "Freehand").click();
  await expect(page.getByTestId("toolbar-tool-popup-addFreehand")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("toolbar-tool-popup-addFreehand")).toHaveCount(0);

  await toolbarButton(page, "Freehand").click();
  await expect(page.getByTestId("toolbar-tool-popup-addFreehand")).toBeVisible();

  await page.mouse.click(4, 4);
  await expect(page.getByTestId("toolbar-tool-popup-addFreehand")).toHaveCount(0);
});

test("freehand smoothing popup slider changes generated curve complexity", async ({ page }) => {
  await gotoApp(page);
  const emptyPicture = String.raw`\begin{tikzpicture}
\end{tikzpicture}`;
  await setSource(page, emptyPicture);
  const layer = interactionLayer(page);

  await toolbarButton(page, "Freehand").click();
  const slider = page.getByTestId("toolbar-freehand-smoothing-slider");
  await expect(slider).toBeVisible();
  await slider.fill("4");
  await drawFreehandStroke(page, layer);
  const lowSmoothingSource = await readSource(page);

  await setSource(page, emptyPicture);
  await toolbarButton(page, "Freehand").click();
  await expect(slider).toBeVisible();
  await slider.fill("32");
  await drawFreehandStroke(page, layer);
  const highSmoothingSource = await readSource(page);

  expect(countBezierControls(lowSmoothingSource)).toBeGreaterThan(countBezierControls(highSmoothingSource));
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

test("live endpoint-anchor drag keeps source well-formed while hovering and on drop", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \draw[red] (-1, 1) -- (1, 1);
  \node[draw] (C) at (0, 0) {C};
\end{tikzpicture}`);
  await page.getByRole("button", { name: "Select" }).click();

  await waitForHitRegions(page, 1);
  const lineRegion = page.locator("[data-hit-region-target-id]").first();
  const lineTarget = await lineRegion.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(lineTarget.x, lineTarget.y);
  const endpointHandle = page.locator('[data-handle-kind="move-handle"][data-source-id="path:0"]').nth(1);
  await expect(endpointHandle).toBeVisible();
  const handleBox = await endpointHandle.boundingBox();
  if (!handleBox) {
    throw new Error("Endpoint handle bounds missing.");
  }
  const nodeRegion = page.locator('[data-hit-region-target-id="path:1"]').first();
  await expect(nodeRegion).toBeVisible();
  const nodeBox = await nodeRegion.boundingBox();
  if (!nodeBox) {
    throw new Error("Node hit-region bounds missing.");
  }

  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();

  await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2, { steps: 12 });
  await expect.poll(async () => page.locator("svg circle").count()).toBeGreaterThan(0);
  const anchorCircle = page.locator("svg circle").first();
  const anchorBox = await anchorCircle.boundingBox();
  if (!anchorBox) {
    throw new Error("Node anchor overlay circle bounds missing.");
  }
  await page.mouse.move(anchorBox.x + anchorBox.width / 2, anchorBox.y + anchorBox.height / 2, { steps: 8 });

  const sourceDuringDrag = await readSource(page);
  expect(sourceDuringDrag).toContain("\\draw[red]");
  expect(sourceDuringDrag).not.toContain(");(");
  expect(sourceDuringDrag).toContain("\\end{tikzpicture}");
  await expect.poll(async () => page.locator("[data-hit-region-target-id]").count()).toBeGreaterThanOrEqual(2);

  // Drag away again before releasing: source should detach from node anchor.
  await page.mouse.move(startX + 120, startY - 20, { steps: 12 });
  const sourceAfterDraggingAway = await readSource(page);
  expect(sourceAfterDraggingAway).not.toContain("(C.");
  expect(sourceAfterDraggingAway).toContain("\\end{tikzpicture}");

  await page.mouse.up();
  const sourceAfterDrop = await readSource(page);
  expect(sourceAfterDrop).not.toContain(");(");
  expect(sourceAfterDrop).toContain("\\end{tikzpicture}");
});

test("dense paths require double click before showing interior edit handles", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\draw (0,0) -- (1,0.2) -- (2,-0.1) -- (3,0.3) -- (4,0) -- (5,0.4) -- (6,0.1) -- (7,0.5) -- (8,0.2);
\draw (0,2) -- (1,2.2) -- (2,2.1);
\end{tikzpicture}`);
  await page.getByRole("button", { name: "Select" }).click();
  await waitForHitRegions(page, 2);
  const denseTargetId = await page.locator("[data-hit-region-target-id]").nth(0).getAttribute("data-hit-region-target-id");
  const shortTargetId = await page.locator("[data-hit-region-target-id]").nth(1).getAttribute("data-hit-region-target-id");
  if (!denseTargetId || !shortTargetId) {
    throw new Error("Expected dense and short path hit-region target ids.");
  }

  await clickHitRegion(page, 0);
  await expect(page.getByTestId("canvas-selection-hint")).toContainText("Double-click path to edit points.");
  await expect.poll(async () =>
    page.locator(`[data-handle-kind="move-element"][data-source-id="${denseTargetId}"]`).count()
  ).toBeGreaterThan(0);
  await expect(page.locator(`[data-handle-kind="move-handle"][data-source-id="${denseTargetId}"]`)).toHaveCount(0);

  await doubleClickHitRegion(page, 0);
  await expect(page.getByTestId("canvas-selection-hint")).toHaveCount(0);

  await clickHitRegion(page, 1);
  await expect(page.getByTestId("canvas-selection-hint")).toHaveCount(0);
  await expect.poll(async () =>
    page.locator(`[data-handle-kind="move-handle"][data-source-id="${shortTargetId}"]`).count()
  ).toBeGreaterThan(0);
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

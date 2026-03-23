import { expect, type Locator, type Page } from "@playwright/test";

export type MenuSection = "file" | "edit" | "path" | "insert" | "view" | "help";

export function tabSwitchButtons(page: Page): Locator {
  return page.locator("[data-testid^='tab-switch-']");
}

export function tabCloseButtons(page: Page): Locator {
  return page.locator("[data-testid^='tab-close-']");
}

export async function resetStorageBeforeNavigation(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      if (!window.name.includes("__pw_storage_cleared__")) {
        localStorage.clear();
        sessionStorage.clear();
        window.name += "__pw_storage_cleared__";
      }
    } catch {
      // ignore storage reset failures
    }
  });
}

export async function gotoApp(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await expect(page.getByTestId("tab-strip")).toBeVisible();
}

export async function openMenuSection(page: Page, section: MenuSection): Promise<void> {
  const trigger = page.getByTestId(`menu-section-${section}`);
  const expanded = await trigger.getAttribute("aria-expanded");
  if (expanded !== "true") {
    await trigger.click();
  }
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
}

async function prepareMenuCommand(page: Page, section: MenuSection, commandId: string): Promise<Locator> {
  await openMenuSection(page, section);
  if (section === "file" && commandId.startsWith("file.import-")) {
    await page.getByRole("menuitem", { name: "Import" }).hover();
  }
  if (
    section === "file" &&
    (commandId === "file.export-svg-download" ||
      commandId === "file.export-standalone-latex-download" ||
      commandId === "file.export-pdf-download" ||
      commandId === "file.export-png-download")
  ) {
    await page.getByRole("menuitem", { name: "Export" }).hover();
  }
  if (section === "edit" && commandId.startsWith("edit.align-")) {
    await page.getByRole("menuitem", { name: "Align" }).hover();
  }
  if (
    section === "edit" &&
    (commandId === "edit.rotate-left-90" ||
      commandId === "edit.rotate-right-90" ||
      commandId === "edit.flip-horizontal" ||
      commandId === "edit.flip-vertical")
  ) {
    await page.getByRole("menuitem", { name: "Transform" }).hover();
  }
  if (section === "edit" && commandId.startsWith("edit.distribute-")) {
    await page.getByRole("menuitem", { name: "Distribute" }).hover();
  }
  if (section === "view" && commandId.startsWith("view.toggle-snap-")) {
    await page.getByRole("menuitem", { name: "Snapping" }).hover();
  }
  if (
    section === "edit" &&
    (commandId === "edit.send-to-back" ||
      commandId === "edit.send-backward" ||
      commandId === "edit.bring-forward" ||
      commandId === "edit.bring-to-front")
  ) {
    await page.getByRole("menuitem", { name: "Reorder" }).hover();
  }
  return page.getByTestId(`menu-cmd-${commandId}`);
}

export async function openMenuCommand(page: Page, section: MenuSection, commandId: string): Promise<void> {
  const command = await prepareMenuCommand(page, section, commandId);
  await command.click();
}

export async function runMenuCommandIfEnabled(
  page: Page,
  section: MenuSection,
  commandId: string
): Promise<boolean> {
  const command = await prepareMenuCommand(page, section, commandId);
  if (!(await command.isEnabled())) {
    return false;
  }
  await command.click();
  return true;
}

export async function expectMenuCommandEnabled(page: Page, section: MenuSection, commandId: string, enabled: boolean): Promise<void> {
  await openMenuSection(page, section);
  const command = page.getByTestId(`menu-cmd-${commandId}`);
  if (enabled) {
    await expect(command).toBeEnabled();
  } else {
    await expect(command).toBeDisabled();
  }
}

export async function setSource(page: Page, source: string): Promise<void> {
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const api = (globalThis as unknown as {
        __TIKZ_EDITOR_APP_TEST_API__?: {
          setSource?: (source: string) => void;
        };
      }).__TIKZ_EDITOR_APP_TEST_API__;
      return typeof api?.setSource === "function";
    });
  }, {
    timeout: 15_000,
    intervals: [100, 200, 400, 800]
  }).toBe(true);

  await page.evaluate((nextSource) => {
    const api = (globalThis as unknown as {
      __TIKZ_EDITOR_APP_TEST_API__?: {
        setSource?: (source: string) => void;
      };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    if (typeof api?.setSource !== "function") {
      throw new Error("App test API setSource is unavailable.");
    }
    api.setSource(nextSource);
  }, source);

  await expect.poll(async () => {
    return await page.evaluate((expectedSource) => {
      const api = (globalThis as unknown as {
        __TIKZ_EDITOR_APP_TEST_API__?: {
          getSource?: () => string;
          getSnapshotSource?: () => string;
        };
      }).__TIKZ_EDITOR_APP_TEST_API__;
      const currentSource = api?.getSource?.();
      const snapshotSource = api?.getSnapshotSource?.();
      if (currentSource !== expectedSource) {
        return false;
      }
      if (snapshotSource == null) {
        return true;
      }
      return snapshotSource === expectedSource;
    }, source);
  }, {
    timeout: 15_000,
    intervals: [100, 200, 400, 800]
  }).toBe(true);
}

export async function readSource(page: Page): Promise<string> {
  const sourceFromStore = await page.evaluate(() => {
    const api = (globalThis as unknown as {
      __TIKZ_EDITOR_APP_TEST_API__?: {
        getSource?: () => string;
      };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    return api?.getSource?.() ?? null;
  });
  if (typeof sourceFromStore === "string") {
    return sourceFromStore;
  }

  const text = await page.locator(".cm-content").first().textContent();
  return text ?? "";
}

export async function readStoreSource(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const api = (globalThis as unknown as {
      __TIKZ_EDITOR_APP_TEST_API__?: {
        getSource?: () => string;
      };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    return api?.getSource?.() ?? "";
  });
}

export async function readPersistedWorkspaceDocumentCount(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const raw = localStorage.getItem("tikz-editor:workspace");
    if (!raw) {
      return 0;
    }
    try {
      const parsed = JSON.parse(raw) as { documents?: unknown[] };
      return Array.isArray(parsed.documents) ? parsed.documents.length : 0;
    } catch {
      return 0;
    }
  });
}

export function canvasViewport(page: Page): Locator {
  return page.getByTestId("canvas-viewport");
}

export function interactionLayer(page: Page): Locator {
  return page.locator("[data-canvas-viewport='true'] svg").last();
}

export async function focusCanvas(page: Page): Promise<void> {
  await canvasViewport(page).click();
  await expect(canvasViewport(page)).toBeFocused();
}

export async function selectFirstCanvasElement(page: Page): Promise<void> {
  await waitForHitRegions(page);
  await clickHitRegion(page, 0);
}

export async function waitForHitRegions(page: Page, minimumCount = 1): Promise<void> {
  await expect.poll(async () => {
    await ensureFirstFigureActive(page);
    return page.locator("[data-hit-region-target-id]").count();
  }, {
    timeout: 30_000,
    intervals: [250, 500, 1000]
  }).toBeGreaterThanOrEqual(minimumCount);
}

export async function clickHitRegion(
  page: Page,
  index: number,
  options: { button?: "left" | "right"; shift?: boolean } = {}
): Promise<void> {
  await waitForHitRegions(page, index + 1);
  const region = page.locator("[data-hit-region-target-id]").nth(index);
  await expect(region).toBeVisible();
  const target = await region.evaluate((element) => {
    const fallback = () => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };

    const pointerEvents = getComputedStyle(element).pointerEvents;
    if (pointerEvents === "fill") {
      return fallback();
    }

    if (element instanceof SVGGeometryElement && typeof element.getTotalLength === "function") {
      try {
        const length = element.getTotalLength();
        const sample = element.getPointAtLength(Math.min(Math.max(length * 0.25, 1), Math.max(length - 1, 1)));
        const svg = element.ownerSVGElement;
        const ctm = element.getScreenCTM();
        if (!svg || !ctm) {
          return fallback();
        }
        const point = svg.createSVGPoint();
        point.x = sample.x;
        point.y = sample.y;
        const screen = point.matrixTransform(ctm);
        return { x: screen.x, y: screen.y };
      } catch {
        return fallback();
      }
    }

    return fallback();
  });

  if (options.shift) {
    await page.keyboard.down("Shift");
  }
  await page.mouse.click(target.x, target.y, {
    button: options.button ?? "left"
  });
  if (options.shift) {
    await page.keyboard.up("Shift");
  }
}

export async function clickHitRegionByTargetId(
  page: Page,
  targetId: string,
  options: { button?: "left" | "right"; shift?: boolean } = {}
): Promise<void> {
  await waitForHitRegions(page, 1);
  const region = page.locator(`[data-hit-region-target-id='${targetId}']`).first();
  await expect(region).toBeVisible();
  const box = await region.boundingBox();
  if (!box) {
    throw new Error(`Missing hit-region bounds for ${targetId}.`);
  }
  if (options.shift) {
    await page.keyboard.down("Shift");
  }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
    button: options.button ?? "left"
  });
  if (options.shift) {
    await page.keyboard.up("Shift");
  }
}

export async function dragHitRegionByTargetId(
  page: Page,
  targetId: string,
  dx: number,
  dy: number
): Promise<void> {
  await waitForHitRegions(page, 1);
  const region = page.locator(`[data-hit-region-target-id='${targetId}']`).first();
  await expect(region).toBeVisible();
  const box = await region.boundingBox();
  if (!box) {
    throw new Error(`Missing hit-region bounds for ${targetId}.`);
  }
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: 8 });
  await page.mouse.up();
}

export async function dragBetweenPoints(
  page: Page,
  target: Locator,
  start: { x: number; y: number },
  end: { x: number; y: number }
): Promise<void> {
  const box = await target.boundingBox();
  if (!box) {
    throw new Error("Missing drag target bounds.");
  }
  await page.mouse.move(box.x + start.x, box.y + start.y);
  await page.mouse.down();
  await page.mouse.move(box.x + end.x, box.y + end.y, { steps: 8 });
}

export async function dragLocatorBy(page: Page, locator: Locator, dx: number, dy: number): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) {
    throw new Error("Missing locator bounds.");
  }
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: 8 });
}

export async function injectBrowserPlatformEnv(page: Page, env: Record<string, unknown>): Promise<void> {
  await page.addInitScript((injected) => {
    (globalThis as { __TIKZ_EDITOR_BROWSER_PLATFORM_ENV__?: unknown }).__TIKZ_EDITOR_BROWSER_PLATFORM_ENV__ = injected;
  }, env);
}

export async function injectNoFsApiFallback(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const globalLike = globalThis as unknown as Record<string, unknown>;
    delete globalLike.showOpenFilePicker;
    delete globalLike.showSaveFilePicker;
  });
}

export async function selectAllSceneElements(page: Page): Promise<void> {
  await waitForHitRegions(page);
  await page.evaluate(() => {
    const api = (globalThis as unknown as {
      __TIKZ_EDITOR_APP_TEST_API__?: {
        selectAllElements?: () => void;
      };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    api?.selectAllElements?.();
  });
}

export async function readSelectedSourceIds(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const api = (globalThis as unknown as {
      __TIKZ_EDITOR_APP_TEST_API__?: {
        getSelectedSourceIds?: () => string[];
      };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    return api?.getSelectedSourceIds?.() ?? [];
  });
}

export async function readSelectionOverlayBoxSourceIds(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const values = new Set<string>();
    for (const element of Array.from(document.querySelectorAll("[data-selection-overlay-box-source-id]"))) {
      const sourceId = element.getAttribute("data-selection-overlay-box-source-id");
      if (sourceId) {
        values.add(sourceId);
      }
    }
    return [...values].sort();
  });
}

export async function readActiveFigureId(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    const api = (globalThis as unknown as {
      __TIKZ_EDITOR_APP_TEST_API__?: { getActiveFigureId?: () => string | null };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    return api?.getActiveFigureId?.() ?? null;
  });
}

export async function readFigureCount(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const api = (globalThis as unknown as {
      __TIKZ_EDITOR_APP_TEST_API__?: { getFigureCount?: () => number };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    return api?.getFigureCount?.() ?? 0;
  });
}

async function ensureFirstFigureActive(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = (globalThis as unknown as {
      __TIKZ_EDITOR_APP_TEST_API__?: {
        getFigureCount?: () => number;
        getActiveFigureId?: () => string | null;
        selectFirstFigure?: () => void;
      };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    if (!api) {
      return;
    }
    if ((api.getFigureCount?.() ?? 0) > 0 && api.getActiveFigureId?.() == null) {
      api.selectFirstFigure?.();
    }
  });
}

export async function clearSceneSelection(page: Page): Promise<void> {
  await page.evaluate(() => {
    const api = (globalThis as unknown as {
      __TIKZ_EDITOR_APP_TEST_API__?: {
        clearSelection?: () => void;
      };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    api?.clearSelection?.();
  });
}

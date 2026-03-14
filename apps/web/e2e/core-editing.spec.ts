import { expect, test } from "@playwright/test";
import {
  canvasViewport,
  clickHitRegionByTargetId,
  clickHitRegion,
  dragBetweenPoints,
  dragHitRegionByTargetId,
  focusCanvas,
  gotoApp,
  interactionLayer,
  openMenuCommand,
  openMenuSection,
  readSource,
  readSelectionOverlayBoxSourceIds,
  readStoreSource,
  resetStorageBeforeNavigation,
  runMenuCommandIfEnabled,
  readSelectedSourceIds,
  selectAllSceneElements,
  selectFirstCanvasElement,
  setSource,
  waitForHitRegions
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

test("tool keyboard shortcut creates shape and escape returns to select", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);

  await focusCanvas(page);
  await page.keyboard.press("r");
  const layer = interactionLayer(page);
  await dragBetweenPoints(page, layer, { x: 120, y: 120 }, { x: 240, y: 220 });
  await page.mouse.up();
  await expect.poll(async () => readSource(page)).toContain("rectangle");

  await page.keyboard.press("Escape");
  await page.keyboard.press("r");
  await page.keyboard.press("Escape");

  const sourceAfterEsc = await readSource(page);
  expect(sourceAfterEsc).toContain("rectangle");
});

test("duplicate, undo, redo and delete shortcuts operate on selected canvas elements", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\draw (0,0) rectangle (2,1);
\end{tikzpicture}`);

  await focusCanvas(page);
  await selectAllSceneElements(page);

  const beforeDuplicate = await readSource(page);
  await page.keyboard.press("ControlOrMeta+d");
  await expect.poll(async () => readSource(page)).not.toEqual(beforeDuplicate);

  const afterDuplicate = await readSource(page);
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(async () => readSource(page)).toEqual(beforeDuplicate);

  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(async () => readSource(page)).toEqual(afterDuplicate);

  await selectAllSceneElements(page);
  await page.keyboard.press("Delete");
  await expect.poll(async () => readSource(page)).not.toEqual(afterDuplicate);
});

test("cmd/ctrl+a selects all canvas elements for delete", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\draw (0,0) rectangle (2,1);
\draw (3,0) rectangle (4,1);
\end{tikzpicture}`);

  await waitForHitRegions(page, 2);
  await focusCanvas(page);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");

  await expect.poll(async () => readSource(page)).not.toContain("\\draw (0,0) rectangle (2,1);");
  await expect.poll(async () => readSource(page)).not.toContain("\\draw (3,0) rectangle (4,1);");
});

test("selection-sensitive edit menu commands enable only after selecting element", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\draw (0,0) rectangle (2,1);
\end{tikzpicture}`);

  await openMenuSection(page, "edit");
  await expect(page.getByTestId("menu-cmd-edit.copy")).toBeDisabled();
  await expect(page.getByTestId("menu-cmd-edit.cut")).toBeDisabled();
  await expect(page.getByTestId("menu-cmd-edit.delete")).toBeDisabled();
  await expect(page.getByTestId("menu-cmd-edit.duplicate")).toBeDisabled();

  await focusCanvas(page);
  await selectAllSceneElements(page);

  await openMenuSection(page, "edit");
  await expect(page.getByTestId("menu-cmd-edit.copy")).toBeEnabled();
  await expect(page.getByTestId("menu-cmd-edit.cut")).toBeEnabled();
  await expect(page.getByTestId("menu-cmd-edit.delete")).toBeEnabled();
  await expect(page.getByTestId("menu-cmd-edit.duplicate")).toBeEnabled();
});

test("menu cut/copy/paste flow works with mocked clipboard", async ({ page }) => {
  await page.addInitScript(() => {
    let clipboardText = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          clipboardText = value;
        },
        readText: async () => clipboardText
      }
    });
  });

  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\draw (0,0) -- (1,1);
\end{tikzpicture}`);

  await focusCanvas(page);
  await selectFirstCanvasElement(page);
  const before = await readSource(page);

  await openMenuCommand(page, "edit", "edit.copy");
  await openMenuCommand(page, "edit", "edit.paste");
  await expect.poll(async () => readSource(page)).not.toEqual(before);

  const afterPaste = await readSource(page);
  await selectFirstCanvasElement(page);
  await openMenuCommand(page, "edit", "edit.cut");
  await expect.poll(async () => readSource(page)).not.toEqual(afterPaste);
});

test("transform, reorder, align and distribute commands are surfaced with stable enabled/disabled states", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\draw (0,0) rectangle (1,1);
\draw (2,0.5) rectangle (3,1.5);
\end{tikzpicture}`);

  await selectAllSceneElements(page);

  const commands = [
    "edit.align-left",
    "edit.align-middle",
    "edit.distribute-horizontal",
    "edit.send-to-back",
    "edit.bring-to-front",
    "edit.rotate-left-90",
    "edit.rotate-right-90",
    "edit.flip-horizontal",
    "edit.flip-vertical"
  ] as const;
  let enabledCount = 0;
  let disabledCount = 0;
  for (const command of commands) {
    const enabled = await runMenuCommandIfEnabled(page, "edit", command);
    if (enabled) {
      enabledCount += 1;
    } else {
      disabledCount += 1;
    }
  }
  expect(enabledCount + disabledCount).toBe(commands.length);
  expect(disabledCount).toBeGreaterThan(0);
});

test("canvas context menu opens and runs duplicate command", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\draw (0,0) rectangle (2,1);
\end{tikzpicture}`);
  await page.getByRole("button", { name: "Select" }).click();

  const sourceBefore = await readSource(page);
  await selectAllSceneElements(page);
  await clickHitRegion(page, 0, { button: "right" });
  await expect(page.getByTestId("canvas-context-menu")).toBeVisible();
  await page.getByTestId("canvas-context-cmd-edit.duplicate").click();

  await expect.poll(async () => readSource(page)).not.toEqual(sourceBefore);
});

test("group honors editor indent size and supports click drill-down to grouped children", async ({ page }) => {
  await gotoApp(page);
  await openMenuCommand(page, "file", "file.open-settings");
  await page.getByTestId("settings-category-editor").click();
  await page.selectOption("#setting-indent-size", "4");
  await page.getByTestId("settings-modal").getByRole("button", { name: "Close" }).click();

  await setSource(page, String.raw`\begin{tikzpicture}[every node/.style={fill=blue!10}]
  \node[draw] (A) at (-1, -1) {A};
  \node[draw] (B) at (1, -1) {B};
  \draw (-1.35,-2.28) rectangle (2.2,-3.4);
\end{tikzpicture}`);

  await page.evaluate(() => {
    const api = (globalThis as unknown as {
      __TIKZ_EDITOR_APP_TEST_API__?: {
        selectSourceIds?: (sourceIds: string[]) => void;
      };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    api?.selectSourceIds?.(["path:0", "path:1"]);
  });
  await expect.poll(async () => {
    const selected = await readSelectedSourceIds(page);
    return selected.slice().sort();
  }).toEqual(["path:0", "path:1"]);
  const grouped = await runMenuCommandIfEnabled(page, "edit", "edit.group");
  expect(grouped).toBe(true);
  await expect.poll(async () => readStoreSource(page)).toContain("\\begin{scope}");
  await expect.poll(async () => readStoreSource(page)).toContain("\n      \\node[draw] (A) at (-1, -1) {A};");
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["scope:0"]);

  await page.evaluate(() => {
    const api = (globalThis as unknown as {
      __TIKZ_EDITOR_APP_TEST_API__?: {
        clearSelection?: () => void;
      };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    api?.clearSelection?.();
  });
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual([]);

  await clickHitRegionByTargetId(page, "path:1", { button: "right" });
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["scope:0"]);
  await expect(page.getByTestId("canvas-context-menu")).toBeVisible();
  await expect(page.getByTestId("canvas-context-cmd-edit.ungroup")).toBeEnabled();
  await page.keyboard.press("Escape");

  await focusCanvas(page);
  await clickHitRegionByTargetId(page, "path:1");
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["scope:0"]);
  await clickHitRegionByTargetId(page, "path:1", { button: "right" });
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["scope:0"]);
  await expect(page.getByTestId("canvas-context-menu")).toBeVisible();
  await expect(page.getByTestId("canvas-context-cmd-edit.ungroup")).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect.poll(async () => page.getByText("2 selected").isVisible()).toBe(true);
  await openMenuSection(page, "edit");
  await expect(page.getByTestId("menu-cmd-edit.ungroup")).toBeEnabled();
  await page.getByRole("menuitem", { name: "Transform" }).hover();
  await expect(page.getByTestId("menu-cmd-edit.rotate-left-90")).toBeDisabled();
  await expect(page.getByTestId("menu-cmd-edit.rotate-right-90")).toBeDisabled();
  await expect(page.getByTestId("menu-cmd-edit.flip-horizontal")).toBeDisabled();
  await expect(page.getByTestId("menu-cmd-edit.flip-vertical")).toBeDisabled();

  const sourceBeforeScopeGestureDrag = await readStoreSource(page);
  await dragHitRegionByTargetId(page, "path:1", 40, -20);
  await expect.poll(async () => readStoreSource(page)).toEqual(sourceBeforeScopeGestureDrag);

  await clickHitRegionByTargetId(page, "path:1");
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["path:1"]);
  await clickHitRegionByTargetId(page, "path:1", { button: "right" });
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["path:1"]);
  await expect(page.getByTestId("canvas-context-menu")).toBeVisible();
  await expect(page.getByTestId("canvas-context-cmd-edit.ungroup")).toBeDisabled();
  await page.keyboard.press("Escape");
  await clickHitRegionByTargetId(page, "path:1");
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["path:1"]);
  await openMenuSection(page, "edit");
  await expect(page.getByTestId("menu-cmd-edit.ungroup")).toBeDisabled();
});

test("selecting non-resizable multi-edge draw statements does not render an extra selection bbox", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \node[draw] (A) at (-1, -1) {A};
  \node[draw] (B) at (1.5, -0.5) {B};
  \node[draw] (C) at (0, 1.5) {C};
  \draw (A) edge (B)
        (B) edge (C)
        (C) edge (A);
\end{tikzpicture}`);

  await focusCanvas(page);
  await clickHitRegionByTargetId(page, "path:3");
  await expect.poll(async () => readSelectedSourceIds(page)).toEqual(["path:3"]);
  await expect.poll(async () => readSelectionOverlayBoxSourceIds(page)).toEqual([]);
});

test("canvas context menu exposes snapping submenu check states", async ({ page }) => {
  await gotoApp(page);

  await page.getByTestId("canvas-viewport").click({ button: "right" });
  await expect(page.getByTestId("canvas-context-menu")).toBeVisible();

  await page.getByRole("menuitem", { name: "Snapping" }).hover();
  await expect(page.getByTestId("canvas-context-cmd-view.toggle-snap-grid")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("canvas-context-cmd-view.toggle-snap-guides")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("canvas-context-cmd-view.toggle-snap-object-points")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("canvas-context-cmd-view.toggle-snap-object-gaps")).toHaveAttribute("aria-checked", "true");

  await page.getByTestId("canvas-context-cmd-view.toggle-snap-grid").click();
  await page.getByTestId("canvas-viewport").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Snapping" }).hover();
  await expect(page.getByTestId("canvas-context-cmd-view.toggle-snap-grid")).toHaveAttribute("aria-checked", "false");
});

test("canvas drop svg inserts a scope-wrapped import", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);

  await page.evaluate(() => {
    const viewport = document.querySelector("[data-canvas-viewport='true']") as HTMLDivElement | null;
    if (!viewport) {
      throw new Error("Canvas viewport not found.");
    }
    const svg = `<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 12 12\"><path d=\"M1 1 L11 11\" stroke=\"black\"/></svg>`;
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([svg], "drop.svg", { type: "image/svg+xml" }));
    viewport.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
    viewport.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
  });

  await expect.poll(async () => readSource(page)).toContain("\\begin{scope}");
});

test("canvas paste custom svg fallback shows warning for invalid svg data", async ({ page }) => {
  await page.addInitScript(() => {
    const globalLike = globalThis as unknown as {
      __TIKZ_EDITOR_BROWSER_PLATFORM_ENV__?: {
        clipboard?: {
          readCustomText?: (formats: readonly string[]) => Promise<{ format: string; text: string } | null>;
        };
      };
    };
    globalLike.__TIKZ_EDITOR_BROWSER_PLATFORM_ENV__ = {
      clipboard: {
        readCustomText: async (formats) => {
          if (!formats.includes("public.svg-image")) {
            return null;
          }
          return {
            format: "public.svg-image",
            text: "this is not svg"
          };
        }
      }
    };
  });

  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);

  await page.evaluate(() => {
    const viewport = document.querySelector("[data-canvas-viewport='true']") as HTMLDivElement | null;
    if (!viewport) {
      throw new Error("Canvas viewport not found.");
    }
    const dataTransfer = new DataTransfer();
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dataTransfer });
    viewport.dispatchEvent(event);
  });

  await expect.poll(async () => readSource(page)).toContain("\\begin{tikzpicture}");
  await expect(page.getByTestId("canvas-warning-message")).toContainText("SVG import failed:");
});

test("canvas paste custom keynote fallback inserts a scope-wrapped import", async ({ page }) => {
  await page.addInitScript(() => {
    const globalLike = globalThis as unknown as {
      __TIKZ_EDITOR_BROWSER_PLATFORM_ENV__?: {
        clipboard?: {
          readCustomText?: (formats: readonly string[]) => Promise<{ format: string; text: string } | null>;
        };
      };
    };
    globalLike.__TIKZ_EDITOR_BROWSER_PLATFORM_ENV__ = {
      clipboard: {
        readCustomText: async (formats) => {
          if (!formats.includes("com.apple.apps.content-language.canvas-object-1.0")) {
            return null;
          }
          return {
            format: "com.apple.apps.content-language.canvas-object-1.0",
            text: JSON.stringify([{
              type_identifier: "com.apple.apps.content-language.shape",
              identifier: "shape-1",
              stroke: { kind: "empty" },
              geometry: {
                position: { x: 0, y: 0 },
                size: { width: 100, height: 100 }
              }
            }])
          };
        }
      }
    };
  });

  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);

  await page.evaluate(() => {
    const viewport = document.querySelector("[data-canvas-viewport='true']") as HTMLDivElement | null;
    if (!viewport) {
      throw new Error("Canvas viewport not found.");
    }
    const dataTransfer = new DataTransfer();
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dataTransfer });
    viewport.dispatchEvent(event);
  });

  await expect.poll(async () => readSource(page)).toContain("\\begin{scope}");
  await expect(page.getByTestId("canvas-warning-message")).toHaveCount(0);
});

test("canvas paste prefers custom desktop tikz payload over plain text fallback", async ({ page }) => {
  await page.addInitScript(() => {
    const globalLike = globalThis as unknown as {
      __TIKZ_EDITOR_BROWSER_PLATFORM_ENV__?: {
        clipboard?: {
          readCustomText?: (formats: readonly string[]) => Promise<{ format: string; text: string } | null>;
        };
      };
    };
    globalLike.__TIKZ_EDITOR_BROWSER_PLATFORM_ENV__ = {
      clipboard: {
        readCustomText: async (formats) => {
          if (!formats.includes("com.tikzeditor.tikz-json")) {
            return null;
          }
          return {
            format: "com.tikzeditor.tikz-json",
            text: JSON.stringify({
              version: 1,
              snippets: ["\\\\draw (4,4) -- (5,5);"],
              plainText: "\\\\draw (4,4) -- (5,5);",
              pasteBehavior: "offset",
              pasteCount: 2
            })
          };
        }
      }
    };
  });

  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);

  await page.evaluate(() => {
    const viewport = document.querySelector("[data-canvas-viewport='true']") as HTMLDivElement | null;
    if (!viewport) {
      throw new Error("Canvas viewport not found.");
    }
    const dataTransfer = new DataTransfer();
    dataTransfer.setData("text/plain", "\\draw (0,0) -- (1,1);");
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dataTransfer });
    viewport.dispatchEvent(event);
  });

  await expect.poll(async () => readSource(page)).toContain("\\draw (4,4) -- (5,5);");
  await expect(page.locator(".cm-content").first()).not.toContainText("\\draw (0,0) -- (1,1);");
});

test("view menu check-state toggles for grid, snapping modes, rulers and guides", async ({ page }) => {
  await gotoApp(page);

  await openMenuSection(page, "view");
  await expect(page.getByTestId("menu-cmd-view.toggle-grid")).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitem", { name: "Snapping" }).hover();
  await expect(page.getByTestId("menu-cmd-view.toggle-snap-grid")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("menu-cmd-view.toggle-snap-guides")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("menu-cmd-view.toggle-snap-object-points")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("menu-cmd-view.toggle-snap-object-gaps")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("menu-cmd-view.toggle-rulers")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("menu-cmd-view.toggle-guides")).toHaveAttribute("aria-checked", "true");

  await openMenuCommand(page, "view", "view.toggle-grid");
  await openMenuCommand(page, "view", "view.toggle-snap-grid");
  await openMenuCommand(page, "view", "view.toggle-snap-guides");
  await openMenuCommand(page, "view", "view.toggle-snap-object-points");
  await openMenuCommand(page, "view", "view.toggle-snap-object-gaps");
  await openMenuCommand(page, "view", "view.toggle-rulers");
  await openMenuCommand(page, "view", "view.toggle-guides");

  await openMenuSection(page, "view");
  await expect(page.getByTestId("menu-cmd-view.toggle-grid")).toHaveAttribute("aria-checked", "false");
  await page.getByRole("menuitem", { name: "Snapping" }).hover();
  await expect(page.getByTestId("menu-cmd-view.toggle-snap-grid")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("menu-cmd-view.toggle-snap-guides")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("menu-cmd-view.toggle-snap-object-points")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("menu-cmd-view.toggle-snap-object-gaps")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("menu-cmd-view.toggle-rulers")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByTestId("menu-cmd-view.toggle-guides")).toHaveAttribute("aria-checked", "false");
});

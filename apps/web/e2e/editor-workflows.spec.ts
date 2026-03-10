import { expect, test, type Page } from "@playwright/test";

function tabSwitchButtons(page: Page) {
  return page.locator("[data-testid^='tab-switch-']");
}

async function openMenuCommand(page: Page, section: "file" | "edit" | "insert" | "view", commandId: string) {
  await page.getByTestId(`menu-section-${section}`).click();
  if (section === "file" && commandId.startsWith("file.export-")) {
    await page.getByRole("menuitem", { name: "Export" }).hover();
  }
  await page.getByTestId(`menu-cmd-${commandId}`).click();
}

async function setSource(page: Page, source: string) {
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(source);
}

async function readSource(page: Page): Promise<string> {
  const text = await page.locator(".cm-content").first().textContent();
  return text ?? "";
}

async function readPersistedWorkspaceDocumentCount(page: Page): Promise<number> {
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

async function canvasViewport(page: Page) {
  return page.locator("[data-canvas-viewport='true']");
}

async function interactionLayer(page: Page) {
  return page.locator("[data-canvas-viewport='true'] svg").last();
}

async function dragBetweenPoints(
  page: Page,
  target: ReturnType<Page["locator"]>,
  start: { x: number; y: number },
  end: { x: number; y: number }
) {
  const box = await target.boundingBox();
  if (!box) {
    throw new Error("Missing drag target bounds.");
  }
  await page.mouse.move(box.x + start.x, box.y + start.y);
  await page.mouse.down();
  await page.mouse.move(box.x + end.x, box.y + end.y, { steps: 8 });
}

async function dragLocatorBy(page: Page, locator: ReturnType<Page["locator"]>, dx: number, dy: number) {
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

test("boots with one tab and supports new/switch/close-all workflows", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("tab-strip")).toBeVisible();
  await expect(tabSwitchButtons(page)).toHaveCount(1);
  await expect(page.getByTestId("styles-tab")).toBeVisible();

  await openMenuCommand(page, "file", "file.new-document");
  await expect(tabSwitchButtons(page)).toHaveCount(2);

  await tabSwitchButtons(page).first().click();
  await expect(page.locator("[role='tab'][aria-selected='true']")).toHaveCount(1);

  await openMenuCommand(page, "file", "file.close-all-documents");
  await expect(tabSwitchButtons(page)).toHaveCount(1);
});

test("keeps sources isolated per tab and restores workspace on reload", async ({ page }) => {
  await page.goto("/");
  await setSource(page, "\\draw (0,0)--(1,0); % doc1");
  await openMenuCommand(page, "file", "file.new-document");
  await setSource(page, "\\draw (2,0)--(3,0); % doc2");

  await tabSwitchButtons(page).first().click();
  await expect.poll(async () => readSource(page)).toContain("% doc1");
  await tabSwitchButtons(page).nth(1).click();
  await expect.poll(async () => readSource(page)).toContain("% doc2");
  await expect.poll(async () => readPersistedWorkspaceDocumentCount(page)).toBe(2);

  await page.reload();
  await expect(tabSwitchButtons(page)).toHaveCount(2);
  await tabSwitchButtons(page).first().click();
  await expect.poll(async () => readSource(page)).toContain("% doc1");
});

test("open example defaults to opening a new tab", async ({ page }) => {
  await page.goto("/");
  await expect(tabSwitchButtons(page)).toHaveCount(1);
  const before = await tabSwitchButtons(page).count();
  await openMenuCommand(page, "file", "file.open-example");
  await expect(page.getByTestId("open-example-modal")).toBeVisible();
  await page.locator("[data-testid^='open-example-card-']").first().click();
  await expect(tabSwitchButtons(page)).toHaveCount(before + 1);
});

test("fallback save path triggers browser download", async ({ page }) => {
  await page.addInitScript(() => {
    const globalLike = globalThis as unknown as Record<string, unknown>;
    delete globalLike.showOpenFilePicker;
    delete globalLike.showSaveFilePicker;
  });
  await page.goto("/");
  await setSource(page, "\\draw (0,0)--(2,2); % save-fallback");

  const downloadPromise = page.waitForEvent("download");
  await openMenuCommand(page, "file", "file.save-document");
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain(".tex");
});

test("fallback open path uses file input and loads content", async ({ page }) => {
  await page.addInitScript(() => {
    const globalLike = globalThis as unknown as Record<string, unknown>;
    delete globalLike.showOpenFilePicker;
    delete globalLike.showSaveFilePicker;

    const originalClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function clickPatched(this: HTMLInputElement) {
      if (this.type === "file") {
        const file = new File(["\\\\draw (7,7)--(8,8); % fallback-open"], "fallback-open.tex", { type: "text/plain" });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        Object.defineProperty(this, "files", {
          configurable: true,
          get: () => dataTransfer.files
        });
        this.dispatchEvent(new Event("change"));
        return;
      }
      originalClick.call(this);
    };
  });

  await page.goto("/");
  await openMenuCommand(page, "file", "file.open-document");
  await expect.poll(async () => readSource(page)).toContain("% fallback-open");
});

test("fallback open path imports svg as a new tikz document", async ({ page }) => {
  await page.addInitScript(() => {
    const globalLike = globalThis as unknown as Record<string, unknown>;
    delete globalLike.showOpenFilePicker;
    delete globalLike.showSaveFilePicker;

    const originalClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function clickPatched(this: HTMLInputElement) {
      if (this.type === "file") {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="red"/></svg>`;
        const file = new File([svg], "fallback-open.svg", { type: "image/svg+xml" });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        Object.defineProperty(this, "files", {
          configurable: true,
          get: () => dataTransfer.files
        });
        this.dispatchEvent(new Event("change"));
        return;
      }
      originalClick.call(this);
    };
  });

  await page.goto("/");
  await openMenuCommand(page, "file", "file.open-document");
  await expect.poll(async () => readSource(page)).toContain("\\begin{tikzpicture}");
});

test("file import svg command imports svg as a new tikz document", async ({ page }) => {
  await page.addInitScript(() => {
    const globalLike = globalThis as unknown as Record<string, unknown>;
    delete globalLike.showOpenFilePicker;
    delete globalLike.showSaveFilePicker;

    const originalClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function clickPatched(this: HTMLInputElement) {
      if (this.type === "file") {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect x="2" y="2" width="16" height="16" fill="blue"/></svg>`;
        const file = new File([svg], "menu-import.svg", { type: "image/svg+xml" });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        Object.defineProperty(this, "files", {
          configurable: true,
          get: () => dataTransfer.files
        });
        this.dispatchEvent(new Event("change"));
        return;
      }
      originalClick.call(this);
    };
  });

  await page.goto("/");
  await openMenuCommand(page, "file", "file.import-svg");
  await expect.poll(async () => readSource(page)).toContain("\\begin{tikzpicture}");
});

test("fs-api save/open flows with rebinding and permission fallback", async ({ page }) => {
  await page.addInitScript(() => {
    type PermissionMode = "read" | "readwrite";
    const writes: string[] = [];
    const openedText = "\\draw (9,9)--(10,10); % opened";
    const createHandle = (name: string, allowWrite: { value: boolean }) => ({
      name,
      queryPermission: async ({ mode }: { mode: PermissionMode }) => {
        if (mode === "read") return "granted";
        return allowWrite.value ? "granted" : "prompt";
      },
      requestPermission: async ({ mode }: { mode: PermissionMode }) => {
        if (mode === "read") return "granted";
        allowWrite.value = true;
        return "granted";
      },
      getFile: async () => ({ text: async () => openedText }),
      createWritable: async () => ({
        write: async (value: string) => {
          writes.push(value);
        },
        close: async () => undefined
      })
    });

    let allowWrite = { value: true };
    const saveHandle = createHandle("bound.tex", allowWrite);
    const memoryStore = new Map<string, unknown>();

    (globalThis as unknown as { __TIKZ_EDITOR_BROWSER_PLATFORM_ENV__: unknown }).__TIKZ_EDITOR_BROWSER_PLATFORM_ENV__ = {
      fsApi: {
        showOpenFilePicker: async () => [createHandle("opened.tex", { value: true })],
        showSaveFilePicker: async () => saveHandle
      },
      fsHandleStore: {
        load: async (id: string) => memoryStore.get(id) ?? null,
        save: async (id: string, handle: unknown) => {
          memoryStore.set(id, handle);
        }
      }
    };

    (globalThis as unknown as { __PW_FSA_WRITES__: string[] }).__PW_FSA_WRITES__ = writes;
    (globalThis as unknown as { __PW_FSA_DENY_NEXT__: () => void }).__PW_FSA_DENY_NEXT__ = () => {
      allowWrite.value = false;
    };
  });

  await page.goto("/");
  await setSource(page, "\\draw (1,1)--(2,2); % fs-save");
  await openMenuCommand(page, "file", "file.save-document-as");
  await openMenuCommand(page, "file", "file.save-document");

  const writesAfterNormalSave = await page.evaluate(() => {
    return (globalThis as unknown as { __PW_FSA_WRITES__?: string[] }).__PW_FSA_WRITES__ ?? [];
  });
  expect(writesAfterNormalSave.length).toBeGreaterThanOrEqual(2);

  await page.evaluate(() => {
    (globalThis as unknown as { __PW_FSA_DENY_NEXT__?: () => void }).__PW_FSA_DENY_NEXT__?.();
  });
  await openMenuCommand(page, "file", "file.save-document");
  const writesAfterPermissionRecovery = await page.evaluate(() => {
    return (globalThis as unknown as { __PW_FSA_WRITES__?: string[] }).__PW_FSA_WRITES__ ?? [];
  });
  expect(writesAfterPermissionRecovery.length).toBeGreaterThanOrEqual(3);

  await openMenuCommand(page, "file", "file.open-document");
  await expect.poll(async () => readSource(page)).toContain("% opened");
});

test("export commands smoke", async ({ page }) => {
  await page.goto("/");
  await openMenuCommand(page, "file", "file.export-svg-download");
  await expect(page.getByRole("heading", { name: "Export SVG" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Export SVG" })).toHaveCount(0);

  await openMenuCommand(page, "file", "file.export-png-download");
  await expect(page.getByRole("heading", { name: "Export PNG" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Export PNG" })).toHaveCount(0);

  const pdfDownload = page.waitForEvent("download");
  await openMenuCommand(page, "file", "file.export-pdf-download");
  await pdfDownload;

  const latexDownload = page.waitForEvent("download");
  await openMenuCommand(page, "file", "file.export-standalone-latex-download");
  await latexDownload;
});

test("canvas drop svg inserts a scope-wrapped import", async ({ page }) => {
  await page.goto("/");
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);

  await page.evaluate(() => {
    const viewport = document.querySelector("[data-canvas-viewport='true']") as HTMLDivElement | null;
    if (!viewport) {
      throw new Error("Canvas viewport not found.");
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><path d="M1 1 L11 11" stroke="black"/></svg>`;
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([svg], "drop.svg", { type: "image/svg+xml" }));
    viewport.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
    viewport.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
  });

  await expect.poll(async () => readSource(page)).toContain("\\begin{scope}");
});

test("canvas paste svg file inserts a scope-wrapped import", async ({ page }) => {
  await page.goto("/");
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);

  await page.evaluate(() => {
    const viewport = document.querySelector("[data-canvas-viewport='true']") as HTMLDivElement | null;
    if (!viewport) {
      throw new Error("Canvas viewport not found.");
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4" fill="none" stroke="black"/></svg>`;
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([svg], "paste.svg", { type: "image/svg+xml" }));
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dataTransfer });
    viewport.dispatchEvent(event);
  });

  await expect.poll(async () => readSource(page)).toContain("\\begin{scope}");
});

test("canvas paste falls back to custom desktop svg clipboard format", async ({ page }) => {
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
            text: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" fill="none" stroke="black"/></svg>`
          };
        }
      }
    };
  });

  await page.goto("/");
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

  await page.goto("/");
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
  await expect(page.locator("[aria-label='Warning message. Click to copy.']")).toContainText("SVG import failed:");
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

  await page.goto("/");
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

test("resize drag shows and hides metric tooltip", async ({ page }) => {
  await page.goto("/");
  await setSource(page, String.raw`\begin{tikzpicture}
\filldraw[fill=blue!20] (0,0) rectangle (4,2);
\end{tikzpicture}`);

  const viewport = await canvasViewport(page);
  const viewportBox = await viewport.boundingBox();
  if (!viewportBox) {
    throw new Error("Canvas viewport not found.");
  }

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
  await page.goto("/");
  await setSource(page, String.raw`\begin{tikzpicture}
\filldraw[fill=blue!20] (0,0) rectangle (4,2);
\end{tikzpicture}`);

  const viewport = await canvasViewport(page);
  const viewportBox = await viewport.boundingBox();
  if (!viewportBox) {
    throw new Error("Canvas viewport not found.");
  }

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

test("rectangle creation shows width and height tooltip", async ({ page }) => {
  await page.goto("/");
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);
  await page.getByRole("button", { name: "Rect" }).click();

  const layer = await interactionLayer(page);
  await expect(layer).toBeVisible();
  await dragBetweenPoints(page, layer, { x: 120, y: 120 }, { x: 280, y: 240 });

  await expect(page.getByTestId("canvas-drag-tooltip-shell")).toBeVisible();
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText("Width:");
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText("Height:");

  await page.mouse.up();
  await expect(page.getByTestId("canvas-drag-tooltip-shell")).toHaveCount(0);
});

test("grid creation shows counts and stays within viewport bounds", async ({ page }) => {
  await page.goto("/");
  await setSource(page, String.raw`\begin{tikzpicture}
\end{tikzpicture}`);
  await page.getByRole("button", { name: "Grid" }).click();

  const viewport = await canvasViewport(page);
  const layer = await interactionLayer(page);
  await expect(layer).toBeVisible();
  const viewportBox = await viewport.boundingBox();
  const layerBox = await layer.boundingBox();
  if (!viewportBox) {
    throw new Error("Canvas viewport not found.");
  }
  if (!layerBox) {
    throw new Error("Canvas interaction layer not found.");
  }

  await dragBetweenPoints(page, layer, { x: layerBox.width - 90, y: layerBox.height - 90 }, { x: layerBox.width - 10, y: layerBox.height - 10 });

  const tooltip = page.getByTestId("canvas-drag-tooltip-shell");
  await expect(tooltip).toBeVisible();
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText("Width:");
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText("Height:");
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText("Cells:");
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText("col");
  await expect(page.getByTestId("canvas-drag-tooltip")).toContainText("row");

  const tooltipBox = await tooltip.boundingBox();
  if (!tooltipBox) {
    throw new Error("Tooltip bounds missing.");
  }
  expect(tooltipBox.x).toBeGreaterThanOrEqual(viewportBox.x);
  expect(tooltipBox.y).toBeGreaterThanOrEqual(viewportBox.y);
  expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(viewportBox.x + viewportBox.width);
  expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(viewportBox.y + viewportBox.height);

  await page.mouse.up();
  await expect(tooltip).toHaveCount(0);
});

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

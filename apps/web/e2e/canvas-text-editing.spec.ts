import { expect, test, type Page } from "@playwright/test";
import {
  clickTextHitRegionByTargetId,
  gotoApp,
  readSelectedSourceIds,
  readStoreSource,
  resetStorageBeforeNavigation,
  setSource,
  waitForHitRegions
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

const PRIMARY_MOD = process.platform === "darwin" ? "Meta" : "Control";

async function setTextareaSelection(page: Page, start: number, end: number): Promise<void> {
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await textarea.evaluate((element, selection) => {
    const [nextStart, nextEnd] = selection as [number, number];
    const textareaElement = element as HTMLTextAreaElement;
    textareaElement.focus();
    textareaElement.setSelectionRange(nextStart, nextEnd);
    textareaElement.dispatchEvent(new Event("select", { bubbles: true }));
  }, [start, end]);
}

async function readTextareaSelection(page: Page): Promise<{ start: number | null; end: number | null }> {
  return await page.getByTestId("canvas-text-edit-textarea").evaluate((element) => {
    const textareaElement = element as HTMLTextAreaElement;
    return {
      start: textareaElement.selectionStart,
      end: textareaElement.selectionEnd
    };
  });
}

async function readTextareaSelectedText(page: Page): Promise<string> {
  return await page.getByTestId("canvas-text-edit-textarea").evaluate((element) => {
    const textareaElement = element as HTMLTextAreaElement;
    const start = textareaElement.selectionStart ?? 0;
    const end = textareaElement.selectionEnd ?? start;
    return textareaElement.value.slice(start, end);
  });
}

test("single-line node text enters canvas edit mode and closes when CodeMirror takes focus", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node at (0,0) {Hello};
\end{tikzpicture}`);

  const textRegion = page.locator("[data-hit-region-target-id='path:0'][data-hit-region-interaction-mode='text']").first();
  await expect(textRegion).toBeVisible();
  await textRegion.hover();
  await expect.poll(async () => textRegion.evaluate((element) => getComputedStyle(element).cursor)).toBe("text");

  await clickTextHitRegionByTargetId(page, "path:0");

  const popup = page.getByTestId("canvas-text-edit-popup");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(popup).toBeVisible();
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue("Hello");
  await expect(page.getByTestId("canvas-text-selection-overlay")).toBeVisible();
  await expect.poll(async () => await readSelectedSourceIds(page)).toEqual(["path:0"]);

  await textarea.fill("Hello world");
  await expect.poll(async () => await readStoreSource(page)).toContain("{Hello world}");

  const sourceEditor = page.locator(".cm-editor").first();
  await sourceEditor.click();
  await expect(popup).toBeHidden();
  await expect(page.getByTestId("canvas-text-selection-overlay")).toHaveCount(0);
});

test("single-line nodes without text width support spaces, backspace, and textarea-driven selection sync", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[draw] at (0,0) {Hello World};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");

  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toHaveValue("Hello World");
  await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(1);
  await expect(page.getByTestId("canvas-text-selection-rect")).toHaveCount(0);

  await setTextareaSelection(page, 0, 5);
  await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(0);
  await expect.poll(async () => page.getByTestId("canvas-text-selection-rect").count()).toBeGreaterThan(0);

  await setTextareaSelection(page, "Hello World".length, "Hello World".length);
  await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(1);
  await expect(page.getByTestId("canvas-text-selection-rect")).toHaveCount(0);

  await textarea.press("Backspace");
  await expect(textarea).toHaveValue("Hello Worl");
  await expect.poll(async () => await readStoreSource(page)).toContain("{Hello Worl}");
});

test("arrow keys and cmd/ctrl+a stay scoped to the popup textarea while editing", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node at (0,0) {Hello World};
\node at (2,0) {Other};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");

  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toHaveValue("Hello World");
  await expect.poll(async () => await readSelectedSourceIds(page)).toEqual(["path:0"]);

  await setTextareaSelection(page, "Hello World".length, "Hello World".length);
  await textarea.press("ArrowLeft");
  await expect.poll(async () => await readTextareaSelection(page)).toEqual({
    start: "Hello World".length - 1,
    end: "Hello World".length - 1
  });
  await expect.poll(async () => await readStoreSource(page)).toContain("{Hello World}");

  await textarea.press(`${PRIMARY_MOD}+A`);
  await expect.poll(async () => await readTextareaSelection(page)).toEqual({
    start: 0,
    end: "Hello World".length
  });
  await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(0);
  await expect.poll(async () => page.getByTestId("canvas-text-selection-rect").count()).toBeGreaterThan(0);
  await expect.poll(async () => await readSelectedSourceIds(page)).toEqual(["path:0"]);
});

test("double click selects a single word in canvas edit mode", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node at (0,0) {Hello World Again};
\end{tikzpicture}`);

  const textRegion = page.locator("[data-hit-region-target-id='path:0'][data-hit-region-interaction-mode='text']").first();
  await expect(textRegion).toBeVisible();
  const box = await textRegion.boundingBox();
  if (!box) {
    throw new Error("Missing single-line text hit-region bounds.");
  }

  await textRegion.click({
    clickCount: 2,
    position: {
      x: box.width * 0.5,
      y: box.height / 2
    }
  });
  await expect(page.getByTestId("canvas-text-edit-textarea")).toBeVisible();
  await expect(page.getByTestId("canvas-text-edit-textarea")).toBeFocused();
  await expect.poll(async () => await readTextareaSelectedText(page)).toMatch(/^\S+$/);
  await expect.poll(async () => await readTextareaSelectedText(page)).not.toBe("Hello World Again");
});

test("typing at the end of node text keeps the textarea caret after the inserted character", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node at (0,0) {Hello};
\end{tikzpicture}`);

  const textRegion = page.locator("[data-hit-region-target-id='path:0'][data-hit-region-interaction-mode='text']").first();
  await expect(textRegion).toBeVisible();
  const box = await textRegion.boundingBox();
  if (!box) {
    throw new Error("Missing single-line text hit-region bounds.");
  }

  await page.mouse.click(box.x + box.width - 1, box.y + box.height / 2);
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeFocused();
  await expect.poll(async () => await readTextareaSelection(page)).toEqual({
    start: "Hello".length,
    end: "Hello".length
  });

  await page.keyboard.type("!");
  await expect(textarea).toHaveValue("Hello!");
  await expect.poll(async () => await readTextareaSelection(page)).toEqual({
    start: "Hello!".length,
    end: "Hello!".length
  });
  await expect.poll(async () => await readStoreSource(page)).toContain("{Hello!}");
});

test("deleting all node text keeps the popup open so new text can be entered", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node at (0,0) {Hello};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeFocused();

  await textarea.press(`${PRIMARY_MOD}+A`);
  await textarea.press("Backspace");
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue("");
  await expect.poll(async () => await readStoreSource(page)).toContain("{}");

  await page.keyboard.type("New");
  await expect(textarea).toHaveValue("New");
  await expect.poll(async () => await readStoreSource(page)).toContain("{New}");
});

test("transient MathJax syntax errors keep canvas edit mode active", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node at (0,0) {Hello};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeFocused();

  await textarea.press(`${PRIMARY_MOD}+A`);
  await page.keyboard.type("$");
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue("$");

  await page.keyboard.type("x");
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue("$x");

  await page.keyboard.type("$");
  await expect(textarea).toHaveValue("$x$");
  await expect.poll(async () => await readStoreSource(page)).toContain("{$x$}");
});

test("fallback-rendered invalid MathJax text still enters canvas edit mode", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node at (0,0) {$};
\end{tikzpicture}`);

  const textRegion = page.locator("[data-hit-region-target-id='path:0'][data-hit-region-interaction-mode='text']").first();
  await expect(textRegion).toBeVisible();
  await expect.poll(async () => textRegion.evaluate((element) => getComputedStyle(element).cursor)).toBe("text");

  await clickTextHitRegionByTargetId(page, "path:0");
  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue("$");

  await page.keyboard.type("x$");
  await expect(textarea).toHaveValue("$x$");
  await expect.poll(async () => await readStoreSource(page)).toContain("{$x$}");
});

test("wrapped text-width nodes enter canvas edit mode and update source through the popup textarea", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[text width=3cm,align=center] at (0,0) {Hello wrapped world};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");

  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeVisible();
  await expect(textarea).toHaveValue("Hello wrapped world");

  await textarea.fill("Hello wrapped world with more text");
  await expect
    .poll(async () => await readStoreSource(page))
    .toContain("{Hello wrapped world with more text}");
});

test("wrapped text selection sync produces multiple canvas highlight rects", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[text width=1.6cm,align=center] at (0,0) {Hello wrapped world with more text};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");
  await expect(page.getByTestId("canvas-text-edit-textarea")).toHaveValue("Hello wrapped world with more text");

  await setTextareaSelection(page, 0, "Hello wrapped world with more text".length);
  await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(0);
  await expect.poll(async () => page.getByTestId("canvas-text-selection-rect").count()).toBeGreaterThan(1);
});

test("explicit multiline node text with align and \\\\ edits from the canvas popup", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[align=center] at (0,0) {First\\Second};
\end{tikzpicture}`);

  await waitForHitRegions(page, 1);
  await clickTextHitRegionByTargetId(page, "path:0");

  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toHaveValue(String.raw`First\\Second`);

  await textarea.fill(String.raw`First\\Third`);
  await expect
    .poll(async () => await readStoreSource(page))
    .toContain(String.raw`{First\\Third}`);
});

test("explicit multiline textarea selection stays synced to a multi-line canvas selection", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[align=center] at (0,0) {First\\Second};
\end{tikzpicture}`);

  await clickTextHitRegionByTargetId(page, "path:0");
  await expect(page.getByTestId("canvas-text-edit-textarea")).toHaveValue(String.raw`First\\Second`);

  await setTextareaSelection(page, 0, String.raw`First\\Second`.length);
  await expect(page.getByTestId("canvas-text-selection-caret")).toHaveCount(0);
  await expect.poll(async () => page.getByTestId("canvas-text-selection-rect").count()).toBeGreaterThan(1);
});

test("filled nodes still enter text edit mode from the text region and remain draggable from the move region", async ({ page }) => {
  await gotoApp(page);
  const initialSource = String.raw`\begin{tikzpicture}
\node[draw,fill=yellow!20,inner sep=12pt,minimum width=3cm,minimum height=1.5cm] at (0,0) {Hello World};
\end{tikzpicture}`;
  await setSource(page, initialSource);

  await clickTextHitRegionByTargetId(page, "path:0");
  await expect(page.getByTestId("canvas-text-edit-textarea")).toHaveValue("Hello World");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("canvas-text-edit-popup")).toHaveCount(0);

  const outerRegion = page.locator("[data-hit-region-target-id='path:0']").first();
  const textRegion = page.locator("[data-hit-region-target-id='path:0'][data-hit-region-interaction-mode='text']").first();
  const outerBox = await outerRegion.boundingBox();
  const textBox = await textRegion.boundingBox();
  if (!outerBox || !textBox) {
    throw new Error("Missing filled-node hit-region bounds.");
  }
  const startX = outerBox.x + outerBox.width / 2;
  const startY = Math.min(textBox.y - 8, outerBox.y + 12);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 48, startY - 32, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => await readStoreSource(page)).not.toBe(initialSource);
  await expect.poll(async () => await readStoreSource(page)).toContain("{Hello World}");
});

test("clicking rendered wrapped text updates the textarea selection", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node[text width=3cm,align=center] at (0,0) {Hello wrapped world};
\end{tikzpicture}`);

  const textRegion = page.locator("[data-hit-region-target-id='path:0'][data-hit-region-interaction-mode='text']").first();
  const box = await textRegion.boundingBox();
  if (!box) {
    throw new Error("Missing wrapped text hit-region bounds.");
  }

  await page.mouse.click(box.x + 8, box.y + box.height / 2);
  const initialSelection = await readTextareaSelection(page);
  await expect(page.getByTestId("canvas-text-edit-textarea")).toBeVisible();

  await page.mouse.click(box.x + box.width - 8, box.y + box.height / 2);
  await expect.poll(async () => await readTextareaSelection(page)).not.toEqual(initialSelection);
});

test("dragging across rendered MathJax node text creates a canvas selection in Chrome", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
\node at (0,0) {$x^2 + y^2 = z^2$};
\end{tikzpicture}`);

  const textRegion = page.locator("[data-hit-region-target-id='path:0'][data-hit-region-interaction-mode='text']").first();
  await expect(textRegion).toBeVisible();
  const box = await textRegion.boundingBox();
  if (!box) {
    throw new Error("Missing MathJax text hit-region bounds.");
  }

  const startX = box.x + 10;
  const startY = box.y + box.height / 2;
  const endX = box.x + box.width - 10;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, startY, { steps: 12 });
  await page.mouse.up();

  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeFocused();
  await expect.poll(async () => {
    const selection = await readTextareaSelection(page);
    return selection.start != null && selection.end != null && selection.end > selection.start;
  }).toBe(true);
  await expect.poll(async () => page.getByTestId("canvas-text-selection-rect").count()).toBeGreaterThan(0);
});

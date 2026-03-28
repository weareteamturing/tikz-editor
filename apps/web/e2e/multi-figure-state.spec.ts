import { expect, test, type Page } from "@playwright/test";
import {
  gotoApp,
  readCanvasTransform,
  readFigureCount,
  resetStorageBeforeNavigation,
  setCanvasTransform,
  setSource,
  tabSwitchButtons
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

async function disableFitModeByZoom(page: Page): Promise<void> {
  await expect(page.getByTestId("canvas-viewport")).toBeVisible();
  const before = await readCanvasTransform(page);
  await page.evaluate(() => {
    const viewport = document.querySelector("[data-testid='canvas-viewport']");
    if (!(viewport instanceof HTMLElement)) {
      throw new Error("Canvas viewport not found.");
    }
    const rect = viewport.getBoundingClientRect();
    viewport.dispatchEvent(new WheelEvent("wheel", {
      deltaY: -120,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    }));
  });
  await expect.poll(async () => {
    const after = await readCanvasTransform(page);
    return Math.abs(after.scale - before.scale) > 0.0001;
  }, {
    timeout: 2_000,
    intervals: [50, 100, 200]
  }).toBe(true);
}

function figuresSource(count: number, label: string): string {
  return Array.from({ length: count }, (_, index) => String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {${label} ${index + 1}};
\end{tikzpicture}`).join("\n");
}

test("viewport is remembered per figure and first visit auto-fits", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \draw (-0.5,-0.5) rectangle (0.5,0.5);
\end{tikzpicture}
\begin{tikzpicture}
  \draw (-8,-5) rectangle (8,5);
\end{tikzpicture}
`);

  await expect.poll(async () => readFigureCount(page)).toBe(2);
  await expect(page.getByTestId("figure-navigator")).toBeVisible();

  await disableFitModeByZoom(page);
  const figure1Transform = { translateX: 130, translateY: 70, scale: 1.8 };
  await setCanvasTransform(page, figure1Transform);

  await page.getByRole("button", { name: "Figure 2" }).click();

  await expect.poll(async () => {
    const transform = await readCanvasTransform(page);
    const sameX = Math.abs(transform.translateX - figure1Transform.translateX) < 0.05;
    const sameY = Math.abs(transform.translateY - figure1Transform.translateY) < 0.05;
    const sameScale = Math.abs(transform.scale - figure1Transform.scale) < 0.005;
    return !(sameX && sameY && sameScale);
  }).toBe(true);

  await disableFitModeByZoom(page);
  const figure2Transform = { translateX: 25, translateY: 48, scale: 0.82 };
  await setCanvasTransform(page, figure2Transform);

  await page.getByRole("button", { name: "Figure 1" }).click();
  await expect.poll(async () => {
    const transform = await readCanvasTransform(page);
    return (
      Math.abs(transform.translateX - figure1Transform.translateX) < 0.05 &&
      Math.abs(transform.translateY - figure1Transform.translateY) < 0.05 &&
      Math.abs(transform.scale - figure1Transform.scale) < 0.005
    );
  }).toBe(true);

  await page.getByRole("button", { name: "Figure 2" }).click();
  await expect.poll(async () => {
    const transform = await readCanvasTransform(page);
    return (
      Math.abs(transform.translateX - figure2Transform.translateX) < 0.05 &&
      Math.abs(transform.translateY - figure2Transform.translateY) < 0.05 &&
      Math.abs(transform.scale - figure2Transform.scale) < 0.005
    );
  }, {
    timeout: 4_000,
    intervals: [50, 100, 200, 400]
  }).toBe(true);
});

test("carousel remembers scroll position per document across tab switches", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, figuresSource(14, "Doc A"));
  await expect.poll(async () => readFigureCount(page)).toBe(14);

  await page.evaluate(() => {
    const strip = document.querySelector("[data-testid='figure-navigator-strip']");
    if (!(strip instanceof HTMLElement)) {
      throw new Error("Figure navigator strip not found.");
    }
    strip.scrollLeft = 900;
    strip.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await page.getByTestId("tab-new").click();
  await setSource(page, figuresSource(12, "Doc B"));
  await expect.poll(async () => readFigureCount(page)).toBe(12);

  await page.evaluate(() => {
    const strip = document.querySelector("[data-testid='figure-navigator-strip']");
    if (!(strip instanceof HTMLElement)) {
      throw new Error("Figure navigator strip not found.");
    }
    strip.scrollLeft = 320;
    strip.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await expect(tabSwitchButtons(page)).toHaveCount(2);
  await tabSwitchButtons(page).nth(0).click();
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const strip = document.querySelector("[data-testid='figure-navigator-strip']");
      return strip instanceof HTMLElement ? strip.scrollLeft : -1;
    });
  }).toBeGreaterThan(850);

  await tabSwitchButtons(page).nth(1).click();
  await expect.poll(async () => {
    return await page.evaluate(() => {
      const strip = document.querySelector("[data-testid='figure-navigator-strip']");
      return strip instanceof HTMLElement ? strip.scrollLeft : -1;
    });
  }).toBeGreaterThan(280);
});

test("switching documents clears old thumbnails immediately", async ({ page }) => {
  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {DocA-1};
\end{tikzpicture}
\begin{tikzpicture}
  \node[draw] at (0,0) {$x^2 + y^2$};
\end{tikzpicture}
`);
  await expect.poll(async () => readFigureCount(page)).toBe(2);
  await expect(page.getByTestId("figure-navigator")).toBeVisible();
  await expect.poll(async () => page.getByTestId("figure-navigator").locator("img").count()).toBe(2);

  const firstDocThumbnailSrc = await page.getByTestId("figure-navigator").locator("img").first().getAttribute("src");
  expect(firstDocThumbnailSrc).toBeTruthy();

  await page.getByTestId("tab-new").click();
  await setSource(page, figuresSource(10, "Doc B thumb"));
  await expect.poll(async () => readFigureCount(page)).toBe(10);

  const hasOldThumbnail = await page.evaluate((oldSrc) => {
    const images = Array.from(document.querySelectorAll("[data-testid='figure-navigator'] img"));
    return images.some((image) => image.getAttribute("src") === oldSrc);
  }, firstDocThumbnailSrc);
  expect(hasOldThumbnail).toBe(false);

  await expect(page.getByTestId("figure-navigator").getByText("Rendering…").first()).toBeVisible();
  await expect.poll(async () => page.getByTestId("figure-navigator").locator("img").count()).toBeGreaterThan(0);
});

import { expect, test } from "@playwright/test";
import { gotoApp, readFigureCount, resetStorageBeforeNavigation, setSource } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

test("figure thumbnails render math text through worker pipeline", async ({ page }) => {
  await page.addInitScript(() => {
    const originalWorker = window.Worker;
    const workerPosts: string[] = [];
    class SpyWorker extends originalWorker {
      postMessage(message: unknown, transfer?: Transferable[]): void {
        const type = (message as { type?: unknown } | null)?.type;
        workerPosts.push(typeof type === "string" ? type : "unknown");
        super.postMessage(message, transfer ?? []);
      }
    }
    Object.defineProperty(window, "Worker", {
      configurable: true,
      writable: true,
      value: SpyWorker
    });
    (globalThis as { __PW_THUMB_WORKER_POSTS__?: string[] }).__PW_THUMB_WORKER_POSTS__ = workerPosts;
  });

  await gotoApp(page);
  await setSource(page, String.raw`\begin{tikzpicture}
  \node at (0,0) {Plain};
\end{tikzpicture}
\begin{tikzpicture}
  \node at (0,0) {$x$};
\end{tikzpicture}
`);

  await expect.poll(async () => readFigureCount(page)).toBe(2);
  await expect(page.getByTestId("figure-navigator")).toBeVisible();
  await expect.poll(async () => page.getByTestId("figure-navigator").locator("img").count()).toBe(2);

  await expect.poll(async () => {
    return await page.evaluate(() => {
      const images = Array.from(document.querySelectorAll("[data-testid='figure-navigator'] img"));
      return images.some((img) => {
        const src = img.getAttribute("src") ?? "";
        if (!src.includes(",")) {
          return false;
        }
        const payload = decodeURIComponent(src.slice(src.indexOf(",") + 1));
        return payload.includes('data-text-renderer="mathjax"');
      });
    });
  }).toBe(true);

  await expect.poll(async () => {
    return await page.evaluate(() => {
      const posts = (globalThis as { __PW_THUMB_WORKER_POSTS__?: string[] }).__PW_THUMB_WORKER_POSTS__ ?? [];
      return posts.includes("render");
    });
  }).toBe(true);
});

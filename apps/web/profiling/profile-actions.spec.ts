/**
 * CDP profiling for editor actions (menu commands).
 *
 * Run from apps/web/:
 *   npx playwright test --config profiling/playwright.config.ts profiling/profile-actions.spec.ts
 *
 * Produces .cpuprofile files in apps/web/profiling/traces/ openable in
 * Chrome DevTools → Performance → Load profile.
 */
import { expect, test } from "@playwright/test";
import {
  canvasViewport,
  clickHitRegion,
  gotoApp,
  openMenuCommand,
  openMenuSection,
  resetStorageBeforeNavigation,
  setSource,
  waitForHitRegions
} from "../e2e/helpers";
import { startCDPProfile, stopCDPProfile } from "./helpers";

const SIMPLE_FIGURE = String.raw`\begin{tikzpicture}
\node[draw] at (2,2) {Hello};
\end{tikzpicture}`;

const REPETITIONS = 5;

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

async function selectNode(page: import("@playwright/test").Page) {
  await gotoApp(page, "/edit/");
  await setSource(page, SIMPLE_FIGURE);
  await page.getByRole("button", { name: "Select" }).click();
  await waitForHitRegions(page);
  await clickHitRegion(page, 0);
  await expect(page.locator("[data-handle-kind]").first()).toBeVisible();
}

test("profile: rotate right 90° on a node", async ({ page }) => {
  await selectNode(page);
  const client = await startCDPProfile(page);
  for (let i = 0; i < REPETITIONS; i++) {
    await openMenuCommand(page, "edit", "edit.rotate-right-90");
    await page.waitForTimeout(300);
  }
  await stopCDPProfile(client, "action-rotate-right-90.cpuprofile");
});

test("profile: nudge right on a node", async ({ page }) => {
  await selectNode(page);
  await canvasViewport(page).focus();
  const client = await startCDPProfile(page);
  for (let i = 0; i < REPETITIONS; i++) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(300);
  }
  await stopCDPProfile(client, "action-nudge-right.cpuprofile");
});

test("profile: menu open/close overhead (no action)", async ({ page }) => {
  await selectNode(page);
  const client = await startCDPProfile(page);
  for (let i = 0; i < REPETITIONS; i++) {
    await openMenuSection(page, "edit");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  await stopCDPProfile(client, "action-menu-overhead.cpuprofile");
});

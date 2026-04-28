import * as path from "path";
import { fileURLToPath } from "url";
import { expect, test } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  gotoApp,
  openMenuCommand,
  openMenuSection,
  resetStorageBeforeNavigation,
  selectAllSceneElements,
  setSource,
  tabCloseButtons,
} from "./helpers";

test.use({ viewport: { width: 1280, height: 900 } });

const SCREENSHOTS_DIR = path.join(__dirname, "../tmp-modal-screenshots");

const SAMPLE_SOURCE = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A};
  \node[draw] at (2,0) {B};
\end{tikzpicture}`;

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
  await gotoApp(page);
});

test("01-settings", async ({ page }) => {
  await openMenuCommand(page, "file", "file.open-settings");
  await expect(page.getByTestId("settings-modal")).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "01-settings.png"), fullPage: true });
});

test("02-open-example", async ({ page }) => {
  await openMenuCommand(page, "file", "file.open-example");
  await expect(page.getByTestId("open-example-modal")).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "02-open-example.png"), fullPage: true });
});

test("03-png-export", async ({ page }) => {
  await setSource(page, SAMPLE_SOURCE);
  await openMenuCommand(page, "file", "file.export-png-download");
  await expect(page.getByTestId("png-export-modal")).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "03-png-export.png"), fullPage: true });
});

test("04-svg-export", async ({ page }) => {
  await setSource(page, SAMPLE_SOURCE);
  await openMenuCommand(page, "file", "file.export-svg-download");
  await expect(page.getByTestId("svg-export-modal")).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "04-svg-export.png"), fullPage: true });
});

async function openWorkspaceSubmenuCommand(page: Parameters<typeof openMenuSection>[0], commandId: string) {
  await openMenuSection(page, "view");
  await page.getByRole("menuitem", { name: "Workspace" }).hover();
  await page.getByTestId(`menu-cmd-${commandId}`).click();
}

test("06-save-workspace", async ({ page }) => {
  await openWorkspaceSubmenuCommand(page, "view.save-workspace-as");
  await expect(page.getByTestId("save-workspace-modal")).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "06-save-workspace.png"), fullPage: true });
});

test("05-manage-workspaces", async ({ page }) => {
  // First create a workspace so the list isn't empty
  await openWorkspaceSubmenuCommand(page, "view.save-workspace-as");
  await expect(page.getByTestId("save-workspace-modal")).toBeVisible();
  await page.getByTestId("save-workspace-name-input").fill("Test Layout");
  await page.getByTestId("save-workspace-confirm").click();
  await expect(page.getByTestId("save-workspace-modal")).toHaveCount(0);

  // Now open Manage Workspaces
  await openWorkspaceSubmenuCommand(page, "view.manage-workspaces");
  await expect(page.getByTestId("manage-workspaces-modal")).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "05-manage-workspaces.png"), fullPage: true });
});

test("07-unsaved-changes", async ({ page }) => {
  // Edit source to make the document dirty
  await setSource(page, SAMPLE_SOURCE);
  // Click the close button on the active tab
  const closeBtn = tabCloseButtons(page).first();
  await expect(closeBtn).toBeVisible();
  await closeBtn.click();
  await expect(page.getByTestId("unsaved-changes-modal")).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "07-unsaved-changes.png"), fullPage: true });
});

test("08-equation", async ({ page }) => {
  await openMenuCommand(page, "insert", "insert.equation");
  await expect(page.getByTestId("equation-modal")).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "08-equation.png"), fullPage: true });
});

test("09-tikzjax", async ({ page }) => {
  await openMenuCommand(page, "file", "file.show-compiled-picture");
  // TikzJax uses aria-labelledby="tikzjax-title" — wait briefly for chrome to appear
  const modal = page.locator("[aria-labelledby='tikzjax-title']");
  await expect(modal).toBeVisible({ timeout: 10_000 });
  // Give it a moment to render headers/body chrome even if CDN is slow
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "09-tikzjax.png"), fullPage: true });
});

test("10-repeat", async ({ page }) => {
  await setSource(page, SAMPLE_SOURCE);
  await selectAllSceneElements(page);
  await openMenuCommand(page, "edit", "edit.repeat");
  await expect(page.getByTestId("repeat-modal")).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, "10-repeat.png"), fullPage: true });
});

import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { gotoApp, resetStorageBeforeNavigation } from "./helpers";

function fsModulePath(relativePath: string): string {
  return `/@fs${fileURLToPath(new URL(relativePath, import.meta.url))}`;
}

test.describe("rectangle resize source rewrite", () => {
  test.beforeEach(async ({ page }) => {
    await resetStorageBeforeNavigation(page);
  });

  test("does not corrupt the rectangle target coordinate when analysis spans lag behind source text", async ({
    browserName,
    page
  }) => {
    test.skip(browserName !== "chromium", "The reported corruption appears in Chrome.");

    await gotoApp(page);

    const staleSource = "\\begin{tikzpicture}\n  \\draw (0,0) rectangle (1.34,1.1);\n\\end{tikzpicture}";
    const currentSource = "\\begin{tikzpicture}\n  \\draw (0,0) rectangle (1.35,1.09);\n\\end{tikzpicture}";

    const result = await page.evaluate(
      async ({ currentSource, modules, staleSource }) => {
        const [
          parserModule,
          appAnalysisManagerModule,
          analysisModule,
          actionsModule,
          pointsModule,
          scalarsModule,
          formatModule
        ] = await Promise.all([
          import(modules.parser),
          import(modules.appAnalysisManager),
          import(modules.analysis),
          import(modules.actions),
          import(modules.points),
          import(modules.scalars),
          import(modules.format)
        ]);

        const parsed = parserModule.parseTikz(staleSource, {
          recover: true,
          includeContextDefinitions: true
        });
        appAnalysisManagerModule.resetSharedEditAnalysisManager();
        const analysisView = appAnalysisManagerModule.getSharedEditAnalysisView({
          documentId: "e2e-rectangle-resize",
          sourceRevision: 1,
          source: currentSource,
          activeFigureId: parsed.activeFigureId,
          snapshot: {
            source: staleSource,
            revision: 1,
            parseResult: parsed
          }
        });
        const session = appAnalysisManagerModule.getSharedEditAnalysisSession();
        return actionsModule.applyEditAction(
          currentSource,
          [],
          {
            kind: "resizeElement",
            elementId: "path:0",
            role: "top-right",
            newWorld: pointsModule.worldPoint(
              scalarsModule.pt(1.35 * formatModule.PT_PER_CM),
              scalarsModule.pt(1.09 * formatModule.PT_PER_CM)
            )
          },
          {
            parseOptions: {
              activeFigureId: parsed.activeFigureId,
              analysisView,
              analysisSession: session ?? analysisModule.createEditAnalysisSession(),
              propertyWriteMode: "drag-frame"
            }
          }
        );
      },
      {
        currentSource,
        staleSource,
        modules: {
          parser: fsModulePath("../../../packages/core/src/parser/index.ts"),
          appAnalysisManager: fsModulePath("../../../packages/app/src/edit-analysis-manager.ts"),
          analysis: fsModulePath("../../../packages/core/src/edit/analysis.ts"),
          actions: fsModulePath("../../../packages/core/src/edit/actions.ts"),
          points: fsModulePath("../../../packages/core/src/coords/points.ts"),
          scalars: fsModulePath("../../../packages/core/src/coords/scalars.ts"),
          format: fsModulePath("../../../packages/core/src/edit/format.ts")
        }
      }
    );

    const nextSource =
      result.kind === "success" || result.kind === "partial"
        ? result.newSource
        : currentSource;

    expect(nextSource).toBe(currentSource);
  });
});

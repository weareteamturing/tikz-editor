import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { parseTikz, type Statement } from "@tikz-editor/core";
import { gotoApp, openMenuCommand, readActiveFigureId, readFigureCount } from "./helpers";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const TRACES_DIR = path.join(THIS_DIR, "traces");
const PAPER_PATH = path.resolve(THIS_DIR, "../../../test/papers/equal_shares_arxiv_v2.tex");
const TARGET_DRAW_LINES = [
  String.raw`\draw[thick,->,magenta] (0.0, 0.0) -- (0.0, 4.5);`,
  String.raw`\draw[thick,->] (0.0, 0.0) -- (0.0, 4.5);`
] as const;

type ProbeRecord = {
  t: number;
  type: string;
  [key: string]: unknown;
};

type ProbeSnapshot = {
  records: ProbeRecord[];
  scrollTop: number | null;
  scrollLeft: number | null;
  highlightCount: number;
  selectionCount: number;
  handleCount: number;
  sourcePanelVisible: boolean;
};

type ProfileSummary = {
  label: string;
  cpuProfilePath: string;
  metrics: {
    msToSelectionRequest: number | null;
    msToFirstHighlight: number | null;
    msToFirstSelection: number | null;
    msToFirstScroll: number | null;
    msToFirstHandle: number | null;
  };
  snapshot: ProbeSnapshot;
};

type PaperTarget = {
  source: string;
  targetLine: string;
  targetOffset: number;
  activeFigureId: string;
  activeFigureNumber: number;
  targetSourceId: string;
};

function resolvePaperTarget(): PaperTarget {
  const source = fs.readFileSync(PAPER_PATH, "utf8");
  const targetLine = TARGET_DRAW_LINES.find((line) => source.includes(line));
  if (!targetLine) {
    throw new Error(`Target draw line not found in ${PAPER_PATH}`);
  }

  const targetOffset = source.indexOf(targetLine);
  const fullParse = parseTikz(source, { recover: true, includeContextDefinitions: true });
  const figure = fullParse.figures.find((candidate) => targetOffset >= candidate.span.from && targetOffset < candidate.span.to);
  if (!figure) {
    throw new Error(`Could not resolve figure containing target line in ${PAPER_PATH}`);
  }
  const activeFigureNumber = fullParse.figures.findIndex((candidate) => candidate.id === figure.id) + 1;
  if (activeFigureNumber <= 0) {
    throw new Error(`Could not resolve figure number for ${figure.id}`);
  }

  const activeParse = parseTikz(source, {
    recover: true,
    includeContextDefinitions: true,
    activeFigureId: figure.id
  });
  const targetStatement = findStatementContainingOffset(activeParse.figure.body, targetOffset);
  if (!targetStatement || targetStatement.kind !== "Path") {
    throw new Error(`Could not resolve path statement containing target line in ${PAPER_PATH}`);
  }

  return {
    source,
    targetLine,
    targetOffset,
    activeFigureId: figure.id,
    activeFigureNumber,
    targetSourceId: targetStatement.id
  };
}

function findStatementContainingOffset(statements: readonly Statement[], offset: number): Statement | null {
  for (const statement of statements) {
    if (offset < statement.span.from || offset >= statement.span.to) {
      continue;
    }
    if (statement.kind === "Scope") {
      return findStatementContainingOffset(statement.body, offset) ?? statement;
    }
    return statement;
  }
  return null;
}

async function seedWorkspace(page: import("@playwright/test").Page, target: PaperTarget): Promise<void> {
  await page.addInitScript(({ source, activeFigureId }) => {
    const payload = {
      workspaceVersion: 3,
      documents: [
        {
          id: "doc-profile-paper",
          title: "equal_shares_arxiv_v2.tex",
          source,
          activeFigureId,
          savedSource: source,
          fileRef: null,
          assistantThreadId: null,
          assistantWorkspacePath: null,
          assistantFigurePath: null,
          assistantPreviewPath: null
        }
      ],
      tabOrder: ["doc-profile-paper"],
      activeDocumentId: "doc-profile-paper",
      recentDocumentIds: ["doc-profile-paper"]
    };
    localStorage.setItem("tikz-editor:workspace", JSON.stringify(payload));
  }, {
    source: target.source,
    activeFigureId: target.activeFigureId
  });
}

async function installProbe(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    const globalLike = window as typeof window & {
      __PW_PROFILE_PROBE__?: {
        reset: (label: string) => void;
        snapshot: () => ProbeSnapshot;
      };
      __PW_PROFILE_PROBE_INSTALLED__?: boolean;
    };
    if (globalLike.__PW_PROFILE_PROBE_INSTALLED__) {
      return;
    }
    globalLike.__PW_PROFILE_PROBE_INSTALLED__ = true;

    let start = performance.now();
    let records: ProbeRecord[] = [];
    let lastHighlightCount = -1;
    let lastSelectionCount = -1;
    let lastHandleCount = -1;
    let lastScrollTop = Number.NaN;
    let lastScrollLeft = Number.NaN;
    let scrollerListenerBound = false;

    const scroller = (): HTMLElement | null => document.querySelector(".cm-scroller");
    const sourcePanelVisible = (): boolean => document.querySelector(".cm-editor") != null;
    const highlightCount = (): number => document.querySelectorAll(".cm-highlight-range").length;
    const selectionCount = (): number =>
      document.querySelectorAll(".cm-selectionBackground, .cm-cursor").length;
    const handleCount = (): number => document.querySelectorAll("[data-handle-kind]").length;

    const record = (type: string, detail: Record<string, unknown> = {}) => {
      records.push({
        t: performance.now() - start,
        type,
        ...detail
      });
    };

    const sample = (reason: string) => {
      const nextHighlightCount = highlightCount();
      if (nextHighlightCount !== lastHighlightCount) {
        lastHighlightCount = nextHighlightCount;
        record("highlight-count", { reason, highlightCount: nextHighlightCount });
      }

      const nextSelectionCount = selectionCount();
      if (nextSelectionCount !== lastSelectionCount) {
        lastSelectionCount = nextSelectionCount;
        record("selection-count", { reason, selectionCount: nextSelectionCount });
      }

      const nextHandleCount = handleCount();
      if (nextHandleCount !== lastHandleCount) {
        lastHandleCount = nextHandleCount;
        record("handle-count", { reason, handleCount: nextHandleCount });
      }

      const nextScroller = scroller();
      const nextScrollTop = nextScroller?.scrollTop ?? Number.NaN;
      const nextScrollLeft = nextScroller?.scrollLeft ?? Number.NaN;
      if (nextScrollTop !== lastScrollTop || nextScrollLeft !== lastScrollLeft) {
        lastScrollTop = nextScrollTop;
        lastScrollLeft = nextScrollLeft;
        record("editor-scroll-state", {
          reason,
          scrollTop: Number.isFinite(nextScrollTop) ? nextScrollTop : null,
          scrollLeft: Number.isFinite(nextScrollLeft) ? nextScrollLeft : null
        });
      }
    };

    const bindScrollerListener = () => {
      const node = scroller();
      if (!node || scrollerListenerBound) {
        return;
      }
      scrollerListenerBound = true;
      node.addEventListener("scroll", () => {
        record("editor-scroll-event", {
          scrollTop: node.scrollTop,
          scrollLeft: node.scrollLeft
        });
        sample("scroll");
      }, { passive: true });
    };

    const observer = new MutationObserver(() => {
      bindScrollerListener();
      sample("mutation");
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: false
    });

    window.addEventListener("tikz-editor:source-selection-changed", (rawEvent) => {
      const event = rawEvent as CustomEvent<{
        from: number;
        to: number;
        anchor: number;
        head: number;
        sourceId: string | null;
      }>;
      record("source-selection-changed", event.detail ?? {});
      sample("source-selection-changed");
    });

    window.addEventListener("tikz-editor:source-selection-request", (rawEvent) => {
      const event = rawEvent as CustomEvent<{
        from: number;
        to: number;
        anchor?: number;
        head?: number;
        sourceId?: string;
        focus?: boolean;
      }>;
      record("source-selection-request", event.detail ?? {});
      sample("source-selection-request");
    });

    bindScrollerListener();
    sample("install");

    globalLike.__PW_PROFILE_PROBE__ = {
      reset(label: string) {
        start = performance.now();
        records = [];
        lastHighlightCount = -1;
        lastSelectionCount = -1;
        lastHandleCount = -1;
        lastScrollTop = Number.NaN;
        lastScrollLeft = Number.NaN;
        bindScrollerListener();
        record("reset", { label, sourcePanelVisible: sourcePanelVisible() });
        sample("reset");
      },
      snapshot() {
        sample("snapshot");
        const currentScroller = scroller();
        return {
          records: [...records],
          scrollTop: currentScroller?.scrollTop ?? null,
          scrollLeft: currentScroller?.scrollLeft ?? null,
          highlightCount: highlightCount(),
          selectionCount: selectionCount(),
          handleCount: handleCount(),
          sourcePanelVisible: sourcePanelVisible()
        };
      }
    };
  });
}

async function startCDPProfile(page: import("@playwright/test").Page) {
  const client = await page.context().newCDPSession(page);
  await client.send("Profiler.enable");
  await client.send("Profiler.start");
  return client;
}

async function stopCDPProfile(
  client: import("playwright-core").CDPSession,
  filename: string
): Promise<string> {
  const { profile } = await client.send("Profiler.stop");
  await client.send("Profiler.disable");

  fs.mkdirSync(TRACES_DIR, { recursive: true });
  const outPath = path.join(TRACES_DIR, filename);
  fs.writeFileSync(outPath, JSON.stringify(profile, null, 2), "utf8");
  return outPath;
}

async function resetProbe(page: import("@playwright/test").Page, label: string): Promise<void> {
  await page.evaluate((nextLabel) => {
    const globalLike = window as typeof window & {
      __PW_PROFILE_PROBE__?: { reset: (label: string) => void };
    };
    globalLike.__PW_PROFILE_PROBE__?.reset(nextLabel);
  }, label);
}

async function readProbe(page: import("@playwright/test").Page): Promise<ProbeSnapshot> {
  return await page.evaluate(() => {
    const globalLike = window as typeof window & {
      __PW_PROFILE_PROBE__?: { snapshot: () => ProbeSnapshot };
    };
    if (!globalLike.__PW_PROFILE_PROBE__) {
      throw new Error("Probe not installed.");
    }
    return globalLike.__PW_PROFILE_PROBE__.snapshot();
  });
}

type DebugState = {
  activeFigureId: string | null;
  figureCount: number;
  canvasNoSvgText: string | null;
  computingTextCount: number;
  sourcePanelVisible: boolean;
  matchingMagentaPathCount: number;
  matchingAnyPathCount: number;
  handleCount: number;
  statusBarText: string | null;
};

async function readDebugState(
  page: import("@playwright/test").Page,
  target: PaperTarget
): Promise<DebugState> {
  const activeFigureId = await readActiveFigureId(page);
  const figureCount = await readFigureCount(page);
  return await page.evaluate((params) => {
    const targetSelector = `path[data-source-id="${params.targetSourceId}"]`;
    const magentaSelector = `${targetSelector}[stroke="#ff00ff"]:not([data-arrow-tip-kind])`;
    const canvasNoSvg = document.querySelector("[data-testid='canvas-no-svg']");
    const statusBar = document.querySelector("[data-testid='status-bar'], [class*='statusBar']");
    const allText = [...document.querySelectorAll("body *")]
      .map((node) => node.textContent?.trim() ?? "")
      .filter(Boolean);
    const computingTextCount = allText.filter((text) => text.includes("Computing…")).length;
    return {
      activeFigureId: params.activeFigureId,
      figureCount: params.figureCount,
      canvasNoSvgText: canvasNoSvg?.textContent?.trim() ?? null,
      computingTextCount,
      sourcePanelVisible: document.querySelector(".cm-editor") != null,
      matchingMagentaPathCount: document.querySelectorAll(magentaSelector).length,
      matchingAnyPathCount: document.querySelectorAll(targetSelector).length,
      handleCount: document.querySelectorAll("[data-handle-kind]").length,
      statusBarText: statusBar?.textContent?.trim() ?? null
    } satisfies DebugState;
  }, { targetSourceId: target.targetSourceId, activeFigureId, figureCount });
}

function printDebug(label: string, state: DebugState): void {
  console.log(`[paper-selection] ${label}: ${JSON.stringify(state)}`);
}

async function waitForTargetFigureReady(
  page: import("@playwright/test").Page,
  target: PaperTarget
): Promise<void> {
  const figureButton = page.getByRole("button", { name: `Figure ${target.activeFigureNumber}` });
  await expect.poll(async () => readFigureCount(page), {
    timeout: 60_000,
    message: "waiting for figure navigator to populate"
  }).toBeGreaterThanOrEqual(target.activeFigureNumber);
  await expect(figureButton).toBeVisible({ timeout: 60_000 });

  const currentActiveFigureId = await readActiveFigureId(page);
  if (currentActiveFigureId !== target.activeFigureId) {
    await figureButton.click();
  }

  await expect.poll(async () => readActiveFigureId(page), {
    timeout: 60_000,
    message: "waiting for target active figure"
  }).toBe(target.activeFigureId);

  printDebug("after-figure-activate", await readDebugState(page, target));

  await expect.poll(async () => {
    const state = await readDebugState(page, target);
    printDebug("ready-poll", state);
    return {
      canvasNoSvgText: state.canvasNoSvgText,
      matchingMagentaPathCount: state.matchingMagentaPathCount
    };
  }, {
    timeout: 120_000,
    intervals: [250, 500, 1000, 2000, 5000],
    message: "waiting for target figure SVG to render"
  }).toEqual({
    canvasNoSvgText: null,
    matchingMagentaPathCount: 1
  });
}

async function resolveSamplePoint(locator: import("@playwright/test").Locator): Promise<{ x: number; y: number }> {
  return await locator.evaluate((element) => {
    const fallback = () => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };

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
}

async function resolveVisibleSamplePointForSelector(
  page: import("@playwright/test").Page,
  selector: string
): Promise<{ x: number; y: number }> {
  return await page.evaluate((rawSelector) => {
    const elements = [...document.querySelectorAll(rawSelector)];
    for (const element of elements) {
      const rect = (element as Element).getBoundingClientRect();
      const style = window.getComputedStyle(element as Element);
      const visible =
        (rect.width > 0 || rect.height > 0) &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        Number(style.opacity || "1") > 0;
      if (!visible) {
        continue;
      }

      const fallback = () => ({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      });

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
    }
    throw new Error(`No visible element matched selector: ${rawSelector}`);
  }, selector);
}

function summarizeSnapshot(label: string, cpuProfilePath: string, snapshot: ProbeSnapshot): ProfileSummary {
  const firstOfType = (type: string, predicate?: (record: ProbeRecord) => boolean): number | null => {
    const match = snapshot.records.find((record) => record.type === type && (predicate ? predicate(record) : true));
    return match ? Number(match.t.toFixed(2)) : null;
  };

  return {
    label,
    cpuProfilePath,
    metrics: {
      msToSelectionRequest: firstOfType("source-selection-request"),
      msToFirstHighlight: firstOfType("highlight-count", (record) => Number(record.highlightCount ?? 0) > 0),
      msToFirstSelection: firstOfType("selection-count", (record) => Number(record.selectionCount ?? 0) > 0),
      msToFirstScroll: firstOfType("editor-scroll-event"),
      msToFirstHandle: firstOfType("handle-count", (record) => Number(record.handleCount ?? 0) > 0)
    },
    snapshot
  };
}

test("profile paper selection hover vs click", async ({ page }) => {
  const target = resolvePaperTarget();
  console.log(
    `[paper-selection] target=${JSON.stringify({
      paperPath: PAPER_PATH,
      targetLine: target.targetLine,
      activeFigureId: target.activeFigureId,
      activeFigureNumber: target.activeFigureNumber,
      targetSourceId: target.targetSourceId
    })}`
  );
  await seedWorkspace(page, target);
  await gotoApp(page, "/edit/");
  await installProbe(page);

  printDebug("after-app-load", await readDebugState(page, target));
  await waitForTargetFigureReady(page, target);

  const point = await resolveVisibleSamplePointForSelector(
    page,
    `path[data-source-id="${target.targetSourceId}"][stroke="#ff00ff"]:not([data-arrow-tip-kind])`
  );
  console.log(`[paper-selection] target-point=${JSON.stringify(point)}`);
  const summaries: ProfileSummary[] = [];

  // Hover with source panel visible.
  await page.mouse.move(Math.max(0, point.x - 80), Math.max(0, point.y - 80));
  await page.waitForTimeout(120);
  await resetProbe(page, "hover-visible");
  const hoverClient = await startCDPProfile(page);
  await page.mouse.move(point.x, point.y, { steps: 4 });
  await page.waitForFunction(
    () =>
      (window as typeof window & {
        __PW_PROFILE_PROBE__?: { snapshot: () => ProbeSnapshot };
      }).__PW_PROFILE_PROBE__?.snapshot().records.some(
        (record) => record.type === "highlight-count" && Number(record.highlightCount ?? 0) > 0
      ) ?? false
  );
  await page.waitForTimeout(250);
  summaries.push(
    summarizeSnapshot(
      "hover-visible",
      await stopCDPProfile(hoverClient, "paper-selection-hover-visible.cpuprofile"),
      await readProbe(page)
    )
  );

  // Click with source panel visible.
  await page.evaluate(() => {
    (window as typeof window & {
      __TIKZ_EDITOR_APP_TEST_API__?: { clearSelection: () => void };
    }).__TIKZ_EDITOR_APP_TEST_API__?.clearSelection();
  });
  await page.waitForTimeout(100);
  await resetProbe(page, "click-visible");
  const clickVisibleClient = await startCDPProfile(page);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(1_500);
  await page.waitForTimeout(1_000);
  summaries.push(
    summarizeSnapshot(
      "click-visible",
      await stopCDPProfile(clickVisibleClient, "paper-selection-click-visible.cpuprofile"),
      await readProbe(page)
    )
  );

  // Click with source panel hidden.
  await openMenuCommand(page, "view", "view.toggle-source-panel");
  await expect(page.locator(".cm-editor")).toHaveCount(0);
  const pointHiddenSourcePanel = await resolveVisibleSamplePointForSelector(
    page,
    `path[data-source-id="${target.targetSourceId}"][stroke="#ff00ff"]:not([data-arrow-tip-kind])`
  );
  console.log(`[paper-selection] target-point-hidden-source-panel=${JSON.stringify(pointHiddenSourcePanel)}`);
  await page.evaluate(() => {
    (window as typeof window & {
      __TIKZ_EDITOR_APP_TEST_API__?: { clearSelection: () => void };
    }).__TIKZ_EDITOR_APP_TEST_API__?.clearSelection();
  });
  await page.waitForTimeout(100);
  await resetProbe(page, "click-hidden-source-panel");
  const clickHiddenClient = await startCDPProfile(page);
  await page.mouse.click(pointHiddenSourcePanel.x, pointHiddenSourcePanel.y);
  await page.waitForTimeout(1_500);
  summaries.push(
    summarizeSnapshot(
      "click-hidden-source-panel",
      await stopCDPProfile(clickHiddenClient, "paper-selection-click-hidden-source-panel.cpuprofile"),
      await readProbe(page)
    )
  );

  // Click with both source and inspector panels hidden.
  await openMenuCommand(page, "view", "view.toggle-inspector-panel");
  const pointHiddenBothPanels = await resolveVisibleSamplePointForSelector(
    page,
    `path[data-source-id="${target.targetSourceId}"][stroke="#ff00ff"]:not([data-arrow-tip-kind])`
  );
  console.log(`[paper-selection] target-point-hidden-both-panels=${JSON.stringify(pointHiddenBothPanels)}`);
  await page.evaluate(() => {
    (window as typeof window & {
      __TIKZ_EDITOR_APP_TEST_API__?: { clearSelection: () => void };
    }).__TIKZ_EDITOR_APP_TEST_API__?.clearSelection();
  });
  await page.waitForTimeout(100);
  await resetProbe(page, "click-hidden-both-panels");
  const clickHiddenBothClient = await startCDPProfile(page);
  await page.mouse.click(pointHiddenBothPanels.x, pointHiddenBothPanels.y);
  await page.waitForTimeout(1_500);
  summaries.push(
    summarizeSnapshot(
      "click-hidden-both-panels",
      await stopCDPProfile(clickHiddenBothClient, "paper-selection-click-hidden-both-panels.cpuprofile"),
      await readProbe(page)
    )
  );

  const report = {
    paperPath: PAPER_PATH,
    targetLine: target.targetLine,
    activeFigureId: target.activeFigureId,
    activeFigureNumber: target.activeFigureNumber,
    targetSourceId: target.targetSourceId,
    summaries
  };
  fs.mkdirSync(TRACES_DIR, { recursive: true });
  const reportPath = path.join(TRACES_DIR, "paper-selection-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));

  expect(summaries).toHaveLength(4);
});

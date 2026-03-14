import * as fs from "node:fs";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import { gotoApp, openMenuCommand, readActiveFigureId, readFigureCount } from "../e2e/helpers";
import {
  clearSelection,
  resolvePaperTarget,
  resolveVisibleSamplePointForSelector,
  seedWorkspace,
  startCDPProfile,
  stopCDPProfile,
  TRACES_DIR,
  waitForActiveFigure,
  type PaperTarget
} from "./helpers";

const VERBOSE_PROFILE_LOGS = process.env.TIKZ_PROFILE_VERBOSE === "1";
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
  if (!VERBOSE_PROFILE_LOGS) {
    return;
  }
  console.log(`[paper-selection] ${label}: ${JSON.stringify(state)}`);
}

async function waitForTargetFigureReady(
  page: import("@playwright/test").Page,
  target: PaperTarget
): Promise<void> {
  await waitForActiveFigure(page, target);
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
  const target = resolvePaperTarget(TARGET_DRAW_LINES);
  if (VERBOSE_PROFILE_LOGS) {
    console.log(
      `[paper-selection] target=${JSON.stringify({
        paperPath: PAPER_PATH,
        targetLine: target.targetLine,
        activeFigureId: target.activeFigureId,
        activeFigureNumber: target.activeFigureNumber,
        targetSourceId: target.targetSourceId
      })}`
    );
  }
  await seedWorkspace(page, target, "doc-profile-paper");
  await gotoApp(page, "/edit/");
  await installProbe(page);

  printDebug("after-app-load", await readDebugState(page, target));
  await waitForTargetFigureReady(page, target);

  const point = await resolveVisibleSamplePointForSelector(
    page,
    `path[data-source-id="${target.targetSourceId}"][stroke="#ff00ff"]:not([data-arrow-tip-kind])`
  );
  if (VERBOSE_PROFILE_LOGS) {
    console.log(`[paper-selection] target-point=${JSON.stringify(point)}`);
  }
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
  await clearSelection(page);
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
  if (VERBOSE_PROFILE_LOGS) {
    console.log(`[paper-selection] target-point-hidden-source-panel=${JSON.stringify(pointHiddenSourcePanel)}`);
  }
  await clearSelection(page);
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
  if (VERBOSE_PROFILE_LOGS) {
    console.log(`[paper-selection] target-point-hidden-both-panels=${JSON.stringify(pointHiddenBothPanels)}`);
  }
  await clearSelection(page);
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
  console.log(`[paper-selection] wrote ${reportPath}`);

  expect(summaries).toHaveLength(4);
});

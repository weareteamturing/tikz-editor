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

const TARGET_DRAW_LINE = String.raw`\draw[thick,->,magenta] (0.0, 0.0) -- (0.0, 4.5);`;
const TARGET_NEXT_COLOR = "green";
const VERBOSE_PROFILE_LOGS = process.env.TIKZ_PROFILE_VERBOSE === "1";

type ProbeRecord = {
  t: number;
  type: string;
  [key: string]: unknown;
};

type ProbeSnapshot = {
  records: ProbeRecord[];
  targetStroke: string | null;
  targetStrokeComputed: string | null;
  computingTextCount: number;
  statusBarText: string | null;
  frameStats: {
    count: number;
    avgMs: number | null;
    p95Ms: number | null;
    maxMs: number | null;
  };
};

type ProfileSummary = {
  label: string;
  cpuProfilePath: string;
  metrics: {
    msToFirstStrokeChange: number | null;
    msToFirstComputing: number | null;
    msToFirstStatusChange: number | null;
    frameP95Ms: number | null;
    frameMaxMs: number | null;
    frameAvgMs: number | null;
    frameCount: number;
  };
  snapshot: ProbeSnapshot;
};

type DebugState = {
  activeFigureId: string | null;
  figureCount: number;
  sourcePanelVisible: boolean;
  matchingTargetPathCount: number;
  targetStroke: string | null;
  targetStrokeComputed: string | null;
  computingTextCount: number;
  statusBarText: string | null;
};


async function installProbe(
  page: import("@playwright/test").Page,
  targetSourceId: string
): Promise<void> {
  await page.evaluate((sourceId) => {
    const globalLike = window as typeof window & {
      __PW_COLOR_PROFILE_PROBE__?: {
        reset: (label: string) => void;
        snapshot: () => ProbeSnapshot;
      };
      __PW_COLOR_PROFILE_PROBE_INSTALLED__?: boolean;
    };
    if (globalLike.__PW_COLOR_PROFILE_PROBE_INSTALLED__) {
      return;
    }
    globalLike.__PW_COLOR_PROFILE_PROBE_INSTALLED__ = true;

    let start = performance.now();
    let records: ProbeRecord[] = [];
    let lastTargetStroke: string | null = null;
    let lastTargetStrokeComputed: string | null = null;
    let lastComputingTextCount = -1;
    let lastStatusBarText: string | null = null;
    let rafId = 0;
    const frameDeltas: number[] = [];
    let lastFrameTime: number | null = null;

    const record = (type: string, detail: Record<string, unknown> = {}) => {
      records.push({
        t: performance.now() - start,
        type,
        ...detail
      });
    };

    const targetElement = (): SVGElement | null =>
      document.querySelector(`path[data-source-id="${sourceId}"]:not([data-arrow-tip-kind])`);

    const currentTargetStroke = (): { stroke: string | null; strokeComputed: string | null } => {
      const element = targetElement();
      if (!element) {
        return { stroke: null, strokeComputed: null };
      }
      const computed = window.getComputedStyle(element);
      return {
        stroke: element.getAttribute("stroke"),
        strokeComputed: computed.stroke ?? null
      };
    };

    const computingTextCount = (): number => {
      const allText = [...document.querySelectorAll("body *")]
        .map((node) => node.textContent?.trim() ?? "")
        .filter(Boolean);
      return allText.filter((text) => text.includes("Computing…")).length;
    };

    const statusBarText = (): string | null =>
      document.querySelector("[data-testid='status-bar'], [class*='statusBar']")?.textContent?.trim() ?? null;

    const sample = (reason: string) => {
      const stroke = currentTargetStroke();
      if (stroke.stroke !== lastTargetStroke || stroke.strokeComputed !== lastTargetStrokeComputed) {
        lastTargetStroke = stroke.stroke;
        lastTargetStrokeComputed = stroke.strokeComputed;
        record("target-stroke", {
          reason,
          targetStroke: stroke.stroke,
          targetStrokeComputed: stroke.strokeComputed
        });
      }

      const nextComputingTextCount = computingTextCount();
      if (nextComputingTextCount !== lastComputingTextCount) {
        lastComputingTextCount = nextComputingTextCount;
        record("computing-text-count", {
          reason,
          computingTextCount: nextComputingTextCount
        });
      }

      const nextStatusBarText = statusBarText();
      if (nextStatusBarText !== lastStatusBarText) {
        lastStatusBarText = nextStatusBarText;
        record("status-bar-text", {
          reason,
          statusBarText: nextStatusBarText
        });
      }
    };

    const summarizeFrames = () => {
      if (frameDeltas.length === 0) {
        return {
          count: 0,
          avgMs: null,
          p95Ms: null,
          maxMs: null
        };
      }
      const sorted = [...frameDeltas].sort((a, b) => a - b);
      const index = (sorted.length - 1) * 0.95;
      const lower = Math.floor(index);
      const upper = Math.ceil(index);
      const p95 =
        lower === upper
          ? sorted[lower] ?? null
          : (sorted[lower] ?? 0) * (1 - (index - lower)) + (sorted[upper] ?? 0) * (index - lower);
      const total = frameDeltas.reduce((sum, value) => sum + value, 0);
      return {
        count: frameDeltas.length,
        avgMs: total / frameDeltas.length,
        p95Ms: p95,
        maxMs: Math.max(...frameDeltas)
      };
    };

    const onAnimationFrame = (ts: number) => {
      if (lastFrameTime != null) {
        frameDeltas.push(ts - lastFrameTime);
      }
      lastFrameTime = ts;
      rafId = window.requestAnimationFrame(onAnimationFrame);
    };
    rafId = window.requestAnimationFrame(onAnimationFrame);

    const observer = new MutationObserver(() => {
      sample("mutation");
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: false
    });

    sample("install");

    globalLike.__PW_COLOR_PROFILE_PROBE__ = {
      reset(label: string) {
        start = performance.now();
        records = [];
        frameDeltas.length = 0;
        lastFrameTime = null;
        lastTargetStroke = null;
        lastTargetStrokeComputed = null;
        lastComputingTextCount = -1;
        lastStatusBarText = null;
        record("reset", { label });
        sample("reset");
      },
      snapshot() {
        sample("snapshot");
        const stroke = currentTargetStroke();
        return {
          records: [...records],
          targetStroke: stroke.stroke,
          targetStrokeComputed: stroke.strokeComputed,
          computingTextCount: computingTextCount(),
          statusBarText: statusBarText(),
          frameStats: summarizeFrames()
        };
      }
    };

    window.addEventListener("beforeunload", () => {
      observer.disconnect();
      window.cancelAnimationFrame(rafId);
    });
  }, targetSourceId);
}


async function resetProbe(page: import("@playwright/test").Page, label: string): Promise<void> {
  await page.evaluate((nextLabel) => {
    const globalLike = window as typeof window & {
      __PW_COLOR_PROFILE_PROBE__?: { reset: (label: string) => void };
    };
    globalLike.__PW_COLOR_PROFILE_PROBE__?.reset(nextLabel);
  }, label);
}

async function readProbe(page: import("@playwright/test").Page): Promise<ProbeSnapshot> {
  return await page.evaluate(() => {
    const globalLike = window as typeof window & {
      __PW_COLOR_PROFILE_PROBE__?: { snapshot: () => ProbeSnapshot };
    };
    if (!globalLike.__PW_COLOR_PROFILE_PROBE__) {
      throw new Error("Probe not installed.");
    }
    return globalLike.__PW_COLOR_PROFILE_PROBE__.snapshot();
  });
}

async function readDebugState(
  page: import("@playwright/test").Page,
  target: PaperTarget
): Promise<DebugState> {
  const activeFigureId = await readActiveFigureId(page);
  const figureCount = await readFigureCount(page);
  return await page.evaluate((params) => {
    const element = document.querySelector(
      `path[data-source-id="${params.targetSourceId}"]:not([data-arrow-tip-kind])`
    );
    const computed = element ? window.getComputedStyle(element) : null;
    const allText = [...document.querySelectorAll("body *")]
      .map((node) => node.textContent?.trim() ?? "")
      .filter(Boolean);
    const computingTextCount = allText.filter((text) => text.includes("Computing…")).length;
    return {
      activeFigureId: params.activeFigureId,
      figureCount: params.figureCount,
      sourcePanelVisible: document.querySelector(".cm-editor") != null,
      matchingTargetPathCount: document.querySelectorAll(
        `path[data-source-id="${params.targetSourceId}"]:not([data-arrow-tip-kind])`
      ).length,
      targetStroke: element?.getAttribute("stroke") ?? null,
      targetStrokeComputed: computed?.stroke ?? null,
      computingTextCount,
      statusBarText: document.querySelector("[data-testid='status-bar'], [class*='statusBar']")?.textContent?.trim() ?? null
    } satisfies DebugState;
  }, { targetSourceId: target.targetSourceId, activeFigureId, figureCount });
}

function printDebug(label: string, state: DebugState): void {
  if (VERBOSE_PROFILE_LOGS) {
    console.log(`[paper-color] ${label}: ${JSON.stringify(state)}`);
  }
}

async function waitForTargetFigureReady(
  page: import("@playwright/test").Page,
  target: PaperTarget
): Promise<void> {
  await waitForActiveFigure(page, target);

  await expect.poll(async () => {
    const state = await readDebugState(page, target);
    printDebug("ready-poll", state);
    return {
      matchingTargetPathCount: state.matchingTargetPathCount,
      targetStroke: state.targetStroke
    };
  }, {
    timeout: 120_000,
    intervals: [250, 500, 1000, 2000],
    message: "waiting for target figure SVG to render"
  }).toEqual({
    matchingTargetPathCount: 1,
    targetStroke: "#ff00ff"
  });
}


async function resetSourceToPaper(page: import("@playwright/test").Page, source: string): Promise<void> {
  await page.evaluate((nextSource) => {
    (window as typeof window & {
      __TIKZ_EDITOR_APP_TEST_API__?: { setSource?: (source: string) => void };
    }).__TIKZ_EDITOR_APP_TEST_API__?.setSource?.(nextSource);
  }, source);
}

async function prepareSelectedPath(page: import("@playwright/test").Page, target: PaperTarget): Promise<void> {
  const targetPathSelector =
    `path[data-source-id="${target.targetSourceId}"][stroke="#ff00ff"]:not([data-arrow-tip-kind])`;
  const pathPoint = await resolveVisibleSamplePointForSelector(page, targetPathSelector);
  await clearSelection(page);
  await page.waitForTimeout(100);
  await page.mouse.click(pathPoint.x, pathPoint.y);
  await page.getByRole("button", { name: "Inspector" }).click().catch(() => {});
  await expect(page.getByRole("button", { name: "Color", exact: true }).first()).toBeVisible();
}

async function performColorChange(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "Color", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Color green", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Color green", exact: true }).click();
}

function summarizeSnapshot(label: string, cpuProfilePath: string, snapshot: ProbeSnapshot): ProfileSummary {
  const baselineStroke = snapshot.records.find((record) => record.type === "target-stroke");
  const baselineStrokeValue = baselineStroke?.targetStroke ?? null;
  const baselineStatus = snapshot.records.find((record) => record.type === "status-bar-text");
  const firstStrokeChange = snapshot.records.find((record) =>
    record.type === "target-stroke" && record.targetStroke !== baselineStrokeValue
  );
  const firstComputing = snapshot.records.find(
    (record) => record.type === "computing-text-count" && Number(record.computingTextCount ?? 0) > 0
  );
  const firstStatusChange = snapshot.records.find((record) =>
    record.type === "status-bar-text" &&
    record !== baselineStatus &&
    record.statusBarText !== baselineStatus?.statusBarText
  );

  return {
    label,
    cpuProfilePath,
    metrics: {
      msToFirstStrokeChange: firstStrokeChange ? Number(firstStrokeChange.t.toFixed(2)) : null,
      msToFirstComputing: firstComputing ? Number(firstComputing.t.toFixed(2)) : null,
      msToFirstStatusChange: firstStatusChange ? Number(firstStatusChange.t.toFixed(2)) : null,
      frameP95Ms: snapshot.frameStats.p95Ms != null ? Number(snapshot.frameStats.p95Ms.toFixed(2)) : null,
      frameMaxMs: snapshot.frameStats.maxMs != null ? Number(snapshot.frameStats.maxMs.toFixed(2)) : null,
      frameAvgMs: snapshot.frameStats.avgMs != null ? Number(snapshot.frameStats.avgMs.toFixed(2)) : null,
      frameCount: snapshot.frameStats.count
    },
    snapshot
  };
}

test("profile paper inspector color change for the magenta axis", async ({ page }) => {
  const target = resolvePaperTarget(TARGET_DRAW_LINE);
  if (VERBOSE_PROFILE_LOGS) {
    console.log(
      `[paper-color] target=${JSON.stringify({
        paperPath: PAPER_PATH,
        targetLine: target.targetLine,
        activeFigureId: target.activeFigureId,
        activeFigureNumber: target.activeFigureNumber,
        targetSourceId: target.targetSourceId,
        nextColor: TARGET_NEXT_COLOR
      })}`
    );
  }

  await seedWorkspace(page, target, "doc-profile-paper-color");
  await gotoApp(page, "/edit/");
  await installProbe(page, target.targetSourceId);
  await waitForTargetFigureReady(page, target);

  const summaries: ProfileSummary[] = [];

  async function runScenario(label: string, filename: string) {
    await resetSourceToPaper(page, target.source);
    await waitForTargetFigureReady(page, target);
    await prepareSelectedPath(page, target);
    await resetProbe(page, label);
    const client = await startCDPProfile(page);
    await performColorChange(page);
    await page.waitForTimeout(1200);
    const snapshot = await readProbe(page);
    summaries.push(
      summarizeSnapshot(label, await stopCDPProfile(client, filename), snapshot)
    );
    if (VERBOSE_PROFILE_LOGS) {
      console.log(`[paper-color] ${label}-snapshot=${JSON.stringify({
        targetStroke: snapshot.targetStroke,
        targetStrokeComputed: snapshot.targetStrokeComputed,
        computingTextCount: snapshot.computingTextCount,
        statusBarText: snapshot.statusBarText,
        frameStats: snapshot.frameStats
      })}`);
    }
  }

  await runScenario("color-visible", "paper-color-visible.cpuprofile");

  await openMenuCommand(page, "view", "view.toggle-source-panel");
  await runScenario("color-source-hidden", "paper-color-source-hidden.cpuprofile");

  const report = {
    paperPath: PAPER_PATH,
    targetLine: target.targetLine,
    activeFigureId: target.activeFigureId,
    activeFigureNumber: target.activeFigureNumber,
    targetSourceId: target.targetSourceId,
    nextColor: TARGET_NEXT_COLOR,
    summaries
  };
  fs.mkdirSync(TRACES_DIR, { recursive: true });
  const reportPath = path.join(TRACES_DIR, "paper-color-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`[paper-color] wrote ${reportPath}`);
});

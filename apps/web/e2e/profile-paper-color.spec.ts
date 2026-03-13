import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { parseTikz, type Statement } from "@tikz-editor/core";
import { gotoApp, openMenuCommand, readActiveFigureId, readFigureCount } from "./helpers";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const TRACES_DIR = path.join(THIS_DIR, "traces");
const PAPER_PATH = path.resolve(THIS_DIR, "../../../test/papers/equal_shares_arxiv_v2.tex");
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

type PaperTarget = {
  source: string;
  targetLine: string;
  targetOffset: number;
  activeFigureId: string;
  activeFigureNumber: number;
  targetSourceId: string;
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

function resolvePaperTarget(): PaperTarget {
  const source = fs.readFileSync(PAPER_PATH, "utf8");
  const targetOffset = source.indexOf(TARGET_DRAW_LINE);
  if (targetOffset < 0) {
    throw new Error(`Target draw line not found in ${PAPER_PATH}`);
  }

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
    targetLine: TARGET_DRAW_LINE,
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
          id: "doc-profile-paper-color",
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
      tabOrder: ["doc-profile-paper-color"],
      activeDocumentId: "doc-profile-paper-color",
      recentDocumentIds: ["doc-profile-paper-color"]
    };
    localStorage.setItem("tikz-editor:workspace", JSON.stringify(payload));
  }, {
    source: target.source,
    activeFigureId: target.activeFigureId
  });
}

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
      const sorted = [...frameDeltas].sort((left, right) => left - right);
      const p95Index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
      const avgMs = frameDeltas.reduce((sum, value) => sum + value, 0) / frameDeltas.length;
      return {
        count: frameDeltas.length,
        avgMs,
        p95Ms: sorted[p95Index] ?? null,
        maxMs: sorted[sorted.length - 1] ?? null
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

async function clearSelection(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    (window as typeof window & {
      __TIKZ_EDITOR_APP_TEST_API__?: { clearSelection?: () => void };
    }).__TIKZ_EDITOR_APP_TEST_API__?.clearSelection?.();
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
  const target = resolvePaperTarget();
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

  await seedWorkspace(page, target);
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

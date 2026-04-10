import { expect, test, type Page } from "@playwright/test";
import {
  clickTextHitRegionByTargetId,
  gotoApp,
  readStoreSource,
  resetStorageBeforeNavigation,
  setSource,
  waitForHitRegions
} from "../e2e/helpers";
import {
  captureProfileVariant,
  summarizeFrameDurations,
  writeScenarioReport
} from "./framework";
import { getProfilingScenarioById } from "./scenario-registry";

const MANIFEST = getProfilingScenarioById("node-text-edit");

if (!MANIFEST) {
  throw new Error("Missing profiling manifest for node-text-edit.");
}

const APPEND_TEXT = " that will be interesting";

type ProbeRecord = {
  t: number;
  type: string;
  [key: string]: unknown;
};

type NodeTextEditProbeSnapshot = {
  records: ProbeRecord[];
  sourceRevision: number;
  popupVisible: boolean;
  textareaValueLength: number;
  selectionStart: number | null;
  selectionEnd: number | null;
  overlayRectCount: number;
  caretCount: number;
  frameDurations: number[];
};

type NodeTextEditVariant = {
  id: string;
  label: string;
  dimensions: Record<string, string | number | boolean | null>;
  source: string;
  initialText: string;
  expectedInsertedText: string;
  openEditMode: (page: Page) => Promise<void>;
};

const VARIANTS: NodeTextEditVariant[] = [
  {
    id: "single-line-append",
    label: "Single-line node append at end",
    dimensions: {
      layout: "single-line",
      align: null,
      textWidth: null,
      explicitLineBreaks: false
    },
    source: String.raw`\begin{tikzpicture}
  \node[draw] (C) at (0,0) {Let me think of something long and fun to write};
\end{tikzpicture}`,
    initialText: "Let me think of something long and fun to write",
    expectedInsertedText: `Let me think of something long and fun to write${APPEND_TEXT}`,
    async openEditMode(page) {
      const textRegion = page
        .locator("[data-hit-region-target-id='path:0'][data-hit-region-interaction-mode='text']")
        .first();
      await expect(textRegion).toBeVisible();
      const box = await textRegion.boundingBox();
      if (!box) {
        throw new Error("Missing single-line text hit-region bounds.");
      }
      await page.mouse.click(box.x + box.width - 1, box.y + box.height / 2);
    }
  },
  {
    id: "wrapped-left-width-60pt-append",
    label: "Wrapped align-left 60pt append",
    dimensions: {
      layout: "wrapped",
      align: "left",
      textWidth: "60pt",
      explicitLineBreaks: false
    },
    source: String.raw`\begin{tikzpicture}
  \node[draw, align=left, text width=60pt] (C) at (0,0) {Let me think of something long and fun to write};
\end{tikzpicture}`,
    initialText: "Let me think of something long and fun to write",
    expectedInsertedText: `Let me think of something long and fun to write${APPEND_TEXT}`,
    async openEditMode(page) {
      await clickTextHitRegionByTargetId(page, "path:0");
    }
  },
  {
    id: "manual-breaks-left-append",
    label: "Explicit multiline align-left append",
    dimensions: {
      layout: "explicit-multiline",
      align: "left",
      textWidth: null,
      explicitLineBreaks: true
    },
    source: String.raw`\begin{tikzpicture}
  \node[draw, align=left] (C) at (0,0) {Let me think of something long\\ and fun to write};
\end{tikzpicture}`,
    initialText: String.raw`Let me think of something long\\ and fun to write`,
    expectedInsertedText: String.raw`Let me think of something long\\ and fun to write that will be interesting`,
    async openEditMode(page) {
      await clickTextHitRegionByTargetId(page, "path:0");
    }
  }
];

test.beforeEach(async ({ page }) => {
  await resetStorageBeforeNavigation(page);
});

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

async function installProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const globalLike = window as typeof window & {
      __PW_NODE_TEXT_EDIT_PROBE__?: {
        reset: (label: string) => void;
        snapshot: () => NodeTextEditProbeSnapshot;
      };
      __PW_NODE_TEXT_EDIT_PROBE_INSTALLED__?: boolean;
    };
    if (globalLike.__PW_NODE_TEXT_EDIT_PROBE_INSTALLED__) {
      return;
    }
    globalLike.__PW_NODE_TEXT_EDIT_PROBE_INSTALLED__ = true;

    let start = performance.now();
    let records: ProbeRecord[] = [];
    const frameDurations: number[] = [];
    let previousFrameTs: number | null = null;
    let rafId = 0;
    let lastPopupVisible: boolean | null = null;
    let lastSourceRevision = Number.NaN;
    let lastTextareaValueLength = Number.NaN;
    let lastSelectionStart: number | null = null;
    let lastSelectionEnd: number | null = null;
    let lastOverlayRectCount = -1;
    let lastCaretCount = -1;

    const sourceRevision = (): number =>
      (window as typeof window & {
        __TIKZ_EDITOR_APP_TEST_API__?: { getSourceRevision?: () => number };
      }).__TIKZ_EDITOR_APP_TEST_API__?.getSourceRevision?.() ?? 0;

    const popup = (): HTMLElement | null =>
      document.querySelector('[data-testid="canvas-text-edit-popup"]');

    const textarea = (): HTMLTextAreaElement | null =>
      document.querySelector('[data-testid="canvas-text-edit-textarea"]');

    const popupVisible = (): boolean => {
      const element = popup();
      if (!element) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        (rect.width > 0 || rect.height > 0) &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        Number(style.opacity || "1") > 0
      );
    };

    const textareaSnapshot = () => {
      const element = textarea();
      return {
        valueLength: element?.value.length ?? 0,
        selectionStart: element?.selectionStart ?? null,
        selectionEnd: element?.selectionEnd ?? null
      };
    };

    const overlayRectCount = (): number => document.querySelectorAll('[data-testid="canvas-text-selection-rect"]').length;
    const caretCount = (): number => document.querySelectorAll('[data-testid="canvas-text-selection-caret"]').length;

    const record = (type: string, detail: Record<string, unknown> = {}) => {
      records.push({
        t: performance.now() - start,
        type,
        ...detail
      });
    };

    const sample = (reason: string) => {
      const nextPopupVisible = popupVisible();
      if (nextPopupVisible !== lastPopupVisible) {
        lastPopupVisible = nextPopupVisible;
        record("popup-visible", { reason, popupVisible: nextPopupVisible });
      }

      const nextSourceRevision = sourceRevision();
      if (nextSourceRevision !== lastSourceRevision) {
        lastSourceRevision = nextSourceRevision;
        record("source-revision", { reason, sourceRevision: nextSourceRevision });
      }

      const nextTextarea = textareaSnapshot();
      if (nextTextarea.valueLength !== lastTextareaValueLength) {
        lastTextareaValueLength = nextTextarea.valueLength;
        record("textarea-value-length", { reason, valueLength: nextTextarea.valueLength });
      }
      if (
        nextTextarea.selectionStart !== lastSelectionStart ||
        nextTextarea.selectionEnd !== lastSelectionEnd
      ) {
        lastSelectionStart = nextTextarea.selectionStart;
        lastSelectionEnd = nextTextarea.selectionEnd;
        record("textarea-selection", {
          reason,
          selectionStart: nextTextarea.selectionStart,
          selectionEnd: nextTextarea.selectionEnd
        });
      }

      const nextOverlayRectCount = overlayRectCount();
      if (nextOverlayRectCount !== lastOverlayRectCount) {
        lastOverlayRectCount = nextOverlayRectCount;
        record("overlay-rect-count", { reason, overlayRectCount: nextOverlayRectCount });
      }

      const nextCaretCount = caretCount();
      if (nextCaretCount !== lastCaretCount) {
        lastCaretCount = nextCaretCount;
        record("caret-count", { reason, caretCount: nextCaretCount });
      }
    };

    const observer = new MutationObserver(() => {
      sample("mutation");
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true
    });

    const step = (now: number) => {
      if (previousFrameTs != null) {
        frameDurations.push(Math.max(0, now - previousFrameTs));
      }
      previousFrameTs = now;
      sample("raf");
      rafId = window.requestAnimationFrame(step);
    };
    rafId = window.requestAnimationFrame(step);

    globalLike.__PW_NODE_TEXT_EDIT_PROBE__ = {
      reset(label: string) {
        start = performance.now();
        records = [];
        frameDurations.length = 0;
        previousFrameTs = null;
        lastPopupVisible = null;
        lastSourceRevision = Number.NaN;
        lastTextareaValueLength = Number.NaN;
        lastSelectionStart = null;
        lastSelectionEnd = null;
        lastOverlayRectCount = -1;
        lastCaretCount = -1;
        record("reset", { label });
        sample("reset");
      },
      snapshot() {
        sample("snapshot");
        const textareaState = textareaSnapshot();
        return {
          records: [...records],
          sourceRevision: sourceRevision(),
          popupVisible: popupVisible(),
          textareaValueLength: textareaState.valueLength,
          selectionStart: textareaState.selectionStart,
          selectionEnd: textareaState.selectionEnd,
          overlayRectCount: overlayRectCount(),
          caretCount: caretCount(),
          frameDurations: [...frameDurations]
        };
      }
    };

    window.addEventListener("beforeunload", () => {
      observer.disconnect();
      window.cancelAnimationFrame(rafId);
    });
  });
}

async function resetProbe(page: Page, label: string): Promise<void> {
  await page.evaluate((nextLabel) => {
    (window as typeof window & {
      __PW_NODE_TEXT_EDIT_PROBE__?: { reset: (label: string) => void };
    }).__PW_NODE_TEXT_EDIT_PROBE__?.reset(nextLabel);
  }, label);
}

async function readProbe(page: Page): Promise<NodeTextEditProbeSnapshot> {
  return await page.evaluate(() => {
    const probe = (window as typeof window & {
      __PW_NODE_TEXT_EDIT_PROBE__?: { snapshot: () => NodeTextEditProbeSnapshot };
    }).__PW_NODE_TEXT_EDIT_PROBE__;
    if (!probe) {
      throw new Error("Node text edit probe not installed.");
    }
    return probe.snapshot();
  });
}

function summarizeProbe(snapshot: NodeTextEditProbeSnapshot) {
  const baselineRevision = snapshot.records.find((record) => record.type === "source-revision");
  const firstPopupVisible = snapshot.records.find(
    (record) => record.type === "popup-visible" && record.popupVisible === true
  );
  const firstSelectionAtEnd = snapshot.records.find(
    (record) =>
      record.type === "textarea-selection" &&
      record.selectionStart != null &&
      record.selectionStart === record.selectionEnd &&
      Number(record.selectionStart) > 0
  );
  const firstSourceRewrite = snapshot.records.find((record) =>
    record.type === "source-revision" &&
    record !== baselineRevision &&
    Number(record.sourceRevision ?? 0) > Number(baselineRevision?.sourceRevision ?? 0)
  );
  const lastValueLength = [...snapshot.records]
    .reverse()
    .find((record) => record.type === "textarea-value-length");

  return {
    metrics: {
      msToPopupVisible: firstPopupVisible ? Number(firstPopupVisible.t.toFixed(2)) : null,
      msToTextareaSelectionEvent: firstSelectionAtEnd ? Number(firstSelectionAtEnd.t.toFixed(2)) : null,
      msToFirstSourceRewrite: firstSourceRewrite ? Number(firstSourceRewrite.t.toFixed(2)) : null,
      finalTextareaValueLength: snapshot.textareaValueLength,
      finalSelectionStart: snapshot.selectionStart,
      finalSelectionEnd: snapshot.selectionEnd,
      finalOverlayRectCount: snapshot.overlayRectCount,
      finalCaretCount: snapshot.caretCount,
      lastRecordedValueLength: lastValueLength ? Number(lastValueLength.valueLength ?? 0) : null
    },
    frameStats: summarizeFrameDurations(snapshot.frameDurations),
    probeSnapshot: snapshot
  };
}

async function prepareVariant(page: Page, variant: NodeTextEditVariant): Promise<void> {
  await gotoApp(page, "/editor/");
  await setSource(page, variant.source);
  await waitForHitRegions(page, 1);
  await installProbe(page);
}

async function runVariant(page: Page, variant: NodeTextEditVariant) {
  await resetProbe(page, variant.id);
  await variant.openEditMode(page);

  const textarea = page.getByTestId("canvas-text-edit-textarea");
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeFocused();
  await expect(textarea).toHaveValue(variant.initialText);

  await setTextareaSelection(page, variant.initialText.length, variant.initialText.length);
  await textarea.press("End");
  await expect.poll(async () => {
    return await textarea.evaluate((element) => {
      const textareaElement = element as HTMLTextAreaElement;
      return {
        start: textareaElement.selectionStart,
        end: textareaElement.selectionEnd
      };
    });
  }).toEqual({
    start: variant.initialText.length,
    end: variant.initialText.length
  });

  await textarea.fill(variant.expectedInsertedText);

  await expect(textarea).toHaveValue(variant.expectedInsertedText);
  await expect.poll(async () => await readStoreSource(page)).toContain(`{${variant.expectedInsertedText}}`);

  const probe = await readProbe(page);
  return summarizeProbe(probe);
}

test("profiles node text editing append variants", async ({ page }, testInfo) => {
  const variants = [];

  for (const variant of VARIANTS) {
    await prepareVariant(page, variant);
    const captured = await captureProfileVariant({
      page,
      scenarioId: MANIFEST.id,
      variantId: variant.id,
      label: variant.label,
      dimensions: variant.dimensions,
      run: async () => await runVariant(page, variant)
    });
    variants.push(captured);
  }

  const reportPath = writeScenarioReport(MANIFEST, testInfo, variants);
  console.log(`[profiling] wrote ${reportPath}`);
});

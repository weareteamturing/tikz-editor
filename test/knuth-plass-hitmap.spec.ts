import { describe, expect, it } from "vitest";
import type { ParagraphLayoutReport } from "../packages/core/src/text/knuth-plass/paragraph/report.js";
import { getKnuthPlassLineRangeFromPoint } from "../packages/core/src/text/knuth-plass/editor/hitmap.js";
import { clientPoint } from "../packages/core/src/coords/index.js";

function makeLineElement(bounds: { left: number; top: number; right: number; bottom: number }, viewBoxWidth: number): any {
  return {
    getBoundingClientRect: () => ({
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom
    }),
    getScreenCTM: () => ({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 0,
      f: 0
    }),
    ownerSVGElement: {
      viewBox: {
        baseVal: {
          width: viewBoxWidth
        }
      }
    }
  };
}

function makeTwoLineReport(): ParagraphLayoutReport {
  return {
    paragraphId: "paragraph:1",
    width: 17,
    alignment: "ragged-right",
    lines: [
      {
        lineIndex: 0,
        startRun: 0,
        endRun: 0,
        width: 11,
        targetWidth: 11,
        naturalWidth: 11,
        glueSetRatio: 0,
        badness: 0,
        spaceCount: 0,
        spaceDeltaPerGap: 0,
        ascent: 8,
        descent: 2,
        xStart: 0,
        xEnd: 11,
        break: null,
        segments: [
          {
            runIndex: 0,
            kind: "text",
            text: "Hello World",
            startOffset: 0,
            endOffset: 11,
            x: 0,
            width: 11,
            caretStops: Array.from({ length: 12 }, (_, index) => index)
          }
        ]
      },
      {
        lineIndex: 1,
        startRun: 0,
        endRun: 0,
        width: 6,
        targetWidth: 6,
        naturalWidth: 6,
        glueSetRatio: 0,
        badness: 0,
        spaceCount: 0,
        spaceDeltaPerGap: 0,
        ascent: 8,
        descent: 2,
        xStart: 0,
        xEnd: 6,
        break: null,
        segments: [
          {
            runIndex: 0,
            kind: "text",
            text: " Again",
            startOffset: 11,
            endOffset: 17,
            x: 0,
            width: 6,
            caretStops: Array.from({ length: 7 }, (_, index) => index)
          }
        ]
      }
    ],
    runs: [
      {
        runIndex: 0,
        kind: "text",
        sourceStart: 0,
        sourceEnd: 17,
        width: 17,
        text: "Hello World Again"
      }
    ],
    errors: [],
    internalMode: "canonical",
    internalDegradeReason: null,
    externalFallbackUsed: false,
    linebreakingMode: "feasible"
  };
}

describe("knuth-plass hitmap line ranges", () => {
  it("returns visual line offsets for a point", async () => {
    const report = makeTwoLineReport();
    const outputJax = {
      linebreaks: {
        getReports: () => [report]
      }
    };
    const containerElement = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: 11, bottom: 10 }, report.width),
        makeLineElement({ left: 0, top: 12, right: 6, bottom: 22 }, report.width)
      ]
    };

    const result = await getKnuthPlassLineRangeFromPoint(outputJax, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World Again",
      containerElement,
      clientPoint: clientPoint(3, 16)
    });

    expect(result).toEqual({
      ok: true,
      paragraphId: "paragraph:1",
      lineIndex: 1,
      lineStartOffset: 11,
      lineEndOffset: 17,
      error: null
    });
  });

  it("returns paragraph-not-found when reports do not include the paragraph", async () => {
    const result = await getKnuthPlassLineRangeFromPoint(
      {
        linebreaks: {
          getReports: () => []
        }
      },
      {
        paragraphId: "missing",
        sourceText: "Hello",
        containerElement: {},
        clientPoint: clientPoint(0, 0)
      }
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("paragraph-not-found");
  });

  it("returns geometry-error when line geometry cannot be resolved", async () => {
    const report = makeTwoLineReport();
    const outputJax = {
      linebreaks: {
        getReports: () => [report]
      }
    };
    const result = await getKnuthPlassLineRangeFromPoint(outputJax, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World Again",
      containerElement: {
        querySelectorAll: () => []
      },
      clientPoint: clientPoint(0, 0)
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("geometry-error");
  });
});

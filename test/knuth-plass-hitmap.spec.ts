import { describe, expect, it } from "vitest";
import type { ParagraphLayoutReport } from "../packages/core/src/text/knuth-plass/paragraph/report.js";
import {
  getKnuthPlassLineRangeFromPoint,
  getKnuthPlassPointFromOffset,
  getKnuthPlassSelectionRects
} from "../packages/core/src/text/knuth-plass/editor/hitmap.js";
import { clientPoint, px } from "../packages/core/src/coords/index.js";

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

function makeExplicitMultilineMathReport(): ParagraphLayoutReport {
  return {
    paragraphId: "paragraph:math",
    width: 3.478,
    alignment: "center",
    lines: [
      {
        lineIndex: 0,
        startRun: 0,
        endRun: 0,
        width: 0.572,
        targetWidth: 0.572,
        naturalWidth: 0.572,
        glueSetRatio: 0,
        badness: 0,
        spaceCount: 0,
        spaceDeltaPerGap: 0,
        ascent: 8,
        descent: 2,
        xStart: 1.453,
        xEnd: 2.025,
        break: null,
        segments: [
          {
            runIndex: 0,
            kind: "math",
            x: 1.453,
            width: 0.572,
            caretStops: [1.453, 2.025]
          }
        ]
      },
      {
        lineIndex: 1,
        startRun: 2,
        endRun: 2,
        width: 3.476,
        targetWidth: 3.476,
        naturalWidth: 3.476,
        glueSetRatio: 0,
        badness: 0,
        spaceCount: 0,
        spaceDeltaPerGap: 0,
        ascent: 8,
        descent: 2,
        xStart: 0.001,
        xEnd: 3.477,
        break: null,
        segments: [
          {
            runIndex: 2,
            kind: "text",
            text: "variable",
            startOffset: 0,
            endOffset: 8,
            x: 0.001,
            width: 3.476,
            caretStops: [0.001, 0.529, 1.029, 1.421, 1.699, 2.199, 2.755, 3.033, 3.477]
          }
        ]
      }
    ],
    runs: [
      {
        runIndex: 0,
        kind: "math",
        sourceStart: 0,
        sourceEnd: 3,
        width: 0.572
      },
      {
        runIndex: 1,
        kind: "space",
        sourceStart: 3,
        sourceEnd: 5,
        width: 0,
        text: " "
      },
      {
        runIndex: 2,
        kind: "text",
        sourceStart: 5,
        sourceEnd: 13,
        width: 3.476,
        text: "variable"
      }
    ],
    errors: [],
    internalMode: "canonical",
    internalDegradeReason: null,
    externalFallbackUsed: false,
    linebreakingMode: "feasible"
  };
}

function makeTex2Svg(width: number): () => { querySelector: () => { getAttribute: (name: string) => string | null } } {
  return () => ({
    querySelector: () => ({
      getAttribute: (name: string) => (name === "viewBox" ? `0 0 ${width} 1` : null)
    })
  });
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
      clientPoint: clientPoint(px(3), px(16))
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
        clientPoint: clientPoint(px(0), px(0))
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
      clientPoint: clientPoint(px(0), px(0))
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("geometry-error");
  });

  it("resolves normalized explicit multiline math caret points through the paragraph hitmap", async () => {
    const report = makeExplicitMultilineMathReport();
    const outputJax = {
      tex2svg: makeTex2Svg(1),
      linebreaks: {
        getReports: () => [report]
      }
    };
    const containerElement = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: 1, bottom: 10 }, report.width),
        makeLineElement({ left: 0, top: 12, right: 3.476, bottom: 22 }, report.width)
      ]
    };
    const sourceText = String.raw`$x$\\variable`;

    const points = await Promise.all(
      [0, 1, 2, 3, 4].map((offset) =>
        getKnuthPlassPointFromOffset(outputJax, {
          paragraphId: report.paragraphId,
          sourceText,
          containerElement,
          offset
        })
      )
    );

    for (const point of points) {
      expect(point.ok).toBe(true);
      expect(point.error).toBeNull();
      expect(point.clientPoint).not.toBeNull();
    }

    expect(points[0].clientPoint?.x).toBe(points[1].clientPoint?.x);
    expect(points[2].clientPoint?.x).toBe(points[3].clientPoint?.x);
    expect((points[2].clientPoint?.x ?? 0)).toBeGreaterThan(points[1].clientPoint?.x ?? 0);
    expect(points[4].lineIndex).toBe(1);
  });

  it("returns selection rects for normalized explicit multiline math source", async () => {
    const report = makeExplicitMultilineMathReport();
    const outputJax = {
      tex2svg: makeTex2Svg(1),
      linebreaks: {
        getReports: () => [report]
      }
    };
    const containerElement = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: 1, bottom: 10 }, report.width),
        makeLineElement({ left: 0, top: 12, right: 3.476, bottom: 22 }, report.width)
      ]
    };

    const rects = await getKnuthPlassSelectionRects(outputJax, {
      paragraphId: report.paragraphId,
      sourceText: String.raw`$x$\\variable`,
      containerElement,
      startOffset: 0,
      endOffset: 13
    });

    expect(rects.ok).toBe(true);
    expect(rects.rects).toHaveLength(2);
  });
});

import { describe, expect, it } from "vitest";
import type { ParagraphLayoutReport } from "../packages/core/src/text/knuth-plass/paragraph/report.js";
import {
  __getKnuthPlassCaretMappingCacheSize,
  clearKnuthPlassCaretMappingCache,
  getKnuthPlassCaretFromPoint,
  getKnuthPlassLineRangeFromPoint,
  getKnuthPlassPointFromOffset,
  getKnuthPlassSelectionRects
} from "../packages/core/src/text/knuth-plass/editor/hitmap.js";
import {
  createMathPrefixCache,
  finalizePrefixWidthTable,
  findNearestPrefixIndexFromTable,
  hasDanglingMathScriptOperator,
  normalizeMathSourceForCache,
  readPrefixUnitsFromTable,
  scanTeXPrefixState,
  seedPrefixWidthTable,
  stabilizePrefixForMeasurement
} from "../packages/core/src/text/knuth-plass/editor/mathPrefix.js";
import { parseSourceSpans } from "../packages/core/src/text/knuth-plass/editor/sourceParser.js";
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
    layoutMode: "wrap",
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

function makeSingleLineReport(): ParagraphLayoutReport {
  const report = makeTwoLineReport();
  return {
    ...report,
    width: 11,
    lines: [report.lines[0]],
    runs: [
      {
        runIndex: 0,
        kind: "text",
        sourceStart: 0,
        sourceEnd: 11,
        width: 11,
        text: "Hello World"
      }
    ]
  };
}

function makeExplicitMultilineMathReport(): ParagraphLayoutReport {
  return {
    paragraphId: "paragraph:math",
    width: 3.478,
    alignment: "center",
    layoutMode: "fixed-lines",
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

describe("knuth-plass math prefix helpers", () => {
  it("parses escaped and delimited math source spans", () => {
    const parsed = parseSourceSpans(String.raw`pre \$x \(a\) mid $b\$c$ post`);

    expect(parsed.error).toBeNull();
    expect(parsed.spans.map((span) => span.kind)).toEqual(["text", "math", "text", "math", "text"]);
    expect(parsed.spans[1]).toMatchObject({
      kind: "math",
      delimiter: "paren",
      content: "a"
    });
    expect(parsed.spans[3]).toMatchObject({
      kind: "math",
      delimiter: "dollar",
      content: String.raw`b\$c`
    });

    expect(parseSourceSpans(String.raw`\) stray`).error).toMatchObject({
      code: "unexpected-close-delimiter",
      index: 0
    });
    expect(parseSourceSpans("text $x").error).toMatchObject({
      code: "unclosed-math",
      index: 5
    });
    expect(parseSourceSpans(String.raw`text \(x`).error).toMatchObject({
      code: "unclosed-math",
      index: 5
    });
    expect(parseSourceSpans(String.raw`\\) escaped close`).spans).toEqual([
      {
        kind: "text",
        rawStart: 0,
        rawEnd: 17,
        text: String.raw`\\) escaped close`
      }
    ]);
  });

  it("stabilizes incomplete TeX prefixes for measurement", () => {
    expect(hasDanglingMathScriptOperator("x^   ")).toBe(true);
    expect(hasDanglingMathScriptOperator(String.raw`x\^`)).toBe(false);
    expect(hasDanglingMathScriptOperator("plain")).toBe(false);

    expect(scanTeXPrefixState(String.raw`\(\left(x`).inMath).toBe(true);
    expect(scanTeXPrefixState(String.raw`\(\left(x`).unclosedLeftCount).toBe(1);
    expect(scanTeXPrefixState(String.raw`$x$`).mathMode).toBe("none");
    expect(scanTeXPrefixState("\\").trailingEscape).toBe(true);
    expect(scanTeXPrefixState("{x").braceDepth).toBe(1);

    expect(stabilizePrefixForMeasurement("\\(\\left{x^")).toBe("\\(\\left{x^}\\right.\\)");
    expect(stabilizePrefixForMeasurement("$x\\")).toBe("$x\\phantom{}$");
    expect(stabilizePrefixForMeasurement("{x")).toBe("{x}");
  });

  it("normalizes prefix width tables and nearest-index lookup", () => {
    expect(seedPrefixWidthTable(3, 9)).toEqual([0, Number.NaN, Number.NaN, 9]);
    expect(finalizePrefixWidthTable([], 10)).toEqual([]);
    expect(finalizePrefixWidthTable([5, Number.NaN, -1, 20], 12)).toEqual([0, 0, 0, 12]);

    expect(readPrefixUnitsFromTable(Number.POSITIVE_INFINITY, 4, 20, [0, 5, 10, 15, 20])).toBe(0);
    expect(readPrefixUnitsFromTable(2, 4, 20, [0, 5, 10, 15, 20])).toBe(10);
    expect(readPrefixUnitsFromTable(2, 4, 20, [])).toBe(10);

    expect(findNearestPrefixIndexFromTable(8, 4, 20, [])).toBe(2);
    expect(findNearestPrefixIndexFromTable(11, 4, 20, [0, 4, 12, 17, 20])).toBe(2);
    expect(findNearestPrefixIndexFromTable(0, 0, 20, [])).toBe(0);
    expect(normalizeMathSourceForCache("dollar", "  x   +   y ")).toBe("dollar:x + y");
  });

  it("builds, caches, and evicts measured math prefix tables", async () => {
    let calls = 0;
    const cache = createMathPrefixCache(1);
    const outputJax = {
      tex2svg: (tex: string) => {
        calls += 1;
        return {
          querySelector: () => ({
            getAttribute: (name: string) => (name === "viewBox" ? `0 0 ${tex.length} 1` : null)
          })
        };
      }
    };

    const first = await cache.getOrBuild(outputJax, {
      delimiter: "dollar",
      raw: "$\\alpha x$",
      content: String.raw`\alpha x`,
      contentStart: 1,
      contentEnd: 9,
      span: { from: 0, to: 10 }
    });
    const second = await cache.getOrBuild(outputJax, {
      delimiter: "dollar",
      raw: "$ \\alpha   x $",
      content: String.raw` \alpha x `,
      contentStart: 1,
      contentEnd: 11,
      span: { from: 0, to: 12 }
    });
    const third = await cache.getOrBuild(outputJax, {
      delimiter: "paren",
      raw: String.raw`\(\beta\)`,
      content: String.raw`\beta`,
      contentStart: 2,
      contentEnd: 7,
      span: { from: 0, to: 9 }
    });

    expect(first[0]).toBe(0);
    expect(first[first.length - 1]).toBe(1);
    expect(second).toBe(first);
    expect(third).not.toBe(first);
    expect(calls).toBeGreaterThan(0);

    const fallback = await cache.getOrBuild({
      tex2svg: () => ({
        firstElementChild: {
          getAttribute: (name: string) => (name === "width" ? "0" : null),
          getBBox: () => ({ width: 0 })
        }
      })
    }, {
      delimiter: "paren",
      raw: String.raw`\(\bad\)`,
      content: String.raw`\bad`,
      contentStart: 2,
      contentEnd: 6,
      span: { from: 0, to: 8 }
    });
    expect(fallback).toEqual([0, 0.25, 0.5, 0.75, 1]);

    await expect(cache.getOrBuild({}, {
      delimiter: "dollar",
      raw: "$x$",
      content: "x",
      contentStart: 1,
      contentEnd: 2,
      span: { from: 0, to: 3 }
    })).rejects.toThrow("No tex2svg");
  });

  it("can measure through the global MathJax adaptor runtime", async () => {
    const previousMathJax = (globalThis as { MathJax?: unknown }).MathJax;
    try {
      (globalThis as { MathJax?: unknown }).MathJax = {
        startup: {
          adaptor: {
            firstChild: () => ({ kind: "svg" }),
            getAttribute: (_node: unknown, name: string) => (name === "viewBox" ? "0 0 7 1" : null)
          }
        }
      };
      const table = await createMathPrefixCache().getOrBuild({
        mathjax: {
          tex2svg: () => ({})
        }
      }, {
        delimiter: "dollar",
        raw: "$x$",
        content: "x",
        contentStart: 1,
        contentEnd: 2,
        span: { from: 0, to: 3 }
      });

      expect(table).toEqual([0, 1]);
    } finally {
      (globalThis as { MathJax?: unknown }).MathJax = previousMathJax;
    }
  });
});

describe("knuth-plass hitmap line ranges", () => {
  it("returns invalid-params for incomplete caret mapping requests", async () => {
    const outputJax = {
      linebreaks: {
        getReports: () => []
      }
    };

    await expect(
      getKnuthPlassCaretFromPoint(outputJax, {
        paragraphId: "",
        sourceText: "Hello",
        containerElement: {},
        clientPoint: clientPoint(px(0), px(0))
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-params" } });
    await expect(
      getKnuthPlassPointFromOffset(outputJax, {
        paragraphId: "",
        sourceText: "Hello",
        containerElement: {},
        offset: 0
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-params" } });
    await expect(
      getKnuthPlassSelectionRects(outputJax, {
        paragraphId: "",
        sourceText: "Hello",
        containerElement: {},
        startOffset: 0,
        endOffset: 1
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-params" } });
  });

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

  it("maps caret points to the nearest measured stop and reuses cached geometry", async () => {
    const report = makeTwoLineReport();
    const outputJax = {
      linebreaks: {
        getReports: () => [report]
      }
    };
    const containerElement = {
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 11, bottom: 22, width: 11, height: 22 }),
      getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: 11, bottom: 10 }, report.width),
        makeLineElement({ left: 0, top: 12, right: 6, bottom: 22 }, report.width)
      ]
    };

    clearKnuthPlassCaretMappingCache(outputJax);
    const result = await getKnuthPlassCaretFromPoint(outputJax, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World Again",
      containerElement,
      clientPoint: clientPoint(px(4.6), px(2))
    });
    const cached = await getKnuthPlassPointFromOffset(outputJax, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World Again",
      containerElement,
      offset: 999
    });

    expect(result).toMatchObject({
      ok: true,
      paragraphId: "paragraph:1",
      offset: 5,
      lineIndex: 0,
      kind: "text",
      snappedToMathPrefix: false,
      error: null
    });
    expect(cached.ok).toBe(true);
    expect(cached.offset).toBe(17);
    expect(__getKnuthPlassCaretMappingCacheSize(outputJax)).toBe(1);

    clearKnuthPlassCaretMappingCache(outputJax);
    expect(__getKnuthPlassCaretMappingCacheSize(outputJax)).toBe(0);
  });

  it("uses the paragraph root as single-line fallback geometry", async () => {
    const report = makeSingleLineReport();
    const lineElement = makeLineElement({ left: 0, top: 0, right: 11, bottom: 10 }, report.width);
    const outputJax = {
      linebreaks: {
        getReports: () => [report]
      }
    };
    const containerElement = {
      querySelectorAll: () => [],
      querySelector: (selector: string) => selector === "[data-paragraph-id]" ? lineElement : null
    };

    const result = await getKnuthPlassLineRangeFromPoint(outputJax, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World",
      containerElement,
      clientPoint: clientPoint(px(5), px(2))
    });

    expect(result).toEqual({
      ok: true,
      paragraphId: "paragraph:1",
      lineIndex: 0,
      lineStartOffset: 0,
      lineEndOffset: 11,
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

  it("maps source parse and alignment failures to specific errors", async () => {
    const report = makeSingleLineReport();
    const outputJax = {
      linebreaks: {
        getReports: () => [report]
      }
    };
    const containerElement = {
      querySelectorAll: () => [
        makeLineElement({ left: 0, top: 0, right: 11, bottom: 10 }, report.width)
      ]
    };

    const sourceParse = await getKnuthPlassPointFromOffset(outputJax, {
      paragraphId: report.paragraphId,
      sourceText: "$unterminated",
      containerElement,
      offset: 0
    });
    expect(sourceParse.ok).toBe(false);
    expect(sourceParse.error?.code).toBe("source-parse-error");

    const missingRuns = await getKnuthPlassPointFromOffset(
      {
        linebreaks: {
          getReports: () => [{ ...report, runs: [] }]
        }
      },
      {
        paragraphId: report.paragraphId,
        sourceText: "Hello World",
        containerElement,
        offset: 0
      }
    );
    expect(missingRuns.ok).toBe(false);
    expect(missingRuns.error?.code).toBe("alignment-error");
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

  it("handles collapsed and reversed selection ranges", async () => {
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

    const collapsed = await getKnuthPlassSelectionRects(outputJax, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World Again",
      containerElement,
      startOffset: 4,
      endOffset: 4
    });
    expect(collapsed).toMatchObject({ ok: true, startOffset: 4, endOffset: 4, rects: [] });

    const reversed = await getKnuthPlassSelectionRects(outputJax, {
      paragraphId: report.paragraphId,
      sourceText: "Hello World Again",
      containerElement,
      startOffset: 15,
      endOffset: 3
    });
    expect(reversed.ok).toBe(true);
    expect(reversed.startOffset).toBe(3);
    expect(reversed.endOffset).toBe(15);
    expect(reversed.rects.map((rect) => rect.lineIndex)).toEqual([0, 1]);
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

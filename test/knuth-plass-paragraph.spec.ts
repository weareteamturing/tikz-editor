import { describe, expect, it } from "vitest";

import { collectBreakablePenalties, collectSpaceBreakpoints } from "../packages/core/src/text/knuth-plass/paragraph/breakpoints.js";
import { breakWithDp } from "../packages/core/src/text/knuth-plass/paragraph/dp.js";
import { greedyBreakParagraph } from "../packages/core/src/text/knuth-plass/paragraph/greedy.js";
import { createMeasurementService } from "../packages/core/src/text/knuth-plass/paragraph/measure.js";
import {
  buildParagraphLayoutReport,
  getOrBuildTextSegmentCaretStops
} from "../packages/core/src/text/knuth-plass/paragraph/report.js";
import { flattenParagraph } from "../packages/core/src/text/knuth-plass/paragraph/tokenize.js";
import type { Item, ParagraphModel } from "../packages/core/src/text/knuth-plass/paragraph/items.js";
import type { ParagraphRun } from "../packages/core/src/text/knuth-plass/paragraph/types.js";

const wrapper = {};

function node(kind: string, extra: Record<string, unknown> = {}) {
  return {
    isKind: (candidate: string) => candidate === kind,
    kind,
    ...extra
  };
}

function textChild(text: string) {
  return {
    node: node("text", {
      getText: () => text
    })
  };
}

function mtext(...children: any[]) {
  return {
    node: node("mtext"),
    childNodes: children,
    textWidth: (text: string) => text.length
  };
}

function mspace(attrs: Record<string, string> = {}) {
  return {
    node: node("mspace", {
      attributes: {
        get: (name: string) => attrs[name] ?? null
      }
    }),
    canBreak: true
  };
}

function textRun(runIndex: number, text: string, sourceStart: number): ParagraphRun {
  return {
    kind: "text",
    runIndex,
    sourceStart,
    sourceEnd: sourceStart + text.length,
    text,
    wrapper,
    childIndex: 0,
    wordIndex: runIndex
  };
}

function spaceRun(runIndex: number, sourceStart: number): ParagraphRun {
  return {
    kind: "space",
    runIndex,
    sourceStart,
    sourceEnd: sourceStart + 1,
    text: " ",
    wrapper,
    breakRef: {
      kind: "mtext-space",
      wrapper,
      childIndex: 0,
      wordIndex: runIndex
    }
  };
}

function model(runs: ParagraphRun[], widths: number[], items: Item[]): ParagraphModel {
  return {
    runs,
    items,
    runWidths: new Map(runs.map((run, index) => [run.runIndex, widths[index] ?? 0])),
    errors: [],
    measurement: {
      measurePrefix: (_word: string, n: number) => n
    } as ParagraphModel["measurement"]
  };
}

function spacePenalty(runIndex: number, penalty = 0): Item {
  return {
    kind: "penalty",
    width: 0,
    penalty,
    payload: {
      runIndex,
      breakKind: "space",
      sourceOffset: runIndex + 1,
      visibleHyphen: false
    }
  };
}

function forcedPenalty(runIndex: number): Item {
  return {
    kind: "penalty",
    width: 0,
    penalty: -10000,
    payload: {
      runIndex,
      breakKind: "forced",
      sourceOffset: runIndex + 1,
      visibleHyphen: false
    }
  };
}

function hyphenPenalty(runIndex: number, splitOffset: number, penalty = 50): Item {
  return {
    kind: "penalty",
    width: 1,
    penalty,
    flagged: true,
    payload: {
      runIndex,
      breakKind: "hyphen",
      sourceOffset: splitOffset,
      visibleHyphen: true,
      splitOffset,
      hyphenSource: "automatic"
    }
  };
}

function glue(runIndex: number, stretch = 1, shrink = 1): Item {
  return {
    kind: "glue",
    width: 0,
    stretch,
    shrink,
    payload: { runIndex }
  };
}

describe("knuth-plass paragraph helpers", () => {
  it("skips linebreaking and reports an error for non-positive target widths", () => {
    const runs = [textRun(0, "Alpha", 0), spaceRun(1, 5), textRun(2, "Beta", 6)];
    const result = greedyBreakParagraph(model(runs, [5, 1, 4], [spacePenalty(1)]), 0);

    expect(result.errors).toEqual(["Target width was non-positive; linebreaking was skipped."]);
    expect(result.lines).toEqual([
      {
        lineIndex: 0,
        startRun: 0,
        startTextOffset: 0,
        endRun: 2,
        endTextOffset: null,
        width: 10,
        break: null
      }
    ]);
  });

  it("breaks greedily at spaces and skips leading spaces on following lines", () => {
    const runs = [
      textRun(0, "Aaaa", 0),
      spaceRun(1, 4),
      spaceRun(2, 5),
      textRun(3, "Bbbb", 6),
      spaceRun(4, 10),
      textRun(5, "Cccc", 11)
    ];
    const result = greedyBreakParagraph(
      model(runs, [4, 1, 1, 4, 1, 4], [spacePenalty(1), spacePenalty(2), spacePenalty(4)]),
      6
    );

    expect(result.errors).toEqual([]);
    expect(result.lines.map((line) => ({
      startRun: line.startRun,
      endRun: line.endRun,
      width: line.width,
      breakRun: line.break?.runIndex ?? null
    }))).toEqual([
      { startRun: 0, endRun: 1, width: 5, breakRun: 2 },
      { startRun: 3, endRun: 3, width: 4, breakRun: 4 },
      { startRun: 5, endRun: 5, width: 4, breakRun: null }
    ]);
  });

  it("keeps over-wide unbreakable runs as forced visual lines", () => {
    const runs = [textRun(0, "LongToken", 0), textRun(1, "Next", 9)];
    const result = greedyBreakParagraph(model(runs, [12, 4], []), 5);

    expect(result.lines.map((line) => [line.startRun, line.endRun, line.width, line.break])).toEqual([
      [0, 0, 12, null],
      [1, 1, 4, null]
    ]);
  });

  it("collects breakable penalties and breakpoint run indices", () => {
    const items: Item[] = [
      { kind: "box", width: 4, payload: { runIndex: 0, runKind: "text", text: "A" } },
      spacePenalty(1, 9999),
      spacePenalty(2, 10000),
      { ...spacePenalty(3, -50), payload: { ...spacePenalty(3, -50).payload, breakKind: "hyphen" } }
    ];

    expect(collectBreakablePenalties(items).map((item) => item.payload.runIndex)).toEqual([1, 3]);
    expect(collectSpaceBreakpoints(items)).toEqual([1, 3]);
  });

  it("breaks paragraphs with DP at spaces, forced breaks, and hyphen penalties", () => {
    const runs = [
      textRun(0, "Alpha", 0),
      spaceRun(1, 5),
      textRun(2, "Beta", 6),
      spaceRun(3, 10),
      textRun(4, "Gamma", 11)
    ];
    const result = breakWithDp(
      model(runs, [5, 1, 4, 1, 5], [spacePenalty(1), glue(1, 5, 1), forcedPenalty(3)]),
      8,
      { tolerance: 10000 }
    );

    expect(result.canProceed).toBe(true);
    expect(result.lines.map((line) => line.break?.kind ?? null)).toEqual(["space", "forced", null]);
    expect(Number.isFinite(result.lines[0]?.spaceDeltaPerGap)).toBe(true);

    const hyphenRuns = [textRun(0, "hyphenation", 0)];
    const hyphenResult = breakWithDp(
      model(hyphenRuns, [11], [
        hyphenPenalty(0, 3, 500),
        hyphenPenalty(0, 3, 10),
        hyphenPenalty(0, 6, 20)
      ]),
      5,
      { tolerance: 10000, allowInfeasible: true, doublehyphendemerits: 1, finalhyphendemerits: 1 }
    );

    expect(hyphenResult.canProceed).toBe(true);
    expect(hyphenResult.lines[0]?.break).toMatchObject({
      kind: "hyphen",
      splitOffset: 3,
      visibleHyphen: true,
      hyphenSource: "automatic"
    });
    expect(hyphenResult.totalCost).toBeGreaterThan(0);
  });

  it("reports DP early exits for invalid widths and pathological inputs", () => {
    expect(breakWithDp(model([spaceRun(0, 0)], [1], []), 5).errors[0]).toContain("no breakable content");
    expect(breakWithDp(model([textRun(0, "x", 0)], [1], []), 0).errors[0]).toContain("non-positive");

    const tooManyRuns = Array.from({ length: 3001 }, (_, index) => textRun(index, "x", index));
    expect(breakWithDp(model(tooManyRuns, tooManyRuns.map(() => 1), []), 10).errors[0]).toContain("runs exceeds limit");

    const manyBreakpoints = Array.from({ length: 1201 }, (_, index) => spacePenalty(index));
    expect(breakWithDp(model([textRun(0, "x", 0)], [1], manyBreakpoints), 10).errors[0]).toContain("breakpoints exceeds limit");

    const impossible = breakWithDp(
      model([textRun(0, "abcdef", 0), spaceRun(1, 6), textRun(2, "ghijkl", 7)], [6, 1, 6], [spacePenalty(1)]),
      2,
      { preventOverflow: true }
    );
    expect(impossible.canProceed).toBe(false);
    expect(impossible.errors[0]).toContain("failed to find");
  });

  it("measures and caches text, prefixes, spaces, and math wrappers", () => {
    const measurement = createMeasurementService();
    const textWrapper = {
      textWidth: (text: string) => text.length * 2
    };
    const mathWrapper = {
      getOuterBBox: () => ({ L: 1, w: 5, R: 2 })
    };
    const fallbackMathWrapper = {
      getBBox: () => ({ L: 0.5, w: 2, R: 0.5 })
    };

    expect(() => measurement.measureText("x", {})).toThrow("Missing textWidth");
    expect(measurement.measureText("abc", textWrapper)).toBe(6);
    expect(measurement.measureWord("abc", textWrapper)).toBe(6);
    expect(measurement.measurePrefix("abcdef", 3, textWrapper)).toBe(6);
    expect(measurement.measurePrefix("abcdef", 99, textWrapper)).toBe(12);
    expect(measurement.measureMath(null)).toBe(0);
    expect(measurement.measureMath(mathWrapper)).toBe(8);
    expect(measurement.measureMath(mathWrapper)).toBe(8);
    expect(measurement.measureMath(fallbackMathWrapper)).toBe(3);

    measurement.primeRuns([
      { ...textRun(0, "Prime", 0), wrapper: textWrapper },
      {
        kind: "space",
        runIndex: 1,
        sourceStart: 5,
        sourceEnd: 6,
        text: " ",
        wrapper: textWrapper,
        breakRef: { kind: "mtext-space", wrapper: textWrapper, childIndex: 0, wordIndex: 0 }
      },
      {
        kind: "space",
        runIndex: 2,
        sourceStart: 6,
        sourceEnd: 7,
        text: " ",
        wrapper: mathWrapper,
        breakRef: { kind: "mspace", wrapper: mathWrapper }
      },
      { kind: "math", runIndex: 3, sourceStart: 7, sourceEnd: 8, wrapper: fallbackMathWrapper }
    ]);

    expect(measurement.getStats().textCacheEntries).toBeGreaterThan(0);
    expect(measurement.getStats().wordPrefixEntries).toBeGreaterThan(0);
    expect(measurement.getStats().mathCacheEntries).toBe(2);
  });

  it("builds paragraph reports with measured partial text, glue, and visible hyphens", () => {
    const measurement = createMeasurementService();
    const textWrapper = {
      textWidth: (text: string) => text.length
    };
    const runs: ParagraphRun[] = [
      { ...textRun(0, "abcdef", 0), wrapper: textWrapper },
      {
        kind: "space",
        runIndex: 1,
        sourceStart: 6,
        sourceEnd: 7,
        text: " ",
        wrapper: textWrapper,
        breakRef: { kind: "mtext-space", wrapper: textWrapper, childIndex: 0, wordIndex: 0 }
      },
      { kind: "math", runIndex: 2, sourceStart: 7, sourceEnd: 10, wrapper: { getBBox: () => ({ w: 3 }) } }
    ];
    const report = buildParagraphLayoutReport({
      paragraphId: "p",
      width: 10,
      alignment: "ragged-right",
      layoutMode: "wrap",
      runs,
      runWidths: new Map([[0, 6], [1, 1], [2, 3]]),
      measurement,
      appliedBreaks: [{
        lineIndex: 0,
        kind: "hyphen",
        runIndex: 0,
        sourceOffset: 4,
        visibleHyphen: true,
        hyphenSource: "automatic",
        splitOffset: 4
      }],
      lineMetrics: [{ ascent: Number.NaN, descent: 2 }],
      lines: [{
        lineIndex: 0,
        startRun: 0,
        startTextOffset: 1,
        endRun: 2,
        endTextOffset: null,
        width: 10,
        targetWidth: 12,
        lineNaturalWidth: 9,
        xOffset: 2,
        glueSetRatio: 0.5,
        badness: 10,
        spaceCount: 1,
        spaceDeltaPerGap: 2,
        break: null
      }]
    });

    expect(report.lines[0]?.segments.map((segment) => segment.kind)).toEqual(["text", "space", "math", "text"]);
    expect(report.lines[0]?.segments[0]).toMatchObject({ text: "bcdef", x: 2, width: 5 });
    expect(report.lines[0]?.segments[1]).toMatchObject({ width: 3 });
    expect(report.lines[0]?.segments[3]).toMatchObject({ text: "-", width: 1 });
    expect(report.lines[0]?.ascent).toBe(0);
    expect(report.lines[0]?.break).toMatchObject({ kind: "hyphen", splitOffset: 4 });

    const textSegment = report.lines[0]?.segments[0];
    expect(textSegment).toBeDefined();
    if (textSegment) {
      expect(getOrBuildTextSegmentCaretStops(textSegment)).toEqual([2, 3, 4, 5, 6, 7]);
      expect(getOrBuildTextSegmentCaretStops(textSegment)).toBe(textSegment.caretStops);
    }
    expect(getOrBuildTextSegmentCaretStops({ runIndex: 1, kind: "space", x: 0, width: 1, caretStops: [0, 1] })).toEqual([0, 1]);
    expect(getOrBuildTextSegmentCaretStops({ runIndex: 99, kind: "text", text: "x", x: 0, width: 1 })).toBeNull();
  });

  it("flattens text, math, forced mspace breaks, and unsupported wrappers", () => {
    const linebreak = mspace({ linebreak: "newline" });
    const paragraph = {
      node: node("mrow"),
      childNodes: [
        mtext(textChild("Alpha  Beta")),
        linebreak,
        mtext(textChild("[12pt]Gamma")),
        {
          node: node("mtext"),
          childNodes: [
            null,
            {
              node: node("mtable")
            },
            {
              node: node("mi")
            }
          ]
        },
        {
          node: node("mtable")
        },
        null
      ]
    };

    const flattened = flattenParagraph(paragraph);

    expect(flattened.canProceed).toBe(true);
    expect(flattened.unsupportedKinds).toContain("mtable");
    expect(flattened.unsupportedKinds).toContain("unknown");
    expect(flattened.errors.length).toBeGreaterThan(0);
    expect(flattened.runs.map((run) => run.kind)).toEqual([
      "text",
      "space",
      "text",
      "space",
      "text",
      "math",
      "math",
      "math"
    ]);

    const forced = flattened.runs[3];
    expect(forced?.kind).toBe("space");
    if (forced?.kind === "space" && forced.breakRef.kind === "mspace") {
      expect(forced.breakRef.isForcedLineBreak).toBe(true);
      expect(forced.breakRef.lineLeading).toBe("12pt");
      expect(forced.breakRef.lineLeadingTrim?.consumed).toBe(6);
    }
    expect(flattened.runs[4]).toMatchObject({ kind: "text", text: "Gamma" });

    const latexForced = flattenParagraph({
      node: node("mrow"),
      childNodes: [mspace({ "data-latex": "\\\\" })]
    });
    expect(latexForced.runs[0]?.kind).toBe("space");
    if (latexForced.runs[0]?.kind === "space" && latexForced.runs[0].breakRef.kind === "mspace") {
      expect(latexForced.runs[0].breakRef.isForcedLineBreak).toBe(true);
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  collectInspectorColorAliases,
  colorOptionsForValue,
  normalizeInspectorColorValue,
  parseInspectorColorletStatement,
  parseInspectorDefineColorStatement,
  readInspectorBraceGroup,
  resolveColorSyntaxValue,
  skipInspectorWhitespace
} from "../packages/core/src/edit/inspector/color-syntax.js";
import {
  clampRoundedCornersRadius,
  computeGenericPathRoundedCornersMax,
  computeLineBasedPathRoundedCornersMax,
  computePathRoundedCornersMax,
  estimateClosingCornerStartOffset,
  estimateRoundedOffsetAlongDirection,
  estimateSegmentEndRoundedOffset,
  estimateSegmentStartRoundedOffset,
  maxRoundedCornersForSubpath,
  normalizeRoundedCornersMax,
  normalizeVector,
  pathHasRoundableCorner
} from "../packages/core/src/edit/inspector/rounded-corners.js";
import { parseOptionListRaw } from "../packages/core/src/options/parse.js";
import { defaultStyle } from "../packages/core/src/semantic/style/defaults.js";
import type { StyleChainEntry } from "../packages/core/src/semantic/style-chain.js";
import type { ScenePathCommand } from "../packages/core/src/semantic/types.js";

describe("inspector color syntax helpers", () => {
  it("parses color aliases defensively and resolves authored color syntax through style chain flags", () => {
    const source = String.raw`
      \colorlet{}{red}
      \colorlet{accent}{red}
      \definecolor{Brand}{RGB}{12, 34, 56}
      \definecolor{bad}{unknown}{1,2,3}
    `;
    const aliases = collectInspectorColorAliases(source);

    expect(aliases.get("accent")).toBe("red");
    expect(aliases.get("brand")).toBe("#0c2238");
    expect(aliases.has("bad")).toBe(false);
    expect(parseInspectorColorletStatement(String.raw`\colorlet{name}{}`, 0)).toBeNull();
    expect(parseInspectorColorletStatement(String.raw`\colorlet{1bad}{red}`, 0)).toBeNull();
    expect(parseInspectorDefineColorStatement(String.raw`\definecolor{c}{RGB}`, 0)).toBeNull();
    expect(readInspectorBraceGroup("{unterminated", 0)).toBeNull();
    expect(skipInspectorWhitespace(" \n\t{x}", 0)).toBe(3);

    const style = defaultStyle();
    const chain: StyleChainEntry[] = [
      {
        kind: "scope",
        rawOptions: [parseOptionListRaw("[fill=red]", 0)],
        before: style,
        after: style,
        resolvedContributions: {}
      },
      {
        kind: "command",
        rawOptions: [parseOptionListRaw("[accent]", 0)],
        before: style,
        after: style,
        resolvedContributions: {}
      }
    ];

    expect(normalizeInspectorColorValue("#0C2238")).toBe("#0c2238");
    expect(normalizeInspectorColorValue("#ff0000")).toBe("red");
    expect(normalizeInspectorColorValue(null)).toBeNull();
    expect(colorOptionsForValue("brand")).toEqual(expect.arrayContaining(["brand", "red", "blue"]));
    expect(resolveColorSyntaxValue(null, ["fill"], "red", aliases, chain)).toBe("accent");
    expect(resolveColorSyntaxValue(null, [], "red", aliases, chain)).toBeNull();
  });
});

describe("inspector rounded-corner geometry helpers", () => {
  it("detects roundable joins across line, cubic, and arc commands", () => {
    const commands: ScenePathCommand[] = [
      { kind: "M", to: { x: 0, y: 0 } },
      { kind: "L", to: { x: 10, y: 0 } },
      { kind: "C", c1: { x: 12, y: 0 }, c2: { x: 12, y: 5 }, to: { x: 10, y: 5 } },
      { kind: "A", rx: 4, ry: 2, xAxisRotation: 30, largeArc: false, sweep: true, to: { x: 4, y: 8 } },
      { kind: "Z" }
    ];

    expect(pathHasRoundableCorner(commands)).toBe(true);
    expect(computePathRoundedCornersMax(commands)).toBeGreaterThan(0);
    expect(computeGenericPathRoundedCornersMax(commands)).toBeGreaterThan(0);
    expect(computeLineBasedPathRoundedCornersMax([{ kind: "L", to: { x: 1, y: 1 } }])).toBeNull();
    expect(maxRoundedCornersForSubpath([10], false)).toBeNull();
  });

  it("estimates rounded offsets and clamps invalid numeric inputs", () => {
    const lineStart = { x: 0, y: 0 };
    const lineEnd = { x: 10, y: 0 };
    const previousCurve: ScenePathCommand = {
      kind: "C",
      c1: { x: -8, y: 0 },
      c2: { x: -2, y: 0 },
      to: lineStart
    };
    const nextCurve: ScenePathCommand = {
      kind: "C",
      c1: { x: 12, y: 0 },
      c2: { x: 18, y: 0 },
      to: { x: 20, y: 0 }
    };

    expect(estimateSegmentStartRoundedOffset(previousCurve, lineStart, lineEnd)).toBeGreaterThan(3);
    expect(estimateSegmentEndRoundedOffset(nextCurve, lineStart, lineEnd)).toBeGreaterThan(3);
    expect(estimateClosingCornerStartOffset([previousCurve, { kind: "Z" }], 1, lineStart, lineEnd)).toBeGreaterThan(3);
    expect(estimateClosingCornerStartOffset([nextCurve, { kind: "Z" }], 1, lineStart, lineEnd)).toBe(0);
    expect(estimateRoundedOffsetAlongDirection({ x: Number.NaN, y: 0 }, { x: 1, y: 0 })).toBe(0);
    expect(estimateRoundedOffsetAlongDirection({ x: 0, y: 5 }, { x: 1, y: 0 })).toBe(0);
    expect(normalizeVector({ x: 0, y: 0 })).toBeNull();
    expect(normalizeRoundedCornersMax(null)).toBe(24);
    expect(clampRoundedCornersRadius(Number.NaN, 2)).toBe(2);
    expect(clampRoundedCornersRadius(0, 2)).toBe(0.1);
  });
});

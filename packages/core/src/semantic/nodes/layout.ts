import type { PathOptionItem } from "../../ast/types.js";
import type {
  NodeTextEngine,
  NodeTextLayoutKind,
  NodeTextParagraphAlignment,
  NodeTextRenderInfo
} from "../../text/types.js";
import { parseLength } from "../coords/parse-length.js";
import type { ResolvedStyle } from "../types.js";
import type { NodeLayout, NodeShape } from "./types.js";
import { normalizeOptionValue } from "./utils.js";

export function resolveNodeLayout(
  text: string,
  options: PathOptionItem["options"] | undefined,
  style: ResolvedStyle,
  _transformScale = 1,
  textEngine: NodeTextEngine | null = null,
  textMode: "text" | "math" = "text"
): NodeLayout {
  const fontSize = style.fontSize;
  const charWidth = fontSize * 0.7;
  const lineHeight = fontSize * 1.05;

  const defaultInner = parseLength(".3333em", "pt") ?? 3.333;
  let innerXSep = defaultInner;
  let innerYSep = defaultInner;
  let textWidth: number | null = null;
  let minWidth = parseLength("1pt", "pt") ?? 1;
  let minHeight = parseLength("1pt", "pt") ?? 1;
  let minSize: number | null = null;

  let outerSep = style.lineWidth / 2;
  let outerXSep: number | null = null;
  let outerYSep: number | null = null;

  if (options) {
    for (const entry of options.entries) {
      if (entry.kind !== "kv") {
        continue;
      }

      if (entry.key === "inner sep") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          innerXSep = parsed;
          innerYSep = parsed;
        }
      } else if (entry.key === "inner xsep") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          innerXSep = parsed;
        }
      } else if (entry.key === "inner ysep") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          innerYSep = parsed;
        }
      } else if (entry.key === "text width") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          textWidth = Math.max(0, parsed);
        }
      } else if (entry.key === "minimum width") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          minWidth = Math.max(0, parsed);
        }
      } else if (entry.key === "minimum height") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          minHeight = Math.max(0, parsed);
        }
      } else if (entry.key === "minimum size") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          minSize = Math.max(0, parsed);
        }
      } else if (entry.key === "outer sep") {
        const normalized = normalizeOptionValue(entry.valueRaw).toLowerCase();
        if (normalized === "auto") {
          outerSep = style.stroke && style.stroke !== "none" ? style.lineWidth / 2 : 0;
        } else {
          const parsed = parseLength(entry.valueRaw, "pt");
          if (parsed != null) {
            outerSep = parsed;
          }
        }
      } else if (entry.key === "outer xsep") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          outerXSep = parsed;
        }
      } else if (entry.key === "outer ysep") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          outerYSep = parsed;
        }
      }
    }
  }

  let textRenderInfo: NodeTextRenderInfo = { mode: "plain" };
  let textLines = computeNodeTextLines(text, textWidth, charWidth);
  let textNaturalWidth: number;
  let textNaturalHeight: number;
  let baseLineY = -fontSize * 0.28;
  let midLineY = -fontSize * 0.065;
  const paragraphAlignment = resolveParagraphAlignment(textWidth, style.textAlign);
  const layoutKind = resolveTextLayoutKind(text, textWidth);

  const measuredText = textEngine?.measure({
    text,
    mode: textMode,
    textWidthPt: textWidth,
    alignment: paragraphAlignment,
    fontStyle: style.fontStyle,
    fontWeight: style.fontWeight,
    fontFamily: style.fontFamily,
    fontSizePt: style.fontSize
  });

  if (measuredText) {
    // We trust MathJax for block metrics/wrapping; line-level alignment inside the block is best-effort for now.
    textLines = splitNodeLines(text);
    textNaturalWidth = measuredText.width;
    textNaturalHeight = measuredText.height;
    baseLineY = measuredText.baselineY;
    midLineY = measuredText.midLineY;
    textRenderInfo = {
      mode: "mathjax",
      cacheKey: measuredText.cacheKey,
      paragraphId: measuredText.paragraphId,
      renderSourceText: measuredText.renderSourceText,
      layoutKind
    };
  } else {
    const maxLineLength = textLines.reduce((max, line) => Math.max(max, line.length), 0);
    textNaturalWidth = maxLineLength * charWidth;
    textNaturalHeight = textLines.length * lineHeight;
  }

  const resolvedMinWidth = Math.max(minWidth, minSize ?? minWidth);
  const resolvedMinHeight = Math.max(minHeight, minSize ?? minHeight);
  const measuredTextWidth = measuredText ? textNaturalWidth : textWidth != null ? Math.max(textNaturalWidth, textWidth) : textNaturalWidth;
  const naturalWidth = measuredTextWidth + innerXSep * 2;
  const naturalHeight = textNaturalHeight + innerYSep * 2;
  const visualWidth = Math.max(naturalWidth, resolvedMinWidth);
  const visualHeight = Math.max(naturalHeight, resolvedMinHeight);
  const resolvedOuterX = outerXSep ?? outerSep;
  const resolvedOuterY = outerYSep ?? outerSep;

  return {
    textLines,
    textBlockWidth: measuredTextWidth,
    textBlockHeight: textNaturalHeight,
    textRenderInfo,
    naturalWidth,
    naturalHeight,
    minimumWidth: resolvedMinWidth,
    minimumHeight: resolvedMinHeight,
    outerXSep: resolvedOuterX,
    outerYSep: resolvedOuterY,
    visualWidth,
    visualHeight,
    visualRadius: Math.max(visualWidth, visualHeight) / 2,
    anchorHalfWidth: visualWidth / 2 + resolvedOuterX,
    anchorHalfHeight: visualHeight / 2 + resolvedOuterY,
    anchorRadius: Math.max(visualWidth / 2 + resolvedOuterX, visualHeight / 2 + resolvedOuterY),
    baseLineY,
    midLineY
  };
}

function resolveTextLayoutKind(text: string, textWidth: number | null): NodeTextLayoutKind {
  if (/\\\\(?:\[[^\]]*\])?/.test(text)) {
    return "explicit-multiline";
  }
  if (textWidth != null) {
    return "wrapped";
  }
  return "single-line";
}

export function adjustNodeLayoutForShape(layout: NodeLayout, shape: NodeShape): NodeLayout {
  if (shape === "ellipse") {
    const naturalHalfWidth = layout.naturalWidth / 2;
    const naturalHalfHeight = layout.naturalHeight / 2;
    const minimumHalfWidth = layout.minimumWidth / 2;
    const minimumHalfHeight = layout.minimumHeight / 2;

    const drawHalfWidth = Math.max(naturalHalfWidth * Math.SQRT2, minimumHalfWidth);
    const drawHalfHeight = Math.max(naturalHalfHeight * Math.SQRT2, minimumHalfHeight);
    const anchorHalfWidth = drawHalfWidth + layout.outerXSep;
    const anchorHalfHeight = drawHalfHeight + layout.outerYSep;

    return {
      ...layout,
      visualWidth: drawHalfWidth * 2,
      visualHeight: drawHalfHeight * 2,
      visualRadius: Math.max(drawHalfWidth, drawHalfHeight),
      anchorHalfWidth,
      anchorHalfHeight,
      anchorRadius: Math.max(anchorHalfWidth, anchorHalfHeight)
    };
  }

  if (shape === "circle") {
    const naturalHalfWidth = layout.naturalWidth / 2;
    const naturalHalfHeight = layout.naturalHeight / 2;
    const minimumHalfWidth = layout.minimumWidth / 2;
    const minimumHalfHeight = layout.minimumHeight / 2;

    const drawRadius = Math.max(Math.hypot(naturalHalfWidth, naturalHalfHeight), minimumHalfWidth, minimumHalfHeight);
    const outerSep = Math.max(layout.outerXSep, layout.outerYSep);
    const anchorRadius = drawRadius + outerSep;

    return {
      ...layout,
      visualWidth: drawRadius * 2,
      visualHeight: drawRadius * 2,
      visualRadius: drawRadius,
      anchorHalfWidth: anchorRadius,
      anchorHalfHeight: anchorRadius,
      anchorRadius
    };
  }

  return layout;
}

function splitNodeLines(text: string): string[] {
  const normalized = text.replace(/\\\\(?:\[[^\]]*\])?/g, "\n");
  const parts = normalized.split("\n");
  if (parts.length === 0) {
    return [""];
  }
  return parts;
}

function computeNodeTextLines(text: string, textWidth: number | null, charWidth: number): string[] {
  const explicitLines = splitNodeLines(text);
  if (textWidth == null || textWidth <= 0 || charWidth <= 0) {
    return explicitLines;
  }

  const maxChars = Math.max(1, Math.floor(textWidth / charWidth));
  const wrapped: string[] = [];
  for (const line of explicitLines) {
    wrapped.push(...wrapLine(line, maxChars));
  }
  return wrapped.length > 0 ? wrapped : [""];
}

function resolveParagraphAlignment(
  textWidth: number | null,
  textAlign: ResolvedStyle["textAlign"]
): NodeTextParagraphAlignment | undefined {
  if (textWidth == null || textWidth <= 0) {
    return undefined;
  }

  if (textAlign === "right" || textAlign === "flush right") {
    return "ragged-left";
  }
  if (textAlign === "justify") {
    return "justified";
  }
  if (textAlign === "left" || textAlign === "flush left") {
    return "ragged-right";
  }
  return "center";
}

function wrapLine(line: string, maxChars: number): string[] {
  if (line.length <= maxChars) {
    return [line];
  }

  const words = line.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) {
    return [line];
  }

  const result: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      if (word.length <= maxChars) {
        current = word;
      } else {
        result.push(...splitLongWord(word, maxChars));
      }
      continue;
    }

    const candidate = `${current} ${word}`;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    result.push(current);
    if (word.length <= maxChars) {
      current = word;
    } else {
      const chunks = splitLongWord(word, maxChars);
      result.push(...chunks.slice(0, -1));
      current = chunks[chunks.length - 1] ?? "";
    }
  }

  if (current.length > 0) {
    result.push(current);
  }

  return result.length > 0 ? result : [line];
}

function splitLongWord(word: string, maxChars: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < word.length; index += maxChars) {
    chunks.push(word.slice(index, index + maxChars));
  }
  return chunks.length > 0 ? chunks : [word];
}

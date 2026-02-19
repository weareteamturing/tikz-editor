import type { Point } from "../semantic/types.js";
import { CM_PER_PT, PT_PER_CM, formatNumber } from "./format.js";

export type ElementTemplate =
  | { kind: "node"; text?: string }
  | { kind: "line"; hasArrow?: boolean; to?: Point }
  | { kind: "rectangle"; corner?: Point }
  | { kind: "circle"; edge?: Point }
  | { kind: "filledCircle"; edge?: Point };

const DEFAULT_NODE_TEXT = "node";
const DEFAULT_LINE_LENGTH_PT = 2 * PT_PER_CM;
const DEFAULT_RECT_WIDTH_PT = 2.2 * PT_PER_CM;
const DEFAULT_RECT_HEIGHT_PT = 1.4 * PT_PER_CM;
const DEFAULT_CIRCLE_RADIUS_PT = 0.8 * PT_PER_CM;

export function generateElementSource(template: ElementTemplate, at: Point): string {
  const atCoord = formatPointCm(at);

  switch (template.kind) {
    case "node": {
      const text = sanitizeNodeText(template.text ?? DEFAULT_NODE_TEXT);
      return `\\node at ${atCoord} {${text}};`;
    }

    case "line": {
      const to = template.to ?? { x: at.x + DEFAULT_LINE_LENGTH_PT, y: at.y };
      const toCoord = formatPointCm(to);
      return template.hasArrow
        ? `\\draw[->] ${atCoord} -- ${toCoord};`
        : `\\draw ${atCoord} -- ${toCoord};`;
    }

    case "rectangle": {
      const corner = template.corner ?? {
        x: at.x + DEFAULT_RECT_WIDTH_PT,
        y: at.y + DEFAULT_RECT_HEIGHT_PT
      };
      return `\\draw ${atCoord} rectangle ${formatPointCm(corner)};`;
    }

    case "circle": {
      const radiusPt = circleRadiusPt(at, template.edge);
      return `\\draw ${atCoord} circle (${formatNumber(radiusPt * CM_PER_PT)}cm);`;
    }

    case "filledCircle": {
      const radiusPt = circleRadiusPt(at, template.edge);
      return `\\fill ${atCoord} circle (${formatNumber(radiusPt * CM_PER_PT)}cm);`;
    }
  }
}

export function insertElementIntoSource(source: string, snippet: string): string {
  const normalizedSnippet = snippet.trim();
  if (normalizedSnippet.length === 0) {
    return source;
  }

  const endToken = "\\end{tikzpicture}";
  const endIndex = source.lastIndexOf(endToken);
  if (endIndex < 0) {
    if (source.length === 0) {
      return normalizedSnippet;
    }
    return source.endsWith("\n")
      ? `${source}${normalizedSnippet}`
      : `${source}\n${normalizedSnippet}`;
  }

  const endLineStart = source.lastIndexOf("\n", endIndex - 1) + 1;
  const endIndent = source.slice(endLineStart, endIndex).match(/^[ \t]*/)?.[0] ?? "";
  const bodyIndent = `${endIndent}  `;

  const before = source.slice(0, endLineStart);
  const after = source.slice(endLineStart);
  const needsLeadingNewline = before.length > 0 && !before.endsWith("\n");
  const prefix = needsLeadingNewline ? "\n" : "";

  return `${before}${prefix}${bodyIndent}${normalizedSnippet}\n${after}`;
}

function formatPointCm(point: Point): string {
  const x = formatNumber(point.x * CM_PER_PT);
  const y = formatNumber(point.y * CM_PER_PT);
  return `(${x},${y})`;
}

function circleRadiusPt(center: Point, edge: Point | undefined): number {
  if (!edge) {
    return DEFAULT_CIRCLE_RADIUS_PT;
  }

  const dx = edge.x - center.x;
  const dy = edge.y - center.y;
  const radius = Math.hypot(dx, dy);
  return radius > 1e-4 ? radius : DEFAULT_CIRCLE_RADIUS_PT;
}

function sanitizeNodeText(raw: string): string {
  return raw.replace(/[{}]/g, "").trim() || DEFAULT_NODE_TEXT;
}

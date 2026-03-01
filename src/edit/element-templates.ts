import type { Point } from "../semantic/types.js";
import { CM_PER_PT, PT_PER_CM, formatNumber } from "./format.js";

export type ElementTemplate =
  | { kind: "node"; text?: string }
  | { kind: "line"; hasArrow?: boolean; to?: Point }
  | { kind: "bezier"; to?: Point; control1?: Point; control2?: Point }
  | { kind: "rectangle"; corner?: Point }
  | { kind: "ellipse"; corner?: Point }
  | { kind: "circle"; edge?: Point }
  | { kind: "filledCircle"; edge?: Point };

const DEFAULT_NODE_TEXT = "node";
const DEFAULT_LINE_LENGTH_PT = 2 * PT_PER_CM;
const DEFAULT_RECT_WIDTH_PT = 2.2 * PT_PER_CM;
const DEFAULT_RECT_HEIGHT_PT = 1.4 * PT_PER_CM;
const DEFAULT_CIRCLE_RADIUS_PT = 0.8 * PT_PER_CM;
const DEFAULT_BEZIER_CONTROL_OFFSET_PT = 0;

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

    case "bezier": {
      const to = template.to ?? { x: at.x + DEFAULT_LINE_LENGTH_PT, y: at.y };
      const controls = resolveBezierControls(at, to, template.control1, template.control2);
      return `\\draw ${atCoord} .. controls ${formatPointCm(controls.control1)} and ${formatPointCm(controls.control2)} .. ${formatPointCm(to)};`;
    }

    case "rectangle": {
      const corner = template.corner ?? {
        x: at.x + DEFAULT_RECT_WIDTH_PT,
        y: at.y + DEFAULT_RECT_HEIGHT_PT
      };
      return `\\draw ${atCoord} rectangle ${formatPointCm(corner)};`;
    }

    case "ellipse": {
      const { center, xRadiusPt, yRadiusPt } = ellipseFromCorner(at, template.corner);
      const xRadiusCm = formatNumber(xRadiusPt * CM_PER_PT);
      const yRadiusCm = formatNumber(yRadiusPt * CM_PER_PT);
      return `\\draw ${formatPointCm(center)} ellipse [x radius=${xRadiusCm}cm, y radius=${yRadiusCm}cm];`;
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

function ellipseFromCorner(anchor: Point, corner: Point | undefined): { center: Point; xRadiusPt: number; yRadiusPt: number } {
  const resolvedCorner = corner ?? {
    x: anchor.x + DEFAULT_RECT_WIDTH_PT,
    y: anchor.y + DEFAULT_RECT_HEIGHT_PT
  };
  const dx = resolvedCorner.x - anchor.x;
  const dy = resolvedCorner.y - anchor.y;
  return {
    center: {
      x: anchor.x + dx / 2,
      y: anchor.y + dy / 2
    },
    xRadiusPt: Math.abs(dx) / 2,
    yRadiusPt: Math.abs(dy) / 2
  };
}

function sanitizeNodeText(raw: string): string {
  return raw.replace(/[{}]/g, "").trim() || DEFAULT_NODE_TEXT;
}

function resolveBezierControls(
  from: Point,
  to: Point,
  control1: Point | undefined,
  control2: Point | undefined
): { control1: Point; control2: Point } {
  if (control1 && control2) {
    return { control1, control2 };
  }

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const controlOffsetX = dx === 0 && dy === 0 ? DEFAULT_LINE_LENGTH_PT / 3 : dx / 3;
  const controlOffsetY = dx === 0 && dy === 0 ? DEFAULT_BEZIER_CONTROL_OFFSET_PT : dy / 3;
  const baseControl1 = {
    x: from.x + controlOffsetX,
    y: from.y + controlOffsetY
  };
  const baseControl2 = {
    x: from.x + 2 * controlOffsetX,
    y: from.y + 2 * controlOffsetY
  };
  return {
    control1: control1 ?? baseControl1,
    control2: control2 ?? baseControl2
  };
}

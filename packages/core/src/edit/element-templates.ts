import type { Point } from "../semantic/types.js";
import { CM_PER_PT, PT_PER_CM, formatNumber } from "./format.js";

export type AnchorReference = {
  nodeName: string;
  anchor: string;
};

export type ElementTemplate =
  | { kind: "node"; text?: string; shape?: string; minimumWidthPt?: number; minimumHeightPt?: number }
  | { kind: "line"; hasArrow?: boolean; to?: Point; fromAnchor?: AnchorReference; toAnchor?: AnchorReference }
  | { kind: "bezier"; to?: Point; control1?: Point; control2?: Point }
  | { kind: "grid"; corner?: Point }
  | { kind: "rectangle"; corner?: Point }
  | { kind: "ellipse"; corner?: Point }
  | { kind: "circle"; edge?: Point }
  | { kind: "filledCircle"; edge?: Point };

export type ComplexPathSegment =
  | { kind: "line"; to: Point; toAnchor?: AnchorReference }
  | { kind: "bezier"; to: Point; control1: Point; control2: Point; toAnchor?: AnchorReference };

const DEFAULT_NODE_TEXT = "node";
const SHAPE_TOOL_DEFAULT_MINIMUM_WIDTH_CM = 2.2;
const SHAPE_TOOL_DEFAULT_MINIMUM_HEIGHT_CM = 1.4;
const DEFAULT_LINE_LENGTH_PT = 2 * PT_PER_CM;
const DEFAULT_RECT_WIDTH_PT = 2.2 * PT_PER_CM;
const DEFAULT_RECT_HEIGHT_PT = 1.4 * PT_PER_CM;
const DEFAULT_CIRCLE_RADIUS_PT = 0.8 * PT_PER_CM;
const DEFAULT_BEZIER_CONTROL_OFFSET_PT = 0;

export function generateElementSource(template: ElementTemplate, at: Point): string {
  const atCoord = formatPointCm(at);

  switch (template.kind) {
    case "node": {
      const text = template.text == null ? DEFAULT_NODE_TEXT : sanitizeNodeText(template.text);
      if (template.shape) {
        const hasExplicitShapeSize = template.minimumWidthPt != null || template.minimumHeightPt != null;
        const optionParts = ["draw", `shape=${template.shape}`];
        if (hasExplicitShapeSize) {
          if (template.minimumWidthPt != null) {
            optionParts.push(`minimum width=${formatNumber(template.minimumWidthPt * CM_PER_PT)}cm`);
          }
          if (template.minimumHeightPt != null) {
            optionParts.push(`minimum height=${formatNumber(template.minimumHeightPt * CM_PER_PT)}cm`);
          }
        } else {
          optionParts.push(`minimum width=${SHAPE_TOOL_DEFAULT_MINIMUM_WIDTH_CM}cm`);
          optionParts.push(`minimum height=${SHAPE_TOOL_DEFAULT_MINIMUM_HEIGHT_CM}cm`);
        }
        return `\\node[${optionParts.join(", ")}] at ${atCoord} {${text}};`;
      }
      return `\\node at ${atCoord} {${text}};`;
    }

    case "line": {
      const fromCoord = formatLineEndpoint(template.fromAnchor, atCoord);
      const to = template.to ?? { x: at.x + DEFAULT_LINE_LENGTH_PT, y: at.y };
      const toCoord = formatLineEndpoint(template.toAnchor, formatPointCm(to));
      return template.hasArrow
        ? `\\draw[->] ${fromCoord} -- ${toCoord};`
        : `\\draw ${fromCoord} -- ${toCoord};`;
    }

    case "bezier": {
      const to = template.to ?? { x: at.x + DEFAULT_LINE_LENGTH_PT, y: at.y };
      const controls = resolveBezierControls(at, to, template.control1, template.control2);
      return `\\draw ${atCoord} .. controls ${formatPointCm(controls.control1)} and ${formatPointCm(controls.control2)} .. ${formatPointCm(to)};`;
    }

    case "grid": {
      const corner = template.corner ?? {
        x: at.x + DEFAULT_RECT_WIDTH_PT,
        y: at.y + DEFAULT_RECT_HEIGHT_PT
      };
      return `\\draw ${atCoord} grid ${formatPointCm(corner)};`;
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

export function generateComplexPathSource(
  start: Point,
  segments: readonly ComplexPathSegment[],
  options: { closed?: boolean; startAnchor?: AnchorReference } = {}
): string | null {
  if (segments.length === 0) {
    return null;
  }

  const parts: string[] = [formatPathEndpoint(options.startAnchor, start)];
  for (const segment of segments) {
    if (segment.kind === "line") {
      parts.push(`-- ${formatPathEndpoint(segment.toAnchor, segment.to)}`);
      continue;
    }

    parts.push(
      `.. controls ${formatPointCm(segment.control1)} and ${formatPointCm(segment.control2)} .. ${formatPathEndpoint(segment.toAnchor, segment.to)}`
    );
  }

  if (options.closed) {
    parts.push("-- cycle");
  }

  return `\\draw ${parts.join(" ")};`;
}

/**
 * Generate just the segment operators (e.g. `-- (x,y) .. controls ... .. (x2,y2)`)
 * without the `\draw`, start coordinate, or `;`.
 */
export function generateComplexPathSegmentSource(
  segments: readonly ComplexPathSegment[]
): string | null {
  if (segments.length === 0) {
    return null;
  }
  const parts: string[] = [];
  for (const segment of segments) {
    if (segment.kind === "line") {
      parts.push(`-- ${formatPathEndpoint(segment.toAnchor, segment.to)}`);
    } else {
      parts.push(
        `.. controls ${formatPointCm(segment.control1)} and ${formatPointCm(segment.control2)} .. ${formatPathEndpoint(segment.toAnchor, segment.to)}`
      );
    }
  }
  return parts.join(" ");
}

/**
 * Reverse an array of path segments so they traverse the path in the opposite direction.
 * `fromWorld` is the start point of the original (unreversed) segment sequence.
 */
export function reverseComplexPathSegments(
  fromWorld: Point,
  segments: readonly ComplexPathSegment[],
  fromAnchor?: AnchorReference
): { startWorld: Point; startAnchor?: AnchorReference; segments: ComplexPathSegment[] } {
  if (segments.length === 0) {
    return { startWorld: fromWorld, startAnchor: fromAnchor, segments: [] };
  }
  const reversed: ComplexPathSegment[] = [];
  // Walk backwards. For each segment, the new "to" is the previous segment's start.
  const segFromPoints = [fromWorld];
  const segFromAnchors: Array<AnchorReference | undefined> = [fromAnchor];
  for (const seg of segments) {
    segFromPoints.push(seg.to);
    segFromAnchors.push(seg.toAnchor);
  }
  // segFromPoints: [from, seg0.to, seg1.to, ...]
  // reversed[i] corresponds to segments[n-1-i]
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]!;
    const segStart = segFromPoints[i]!;
    const segStartAnchor = segFromAnchors[i];
    if (seg.kind === "line") {
      reversed.push({ kind: "line", to: segStart, toAnchor: segStartAnchor });
    } else {
      // swap control1 and control2
      reversed.push({
        kind: "bezier",
        to: segStart,
        control1: seg.control2,
        control2: seg.control1,
        toAnchor: segStartAnchor
      });
    }
  }
  const newStart = segFromPoints[segFromPoints.length - 1]!;
  const newStartAnchor = segFromAnchors[segFromAnchors.length - 1];
  return { startWorld: newStart, startAnchor: newStartAnchor, segments: reversed };
}

/**
 * Generate source for prepending to an existing path's start.
 * Returns `(newStart) -- (p1) -- ... --` — ending with an operator (no final coordinate),
 * so the existing path's first coordinate naturally follows.
 *
 * `startWorld` is the new far start point; `segments` should be reversed so the last
 * segment's target is the existing path's old start (which will be omitted).
 */
export function generateComplexPathPrependSource(
  startWorld: Point,
  segments: readonly ComplexPathSegment[],
  startAnchor?: AnchorReference
): string | null {
  if (segments.length === 0) return null;

  const parts: string[] = [formatPathEndpoint(startAnchor, startWorld)];

  // All segments except the last: include full operator + target
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (seg.kind === "line") {
      parts.push(`-- ${formatPathEndpoint(seg.toAnchor, seg.to)}`);
    } else {
      parts.push(`.. controls ${formatPointCm(seg.control1)} and ${formatPointCm(seg.control2)} .. ${formatPathEndpoint(seg.toAnchor, seg.to)}`);
    }
  }

  // Last segment: operator only, no target (existing body provides it)
  const last = segments[segments.length - 1]!;
  if (last.kind === "line") {
    parts.push("--");
  } else {
    parts.push(`.. controls ${formatPointCm(last.control1)} and ${formatPointCm(last.control2)} ..`);
  }

  return parts.join(" ");
}

function formatPointCm(point: Point): string {
  const x = formatNumber(point.x * CM_PER_PT);
  const y = formatNumber(point.y * CM_PER_PT);
  return `(${x},${y})`;
}

function formatLineEndpoint(anchor: AnchorReference | undefined, fallbackCoord: string): string {
  return formatAnchorReference(anchor, fallbackCoord);
}

function formatPathEndpoint(anchor: AnchorReference | undefined, fallbackPoint: Point): string {
  return formatAnchorReference(anchor, formatPointCm(fallbackPoint));
}

function formatAnchorReference(anchor: AnchorReference | undefined, fallbackCoord: string): string {
  if (!anchor) {
    return fallbackCoord;
  }
  const nodeName = anchor.nodeName.trim();
  if (nodeName.length === 0) {
    return fallbackCoord;
  }
  const normalizedAnchor = anchor.anchor.trim().toLowerCase();
  return normalizedAnchor === "center" || normalizedAnchor.length === 0
    ? `(${nodeName})`
    : `(${nodeName}.${normalizedAnchor})`;
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
  return raw.replace(/[{}]/g, "").trim();
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

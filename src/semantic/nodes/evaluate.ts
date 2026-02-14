import { parseCoordinate } from "../../domains/coordinates/parse.js";
import type { CoordinateItem, NodeItem, PathItem, PathOptionItem, PathStatement } from "../../ast/types.js";
import type { OptionListAst } from "../../options/types.js";
import type { SemanticContext } from "../context.js";
import { evaluateRawCoordinate } from "../coords/evaluate.js";
import { parseLength } from "../coords/parse-length.js";
import { currentAnchorForDirection, parseDirectionalKey, resolveNodePositioningTarget } from "../path/node-positioning.js";
import type { ArcParameters, DiagnosticPushFn, FeatureMarkFn, PlacementSegment } from "../path/types.js";
import { resolveContextDelta } from "../style/resolve.js";
import type { Point, ResolvedStyle, SceneCircle, SceneElement, SceneEllipse, ScenePath, SceneText } from "../types.js";

function makeCircleElement(
  sourceId: string,
  center: Point,
  radius: number,
  style: ResolvedStyle,
  span: { from: number; to: number }
): SceneCircle {
  return {
    kind: "Circle",
    id: `scene-circle:${sourceId}:${span.from}`,
    sourceId,
    sourceSpan: span,
    style: { ...style },
    center,
    radius
  };
}

function makeTextElement(
  sourceId: string,
  itemId: string,
  position: Point,
  style: ResolvedStyle,
  span: { from: number; to: number },
  text: string,
  textBlockWidth?: number
): SceneText {
  return {
    kind: "Text",
    id: `scene-text:${sourceId}:${itemId}`,
    sourceId,
    sourceSpan: span,
    style: { ...style },
    position,
    text,
    textBlockWidth
  };
}

export function evaluateNodeItem(
  item: NodeItem,
  statement: PathStatement,
  context: SemanticContext,
  style: ResolvedStyle,
  markFeature: FeatureMarkFn,
  pushDiagnostic: DiagnosticPushFn,
  segment: PlacementSegment | null,
  forcedName?: string,
  defaultPositionFraction?: number
): {
  behindElements: SceneElement[];
  frontElements: SceneElement[];
} {
  const frame = context.stack[context.stack.length - 1];
  const nodeOptions = withDefaultNodePosition(item.options, defaultPositionFraction);
  const effectiveNodeOptions = resolveEffectiveNodeOptions({
    statementOptions: statement.options,
    nodeOptions,
    everyNodeStyles: frame.everyNodeStyles,
    everyRectangleNodeStyles: frame.everyRectangleNodeStyles,
    everyCircleNodeStyles: frame.everyCircleNodeStyles
  });
  const effectiveNodeLocalOptions = resolveEffectiveNodeOptions({
    statementOptions: undefined,
    nodeOptions,
    everyNodeStyles: frame.everyNodeStyles,
    everyRectangleNodeStyles: frame.everyRectangleNodeStyles,
    everyCircleNodeStyles: frame.everyCircleNodeStyles
  });
  const inheritedTransformScale = frame.transformShape ? computeTransformScale(frame.transform) : 1;
  const nodeOptionScale = resolveNodeOptionScale(effectiveNodeLocalOptions, style, context);
  const transformScale = inheritedTransformScale * nodeOptionScale;
  const nodeStyle = resolveNodeStyle(effectiveNodeOptions, style, context, transformScale);
  const nodeLayout = resolveNodeLayout(item.text, effectiveNodeOptions, nodeStyle, transformScale);
  const nodeShape = resolveNodeShape(effectiveNodeOptions);
  const anchor = resolveNodeAnchor(effectiveNodeOptions);
  const target = resolveNodeTargetPoint(item, context, item.span, pushDiagnostic, effectiveNodeOptions, segment);
  const resolvedPositioning = resolveNodePositioningTarget(effectiveNodeOptions, context, target);
  for (const code of resolvedPositioning.diagnostics) {
    pushDiagnostic(code, `Node positioning issue: ${code}`, item.span.from, item.span.to);
  }
  const center = placeNodeCenter(
    resolvedPositioning.anchorPoint,
    nodeShape,
    nodeLayout,
    resolvedPositioning.anchorOverride ?? anchor
  );
  const scopedNames = collectScopedNodeNames(forcedName ?? item.name, item.aliases, context);

  for (const name of scopedNames) {
    registerNamedNodeAnchors(context, name, center, nodeShape, nodeLayout);
  }

  const nodeElements: SceneElement[] = [];
  const boxPaintMode = resolveNodeBoxPaintMode(effectiveNodeLocalOptions);
  if (boxPaintMode.draw || boxPaintMode.fill) {
    const nodeBoxStyle = applyNodeBoxPaintMode(nodeStyle, boxPaintMode);
    if (nodeShape === "circle") {
      nodeElements.push(makeCircleElement(statement.id, center, nodeLayout.visualRadius, nodeBoxStyle, item.span));
      markFeature("shape_circle", "supported");
      markFeature("svg_circle", "supported");
    } else if (nodeShape === "ellipse") {
      nodeElements.push(makeNodeEllipseElement(statement.id, item.id, center, nodeLayout.visualWidth, nodeLayout.visualHeight, nodeBoxStyle, item.span));
      markFeature("keyword_ellipse", "supported");
    } else if (nodeShape === "rectangle") {
      nodeElements.push(makeNodeBoxElement(statement.id, item.id, center, nodeLayout.visualWidth, nodeLayout.visualHeight, nodeBoxStyle, item.span));
      markFeature("shape_rectangle", "supported");
      markFeature("svg_path", "supported");
    }
  }

  const normalizedText = nodeLayout.textLines.join("\n");
  if (normalizedText.length > 0) {
    nodeElements.push(makeTextElement(statement.id, item.id, center, nodeStyle, item.span, normalizedText, nodeLayout.textBlockWidth));
    markFeature("svg_text", "supported");
  }

  const layer = resolveNodeLayer(effectiveNodeOptions, context);
  if (layer === "behind") {
    return { behindElements: nodeElements, frontElements: [] };
  }
  return { behindElements: [], frontElements: nodeElements };
}

function withDefaultNodePosition(options: OptionListAst | undefined, defaultPos: number | undefined): OptionListAst | undefined {
  if (defaultPos == null) {
    return options;
  }

  const hasExplicitPosition =
    options?.entries.some(
      (entry) =>
        (entry.kind === "kv" && entry.key === "pos") ||
        (entry.kind === "flag" &&
          (entry.key === "midway" ||
            entry.key === "near start" ||
            entry.key === "near end" ||
            entry.key === "very near start" ||
            entry.key === "very near end" ||
            entry.key === "at start" ||
            entry.key === "at end"))
    ) ?? false;

  if (hasExplicitPosition) {
    return options;
  }

  const syntheticEntry = {
    kind: "kv" as const,
    key: "pos",
    valueRaw: String(defaultPos),
    span: options?.span ?? { from: 0, to: 0 },
    raw: `pos=${defaultPos}`
  };

  if (!options) {
    return {
      span: { from: 0, to: 0 },
      raw: `[pos=${defaultPos}]`,
      entries: [syntheticEntry]
    };
  }

  return {
    span: options.span,
    raw: `${options.raw}, pos=${defaultPos}`,
    entries: [...options.entries, syntheticEntry]
  };
}

function resolveNodeStyle(
  options: PathOptionItem["options"] | undefined,
  baseStyle: ResolvedStyle,
  context: SemanticContext,
  transformScale = 1
): ResolvedStyle {
  let resolvedStyle = { ...baseStyle };
  if (options) {
    const frame = context.stack[context.stack.length - 1];
    const resolved = resolveContextDelta(baseStyle, frame.transform, [options]);
    resolvedStyle = resolved.style;
  }

  if (Math.abs(transformScale - 1) <= 1e-6) {
    return resolvedStyle;
  }

  return {
    ...resolvedStyle,
    lineWidth: resolvedStyle.lineWidth * transformScale,
    doubleDistance: resolvedStyle.doubleDistance * transformScale,
    fontSize: resolvedStyle.fontSize * transformScale
  };
}

function resolveNodeOptionScale(
  options: PathOptionItem["options"] | undefined,
  baseStyle: ResolvedStyle,
  context: SemanticContext
): number {
  if (!options) {
    return 1;
  }

  const frame = context.stack[context.stack.length - 1];
  const resolved = resolveContextDelta(baseStyle, frame.transform, [options]);
  return computeRelativeTransformScale(frame.transform, resolved.transform);
}

function resolveEffectiveNodeOptions(params: {
  statementOptions: OptionListAst | undefined;
  nodeOptions: OptionListAst | undefined;
  everyNodeStyles: OptionListAst[];
  everyRectangleNodeStyles: OptionListAst[];
  everyCircleNodeStyles: OptionListAst[];
}): OptionListAst | undefined {
  const base = mergeOptionLists([...params.everyNodeStyles, params.statementOptions, params.nodeOptions]);
  const shape = resolveNodeShape(base);
  const shapeStyles =
    shape === "circle"
      ? params.everyCircleNodeStyles
      : shape === "rectangle"
        ? params.everyRectangleNodeStyles
        : [];

  return mergeOptionLists([...params.everyNodeStyles, ...shapeStyles, params.statementOptions, params.nodeOptions]);
}

function mergeOptionLists(lists: Array<OptionListAst | undefined>): OptionListAst | undefined {
  const present = lists.filter((entry): entry is OptionListAst => Boolean(entry));
  if (present.length === 0) {
    return undefined;
  }

  const spanFrom = present.reduce((min, list) => Math.min(min, list.span.from), Number.POSITIVE_INFINITY);
  const spanTo = present.reduce((max, list) => Math.max(max, list.span.to), 0);
  return {
    span: {
      from: Number.isFinite(spanFrom) ? spanFrom : 0,
      to: spanTo
    },
    raw: present.map((list) => list.raw).join(", "),
    entries: present.flatMap((list) => list.entries)
  };
}

function computeTransformScale(transform: { a: number; b: number; c: number; d: number }): number {
  const sx = Math.hypot(transform.a, transform.b);
  const sy = Math.hypot(transform.c, transform.d);
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) {
    return 1;
  }
  const averaged = (sx + sy) / 2;
  if (!Number.isFinite(averaged) || averaged <= 1e-6) {
    return 1;
  }
  return averaged;
}

function computeRelativeTransformScale(
  baseTransform: { a: number; b: number; c: number; d: number },
  resolvedTransform: { a: number; b: number; c: number; d: number }
): number {
  const base = computeTransformScale(baseTransform);
  const resolved = computeTransformScale(resolvedTransform);
  if (!Number.isFinite(resolved) || resolved <= 1e-6) {
    return 1;
  }
  if (!Number.isFinite(base) || base <= 1e-6) {
    return resolved;
  }
  return resolved / base;
}

type NodeShape = "rectangle" | "circle" | "ellipse" | "coordinate";
type NodeLayer = "front" | "behind";
type NodeLayout = {
  textLines: string[];
  textBlockWidth: number;
  visualWidth: number;
  visualHeight: number;
  visualRadius: number;
  anchorHalfWidth: number;
  anchorHalfHeight: number;
  anchorRadius: number;
  baseLineY: number;
  midLineY: number;
};

function resolveNodeShape(options: PathOptionItem["options"] | undefined): NodeShape {
  if (!options) {
    return "rectangle";
  }

  let shape: NodeShape = "rectangle";
  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "circle" || entry.key === "rectangle" || entry.key === "ellipse" || entry.key === "coordinate") {
        shape = entry.key;
      }
      continue;
    }
    if (entry.kind === "kv" && entry.key === "shape") {
      const normalized = normalizeOptionValue(entry.valueRaw).toLowerCase();
      if (normalized === "circle" || normalized === "rectangle" || normalized === "ellipse" || normalized === "coordinate") {
        shape = normalized;
      }
    }
  }
  return shape;
}

function resolveNodeAnchor(options: PathOptionItem["options"] | undefined): string {
  if (!options) {
    return "center";
  }

  let anchor = "center";
  for (const entry of options.entries) {
    if (entry.kind === "kv") {
      if (entry.key === "anchor") {
        const normalized = normalizeOptionValue(entry.valueRaw).toLowerCase().replaceAll("_", " ");
        if (normalized.length > 0) {
          anchor = normalized;
        }
        continue;
      }

      const directional = parseDirectionalKey(entry.key);
      if (directional) {
        anchor = directional.legacyOf ? "center" : currentAnchorForDirection(directional.direction);
      }
      continue;
    }

    if (entry.kind !== "flag") {
      continue;
    }

    if (entry.key === "centered") {
      anchor = "center";
      continue;
    }

    const directional = parseDirectionalKey(entry.key);
    if (directional) {
      anchor = directional.legacyOf ? "center" : currentAnchorForDirection(directional.direction);
    }
  }

  return anchor;
}

function resolveNodeLayer(options: PathOptionItem["options"] | undefined, context: SemanticContext): NodeLayer {
  let mode: NodeLayer = context.stack[context.stack.length - 1]?.nodeLayerMode ?? "front";
  if (!options) {
    return mode;
  }

  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "behind path") {
        mode = "behind";
      } else if (entry.key === "in front of path") {
        mode = "front";
      }
      continue;
    }

    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "behind path") {
      const boolish = parseBoolish(entry.valueRaw);
      if (boolish != null) {
        mode = boolish ? "behind" : "front";
      }
      continue;
    }
    if (entry.key === "in front of path") {
      const boolish = parseBoolish(entry.valueRaw);
      if (boolish != null) {
        mode = boolish ? "front" : "behind";
      }
    }
  }

  return mode;
}

function resolveNodeLayout(
  text: string,
  options: PathOptionItem["options"] | undefined,
  style: ResolvedStyle,
  transformScale = 1
): NodeLayout {
  const fontSize = style.fontSize;
  const charWidth = fontSize * 0.7;
  const lineHeight = fontSize * 1.05;

  const defaultInner = (parseLength(".3333em", "pt") ?? 3.333) * transformScale;
  let innerXSep = defaultInner;
  let innerYSep = defaultInner;
  let textWidth: number | null = null;
  let minWidth = (parseLength("1pt", "pt") ?? 1) * transformScale;
  let minHeight = (parseLength("1pt", "pt") ?? 1) * transformScale;
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
          const scaled = parsed * transformScale;
          innerXSep = scaled;
          innerYSep = scaled;
        }
      } else if (entry.key === "inner xsep") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          innerXSep = parsed * transformScale;
        }
      } else if (entry.key === "inner ysep") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          innerYSep = parsed * transformScale;
        }
      } else if (entry.key === "text width") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          textWidth = Math.max(0, parsed * transformScale);
        }
      } else if (entry.key === "minimum width") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          minWidth = Math.max(0, parsed * transformScale);
        }
      } else if (entry.key === "minimum height") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          minHeight = Math.max(0, parsed * transformScale);
        }
      } else if (entry.key === "minimum size") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          minSize = Math.max(0, parsed * transformScale);
        }
      } else if (entry.key === "outer sep") {
        const normalized = normalizeOptionValue(entry.valueRaw).toLowerCase();
        if (normalized === "auto") {
          outerSep = style.stroke && style.stroke !== "none" ? style.lineWidth / 2 : 0;
        } else {
          const parsed = parseLength(entry.valueRaw, "pt");
          if (parsed != null) {
            outerSep = parsed * transformScale;
          }
        }
      } else if (entry.key === "outer xsep") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          outerXSep = parsed * transformScale;
        }
      } else if (entry.key === "outer ysep") {
        const parsed = parseLength(entry.valueRaw, "pt");
        if (parsed != null) {
          outerYSep = parsed * transformScale;
        }
      }
    }
  }

  const textLines = computeNodeTextLines(text, textWidth, charWidth);
  const maxLineLength = textLines.reduce((max, line) => Math.max(max, line.length), 0);
  const textNaturalWidth = maxLineLength * charWidth;
  const textNaturalHeight = textLines.length * lineHeight;
  const resolvedMinWidth = Math.max(minWidth, minSize ?? minWidth);
  const resolvedMinHeight = Math.max(minHeight, minSize ?? minHeight);
  const measuredTextWidth = textWidth != null ? Math.max(textNaturalWidth, textWidth) : textNaturalWidth;
  const visualWidth = Math.max(measuredTextWidth + innerXSep * 2, resolvedMinWidth);
  const visualHeight = Math.max(textNaturalHeight + innerYSep * 2, resolvedMinHeight);
  const resolvedOuterX = outerXSep ?? outerSep;
  const resolvedOuterY = outerYSep ?? outerSep;

  return {
    textLines,
    textBlockWidth: measuredTextWidth,
    visualWidth,
    visualHeight,
    visualRadius: Math.max(visualWidth, visualHeight) / 2,
    anchorHalfWidth: visualWidth / 2 + resolvedOuterX,
    anchorHalfHeight: visualHeight / 2 + resolvedOuterY,
    anchorRadius: Math.max(visualWidth / 2 + resolvedOuterX, visualHeight / 2 + resolvedOuterY),
    baseLineY: -fontSize * 0.28,
    midLineY: -fontSize * 0.065
  };
}

function resolveNodeTargetPoint(
  item: PathItem & { kind: "Node"; atRaw?: string; atRelativePrefix?: "+" | "++" },
  context: SemanticContext,
  span: { from: number; to: number },
  pushDiagnostic: DiagnosticPushFn,
  options: PathOptionItem["options"] | undefined,
  segment: PlacementSegment | null
): Point {
  if (item.atRaw) {
    const evaluated = evaluateRawCoordinate(item.atRaw, context, item.atRelativePrefix);
    if (evaluated.point) {
      return evaluated.point;
    }
    for (const code of evaluated.diagnostics) {
      pushDiagnostic(code, `Node placement issue: ${code}`, span.from, span.to);
    }
  }

  const pos = resolveNodePositionFraction(options);
  if (pos != null && segment) {
    return pointAtPlacementSegment(segment, pos);
  }

  if (segment) {
    return pointAtSegmentEnd(segment);
  }

  return context.currentPoint ?? { x: 0, y: 0 };
}

function resolveNodePositionFraction(options: PathOptionItem["options"] | undefined): number | null {
  if (!options) {
    return null;
  }

  let value: number | null = null;
  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "midway") {
        value = 0.5;
      } else if (entry.key === "near start") {
        value = 0.25;
      } else if (entry.key === "near end") {
        value = 0.75;
      } else if (entry.key === "very near start") {
        value = 0.125;
      } else if (entry.key === "very near end") {
        value = 0.875;
      } else if (entry.key === "at start") {
        value = 0;
      } else if (entry.key === "at end") {
        value = 1;
      }
      continue;
    }

    if (entry.kind === "kv" && entry.key === "pos") {
      const parsed = Number(normalizeOptionValue(entry.valueRaw));
      if (Number.isFinite(parsed)) {
        value = parsed;
      }
    }
  }

  if (value == null) {
    return null;
  }
  return clamp(value, 0, 1);
}

function pointAtPlacementSegment(segment: PlacementSegment, t: number): Point {
  const clamped = clamp(t, 0, 1);
  if (segment.kind === "line") {
    return interpolate(segment.from, segment.to, clamped);
  }

  if (segment.kind === "hv") {
    if (clamped <= 0.5) {
      return interpolate(segment.from, segment.bend, clamped * 2);
    }
    return interpolate(segment.bend, segment.to, (clamped - 0.5) * 2);
  }

  if (segment.kind === "cubic") {
    return cubicPoint(segment.from, segment.c1, segment.c2, segment.to, clamped);
  }

  const center = arcCenter(segment.from, segment.params);
  const angle = segment.params.startAngle + (segment.params.endAngle - segment.params.startAngle) * clamped;
  const radians = toRadians(angle);
  return {
    x: center.x + segment.params.rx * Math.cos(radians),
    y: center.y + segment.params.ry * Math.sin(radians)
  };
}

function pointAtSegmentEnd(segment: PlacementSegment): Point {
  if (segment.kind === "line" || segment.kind === "hv" || segment.kind === "cubic" || segment.kind === "arc") {
    return segment.to;
  }
  return pointAtPlacementSegment(segment, 1);
}

function interpolate(from: Point, to: Point, t: number): Point {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t
  };
}

function cubicPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const uu = u * u;
  const uuu = uu * u;
  const tt = t * t;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y
  };
}

function placeNodeCenter(target: Point, shape: NodeShape, layout: NodeLayout, anchor: string): Point {
  const offset = nodeAnchorOffset(shape, layout, anchor);
  return {
    x: target.x - offset.x,
    y: target.y - offset.y
  };
}

function nodeAnchorOffset(shape: NodeShape, layout: NodeLayout, anchorRaw: string): Point {
  const anchor = anchorRaw.trim().toLowerCase().replaceAll("_", " ");

  if (shape === "coordinate") {
    return { x: 0, y: 0 };
  }

  if (shape === "circle") {
    const r = layout.anchorRadius;
    const d = r / Math.sqrt(2);
    switch (anchor) {
      case "north":
        return { x: 0, y: r };
      case "south":
        return { x: 0, y: -r };
      case "east":
        return { x: r, y: 0 };
      case "west":
        return { x: -r, y: 0 };
      case "north east":
        return { x: d, y: d };
      case "north west":
        return { x: -d, y: d };
      case "south east":
        return { x: d, y: -d };
      case "south west":
        return { x: -d, y: -d };
      case "base":
      case "base east":
      case "base west":
      case "mid":
      case "mid east":
      case "mid west":
      case "center":
      default:
        return { x: 0, y: 0 };
    }
  }

  if (shape === "ellipse") {
    const rx = layout.anchorHalfWidth;
    const ry = layout.anchorHalfHeight;
    switch (anchor) {
      case "north":
        return { x: 0, y: ry };
      case "south":
        return { x: 0, y: -ry };
      case "east":
        return { x: rx, y: 0 };
      case "west":
        return { x: -rx, y: 0 };
      case "north east":
        return ellipseDirectionalOffset(rx, ry, 1, 1);
      case "north west":
        return ellipseDirectionalOffset(rx, ry, -1, 1);
      case "south east":
        return ellipseDirectionalOffset(rx, ry, 1, -1);
      case "south west":
        return ellipseDirectionalOffset(rx, ry, -1, -1);
      case "base east":
        return { x: rx, y: layout.baseLineY };
      case "base west":
        return { x: -rx, y: layout.baseLineY };
      case "mid":
        return { x: 0, y: layout.midLineY };
      case "mid east":
        return { x: rx, y: layout.midLineY };
      case "mid west":
        return { x: -rx, y: layout.midLineY };
      case "base":
        return { x: 0, y: layout.baseLineY };
      case "center":
      default:
        return { x: 0, y: 0 };
    }
  }

  const hw = layout.anchorHalfWidth;
  const hh = layout.anchorHalfHeight;
  switch (anchor) {
    case "north":
      return { x: 0, y: hh };
    case "south":
      return { x: 0, y: -hh };
    case "east":
      return { x: hw, y: 0 };
    case "west":
      return { x: -hw, y: 0 };
    case "north east":
      return { x: hw, y: hh };
    case "north west":
      return { x: -hw, y: hh };
    case "south east":
      return { x: hw, y: -hh };
    case "south west":
      return { x: -hw, y: -hh };
    case "base east":
      return { x: hw, y: layout.baseLineY };
    case "base west":
      return { x: -hw, y: layout.baseLineY };
    case "mid":
      return { x: 0, y: layout.midLineY };
    case "mid east":
      return { x: hw, y: layout.midLineY };
    case "mid west":
      return { x: -hw, y: layout.midLineY };
    case "base":
      return { x: 0, y: layout.baseLineY };
    case "center":
    default:
      return { x: 0, y: 0 };
  }
}

function ellipseDirectionalOffset(rx: number, ry: number, dx: number, dy: number): Point {
  const norm = Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
  if (!Number.isFinite(norm) || norm <= 1e-9) {
    return { x: 0, y: 0 };
  }
  return {
    x: dx / norm,
    y: dy / norm
  };
}

function resolveNodeBoxPaintMode(options: PathOptionItem["options"] | undefined): { draw: boolean; fill: boolean } {
  let draw = false;
  let fill = false;

  if (!options) {
    return { draw, fill };
  }

  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "draw") {
        draw = true;
      } else if (entry.key === "fill") {
        fill = true;
      }
      continue;
    }

    if (entry.kind !== "kv") {
      continue;
    }

    if (entry.key === "draw") {
      draw = normalizeOptionValue(entry.valueRaw).toLowerCase() !== "none";
      continue;
    }

    if (entry.key === "fill") {
      fill = normalizeOptionValue(entry.valueRaw).toLowerCase() !== "none";
    }
  }

  return { draw, fill };
}

function applyNodeBoxPaintMode(style: ResolvedStyle, paintMode: { draw: boolean; fill: boolean }): ResolvedStyle {
  return {
    ...style,
    stroke: paintMode.draw ? style.stroke : null,
    fill: paintMode.fill ? style.fill : null,
    drawExplicit: paintMode.draw ? style.drawExplicit : false
  };
}

function makeNodeBoxElement(
  sourceId: string,
  itemId: string,
  center: Point,
  width: number,
  height: number,
  style: ResolvedStyle,
  span: { from: number; to: number }
): ScenePath {
  const halfWidth = width / 2;
  const halfHeight = height / 2;

  return {
    kind: "Path",
    id: `scene-node-box:${sourceId}:${itemId}`,
    sourceId,
    sourceSpan: span,
    style: { ...style },
    commands: [
      { kind: "M", to: { x: center.x - halfWidth, y: center.y - halfHeight } },
      { kind: "L", to: { x: center.x + halfWidth, y: center.y - halfHeight } },
      { kind: "L", to: { x: center.x + halfWidth, y: center.y + halfHeight } },
      { kind: "L", to: { x: center.x - halfWidth, y: center.y + halfHeight } },
      { kind: "Z" }
    ]
  };
}

function makeNodeEllipseElement(
  sourceId: string,
  itemId: string,
  center: Point,
  width: number,
  height: number,
  style: ResolvedStyle,
  span: { from: number; to: number }
): SceneEllipse {
  return {
    kind: "Ellipse",
    id: `scene-node-ellipse:${sourceId}:${itemId}`,
    sourceId,
    sourceSpan: span,
    style: { ...style },
    center,
    rx: width / 2,
    ry: height / 2
  };
}

function registerNamedNodeAnchors(
  context: SemanticContext,
  name: string,
  center: Point,
  shape: NodeShape,
  layout: NodeLayout
): void {
  context.namedNodeGeometries.set(name, {
    shape,
    center,
    anchorHalfWidth: layout.anchorHalfWidth,
    anchorHalfHeight: layout.anchorHalfHeight,
    anchorRadius: layout.anchorRadius
  });

  const offsets: Record<string, Point> = {
    center: nodeAnchorOffset(shape, layout, "center"),
    base: nodeAnchorOffset(shape, layout, "base"),
    north: nodeAnchorOffset(shape, layout, "north"),
    south: nodeAnchorOffset(shape, layout, "south"),
    east: nodeAnchorOffset(shape, layout, "east"),
    west: nodeAnchorOffset(shape, layout, "west"),
    "north east": nodeAnchorOffset(shape, layout, "north east"),
    "north west": nodeAnchorOffset(shape, layout, "north west"),
    "south east": nodeAnchorOffset(shape, layout, "south east"),
    "south west": nodeAnchorOffset(shape, layout, "south west"),
    "base east": nodeAnchorOffset(shape, layout, "base east"),
    "base west": nodeAnchorOffset(shape, layout, "base west"),
    mid: nodeAnchorOffset(shape, layout, "mid"),
    "mid east": nodeAnchorOffset(shape, layout, "mid east"),
    "mid west": nodeAnchorOffset(shape, layout, "mid west")
  };

  for (const [anchor, offset] of Object.entries(offsets)) {
    const point = {
      x: center.x + offset.x,
      y: center.y + offset.y
    };
    if (anchor === "center") {
      context.namedCoordinates.set(name, point);
    }
    context.namedCoordinates.set(`${name}.${anchor}`, point);
  }
}

function collectScopedNodeNames(name: string | undefined, aliases: string[] | undefined, context: SemanticContext): string[] {
  const names = [name, ...(aliases ?? [])].filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  const scoped = names.map((entry) => applyNameScope(entry, context));
  return Array.from(new Set(scoped));
}

export function maybeResolveTrailingCoordinateFromNodeName(name: string | undefined): string | null {
  if (!name) {
    return null;
  }

  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const asCoordinate = `(${trimmed})`;
  const parsed = parseCoordinate(asCoordinate);
  if (parsed.form === "named" || parsed.form === "unknown") {
    return null;
  }
  return asCoordinate;
}

export function shouldCaptureStandaloneNodeNameCoordinate(items: PathItem[], coordinateIndex: number): boolean {
  for (let index = 0; index < coordinateIndex; index += 1) {
    if (items[index]?.kind === "Node") {
      return false;
    }
  }

  for (let index = coordinateIndex - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item || item.kind === "PathComment") {
      continue;
    }
    if (item.kind === "PathKeyword" && item.keyword === "at") {
      return false;
    }
    break;
  }

  return true;
}

export function applyNameScope(name: string, context: SemanticContext): string {
  const frame = context.stack[context.stack.length - 1];
  const prefix = frame?.namePrefix ?? "";
  const suffix = frame?.nameSuffix ?? "";
  if (prefix.length === 0 && suffix.length === 0) {
    return name.trim();
  }

  const trimmed = name.trim();
  const dot = trimmed.indexOf(".");
  if (dot === -1) {
    return `${prefix}${trimmed}${suffix}`;
  }

  const base = trimmed.slice(0, dot);
  const anchor = trimmed.slice(dot);
  return `${prefix}${base}${suffix}${anchor}`;
}

function parseBoolish(raw: string): boolean | null {
  const normalized = normalizeOptionValue(raw).toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "no" || normalized === "0") {
    return false;
  }
  return null;
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

function normalizeOptionValue(raw: string): string {
  let value = raw.trim();
  while (value.startsWith("{") && value.endsWith("}") && isWrappedBySingleBracePair(value)) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

function isWrappedBySingleBracePair(raw: string): boolean {
  let depth = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && index !== raw.length - 1) {
        return false;
      }
      if (depth < 0) {
        return false;
      }
    }
  }
  return depth === 0;
}


export function maybeResolveNamedCoordinateBorderPoint(
  coordinate: Pick<CoordinateItem, "form" | "x">,
  fallbackPoint: Point,
  fromPoint: Point | null,
  context: SemanticContext
): Point {
  if (coordinate.form !== "named") {
    return fallbackPoint;
  }
  return maybeResolveNamedNodeBorderPoint(coordinate.x, fallbackPoint, fromPoint, context);
}

export function maybeResolveNamedCoordinateBorderPointFromRaw(
  rawCoordinate: string,
  fallbackPoint: Point,
  fromPoint: Point | null,
  context: SemanticContext
): Point {
  const parsed = parseCoordinate(rawCoordinate);
  if (parsed.form !== "named") {
    return fallbackPoint;
  }
  return maybeResolveNamedNodeBorderPoint(parsed.x, fallbackPoint, fromPoint, context);
}

function maybeResolveNamedNodeBorderPoint(
  rawName: string,
  fallbackPoint: Point,
  fromPoint: Point | null,
  context: SemanticContext
): Point {
  if (!fromPoint) {
    return fallbackPoint;
  }

  const trimmed = rawName.trim();
  if (trimmed.length === 0 || trimmed.includes(".")) {
    return fallbackPoint;
  }

  const geometry = resolveNamedNodeGeometry(trimmed, context);
  if (!geometry || geometry.shape === "coordinate") {
    return fallbackPoint;
  }

  const borderPoint = intersectNodeBorder(geometry, fromPoint);
  return borderPoint ?? fallbackPoint;
}

function resolveNamedNodeGeometry(rawName: string, context: SemanticContext): {
  shape: "rectangle" | "circle" | "ellipse" | "coordinate";
  center: Point;
  anchorHalfWidth: number;
  anchorHalfHeight: number;
  anchorRadius: number;
} | null {
  const scoped = applyNameScope(rawName, context);
  const candidates = scoped === rawName ? [rawName] : [scoped, rawName];
  for (const candidate of candidates) {
    const geometry = context.namedNodeGeometries.get(candidate);
    if (geometry) {
      return geometry;
    }
  }
  return null;
}

function intersectNodeBorder(
  geometry: {
    shape: "rectangle" | "circle" | "ellipse" | "coordinate";
    center: Point;
    anchorHalfWidth: number;
    anchorHalfHeight: number;
    anchorRadius: number;
  },
  fromPoint: Point
): Point | null {
  const dx = fromPoint.x - geometry.center.x;
  const dy = fromPoint.y - geometry.center.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len <= 1e-9) {
    return null;
  }

  if (geometry.shape === "circle") {
    const radius = geometry.anchorRadius;
    if (!Number.isFinite(radius) || radius <= 1e-9) {
      return null;
    }
    const scale = radius / len;
    return {
      x: geometry.center.x + dx * scale,
      y: geometry.center.y + dy * scale
    };
  }

  if (geometry.shape === "rectangle") {
    const hw = geometry.anchorHalfWidth;
    const hh = geometry.anchorHalfHeight;
    if (!Number.isFinite(hw) || !Number.isFinite(hh) || hw <= 1e-9 || hh <= 1e-9) {
      return null;
    }
    const scale = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
    return {
      x: geometry.center.x + dx * scale,
      y: geometry.center.y + dy * scale
    };
  }

  if (geometry.shape === "ellipse") {
    const rx = geometry.anchorHalfWidth;
    const ry = geometry.anchorHalfHeight;
    if (!Number.isFinite(rx) || !Number.isFinite(ry) || rx <= 1e-9 || ry <= 1e-9) {
      return null;
    }
    const scale = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
    if (!Number.isFinite(scale)) {
      return null;
    }
    return {
      x: geometry.center.x + dx * scale,
      y: geometry.center.y + dy * scale
    };
  }

  return null;
}


function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function arcCenter(from: Point, params: ArcParameters): Point {
  const startRadians = toRadians(params.startAngle);
  return {
    x: from.x - params.rx * Math.cos(startRadians),
    y: from.y - params.ry * Math.sin(startRadians)
  };
}

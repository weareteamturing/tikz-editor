import type { CoordinateOperationItem, PathOptionItem, PathStatement, ToOperationItem } from "../../ast/types.js";
import type { SemanticContext } from "../context.js";
import { evaluateCoordinate, evaluateRawCoordinate } from "../coords/evaluate.js";
import { parseCoordinateLike, parseLength } from "../coords/parse-length.js";
import { extractCircleRadius } from "../style/resolve.js";
import type {
  Point,
  ResolvedStyle,
  SceneCircle,
  SceneElement,
  SceneEllipse,
  ScenePath,
  ScenePathCommand,
  SceneText
} from "../types.js";

type FeatureMarkFn = (featureId: string, status: "supported" | "unsupported") => void;
type DiagnosticPushFn = (code: string, message: string, spanFrom: number, spanTo: number) => void;

export function evaluatePathStatement(
  statement: PathStatement,
  context: SemanticContext,
  style: ResolvedStyle,
  markFeature: FeatureMarkFn,
  pushDiagnostic: DiagnosticPushFn
): SceneElement[] {
  const elements: SceneElement[] = [];
  let activePath: ScenePath | null = null;
  let currentOperator: "--" | "-|" | "|-" | ".." | null = null;
  let pendingRectangleFrom: Point | null = null;
  let pendingCircleCenter: Point | null = null;
  let pendingCircleRadius: number | null = null;
  let pendingEllipseCenter: Point | null = null;
  let pendingEllipseRadii: { rx: number; ry: number } | null = null;
  let pendingArcFrom: Point | null = null;
  let pendingGrid: { from: Point; step: number } | null = null;

  for (let index = 0; index < statement.items.length; index += 1) {
    const item = statement.items[index];

    if (item.kind === "Coordinate") {
      const evaluated = evaluateCoordinate(item, context);
      for (const code of evaluated.diagnostics) {
        pushDiagnostic(code, `Coordinate evaluation issue: ${code}`, item.span.from, item.span.to);
      }
      if (!evaluated.point) {
        continue;
      }

      if (pendingGrid) {
        markFeature("keyword_grid", "supported");
        markFeature("svg_path", "supported");
        elements.push(...makeGridElements(statement.id, item.id, pendingGrid.from, evaluated.point, pendingGrid.step, style, item.span));
        context.currentPoint = evaluated.point;
        pendingGrid = null;
        continue;
      }

      if (pendingRectangleFrom) {
        markFeature("shape_rectangle", "supported");
        markFeature("svg_path", "supported");
        elements.push(makeRectangleElement(statement.id, item.id, pendingRectangleFrom, evaluated.point, style, item.span));
        pendingRectangleFrom = null;
        context.currentPoint = evaluated.point;
        if (!context.pathStartPoint) {
          context.pathStartPoint = evaluated.point;
        }
        continue;
      }

      if (!activePath) {
        activePath = makePath(statement.id, item.id, style, statement.span);
        activePath.commands.push({ kind: "M", to: evaluated.point });
        context.pathStartPoint = evaluated.point;
        markFeature("svg_path", "supported");
      } else {
        appendPathPoint(activePath.commands, currentOperator, context.currentPoint, evaluated.point);
      }

      const shouldAdvancePoint = item.relativePrefix ? item.relativePrefix === "++" : true;
      if (shouldAdvancePoint) {
        context.currentPoint = evaluated.point;
      }
      if (!context.currentPoint) {
        context.currentPoint = evaluated.point;
      }
      currentOperator = null;
      continue;
    }

    if (item.kind === "PathKeyword") {
      if (item.keyword === "--" || item.keyword === "-|" || item.keyword === "|-" || item.keyword === "..") {
        currentOperator = item.keyword;
        if (item.keyword === "..") {
          markFeature("path_operator_curves", "unsupported");
          pushDiagnostic("unsupported-path-operator", "Curve operator `..` is not supported yet.", item.span.from, item.span.to);
        } else {
          markFeature("path_operators_basic", "supported");
        }
        continue;
      }

      if (item.keyword === "cycle") {
        if (activePath) {
          activePath.commands.push({ kind: "Z" });
          elements.push(activePath);
          activePath = null;
          markFeature("path_cycle", "supported");
        }
        if (context.pathStartPoint) {
          context.currentPoint = context.pathStartPoint;
        }
        continue;
      }

      if (item.keyword === "rectangle") {
        if (!context.currentPoint) {
          pushDiagnostic("rectangle-without-start", "Rectangle operator requires a current point.", item.span.from, item.span.to);
          continue;
        }
        pendingRectangleFrom = context.currentPoint;
        markFeature("shape_rectangle", "supported");
        continue;
      }

      if (item.keyword === "circle") {
        if (!context.currentPoint) {
          pushDiagnostic("circle-without-center", "Circle operator requires a current point.", item.span.from, item.span.to);
          continue;
        }
        pendingCircleCenter = context.currentPoint;
        pendingCircleRadius = null;
        markFeature("shape_circle", "supported");
        continue;
      }

      if (item.keyword === "ellipse") {
        if (!context.currentPoint) {
          pushDiagnostic("ellipse-without-center", "Ellipse keyword requires a current point.", item.span.from, item.span.to);
          continue;
        }
        pendingEllipseCenter = context.currentPoint;
        pendingEllipseRadii = null;
        markFeature("keyword_ellipse", "supported");
        continue;
      }

      if (item.keyword === "arc") {
        if (!context.currentPoint) {
          pushDiagnostic("arc-without-start", "Arc keyword requires a current point.", item.span.from, item.span.to);
          continue;
        }
        pendingArcFrom = context.currentPoint;
        markFeature("keyword_arc", "supported");
        continue;
      }

      if (item.keyword === "grid") {
        if (!context.currentPoint) {
          pushDiagnostic("grid-without-start", "Grid keyword requires a current point.", item.span.from, item.span.to);
          continue;
        }
        pendingGrid = {
          from: context.currentPoint,
          step: parseLength("1cm", "cm") ?? 28.3464567
        };
        continue;
      }

      if (
        item.keyword === "controls" ||
        item.keyword === "and"
      ) {
        markFeature(`keyword_${item.keyword}`, "unsupported");
        pushDiagnostic(
          "unsupported-path-keyword",
          `Path keyword \`${item.keyword}\` is parsed but not semantically implemented yet.`,
          item.span.from,
          item.span.to
        );
      }

      continue;
    }

    if (item.kind === "PathOption") {
      if (pendingCircleCenter) {
        pendingCircleRadius = extractCircleRadius(item.options);
      }
      if (pendingEllipseCenter) {
        pendingEllipseRadii = extractEllipseRadii(item, pushDiagnostic);
      }
      if (pendingArcFrom) {
        const arcParams = extractArcParameters(item, pushDiagnostic);
        if (arcParams) {
          if (!activePath) {
            activePath = makePath(statement.id, item.id, style, item.span);
            activePath.commands.push({ kind: "M", to: pendingArcFrom });
          }
          appendArc(activePath.commands, pendingArcFrom, arcParams.startAngle, arcParams.endAngle, arcParams.radius);
          context.currentPoint = arcEndpoint(pendingArcFrom, arcParams.startAngle, arcParams.endAngle, arcParams.radius);
          markFeature("svg_path", "supported");
        }
        pendingArcFrom = null;
      }
      if (pendingGrid && item.options.entries.some((entry) => entry.kind === "kv" && entry.key === "step")) {
        const step = extractGridStep(item);
        if (step != null && step > 0) {
          pendingGrid.step = step;
        }
      }
      continue;
    }

    if (item.kind === "Node") {
      const position = context.currentPoint ?? { x: 0, y: 0 };
      elements.push(makeTextElement(statement.id, item.id, position, style, item.span, item.text));
      markFeature("svg_text", "supported");
      continue;
    }

    if (item.kind === "CoordinateOperation") {
      registerNamedCoordinate(item, context, pushDiagnostic);
      markFeature("named_coordinates", "supported");
      continue;
    }

    if (item.kind === "ToOperation") {
      const handled = applyToOperation(item, context, statement, style, activePath, markFeature, pushDiagnostic);
      activePath = handled.activePath;
      continue;
    }

    if (item.kind === "SvgOperation") {
      markFeature("svg_operation", "unsupported");
      pushDiagnostic("unsupported-svg-operation", "`svg` operations are not semantically implemented yet.", item.span.from, item.span.to);
      continue;
    }

    if (item.kind === "LetOperation") {
      markFeature("let_operation", "unsupported");
      pushDiagnostic("unsupported-let-operation", "`let` operations are not semantically implemented yet.", item.span.from, item.span.to);
      continue;
    }
  }

  if (pendingCircleCenter) {
    markFeature("svg_circle", "supported");
    elements.push(makeCircleElement(statement.id, pendingCircleCenter, pendingCircleRadius ?? parseLength("1cm", "cm")!, style, statement.span));
  }

  if (pendingEllipseCenter) {
    const radii = pendingEllipseRadii ?? {
      rx: parseLength("1cm", "cm") ?? 28.3464567,
      ry: parseLength("1cm", "cm") ?? 28.3464567
    };
    elements.push(makeEllipseElement(statement.id, pendingEllipseCenter, radii.rx, radii.ry, style, statement.span));
  }

  if (activePath) {
    elements.push(activePath);
  }

  return elements;
}

function makePath(sourceId: string, itemId: string, style: ResolvedStyle, span: { from: number; to: number }): ScenePath {
  return {
    kind: "Path",
    id: `scene-path:${sourceId}:${itemId}`,
    sourceId,
    sourceSpan: span,
    style: { ...style },
    commands: []
  };
}

function appendPathPoint(commands: ScenePathCommand[], operator: "--" | "-|" | "|-" | ".." | null, current: Point | null, next: Point): void {
  if (!current || !operator || operator === "--" || operator === "..") {
    commands.push({ kind: "L", to: next });
    return;
  }

  if (operator === "-|") {
    commands.push({ kind: "L", to: { x: next.x, y: current.y } });
    commands.push({ kind: "L", to: next });
    return;
  }

  if (operator === "|-") {
    commands.push({ kind: "L", to: { x: current.x, y: next.y } });
    commands.push({ kind: "L", to: next });
    return;
  }
}

function makeRectangleElement(
  sourceId: string,
  itemId: string,
  from: Point,
  to: Point,
  style: ResolvedStyle,
  span: { from: number; to: number }
): ScenePath {
  return {
    kind: "Path",
    id: `scene-rectangle:${sourceId}:${itemId}`,
    sourceId,
    sourceSpan: span,
    style: { ...style },
    commands: [
      { kind: "M", to: from },
      { kind: "L", to: { x: to.x, y: from.y } },
      { kind: "L", to: to },
      { kind: "L", to: { x: from.x, y: to.y } },
      { kind: "Z" }
    ]
  };
}

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

function makeEllipseElement(
  sourceId: string,
  center: Point,
  rx: number,
  ry: number,
  style: ResolvedStyle,
  span: { from: number; to: number }
): SceneEllipse {
  return {
    kind: "Ellipse",
    id: `scene-ellipse:${sourceId}:${span.from}`,
    sourceId,
    sourceSpan: span,
    style: { ...style },
    center,
    rx,
    ry
  };
}

function makeTextElement(
  sourceId: string,
  itemId: string,
  position: Point,
  style: ResolvedStyle,
  span: { from: number; to: number },
  text: string
): SceneText {
  return {
    kind: "Text",
    id: `scene-text:${sourceId}:${itemId}`,
    sourceId,
    sourceSpan: span,
    style: { ...style },
    position,
    text
  };
}

function registerNamedCoordinate(item: CoordinateOperationItem, context: SemanticContext, pushDiagnostic: DiagnosticPushFn): void {
  const coordinatePattern = /coordinate\s*\(([^\)]+)\)\s*at\s*(\([^\)]+\))/i;
  const match = item.raw.match(coordinatePattern);
  if (!match) {
    pushDiagnostic("invalid-coordinate-operation", "Could not parse coordinate operation.", item.span.from, item.span.to);
    return;
  }

  const name = match[1].trim();
  const rawCoordinate = match[2].trim();
  const tuple = parseCoordinateLike(rawCoordinate);
  if (!tuple) {
    pushDiagnostic("invalid-coordinate-operation", "Invalid coordinate operation target.", item.span.from, item.span.to);
    return;
  }

  const x = parseLength(tuple.x, "cm");
  const y = parseLength(tuple.y, "cm");
  if (x == null || y == null) {
    pushDiagnostic("invalid-coordinate-operation", "Invalid coordinate operation value.", item.span.from, item.span.to);
    return;
  }

  context.namedCoordinates.set(name, { x, y });
}

function applyToOperation(
  item: ToOperationItem,
  context: SemanticContext,
  statement: PathStatement,
  style: ResolvedStyle,
  activePath: ScenePath | null,
  markFeature: FeatureMarkFn,
  pushDiagnostic: DiagnosticPushFn
): { activePath: ScenePath | null } {
  const target = parseToTarget(item.raw);
  if (!target) {
    markFeature("to_operation", "unsupported");
    pushDiagnostic("unsupported-to-operation", "`to` operation target is not yet supported.", item.span.from, item.span.to);
    return { activePath };
  }

  markFeature("to_operation", "supported");
  markFeature("keyword_to", "supported");
  markFeature("path_operators_basic", "supported");

  if (target.kind === "cycle") {
    if (activePath) {
      activePath.commands.push({ kind: "Z" });
      context.currentPoint = context.pathStartPoint;
    }
    return { activePath };
  }

  const evaluated = evaluateRawCoordinate(target.rawCoordinate, context, target.relativePrefix);
  if (!evaluated.point) {
    markFeature("to_operation", "unsupported");
    for (const code of evaluated.diagnostics) {
      pushDiagnostic(code, `to-operation target issue: ${code}`, item.span.from, item.span.to);
    }
    return { activePath };
  }

  let path = activePath;
  if (!path) {
    if (context.currentPoint) {
      path = makePath(statement.id, item.id, style, item.span);
      path.commands.push({ kind: "M", to: context.currentPoint });
    } else {
      path = makePath(statement.id, item.id, style, item.span);
      path.commands.push({ kind: "M", to: evaluated.point });
      context.pathStartPoint = evaluated.point;
      context.currentPoint = evaluated.point;
      markFeature("svg_path", "supported");
      return { activePath: path };
    }
  }

  appendPathPoint(path.commands, "--", context.currentPoint, evaluated.point);
  context.currentPoint = evaluated.point;
  markFeature("svg_path", "supported");
  return { activePath: path };
}

function parseToTarget(raw: string): { kind: "cycle" } | { kind: "coordinate"; rawCoordinate: string; relativePrefix?: "+" | "++" } | null {
  if (/\bcycle\b/i.test(raw)) {
    return { kind: "cycle" };
  }

  const match = raw.match(/(to\b[\s\S]*?)(\+\+|\+)?(\([^\)]*\))\s*$/i);
  if (!match) {
    return null;
  }

  const prefix = match[2] === "++" ? "++" : match[2] === "+" ? "+" : undefined;
  return {
    kind: "coordinate",
    rawCoordinate: match[3],
    relativePrefix: prefix
  };
}

function extractEllipseRadii(item: PathOptionItem, pushDiagnostic: DiagnosticPushFn): { rx: number; ry: number } | null {
  let rx: number | null = null;
  let ry: number | null = null;
  let r: number | null = null;

  for (const entry of item.options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "x radius") {
      rx = parseLength(entry.valueRaw, "cm");
    } else if (entry.key === "y radius") {
      ry = parseLength(entry.valueRaw, "cm");
    } else if (entry.key === "radius") {
      r = parseLength(entry.valueRaw, "cm");
    }
  }

  if (r != null) {
    return { rx: r, ry: r };
  }

  if (rx != null && ry != null) {
    return { rx, ry };
  }

  if (rx == null && ry == null) {
    return null;
  }

  pushDiagnostic("invalid-ellipse-radii", "Ellipse requires both x radius and y radius.", item.span.from, item.span.to);
  return null;
}

function extractArcParameters(
  item: PathOptionItem,
  pushDiagnostic: DiagnosticPushFn
): { startAngle: number; endAngle: number; radius: number } | null {
  let startAngle: number | null = null;
  let endAngle: number | null = null;
  let radius: number | null = null;

  for (const entry of item.options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "start angle") {
      const parsed = Number(entry.valueRaw);
      if (Number.isFinite(parsed)) {
        startAngle = parsed;
      }
    } else if (entry.key === "end angle") {
      const parsed = Number(entry.valueRaw);
      if (Number.isFinite(parsed)) {
        endAngle = parsed;
      }
    } else if (entry.key === "radius") {
      radius = parseLength(entry.valueRaw, "cm");
    }
  }

  if (startAngle == null || endAngle == null || radius == null) {
    pushDiagnostic("invalid-arc-parameters", "Arc requires start angle, end angle, and radius.", item.span.from, item.span.to);
    return null;
  }

  return { startAngle, endAngle, radius };
}

function extractGridStep(item: PathOptionItem): number | null {
  for (const entry of item.options.entries) {
    if (entry.kind === "kv" && entry.key === "step") {
      const step = parseLength(entry.valueRaw, "cm");
      if (step != null) {
        return step;
      }
    }
  }
  return null;
}

function appendArc(commands: ScenePathCommand[], from: Point, startAngle: number, endAngle: number, radius: number): void {
  const delta = endAngle - startAngle;
  const segments = Math.max(8, Math.ceil(Math.abs(delta) / 10));
  const startRadians = toRadians(startAngle);
  const center = {
    x: from.x - radius * Math.cos(startRadians),
    y: from.y - radius * Math.sin(startRadians)
  };

  for (let i = 1; i <= segments; i += 1) {
    const angle = startAngle + (delta * i) / segments;
    const radians = toRadians(angle);
    commands.push({
      kind: "L",
      to: {
        x: center.x + radius * Math.cos(radians),
        y: center.y + radius * Math.sin(radians)
      }
    });
  }
}

function arcEndpoint(from: Point, startAngle: number, endAngle: number, radius: number): Point {
  const startRadians = toRadians(startAngle);
  const center = {
    x: from.x - radius * Math.cos(startRadians),
    y: from.y - radius * Math.sin(startRadians)
  };
  const endRadians = toRadians(endAngle);
  return {
    x: center.x + radius * Math.cos(endRadians),
    y: center.y + radius * Math.sin(endRadians)
  };
}

function makeGridElements(
  sourceId: string,
  itemId: string,
  from: Point,
  to: Point,
  step: number,
  style: ResolvedStyle,
  span: { from: number; to: number }
): ScenePath[] {
  const minX = Math.min(from.x, to.x);
  const maxX = Math.max(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const maxY = Math.max(from.y, to.y);
  const spacing = step > 0 ? step : parseLength("1cm", "cm") ?? 28.3464567;

  const paths: ScenePath[] = [];
  for (let x = minX; x <= maxX + 1e-6; x += spacing) {
    paths.push({
      kind: "Path",
      id: `scene-grid-x:${sourceId}:${itemId}:${x.toFixed(3)}`,
      sourceId,
      sourceSpan: span,
      style: { ...style },
      commands: [
        { kind: "M", to: { x, y: minY } },
        { kind: "L", to: { x, y: maxY } }
      ]
    });
  }
  for (let y = minY; y <= maxY + 1e-6; y += spacing) {
    paths.push({
      kind: "Path",
      id: `scene-grid-y:${sourceId}:${itemId}:${y.toFixed(3)}`,
      sourceId,
      sourceSpan: span,
      style: { ...style },
      commands: [
        { kind: "M", to: { x: minX, y } },
        { kind: "L", to: { x: maxX, y } }
      ]
    });
  }
  return paths;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

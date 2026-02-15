import type { CoordinateItem, EdgeOperationItem, PathStatement, ToOperationItem } from "../../ast/types.js";
import type { SemanticContext } from "../context.js";
import {
  applyNameScope,
  evaluateNodeItem,
  maybeResolveNamedCoordinateBorderPoint,
  maybeResolveTrailingCoordinateFromNodeName,
  shouldCaptureStandaloneNodeNameCoordinate
} from "../nodes/evaluate.js";
import { pointAtPlacementSegment, resolveNodePositionFraction } from "../nodes/placement.js";
import { evaluateCoordinate, evaluateRawCoordinate } from "../coords/evaluate.js";
import { parseLength, parseQuantityExpression } from "../coords/parse-length.js";
import type { Point, ResolvedStyle, SceneElement, ScenePath } from "../types.js";
import { appendArcCommand, extractArcParameters, parseArcShorthand } from "./arc.js";
import { DEFAULT_GRID_STEP } from "./constants.js";
import { appendSinCosSegment, parseBezierFromItems } from "./curves.js";
import {
  appendCircleSubpath,
  appendEllipseSubpath,
  appendRectangleSubpath,
  ensurePathForSubpath,
  flushDrawableActivePath,
  hasDrawablePathSegments,
  makeCircleElement,
  makeEllipseElement,
  makePath,
  makeRectangleElement
} from "./elements.js";
import { extractGridSteps, makeGridElements } from "./grid.js";
import { parseCircleRadiusFromCoordinateRaw, parseCoordinateOperation, parseEllipseRadiiFromCoordinateRaw } from "./parsers.js";
import { parseParabolaFromItems } from "./parabola.js";
import { extractCircleShapeOptions, extractEllipseRadii, extractRoundedCorners } from "./shape-options.js";
import { appendPathPoint, roundClosedPathStartCorner } from "./segments.js";
import { applyEdgeOperation, applyToOperation } from "./to-operation.js";
import {
  extractNodeAdornmentPlan,
  extractToLikeOptionPlan,
  materializeNodeAdornment
} from "./label-quotes.js";
import type { DiagnosticPushFn, FeatureMarkFn, PlacementSegment } from "./types.js";
import { applyMatrix, applyMatrixToVector } from "../transform.js";
import { parseStyleValueAsOptionList, resolveContextDelta } from "../style/resolve.js";

type EllipseGeometry = {
  rx: number;
  ry: number;
  rotation: number;
};

type CircleOrEllipseGeometry =
  | {
      kind: "circle";
      radius: number;
    }
  | ({
      kind: "ellipse";
    } & EllipseGeometry);

function transformCircleGeometry(
  radius: number,
  transform: { a: number; b: number; c: number; d: number }
): CircleOrEllipseGeometry {
  const transformed = transformEllipseGeometry(radius, radius, 0, transform);
  const tolerance = Math.max(transformed.rx, transformed.ry) * 1e-6;
  if (Math.abs(transformed.rx - transformed.ry) <= tolerance) {
    return { kind: "circle", radius: (transformed.rx + transformed.ry) / 2 };
  }
  return { kind: "ellipse", ...transformed };
}

function transformEllipseGeometry(
  rx: number,
  ry: number,
  rotation: number,
  transform: { a: number; b: number; c: number; d: number }
): EllipseGeometry {
  const theta = (rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);

  const axisX = { x: rx * cos, y: rx * sin };
  const axisY = { x: -ry * sin, y: ry * cos };
  const transformedAxisX = applyMatrixToVector(transform, axisX);
  const transformedAxisY = applyMatrixToVector(transform, axisY);

  const s11 = transformedAxisX.x * transformedAxisX.x + transformedAxisY.x * transformedAxisY.x;
  const s12 = transformedAxisX.x * transformedAxisX.y + transformedAxisY.x * transformedAxisY.y;
  const s22 = transformedAxisX.y * transformedAxisX.y + transformedAxisY.y * transformedAxisY.y;

  const traceHalf = (s11 + s22) / 2;
  const discriminant = Math.sqrt(Math.max(0, traceHalf * traceHalf - (s11 * s22 - s12 * s12)));
  const lambda1 = Math.max(0, traceHalf + discriminant);
  const lambda2 = Math.max(0, traceHalf - discriminant);
  const major = Math.sqrt(lambda1);
  const minor = Math.sqrt(lambda2);

  if (!Number.isFinite(major) || !Number.isFinite(minor) || major <= 1e-9 || minor <= 1e-9) {
    return { rx, ry, rotation };
  }

  const rotationRadians = Math.abs(lambda1 - lambda2) <= 1e-9 ? 0 : 0.5 * Math.atan2(2 * s12, s11 - s22);
  return {
    rx: major,
    ry: minor,
    rotation: normalizeDegrees((rotationRadians * 180) / Math.PI)
  };
}

function normalizeDegrees(degrees: number): number {
  let normalized = degrees % 360;
  if (normalized <= -180) {
    normalized += 360;
  } else if (normalized > 180) {
    normalized -= 360;
  }
  return Math.abs(normalized) <= 1e-9 ? 0 : normalized;
}

function inferSegmentEndHeadingDegrees(segment: PlacementSegment | null): number {
  if (!segment) {
    return 0;
  }

  let direction: Point | null = null;
  if (segment.kind === "line") {
    direction = {
      x: segment.to.x - segment.from.x,
      y: segment.to.y - segment.from.y
    };
  } else if (segment.kind === "hv") {
    direction = {
      x: segment.to.x - segment.bend.x,
      y: segment.to.y - segment.bend.y
    };
  } else if (segment.kind === "cubic") {
    direction = {
      x: segment.to.x - segment.c2.x,
      y: segment.to.y - segment.c2.y
    };
    if (Math.hypot(direction.x, direction.y) <= 1e-9) {
      direction = {
        x: segment.to.x - segment.from.x,
        y: segment.to.y - segment.from.y
      };
    }
  } else if (segment.kind === "arc") {
    direction = {
      x: segment.to.x - segment.from.x,
      y: segment.to.y - segment.from.y
    };
  }

  if (!direction || Math.hypot(direction.x, direction.y) <= 1e-9) {
    return 0;
  }
  return (Math.atan2(direction.y, direction.x) * 180) / Math.PI;
}

function evaluateTurnCoordinate(
  item: CoordinateItem,
  currentPoint: Point | null,
  transform: { a: number; b: number; c: number; d: number },
  lastPlacementSegment: PlacementSegment | null
): { point: Point | null; diagnostics: string[]; advancesCurrentPoint: boolean } | null {
  const hasTurnOption = item.options?.entries.some(
    (entry) =>
      (entry.kind === "flag" && entry.key === "turn") ||
      (entry.kind === "kv" && entry.key === "turn")
  );
  if (!hasTurnOption) {
    return null;
  }

  if (item.form !== "polar") {
    return {
      point: null,
      diagnostics: [`invalid-turn-coordinate:${item.raw}`],
      advancesCurrentPoint: true
    };
  }

  if (!currentPoint) {
    return {
      point: null,
      diagnostics: ["turn-coordinate-without-current-point"],
      advancesCurrentPoint: true
    };
  }

  const angleQuantity = parseQuantityExpression(item.x.trim());
  const radius = parseLength(item.y, "cm");
  if (!angleQuantity || angleQuantity.kind !== "scalar" || radius == null) {
    return {
      point: null,
      diagnostics: [`invalid-polar-coordinate:${item.raw}`],
      advancesCurrentPoint: true
    };
  }

  const heading = inferSegmentEndHeadingDegrees(lastPlacementSegment);
  const absoluteAngle = heading + angleQuantity.value;
  const radians = (absoluteAngle * Math.PI) / 180;
  const localVector = {
    x: radius * Math.cos(radians),
    y: radius * Math.sin(radians)
  };
  const delta = applyMatrixToVector(transform, localVector);

  return {
    point: {
      x: currentPoint.x + delta.x,
      y: currentPoint.y + delta.y
    },
    diagnostics: [],
    advancesCurrentPoint: true
  };
}

function resolveDefaultGridStep(transform: { a: number; b: number; c: number; d: number }, axis: "x" | "y"): number {
  const oneCoordinateUnit = parseLength("1", "cm") ?? DEFAULT_GRID_STEP;
  const vector =
    axis === "x"
      ? applyMatrixToVector(transform, { x: oneCoordinateUnit, y: 0 })
      : applyMatrixToVector(transform, { x: 0, y: oneCoordinateUnit });
  const magnitude = Math.hypot(vector.x, vector.y);
  return Number.isFinite(magnitude) && magnitude > 1e-9 ? magnitude : DEFAULT_GRID_STEP;
}

export function evaluatePathStatement(
  statement: PathStatement,
  context: SemanticContext,
  style: ResolvedStyle,
  markFeature: FeatureMarkFn,
  pushDiagnostic: DiagnosticPushFn
): SceneElement[] {
  const geometryElements: SceneElement[] = [];
  const behindNodeElements: SceneElement[] = [];
  const frontNodeElements: SceneElement[] = [];
  let activePath: ScenePath | null = null;
  let currentOperator: "--" | "-|" | "|-" | null = null;
  let activeRoundedCorners = style.roundedCorners;
  let pendingRectangleFrom: Point | null = null;
  let pendingCircleCenter: Point | null = null;
  let pendingCircleRadius: number | null = null;
  let pendingCircleRadii: { rx: number; ry: number } | null = null;
  let pendingCircleRotation = 0;
  let pendingEllipseCenter: Point | null = null;
  let pendingEllipseRadii: { rx: number; ry: number } | null = null;
  let pendingArc: { from: Point } | null = null;
  let pendingGrid: { from: Point; stepX: number; stepY: number } | null = null;
  let pendingNamedCoordinate: { name: string } | null = null;
  let pendingSegmentPlacements: Array<{ name: string; fraction: number }> = [];
  let pendingNodeNameForNodeCommand: string | null = null;
  let lastPlacementSegment: PlacementSegment | null = null;
  let previousSegmentRoundedCorners: number | null = null;
  let currentPointLogical: Point | null = context.currentPoint;
  let currentPointCoordinate: Pick<CoordinateItem, "form" | "x"> | null = null;
  let pendingEdgeStartCoordinateRaw: string | null = null;
  let edgeOperationStart: { point: Point; coordinateRaw: string | null } | null = null;
  let hasPathCurrentPoint = false;
  const frame = context.stack[context.stack.length - 1];
  const frameTransform = frame.transform;
  const pointsClose = (left: Point, right: Point): boolean => Math.hypot(left.x - right.x, left.y - right.y) <= 1e-6;
  const defaultPathOrigin = applyMatrix(frameTransform, { x: 0, y: 0 });
  const setCurrentPoint = (
    point: Point | null,
    logicalPoint: Point | null = point,
    coordinate: Pick<CoordinateItem, "form" | "x"> | null = null
  ): void => {
    context.currentPoint = point;
    if (!point) {
      currentPointLogical = null;
      currentPointCoordinate = null;
      return;
    }
    currentPointLogical = logicalPoint ?? point;
    currentPointCoordinate = coordinate;
    hasPathCurrentPoint = true;
  };
  const flushPendingSegmentPlacements = (segment: PlacementSegment | null): void => {
    if (!segment || pendingSegmentPlacements.length === 0) {
      return;
    }
    for (const pending of pendingSegmentPlacements) {
      const point = pointAtPlacementSegment(segment, pending.fraction);
      context.namedCoordinates.set(applyNameScope(pending.name, context), point);
    }
    pendingSegmentPlacements = [];
  };
  const hasFilledShadowLayer = style.shadowLayers.some(
    (layer) =>
      layer.style.shadeEnabled ||
      (layer.style.fill != null && layer.style.fill !== "none")
  );
  const shouldCompoundFilledSubpaths = style.shadeEnabled || (style.fill != null && style.fill !== "none") || hasFilledShadowLayer;
  const drawEdgeOptions = parseStyleValueAsOptionList("draw");
  const everyEdgeOptions = parseStyleValueAsOptionList("every edge");

  const emitCircleOrEllipse = (
    geometry: CircleOrEllipseGeometry,
    center: Point,
    itemId: string,
    span: { from: number; to: number }
  ): void => {
    if (geometry.kind === "circle") {
      markFeature("shape_circle", "supported");
      if (shouldCompoundFilledSubpaths) {
        activePath = ensurePathForSubpath(activePath, statement.id, itemId, style, span);
        appendCircleSubpath(activePath.commands, center, geometry.radius);
        markFeature("svg_path", "supported");
      } else {
        markFeature("svg_circle", "supported");
        geometryElements.push(makeCircleElement(statement.id, center, geometry.radius, style, span));
      }
      return;
    }

    markFeature("keyword_ellipse", "supported");
    if (shouldCompoundFilledSubpaths) {
      activePath = ensurePathForSubpath(activePath, statement.id, itemId, style, span);
      appendEllipseSubpath(activePath.commands, center, geometry.rx, geometry.ry, geometry.rotation);
      markFeature("svg_path", "supported");
      return;
    }
    geometryElements.push(makeEllipseElement(statement.id, center, geometry.rx, geometry.ry, style, span, geometry.rotation));
  };

  for (let index = 0; index < statement.items.length; index += 1) {
    const item = statement.items[index];
    if (item.kind !== "EdgeOperation" && item.kind !== "PathComment") {
      edgeOperationStart = null;
      pendingEdgeStartCoordinateRaw = null;
    }

    if (item.kind === "Coordinate") {
      if (statement.command === "node" && item.raw.trim() === "()") {
        continue;
      }

      if (pendingCircleCenter) {
        const radius = parseCircleRadiusFromCoordinateRaw(item.raw);
        if (radius != null) {
          emitCircleOrEllipse(transformCircleGeometry(radius, frameTransform), pendingCircleCenter, item.id, item.span);
          pendingCircleCenter = null;
          pendingCircleRadius = null;
          pendingCircleRadii = null;
          pendingCircleRotation = 0;
          continue;
        }

        const fallbackRadius = pendingCircleRadius ?? style.radius;
        if (fallbackRadius != null) {
          emitCircleOrEllipse(transformCircleGeometry(fallbackRadius, frameTransform), pendingCircleCenter, item.id, item.span);
        } else {
          const fallbackRadii = pendingCircleRadii ?? {
            rx: style.xRadius ?? DEFAULT_GRID_STEP,
            ry: style.yRadius ?? DEFAULT_GRID_STEP
          };
          emitCircleOrEllipse(
            { kind: "ellipse", ...transformEllipseGeometry(fallbackRadii.rx, fallbackRadii.ry, pendingCircleRotation, frameTransform) },
            pendingCircleCenter,
            item.id,
            item.span
          );
        }
        pendingCircleCenter = null;
        pendingCircleRadius = null;
        pendingCircleRadii = null;
        pendingCircleRotation = 0;
        lastPlacementSegment = null;
      }

      if (pendingEllipseCenter) {
        const parsedRadii = parseEllipseRadiiFromCoordinateRaw(item.raw);
        if (parsedRadii) {
          const geometry = transformEllipseGeometry(parsedRadii.rx, parsedRadii.ry, 0, frameTransform);
          markFeature("keyword_ellipse", "supported");
          if (shouldCompoundFilledSubpaths) {
            activePath = ensurePathForSubpath(activePath, statement.id, item.id, style, item.span);
            appendEllipseSubpath(activePath.commands, pendingEllipseCenter, geometry.rx, geometry.ry, geometry.rotation);
            markFeature("svg_path", "supported");
          } else {
            geometryElements.push(makeEllipseElement(statement.id, pendingEllipseCenter, geometry.rx, geometry.ry, style, item.span, geometry.rotation));
          }
          pendingEllipseCenter = null;
          pendingEllipseRadii = null;
          lastPlacementSegment = null;
          continue;
        }
      }

      if (pendingArc) {
        const shorthand = parseArcShorthand(item.raw);
        if (shorthand) {
          let path: ScenePath | null = activePath;
          if (!path) {
            path = makePath(statement.id, item.id, style, item.span);
            path.commands.push({ kind: "M", to: pendingArc.from });
          }
          const appended = appendArcCommand(path.commands, pendingArc.from, shorthand, frameTransform);
          activePath = path;
          setCurrentPoint(appended.endpoint);
          lastPlacementSegment = appended.segment;
          previousSegmentRoundedCorners = activeRoundedCorners;
          markFeature("keyword_arc", "supported");
          markFeature("svg_path", "supported");
          pendingArc = null;
          continue;
        }
      }

      if (
        statement.command === "node" &&
        item.form === "named" &&
        pendingNodeNameForNodeCommand == null &&
        shouldCaptureStandaloneNodeNameCoordinate(statement.items, index)
      ) {
        const rawName = item.x.trim();
        if (rawName.length > 0) {
          pendingNodeNameForNodeCommand = rawName;
          markFeature("named_coordinates", "supported");
          continue;
        }
      }

      const evaluated =
        evaluateTurnCoordinate(item, currentPointLogical ?? context.currentPoint, frameTransform, lastPlacementSegment) ??
        evaluateCoordinate(item, context);
      for (const code of evaluated.diagnostics) {
        pushDiagnostic(code, `Coordinate evaluation issue: ${code}`, item.span.from, item.span.to);
      }
      if (!evaluated.point) {
        continue;
      }

      if (pendingNamedCoordinate) {
        context.namedCoordinates.set(applyNameScope(pendingNamedCoordinate.name, context), evaluated.point);
        pendingNamedCoordinate = null;
      }

      if (pendingGrid) {
        markFeature("keyword_grid", "supported");
        markFeature("svg_path", "supported");
        geometryElements.push(
          ...makeGridElements(
            statement.id,
            item.id,
            pendingGrid.from,
            evaluated.point,
            pendingGrid.stepX,
            pendingGrid.stepY,
            style,
            item.span,
            frameTransform
          )
        );
        setCurrentPoint(evaluated.point, evaluated.point, {
          form: item.form,
          x: item.x
        });
        pendingGrid = null;
        continue;
      }

      if (pendingRectangleFrom) {
        markFeature("shape_rectangle", "supported");
        if (shouldCompoundFilledSubpaths) {
          activePath = ensurePathForSubpath(activePath, statement.id, item.id, style, item.span);
          appendRectangleSubpath(activePath.commands, pendingRectangleFrom, evaluated.point, activeRoundedCorners, frameTransform);
        } else {
          geometryElements.push(
            makeRectangleElement(
              statement.id,
              item.id,
              pendingRectangleFrom,
              evaluated.point,
              style,
              item.span,
              activeRoundedCorners,
              frameTransform
            )
          );
        }
        markFeature("svg_path", "supported");
        pendingRectangleFrom = null;
        setCurrentPoint(evaluated.point, evaluated.point, {
          form: item.form,
          x: item.x
        });
        if (!context.pathStartPoint) {
          context.pathStartPoint = evaluated.point;
        }
        continue;
      }

      const coordinateRef: Pick<CoordinateItem, "form" | "x"> = {
        form: item.form,
        x: item.x
      };
      const sourceLogicalPoint = currentPointLogical ?? context.currentPoint;
      const hasOperatorSegment = currentOperator != null && context.currentPoint != null && sourceLogicalPoint != null;
      const pathSourcePoint = hasOperatorSegment
        ? currentPointCoordinate
          ? maybeResolveNamedCoordinateBorderPoint(currentPointCoordinate, sourceLogicalPoint, evaluated.point, context)
          : sourceLogicalPoint
        : null;
      const pathTargetPoint = hasOperatorSegment
        ? maybeResolveNamedCoordinateBorderPoint(item, evaluated.point, sourceLogicalPoint, context)
        : evaluated.point;
      const advancedPoint = hasOperatorSegment ? pathTargetPoint : evaluated.point;
      if (!hasOperatorSegment && pendingSegmentPlacements.length > 0) {
        for (const pending of pendingSegmentPlacements) {
          context.namedCoordinates.set(applyNameScope(pending.name, context), evaluated.point);
        }
        pendingSegmentPlacements = [];
      }

      if (!activePath) {
        activePath = makePath(statement.id, item.id, style, statement.span);
        if (hasOperatorSegment && pathSourcePoint) {
          activePath.commands.push({ kind: "M", to: pathSourcePoint });
          const appended = appendPathPoint(
            activePath.commands,
            currentOperator,
            pathSourcePoint,
            pathTargetPoint,
            previousSegmentRoundedCorners,
            activeRoundedCorners
          );
          lastPlacementSegment = appended.segment;
          flushPendingSegmentPlacements(appended.segment);
          previousSegmentRoundedCorners = appended.nextRoundedCorners;
          context.pathStartPoint = pathSourcePoint;
        } else {
          activePath.commands.push({ kind: "M", to: pathTargetPoint });
          context.pathStartPoint = pathTargetPoint;
          lastPlacementSegment = null;
          previousSegmentRoundedCorners = null;
        }
        markFeature("svg_path", "supported");
      } else if (!currentOperator) {
        activePath.commands.push({ kind: "M", to: pathTargetPoint });
        context.pathStartPoint = pathTargetPoint;
        lastPlacementSegment = null;
        previousSegmentRoundedCorners = null;
      } else if (hasOperatorSegment && pathSourcePoint) {
        const lastCommand = activePath.commands[activePath.commands.length - 1];
        if (lastCommand?.kind === "M") {
          lastCommand.to = pathSourcePoint;
          context.pathStartPoint = pathSourcePoint;
        } else {
          const lastPoint =
            lastCommand?.kind === "L" || lastCommand?.kind === "C"
              ? lastCommand.to
              : null;
          if (!lastPoint || !pointsClose(lastPoint, pathSourcePoint)) {
            activePath.commands.push({ kind: "M", to: pathSourcePoint });
            context.pathStartPoint = pathSourcePoint;
          }
        }
        const appended = appendPathPoint(
          activePath.commands,
          currentOperator,
          pathSourcePoint,
          pathTargetPoint,
          previousSegmentRoundedCorners,
          activeRoundedCorners
        );
        lastPlacementSegment = appended.segment;
        flushPendingSegmentPlacements(appended.segment);
        previousSegmentRoundedCorners = appended.nextRoundedCorners;
      } else {
        activePath.commands.push({ kind: "M", to: pathTargetPoint });
        context.pathStartPoint = pathTargetPoint;
        lastPlacementSegment = null;
        previousSegmentRoundedCorners = null;
      }

      const shouldAdvancePoint = item.relativePrefix ? item.relativePrefix === "++" : true;
      if (shouldAdvancePoint) {
        setCurrentPoint(advancedPoint, evaluated.point, coordinateRef);
      } else if (context.currentPoint) {
        setCurrentPoint(context.currentPoint, advancedPoint, currentPointCoordinate);
      }
      if (!context.currentPoint) {
        setCurrentPoint(advancedPoint, evaluated.point, coordinateRef);
      }
      currentOperator = null;
      continue;
    }

    if (item.kind === "PathKeyword") {
      if (pendingCircleCenter) {
        const fallbackRadius = pendingCircleRadius ?? style.radius;
        if (fallbackRadius != null) {
          emitCircleOrEllipse(transformCircleGeometry(fallbackRadius, frameTransform), pendingCircleCenter, item.id, item.span);
        } else {
          const fallbackRadii = pendingCircleRadii ?? {
            rx: style.xRadius ?? DEFAULT_GRID_STEP,
            ry: style.yRadius ?? DEFAULT_GRID_STEP
          };
          emitCircleOrEllipse(
            { kind: "ellipse", ...transformEllipseGeometry(fallbackRadii.rx, fallbackRadii.ry, pendingCircleRotation, frameTransform) },
            pendingCircleCenter,
            item.id,
            item.span
          );
        }
        pendingCircleCenter = null;
        pendingCircleRadius = null;
        pendingCircleRadii = null;
        pendingCircleRotation = 0;
        lastPlacementSegment = null;
      }

      if (item.keyword === "--" || item.keyword === "-|" || item.keyword === "|-") {
        currentOperator = item.keyword;
        markFeature("path_operators_basic", "supported");
        continue;
      }

      if (item.keyword === "..") {
        const parsedCurve = parseBezierFromItems(statement.items, index, context);
        if (!parsedCurve) {
          markFeature("path_operator_curves", "unsupported");
          pushDiagnostic(
            "unsupported-path-operator",
            "Curve operator `..` currently supports only `.. controls (...) and (...) .. (...)` patterns.",
            item.span.from,
            item.span.to
          );
          continue;
        }

        if (!activePath) {
          if (!context.currentPoint) {
            markFeature("path_operator_curves", "unsupported");
            pushDiagnostic("curve-without-start", "Curve operator requires a current point.", item.span.from, item.span.to);
            index = parsedCurve.consumedIndex;
            continue;
          }
          activePath = makePath(statement.id, item.id, style, statement.span);
          activePath.commands.push({ kind: "M", to: context.currentPoint });
          context.pathStartPoint = context.pathStartPoint ?? context.currentPoint;
          markFeature("svg_path", "supported");
        }

        if (!parsedCurve.endPoint) {
          markFeature("path_operator_curves", "unsupported");
          pushDiagnostic("invalid-curve-target", "Failed to evaluate curve control or target point.", item.span.from, item.span.to);
          index = parsedCurve.consumedIndex;
          continue;
        }

        const curveFrom = context.currentPoint;
        activePath.commands.push({
          kind: "C",
          c1: parsedCurve.control1,
          c2: parsedCurve.control2,
          to: parsedCurve.endPoint
        });
        if (curveFrom) {
          lastPlacementSegment = {
            kind: "cubic",
            from: curveFrom,
            c1: parsedCurve.control1,
            c2: parsedCurve.control2,
            to: parsedCurve.endPoint
          };
        }
        previousSegmentRoundedCorners = activeRoundedCorners;
        markFeature("path_operator_curves", "supported");
        markFeature("keyword_controls", "supported");
        if (parsedCurve.usedAnd) {
          markFeature("keyword_and", "supported");
        }
        markFeature("svg_path", "supported");

        if (parsedCurve.endAdvancesCurrentPoint) {
          setCurrentPoint(parsedCurve.endPoint);
        }
        if (parsedCurve.endClosesPath) {
          activePath.commands.push({ kind: "Z" });
          if (hasDrawablePathSegments(activePath)) {
            geometryElements.push(activePath);
          }
          activePath = null;
          previousSegmentRoundedCorners = null;
          if (context.pathStartPoint) {
            setCurrentPoint(context.pathStartPoint);
          }
          lastPlacementSegment = null;
          markFeature("path_cycle", "supported");
        }
        currentOperator = null;
        index = parsedCurve.consumedIndex;
        continue;
      }

      if (item.keyword === "cycle") {
        if (activePath) {
          const logicalCurrentPoint = currentPointLogical ?? context.currentPoint;
          if (logicalCurrentPoint && context.pathStartPoint) {
            const closingFrom = logicalCurrentPoint;
            const pathStart = context.pathStartPoint;
            const operator: "--" | "-|" | "|-" = currentOperator ?? "--";
            const appended = appendPathPoint(
              activePath.commands,
              operator,
              closingFrom,
              pathStart,
              previousSegmentRoundedCorners,
              activeRoundedCorners
            );
            previousSegmentRoundedCorners = appended.nextRoundedCorners;
            setCurrentPoint(pathStart);
            roundClosedPathStartCorner(activePath.commands, closingFrom, pathStart, activeRoundedCorners);
          }
          activePath.commands.push({ kind: "Z" });
          if (hasDrawablePathSegments(activePath)) {
            geometryElements.push(activePath);
          }
          activePath = null;
          previousSegmentRoundedCorners = null;
          markFeature("path_cycle", "supported");
        }
        if (context.pathStartPoint) {
          setCurrentPoint(context.pathStartPoint);
        }
        lastPlacementSegment = null;
        currentOperator = null;
        continue;
      }

      if (item.keyword === "rectangle") {
        const rectangleStart = currentPointLogical ?? context.currentPoint ?? defaultPathOrigin;
        const effectiveRectangleStart = hasPathCurrentPoint ? rectangleStart : defaultPathOrigin;
        if (!context.currentPoint && !currentPointLogical) {
          setCurrentPoint(effectiveRectangleStart);
        }
        if (!shouldCompoundFilledSubpaths) {
          activePath = flushDrawableActivePath(geometryElements, activePath);
        }
        previousSegmentRoundedCorners = null;
        pendingRectangleFrom = effectiveRectangleStart;
        lastPlacementSegment = null;
        markFeature("shape_rectangle", "supported");
        continue;
      }

      if (item.keyword === "circle") {
        const circleCenter = currentPointLogical ?? context.currentPoint;
        if (!circleCenter) {
          pushDiagnostic("circle-without-center", "Circle operator requires a current point.", item.span.from, item.span.to);
          continue;
        }
        if (!shouldCompoundFilledSubpaths) {
          activePath = flushDrawableActivePath(geometryElements, activePath);
        }
        previousSegmentRoundedCorners = null;
        pendingCircleCenter = circleCenter;
        pendingCircleRadius = null;
        pendingCircleRadii = null;
        pendingCircleRotation = 0;
        lastPlacementSegment = null;
        markFeature("shape_circle", "supported");
        continue;
      }

      if (item.keyword === "ellipse") {
        const ellipseCenter = currentPointLogical ?? context.currentPoint;
        if (!ellipseCenter) {
          pushDiagnostic("ellipse-without-center", "Ellipse keyword requires a current point.", item.span.from, item.span.to);
          continue;
        }
        if (!shouldCompoundFilledSubpaths) {
          activePath = flushDrawableActivePath(geometryElements, activePath);
        }
        previousSegmentRoundedCorners = null;
        pendingEllipseCenter = ellipseCenter;
        pendingEllipseRadii = null;
        lastPlacementSegment = null;
        markFeature("keyword_ellipse", "supported");
        continue;
      }

      if (item.keyword === "arc") {
        const arcStart = currentPointLogical ?? context.currentPoint;
        if (!arcStart) {
          pushDiagnostic("arc-without-start", "Arc keyword requires a current point.", item.span.from, item.span.to);
          continue;
        }
        pendingArc = { from: arcStart };
        lastPlacementSegment = null;
        markFeature("keyword_arc", "supported");
        continue;
      }

      if (item.keyword === "grid") {
        const gridStart = currentPointLogical ?? context.currentPoint ?? defaultPathOrigin;
        const effectiveGridStart = hasPathCurrentPoint ? gridStart : defaultPathOrigin;
        if (!context.currentPoint && !currentPointLogical) {
          setCurrentPoint(effectiveGridStart);
        }
        activePath = flushDrawableActivePath(geometryElements, activePath);
        previousSegmentRoundedCorners = null;
        pendingGrid = {
          from: effectiveGridStart,
          stepX: resolveDefaultGridStep(frameTransform, "x"),
          stepY: resolveDefaultGridStep(frameTransform, "y")
        };
        lastPlacementSegment = null;
        continue;
      }

      if (item.keyword === "parabola") {
        if (!context.currentPoint) {
          pushDiagnostic("parabola-without-start", "Parabola keyword requires a current point.", item.span.from, item.span.to);
          continue;
        }

        const parsed = parseParabolaFromItems(statement.items, index, context);
        if (!parsed) {
          pushDiagnostic("invalid-parabola", "Parabola requires a target coordinate or `cycle`.", item.span.from, item.span.to);
          continue;
        }

        if (!activePath) {
          activePath = makePath(statement.id, item.id, style, statement.span);
          activePath.commands.push({ kind: "M", to: context.currentPoint });
          context.pathStartPoint = context.pathStartPoint ?? context.currentPoint;
          markFeature("svg_path", "supported");
        }

        for (const command of parsed.commands) {
          activePath.commands.push(command);
        }
        previousSegmentRoundedCorners = activeRoundedCorners;
        const lastCommand = parsed.commands[parsed.commands.length - 1];
        if (lastCommand?.kind === "C") {
          const previousCommand = parsed.commands.length > 1 ? parsed.commands[parsed.commands.length - 2] : null;
          const from = previousCommand?.kind === "C" ? previousCommand.to : context.currentPoint;
          if (from) {
            lastPlacementSegment = {
              kind: "cubic",
              from,
              c1: lastCommand.c1,
              c2: lastCommand.c2,
              to: lastCommand.to
            };
          }
        }
        setCurrentPoint(parsed.endPoint);
        markFeature("svg_path", "supported");
        index = parsed.consumedIndex;
        currentOperator = null;
        continue;
      }

      if (item.keyword === "sin" || item.keyword === "cos") {
        if (!context.currentPoint) {
          pushDiagnostic(`${item.keyword}-without-start`, `\`${item.keyword}\` requires a current point.`, item.span.from, item.span.to);
          continue;
        }

        const targetItem = statement.items[index + 1];
        if (!targetItem || targetItem.kind !== "Coordinate") {
          pushDiagnostic(`invalid-${item.keyword}-target`, `\`${item.keyword}\` requires a following coordinate target.`, item.span.from, item.span.to);
          continue;
        }

        const evaluatedTarget = evaluateCoordinate(targetItem, context);
        for (const code of evaluatedTarget.diagnostics) {
          pushDiagnostic(code, `${item.keyword} target issue: ${code}`, targetItem.span.from, targetItem.span.to);
        }
        if (!evaluatedTarget.point) {
          index += 1;
          continue;
        }

        let path: ScenePath | null = activePath;
        if (!path) {
          path = makePath(statement.id, item.id, style, statement.span);
          path.commands.push({ kind: "M", to: context.currentPoint });
          context.pathStartPoint = context.pathStartPoint ?? context.currentPoint;
          markFeature("svg_path", "supported");
        }

        const from = context.currentPoint;
        const to = maybeResolveNamedCoordinateBorderPoint(targetItem, evaluatedTarget.point, from, context);
        const segment = appendSinCosSegment(path.commands, from, to, item.keyword);
        activePath = path;
        lastPlacementSegment = segment;
        previousSegmentRoundedCorners = activeRoundedCorners;
        markFeature("path_operator_curves", "supported");
        markFeature("svg_path", "supported");

        if (evaluatedTarget.advancesCurrentPoint) {
          setCurrentPoint(to, evaluatedTarget.point, {
            form: targetItem.form,
            x: targetItem.x
          });
        } else if (!context.currentPoint) {
          setCurrentPoint(to, evaluatedTarget.point, {
            form: targetItem.form,
            x: targetItem.x
          });
        }

        currentOperator = null;
        index += 1;
        continue;
      }

      if (item.keyword === "controls" || item.keyword === "and") {
        if (item.keyword === "controls") {
          markFeature("keyword_controls", "unsupported");
        } else {
          markFeature("keyword_and", "unsupported");
        }
        pushDiagnostic(
          "unsupported-path-keyword",
          `Path keyword \`${item.keyword}\` is parsed but not semantically implemented yet.`,
          item.span.from,
          item.span.to
        );
      }

      if (item.keyword === "edge") {
        markFeature("edge_operation", "unsupported");
        markFeature("keyword_edge", "unsupported");
        pushDiagnostic(
          "invalid-edge-operation",
          "`edge` operation requires a target coordinate.",
          item.span.from,
          item.span.to
        );
      }

      if (
        item.keyword === "plot" ||
        item.keyword === "bend"
      ) {
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
        const parsed = extractCircleShapeOptions(item);
        if (parsed.radius != null) {
          pendingCircleRadius = parsed.radius;
          pendingCircleRadii = null;
        } else if (parsed.rx != null && parsed.ry != null) {
          pendingCircleRadius = null;
          pendingCircleRadii = { rx: parsed.rx, ry: parsed.ry };
        }
        if (parsed.rotation != null) {
          pendingCircleRotation = parsed.rotation;
        }
      }

      if (pendingEllipseCenter) {
        pendingEllipseRadii = extractEllipseRadii(item, pushDiagnostic);
      }

      if (pendingArc) {
        const arcParams = extractArcParameters(item, pushDiagnostic, style);
        if (arcParams) {
          let path: ScenePath | null = activePath;
          if (!path) {
            path = makePath(statement.id, item.id, style, item.span);
            path.commands.push({ kind: "M", to: pendingArc.from });
          }
          const appended = appendArcCommand(path.commands, pendingArc.from, arcParams, frameTransform);
          activePath = path;
          setCurrentPoint(appended.endpoint);
          lastPlacementSegment = appended.segment;
          previousSegmentRoundedCorners = activeRoundedCorners;
          markFeature("keyword_arc", "supported");
          markFeature("svg_path", "supported");
          pendingArc = null;
        }
      }

      if (pendingGrid) {
        const parsed = extractGridSteps(item, pushDiagnostic, context);
        if (parsed) {
          if (parsed.stepX != null && parsed.stepX >= 0) {
            pendingGrid.stepX = parsed.stepX;
          }
          if (parsed.stepY != null && parsed.stepY >= 0) {
            pendingGrid.stepY = parsed.stepY;
          }
        }
      }

      const rounded = extractRoundedCorners(item.options, activeRoundedCorners);
      if (rounded !== undefined) {
        activeRoundedCorners = rounded;
      }
      continue;
    }

    if (item.kind === "Node") {
      const adornmentPlan = extractNodeAdornmentPlan(item.options, {
        quoteMode: frame.nodeQuotesMode,
        labelPosition: frame.labelPosition,
        pinPosition: frame.pinPosition,
        labelDistancePt: frame.labelDistancePt,
        pinDistancePt: frame.pinDistancePt,
        pinEdgeRaw: frame.pinEdgeRaw
      });
      const declaredNodeName = pendingNodeNameForNodeCommand ?? item.name ?? null;
      const trailingCoordinateRaw = maybeResolveTrailingCoordinateFromNodeName(item.name);
      const synthesizedMainNodeName =
        adornmentPlan.adornments.length > 0 && !declaredNodeName
          ? `adornment_main_${sanitizeGeneratedNodeName(statement.id)}_${index}`
          : null;
      const forcedMainNodeName = pendingNodeNameForNodeCommand ?? synthesizedMainNodeName ?? undefined;
      const nodeBase = trailingCoordinateRaw ? { ...item, name: undefined } : item;
      const nodeItem = {
        ...nodeBase,
        options: adornmentPlan.mainOptions,
        optionsSpan: adornmentPlan.mainOptions?.span
      };
      const resolvedNode = evaluateNodeItem(
        nodeItem,
        statement,
        context,
        style,
        markFeature,
        pushDiagnostic,
        lastPlacementSegment,
        forcedMainNodeName
      );
      pendingNodeNameForNodeCommand = null;
      pendingEdgeStartCoordinateRaw = declaredNodeName ? `(${declaredNodeName.trim()})` : null;
      behindNodeElements.push(...resolvedNode.behindElements);
      frontNodeElements.push(...resolvedNode.frontElements);

      const mainNodeNameRaw = forcedMainNodeName ?? declaredNodeName;
      if (mainNodeNameRaw) {
        for (let adornmentIndex = 0; adornmentIndex < adornmentPlan.adornments.length; adornmentIndex += 1) {
          const spec = adornmentPlan.adornments[adornmentIndex];
          const materialized = materializeNodeAdornment({
            spec,
            context,
            mainNodeNameRaw,
            ownerId: item.id,
            adornmentIndex
          });
          const resolvedAdornment = evaluateNodeItem(
            materialized.node,
            statement,
            context,
            style,
            markFeature,
            pushDiagnostic,
            null,
            materialized.node.name
          );
          behindNodeElements.push(...resolvedAdornment.behindElements);
          frontNodeElements.push(...resolvedAdornment.frontElements);

          if (spec.kind === "pin" && materialized.node.name && materialized.mainPoint) {
            const pinEdgeItem: EdgeOperationItem = {
              kind: "EdgeOperation",
              id: `${item.id}:pin-edge:${adornmentIndex}`,
              span: spec.span,
              optionsSpan: undefined,
              options: undefined,
              nodes: undefined,
              target: {
                kind: "coordinate",
                raw: `(${materialized.node.name})`
              },
              raw: `edge (${materialized.node.name})`
            };

            const pinEdgeOptionLists = [
              parseStyleValueAsOptionList("help lines"),
              materialized.pinEdgeOptions
            ].filter((list): list is NonNullable<typeof list> => list != null);
            const resolvedPinEdgeStyle = resolveContextDelta(
              style,
              frameTransform,
              pinEdgeOptionLists,
              frame.customStyles,
              (raw) => evaluateRawCoordinate(raw, context).point
            );
            for (const code of resolvedPinEdgeStyle.diagnostics) {
              pushDiagnostic(code, `Pin edge option issue: ${code}`, spec.span.from, spec.span.to);
            }

            const pinEdge = applyEdgeOperation(
              pinEdgeItem,
              context,
              statement,
              resolvedPinEdgeStyle.style,
              markFeature,
              pushDiagnostic,
              materialized.mainPoint,
              `(${materialized.mainNameRaw})`
            );
            if (pinEdge.activePath && hasDrawablePathSegments(pinEdge.activePath)) {
              frontNodeElements.push(...pinEdge.behindNodeElements);
              frontNodeElements.push(pinEdge.activePath);
              frontNodeElements.push(...pinEdge.frontNodeElements);
            } else {
              frontNodeElements.push(...pinEdge.behindNodeElements, ...pinEdge.frontNodeElements);
            }
          }
        }
      }

      if (trailingCoordinateRaw) {
        const trailingCoordinate = evaluateRawCoordinate(trailingCoordinateRaw, context);
        if (trailingCoordinate.point) {
          if (activePath) {
            activePath.commands.push({ kind: "M", to: trailingCoordinate.point });
          }
          setCurrentPoint(trailingCoordinate.point);
          context.pathStartPoint = trailingCoordinate.point;
          lastPlacementSegment = null;
          previousSegmentRoundedCorners = null;
        } else {
          for (const code of trailingCoordinate.diagnostics) {
            pushDiagnostic(code, `Node trailing coordinate issue: ${code}`, item.span.from, item.span.to);
          }
        }
      }
      continue;
    }

    if (item.kind === "CoordinateOperation") {
      const parsedName = item.name?.trim() || parseCoordinateOperation(item.raw)?.name;
      if (!parsedName) {
        pushDiagnostic("invalid-coordinate-operation", "Could not parse coordinate operation.", item.span.from, item.span.to);
        continue;
      }

      const nextItem = statement.items[index + 1];
      const nextCoordinate = statement.items[index + 2];
      if (nextItem?.kind === "PathKeyword" && nextItem.keyword === "at" && nextCoordinate?.kind === "Coordinate") {
        pendingNamedCoordinate = { name: parsedName };
      } else {
        const placementFraction = resolveNodePositionFraction(item.options);
        if (placementFraction != null && currentOperator) {
          pendingSegmentPlacements.push({ name: parsedName, fraction: placementFraction });
          markFeature("named_coordinates", "supported");
          continue;
        }

        const capturePoint =
          placementFraction != null && lastPlacementSegment
            ? pointAtPlacementSegment(lastPlacementSegment, placementFraction)
            : currentPointLogical ?? context.currentPoint;
        if (capturePoint) {
          context.namedCoordinates.set(applyNameScope(parsedName, context), capturePoint);
        } else {
          pushDiagnostic(
            "invalid-coordinate-operation",
            "Coordinate operation requires `at (...)` or an existing current point.",
            item.span.from,
            item.span.to
          );
        }
      }
      markFeature("named_coordinates", "supported");
      continue;
    }

    if (item.kind === "ToOperation") {
      const toPlan = extractToLikeOptionPlan(item);
      const toItem: ToOperationItem =
        toPlan.generatedNodes.length > 0
          ? {
              ...toPlan.item,
              nodes: [...(toPlan.item.nodes ?? []), ...toPlan.generatedNodes]
            }
          : toPlan.item;
      const handled = applyToOperation(
        toItem,
        context,
        statement,
        style,
        activePath,
        previousSegmentRoundedCorners,
        markFeature,
        pushDiagnostic
      );
      activePath = handled.activePath;
      if (handled.segment) {
        lastPlacementSegment = handled.segment;
      }
      behindNodeElements.push(...handled.behindNodeElements);
      frontNodeElements.push(...handled.frontNodeElements);
      if (handled.previousSegmentRoundedCorners !== undefined) {
        previousSegmentRoundedCorners = handled.previousSegmentRoundedCorners;
      }
      setCurrentPoint(context.currentPoint);
      continue;
    }

    if (item.kind === "EdgeOperation") {
      const edgePlan = extractToLikeOptionPlan(item);
      const edgeItem: EdgeOperationItem =
        edgePlan.generatedNodes.length > 0
          ? {
              ...edgePlan.item,
              nodes: [...(edgePlan.item.nodes ?? []), ...edgePlan.generatedNodes]
            }
          : edgePlan.item;
      if (!edgeOperationStart) {
        let coordinateRaw = pendingEdgeStartCoordinateRaw;
        if (!coordinateRaw && currentPointCoordinate) {
          const namedCoordinate = currentPointCoordinate as { form: string; x: string };
          if (namedCoordinate.form === "named") {
            coordinateRaw = `(${namedCoordinate.x.trim()})`;
          }
        }
        let startPoint = context.currentPoint;
        if (!startPoint && coordinateRaw) {
          const resolvedStart = evaluateRawCoordinate(coordinateRaw, context);
          for (const code of resolvedStart.diagnostics) {
            pushDiagnostic(code, `Edge start issue: ${code}`, item.span.from, item.span.to);
          }
          if (resolvedStart.point) {
            startPoint = resolvedStart.point;
          }
        }
        if (!startPoint) {
          pushDiagnostic("edge-without-start", "`edge` operation requires a current point.", item.span.from, item.span.to);
          continue;
        }
        edgeOperationStart = {
          point: startPoint,
          coordinateRaw
        };
      }

      const edgeOptionLists = [
        everyEdgeOptions,
        drawEdgeOptions,
        edgeItem.options
      ].filter((list): list is NonNullable<typeof list> => list != null);
      const resolvedEdgeStyle = resolveContextDelta(
        style,
        frameTransform,
        edgeOptionLists,
        frame.customStyles,
        (raw) => evaluateRawCoordinate(raw, context).point
      );
      for (const code of resolvedEdgeStyle.diagnostics) {
        if (code === "unsupported-option-flag:every edge") {
          continue;
        }
        pushDiagnostic(code, `Edge option issue: ${code}`, item.span.from, item.span.to);
      }

      const handled = applyEdgeOperation(
        edgeItem,
        context,
        statement,
        resolvedEdgeStyle.style,
        markFeature,
        pushDiagnostic,
        edgeOperationStart.point,
        edgeOperationStart.coordinateRaw
      );
      if (handled.activePath && hasDrawablePathSegments(handled.activePath)) {
        frontNodeElements.push(...handled.behindNodeElements);
        frontNodeElements.push(handled.activePath);
        frontNodeElements.push(...handled.frontNodeElements);
      } else {
        frontNodeElements.push(...handled.behindNodeElements, ...handled.frontNodeElements);
      }
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
    const fallbackRadius = pendingCircleRadius ?? style.radius;
    if (fallbackRadius != null) {
      emitCircleOrEllipse(transformCircleGeometry(fallbackRadius, frameTransform), pendingCircleCenter, statement.id, statement.span);
    } else {
      const fallbackRadii = pendingCircleRadii ?? {
        rx: style.xRadius ?? DEFAULT_GRID_STEP,
        ry: style.yRadius ?? DEFAULT_GRID_STEP
      };
      emitCircleOrEllipse(
        { kind: "ellipse", ...transformEllipseGeometry(fallbackRadii.rx, fallbackRadii.ry, pendingCircleRotation, frameTransform) },
        pendingCircleCenter,
        statement.id,
        statement.span
      );
    }
    lastPlacementSegment = null;
  }

  if (pendingEllipseCenter) {
    const radii = pendingEllipseRadii ?? {
      rx: DEFAULT_GRID_STEP,
      ry: DEFAULT_GRID_STEP
    };
    const geometry = transformEllipseGeometry(radii.rx, radii.ry, 0, frameTransform);
    if (shouldCompoundFilledSubpaths) {
      activePath = ensurePathForSubpath(activePath, statement.id, statement.id, style, statement.span);
      appendEllipseSubpath(activePath.commands, pendingEllipseCenter, geometry.rx, geometry.ry, geometry.rotation);
      markFeature("svg_path", "supported");
    } else {
      geometryElements.push(makeEllipseElement(statement.id, pendingEllipseCenter, geometry.rx, geometry.ry, style, statement.span, geometry.rotation));
    }
    lastPlacementSegment = null;
  }

  if (pendingArc) {
    pushDiagnostic("invalid-arc-parameters", "Arc requires either option parameters or shorthand coordinates.", statement.span.from, statement.span.to);
  }

  if (activePath && hasDrawablePathSegments(activePath)) {
    geometryElements.push(activePath);
  }

  return [...behindNodeElements, ...geometryElements, ...frontNodeElements];
}

function sanitizeGeneratedNodeName(raw: string): string {
  const sanitized = raw.replace(/[^A-Za-z0-9_-]/g, "_");
  return sanitized.length > 0 ? sanitized : "node";
}

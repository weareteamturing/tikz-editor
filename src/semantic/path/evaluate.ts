import type { CoordinateForm, CoordinateItem, EdgeOperationItem, PathStatement, ToOperationItem } from "../../ast/types.js";
import { parseTikz } from "../../parser/index.js";
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
import type { EvaluatedCoordinate } from "../coords/evaluate.js";
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
import { applyMatrix, applyMatrixToVector, identityMatrix } from "../transform.js";
import { createEditHandle } from "../edit-handles.js";
import { parseStyleValueAsOptionList, resolveContextDelta } from "../style/resolve.js";
import type { StyleTraceLayerInput } from "../style-chain.js";
import { applyDecorationToPath } from "../decorations/index.js";

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
  transform: { a: number; b: number; c: number; d: number; e: number; f: number },
  lastPlacementSegment: PlacementSegment | null
): EvaluatedCoordinate | null {
  const hasTurnOption = item.options?.entries.some(
    (entry) =>
      (entry.kind === "flag" && entry.key === "turn") ||
      (entry.kind === "kv" && entry.key === "turn")
  );
  if (!hasTurnOption) {
    return null;
  }

  const polarForm: CoordinateForm = "polar";
  if (item.form !== "polar") {
    return {
      world: null,
      local: undefined,
      transform: identityMatrix(),
      coordinateForm: polarForm,
      diagnostics: [`invalid-turn-coordinate:${item.raw}`],
      advancesCurrentPoint: true
    };
  }

  if (!currentPoint) {
    return {
      world: null,
      local: undefined,
      transform: identityMatrix(),
      coordinateForm: polarForm,
      diagnostics: ["turn-coordinate-without-current-point"],
      advancesCurrentPoint: true
    };
  }

  const angleQuantity = parseQuantityExpression(item.x.trim());
  const radius = parseLength(item.y, "cm");
  if (!angleQuantity || angleQuantity.kind !== "scalar" || radius == null) {
    return {
      world: null,
      local: undefined,
      transform: identityMatrix(),
      coordinateForm: polarForm,
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
    world: {
      x: currentPoint.x + delta.x,
      y: currentPoint.y + delta.y
    },
    local: localVector,
    transform,
    coordinateForm: polarForm,
    relativePrefix: item.relativePrefix,
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
  let pendingPlot: { mark: string | null; expectsCoordinates: boolean } | null = null;
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
  const statementStyleChain = frame.styleChain;
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
  const resolvePlotMark = (options: { entries: Array<{ kind: string; key?: string; valueRaw?: string }> } | undefined): string | null => {
    if (!options) {
      return null;
    }
    for (const entry of options.entries) {
      if (entry.kind !== "kv" || entry.key !== "mark") {
        continue;
      }
      const raw = (entry.valueRaw ?? "").trim();
      if (raw.length === 0) {
        continue;
      }
      return raw;
    }
    return null;
  };
  const extractPlotCoordinateEntries = (rawGroup: string): Array<{ raw: string; relativePrefix?: "+" | "++" }> => {
    const trimmed = rawGroup.trim();
    const content =
      trimmed.startsWith("{") && trimmed.endsWith("}") && trimmed.length >= 2 ? trimmed.slice(1, -1).trim() : trimmed;
    const entries: Array<{ raw: string; relativePrefix?: "+" | "++" }> = [];
    let index = 0;

    while (index < content.length) {
      while (index < content.length && (/\s/.test(content[index]) || content[index] === ",")) {
        index += 1;
      }
      if (index >= content.length) {
        break;
      }

      let relativePrefix: "+" | "++" | undefined;
      if (content.startsWith("++", index)) {
        relativePrefix = "++";
        index += 2;
      } else if (content[index] === "+") {
        relativePrefix = "+";
        index += 1;
      }
      while (index < content.length && /\s/.test(content[index])) {
        index += 1;
      }

      if (content[index] !== "(") {
        index += 1;
        continue;
      }

      const coordinateStart = index;
      let depth = 0;
      while (index < content.length) {
        const char = content[index];
        if (char === "\\") {
          index += 2;
          continue;
        }
        if (char === "(") {
          depth += 1;
          index += 1;
          continue;
        }
        if (char === ")") {
          depth -= 1;
          index += 1;
          if (depth === 0) {
            const raw = content.slice(coordinateStart, index).trim();
            if (raw.length > 0) {
              entries.push({ raw, relativePrefix });
            }
            break;
          }
          continue;
        }
        index += 1;
      }
    }

    return entries;
  };
  const appendPlotXMarks = (commands: ScenePath["commands"], points: Point[]): void => {
    const halfSize = parseLength("1.5pt", "pt") ?? 1.5;
    for (const point of points) {
      commands.push({
        kind: "M",
        to: { x: point.x - halfSize, y: point.y - halfSize }
      });
      commands.push({
        kind: "L",
        to: { x: point.x + halfSize, y: point.y + halfSize }
      });
      commands.push({
        kind: "M",
        to: { x: point.x - halfSize, y: point.y + halfSize }
      });
      commands.push({
        kind: "L",
        to: { x: point.x + halfSize, y: point.y - halfSize }
      });
    }
  };

  const emitCircleOrEllipse = (
    geometry: CircleOrEllipseGeometry,
    center: Point,
    itemId: string,
    span: { from: number; to: number }
  ): void => {
      if (geometry.kind === "circle") {
        markFeature("shape_circle", "supported");
        if (shouldCompoundFilledSubpaths) {
        activePath = ensurePathForSubpath(activePath, statement.id, itemId, style, statementStyleChain, span);
          appendCircleSubpath(activePath.commands, center, geometry.radius);
          markFeature("svg_path", "supported");
        } else {
          markFeature("svg_circle", "supported");
          geometryElements.push(makeCircleElement(statement.id, center, geometry.radius, style, statementStyleChain, span));
        }
        return;
      }

    markFeature("keyword_ellipse", "supported");
    if (shouldCompoundFilledSubpaths) {
      activePath = ensurePathForSubpath(activePath, statement.id, itemId, style, statementStyleChain, span);
      appendEllipseSubpath(activePath.commands, center, geometry.rx, geometry.ry, geometry.rotation);
      markFeature("svg_path", "supported");
      return;
    }
    geometryElements.push(makeEllipseElement(statement.id, center, geometry.rx, geometry.ry, style, statementStyleChain, span, geometry.rotation));
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
            activePath = ensurePathForSubpath(activePath, statement.id, item.id, style, statementStyleChain, item.span);
            appendEllipseSubpath(activePath.commands, pendingEllipseCenter, geometry.rx, geometry.ry, geometry.rotation);
            markFeature("svg_path", "supported");
          } else {
            geometryElements.push(
              makeEllipseElement(statement.id, pendingEllipseCenter, geometry.rx, geometry.ry, style, statementStyleChain, item.span, geometry.rotation)
            );
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
            path = makePath(statement.id, item.id, style, statementStyleChain, item.span);
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

      if (
        statement.command === "coordinate" &&
        item.form === "named" &&
        pendingNamedCoordinate == null &&
        shouldCaptureStandaloneNodeNameCoordinate(statement.items, index)
      ) {
        const rawName = item.x.trim();
        if (rawName.length > 0) {
          let nextMeaningfulItem: PathStatement["items"][number] | null = null;
          for (let lookahead = index + 1; lookahead < statement.items.length; lookahead += 1) {
            const candidate = statement.items[lookahead];
            if (candidate?.kind === "PathComment") {
              continue;
            }
            nextMeaningfulItem = candidate ?? null;
            break;
          }

          const hasExplicitAtTarget = nextMeaningfulItem?.kind === "PathKeyword" && nextMeaningfulItem.keyword === "at";
          if (hasExplicitAtTarget) {
            pendingNamedCoordinate = { name: rawName };
          } else {
            const fallbackPoint = hasPathCurrentPoint ? (currentPointLogical ?? context.currentPoint ?? defaultPathOrigin) : defaultPathOrigin;
            context.namedCoordinates.set(applyNameScope(rawName, context), fallbackPoint);
            if (!context.currentPoint) {
              setCurrentPoint(fallbackPoint, fallbackPoint, {
                form: item.form,
                x: item.x
              });
            }
          }

          markFeature("named_coordinates", "supported");
          continue;
        }
      }

      const evaluated =
        evaluateTurnCoordinate(item, currentPointLogical ?? context.currentPoint, frameTransform, lastPlacementSegment) ??
        evaluateCoordinate(item, context);
      const handleKind = statement.command === "node" ? "node-position" : "path-point";
      const rewriteTargetHandleId =
        handleKind === "path-point" && evaluated.coordinateForm === "named"
          ? resolveNamedCoordinateRewriteHandleId(item.x, context)
          : undefined;
      const handle = createEditHandle(evaluated, item.span, statement.id, handleKind, context, {
        rewriteTargetHandleId
      });
      if (handle) context.editHandles.push(handle);
      for (const code of evaluated.diagnostics) {
        pushDiagnostic(code, `Coordinate evaluation issue: ${code}`, item.span.from, item.span.to);
      }
      if (!evaluated.world) {
        continue;
      }

      if (pendingNamedCoordinate) {
        const scopedName = applyNameScope(pendingNamedCoordinate.name, context);
        context.namedCoordinates.set(scopedName, evaluated.world);
        if (handle && handle.rewriteMode !== "unsupported" && !handle.rewriteTargetHandleId) {
          context.namedCoordinateRewriteHandles.set(scopedName, handle.id);
        }
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
            evaluated.world,
              pendingGrid.stepX,
              pendingGrid.stepY,
              style,
              statementStyleChain,
              item.span,
              frameTransform
            )
        );
        setCurrentPoint(evaluated.world, evaluated.world, {
          form: item.form,
          x: item.x
        });
        pendingGrid = null;
        continue;
      }

      if (pendingRectangleFrom) {
        markFeature("shape_rectangle", "supported");
        if (shouldCompoundFilledSubpaths) {
          activePath = ensurePathForSubpath(activePath, statement.id, item.id, style, statementStyleChain, item.span);
          appendRectangleSubpath(activePath.commands, pendingRectangleFrom, evaluated.world, activeRoundedCorners, frameTransform);
        } else {
          geometryElements.push(
            makeRectangleElement(
              statement.id,
              item.id,
                pendingRectangleFrom,
                evaluated.world,
                style,
                statementStyleChain,
                item.span,
                activeRoundedCorners,
                frameTransform
            )
          );
        }
        markFeature("svg_path", "supported");
        pendingRectangleFrom = null;
        setCurrentPoint(evaluated.world, evaluated.world, {
          form: item.form,
          x: item.x
        });
        if (!context.pathStartPoint) {
          context.pathStartPoint = evaluated.world;
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
          ? maybeResolveNamedCoordinateBorderPoint(currentPointCoordinate, sourceLogicalPoint, evaluated.world, context)
          : sourceLogicalPoint
        : null;
      const pathTargetPoint = hasOperatorSegment
        ? maybeResolveNamedCoordinateBorderPoint(item, evaluated.world, sourceLogicalPoint, context)
        : evaluated.world;
      const advancedPoint = hasOperatorSegment ? pathTargetPoint : evaluated.world;
      if (!hasOperatorSegment && pendingSegmentPlacements.length > 0) {
        for (const pending of pendingSegmentPlacements) {
          context.namedCoordinates.set(applyNameScope(pending.name, context), evaluated.world);
        }
        pendingSegmentPlacements = [];
      }

      if (!activePath) {
        activePath = makePath(statement.id, item.id, style, statementStyleChain, statement.span);
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
        setCurrentPoint(advancedPoint, evaluated.world, coordinateRef);
      } else if (context.currentPoint) {
        setCurrentPoint(context.currentPoint, advancedPoint, currentPointCoordinate);
      }
      if (!context.currentPoint) {
        setCurrentPoint(advancedPoint, evaluated.world, coordinateRef);
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
          activePath = makePath(statement.id, item.id, style, statementStyleChain, statement.span);
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
          if (shouldCompoundFilledSubpaths) {
            previousSegmentRoundedCorners = null;
          } else {
            if (hasDrawablePathSegments(activePath)) {
              geometryElements.push(activePath);
            }
            activePath = null;
            previousSegmentRoundedCorners = null;
          }
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
        const circleCenter = currentPointLogical ?? context.currentPoint ?? defaultPathOrigin;
        const effectiveCircleCenter = hasPathCurrentPoint ? circleCenter : defaultPathOrigin;
        if (!context.currentPoint && !currentPointLogical) {
          setCurrentPoint(effectiveCircleCenter);
        }
        if (!shouldCompoundFilledSubpaths) {
          activePath = flushDrawableActivePath(geometryElements, activePath);
        }
        previousSegmentRoundedCorners = null;
        pendingCircleCenter = effectiveCircleCenter;
        pendingCircleRadius = null;
        pendingCircleRadii = null;
        pendingCircleRotation = 0;
        lastPlacementSegment = null;
        markFeature("shape_circle", "supported");
        continue;
      }

      if (item.keyword === "ellipse") {
        const ellipseCenter = currentPointLogical ?? context.currentPoint ?? defaultPathOrigin;
        const effectiveEllipseCenter = hasPathCurrentPoint ? ellipseCenter : defaultPathOrigin;
        if (!context.currentPoint && !currentPointLogical) {
          setCurrentPoint(effectiveEllipseCenter);
        }
        if (!shouldCompoundFilledSubpaths) {
          activePath = flushDrawableActivePath(geometryElements, activePath);
        }
        previousSegmentRoundedCorners = null;
        pendingEllipseCenter = effectiveEllipseCenter;
        pendingEllipseRadii = null;
        lastPlacementSegment = null;
        markFeature("keyword_ellipse", "supported");
        continue;
      }

      if (item.keyword === "arc") {
        const arcStart = currentPointLogical ?? context.currentPoint ?? defaultPathOrigin;
        const effectiveArcStart = hasPathCurrentPoint ? arcStart : defaultPathOrigin;
        if (!context.currentPoint && !currentPointLogical) {
          setCurrentPoint(effectiveArcStart);
        }
        pendingArc = { from: effectiveArcStart };
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

      if (item.keyword === "plot") {
        activePath = flushDrawableActivePath(geometryElements, activePath);
        previousSegmentRoundedCorners = null;
        lastPlacementSegment = null;
        pendingPlot = { mark: null, expectsCoordinates: false };
        currentOperator = null;
        continue;
      }

      if (item.keyword === "coordinates") {
        if (pendingPlot) {
          pendingPlot.expectsCoordinates = true;
          continue;
        }
        pushDiagnostic(
          "unsupported-path-keyword",
          "Path keyword `coordinates` is currently implemented only after `plot`.",
          item.span.from,
          item.span.to
        );
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
          activePath = makePath(statement.id, item.id, style, statementStyleChain, statement.span);
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
        if (!evaluatedTarget.world) {
          index += 1;
          continue;
        }

        let path: ScenePath | null = activePath;
        if (!path) {
          path = makePath(statement.id, item.id, style, statementStyleChain, statement.span);
          path.commands.push({ kind: "M", to: context.currentPoint });
          context.pathStartPoint = context.pathStartPoint ?? context.currentPoint;
          markFeature("svg_path", "supported");
        }

        const from = context.currentPoint;
        const to = maybeResolveNamedCoordinateBorderPoint(targetItem, evaluatedTarget.world, from, context);
        const segment = appendSinCosSegment(path.commands, from, to, item.keyword);
        activePath = path;
        lastPlacementSegment = segment;
        previousSegmentRoundedCorners = activeRoundedCorners;
        markFeature("path_operator_curves", "supported");
        markFeature("svg_path", "supported");

        if (evaluatedTarget.advancesCurrentPoint) {
          setCurrentPoint(to, evaluatedTarget.world, {
            form: targetItem.form,
            x: targetItem.x
          });
        } else if (!context.currentPoint) {
          setCurrentPoint(to, evaluatedTarget.world, {
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

      if (item.keyword === "bend") {
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
            path = makePath(statement.id, item.id, style, statementStyleChain, item.span);
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

      if (pendingPlot) {
        const plotMark = resolvePlotMark(item.options);
        if (plotMark) {
          pendingPlot.mark = plotMark;
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
      const standaloneNodeDefaultTarget = statement.command === "node" && !hasPathCurrentPoint ? defaultPathOrigin : undefined;
      const resolvedNode = evaluateNodeItem(
        nodeItem,
        statement,
        context,
        style,
        markFeature,
        pushDiagnostic,
        lastPlacementSegment,
        forcedMainNodeName,
        undefined,
        standaloneNodeDefaultTarget,
        statementStyleChain
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
            materialized.node.name,
            undefined,
            undefined,
            statementStyleChain
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

            const pinEdgeOptionLayers: StyleTraceLayerInput[] = [];
            const helpLinesOptions = parseStyleValueAsOptionList("help lines");
            if (helpLinesOptions) {
              pinEdgeOptionLayers.push({
                kind: "command",
                sourceRef: {
                  sourceId: pinEdgeItem.id,
                  sourceSpan: spec.span,
                  sourceKind: "pin-edge-default",
                  label: "help lines"
                },
                rawOptions: [helpLinesOptions]
              });
            }
            if (materialized.pinEdgeOptions) {
              pinEdgeOptionLayers.push({
                kind: "command",
                sourceRef: {
                  sourceId: pinEdgeItem.id,
                  sourceSpan: materialized.pinEdgeOptions.span,
                  sourceKind: "pin-edge-options",
                  label: "pin edge"
                },
                rawOptions: [materialized.pinEdgeOptions]
              });
            }
            const resolvedPinEdgeStyle = resolveContextDelta(
              style,
              frameTransform,
              pinEdgeOptionLayers,
              frame.customStyles,
              (raw) => evaluateRawCoordinate(raw, context).world,
              statementStyleChain
            );
            for (const code of resolvedPinEdgeStyle.diagnostics) {
              pushDiagnostic(code, `Pin edge option issue: ${code}`, spec.span.from, spec.span.to);
            }

            const pinEdge = applyEdgeOperation(
              pinEdgeItem,
              context,
              statement,
              resolvedPinEdgeStyle.style,
              resolvedPinEdgeStyle.chain,
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
        if (trailingCoordinate.world) {
          if (activePath) {
            activePath.commands.push({ kind: "M", to: trailingCoordinate.world });
          }
          setCurrentPoint(trailingCoordinate.world);
          context.pathStartPoint = trailingCoordinate.world;
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

    if (item.kind === "DecorateOperation") {
      markFeature("decorate_operation", "supported");
      activePath = flushDrawableActivePath(geometryElements, activePath);
      previousSegmentRoundedCorners = null;
      pendingRectangleFrom = null;
      pendingCircleCenter = null;
      pendingCircleRadius = null;
      pendingCircleRadii = null;
      pendingCircleRotation = 0;
      pendingEllipseCenter = null;
      pendingEllipseRadii = null;
      pendingArc = null;
      pendingGrid = null;
      pendingPlot = null;

      const raw = item.subpathRaw.trim();
      const subpathBody = raw.startsWith("{") && raw.endsWith("}") ? raw.slice(1, -1) : raw;
      const parseResult = parseTikz(`\\begin{tikzpicture}\\path ${subpathBody};\\end{tikzpicture}`, { recover: true });
      for (const diagnostic of parseResult.diagnostics) {
        if (diagnostic.severity !== "error") {
          continue;
        }
        pushDiagnostic(
          diagnostic.code ?? "decorate-operation-parse-error",
          `Decorate operation parse issue: ${diagnostic.message}`,
          item.subpathSpan.from,
          item.subpathSpan.to
        );
      }

      // Guard against malformed decorate operations with no decorated subpath.
      // In that shape the parser may produce a self-referential decorate item that
      // would recurse indefinitely through evaluatePathStatement.
      const normalizedSubpathBody = subpathBody.trim();
      const hasSelfReferentialDecorate = parseResult.figure.body.some((candidate) => {
        if (candidate.kind !== "Path" || candidate.items.length !== 1) {
          return false;
        }
        const onlyItem = candidate.items[0];
        return onlyItem?.kind === "DecorateOperation" && onlyItem.subpathRaw.trim() === normalizedSubpathBody;
      });
      if (hasSelfReferentialDecorate) {
        pushDiagnostic(
          "invalid-decorate-operation",
          "Decorate operation requires a decorated subpath.",
          item.subpathSpan.from,
          item.subpathSpan.to
        );
        continue;
      }

      let operationStyle = style;
      let operationStyleChain = statementStyleChain;
      if (item.options) {
        const resolvedDecorateOptions = resolveContextDelta(
          style,
          frameTransform,
          [
            {
              kind: "command",
              sourceRef: {
                sourceId: item.id,
                sourceSpan: item.optionsSpan ?? item.span,
                sourceKind: "decorate-operation",
                label: "decorate"
              },
              rawOptions: [item.options]
            }
          ],
          frame.customStyles,
          (rawCoordinate) => evaluateRawCoordinate(rawCoordinate, context).world,
          statementStyleChain
        );
        operationStyle = {
          ...resolvedDecorateOptions.style,
          decoration: {
            ...resolvedDecorateOptions.style.decoration,
            enabled: true,
            params: { ...resolvedDecorateOptions.style.decoration.params }
          }
        };
        operationStyleChain = resolvedDecorateOptions.chain;
        for (const code of resolvedDecorateOptions.diagnostics) {
          pushDiagnostic(code, `Decorate option issue: ${code}`, item.span.from, item.span.to);
        }
      } else {
        operationStyle = {
          ...style,
          decoration: {
            ...style.decoration,
            enabled: true,
            params: { ...style.decoration.params }
          }
        };
      }

      for (const nestedStatement of parseResult.figure.body) {
        if (nestedStatement.kind !== "Path") {
          continue;
        }
        const nestedElements = evaluatePathStatement(nestedStatement, context, operationStyle, markFeature, pushDiagnostic);
        geometryElements.push(...nestedElements);
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

    if (item.kind === "UnknownPathItem") {
      if (pendingPlot?.expectsCoordinates) {
        const coordinateEntries = extractPlotCoordinateEntries(item.raw);
        if (coordinateEntries.length === 0) {
          pushDiagnostic(
            "invalid-plot-coordinates",
            "Plot coordinates require at least one coordinate entry.",
            item.span.from,
            item.span.to
          );
          pendingPlot = null;
          continue;
        }

        const savedCurrentPoint = context.currentPoint;
        let iterationCurrentPoint = context.currentPoint;
        const points: Point[] = [];
        const plotMark = pendingPlot.mark;
        for (const entry of coordinateEntries) {
          context.currentPoint = iterationCurrentPoint;
          const evaluated = evaluateRawCoordinate(entry.raw, context, entry.relativePrefix);
          for (const code of evaluated.diagnostics) {
            pushDiagnostic(code, `Plot coordinate issue: ${code}`, item.span.from, item.span.to);
          }
          if (!evaluated.world) {
            continue;
          }

          points.push(evaluated.world);
          if (evaluated.advancesCurrentPoint || iterationCurrentPoint == null) {
            iterationCurrentPoint = evaluated.world;
          }
        }
        context.currentPoint = savedCurrentPoint;
        pendingPlot = null;

        if (points.length === 0) {
          continue;
        }

        activePath = flushDrawableActivePath(geometryElements, activePath);

        if (points.length >= 2) {
          const plotPath = makePath(statement.id, item.id, style, statementStyleChain, item.span);
          plotPath.commands.push({ kind: "M", to: points[0] });
          for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
            plotPath.commands.push({ kind: "L", to: points[pointIndex] });
          }
          geometryElements.push(plotPath);
          markFeature("svg_path", "supported");
          lastPlacementSegment = {
            kind: "line",
            from: points[points.length - 2],
            to: points[points.length - 1]
          };
          previousSegmentRoundedCorners = activeRoundedCorners;
        } else {
          lastPlacementSegment = null;
          previousSegmentRoundedCorners = null;
        }

        if ((plotMark ?? "").trim().toLowerCase() === "x") {
          const markerPathStyle: ResolvedStyle = {
            ...style,
            fill: "none"
          };
          const markerPath = makePath(statement.id, `${item.id}:mark`, markerPathStyle, statementStyleChain, item.span);
          appendPlotXMarks(markerPath.commands, points);
          if (hasDrawablePathSegments(markerPath)) {
            geometryElements.push(markerPath);
            markFeature("svg_path", "supported");
          }
        }

        const finalPoint = points[points.length - 1];
        setCurrentPoint(finalPoint);
        context.pathStartPoint = points[0];
        currentOperator = null;
      }
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
      let toStartCoordinateRaw: string | null = null;
      if (currentPointCoordinate) {
        const namedCoordinate = currentPointCoordinate as { form: string; x: string };
        if (namedCoordinate.form === "named") {
          toStartCoordinateRaw = `(${namedCoordinate.x.trim()})`;
        }
      }
      const handled = applyToOperation(
        toItem,
        context,
        statement,
        style,
        statementStyleChain,
        activePath,
        previousSegmentRoundedCorners,
        markFeature,
        pushDiagnostic,
        toStartCoordinateRaw
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
          if (resolvedStart.world) {
            startPoint = resolvedStart.world;
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

      const edgeOptionLayers: StyleTraceLayerInput[] = [];
      if (everyEdgeOptions) {
        edgeOptionLayers.push({
          kind: "command",
          sourceRef: {
            sourceId: edgeItem.id,
            sourceSpan: item.span,
            sourceKind: "edge-default",
            label: "every edge"
          },
          rawOptions: [everyEdgeOptions]
        });
      }
      if (drawEdgeOptions) {
        edgeOptionLayers.push({
          kind: "command",
          sourceRef: {
            sourceId: edgeItem.id,
            sourceSpan: item.span,
            sourceKind: "edge-default",
            label: "draw"
          },
          rawOptions: [drawEdgeOptions]
        });
      }
      if (edgeItem.options) {
        edgeOptionLayers.push({
          kind: "command",
          sourceRef: {
            sourceId: edgeItem.id,
            sourceSpan: edgeItem.optionsSpan ?? item.span,
            sourceKind: "edge-options",
            label: "edge"
          },
          rawOptions: [edgeItem.options]
        });
      }
      const resolvedEdgeStyle = resolveContextDelta(
        style,
        frameTransform,
        edgeOptionLayers,
        frame.customStyles,
        (raw) => evaluateRawCoordinate(raw, context).world,
        statementStyleChain
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
        resolvedEdgeStyle.chain,
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
      activePath = ensurePathForSubpath(activePath, statement.id, statement.id, style, statementStyleChain, statement.span);
      appendEllipseSubpath(activePath.commands, pendingEllipseCenter, geometry.rx, geometry.ry, geometry.rotation);
      markFeature("svg_path", "supported");
    } else {
      geometryElements.push(
        makeEllipseElement(statement.id, pendingEllipseCenter, geometry.rx, geometry.ry, style, statementStyleChain, statement.span, geometry.rotation)
      );
    }
    lastPlacementSegment = null;
  }

  if (pendingArc) {
    pushDiagnostic("invalid-arc-parameters", "Arc requires either option parameters or shorthand coordinates.", statement.span.from, statement.span.to);
  }

  if (activePath && hasDrawablePathSegments(activePath)) {
    geometryElements.push(activePath);
  }

  const preActionElements: SceneElement[] = [];
  const postActionElements: SceneElement[] = [];
  for (const preAction of style.decorationPreActions) {
    markFeature("decorate_option", "supported");
    preActionElements.push(
      ...decoratePathElements(geometryElements, preAction, "collect", statement.id, markFeature, pushDiagnostic)
    );
  }
  for (const postAction of style.decorationPostActions) {
    markFeature("decorate_option", "supported");
    postActionElements.push(
      ...decoratePathElements(geometryElements, postAction, "collect", statement.id, markFeature, pushDiagnostic)
    );
  }

  let mainGeometry = geometryElements;
  if (style.decoration.enabled) {
    markFeature("decorate_option", "supported");
    mainGeometry = decoratePathElements(geometryElements, style.decoration, "replace", statement.id, markFeature, pushDiagnostic);
  }

  return [...preActionElements, ...behindNodeElements, ...mainGeometry, ...frontNodeElements, ...postActionElements];
}

function decoratePathElements(
  elements: SceneElement[],
  decoration: ResolvedStyle["decoration"],
  mode: "replace" | "collect",
  statementId: string,
  markFeature: FeatureMarkFn,
  pushDiagnostic: DiagnosticPushFn
): SceneElement[] {
  const output: SceneElement[] = [];
  const decorationName = canonicalDecorationName(decoration.name);
  if (decorationName) {
    markDecorationFeature(decorationName, "supported", markFeature);
  }

  for (const element of elements) {
    const path = toDecoratablePathElement(element);
    if (!path) {
      if (mode === "replace") {
        output.push(element);
      }
      continue;
    }

    const outcome = applyDecorationToPath(path, decoration, `${statementId}:${element.id}`);
    if (outcome.kind === "unsupported") {
      markDecorationFeature(outcome.name, "unsupported", markFeature);
      pushDiagnostic(
        `unsupported-decoration-name:${outcome.name}`,
        outcome.reason === "deferred"
          ? `Decoration \`${outcome.name}\` is parsed but deferred because it requires dynamic TeX code execution.`
          : `Decoration \`${outcome.name}\` is not implemented; keeping the undecorated path.`,
        path.sourceSpan.from,
        path.sourceSpan.to
      );
      if (mode === "replace") {
        output.push(element);
      } else {
        output.push(...outcome.paths);
      }
      continue;
    }

    output.push(...outcome.paths);
  }

  return output;
}

function toDecoratablePathElement(element: SceneElement): ScenePath | null {
  if (element.kind === "Path") {
    return element;
  }

  if (element.kind === "Circle") {
    const commands: ScenePath["commands"] = [];
    appendCircleSubpath(commands, element.center, element.radius);
    return {
      kind: "Path",
      id: `${element.id}:as-path`,
      sourceId: element.sourceId,
      sourceSpan: element.sourceSpan,
      origin: element.origin,
      style: cloneStyleForDecoration(element.style),
      styleChain: element.styleChain.map((entry) => ({ ...entry })),
      commands
    };
  }

  if (element.kind === "Ellipse") {
    const commands: ScenePath["commands"] = [];
    appendEllipseSubpath(commands, element.center, element.rx, element.ry, element.rotation ?? 0);
    return {
      kind: "Path",
      id: `${element.id}:as-path`,
      sourceId: element.sourceId,
      sourceSpan: element.sourceSpan,
      origin: element.origin,
      style: cloneStyleForDecoration(element.style),
      styleChain: element.styleChain.map((entry) => ({ ...entry })),
      commands
    };
  }

  return null;
}

function cloneStyleForDecoration(style: ResolvedStyle): ResolvedStyle {
  return {
    ...style,
    decoration: {
      ...style.decoration,
      params: { ...style.decoration.params }
    },
    decorationPreActions: style.decorationPreActions.map((entry) => ({
      ...entry,
      params: { ...entry.params }
    })),
    decorationPostActions: style.decorationPostActions.map((entry) => ({
      ...entry,
      params: { ...entry.params }
    })),
    shadowLayers: style.shadowLayers.map((layer) => ({
      ...layer,
      style: { ...layer.style }
    }))
  };
}

function canonicalDecorationName(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function markDecorationFeature(nameRaw: string, status: "supported" | "unsupported", markFeature: FeatureMarkFn): void {
  const name = canonicalDecorationName(nameRaw);
  if (!name || name === "none") {
    return;
  }

  if (
    name === "zigzag" ||
    name === "straight zigzag" ||
    name === "random steps" ||
    name === "saw" ||
    name === "bent" ||
    name === "bumps" ||
    name === "coil" ||
    name === "snake" ||
    name === "lineto" ||
    name === "curveto" ||
    name === "moveto"
  ) {
    markFeature("decoration_pathmorphing", status);
    return;
  }

  if (
    name === "ticks" ||
    name === "expanding waves" ||
    name === "waves" ||
    name === "border" ||
    name === "brace"
  ) {
    markFeature("decoration_pathreplacing", status);
    return;
  }

  if (name === "koch curve type 1" || name === "koch curve type 2" || name === "koch snowflake" || name === "cantor set") {
    markFeature("decoration_fractals", status);
    return;
  }

  if (name === "crosses" || name === "triangles") {
    markFeature("decoration_shape_marks", status);
    return;
  }

  if (name === "footprints") {
    markFeature("decoration_footprints", status);
    return;
  }

  if (name === "shape backgrounds") {
    markFeature("decoration_shape_backgrounds", status);
  }
}

function resolveNamedCoordinateRewriteHandleId(rawName: string, context: SemanticContext): string | undefined {
  const trimmed = rawName.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const scoped = applyNameScope(trimmed, context);
  const candidates = scoped === trimmed ? [trimmed] : [scoped, trimmed];
  for (const candidate of candidates) {
    const handleId = context.namedCoordinateRewriteHandles.get(candidate);
    if (handleId) {
      return handleId;
    }
  }
  return undefined;
}

function sanitizeGeneratedNodeName(raw: string): string {
  const sanitized = raw.replace(/[^A-Za-z0-9_-]/g, "_");
  return sanitized.length > 0 ? sanitized : "node";
}

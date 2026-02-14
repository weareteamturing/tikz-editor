import { splitAllAtTopLevel } from "../../domains/coordinates/parse.js";
import type { CoordinateItem, PathItem, PathOptionItem, PathStatement, ToOperationItem } from "../../ast/types.js";
import type { SemanticContext } from "../context.js";
import {
  applyNameScope,
  evaluateNodeItem,
  maybeResolveNamedCoordinateBorderPoint,
  maybeResolveNamedCoordinateBorderPointFromRaw,
  maybeResolveTrailingCoordinateFromNodeName,
  shouldCaptureStandaloneNodeNameCoordinate
} from "../nodes/evaluate.js";
import { evaluateCoordinate, evaluateRawCoordinate } from "../coords/evaluate.js";
import { parseCoordinateLike, parseLength } from "../coords/parse-length.js";
import type { ArcParameters, DiagnosticPushFn, FeatureMarkFn, PlacementSegment } from "./types.js";
import { applyMatrixToVector } from "../transform.js";
import type {
  Point,
  ResolvedStyle,
  SceneCircle,
  SceneElement,
  SceneEllipse,
  ScenePath,
  ScenePathCommand
} from "../types.js";

const DEFAULT_GRID_STEP = parseLength("1cm", "cm") ?? 28.4527559055;
const SIN_CONTROL_1_X = 0.326;
const SIN_CONTROL_1_Y = 0.512;
const SIN_CONTROL_2_X = 0.638;
const SIN_CONTROL_2_Y = 1;
const COS_CONTROL_1_X = 0.362;
const COS_CONTROL_1_Y = 0;
const COS_CONTROL_2_X = 0.674;
const COS_CONTROL_2_Y = 0.488;

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
  let pendingNodeNameForNodeCommand: string | null = null;
  let lastPlacementSegment: PlacementSegment | null = null;
  let previousSegmentRoundedCorners: number | null = null;
  const shouldCompoundFilledSubpaths = style.fill != null && style.fill !== "none";

  for (let index = 0; index < statement.items.length; index += 1) {
    const item = statement.items[index];

    if (item.kind === "Coordinate") {
      if (pendingCircleCenter) {
        const radius = parseCircleRadiusFromCoordinateRaw(item.raw);
        if (radius != null) {
          markFeature("shape_circle", "supported");
          if (shouldCompoundFilledSubpaths) {
            activePath = ensurePathForSubpath(activePath, statement.id, item.id, style, item.span);
            appendCircleSubpath(activePath.commands, pendingCircleCenter, radius);
            markFeature("svg_path", "supported");
          } else {
            markFeature("svg_circle", "supported");
            geometryElements.push(makeCircleElement(statement.id, pendingCircleCenter, radius, style, item.span));
          }
          pendingCircleCenter = null;
          pendingCircleRadius = null;
          pendingCircleRadii = null;
          pendingCircleRotation = 0;
          continue;
        }

        const fallbackRadius = pendingCircleRadius ?? style.radius;
        if (fallbackRadius != null) {
          markFeature("shape_circle", "supported");
          if (shouldCompoundFilledSubpaths) {
            activePath = ensurePathForSubpath(activePath, statement.id, item.id, style, item.span);
            appendCircleSubpath(activePath.commands, pendingCircleCenter, fallbackRadius);
            markFeature("svg_path", "supported");
          } else {
            markFeature("svg_circle", "supported");
            geometryElements.push(makeCircleElement(statement.id, pendingCircleCenter, fallbackRadius, style, item.span));
          }
        } else {
          const fallbackRadii = pendingCircleRadii ?? {
            rx: style.xRadius ?? DEFAULT_GRID_STEP,
            ry: style.yRadius ?? DEFAULT_GRID_STEP
          };
          markFeature("keyword_ellipse", "supported");
          if (shouldCompoundFilledSubpaths && Math.abs(pendingCircleRotation) <= 1e-6) {
            activePath = ensurePathForSubpath(activePath, statement.id, item.id, style, item.span);
            appendEllipseSubpath(activePath.commands, pendingCircleCenter, fallbackRadii.rx, fallbackRadii.ry, 0);
            markFeature("svg_path", "supported");
          } else {
            geometryElements.push(
              makeEllipseElement(statement.id, pendingCircleCenter, fallbackRadii.rx, fallbackRadii.ry, style, item.span, pendingCircleRotation)
            );
          }
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
          markFeature("keyword_ellipse", "supported");
          if (shouldCompoundFilledSubpaths) {
            activePath = ensurePathForSubpath(activePath, statement.id, item.id, style, item.span);
            appendEllipseSubpath(activePath.commands, pendingEllipseCenter, parsedRadii.rx, parsedRadii.ry, 0);
            markFeature("svg_path", "supported");
          } else {
            geometryElements.push(makeEllipseElement(statement.id, pendingEllipseCenter, parsedRadii.rx, parsedRadii.ry, style, item.span));
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
          const appended = appendArcCommand(path.commands, pendingArc.from, shorthand);
          activePath = path;
          context.currentPoint = appended.endpoint;
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

      const evaluated = evaluateCoordinate(item, context);
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
          ...makeGridElements(statement.id, item.id, pendingGrid.from, evaluated.point, pendingGrid.stepX, pendingGrid.stepY, style, item.span)
        );
        context.currentPoint = evaluated.point;
        pendingGrid = null;
        continue;
      }

      if (pendingRectangleFrom) {
        markFeature("shape_rectangle", "supported");
        if (shouldCompoundFilledSubpaths) {
          activePath = ensurePathForSubpath(activePath, statement.id, item.id, style, item.span);
          appendRectangleSubpath(activePath.commands, pendingRectangleFrom, evaluated.point);
        } else {
          geometryElements.push(makeRectangleElement(statement.id, item.id, pendingRectangleFrom, evaluated.point, style, item.span));
        }
        markFeature("svg_path", "supported");
        pendingRectangleFrom = null;
        context.currentPoint = evaluated.point;
        if (!context.pathStartPoint) {
          context.pathStartPoint = evaluated.point;
        }
        continue;
      }

      const pathTargetPoint = maybeResolveNamedCoordinateBorderPoint(item, evaluated.point, context.currentPoint, context);

      if (!activePath) {
        activePath = makePath(statement.id, item.id, style, statement.span);
        if (currentOperator && context.currentPoint) {
          activePath.commands.push({ kind: "M", to: context.currentPoint });
          const appended = appendPathPoint(
            activePath.commands,
            currentOperator,
            context.currentPoint,
            pathTargetPoint,
            previousSegmentRoundedCorners,
            activeRoundedCorners
          );
          lastPlacementSegment = appended.segment;
          previousSegmentRoundedCorners = appended.nextRoundedCorners;
          context.pathStartPoint = context.pathStartPoint ?? context.currentPoint;
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
      } else {
        const appended = appendPathPoint(
          activePath.commands,
          currentOperator,
          context.currentPoint,
          pathTargetPoint,
          previousSegmentRoundedCorners,
          activeRoundedCorners
        );
        lastPlacementSegment = appended.segment;
        previousSegmentRoundedCorners = appended.nextRoundedCorners;
      }

      const shouldAdvancePoint = item.relativePrefix ? item.relativePrefix === "++" : true;
      if (shouldAdvancePoint) {
        context.currentPoint = pathTargetPoint;
      }
      if (!context.currentPoint) {
        context.currentPoint = pathTargetPoint;
      }
      currentOperator = null;
      continue;
    }

    if (item.kind === "PathKeyword") {
      if (pendingCircleCenter) {
        const fallbackRadius = pendingCircleRadius ?? style.radius;
        if (fallbackRadius != null) {
          markFeature("shape_circle", "supported");
          if (shouldCompoundFilledSubpaths) {
            activePath = ensurePathForSubpath(activePath, statement.id, item.id, style, item.span);
            appendCircleSubpath(activePath.commands, pendingCircleCenter, fallbackRadius);
            markFeature("svg_path", "supported");
          } else {
            markFeature("svg_circle", "supported");
            geometryElements.push(makeCircleElement(statement.id, pendingCircleCenter, fallbackRadius, style, item.span));
          }
        } else {
          const fallbackRadii = pendingCircleRadii ?? {
            rx: style.xRadius ?? DEFAULT_GRID_STEP,
            ry: style.yRadius ?? DEFAULT_GRID_STEP
          };
          markFeature("keyword_ellipse", "supported");
          if (shouldCompoundFilledSubpaths && Math.abs(pendingCircleRotation) <= 1e-6) {
            activePath = ensurePathForSubpath(activePath, statement.id, item.id, style, item.span);
            appendEllipseSubpath(activePath.commands, pendingCircleCenter, fallbackRadii.rx, fallbackRadii.ry, 0);
            markFeature("svg_path", "supported");
          } else {
            geometryElements.push(
              makeEllipseElement(statement.id, pendingCircleCenter, fallbackRadii.rx, fallbackRadii.ry, style, item.span, pendingCircleRotation)
            );
          }
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
          context.currentPoint = parsedCurve.endPoint;
        }
        if (parsedCurve.endClosesPath) {
          activePath.commands.push({ kind: "Z" });
          if (hasDrawablePathSegments(activePath)) {
            geometryElements.push(activePath);
          }
          activePath = null;
          previousSegmentRoundedCorners = null;
          if (context.pathStartPoint) {
            context.currentPoint = context.pathStartPoint;
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
          if (context.currentPoint && context.pathStartPoint) {
            const closingFrom = context.currentPoint;
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
            context.currentPoint = pathStart;
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
          context.currentPoint = context.pathStartPoint;
        }
        lastPlacementSegment = null;
        currentOperator = null;
        continue;
      }

      if (item.keyword === "rectangle") {
        if (!context.currentPoint) {
          pushDiagnostic("rectangle-without-start", "Rectangle operator requires a current point.", item.span.from, item.span.to);
          continue;
        }
        if (!shouldCompoundFilledSubpaths) {
          activePath = flushDrawableActivePath(geometryElements, activePath);
        }
        previousSegmentRoundedCorners = null;
        pendingRectangleFrom = context.currentPoint;
        lastPlacementSegment = null;
        markFeature("shape_rectangle", "supported");
        continue;
      }

      if (item.keyword === "circle") {
        if (!context.currentPoint) {
          pushDiagnostic("circle-without-center", "Circle operator requires a current point.", item.span.from, item.span.to);
          continue;
        }
        if (!shouldCompoundFilledSubpaths) {
          activePath = flushDrawableActivePath(geometryElements, activePath);
        }
        previousSegmentRoundedCorners = null;
        pendingCircleCenter = context.currentPoint;
        pendingCircleRadius = null;
        pendingCircleRadii = null;
        pendingCircleRotation = 0;
        lastPlacementSegment = null;
        markFeature("shape_circle", "supported");
        continue;
      }

      if (item.keyword === "ellipse") {
        if (!context.currentPoint) {
          pushDiagnostic("ellipse-without-center", "Ellipse keyword requires a current point.", item.span.from, item.span.to);
          continue;
        }
        if (!shouldCompoundFilledSubpaths) {
          activePath = flushDrawableActivePath(geometryElements, activePath);
        }
        previousSegmentRoundedCorners = null;
        pendingEllipseCenter = context.currentPoint;
        pendingEllipseRadii = null;
        lastPlacementSegment = null;
        markFeature("keyword_ellipse", "supported");
        continue;
      }

      if (item.keyword === "arc") {
        if (!context.currentPoint) {
          pushDiagnostic("arc-without-start", "Arc keyword requires a current point.", item.span.from, item.span.to);
          continue;
        }
        pendingArc = { from: context.currentPoint };
        lastPlacementSegment = null;
        markFeature("keyword_arc", "supported");
        continue;
      }

      if (item.keyword === "grid") {
        if (!context.currentPoint) {
          pushDiagnostic("grid-without-start", "Grid keyword requires a current point.", item.span.from, item.span.to);
          continue;
        }
        activePath = flushDrawableActivePath(geometryElements, activePath);
        previousSegmentRoundedCorners = null;
        pendingGrid = {
          from: context.currentPoint,
          stepX: DEFAULT_GRID_STEP,
          stepY: DEFAULT_GRID_STEP
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
        context.currentPoint = parsed.endPoint;
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
          context.currentPoint = to;
        } else if (!context.currentPoint) {
          context.currentPoint = to;
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

      if (
        item.keyword === "plot" ||
        item.keyword === "edge" ||
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
          const appended = appendArcCommand(path.commands, pendingArc.from, arcParams);
          activePath = path;
          context.currentPoint = appended.endpoint;
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
      const trailingCoordinateRaw = maybeResolveTrailingCoordinateFromNodeName(item.name);
      const nodeItem = trailingCoordinateRaw ? { ...item, name: undefined } : item;
      const resolvedNode = evaluateNodeItem(
        nodeItem,
        statement,
        context,
        style,
        markFeature,
        pushDiagnostic,
        lastPlacementSegment,
        pendingNodeNameForNodeCommand ?? undefined
      );
      pendingNodeNameForNodeCommand = null;
      behindNodeElements.push(...resolvedNode.behindElements);
      frontNodeElements.push(...resolvedNode.frontElements);
      if (trailingCoordinateRaw) {
        const trailingCoordinate = evaluateRawCoordinate(trailingCoordinateRaw, context);
        if (trailingCoordinate.point) {
          if (activePath) {
            activePath.commands.push({ kind: "M", to: trailingCoordinate.point });
          }
          context.currentPoint = trailingCoordinate.point;
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
      } else if (context.currentPoint) {
        context.namedCoordinates.set(applyNameScope(parsedName, context), context.currentPoint);
      } else {
        pushDiagnostic(
          "invalid-coordinate-operation",
          "Coordinate operation requires `at (...)` or an existing current point.",
          item.span.from,
          item.span.to
        );
      }
      markFeature("named_coordinates", "supported");
      continue;
    }

    if (item.kind === "ToOperation") {
      const handled = applyToOperation(
        item,
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
      markFeature("shape_circle", "supported");
      if (shouldCompoundFilledSubpaths) {
        activePath = ensurePathForSubpath(activePath, statement.id, statement.id, style, statement.span);
        appendCircleSubpath(activePath.commands, pendingCircleCenter, fallbackRadius);
        markFeature("svg_path", "supported");
      } else {
        markFeature("svg_circle", "supported");
        geometryElements.push(makeCircleElement(statement.id, pendingCircleCenter, fallbackRadius, style, statement.span));
      }
    } else {
      const fallbackRadii = pendingCircleRadii ?? {
        rx: style.xRadius ?? DEFAULT_GRID_STEP,
        ry: style.yRadius ?? DEFAULT_GRID_STEP
      };
      markFeature("keyword_ellipse", "supported");
      if (shouldCompoundFilledSubpaths && Math.abs(pendingCircleRotation) <= 1e-6) {
        activePath = ensurePathForSubpath(activePath, statement.id, statement.id, style, statement.span);
        appendEllipseSubpath(activePath.commands, pendingCircleCenter, fallbackRadii.rx, fallbackRadii.ry, 0);
        markFeature("svg_path", "supported");
      } else {
        geometryElements.push(
          makeEllipseElement(statement.id, pendingCircleCenter, fallbackRadii.rx, fallbackRadii.ry, style, statement.span, pendingCircleRotation)
        );
      }
    }
    lastPlacementSegment = null;
  }

  if (pendingEllipseCenter) {
    const radii = pendingEllipseRadii ?? {
      rx: DEFAULT_GRID_STEP,
      ry: DEFAULT_GRID_STEP
    };
    if (shouldCompoundFilledSubpaths) {
      activePath = ensurePathForSubpath(activePath, statement.id, statement.id, style, statement.span);
      appendEllipseSubpath(activePath.commands, pendingEllipseCenter, radii.rx, radii.ry, 0);
      markFeature("svg_path", "supported");
    } else {
      geometryElements.push(makeEllipseElement(statement.id, pendingEllipseCenter, radii.rx, radii.ry, style, statement.span));
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

function ensurePathForSubpath(
  activePath: ScenePath | null,
  sourceId: string,
  itemId: string,
  style: ResolvedStyle,
  span: { from: number; to: number }
): ScenePath {
  if (activePath) {
    return activePath;
  }
  return makePath(sourceId, itemId, style, span);
}

function appendRectangleSubpath(commands: ScenePathCommand[], from: Point, to: Point): void {
  commands.push({ kind: "M", to: from });
  commands.push({ kind: "L", to: { x: to.x, y: from.y } });
  commands.push({ kind: "L", to });
  commands.push({ kind: "L", to: { x: from.x, y: to.y } });
  commands.push({ kind: "Z" });
}

function appendCircleSubpath(commands: ScenePathCommand[], center: Point, radius: number): void {
  appendEllipseSubpath(commands, center, radius, radius, 0);
}

function appendEllipseSubpath(commands: ScenePathCommand[], center: Point, rx: number, ry: number, rotation: number): void {
  const start = { x: center.x + rx, y: center.y };
  const opposite = { x: center.x - rx, y: center.y };

  commands.push({ kind: "M", to: start });
  commands.push({
    kind: "A",
    rx,
    ry,
    xAxisRotation: rotation,
    largeArc: false,
    sweep: true,
    to: opposite
  });
  commands.push({
    kind: "A",
    rx,
    ry,
    xAxisRotation: rotation,
    largeArc: false,
    sweep: true,
    to: start
  });
  commands.push({ kind: "Z" });
}

function appendPathPoint(
  commands: ScenePathCommand[],
  operator: "--" | "-|" | "|-" | null,
  current: Point | null,
  next: Point,
  previousSegmentRoundedCorners: number | null,
  currentSegmentRoundedCorners: number | null
): { segment: PlacementSegment | null; nextRoundedCorners: number | null } {
  if (!current) {
    commands.push({ kind: "L", to: next });
    return { segment: null, nextRoundedCorners: currentSegmentRoundedCorners };
  }

  if (!operator || operator === "--") {
    appendSingleLine(commands, current, next, previousSegmentRoundedCorners);
    return {
      segment: { kind: "line", from: current, to: next },
      nextRoundedCorners: currentSegmentRoundedCorners
    };
  }

  if (operator === "-|") {
    const bend = { x: next.x, y: current.y };
    appendSingleLine(commands, current, bend, previousSegmentRoundedCorners);
    appendSingleLine(commands, bend, next, currentSegmentRoundedCorners);
    return {
      segment: { kind: "hv", operator, from: current, bend, to: next },
      nextRoundedCorners: currentSegmentRoundedCorners
    };
  }

  if (operator === "|-") {
    const bend = { x: current.x, y: next.y };
    appendSingleLine(commands, current, bend, previousSegmentRoundedCorners);
    appendSingleLine(commands, bend, next, currentSegmentRoundedCorners);
    return {
      segment: { kind: "hv", operator, from: current, bend, to: next },
      nextRoundedCorners: currentSegmentRoundedCorners
    };
  }

  return { segment: null, nextRoundedCorners: currentSegmentRoundedCorners };
}

function appendSingleLine(commands: ScenePathCommand[], from: Point, to: Point, cornerRoundedCorners: number | null): void {
  if (!cornerRoundedCorners || cornerRoundedCorners <= 0) {
    commands.push({ kind: "L", to });
    return;
  }

  const previous = extractPreviousCorner(commands);
  if (!previous) {
    commands.push({ kind: "L", to });
    return;
  }

  const rounded = computeRoundedCorner(previous, from, to, cornerRoundedCorners);
  if (!rounded) {
    commands.push({ kind: "L", to });
    return;
  }

  const last = commands[commands.length - 1];
  if (last?.kind === "L") {
    last.to = rounded.entry;
  } else {
    commands.push({ kind: "L", to: rounded.entry });
  }
  commands.push({ kind: "C", c1: rounded.c1, c2: rounded.c2, to: rounded.exit });
  commands.push({ kind: "L", to });
}

function roundClosedPathStartCorner(
  commands: ScenePathCommand[],
  closingFrom: Point,
  start: Point,
  cornerRoundedCorners: number | null
): void {
  if (!cornerRoundedCorners || cornerRoundedCorners <= 0) {
    return;
  }

  const move = commands[0];
  if (!move || move.kind !== "M") {
    return;
  }

  const firstSegmentIndex = commands.findIndex(
    (command, index) => index > 0 && (command.kind === "L" || command.kind === "C" || command.kind === "A")
  );
  if (firstSegmentIndex === -1) {
    return;
  }

  const firstSegment = commands[firstSegmentIndex];
  if (firstSegment.kind !== "L" && firstSegment.kind !== "C" && firstSegment.kind !== "A") {
    return;
  }
  const rounded = computeRoundedCorner(closingFrom, start, firstSegment.to, cornerRoundedCorners);
  if (!rounded) {
    return;
  }

  move.to = rounded.exit;

  for (let index = commands.length - 1; index >= 0; index -= 1) {
    const command = commands[index];
    if (command.kind === "L" || command.kind === "C" || command.kind === "A") {
      command.to = rounded.entry;
      break;
    }
  }

  commands.push({ kind: "C", c1: rounded.c1, c2: rounded.c2, to: rounded.exit });
}

function extractPreviousCorner(commands: ScenePathCommand[]): Point | null {
  if (commands.length < 2) {
    return null;
  }

  const previous = commands[commands.length - 2];
  if (!previous) {
    return null;
  }

  if (previous.kind === "M" || previous.kind === "L" || previous.kind === "C" || previous.kind === "A") {
    return previous.to;
  }

  return null;
}

function computeRoundedCorner(prev: Point, corner: Point, next: Point, requestedDistance: number): {
  entry: Point;
  exit: Point;
  c1: Point;
  c2: Point;
} | null {
  const incoming = normalize({ x: corner.x - prev.x, y: corner.y - prev.y });
  const outgoing = normalize({ x: next.x - corner.x, y: next.y - corner.y });
  if (!incoming || !outgoing) {
    return null;
  }

  if (!Number.isFinite(requestedDistance) || requestedDistance <= 0) {
    return null;
  }

  const incomingLength = distance(prev, corner);
  const outgoingLength = distance(corner, next);
  if (!Number.isFinite(incomingLength) || !Number.isFinite(outgoingLength) || incomingLength <= 1e-9 || outgoingLength <= 1e-9) {
    return null;
  }

  const inDistance = Math.min(requestedDistance, incomingLength);
  const outDistance = Math.min(requestedDistance, outgoingLength);
  if (inDistance <= 1e-9 || outDistance <= 1e-9) {
    return null;
  }

  // PGF rounds corners by stepping fixed in/out distances along segments, then
  // inserting a quarter-circle cubic approximation with kappa = 0.5522847.
  const kappa = 0.5522847;

  const entry = { x: corner.x - incoming.x * inDistance, y: corner.y - incoming.y * inDistance };
  const exit = { x: corner.x + outgoing.x * outDistance, y: corner.y + outgoing.y * outDistance };
  const c1 = { x: entry.x + incoming.x * inDistance * kappa, y: entry.y + incoming.y * inDistance * kappa };
  const c2 = { x: exit.x - outgoing.x * outDistance * kappa, y: exit.y - outgoing.y * outDistance * kappa };

  return { entry, exit, c1, c2 };
}

function normalize(vector: Point): Point | null {
  const len = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(len) || len <= 1e-9) {
    return null;
  }
  return { x: vector.x / len, y: vector.y / len };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function interpolate(from: Point, to: Point, t: number): Point {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t
  };
}

function hasDrawablePathSegments(path: ScenePath): boolean {
  return path.commands.some((command) => command.kind === "L" || command.kind === "C" || command.kind === "A");
}

function dropUndrawnActivePath(path: ScenePath | null): ScenePath | null {
  if (!path) {
    return null;
  }
  return hasDrawablePathSegments(path) ? path : null;
}

function flushDrawableActivePath(elements: SceneElement[], path: ScenePath | null): ScenePath | null {
  const drawable = dropUndrawnActivePath(path);
  if (drawable) {
    elements.push(drawable);
  }
  return null;
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
  span: { from: number; to: number },
  rotation = 0
): SceneEllipse {
  return {
    kind: "Ellipse",
    id: `scene-ellipse:${sourceId}:${span.from}`,
    sourceId,
    sourceSpan: span,
    style: { ...style },
    center,
    rx,
    ry,
    rotation
  };
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

function parseCoordinateOperation(raw: string): { name: string } | null {
  const inlineWithAt = raw.match(/coordinate\s*\(([^\)]+)\)\s*at\s*(\([^\)]+\))/i);
  if (inlineWithAt) {
    return { name: inlineWithAt[1].trim() };
  }

  const simple = raw.match(/coordinate\s*\(([^\)]+)\)/i);
  if (!simple) {
    return null;
  }
  return { name: simple[1].trim() };
}

function applyToOperation(
  item: ToOperationItem,
  context: SemanticContext,
  statement: PathStatement,
  style: ResolvedStyle,
  activePath: ScenePath | null,
  previousSegmentRoundedCorners: number | null,
  markFeature: FeatureMarkFn,
  pushDiagnostic: DiagnosticPushFn
): {
  activePath: ScenePath | null;
  segment: PlacementSegment | null;
  behindNodeElements: SceneElement[];
  frontNodeElements: SceneElement[];
  previousSegmentRoundedCorners?: number | null;
} {
  const behindNodeElements: SceneElement[] = [];
  const frontNodeElements: SceneElement[] = [];
  const target = item.target ?? parseToTarget(item.raw);
  if (!target) {
    markFeature("to_operation", "unsupported");
    pushDiagnostic("unsupported-to-operation", "`to` operation target is not yet supported.", item.span.from, item.span.to);
    return { activePath, segment: null, behindNodeElements, frontNodeElements };
  }

  markFeature("to_operation", "supported");
  markFeature("keyword_to", "supported");
  markFeature("path_operators_basic", "supported");

  if (target.kind === "cycle") {
    if (activePath) {
      if (context.currentPoint && context.pathStartPoint) {
        const closingFrom = context.currentPoint;
        const pathStart = context.pathStartPoint;
        appendPathPoint(
          activePath.commands,
          "--",
          closingFrom,
          pathStart,
          previousSegmentRoundedCorners,
          style.roundedCorners
        );
        context.currentPoint = pathStart;
        roundClosedPathStartCorner(activePath.commands, closingFrom, pathStart, style.roundedCorners);
      }
      activePath.commands.push({ kind: "Z" });
      context.currentPoint = context.pathStartPoint;
    }
    return {
      activePath,
      segment: null,
      behindNodeElements,
      frontNodeElements,
      previousSegmentRoundedCorners: null
    };
  }

  const evaluated = evaluateRawCoordinate(target.raw, context, target.relativePrefix);
  if (!evaluated.point) {
    markFeature("to_operation", "unsupported");
    for (const code of evaluated.diagnostics) {
      pushDiagnostic(code, `to-operation target issue: ${code}`, item.span.from, item.span.to);
    }
    return { activePath, segment: null, behindNodeElements, frontNodeElements };
  }
  const resolvedTargetPoint = maybeResolveNamedCoordinateBorderPointFromRaw(target.raw, evaluated.point, context.currentPoint, context);

  let path = activePath;
  if (!path) {
    if (context.currentPoint) {
      path = makePath(statement.id, item.id, style, item.span);
      path.commands.push({ kind: "M", to: context.currentPoint });
    } else {
      path = makePath(statement.id, item.id, style, item.span);
      path.commands.push({ kind: "M", to: resolvedTargetPoint });
      context.pathStartPoint = resolvedTargetPoint;
      context.currentPoint = resolvedTargetPoint;
      markFeature("svg_path", "supported");
      return {
        activePath: path,
        segment: null,
        behindNodeElements,
        frontNodeElements,
        previousSegmentRoundedCorners: null
      };
    }
  }

  const start = context.currentPoint;
  let segment: PlacementSegment | null = null;
  let nextRoundedCorners = previousSegmentRoundedCorners;
  const curved = extractToCurveOptions(item.options);
  if (start && curved) {
    segment = appendToCurve(path.commands, start, resolvedTargetPoint, curved);
    nextRoundedCorners = style.roundedCorners;
    markFeature("path_operator_curves", "supported");
  } else {
    const appended = appendPathPoint(
      path.commands,
      "--",
      context.currentPoint,
      resolvedTargetPoint,
      previousSegmentRoundedCorners,
      style.roundedCorners
    );
    segment = appended.segment;
    nextRoundedCorners = appended.nextRoundedCorners;
  }
  context.currentPoint = resolvedTargetPoint;

  for (const node of item.nodes ?? []) {
    const resolvedNode = evaluateNodeItem(node, statement, context, style, markFeature, pushDiagnostic, segment, undefined, 0.5);
    behindNodeElements.push(...resolvedNode.behindElements);
    frontNodeElements.push(...resolvedNode.frontElements);
  }

  markFeature("svg_path", "supported");
  return {
    activePath: path,
    segment,
    behindNodeElements,
    frontNodeElements,
    previousSegmentRoundedCorners: nextRoundedCorners
  };
}

function parseToTarget(raw: string): { kind: "cycle" } | { kind: "coordinate"; raw: string; relativePrefix?: "+" | "++" } | null {
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
    raw: match[3],
    relativePrefix: prefix
  };
}

function extractToCurveOptions(
  options: ToOperationItem["options"]
): {
  out: number;
  in: number;
  outLooseness: number;
  inLooseness: number;
} | null {
  if (!options) {
    return null;
  }

  let out: number | null = null;
  let inAngle: number | null = null;
  let looseness: number | null = null;
  let outLooseness: number | null = null;
  let inLooseness: number | null = null;

  for (const entry of options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }

    if (entry.key === "out") {
      const parsed = Number(normalizeOptionValue(entry.valueRaw));
      if (Number.isFinite(parsed)) {
        out = parsed;
      }
      continue;
    }

    if (entry.key === "in") {
      const parsed = Number(normalizeOptionValue(entry.valueRaw));
      if (Number.isFinite(parsed)) {
        inAngle = parsed;
      }
      continue;
    }

    if (entry.key === "looseness") {
      const parsed = Number(normalizeOptionValue(entry.valueRaw));
      if (Number.isFinite(parsed) && parsed >= 0) {
        looseness = parsed;
      }
      continue;
    }

    if (entry.key === "out looseness") {
      const parsed = Number(normalizeOptionValue(entry.valueRaw));
      if (Number.isFinite(parsed) && parsed >= 0) {
        outLooseness = parsed;
      }
      continue;
    }

    if (entry.key === "in looseness") {
      const parsed = Number(normalizeOptionValue(entry.valueRaw));
      if (Number.isFinite(parsed) && parsed >= 0) {
        inLooseness = parsed;
      }
    }
  }

  if (out == null || inAngle == null) {
    return null;
  }

  const shared = looseness ?? 1;
  return {
    out,
    in: inAngle,
    outLooseness: outLooseness ?? shared,
    inLooseness: inLooseness ?? shared
  };
}

function appendToCurve(
  commands: ScenePathCommand[],
  from: Point,
  to: Point,
  options: { out: number; in: number; outLooseness: number; inLooseness: number }
): PlacementSegment {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const baseDistance = Math.hypot(dx, dy) * 0.3915;

  const outDistance = baseDistance * options.outLooseness;
  const inDistance = baseDistance * options.inLooseness;

  const outRadians = toRadians(options.out);
  const inRadians = toRadians(options.in);
  const c1 = {
    x: from.x + outDistance * Math.cos(outRadians),
    y: from.y + outDistance * Math.sin(outRadians)
  };
  const c2 = {
    x: to.x + inDistance * Math.cos(inRadians),
    y: to.y + inDistance * Math.sin(inRadians)
  };

  commands.push({
    kind: "C",
    c1,
    c2,
    to
  });

  return {
    kind: "cubic",
    from,
    c1,
    c2,
    to
  };
}

function appendSinCosSegment(commands: ScenePathCommand[], from: Point, to: Point, mode: "sin" | "cos"): PlacementSegment {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  const c1 =
    mode === "sin"
      ? {
          x: from.x + SIN_CONTROL_1_X * dx,
          y: from.y + SIN_CONTROL_1_Y * dy
        }
      : {
          x: from.x + COS_CONTROL_1_X * dx,
          y: from.y + COS_CONTROL_1_Y * dy
        };
  const c2 =
    mode === "sin"
      ? {
          x: from.x + SIN_CONTROL_2_X * dx,
          y: from.y + SIN_CONTROL_2_Y * dy
        }
      : {
          x: from.x + COS_CONTROL_2_X * dx,
          y: from.y + COS_CONTROL_2_Y * dy
        };

  commands.push({ kind: "C", c1, c2, to });
  return { kind: "cubic", from, c1, c2, to };
}

function extractEllipseRadii(item: PathOptionItem, pushDiagnostic: DiagnosticPushFn): { rx: number; ry: number } | null {
  let rx: number | null = null;
  let ry: number | null = null;
  let radius: number | null = null;

  for (const entry of item.options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "x radius") {
      rx = parseLength(entry.valueRaw, "cm");
    } else if (entry.key === "y radius") {
      ry = parseLength(entry.valueRaw, "cm");
    } else if (entry.key === "radius") {
      radius = parseLength(entry.valueRaw, "cm");
    }
  }

  if (radius != null) {
    return { rx: radius, ry: radius };
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

function extractCircleShapeOptions(item: PathOptionItem): {
  radius?: number;
  rx?: number;
  ry?: number;
  rotation?: number;
} {
  let radius: number | undefined;
  let rx: number | undefined;
  let ry: number | undefined;
  let rotation: number | undefined;

  for (const entry of item.options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "radius") {
      const parsed = parseLength(entry.valueRaw, "cm");
      if (parsed != null) {
        radius = parsed;
      }
    } else if (entry.key === "x radius") {
      const parsed = parseLength(entry.valueRaw, "cm");
      if (parsed != null) {
        rx = parsed;
      }
    } else if (entry.key === "y radius") {
      const parsed = parseLength(entry.valueRaw, "cm");
      if (parsed != null) {
        ry = parsed;
      }
    } else if (entry.key === "rotate") {
      const parsed = Number(entry.valueRaw);
      if (Number.isFinite(parsed)) {
        rotation = parsed;
      }
    }
  }

  return { radius, rx, ry, rotation };
}

function extractArcParameters(item: PathOptionItem, pushDiagnostic: DiagnosticPushFn, style: ResolvedStyle): ArcParameters | null {
  let startAngle: number | null = null;
  let endAngle: number | null = null;
  let deltaAngle: number | null = null;
  let rx: number | null = style.xRadius ?? style.radius;
  let ry: number | null = style.yRadius ?? style.radius;

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
    } else if (entry.key === "delta angle") {
      const parsed = Number(entry.valueRaw);
      if (Number.isFinite(parsed)) {
        deltaAngle = parsed;
      }
    } else if (entry.key === "radius") {
      const parsed = parseLength(entry.valueRaw, "cm");
      if (parsed != null) {
        rx = parsed;
        ry = parsed;
      }
    } else if (entry.key === "x radius") {
      const parsed = parseLength(entry.valueRaw, "cm");
      if (parsed != null) {
        rx = parsed;
      }
    } else if (entry.key === "y radius") {
      const parsed = parseLength(entry.valueRaw, "cm");
      if (parsed != null) {
        ry = parsed;
      }
    }
  }

  if (startAngle == null) {
    pushDiagnostic("invalid-arc-parameters", "Arc requires a start angle.", item.span.from, item.span.to);
    return null;
  }

  const resolvedEndAngle = endAngle ?? (deltaAngle != null ? startAngle + deltaAngle : null);
  if (resolvedEndAngle == null) {
    pushDiagnostic("invalid-arc-parameters", "Arc requires an end angle or delta angle.", item.span.from, item.span.to);
    return null;
  }

  if (rx != null && ry != null) {
    return {
      startAngle,
      endAngle: resolvedEndAngle,
      rx,
      ry
    };
  }

  pushDiagnostic("invalid-arc-parameters", "Arc requires `radius` or both `x radius` and `y radius`.", item.span.from, item.span.to);
  return null;
}

function extractGridSteps(
  item: PathOptionItem,
  pushDiagnostic: DiagnosticPushFn,
  context: SemanticContext
): { stepX?: number; stepY?: number } | null {
  let stepX: number | undefined;
  let stepY: number | undefined;

  for (const entry of item.options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }

    if (entry.key === "step") {
      const pair = parseCoordinateLike(entry.valueRaw);
      if (pair) {
        const parsedX = parseLength(pair.x, "cm");
        const parsedY = parseLength(pair.y, "cm");
        if (parsedX == null || parsedY == null || parsedX < 0 || parsedY < 0) {
          pushDiagnostic("invalid-grid-step", "Grid `step` coordinate must provide positive lengths.", entry.span.from, entry.span.to);
          continue;
        }
        stepX = resolveGridAxisStep(parsedX, "x", hasExplicitLengthUnit(pair.x), context);
        stepY = resolveGridAxisStep(parsedY, "y", hasExplicitLengthUnit(pair.y), context);
        continue;
      }

      const polar = parsePolarStep(entry.valueRaw);
      if (polar) {
        stepX = Math.abs(polar.x);
        stepY = Math.abs(polar.y);
        continue;
      }

      const scalar = parseLength(entry.valueRaw, "cm");
      if (scalar == null || scalar < 0) {
        pushDiagnostic("invalid-grid-step", "Grid `step` must be a positive length.", entry.span.from, entry.span.to);
        continue;
      }
      const hasUnit = hasExplicitLengthUnit(entry.valueRaw);
      stepX = resolveGridAxisStep(scalar, "x", hasUnit, context);
      stepY = resolveGridAxisStep(scalar, "y", hasUnit, context);
      continue;
    }

    if (entry.key === "xstep" || entry.key === "x step") {
      const parsed = parseLength(entry.valueRaw, "cm");
      if (parsed == null || parsed < 0) {
        pushDiagnostic("invalid-grid-step", "Grid `xstep` must be a positive length.", entry.span.from, entry.span.to);
        continue;
      }
      stepX = resolveGridAxisStep(parsed, "x", hasExplicitLengthUnit(entry.valueRaw), context);
      continue;
    }

    if (entry.key === "ystep" || entry.key === "y step") {
      const parsed = parseLength(entry.valueRaw, "cm");
      if (parsed == null || parsed < 0) {
        pushDiagnostic("invalid-grid-step", "Grid `ystep` must be a positive length.", entry.span.from, entry.span.to);
        continue;
      }
      stepY = resolveGridAxisStep(parsed, "y", hasExplicitLengthUnit(entry.valueRaw), context);
    }
  }

  if (stepX == null && stepY == null) {
    return null;
  }

  return { stepX, stepY };
}

function parsePolarStep(raw: string): { x: number; y: number } | null {
  const inner = coordinateInner(raw);
  if (!inner) {
    return null;
  }

  const parts = splitAllAtTopLevel(inner, ":").map((part) => part.trim());
  if (parts.length !== 2) {
    return null;
  }

  const angle = Number(parts[0]);
  const radius = parseLength(parts[1], "cm");
  if (!Number.isFinite(angle) || radius == null) {
    return null;
  }

  const radians = toRadians(angle);
  return {
    x: radius * Math.cos(radians),
    y: radius * Math.sin(radians)
  };
}

function resolveGridAxisStep(
  step: number,
  axis: "x" | "y",
  hasExplicitUnit: boolean,
  context: SemanticContext
): number {
  if (hasExplicitUnit) {
    return Math.abs(step);
  }

  const frame = context.stack[context.stack.length - 1];
  const delta =
    axis === "x"
      ? applyMatrixToVector(frame.transform, { x: step, y: 0 })
      : applyMatrixToVector(frame.transform, { x: 0, y: step });
  const magnitude = Math.hypot(delta.x, delta.y);
  if (!Number.isFinite(magnitude) || magnitude <= 1e-9) {
    return Math.abs(step);
  }
  return Math.abs(magnitude);
}

function hasExplicitLengthUnit(raw: string): boolean {
  const compact = normalizeOptionValue(raw).replace(/\s+/g, "");
  const match = compact.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))([A-Za-z]+)?$/);
  return Boolean(match && match[2]);
}

function extractRoundedCorners(options: PathOptionItem["options"], current: number | null): number | null | undefined {
  let next = current;
  let changed = false;

  for (const entry of options.entries) {
    if (entry.kind === "flag" && entry.key === "sharp corners") {
      next = null;
      changed = true;
      continue;
    }
    if (entry.kind === "flag" && entry.key === "rounded corners") {
      next = parseLength("4pt", "pt") ?? 4;
      changed = true;
      continue;
    }
    if (entry.kind === "kv" && entry.key === "rounded corners") {
      const parsed = parseLength(entry.valueRaw, "pt");
      if (parsed != null) {
        next = parsed;
        changed = true;
      }
    }
  }

  return changed ? next : undefined;
}

function parseCircleRadiusFromCoordinateRaw(raw: string): number | null {
  const inner = coordinateInner(raw);
  if (!inner) {
    return null;
  }

  if (inner.includes(",") || inner.includes(":") || /\band\b/i.test(inner)) {
    return null;
  }

  return parseLength(inner, "cm");
}

function parseEllipseRadiiFromCoordinateRaw(raw: string): { rx: number; ry: number } | null {
  const inner = coordinateInner(raw);
  if (!inner) {
    return null;
  }

  const match = inner.match(/^(.+?)\s+and\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const rx = parseLength(match[1].trim(), "cm");
  const ry = parseLength(match[2].trim(), "cm");
  if (rx == null || ry == null) {
    return null;
  }

  return { rx, ry };
}

function parseArcShorthand(raw: string): ArcParameters | null {
  const inner = coordinateInner(raw);
  if (!inner) {
    return null;
  }

  const parts = splitAllAtTopLevel(inner, ":").map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length !== 3) {
    return null;
  }

  const startAngle = Number(parts[0]);
  const endAngle = Number(parts[1]);
  if (!Number.isFinite(startAngle) || !Number.isFinite(endAngle)) {
    return null;
  }

  const radiiSpec = parts[2];
  const elliptical = radiiSpec.match(/^(.+?)\s+and\s+(.+)$/i);
  if (elliptical) {
    const rx = parseLength(elliptical[1].trim(), "cm");
    const ry = parseLength(elliptical[2].trim(), "cm");
    if (rx == null || ry == null) {
      return null;
    }
    return { startAngle, endAngle, rx, ry };
  }

  const radius = parseLength(radiiSpec, "cm");
  if (radius == null) {
    return null;
  }

  return { startAngle, endAngle, rx: radius, ry: radius };
}

function appendArcCommand(
  commands: ScenePathCommand[],
  from: Point,
  params: ArcParameters
): { endpoint: Point; segment: PlacementSegment } {
  const endpoint = arcEndpoint(from, params);
  commands.push({
    kind: "A",
    rx: Math.abs(params.rx),
    ry: Math.abs(params.ry),
    xAxisRotation: 0,
    largeArc: Math.abs(params.endAngle - params.startAngle) > 180,
    sweep: params.endAngle >= params.startAngle,
    to: endpoint
  });
  return {
    endpoint,
    segment: {
      kind: "arc",
      from,
      to: endpoint,
      params
    }
  };
}

function arcEndpoint(from: Point, params: ArcParameters): Point {
  const center = arcCenter(from, params);
  const endRadians = toRadians(params.endAngle);
  return {
    x: center.x + params.rx * Math.cos(endRadians),
    y: center.y + params.ry * Math.sin(endRadians)
  };
}

function arcCenter(from: Point, params: ArcParameters): Point {
  const startRadians = toRadians(params.startAngle);
  return {
    x: from.x - params.rx * Math.cos(startRadians),
    y: from.y - params.ry * Math.sin(startRadians)
  };
}

function makeGridElements(
  sourceId: string,
  itemId: string,
  from: Point,
  to: Point,
  stepX: number,
  stepY: number,
  style: ResolvedStyle,
  span: { from: number; to: number }
): ScenePath[] {
  const minX = Math.min(from.x, to.x);
  const maxX = Math.max(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const maxY = Math.max(from.y, to.y);
  const spacingX = stepX >= 0 ? stepX : DEFAULT_GRID_STEP;
  const spacingY = stepY >= 0 ? stepY : DEFAULT_GRID_STEP;

  const paths: ScenePath[] = [];
  if (spacingX > 0) {
    for (let x = minX; x <= maxX + 1e-6; x += spacingX) {
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
  }
  if (spacingY > 0) {
    for (let y = minY; y <= maxY + 1e-6; y += spacingY) {
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
  }
  return paths;
}

function coordinateInner(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) {
    return null;
  }
  return trimmed.slice(1, -1).trim();
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function parseBezierFromItems(
  items: PathItem[],
  startIndex: number,
  context: SemanticContext
): {
  consumedIndex: number;
  control1: Point;
  control2: Point;
  endPoint: Point | null;
  endAdvancesCurrentPoint: boolean;
  endClosesPath: boolean;
  usedAnd: boolean;
} | null {
  let cursor = startIndex + 1;
  const controlsKeyword = items[cursor];
  if (!controlsKeyword || controlsKeyword.kind !== "PathKeyword" || controlsKeyword.keyword !== "controls") {
    return null;
  }
  cursor += 1;

  const control1Item = items[cursor];
  if (!control1Item || control1Item.kind !== "Coordinate") {
    return null;
  }
  const control1Eval = evaluateCoordinate(control1Item, context);
  if (!control1Eval.point) {
    return null;
  }
  cursor += 1;

  let usedAnd = false;
  let control2 = control1Eval.point;

  const maybeAnd = items[cursor];
  if (maybeAnd && maybeAnd.kind === "PathKeyword" && maybeAnd.keyword === "and") {
    usedAnd = true;
    cursor += 1;
    const control2Item = items[cursor];
    if (!control2Item || control2Item.kind !== "Coordinate") {
      return null;
    }
    const control2Eval = evaluateCoordinate(control2Item, context);
    if (!control2Eval.point) {
      return null;
    }
    control2 = control2Eval.point;
    cursor += 1;
  }

  const closingDots = items[cursor];
  if (!closingDots || closingDots.kind !== "PathKeyword" || closingDots.keyword !== "..") {
    return null;
  }
  cursor += 1;

  const targetItem = items[cursor];
  if (!targetItem) {
    return null;
  }

  if (targetItem.kind === "PathKeyword" && targetItem.keyword === "cycle") {
    return {
      consumedIndex: cursor,
      control1: control1Eval.point,
      control2,
      endPoint: context.pathStartPoint,
      endAdvancesCurrentPoint: true,
      endClosesPath: true,
      usedAnd
    };
  }

  if (targetItem.kind !== "Coordinate") {
    return null;
  }
  const targetEval = evaluateCoordinate(targetItem, context);

  return {
    consumedIndex: cursor,
    control1: control1Eval.point,
    control2,
    endPoint: targetEval.point,
    endAdvancesCurrentPoint: targetEval.advancesCurrentPoint,
    endClosesPath: false,
    usedAnd
  };
}

function parseParabolaFromItems(
  items: PathItem[],
  startIndex: number,
  context: SemanticContext
): { consumedIndex: number; commands: ScenePathCommand[]; endPoint: Point } | null {
  const start = context.currentPoint;
  if (!start) {
    return null;
  }

  let cursor = startIndex + 1;
  let parabolaOptions: PathOptionItem["options"] | undefined;

  const maybeOption = items[cursor];
  if (maybeOption?.kind === "PathOption") {
    parabolaOptions = maybeOption.options;
    cursor += 1;
  }

  const parsedOptions = parseParabolaOptions(parabolaOptions);
  let bendSpec = parsedOptions.bend;
  let bendPos = parsedOptions.bendPos;

  const maybeBendKeyword = items[cursor];
  if (maybeBendKeyword?.kind === "PathKeyword" && maybeBendKeyword.keyword === "bend") {
    const bendCoordinate = items[cursor + 1];
    if (!bendCoordinate || bendCoordinate.kind !== "Coordinate") {
      return null;
    }
    bendSpec = {
      kind: "coordinate",
      raw: bendCoordinate.raw,
      relativePrefix: bendCoordinate.relativePrefix
    };
    cursor += 2;
  }

  const targetItem = items[cursor];
  let endPoint: Point | null = null;
  if (targetItem?.kind === "Coordinate") {
    const evaluated = evaluateCoordinate(targetItem, context);
    endPoint = evaluated.point;
  } else if (targetItem?.kind === "PathKeyword" && targetItem.keyword === "cycle") {
    endPoint = context.pathStartPoint;
  }

  if (!endPoint) {
    return null;
  }

  if (!Number.isFinite(bendPos)) {
    bendPos = 0;
  }
  bendPos = clamp(bendPos, 0, 1);
  const savedPoint = interpolate(start, endPoint, bendPos);

  let bendPoint: Point | null = null;
  if (bendSpec.kind === "saved") {
    bendPoint = savedPoint;
  } else if (bendSpec.kind === "height") {
    bendPoint = { x: savedPoint.x, y: savedPoint.y + bendSpec.height };
  } else {
    bendPoint = evaluateParabolaBendCoordinate(bendSpec.raw, context, savedPoint, bendSpec.relativePrefix);
  }

  if (!bendPoint) {
    return null;
  }

  const toBend = {
    x: bendPoint.x - start.x,
    y: bendPoint.y - start.y
  };
  const toEnd = {
    x: endPoint.x - bendPoint.x,
    y: endPoint.y - bendPoint.y
  };

  return {
    consumedIndex: cursor,
    commands: buildParabolaCommands(start, toBend, toEnd),
    endPoint
  };
}

function parseParabolaOptions(options: PathOptionItem["options"] | undefined): {
  bendPos: number;
  bend:
    | { kind: "saved" }
    | { kind: "height"; height: number }
    | { kind: "coordinate"; raw: string; relativePrefix?: "+" | "++" };
} {
  let bendPos = 0;
  let bend:
    | { kind: "saved" }
    | { kind: "height"; height: number }
    | { kind: "coordinate"; raw: string; relativePrefix?: "+" | "++" } = { kind: "saved" };

  if (!options) {
    return { bendPos, bend };
  }

  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "bend at end") {
        bendPos = 1;
        bend = { kind: "coordinate", raw: "(0,0)", relativePrefix: "+" };
      } else if (entry.key === "bend at start") {
        bendPos = 0;
        bend = { kind: "coordinate", raw: "(0,0)", relativePrefix: "+" };
      }
      continue;
    }

    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "bend pos") {
      const parsed = Number(normalizeOptionValue(entry.valueRaw));
      if (Number.isFinite(parsed)) {
        bendPos = parsed;
      }
      continue;
    }
    if (entry.key === "parabola height") {
      const parsed = parseLength(entry.valueRaw, "cm");
      if (parsed != null) {
        bendPos = 0.5;
        bend = { kind: "height", height: parsed };
      }
      continue;
    }
    if (entry.key === "bend") {
      const parsed = parseBendCoordinateValue(entry.valueRaw);
      if (parsed) {
        bend = { kind: "coordinate", raw: parsed.raw, relativePrefix: parsed.relativePrefix };
      }
    }
  }

  return { bendPos, bend };
}

function parseBendCoordinateValue(raw: string): { raw: string; relativePrefix?: "+" | "++" } | null {
  const normalized = normalizeOptionValue(raw);
  if (normalized.length === 0) {
    return null;
  }

  let relativePrefix: "+" | "++" | undefined;
  let coordinateRaw = normalized;
  if (coordinateRaw.startsWith("++")) {
    relativePrefix = "++";
    coordinateRaw = coordinateRaw.slice(2).trim();
  } else if (coordinateRaw.startsWith("+")) {
    relativePrefix = "+";
    coordinateRaw = coordinateRaw.slice(1).trim();
  }

  if (!coordinateRaw.startsWith("(") || !coordinateRaw.endsWith(")")) {
    return null;
  }

  return { raw: coordinateRaw, relativePrefix };
}

function evaluateParabolaBendCoordinate(
  raw: string,
  context: SemanticContext,
  savedPoint: Point,
  relativePrefix?: "+" | "++"
): Point | null {
  if (!relativePrefix) {
    return evaluateRawCoordinate(raw, context).point;
  }

  const originalCurrent = context.currentPoint;
  context.currentPoint = savedPoint;
  const evaluated = evaluateRawCoordinate(raw, context, relativePrefix);
  context.currentPoint = originalCurrent;
  return evaluated.point;
}

function buildParabolaCommands(start: Point, toBend: Point, toEnd: Point): ScenePathCommand[] {
  const commands: ScenePathCommand[] = [];

  const hasBendSegment = Math.abs(toBend.x) > 1e-9 || Math.abs(toBend.y) > 1e-9;
  const bend = { x: start.x + toBend.x, y: start.y + toBend.y };
  if (hasBendSegment) {
    commands.push({
      kind: "C",
      c1: {
        x: start.x + 0.1125 * toBend.x,
        y: start.y + 0.225 * toBend.y
      },
      c2: {
        x: start.x + 0.5 * toBend.x,
        y: start.y + toBend.y
      },
      to: bend
    });
  }

  const hasEndSegment = Math.abs(toEnd.x) > 1e-9 || Math.abs(toEnd.y) > 1e-9;
  if (hasEndSegment) {
    commands.push({
      kind: "C",
      c1: {
        x: bend.x + 0.5 * toEnd.x,
        y: bend.y
      },
      c2: {
        x: bend.x + 0.8875 * toEnd.x,
        y: bend.y + 0.775 * toEnd.y
      },
      to: {
        x: bend.x + toEnd.x,
        y: bend.y + toEnd.y
      }
    });
  }

  return commands;
}

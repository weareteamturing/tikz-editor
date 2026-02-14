import type { PathStatement } from "../../ast/types.js";
import type { SemanticContext } from "../context.js";
import {
  applyNameScope,
  evaluateNodeItem,
  maybeResolveNamedCoordinateBorderPoint,
  maybeResolveTrailingCoordinateFromNodeName,
  shouldCaptureStandaloneNodeNameCoordinate
} from "../nodes/evaluate.js";
import { evaluateCoordinate, evaluateRawCoordinate } from "../coords/evaluate.js";
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
import { applyToOperation } from "./to-operation.js";
import type { DiagnosticPushFn, FeatureMarkFn, PlacementSegment } from "./types.js";

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
  const shouldCompoundFilledSubpaths = style.shadeEnabled || (style.fill != null && style.fill !== "none");

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

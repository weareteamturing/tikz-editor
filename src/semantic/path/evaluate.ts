import { splitAllAtTopLevel } from "../../domains/coordinates/parse.js";
import type { PathItem, PathOptionItem, PathStatement, ToOperationItem } from "../../ast/types.js";
import type { OptionListAst } from "../../options/types.js";
import type { SemanticContext } from "../context.js";
import { evaluateCoordinate, evaluateRawCoordinate } from "../coords/evaluate.js";
import { parseCoordinateLike, parseLength } from "../coords/parse-length.js";
import { resolveContextDelta } from "../style/resolve.js";
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
type ArcParameters = { startAngle: number; endAngle: number; rx: number; ry: number };
type PlacementSegment =
  | { kind: "line"; from: Point; to: Point }
  | { kind: "hv"; operator: "-|" | "|-"; from: Point; bend: Point; to: Point }
  | { kind: "cubic"; from: Point; c1: Point; c2: Point; to: Point }
  | { kind: "arc"; from: Point; to: Point; params: ArcParameters };

const DEFAULT_GRID_STEP = parseLength("1cm", "cm") ?? 28.4527559055;

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
  let lastPlacementSegment: PlacementSegment | null = null;

  for (let index = 0; index < statement.items.length; index += 1) {
    const item = statement.items[index];

    if (item.kind === "Coordinate") {
      if (pendingCircleCenter) {
        const radius = parseCircleRadiusFromCoordinateRaw(item.raw);
        if (radius != null) {
          markFeature("shape_circle", "supported");
          markFeature("svg_circle", "supported");
          geometryElements.push(makeCircleElement(statement.id, pendingCircleCenter, radius, style, item.span));
          pendingCircleCenter = null;
          pendingCircleRadius = null;
          pendingCircleRadii = null;
          pendingCircleRotation = 0;
          continue;
        }

        const fallbackRadius = pendingCircleRadius ?? style.radius;
        if (fallbackRadius != null) {
          markFeature("shape_circle", "supported");
          markFeature("svg_circle", "supported");
          geometryElements.push(makeCircleElement(statement.id, pendingCircleCenter, fallbackRadius, style, item.span));
        } else {
          const fallbackRadii = pendingCircleRadii ?? {
            rx: style.xRadius ?? DEFAULT_GRID_STEP,
            ry: style.yRadius ?? DEFAULT_GRID_STEP
          };
          markFeature("keyword_ellipse", "supported");
          geometryElements.push(
            makeEllipseElement(statement.id, pendingCircleCenter, fallbackRadii.rx, fallbackRadii.ry, style, item.span, pendingCircleRotation)
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
          markFeature("keyword_ellipse", "supported");
          geometryElements.push(makeEllipseElement(statement.id, pendingEllipseCenter, parsedRadii.rx, parsedRadii.ry, style, item.span));
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
          markFeature("keyword_arc", "supported");
          markFeature("svg_path", "supported");
          pendingArc = null;
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
        markFeature("svg_path", "supported");
        geometryElements.push(makeRectangleElement(statement.id, item.id, pendingRectangleFrom, evaluated.point, style, item.span));
        pendingRectangleFrom = null;
        context.currentPoint = evaluated.point;
        if (!context.pathStartPoint) {
          context.pathStartPoint = evaluated.point;
        }
        continue;
      }

      if (!activePath) {
        activePath = makePath(statement.id, item.id, style, statement.span);
        if (currentOperator && context.currentPoint) {
          activePath.commands.push({ kind: "M", to: context.currentPoint });
          lastPlacementSegment = appendPathPoint(
            activePath.commands,
            currentOperator,
            context.currentPoint,
            evaluated.point,
            activeRoundedCorners
          );
          context.pathStartPoint = context.pathStartPoint ?? context.currentPoint;
        } else {
          activePath.commands.push({ kind: "M", to: evaluated.point });
          context.pathStartPoint = evaluated.point;
          lastPlacementSegment = null;
        }
        markFeature("svg_path", "supported");
      } else if (!currentOperator) {
        activePath.commands.push({ kind: "M", to: evaluated.point });
        context.pathStartPoint = evaluated.point;
        lastPlacementSegment = null;
      } else {
        lastPlacementSegment = appendPathPoint(
          activePath.commands,
          currentOperator,
          context.currentPoint,
          evaluated.point,
          activeRoundedCorners
        );
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
      if (pendingCircleCenter) {
        const fallbackRadius = pendingCircleRadius ?? style.radius;
        if (fallbackRadius != null) {
          markFeature("shape_circle", "supported");
          markFeature("svg_circle", "supported");
          geometryElements.push(makeCircleElement(statement.id, pendingCircleCenter, fallbackRadius, style, item.span));
        } else {
          const fallbackRadii = pendingCircleRadii ?? {
            rx: style.xRadius ?? DEFAULT_GRID_STEP,
            ry: style.yRadius ?? DEFAULT_GRID_STEP
          };
          markFeature("keyword_ellipse", "supported");
          geometryElements.push(
            makeEllipseElement(statement.id, pendingCircleCenter, fallbackRadii.rx, fallbackRadii.ry, style, item.span, pendingCircleRotation)
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
        markFeature("path_operator_curves", "supported");
        markFeature("keyword_controls", "supported");
        if (parsedCurve.usedAnd) {
          markFeature("keyword_and", "supported");
        }
        markFeature("svg_path", "supported");

        if (parsedCurve.endAdvancesCurrentPoint) {
          context.currentPoint = parsedCurve.endPoint;
        }
        currentOperator = null;
        index = parsedCurve.consumedIndex;
        continue;
      }

      if (item.keyword === "cycle") {
        if (activePath) {
          if ((currentOperator === "-|" || currentOperator === "|-") && context.currentPoint && context.pathStartPoint) {
            const bendPoint =
              currentOperator === "-|"
                ? { x: context.pathStartPoint.x, y: context.currentPoint.y }
                : { x: context.currentPoint.x, y: context.pathStartPoint.y };
            appendSingleLine(activePath.commands, context.currentPoint, bendPoint, activeRoundedCorners);
            context.currentPoint = bendPoint;
          }
          activePath.commands.push({ kind: "Z" });
          if (hasDrawablePathSegments(activePath)) {
            geometryElements.push(activePath);
          }
          activePath = null;
          markFeature("path_cycle", "supported");
        }
        if (context.pathStartPoint) {
          context.currentPoint = context.pathStartPoint;
        }
        lastPlacementSegment = null;
        continue;
      }

      if (item.keyword === "rectangle") {
        if (!context.currentPoint) {
          pushDiagnostic("rectangle-without-start", "Rectangle operator requires a current point.", item.span.from, item.span.to);
          continue;
        }
        activePath = flushDrawableActivePath(geometryElements, activePath);
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
        activePath = flushDrawableActivePath(geometryElements, activePath);
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
        activePath = flushDrawableActivePath(geometryElements, activePath);
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
        activePath = flushDrawableActivePath(geometryElements, activePath);
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
          markFeature("keyword_parabola", "unsupported");
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
        markFeature("keyword_parabola", "supported");
        markFeature("svg_path", "supported");
        index = parsed.consumedIndex;
        currentOperator = null;
        continue;
      }

      if (item.keyword === "controls" || item.keyword === "and") {
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
          markFeature("keyword_arc", "supported");
          markFeature("svg_path", "supported");
          pendingArc = null;
        }
      }

      if (pendingGrid) {
        const parsed = extractGridSteps(item, pushDiagnostic);
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
      const frame = context.stack[context.stack.length - 1];
      const effectiveNodeOptions = resolveEffectiveNodeOptions({
        statementOptions: statement.options,
        nodeOptions: item.options,
        everyNodeStyles: frame.everyNodeStyles,
        everyRectangleNodeStyles: frame.everyRectangleNodeStyles,
        everyCircleNodeStyles: frame.everyCircleNodeStyles
      });
      const transformScale = frame.transformShape ? computeTransformScale(frame.transform) : 1;
      const nodeStyle = resolveNodeStyle(effectiveNodeOptions, style, context, transformScale);
      const nodeLayout = resolveNodeLayout(item.text, effectiveNodeOptions, nodeStyle, transformScale);
      const nodeShape = resolveNodeShape(effectiveNodeOptions);
      const anchor = resolveNodeAnchor(effectiveNodeOptions);
      const target = resolveNodeTargetPoint(item, context, item.span, pushDiagnostic, effectiveNodeOptions, lastPlacementSegment);
      const offset = resolveNodePlacementOffset(effectiveNodeOptions);
      const center = placeNodeCenter({ x: target.x + offset.x, y: target.y + offset.y }, nodeShape, nodeLayout, anchor);
      const scopedNames = collectScopedNodeNames(item.name, item.aliases, context);

      for (const name of scopedNames) {
        registerNamedNodeAnchors(context, name, center, nodeShape, nodeLayout);
      }

      const nodeElements: SceneElement[] = [];
      if (shouldDrawNodeBox(effectiveNodeOptions)) {
        if (nodeShape === "circle") {
          nodeElements.push(makeCircleElement(statement.id, center, nodeLayout.visualRadius, nodeStyle, item.span));
          markFeature("shape_circle", "supported");
          markFeature("svg_circle", "supported");
        } else if (nodeShape === "rectangle") {
          nodeElements.push(makeNodeBoxElement(statement.id, item.id, center, nodeLayout.visualWidth, nodeLayout.visualHeight, nodeStyle, item.span));
          markFeature("shape_rectangle", "supported");
          markFeature("svg_path", "supported");
        }
      }

      const normalizedText = nodeLayout.textLines.join("\n");
      if (normalizedText.length > 0) {
        nodeElements.push(makeTextElement(statement.id, item.id, center, nodeStyle, item.span, normalizedText));
        markFeature("svg_text", "supported");
      }

      const layer = resolveNodeLayer(effectiveNodeOptions, context);
      if (layer === "behind") {
        behindNodeElements.push(...nodeElements);
      } else {
        frontNodeElements.push(...nodeElements);
      }
      continue;
    }

    if (item.kind === "CoordinateOperation") {
      const parsed = parseCoordinateOperation(item.raw);
      if (!parsed) {
        pushDiagnostic("invalid-coordinate-operation", "Could not parse coordinate operation.", item.span.from, item.span.to);
        continue;
      }

      const nextItem = statement.items[index + 1];
      const nextCoordinate = statement.items[index + 2];
      if (nextItem?.kind === "PathKeyword" && nextItem.keyword === "at" && nextCoordinate?.kind === "Coordinate") {
        pendingNamedCoordinate = { name: parsed.name };
      } else if (context.currentPoint) {
        context.namedCoordinates.set(applyNameScope(parsed.name, context), context.currentPoint);
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
      const handled = applyToOperation(item, context, statement, style, activePath, markFeature, pushDiagnostic);
      activePath = handled.activePath;
      if (handled.segment) {
        lastPlacementSegment = handled.segment;
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
      markFeature("svg_circle", "supported");
      geometryElements.push(makeCircleElement(statement.id, pendingCircleCenter, fallbackRadius, style, statement.span));
    } else {
      const fallbackRadii = pendingCircleRadii ?? {
        rx: style.xRadius ?? DEFAULT_GRID_STEP,
        ry: style.yRadius ?? DEFAULT_GRID_STEP
      };
      markFeature("keyword_ellipse", "supported");
      geometryElements.push(
        makeEllipseElement(statement.id, pendingCircleCenter, fallbackRadii.rx, fallbackRadii.ry, style, statement.span, pendingCircleRotation)
      );
    }
    lastPlacementSegment = null;
  }

  if (pendingEllipseCenter) {
    const radii = pendingEllipseRadii ?? {
      rx: DEFAULT_GRID_STEP,
      ry: DEFAULT_GRID_STEP
    };
    geometryElements.push(makeEllipseElement(statement.id, pendingEllipseCenter, radii.rx, radii.ry, style, statement.span));
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

function appendPathPoint(
  commands: ScenePathCommand[],
  operator: "--" | "-|" | "|-" | null,
  current: Point | null,
  next: Point,
  roundedCorners: number | null
): PlacementSegment | null {
  if (!current) {
    commands.push({ kind: "L", to: next });
    return null;
  }

  if (!operator || operator === "--") {
    appendSingleLine(commands, current, next, roundedCorners);
    return { kind: "line", from: current, to: next };
  }

  if (operator === "-|") {
    const bend = { x: next.x, y: current.y };
    appendSingleLine(commands, current, bend, roundedCorners);
    appendSingleLine(commands, bend, next, roundedCorners);
    return { kind: "hv", operator, from: current, bend, to: next };
  }

  if (operator === "|-") {
    const bend = { x: current.x, y: next.y };
    appendSingleLine(commands, current, bend, roundedCorners);
    appendSingleLine(commands, bend, next, roundedCorners);
    return { kind: "hv", operator, from: current, bend, to: next };
  }

  return null;
}

function appendSingleLine(commands: ScenePathCommand[], from: Point, to: Point, roundedCorners: number | null): void {
  if (!roundedCorners || roundedCorners <= 0) {
    commands.push({ kind: "L", to });
    return;
  }

  const previous = extractPreviousCorner(commands);
  if (!previous) {
    commands.push({ kind: "L", to });
    return;
  }

  const rounded = computeRoundedCorner(previous, from, to, roundedCorners);
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

function computeRoundedCorner(prev: Point, corner: Point, next: Point, requestedRadius: number): {
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

  const dot = clamp(incoming.x * outgoing.x + incoming.y * outgoing.y, -1, 1);
  const turn = Math.acos(dot);
  if (!Number.isFinite(turn) || turn <= 1e-3 || Math.abs(Math.PI - turn) <= 1e-3) {
    return null;
  }

  const incomingLength = distance(prev, corner);
  const outgoingLength = distance(corner, next);
  const tangentDistance = requestedRadius / Math.tan(turn / 2);
  if (!Number.isFinite(tangentDistance) || tangentDistance <= 0) {
    return null;
  }

  const d = Math.min(tangentDistance, incomingLength / 2, outgoingLength / 2);
  const actualRadius = d * Math.tan(turn / 2);
  const k = (4 / 3) * Math.tan(turn / 4) * actualRadius;

  const entry = { x: corner.x - incoming.x * d, y: corner.y - incoming.y * d };
  const exit = { x: corner.x + outgoing.x * d, y: corner.y + outgoing.y * d };
  const c1 = { x: entry.x + incoming.x * k, y: entry.y + incoming.y * k };
  const c2 = { x: exit.x - outgoing.x * k, y: exit.y - outgoing.y * k };

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

type NodeShape = "rectangle" | "circle" | "coordinate";
type NodeLayer = "front" | "behind";
type NodeLayout = {
  textLines: string[];
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
      if (entry.key === "circle" || entry.key === "rectangle" || entry.key === "coordinate") {
        shape = entry.key;
      }
      continue;
    }
    if (entry.kind === "kv" && entry.key === "shape") {
      const normalized = normalizeOptionValue(entry.valueRaw).toLowerCase();
      if (normalized === "circle" || normalized === "rectangle" || normalized === "coordinate") {
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
    if (entry.kind === "kv" && entry.key === "anchor") {
      const normalized = normalizeOptionValue(entry.valueRaw).toLowerCase().replaceAll("_", " ");
      if (normalized.length > 0) {
        anchor = normalized;
      }
      continue;
    }

    if (entry.kind !== "flag") {
      continue;
    }

    if (entry.key === "above") {
      anchor = "south";
    } else if (entry.key === "below") {
      anchor = "north";
    } else if (entry.key === "left") {
      anchor = "east";
    } else if (entry.key === "right") {
      anchor = "west";
    } else if (entry.key === "above left") {
      anchor = "south east";
    } else if (entry.key === "above right") {
      anchor = "south west";
    } else if (entry.key === "below left") {
      anchor = "north east";
    } else if (entry.key === "below right") {
      anchor = "north west";
    } else if (entry.key === "base left") {
      anchor = "base east";
    } else if (entry.key === "base right") {
      anchor = "base west";
    } else if (entry.key === "mid left") {
      anchor = "mid east";
    } else if (entry.key === "mid right") {
      anchor = "mid west";
    } else if (entry.key === "centered") {
      anchor = "center";
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

function resolveNodePlacementOffset(options: PathOptionItem["options"] | undefined): Point {
  if (!options) {
    return { x: 0, y: 0 };
  }

  let offset: Point = { x: 0, y: 0 };
  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "centered") {
        offset = { x: 0, y: 0 };
      }
      continue;
    }

    if (entry.kind !== "kv") {
      continue;
    }

    if (entry.key === "above") {
      const dy = parsePlacementLength(entry.valueRaw);
      if (dy != null) {
        offset = { ...offset, y: offset.y + dy };
      }
      continue;
    }
    if (entry.key === "below") {
      const dy = parsePlacementLength(entry.valueRaw);
      if (dy != null) {
        offset = { ...offset, y: offset.y - dy };
      }
      continue;
    }
    if (entry.key === "left") {
      const dx = parsePlacementLength(entry.valueRaw);
      if (dx != null) {
        offset = { ...offset, x: offset.x - dx };
      }
      continue;
    }
    if (entry.key === "right") {
      const dx = parsePlacementLength(entry.valueRaw);
      if (dx != null) {
        offset = { ...offset, x: offset.x + dx };
      }
      continue;
    }

    if (entry.key === "above left" || entry.key === "above right" || entry.key === "below left" || entry.key === "below right") {
      const parsed = parseDiagonalPlacement(entry.valueRaw);
      if (parsed) {
        const sx = entry.key.includes("left") ? -parsed.x : parsed.x;
        const sy = entry.key.includes("below") ? -parsed.y : parsed.y;
        offset = { x: offset.x + sx, y: offset.y + sy };
      }
      continue;
    }
  }

  return offset;
}

function parsePlacementLength(raw: string): number | null {
  const normalized = normalizeOptionValue(raw);
  if (normalized.length === 0) {
    return 0;
  }
  return parseLength(normalized, "pt");
}

function parseDiagonalPlacement(raw: string): { x: number; y: number } | null {
  const normalized = normalizeOptionValue(raw);
  if (normalized.length === 0) {
    return { x: 0, y: 0 };
  }

  const parts = normalized.split(/\band\b/i).map((part) => part.trim()).filter((part) => part.length > 0);
  if (parts.length === 2) {
    const vertical = parseLength(parts[0], "pt");
    const horizontal = parseLength(parts[1], "pt");
    if (vertical != null && horizontal != null) {
      return { x: horizontal, y: vertical };
    }
  }

  const diagonal = parseLength(normalized, "pt");
  if (diagonal == null) {
    return null;
  }
  const component = diagonal / Math.sqrt(2);
  return { x: component, y: component };
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

function shouldDrawNodeBox(options: PathOptionItem["options"] | undefined): boolean {
  if (!options) {
    return false;
  }

  return options.entries.some(
    (entry) =>
      (entry.kind === "flag" && (entry.key === "draw" || entry.key === "fill")) ||
      (entry.kind === "kv" &&
        ((entry.key === "draw" && normalizeOptionValue(entry.valueRaw).toLowerCase() !== "none") ||
          (entry.key === "fill" && normalizeOptionValue(entry.valueRaw).toLowerCase() !== "none")))
  );
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

function registerNamedNodeAnchors(
  context: SemanticContext,
  name: string,
  center: Point,
  shape: NodeShape,
  layout: NodeLayout
): void {
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

function applyNameScope(name: string, context: SemanticContext): string {
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
  markFeature: FeatureMarkFn,
  pushDiagnostic: DiagnosticPushFn
): { activePath: ScenePath | null; segment: PlacementSegment | null } {
  const target = parseToTarget(item.raw);
  if (!target) {
    markFeature("to_operation", "unsupported");
    pushDiagnostic("unsupported-to-operation", "`to` operation target is not yet supported.", item.span.from, item.span.to);
    return { activePath, segment: null };
  }

  markFeature("to_operation", "supported");
  markFeature("keyword_to", "supported");
  markFeature("path_operators_basic", "supported");

  if (target.kind === "cycle") {
    if (activePath) {
      activePath.commands.push({ kind: "Z" });
      context.currentPoint = context.pathStartPoint;
    }
    return { activePath, segment: null };
  }

  const evaluated = evaluateRawCoordinate(target.rawCoordinate, context, target.relativePrefix);
  if (!evaluated.point) {
    markFeature("to_operation", "unsupported");
    for (const code of evaluated.diagnostics) {
      pushDiagnostic(code, `to-operation target issue: ${code}`, item.span.from, item.span.to);
    }
    return { activePath, segment: null };
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
      return { activePath: path, segment: null };
    }
  }

  const segment = appendPathPoint(path.commands, "--", context.currentPoint, evaluated.point, style.roundedCorners);
  context.currentPoint = evaluated.point;
  markFeature("svg_path", "supported");
  return { activePath: path, segment };
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
  let radius: number | null = style.radius;
  let rx: number | null = style.xRadius;
  let ry: number | null = style.yRadius;

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
      radius = parseLength(entry.valueRaw, "cm");
    } else if (entry.key === "x radius") {
      rx = parseLength(entry.valueRaw, "cm");
    } else if (entry.key === "y radius") {
      ry = parseLength(entry.valueRaw, "cm");
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

  if (radius != null) {
    return {
      startAngle,
      endAngle: resolvedEndAngle,
      rx: radius,
      ry: radius
    };
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
  pushDiagnostic: DiagnosticPushFn
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
        stepX = parsedX;
        stepY = parsedY;
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
      stepX = scalar;
      stepY = scalar;
      continue;
    }

    if (entry.key === "xstep" || entry.key === "x step") {
      const parsed = parseLength(entry.valueRaw, "cm");
      if (parsed == null || parsed < 0) {
        pushDiagnostic("invalid-grid-step", "Grid `xstep` must be a positive length.", entry.span.from, entry.span.to);
        continue;
      }
      stepX = parsed;
      continue;
    }

    if (entry.key === "ystep" || entry.key === "y step") {
      const parsed = parseLength(entry.valueRaw, "cm");
      if (parsed == null || parsed < 0) {
        pushDiagnostic("invalid-grid-step", "Grid `ystep` must be a positive length.", entry.span.from, entry.span.to);
        continue;
      }
      stepY = parsed;
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
  if (!targetItem || targetItem.kind !== "Coordinate") {
    return null;
  }
  const targetEval = evaluateCoordinate(targetItem, context);

  return {
    consumedIndex: cursor,
    control1: control1Eval.point,
    control2,
    endPoint: targetEval.point,
    endAdvancesCurrentPoint: targetEval.advancesCurrentPoint,
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
  let mode: "bend-at-start" | "bend-at-end" = "bend-at-start";
  let explicitBend: Point | null = null;

  const maybeOption = items[cursor];
  if (maybeOption?.kind === "PathOption") {
    const optionMode = parseParabolaOptionMode(maybeOption.options);
    if (optionMode) {
      mode = optionMode;
    }
    cursor += 1;
  }

  const maybeBendKeyword = items[cursor];
  if (maybeBendKeyword?.kind === "PathKeyword" && maybeBendKeyword.keyword === "bend") {
    const bendCoordinate = items[cursor + 1];
    if (!bendCoordinate || bendCoordinate.kind !== "Coordinate") {
      return null;
    }
    const bendEval = evaluateCoordinate(bendCoordinate, context);
    if (!bendEval.point) {
      return null;
    }
    explicitBend = bendEval.point;
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

  if (explicitBend) {
    const left = buildParabolaSegment(start, explicitBend, "bend-at-start");
    const right = buildParabolaSegment(explicitBend, endPoint, "bend-at-end");
    return {
      consumedIndex: cursor,
      commands: [left, right],
      endPoint
    };
  }

  return {
    consumedIndex: cursor,
    commands: [buildParabolaSegment(start, endPoint, mode)],
    endPoint
  };
}

function parseParabolaOptionMode(options: PathOptionItem["options"]): "bend-at-start" | "bend-at-end" | null {
  for (const entry of options.entries) {
    if (entry.kind !== "flag") {
      continue;
    }
    if (entry.key === "bend at end") {
      return "bend-at-end";
    }
    if (entry.key === "bend at start") {
      return "bend-at-start";
    }
  }
  return null;
}

function buildParabolaSegment(start: Point, end: Point, mode: "bend-at-start" | "bend-at-end"): ScenePathCommand {
  const control =
    mode === "bend-at-start"
      ? { x: (start.x + end.x) / 2, y: start.y }
      : { x: (start.x + end.x) / 2, y: end.y };

  return quadraticToCubic(start, control, end);
}

function quadraticToCubic(start: Point, control: Point, end: Point): ScenePathCommand {
  return {
    kind: "C",
    c1: {
      x: start.x + (2 / 3) * (control.x - start.x),
      y: start.y + (2 / 3) * (control.y - start.y)
    },
    c2: {
      x: end.x + (2 / 3) * (control.x - end.x),
      y: end.y + (2 / 3) * (control.y - end.y)
    },
    to: end
  };
}

import type { NodeItem, PathStatement } from "../../ast/types.js";
import { DEFAULT_MACRO_EXPANSION_MAX_DEPTH, expandMacroBindings } from "../../macros/index.js";
import type { SemanticContext } from "../context.js";
import { resolveNodePositioningTarget } from "../path/node-positioning.js";
import type { DiagnosticPushFn, FeatureMarkFn, PlacementSegment } from "../path/types.js";
import type { ResolvedStyle, SceneElement } from "../types.js";
import { placeNodeCenter, registerNamedNodeAnchors } from "./anchors.js";
import {
  applyNodeBoxPaintMode,
  makeCircleElement,
  makeNodeBoxElement,
  makeNodeCircularSectorElement,
  makeNodeCloudElement,
  makeNodeCylinderElement,
  makeNodeDartElement,
  makeNodeDiamondElement,
  makeNodeEllipseElement,
  makeNodeIsoscelesTriangleElement,
  makeNodeKiteElement,
  makeNodeRegularPolygonElement,
  makeNodeSemicircleElement,
  makeNodeSignalElement,
  makeNodeStarElement,
  makeNodeStarburstElement,
  makeNodeTapeElement,
  makeNodeTrapeziumElement,
  makeTextElement,
  resolveNodeBoxPaintMode
} from "./elements.js";
import { resolveNodeLayout } from "./layout.js";
import { evaluateMatrixNodeItem, resolveMatrixMode } from "./matrix.js";
import { collectScopedNodeNames } from "./named-coordinates.js";
import {
  computeTransformScale,
  resolveEffectiveNodeOptions,
  resolveNodeAnchor,
  resolveNodeLayer,
  resolveNodeOptionScale,
  resolveNodeShape,
  resolveNodeStyle,
  withDefaultNodePosition
} from "./options.js";
import { resolveNodeShapeGeometryParams } from "./shape-geometry.js";
import { resolveNodeTargetPoint } from "./placement.js";

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
    everyCircleNodeStyles: frame.everyCircleNodeStyles,
    everyDiamondNodeStyles: frame.everyDiamondNodeStyles,
    everyTrapeziumNodeStyles: frame.everyTrapeziumNodeStyles,
    everyIsoscelesTriangleNodeStyles: frame.everyIsoscelesTriangleNodeStyles,
    everyKiteNodeStyles: frame.everyKiteNodeStyles,
    everyDartNodeStyles: frame.everyDartNodeStyles,
    everyCircularSectorNodeStyles: frame.everyCircularSectorNodeStyles,
    everyCylinderNodeStyles: frame.everyCylinderNodeStyles,
    everyCloudNodeStyles: frame.everyCloudNodeStyles,
    everyStarburstNodeStyles: frame.everyStarburstNodeStyles,
    everySignalNodeStyles: frame.everySignalNodeStyles,
    everyTapeNodeStyles: frame.everyTapeNodeStyles
  });
  const effectiveNodeLocalOptions = resolveEffectiveNodeOptions({
    statementOptions: undefined,
    nodeOptions,
    everyNodeStyles: frame.everyNodeStyles,
    everyRectangleNodeStyles: frame.everyRectangleNodeStyles,
    everyCircleNodeStyles: frame.everyCircleNodeStyles,
    everyDiamondNodeStyles: frame.everyDiamondNodeStyles,
    everyTrapeziumNodeStyles: frame.everyTrapeziumNodeStyles,
    everyIsoscelesTriangleNodeStyles: frame.everyIsoscelesTriangleNodeStyles,
    everyKiteNodeStyles: frame.everyKiteNodeStyles,
    everyDartNodeStyles: frame.everyDartNodeStyles,
    everyCircularSectorNodeStyles: frame.everyCircularSectorNodeStyles,
    everyCylinderNodeStyles: frame.everyCylinderNodeStyles,
    everyCloudNodeStyles: frame.everyCloudNodeStyles,
    everyStarburstNodeStyles: frame.everyStarburstNodeStyles,
    everySignalNodeStyles: frame.everySignalNodeStyles,
    everyTapeNodeStyles: frame.everyTapeNodeStyles
  });
  const inheritedTransformScale = frame.transformShape ? computeTransformScale(frame.transform) : 1;
  const nodeOptionScale = resolveNodeOptionScale(effectiveNodeLocalOptions, style, context);
  const transformScale = inheritedTransformScale * nodeOptionScale;
  const nodeStyle = resolveNodeStyle(effectiveNodeOptions, style, context, transformScale);
  const nodeShape = resolveNodeShape(effectiveNodeOptions);
  const anchor = resolveNodeAnchor(effectiveNodeOptions);
  const target = resolveNodeTargetPoint(item, context, item.span, pushDiagnostic, effectiveNodeOptions, segment);
  const resolvedPositioning = resolveNodePositioningTarget(effectiveNodeOptions, context, target);
  for (const code of resolvedPositioning.diagnostics) {
    pushDiagnostic(code, `Node positioning issue: ${code}`, item.span.from, item.span.to);
  }

  const expandedNodeText = expandMacroBindings(item.text, frame.macroBindings, {
    maxDepth: DEFAULT_MACRO_EXPANSION_MAX_DEPTH,
    trace: context.macroTraceCollector ?? undefined
  });
  const resolvedNodeText = resolveTextColorAliases(expandedNodeText, frame.colorAliases);

  const matrixMode = resolveMatrixMode(effectiveNodeOptions);
  if (matrixMode.enabled) {
    return evaluateMatrixNodeItem({
      item,
      statement,
      context,
      style,
      markFeature,
      pushDiagnostic,
      forcedName,
      matrixMode,
      nodeShape,
      nodeStyle,
      effectiveNodeOptions,
      effectiveNodeLocalOptions,
      inheritedTransformScale,
      resolvedPositioning,
      fallbackAnchor: resolvedPositioning.anchorOverride ?? anchor,
      evaluateNestedNode: (matrixCellItem) =>
        evaluateNodeItem(matrixCellItem, statement, context, style, markFeature, pushDiagnostic, null)
    });
  }

  const nodeLayout = resolveNodeLayout(resolvedNodeText, effectiveNodeOptions, nodeStyle, transformScale, context.textEngine);
  const shapeGeometry = resolveNodeShapeGeometryParams(effectiveNodeOptions);
  const center = placeNodeCenter(
    resolvedPositioning.anchorPoint,
    nodeShape,
    nodeLayout,
    resolvedPositioning.anchorOverride ?? anchor,
    effectiveNodeOptions
  );
  const scopedNames = collectScopedNodeNames(forcedName ?? item.name, item.aliases, context);

  for (const name of scopedNames) {
    registerNamedNodeAnchors(context, name, center, nodeShape, nodeLayout, effectiveNodeOptions);
  }

  const nodeElements: SceneElement[] = [];
  const explicitPaintMode = resolveNodeBoxPaintMode(effectiveNodeLocalOptions);
  const resolvedPaintMode = {
    draw:
      explicitPaintMode.draw ||
      (!style.drawExplicit && nodeStyle.drawExplicit && nodeStyle.stroke != null && nodeStyle.stroke !== "none"),
    fill:
      explicitPaintMode.fill ||
      ((style.fill == null || style.fill === "none") && nodeStyle.fill != null && nodeStyle.fill !== "none")
  };
  if (resolvedPaintMode.draw || resolvedPaintMode.fill || nodeStyle.shadowLayers.length > 0) {
    const nodeBoxStyle = applyNodeBoxPaintMode(nodeStyle, resolvedPaintMode);
    if (nodeShape === "circle") {
      nodeElements.push(makeCircleElement(statement.id, center, nodeLayout.visualRadius, nodeBoxStyle, item.span));
      markFeature("shape_circle", "supported");
      markFeature("svg_circle", "supported");
    } else if (nodeShape === "ellipse") {
      nodeElements.push(makeNodeEllipseElement(statement.id, item.id, center, nodeLayout.visualWidth, nodeLayout.visualHeight, nodeBoxStyle, item.span));
      markFeature("keyword_ellipse", "supported");
    } else if (nodeShape === "diamond") {
      nodeElements.push(
        makeNodeDiamondElement(
          statement.id,
          item.id,
          center,
          nodeLayout.visualWidth,
          nodeLayout.visualHeight,
          shapeGeometry.diamondAspect,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_diamond", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "trapezium") {
      nodeElements.push(
        makeNodeTrapeziumElement(
          statement.id,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.trapeziumLeftAngle,
          shapeGeometry.trapeziumRightAngle,
          shapeGeometry.shapeBorderRotate,
          shapeGeometry.trapeziumStretches,
          shapeGeometry.trapeziumStretchesBody,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_trapezium", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "semicircle") {
      nodeElements.push(
        makeNodeSemicircleElement(
          statement.id,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_semicircle", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "isosceles triangle") {
      nodeElements.push(
        makeNodeIsoscelesTriangleElement(
          statement.id,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.isoscelesTriangleApexAngle,
          shapeGeometry.shapeBorderRotate,
          shapeGeometry.isoscelesTriangleStretches,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_isosceles_triangle", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "kite") {
      nodeElements.push(
        makeNodeKiteElement(
          statement.id,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.kiteUpperVertexAngle,
          shapeGeometry.kiteLowerVertexAngle,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_kite", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "dart") {
      nodeElements.push(
        makeNodeDartElement(
          statement.id,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.dartTipAngle,
          shapeGeometry.dartTailAngle,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_dart", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "circular sector") {
      nodeElements.push(
        makeNodeCircularSectorElement(
          statement.id,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.circularSectorAngle,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_circular_sector", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "cylinder") {
      nodeElements.push(
        makeNodeCylinderElement(
          statement.id,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.cylinderAspect,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_cylinder", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "regular polygon") {
      nodeElements.push(
        makeNodeRegularPolygonElement(
          statement.id,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.regularPolygonSides,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_regular_polygon", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "star") {
      nodeElements.push(
        makeNodeStarElement(
          statement.id,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.starPoints,
          shapeGeometry.starPointRatio,
          shapeGeometry.starPointHeightPt,
          shapeGeometry.starUsesPointRatio,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_star", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "cloud") {
      nodeElements.push(
        makeNodeCloudElement(
          statement.id,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.cloudPuffs,
          shapeGeometry.cloudPuffArc,
          shapeGeometry.diamondAspect,
          shapeGeometry.cloudIgnoresAspect,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_cloud", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "starburst") {
      nodeElements.push(
        makeNodeStarburstElement(
          statement.id,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.starburstPoints,
          shapeGeometry.starburstPointHeightPt,
          shapeGeometry.randomStarburstSeed,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_starburst", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "signal") {
      nodeElements.push(
        makeNodeSignalElement(
          statement.id,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.signalPointerAngle,
          shapeGeometry.signalToSides,
          shapeGeometry.signalFromSides,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_signal", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "tape") {
      nodeElements.push(
        makeNodeTapeElement(
          statement.id,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.tapeBendTop,
          shapeGeometry.tapeBendBottom,
          shapeGeometry.tapeBendHeightPt,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_tape", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "rectangle") {
      nodeElements.push(makeNodeBoxElement(statement.id, item.id, center, nodeLayout.visualWidth, nodeLayout.visualHeight, nodeBoxStyle, item.span));
      markFeature("shape_rectangle", "supported");
      markFeature("svg_path", "supported");
    }
  }

  const normalizedText = nodeLayout.textLines.join("\n");
  if (normalizedText.length > 0) {
    nodeElements.push(
      makeTextElement(
        statement.id,
        item.id,
        center,
        nodeStyle,
        item.span,
        normalizedText,
        nodeLayout.textBlockWidth,
        nodeLayout.textBlockHeight,
        nodeLayout.textRenderInfo
      )
    );
    markFeature("svg_text", "supported");
  }

  const layer = resolveNodeLayer(effectiveNodeOptions, context);
  if (layer === "behind") {
    return { behindElements: nodeElements, frontElements: [] };
  }
  return { behindElements: [], frontElements: nodeElements };
}

function resolveTextColorAliases(text: string, colorAliases: Map<string, string>): string {
  if (colorAliases.size === 0 || text.length === 0) {
    return text;
  }

  let resolved = replaceColorCommandAliases(text, "\\textcolor", colorAliases);
  resolved = replaceColorCommandAliases(resolved, "\\color", colorAliases);
  return resolved;
}

function replaceColorCommandAliases(text: string, command: "\\textcolor" | "\\color", colorAliases: Map<string, string>): string {
  const escapedCommand = command.replace("\\", "\\\\");
  const pattern = new RegExp(`${escapedCommand}(\\s*\\[[^\\]]*\\])?\\s*\\{([^{}]+)\\}`, "g");
  return text.replace(pattern, (fullMatch: string, modelPart = "", rawColorName = "") => {
    const resolved = resolveColorAlias(rawColorName, colorAliases);
    if (!resolved) {
      return fullMatch;
    }
    return `${command}${modelPart}{${resolved}}`;
  });
}

function resolveColorAlias(rawColorName: string, colorAliases: Map<string, string>): string | null {
  const initialKey = normalizeColorAliasKey(rawColorName);
  if (!initialKey) {
    return null;
  }

  let resolved = colorAliases.get(initialKey);
  if (!resolved) {
    return null;
  }

  const seen = new Set<string>([initialKey]);
  while (true) {
    const nextKey = normalizeColorAliasKey(resolved);
    if (!nextKey || seen.has(nextKey)) {
      break;
    }
    const nextResolved = colorAliases.get(nextKey);
    if (!nextResolved) {
      break;
    }
    seen.add(nextKey);
    resolved = nextResolved;
  }

  return resolved;
}

function normalizeColorAliasKey(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed;
}

export {
  applyNameScope,
  maybeResolveNamedCoordinateBorderPoint,
  maybeResolveNamedCoordinateBorderPointFromRaw,
  maybeResolveTrailingCoordinateFromNodeName,
  shouldCaptureStandaloneNodeNameCoordinate
} from "./named-coordinates.js";

import type { NodeItem, PathStatement } from "../../ast/types.js";
import { DEFAULT_MACRO_EXPANSION_MAX_DEPTH, expandMacroBindings } from "../../macros/index.js";
import type { OptionEntry, OptionListAst } from "../../options/types.js";
import type { ProvenanceOptionList, SemanticContext } from "../context.js";
import { evaluateRawCoordinate } from "../coords/evaluate.js";
import { applyDecorationToPath } from "../decorations/index.js";
import { appendCircleSubpath, appendEllipseSubpath } from "../path/elements.js";
import { resolveNodePositioningTarget } from "../path/node-positioning.js";
import type { DiagnosticPushFn, FeatureMarkFn, PlacementSegment } from "../path/types.js";
import type { Point, ResolvedStyle, SceneAdornment, SceneElement, ScenePath, ScenePathCommand } from "../types.js";
import { cloneCustomStyleRegistry, walkOptionEntriesWithCustomStyles } from "../style/custom-styles.js";
import { expandOptionListMacros } from "../style/macro-options.js";
import { resolveContextDelta } from "../style/resolve.js";
import { makeNodeAdornmentTargetId } from "../path/label-quotes.js";
import {
  cloneResolvedStyle,
  cloneStyleChain,
  diffResolvedStyle,
  type StyleChainEntry,
  type StyleSourceRef,
  type StyleTraceLayerInput
} from "../style-chain.js";
import { placeNodeCenter, registerNamedNodeAnchors } from "./anchors.js";
import {
  applyNodeBoxPaintMode,
  makeCircleElement,
  makeNodeBoxElement,
  makeNodeCircularSectorElement,
  makeNodeCloudCalloutElement,
  makeNodeCloudElement,
  makeNodeCylinderElement,
  makeNodeDartElement,
  makeNodeDiamondElement,
  makeNodeEllipseCalloutElement,
  makeNodeEllipseElement,
  makeNodeIsoscelesTriangleElement,
  makeNodeKiteElement,
  makeNodeRectangleCalloutElement,
  makeNodeRegularPolygonElement,
  makeNodeSemicircleElement,
  makeNodeSignalElement,
  makeNodeSingleArrowElement,
  makeNodeStarElement,
  makeNodeStarburstElement,
  makeNodeTapeElement,
  makeNodeTrapeziumElement,
  makeNodeDoubleArrowElement,
  makeTextElement,
  resolveNodeBoxPaintMode
} from "./elements.js";
import { adjustNodeLayoutForShape, resolveNodeLayout } from "./layout.js";
import { evaluateMatrixNodeItem, resolveMatrixMode } from "./matrix.js";
import { collectScopedNodeNames } from "./named-coordinates.js";
import {
  computeTransformRotation,
  computeTransformScale,
  resolveEffectiveNodeOptions,
  resolveNodeAnchor,
  resolveNodeLayer,
  resolveNodeOptionScale,
  resolveNodeStyle,
  resolveNodeShape,
  withDefaultNodePosition
} from "./options.js";
import { resolveCalloutPointerOffset, resolveNodeShapeGeometryParams } from "./shape-geometry.js";
import type { NodeShape } from "./types.js";
import { resolveNodeTargetPoint } from "./placement.js";
import { normalizeOptionValue } from "./utils.js";

export type NodeAnchorExtents = {
  left: number;
  right: number;
  up: number;
  down: number;
  halfWidth: number;
  halfHeight: number;
};

export function measureNodeAnchorExtents(
  item: NodeItem,
  statement: PathStatement,
  context: SemanticContext,
  style: ResolvedStyle,
  defaultPositionFraction?: number
): NodeAnchorExtents {
  const frame = context.stack[context.stack.length - 1];
  const everyNodeStyles = item.adornment ? [] : frame.everyNodeStyles;
  const nodeOptions = withDefaultNodePosition(item.options, defaultPositionFraction);
  const effectiveNodeOptions = resolveEffectiveNodeOptions({
    statementOptions: statement.options,
    nodeOptions,
    everyNodeStyles,
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
    everyTapeNodeStyles: frame.everyTapeNodeStyles,
    everyRectangleCalloutNodeStyles: frame.everyRectangleCalloutNodeStyles,
    everyEllipseCalloutNodeStyles: frame.everyEllipseCalloutNodeStyles,
    everyCloudCalloutNodeStyles: frame.everyCloudCalloutNodeStyles,
    everySingleArrowNodeStyles: frame.everySingleArrowNodeStyles,
    everyDoubleArrowNodeStyles: frame.everyDoubleArrowNodeStyles
  });
  const effectiveNodeLocalOptions = resolveEffectiveNodeOptions({
    statementOptions: undefined,
    nodeOptions,
    everyNodeStyles,
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
    everyTapeNodeStyles: frame.everyTapeNodeStyles,
    everyRectangleCalloutNodeStyles: frame.everyRectangleCalloutNodeStyles,
    everyEllipseCalloutNodeStyles: frame.everyEllipseCalloutNodeStyles,
    everyCloudCalloutNodeStyles: frame.everyCloudCalloutNodeStyles,
    everySingleArrowNodeStyles: frame.everySingleArrowNodeStyles,
    everyDoubleArrowNodeStyles: frame.everyDoubleArrowNodeStyles
  });

  const inheritedTransformScale = frame.transformShape ? computeTransformScale(frame.transform) : 1;
  const expandedNodeOptions = expandNodePlacementOptions(effectiveNodeOptions, context);
  const expandedNodeLocalOptions = expandNodePlacementOptions(effectiveNodeLocalOptions, context);
  const nodeOptionScale = resolveNodeOptionScale(expandedNodeLocalOptions, style, context);
  const transformScale = inheritedTransformScale * nodeOptionScale;

  const nodeDecorationBaseStyle: ResolvedStyle = {
    ...style,
    decoration: {
      ...style.decoration,
      enabled: false,
      params: { ...style.decoration.params }
    },
    decorationPreActions: [],
    decorationPostActions: []
  };
  const nodeLocalStyle = resolveNodeStyle(expandedNodeLocalOptions, nodeDecorationBaseStyle, context, transformScale);
  const nodeShape = resolveNodeShape(expandedNodeOptions);
  const expandedNodeText = expandMacroBindings(item.text, frame.macroBindings, {
    maxDepth: DEFAULT_MACRO_EXPANSION_MAX_DEPTH,
    trace: context.macroTraceCollector ?? undefined
  });
  const resolvedNodeText = resolveTextColorAliases(expandedNodeText, frame.colorAliases);
  const baseNodeLayout = resolveNodeLayout(resolvedNodeText, expandedNodeOptions, nodeLocalStyle, transformScale, context.textEngine);
  const nodeLayout = adjustNodeLayoutForShape(baseNodeLayout, nodeShape);
  const anchor = resolveNodeAnchor(expandedNodeOptions);
  const directionalExtents = resolveDirectionalAnchorExtents(anchor, nodeLayout.anchorHalfWidth, nodeLayout.anchorHalfHeight);
  return {
    left: directionalExtents.left,
    right: directionalExtents.right,
    up: directionalExtents.up,
    down: directionalExtents.down,
    halfWidth: nodeLayout.anchorHalfWidth,
    halfHeight: nodeLayout.anchorHalfHeight
  };
}

function resolveDirectionalAnchorExtents(
  anchor: string,
  halfWidth: number,
  halfHeight: number
): { left: number; right: number; up: number; down: number } {
  const normalized = anchor.trim().toLowerCase().replaceAll("_", " ");
  const hasEast = normalized.includes("east");
  const hasWest = normalized.includes("west");
  const hasNorth = normalized.includes("north");
  const hasSouth = normalized.includes("south");

  const left = hasEast ? halfWidth * 2 : hasWest ? 0 : halfWidth;
  const right = hasWest ? halfWidth * 2 : hasEast ? 0 : halfWidth;
  const up = hasSouth ? halfHeight * 2 : hasNorth ? 0 : halfHeight;
  const down = hasNorth ? halfHeight * 2 : hasSouth ? 0 : halfHeight;

  return { left, right, up, down };
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
  defaultPositionFraction?: number,
  defaultTargetPoint?: Point,
  baseStyleChain?: StyleChainEntry[]
): {
  behindElements: SceneElement[];
  frontElements: SceneElement[];
} {
  const frame = context.stack[context.stack.length - 1];
  const effectiveBaseStyleChain = baseStyleChain ?? frame.styleChain;
  const everyNodeStyles = item.adornment ? [] : frame.everyNodeStyles;
  const nodeOptions = withDefaultNodePosition(item.options, defaultPositionFraction);
  const effectiveNodeOptions = resolveEffectiveNodeOptions({
    statementOptions: statement.options,
    nodeOptions,
    everyNodeStyles,
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
    everyTapeNodeStyles: frame.everyTapeNodeStyles,
    everyRectangleCalloutNodeStyles: frame.everyRectangleCalloutNodeStyles,
    everyEllipseCalloutNodeStyles: frame.everyEllipseCalloutNodeStyles,
    everyCloudCalloutNodeStyles: frame.everyCloudCalloutNodeStyles,
    everySingleArrowNodeStyles: frame.everySingleArrowNodeStyles,
    everyDoubleArrowNodeStyles: frame.everyDoubleArrowNodeStyles
  });
  const effectiveNodeLocalOptions = resolveEffectiveNodeOptions({
    statementOptions: undefined,
    nodeOptions,
    everyNodeStyles,
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
    everyTapeNodeStyles: frame.everyTapeNodeStyles,
    everyRectangleCalloutNodeStyles: frame.everyRectangleCalloutNodeStyles,
    everyEllipseCalloutNodeStyles: frame.everyEllipseCalloutNodeStyles,
    everyCloudCalloutNodeStyles: frame.everyCloudCalloutNodeStyles,
    everySingleArrowNodeStyles: frame.everySingleArrowNodeStyles,
    everyDoubleArrowNodeStyles: frame.everyDoubleArrowNodeStyles
  });
  const inheritedTransformScale = frame.transformShape ? computeTransformScale(frame.transform) : 1;
  const expandedNodeOptions = expandNodePlacementOptions(effectiveNodeOptions, context);
  const expandedNodeLocalOptions = expandNodePlacementOptions(effectiveNodeLocalOptions, context);
  const nodeOptionScale = resolveNodeOptionScale(expandedNodeLocalOptions, style, context);
  const transformScale = inheritedTransformScale * nodeOptionScale;
  const nodeDecorationBaseStyle: ResolvedStyle = {
    ...style,
    decoration: {
      ...style.decoration,
      enabled: false,
      params: { ...style.decoration.params }
    },
    decorationPreActions: [],
    decorationPostActions: []
  };
  const nodeLocalStyle = resolveNodeStyle(expandedNodeLocalOptions, nodeDecorationBaseStyle, context, transformScale);
  const nodeShape = resolveNodeShape(expandedNodeOptions);
  const nodeStyleTrace = resolveNodeStyleTrace({
    item,
    statement,
    context,
    baseStyle: style,
    baseStyleChain: effectiveBaseStyleChain,
    nodeShape,
    nodeOptions,
    transformScale
  });
  const nodeStyle = nodeStyleTrace.style;
  const nodeStyleChain = nodeStyleTrace.chain;
  const anchor = resolveAutoNodeAnchor(expandedNodeOptions, segment) ?? resolveNodeAnchor(expandedNodeOptions);
  const target = resolveNodeTargetPoint(item, context, statement.id, item.span, pushDiagnostic, expandedNodeOptions, segment, defaultTargetPoint);
  const resolvedPositioning = resolveNodePositioningTarget(expandedNodeOptions, context, target);
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
      nodeStyleChain,
      effectiveNodeOptions,
      effectiveNodeLocalOptions,
      inheritedTransformScale,
      resolvedPositioning,
      fallbackAnchor: resolvedPositioning.anchorOverride ?? anchor,
      evaluateNestedNode: (matrixCellItem, defaultTargetPoint) =>
        evaluateNodeItem(
          matrixCellItem,
          statement,
          context,
          style,
          markFeature,
          pushDiagnostic,
          null,
          undefined,
          undefined,
          defaultTargetPoint,
          effectiveBaseStyleChain
        )
    });
  }

  const baseNodeLayout = resolveNodeLayout(resolvedNodeText, expandedNodeOptions, nodeStyle, transformScale, context.textEngine);
  const nodeLayout = adjustNodeLayoutForShape(baseNodeLayout, nodeShape);
  const shapeGeometry = resolveNodeShapeGeometryParams(expandedNodeOptions);
  const slopedRotation = resolveSlopedNodeRotation(expandedNodeOptions, segment);
  const optionRotation = resolveNodeOptionRotation(expandedNodeOptions);
  const localTextRotation =
    optionRotation != null && slopedRotation != null
      ? optionRotation + slopedRotation
      : (optionRotation ?? slopedRotation ?? 0);
  const inheritedTextRotation = frame.transformShape ? computeTransformRotation(frame.transform) : 0;
  const combinedTextRotation = localTextRotation + inheritedTextRotation;
  const textRotation = Math.abs(combinedTextRotation) > 1e-6 ? combinedTextRotation : undefined;
  const nodeShapeRotation = textRotation ?? 0;
  const center = placeNodeCenter(
    resolvedPositioning.anchorPoint,
    nodeShape,
    nodeLayout,
    resolvedPositioning.anchorOverride ?? anchor,
    expandedNodeOptions,
    textRotation ?? 0
  );
  const setNames = collectSetNames(expandedNodeOptions);
  let scopedNames = collectScopedNodeNames(forcedName ?? item.name, item.aliases, context);
  if (scopedNames.length === 0 && setNames.length > 0) {
    scopedNames = collectScopedNodeNames(makeGeneratedSetMemberName(item), undefined, context);
  }

  for (const name of scopedNames) {
    registerNamedNodeAnchors(context, name, center, nodeShape, nodeLayout, expandedNodeOptions, textRotation ?? 0, statement.id);
  }
  registerNodeSetMembership(scopedNames, setNames, context);

  const nodeElements: SceneElement[] = [];
  const pushNodeElement = (element: SceneElement): void => {
    const rotatedElement = rotateNodeElementGeometry(element, center, nodeShapeRotation);
    rotatedElement.styleChain = cloneStyleChain(nodeStyleChain);
    nodeElements.push(rotatedElement);
  };
  const explicitPaintMode = resolveNodeBoxPaintMode(expandedNodeLocalOptions);
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
    const calloutPointerOffset = resolveCalloutPointerOffset(shapeGeometry, context, center);
    if (nodeShape === "circle") {
      pushNodeElement(makeCircleElement(statement.id, center, nodeLayout.visualRadius, nodeBoxStyle, item.span));
      markFeature("shape_circle", "supported");
      markFeature("svg_circle", "supported");
    } else if (nodeShape === "ellipse") {
      pushNodeElement(makeNodeEllipseElement(statement.id, item.id, center, nodeLayout.visualWidth, nodeLayout.visualHeight, nodeBoxStyle, item.span));
      markFeature("shape_ellipse", "supported");
    } else if (nodeShape === "diamond") {
      pushNodeElement(
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
      pushNodeElement(
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
      pushNodeElement(
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
      pushNodeElement(
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
      pushNodeElement(
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
      pushNodeElement(
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
      pushNodeElement(
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
      pushNodeElement(
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
      pushNodeElement(
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
      pushNodeElement(
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
      pushNodeElement(
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
      pushNodeElement(
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
      pushNodeElement(
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
      pushNodeElement(
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
    } else if (nodeShape === "rectangle callout") {
      pushNodeElement(
        makeNodeRectangleCalloutElement(
          statement.id,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          calloutPointerOffset,
          shapeGeometry.calloutPointerWidthPt,
          shapeGeometry.calloutPointerIsAbsolute,
          shapeGeometry.calloutPointerShortenPt,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_rectangle_callout", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "ellipse callout") {
      pushNodeElement(
        makeNodeEllipseCalloutElement(
          statement.id,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          calloutPointerOffset,
          shapeGeometry.calloutPointerArc,
          shapeGeometry.calloutPointerIsAbsolute,
          shapeGeometry.calloutPointerShortenPt,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_ellipse_callout", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "cloud callout") {
      pushNodeElement(
        makeNodeCloudCalloutElement(
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
          calloutPointerOffset,
          shapeGeometry.calloutPointerStartSizeRaw,
          shapeGeometry.calloutPointerEndSizeRaw,
          shapeGeometry.calloutPointerSegments,
          shapeGeometry.calloutPointerIsAbsolute,
          shapeGeometry.calloutPointerShortenPt,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_cloud_callout", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "single arrow") {
      pushNodeElement(
        makeNodeSingleArrowElement(
          statement.id,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.singleArrowTipAngle,
          shapeGeometry.singleArrowHeadExtendPt,
          shapeGeometry.singleArrowHeadIndentPt,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_single_arrow", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "double arrow") {
      pushNodeElement(
        makeNodeDoubleArrowElement(
          statement.id,
          item.id,
          center,
          nodeLayout.naturalWidth,
          nodeLayout.naturalHeight,
          nodeLayout.minimumWidth,
          nodeLayout.minimumHeight,
          shapeGeometry.doubleArrowTipAngle,
          shapeGeometry.doubleArrowHeadExtendPt,
          shapeGeometry.doubleArrowHeadIndentPt,
          shapeGeometry.shapeBorderRotate,
          nodeBoxStyle,
          item.span
        )
      );
      markFeature("shape_double_arrow", "supported");
      markFeature("svg_path", "supported");
    } else if (nodeShape === "rectangle") {
      pushNodeElement(makeNodeBoxElement(statement.id, item.id, center, nodeLayout.visualWidth, nodeLayout.visualHeight, nodeBoxStyle, item.span));
      markFeature("shape_rectangle", "supported");
      markFeature("svg_path", "supported");
    }
  }

  const normalizedText = nodeLayout.textLines.join("\n");
  if (normalizedText.length > 0) {
    pushNodeElement(
      makeTextElement(
        statement.id,
        item.id,
        center,
        nodeStyle,
        item.span,
        normalizedText,
        nodeLayout.textBlockWidth,
        nodeLayout.textBlockHeight,
        nodeLayout.textRenderInfo,
        textRotation,
        undefined,
        item.textSpan,
        hasTextWidthOption(expandedNodeOptions)
      )
    );
    markFeature("svg_text", "supported");
  }

  const renderedNodeElements = applyNodeDecorations(
    nodeElements,
    nodeLocalStyle.decoration,
    `${statement.id}:${item.id}`,
    markFeature,
    pushDiagnostic
  );
  const adornmentMetadata = item.adornment;
  const editableNodeElements = adornmentMetadata
    ? renderedNodeElements.map((element) => attachAdornmentMetadata(element, adornmentMetadata, center))
    : renderedNodeElements;
  const layer = resolveNodeLayer(expandedNodeOptions, context);
  if (layer === "behind") {
    return { behindElements: editableNodeElements, frontElements: [] };
  }
  return { behindElements: [], frontElements: editableNodeElements };
}

function attachAdornmentMetadata(
  element: SceneElement,
  adornment: NonNullable<NodeItem["adornment"]>,
  ownerPoint: Point
): SceneElement {
  const metadata: SceneAdornment = {
    targetId: makeNodeAdornmentTargetId(adornment.ownerNodeId, adornment.adornmentIndex, adornment.kind),
    kind: adornment.kind,
    ownerSourceId: adornment.ownerSourceId,
    ownerNodeId: adornment.ownerNodeId,
    adornmentIndex: adornment.adornmentIndex,
    optionSpan: adornment.optionSpan,
    valueSpan: adornment.valueSpan,
    textSpan: adornment.textSpan,
    angleRaw: adornment.angleRaw,
    angleSpan: adornment.angleSpan,
    distancePt: adornment.distancePt,
    defaultDistancePt: adornment.defaultDistancePt,
    distanceExplicit: adornment.distanceExplicit,
    ownerPoint,
    ownerGeometry: adornment.ownerGeometry
  };

  return {
    ...element,
    adornment: metadata
  };
}

function resolveNodeStyleTrace(params: {
  item: NodeItem;
  statement: PathStatement;
  context: SemanticContext;
  baseStyle: ResolvedStyle;
  baseStyleChain: StyleChainEntry[];
  nodeShape: NodeShape;
  nodeOptions: OptionListAst | undefined;
  transformScale: number;
}): { style: ResolvedStyle; chain: StyleChainEntry[] } {
  const frame = params.context.stack[params.context.stack.length - 1];
  const macroTrace = params.context.macroTraceCollector ?? undefined;
  const everyNodeLayers = expandProvenanceOptionLayers(frame.everyNodeStyles, frame, macroTrace);
  const includeEveryNodeLayers = !params.item.adornment;
  const everyShapeLayers = expandProvenanceOptionLayers(resolveEveryShapeNodeStyleLayers(frame, params.nodeShape), frame, macroTrace);
  const expandedStatementOptions = params.statement.options
    ? expandOptionListMacros([params.statement.options], frame.macroBindings, macroTrace)
    : [];
  const expandedNodeOptions = params.nodeOptions ? expandOptionListMacros([params.nodeOptions], frame.macroBindings, macroTrace) : [];
  const commandOptions = [...expandedStatementOptions, ...expandedNodeOptions];

  const layers: StyleTraceLayerInput[] = [
    ...(includeEveryNodeLayers
      ? everyNodeLayers.map(
          (layer): StyleTraceLayerInput => ({
            kind: "every-node",
            sourceRef: layer.sourceRef,
            rawOptions: [layer.options]
          })
        )
      : []),
    ...everyShapeLayers.map(
      (layer): StyleTraceLayerInput => ({
        kind: "every-shape",
        shape: params.nodeShape,
        sourceRef: layer.sourceRef,
        rawOptions: [layer.options]
      })
    )
  ];
  if (commandOptions.length > 0) {
    layers.push({
      kind: "command",
      sourceRef: {
        sourceId: params.item.id,
        sourceSpan: params.item.optionsSpan ?? params.item.span,
        sourceKind: "node-options",
        label: "node"
      },
      rawOptions: commandOptions
    });
  }

  const resolved = resolveContextDelta(
    params.baseStyle,
    frame.transform,
    layers,
    cloneCustomStyleRegistry(frame.customStyles),
    (raw) => evaluateRawCoordinate(raw, params.context).world,
    params.baseStyleChain,
    frame.colorAliases
  );

  const scaledStyle = applyNodeTransformScale(resolved.style, params.transformScale);
  const scaleContributions = diffResolvedStyle(resolved.style, scaledStyle);
  if (Object.keys(scaleContributions).length === 0) {
    return { style: scaledStyle, chain: resolved.chain };
  }

  const scaleSourceRef: StyleSourceRef = {
    sourceId: params.item.id,
    sourceSpan: params.item.span,
    sourceKind: "node-transform-scale",
    label: "node transform scale"
  };
  return {
    style: scaledStyle,
    chain: [
      ...resolved.chain,
      {
        kind: "command",
        sourceRef: scaleSourceRef,
        rawOptions: [],
        before: cloneResolvedStyle(resolved.style),
        after: cloneResolvedStyle(scaledStyle),
        resolvedContributions: scaleContributions
      }
    ]
  };
}

function applyNodeTransformScale(style: ResolvedStyle, transformScale: number): ResolvedStyle {
  if (Math.abs(transformScale - 1) <= 1e-6) {
    return style;
  }
  return {
    ...style,
    lineWidth: style.lineWidth * transformScale,
    doubleDistance: style.doubleDistance * transformScale,
    fontSize: style.fontSize * transformScale
  };
}

function expandProvenanceOptionLayers(
  layers: ProvenanceOptionList[],
  frame: SemanticContext["stack"][number],
  macroTrace: SemanticContext["macroTraceCollector"] | undefined
): ProvenanceOptionList[] {
  if (layers.length === 0) {
    return [];
  }

  const expanded: ProvenanceOptionList[] = [];
  for (const layer of layers) {
    const expandedOptions = expandOptionListMacros([layer.options], frame.macroBindings, macroTrace ?? undefined);
    if (expandedOptions.length === 0) {
      expanded.push(layer);
      continue;
    }
    for (const optionList of expandedOptions) {
      expanded.push({
        options: optionList,
        sourceRef: layer.sourceRef
      });
    }
  }
  return expanded;
}

function resolveEveryShapeNodeStyleLayers(frame: SemanticContext["stack"][number], nodeShape: NodeShape): ProvenanceOptionList[] {
  if (nodeShape === "circle") {
    return frame.everyCircleNodeStyles;
  }
  if (nodeShape === "rectangle") {
    return frame.everyRectangleNodeStyles;
  }
  if (nodeShape === "diamond") {
    return frame.everyDiamondNodeStyles;
  }
  if (nodeShape === "trapezium") {
    return frame.everyTrapeziumNodeStyles;
  }
  if (nodeShape === "isosceles triangle") {
    return frame.everyIsoscelesTriangleNodeStyles;
  }
  if (nodeShape === "kite") {
    return frame.everyKiteNodeStyles;
  }
  if (nodeShape === "dart") {
    return frame.everyDartNodeStyles;
  }
  if (nodeShape === "circular sector") {
    return frame.everyCircularSectorNodeStyles;
  }
  if (nodeShape === "cylinder") {
    return frame.everyCylinderNodeStyles;
  }
  if (nodeShape === "cloud") {
    return frame.everyCloudNodeStyles;
  }
  if (nodeShape === "starburst") {
    return frame.everyStarburstNodeStyles;
  }
  if (nodeShape === "signal") {
    return frame.everySignalNodeStyles;
  }
  if (nodeShape === "tape") {
    return frame.everyTapeNodeStyles;
  }
  if (nodeShape === "rectangle callout") {
    return frame.everyRectangleCalloutNodeStyles;
  }
  if (nodeShape === "ellipse callout") {
    return frame.everyEllipseCalloutNodeStyles;
  }
  if (nodeShape === "cloud callout") {
    return frame.everyCloudCalloutNodeStyles;
  }
  if (nodeShape === "single arrow") {
    return frame.everySingleArrowNodeStyles;
  }
  if (nodeShape === "double arrow") {
    return frame.everyDoubleArrowNodeStyles;
  }
  return [];
}

function resolveAutoNodeAnchor(options: NodeItem["options"], segment: PlacementSegment | null): string | null {
  if (!options || !segment) {
    return null;
  }

  const hasExplicitAnchor = options.entries.some((entry) => entry.kind === "kv" && entry.key === "anchor");
  if (hasExplicitAnchor) {
    return null;
  }

  let autoSide: "left" | "right" | null = null;
  let swap = false;
  const sloped = hasSlopedOption(options);

  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "auto") {
        autoSide = "left";
      } else if (entry.key === "swap") {
        swap = !swap;
      }
      continue;
    }

    if (entry.kind !== "kv") {
      continue;
    }

    if (entry.key === "auto") {
      const normalized = entry.valueRaw.trim().toLowerCase();
      if (normalized === "right") {
        autoSide = "right";
      } else if (
        normalized === "left" ||
        normalized === "true" ||
        normalized === "yes" ||
        normalized === "on" ||
        normalized === "1"
      ) {
        autoSide = "left";
      } else if (
        normalized === "false" ||
        normalized === "no" ||
        normalized === "off" ||
        normalized === "0"
      ) {
        autoSide = null;
      }
      continue;
    }

    if (entry.key === "swap") {
      const normalized = entry.valueRaw.trim().toLowerCase();
      if (normalized === "true" || normalized === "yes" || normalized === "on" || normalized === "1") {
        swap = true;
      } else if (normalized === "false" || normalized === "no" || normalized === "off" || normalized === "0") {
        swap = false;
      }
    }
  }

  if (!autoSide) {
    return null;
  }

  if (sloped) {
    const tangent = segmentTangent(segment);
    if (!tangent) {
      return null;
    }

    let normal = {
      x: -tangent.y,
      y: tangent.x
    };
    if (autoSide === "right") {
      normal = {
        x: -normal.x,
        y: -normal.y
      };
    }
    if (swap) {
      normal = {
        x: -normal.x,
        y: -normal.y
      };
    }

    const slopedRotation =
      resolveSlopedNodeRotation(options, segment) ??
      (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI;
    const theta = (slopedRotation * Math.PI) / 180;
    const northDirection = {
      x: -Math.sin(theta),
      y: Math.cos(theta)
    };
    const dot = normal.x * northDirection.x + normal.y * northDirection.y;
    return dot >= 0 ? "south" : "north";
  }

  const tangent = segmentTangent(segment);
  if (!tangent) {
    return null;
  }

  let normal = {
    x: -tangent.y,
    y: tangent.x
  };
  if (autoSide === "right") {
    normal = {
      x: -normal.x,
      y: -normal.y
    };
  }
  if (swap) {
    normal = {
      x: -normal.x,
      y: -normal.y
    };
  }

  const anchorDirection = {
    x: -normal.x,
    y: -normal.y
  };
  return directionToAnchor(anchorDirection);
}

function resolveSlopedNodeRotation(options: NodeItem["options"], segment: PlacementSegment | null): number | null {
  if (!options || !segment) {
    return null;
  }

  if (!hasSlopedOption(options)) {
    return null;
  }

  const tangent = segmentTangent(segment);
  if (!tangent) {
    return null;
  }

  let rotation = (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI;
  if (!allowsUpsideDown(options)) {
    if (rotation > 90) {
      rotation -= 180;
    } else if (rotation <= -90) {
      rotation += 180;
    }
  }
  return rotation;
}

function hasSlopedOption(options: NodeItem["options"]): boolean {
  if (!options) {
    return false;
  }

  let sloped = false;
  for (const entry of options.entries) {
    if (entry.kind === "flag" && entry.key === "sloped") {
      sloped = true;
      continue;
    }
    if (entry.kind !== "kv" || entry.key !== "sloped") {
      continue;
    }
    const normalized = normalizeOptionValue(entry.valueRaw).toLowerCase();
    sloped = normalized.length === 0 || normalized === "true" || normalized === "yes" || normalized === "on" || normalized === "1";
  }

  return sloped;
}

function resolveNodeOptionRotation(options: NodeItem["options"]): number | null {
  if (!options) {
    return null;
  }

  let rotation: number | null = null;
  for (const entry of options.entries) {
    if (entry.kind !== "kv" || entry.key !== "rotate") {
      continue;
    }
    const parsed = Number(normalizeOptionValue(entry.valueRaw));
    if (Number.isFinite(parsed)) {
      rotation = parsed;
    }
  }
  return rotation;
}

function allowsUpsideDown(options: NodeItem["options"]): boolean {
  if (!options) {
    return false;
  }

  let allow = false;
  for (const entry of options.entries) {
    if (entry.kind === "flag" && entry.key === "allow upside down") {
      allow = true;
      continue;
    }
    if (entry.kind !== "kv" || entry.key !== "allow upside down") {
      continue;
    }
    const normalized = normalizeOptionValue(entry.valueRaw).toLowerCase();
    if (normalized.length === 0 || normalized === "true" || normalized === "yes" || normalized === "on" || normalized === "1") {
      allow = true;
      continue;
    }
    if (normalized === "false" || normalized === "no" || normalized === "off" || normalized === "0") {
      allow = false;
    }
  }

  return allow;
}

function expandNodePlacementOptions(options: OptionListAst | undefined, context: SemanticContext): OptionListAst | undefined {
  if (!options) {
    return undefined;
  }

  const frame = context.stack[context.stack.length - 1];
  const expandedLists = expandOptionListMacros([options], frame.macroBindings, context.macroTraceCollector ?? undefined);
  const expandedEntries: OptionEntry[] = [];
  const diagnostics: string[] = [];
  walkOptionEntriesWithCustomStyles(
    expandedLists,
    cloneCustomStyleRegistry(frame.customStyles),
    (entry) => {
      expandedEntries.push(entry);
    },
    diagnostics
  );
  if (expandedEntries.length === 0) {
    return options;
  }

  return {
    span: options.span,
    raw: options.raw,
    entries: expandedEntries
  };
}

function segmentTangent(segment: PlacementSegment): Point | null {
  let tangent: Point;
  if (segment.kind === "line") {
    tangent = {
      x: segment.to.x - segment.from.x,
      y: segment.to.y - segment.from.y
    };
  } else if (segment.kind === "hv") {
    tangent = {
      x: segment.to.x - segment.bend.x,
      y: segment.to.y - segment.bend.y
    };
  } else if (segment.kind === "cubic") {
    tangent = {
      x: segment.to.x - segment.c2.x,
      y: segment.to.y - segment.c2.y
    };
    if (Math.hypot(tangent.x, tangent.y) <= 1e-9) {
      tangent = {
        x: segment.to.x - segment.from.x,
        y: segment.to.y - segment.from.y
      };
    }
  } else {
    tangent = {
      x: segment.to.x - segment.from.x,
      y: segment.to.y - segment.from.y
    };
  }

  const len = Math.hypot(tangent.x, tangent.y);
  if (!Number.isFinite(len) || len <= 1e-9) {
    return null;
  }
  return {
    x: tangent.x / len,
    y: tangent.y / len
  };
}

function directionToAnchor(direction: Point): string {
  const len = Math.hypot(direction.x, direction.y);
  if (!Number.isFinite(len) || len <= 1e-9) {
    return "center";
  }
  const x = direction.x / len;
  const y = direction.y / len;

  const absX = Math.abs(x);
  const absY = Math.abs(y);
  if (absX <= 0.35) {
    return y >= 0 ? "north" : "south";
  }
  if (absY <= 0.35) {
    return x >= 0 ? "east" : "west";
  }
  if (x >= 0 && y >= 0) {
    return "north east";
  }
  if (x >= 0 && y < 0) {
    return "south east";
  }
  if (x < 0 && y >= 0) {
    return "north west";
  }
  return "south west";
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

function rotateNodeElementGeometry(element: SceneElement, center: Point, rotation: number): SceneElement {
  if (Math.abs(rotation) <= 1e-6 || element.kind === "Text") {
    return element;
  }

  if (element.kind === "Path") {
    return {
      ...element,
      commands: element.commands.map((command) => rotateScenePathCommand(command, center, rotation))
    };
  }

  if (element.kind === "Circle") {
    return {
      ...element,
      center: rotatePointAround(element.center, center, rotation)
    };
  }

  const rotated = normalizeRotationDegrees((element.rotation ?? 0) + rotation);
  return {
    ...element,
    center: rotatePointAround(element.center, center, rotation),
    rotation: Math.abs(rotated) > 1e-6 ? rotated : undefined
  };
}

function rotateScenePathCommand(command: ScenePathCommand, center: Point, rotation: number): ScenePathCommand {
  if (command.kind === "Z") {
    return { kind: "Z" };
  }

  if (command.kind === "M" || command.kind === "L") {
    return {
      kind: command.kind,
      to: rotatePointAround(command.to, center, rotation)
    };
  }

  if (command.kind === "C") {
    return {
      kind: "C",
      c1: rotatePointAround(command.c1, center, rotation),
      c2: rotatePointAround(command.c2, center, rotation),
      to: rotatePointAround(command.to, center, rotation)
    };
  }

  return {
    kind: "A",
    rx: command.rx,
    ry: command.ry,
    xAxisRotation: normalizeRotationDegrees(command.xAxisRotation + rotation),
    largeArc: command.largeArc,
    sweep: command.sweep,
    to: rotatePointAround(command.to, center, rotation)
  };
}

function rotatePointAround(point: Point, center: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;

  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos
  };
}

function normalizeRotationDegrees(degrees: number): number {
  if (!Number.isFinite(degrees)) {
    return 0;
  }

  let normalized = degrees % 360;
  if (normalized <= -180) {
    normalized += 360;
  } else if (normalized > 180) {
    normalized -= 360;
  }
  return normalized;
}

function applyNodeDecorations(
  elements: SceneElement[],
  decoration: ResolvedStyle["decoration"],
  seedPrefix: string,
  markFeature: FeatureMarkFn,
  pushDiagnostic: DiagnosticPushFn
): SceneElement[] {
  if (!decoration.enabled) {
    return elements;
  }

  const decorationName = canonicalDecorationName(decoration.name);
  if (!decorationName || decorationName === "none") {
    return elements;
  }

  markFeature("decorate_option", "supported");
  markNodeDecorationFeature(decorationName, "supported", markFeature);

  const output: SceneElement[] = [];
  for (const element of elements) {
    const path = toDecoratableNodePath(element);
    if (!path) {
      output.push(element);
      continue;
    }

    const outcome = applyDecorationToPath(path, decoration, `${seedPrefix}:${element.id}`);
    if (outcome.kind === "unsupported") {
      markNodeDecorationFeature(outcome.name, "unsupported", markFeature);
      pushDiagnostic(
        `unsupported-decoration-name:${outcome.name}`,
        outcome.reason === "deferred"
          ? `Decoration \`${outcome.name}\` is parsed but deferred because it requires dynamic TeX code execution.`
          : `Decoration \`${outcome.name}\` is not implemented; keeping the undecorated path.`,
        path.sourceRef.sourceSpan.from,
        path.sourceRef.sourceSpan.to
      );
      output.push(element);
      continue;
    }

    output.push(...outcome.elements);
  }

  return output;
}

function toDecoratableNodePath(element: SceneElement): ScenePath | null {
  if (element.kind === "Path") {
    return element;
  }

  if (element.kind === "Circle") {
    const commands: ScenePath["commands"] = [];
    appendCircleSubpath(commands, element.center, element.radius);
    return {
      kind: "Path",
      id: `${element.id}:as-path`,
      runtimeId: `${element.runtimeId}:as-path`,
      sourceRef: {
        sourceId: element.sourceRef.sourceId,
        sourceSpan: element.sourceRef.sourceSpan,
        sourceFingerprint: element.sourceRef.sourceFingerprint
      },
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
      runtimeId: `${element.runtimeId}:as-path`,
      sourceRef: {
        sourceId: element.sourceRef.sourceId,
        sourceSpan: element.sourceRef.sourceSpan,
        sourceFingerprint: element.sourceRef.sourceFingerprint
      },
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

function markNodeDecorationFeature(nameRaw: string, status: "supported" | "unsupported", markFeature: FeatureMarkFn): void {
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
    name === "brace" ||
    name === "text along path"
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

function registerNodeSetMembership(nodeNames: string[], setNames: string[], context: SemanticContext): void {
  if (nodeNames.length === 0 || setNames.length === 0) {
    return;
  }

  for (const setName of setNames) {
    const existingMembers = context.namedNodeSets.get(setName);
    const members = existingMembers ? new Set(existingMembers) : new Set<string>();
    let changed = !existingMembers;
    for (const nodeName of nodeNames) {
      if (members.has(nodeName)) {
        continue;
      }
      members.add(nodeName);
      changed = true;
    }
    if (changed) {
      context.namedNodeSets.set(setName, members);
    }
  }
}

function collectSetNames(options: OptionListAst | undefined): string[] {
  if (!options) {
    return [];
  }
  const names: string[] = [];
  for (const entry of options.entries) {
    if (entry.kind !== "kv" || entry.key !== "set") {
      continue;
    }
    const parts = splitTopLevelCommas(entry.valueRaw);
    for (const part of parts) {
      const normalized = normalizeOptionValue(part).trim();
      if (normalized.length > 0) {
        names.push(normalized);
      }
    }
  }
  return Array.from(new Set(names));
}

function hasTextWidthOption(options: OptionListAst | undefined): boolean {
  if (!options) {
    return false;
  }
  for (const entry of options.entries) {
    if (entry.kind === "kv" && entry.key === "text width") {
      return true;
    }
  }
  return false;
}

function splitTopLevelCommas(raw: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depthBrace = 0;
  let depthSquare = 0;
  let depthParen = 0;
  let inQuote = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (char === "\\" && index + 1 < raw.length) {
      index += 1;
      continue;
    }
    if (char === '"' && raw[index - 1] !== "\\") {
      inQuote = !inQuote;
      continue;
    }
    if (inQuote) {
      continue;
    }
    if (char === "{") {
      depthBrace += 1;
      continue;
    }
    if (char === "}") {
      depthBrace = Math.max(0, depthBrace - 1);
      continue;
    }
    if (char === "[") {
      depthSquare += 1;
      continue;
    }
    if (char === "]") {
      depthSquare = Math.max(0, depthSquare - 1);
      continue;
    }
    if (char === "(") {
      depthParen += 1;
      continue;
    }
    if (char === ")") {
      depthParen = Math.max(0, depthParen - 1);
      continue;
    }
    if (char === "," && depthBrace === 0 && depthSquare === 0 && depthParen === 0) {
      parts.push(raw.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(raw.slice(start));
  return parts;
}

function makeGeneratedSetMemberName(item: NodeItem): string {
  const from = Math.max(0, item.span.from);
  const to = Math.max(0, item.span.to);
  return `graph_set_node_${from}_${to}`;
}

export {
  applyNameScope,
  maybeResolveNamedCoordinateBorderPoint,
  maybeResolveNamedCoordinateBorderPointFromRaw,
  maybeResolveNamedCoordinateBorderPointFromRawAlongAngle,
  maybeResolveTrailingCoordinateFromNodeName,
  shouldCaptureStandaloneNodeNameCoordinate
} from "./named-coordinates.js";

import type { NodeItem, PathStatement } from "../../ast/types.js";
import type { SemanticContext } from "../context.js";
import { resolveNodePositioningTarget } from "../path/node-positioning.js";
import type { DiagnosticPushFn, FeatureMarkFn, PlacementSegment } from "../path/types.js";
import type { ResolvedStyle, SceneElement } from "../types.js";
import { placeNodeCenter, registerNamedNodeAnchors } from "./anchors.js";
import {
  applyNodeBoxPaintMode,
  makeCircleElement,
  makeNodeBoxElement,
  makeNodeEllipseElement,
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
  const nodeShape = resolveNodeShape(effectiveNodeOptions);
  const anchor = resolveNodeAnchor(effectiveNodeOptions);
  const target = resolveNodeTargetPoint(item, context, item.span, pushDiagnostic, effectiveNodeOptions, segment);
  const resolvedPositioning = resolveNodePositioningTarget(effectiveNodeOptions, context, target);
  for (const code of resolvedPositioning.diagnostics) {
    pushDiagnostic(code, `Node positioning issue: ${code}`, item.span.from, item.span.to);
  }

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

  const nodeLayout = resolveNodeLayout(item.text, effectiveNodeOptions, nodeStyle, transformScale, context.textEngine);
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
  if (boxPaintMode.draw || boxPaintMode.fill || nodeStyle.shadowLayers.length > 0) {
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

export {
  applyNameScope,
  maybeResolveNamedCoordinateBorderPoint,
  maybeResolveNamedCoordinateBorderPointFromRaw,
  maybeResolveTrailingCoordinateFromNodeName,
  shouldCaptureStandaloneNodeNameCoordinate
} from "./named-coordinates.js";

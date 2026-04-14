import type { NodeItem, PathStatement } from "../../ast/types.js";
import { parseCoordinate } from "../../domains/coordinates/parse.js";
import { DEFAULT_MACRO_EXPANSION_MAX_DEPTH, expandMacroBindings } from "../../macros/index.js";
import { parseOptionListRaw } from "../../options/parse.js";
import type { OptionEntry, OptionListAst } from "../../options/types.js";
import { stripWrappingBraces } from "../../utils/braces.js";
import {
  readNamedNodeGeometry,
  resolveContextColorAliasValue,
  type ProvenanceOptionList,
  type SemanticContext
} from "../context.js";
import { evaluateRawCoordinate } from "../coords/evaluate.js";
import { parseQuantityExpression } from "../coords/parse-length.js";
import { applyDecorationToPath } from "../decorations/index.js";
import { appendCircleSubpath, appendEllipseSubpath } from "../path/elements.js";
import {
  currentAnchorForDirection,
  resolveNodePositioningTarget,
  targetAnchorForDirection,
  type PositioningDirection
} from "../path/node-positioning.js";
import {
  resolvePathAttachedNodeRegime,
  resolvePathAttachedNodeSloped,
  resolvePathPositionFraction
} from "../path/path-attached.js";
import type { DiagnosticPushFn, FeatureMarkFn, PlacementSegment } from "../path/types.js";
import type { Matrix2D, Point, ResolvedStyle, SceneAdornment, SceneElement, ScenePath, ScenePathAttachment, ScenePathCommand } from "../types.js";
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
import { nodeAnchorOffset, placeNodeCenter, registerNamedNodeAnchors } from "./anchors.js";
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
  resolveEffectiveNodeOptions,
  resolveNodeAnchor,
  resolveNodeLayer,
  resolveNodeOptionTransform,
  resolveNodeStyle,
  resolveNodeShape,
  withDefaultNodePosition
} from "./options.js";
import { resolveCalloutPointerOffset, resolveNodeShapeGeometryParams } from "./shape-geometry.js";
import type { NodeShape } from "./types.js";
import { resolveNodeTargetPoint } from "./placement.js";
import { normalizeEscapedTextSpaces, normalizeNodeTextFontSize } from "./normalize-text.js";
import { normalizeOptionValue } from "./utils.js";
import { applyMatrixToVector, identityMatrix, multiplyMatrix, rotationMatrix } from "../transform.js";
import type { PgfRandom } from "../pgfmath/rng.js";

const CONTINUOUS_POSITIONING_DIRECTIONS: PositioningDirection[] = [
  "above",
  "below",
  "left",
  "right",
  "above left",
  "above right",
  "below left",
  "below right"
];

export type NodeAnchorExtents = {
  left: number;
  right: number;
  up: number;
  down: number;
  halfWidth: number;
  halfHeight: number;
};

function computePositioningAnchorOffsetsByDirection(params: {
  targetNodeName: string;
  targetCenter: Point;
  currentCenter: Point;
  context: SemanticContext;
  legacyOf: boolean;
  nodeShape: NodeShape;
  nodeLayout: ReturnType<typeof adjustNodeLayoutForShape>;
  nodeOptions: OptionListAst | undefined;
  nodeTransform: Matrix2D;
}): Record<string, { targetAnchor: Point; currentAnchor: Point }> {
  const {
    targetNodeName,
    targetCenter,
    currentCenter,
    context,
    legacyOf,
    nodeShape,
    nodeLayout,
    nodeOptions,
    nodeTransform
  } = params;
  const offsets: Record<string, { targetAnchor: Point; currentAnchor: Point }> = {};

  for (const direction of CONTINUOUS_POSITIONING_DIRECTIONS) {
    const currentAnchor = applyMatrixToVector(
      nodeTransform,
      nodeAnchorOffset(nodeShape, nodeLayout, currentAnchorForDirection(direction), nodeOptions)
    );
    let targetAnchor: Point = { x: 0, y: 0 };

    if (!legacyOf) {
      const targetAnchorPoint = evaluateRawCoordinate(
        `(${targetNodeName}.${targetAnchorForDirection(direction)})`,
        context
      ).world;
      if (targetAnchorPoint) {
        targetAnchor = {
          x: targetAnchorPoint.x - targetCenter.x,
          y: targetAnchorPoint.y - targetCenter.y
        };
      }
    }

    offsets[direction] = {
      targetAnchor,
      currentAnchor: {
        x: currentAnchor.x,
        y: currentAnchor.y
      }
    };
  }

  return offsets;
}

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

  const expandedNodeOptions = expandNodePlacementOptions(effectiveNodeOptions, context);
  const expandedNodeLocalOptions = expandNodePlacementOptions(effectiveNodeLocalOptions, context);

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
  const nodeLocalStyle = resolveNodeStyle(expandedNodeLocalOptions, nodeDecorationBaseStyle, context, 1);
  const nodeShape = resolveNodeShape(expandedNodeOptions);
  const expandedNodeText = expandMacroBindings(item.text, frame.macroBindings, {
    maxDepth: DEFAULT_MACRO_EXPANSION_MAX_DEPTH,
    trace: context.macroTraceCollector ?? undefined
  });
  const resolvedNodeText = normalizeEscapedTextSpaces(resolveTextColorAliases(expandedNodeText, context, statement.id));
  const normalizedText = normalizeNodeTextFontSize(resolvedNodeText, nodeLocalStyle.fontSize);
  const nodeTextStyle = normalizedText.fontSizePt === nodeLocalStyle.fontSize
    ? nodeLocalStyle
    : { ...nodeLocalStyle, fontSize: normalizedText.fontSizePt };
  const baseNodeLayout = resolveNodeLayout(
    normalizedText.text,
    expandedNodeOptions,
    nodeTextStyle,
    1,
    context.textEngine,
    "text"
  );
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
  baseStyleChain?: StyleChainEntry[],
  placementOptions: { allowImplicitOriginHandle?: boolean; explicitAtSyntax?: boolean; textMode?: "text" | "math" } = {}
): {
  behindElements: SceneElement[];
  frontElements: SceneElement[];
} {
  const frame = context.stack[context.stack.length - 1];
  const effectiveBaseStyleChain = baseStyleChain ?? frame.styleChain;
  const everyNodeStyles = item.adornment ? [] : frame.everyNodeStyles;
  const everyFitStyles = item.adornment ? [] : frame.everyFitStyles;
  const nodeOptions = withDefaultNodePosition(item.options, defaultPositionFraction);
  let effectiveNodeOptions = resolveEffectiveNodeOptions({
    statementOptions: statement.options,
    nodeOptions,
    everyNodeStyles,
    everyFitStyles,
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
  let effectiveNodeLocalOptions = resolveEffectiveNodeOptions({
    statementOptions: undefined,
    nodeOptions,
    everyNodeStyles,
    everyFitStyles,
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
  let expandedNodeOptions = expandNodePlacementOptions(effectiveNodeOptions, context);
  let expandedNodeLocalOptions = expandNodePlacementOptions(effectiveNodeLocalOptions, context);

  const fitOverrides = resolveFitOverrides(expandedNodeOptions, context);
  if (fitOverrides.hasFit) {
    markFeature("fit_node", fitOverrides.overrideOptions ? "supported" : "unsupported");
    for (const diagnostic of fitOverrides.diagnostics) {
      pushDiagnostic(diagnostic.code, diagnostic.message, item.span.from, item.span.to);
    }
    const fitSyntheticOptions = fitOverrides.overrideOptions ? [fitOverrides.overrideOptions] : [];

    effectiveNodeOptions = resolveEffectiveNodeOptions({
      statementOptions: statement.options,
      nodeOptions,
      everyNodeStyles,
      everyFitStyles,
      applyEveryFitStyles: true,
      syntheticOptions: fitSyntheticOptions,
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
    effectiveNodeLocalOptions = resolveEffectiveNodeOptions({
      statementOptions: undefined,
      nodeOptions,
      everyNodeStyles,
      everyFitStyles,
      applyEveryFitStyles: true,
      syntheticOptions: fitSyntheticOptions,
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

    expandedNodeOptions = expandNodePlacementOptions(effectiveNodeOptions, context);
    expandedNodeLocalOptions = expandNodePlacementOptions(effectiveNodeLocalOptions, context);
  }

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
  const nodeLocalStyle = resolveNodeStyle(expandedNodeLocalOptions, nodeDecorationBaseStyle, context, 1);
  const nodeShape = resolveNodeShape(expandedNodeOptions);
  const commandNodeOptions = fitOverrides.overrideOptions
    ? resolveEffectiveNodeOptions({
        statementOptions: undefined,
        nodeOptions,
        everyNodeStyles: [],
        everyFitStyles: [],
        syntheticOptions: [fitOverrides.overrideOptions],
        everyRectangleNodeStyles: [],
        everyCircleNodeStyles: [],
        everyDiamondNodeStyles: [],
        everyTrapeziumNodeStyles: [],
        everyIsoscelesTriangleNodeStyles: [],
        everyKiteNodeStyles: [],
        everyDartNodeStyles: [],
        everyCircularSectorNodeStyles: [],
        everyCylinderNodeStyles: [],
        everyCloudNodeStyles: [],
        everyStarburstNodeStyles: [],
        everySignalNodeStyles: [],
        everyTapeNodeStyles: [],
        everyRectangleCalloutNodeStyles: [],
        everyEllipseCalloutNodeStyles: [],
        everyCloudCalloutNodeStyles: [],
        everySingleArrowNodeStyles: [],
        everyDoubleArrowNodeStyles: []
      })
    : nodeOptions;

  const nodeStyleTrace = resolveNodeStyleTrace({
    item,
    statement,
    context,
    baseStyle: style,
    baseStyleChain: effectiveBaseStyleChain,
    nodeShape,
    nodeOptions: commandNodeOptions,
    applyEveryFitStyles: fitOverrides.hasFit,
    transformScale: 1
  });
  const nodeStyle = nodeStyleTrace.style;
  const nodeStyleChain = nodeStyleTrace.chain;
  const anchor =
    resolveAutoNodeAnchor(expandedNodeOptions, segment, effectiveBaseStyleChain) ??
    resolveNodeAnchor(expandedNodeOptions);
  const statementHasTreeChildren = statement.items.some((candidate) => candidate.kind === "ChildOperation");
  const isSyntheticTreeChildStatement = statement.id.includes(":tree-child:");
  const shouldUseStatementSourceId =
    item.adornment != null ||
    statement.command === "node" ||
    statementHasTreeChildren ||
    isSyntheticTreeChildStatement;
  const nodeSourceId = shouldUseStatementSourceId ? statement.id : item.id;
  const nodeHandleSourceId = item.adornment
    ? makeNodeAdornmentTargetId(item.adornment.ownerNodeId, item.adornment.adornmentIndex, item.adornment.kind)
    : nodeSourceId;
  const target = resolveNodeTargetPoint(
    item,
    context,
    nodeHandleSourceId,
    item.span,
    pushDiagnostic,
    expandedNodeOptions,
    segment,
    defaultTargetPoint,
    placementOptions
  );
  const resolvedPositioning = resolveNodePositioningTarget(expandedNodeOptions, context, target);
  for (const code of resolvedPositioning.diagnostics) {
    pushDiagnostic(code, `Node positioning issue: ${code}`, item.span.from, item.span.to);
  }

  const expandedNodeText = expandMacroBindings(item.text, frame.macroBindings, {
    maxDepth: DEFAULT_MACRO_EXPANSION_MAX_DEPTH,
    trace: context.macroTraceCollector ?? undefined
  });
  const resolvedNodeText = normalizeEscapedTextSpaces(resolveTextColorAliases(expandedNodeText, context, statement.id));
  const normalizedNodeText = normalizeNodeTextFontSize(resolvedNodeText, nodeStyle.fontSize);
  const nodeTextStyle = normalizedNodeText.fontSizePt === nodeStyle.fontSize
    ? nodeStyle
    : { ...nodeStyle, fontSize: normalizedNodeText.fontSizePt };

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
      inheritedTransformScale: 1,
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
          effectiveBaseStyleChain,
          { allowImplicitOriginHandle: false, textMode: matrixMode.textMode }
        )
    });
  }

  const baseNodeLayout = resolveNodeLayout(
    normalizedNodeText.text,
    expandedNodeOptions,
    nodeTextStyle,
    1,
    context.textEngine,
    placementOptions.textMode ?? "text"
  );
  const nodeLayout = adjustNodeLayoutForShape(baseNodeLayout, nodeShape);
  const shapeGeometry = resolveNodeShapeGeometryParams(expandedNodeOptions, () => context.mathRandom.nextRaw());
  const slopedRotation = resolveSlopedNodeRotation(expandedNodeOptions, segment, effectiveBaseStyleChain);
  const inheritedNodeTransform: Matrix2D = frame.transformShape
    ? { a: frame.transform.a, b: frame.transform.b, c: frame.transform.c, d: frame.transform.d, e: 0, f: 0 }
    : identityMatrix();
  const nodeOptionTransform = resolveNodeOptionTransform(expandedNodeLocalOptions, style, context);
  const baseNodeTransform = multiplyMatrix(inheritedNodeTransform, nodeOptionTransform);
  const nodeTransform =
    slopedRotation != null && Math.abs(slopedRotation) > 1e-6
      ? multiplyMatrix(baseNodeTransform, rotationMatrix(slopedRotation))
      : baseNodeTransform;
  const center = placeNodeCenter(
    resolvedPositioning.anchorPoint,
    nodeShape,
    nodeLayout,
    resolvedPositioning.anchorOverride ?? anchor,
    expandedNodeOptions,
    nodeTransform
  );
  // Create positioning handle now that we have center and nodeLayout for the current node (B)
  if (resolvedPositioning.relativePlacement) {
    const rp = resolvedPositioning.relativePlacement;
    const dir = rp.direction;
    const isBaseOrMid = dir.startsWith("base ") || dir.startsWith("mid ");
    if (!isBaseOrMid) {
      // Remove any implicit origin handle that resolveNodeTargetPoint created for this node
      const implicitIdx = context.editHandles.findIndex(
        (h) => h.sourceRef.sourceId === nodeHandleSourceId && h.kind === "node-position"
      );
      if (implicitIdx !== -1) {
        context.editHandles.splice(implicitIdx, 1);
      }

      // Look up target node's geometry for anchor compensation
      const targetGeom = readNamedNodeGeometry(context, rp.targetNodeName);

      const sourceText = context.source.slice(rp.span.from, rp.span.to);
      context.editHandles.push({
        id: `handle:${nodeHandleSourceId}:node-position:${context.editHandles.length}`,
        runtimeId: `handle:${nodeHandleSourceId}:node-position:${context.editHandles.length}`,
        sourceRef: {
          sourceId: nodeHandleSourceId,
          sourceSpan: rp.span,
          sourceFingerprint: context.sourceFingerprint
        },
        kind: "node-position",
        world: center,
        transform: frame?.transform ?? { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        sourceText,
        coordinateForm: "cartesian",
        rewriteMode: "positioning",
        positioningContext: {
          direction: rp.direction,
          targetNodeName: rp.targetNodeName,
          targetCenter: rp.targetCenter,
          currentCenter: center,
          legacyOf: rp.legacyOf,
          anchorOffsetsByDirection: computePositioningAnchorOffsetsByDirection({
            targetNodeName: rp.targetNodeName,
            targetCenter: rp.targetCenter,
            currentCenter: center,
            context,
            legacyOf: rp.legacyOf,
            nodeShape,
            nodeLayout,
            nodeOptions: expandedNodeOptions,
            nodeTransform
          }),
          targetAnchorHW: targetGeom?.anchorHalfWidth ?? 0,
          targetAnchorHH: targetGeom?.anchorHalfHeight ?? 0,
          currentAnchorHW: nodeLayout.anchorHalfWidth,
          currentAnchorHH: nodeLayout.anchorHalfHeight
        }
      });
    }
  }

  const pathAttachmentMetadata: ScenePathAttachment | null =
    !item.adornment &&
    segment &&
    !resolvedPositioning.relativePlacement &&
    !item.atRaw &&
    !expandedNodeOptions?.entries.some((entry) => entry.kind === "kv" && entry.key === "at")
      ? (() => {
          const regime = resolvePathAttachedNodeRegime(expandedNodeOptions, effectiveBaseStyleChain);
          if (!regime) {
            return null;
          }
          const pos = resolvePathPositionFraction(expandedNodeOptions) ?? 0.5;
          return {
            hostPathSourceId: statement.id,
            nodeSourceId: nodeSourceId,
            segment,
            pos,
            regime,
            sloped: resolvePathAttachedNodeSloped(expandedNodeOptions, effectiveBaseStyleChain)
          } satisfies ScenePathAttachment;
        })()
      : null;

  if (pathAttachmentMetadata) {
    const sourceText = context.source.slice(item.span.from, item.span.to);
    context.editHandles.push({
      id: `handle:${nodeHandleSourceId}:node-position:${context.editHandles.length}`,
      runtimeId: `handle:${nodeHandleSourceId}:node-position:${context.editHandles.length}`,
      sourceRef: {
        sourceId: nodeHandleSourceId,
        sourceSpan: item.optionsSpan ?? item.span,
        sourceFingerprint: context.sourceFingerprint
      },
      kind: "node-position",
      world: center,
      transform: frame?.transform ?? { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      sourceText,
      coordinateForm: "cartesian",
      rewriteMode: "positioning",
      pathAttachmentContext: {
        hostPathSourceId: pathAttachmentMetadata.hostPathSourceId,
        segment: pathAttachmentMetadata.segment,
        pos: pathAttachmentMetadata.pos,
        regime: pathAttachmentMetadata.regime,
        sloped: pathAttachmentMetadata.sloped
      }
    });
  }

  const setNames = collectSetNames(expandedNodeOptions);
  let scopedNames = collectScopedNodeNames(forcedName ?? item.name, item.aliases, context);
  if (scopedNames.length === 0 && setNames.length > 0) {
    scopedNames = collectScopedNodeNames(makeGeneratedSetMemberName(item), undefined, context);
  }

  for (const name of scopedNames) {
    registerNamedNodeAnchors(context, name, center, nodeShape, nodeLayout, expandedNodeOptions, nodeTransform, nodeSourceId);
  }
  registerNodeSetMembership(scopedNames, setNames, context);

  const nodeElementTransform = resolveNodeElementTransform(center, nodeTransform);
  const nodeElements: SceneElement[] = [];
  const pushNodeElement = (element: SceneElement): void => {
    const rotatedElement = rotateNodeElementGeometry(element, center, 0);
    rotatedElement.styleChain = cloneStyleChain(nodeStyleChain);
    rotatedElement.transform = nodeElementTransform;
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
      pushNodeElement(makeCircleElement(nodeSourceId, center, nodeLayout.visualRadius, nodeBoxStyle, item.span));
      markFeature("shape_circle", "supported");
      markFeature("svg_circle", "supported");
    } else if (nodeShape === "ellipse") {
      pushNodeElement(makeNodeEllipseElement(nodeSourceId, item.id, center, nodeLayout.visualWidth, nodeLayout.visualHeight, nodeBoxStyle, item.span));
      markFeature("shape_ellipse", "supported");
    } else if (nodeShape === "diamond") {
      pushNodeElement(
        makeNodeDiamondElement(
          nodeSourceId,
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
          nodeSourceId,
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
          nodeSourceId,
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
          nodeSourceId,
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
          nodeSourceId,
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
          nodeSourceId,
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
          nodeSourceId,
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
          nodeSourceId,
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
          nodeSourceId,
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
          nodeSourceId,
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
          nodeSourceId,
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
          nodeSourceId,
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
          nodeSourceId,
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
          nodeSourceId,
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
          nodeSourceId,
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
          nodeSourceId,
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
          nodeSourceId,
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
          nodeSourceId,
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
          nodeSourceId,
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
      pushNodeElement(makeNodeBoxElement(nodeSourceId, item.id, center, nodeLayout.visualWidth, nodeLayout.visualHeight, nodeBoxStyle, item.span));
      markFeature("shape_rectangle", "supported");
      markFeature("svg_path", "supported");
    }
  }

  const renderedNodeText = nodeLayout.textLines.join("\n");
  if (renderedNodeText.length > 0) {
    pushNodeElement(
      makeTextElement(
        nodeSourceId,
        item.id,
        center,
        nodeTextStyle,
        item.span,
        renderedNodeText,
        nodeLayout.textBlockWidth,
        nodeLayout.textBlockHeight,
        nodeLayout.visualWidth,
        nodeLayout.visualHeight,
        nodeLayout.textRenderInfo,
        undefined,
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
    `${nodeSourceId}:${item.id}`,
    context.mathRandom,
    markFeature,
    pushDiagnostic
  );
  const adornmentMetadata = item.adornment;
  const editableNodeElements = renderedNodeElements.map((element) => {
    const withAdornment = adornmentMetadata ? attachAdornmentMetadata(element, adornmentMetadata, center) : element;
    return pathAttachmentMetadata ? attachPathAttachmentMetadata(withAdornment, pathAttachmentMetadata) : withAdornment;
  });
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

function attachPathAttachmentMetadata(
  element: SceneElement,
  pathAttachment: ScenePathAttachment
): SceneElement {
  return {
    ...element,
    pathAttachment
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
  applyEveryFitStyles?: boolean;
  transformScale: number;
}): { style: ResolvedStyle; chain: StyleChainEntry[] } {
  const frame = params.context.stack[params.context.stack.length - 1];
  const macroTrace = params.context.macroTraceCollector ?? undefined;
  const everyNodeLayers = expandProvenanceOptionLayers(frame.everyNodeStyles, frame, macroTrace);
  const everyFitLayers =
    params.applyEveryFitStyles === true
      ? expandProvenanceOptionLayers(frame.everyFitStyles, frame, macroTrace)
      : [];
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
    ...(includeEveryNodeLayers
      ? everyFitLayers.map(
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

  const resolved = resolveContextDelta(
    params.baseStyle,
    frame.transform,
    layers,
    cloneCustomStyleRegistry(frame.customStyles),
    (raw) => evaluateRawCoordinate(raw, params.context).world,
    params.baseStyleChain,
    (raw) => resolveContextColorAliasValue(params.context, raw)
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

function resolveAutoNodeAnchor(
  options: NodeItem["options"],
  segment: PlacementSegment | null,
  styleChain: StyleChainEntry[] = []
): string | null {
  if (!options || !segment) {
    return null;
  }

  let autoSide: "left" | "right" | null = null;
  let autoExplicit = false;
  let swap = false;
  let swapExplicit = false;
  const sloped = resolveScopedBooleanOption(options, styleChain, "sloped") ?? false;

  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "auto") {
        autoExplicit = true;
        autoSide = "left";
      } else if (entry.key === "swap") {
        swapExplicit = true;
        swap = !swap;
      }
      continue;
    }

    if (entry.kind !== "kv") {
      continue;
    }

    if (entry.key === "auto") {
      const normalized = entry.valueRaw.trim().toLowerCase();
      autoExplicit = true;
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
      swapExplicit = true;
      if (normalized === "true" || normalized === "yes" || normalized === "on" || normalized === "1") {
        swap = true;
      } else if (normalized === "false" || normalized === "no" || normalized === "off" || normalized === "0") {
        swap = false;
      }
    }
  }

  if (!autoExplicit || !swapExplicit) {
    for (const styleEntry of styleChain) {
      for (const optionList of styleEntry.rawOptions) {
        for (const option of optionList.entries) {
          if (option.kind === "flag") {
            if (!autoExplicit && option.key === "auto") {
              autoSide = "left";
            } else if (!swapExplicit && option.key === "swap") {
              swap = !swap;
            }
            continue;
          }

          if (option.kind !== "kv") {
            continue;
          }

          if (!autoExplicit && option.key === "auto") {
            const normalized = option.valueRaw.trim().toLowerCase();
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

          if (!swapExplicit && option.key === "swap") {
            const normalized = option.valueRaw.trim().toLowerCase();
            if (normalized === "true" || normalized === "yes" || normalized === "on" || normalized === "1") {
              swap = true;
            } else if (normalized === "false" || normalized === "no" || normalized === "off" || normalized === "0") {
              swap = false;
            }
          }
        }
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
      resolveSlopedNodeRotation(options, segment, styleChain) ??
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

function resolveSlopedNodeRotation(
  options: NodeItem["options"],
  segment: PlacementSegment | null,
  styleChain: StyleChainEntry[] = []
): number | null {
  if (!options || !segment) {
    return null;
  }

  if (!resolveScopedBooleanOption(options, styleChain, "sloped")) {
    return null;
  }

  const tangent = segmentTangent(segment);
  if (!tangent) {
    return null;
  }

  let rotation = (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI;
  if (!allowsUpsideDown(options, styleChain)) {
    if (rotation > 90) {
      rotation -= 180;
    } else if (rotation <= -90) {
      rotation += 180;
    }
  }
  return rotation;
}

function allowsUpsideDown(options: NodeItem["options"], styleChain: StyleChainEntry[] = []): boolean {
  return resolveScopedBooleanOption(options, styleChain, "allow upside down") ?? false;
}

function resolveScopedBooleanOption(
  options: NodeItem["options"] | OptionListAst | undefined,
  styleChain: StyleChainEntry[],
  key: string
): boolean | null {
  const local = resolveBooleanOption(options, key);
  if (local != null) {
    return local;
  }

  let inherited: boolean | null = null;
  for (const styleEntry of styleChain) {
    for (const optionList of styleEntry.rawOptions) {
      const resolved = resolveBooleanOption(optionList, key);
      if (resolved != null) {
        inherited = resolved;
      }
    }
  }

  return inherited;
}

function resolveBooleanOption(options: NodeItem["options"] | OptionListAst | undefined, key: string): boolean | null {
  if (!options) {
    return null;
  }

  let seen = false;
  let value = false;
  for (const entry of options.entries) {
    if (entry.kind === "flag" && entry.key === key) {
      seen = true;
      value = true;
      continue;
    }
    if (entry.kind !== "kv" || entry.key !== key) {
      continue;
    }
    const normalized = normalizeOptionValue(entry.valueRaw).toLowerCase();
    if (normalized.length === 0 || normalized === "true" || normalized === "yes" || normalized === "on" || normalized === "1") {
      seen = true;
      value = true;
    } else if (normalized === "false" || normalized === "no" || normalized === "off" || normalized === "0") {
      seen = true;
      value = false;
    }
  }

  return seen ? value : null;
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

function resolveTextColorAliases(text: string, context: SemanticContext, consumerStatementId: string): string {
  if (text.length === 0) {
    return text;
  }

  let resolved = replaceColorCommandAliases(text, "\\textcolor", context, consumerStatementId);
  resolved = replaceColorCommandAliases(resolved, "\\color", context, consumerStatementId);
  return resolved;
}

function replaceColorCommandAliases(
  text: string,
  command: "\\textcolor" | "\\color",
  context: SemanticContext,
  consumerStatementId: string
): string {
  const escapedCommand = command.replace("\\", "\\\\");
  const pattern = new RegExp(`${escapedCommand}(\\s*\\[[^\\]]*\\])?\\s*\\{([^{}]+)\\}`, "g");
  return text.replace(pattern, (fullMatch: string, modelPart = "", rawColorName = "") => {
    const resolved = resolveContextColorAliasValue(context, rawColorName, consumerStatementId);
    if (!resolved) {
      return fullMatch;
    }
    return `${command}${modelPart}{${resolved}}`;
  });
}

function resolveNodeElementTransform(center: Point, nodeTransform: Matrix2D): Matrix2D | undefined {
  const hasLinear =
    Math.abs(nodeTransform.a - 1) > 1e-9 ||
    Math.abs(nodeTransform.b) > 1e-9 ||
    Math.abs(nodeTransform.c) > 1e-9 ||
    Math.abs(nodeTransform.d - 1) > 1e-9;
  const hasTranslation = Math.abs(nodeTransform.e) > 1e-9 || Math.abs(nodeTransform.f) > 1e-9;
  if (!hasLinear && !hasTranslation) {
    return undefined;
  }

  const e = center.x - nodeTransform.a * center.x - nodeTransform.c * center.y + nodeTransform.e;
  const f = center.y - nodeTransform.b * center.x - nodeTransform.d * center.y + nodeTransform.f;
  return {
    a: nodeTransform.a,
    b: nodeTransform.b,
    c: nodeTransform.c,
    d: nodeTransform.d,
    e,
    f
  };
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
  rng: PgfRandom,
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

    const outcome = applyDecorationToPath(path, decoration, `${seedPrefix}:${element.id}`, rng);
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

type FitDiagnostic = {
  code: string;
  message: string;
};

type FitOverrideResolution = {
  hasFit: boolean;
  overrideOptions: OptionListAst | null;
  diagnostics: FitDiagnostic[];
};

function resolveFitOverrides(options: OptionListAst | undefined, context: SemanticContext): FitOverrideResolution {
  if (!options) {
    return { hasFit: false, overrideOptions: null, diagnostics: [] };
  }

  let fitEntry: Extract<OptionEntry, { kind: "kv" }> | null = null;
  let rotateFitDegrees: number | null = null;
  const diagnostics: FitDiagnostic[] = [];

  for (const entry of options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "fit") {
      fitEntry = entry;
      continue;
    }
    if (entry.key === "rotate fit") {
      const parsed = parseQuantityExpression(normalizeOptionValue(entry.valueRaw));
      if (parsed && Number.isFinite(parsed.value)) {
        rotateFitDegrees = parsed.value;
      } else {
        diagnostics.push({
          code: `unsupported-fit-rotate:${entry.valueRaw}`,
          message: `Node fit issue: unsupported-fit-rotate:${entry.valueRaw}`
        });
      }
    }
  }

  if (!fitEntry) {
    return { hasFit: false, overrideOptions: null, diagnostics };
  }

  const fitPoints = collectFitSamplePoints(fitEntry.valueRaw, context);
  if (fitPoints.length === 0) {
    diagnostics.push({
      code: "unsupported-fit-targets",
      message: "Node fit issue: unsupported-fit-targets"
    });
    return { hasFit: true, overrideOptions: null, diagnostics };
  }

  const bounds = computeFitBounds(fitPoints, rotateFitDegrees);
  if (!bounds) {
    diagnostics.push({
      code: "unsupported-fit-targets",
      message: "Node fit issue: unsupported-fit-targets"
    });
    return { hasFit: true, overrideOptions: null, diagnostics };
  }

  const rotateSegment =
    rotateFitDegrees != null && Number.isFinite(rotateFitDegrees)
      ? `,rotate=${formatFitNumber(rotateFitDegrees)}`
      : "";
  const halfHeight = bounds.height / 2;
  const overrideRaw = `[at=(${formatFitNumber(bounds.center.x)}pt,${formatFitNumber(bounds.center.y)}pt),anchor=center,align=center,text width={${formatFitNumber(bounds.width)}pt},minimum width={${formatFitNumber(bounds.width)}pt},minimum height={${formatFitNumber(bounds.height)}pt},text height={${formatFitNumber(halfHeight)}pt},text depth={${formatFitNumber(halfHeight)}pt}${rotateSegment}]`;
  const overrideOptions = parseOptionListRaw(overrideRaw, fitEntry.span.from);
  return { hasFit: true, overrideOptions, diagnostics };
}

function collectFitSamplePoints(fitRaw: string, context: SemanticContext): Point[] {
  const normalized = stripWrappingBraces(fitRaw).trim();
  if (normalized.length === 0) {
    return [];
  }

  const tokens = extractTopLevelCoordinateTokens(normalized);
  const points: Point[] = [];
  for (const token of tokens) {
    for (const point of resolveFitTokenPoints(token, context)) {
      points.push(point);
    }
  }
  return points;
}

function extractTopLevelCoordinateTokens(raw: string): string[] {
  const tokens: string[] = [];
  let start = -1;
  let depth = 0;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (char === "\\" && index + 1 < raw.length) {
      index += 1;
      continue;
    }
    if (char === "(") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }
    if (char === ")") {
      if (depth === 0) {
        continue;
      }
      depth -= 1;
      if (depth === 0 && start >= 0) {
        tokens.push(raw.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return tokens;
}

function resolveFitTokenPoints(tokenRaw: string, context: SemanticContext): Point[] {
  const coordinate = evaluateRawCoordinate(tokenRaw, context);
  if (!coordinate.world) {
    return [];
  }

  const parsed = parseCoordinate(tokenRaw);
  const maybeName = parsed.form === "named" ? parsed.x.trim() : "";
  if (!isBareNodeReference(maybeName)) {
    return [coordinate.world];
  }

  const geometry = resolveScopedNamedNodeGeometry(maybeName, context);
  if (!geometry) {
    return [coordinate.world];
  }

  const anchors: Point[] = [];
  for (const anchor of ["west", "east", "north", "south"]) {
    const resolved = evaluateRawCoordinate(`(${maybeName}.${anchor})`, context);
    if (resolved.world) {
      anchors.push(resolved.world);
    }
  }
  return anchors.length > 0 ? anchors : [coordinate.world];
}

function isBareNodeReference(nameRaw: string): boolean {
  if (nameRaw.length === 0) {
    return false;
  }
  if (nameRaw.includes(".")) {
    return false;
  }
  const normalized = stripWrappingBraces(nameRaw).trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  if (normalized.startsWith("intersection ") || normalized.includes(" of ")) {
    return false;
  }
  if (normalized.includes("|-") || normalized.includes("-|")) {
    return false;
  }
  return true;
}

function resolveScopedNamedNodeGeometry(name: string, context: SemanticContext) {
  const frame = context.stack[context.stack.length - 1];
  const prefix = frame?.namePrefix ?? "";
  const suffix = frame?.nameSuffix ?? "";
  const scoped = applyRawNameScope(name, prefix, suffix);
  return readNamedNodeGeometry(context, scoped) ?? readNamedNodeGeometry(context, name);
}

function applyRawNameScope(name: string, prefix: string, suffix: string): string {
  if (prefix.length === 0 && suffix.length === 0) {
    return name;
  }
  const dot = name.indexOf(".");
  if (dot === -1) {
    return `${prefix}${name}${suffix}`;
  }
  const base = name.slice(0, dot);
  const anchor = name.slice(dot);
  return `${prefix}${base}${suffix}${anchor}`;
}

function computeFitBounds(
  points: Point[],
  rotateFitDegrees: number | null
): { center: Point; width: number; height: number } | null {
  if (points.length === 0) {
    return null;
  }

  const hasRotate = rotateFitDegrees != null && Number.isFinite(rotateFitDegrees);
  const sampled = hasRotate ? points.map((point) => rotatePoint(point, -rotateFitDegrees!)) : points;
  const minX = Math.min(...sampled.map((point) => point.x));
  const maxX = Math.max(...sampled.map((point) => point.x));
  const minY = Math.min(...sampled.map((point) => point.y));
  const maxY = Math.max(...sampled.map((point) => point.y));

  if (![minX, maxX, minY, maxY].every(Number.isFinite)) {
    return null;
  }

  const centerRotated = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2
  };
  const center = hasRotate ? rotatePoint(centerRotated, rotateFitDegrees!) : centerRotated;
  return {
    center,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY)
  };
}

function rotatePoint(point: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos
  };
}

function formatFitNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const rounded = Math.abs(value) < 1e-9 ? 0 : value;
  return Number(rounded.toFixed(6)).toString();
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

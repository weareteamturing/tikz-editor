import type { NodeItem, PathStatement } from "../../ast/types.js";
import { DEFAULT_MACRO_EXPANSION_MAX_DEPTH, expandMacroBindings } from "../../macros/index.js";
import type { OptionEntry, OptionListAst } from "../../options/types.js";
import type { SemanticContext } from "../context.js";
import { resolveNodePositioningTarget } from "../path/node-positioning.js";
import type { DiagnosticPushFn, FeatureMarkFn, PlacementSegment } from "../path/types.js";
import type { Point, ResolvedStyle, SceneElement } from "../types.js";
import { cloneCustomStyleRegistry, walkOptionEntriesWithCustomStyles } from "../style/custom-styles.js";
import { expandOptionListMacros } from "../style/macro-options.js";
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
import { resolveCalloutPointerOffset, resolveNodeShapeGeometryParams } from "./shape-geometry.js";
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
  const nodeStyle = resolveNodeStyle(expandedNodeOptions, style, context, transformScale);
  const nodeShape = resolveNodeShape(expandedNodeOptions);
  const anchor = resolveAutoNodeAnchor(expandedNodeOptions, segment) ?? resolveNodeAnchor(expandedNodeOptions);
  const target = resolveNodeTargetPoint(item, context, item.span, pushDiagnostic, expandedNodeOptions, segment);
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
      effectiveNodeOptions,
      effectiveNodeLocalOptions,
      inheritedTransformScale,
      resolvedPositioning,
      fallbackAnchor: resolvedPositioning.anchorOverride ?? anchor,
      evaluateNestedNode: (matrixCellItem) =>
        evaluateNodeItem(matrixCellItem, statement, context, style, markFeature, pushDiagnostic, null)
    });
  }

  const nodeLayout = resolveNodeLayout(resolvedNodeText, expandedNodeOptions, nodeStyle, transformScale, context.textEngine);
  const shapeGeometry = resolveNodeShapeGeometryParams(expandedNodeOptions);
  const slopedRotation = resolveSlopedNodeRotation(expandedNodeOptions, segment);
  const center = placeNodeCenter(
    resolvedPositioning.anchorPoint,
    nodeShape,
    nodeLayout,
    resolvedPositioning.anchorOverride ?? anchor,
    expandedNodeOptions
  );
  const scopedNames = collectScopedNodeNames(forcedName ?? item.name, item.aliases, context);

  for (const name of scopedNames) {
    registerNamedNodeAnchors(context, name, center, nodeShape, nodeLayout, expandedNodeOptions);
  }

  const nodeElements: SceneElement[] = [];
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
    } else if (nodeShape === "rectangle callout") {
      nodeElements.push(
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
      nodeElements.push(
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
      nodeElements.push(
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
      nodeElements.push(
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
      nodeElements.push(
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
        nodeLayout.textRenderInfo,
        slopedRotation ?? undefined
      )
    );
    markFeature("svg_text", "supported");
  }

  const layer = resolveNodeLayer(expandedNodeOptions, context);
  if (layer === "behind") {
    return { behindElements: nodeElements, frontElements: [] };
  }
  return { behindElements: [], frontElements: nodeElements };
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

  let sloped = false;
  for (const entry of options.entries) {
    if (entry.kind === "flag" && entry.key === "sloped") {
      sloped = true;
      continue;
    }
    if (entry.kind === "kv" && entry.key === "sloped") {
      const normalized = entry.valueRaw.trim().toLowerCase();
      sloped = normalized.length === 0 || normalized === "true" || normalized === "yes" || normalized === "on" || normalized === "1";
    }
  }

  if (!sloped) {
    return null;
  }

  const tangent = segmentTangent(segment);
  if (!tangent) {
    return null;
  }

  return (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI;
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

export {
  applyNameScope,
  maybeResolveNamedCoordinateBorderPoint,
  maybeResolveNamedCoordinateBorderPointFromRaw,
  maybeResolveNamedCoordinateBorderPointFromRawAlongAngle,
  maybeResolveTrailingCoordinateFromNodeName,
  shouldCaptureStandaloneNodeNameCoordinate
} from "./named-coordinates.js";

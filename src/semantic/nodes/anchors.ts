import type { OptionListAst } from "../../options/types.js";
import type { SemanticContext } from "../context.js";
import type { Point } from "../types.js";
import {
  makeCircularSector,
  makeCloud,
  makeCylinder,
  makeDoubleArrow,
  makeDartPolygon,
  makeEllipseCallout,
  intersectRayWithPolygon,
  makeDiamondPolygon,
  makeIsoscelesTrianglePolygon,
  makeKitePolygon,
  makeRectangleCallout,
  makeRegularPolygon,
  makeSemicircle,
  makeSignal,
  makeSingleArrow,
  makeStar,
  makeStarburst,
  makeTape,
  makeTrapeziumPolygon,
  makeCloudCallout,
  midpoint,
  resolveCalloutPointerOffset,
  resolveNodeShapeGeometryParams
} from "./shape-geometry.js";
import type { NodeLayout, NodeShape } from "./types.js";

export function placeNodeCenter(
  target: Point,
  shape: NodeShape,
  layout: NodeLayout,
  anchor: string,
  options: OptionListAst | undefined = undefined
): Point {
  const offset = nodeAnchorOffset(shape, layout, anchor, options);
  return {
    x: target.x - offset.x,
    y: target.y - offset.y
  };
}

export function nodeAnchorOffset(
  shape: NodeShape,
  layout: NodeLayout,
  anchorRaw: string,
  options: OptionListAst | undefined = undefined
): Point {
  const anchor = anchorRaw.trim().toLowerCase().replaceAll("_", " ");
  const shapeGeometry = resolveNodeShapeGeometryParams(options);

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

  if (shape === "ellipse") {
    const rx = layout.anchorHalfWidth;
    const ry = layout.anchorHalfHeight;
    switch (anchor) {
      case "north":
        return { x: 0, y: ry };
      case "south":
        return { x: 0, y: -ry };
      case "east":
        return { x: rx, y: 0 };
      case "west":
        return { x: -rx, y: 0 };
      case "north east":
        return ellipseDirectionalOffset(rx, ry, 1, 1);
      case "north west":
        return ellipseDirectionalOffset(rx, ry, -1, 1);
      case "south east":
        return ellipseDirectionalOffset(rx, ry, 1, -1);
      case "south west":
        return ellipseDirectionalOffset(rx, ry, -1, -1);
      case "base east":
        return { x: rx, y: layout.baseLineY };
      case "base west":
        return { x: -rx, y: layout.baseLineY };
      case "mid":
        return { x: 0, y: layout.midLineY };
      case "mid east":
        return { x: rx, y: layout.midLineY };
      case "mid west":
        return { x: -rx, y: layout.midLineY };
      case "base":
        return { x: 0, y: layout.baseLineY };
      case "center":
      default:
        return { x: 0, y: 0 };
    }
  }

  if (shape === "diamond") {
    const polygon = makeDiamondPolygon(layout.anchorHalfWidth, layout.anchorHalfHeight, shapeGeometry.diamondAspect);
    return polygonShapeAnchorOffset(anchor, polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "trapezium") {
    const polygon = makeTrapeziumAnchorPolygon(layout, shapeGeometry);
    return trapeziumAnchorOffset(anchor, polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "isosceles triangle") {
    const polygon = makeIsoscelesTrianglePolygon(
      anchorSizingWithOuter(layout),
      shapeGeometry.isoscelesTriangleApexAngle,
      shapeGeometry.shapeBorderRotate,
      shapeGeometry.isoscelesTriangleStretches
    );
    const special = isoscelesTriangleSpecialAnchor(anchor, polygon);
    if (special) {
      return special;
    }
    return polygonShapeAnchorOffset(anchor, polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "kite") {
    const polygon = makeKitePolygon(
      anchorSizingWithOuter(layout),
      shapeGeometry.kiteUpperVertexAngle,
      shapeGeometry.kiteLowerVertexAngle,
      shapeGeometry.shapeBorderRotate
    );
    const special = kiteSpecialAnchor(anchor, polygon);
    if (special) {
      return special;
    }
    return polygonShapeAnchorOffset(anchor, polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "dart") {
    const polygon = makeDartPolygon(
      anchorSizingWithOuter(layout),
      shapeGeometry.dartTipAngle,
      shapeGeometry.dartTailAngle,
      shapeGeometry.shapeBorderRotate
    );
    const special = dartSpecialAnchor(anchor, polygon);
    if (special) {
      return special;
    }
    return polygonShapeAnchorOffset(anchor, polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "regular polygon") {
    const polygon = makeRegularPolygon(anchorSizingWithOuter(layout), shapeGeometry.regularPolygonSides, shapeGeometry.shapeBorderRotate);
    const special = regularPolygonSpecialAnchor(anchor, polygon);
    if (special) {
      return special;
    }
    return polygonShapeAnchorOffset(anchor, polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "star") {
    const star = makeStar(
      anchorSizingWithOuter(layout),
      shapeGeometry.starPoints,
      shapeGeometry.starPointRatio,
      shapeGeometry.starPointHeightPt,
      shapeGeometry.starUsesPointRatio,
      shapeGeometry.shapeBorderRotate
    );
    const special = starSpecialAnchor(anchor, star.outer, star.inner);
    if (special) {
      return special;
    }
    return polygonShapeAnchorOffset(anchor, star.polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "cloud") {
    const cloud = makeCloud(
      anchorSizingWithOuter(layout),
      shapeGeometry.cloudPuffs,
      shapeGeometry.cloudPuffArc,
      shapeGeometry.diamondAspect,
      shapeGeometry.cloudIgnoresAspect,
      shapeGeometry.shapeBorderRotate
    );
    const special = cloudSpecialAnchor(anchor, cloud.puffs);
    if (special) {
      return special;
    }
    return polygonShapeAnchorOffset(anchor, cloud.polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "starburst") {
    const starburst = makeStarburst(
      anchorSizingWithOuter(layout),
      shapeGeometry.starburstPoints,
      shapeGeometry.starburstPointHeightPt,
      shapeGeometry.randomStarburstSeed,
      shapeGeometry.shapeBorderRotate
    );
    const special = starburstSpecialAnchor(anchor, starburst.outer, starburst.inner);
    if (special) {
      return special;
    }
    return polygonShapeAnchorOffset(anchor, starburst.polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "signal") {
    const signal = makeSignal(
      anchorSizingWithOuter(layout),
      shapeGeometry.signalPointerAngle,
      shapeGeometry.signalToSides,
      shapeGeometry.signalFromSides
    );
    return polygonShapeAnchorOffset(anchor, signal.polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "tape") {
    const tape = makeTape(
      anchorSizingWithOuter(layout),
      shapeGeometry.tapeBendTop,
      shapeGeometry.tapeBendBottom,
      shapeGeometry.tapeBendHeightPt
    );
    return polygonShapeAnchorOffset(anchor, tape.polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "rectangle callout") {
    const pointerOffset = resolveCalloutPointerOffset(shapeGeometry, null, null);
    const callout = makeRectangleCallout(
      anchorSizingWithOuter(layout),
      pointerOffset,
      shapeGeometry.calloutPointerWidthPt,
      shapeGeometry.calloutPointerIsAbsolute,
      shapeGeometry.calloutPointerShortenPt
    );
    if (anchor === "pointer") {
      return callout.pointerAnchor;
    }
    return nodeAnchorOffset("rectangle", layout, anchor, options);
  }

  if (shape === "ellipse callout") {
    const pointerOffset = resolveCalloutPointerOffset(shapeGeometry, null, null);
    const callout = makeEllipseCallout(
      anchorSizingWithOuter(layout),
      pointerOffset,
      shapeGeometry.calloutPointerArc,
      shapeGeometry.calloutPointerIsAbsolute,
      shapeGeometry.calloutPointerShortenPt
    );
    if (anchor === "pointer") {
      return callout.pointerAnchor;
    }
    return nodeAnchorOffset("ellipse", layout, anchor, options);
  }

  if (shape === "cloud callout") {
    const pointerOffset = resolveCalloutPointerOffset(shapeGeometry, null, null);
    const callout = makeCloudCallout(
      anchorSizingWithOuter(layout),
      shapeGeometry.cloudPuffs,
      shapeGeometry.cloudPuffArc,
      shapeGeometry.diamondAspect,
      shapeGeometry.cloudIgnoresAspect,
      shapeGeometry.shapeBorderRotate,
      pointerOffset,
      shapeGeometry.calloutPointerStartSizeRaw,
      shapeGeometry.calloutPointerEndSizeRaw,
      shapeGeometry.calloutPointerSegments,
      shapeGeometry.calloutPointerIsAbsolute,
      shapeGeometry.calloutPointerShortenPt
    );
    if (anchor === "pointer") {
      return callout.pointerAnchor;
    }
    const special = cloudSpecialAnchor(anchor, callout.puffs);
    if (special) {
      return special;
    }
    return polygonShapeAnchorOffset(anchor, callout.polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "single arrow") {
    const singleArrow = makeSingleArrow(
      anchorSizingWithOuter(layout),
      shapeGeometry.singleArrowTipAngle,
      shapeGeometry.singleArrowHeadExtendPt,
      shapeGeometry.singleArrowHeadIndentPt,
      shapeGeometry.shapeBorderRotate
    );
    const special = singleArrowSpecialAnchor(anchor, singleArrow);
    if (special) {
      return special;
    }
    return polygonShapeAnchorOffset(anchor, singleArrow.polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "double arrow") {
    const doubleArrow = makeDoubleArrow(
      anchorSizingWithOuter(layout),
      shapeGeometry.doubleArrowTipAngle,
      shapeGeometry.doubleArrowHeadExtendPt,
      shapeGeometry.doubleArrowHeadIndentPt,
      shapeGeometry.shapeBorderRotate
    );
    const special = doubleArrowSpecialAnchor(anchor, doubleArrow);
    if (special) {
      return special;
    }
    return polygonShapeAnchorOffset(anchor, doubleArrow.polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "semicircle") {
    const semicircle = makeSemicircle(anchorSizingWithOuter(layout), shapeGeometry.shapeBorderRotate, 0);
    if (anchor === "apex") {
      return semicircle.apex;
    }
    if (anchor === "arc start") {
      return semicircle.arcStart;
    }
    if (anchor === "arc end") {
      return semicircle.arcEnd;
    }
    if (anchor === "chord center") {
      return semicircle.chordCenter;
    }
    return polygonShapeAnchorOffset(anchor, semicircle.polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "circular sector") {
    const sector = makeCircularSector(
      anchorSizingWithOuter(layout),
      shapeGeometry.circularSectorAngle,
      shapeGeometry.shapeBorderRotate,
      0
    );
    if (anchor === "sector center") {
      return sector.sectorCenter;
    }
    if (anchor === "arc start") {
      return sector.arcStart;
    }
    if (anchor === "arc end") {
      return sector.arcEnd;
    }
    if (anchor === "arc center") {
      return sector.arcCenter;
    }
    return polygonShapeAnchorOffset(anchor, sector.polygon, layout.baseLineY, layout.midLineY);
  }

  if (shape === "cylinder") {
    const cylinder = makeCylinder(
      anchorSizingWithOuter(layout),
      shapeGeometry.cylinderAspect,
      shapeGeometry.shapeBorderRotate,
      0
    );
    if (anchor === "shape center") {
      return cylinder.shapeCenter;
    }
    if (anchor === "before top") {
      return cylinder.beforeTop;
    }
    if (anchor === "top") {
      return cylinder.top;
    }
    if (anchor === "after top") {
      return cylinder.afterTop;
    }
    if (anchor === "before bottom") {
      return cylinder.beforeBottom;
    }
    if (anchor === "bottom") {
      return cylinder.bottom;
    }
    if (anchor === "after bottom") {
      return cylinder.afterBottom;
    }
    return polygonShapeAnchorOffset(anchor, cylinder.polygon, layout.baseLineY, layout.midLineY);
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

function makeTrapeziumAnchorPolygon(
  layout: NodeLayout,
  shapeGeometry: ReturnType<typeof resolveNodeShapeGeometryParams>
): Point[] {
  return makeTrapeziumPolygon(
    {
      naturalHalfWidth: layout.naturalWidth / 2 + layout.outerXSep,
      naturalHalfHeight: layout.naturalHeight / 2 + layout.outerYSep,
      minimumWidth: layout.minimumWidth + layout.outerXSep * 2,
      minimumHeight: layout.minimumHeight + layout.outerYSep * 2
    },
    shapeGeometry.trapeziumLeftAngle,
    shapeGeometry.trapeziumRightAngle,
    shapeGeometry.shapeBorderRotate,
    shapeGeometry.trapeziumStretches,
    shapeGeometry.trapeziumStretchesBody
  );
}

function resolveAnchorPolygon(
  shape: NodeShape,
  layout: NodeLayout,
  shapeGeometry: ReturnType<typeof resolveNodeShapeGeometryParams>
): Point[] | undefined {
  if (shape === "diamond") {
    return makeDiamondPolygon(layout.anchorHalfWidth, layout.anchorHalfHeight, shapeGeometry.diamondAspect);
  }
  if (shape === "trapezium") {
    return makeTrapeziumAnchorPolygon(layout, shapeGeometry);
  }
  if (shape === "isosceles triangle") {
    return makeIsoscelesTrianglePolygon(
      anchorSizingWithOuter(layout),
      shapeGeometry.isoscelesTriangleApexAngle,
      shapeGeometry.shapeBorderRotate,
      shapeGeometry.isoscelesTriangleStretches
    );
  }
  if (shape === "kite") {
    return makeKitePolygon(
      anchorSizingWithOuter(layout),
      shapeGeometry.kiteUpperVertexAngle,
      shapeGeometry.kiteLowerVertexAngle,
      shapeGeometry.shapeBorderRotate
    );
  }
  if (shape === "dart") {
    return makeDartPolygon(
      anchorSizingWithOuter(layout),
      shapeGeometry.dartTipAngle,
      shapeGeometry.dartTailAngle,
      shapeGeometry.shapeBorderRotate
    );
  }
  if (shape === "circular sector") {
    return makeCircularSector(anchorSizingWithOuter(layout), shapeGeometry.circularSectorAngle, shapeGeometry.shapeBorderRotate, 0).polygon;
  }
  if (shape === "cylinder") {
    return makeCylinder(anchorSizingWithOuter(layout), shapeGeometry.cylinderAspect, shapeGeometry.shapeBorderRotate, 0).polygon;
  }
  if (shape === "regular polygon") {
    return makeRegularPolygon(anchorSizingWithOuter(layout), shapeGeometry.regularPolygonSides, shapeGeometry.shapeBorderRotate);
  }
  if (shape === "star") {
    return makeStar(
      anchorSizingWithOuter(layout),
      shapeGeometry.starPoints,
      shapeGeometry.starPointRatio,
      shapeGeometry.starPointHeightPt,
      shapeGeometry.starUsesPointRatio,
      shapeGeometry.shapeBorderRotate
    ).polygon;
  }
  if (shape === "semicircle") {
    return makeSemicircle(anchorSizingWithOuter(layout), shapeGeometry.shapeBorderRotate, 0).polygon;
  }
  if (shape === "cloud") {
    return makeCloud(
      anchorSizingWithOuter(layout),
      shapeGeometry.cloudPuffs,
      shapeGeometry.cloudPuffArc,
      shapeGeometry.diamondAspect,
      shapeGeometry.cloudIgnoresAspect,
      shapeGeometry.shapeBorderRotate
    ).polygon;
  }
  if (shape === "starburst") {
    return makeStarburst(
      anchorSizingWithOuter(layout),
      shapeGeometry.starburstPoints,
      shapeGeometry.starburstPointHeightPt,
      shapeGeometry.randomStarburstSeed,
      shapeGeometry.shapeBorderRotate
    ).polygon;
  }
  if (shape === "signal") {
    return makeSignal(
      anchorSizingWithOuter(layout),
      shapeGeometry.signalPointerAngle,
      shapeGeometry.signalToSides,
      shapeGeometry.signalFromSides
    ).polygon;
  }
  if (shape === "tape") {
    return makeTape(
      anchorSizingWithOuter(layout),
      shapeGeometry.tapeBendTop,
      shapeGeometry.tapeBendBottom,
      shapeGeometry.tapeBendHeightPt
    ).polygon;
  }
  if (shape === "rectangle callout") {
    return [
      { x: -layout.anchorHalfWidth, y: layout.anchorHalfHeight },
      { x: layout.anchorHalfWidth, y: layout.anchorHalfHeight },
      { x: layout.anchorHalfWidth, y: -layout.anchorHalfHeight },
      { x: -layout.anchorHalfWidth, y: -layout.anchorHalfHeight }
    ];
  }
  if (shape === "ellipse callout") {
    return makeEllipseAnchorPolygon(layout.anchorHalfWidth, layout.anchorHalfHeight);
  }
  if (shape === "cloud callout") {
    return makeCloud(
      anchorSizingWithOuter(layout),
      shapeGeometry.cloudPuffs,
      shapeGeometry.cloudPuffArc,
      shapeGeometry.diamondAspect,
      shapeGeometry.cloudIgnoresAspect,
      shapeGeometry.shapeBorderRotate
    ).polygon;
  }
  if (shape === "single arrow") {
    return makeSingleArrow(
      anchorSizingWithOuter(layout),
      shapeGeometry.singleArrowTipAngle,
      shapeGeometry.singleArrowHeadExtendPt,
      shapeGeometry.singleArrowHeadIndentPt,
      shapeGeometry.shapeBorderRotate
    ).polygon;
  }
  if (shape === "double arrow") {
    return makeDoubleArrow(
      anchorSizingWithOuter(layout),
      shapeGeometry.doubleArrowTipAngle,
      shapeGeometry.doubleArrowHeadExtendPt,
      shapeGeometry.doubleArrowHeadIndentPt,
      shapeGeometry.shapeBorderRotate
    ).polygon;
  }
  return undefined;
}

function makeEllipseAnchorPolygon(rx: number, ry: number, steps = 64): Point[] {
  const points: Point[] = [];
  const count = Math.max(8, steps);
  for (let index = 0; index < count; index += 1) {
    const angle = (2 * Math.PI * index) / count;
    points.push({
      x: rx * Math.cos(angle),
      y: ry * Math.sin(angle)
    });
  }
  return points;
}

function trapeziumAnchorOffset(anchor: string, polygon: Point[], baseLineY: number, midLineY: number): Point {
  const bottomLeft = polygon[0] ?? { x: 0, y: 0 };
  const topLeft = polygon[1] ?? { x: 0, y: 0 };
  const topRight = polygon[2] ?? { x: 0, y: 0 };
  const bottomRight = polygon[3] ?? { x: 0, y: 0 };

  if (anchor === "bottom left corner") {
    return bottomLeft;
  }
  if (anchor === "top left corner") {
    return topLeft;
  }
  if (anchor === "top right corner") {
    return topRight;
  }
  if (anchor === "bottom right corner") {
    return bottomRight;
  }
  if (anchor === "left side") {
    return midpoint(bottomLeft, topLeft);
  }
  if (anchor === "right side") {
    return midpoint(bottomRight, topRight);
  }
  if (anchor === "top side") {
    return midpoint(topLeft, topRight);
  }
  if (anchor === "bottom side") {
    return midpoint(bottomLeft, bottomRight);
  }

  return polygonShapeAnchorOffset(anchor, polygon, baseLineY, midLineY);
}

function isoscelesTriangleSpecialAnchor(anchor: string, polygon: Point[]): Point | null {
  const apex = polygon[0];
  const leftCorner = polygon[1];
  const rightCorner = polygon[2];
  if (!apex || !leftCorner || !rightCorner) {
    return null;
  }

  if (anchor === "apex") {
    return apex;
  }
  if (anchor === "left corner") {
    return leftCorner;
  }
  if (anchor === "right corner") {
    return rightCorner;
  }
  if (anchor === "left side") {
    return midpoint(apex, leftCorner);
  }
  if (anchor === "right side") {
    return midpoint(apex, rightCorner);
  }
  if (anchor === "lower side") {
    return midpoint(leftCorner, rightCorner);
  }

  return null;
}

function kiteSpecialAnchor(anchor: string, polygon: Point[]): Point | null {
  const upper = polygon[0];
  const left = polygon[1];
  const lower = polygon[2];
  const right = polygon[3];
  if (!upper || !left || !lower || !right) {
    return null;
  }

  if (anchor === "upper vertex") {
    return upper;
  }
  if (anchor === "left vertex") {
    return left;
  }
  if (anchor === "lower vertex") {
    return lower;
  }
  if (anchor === "right vertex") {
    return right;
  }
  if (anchor === "upper left side") {
    return midpoint(upper, left);
  }
  if (anchor === "upper right side") {
    return midpoint(upper, right);
  }
  if (anchor === "lower left side") {
    return midpoint(lower, left);
  }
  if (anchor === "lower right side") {
    return midpoint(lower, right);
  }

  return null;
}

function dartSpecialAnchor(anchor: string, polygon: Point[]): Point | null {
  const tip = polygon[0];
  const leftTail = polygon[1];
  const tailCenter = polygon[2];
  const rightTail = polygon[3];
  if (!tip || !leftTail || !tailCenter || !rightTail) {
    return null;
  }

  if (anchor === "tip") {
    return tip;
  }
  if (anchor === "left tail") {
    return leftTail;
  }
  if (anchor === "right tail") {
    return rightTail;
  }
  if (anchor === "tail center") {
    return tailCenter;
  }
  if (anchor === "left side") {
    return midpoint(tip, leftTail);
  }
  if (anchor === "right side") {
    return midpoint(tip, rightTail);
  }

  return null;
}

function regularPolygonSpecialAnchor(anchor: string, polygon: Point[]): Point | null {
  const cornerMatch = anchor.match(/^corner\s+(\d+)$/);
  if (cornerMatch) {
    const index = Number(cornerMatch[1]);
    if (Number.isFinite(index) && index >= 1) {
      return polygon[(index - 1) % polygon.length] ?? null;
    }
  }

  const sideMatch = anchor.match(/^side\s+(\d+)$/);
  if (sideMatch) {
    const index = Number(sideMatch[1]);
    if (Number.isFinite(index) && index >= 1) {
      const sideIndex = (index - 1) % polygon.length;
      const from = polygon[sideIndex];
      const to = polygon[(sideIndex + 1) % polygon.length];
      if (from && to) {
        return midpoint(from, to);
      }
    }
  }

  return null;
}

function starSpecialAnchor(anchor: string, outerPoints: Point[], innerPoints: Point[]): Point | null {
  const outerMatch = anchor.match(/^(?:outer\s+)?point\s+(\d+)$/);
  if (outerMatch) {
    const index = Number(outerMatch[1]);
    if (Number.isFinite(index) && index >= 1) {
      return outerPoints[(index - 1) % outerPoints.length] ?? null;
    }
  }

  const innerMatch = anchor.match(/^inner\s+point\s+(\d+)$/);
  if (innerMatch) {
    const index = Number(innerMatch[1]);
    if (Number.isFinite(index) && index >= 1) {
      return innerPoints[(index - 1) % innerPoints.length] ?? null;
    }
  }

  return null;
}

function cloudSpecialAnchor(anchor: string, puffs: Point[]): Point | null {
  const match = anchor.match(/^puff\s+(\d+)$/);
  if (!match) {
    return null;
  }
  const index = Number(match[1]);
  if (!Number.isFinite(index) || index < 1) {
    return null;
  }
  return puffs[(index - 1) % puffs.length] ?? null;
}

function starburstSpecialAnchor(anchor: string, outerPoints: Point[], innerPoints: Point[]): Point | null {
  return starSpecialAnchor(anchor, outerPoints, innerPoints);
}

function singleArrowSpecialAnchor(
  anchor: string,
  geometry: ReturnType<typeof makeSingleArrow>
): Point | null {
  if (anchor === "tip") {
    return geometry.tip;
  }
  if (anchor === "before tip") {
    return geometry.beforeTip;
  }
  if (anchor === "after tip") {
    return geometry.afterTip;
  }
  if (anchor === "before head") {
    return geometry.beforeHead;
  }
  if (anchor === "after head") {
    return geometry.afterHead;
  }
  if (anchor === "before tail") {
    return geometry.beforeTail;
  }
  if (anchor === "after tail") {
    return geometry.afterTail;
  }
  if (anchor === "tail") {
    return geometry.tail;
  }
  return null;
}

function doubleArrowSpecialAnchor(
  anchor: string,
  geometry: ReturnType<typeof makeDoubleArrow>
): Point | null {
  if (anchor === "tip 1") {
    return geometry.tip1;
  }
  if (anchor === "before tip 1") {
    return geometry.beforeTip1;
  }
  if (anchor === "after tip 1") {
    return geometry.afterTip1;
  }
  if (anchor === "before head 1") {
    return geometry.beforeHead1;
  }
  if (anchor === "after head 1") {
    return geometry.afterHead1;
  }
  if (anchor === "tip 2") {
    return geometry.tip2;
  }
  if (anchor === "before tip 2") {
    return geometry.beforeTip2;
  }
  if (anchor === "after tip 2") {
    return geometry.afterTip2;
  }
  if (anchor === "before head 2") {
    return geometry.beforeHead2;
  }
  if (anchor === "after head 2") {
    return geometry.afterHead2;
  }
  return null;
}

function polygonShapeAnchorOffset(anchor: string, polygon: Point[], baseLineY: number, midLineY: number): Point {
  if (anchor === "center") {
    return { x: 0, y: 0 };
  }
  if (anchor === "base") {
    return { x: 0, y: baseLineY };
  }
  if (anchor === "mid") {
    return { x: 0, y: midLineY };
  }
  if (anchor === "base east") {
    return polygonDirectionalOffset(polygon, { x: 0, y: baseLineY }, { x: 1, y: 0 });
  }
  if (anchor === "base west") {
    return polygonDirectionalOffset(polygon, { x: 0, y: baseLineY }, { x: -1, y: 0 });
  }
  if (anchor === "mid east") {
    return polygonDirectionalOffset(polygon, { x: 0, y: midLineY }, { x: 1, y: 0 });
  }
  if (anchor === "mid west") {
    return polygonDirectionalOffset(polygon, { x: 0, y: midLineY }, { x: -1, y: 0 });
  }

  const direction = anchorDirection(anchor);
  if (!direction) {
    return { x: 0, y: 0 };
  }
  return polygonDirectionalOffset(polygon, { x: 0, y: 0 }, direction);
}

function polygonDirectionalOffset(polygon: Point[], reference: Point, direction: Point): Point {
  const hit = intersectRayWithPolygon(reference, direction, polygon);
  if (!hit) {
    return { x: 0, y: 0 };
  }
  return hit;
}

function anchorDirection(anchor: string): Point | null {
  switch (anchor) {
    case "north":
      return { x: 0, y: 1 };
    case "south":
      return { x: 0, y: -1 };
    case "east":
      return { x: 1, y: 0 };
    case "west":
      return { x: -1, y: 0 };
    case "north east":
      return { x: 1, y: 1 };
    case "north west":
      return { x: -1, y: 1 };
    case "south east":
      return { x: 1, y: -1 };
    case "south west":
      return { x: -1, y: -1 };
    default:
      return null;
  }
}

function ellipseDirectionalOffset(rx: number, ry: number, dx: number, dy: number): Point {
  const norm = Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
  if (!Number.isFinite(norm) || norm <= 1e-9) {
    return { x: 0, y: 0 };
  }
  return {
    x: dx / norm,
    y: dy / norm
  };
}

function anchorSizingWithOuter(layout: NodeLayout): {
  naturalWidth: number;
  naturalHeight: number;
  minimumWidth: number;
  minimumHeight: number;
} {
  return {
    naturalWidth: layout.naturalWidth + layout.outerXSep * 2,
    naturalHeight: layout.naturalHeight + layout.outerYSep * 2,
    minimumWidth: layout.minimumWidth + layout.outerXSep * 2,
    minimumHeight: layout.minimumHeight + layout.outerYSep * 2
  };
}

export function registerNamedNodeAnchors(
  context: SemanticContext,
  name: string,
  center: Point,
  shape: NodeShape,
  layout: NodeLayout,
  options: OptionListAst | undefined = undefined
): void {
  const shapeGeometry = resolveNodeShapeGeometryParams(options);
  const anchorPolygon = resolveAnchorPolygon(shape, layout, shapeGeometry);

  context.namedNodeGeometries.set(name, {
    shape,
    center,
    anchorHalfWidth: layout.anchorHalfWidth,
    anchorHalfHeight: layout.anchorHalfHeight,
    anchorRadius: layout.anchorRadius,
    diamondAspect: shapeGeometry.diamondAspect,
    trapeziumLeftAngle: shapeGeometry.trapeziumLeftAngle,
    trapeziumRightAngle: shapeGeometry.trapeziumRightAngle,
    shapeBorderRotate: shapeGeometry.shapeBorderRotate,
    trapeziumStretches: shapeGeometry.trapeziumStretches,
    trapeziumStretchesBody: shapeGeometry.trapeziumStretchesBody,
    anchorPolygon
  });

  const offsets: Record<string, Point> = {
    center: nodeAnchorOffset(shape, layout, "center", options),
    base: nodeAnchorOffset(shape, layout, "base", options),
    north: nodeAnchorOffset(shape, layout, "north", options),
    south: nodeAnchorOffset(shape, layout, "south", options),
    east: nodeAnchorOffset(shape, layout, "east", options),
    west: nodeAnchorOffset(shape, layout, "west", options),
    "north east": nodeAnchorOffset(shape, layout, "north east", options),
    "north west": nodeAnchorOffset(shape, layout, "north west", options),
    "south east": nodeAnchorOffset(shape, layout, "south east", options),
    "south west": nodeAnchorOffset(shape, layout, "south west", options),
    "base east": nodeAnchorOffset(shape, layout, "base east", options),
    "base west": nodeAnchorOffset(shape, layout, "base west", options),
    mid: nodeAnchorOffset(shape, layout, "mid", options),
    "mid east": nodeAnchorOffset(shape, layout, "mid east", options),
    "mid west": nodeAnchorOffset(shape, layout, "mid west", options)
  };

  if (shape === "trapezium") {
    offsets["bottom left corner"] = nodeAnchorOffset(shape, layout, "bottom left corner", options);
    offsets["top left corner"] = nodeAnchorOffset(shape, layout, "top left corner", options);
    offsets["top right corner"] = nodeAnchorOffset(shape, layout, "top right corner", options);
    offsets["bottom right corner"] = nodeAnchorOffset(shape, layout, "bottom right corner", options);
    offsets["left side"] = nodeAnchorOffset(shape, layout, "left side", options);
    offsets["right side"] = nodeAnchorOffset(shape, layout, "right side", options);
    offsets["top side"] = nodeAnchorOffset(shape, layout, "top side", options);
    offsets["bottom side"] = nodeAnchorOffset(shape, layout, "bottom side", options);
  }

  if (shape === "isosceles triangle") {
    offsets.apex = nodeAnchorOffset(shape, layout, "apex", options);
    offsets["left corner"] = nodeAnchorOffset(shape, layout, "left corner", options);
    offsets["right corner"] = nodeAnchorOffset(shape, layout, "right corner", options);
    offsets["left side"] = nodeAnchorOffset(shape, layout, "left side", options);
    offsets["right side"] = nodeAnchorOffset(shape, layout, "right side", options);
    offsets["lower side"] = nodeAnchorOffset(shape, layout, "lower side", options);
  }

  if (shape === "kite") {
    offsets["upper vertex"] = nodeAnchorOffset(shape, layout, "upper vertex", options);
    offsets["left vertex"] = nodeAnchorOffset(shape, layout, "left vertex", options);
    offsets["lower vertex"] = nodeAnchorOffset(shape, layout, "lower vertex", options);
    offsets["right vertex"] = nodeAnchorOffset(shape, layout, "right vertex", options);
    offsets["upper left side"] = nodeAnchorOffset(shape, layout, "upper left side", options);
    offsets["upper right side"] = nodeAnchorOffset(shape, layout, "upper right side", options);
    offsets["lower left side"] = nodeAnchorOffset(shape, layout, "lower left side", options);
    offsets["lower right side"] = nodeAnchorOffset(shape, layout, "lower right side", options);
  }

  if (shape === "dart") {
    offsets.tip = nodeAnchorOffset(shape, layout, "tip", options);
    offsets["tail center"] = nodeAnchorOffset(shape, layout, "tail center", options);
    offsets["left tail"] = nodeAnchorOffset(shape, layout, "left tail", options);
    offsets["right tail"] = nodeAnchorOffset(shape, layout, "right tail", options);
    offsets["left side"] = nodeAnchorOffset(shape, layout, "left side", options);
    offsets["right side"] = nodeAnchorOffset(shape, layout, "right side", options);
  }

  if (shape === "semicircle") {
    offsets.apex = nodeAnchorOffset(shape, layout, "apex", options);
    offsets["arc start"] = nodeAnchorOffset(shape, layout, "arc start", options);
    offsets["arc end"] = nodeAnchorOffset(shape, layout, "arc end", options);
    offsets["chord center"] = nodeAnchorOffset(shape, layout, "chord center", options);
  }

  if (shape === "circular sector") {
    offsets["sector center"] = nodeAnchorOffset(shape, layout, "sector center", options);
    offsets["arc start"] = nodeAnchorOffset(shape, layout, "arc start", options);
    offsets["arc end"] = nodeAnchorOffset(shape, layout, "arc end", options);
    offsets["arc center"] = nodeAnchorOffset(shape, layout, "arc center", options);
  }

  if (shape === "cylinder") {
    offsets["shape center"] = nodeAnchorOffset(shape, layout, "shape center", options);
    offsets["before top"] = nodeAnchorOffset(shape, layout, "before top", options);
    offsets.top = nodeAnchorOffset(shape, layout, "top", options);
    offsets["after top"] = nodeAnchorOffset(shape, layout, "after top", options);
    offsets["before bottom"] = nodeAnchorOffset(shape, layout, "before bottom", options);
    offsets.bottom = nodeAnchorOffset(shape, layout, "bottom", options);
    offsets["after bottom"] = nodeAnchorOffset(shape, layout, "after bottom", options);
  }

  if (shape === "regular polygon") {
    const sides = Math.max(3, shapeGeometry.regularPolygonSides);
    for (let index = 1; index <= sides; index += 1) {
      offsets[`corner ${index}`] = nodeAnchorOffset(shape, layout, `corner ${index}`, options);
      offsets[`side ${index}`] = nodeAnchorOffset(shape, layout, `side ${index}`, options);
    }
  }

  if (shape === "star") {
    const points = Math.max(2, shapeGeometry.starPoints);
    for (let index = 1; index <= points; index += 1) {
      offsets[`point ${index}`] = nodeAnchorOffset(shape, layout, `point ${index}`, options);
      offsets[`outer point ${index}`] = nodeAnchorOffset(shape, layout, `outer point ${index}`, options);
      offsets[`inner point ${index}`] = nodeAnchorOffset(shape, layout, `inner point ${index}`, options);
    }
  }

  if (shape === "cloud") {
    const puffs = Math.max(2, shapeGeometry.cloudPuffs);
    for (let index = 1; index <= puffs; index += 1) {
      offsets[`puff ${index}`] = nodeAnchorOffset(shape, layout, `puff ${index}`, options);
    }
  }

  if (shape === "starburst") {
    const points = Math.max(2, shapeGeometry.starburstPoints);
    for (let index = 1; index <= points; index += 1) {
      offsets[`point ${index}`] = nodeAnchorOffset(shape, layout, `point ${index}`, options);
      offsets[`outer point ${index}`] = nodeAnchorOffset(shape, layout, `outer point ${index}`, options);
      offsets[`inner point ${index}`] = nodeAnchorOffset(shape, layout, `inner point ${index}`, options);
    }
  }

  if (shape === "rectangle callout" || shape === "ellipse callout") {
    offsets.pointer = nodeAnchorOffset(shape, layout, "pointer", options);
  }

  if (shape === "cloud callout") {
    offsets.pointer = nodeAnchorOffset(shape, layout, "pointer", options);
    const puffs = Math.max(2, shapeGeometry.cloudPuffs);
    for (let index = 1; index <= puffs; index += 1) {
      offsets[`puff ${index}`] = nodeAnchorOffset(shape, layout, `puff ${index}`, options);
    }
  }

  if ((shape === "rectangle callout" || shape === "ellipse callout" || shape === "cloud callout") && shapeGeometry.calloutPointerIsAbsolute) {
    const pointerOffset = resolveCalloutPointerOffset(shapeGeometry, context, center);
    if (shape === "rectangle callout") {
      offsets.pointer = makeRectangleCallout(
        anchorSizingWithOuter(layout),
        pointerOffset,
        shapeGeometry.calloutPointerWidthPt,
        true,
        shapeGeometry.calloutPointerShortenPt
      ).pointerAnchor;
    } else if (shape === "ellipse callout") {
      offsets.pointer = makeEllipseCallout(
        anchorSizingWithOuter(layout),
        pointerOffset,
        shapeGeometry.calloutPointerArc,
        true,
        shapeGeometry.calloutPointerShortenPt
      ).pointerAnchor;
    } else {
      offsets.pointer = makeCloudCallout(
        anchorSizingWithOuter(layout),
        shapeGeometry.cloudPuffs,
        shapeGeometry.cloudPuffArc,
        shapeGeometry.diamondAspect,
        shapeGeometry.cloudIgnoresAspect,
        shapeGeometry.shapeBorderRotate,
        pointerOffset,
        shapeGeometry.calloutPointerStartSizeRaw,
        shapeGeometry.calloutPointerEndSizeRaw,
        shapeGeometry.calloutPointerSegments,
        true,
        shapeGeometry.calloutPointerShortenPt
      ).pointerAnchor;
    }
  }

  if (shape === "single arrow") {
    offsets.tip = nodeAnchorOffset(shape, layout, "tip", options);
    offsets["before tip"] = nodeAnchorOffset(shape, layout, "before tip", options);
    offsets["after tip"] = nodeAnchorOffset(shape, layout, "after tip", options);
    offsets["before head"] = nodeAnchorOffset(shape, layout, "before head", options);
    offsets["after head"] = nodeAnchorOffset(shape, layout, "after head", options);
    offsets["before tail"] = nodeAnchorOffset(shape, layout, "before tail", options);
    offsets["after tail"] = nodeAnchorOffset(shape, layout, "after tail", options);
    offsets.tail = nodeAnchorOffset(shape, layout, "tail", options);
  }

  if (shape === "double arrow") {
    offsets["tip 1"] = nodeAnchorOffset(shape, layout, "tip 1", options);
    offsets["before tip 1"] = nodeAnchorOffset(shape, layout, "before tip 1", options);
    offsets["after tip 1"] = nodeAnchorOffset(shape, layout, "after tip 1", options);
    offsets["before head 1"] = nodeAnchorOffset(shape, layout, "before head 1", options);
    offsets["after head 1"] = nodeAnchorOffset(shape, layout, "after head 1", options);
    offsets["tip 2"] = nodeAnchorOffset(shape, layout, "tip 2", options);
    offsets["before tip 2"] = nodeAnchorOffset(shape, layout, "before tip 2", options);
    offsets["after tip 2"] = nodeAnchorOffset(shape, layout, "after tip 2", options);
    offsets["before head 2"] = nodeAnchorOffset(shape, layout, "before head 2", options);
    offsets["after head 2"] = nodeAnchorOffset(shape, layout, "after head 2", options);
  }

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

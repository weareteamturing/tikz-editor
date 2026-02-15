import type { OptionListAst } from "../../options/types.js";
import type { SemanticContext } from "../context.js";
import type { Point } from "../types.js";
import {
  intersectRayWithPolygon,
  makeDiamondPolygon,
  makeRegularPolygon,
  makeSemicircle,
  makeStar,
  makeTrapeziumPolygon,
  midpoint,
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
  const anchorPolygon =
    shape === "diamond"
      ? makeDiamondPolygon(layout.anchorHalfWidth, layout.anchorHalfHeight, shapeGeometry.diamondAspect)
      : shape === "trapezium"
        ? makeTrapeziumAnchorPolygon(layout, shapeGeometry)
        : shape === "regular polygon"
          ? makeRegularPolygon(anchorSizingWithOuter(layout), shapeGeometry.regularPolygonSides, shapeGeometry.shapeBorderRotate)
          : shape === "star"
            ? makeStar(
                anchorSizingWithOuter(layout),
                shapeGeometry.starPoints,
                shapeGeometry.starPointRatio,
                shapeGeometry.starPointHeightPt,
                shapeGeometry.starUsesPointRatio,
                shapeGeometry.shapeBorderRotate
              ).polygon
            : shape === "semicircle"
              ? makeSemicircle(anchorSizingWithOuter(layout), shapeGeometry.shapeBorderRotate, 0).polygon
              : undefined;

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

  if (shape === "semicircle") {
    offsets.apex = nodeAnchorOffset(shape, layout, "apex", options);
    offsets["arc start"] = nodeAnchorOffset(shape, layout, "arc start", options);
    offsets["arc end"] = nodeAnchorOffset(shape, layout, "arc end", options);
    offsets["chord center"] = nodeAnchorOffset(shape, layout, "chord center", options);
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

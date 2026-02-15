import type { PathOptionItem } from "../../ast/types.js";
import type { NodeTextRenderInfo } from "../../text/types.js";
import { appendPathPoint, roundClosedPathStartCorner } from "../path/segments.js";
import type { Point, ResolvedStyle, SceneCircle, SceneEllipse, ScenePath, ScenePathCommand, SceneText } from "../types.js";
import {
  makeCircularSector,
  makeCylinder,
  makeDartPolygon,
  makeDiamondPolygon,
  makeIsoscelesTrianglePolygon,
  makeKitePolygon,
  makeRegularPolygon,
  makeSemicircle,
  makeStar,
  makeTrapeziumPolygon
} from "./shape-geometry.js";
import { normalizeOptionValue } from "./utils.js";

export function makeCircleElement(
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

export function makeTextElement(
  sourceId: string,
  itemId: string,
  position: Point,
  style: ResolvedStyle,
  span: { from: number; to: number },
  text: string,
  textBlockWidth?: number,
  textBlockHeight?: number,
  textRenderInfo?: NodeTextRenderInfo
): SceneText {
  return {
    kind: "Text",
    id: `scene-text:${sourceId}:${itemId}`,
    sourceId,
    sourceSpan: span,
    style: { ...style },
    position,
    text,
    textBlockWidth,
    textBlockHeight,
    textRenderInfo
  };
}

export function resolveNodeBoxPaintMode(options: PathOptionItem["options"] | undefined): { draw: boolean; fill: boolean } {
  let draw = false;
  let fill = false;

  if (!options) {
    return { draw, fill };
  }

  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "draw") {
        draw = true;
      } else if (entry.key === "fill") {
        fill = true;
      } else if (entry.key === "shade") {
        fill = true;
      }
      continue;
    }

    if (entry.kind !== "kv") {
      continue;
    }

    if (entry.key === "draw") {
      draw = normalizeOptionValue(entry.valueRaw).toLowerCase() !== "none";
      continue;
    }

    if (entry.key === "fill") {
      fill = normalizeOptionValue(entry.valueRaw).toLowerCase() !== "none";
      continue;
    }

    if (entry.key === "shade") {
      const value = normalizeOptionValue(entry.valueRaw).toLowerCase();
      fill = value !== "none" && value !== "false";
      continue;
    }

    if (
      entry.key === "shading" ||
      entry.key === "top color" ||
      entry.key === "bottom color" ||
      entry.key === "middle color" ||
      entry.key === "left color" ||
      entry.key === "right color" ||
      entry.key === "ball color" ||
      entry.key === "inner color" ||
      entry.key === "outer color" ||
      entry.key === "lower left" ||
      entry.key === "lower right" ||
      entry.key === "upper left" ||
      entry.key === "upper right"
    ) {
      fill = true;
    }
  }

  return { draw, fill };
}

export function applyNodeBoxPaintMode(style: ResolvedStyle, paintMode: { draw: boolean; fill: boolean }): ResolvedStyle {
  return {
    ...style,
    stroke: paintMode.draw ? style.stroke : null,
    fill: paintMode.fill ? style.fill : null,
    drawExplicit: paintMode.draw ? style.drawExplicit : false
  };
}

export function makeNodeBoxElement(
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
  const topLeft = { x: center.x - halfWidth, y: center.y - halfHeight };
  const topRight = { x: center.x + halfWidth, y: center.y - halfHeight };
  const bottomRight = { x: center.x + halfWidth, y: center.y + halfHeight };
  const bottomLeft = { x: center.x - halfWidth, y: center.y + halfHeight };
  const roundedCorners = style.roundedCorners;

  let commands: ScenePathCommand[];
  if (!roundedCorners || roundedCorners <= 0) {
    commands = [
      { kind: "M", to: topLeft },
      { kind: "L", to: topRight },
      { kind: "L", to: bottomRight },
      { kind: "L", to: bottomLeft },
      { kind: "Z" }
    ];
  } else {
    commands = [{ kind: "M", to: topLeft }];
    let previousSegmentRoundedCorners: number | null = null;
    let current = topLeft;

    for (const next of [topRight, bottomRight, bottomLeft, topLeft]) {
      const appended = appendPathPoint(commands, "--", current, next, previousSegmentRoundedCorners, roundedCorners);
      previousSegmentRoundedCorners = appended.nextRoundedCorners;
      current = next;
    }
    roundClosedPathStartCorner(commands, bottomLeft, topLeft, roundedCorners);
    commands.push({ kind: "Z" });
  }

  return {
    kind: "Path",
    id: `scene-node-box:${sourceId}:${itemId}`,
    sourceId,
    sourceSpan: span,
    style: { ...style },
    commands
  };
}

export function makeNodeEllipseElement(
  sourceId: string,
  itemId: string,
  center: Point,
  width: number,
  height: number,
  style: ResolvedStyle,
  span: { from: number; to: number }
): SceneEllipse {
  return {
    kind: "Ellipse",
    id: `scene-node-ellipse:${sourceId}:${itemId}`,
    sourceId,
    sourceSpan: span,
    style: { ...style },
    center,
    rx: width / 2,
    ry: height / 2
  };
}

export function makeNodeDiamondElement(
  sourceId: string,
  itemId: string,
  center: Point,
  width: number,
  height: number,
  aspect: number,
  style: ResolvedStyle,
  span: { from: number; to: number }
): ScenePath {
  const corners = makeDiamondPolygon(width / 2, height / 2, aspect).map((point) => ({
    x: center.x + point.x,
    y: center.y + point.y
  }));
  return makeNodePolygonElement(sourceId, itemId, corners, style, span);
}

export function makeNodeTrapeziumElement(
  sourceId: string,
  itemId: string,
  center: Point,
  naturalWidth: number,
  naturalHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  leftAngle: number,
  rightAngle: number,
  rotation: number,
  stretches: boolean,
  stretchesBody: boolean,
  style: ResolvedStyle,
  span: { from: number; to: number }
): ScenePath {
  const corners = makeTrapeziumPolygon(
    {
      naturalHalfWidth: naturalWidth / 2,
      naturalHalfHeight: naturalHeight / 2,
      minimumWidth,
      minimumHeight
    },
    leftAngle,
    rightAngle,
    rotation,
    stretches,
    stretchesBody
  ).map((point) => ({
    x: center.x + point.x,
    y: center.y + point.y
  }));
  return makeNodePolygonElement(sourceId, itemId, corners, style, span);
}

export function makeNodeIsoscelesTriangleElement(
  sourceId: string,
  itemId: string,
  center: Point,
  naturalWidth: number,
  naturalHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  apexAngle: number,
  rotation: number,
  stretches: boolean,
  style: ResolvedStyle,
  span: { from: number; to: number }
): ScenePath {
  const corners = makeIsoscelesTrianglePolygon(
    {
      naturalWidth,
      naturalHeight,
      minimumWidth,
      minimumHeight
    },
    apexAngle,
    rotation,
    stretches
  ).map((point) => ({
    x: center.x + point.x,
    y: center.y + point.y
  }));
  return makeNodePolygonElement(sourceId, itemId, corners, style, span);
}

export function makeNodeKiteElement(
  sourceId: string,
  itemId: string,
  center: Point,
  naturalWidth: number,
  naturalHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  upperVertexAngle: number,
  lowerVertexAngle: number,
  rotation: number,
  style: ResolvedStyle,
  span: { from: number; to: number }
): ScenePath {
  const corners = makeKitePolygon(
    {
      naturalWidth,
      naturalHeight,
      minimumWidth,
      minimumHeight
    },
    upperVertexAngle,
    lowerVertexAngle,
    rotation
  ).map((point) => ({
    x: center.x + point.x,
    y: center.y + point.y
  }));
  return makeNodePolygonElement(sourceId, itemId, corners, style, span);
}

export function makeNodeDartElement(
  sourceId: string,
  itemId: string,
  center: Point,
  naturalWidth: number,
  naturalHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  tipAngle: number,
  tailAngle: number,
  rotation: number,
  style: ResolvedStyle,
  span: { from: number; to: number }
): ScenePath {
  const corners = makeDartPolygon(
    {
      naturalWidth,
      naturalHeight,
      minimumWidth,
      minimumHeight
    },
    tipAngle,
    tailAngle,
    rotation
  ).map((point) => ({
    x: center.x + point.x,
    y: center.y + point.y
  }));
  return makeNodePolygonElement(sourceId, itemId, corners, style, span);
}

export function makeNodeSemicircleElement(
  sourceId: string,
  itemId: string,
  center: Point,
  naturalWidth: number,
  naturalHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  rotation: number,
  style: ResolvedStyle,
  span: { from: number; to: number }
): ScenePath {
  const semicircle = makeSemicircle(
    {
      naturalWidth,
      naturalHeight,
      minimumWidth,
      minimumHeight
    },
    rotation,
    0
  );
  const corners = semicircle.polygon.map((point) => ({
    x: center.x + point.x,
    y: center.y + point.y
  }));
  return makeNodePolygonElement(sourceId, itemId, corners, style, span);
}

export function makeNodeCircularSectorElement(
  sourceId: string,
  itemId: string,
  center: Point,
  naturalWidth: number,
  naturalHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  sectorAngle: number,
  rotation: number,
  style: ResolvedStyle,
  span: { from: number; to: number }
): ScenePath {
  const sector = makeCircularSector(
    {
      naturalWidth,
      naturalHeight,
      minimumWidth,
      minimumHeight
    },
    sectorAngle,
    rotation,
    0
  );
  const corners = sector.polygon.map((point) => ({
    x: center.x + point.x,
    y: center.y + point.y
  }));
  return makeNodePolygonElement(sourceId, itemId, corners, style, span);
}

export function makeNodeRegularPolygonElement(
  sourceId: string,
  itemId: string,
  center: Point,
  naturalWidth: number,
  naturalHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  sides: number,
  rotation: number,
  style: ResolvedStyle,
  span: { from: number; to: number }
): ScenePath {
  const corners = makeRegularPolygon(
    {
      naturalWidth,
      naturalHeight,
      minimumWidth,
      minimumHeight
    },
    sides,
    rotation
  ).map((point) => ({
    x: center.x + point.x,
    y: center.y + point.y
  }));
  return makeNodePolygonElement(sourceId, itemId, corners, style, span);
}

export function makeNodeCylinderElement(
  sourceId: string,
  itemId: string,
  center: Point,
  naturalWidth: number,
  naturalHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  aspect: number,
  rotation: number,
  style: ResolvedStyle,
  span: { from: number; to: number }
): ScenePath {
  const cylinder = makeCylinder(
    {
      naturalWidth,
      naturalHeight,
      minimumWidth,
      minimumHeight
    },
    aspect,
    rotation,
    0
  );
  const corners = cylinder.polygon.map((point) => ({
    x: center.x + point.x,
    y: center.y + point.y
  }));
  return makeNodePolygonElement(sourceId, itemId, corners, style, span);
}

export function makeNodeStarElement(
  sourceId: string,
  itemId: string,
  center: Point,
  naturalWidth: number,
  naturalHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  points: number,
  ratio: number,
  pointHeightPt: number,
  usesRatio: boolean,
  rotation: number,
  style: ResolvedStyle,
  span: { from: number; to: number }
): ScenePath {
  const star = makeStar(
    {
      naturalWidth,
      naturalHeight,
      minimumWidth,
      minimumHeight
    },
    points,
    ratio,
    pointHeightPt,
    usesRatio,
    rotation
  );
  const corners = star.polygon.map((point) => ({
    x: center.x + point.x,
    y: center.y + point.y
  }));
  return makeNodePolygonElement(sourceId, itemId, corners, style, span);
}

function makeNodePolygonElement(
  sourceId: string,
  itemId: string,
  corners: Point[],
  style: ResolvedStyle,
  span: { from: number; to: number }
): ScenePath {
  const first = corners[0] ?? { x: 0, y: 0 };
  const commands: ScenePathCommand[] = [{ kind: "M", to: first }];
  for (let index = 1; index < corners.length; index += 1) {
    commands.push({ kind: "L", to: corners[index] });
  }
  commands.push({ kind: "Z" });
  return {
    kind: "Path",
    id: `scene-node-box:${sourceId}:${itemId}`,
    sourceId,
    sourceSpan: span,
    style: { ...style },
    commands
  };
}

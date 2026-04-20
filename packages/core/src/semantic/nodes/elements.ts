import type { PathOptionItem } from "../../ast/types.js";
import type { NodeTextRenderInfo } from "../../text/types.js";
import { appendPathPoint, roundClosedPathStartCorner } from "../path/segments.js";
import type { WorldPoint } from "../../coords/points.js";
import type { ResolvedStyle, SceneAdornment, SceneCircle, SceneEllipse, ScenePath, ScenePathCommand, SceneText } from "../types.js";
import type { StyleChainEntry } from "../style-chain.js";
import { cloneStyleChain } from "../style-chain.js";
import {
  makeCircularSector,
  makeChamferedRectanglePolygon,
  makeCloudCallout,
  makeCloud,
  makeCylinder,
  makeDoubleArrow,
  makeDartPolygon,
  makeDiamondPolygon,
  makeMagnifyingGlassHandle,
  makeEllipseCallout,
  makeIsoscelesTrianglePolygon,
  makeKitePolygon,
  makeRectangleCallout,
  makeRegularPolygon,
  makeRoundedRectanglePolygon,
  makeSemicircle,
  makeSignal,
  makeSingleArrow,
  makeStar,
  makeStarburst,
  makeTape,
  type SignalDirection,
  type TapeBendStyle,
  makeTrapeziumPolygon
} from "./shape-geometry.js";
import { normalizeOptionValue } from "./utils.js";

export function makeCircleElement(
  sourceId: string,
  center: WorldPoint,
  radius: number,
  style: ResolvedStyle,
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = [],
  adornment?: SceneAdornment
): SceneCircle {
  return {
    kind: "Circle",
    id: `scene-circle:${sourceId}:${span.from}`,
    runtimeId: `scene-circle:${sourceId}:${span.from}`,
    sourceRef: { sourceId, sourceSpan: span, sourceFingerprint: "" },
    adornment,
    style: { ...style },
    styleChain: cloneStyleChain(styleChain),
    clipChain: [],
    center,
    radius
  };
}

export function makeTextElement(
  sourceId: string,
  itemId: string,
  position: WorldPoint,
  style: ResolvedStyle,
  span: { from: number; to: number },
  text: string,
  textBlockWidth?: number,
  textBlockHeight?: number,
  nodeVisualWidth?: number,
  nodeVisualHeight?: number,
  textRenderInfo?: NodeTextRenderInfo,
  rotation?: number,
  styleChain: StyleChainEntry[] = [],
  textSourceSpan?: { from: number; to: number },
  textHasFixedWidth?: boolean,
  adornment?: SceneAdornment
): SceneText {
  return {
    kind: "Text",
    id: `scene-text:${sourceId}:${itemId}`,
    runtimeId: `scene-text:${sourceId}:${itemId}`,
    sourceRef: { sourceId, sourceSpan: span, sourceFingerprint: "" },
    adornment,
    textSourceSpan,
    textHasFixedWidth,
    style: { ...style },
    styleChain: cloneStyleChain(styleChain),
    clipChain: [],
    position,
    text,
    textBlockWidth,
    textBlockHeight,
    nodeVisualWidth,
    nodeVisualHeight,
    textRenderInfo,
    rotation
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
      } else if (entry.key === "pattern") {
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

    if (entry.key === "pattern") {
      fill = normalizeOptionValue(entry.valueRaw).toLowerCase() !== "none";
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
    fillPattern: paintMode.fill ? style.fillPattern : null,
    drawExplicit: paintMode.draw ? style.drawExplicit : false
  };
}

export function makeNodeBoxElement(
  sourceId: string,
  itemId: string,
  center: WorldPoint,
  width: number,
  height: number,
  style: ResolvedStyle,
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = [],
  adornment?: SceneAdornment
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
    runtimeId: `scene-node-box:${sourceId}:${itemId}`,
    sourceRef: { sourceId, sourceSpan: span, sourceFingerprint: "" },
    adornment,
    style: { ...style },
    styleChain: cloneStyleChain(styleChain),
    clipChain: [],
    commands
  };
}

export function makeNodeEllipseElement(
  sourceId: string,
  itemId: string,
  center: WorldPoint,
  width: number,
  height: number,
  style: ResolvedStyle,
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = [],
  adornment?: SceneAdornment
): SceneEllipse {
  return {
    kind: "Ellipse",
    id: `scene-node-ellipse:${sourceId}:${itemId}`,
    runtimeId: `scene-node-ellipse:${sourceId}:${itemId}`,
    sourceRef: { sourceId, sourceSpan: span, sourceFingerprint: "" },
    adornment,
    style: { ...style },
    styleChain: cloneStyleChain(styleChain),
    clipChain: [],
    center,
    rx: width / 2,
    ry: height / 2
  };
}

export function makeNodeDiamondElement(
  sourceId: string,
  itemId: string,
  center: WorldPoint,
  width: number,
  height: number,
  aspect: number,
  style: ResolvedStyle,
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = []
): ScenePath {
  const corners = makeDiamondPolygon(width / 2, height / 2, aspect).map((point) => ({
    x: center.x + point.x,
    y: center.y + point.y
  }));
  return makeNodePolygonElement(sourceId, itemId, corners, style, span, styleChain);
}

export function makeNodeRoundedRectangleElement(
  sourceId: string,
  itemId: string,
  center: WorldPoint,
  width: number,
  height: number,
  arcLength: number,
  westArc: "convex" | "concave" | "none",
  eastArc: "convex" | "concave" | "none",
  style: ResolvedStyle,
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = []
): ScenePath {
  const corners = makeRoundedRectanglePolygon(width, height, arcLength, westArc, eastArc).map((point) => ({
    x: center.x + point.x,
    y: center.y + point.y
  }));
  return makeNodePolygonElement(sourceId, itemId, corners, style, span, styleChain);
}

export function makeNodeChamferedRectangleElement(
  sourceId: string,
  itemId: string,
  center: WorldPoint,
  width: number,
  height: number,
  chamferX: number,
  chamferY: number,
  chamferAngle: number,
  cornersRaw: string,
  style: ResolvedStyle,
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = []
): ScenePath {
  const corners = makeChamferedRectanglePolygon(width, height, chamferX, chamferY, chamferAngle, cornersRaw).map((point) => ({
    x: center.x + point.x,
    y: center.y + point.y
  }));
  return makeNodePolygonElement(sourceId, itemId, corners, style, span, styleChain);
}

export function makeNodeLineElement(
  sourceId: string,
  itemId: string,
  from: WorldPoint,
  to: WorldPoint,
  style: ResolvedStyle,
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = []
): ScenePath {
  return {
    kind: "Path",
    id: `scene-node-line:${sourceId}:${itemId}`,
    runtimeId: `scene-node-line:${sourceId}:${itemId}`,
    sourceRef: { sourceId, sourceSpan: span, sourceFingerprint: "" },
    style: { ...style },
    styleChain: cloneStyleChain(styleChain),
    clipChain: [],
    commands: [
      { kind: "M", to: from },
      { kind: "L", to }
    ]
  };
}

export function makeNodeMagnifyingHandleElement(
  sourceId: string,
  itemId: string,
  center: WorldPoint,
  radius: number,
  angleDegrees: number,
  aspect: number,
  style: ResolvedStyle,
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = []
): ScenePath {
  const handle = makeMagnifyingGlassHandle(radius, angleDegrees, aspect);
  return makeNodeLineElement(
    sourceId,
    itemId,
    { x: center.x + handle.from.x, y: center.y + handle.from.y },
    { x: center.x + handle.to.x, y: center.y + handle.to.y },
    style,
    span,
    styleChain
  );
}

export function makeNodeTrapeziumElement(
  sourceId: string,
  itemId: string,
  center: WorldPoint,
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
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = []
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
  return makeNodePolygonElement(sourceId, itemId, corners, style, span, styleChain);
}

export function makeNodeIsoscelesTriangleElement(
  sourceId: string,
  itemId: string,
  center: WorldPoint,
  naturalWidth: number,
  naturalHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  apexAngle: number,
  rotation: number,
  stretches: boolean,
  style: ResolvedStyle,
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = []
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
  return makeNodePolygonElement(sourceId, itemId, corners, style, span, styleChain);
}

export function makeNodeKiteElement(
  sourceId: string,
  itemId: string,
  center: WorldPoint,
  naturalWidth: number,
  naturalHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  upperVertexAngle: number,
  lowerVertexAngle: number,
  rotation: number,
  style: ResolvedStyle,
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = []
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
  return makeNodePolygonElement(sourceId, itemId, corners, style, span, styleChain);
}

export function makeNodeDartElement(
  sourceId: string,
  itemId: string,
  center: WorldPoint,
  naturalWidth: number,
  naturalHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  tipAngle: number,
  tailAngle: number,
  rotation: number,
  style: ResolvedStyle,
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = []
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
  return makeNodePolygonElement(sourceId, itemId, corners, style, span, styleChain);
}

export function makeNodeSemicircleElement(
  sourceId: string,
  itemId: string,
  center: WorldPoint,
  naturalWidth: number,
  naturalHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  rotation: number,
  style: ResolvedStyle,
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = []
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
  return makeNodePolygonElement(sourceId, itemId, corners, style, span, styleChain);
}

export function makeNodeCircularSectorElement(
  sourceId: string,
  itemId: string,
  center: WorldPoint,
  naturalWidth: number,
  naturalHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  sectorAngle: number,
  rotation: number,
  style: ResolvedStyle,
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = []
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
  return makeNodePolygonElement(sourceId, itemId, corners, style, span, styleChain);
}

export function makeNodeRegularPolygonElement(
  sourceId: string,
  itemId: string,
  center: WorldPoint,
  naturalWidth: number,
  naturalHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  sides: number,
  rotation: number,
  style: ResolvedStyle,
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = []
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
  return makeNodePolygonElement(sourceId, itemId, corners, style, span, styleChain);
}

export function makeNodeCylinderElement(
  sourceId: string,
  itemId: string,
  center: WorldPoint,
  naturalWidth: number,
  naturalHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  aspect: number,
  rotation: number,
  style: ResolvedStyle,
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = []
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
  return makeNodePolygonElement(sourceId, itemId, corners, style, span, styleChain);
}

export function makeNodeStarElement(
  sourceId: string,
  itemId: string,
  center: WorldPoint,
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
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = []
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
  return makeNodePolygonElement(sourceId, itemId, corners, style, span, styleChain);
}

export function makeNodeCloudElement(
  sourceId: string,
  itemId: string,
  center: WorldPoint,
  naturalWidth: number,
  naturalHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  puffs: number,
  puffArc: number,
  aspect: number,
  ignoresAspect: boolean,
  rotation: number,
  style: ResolvedStyle,
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = []
): ScenePath {
  const cloud = makeCloud(
    {
      naturalWidth,
      naturalHeight,
      minimumWidth,
      minimumHeight
    },
    puffs,
    puffArc,
    aspect,
    ignoresAspect,
    rotation
  );
  const corners = cloud.polygon.map((point) => ({
    x: center.x + point.x,
    y: center.y + point.y
  }));
  return makeNodePolygonElement(sourceId, itemId, corners, style, span, styleChain);
}

export function makeNodeStarburstElement(
  sourceId: string,
  itemId: string,
  center: WorldPoint,
  naturalWidth: number,
  naturalHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  points: number,
  pointHeightPt: number,
  randomSeed: number,
  rotation: number,
  style: ResolvedStyle,
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = []
): ScenePath {
  const starburst = makeStarburst(
    {
      naturalWidth,
      naturalHeight,
      minimumWidth,
      minimumHeight
    },
    points,
    pointHeightPt,
    randomSeed,
    rotation
  );
  const corners = starburst.polygon.map((point) => ({
    x: center.x + point.x,
    y: center.y + point.y
  }));
  return makeNodePolygonElement(sourceId, itemId, corners, style, span, styleChain);
}

export function makeNodeSignalElement(
  sourceId: string,
  itemId: string,
  center: WorldPoint,
  naturalWidth: number,
  naturalHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  pointerAngle: number,
  toSides: SignalDirection[],
  fromSides: SignalDirection[],
  style: ResolvedStyle,
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = []
): ScenePath {
  const signal = makeSignal(
    {
      naturalWidth,
      naturalHeight,
      minimumWidth,
      minimumHeight
    },
    pointerAngle,
    toSides,
    fromSides
  );
  const corners = signal.polygon.map((point) => ({
    x: center.x + point.x,
    y: center.y + point.y
  }));
  return makeNodePolygonElement(sourceId, itemId, corners, style, span, styleChain);
}

export function makeNodeTapeElement(
  sourceId: string,
  itemId: string,
  center: WorldPoint,
  naturalWidth: number,
  naturalHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  bendTop: TapeBendStyle,
  bendBottom: TapeBendStyle,
  bendHeightPt: number,
  style: ResolvedStyle,
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = []
): ScenePath {
  const tape = makeTape(
    {
      naturalWidth,
      naturalHeight,
      minimumWidth,
      minimumHeight
    },
    bendTop,
    bendBottom,
    bendHeightPt
  );
  const corners = tape.polygon.map((point) => ({
    x: center.x + point.x,
    y: center.y + point.y
  }));
  return makeNodePolygonElement(sourceId, itemId, corners, style, span, styleChain);
}

export function makeNodeRectangleCalloutElement(
  sourceId: string,
  itemId: string,
  center: WorldPoint,
  naturalWidth: number,
  naturalHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  pointerOffset: WorldPoint,
  pointerWidthPt: number,
  pointerIsAbsolute: boolean,
  pointerShortenPt: number,
  style: ResolvedStyle,
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = []
): ScenePath {
  const callout = makeRectangleCallout(
    {
      naturalWidth,
      naturalHeight,
      minimumWidth,
      minimumHeight
    },
    pointerOffset,
    pointerWidthPt,
    pointerIsAbsolute,
    pointerShortenPt
  );
  const corners = callout.polygon.map((point) => ({
    x: center.x + point.x,
    y: center.y + point.y
  }));
  return makeNodePolygonElement(sourceId, itemId, corners, style, span, styleChain);
}

export function makeNodeEllipseCalloutElement(
  sourceId: string,
  itemId: string,
  center: WorldPoint,
  naturalWidth: number,
  naturalHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  pointerOffset: WorldPoint,
  pointerArc: number,
  pointerIsAbsolute: boolean,
  pointerShortenPt: number,
  style: ResolvedStyle,
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = []
): ScenePath {
  const callout = makeEllipseCallout(
    {
      naturalWidth,
      naturalHeight,
      minimumWidth,
      minimumHeight
    },
    pointerOffset,
    pointerArc,
    pointerIsAbsolute,
    pointerShortenPt
  );
  const corners = callout.polygon.map((point) => ({
    x: center.x + point.x,
    y: center.y + point.y
  }));
  return makeNodePolygonElement(sourceId, itemId, corners, style, span, styleChain);
}

export function makeNodeCloudCalloutElement(
  sourceId: string,
  itemId: string,
  center: WorldPoint,
  naturalWidth: number,
  naturalHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  puffs: number,
  puffArc: number,
  aspect: number,
  ignoresAspect: boolean,
  rotation: number,
  pointerOffset: WorldPoint,
  pointerStartSizeRaw: string,
  pointerEndSizeRaw: string,
  pointerSegments: number,
  pointerIsAbsolute: boolean,
  pointerShortenPt: number,
  style: ResolvedStyle,
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = []
): ScenePath {
  const callout = makeCloudCallout(
    {
      naturalWidth,
      naturalHeight,
      minimumWidth,
      minimumHeight
    },
    puffs,
    puffArc,
    aspect,
    ignoresAspect,
    rotation,
    pointerOffset,
    pointerStartSizeRaw,
    pointerEndSizeRaw,
    pointerSegments,
    pointerIsAbsolute,
    pointerShortenPt
  );
  const cloudPolygon = callout.polygon.map((point) => ({
    x: center.x + point.x,
    y: center.y + point.y
  }));
  const pointerPolygon = callout.pointerPolygon.map((point) => ({
    x: center.x + point.x,
    y: center.y + point.y
  }));
  return makeNodeMultiPolygonElement(sourceId, itemId, [cloudPolygon, pointerPolygon], style, span, styleChain);
}

export function makeNodeSingleArrowElement(
  sourceId: string,
  itemId: string,
  center: WorldPoint,
  naturalWidth: number,
  naturalHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  tipAngle: number,
  headExtendPt: number,
  headIndentPt: number,
  rotation: number,
  style: ResolvedStyle,
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = []
): ScenePath {
  const arrow = makeSingleArrow(
    {
      naturalWidth,
      naturalHeight,
      minimumWidth,
      minimumHeight
    },
    tipAngle,
    headExtendPt,
    headIndentPt,
    rotation
  );
  const corners = arrow.polygon.map((point) => ({
    x: center.x + point.x,
    y: center.y + point.y
  }));
  return makeNodePolygonElement(sourceId, itemId, corners, style, span, styleChain);
}

export function makeNodeDoubleArrowElement(
  sourceId: string,
  itemId: string,
  center: WorldPoint,
  naturalWidth: number,
  naturalHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  tipAngle: number,
  headExtendPt: number,
  headIndentPt: number,
  rotation: number,
  style: ResolvedStyle,
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = []
): ScenePath {
  const arrow = makeDoubleArrow(
    {
      naturalWidth,
      naturalHeight,
      minimumWidth,
      minimumHeight
    },
    tipAngle,
    headExtendPt,
    headIndentPt,
    rotation
  );
  const corners = arrow.polygon.map((point) => ({
    x: center.x + point.x,
    y: center.y + point.y
  }));
  return makeNodePolygonElement(sourceId, itemId, corners, style, span, styleChain);
}

function makeNodePolygonElement(
  sourceId: string,
  itemId: string,
  corners: WorldPoint[],
  style: ResolvedStyle,
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = []
): ScenePath {
  const first = corners[0];
  if (!first) {
    throw new Error("Node polygon geometry requires at least one corner.");
  }
  const commands: ScenePathCommand[] = [{ kind: "M", to: first }];
  for (let index = 1; index < corners.length; index += 1) {
    commands.push({ kind: "L", to: corners[index] });
  }
  commands.push({ kind: "Z" });
  return {
    kind: "Path",
    id: `scene-node-box:${sourceId}:${itemId}`,
    runtimeId: `scene-node-box:${sourceId}:${itemId}`,
    sourceRef: { sourceId, sourceSpan: span, sourceFingerprint: "" },
    style: { ...style },
    styleChain: cloneStyleChain(styleChain),
    commands
  };
}

function makeNodeMultiPolygonElement(
  sourceId: string,
  itemId: string,
  polygons: WorldPoint[][],
  style: ResolvedStyle,
  span: { from: number; to: number },
  styleChain: StyleChainEntry[] = []
): ScenePath {
  const commands: ScenePathCommand[] = [];
  for (const polygon of polygons) {
    const first = polygon[0];
    if (!first) {
      continue;
    }
    commands.push({ kind: "M", to: first });
    for (let index = 1; index < polygon.length; index += 1) {
      commands.push({ kind: "L", to: polygon[index] });
    }
    commands.push({ kind: "Z" });
  }

  if (commands.length === 0) {
    throw new Error("Node multi-polygon geometry requires at least one non-empty polygon.");
  }

  return {
    kind: "Path",
    id: `scene-node-box:${sourceId}:${itemId}`,
    runtimeId: `scene-node-box:${sourceId}:${itemId}`,
    sourceRef: { sourceId, sourceSpan: span, sourceFingerprint: "" },
    style: { ...style },
    styleChain: cloneStyleChain(styleChain),
    commands
  };
}

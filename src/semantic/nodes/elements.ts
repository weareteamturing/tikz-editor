import type { PathOptionItem } from "../../ast/types.js";
import type { NodeTextRenderInfo } from "../../text/types.js";
import { appendPathPoint, roundClosedPathStartCorner } from "../path/segments.js";
import type { Point, ResolvedStyle, SceneCircle, SceneEllipse, ScenePath, ScenePathCommand, SceneText } from "../types.js";
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

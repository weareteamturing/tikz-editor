import type { Point, ResolvedStyle, SceneCircle, SceneElement, SceneEllipse, ScenePath, ScenePathCommand } from "../types.js";
import type { Matrix2D } from "../types.js";
import { applyMatrix, inverseMatrix } from "../transform.js";
import { appendPathPoint, roundClosedPathStartCorner } from "./segments.js";
import type { StyleChainEntry } from "../style-chain.js";
import { cloneStyleChain } from "../style-chain.js";

export function makePath(
  sourceId: string,
  itemId: string,
  style: ResolvedStyle,
  styleChain: StyleChainEntry[],
  span: { from: number; to: number }
): ScenePath {
  return {
    kind: "Path",
    id: `scene-path:${sourceId}:${itemId}`,
    sourceId,
    sourceSpan: span,
    style: { ...style },
    styleChain: cloneStyleChain(styleChain),
    commands: []
  };
}

export function ensurePathForSubpath(
  activePath: ScenePath | null,
  sourceId: string,
  itemId: string,
  style: ResolvedStyle,
  styleChain: StyleChainEntry[],
  span: { from: number; to: number }
): ScenePath {
  if (activePath) {
    return activePath;
  }
  return makePath(sourceId, itemId, style, styleChain, span);
}

export function appendRectangleSubpath(
  commands: ScenePathCommand[],
  from: Point,
  to: Point,
  roundedCorners: number | null = null,
  transform?: Matrix2D
): void {
  const corners = resolveRectangleCorners(from, to, transform);
  const start = corners[0];
  const topRight = corners[1];
  const opposite = corners[2];
  const bottomLeft = corners[3];

  if (!roundedCorners || roundedCorners <= 0) {
    commands.push({ kind: "M", to: start });
    commands.push({ kind: "L", to: topRight });
    commands.push({ kind: "L", to: opposite });
    commands.push({ kind: "L", to: bottomLeft });
    commands.push({ kind: "Z" });
    return;
  }

  commands.push({ kind: "M", to: start });
  let previousSegmentRoundedCorners: number | null = null;
  previousSegmentRoundedCorners = appendPathPoint(
    commands,
    "--",
    start,
    topRight,
    previousSegmentRoundedCorners,
    roundedCorners
  ).nextRoundedCorners;
  previousSegmentRoundedCorners = appendPathPoint(
    commands,
    "--",
    topRight,
    opposite,
    previousSegmentRoundedCorners,
    roundedCorners
  ).nextRoundedCorners;
  previousSegmentRoundedCorners = appendPathPoint(
    commands,
    "--",
    opposite,
    bottomLeft,
    previousSegmentRoundedCorners,
    roundedCorners
  ).nextRoundedCorners;
  appendPathPoint(commands, "--", bottomLeft, start, previousSegmentRoundedCorners, roundedCorners);
  roundClosedPathStartCorner(commands, bottomLeft, start, roundedCorners);
  commands.push({ kind: "Z" });
}

export function appendCircleSubpath(commands: ScenePathCommand[], center: Point, radius: number): void {
  appendEllipseSubpath(commands, center, radius, radius, 0);
}

export function appendEllipseSubpath(commands: ScenePathCommand[], center: Point, rx: number, ry: number, rotation: number): void {
  const theta = (rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const axis = { x: rx * cos, y: rx * sin };
  const start = { x: center.x + axis.x, y: center.y + axis.y };
  const opposite = { x: center.x - axis.x, y: center.y - axis.y };

  commands.push({ kind: "M", to: start });
  commands.push({
    kind: "A",
    rx,
    ry,
    xAxisRotation: rotation,
    largeArc: false,
    sweep: true,
    to: opposite
  });
  commands.push({
    kind: "A",
    rx,
    ry,
    xAxisRotation: rotation,
    largeArc: false,
    sweep: true,
    to: start
  });
  commands.push({ kind: "Z" });
}

export function hasDrawablePathSegments(path: ScenePath): boolean {
  return path.commands.some((command) => command.kind === "L" || command.kind === "C" || command.kind === "A");
}

export function dropUndrawnActivePath(path: ScenePath | null): ScenePath | null {
  if (!path) {
    return null;
  }
  return hasDrawablePathSegments(path) ? path : null;
}

export function flushDrawableActivePath(elements: SceneElement[], path: ScenePath | null): ScenePath | null {
  const drawable = dropUndrawnActivePath(path);
  if (drawable) {
    elements.push(drawable);
  }
  return null;
}

export function makeRectangleElement(
  sourceId: string,
  itemId: string,
  from: Point,
  to: Point,
  style: ResolvedStyle,
  styleChain: StyleChainEntry[],
  span: { from: number; to: number },
  roundedCorners: number | null = style.roundedCorners,
  transform?: Matrix2D
): ScenePath {
  const commands: ScenePathCommand[] = [];
  appendRectangleSubpath(commands, from, to, roundedCorners, transform);

  return {
    kind: "Path",
    id: `scene-rectangle:${sourceId}:${itemId}`,
    sourceId,
    sourceSpan: span,
    style: { ...style },
    styleChain: cloneStyleChain(styleChain),
    commands
  };
}

function resolveRectangleCorners(from: Point, to: Point, transform?: Matrix2D): [Point, Point, Point, Point] {
  if (!transform) {
    return [from, { x: to.x, y: from.y }, to, { x: from.x, y: to.y }];
  }

  const localFrom = applyInverseMatrix(transform, from);
  const localTo = applyInverseMatrix(transform, to);
  if (!localFrom || !localTo) {
    return [from, { x: to.x, y: from.y }, to, { x: from.x, y: to.y }];
  }

  const localTopRight = { x: localTo.x, y: localFrom.y };
  const localBottomLeft = { x: localFrom.x, y: localTo.y };
  return [
    applyMatrix(transform, localFrom),
    applyMatrix(transform, localTopRight),
    applyMatrix(transform, localTo),
    applyMatrix(transform, localBottomLeft)
  ];
}

function applyInverseMatrix(matrix: Matrix2D, point: Point): Point | null {
  const inv = inverseMatrix(matrix);
  if (!inv) {
    return null;
  }
  return applyMatrix(inv, point);
}

export function makeCircleElement(
  sourceId: string,
  center: Point,
  radius: number,
  style: ResolvedStyle,
  styleChain: StyleChainEntry[],
  span: { from: number; to: number }
): SceneCircle {
  return {
    kind: "Circle",
    id: `scene-circle:${sourceId}:${span.from}`,
    sourceId,
    sourceSpan: span,
    style: { ...style },
    styleChain: cloneStyleChain(styleChain),
    center,
    radius
  };
}

export function makeEllipseElement(
  sourceId: string,
  center: Point,
  rx: number,
  ry: number,
  style: ResolvedStyle,
  styleChain: StyleChainEntry[],
  span: { from: number; to: number },
  rotation = 0
): SceneEllipse {
  return {
    kind: "Ellipse",
    id: `scene-ellipse:${sourceId}:${span.from}`,
    sourceId,
    sourceSpan: span,
    style: { ...style },
    styleChain: cloneStyleChain(styleChain),
    center,
    rx,
    ry,
    rotation
  };
}

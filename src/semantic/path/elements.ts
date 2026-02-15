import type { Point, ResolvedStyle, SceneCircle, SceneElement, SceneEllipse, ScenePath, ScenePathCommand } from "../types.js";
import { appendPathPoint, roundClosedPathStartCorner } from "./segments.js";

export function makePath(sourceId: string, itemId: string, style: ResolvedStyle, span: { from: number; to: number }): ScenePath {
  return {
    kind: "Path",
    id: `scene-path:${sourceId}:${itemId}`,
    sourceId,
    sourceSpan: span,
    style: { ...style },
    commands: []
  };
}

export function ensurePathForSubpath(
  activePath: ScenePath | null,
  sourceId: string,
  itemId: string,
  style: ResolvedStyle,
  span: { from: number; to: number }
): ScenePath {
  if (activePath) {
    return activePath;
  }
  return makePath(sourceId, itemId, style, span);
}

export function appendRectangleSubpath(
  commands: ScenePathCommand[],
  from: Point,
  to: Point,
  roundedCorners: number | null = null
): void {
  const topRight = { x: to.x, y: from.y };
  const bottomLeft = { x: from.x, y: to.y };

  if (!roundedCorners || roundedCorners <= 0) {
    commands.push({ kind: "M", to: from });
    commands.push({ kind: "L", to: topRight });
    commands.push({ kind: "L", to });
    commands.push({ kind: "L", to: bottomLeft });
    commands.push({ kind: "Z" });
    return;
  }

  commands.push({ kind: "M", to: from });
  let previousSegmentRoundedCorners: number | null = null;
  previousSegmentRoundedCorners = appendPathPoint(
    commands,
    "--",
    from,
    topRight,
    previousSegmentRoundedCorners,
    roundedCorners
  ).nextRoundedCorners;
  previousSegmentRoundedCorners = appendPathPoint(
    commands,
    "--",
    topRight,
    to,
    previousSegmentRoundedCorners,
    roundedCorners
  ).nextRoundedCorners;
  previousSegmentRoundedCorners = appendPathPoint(
    commands,
    "--",
    to,
    bottomLeft,
    previousSegmentRoundedCorners,
    roundedCorners
  ).nextRoundedCorners;
  appendPathPoint(commands, "--", bottomLeft, from, previousSegmentRoundedCorners, roundedCorners);
  roundClosedPathStartCorner(commands, bottomLeft, from, roundedCorners);
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
  span: { from: number; to: number },
  roundedCorners: number | null = style.roundedCorners
): ScenePath {
  const commands: ScenePathCommand[] = [];
  appendRectangleSubpath(commands, from, to, roundedCorners);

  return {
    kind: "Path",
    id: `scene-rectangle:${sourceId}:${itemId}`,
    sourceId,
    sourceSpan: span,
    style: { ...style },
    commands
  };
}

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

export function makeEllipseElement(
  sourceId: string,
  center: Point,
  rx: number,
  ry: number,
  style: ResolvedStyle,
  span: { from: number; to: number },
  rotation = 0
): SceneEllipse {
  return {
    kind: "Ellipse",
    id: `scene-ellipse:${sourceId}:${span.from}`,
    sourceId,
    sourceSpan: span,
    style: { ...style },
    center,
    rx,
    ry,
    rotation
  };
}

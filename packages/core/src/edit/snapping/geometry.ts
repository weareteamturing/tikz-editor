import { unsafeBounds, unsafePoint } from "../../coords/points.js";
import type {
  SceneElement,
  ScenePath,
  ScenePathCommand,
  SceneText
} from "../../semantic/types.js";
import type { WorldBounds, WorldPoint } from "../../coords/points.js";
import type { SelectionGeometry, SnapBounds, SnapPoint } from "./types.js";

export const SNAP_EPSILON = 1e-6;

export function mergeBounds(a: WorldBounds, b: WorldBounds): WorldBounds {
  return unsafeBounds<WorldBounds>(
    Math.min(a.minX, b.minX),
    Math.min(a.minY, b.minY),
    Math.max(a.maxX, b.maxX),
    Math.max(a.maxY, b.maxY)
  );
}

export function boundsCenter(bounds: WorldBounds): WorldPoint {
  return unsafePoint<WorldPoint>(
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2
  );
}

export function boundsFromPoints(a: WorldPoint, b: WorldPoint): WorldBounds {
  return unsafeBounds<WorldBounds>(
    Math.min(a.x, b.x),
    Math.min(a.y, b.y),
    Math.max(a.x, b.x),
    Math.max(a.y, b.y)
  );
}

export function translateBounds(bounds: WorldBounds, delta: WorldPoint): WorldBounds {
  return unsafeBounds<WorldBounds>(
    bounds.minX + delta.x,
    bounds.minY + delta.y,
    bounds.maxX + delta.x,
    bounds.maxY + delta.y
  );
}

export function translatePoints(points: readonly WorldPoint[], delta: WorldPoint): WorldPoint[] {
  return points.map((point) => unsafePoint<WorldPoint>(point.x + delta.x, point.y + delta.y));
}

export function expandBounds(bounds: WorldBounds, padding: number): WorldBounds {
  return unsafeBounds<WorldBounds>(
    bounds.minX - padding,
    bounds.minY - padding,
    bounds.maxX + padding,
    bounds.maxY + padding
  );
}

export function boundsIntersect(a: WorldBounds, b: WorldBounds): boolean {
  return !(
    a.maxX < b.minX - SNAP_EPSILON ||
    b.maxX < a.minX - SNAP_EPSILON ||
    a.maxY < b.minY - SNAP_EPSILON ||
    b.maxY < a.minY - SNAP_EPSILON
  );
}

export function rangeIntersection(a: [number, number], b: [number, number]): [number, number] | null {
  const lo = Math.max(a[0], b[0]);
  const hi = Math.min(a[1], b[1]);
  return hi < lo - SNAP_EPSILON ? null : [lo, hi];
}

export function rangesOverlap(a: [number, number], b: [number, number]): boolean {
  return rangeIntersection(a, b) !== null;
}

export function selectionSnapPointsFromBounds(bounds: WorldBounds): WorldPoint[] {
  const center = boundsCenter(bounds);
  return [
    unsafePoint<WorldPoint>(bounds.minX, bounds.minY),
    unsafePoint<WorldPoint>(bounds.maxX, bounds.minY),
    unsafePoint<WorldPoint>(bounds.minX, bounds.maxY),
    unsafePoint<WorldPoint>(bounds.maxX, bounds.maxY),
    center
  ];
}

export function collectSourceWorldBounds(elements: SceneElement[]): Map<string, SnapBounds> {
  const boundsBySource = new Map<string, SnapBounds>();

  for (const element of elements) {
    if (element.adornment) {
      continue;
    }
    const bounds = elementBoundsInWorld(element);
    if (!bounds) continue;
    addBoundsForSourceId(boundsBySource, element.sourceRef.sourceId, bounds);
    if (element.matrixCell) {
      addBoundsForSourceId(boundsBySource, element.matrixCell.matrixSourceId, bounds);
    }
  }

  return boundsBySource;
}

export function collectSourceReferenceBounds(elements: SceneElement[]): Map<string, SnapBounds> {
  const boundsBySource = new Map<string, SnapBounds>();

  for (const element of elements) {
    if (element.adornment) {
      continue;
    }
    if (!isElementReferenceSnappable(element)) {
      continue;
    }

    const bounds = elementBoundsInWorld(element);
    if (!bounds) continue;
    addBoundsForSourceId(boundsBySource, element.sourceRef.sourceId, bounds);
    if (element.matrixCell) {
      addBoundsForSourceId(boundsBySource, element.matrixCell.matrixSourceId, bounds);
    }
  }

  return boundsBySource;
}

function addBoundsForSourceId(boundsBySource: Map<string, SnapBounds>, sourceId: string, bounds: WorldBounds): void {
  const normalized = sourceId.trim();
  if (normalized.length === 0) {
    return;
  }
  const existing = boundsBySource.get(normalized);
  const merged = existing ? mergeBounds(existing, bounds) : bounds;
  boundsBySource.set(normalized, {
    ...merged,
    sourceId: normalized
  });
}

export function collectSourceSnapPoints(boundsBySource: Iterable<SnapBounds>): SnapPoint[] {
  const points: SnapPoint[] = [];

  for (const bounds of boundsBySource) {
    points.push(
      { sourceId: bounds.sourceId, role: "corner", x: bounds.minX, y: bounds.minY },
      { sourceId: bounds.sourceId, role: "corner", x: bounds.maxX, y: bounds.minY },
      { sourceId: bounds.sourceId, role: "corner", x: bounds.minX, y: bounds.maxY },
      { sourceId: bounds.sourceId, role: "corner", x: bounds.maxX, y: bounds.maxY },
      {
        sourceId: bounds.sourceId,
        role: "center",
        ...boundsCenter(bounds)
      }
    );
  }

  return points;
}

export function collectSelectionGeometryFromBounds(
  boundsBySource: ReadonlyMap<string, SnapBounds>,
  selectedSourceIds: readonly string[]
): SelectionGeometry | null {
  let mergedBounds: WorldBounds | null = null;

  for (const sourceId of selectedSourceIds) {
    const sourceBounds = boundsBySource.get(sourceId);
    if (!sourceBounds) continue;
    mergedBounds = mergedBounds ? mergeBounds(mergedBounds, sourceBounds) : sourceBounds;
  }

  if (!mergedBounds) {
    return null;
  }

  return {
    bounds: mergedBounds,
    snapPoints: selectionSnapPointsFromBounds(mergedBounds)
  };
}

export function collectSelectionGeometry(
  elements: SceneElement[],
  selectedSourceIds: readonly string[]
): SelectionGeometry | null {
  const boundsBySource = collectSourceWorldBounds(elements);
  return collectSelectionGeometryFromBounds(boundsBySource, selectedSourceIds);
}

function elementBoundsInWorld(element: SceneElement): WorldBounds | null {
  if (element.kind === "Path") {
    const bounds = pathBoundsInWorld(element);
    if (!bounds) {
      return null;
    }
    return element.transform ? transformBounds(bounds, element.transform) : bounds;
  }

  if (element.kind === "Circle") {
    const bounds = unsafeBounds<WorldBounds>(
      element.center.x - element.radius,
      element.center.y - element.radius,
      element.center.x + element.radius,
      element.center.y + element.radius
    );
    return element.transform ? transformBounds(bounds, element.transform) : bounds;
  }

  if (element.kind === "Ellipse") {
    const bounds = computeEllipseBounds(element.center.x, element.center.y, element.rx, element.ry, element.rotation ?? 0);
    return element.transform ? transformBounds(bounds, element.transform) : bounds;
  }

  const bounds = textBoundsInWorld(element);
  return element.transform ? transformBounds(bounds, element.transform) : bounds;
}

function isElementReferenceSnappable(element: SceneElement): boolean {
  if (element.kind !== "Path") {
    return true;
  }

  return pathIsClosed(element.commands);
}

function pathIsClosed(commands: readonly ScenePathCommand[]): boolean {
  return commands.some((command) => command.kind === "Z");
}

function textBoundsInWorld(element: SceneText): WorldBounds {
  const width = element.textBlockWidth ?? estimateTextBlockWidth(element.text, element.style.fontSize);
  const lineCount = Math.max(1, element.text.split("\n").length);
  const height = element.textBlockHeight ?? lineCount * element.style.fontSize * 1.15;

  return computeRotatedRectBounds(
    element.position.x,
    element.position.y,
    width,
    height,
    element.rotation ?? 0
  );
}

function pathBoundsInWorld(path: ScenePath): WorldBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let previous: WorldPoint | null = null;

  const includePoint = (point: WorldPoint) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  };

  for (const command of path.commands) {
    if (command.kind === "Z") continue;

    if (command.kind === "C") {
      includePoint(command.c1);
      includePoint(command.c2);
    }

    if (command.kind === "A") {
      if (previous) {
        includePoint(unsafePoint<WorldPoint>(previous.x - command.rx, previous.y - command.ry));
        includePoint(unsafePoint<WorldPoint>(previous.x + command.rx, previous.y + command.ry));
      }

      includePoint(unsafePoint<WorldPoint>(command.to.x - command.rx, command.to.y - command.ry));
      includePoint(unsafePoint<WorldPoint>(command.to.x + command.rx, command.to.y + command.ry));
      previous = command.to;
      continue;
    }

    includePoint(command.to);
    previous = command.to;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return unsafeBounds<WorldBounds>(minX, minY, maxX, maxY);
}

function computeEllipseBounds(cx: number, cy: number, rx: number, ry: number, rotation: number): WorldBounds {
  const theta = (rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const extentX = Math.sqrt(rx * rx * cos * cos + ry * ry * sin * sin);
  const extentY = Math.sqrt(rx * rx * sin * sin + ry * ry * cos * cos);

  return unsafeBounds<WorldBounds>(cx - extentX, cy - extentY, cx + extentX, cy + extentY);
}

function computeRotatedRectBounds(cx: number, cy: number, width: number, height: number, rotation: number): WorldBounds {
  const halfWidth = width / 2;
  const halfHeight = height / 2;

  if (Math.abs(rotation) <= 1e-6) {
    return unsafeBounds<WorldBounds>(cx - halfWidth, cy - halfHeight, cx + halfWidth, cy + halfHeight);
  }

  const theta = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(theta));
  const sin = Math.abs(Math.sin(theta));
  const extentX = halfWidth * cos + halfHeight * sin;
  const extentY = halfWidth * sin + halfHeight * cos;

  return unsafeBounds<WorldBounds>(cx - extentX, cy - extentY, cx + extentX, cy + extentY);
}

function transformBounds(
  bounds: WorldBounds,
  transform: { a: number; b: number; c: number; d: number; e: number; f: number }
): WorldBounds {
  const corners: WorldPoint[] = [
    unsafePoint<WorldPoint>(bounds.minX, bounds.minY),
    unsafePoint<WorldPoint>(bounds.maxX, bounds.minY),
    unsafePoint<WorldPoint>(bounds.maxX, bounds.maxY),
    unsafePoint<WorldPoint>(bounds.minX, bounds.maxY)
  ];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of corners) {
    const mapped = unsafePoint<WorldPoint>(
      transform.a * point.x + transform.c * point.y + transform.e,
      transform.b * point.x + transform.d * point.y + transform.f
    );
    minX = Math.min(minX, mapped.x);
    minY = Math.min(minY, mapped.y);
    maxX = Math.max(maxX, mapped.x);
    maxY = Math.max(maxY, mapped.y);
  }
  return unsafeBounds<WorldBounds>(minX, minY, maxX, maxY);
}

function estimateTextBlockWidth(text: string, fontSize: number): number {
  const lines = text.split("\n");
  const maxChars = lines.reduce((max, line) => Math.max(max, line.length), 0);
  if (maxChars <= 0) return 0;
  return maxChars * fontSize * 0.7;
}

export function shiftPathCommand(command: ScenePathCommand, delta: WorldPoint): ScenePathCommand {
  if (command.kind === "Z") {
    return command;
  }
  if (command.kind === "A") {
    return {
      ...command,
      to: {
        x: command.to.x + delta.x,
        y: command.to.y + delta.y
      }
    };
  }
  if (command.kind === "C") {
    return {
      ...command,
      c1: {
        x: command.c1.x + delta.x,
        y: command.c1.y + delta.y
      },
      c2: {
        x: command.c2.x + delta.x,
        y: command.c2.y + delta.y
      },
      to: {
        x: command.to.x + delta.x,
        y: command.to.y + delta.y
      }
    };
  }
  return {
    ...command,
    to: {
      x: command.to.x + delta.x,
      y: command.to.y + delta.y
    }
  };
}

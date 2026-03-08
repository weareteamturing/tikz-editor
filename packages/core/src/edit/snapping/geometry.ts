import type {
  Bounds,
  Point,
  SceneElement,
  ScenePath,
  ScenePathCommand,
  SceneText
} from "../../semantic/types.js";
import type { SelectionGeometry, SnapBounds, SnapPoint } from "./types.js";

export const SNAP_EPSILON = 1e-6;

export function mergeBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY)
  };
}

export function boundsCenter(bounds: Bounds): Point {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2
  };
}

export function boundsFromPoints(a: Point, b: Point): Bounds {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y)
  };
}

export function translateBounds(bounds: Bounds, delta: Point): Bounds {
  return {
    minX: bounds.minX + delta.x,
    minY: bounds.minY + delta.y,
    maxX: bounds.maxX + delta.x,
    maxY: bounds.maxY + delta.y
  };
}

export function translatePoints(points: readonly Point[], delta: Point): Point[] {
  return points.map((point) => ({
    x: point.x + delta.x,
    y: point.y + delta.y
  }));
}

export function expandBounds(bounds: Bounds, padding: number): Bounds {
  return {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    maxX: bounds.maxX + padding,
    maxY: bounds.maxY + padding
  };
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
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

export function selectionSnapPointsFromBounds(bounds: Bounds): Point[] {
  const center = boundsCenter(bounds);
  return [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.minX, y: bounds.maxY },
    { x: bounds.maxX, y: bounds.maxY },
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

    const existing = boundsBySource.get(element.sourceId);
    const merged = existing ? mergeBounds(existing, bounds) : bounds;
    boundsBySource.set(element.sourceId, {
      ...merged,
      sourceId: element.sourceId
    });
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

    const existing = boundsBySource.get(element.sourceId);
    const merged = existing ? mergeBounds(existing, bounds) : bounds;
    boundsBySource.set(element.sourceId, {
      ...merged,
      sourceId: element.sourceId
    });
  }

  return boundsBySource;
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
  let mergedBounds: Bounds | null = null;

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

function elementBoundsInWorld(element: SceneElement): Bounds | null {
  if (element.kind === "Path") {
    return pathBoundsInWorld(element);
  }

  if (element.kind === "Circle") {
    return {
      minX: element.center.x - element.radius,
      minY: element.center.y - element.radius,
      maxX: element.center.x + element.radius,
      maxY: element.center.y + element.radius
    };
  }

  if (element.kind === "Ellipse") {
    return computeEllipseBounds(element.center.x, element.center.y, element.rx, element.ry, element.rotation ?? 0);
  }

  return textBoundsInWorld(element);
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

function textBoundsInWorld(element: SceneText): Bounds {
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

function pathBoundsInWorld(path: ScenePath): Bounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let previous: Point | null = null;

  const includePoint = (point: Point) => {
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
        includePoint({ x: previous.x - command.rx, y: previous.y - command.ry });
        includePoint({ x: previous.x + command.rx, y: previous.y + command.ry });
      }

      includePoint({ x: command.to.x - command.rx, y: command.to.y - command.ry });
      includePoint({ x: command.to.x + command.rx, y: command.to.y + command.ry });
      previous = command.to;
      continue;
    }

    includePoint(command.to);
    previous = command.to;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

function computeEllipseBounds(cx: number, cy: number, rx: number, ry: number, rotation: number): Bounds {
  const theta = (rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const extentX = Math.sqrt(rx * rx * cos * cos + ry * ry * sin * sin);
  const extentY = Math.sqrt(rx * rx * sin * sin + ry * ry * cos * cos);

  return {
    minX: cx - extentX,
    maxX: cx + extentX,
    minY: cy - extentY,
    maxY: cy + extentY
  };
}

function computeRotatedRectBounds(cx: number, cy: number, width: number, height: number, rotation: number): Bounds {
  const halfWidth = width / 2;
  const halfHeight = height / 2;

  if (Math.abs(rotation) <= 1e-6) {
    return {
      minX: cx - halfWidth,
      maxX: cx + halfWidth,
      minY: cy - halfHeight,
      maxY: cy + halfHeight
    };
  }

  const theta = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(theta));
  const sin = Math.abs(Math.sin(theta));
  const extentX = halfWidth * cos + halfHeight * sin;
  const extentY = halfWidth * sin + halfHeight * cos;

  return {
    minX: cx - extentX,
    maxX: cx + extentX,
    minY: cy - extentY,
    maxY: cy + extentY
  };
}

function estimateTextBlockWidth(text: string, fontSize: number): number {
  const lines = text.split("\n");
  const maxChars = lines.reduce((max, line) => Math.max(max, line.length), 0);
  if (maxChars <= 0) return 0;
  return maxChars * fontSize * 0.7;
}

export function shiftPathCommand(command: ScenePathCommand, delta: Point): ScenePathCommand {
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

import { worldBounds, worldPoint } from "../../coords/points.js";
import { pt } from "../../coords/scalars.js";
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
  return worldBounds(
    pt(Math.min(a.minX, b.minX)),
    pt(Math.min(a.minY, b.minY)),
    pt(Math.max(a.maxX, b.maxX)),
    pt(Math.max(a.maxY, b.maxY))
  );
}

export function boundsCenter(bounds: WorldBounds): WorldPoint {
  return worldPoint(
    pt((bounds.minX + bounds.maxX) / 2),
    pt((bounds.minY + bounds.maxY) / 2)
  );
}

export function boundsFromPoints(a: WorldPoint, b: WorldPoint): WorldBounds {
  return worldBounds(
    pt(Math.min(a.x, b.x)),
    pt(Math.min(a.y, b.y)),
    pt(Math.max(a.x, b.x)),
    pt(Math.max(a.y, b.y))
  );
}

export function translateBounds(bounds: WorldBounds, delta: WorldPoint): WorldBounds {
  return worldBounds(
    pt(bounds.minX + delta.x),
    pt(bounds.minY + delta.y),
    pt(bounds.maxX + delta.x),
    pt(bounds.maxY + delta.y)
  );
}

export function translatePoints(points: readonly WorldPoint[], delta: WorldPoint): WorldPoint[] {
  return points.map((point) => worldPoint(pt(point.x + delta.x), pt(point.y + delta.y)));
}

export function expandBounds(bounds: WorldBounds, padding: number): WorldBounds {
  return worldBounds(
    pt(bounds.minX - padding),
    pt(bounds.minY - padding),
    pt(bounds.maxX + padding),
    pt(bounds.maxY + padding)
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
    worldPoint(pt(bounds.minX), pt(bounds.minY)),
    worldPoint(pt(bounds.maxX), pt(bounds.minY)),
    worldPoint(pt(bounds.minX), pt(bounds.maxY)),
    worldPoint(pt(bounds.maxX), pt(bounds.maxY)),
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
      Object.assign(worldPoint(pt(bounds.minX), pt(bounds.minY)), { sourceId: bounds.sourceId, role: "corner" as const }),
      Object.assign(worldPoint(pt(bounds.maxX), pt(bounds.minY)), { sourceId: bounds.sourceId, role: "corner" as const }),
      Object.assign(worldPoint(pt(bounds.minX), pt(bounds.maxY)), { sourceId: bounds.sourceId, role: "corner" as const }),
      Object.assign(worldPoint(pt(bounds.maxX), pt(bounds.maxY)), { sourceId: bounds.sourceId, role: "corner" as const }),
      Object.assign(boundsCenter(bounds), { sourceId: bounds.sourceId, role: "center" as const })
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
    const bounds = worldBounds(
      pt(element.center.x - element.radius),
      pt(element.center.y - element.radius),
      pt(element.center.x + element.radius),
      pt(element.center.y + element.radius)
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
        includePoint(worldPoint(pt(previous.x - command.rx), pt(previous.y - command.ry)));
        includePoint(worldPoint(pt(previous.x + command.rx), pt(previous.y + command.ry)));
      }

      includePoint(worldPoint(pt(command.to.x - command.rx), pt(command.to.y - command.ry)));
      includePoint(worldPoint(pt(command.to.x + command.rx), pt(command.to.y + command.ry)));
      previous = command.to;
      continue;
    }

    includePoint(command.to);
    previous = command.to;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return worldBounds(pt(minX), pt(minY), pt(maxX), pt(maxY));
}

function computeEllipseBounds(cx: number, cy: number, rx: number, ry: number, rotation: number): WorldBounds {
  const theta = (rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const extentX = Math.sqrt(rx * rx * cos * cos + ry * ry * sin * sin);
  const extentY = Math.sqrt(rx * rx * sin * sin + ry * ry * cos * cos);

  return worldBounds(pt(cx - extentX), pt(cy - extentY), pt(cx + extentX), pt(cy + extentY));
}

function computeRotatedRectBounds(cx: number, cy: number, width: number, height: number, rotation: number): WorldBounds {
  const halfWidth = width / 2;
  const halfHeight = height / 2;

  if (Math.abs(rotation) <= 1e-6) {
    return worldBounds(pt(cx - halfWidth), pt(cy - halfHeight), pt(cx + halfWidth), pt(cy + halfHeight));
  }

  const theta = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(theta));
  const sin = Math.abs(Math.sin(theta));
  const extentX = halfWidth * cos + halfHeight * sin;
  const extentY = halfWidth * sin + halfHeight * cos;

  return worldBounds(pt(cx - extentX), pt(cy - extentY), pt(cx + extentX), pt(cy + extentY));
}

function transformBounds(
  bounds: WorldBounds,
  transform: { a: number; b: number; c: number; d: number; e: number; f: number }
): WorldBounds {
  const corners: WorldPoint[] = [
    worldPoint(pt(bounds.minX), pt(bounds.minY)),
    worldPoint(pt(bounds.maxX), pt(bounds.minY)),
    worldPoint(pt(bounds.maxX), pt(bounds.maxY)),
    worldPoint(pt(bounds.minX), pt(bounds.maxY))
  ];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of corners) {
    const mapped = worldPoint(
      pt(transform.a * point.x + transform.c * point.y + transform.e),
      pt(transform.b * point.x + transform.d * point.y + transform.f)
    );
    minX = Math.min(minX, mapped.x);
    minY = Math.min(minY, mapped.y);
    maxX = Math.max(maxX, mapped.x);
    maxY = Math.max(maxY, mapped.y);
  }
  return worldBounds(pt(minX), pt(minY), pt(maxX), pt(maxY));
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
      to: worldPoint(pt(command.to.x + delta.x), pt(command.to.y + delta.y))
    };
  }
  if (command.kind === "C") {
    return {
      ...command,
      c1: worldPoint(pt(command.c1.x + delta.x), pt(command.c1.y + delta.y)),
      c2: worldPoint(pt(command.c2.x + delta.x), pt(command.c2.y + delta.y)),
      to: worldPoint(pt(command.to.x + delta.x), pt(command.to.y + delta.y))
    };
  }
  return {
    ...command,
    to: worldPoint(pt(command.to.x + delta.x), pt(command.to.y + delta.y))
  };
}

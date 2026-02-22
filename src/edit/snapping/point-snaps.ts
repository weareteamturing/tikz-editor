import type {
  Axis,
  AxisMinOffset,
  AxisSnapBuckets,
  PointSnapCandidate,
  SnapLine,
  SnapPoint
} from "./types.js";
import { SNAP_EPSILON } from "./geometry.js";

export function collectPointSnaps({
  selectionPoints,
  referencePoints,
  minOffset,
  nearest,
  kind,
  enabledAxis
}: {
  selectionPoints: readonly { x: number; y: number }[];
  referencePoints: readonly (SnapPoint | { x: number; y: number })[];
  minOffset: AxisMinOffset;
  nearest: AxisSnapBuckets;
  kind: "point" | "grid";
  enabledAxis?: Axis | null;
}): void {
  for (const from of selectionPoints) {
    for (const to of referencePoints) {
      const offsetX = to.x - from.x;
      const offsetY = to.y - from.y;

      if (enabledAxis !== "y") {
        const absX = Math.abs(offsetX);
        if (absX <= minOffset.x + SNAP_EPSILON) {
          if (absX + SNAP_EPSILON < minOffset.x) {
            nearest.x.length = 0;
          }

          nearest.x.push({
            kind,
            axis: "x",
            from: { x: from.x, y: from.y },
            to: { x: to.x, y: to.y },
            offset: offsetX,
            key: roundSnapValue(to.x)
          });
          minOffset.x = absX;
        }
      }

      if (enabledAxis !== "x") {
        const absY = Math.abs(offsetY);
        if (absY <= minOffset.y + SNAP_EPSILON) {
          if (absY + SNAP_EPSILON < minOffset.y) {
            nearest.y.length = 0;
          }

          nearest.y.push({
            kind,
            axis: "y",
            from: { x: from.x, y: from.y },
            to: { x: to.x, y: to.y },
            offset: offsetY,
            key: roundSnapValue(to.y)
          });
          minOffset.y = absY;
        }
      }
    }
  }
}

export function pointSnapOffset(nearest: AxisSnapBuckets): { x: number; y: number } {
  const xSnap = nearest.x.find((snap): snap is PointSnapCandidate => snap.kind !== "gap");
  const ySnap = nearest.y.find((snap): snap is PointSnapCandidate => snap.kind !== "gap");

  return {
    x: xSnap?.offset ?? 0,
    y: ySnap?.offset ?? 0
  };
}

export function createPointSnapLines(nearest: AxisSnapBuckets): SnapLine[] {
  const xGroups = new Map<number, PointSnapCandidate[]>();
  const yGroups = new Map<number, PointSnapCandidate[]>();

  for (const snap of nearest.x) {
    if (snap.kind !== "point") continue;
    const key = snap.key;
    const entry = xGroups.get(key) ?? [];
    entry.push(snap);
    xGroups.set(key, entry);
  }

  for (const snap of nearest.y) {
    if (snap.kind !== "point") continue;
    const key = snap.key;
    const entry = yGroups.get(key) ?? [];
    entry.push(snap);
    yGroups.set(key, entry);
  }

  const lines: SnapLine[] = [];

  for (const [key, group] of xGroups.entries()) {
    const points = dedupePoints(
      group.flatMap((snap) => [
        { x: key, y: snap.from.y },
        { x: key, y: snap.to.y }
      ])
    ).sort((a, b) => a.y - b.y);

    lines.push({
      type: "points",
      axis: "x",
      points
    });
  }

  for (const [key, group] of yGroups.entries()) {
    const points = dedupePoints(
      group.flatMap((snap) => [
        { x: snap.from.x, y: key },
        { x: snap.to.x, y: key }
      ])
    ).sort((a, b) => a.x - b.x);

    lines.push({
      type: "points",
      axis: "y",
      points
    });
  }

  return lines;
}

export function createPointerLinesForPointSnap(nearest: AxisSnapBuckets, snappedPoint: { x: number; y: number }): SnapLine[] {
  const lines: SnapLine[] = [];

  const xSnap = nearest.x.find((snap): snap is PointSnapCandidate => snap.kind === "point");
  if (xSnap) {
    lines.push({
      type: "pointer",
      axis: "x",
      from: { x: xSnap.to.x, y: xSnap.to.y },
      to: { x: xSnap.to.x, y: snappedPoint.y }
    });
  }

  const ySnap = nearest.y.find((snap): snap is PointSnapCandidate => snap.kind === "point");
  if (ySnap) {
    lines.push({
      type: "pointer",
      axis: "y",
      from: { x: ySnap.to.x, y: ySnap.to.y },
      to: { x: snappedPoint.x, y: ySnap.to.y }
    });
  }

  return lines;
}

export function createEmptySnapBuckets(): AxisSnapBuckets {
  return {
    x: [],
    y: []
  };
}

export function createMinOffset(threshold: number, enabledAxis?: Axis | null): AxisMinOffset {
  return {
    x: enabledAxis === "y" ? 0 : Math.max(0, threshold),
    y: enabledAxis === "x" ? 0 : Math.max(0, threshold)
  };
}

export function roundSnapValue(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function dedupePoints(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  const map = new Map<string, { x: number; y: number }>();
  for (const point of points) {
    const key = `${roundSnapValue(point.x)},${roundSnapValue(point.y)}`;
    if (!map.has(key)) {
      map.set(key, {
        x: roundSnapValue(point.x),
        y: roundSnapValue(point.y)
      });
    }
  }
  return [...map.values()];
}

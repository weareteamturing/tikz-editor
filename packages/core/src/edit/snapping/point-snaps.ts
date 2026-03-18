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

export function collectGuideSnaps({
  selectionPoints,
  guides,
  minOffset,
  nearest,
  enabledAxis
}: {
  selectionPoints: readonly { x: number; y: number }[];
  guides: { x: readonly number[]; y: readonly number[] };
  minOffset: AxisMinOffset;
  nearest: AxisSnapBuckets;
  enabledAxis?: Axis | null;
}): void {
  for (const from of selectionPoints) {
    if (enabledAxis !== "y") {
      for (const guideX of guides.x) {
        const offsetX = guideX - from.x;
        const absX = Math.abs(offsetX);
        if (absX <= minOffset.x + SNAP_EPSILON) {
          if (absX + SNAP_EPSILON < minOffset.x) {
            nearest.x.length = 0;
          }

          nearest.x.push({
            kind: "guide",
            axis: "x",
            from: { x: from.x, y: from.y },
            to: { x: guideX, y: from.y },
            offset: offsetX,
            key: roundSnapValue(guideX)
          });
          minOffset.x = absX;
        }
      }
    }

    if (enabledAxis !== "x") {
      for (const guideY of guides.y) {
        const offsetY = guideY - from.y;
        const absY = Math.abs(offsetY);
        if (absY <= minOffset.y + SNAP_EPSILON) {
          if (absY + SNAP_EPSILON < minOffset.y) {
            nearest.y.length = 0;
          }

          nearest.y.push({
            kind: "guide",
            axis: "y",
            from: { x: from.x, y: from.y },
            to: { x: from.x, y: guideY },
            offset: offsetY,
            key: roundSnapValue(guideY)
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
  const lines: SnapLine[] = [];
  const seen = new Set<string>();

  for (const snap of nearest.x) {
    if (snap.kind !== "point") {
      continue;
    }
    const from = { x: snap.to.x, y: snap.from.y };
    const to = { x: snap.to.x, y: snap.to.y };
    const key = makeLineKey("x", from, to);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    lines.push({
      type: "points",
      axis: "x",
      points: [from, to]
    });
  }

  for (const snap of nearest.y) {
    if (snap.kind !== "point") {
      continue;
    }
    const from = { x: snap.from.x, y: snap.to.y };
    const to = { x: snap.to.x, y: snap.to.y };
    const key = makeLineKey("y", from, to);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    lines.push({
      type: "points",
      axis: "y",
      points: [from, to]
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

function makeLineKey(
  axis: Axis,
  from: { x: number; y: number },
  to: { x: number; y: number }
): string {
  const ax = roundSnapValue(from.x);
  const ay = roundSnapValue(from.y);
  const bx = roundSnapValue(to.x);
  const by = roundSnapValue(to.y);
  if (axis === "x") {
    return `${axis}:${ax}:${Math.min(ay, by)}:${Math.max(ay, by)}`;
  }
  return `${axis}:${ay}:${Math.min(ax, bx)}:${Math.max(ax, bx)}`;
}

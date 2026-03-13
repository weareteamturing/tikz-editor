import { CM_PER_PT, formatNumber } from "tikz-editor/edit/format";
import type { Point } from "tikz-editor/semantic/types";

const MIN_WORLD_DISTANCE_PT = 1e-3;

export const FREEHAND_LIVE_POINT_SPACING_PX = 12;
export const FREEHAND_MIN_POINTS = 3;
export const FREEHAND_SMOOTHING_MIN_PX = 4;
export const FREEHAND_SMOOTHING_MAX_PX = 32;
export const FREEHAND_SMOOTHING_DEFAULT_PX = 16;

export type FreehandToolDraft = {
  points: Point[];
  minSampleDistanceWorld: number;
};

export type FreehandBezierSegment = {
  control1: Point;
  control2: Point;
  to: Point;
};

export function createFreehandToolDraft(startWorld: Point, zoom: number): FreehandToolDraft {
  return {
    points: [{ ...startWorld }],
    minSampleDistanceWorld: FREEHAND_LIVE_POINT_SPACING_PX / Math.max(zoom, 1e-3)
  };
}

export function appendFreehandToolPoint(draft: FreehandToolDraft, point: Point): FreehandToolDraft {
  const last = draft.points[draft.points.length - 1];
  if (last && distanceSquared(last, point) < draft.minSampleDistanceWorld * draft.minSampleDistanceWorld) {
    return draft;
  }
  return {
    ...draft,
    points: [...draft.points, { ...point }]
  };
}

export function simplifyFreehandPoints(points: readonly Point[], toleranceWorld: number): Point[] {
  if (points.length <= 2) {
    return points.map((point) => ({ ...point }));
  }

  const toleranceSq = toleranceWorld * toleranceWorld;
  const simplified: Point[] = [{ ...points[0]! }];
  let lastKept = points[0]!;

  for (let i = 1; i < points.length - 1; i += 1) {
    const point = points[i]!;
    if (distanceSquared(lastKept, point) >= toleranceSq) {
      simplified.push({ ...point });
      lastKept = point;
    }
  }

  const lastPoint = points[points.length - 1]!;
  const currentLast = simplified[simplified.length - 1]!;
  if (distanceSquared(currentLast, lastPoint) > 0) {
    simplified.push({ ...lastPoint });
  }

  return simplified;
}

export function catmullRomToBezierSegments(points: readonly Point[]): FreehandBezierSegment[] {
  if (points.length < 2) {
    return [];
  }

  const segments: FreehandBezierSegment[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = i === 0 ? points[i]! : points[i - 1]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = i + 2 < points.length ? points[i + 2]! : p2;

    segments.push({
      control1: {
        x: p1.x + (p2.x - p0.x) / 6,
        y: p1.y + (p2.y - p0.y) / 6
      },
      control2: {
        x: p2.x - (p3.x - p1.x) / 6,
        y: p2.y - (p3.y - p1.y) / 6
      },
      to: { ...p2 }
    });
  }

  return segments;
}

export function resolveFreehandPreviewSegments(
  draft: FreehandToolDraft,
  smoothingTolerancePx = FREEHAND_SMOOTHING_DEFAULT_PX,
  zoom = 1
): Array<
  | { kind: "line"; from: Point; to: Point }
  | { kind: "bezier"; from: Point; control1: Point; control2: Point; to: Point }
> {
  const smoothingToleranceWorld = clampSmoothingTolerancePx(smoothingTolerancePx) / Math.max(zoom, 1e-3);
  const previewPoints = simplifyFreehandPoints(draft.points, smoothingToleranceWorld);

  if (previewPoints.length < FREEHAND_MIN_POINTS) {
    const previewSegments: Array<{ kind: "line"; from: Point; to: Point }> = [];
    for (let i = 1; i < previewPoints.length; i += 1) {
      previewSegments.push({
        kind: "line",
        from: { ...previewPoints[i - 1]! },
        to: { ...previewPoints[i]! }
      });
    }
    return previewSegments;
  }

  const curves = catmullRomToBezierSegments(previewPoints);
  const previewSegments: Array<{ kind: "bezier"; from: Point; control1: Point; control2: Point; to: Point }> = [];
  let current = previewPoints[0]!;
  for (const segment of curves) {
    previewSegments.push({
      kind: "bezier",
      from: { ...current },
      control1: { ...segment.control1 },
      control2: { ...segment.control2 },
      to: { ...segment.to }
    });
    current = segment.to;
  }
  return previewSegments;
}

export function generateFreehandToolSource(
  draft: FreehandToolDraft,
  zoom: number,
  smoothingTolerancePx = FREEHAND_SMOOTHING_DEFAULT_PX
): string | null {
  const toleranceWorld = clampSmoothingTolerancePx(smoothingTolerancePx) / Math.max(zoom, 1e-3);
  const simplified = simplifyFreehandPoints(draft.points, toleranceWorld);
  if (simplified.length < FREEHAND_MIN_POINTS) {
    return null;
  }

  if (polylineLength(simplified) <= MIN_WORLD_DISTANCE_PT) {
    return null;
  }

  const segments = catmullRomToBezierSegments(simplified);
  if (segments.length === 0) {
    return null;
  }

  const parts: string[] = [formatPointCm(simplified[0]!)];
  for (const segment of segments) {
    parts.push(
      `.. controls ${formatPointCm(segment.control1)} and ${formatPointCm(segment.control2)} .. ${formatPointCm(segment.to)}`
    );
  }
  return `\\draw ${parts.join(" ")};`;
}

function polylineLength(points: readonly Point[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += Math.sqrt(distanceSquared(points[i - 1]!, points[i]!));
  }
  return length;
}

function formatPointCm(point: Point): string {
  return `(${formatNumber(point.x * CM_PER_PT)},${formatNumber(point.y * CM_PER_PT)})`;
}

function distanceSquared(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function clampSmoothingTolerancePx(value: number): number {
  if (!Number.isFinite(value)) {
    return FREEHAND_SMOOTHING_DEFAULT_PX;
  }
  const rounded = Math.round(value);
  return Math.max(FREEHAND_SMOOTHING_MIN_PX, Math.min(FREEHAND_SMOOTHING_MAX_PX, rounded));
}

import { generateComplexPathSource, type ComplexPathSegment } from "tikz-editor/edit/element-templates";
import type { Point } from "tikz-editor/semantic/types";

import { resolveBezierControlsFromBend } from "./interaction-helpers";

const MIN_SEGMENT_LENGTH_PT = 1e-3;
export const PATH_TOOL_CLOSE_RADIUS_PX = 10;
export const PATH_TOOL_BEND_DRAG_THRESHOLD_PX = 3;

export type PathToolDraft = {
  startWorld: Point;
  segments: ComplexPathSegment[];
};

export type PathToolGestureSegment = {
  endWorld: Point;
  bendWorld: Point;
  asBezier: boolean;
};

export function createPathToolDraft(startWorld: Point): PathToolDraft {
  return {
    startWorld: { ...startWorld },
    segments: []
  };
}

export function pathToolCurrentPoint(draft: PathToolDraft): Point {
  const lastSegment = draft.segments[draft.segments.length - 1];
  return lastSegment ? { ...lastSegment.to } : { ...draft.startWorld };
}

export function pathToolHasDrawableSegments(draft: PathToolDraft): boolean {
  return draft.segments.length > 0;
}

export function pathToolCanClose(draft: PathToolDraft): boolean {
  return draft.segments.length >= 2;
}

export function pathToolCloseRadiusWorld(zoom: number): number {
  return PATH_TOOL_CLOSE_RADIUS_PX / Math.max(zoom, 1e-3);
}

export function pathToolWouldCreateDegenerateSegment(draft: PathToolDraft, endWorld: Point): boolean {
  const from = pathToolCurrentPoint(draft);
  return distanceSquared(from, endWorld) <= MIN_SEGMENT_LENGTH_PT * MIN_SEGMENT_LENGTH_PT;
}

export function pathToolIsPointNearStart(draft: PathToolDraft, point: Point, radiusWorld: number): boolean {
  return distanceSquared(draft.startWorld, point) <= radiusWorld * radiusWorld;
}

export function pathToolShouldClose(draft: PathToolDraft, point: Point, radiusWorld: number): boolean {
  return pathToolCanClose(draft) && pathToolIsPointNearStart(draft, point, radiusWorld);
}

export function appendPathToolLineSegment(draft: PathToolDraft, endWorld: Point): PathToolDraft {
  if (pathToolWouldCreateDegenerateSegment(draft, endWorld)) {
    return draft;
  }

  return {
    ...draft,
    segments: [...draft.segments, { kind: "line", to: { ...endWorld } }]
  };
}

export function appendPathToolBezierSegment(
  draft: PathToolDraft,
  endWorld: Point,
  bendWorld: Point
): PathToolDraft {
  if (pathToolWouldCreateDegenerateSegment(draft, endWorld)) {
    return draft;
  }

  const from = pathToolCurrentPoint(draft);
  const controls = resolveBezierControlsFromBend(from, endWorld, bendWorld);

  return {
    ...draft,
    segments: [
      ...draft.segments,
      {
        kind: "bezier",
        to: { ...controls.endWorld },
        control1: { ...controls.control1 },
        control2: { ...controls.control2 }
      }
    ]
  };
}

export function appendPathToolSegmentFromGesture(
  draft: PathToolDraft,
  segment: PathToolGestureSegment
): PathToolDraft {
  return segment.asBezier
    ? appendPathToolBezierSegment(draft, segment.endWorld, segment.bendWorld)
    : appendPathToolLineSegment(draft, segment.endWorld);
}

export function generatePathToolSource(draft: PathToolDraft, options: { closed: boolean }): string | null {
  return generateComplexPathSource(draft.startWorld, draft.segments, { closed: options.closed });
}

function distanceSquared(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

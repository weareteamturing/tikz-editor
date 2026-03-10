import type { ElementTemplate } from "tikz-editor/edit/actions";
import type { SelectionGeometry } from "tikz-editor/edit/snapping";
import type { EditHandle, Point, SceneElement, ScenePathCommand } from "tikz-editor/semantic/types";
import { CM_PER_PT, PT_PER_CM, formatNumber } from "tikz-editor/edit/format";

import { distanceSquared } from "./geometry";
import { shouldConstrainToolCreateToSquare, type ToolCreateMode } from "../tool-config";
import type { Bounds, DragState, DragTooltipRow } from "./types";
import type { ResizeFrame } from "./resize-frames";

const DEFAULT_BEZIER_LENGTH_PT = 2 * PT_PER_CM;
const STEP_SNAP_EPSILON = 1e-9;
export const DEFAULT_GRID_TOOL_STEP_PT = PT_PER_CM;
const TOOLTIP_ZERO_EPSILON = 1e-6;

export function boundsFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Bounds {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y)
  };
}

export function collectSourceIdsInBounds(boundsBySource: ReadonlyMap<string, Bounds>, selection: Bounds): string[] {
  const result: string[] = [];
  for (const [sourceId, bounds] of boundsBySource) {
    if (boundsContainedWithin(bounds, selection)) {
      result.push(sourceId);
    }
  }
  return result;
}

export function deriveSelectionTranslationDeltaFromAnchor(
  initialSelection: SelectionGeometry,
  currentSelection: SelectionGeometry | null,
  anchorRatio: { x: number; y: number } | null
): Point {
  if (!currentSelection) {
    return { x: 0, y: 0 };
  }

  const ratio = anchorRatio ?? { x: 0.5, y: 0.5 };
  const initialCenter = pointFromBoundsAnchorRatio(initialSelection.bounds, ratio);
  const currentCenter = pointFromBoundsAnchorRatio(currentSelection.bounds, ratio);
  return {
    x: currentCenter.x - initialCenter.x,
    y: currentCenter.y - initialCenter.y
  };
}

export function createTemplateForToolDrag(
  mode: ToolCreateMode,
  startWorld: Point,
  endWorld: Point
): ElementTemplate {
  const dx = endWorld.x - startWorld.x;
  const dy = endWorld.y - startWorld.y;
  const dragDistance = Math.hypot(dx, dy);
  const hasDrag = dragDistance >= 1e-3;

  if (mode === "addPath") {
    return hasDrag
      ? { kind: "line", hasArrow: false, to: endWorld }
      : { kind: "line", hasArrow: false };
  }

  if (mode === "addLine") {
    return hasDrag
      ? { kind: "line", hasArrow: false, to: endWorld }
      : { kind: "line", hasArrow: false };
  }

  if (mode === "addArrow") {
    return hasDrag
      ? { kind: "line", hasArrow: true, to: endWorld }
      : { kind: "line", hasArrow: true };
  }

  if (mode === "addBezier") {
    const bend = {
      x: (startWorld.x + endWorld.x) / 2,
      y: (startWorld.y + endWorld.y) / 2
    };
    return hasDrag
      ? createBezierTemplateFromBend(startWorld, endWorld, bend)
      : { kind: "bezier" };
  }

  if (mode === "addGrid") {
    return hasDrag
      ? { kind: "grid", corner: endWorld }
      : { kind: "grid" };
  }

  if (mode === "addRect") {
    return hasDrag
      ? { kind: "rectangle", corner: endWorld }
      : { kind: "rectangle" };
  }

  if (mode === "addEllipse") {
    return hasDrag
      ? { kind: "ellipse", corner: endWorld }
      : { kind: "ellipse" };
  }

  return hasDrag
    ? { kind: "circle", edge: endWorld }
    : { kind: "circle" };
}

export function resolveBezierControlsFromBend(
  startWorld: Point,
  endWorld: Point,
  bendWorld: Point
): { endWorld: Point; control1: Point; control2: Point } {
  let resolvedEnd = endWorld;
  let dx = resolvedEnd.x - startWorld.x;
  let dy = resolvedEnd.y - startWorld.y;
  let length = Math.hypot(dx, dy);
  if (length <= 1e-6) {
    resolvedEnd = { x: startWorld.x + DEFAULT_BEZIER_LENGTH_PT, y: startWorld.y };
    dx = resolvedEnd.x - startWorld.x;
    dy = resolvedEnd.y - startWorld.y;
    length = Math.hypot(dx, dy);
  }

  const unitTangent = { x: dx / length, y: dy / length };
  const unitNormal = { x: -unitTangent.y, y: unitTangent.x };
  const midpoint = {
    x: (startWorld.x + resolvedEnd.x) / 2,
    y: (startWorld.y + resolvedEnd.y) / 2
  };
  const signedNormalOffset =
    (bendWorld.x - midpoint.x) * unitNormal.x +
    (bendWorld.y - midpoint.y) * unitNormal.y;
  const controlNormalOffset = (4 / 3) * signedNormalOffset;

  const control1 = {
    x: startWorld.x + dx / 3 + unitNormal.x * controlNormalOffset,
    y: startWorld.y + dy / 3 + unitNormal.y * controlNormalOffset
  };
  const control2 = {
    x: startWorld.x + (2 * dx) / 3 + unitNormal.x * controlNormalOffset,
    y: startWorld.y + (2 * dy) / 3 + unitNormal.y * controlNormalOffset
  };

  return {
    endWorld: resolvedEnd,
    control1,
    control2
  };
}

export function createBezierTemplateFromBend(
  startWorld: Point,
  endWorld: Point,
  bendWorld: Point
): ElementTemplate {
  const controls = resolveBezierControlsFromBend(startWorld, endWorld, bendWorld);
  return {
    kind: "bezier",
    to: controls.endWorld,
    control1: controls.control1,
    control2: controls.control2
  };
}

export function resolveToolCreateCurrentWorld(
  startWorld: Point,
  rawCurrentWorld: Point,
  mode: ToolCreateMode,
  shiftKey: boolean
): Point {
  return shouldConstrainToolCreateToSquare(mode) && shiftKey
    ? constrainRectCornerToSquare(startWorld, rawCurrentWorld)
    : rawCurrentWorld;
}

export function snapPointDeltaToAxisStepMultiples(
  anchorWorld: Point,
  currentWorld: Point,
  stepX: number,
  stepY: number
): Point {
  return {
    x: anchorWorld.x + snapDeltaToStep(currentWorld.x - anchorWorld.x, stepX),
    y: anchorWorld.y + snapDeltaToStep(currentWorld.y - anchorWorld.y, stepY)
  };
}

export function resolveHandleIdForDrag(
  drag: Extract<DragState, { kind: "handle" }>,
  handles: EditHandle[]
): string | null {
  const direct = handles.find((handle) => handle.id === drag.handleId);
  if (direct) {
    return direct.id;
  }

  let best: EditHandle | null = null;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (const handle of handles) {
    if (handle.sourceRef.sourceId !== drag.sourceId || handle.kind !== drag.handleKind) {
      continue;
    }
    const dx = handle.world.x - drag.lastKnownWorld.x;
    const dy = handle.world.y - drag.lastKnownWorld.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = handle;
    }
  }

  if (!best) {
    return null;
  }

  drag.handleId = best.id;
  drag.lastKnownWorld = { ...best.world };
  return best.id;
}

function boundsContainedWithin(inner: Bounds, outer: Bounds): boolean {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;
}

function pointFromBoundsAnchorRatio(bounds: Bounds, ratio: { x: number; y: number }): Point {
  return {
    x: bounds.minX + (bounds.maxX - bounds.minX) * ratio.x,
    y: bounds.minY + (bounds.maxY - bounds.minY) * ratio.y
  };
}

function constrainRectCornerToSquare(startWorld: Point, cornerWorld: Point): Point {
  const dx = cornerWorld.x - startWorld.x;
  const dy = cornerWorld.y - startWorld.y;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  if (side <= 1e-6) {
    return cornerWorld;
  }

  const xSign = dx < 0 ? -1 : 1;
  const ySign = dy < 0 ? -1 : 1;
  return {
    x: startWorld.x + xSign * side,
    y: startWorld.y + ySign * side
  };
}

function snapDeltaToStep(delta: number, step: number): number {
  if (!(step > STEP_SNAP_EPSILON)) {
    return delta;
  }
  return Math.round(delta / step) * step;
}

export function sourceIdAnchorWorld(elements: SceneElement[], sourceId: string): Point {
  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (const element of elements) {
    if (element.sourceRef.sourceId !== sourceId) {
      continue;
    }
    const anchor = elementAnchorWorld(element);
    sumX += anchor.x;
    sumY += anchor.y;
    count += 1;
  }

  if (count === 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: sumX / count,
    y: sumY / count
  };
}

export function formatTooltipLengthRows(widthPt: number, heightPt: number): DragTooltipRow[] {
  return [
    { label: "Width", value: formatTooltipLength(widthPt) },
    { label: "Height", value: formatTooltipLength(heightPt) }
  ];
}

export function formatTooltipAngleRow(degrees: number): DragTooltipRow {
  const normalized = Math.abs(degrees) <= TOOLTIP_ZERO_EPSILON ? 0 : degrees;
  return {
    label: "Angle",
    value: `${Math.round(normalized)}°`
  };
}

export function formatTooltipGridCountRow(columns: number, rows: number): DragTooltipRow {
  return {
    label: "Cells",
    value: `${columns} col, ${rows} row`
  };
}

export function resolveFrameBasis(frame: ResizeFrame): {
  widthUnit: Point;
  heightUnit: Point;
  width: number;
  height: number;
} {
  const topLeft = frame.cornersByRole["top-left"].world;
  const topRight = frame.cornersByRole["top-right"].world;
  const bottomLeft = frame.cornersByRole["bottom-left"].world;
  const widthVector = {
    x: topRight.x - topLeft.x,
    y: topRight.y - topLeft.y
  };
  const heightVector = {
    x: topLeft.x - bottomLeft.x,
    y: topLeft.y - bottomLeft.y
  };
  const width = Math.hypot(widthVector.x, widthVector.y);
  const height = Math.hypot(heightVector.x, heightVector.y);
  return {
    widthUnit: width > TOOLTIP_ZERO_EPSILON ? { x: widthVector.x / width, y: widthVector.y / width } : { x: 1, y: 0 },
    heightUnit: height > TOOLTIP_ZERO_EPSILON ? { x: heightVector.x / height, y: heightVector.y / height } : { x: 0, y: 1 },
    width,
    height
  };
}

export function oppositeCornerWorld(frame: ResizeFrame, role: Extract<DragState, { kind: "resize" }>["role"]): Point {
  const oppositeRole =
    role === "top-left" ? "bottom-right" :
    role === "top-right" ? "bottom-left" :
    role === "bottom-left" ? "top-right" :
    "top-left";
  return frame.cornersByRole[oppositeRole].world;
}

export function projectResizeDimensionsFromCenter(
  pointerWorld: Point,
  frame: ResizeFrame,
  preserveAspectRatio: number | null,
  preserveAspectDuringResize: boolean
): { width: number; height: number } {
  const basis = resolveFrameBasis(frame);
  const relative = {
    x: pointerWorld.x - frame.centerWorld.x,
    y: pointerWorld.y - frame.centerWorld.y
  };
  let width = 2 * Math.abs(dotPoint(relative, basis.widthUnit));
  let height = 2 * Math.abs(dotPoint(relative, basis.heightUnit));
  const aspectRatio =
    preserveAspectRatio && preserveAspectRatio > TOOLTIP_ZERO_EPSILON
      ? preserveAspectRatio
      : null;

  if (preserveAspectDuringResize && aspectRatio) {
    if (width > TOOLTIP_ZERO_EPSILON || height > TOOLTIP_ZERO_EPSILON) {
      width = Math.max(width, height / aspectRatio);
      height = width * aspectRatio;
    }
  }

  return {
    width: clampTooltipScalar(width),
    height: clampTooltipScalar(height)
  };
}

export function projectResizeDimensionsFromOppositeCorner(
  pointerWorld: Point,
  frame: ResizeFrame,
  role: Extract<DragState, { kind: "resize" }>["role"]
): { width: number; height: number } {
  const basis = resolveFrameBasis(frame);
  const fixed = oppositeCornerWorld(frame, role);
  const delta = {
    x: pointerWorld.x - fixed.x,
    y: pointerWorld.y - fixed.y
  };
  return {
    width: clampTooltipScalar(Math.abs(dotPoint(delta, basis.widthUnit))),
    height: clampTooltipScalar(Math.abs(dotPoint(delta, basis.heightUnit)))
  };
}

export function resolveToolCreateSize(
  mode: ToolCreateMode,
  startWorld: Point,
  currentWorld: Point
): { width: number; height: number } {
  if (mode === "addCircle") {
    const radius = Math.hypot(currentWorld.x - startWorld.x, currentWorld.y - startWorld.y);
    const diameter = clampTooltipScalar(radius * 2);
    return { width: diameter, height: diameter };
  }

  return {
    width: clampTooltipScalar(Math.abs(currentWorld.x - startWorld.x)),
    height: clampTooltipScalar(Math.abs(currentWorld.y - startWorld.y))
  };
}

export function resolveGridTooltipCounts(startWorld: Point, currentWorld: Point): { columns: number; rows: number } {
  const width = Math.abs(currentWorld.x - startWorld.x);
  const height = Math.abs(currentWorld.y - startWorld.y);
  return {
    columns: Math.max(1, Math.round(width / DEFAULT_GRID_TOOL_STEP_PT)),
    rows: Math.max(1, Math.round(height / DEFAULT_GRID_TOOL_STEP_PT))
  };
}

function formatTooltipLength(valuePt: number): string {
  const clamped = clampTooltipScalar(valuePt);
  return `${formatNumber(clamped)}pt (${formatNumber(clamped * CM_PER_PT)}cm)`;
}

function clampTooltipScalar(value: number): number {
  return Math.abs(value) <= TOOLTIP_ZERO_EPSILON ? 0 : value;
}

function dotPoint(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

function elementAnchorWorld(element: SceneElement): Point {
  if (element.kind === "Circle" || element.kind === "Ellipse") {
    return element.center;
  }
  if (element.kind === "Text") {
    return element.position;
  }

  const firstPoint = firstPathPoint(element.commands);
  return firstPoint ?? { x: 0, y: 0 };
}

function firstPathPoint(commands: ScenePathCommand[]): Point | null {
  for (const command of commands) {
    if (command.kind === "Z") {
      continue;
    }
    return command.to;
  }
  return null;
}

export function pickClosestSourceId(
  elements: SceneElement[],
  sourceIds: readonly string[],
  preferredWorld: Point
): string {
  let bestId = sourceIds[0]!;
  let bestDistSq = Number.POSITIVE_INFINITY;

  for (const sourceId of sourceIds) {
    const anchor = sourceIdAnchorWorld(elements, sourceId);
    const distSq = distanceSquared(anchor, preferredWorld);
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestId = sourceId;
    }
  }

  return bestId;
}

import type { NodeItem, PathItem, Span, Statement } from "tikz-editor/ast/types";
import type { ResizeRole } from "tikz-editor/edit/actions";
import type { OptionListAst } from "tikz-editor/options/types";
import type {
  EditHandle,
  Point,
  SceneElement,
  ScenePath,
  ScenePathShapeHint,
  SceneText
} from "tikz-editor/semantic/types";
import type { SvgViewBox } from "tikz-editor/svg/index";
import type { CanvasDragKind } from "../../store/types";
import type { HitRegion } from "./hit-regions";
import type {
  Bounds,
  DragState,
  EditableTextTarget,
  SelectionBounds
} from "./types";
import {
  clamp,
  distanceSquared,
  fmt,
  resizeCursorForVector,
  vectorLengthSquared,
  worldToSvgPoint
} from "./geometry";

type GuideOrientation = "vertical" | "horizontal";

type GuidesState = {
  vertical: number[];
  horizontal: number[];
};

export function collectSelectionBounds(
  elements: SceneElement[],
  selectedIds: ReadonlySet<string>,
  viewBox: SvgViewBox
): SelectionBounds[] {
  const boundsBySource = collectSourceBounds(elements, viewBox);
  const selections: SelectionBounds[] = [];
  for (const [sourceId, bounds] of boundsBySource.entries()) {
    if (selectedIds.has(sourceId)) {
      selections.push({ sourceId, bounds });
    }
  }
  return selections;
}

export function collectSourceBounds(elements: SceneElement[], viewBox: SvgViewBox): Map<string, Bounds> {
  const boundsBySource = new Map<string, Bounds>();

  for (const element of elements) {
    const bounds = elementBoundsInSvg(element, viewBox);
    if (!bounds) continue;

    const existing = boundsBySource.get(element.sourceId);
    if (!existing) {
      boundsBySource.set(element.sourceId, bounds);
    } else {
      boundsBySource.set(element.sourceId, mergeBounds(existing, bounds));
    }
  }

  return boundsBySource;
}

export function elementBoundsInSvg(element: SceneElement, viewBox: SvgViewBox): Bounds | null {
  if (element.kind === "Path") {
    return pathBoundsInSvg(element, viewBox);
  }

  if (element.kind === "Circle") {
    const center = worldToSvgPoint(element.center, viewBox);
    return {
      minX: center.x - element.radius,
      maxX: center.x + element.radius,
      minY: center.y - element.radius,
      maxY: center.y + element.radius
    };
  }

  if (element.kind === "Ellipse") {
    const center = worldToSvgPoint(element.center, viewBox);
    return computeEllipseBounds(center.x, center.y, element.rx, element.ry, element.rotation ?? 0);
  }

  return textBounds(element, viewBox);
}

export function textBounds(element: SceneText, viewBox: SvgViewBox): Bounds {
  const textGeometry = textGeometryInSvg(element, viewBox);
  return computeRotatedRectBounds(
    textGeometry.cx,
    textGeometry.cy,
    textGeometry.width,
    textGeometry.height,
    textGeometry.rotation
  );
}

export function textGeometryInSvg(
  element: SceneText,
  viewBox: Pick<SvgViewBox, "y" | "height">
): { cx: number; cy: number; width: number; height: number; rotation: number } {
  const center = worldToSvgPoint(element.position, viewBox);
  const width = element.textBlockWidth ?? estimateTextBlockWidth(element.text, element.style.fontSize);
  const height = element.textBlockHeight ?? Math.max(1, element.text.split("\n").length) * element.style.fontSize * 1.15;

  return {
    cx: center.x,
    cy: center.y,
    width,
    height,
    rotation: element.rotation ?? 0
  };
}

export function pathBoundsInSvg(path: ScenePath, viewBox: SvgViewBox): Bounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let previous: { x: number; y: number } | null = null;

  const includePoint = (point: { x: number; y: number }) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  };

  for (const command of path.commands) {
    if (command.kind === "Z") continue;

    if (command.kind === "C") {
      includePoint(worldToSvgPoint(command.c1, viewBox));
      includePoint(worldToSvgPoint(command.c2, viewBox));
    }

    if (command.kind === "A") {
      if (previous) {
        includePoint({ x: previous.x - command.rx, y: previous.y - command.ry });
        includePoint({ x: previous.x + command.rx, y: previous.y + command.ry });
      }
      const to = worldToSvgPoint(command.to, viewBox);
      includePoint({ x: to.x - command.rx, y: to.y - command.ry });
      includePoint({ x: to.x + command.rx, y: to.y + command.ry });
      previous = to;
      continue;
    }

    const point = worldToSvgPoint(command.to, viewBox);
    includePoint(point);
    previous = point;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

export function computeEllipseBounds(cx: number, cy: number, rx: number, ry: number, rotation: number): Bounds {
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

export function computeRotatedRectBounds(cx: number, cy: number, width: number, height: number, rotation: number): Bounds {
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

export function mergeBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY)
  };
}

export function selectionAnchorRatioFromPoint(bounds: Bounds, point: Point): { x: number; y: number } {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  return {
    x: Math.abs(width) > 1e-9 ? (point.x - bounds.minX) / width : 0.5,
    y: Math.abs(height) > 1e-9 ? (point.y - bounds.minY) / height : 0.5
  };
}

export function caretStrokeWidthInSvg(fontSizePt: number): number {
  if (!Number.isFinite(fontSizePt) || fontSizePt <= 0) {
    return 0.5;
  }
  return clamp(fontSizePt * 0.055, 0.45, 1.1);
}

export function estimateTextBlockWidth(text: string, fontSize: number): number {
  const lines = text.split("\n");
  const maxChars = lines.reduce((max, line) => Math.max(max, line.length), 0);
  if (maxChars <= 0) {
    return 0;
  }
  return maxChars * fontSize * 0.7;
}

export function makeMergeKey(prefix: string, id: string, pointerId: number): string {
  return `${prefix}:${id}:${pointerId}:${Date.now().toString(36)}`;
}

export function buildAnchoredGridPreviewLines(
  anchor: number,
  min: number,
  max: number,
  step: number,
  maxLines: number
): number[] {
  if (!Number.isFinite(anchor) || !Number.isFinite(min) || !Number.isFinite(max) || !(step > 0)) {
    return [];
  }
  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  const epsilon = step * 1e-6;
  const startIndex = Math.ceil((lower - anchor - epsilon) / step);
  const endIndex = Math.floor((upper - anchor + epsilon) / step);
  if (endIndex < startIndex) {
    return [];
  }

  const count = endIndex - startIndex + 1;
  const stride = Math.max(1, Math.ceil(count / Math.max(1, maxLines)));
  const values: number[] = [];
  for (let index = startIndex; index <= endIndex; index += stride) {
    values.push(anchor + index * step);
  }

  if (startIndex <= 0 && endIndex >= 0 && !values.some((value) => Math.abs(value - anchor) <= epsilon)) {
    values.push(anchor);
    values.sort((left, right) => left - right);
  }

  return values;
}

export function previewArrowPoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  size: number
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len <= 1e-6) {
    return `${fmt(x2)},${fmt(y2)}`;
  }

  const ux = dx / len;
  const uy = dy / len;
  const baseX = x2 - ux * size;
  const baseY = y2 - uy * size;
  const halfWidth = size * 0.45;
  const px = -uy * halfWidth;
  const py = ux * halfWidth;

  const p1 = `${fmt(x2)},${fmt(y2)}`;
  const p2 = `${fmt(baseX + px)},${fmt(baseY + py)}`;
  const p3 = `${fmt(baseX - px)},${fmt(baseY - py)}`;
  return `${p1} ${p2} ${p3}`;
}

export function collectNewSourceIds(elements: SceneElement[], beforeIds: ReadonlySet<string>): string[] {
  const newIds = new Set<string>();
  for (const element of elements) {
    if (!beforeIds.has(element.sourceId)) {
      newIds.add(element.sourceId);
    }
  }
  return [...newIds];
}

export function collectMatrixStatementSourceIds(statements: readonly Statement[]): Set<string> {
  const sourceIds = new Set<string>();

  const visitStatements = (items: readonly Statement[]) => {
    for (const statement of items) {
      if (statement.kind === "Path") {
        if (statement.items.some((item) => item.kind === "Node" && isMatrixNodeItem(item))) {
          sourceIds.add(statement.id);
        }
        continue;
      }
      if (statement.kind === "Scope") {
        visitStatements(statement.body);
      }
    }
  };

  visitStatements(statements);
  return sourceIds;
}

export function isMatrixNodeItem(item: NodeItem): boolean {
  for (const entry of item.options?.entries ?? []) {
    if (entry.kind !== "flag" && entry.kind !== "kv") {
      continue;
    }
    if (entry.key === "matrix" || entry.key === "matrix of nodes" || entry.key === "matrix of math nodes") {
      return true;
    }
  }
  return false;
}

export function resolveFallbackTextSourceSpanForSourceId(
  sourceId: string,
  hitRegions: readonly HitRegion[],
  sceneTextByRegionKey: ReadonlyMap<string, SceneText>
): Span | null {
  const candidates = hitRegions
    .filter((region): region is Extract<HitRegion, { shape: "rect" }> => region.sourceId === sourceId && region.shape === "rect")
    .map((region) => sceneTextByRegionKey.get(region.key))
    .filter((sceneText): sceneText is SceneText => sceneText != null);

  if (candidates.length === 0) {
    return null;
  }

  let bestSpan: Span | null = null;
  for (const candidate of candidates) {
    const span = candidate.textSourceSpan ?? candidate.sourceSpan;
    if (span.to <= span.from) {
      continue;
    }
    if (!bestSpan || span.from < bestSpan.from || (span.from === bestSpan.from && span.to > bestSpan.to)) {
      bestSpan = span;
    }
  }

  return bestSpan;
}

export function resolveEditableTextTargetForSelectionOffsets(
  sourceId: string,
  anchorOffset: number,
  headOffset: number,
  hitRegions: readonly HitRegion[],
  resolveEditableTextTarget: (sourceId: string, region: HitRegion | undefined) => EditableTextTarget | null
): EditableTextTarget | null {
  const rectRegions = hitRegions.filter(
    (candidate): candidate is Extract<HitRegion, { shape: "rect" }> => candidate.sourceId === sourceId && candidate.shape === "rect"
  );
  if (rectRegions.length === 0) {
    return null;
  }

  const minOffset = Math.min(anchorOffset, headOffset);
  const maxOffset = Math.max(anchorOffset, headOffset);
  let fallback: EditableTextTarget | null = null;

  for (const region of rectRegions) {
    const target = resolveEditableTextTarget(sourceId, region);
    if (!target) {
      continue;
    }
    fallback ??= target;
    if (minOffset >= target.sourceSpan.from && maxOffset <= target.sourceSpan.to) {
      return target;
    }
  }

  return fallback;
}

export function sourceHasSingleResizablePathShape(
  elements: readonly SceneElement[],
  editHandles: readonly EditHandle[],
  sourceId: string,
  statements?: readonly Statement[]
): boolean {
  const sourceElements = elements.filter((element) => element.sourceId === sourceId);
  const nonText = sourceElements.filter((element) => element.kind !== "Text");
  if (nonText.length !== 1) {
    return false;
  }

  const shapeElement = nonText[0];
  if (!shapeElement) {
    return false;
  }

  if (shapeElement.kind === "Circle") {
    return true;
  }
  if (shapeElement.kind === "Ellipse") {
    return true;
  }
  if (shapeElement.kind !== "Path") {
    return false;
  }

  const pathHandles = editHandles.filter(
    (handle) => handle.sourceId === sourceId && handle.kind === "path-point"
  );

  const pathShapeHint = resolveScenePathShapeHint(shapeElement, statements, sourceId);
  if (!pathShapeHint) {
    return false;
  }

  if (pathShapeHint === "rectangle") {
    if (pathHandles.length !== 2) {
      return false;
    }
    const [firstHandle, secondHandle] = pathHandles;
    if (!firstHandle || !secondHandle) {
      return false;
    }
    if (firstHandle.rewriteMode === "unsupported" || secondHandle.rewriteMode === "unsupported") {
      return false;
    }
    if (
      firstHandle.sourceSpan.from === secondHandle.sourceSpan.from &&
      firstHandle.sourceSpan.to === secondHandle.sourceSpan.to
    ) {
      return false;
    }
    if (!transformsApproximatelyEqual(firstHandle.transform, secondHandle.transform)) {
      return false;
    }
    return true;
  }

  return pathHandles.length === 1;
}

export function findPathStatementById(
  statements: readonly Statement[],
  sourceId: string
): Extract<Statement, { kind: "Path" }> | null {
  for (const statement of statements) {
    if (statement.kind === "Path" && statement.id === sourceId) {
      return statement;
    }
    if (statement.kind === "Scope") {
      const nested = findPathStatementById(statement.body, sourceId);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
}

export function resolveStatementRotateDegrees(statement: Statement | null | undefined): number {
  if (!statement || statement.kind !== "Path") {
    return 0;
  }
  return resolveRotateDegreesFromOptions(statement.options);
}

export function resolveRotateDegreesFromOptions(options: OptionListAst | undefined): number {
  const entries = options?.entries ?? [];
  let rotate = 0;
  for (const entry of entries) {
    if (entry.kind !== "kv") {
      continue;
    }
    if (entry.key !== "rotate" && entry.key !== "/tikz/rotate") {
      continue;
    }
    const normalizedRaw = entry.valueRaw.trim();
    const unwrapped =
      normalizedRaw.startsWith("{") && normalizedRaw.endsWith("}")
        ? normalizedRaw.slice(1, -1).trim()
        : normalizedRaw;
    const parsed = Number(unwrapped);
    if (Number.isFinite(parsed)) {
      rotate = parsed;
    }
  }
  return rotate;
}

export function resolveScenePathShapeHint(
  path: ScenePath,
  statements: readonly Statement[] | undefined,
  sourceId: string
): ScenePathShapeHint | null {
  if (path.shapeHint) {
    return path.shapeHint;
  }
  if (!statements) {
    return null;
  }
  const pathStatement = findPathStatementById(statements, sourceId);
  if (!pathStatement) {
    return null;
  }
  return resolvePathShapeHintFromItems(pathStatement.items);
}

export function resolvePathShapeHintFromItems(items: readonly PathItem[]): ScenePathShapeHint | null {
  const hints = new Set<ScenePathShapeHint>();
  collectPathShapeHints(items, hints);
  if (hints.size !== 1) {
    return null;
  }
  return [...hints][0] ?? null;
}

export function collectPathShapeHints(items: readonly PathItem[], hints: Set<ScenePathShapeHint>): void {
  for (const item of items) {
    if (item.kind === "PathKeyword") {
      if (item.keyword === "rectangle") {
        hints.add("rectangle");
      } else if (item.keyword === "circle") {
        hints.add("circle");
      } else if (item.keyword === "ellipse") {
        hints.add("ellipse");
      }
      continue;
    }
    if (item.kind === "ChildOperation") {
      collectPathShapeHints(item.body, hints);
    }
  }
}

export function transformsApproximatelyEqual(
  left: EditHandle["transform"],
  right: EditHandle["transform"],
  epsilon = 1e-9
): boolean {
  return (
    Math.abs(left.a - right.a) <= epsilon &&
    Math.abs(left.b - right.b) <= epsilon &&
    Math.abs(left.c - right.c) <= epsilon &&
    Math.abs(left.d - right.d) <= epsilon &&
    Math.abs(left.e - right.e) <= epsilon &&
    Math.abs(left.f - right.f) <= epsilon
  );
}

export function ellipseAspectRatioForSource(
  elements: readonly SceneElement[],
  sourceId: string
): number | null {
  const ellipses = elements.filter(
    (element): element is Extract<SceneElement, { kind: "Ellipse" }> =>
      element.sourceId === sourceId && element.kind === "Ellipse"
  );
  if (ellipses.length !== 1) {
    return null;
  }

  const ellipse = ellipses[0];
  if (!ellipse || ellipse.rx <= 1e-6 || ellipse.ry <= 1e-6) {
    return null;
  }
  return ellipse.ry / ellipse.rx;
}

export function findWordRangeAtIndex(text: string, index: number): { start: number; end: number } | null {
  if (text.length === 0) {
    return null;
  }

  let probe = clamp(Math.floor(index), 0, text.length);
  if (probe === text.length) {
    probe = text.length - 1;
  }
  if (probe < 0) {
    return null;
  }

  if (!isWordChar(text.charAt(probe))) {
    if (probe > 0 && isWordChar(text.charAt(probe - 1))) {
      probe -= 1;
    } else {
      return null;
    }
  }

  let start = probe;
  let end = probe + 1;
  while (start > 0 && isWordChar(text.charAt(start - 1))) {
    start -= 1;
  }
  while (end < text.length && isWordChar(text.charAt(end))) {
    end += 1;
  }

  return { start, end };
}

export function isWordChar(character: string): boolean {
  return /^[A-Za-z0-9_]$/.test(character);
}

export function preferredNodeBoundsForSource(
  elements: SceneElement[],
  sourceId: string,
  viewBox: SvgViewBox,
  fallback: Bounds | null
): Bounds | null {
  const sourceElements = elements.filter((element) => element.sourceId === sourceId);
  if (sourceElements.length === 0) {
    return fallback;
  }

  const nonText = sourceElements.filter((element) => element.kind !== "Text");
  const preferred = nonText.length > 0 ? nonText : sourceElements;

  let bounds: Bounds | null = null;
  for (const element of preferred) {
    const next = elementBoundsInSvg(element, viewBox);
    if (!next) continue;
    bounds = bounds ? mergeBounds(bounds, next) : next;
  }

  return bounds ?? fallback;
}

export function getHandleCursor(
  handle: EditHandle,
  scene: { elements: SceneElement[] } | null,
  allHandles: EditHandle[]
): string {
  if (handle.kind !== "path-point" || !scene) {
    return "move";
  }

  const siblingPathHandles = allHandles.filter(
    (candidate) => candidate.kind === "path-point" && candidate.sourceId === handle.sourceId
  );
  if (siblingPathHandles.length === 2) {
    const other = siblingPathHandles.find((candidate) => candidate.id !== handle.id);
    if (other) {
      const vector = {
        x: other.world.x - handle.world.x,
        y: other.world.y - handle.world.y
      };
      if (vectorLengthSquared(vector) > 1e-12) {
        return resizeCursorForVector(vector);
      }
    }
  }

  const sourcePaths = scene.elements.filter(
    (element): element is ScenePath => element.kind === "Path" && element.sourceId === handle.sourceId
  );
  if (sourcePaths.length === 0) {
    return "move";
  }

  let bestVector: Point | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const path of sourcePaths) {
    let current: Point | null = null;
    let subpathStart: Point | null = null;
    for (const command of path.commands) {
      if (command.kind === "M") {
        current = command.to;
        subpathStart = command.to;
        continue;
      }

      if (command.kind === "Z") {
        if (current && subpathStart) {
          const vector = { x: subpathStart.x - current.x, y: subpathStart.y - current.y };
          const fromDist = distanceSquared(handle.world, current);
          if (fromDist < bestDistance && vectorLengthSquared(vector) > 1e-12) {
            bestDistance = fromDist;
            bestVector = vector;
          }
          const toDist = distanceSquared(handle.world, subpathStart);
          if (toDist < bestDistance && vectorLengthSquared(vector) > 1e-12) {
            bestDistance = toDist;
            bestVector = vector;
          }
          current = subpathStart;
        }
        continue;
      }

      if (!current) {
        current = command.to;
        continue;
      }

      const from = current;
      const to = command.to;

      if (command.kind === "L" || command.kind === "A") {
        const vector = { x: to.x - from.x, y: to.y - from.y };
        const fromDist = distanceSquared(handle.world, from);
        if (fromDist < bestDistance && vectorLengthSquared(vector) > 1e-12) {
          bestDistance = fromDist;
          bestVector = vector;
        }
        const toDist = distanceSquared(handle.world, to);
        if (toDist < bestDistance && vectorLengthSquared(vector) > 1e-12) {
          bestDistance = toDist;
          bestVector = vector;
        }
      } else {
        const startVector = { x: command.c1.x - from.x, y: command.c1.y - from.y };
        const endVector = { x: to.x - command.c2.x, y: to.y - command.c2.y };

        const fromDist = distanceSquared(handle.world, from);
        if (fromDist < bestDistance && vectorLengthSquared(startVector) > 1e-12) {
          bestDistance = fromDist;
          bestVector = startVector;
        }
        const toDist = distanceSquared(handle.world, to);
        if (toDist < bestDistance && vectorLengthSquared(endVector) > 1e-12) {
          bestDistance = toDist;
          bestVector = endVector;
        }
      }

      current = to;
    }
  }

  if (!bestVector) {
    return "move";
  }

  return resizeCursorForVector(bestVector);
}

export function selectNudgeAnchorHandle(handles: EditHandle[]): EditHandle | null {
  if (handles.length === 0) {
    return null;
  }
  return handles.find((handle) => handle.kind === "node-position") ?? handles[0]!;
}

export function canvasDragKindFromDragState(drag: DragState | null): CanvasDragKind | null {
  if (!drag) {
    return null;
  }
  if (drag.kind === "tool-bezier-bend") {
    return "tool-create";
  }
  return drag.kind;
}

export function dragCursorForState(drag: DragState | null): string | null {
  if (!drag) {
    return null;
  }
  if (drag.kind === "handle" || drag.kind === "resize" || drag.kind === "rotate") {
    return drag.cursor;
  }
  if (drag.kind === "element") {
    return "move";
  }
  if (drag.kind === "pan") {
    return "grabbing";
  }
  if (drag.kind === "marquee" || drag.kind === "tool-create" || drag.kind === "tool-bezier-bend") {
    return "crosshair";
  }
  return drag.kind === "text-select" ? "text" : null;
}

export function resizeCursorForRole(role: ResizeRole): string {
  return role === "top-left" || role === "bottom-right" ? "nwse-resize" : "nesw-resize";
}

export function isPointInsideRect(clientX: number, clientY: number, rect: DOMRect): boolean {
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

export function addGuide(guides: GuidesState, orientation: GuideOrientation, value: number): GuidesState {
  if (orientation === "vertical") {
    const nextVertical = [...guides.vertical];
    const added = upsertGuideValue(nextVertical, value);
    if (!added) {
      return guides;
    }
    nextVertical.sort((a, b) => a - b);
    return { ...guides, vertical: nextVertical };
  }

  const nextHorizontal = [...guides.horizontal];
  const added = upsertGuideValue(nextHorizontal, value);
  if (!added) {
    return guides;
  }
  nextHorizontal.sort((a, b) => a - b);
  return { ...guides, horizontal: nextHorizontal };
}

export function removeGuide(guides: GuidesState, orientation: GuideOrientation, value: number): GuidesState {
  if (orientation === "vertical") {
    const nextVertical = [...guides.vertical];
    const removed = removeGuideValue(nextVertical, value);
    if (!removed) {
      return guides;
    }
    return { ...guides, vertical: nextVertical };
  }

  const nextHorizontal = [...guides.horizontal];
  const removed = removeGuideValue(nextHorizontal, value);
  if (!removed) {
    return guides;
  }
  return { ...guides, horizontal: nextHorizontal };
}

export function moveGuide(
  guides: GuidesState,
  orientation: GuideOrientation,
  sourceValue: number,
  targetValue: number
): GuidesState {
  const withoutSource = removeGuide(guides, orientation, sourceValue);
  return addGuide(withoutSource, orientation, targetValue);
}

export function upsertGuideValue(values: number[], value: number): boolean {
  const normalized = normalizeGuideValue(value);
  if (values.some((existing) => Math.abs(existing - normalized) <= 1e-4)) {
    return false;
  }
  values.push(normalized);
  return true;
}

export function removeGuideValue(values: number[], value: number): boolean {
  const normalized = normalizeGuideValue(value);
  const index = values.findIndex((existing) => Math.abs(existing - normalized) <= 1e-4);
  if (index < 0) {
    return false;
  }
  values.splice(index, 1);
  return true;
}

export function normalizeGuideValue(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

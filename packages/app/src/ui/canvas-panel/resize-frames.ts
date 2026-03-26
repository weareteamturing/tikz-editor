import { worldToLocal } from "tikz-editor/edit/coords";
import type { ResizeRole } from "tikz-editor/edit/actions";
import type {
  EditHandle,
  Matrix2D,
  Point,
  SceneCircle,
  SceneElement,
  SceneEllipse,
  ScenePath,
  ScenePathShapeHint,
  SceneText
} from "tikz-editor/semantic/types";
import { applyMatrix, applyMatrixToVector } from "tikz-editor/semantic/transform";
import type { SvgViewBox } from "tikz-editor/svg/types";
import { svgToWorldPoint, worldToSvgPoint } from "./geometry";
import type { Bounds } from "./types";

export type ResizeFrameCornerRole = Extract<ResizeRole, "top-left" | "top-right" | "bottom-left" | "bottom-right">;

export const RESIZE_FRAME_CORNER_ROLES: readonly ResizeFrameCornerRole[] = [
  "top-left",
  "top-right",
  "bottom-right",
  "bottom-left"
];

export type ResizeFrameCorner = {
  world: Point;
  svg: Point;
};

export type ResizeFrame = {
  sourceId: string;
  centerWorld: Point;
  centerSvg: Point;
  cornersByRole: Record<ResizeFrameCornerRole, ResizeFrameCorner>;
  polygonSvg: Point[];
  boundsSvg: Bounds;
};

const EPSILON = 1e-6;

const IDENTITY_MATRIX: Matrix2D = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0
};

export function resolveResizeFrameForSource(
  elements: readonly SceneElement[],
  editHandles: readonly EditHandle[],
  sourceId: string,
  viewBox: SvgViewBox,
  pathShapeHintOverride?: ScenePathShapeHint | null
): ResizeFrame | null {
  const sourceElements = elements.filter((element) => element.sourceRef.sourceId === sourceId && !element.adornment);
  const nonTextElements = sourceElements.filter((element) => element.kind !== "Text");
  const textElements = sourceElements.filter(
    (element): element is SceneText => element.kind === "Text"
  );
  if (nonTextElements.length === 1) {
    const element = nonTextElements[0];
    if (!element) {
      return null;
    }

    if (element.kind === "Path") {
      return resolvePathResizeFrame(
        element,
        sourceElements,
        editHandles,
        sourceId,
        viewBox,
        pathShapeHintOverride
      );
    }
    if (element.kind === "Circle") {
      return resolveCircleResizeFrame(element, editHandles, sourceId, viewBox);
    }
    if (element.kind === "Ellipse") {
      return resolveEllipseResizeFrame(element, editHandles, sourceId, viewBox);
    }
    return null;
  }

  if (nonTextElements.length === 0 && textElements.length === 1) {
    return resolveTextResizeFrame(sourceId, textElements[0], viewBox);
  }
  return null;
}

export function resolveResizeFrameFromBounds(
  sourceId: string,
  bounds: Bounds,
  viewBox: SvgViewBox
): ResizeFrame | null {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (!(width > EPSILON) || !(height > EPSILON)) {
    return null;
  }

  const cornersByRoleSvg: Record<ResizeFrameCornerRole, Point> = {
    "top-left": { x: bounds.minX, y: bounds.minY },
    "top-right": { x: bounds.maxX, y: bounds.minY },
    "bottom-right": { x: bounds.maxX, y: bounds.maxY },
    "bottom-left": { x: bounds.minX, y: bounds.maxY }
  };
  const centerWorld = svgToWorldPoint(
    {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2
    },
    viewBox
  );
  const cornersByRoleWorld: Record<ResizeFrameCornerRole, Point> = {
    "top-left": svgToWorldPoint(cornersByRoleSvg["top-left"], viewBox),
    "top-right": svgToWorldPoint(cornersByRoleSvg["top-right"], viewBox),
    "bottom-right": svgToWorldPoint(cornersByRoleSvg["bottom-right"], viewBox),
    "bottom-left": svgToWorldPoint(cornersByRoleSvg["bottom-left"], viewBox)
  };
  return buildResizeFrame(sourceId, centerWorld, cornersByRoleWorld, viewBox);
}

function resolvePathResizeFrame(
  path: ScenePath,
  sourceElements: readonly SceneElement[],
  editHandles: readonly EditHandle[],
  sourceId: string,
  viewBox: SvgViewBox,
  pathShapeHintOverride?: ScenePathShapeHint | null
): ResizeFrame | null {
  const pathShapeHint = pathShapeHintOverride === undefined ? (path.shapeHint ?? null) : pathShapeHintOverride;
  if (!pathShapeHint) {
    return resolveNodePathResizeFrame(path, sourceElements, editHandles, sourceId, viewBox);
  }
  if (pathShapeHint === "rectangle") {
    return resolvePathRectangleResizeFrame(editHandles, sourceId, viewBox);
  }
  if (pathShapeHint === "circle" || pathShapeHint === "ellipse") {
    const centerHandle = pickCenterPathPointHandle(editHandles, sourceId);
    if (!centerHandle) {
      return null;
    }
    const radii = resolvePathArcRadii(path, pathShapeHint);
    if (!radii) {
      return null;
    }
    return resolveEllipseLikeResizeFrame(
      sourceId,
      centerHandle.world,
      radii.rx,
      radii.ry,
      viewBox,
      centerHandle.transform
    );
  }
  return null;
}

function resolveNodePathResizeFrame(
  path: ScenePath,
  sourceElements: readonly SceneElement[],
  editHandles: readonly EditHandle[],
  sourceId: string,
  viewBox: SvgViewBox
): ResizeFrame | null {
  const isNodeSource =
    sourceElements.some((element) => element.kind === "Text") ||
    editHandles.some((handle) => handle.sourceRef.sourceId === sourceId && handle.kind === "node-position");
  if (!isNodeSource) {
    return null;
  }

  const corners = resolveRectanglePathCorners(path);
  if (!corners) {
    return resolveGenericNodePathResizeFrame(path, sourceId, viewBox);
  }
  const transformedCorners = path.transform
    ? corners.map((corner) => applyMatrix(path.transform!, corner))
    : corners;
  const centerWorld = {
    x: transformedCorners.reduce((sum, point) => sum + point.x, 0) / transformedCorners.length,
    y: transformedCorners.reduce((sum, point) => sum + point.y, 0) / transformedCorners.length
  };
  const basis = resolveRectangleBasis(transformedCorners);
  if (!basis) {
    return null;
  }
  const cornersByRole = assignCornersByRoleWithBasis(transformedCorners, centerWorld, basis.u, basis.v);
  if (!cornersByRole) {
    return null;
  }
  return buildResizeFrame(sourceId, centerWorld, cornersByRole, viewBox);
}

function resolveGenericNodePathResizeFrame(
  path: ScenePath,
  sourceId: string,
  viewBox: SvgViewBox
): ResizeFrame | null {
  const localBounds = approximatePathBoundsInWorld(path);
  if (!localBounds) {
    return null;
  }
  const width = localBounds.maxX - localBounds.minX;
  const height = localBounds.maxY - localBounds.minY;
  if (!(width > EPSILON) || !(height > EPSILON)) {
    return null;
  }

  const roleLocal: Record<ResizeFrameCornerRole, Point> = {
    "top-left": { x: localBounds.minX, y: localBounds.maxY },
    "top-right": { x: localBounds.maxX, y: localBounds.maxY },
    "bottom-right": { x: localBounds.maxX, y: localBounds.minY },
    "bottom-left": { x: localBounds.minX, y: localBounds.minY }
  };
  const transform = path.transform;
  const roleWorld: Record<ResizeFrameCornerRole, Point> = transform
    ? {
        "top-left": applyMatrix(transform, roleLocal["top-left"]),
        "top-right": applyMatrix(transform, roleLocal["top-right"]),
        "bottom-right": applyMatrix(transform, roleLocal["bottom-right"]),
        "bottom-left": applyMatrix(transform, roleLocal["bottom-left"])
      }
    : roleLocal;
  const centerLocal = {
    x: (localBounds.minX + localBounds.maxX) / 2,
    y: (localBounds.minY + localBounds.maxY) / 2
  };
  const centerWorld = transform ? applyMatrix(transform, centerLocal) : centerLocal;
  return buildResizeFrame(sourceId, centerWorld, roleWorld, viewBox);
}

function approximatePathBoundsInWorld(path: ScenePath): Bounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let current: Point | null = null;

  const includePoint = (point: Point): void => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  };

  for (const command of path.commands) {
    if (command.kind === "M") {
      current = command.to;
      includePoint(command.to);
      continue;
    }
    if (command.kind === "L") {
      current = command.to;
      includePoint(command.to);
      continue;
    }
    if (command.kind === "C") {
      includePoint(command.c1);
      includePoint(command.c2);
      includePoint(command.to);
      current = command.to;
      continue;
    }
    if (command.kind === "A") {
      if (current) {
        includePoint({ x: current.x - command.rx, y: current.y - command.ry });
        includePoint({ x: current.x + command.rx, y: current.y + command.ry });
      }
      includePoint({ x: command.to.x - command.rx, y: command.to.y - command.ry });
      includePoint({ x: command.to.x + command.rx, y: command.to.y + command.ry });
      current = command.to;
      continue;
    }
    if (command.kind === "Z") {
      continue;
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

function resolvePathRectangleResizeFrame(
  editHandles: readonly EditHandle[],
  sourceId: string,
  viewBox: SvgViewBox
): ResizeFrame | null {
  const pathPointHandles = editHandles.filter(
    (handle) => handle.sourceRef.sourceId === sourceId && handle.kind === "path-point"
  );
  if (pathPointHandles.length !== 2) {
    return null;
  }

  const [startHandle, oppositeHandle] = pathPointHandles;
  if (!startHandle || !oppositeHandle) {
    return null;
  }
  if (!transformsApproximatelyEqual(startHandle.transform, oppositeHandle.transform)) {
    return null;
  }

  const transform = startHandle.transform;
  const startLocal = startHandle.local ?? worldToLocal(startHandle.world, transform);
  const oppositeLocal = oppositeHandle.local ?? worldToLocal(oppositeHandle.world, transform);
  if (!startLocal || !oppositeLocal) {
    return null;
  }

  const minX = Math.min(startLocal.x, oppositeLocal.x);
  const maxX = Math.max(startLocal.x, oppositeLocal.x);
  const minY = Math.min(startLocal.y, oppositeLocal.y);
  const maxY = Math.max(startLocal.y, oppositeLocal.y);
  const roleLocal: Record<ResizeFrameCornerRole, Point> = {
    "top-left": { x: minX, y: maxY },
    "top-right": { x: maxX, y: maxY },
    "bottom-right": { x: maxX, y: minY },
    "bottom-left": { x: minX, y: minY }
  };
  const roleWorld: Record<ResizeFrameCornerRole, Point> = {
    "top-left": applyMatrix(transform, roleLocal["top-left"]),
    "top-right": applyMatrix(transform, roleLocal["top-right"]),
    "bottom-right": applyMatrix(transform, roleLocal["bottom-right"]),
    "bottom-left": applyMatrix(transform, roleLocal["bottom-left"])
  };
  const centerWorld = applyMatrix(transform, {
    x: (startLocal.x + oppositeLocal.x) / 2,
    y: (startLocal.y + oppositeLocal.y) / 2
  });
  return buildResizeFrame(sourceId, centerWorld, roleWorld, viewBox);
}

function resolveCircleResizeFrame(
  circle: SceneCircle,
  editHandles: readonly EditHandle[],
  sourceId: string,
  viewBox: SvgViewBox
): ResizeFrame | null {
  const centerHandle = pickCenterPathPointHandle(editHandles, sourceId, circle.center);
  if (!centerHandle || circle.radius <= EPSILON) {
    return null;
  }
  return resolveEllipseLikeResizeFrame(
    sourceId,
    circle.center,
    circle.radius,
    circle.radius,
    viewBox,
    centerHandle.transform
  );
}

function resolveEllipseResizeFrame(
  ellipse: SceneEllipse,
  editHandles: readonly EditHandle[],
  sourceId: string,
  viewBox: SvgViewBox
): ResizeFrame | null {
  const centerHandle = pickCenterPathPointHandle(editHandles, sourceId, ellipse.center);
  if (!centerHandle || ellipse.rx <= EPSILON || ellipse.ry <= EPSILON) {
    return null;
  }

  const transform = centerHandle.transform;
  const shouldApplyEllipseRotation = matrixIsIdentity(transform) && Math.abs(ellipse.rotation ?? 0) > EPSILON;

  return resolveEllipseLikeResizeFrame(
    sourceId,
    ellipse.center,
    ellipse.rx,
    ellipse.ry,
    viewBox,
    transform,
    shouldApplyEllipseRotation ? (ellipse.rotation ?? 0) : 0
  );
}

function resolveEllipseLikeResizeFrame(
  sourceId: string,
  centerWorld: Point,
  rx: number,
  ry: number,
  viewBox: SvgViewBox,
  transform: Matrix2D,
  extraRotation = 0
): ResizeFrame | null {
  if (!(rx > EPSILON) || !(ry > EPSILON)) {
    return null;
  }

  const localByRole: Record<ResizeFrameCornerRole, Point> = {
    "top-left": { x: -rx, y: ry },
    "top-right": { x: rx, y: ry },
    "bottom-right": { x: rx, y: -ry },
    "bottom-left": { x: -rx, y: -ry }
  };
  const toWorldCorner = (localCorner: Point): Point => {
    let worldOffset = applyMatrixToVector(transform, localCorner);
    if (Math.abs(extraRotation) > EPSILON) {
      worldOffset = rotateVector(worldOffset, extraRotation);
    }
    return {
      x: centerWorld.x + worldOffset.x,
      y: centerWorld.y + worldOffset.y
    };
  };
  const roleWorld: Record<ResizeFrameCornerRole, Point> = {
    "top-left": toWorldCorner(localByRole["top-left"]),
    "top-right": toWorldCorner(localByRole["top-right"]),
    "bottom-right": toWorldCorner(localByRole["bottom-right"]),
    "bottom-left": toWorldCorner(localByRole["bottom-left"])
  };
  return buildResizeFrame(sourceId, centerWorld, roleWorld, viewBox);
}

function resolveTextResizeFrame(
  sourceId: string,
  text: SceneText,
  viewBox: SvgViewBox
): ResizeFrame | null {
  const width = text.nodeVisualWidth ?? text.textBlockWidth ?? estimateTextBlockWidth(text.text, text.style.fontSize);
  const lineCount = Math.max(1, text.text.split("\n").length);
  const height = text.nodeVisualHeight ?? text.textBlockHeight ?? lineCount * text.style.fontSize * 1.15;
  if (!(width > EPSILON) || !(height > EPSILON)) {
    return null;
  }

  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const rotation = text.rotation ?? 0;
  const localByRole: Record<ResizeFrameCornerRole, Point> = {
    "top-left": { x: -halfWidth, y: halfHeight },
    "top-right": { x: halfWidth, y: halfHeight },
    "bottom-right": { x: halfWidth, y: -halfHeight },
    "bottom-left": { x: -halfWidth, y: -halfHeight }
  };
  const cornersByRole = {
    "top-left": rotateAndTranslatePoint(localByRole["top-left"], text.position, rotation),
    "top-right": rotateAndTranslatePoint(localByRole["top-right"], text.position, rotation),
    "bottom-right": rotateAndTranslatePoint(localByRole["bottom-right"], text.position, rotation),
    "bottom-left": rotateAndTranslatePoint(localByRole["bottom-left"], text.position, rotation)
  };
  if (!text.transform) {
    return buildResizeFrame(sourceId, text.position, cornersByRole, viewBox);
  }
  const transformedCornersByRole = {
    "top-left": applyMatrix(text.transform, cornersByRole["top-left"]),
    "top-right": applyMatrix(text.transform, cornersByRole["top-right"]),
    "bottom-right": applyMatrix(text.transform, cornersByRole["bottom-right"]),
    "bottom-left": applyMatrix(text.transform, cornersByRole["bottom-left"])
  };
  const centerWorld = applyMatrix(text.transform, text.position);
  return buildResizeFrame(sourceId, centerWorld, transformedCornersByRole, viewBox);
}

function resolvePathArcRadii(
  path: ScenePath,
  pathShapeHint: Extract<ScenePathShapeHint, "circle" | "ellipse">
): { rx: number; ry: number } | null {
  const arc = path.commands.find(
    (command): command is Extract<ScenePath["commands"][number], { kind: "A" }> => command.kind === "A"
  );
  if (!arc) {
    return null;
  }
  if (pathShapeHint === "circle") {
    const radius = Math.max(Math.abs(arc.rx), Math.abs(arc.ry));
    if (!(radius > EPSILON)) {
      return null;
    }
    return { rx: radius, ry: radius };
  }
  const rx = Math.abs(arc.rx);
  const ry = Math.abs(arc.ry);
  if (!(rx > EPSILON) || !(ry > EPSILON)) {
    return null;
  }
  return { rx, ry };
}

function buildResizeFrame(
  sourceId: string,
  centerWorld: Point,
  cornersByRoleWorld: Record<ResizeFrameCornerRole, Point>,
  viewBox: SvgViewBox
): ResizeFrame | null {
  const cornersByRole = {
    "top-left": {
      world: cornersByRoleWorld["top-left"],
      svg: worldToSvgPoint(cornersByRoleWorld["top-left"], viewBox)
    },
    "top-right": {
      world: cornersByRoleWorld["top-right"],
      svg: worldToSvgPoint(cornersByRoleWorld["top-right"], viewBox)
    },
    "bottom-right": {
      world: cornersByRoleWorld["bottom-right"],
      svg: worldToSvgPoint(cornersByRoleWorld["bottom-right"], viewBox)
    },
    "bottom-left": {
      world: cornersByRoleWorld["bottom-left"],
      svg: worldToSvgPoint(cornersByRoleWorld["bottom-left"], viewBox)
    }
  };

  const polygonSvg = RESIZE_FRAME_CORNER_ROLES.map((role) => cornersByRole[role].svg);
  const boundsSvg = boundsFromPoints(polygonSvg);

  return {
    sourceId,
    centerWorld,
    centerSvg: worldToSvgPoint(centerWorld, viewBox),
    cornersByRole,
    polygonSvg,
    boundsSvg
  };
}

function resolveRectanglePathCorners(path: ScenePath): Point[] | null {
  const corners: Point[] = [];
  let closed = false;
  for (const command of path.commands) {
    if (command.kind === "M" || command.kind === "L") {
      if (closed) {
        return null;
      }
      corners.push(command.to);
      continue;
    }
    if (command.kind === "Z") {
      closed = true;
      break;
    }
    return null;
  }

  if (!closed || corners.length < 4) {
    return null;
  }
  const first = corners[0];
  const last = corners[corners.length - 1];
  if (!first || !last) {
    return null;
  }
  if (pointsApproximatelyEqual(first, last)) {
    corners.pop();
  }
  if (corners.length !== 4) {
    return null;
  }
  return resolveRectangleBasis(corners) ? corners : null;
}

function resolveRectangleBasis(corners: readonly Point[]): { u: Point; v: Point } | null {
  if (corners.length !== 4) {
    return null;
  }

  const edge01 = subtractPoints(corners[1], corners[0]);
  const edge12 = subtractPoints(corners[2], corners[1]);
  const edge23 = subtractPoints(corners[3], corners[2]);
  const edge30 = subtractPoints(corners[0], corners[3]);
  const len01 = Math.hypot(edge01.x, edge01.y);
  const len12 = Math.hypot(edge12.x, edge12.y);
  const len23 = Math.hypot(edge23.x, edge23.y);
  const len30 = Math.hypot(edge30.x, edge30.y);
  if (len01 <= EPSILON || len12 <= EPSILON || len23 <= EPSILON || len30 <= EPSILON) {
    return null;
  }

  const orthogonalityTolerance = 1e-3;
  const lengthTolerance = 1e-3;
  if (Math.abs(dot(edge01, edge12)) > orthogonalityTolerance * len01 * len12) {
    return null;
  }
  if (Math.abs(dot(edge12, edge23)) > orthogonalityTolerance * len12 * len23) {
    return null;
  }
  if (Math.abs(len01 - len23) > lengthTolerance * Math.max(len01, len23)) {
    return null;
  }
  if (Math.abs(len12 - len30) > lengthTolerance * Math.max(len12, len30)) {
    return null;
  }

  return {
    u: { x: edge01.x / len01, y: edge01.y / len01 },
    v: { x: edge12.x / len12, y: edge12.y / len12 }
  };
}

function assignCornersByRoleWithBasis(
  points: readonly Point[],
  center: Point,
  uAxis: Point,
  vAxis: Point
): Record<ResizeFrameCornerRole, Point> | null {
  if (points.length !== 4) {
    return null;
  }

  const projections = points.map((point) => ({
    point,
    u: dot(subtractPoints(point, center), uAxis),
    v: dot(subtractPoints(point, center), vAxis)
  }));
  const maxAbsU = Math.max(...projections.map((projection) => Math.abs(projection.u)));
  const maxAbsV = Math.max(...projections.map((projection) => Math.abs(projection.v)));
  if (maxAbsU <= EPSILON || maxAbsV <= EPSILON) {
    return null;
  }

  const usedIndices = new Set<number>();
  const pick = (targetU: number, targetV: number): Point | null => {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < projections.length; index += 1) {
      if (usedIndices.has(index)) {
        continue;
      }
      const projection = projections[index];
      if (!projection) {
        continue;
      }
      const normalizedU = projection.u / maxAbsU;
      const normalizedV = projection.v / maxAbsV;
      const distance =
        (normalizedU - targetU) * (normalizedU - targetU) +
        (normalizedV - targetV) * (normalizedV - targetV);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) {
      return null;
    }
    usedIndices.add(bestIndex);
    return projections[bestIndex]?.point ?? null;
  };

  const topLeft = pick(-1, 1);
  const topRight = pick(1, 1);
  const bottomRight = pick(1, -1);
  const bottomLeft = pick(-1, -1);
  if (!topLeft || !topRight || !bottomRight || !bottomLeft) {
    return null;
  }
  return {
    "top-left": topLeft,
    "top-right": topRight,
    "bottom-right": bottomRight,
    "bottom-left": bottomLeft
  };
}

function pickCenterPathPointHandle(
  editHandles: readonly EditHandle[],
  sourceId: string,
  targetCenter?: Point
): EditHandle | null {
  const pathPointHandles = editHandles.filter(
    (handle) => handle.sourceRef.sourceId === sourceId && handle.kind === "path-point"
  );
  const candidateHandles =
    pathPointHandles.length > 0
      ? pathPointHandles
      : editHandles.filter(
          (handle) => handle.sourceRef.sourceId === sourceId && handle.kind === "node-position"
        );
  if (candidateHandles.length === 0) {
    return null;
  }
  if (!targetCenter) {
    return candidateHandles[0] ?? null;
  }

  let bestHandle = candidateHandles[0] ?? null;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  for (const handle of candidateHandles) {
    const dx = handle.world.x - targetCenter.x;
    const dy = handle.world.y - targetCenter.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestHandle = handle;
    }
  }
  return bestHandle;
}

function boundsFromPoints(points: readonly Point[]): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, minY, maxX, maxY };
}

function rotateVector(vector: Point, degrees: number): Point {
  if (Math.abs(degrees) <= EPSILON) {
    return vector;
  }
  const theta = (degrees * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    x: vector.x * cos - vector.y * sin,
    y: vector.x * sin + vector.y * cos
  };
}

function rotateAndTranslatePoint(localPoint: Point, center: Point, degrees: number): Point {
  const rotated = rotateVector(localPoint, degrees);
  return {
    x: center.x + rotated.x,
    y: center.y + rotated.y
  };
}

function subtractPoints(left: Point, right: Point): Point {
  return {
    x: left.x - right.x,
    y: left.y - right.y
  };
}

function dot(left: Point, right: Point): number {
  return left.x * right.x + left.y * right.y;
}

function pointsApproximatelyEqual(left: Point, right: Point, epsilon = 1e-6): boolean {
  return Math.abs(left.x - right.x) <= epsilon && Math.abs(left.y - right.y) <= epsilon;
}

function estimateTextBlockWidth(text: string, fontSize: number): number {
  const lines = text.split("\n");
  const maxChars = lines.reduce((max, line) => Math.max(max, line.length), 0);
  if (maxChars <= 0) {
    return 0;
  }
  return maxChars * fontSize * 0.7;
}

function matrixIsIdentity(matrix: Matrix2D): boolean {
  return (
    Math.abs(matrix.a - IDENTITY_MATRIX.a) <= EPSILON &&
    Math.abs(matrix.b - IDENTITY_MATRIX.b) <= EPSILON &&
    Math.abs(matrix.c - IDENTITY_MATRIX.c) <= EPSILON &&
    Math.abs(matrix.d - IDENTITY_MATRIX.d) <= EPSILON &&
    Math.abs(matrix.e - IDENTITY_MATRIX.e) <= EPSILON &&
    Math.abs(matrix.f - IDENTITY_MATRIX.f) <= EPSILON
  );
}

function transformsApproximatelyEqual(
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

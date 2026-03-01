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
  ScenePathShapeHint
} from "tikz-editor/semantic/types";
import { applyMatrix, applyMatrixToVector } from "tikz-editor/semantic/transform";
import type { SvgViewBox } from "tikz-editor/svg/types";
import { worldToSvgPoint } from "./geometry";
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
  const sourceElements = elements.filter((element) => element.sourceId === sourceId);
  const nonTextElements = sourceElements.filter((element) => element.kind !== "Text");
  if (nonTextElements.length !== 1) {
    return null;
  }

  const element = nonTextElements[0];
  if (!element) {
    return null;
  }

  if (element.kind === "Path") {
    return resolvePathResizeFrame(element, editHandles, sourceId, viewBox, pathShapeHintOverride);
  }
  if (element.kind === "Circle") {
    return resolveCircleResizeFrame(element, editHandles, sourceId, viewBox);
  }
  if (element.kind === "Ellipse") {
    return resolveEllipseResizeFrame(element, editHandles, sourceId, viewBox);
  }
  return null;
}

function resolvePathResizeFrame(
  path: ScenePath,
  editHandles: readonly EditHandle[],
  sourceId: string,
  viewBox: SvgViewBox,
  pathShapeHintOverride?: ScenePathShapeHint | null
): ResizeFrame | null {
  const pathShapeHint = pathShapeHintOverride === undefined ? (path.shapeHint ?? null) : pathShapeHintOverride;
  if (!pathShapeHint) {
    return null;
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

function resolvePathRectangleResizeFrame(
  editHandles: readonly EditHandle[],
  sourceId: string,
  viewBox: SvgViewBox
): ResizeFrame | null {
  const pathPointHandles = editHandles.filter(
    (handle) => handle.sourceId === sourceId && handle.kind === "path-point"
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

function pickCenterPathPointHandle(
  editHandles: readonly EditHandle[],
  sourceId: string,
  targetCenter?: Point
): EditHandle | null {
  const candidateHandles = editHandles.filter(
    (handle) => handle.sourceId === sourceId && handle.kind === "path-point"
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

import { parseCoordinate } from "../../domains/coordinates/parse.js";
import type { CoordinateItem, PathItem } from "../../ast/types.js";
import {
  readNamedNodeGeometry,
  type NamedNodeGeometry,
  type SemanticContext
} from "../context.js";
import type { Point } from "../types.js";
import { intersectRayWithPolygon } from "./shape-geometry.js";
import { applyMatrixToVector, inverseMatrix } from "../transform.js";

export function collectScopedNodeNames(name: string | undefined, aliases: string[] | undefined, context: SemanticContext): string[] {
  const names = [name, ...(aliases ?? [])].filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  const scoped = names.map((entry) => applyNameScope(entry, context));
  return Array.from(new Set(scoped));
}

export function maybeResolveTrailingCoordinateFromNodeName(name: string | undefined): string | null {
  if (!name) {
    return null;
  }

  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const asCoordinate = `(${trimmed})`;
  const parsed = parseCoordinate(asCoordinate);
  if (parsed.form === "named" || parsed.form === "unknown") {
    return null;
  }
  return asCoordinate;
}

export function shouldCaptureStandaloneNodeNameCoordinate(items: PathItem[], coordinateIndex: number): boolean {
  for (let index = 0; index < coordinateIndex; index += 1) {
    if (items[index]?.kind === "Node") {
      return false;
    }
  }

  for (let index = coordinateIndex - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item || item.kind === "PathComment") {
      continue;
    }
    if (item.kind === "PathKeyword" && item.keyword === "at") {
      return false;
    }
    break;
  }

  return true;
}

export function applyNameScope(name: string, context: SemanticContext): string {
  const frame = context.stack[context.stack.length - 1];
  const prefix = frame?.namePrefix ?? "";
  const suffix = frame?.nameSuffix ?? "";
  if (prefix.length === 0 && suffix.length === 0) {
    return name.trim();
  }

  const trimmed = name.trim();
  const dot = trimmed.indexOf(".");
  if (dot === -1) {
    return `${prefix}${trimmed}${suffix}`;
  }

  const base = trimmed.slice(0, dot);
  const anchor = trimmed.slice(dot);
  return `${prefix}${base}${suffix}${anchor}`;
}

export function maybeResolveNamedCoordinateBorderPoint(
  coordinate: Pick<CoordinateItem, "form" | "x">,
  fallbackPoint: Point,
  fromPoint: Point | null,
  context: SemanticContext
): Point {
  if (coordinate.form !== "named") {
    return fallbackPoint;
  }
  return maybeResolveNamedNodeBorderPoint(coordinate.x, fallbackPoint, fromPoint, context);
}

export function maybeResolveNamedCoordinateBorderPointFromRaw(
  rawCoordinate: string,
  fallbackPoint: Point,
  fromPoint: Point | null,
  context: SemanticContext
): Point {
  const parsed = parseCoordinate(rawCoordinate);
  if (parsed.form !== "named") {
    return fallbackPoint;
  }
  return maybeResolveNamedNodeBorderPoint(parsed.x, fallbackPoint, fromPoint, context);
}

export function maybeResolveNamedCoordinateBorderPointFromRawAlongAngle(
  rawCoordinate: string,
  fallbackPoint: Point,
  angleDegrees: number,
  context: SemanticContext
): Point {
  const parsed = parseCoordinate(rawCoordinate);
  if (parsed.form !== "named") {
    return fallbackPoint;
  }
  return maybeResolveNamedNodeBorderPointAlongAngle(parsed.x, fallbackPoint, angleDegrees, context);
}

function maybeResolveNamedNodeBorderPoint(
  rawName: string,
  fallbackPoint: Point,
  fromPoint: Point | null,
  context: SemanticContext
): Point {
  if (!fromPoint) {
    return fallbackPoint;
  }

  const trimmed = rawName.trim();
  if (trimmed.length === 0 || trimmed.includes(".")) {
    return fallbackPoint;
  }

  const geometry = resolveNamedNodeGeometry(trimmed, context);
  if (!geometry || geometry.shape === "coordinate") {
    return fallbackPoint;
  }

  const borderPoint = intersectNodeBorder(geometry, fromPoint);
  return borderPoint ?? fallbackPoint;
}

function maybeResolveNamedNodeBorderPointAlongAngle(
  rawName: string,
  fallbackPoint: Point,
  angleDegrees: number,
  context: SemanticContext
): Point {
  const trimmed = rawName.trim();
  if (trimmed.length === 0 || trimmed.includes(".")) {
    return fallbackPoint;
  }

  const geometry = resolveNamedNodeGeometry(trimmed, context);
  if (!geometry || geometry.shape === "coordinate") {
    return fallbackPoint;
  }

  const radians = (angleDegrees * Math.PI) / 180;
  const probePoint = {
    x: geometry.center.x + Math.cos(radians),
    y: geometry.center.y + Math.sin(radians)
  };
  const borderPoint = intersectNodeBorder(geometry, probePoint);
  return borderPoint ?? fallbackPoint;
}

function resolveNamedNodeGeometry(rawName: string, context: SemanticContext): NamedNodeGeometry | null {
  const scoped = applyNameScope(rawName, context);
  const candidates = scoped === rawName ? [rawName] : [scoped, rawName];
  for (const candidate of candidates) {
    const geometry = readNamedNodeGeometry(context, candidate);
    if (geometry) {
      return geometry;
    }
  }
  return null;
}

function intersectNodeBorder(
  geometry: NamedNodeGeometry,
  fromPoint: Point
): Point | null {
  const dx = fromPoint.x - geometry.center.x;
  const dy = fromPoint.y - geometry.center.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len <= 1e-9) {
    return null;
  }

  if (geometry.anchorPolygon && geometry.anchorPolygon.length >= 3) {
    const border = intersectRayWithPolygon({ x: 0, y: 0 }, { x: dx, y: dy }, geometry.anchorPolygon);
    if (!border) {
      return null;
    }
    return {
      x: geometry.center.x + border.x,
      y: geometry.center.y + border.y
    };
  }

  if (geometry.shape === "circle") {
    const transform = geometry.anchorTransform;
    const localDirection = (() => {
      if (!transform) return { x: dx, y: dy };
      const inverse = inverseMatrix(transform);
      if (!inverse) return { x: dx, y: dy };
      return applyMatrixToVector(inverse, { x: dx, y: dy });
    })();
    const localLen = Math.hypot(localDirection.x, localDirection.y);
    if (!Number.isFinite(localLen) || localLen <= 1e-9) {
      return null;
    }
    const radius = geometry.anchorRadius;
    if (!Number.isFinite(radius) || radius <= 1e-9) {
      return null;
    }
    const scale = radius / localLen;
    const localPoint = {
      x: localDirection.x * scale,
      y: localDirection.y * scale
    };
    if (!transform) {
      return {
        x: geometry.center.x + localPoint.x,
        y: geometry.center.y + localPoint.y
      };
    }
    const mapped = applyMatrixToVector(transform, localPoint);
    return {
      x: geometry.center.x + mapped.x,
      y: geometry.center.y + mapped.y
    };
  }

  if (geometry.shape === "rectangle") {
    const transform = geometry.anchorTransform;
    const localDirection = (() => {
      if (!transform) return { x: dx, y: dy };
      const inverse = inverseMatrix(transform);
      if (!inverse) return { x: dx, y: dy };
      return applyMatrixToVector(inverse, { x: dx, y: dy });
    })();
    const hw = geometry.anchorHalfWidth;
    const hh = geometry.anchorHalfHeight;
    if (!Number.isFinite(hw) || !Number.isFinite(hh) || hw <= 1e-9 || hh <= 1e-9) {
      return null;
    }
    const scale = 1 / Math.max(Math.abs(localDirection.x) / hw, Math.abs(localDirection.y) / hh);
    const localPoint = {
      x: localDirection.x * scale,
      y: localDirection.y * scale
    };
    if (!transform) {
      return {
        x: geometry.center.x + localPoint.x,
        y: geometry.center.y + localPoint.y
      };
    }
    const mapped = applyMatrixToVector(transform, localPoint);
    return {
      x: geometry.center.x + mapped.x,
      y: geometry.center.y + mapped.y
    };
  }

  if (geometry.shape === "ellipse") {
    const transform = geometry.anchorTransform;
    const localDirection = (() => {
      if (!transform) return { x: dx, y: dy };
      const inverse = inverseMatrix(transform);
      if (!inverse) return { x: dx, y: dy };
      return applyMatrixToVector(inverse, { x: dx, y: dy });
    })();
    const rx = geometry.anchorHalfWidth;
    const ry = geometry.anchorHalfHeight;
    if (!Number.isFinite(rx) || !Number.isFinite(ry) || rx <= 1e-9 || ry <= 1e-9) {
      return null;
    }
    const scale = 1 / Math.sqrt((localDirection.x * localDirection.x) / (rx * rx) + (localDirection.y * localDirection.y) / (ry * ry));
    if (!Number.isFinite(scale)) {
      return null;
    }
    const localPoint = {
      x: localDirection.x * scale,
      y: localDirection.y * scale
    };
    if (!transform) {
      return {
        x: geometry.center.x + localPoint.x,
        y: geometry.center.y + localPoint.y
      };
    }
    const mapped = applyMatrixToVector(transform, localPoint);
    return {
      x: geometry.center.x + mapped.x,
      y: geometry.center.y + mapped.y
    };
  }

  return null;
}

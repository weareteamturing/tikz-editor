import { parseCoordinate } from "../../domains/coordinates/parse.js";
import type { CoordinateItem, PathItem } from "../../ast/types.js";
import type { SemanticContext } from "../context.js";
import type { Point } from "../types.js";

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

function resolveNamedNodeGeometry(rawName: string, context: SemanticContext): {
  shape: "rectangle" | "circle" | "ellipse" | "coordinate";
  center: Point;
  anchorHalfWidth: number;
  anchorHalfHeight: number;
  anchorRadius: number;
} | null {
  const scoped = applyNameScope(rawName, context);
  const candidates = scoped === rawName ? [rawName] : [scoped, rawName];
  for (const candidate of candidates) {
    const geometry = context.namedNodeGeometries.get(candidate);
    if (geometry) {
      return geometry;
    }
  }
  return null;
}

function intersectNodeBorder(
  geometry: {
    shape: "rectangle" | "circle" | "ellipse" | "coordinate";
    center: Point;
    anchorHalfWidth: number;
    anchorHalfHeight: number;
    anchorRadius: number;
  },
  fromPoint: Point
): Point | null {
  const dx = fromPoint.x - geometry.center.x;
  const dy = fromPoint.y - geometry.center.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len <= 1e-9) {
    return null;
  }

  if (geometry.shape === "circle") {
    const radius = geometry.anchorRadius;
    if (!Number.isFinite(radius) || radius <= 1e-9) {
      return null;
    }
    const scale = radius / len;
    return {
      x: geometry.center.x + dx * scale,
      y: geometry.center.y + dy * scale
    };
  }

  if (geometry.shape === "rectangle") {
    const hw = geometry.anchorHalfWidth;
    const hh = geometry.anchorHalfHeight;
    if (!Number.isFinite(hw) || !Number.isFinite(hh) || hw <= 1e-9 || hh <= 1e-9) {
      return null;
    }
    const scale = 1 / Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
    return {
      x: geometry.center.x + dx * scale,
      y: geometry.center.y + dy * scale
    };
  }

  if (geometry.shape === "ellipse") {
    const rx = geometry.anchorHalfWidth;
    const ry = geometry.anchorHalfHeight;
    if (!Number.isFinite(rx) || !Number.isFinite(ry) || rx <= 1e-9 || ry <= 1e-9) {
      return null;
    }
    const scale = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
    if (!Number.isFinite(scale)) {
      return null;
    }
    return {
      x: geometry.center.x + dx * scale,
      y: geometry.center.y + dy * scale
    };
  }

  return null;
}

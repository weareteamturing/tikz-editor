import type { OptionListAst } from "../../options/types.js";
import type { Point } from "../types.js";
import { normalizeOptionValue } from "./utils.js";

export type ShapeGeometryParams = {
  diamondAspect: number;
  trapeziumLeftAngle: number;
  trapeziumRightAngle: number;
  shapeBorderRotate: number;
};

const DEFAULT_DIAMOND_ASPECT = 1;
const DEFAULT_TRAPEZIUM_ANGLE = 60;
const DEFAULT_SHAPE_BORDER_ROTATE = 0;
const EPSILON = 1e-9;

export function resolveNodeShapeGeometryParams(options: OptionListAst | undefined): ShapeGeometryParams {
  let diamondAspect = DEFAULT_DIAMOND_ASPECT;
  let trapeziumLeftAngle = DEFAULT_TRAPEZIUM_ANGLE;
  let trapeziumRightAngle = DEFAULT_TRAPEZIUM_ANGLE;
  let shapeBorderRotate = DEFAULT_SHAPE_BORDER_ROTATE;

  if (!options) {
    return {
      diamondAspect,
      trapeziumLeftAngle,
      trapeziumRightAngle,
      shapeBorderRotate
    };
  }

  for (const entry of options.entries) {
    if (entry.kind !== "kv") {
      continue;
    }

    if (entry.key === "aspect" || entry.key === "shape aspect") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        diamondAspect = normalizeAspect(parsed);
      }
      continue;
    }

    if (entry.key === "trapezium angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        const normalized = normalizeAngle(parsed);
        trapeziumLeftAngle = normalized;
        trapeziumRightAngle = normalized;
      }
      continue;
    }

    if (entry.key === "trapezium left angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        trapeziumLeftAngle = normalizeAngle(parsed);
      }
      continue;
    }

    if (entry.key === "trapezium right angle") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        trapeziumRightAngle = normalizeAngle(parsed);
      }
      continue;
    }

    if (entry.key === "shape border rotate") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        shapeBorderRotate = parsed;
      }
    }
  }

  return {
    diamondAspect,
    trapeziumLeftAngle,
    trapeziumRightAngle,
    shapeBorderRotate
  };
}

export function makeDiamondPolygon(halfWidth: number, halfHeight: number, aspect: number): Point[] {
  const safeHalfWidth = Math.max(0, halfWidth);
  const safeHalfHeight = Math.max(0, halfHeight);
  const safeAspect = normalizeAspect(aspect);
  const horizontalRadius = safeHalfWidth + safeAspect * safeHalfHeight;
  const verticalRadius = safeHalfWidth / safeAspect + safeHalfHeight;
  return [
    { x: 0, y: verticalRadius },
    { x: horizontalRadius, y: 0 },
    { x: 0, y: -verticalRadius },
    { x: -horizontalRadius, y: 0 }
  ];
}

export function makeTrapeziumPolygon(
  halfWidth: number,
  halfHeight: number,
  leftAngle: number,
  rightAngle: number,
  rotation: number
): Point[] {
  const safeHalfWidth = Math.max(0, halfWidth);
  const safeHalfHeight = Math.max(0, halfHeight);
  const leftExtension = 2 * safeHalfHeight * cotDegrees(leftAngle);
  const rightExtension = 2 * safeHalfHeight * cotDegrees(rightAngle);

  const polygon = [
    {
      x: -safeHalfWidth - Math.max(leftExtension, 0),
      y: -safeHalfHeight
    },
    {
      x: -safeHalfWidth + Math.min(leftExtension, 0),
      y: safeHalfHeight
    },
    {
      x: safeHalfWidth - Math.min(rightExtension, 0),
      y: safeHalfHeight
    },
    {
      x: safeHalfWidth + Math.max(rightExtension, 0),
      y: -safeHalfHeight
    }
  ];

  if (Math.abs(rotation) <= 1e-6) {
    return polygon;
  }

  return polygon.map((point) => rotatePoint(point, rotation));
}

export function intersectRayWithPolygon(reference: Point, direction: Point, polygon: Point[]): Point | null {
  if (polygon.length < 2) {
    return null;
  }

  const directionLength = Math.hypot(direction.x, direction.y);
  if (!Number.isFinite(directionLength) || directionLength <= EPSILON) {
    return null;
  }

  const maxRadius = polygon.reduce((max, point) => Math.max(max, Math.hypot(point.x, point.y)), 0);
  const referenceRadius = Math.hypot(reference.x, reference.y);
  const rayLength = Math.max(1, maxRadius + referenceRadius + 1) * 4;
  const rayTarget = {
    x: reference.x + (direction.x / directionLength) * rayLength,
    y: reference.y + (direction.y / directionLength) * rayLength
  };

  let best: { point: Point; t: number } | null = null;
  for (let index = 0; index < polygon.length; index += 1) {
    const edgeStart = polygon[index];
    const edgeEnd = polygon[(index + 1) % polygon.length];
    const hit = intersectSegments(reference, rayTarget, edgeStart, edgeEnd);
    if (!hit) {
      continue;
    }
    if (hit.t < -1e-6) {
      continue;
    }
    if (!best || hit.t < best.t) {
      best = hit;
    }
  }

  return best?.point ?? null;
}

export function midpoint(from: Point, to: Point): Point {
  return {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2
  };
}

function parseNumericOption(raw: string): number | null {
  const normalized = normalizeOptionValue(raw).trim();
  if (normalized.length === 0) {
    return null;
  }

  const direct = Number(normalized);
  if (Number.isFinite(direct)) {
    return direct;
  }

  const match = normalized.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(?:\s*deg(?:ree)?s?)?$/i);
  if (!match) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeAspect(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_DIAMOND_ASPECT;
  }
  const magnitude = Math.abs(value);
  if (magnitude <= 1e-4) {
    return DEFAULT_DIAMOND_ASPECT;
  }
  return Math.min(10_000, magnitude);
}

function normalizeAngle(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TRAPEZIUM_ANGLE;
  }
  const normalized = ((value % 360) + 360) % 360;
  return normalized;
}

function cotDegrees(degrees: number): number {
  const radians = (degrees * Math.PI) / 180;
  const sine = Math.sin(radians);
  const cosine = Math.cos(radians);
  if (!Number.isFinite(sine) || Math.abs(sine) <= 1e-6) {
    return cosine >= 0 ? 1e6 : -1e6;
  }
  return cosine / sine;
}

function rotatePoint(point: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine
  };
}

function intersectSegments(
  firstFrom: Point,
  firstTo: Point,
  secondFrom: Point,
  secondTo: Point
): { point: Point; t: number } | null {
  const firstDirection = { x: firstTo.x - firstFrom.x, y: firstTo.y - firstFrom.y };
  const secondDirection = { x: secondTo.x - secondFrom.x, y: secondTo.y - secondFrom.y };
  const denominator = cross(firstDirection, secondDirection);
  if (Math.abs(denominator) <= EPSILON) {
    return null;
  }

  const offset = {
    x: secondFrom.x - firstFrom.x,
    y: secondFrom.y - firstFrom.y
  };
  const firstT = cross(offset, secondDirection) / denominator;
  const secondT = cross(offset, firstDirection) / denominator;
  if (firstT < -1e-6 || firstT > 1 + 1e-6 || secondT < -1e-6 || secondT > 1 + 1e-6) {
    return null;
  }

  const clampedFirstT = Math.max(0, Math.min(1, firstT));
  return {
    point: {
      x: firstFrom.x + clampedFirstT * firstDirection.x,
      y: firstFrom.y + clampedFirstT * firstDirection.y
    },
    t: clampedFirstT
  };
}

function cross(left: Point, right: Point): number {
  return left.x * right.y - left.y * right.x;
}

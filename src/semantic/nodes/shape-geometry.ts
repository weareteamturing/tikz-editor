import { parseLength } from "../coords/parse-length.js";
import type { Point } from "../types.js";
import type { OptionListAst } from "../../options/types.js";
import { normalizeOptionValue } from "./utils.js";

export type ShapeGeometryParams = {
  diamondAspect: number;
  trapeziumLeftAngle: number;
  trapeziumRightAngle: number;
  shapeBorderRotate: number;
  trapeziumStretches: boolean;
  trapeziumStretchesBody: boolean;
  regularPolygonSides: number;
  starPoints: number;
  starPointRatio: number;
  starPointHeightPt: number;
  starUsesPointRatio: boolean;
};

export type TrapeziumSizingInput = {
  naturalHalfWidth: number;
  naturalHalfHeight: number;
  minimumWidth: number;
  minimumHeight: number;
};

export type CircularSizingInput = {
  naturalWidth: number;
  naturalHeight: number;
  minimumWidth: number;
  minimumHeight: number;
};

export type SemicircleGeometry = {
  center: Point;
  radius: number;
  rotation: number;
  apex: Point;
  arcStart: Point;
  arcEnd: Point;
  chordCenter: Point;
  polygon: Point[];
};

const DEFAULT_DIAMOND_ASPECT = 1;
const DEFAULT_TRAPEZIUM_ANGLE = 60;
const DEFAULT_SHAPE_BORDER_ROTATE = 0;
const DEFAULT_REGULAR_POLYGON_SIDES = 5;
const DEFAULT_STAR_POINTS = 5;
const DEFAULT_STAR_RATIO = 1.5;
const DEFAULT_STAR_POINT_HEIGHT_PT = parseLength(".5cm", "pt") ?? 14.2264;
const EPSILON = 1e-9;

export function resolveNodeShapeGeometryParams(options: OptionListAst | undefined): ShapeGeometryParams {
  let diamondAspect = DEFAULT_DIAMOND_ASPECT;
  let trapeziumLeftAngle = DEFAULT_TRAPEZIUM_ANGLE;
  let trapeziumRightAngle = DEFAULT_TRAPEZIUM_ANGLE;
  let shapeBorderRotate = DEFAULT_SHAPE_BORDER_ROTATE;
  let trapeziumStretches = false;
  let trapeziumStretchesBody = false;
  let regularPolygonSides = DEFAULT_REGULAR_POLYGON_SIDES;
  let starPoints = DEFAULT_STAR_POINTS;
  let starPointRatio = DEFAULT_STAR_RATIO;
  let starPointHeightPt = DEFAULT_STAR_POINT_HEIGHT_PT;
  let starUsesPointRatio = true;

  if (!options) {
    return {
      diamondAspect,
      trapeziumLeftAngle,
      trapeziumRightAngle,
      shapeBorderRotate,
      trapeziumStretches,
      trapeziumStretchesBody,
      regularPolygonSides,
      starPoints,
      starPointRatio,
      starPointHeightPt,
      starUsesPointRatio
    };
  }

  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "trapezium stretches") {
        trapeziumStretches = true;
      } else if (entry.key === "trapezium stretches body") {
        trapeziumStretchesBody = true;
      }
      continue;
    }

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

    if (entry.key === "shape border rotate" || entry.key === "regular polygon rotate" || entry.key === "star rotate") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        shapeBorderRotate = parsed;
      }
      continue;
    }

    if (entry.key === "trapezium stretches") {
      const parsed = parseBoolishOption(entry.valueRaw);
      if (parsed != null) {
        trapeziumStretches = parsed;
      }
      continue;
    }

    if (entry.key === "trapezium stretches body") {
      const parsed = parseBoolishOption(entry.valueRaw);
      if (parsed != null) {
        trapeziumStretchesBody = parsed;
      }
      continue;
    }

    if (entry.key === "regular polygon sides") {
      const parsed = parseIntegerOption(entry.valueRaw);
      if (parsed != null) {
        regularPolygonSides = normalizeInteger(parsed, 3, 360, DEFAULT_REGULAR_POLYGON_SIDES);
      }
      continue;
    }

    if (entry.key === "star points") {
      const parsed = parseIntegerOption(entry.valueRaw);
      if (parsed != null) {
        starPoints = normalizeInteger(parsed, 2, 360, DEFAULT_STAR_POINTS);
      }
      continue;
    }

    if (entry.key === "star point ratio") {
      const parsed = parseNumericOption(entry.valueRaw);
      if (parsed != null) {
        starPointRatio = normalizeRatio(parsed);
        starUsesPointRatio = true;
      }
      continue;
    }

    if (entry.key === "star point height") {
      const parsedLength = parseLength(entry.valueRaw, "pt");
      if (parsedLength != null && Number.isFinite(parsedLength)) {
        starPointHeightPt = Math.max(0, parsedLength);
        starUsesPointRatio = false;
      }
    }
  }

  return {
    diamondAspect,
    trapeziumLeftAngle,
    trapeziumRightAngle,
    shapeBorderRotate,
    trapeziumStretches,
    trapeziumStretchesBody,
    regularPolygonSides,
    starPoints,
    starPointRatio,
    starPointHeightPt,
    starUsesPointRatio
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
  sizing: TrapeziumSizingInput,
  leftAngle: number,
  rightAngle: number,
  rotation: number,
  stretches: boolean,
  stretchesBody: boolean
): Point[] {
  const resolved = resolveTrapeziumDimensions(
    sizing.naturalHalfWidth,
    sizing.naturalHalfHeight,
    sizing.minimumWidth,
    sizing.minimumHeight,
    leftAngle,
    rightAngle,
    stretches,
    stretchesBody
  );

  const polygon = [
    {
      x: -resolved.halfWidth - Math.max(resolved.leftExtension, 0),
      y: -resolved.halfHeight
    },
    {
      x: -resolved.halfWidth + Math.min(resolved.leftExtension, 0),
      y: resolved.halfHeight
    },
    {
      x: resolved.halfWidth - Math.min(resolved.rightExtension, 0),
      y: resolved.halfHeight
    },
    {
      x: resolved.halfWidth + Math.max(resolved.rightExtension, 0),
      y: -resolved.halfHeight
    }
  ];

  if (Math.abs(rotation) <= 1e-6) {
    return polygon;
  }

  return polygon.map((point) => rotatePoint(point, rotation));
}

export function makeRegularPolygon(
  sizing: CircularSizingInput,
  sidesRaw: number,
  rotation: number
): Point[] {
  const sides = normalizeInteger(Math.round(sidesRaw), 3, 360, DEFAULT_REGULAR_POLYGON_SIDES);
  const diagonalHalf = Math.hypot(sizing.naturalWidth / 2, sizing.naturalHeight / 2);
  const minRadius = Math.max(sizing.minimumWidth, sizing.minimumHeight) / 2;
  const cosine = Math.cos(Math.PI / sides);
  const circumRadius = cosine <= 1e-6 ? minRadius : Math.max(diagonalHalf / cosine, minRadius);
  const startAngle = regularPolygonStartAngle(sides, rotation);

  const vertices: Point[] = [];
  const step = 360 / sides;
  for (let index = 0; index < sides; index += 1) {
    vertices.push(pointPolar(startAngle + index * step, circumRadius));
  }
  return vertices;
}

export function makeStar(
  sizing: CircularSizingInput,
  pointsRaw: number,
  ratioRaw: number,
  pointHeightPt: number,
  useRatio: boolean,
  rotation: number
): { polygon: Point[]; outer: Point[]; inner: Point[] } {
  const points = normalizeInteger(Math.round(pointsRaw), 2, 360, DEFAULT_STAR_POINTS);
  const safeRatio = normalizeRatio(ratioRaw);
  const innerBase = Math.hypot(sizing.naturalWidth / 2, sizing.naturalHeight / 2);
  const safeHeight = Math.max(0, pointHeightPt);

  let innerRadius = innerBase;
  let outerRadius = useRatio ? innerRadius * safeRatio : innerRadius + safeHeight;

  const minRadius = Math.max(sizing.minimumWidth, sizing.minimumHeight) / 2;
  if (outerRadius < minRadius) {
    outerRadius = minRadius;
    innerRadius = useRatio ? outerRadius / safeRatio : Math.max(0, outerRadius - safeHeight);
  }

  const startAngle = 90 + rotation;
  const step = 180 / points;
  const polygon: Point[] = [];
  const outer: Point[] = [];
  const inner: Point[] = [];

  for (let index = 0; index < points; index += 1) {
    const outerAngle = startAngle + index * 2 * step;
    const innerAngle = outerAngle + step;
    const outerPoint = pointPolar(outerAngle, outerRadius);
    const innerPoint = pointPolar(innerAngle, innerRadius);
    outer.push(outerPoint);
    inner.push(innerPoint);
    polygon.push(outerPoint, innerPoint);
  }

  return { polygon, outer, inner };
}

export function makeSemicircle(
  sizing: CircularSizingInput,
  rotation: number,
  outerSep: number,
  sampleSteps = 48
): SemicircleGeometry {
  const safeNaturalWidth = Math.max(0, sizing.naturalWidth);
  const safeNaturalHeight = Math.max(0, sizing.naturalHeight);
  const safeMinimumWidth = Math.max(0, sizing.minimumWidth);
  const safeMinimumHeight = Math.max(0, sizing.minimumHeight);

  const halfWidth = safeNaturalWidth / 2;
  const halfHeight = safeNaturalHeight / 2;
  const defaultRadius = Math.hypot(halfWidth, 2 * halfHeight);
  const radiusBase = Math.max(defaultRadius, safeMinimumWidth / 2, safeMinimumHeight);
  const adjustment = 0.4 * (radiusBase - defaultRadius);
  const centerY = -(adjustment + halfHeight);

  const safeOuterSep = Math.max(0, outerSep);
  const anchorRadius = radiusBase + safeOuterSep;
  const chordY = centerY - safeOuterSep;

  const centerUnrotated = { x: 0, y: centerY };
  const apexUnrotated = { x: 0, y: centerY + anchorRadius };
  const arcStartUnrotated = { x: anchorRadius, y: chordY };
  const arcEndUnrotated = { x: -anchorRadius, y: chordY };
  const chordCenterUnrotated = { x: 0, y: chordY };

  const polygonUnrotated: Point[] = [];
  const steps = Math.max(8, sampleSteps);
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const angle = t * Math.PI;
    polygonUnrotated.push({
      x: anchorRadius * Math.cos(angle),
      y: centerY + anchorRadius * Math.sin(angle)
    });
  }
  polygonUnrotated.push(arcEndUnrotated, arcStartUnrotated);

  const center = rotatePoint(centerUnrotated, rotation);
  const apex = rotatePoint(apexUnrotated, rotation);
  const arcStart = rotatePoint(arcStartUnrotated, rotation);
  const arcEnd = rotatePoint(arcEndUnrotated, rotation);
  const chordCenter = rotatePoint(chordCenterUnrotated, rotation);
  const polygon = polygonUnrotated.map((point) => rotatePoint(point, rotation));

  return {
    center,
    radius: anchorRadius,
    rotation,
    apex,
    arcStart,
    arcEnd,
    chordCenter,
    polygon
  };
}

export function regularPolygonStartAngle(sidesRaw: number, rotation: number): number {
  const sides = normalizeInteger(Math.round(sidesRaw), 3, 360, DEFAULT_REGULAR_POLYGON_SIDES);
  if (sides % 2 === 1) {
    return 90 + rotation;
  }
  return 90 - 180 / sides + rotation;
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

function parseIntegerOption(raw: string): number | null {
  const numeric = parseNumericOption(raw);
  if (numeric == null) {
    return null;
  }
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.round(numeric);
}

function parseBoolishOption(raw: string): boolean | null {
  const normalized = normalizeOptionValue(raw).toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "1" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "no" || normalized === "0" || normalized === "off") {
    return false;
  }
  return null;
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

function normalizeRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_STAR_RATIO;
  }
  const magnitude = Math.abs(value);
  if (magnitude <= 1e-4) {
    return DEFAULT_STAR_RATIO;
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

function normalizeInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  if (value < min || value > max) {
    return fallback;
  }
  return value;
}

function pointPolar(degrees: number, radius: number): Point {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: radius * Math.cos(radians),
    y: radius * Math.sin(radians)
  };
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

function resolveTrapeziumDimensions(
  naturalHalfWidth: number,
  naturalHalfHeight: number,
  minimumWidth: number,
  minimumHeight: number,
  leftAngle: number,
  rightAngle: number,
  stretches: boolean,
  stretchesBody: boolean
): {
  halfWidth: number;
  halfHeight: number;
  leftExtension: number;
  rightExtension: number;
} {
  let halfWidth = Math.max(0, naturalHalfWidth);
  let halfHeight = Math.max(0, naturalHalfHeight);
  const targetHalfHeight = Math.max(0, minimumHeight / 2);
  const targetWidth = Math.max(0, minimumWidth);
  let leftExtension = 2 * halfHeight * cotDegrees(leftAngle);
  let rightExtension = 2 * halfHeight * cotDegrees(rightAngle);

  if (halfHeight + EPSILON < targetHalfHeight) {
    if (stretches || stretchesBody) {
      halfHeight = targetHalfHeight;
      leftExtension = 2 * halfHeight * cotDegrees(leftAngle);
      rightExtension = 2 * halfHeight * cotDegrees(rightAngle);
    } else {
      const scale = targetHalfHeight / Math.max(halfHeight, EPSILON);
      halfWidth *= scale;
      halfHeight = targetHalfHeight;
      leftExtension *= scale;
      rightExtension *= scale;
    }
  }

  let totalWidth = 2 * halfWidth + Math.abs(leftExtension) + Math.abs(rightExtension);
  if (totalWidth + EPSILON < targetWidth) {
    if (stretchesBody) {
      const remainder = targetWidth - totalWidth;
      halfWidth += remainder / 2;
    } else {
      const scale = targetWidth / Math.max(totalWidth, EPSILON);
      halfWidth *= scale;
      leftExtension *= scale;
      rightExtension *= scale;
      if (!stretches) {
        halfHeight *= scale;
      }
    }
    totalWidth = 2 * halfWidth + Math.abs(leftExtension) + Math.abs(rightExtension);
  }

  if (!Number.isFinite(totalWidth)) {
    return {
      halfWidth: Math.max(0, naturalHalfWidth),
      halfHeight: Math.max(0, naturalHalfHeight),
      leftExtension: 0,
      rightExtension: 0
    };
  }

  return {
    halfWidth: Math.max(0, halfWidth),
    halfHeight: Math.max(0, halfHeight),
    leftExtension: clampFinite(leftExtension),
    rightExtension: clampFinite(rightExtension)
  };
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

function clampFinite(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(-1e6, Math.min(1e6, value));
}

function cross(left: Point, right: Point): number {
  return left.x * right.y - left.y * right.x;
}

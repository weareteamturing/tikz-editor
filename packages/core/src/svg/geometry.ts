import { worldToSvgPoint } from "../coords/svg.js";
import { unsafeBounds, unsafePoint } from "../coords/points.js";
import type { SvgBounds, SvgPoint } from "../coords/points.js";
import type { SvgTransform } from "../coords/transforms.js";
import type { ScenePathCommand } from "../semantic/types.js";
import type { SvgViewBox } from "./types.js";

export function computeSvgPathBounds(commands: ScenePathCommand[], viewBox: Pick<SvgViewBox, "y" | "height">): SvgBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let previous: SvgPoint | null = null;

  const includePoint = (point: SvgPoint) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  };

  for (const command of commands) {
    if (command.kind === "Z") {
      continue;
    }

    if (command.kind === "C") {
      includePoint(worldToSvgPoint(command.c1, viewBox));
      includePoint(worldToSvgPoint(command.c2, viewBox));
    }

    if (command.kind === "A") {
      const to = worldToSvgPoint(command.to, viewBox);
      if (previous) {
        includeSvgArcBounds({
          start: previous,
          end: to,
          rx: command.rx,
          ry: command.ry,
          xAxisRotation: -command.xAxisRotation,
          largeArc: command.largeArc,
          sweep: command.sweep ? 0 : 1,
          includePoint
        });
      } else {
        includePoint(to);
      }
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

  return unsafeBounds<SvgBounds>(minX, minY, maxX, maxY);
}

export function includeSvgArcBounds(args: {
  start: SvgPoint;
  end: SvgPoint;
  rx: number;
  ry: number;
  xAxisRotation: number;
  largeArc: boolean;
  sweep: 0 | 1;
  includePoint: (point: SvgPoint) => void;
}): void {
  const { start, end, xAxisRotation, largeArc, sweep, includePoint } = args;
  let rx = Math.abs(args.rx);
  let ry = Math.abs(args.ry);
  includePoint(start);
  includePoint(end);
  if (!Number.isFinite(rx) || !Number.isFinite(ry) || rx <= 1e-9 || ry <= 1e-9) {
    return;
  }

  const phi = (xAxisRotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx2 = (start.x - end.x) / 2;
  const dy2 = (start.y - end.y) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const numerator = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
  const denominator = rx2 * y1p * y1p + ry2 * x1p * x1p;
  const factor = denominator <= 1e-12 ? 0 : Math.sqrt(Math.max(0, numerator / denominator));
  const sign = largeArc === Boolean(sweep) ? -1 : 1;
  const cxp = sign * factor * ((rx * y1p) / ry);
  const cyp = sign * factor * ((-ry * x1p) / rx);
  const cx = cosPhi * cxp - sinPhi * cyp + (start.x + end.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (start.y + end.y) / 2;

  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  const theta1 = Math.atan2(uy, ux);
  let deltaTheta = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  if (sweep === 0 && deltaTheta > 0) {
    deltaTheta -= Math.PI * 2;
  } else if (sweep === 1 && deltaTheta < 0) {
    deltaTheta += Math.PI * 2;
  }

  const candidates = [
    Math.atan2(-ry * sinPhi, rx * cosPhi),
    Math.atan2(-ry * sinPhi, rx * cosPhi) + Math.PI,
    Math.atan2(ry * cosPhi, rx * sinPhi),
    Math.atan2(ry * cosPhi, rx * sinPhi) + Math.PI
  ];

  for (const angle of candidates) {
    if (!isAngleOnArc(angle, theta1, deltaTheta)) {
      continue;
    }
    const cosT = Math.cos(angle);
    const sinT = Math.sin(angle);
    includePoint(
      unsafePoint<SvgPoint>(
        cx + rx * cosPhi * cosT - ry * sinPhi * sinT,
        cy + rx * sinPhi * cosT + ry * cosPhi * sinT
      )
    );
  }
}

export function computeSvgEllipseBounds(cx: number, cy: number, rx: number, ry: number, rotation: number): SvgBounds {
  const theta = (rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const extentX = Math.sqrt(rx * rx * cos * cos + ry * ry * sin * sin);
  const extentY = Math.sqrt(rx * rx * sin * sin + ry * ry * cos * cos);
  return unsafeBounds<SvgBounds>(cx - extentX, cy - extentY, cx + extentX, cy + extentY);
}

export function transformSvgBounds(bounds: SvgBounds, transform: SvgTransform): SvgBounds {
  const corners: SvgPoint[] = [
    unsafePoint<SvgPoint>(bounds.minX, bounds.minY),
    unsafePoint<SvgPoint>(bounds.maxX, bounds.minY),
    unsafePoint<SvgPoint>(bounds.maxX, bounds.maxY),
    unsafePoint<SvgPoint>(bounds.minX, bounds.maxY)
  ];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of corners) {
    const mapped = unsafePoint<SvgPoint>(
      transform.a * point.x + transform.c * point.y + transform.e,
      transform.b * point.x + transform.d * point.y + transform.f
    );
    minX = Math.min(minX, mapped.x);
    minY = Math.min(minY, mapped.y);
    maxX = Math.max(maxX, mapped.x);
    maxY = Math.max(maxY, mapped.y);
  }
  return unsafeBounds<SvgBounds>(minX, minY, maxX, maxY);
}

function isAngleOnArc(angle: number, startAngle: number, deltaAngle: number): boolean {
  const tau = Math.PI * 2;
  const normalize = (value: number): number => {
    let normalized = value % tau;
    if (normalized < 0) {
      normalized += tau;
    }
    return normalized;
  };

  const epsilon = 1e-9;
  if (deltaAngle >= 0) {
    const distance = normalize(angle - startAngle);
    return distance <= deltaAngle + epsilon;
  }
  const distance = normalize(startAngle - angle);
  return distance <= -deltaAngle + epsilon;
}

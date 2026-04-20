import type { FrameLocalPoint, FrameLocalVector, WorldPoint, WorldVector } from "./points.js";
import { frameLocalPoint, frameLocalVector, worldPoint, worldVector } from "./points.js";
import type { FrameTransform, WorldToFrameTransform } from "./transforms.js";
import { worldToFrameTransform } from "./transforms.js";

export function applyFrameTransform(transform: FrameTransform, point: FrameLocalPoint): WorldPoint {
  return worldPoint(
    transform.a * point.x + transform.c * point.y + transform.e,
    transform.b * point.x + transform.d * point.y + transform.f
  );
}

export function applyFrameVector(transform: Pick<FrameTransform, "a" | "b" | "c" | "d">, vector: FrameLocalVector): WorldVector {
  return worldVector(
    transform.a * vector.x + transform.c * vector.y,
    transform.b * vector.x + transform.d * vector.y
  );
}

export function invertFrameTransform(transform: FrameTransform): WorldToFrameTransform | null {
  const det = transform.a * transform.d - transform.b * transform.c;
  if (!Number.isFinite(det) || Math.abs(det) <= 1e-12) {
    return null;
  }
  return worldToFrameTransform(
    transform.d / det,
    -transform.b / det,
    -transform.c / det,
    transform.a / det,
    (transform.c * transform.f - transform.d * transform.e) / det,
    (transform.b * transform.e - transform.a * transform.f) / det
  );
}

export function worldToFrameLocal(point: WorldPoint, transform: FrameTransform): FrameLocalPoint | null {
  const inverse = invertFrameTransform(transform);
  if (!inverse) {
    return null;
  }
  return applyWorldToFramePoint(inverse, point);
}

export function worldVectorToFrameLocal(vector: WorldVector, transform: FrameTransform): FrameLocalVector | null {
  const inverse = invertFrameTransform(transform);
  if (!inverse) {
    return null;
  }
  return applyWorldToFrameVector(inverse, vector);
}

export function applyWorldToFramePoint(transform: WorldToFrameTransform, point: WorldPoint): FrameLocalPoint {
  return frameLocalPoint(
    transform.a * point.x + transform.c * point.y + transform.e,
    transform.b * point.x + transform.d * point.y + transform.f
  );
}

export function applyWorldToFrameVector(transform: Pick<WorldToFrameTransform, "a" | "b" | "c" | "d">, vector: WorldVector): FrameLocalVector {
  return frameLocalVector(
    transform.a * vector.x + transform.c * vector.y,
    transform.b * vector.x + transform.d * vector.y
  );
}

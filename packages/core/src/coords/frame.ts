import type { FrameLocalPoint, WorldPoint } from "./points.js";
import type { FrameTransform } from "./transforms.js";
import { unsafePoint } from "./points.js";

export function applyFrameTransform(transform: FrameTransform, point: FrameLocalPoint): WorldPoint {
  return unsafePoint<WorldPoint>(
    transform.a * point.x + transform.c * point.y + transform.e,
    transform.b * point.x + transform.d * point.y + transform.f
  );
}

export function applyFrameVector(transform: Pick<FrameTransform, "a" | "b" | "c" | "d">, point: FrameLocalPoint): WorldPoint {
  return unsafePoint<WorldPoint>(
    transform.a * point.x + transform.c * point.y,
    transform.b * point.x + transform.d * point.y
  );
}

export function invertFrameTransform(transform: FrameTransform): FrameTransform | null {
  const det = transform.a * transform.d - transform.b * transform.c;
  if (!Number.isFinite(det) || Math.abs(det) <= 1e-12) {
    return null;
  }
  return {
    a: transform.d / det,
    b: -transform.b / det,
    c: -transform.c / det,
    d: transform.a / det,
    e: (transform.c * transform.f - transform.d * transform.e) / det,
    f: (transform.b * transform.e - transform.a * transform.f) / det
  } as FrameTransform;
}

export function worldToFrameLocal(point: WorldPoint, transform: FrameTransform): FrameLocalPoint | null {
  const inverse = invertFrameTransform(transform);
  if (!inverse) {
    return null;
  }
  return unsafePoint<FrameLocalPoint>(
    inverse.a * point.x + inverse.c * point.y + inverse.e,
    inverse.b * point.x + inverse.d * point.y + inverse.f
  );
}

export function worldVectorToFrameLocal(point: WorldPoint, transform: FrameTransform): FrameLocalPoint | null {
  const inverse = invertFrameTransform(transform);
  if (!inverse) {
    return null;
  }
  return unsafePoint<FrameLocalPoint>(
    inverse.a * point.x + inverse.c * point.y,
    inverse.b * point.x + inverse.d * point.y
  );
}

import type { SvgBounds, SvgPoint, WorldBounds, WorldPoint } from "./points.js";
import type { SvgTransform, WorldTransform } from "./transforms.js";
import { unsafeBounds, unsafePoint } from "./points.js";
import { unsafeTransform } from "./transforms.js";

export type SvgViewBoxLike = Pick<{ y: number; height: number }, "y" | "height">;

export function worldToSvgY(worldY: number, viewBox: SvgViewBoxLike): number {
  return viewBox.y + viewBox.height - (worldY - viewBox.y);
}

export function worldToSvgPoint(point: WorldPoint, viewBox: SvgViewBoxLike): SvgPoint {
  return unsafePoint<SvgPoint>(point.x, worldToSvgY(point.y, viewBox));
}

export function svgToWorldPoint(point: SvgPoint, viewBox: SvgViewBoxLike): WorldPoint {
  return unsafePoint<WorldPoint>(point.x, viewBox.y + viewBox.height - (point.y - viewBox.y));
}

export function worldToSvgBounds(bounds: WorldBounds, viewBox: SvgViewBoxLike): SvgBounds {
  const topLeft = worldToSvgPoint(unsafePoint<WorldPoint>(bounds.minX, bounds.maxY), viewBox);
  const bottomRight = worldToSvgPoint(unsafePoint<WorldPoint>(bounds.maxX, bounds.minY), viewBox);
  return unsafeBounds<SvgBounds>(topLeft.x, topLeft.y, bottomRight.x, bottomRight.y);
}

export function worldToSvgTransform(matrix: WorldTransform, viewBox: SvgViewBoxLike): SvgTransform {
  const k = 2 * viewBox.y + viewBox.height;
  const flip = unsafeTransform<SvgTransform>(1, 0, 0, -1, 0, k);
  return multiplyAffine(multiplyAffine(flip, matrix as unknown as SvgTransform), flip);
}

function multiplyAffine(left: SvgTransform, right: SvgTransform): SvgTransform {
  return unsafeTransform<SvgTransform>(
    left.a * right.a + left.c * right.b,
    left.b * right.a + left.d * right.b,
    left.a * right.c + left.c * right.d,
    left.b * right.c + left.d * right.d,
    left.a * right.e + left.c * right.f + left.e,
    left.b * right.e + left.d * right.f + left.f
  );
}

import type { SvgBounds, SvgPoint, WorldBounds, WorldPoint } from "./points.js";
import { svgBounds, svgPoint, worldPoint } from "./points.js";
import type { SvgTransform, WorldTransform } from "./transforms.js";
import { svgTransform } from "./transforms.js";

export type SvgViewBoxLike = Pick<{ y: number; height: number }, "y" | "height">;

export function worldToSvgY(worldY: number, viewBox: SvgViewBoxLike): number {
  return viewBox.y + viewBox.height - (worldY - viewBox.y);
}

export function worldToSvgPoint(point: WorldPoint, viewBox: SvgViewBoxLike): SvgPoint {
  return svgPoint(point.x, worldToSvgY(point.y, viewBox));
}

export function svgToWorldPoint(point: SvgPoint, viewBox: SvgViewBoxLike): WorldPoint {
  return worldPoint(point.x, viewBox.y + viewBox.height - (point.y - viewBox.y));
}

export function worldToSvgBounds(bounds: WorldBounds, viewBox: SvgViewBoxLike): SvgBounds {
  const topLeft = worldToSvgPoint(worldPoint(bounds.minX, bounds.maxY), viewBox);
  const bottomRight = worldToSvgPoint(worldPoint(bounds.maxX, bounds.minY), viewBox);
  return svgBounds(topLeft.x, topLeft.y, bottomRight.x, bottomRight.y);
}

export function worldToSvgTransform(matrix: WorldTransform, viewBox: SvgViewBoxLike): SvgTransform {
  const k = 2 * viewBox.y + viewBox.height;
  const flip = svgTransform(1, 0, 0, -1, 0, k);
  return multiplyAffine(multiplyAffine(flip, svgTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f)), flip);
}

function multiplyAffine(left: SvgTransform, right: SvgTransform): SvgTransform {
  return svgTransform(
    left.a * right.a + left.c * right.b,
    left.b * right.a + left.d * right.b,
    left.a * right.c + left.c * right.d,
    left.b * right.c + left.d * right.d,
    left.a * right.e + left.c * right.f + left.e,
    left.b * right.e + left.d * right.f + left.f
  );
}

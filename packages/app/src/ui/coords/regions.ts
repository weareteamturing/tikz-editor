import { unsafePoint } from "tikz-editor/coords/index";
import type { HitRegion } from "../canvas-panel/hit-regions";
import { rotatePointAroundCenter } from "../canvas-panel/geometry";
import { applyMatrix, inverseMatrix } from "tikz-editor/semantic/transform";
import type { SvgPoint, TextRectLocalPoint } from "./types";

export function resolveRectHitRegionContentBox(region: Extract<HitRegion, { shape: "rect" }>): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const width = region.contentWidth ?? region.width;
  const height = region.contentHeight ?? region.height;
  return {
    x: region.cx - width / 2,
    y: region.cy - height / 2,
    width,
    height
  };
}

export function svgPointToTextRectLocal(point: SvgPoint, region: Extract<HitRegion, { shape: "rect" }>): TextRectLocalPoint {
  if (region.transform) {
    const inverse = inverseMatrix(region.transform);
    if (inverse) {
      const transformed = applyMatrix(inverse, point);
      return unsafePoint<TextRectLocalPoint>(transformed.x, transformed.y);
    }
  }
  const rotated = rotatePointAroundCenter(point, region.cx, region.cy, region.rotation);
  return unsafePoint<TextRectLocalPoint>(rotated.x, rotated.y);
}

export function isSvgPointInsideRectHitRegionContentBox(
  point: SvgPoint,
  region: Extract<HitRegion, { shape: "rect" }>
): boolean {
  const unrotatedPoint = svgPointToTextRectLocal(point, region);
  const contentBox = resolveRectHitRegionContentBox(region);
  return (
    unrotatedPoint.x >= contentBox.x &&
    unrotatedPoint.x <= contentBox.x + contentBox.width &&
    unrotatedPoint.y >= contentBox.y &&
    unrotatedPoint.y <= contentBox.y + contentBox.height
  );
}

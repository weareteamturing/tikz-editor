import { textareaLocalPoint, viewportBounds } from "tikz-editor/coords/index";
import type { ClientBounds, ClientPoint, SvgBounds, SvgPoint, TextareaLocalPoint, ViewportBounds, ViewportPoint } from "./types";

export function clientPointToTextareaLocal(point: ClientPoint, textareaRect: DOMRect): TextareaLocalPoint {
  return textareaLocalPoint(point.x - textareaRect.left, point.y - textareaRect.top);
}

export function clientBoundsToViewport(bounds: ClientBounds, viewportRect: DOMRect | null): ViewportBounds {
  const left = viewportRect?.left ?? 0;
  const top = viewportRect?.top ?? 0;
  return viewportBounds(
    bounds.minX - left,
    bounds.minY - top,
    bounds.maxX - left,
    bounds.maxY - top
  );
}

export function svgBoundsToViewportBounds(
  bounds: SvgBounds,
  project: (point: SvgPoint) => ViewportPoint
): ViewportBounds {
  const topLeft = project({ x: bounds.minX, y: bounds.minY });
  const bottomRight = project({ x: bounds.maxX, y: bounds.maxY });
  return viewportBounds(topLeft.x, topLeft.y, bottomRight.x, bottomRight.y);
}

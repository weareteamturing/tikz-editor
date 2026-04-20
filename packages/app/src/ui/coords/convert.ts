import type { SvgViewBox } from "tikz-editor/svg/types";
import type { CanvasTransform } from "../../store/types";
import type { ClientPoint, SvgPoint, ViewportPoint, WorldPoint } from "./types";
import {
  clientPoint,
  svgPoint,
  svgToWorldPoint as coreSvgToWorldPoint,
  viewportPoint,
  worldToSvgPoint as coreWorldToSvgPoint
} from "tikz-editor/coords/index";

export function clientToViewport(point: ClientPoint, viewportRect: DOMRect | null): ViewportPoint {
  return viewportPoint(
    point.x - (viewportRect?.left ?? 0),
    point.y - (viewportRect?.top ?? 0)
  );
}

export function viewportToClient(point: ViewportPoint, viewportRect: DOMRect | null): ClientPoint {
  return clientPoint(
    point.x + (viewportRect?.left ?? 0),
    point.y + (viewportRect?.top ?? 0)
  );
}

export function viewportToSvg(point: ViewportPoint, transform: CanvasTransform, viewBox: SvgViewBox): SvgPoint {
  const scale = Math.max(transform.scale, 1e-6);
  return svgPoint(
    viewBox.x + (point.x - transform.translateX) / scale,
    viewBox.y + (point.y - transform.translateY) / scale
  );
}

export function svgToViewport(point: SvgPoint, transform: CanvasTransform, viewBox: SvgViewBox): ViewportPoint {
  return viewportPoint(
    transform.translateX + (point.x - viewBox.x) * transform.scale,
    transform.translateY + (point.y - viewBox.y) * transform.scale
  );
}

export function svgToWorld(point: SvgPoint, viewBox: SvgViewBox): WorldPoint {
  return coreSvgToWorldPoint(point, viewBox);
}

export function worldToSvg(point: WorldPoint, viewBox: SvgViewBox): SvgPoint {
  return coreWorldToSvgPoint(point, viewBox);
}

export function worldToViewport(point: WorldPoint, transform: CanvasTransform, viewBox: SvgViewBox): ViewportPoint {
  return svgToViewport(worldToSvg(point, viewBox), transform, viewBox);
}

export function clientToSvg(
  point: ClientPoint,
  svgElement: SVGSVGElement | null,
  viewportRect: DOMRect | null,
  transform: CanvasTransform,
  viewBox: SvgViewBox
): SvgPoint | null {
  if (svgElement) {
    const ctm = svgElement.getScreenCTM();
    if (ctm) {
      const domPoint = svgElement.createSVGPoint();
      domPoint.x = point.x;
      domPoint.y = point.y;
      const result = domPoint.matrixTransform(ctm.inverse());
      return svgPoint(result.x, result.y);
    }
  }
  return viewportToSvg(clientToViewport(point, viewportRect), transform, viewBox);
}

export function clientToWorld(
  point: ClientPoint,
  svgElement: SVGSVGElement | null,
  viewportRect: DOMRect | null,
  transform: CanvasTransform,
  viewBox: SvgViewBox
): WorldPoint | null {
  const svgPoint = clientToSvg(point, svgElement, viewportRect, transform, viewBox);
  return svgPoint ? svgToWorld(svgPoint, viewBox) : null;
}

import { forwardRef, memo } from "react";
import type { Point } from "./points";

export type RectBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AnchorDot = {
  key: string;
  x: number;
  y: number;
  active?: boolean;
};

export function buildCardinalAnchorDots(center: Point, radius: number): AnchorDot[] {
  return [
    { key: "n", x: center.x, y: center.y - radius },
    { key: "e", x: center.x + radius, y: center.y },
    { key: "s", x: center.x, y: center.y + radius },
    { key: "w", x: center.x - radius, y: center.y }
  ];
}

export function buildRectAnchorDots(bounds: RectBounds): AnchorDot[] {
  const x0 = bounds.x;
  const y0 = bounds.y;
  const x1 = bounds.x + bounds.width;
  const y1 = bounds.y + bounds.height;
  const xm = (x0 + x1) / 2;
  const ym = (y0 + y1) / 2;
  return [
    { key: "c", x: xm, y: ym },
    { key: "nw", x: x0, y: y0 },
    { key: "n", x: xm, y: y0 },
    { key: "ne", x: x1, y: y0 },
    { key: "e", x: x1, y: ym },
    { key: "se", x: x1, y: y1 },
    { key: "s", x: xm, y: y1 },
    { key: "sw", x: x0, y: y1 },
    { key: "w", x: x0, y: ym }
  ];
}

export type AnchorOverlayProps = {
  anchors: AnchorDot[];
  visible?: boolean;
  radius?: number;
  strokeWidth?: number;
};

const ANCHOR_FILL = "rgba(60, 172, 83, 0.72)";
const ANCHOR_STROKE = "rgba(20, 117, 40, 0.92)";
const ACTIVE_FILL = "rgba(53, 194, 79, 0.9)";
const ACTIVE_STROKE = "rgba(16, 102, 34, 1)";

export function applyAnchorOverlayState(
  target: SVGGElement,
  anchors: readonly AnchorDot[],
  visible: boolean,
  activeKey: string | null,
  radius = 2.7
): void {
  target.style.display = visible ? "inline" : "none";
  const circles = target.querySelectorAll<SVGCircleElement>("circle[data-anchor-key]");
  circles.forEach((circle, index) => {
    const anchor = anchors[index];
    if (!anchor) {
      return;
    }
    const active = visible && anchor.key === activeKey;
    circle.setAttribute("r", String(active ? radius * 1.1 : radius * 0.85));
    circle.setAttribute("fill", active ? ACTIVE_FILL : ANCHOR_FILL);
    circle.setAttribute("stroke", active ? ACTIVE_STROKE : ANCHOR_STROKE);
  });
}

export const AnchorOverlay = memo(forwardRef<SVGGElement, AnchorOverlayProps>(function AnchorOverlay({
  anchors,
  visible = true,
  radius = 2.7,
  strokeWidth = 0.34
}: AnchorOverlayProps, ref) {
  if (anchors.length === 0) {
    return null;
  }

  return (
    <g ref={ref} pointerEvents="none" style={{ display: visible ? "inline" : "none" }}>
      {anchors.map((anchor) => {
        const active = anchor.active ?? false;
        return (
          <circle
            key={anchor.key}
            data-anchor-key={anchor.key}
            cx={anchor.x}
            cy={anchor.y}
            r={active ? radius * 1.1 : radius * 0.85}
            fill={active ? ACTIVE_FILL : ANCHOR_FILL}
            stroke={active ? ACTIVE_STROKE : ANCHOR_STROKE}
            strokeWidth={strokeWidth}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </g>
  );
}));

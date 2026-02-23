import type { SceneElement, ScenePathCommand, SceneText } from "tikz-editor/semantic/types";
import type { SvgViewBox } from "tikz-editor/svg/types";

const HIT_STROKE_PX = 10;

export type HitRegion =
  | {
      shape: "path";
      key: string;
      sourceId: string;
      d: string;
      pointerMode: "stroke" | "fill";
      strokeWidth: number;
    }
  | {
      shape: "circle";
      key: string;
      sourceId: string;
      cx: number;
      cy: number;
      r: number;
      pointerMode: "stroke" | "fill";
      strokeWidth: number;
    }
  | {
      shape: "ellipse";
      key: string;
      sourceId: string;
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      rotation: number;
      pointerMode: "stroke" | "fill";
      strokeWidth: number;
    }
  | {
      shape: "rect";
      key: string;
      sourceId: string;
      x: number;
      y: number;
      width: number;
      height: number;
      cx: number;
      cy: number;
      rotation: number;
    };

export function buildHitRegions(elements: SceneElement[], viewBox: SvgViewBox, scale: number): HitRegion[] {
  const regions: HitRegion[] = [];
  const strokeWidth = HIT_STROKE_PX / Math.max(scale, 1e-3);

  for (const element of elements) {
    if (element.kind === "Path") {
      const d = encodePathData(element.commands, viewBox);
      if (!d) continue;
      const filled = hasVisibleFill(element.style.fill);
      regions.push({
        shape: "path",
        key: `hit:${element.id}`,
        sourceId: element.sourceId,
        d,
        pointerMode: filled ? "fill" : "stroke",
        strokeWidth
      });
      continue;
    }

    if (element.kind === "Circle") {
      const center = worldToSvgPoint(element.center, viewBox);
      const filled = hasVisibleFill(element.style.fill);
      regions.push({
        shape: "circle",
        key: `hit:${element.id}`,
        sourceId: element.sourceId,
        cx: center.x,
        cy: center.y,
        r: element.radius,
        pointerMode: filled ? "fill" : "stroke",
        strokeWidth
      });
      continue;
    }

    if (element.kind === "Ellipse") {
      const center = worldToSvgPoint(element.center, viewBox);
      const filled = hasVisibleFill(element.style.fill);
      regions.push({
        shape: "ellipse",
        key: `hit:${element.id}`,
        sourceId: element.sourceId,
        cx: center.x,
        cy: center.y,
        rx: element.rx,
        ry: element.ry,
        rotation: element.rotation ?? 0,
        pointerMode: filled ? "fill" : "stroke",
        strokeWidth
      });
      continue;
    }

    const textGeometry = textGeometryInSvg(element, viewBox);
    regions.push({
      shape: "rect",
      key: `hit:${element.id}`,
      sourceId: element.sourceId,
      x: textGeometry.cx - textGeometry.width / 2,
      y: textGeometry.cy - textGeometry.height / 2,
      width: textGeometry.width,
      height: textGeometry.height,
      cx: textGeometry.cx,
      cy: textGeometry.cy,
      rotation: textGeometry.rotation
    });
  }

  return regions;
}

function hasVisibleFill(fill: string | null): boolean {
  return fill != null && fill !== "none";
}

function textGeometryInSvg(
  element: SceneText,
  viewBox: Pick<SvgViewBox, "y" | "height">
): { cx: number; cy: number; width: number; height: number; rotation: number } {
  const center = worldToSvgPoint(element.position, viewBox);
  const width = element.textBlockWidth ?? estimateTextBlockWidth(element.text, element.style.fontSize);
  const height = element.textBlockHeight ?? Math.max(1, element.text.split("\n").length) * element.style.fontSize * 1.15;

  return {
    cx: center.x,
    cy: center.y,
    width,
    height,
    rotation: element.rotation ?? 0
  };
}

function estimateTextBlockWidth(text: string, fontSize: number): number {
  const lines = text.split("\n");
  const maxChars = lines.reduce((max, line) => Math.max(max, line.length), 0);
  if (maxChars <= 0) {
    return 0;
  }
  return maxChars * fontSize * 0.7;
}

function worldToSvgPoint(point: { x: number; y: number }, viewBox: Pick<SvgViewBox, "y" | "height">): { x: number; y: number } {
  return {
    x: point.x,
    y: worldToSvgY(point.y, viewBox)
  };
}

function worldToSvgY(worldY: number, viewBox: Pick<SvgViewBox, "y" | "height">): number {
  return viewBox.y + viewBox.height - (worldY - viewBox.y);
}

function encodePathData(commands: ScenePathCommand[], viewBox: Pick<SvgViewBox, "y" | "height">): string {
  const chunks: string[] = [];

  for (const command of commands) {
    if (command.kind === "Z") {
      chunks.push("Z");
      continue;
    }

    if (command.kind === "A") {
      const to = worldToSvgPoint(command.to, viewBox);
      const sweep = command.sweep ? 0 : 1;
      chunks.push(
        `A ${fmt(command.rx)} ${fmt(command.ry)} ${fmt(-command.xAxisRotation)} ${command.largeArc ? 1 : 0} ${sweep} ${fmt(to.x)} ${fmt(to.y)}`
      );
      continue;
    }

    if (command.kind === "C") {
      const c1 = worldToSvgPoint(command.c1, viewBox);
      const c2 = worldToSvgPoint(command.c2, viewBox);
      const to = worldToSvgPoint(command.to, viewBox);
      chunks.push(`C ${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(to.x)} ${fmt(to.y)}`);
      continue;
    }

    const to = worldToSvgPoint(command.to, viewBox);
    chunks.push(`${command.kind} ${fmt(to.x)} ${fmt(to.y)}`);
  }

  return chunks.join(" ");
}

function fmt(value: number): string {
  return Number(value.toFixed(4)).toString();
}

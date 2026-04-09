import { applyMatrix } from "tikz-editor/semantic/transform";
import type { Bounds, Matrix2D, Point, SceneElement, ScenePathCommand, SceneText } from "tikz-editor/semantic/types";
import type { SvgViewBox } from "tikz-editor/svg/types";

const HIT_STROKE_PX = 18;
const ADORNMENT_TEXT_HIT_PADDING_PX = 8;

export type HitRegion =
  | {
      shape: "path";
      key: string;
      sourceId: string;
      targetId: string;
      d: string;
      transform?: Matrix2D;
      pointerMode: "stroke" | "fill";
      strokeWidth: number;
    }
  | {
      shape: "circle";
      key: string;
      sourceId: string;
      targetId: string;
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
      targetId: string;
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
      targetId: string;
      x: number;
      y: number;
      width: number;
      height: number;
      cx: number;
      cy: number;
      rotation: number;
      transform?: Matrix2D;
      interactionMode?: "move" | "text";
      pointerMode?: "stroke" | "fill";
      strokeWidth?: number;
      sceneTextKey?: string;
      contentWidth?: number;
      contentHeight?: number;
      matrixEdgeSelection?: {
        kind: "row" | "column";
        matrixSourceId: string;
        selectionIds: string[];
        cursor: "e-resize" | "s-resize";
      };
    };

export type ScopeHitBounds = {
  scopeId: string;
  bounds: Bounds;
};

export function buildHitRegions(
  elements: SceneElement[],
  viewBox: SvgViewBox,
  scale: number,
  scopeHitBounds: readonly ScopeHitBounds[] = []
): HitRegion[] {
  const regions: HitRegion[] = [];
  const strokeWidth = HIT_STROKE_PX / Math.max(scale, 1e-3);
  const sourceHasNonAdornmentNonText = new Set<string>();
  for (const element of elements) {
    if (!element.adornment && element.kind !== "Text") {
      sourceHasNonAdornmentNonText.add(element.sourceRef.sourceId);
    }
  }

  for (const element of elements) {
    const sourceId = element.sourceRef.sourceId;
    if (element.kind === "Path") {
      const d = encodePathData(element.commands, viewBox);
      if (!d) continue;
      const filled = hasVisibleFill(element.style.fill);
      const transform = element.transform ? worldTransformToSvgTransform(element.transform, viewBox) : undefined;
      regions.push({
        shape: "path",
        key: `hit:${element.id}`,
        sourceId,
        targetId: element.adornment?.targetId ?? sourceId,
        d,
        transform,
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
        sourceId,
        targetId: element.adornment?.targetId ?? sourceId,
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
        sourceId,
        targetId: element.adornment?.targetId ?? sourceId,
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
    const sceneTextKey = `hit:${element.id}`;
    const hitPadding = element.adornment ? ADORNMENT_TEXT_HIT_PADDING_PX / Math.max(scale, 1e-3) : 0;
    if (element.adornment && hitPadding > 0) {
      regions.push({
        shape: "rect",
        key: `${sceneTextKey}:halo`,
        sourceId,
        targetId: element.adornment.targetId,
        x: textGeometry.cx - textGeometry.width / 2 - hitPadding,
        y: textGeometry.cy - textGeometry.height / 2 - hitPadding,
        width: textGeometry.width + 2 * hitPadding,
        height: textGeometry.height + 2 * hitPadding,
        cx: textGeometry.cx,
        cy: textGeometry.cy,
        rotation: textGeometry.rotation,
        transform: textGeometry.transform,
        interactionMode: "move",
        sceneTextKey,
        contentWidth: textGeometry.width,
        contentHeight: textGeometry.height
      });
    }
    const hasNodeVisualBounds =
      Number.isFinite(element.nodeVisualWidth) &&
      Number.isFinite(element.nodeVisualHeight) &&
      (element.nodeVisualWidth ?? 0) > 0 &&
      (element.nodeVisualHeight ?? 0) > 0;
    const isTextOnlyNodeSource =
      !element.adornment &&
      !element.matrixCell &&
      !sourceHasNonAdornmentNonText.has(sourceId);
    if (isTextOnlyNodeSource && hasNodeVisualBounds) {
      const nodeWidth = element.nodeVisualWidth!;
      const nodeHeight = element.nodeVisualHeight!;
      const hasExtraNodeArea =
        nodeWidth > textGeometry.width + 1e-6 ||
        nodeHeight > textGeometry.height + 1e-6;
      if (hasExtraNodeArea) {
        regions.push({
          shape: "rect",
          key: `${sceneTextKey}:node-area`,
          sourceId,
          targetId: sourceId,
          x: textGeometry.cx - nodeWidth / 2,
          y: textGeometry.cy - nodeHeight / 2,
          width: nodeWidth,
          height: nodeHeight,
          cx: textGeometry.cx,
          cy: textGeometry.cy,
          rotation: textGeometry.rotation,
          transform: textGeometry.transform,
          interactionMode: "move",
          sceneTextKey,
          contentWidth: textGeometry.width,
          contentHeight: textGeometry.height
        });
      }
    }
    regions.push({
      shape: "rect",
      key: sceneTextKey,
      sourceId,
      targetId: element.adornment?.targetId ?? sourceId,
      x: textGeometry.cx - textGeometry.width / 2,
      y: textGeometry.cy - textGeometry.height / 2,
      width: textGeometry.width,
      height: textGeometry.height,
      cx: textGeometry.cx,
      cy: textGeometry.cy,
      rotation: textGeometry.rotation,
      transform: textGeometry.transform,
      interactionMode: "text",
      pointerMode: "fill",
      sceneTextKey,
      contentWidth: textGeometry.width,
      contentHeight: textGeometry.height
    });
  }

  for (const scope of scopeHitBounds) {
    const topLeft = worldToSvgPoint({ x: scope.bounds.minX, y: scope.bounds.maxY }, viewBox);
    const bottomRight = worldToSvgPoint({ x: scope.bounds.maxX, y: scope.bounds.minY }, viewBox);
    const pad = strokeWidth / 2;
    const width = Math.max(0, bottomRight.x - topLeft.x) + strokeWidth;
    const height = Math.max(0, bottomRight.y - topLeft.y) + strokeWidth;
    regions.push({
      shape: "rect",
      key: `scope-hit:${scope.scopeId}`,
      sourceId: scope.scopeId,
      targetId: scope.scopeId,
      x: topLeft.x - pad,
      y: topLeft.y - pad,
      width,
      height,
      cx: topLeft.x + (bottomRight.x - topLeft.x) / 2,
      cy: topLeft.y + (bottomRight.y - topLeft.y) / 2,
      rotation: 0,
      interactionMode: "move",
      pointerMode: "stroke",
      strokeWidth
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
): { cx: number; cy: number; width: number; height: number; rotation: number; transform?: Matrix2D } {
  const center = worldToSvgPoint(element.position, viewBox);
  const width = element.textBlockWidth ?? estimateTextBlockWidth(element.text, element.style.fontSize);
  const height = element.textBlockHeight ?? Math.max(1, element.text.split("\n").length) * element.style.fontSize * 1.15;
  const x = center.x - width / 2;
  const y = center.y - height / 2;
  const transform = resolveTextRectTransformInSvg(element, { x, y, width, height }, viewBox);

  return {
    cx: center.x,
    cy: center.y,
    width,
    height,
    rotation: 0,
    transform
  };
}

function resolveTextRectTransformInSvg(
  element: SceneText,
  localRect: { x: number; y: number; width: number; height: number },
  viewBox: Pick<SvgViewBox, "y" | "height">
): Matrix2D | undefined {
  const center = element.position;
  const halfWidth = localRect.width / 2;
  const halfHeight = localRect.height / 2;
  const rotation = element.rotation ?? 0;
  const localCornersWorld = {
    topLeft: rotateWorldPointAroundCenter({ x: center.x - halfWidth, y: center.y + halfHeight }, center, rotation),
    topRight: rotateWorldPointAroundCenter({ x: center.x + halfWidth, y: center.y + halfHeight }, center, rotation),
    bottomLeft: rotateWorldPointAroundCenter({ x: center.x - halfWidth, y: center.y - halfHeight }, center, rotation)
  };
  const actualCornersWorld = element.transform
    ? {
        topLeft: applyMatrix(element.transform, localCornersWorld.topLeft),
        topRight: applyMatrix(element.transform, localCornersWorld.topRight),
        bottomLeft: applyMatrix(element.transform, localCornersWorld.bottomLeft)
      }
    : localCornersWorld;
  const actualCornersSvg = {
    topLeft: worldToSvgPoint(actualCornersWorld.topLeft, viewBox),
    topRight: worldToSvgPoint(actualCornersWorld.topRight, viewBox),
    bottomLeft: worldToSvgPoint(actualCornersWorld.bottomLeft, viewBox)
  };

  const transform = rectTransformFromCorners(localRect, actualCornersSvg);
  return isIdentityAffine(transform) ? undefined : transform;
}

function rotateWorldPointAroundCenter(point: Point, center: Point, degrees: number): Point {
  if (Math.abs(degrees) <= 1e-6) {
    return point;
  }
  const theta = (degrees * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos
  };
}

function rectTransformFromCorners(
  localRect: { x: number; y: number; width: number; height: number },
  corners: {
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
  }
): Matrix2D {
  const safeWidth = Math.max(localRect.width, 1e-9);
  const safeHeight = Math.max(localRect.height, 1e-9);
  const a = (corners.topRight.x - corners.topLeft.x) / safeWidth;
  const b = (corners.topRight.y - corners.topLeft.y) / safeWidth;
  const c = (corners.bottomLeft.x - corners.topLeft.x) / safeHeight;
  const d = (corners.bottomLeft.y - corners.topLeft.y) / safeHeight;
  const e = corners.topLeft.x - a * localRect.x - c * localRect.y;
  const f = corners.topLeft.y - b * localRect.x - d * localRect.y;
  return { a, b, c, d, e, f };
}

function isIdentityAffine(matrix: Matrix2D): boolean {
  return (
    Math.abs(matrix.a - 1) <= 1e-6 &&
    Math.abs(matrix.b) <= 1e-6 &&
    Math.abs(matrix.c) <= 1e-6 &&
    Math.abs(matrix.d - 1) <= 1e-6 &&
    Math.abs(matrix.e) <= 1e-6 &&
    Math.abs(matrix.f) <= 1e-6
  );
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

function worldTransformToSvgTransform(
  matrix: Matrix2D,
  viewBox: Pick<SvgViewBox, "y" | "height">
): Matrix2D {
  const k = viewBox.y + viewBox.height + viewBox.y;
  const flip: Matrix2D = { a: 1, b: 0, c: 0, d: -1, e: 0, f: k };
  return multiplyAffine(multiplyAffine(flip, matrix), flip);
}

function multiplyAffine(left: Matrix2D, right: Matrix2D): Matrix2D {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f
  };
}

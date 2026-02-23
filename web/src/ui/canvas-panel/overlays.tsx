import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { EditHandle, Point } from "tikz-editor/semantic/types";
import type { SnapLine } from "tikz-editor/edit/snapping";
import type { SvgViewBox } from "tikz-editor/svg/types";
import type { ToolMode } from "../../store/types";
import type { HitRegion } from "./hit-regions";
import { fmt, worldToSvgPoint } from "./geometry";
import css from "../CanvasPanel.module.css";

const SNAP_GAP_ARROW_MARKER_ID = "snap-gap-arrow-marker";
const TOOL_PREVIEW_NODE_RADIUS_PX = 12;

type ToolPreview =
  | { kind: "cursor"; x: number; y: number }
  | { kind: "node"; x: number; y: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; arrow: boolean }
  | { kind: "rect"; x: number; y: number; width: number; height: number }
  | { kind: "circle"; cx: number; cy: number; r: number };

type HandleDisplay =
  | {
      key: string;
      x: number;
      y: number;
      cursor: string;
      kind: "move-handle";
      handle: EditHandle;
    }
  | {
      key: string;
      x: number;
      y: number;
      cursor: string;
      kind: "move-element";
      elementId: string;
    };

export function SnapOverlay({
  snapLines,
  viewBox,
  snapStrokeWidth,
  snapCrossSize
}: {
  snapLines: readonly SnapLine[];
  viewBox: SvgViewBox;
  snapStrokeWidth: number;
  snapCrossSize: number;
}) {
  if (snapLines.length === 0) {
    return null;
  }

  return (
    <g className={css.snapOverlay}>
      <defs>
        <marker
          id={SNAP_GAP_ARROW_MARKER_ID}
          markerWidth={6}
          markerHeight={6}
          refX={10}
          refY={5}
          orient="auto-start-reverse"
          viewBox="0 0 10 10"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className={css.snapGapArrowHead} />
        </marker>
      </defs>
      {snapLines.map((line, index) => {
        if (line.type === "points") {
          const points = line.points.map((point) => worldToSvgPoint(point, viewBox));
          const first = points[0];
          const last = points[points.length - 1];
          return (
            <g key={`snap-points-${index}`}>
              {first && last && points.length > 1 && (
                <line
                  x1={first.x}
                  y1={first.y}
                  x2={last.x}
                  y2={last.y}
                  className={css.snapLine}
                  strokeWidth={snapStrokeWidth}
                />
              )}
              {points.map((point, pointIndex) => (
                <g key={`snap-point-${index}-${pointIndex}`}>
                  <line
                    x1={point.x - snapCrossSize}
                    y1={point.y - snapCrossSize}
                    x2={point.x + snapCrossSize}
                    y2={point.y + snapCrossSize}
                    className={css.snapLine}
                    strokeWidth={snapStrokeWidth}
                  />
                  <line
                    x1={point.x - snapCrossSize}
                    y1={point.y + snapCrossSize}
                    x2={point.x + snapCrossSize}
                    y2={point.y - snapCrossSize}
                    className={css.snapLine}
                    strokeWidth={snapStrokeWidth}
                  />
                </g>
              ))}
            </g>
          );
        }

        if (line.type === "pointer") {
          const from = worldToSvgPoint(line.from, viewBox);
          const to = worldToSvgPoint(line.to, viewBox);
          return (
            <g key={`snap-pointer-${index}`}>
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                className={css.snapLine}
                strokeWidth={snapStrokeWidth}
              />
              <line
                x1={from.x - snapCrossSize}
                y1={from.y - snapCrossSize}
                x2={from.x + snapCrossSize}
                y2={from.y + snapCrossSize}
                className={css.snapLine}
                strokeWidth={snapStrokeWidth}
              />
              <line
                x1={from.x - snapCrossSize}
                y1={from.y + snapCrossSize}
                x2={from.x + snapCrossSize}
                y2={from.y - snapCrossSize}
                className={css.snapLine}
                strokeWidth={snapStrokeWidth}
              />
            </g>
          );
        }

        return (
          <g key={`snap-gap-${index}`}>
            {line.segments.map((segment, segmentIndex) => {
              const a = worldToSvgPoint(segment[0], viewBox);
              const b = worldToSvgPoint(segment[1], viewBox);
              const isEqualGap = line.gapKind === "equal";
              return (
                <line
                  key={`snap-gap-segment-${index}-${segmentIndex}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className={`${css.snapLine} ${css.snapGapLine}`}
                  strokeWidth={snapStrokeWidth}
                  markerStart={isEqualGap ? `url(#${SNAP_GAP_ARROW_MARKER_ID})` : undefined}
                  markerEnd={isEqualGap ? `url(#${SNAP_GAP_ARROW_MARKER_ID})` : undefined}
                />
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

export function ToolPreviewOverlay({
  toolPreview,
  scale,
  handleStrokeWidth,
  previewArrowPoints
}: {
  toolPreview: ToolPreview | null;
  scale: number;
  handleStrokeWidth: number;
  previewArrowPoints: (x1: number, y1: number, x2: number, y2: number, size: number) => string;
}) {
  if (!toolPreview) {
    return null;
  }

  return (
    <g className={css.toolPreview}>
      {toolPreview.kind === "cursor" && (
        <g>
          <line
            x1={toolPreview.x - TOOL_PREVIEW_NODE_RADIUS_PX / Math.max(scale, 1e-3)}
            y1={toolPreview.y}
            x2={toolPreview.x + TOOL_PREVIEW_NODE_RADIUS_PX / Math.max(scale, 1e-3)}
            y2={toolPreview.y}
            className={css.toolPreviewStroke}
            strokeWidth={handleStrokeWidth}
          />
          <line
            x1={toolPreview.x}
            y1={toolPreview.y - TOOL_PREVIEW_NODE_RADIUS_PX / Math.max(scale, 1e-3)}
            x2={toolPreview.x}
            y2={toolPreview.y + TOOL_PREVIEW_NODE_RADIUS_PX / Math.max(scale, 1e-3)}
            className={css.toolPreviewStroke}
            strokeWidth={handleStrokeWidth}
          />
        </g>
      )}
      {toolPreview.kind === "node" && (
        <g>
          <circle
            cx={toolPreview.x}
            cy={toolPreview.y}
            r={TOOL_PREVIEW_NODE_RADIUS_PX / Math.max(scale, 1e-3)}
            className={css.toolPreviewFill}
            strokeWidth={handleStrokeWidth}
          />
          <line
            x1={toolPreview.x - TOOL_PREVIEW_NODE_RADIUS_PX / Math.max(scale, 1e-3)}
            y1={toolPreview.y}
            x2={toolPreview.x + TOOL_PREVIEW_NODE_RADIUS_PX / Math.max(scale, 1e-3)}
            y2={toolPreview.y}
            className={css.toolPreviewStroke}
            strokeWidth={handleStrokeWidth}
          />
          <line
            x1={toolPreview.x}
            y1={toolPreview.y - TOOL_PREVIEW_NODE_RADIUS_PX / Math.max(scale, 1e-3)}
            x2={toolPreview.x}
            y2={toolPreview.y + TOOL_PREVIEW_NODE_RADIUS_PX / Math.max(scale, 1e-3)}
            className={css.toolPreviewStroke}
            strokeWidth={handleStrokeWidth}
          />
        </g>
      )}
      {toolPreview.kind === "line" && (
        <g>
          <line
            x1={toolPreview.x1}
            y1={toolPreview.y1}
            x2={toolPreview.x2}
            y2={toolPreview.y2}
            className={css.toolPreviewStroke}
            strokeWidth={handleStrokeWidth}
          />
          {toolPreview.arrow && (
            <polygon
              points={previewArrowPoints(
                toolPreview.x1,
                toolPreview.y1,
                toolPreview.x2,
                toolPreview.y2,
                10 / Math.max(scale, 1e-3)
              )}
              className={css.toolPreviewStroke}
            />
          )}
        </g>
      )}
      {toolPreview.kind === "rect" && (
        <rect
          x={toolPreview.x}
          y={toolPreview.y}
          width={toolPreview.width}
          height={toolPreview.height}
          className={css.toolPreviewFill}
          strokeWidth={handleStrokeWidth}
        />
      )}
      {toolPreview.kind === "circle" && (
        <circle
          cx={toolPreview.cx}
          cy={toolPreview.cy}
          r={toolPreview.r}
          className={css.toolPreviewFill}
          strokeWidth={handleStrokeWidth}
        />
      )}
    </g>
  );
}

export function HitRegionLayer({
  hitRegions,
  hoveredElementId,
  toolMode,
  editableTextRegionKeys,
  onElementPointerDown,
  onElementDoubleClick,
  onHoverChange
}: {
  hitRegions: readonly HitRegion[];
  hoveredElementId: string | null;
  toolMode: ToolMode;
  editableTextRegionKeys: ReadonlySet<string>;
  onElementPointerDown: (event: ReactPointerEvent<SVGElement>, sourceId: string, region?: HitRegion) => void;
  onElementDoubleClick: (event: ReactMouseEvent<SVGElement>, sourceId: string, region?: HitRegion) => void;
  onHoverChange: (sourceId: string | null) => void;
}) {
  return (
    <g className={css.hitRegions}>
      {hitRegions.map((region) => {
        const isHovered = hoveredElementId === region.sourceId;
        const cursor = toolMode === "select" ? (editableTextRegionKeys.has(region.key) ? "text" : "move") : undefined;
        const className = [css.hitRegion, isHovered ? css.hitRegionHovered : ""].filter(Boolean).join(" ");

        const onEnter = () => {
          if (toolMode === "select") onHoverChange(region.sourceId);
        };
        const onLeave = () => {
          if (toolMode === "select") onHoverChange(null);
        };

        if (region.shape === "path") {
          return (
            <path
              key={region.key}
              className={className}
              d={region.d}
              fill={region.pointerMode === "fill" ? "transparent" : "none"}
              stroke={region.pointerMode === "stroke" ? "transparent" : "none"}
              strokeWidth={region.pointerMode === "stroke" ? region.strokeWidth : undefined}
              style={cursor ? { cursor } : undefined}
              pointerEvents={toolMode === "select" ? (region.pointerMode === "stroke" ? "stroke" : "fill") : "none"}
              onPointerDown={(event) => onElementPointerDown(event, region.sourceId, region)}
              onDoubleClick={(event) => onElementDoubleClick(event, region.sourceId, region)}
              onPointerEnter={onEnter}
              onPointerLeave={onLeave}
            />
          );
        }

        if (region.shape === "circle") {
          return (
            <circle
              key={region.key}
              className={className}
              cx={region.cx}
              cy={region.cy}
              r={region.r}
              fill={region.pointerMode === "fill" ? "transparent" : "none"}
              stroke={region.pointerMode === "stroke" ? "transparent" : "none"}
              strokeWidth={region.pointerMode === "stroke" ? region.strokeWidth : undefined}
              style={cursor ? { cursor } : undefined}
              pointerEvents={toolMode === "select" ? (region.pointerMode === "stroke" ? "stroke" : "fill") : "none"}
              onPointerDown={(event) => onElementPointerDown(event, region.sourceId, region)}
              onDoubleClick={(event) => onElementDoubleClick(event, region.sourceId, region)}
              onPointerEnter={onEnter}
              onPointerLeave={onLeave}
            />
          );
        }

        if (region.shape === "ellipse") {
          const transform =
            Math.abs(region.rotation) > 1e-6
              ? `rotate(${fmt(-region.rotation)} ${fmt(region.cx)} ${fmt(region.cy)})`
              : undefined;
          return (
            <ellipse
              key={region.key}
              className={className}
              cx={region.cx}
              cy={region.cy}
              rx={region.rx}
              ry={region.ry}
              transform={transform}
              fill={region.pointerMode === "fill" ? "transparent" : "none"}
              stroke={region.pointerMode === "stroke" ? "transparent" : "none"}
              strokeWidth={region.pointerMode === "stroke" ? region.strokeWidth : undefined}
              style={cursor ? { cursor } : undefined}
              pointerEvents={toolMode === "select" ? (region.pointerMode === "stroke" ? "stroke" : "fill") : "none"}
              onPointerDown={(event) => onElementPointerDown(event, region.sourceId, region)}
              onDoubleClick={(event) => onElementDoubleClick(event, region.sourceId, region)}
              onPointerEnter={onEnter}
              onPointerLeave={onLeave}
            />
          );
        }

        return (
          <rect
            key={region.key}
            className={className}
            x={region.x}
            y={region.y}
            width={region.width}
            height={region.height}
            transform={
              Math.abs(region.rotation) > 1e-6
                ? `rotate(${fmt(-region.rotation)} ${fmt(region.cx)} ${fmt(region.cy)})`
                : undefined
            }
            fill="transparent"
            style={cursor ? { cursor } : undefined}
            pointerEvents={toolMode === "select" ? "all" : "none"}
            onPointerDown={(event) => onElementPointerDown(event, region.sourceId, region)}
            onDoubleClick={(event) => onElementDoubleClick(event, region.sourceId, region)}
            onPointerEnter={onEnter}
            onPointerLeave={onLeave}
          />
        );
      })}
    </g>
  );
}

export function SelectionOverlay({
  marqueeBounds,
  selectionStrokeWidth,
  textSelectionVisual
}: {
  marqueeBounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  selectionStrokeWidth: number;
  textSelectionVisual:
    | {
        collapsed: boolean;
        x1: number;
        x2: number;
        yTop: number;
        height: number;
        caretStrokeWidth: number;
        rotation: number;
        cx: number;
        cy: number;
      }
    | null;
}) {
  return (
    <>
      <g className={css.selectionOverlay}>
        {marqueeBounds && (
          <rect
            className={css.marqueeRect}
            x={marqueeBounds.minX}
            y={marqueeBounds.minY}
            width={Math.max(0.001, marqueeBounds.maxX - marqueeBounds.minX)}
            height={Math.max(0.001, marqueeBounds.maxY - marqueeBounds.minY)}
            strokeWidth={selectionStrokeWidth}
          />
        )}
      </g>

      {textSelectionVisual && (
        <g
          className={css.textSelectionOverlay}
          transform={
            Math.abs(textSelectionVisual.rotation) > 1e-6
              ? `rotate(${fmt(-textSelectionVisual.rotation)} ${fmt(textSelectionVisual.cx)} ${fmt(textSelectionVisual.cy)})`
              : undefined
          }
        >
          {textSelectionVisual.collapsed ? (
            <line
              className={css.textCaret}
              x1={textSelectionVisual.x1}
              y1={textSelectionVisual.yTop}
              x2={textSelectionVisual.x1}
              y2={textSelectionVisual.yTop + textSelectionVisual.height}
              strokeWidth={textSelectionVisual.caretStrokeWidth}
            />
          ) : (
            <rect
              className={css.textSelectionRect}
              x={Math.min(textSelectionVisual.x1, textSelectionVisual.x2)}
              y={textSelectionVisual.yTop}
              width={Math.max(1e-3, Math.abs(textSelectionVisual.x2 - textSelectionVisual.x1))}
              height={textSelectionVisual.height}
            />
          )}
        </g>
      )}
    </>
  );
}

export function HandleOverlay({
  handleDisplays,
  handleHalfSize,
  handleStrokeWidth,
  onHandlePointerDown,
  onElementPointerDown
}: {
  handleDisplays: readonly HandleDisplay[];
  handleHalfSize: number;
  handleStrokeWidth: number;
  onHandlePointerDown: (event: ReactPointerEvent<SVGElement>, handle: EditHandle) => void;
  onElementPointerDown: (event: ReactPointerEvent<SVGElement>, sourceId: string, region?: HitRegion) => void;
}) {
  return (
    <g className={css.handleOverlay}>
      {handleDisplays.map((display) => (
        <rect
          key={display.key}
          className={css.handle}
          x={display.x - handleHalfSize}
          y={display.y - handleHalfSize}
          width={handleHalfSize * 2}
          height={handleHalfSize * 2}
          strokeWidth={handleStrokeWidth}
          style={{ cursor: display.cursor }}
          onPointerDown={(event) =>
            display.kind === "move-handle"
              ? onHandlePointerDown(event, display.handle)
              : onElementPointerDown(event, display.elementId)
          }
        />
      ))}
    </g>
  );
}

import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { EditHandle, Point } from "tikz-editor/semantic/types";
import type { ResizeRole } from "tikz-editor/edit/actions";
import type { SnapLine } from "tikz-editor/edit/snapping";
import type { SvgViewBox } from "tikz-editor/svg/types";
import type { ToolMode } from "../../store/types";
import type { HitRegion } from "./hit-regions";
import type { CurveControlLine } from "./curve-controls";
import { fmt, worldToSvgPoint } from "./geometry";
import css from "../CanvasPanel.module.css";

const SNAP_GAP_ARROW_MARKER_ID = "snap-gap-arrow-marker";
const TOOL_PREVIEW_NODE_RADIUS_PX = 12;

type ToolPreview =
  | { kind: "cursor"; x: number; y: number }
  | { kind: "node"; x: number; y: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; arrow: boolean }
  | { kind: "bezier"; x1: number; y1: number; c1x: number; c1y: number; c2x: number; c2y: number; x2: number; y2: number }
  | { kind: "grid"; x: number; y: number; width: number; height: number; verticalLines: number[]; horizontalLines: number[] }
  | { kind: "rect"; x: number; y: number; width: number; height: number }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
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
    }
  | {
      key: string;
      x: number;
      y: number;
      cursor: string;
      kind: "resize-element";
      elementId: string;
      role: ResizeRole;
    };

type SelectionBoxDisplay =
  | {
      key: string;
      sourceId: string;
      kind: "axis-aligned";
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
    }
  | {
      key: string;
      sourceId: string;
      kind: "polygon";
      points: ReadonlyArray<{ x: number; y: number }>;
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
      {toolPreview.kind === "bezier" && (
        <g>
          <line
            x1={toolPreview.x1}
            y1={toolPreview.y1}
            x2={toolPreview.c1x}
            y2={toolPreview.c1y}
            className={css.curveControlLine}
            strokeWidth={handleStrokeWidth}
          />
          <line
            x1={toolPreview.x2}
            y1={toolPreview.y2}
            x2={toolPreview.c2x}
            y2={toolPreview.c2y}
            className={css.curveControlLine}
            strokeWidth={handleStrokeWidth}
          />
          <path
            d={`M ${fmt(toolPreview.x1)},${fmt(toolPreview.y1)} C ${fmt(toolPreview.c1x)},${fmt(toolPreview.c1y)} ${fmt(toolPreview.c2x)},${fmt(toolPreview.c2y)} ${fmt(toolPreview.x2)},${fmt(toolPreview.y2)}`}
            className={css.toolPreviewStroke}
            strokeWidth={handleStrokeWidth}
          />
        </g>
      )}
      {toolPreview.kind === "grid" && (
        <g>
          <rect
            x={toolPreview.x}
            y={toolPreview.y}
            width={toolPreview.width}
            height={toolPreview.height}
            className={css.toolPreviewFill}
            strokeWidth={handleStrokeWidth}
          />
          {toolPreview.verticalLines.map((x, index) => (
            <line
              key={`grid-v-${index}`}
              x1={x}
              y1={toolPreview.y}
              x2={x}
              y2={toolPreview.y + toolPreview.height}
              className={css.toolPreviewStroke}
              strokeWidth={handleStrokeWidth}
            />
          ))}
          {toolPreview.horizontalLines.map((y, index) => (
            <line
              key={`grid-h-${index}`}
              x1={toolPreview.x}
              y1={y}
              x2={toolPreview.x + toolPreview.width}
              y2={y}
              className={css.toolPreviewStroke}
              strokeWidth={handleStrokeWidth}
            />
          ))}
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
      {toolPreview.kind === "ellipse" && (
        <ellipse
          cx={toolPreview.cx}
          cy={toolPreview.cy}
          rx={toolPreview.rx}
          ry={toolPreview.ry}
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

export function CurveControlOverlay({
  lines,
  viewBox,
  strokeWidth
}: {
  lines: readonly CurveControlLine[];
  viewBox: SvgViewBox;
  strokeWidth: number;
}) {
  if (lines.length === 0) {
    return null;
  }

  return (
    <g className={css.curveControlOverlay}>
      {lines.map((line) => {
        const from = worldToSvgPoint(line.from, viewBox);
        const to = worldToSvgPoint(line.to, viewBox);
        return (
          <line
            key={line.key}
            className={css.curveControlLine}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            strokeWidth={strokeWidth}
          />
        );
      })}
    </g>
  );
}

export function HitRegionLayer({
  hitRegions,
  hoveredElementId,
  toolMode,
  editableTextRegionKeys,
  draggableSourceIds,
  onElementPointerDown,
  onElementDoubleClick,
  onHoverChange
}: {
  hitRegions: readonly HitRegion[];
  hoveredElementId: string | null;
  toolMode: ToolMode;
  editableTextRegionKeys: ReadonlySet<string>;
  draggableSourceIds: ReadonlySet<string>;
  onElementPointerDown: (event: ReactPointerEvent<SVGElement>, sourceId: string, region?: HitRegion) => void;
  onElementDoubleClick: (event: ReactMouseEvent<SVGElement>, sourceId: string, region?: HitRegion) => void;
  onHoverChange: (sourceId: string | null) => void;
}) {
  return (
    <g className={css.hitRegions}>
      {hitRegions.map((region) => {
        const isHovered = hoveredElementId === region.sourceId;
        const cursor =
          toolMode === "select"
            ? editableTextRegionKeys.has(region.key)
              ? "text"
              : draggableSourceIds.has(region.sourceId)
                ? "move"
                : undefined
            : undefined;
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
  selectionBoxes,
  selectionStrokeWidth,
  textSelectionVisual
}: {
  marqueeBounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  selectionBoxes: ReadonlyArray<SelectionBoxDisplay>;
  selectionStrokeWidth: number;
  textSelectionVisual:
    | {
        collapsed: boolean;
        caretAnimationKey: string;
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
        {selectionBoxes.map((bounds) =>
          bounds.kind === "polygon" ? (
            <polygon
              key={bounds.key}
              className={css.selectionRect}
              points={bounds.points.map((point) => `${fmt(point.x)},${fmt(point.y)}`).join(" ")}
              strokeWidth={selectionStrokeWidth}
            />
          ) : (
            <rect
              key={bounds.key}
              className={css.selectionRect}
              x={bounds.minX}
              y={bounds.minY}
              width={Math.max(0.001, bounds.maxX - bounds.minX)}
              height={Math.max(0.001, bounds.maxY - bounds.minY)}
              strokeWidth={selectionStrokeWidth}
            />
          )
        )}
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
              key={textSelectionVisual.caretAnimationKey}
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

export function SelectionDragLayer({
  toolMode,
  selectionBoxes,
  dragStrokeWidth,
  draggableSourceIds,
  onElementPointerDown
}: {
  toolMode: ToolMode;
  selectionBoxes: ReadonlyArray<SelectionBoxDisplay>;
  dragStrokeWidth: number;
  draggableSourceIds: ReadonlySet<string>;
  onElementPointerDown: (event: ReactPointerEvent<SVGElement>, sourceId: string, region?: HitRegion) => void;
}) {
  if (toolMode !== "select" || selectionBoxes.length === 0) {
    return null;
  }

  return (
    <g className={css.selectionDragLayer}>
      {selectionBoxes.map((bounds) => {
        if (!draggableSourceIds.has(bounds.sourceId)) {
          return null;
        }
        if (bounds.kind === "polygon") {
          return (
            <polygon
              key={`${bounds.key}:drag`}
              className={css.selectionDragStroke}
              points={bounds.points.map((point) => `${fmt(point.x)},${fmt(point.y)}`).join(" ")}
              strokeWidth={dragStrokeWidth}
              onPointerDown={(event) => onElementPointerDown(event, bounds.sourceId)}
            />
          );
        }

        return (
          <rect
            key={`${bounds.key}:drag`}
            className={css.selectionDragStroke}
            x={bounds.minX}
            y={bounds.minY}
            width={Math.max(0.001, bounds.maxX - bounds.minX)}
            height={Math.max(0.001, bounds.maxY - bounds.minY)}
            strokeWidth={dragStrokeWidth}
            onPointerDown={(event) => onElementPointerDown(event, bounds.sourceId)}
          />
        );
      })}
    </g>
  );
}

export function HandleOverlay({
  handleDisplays,
  handleHalfSize,
  handleStrokeWidth,
  onHandlePointerDown,
  onElementPointerDown,
  onResizeHandlePointerDown
}: {
  handleDisplays: readonly HandleDisplay[];
  handleHalfSize: number;
  handleStrokeWidth: number;
  onHandlePointerDown: (event: ReactPointerEvent<SVGElement>, handle: EditHandle) => void;
  onElementPointerDown: (event: ReactPointerEvent<SVGElement>, sourceId: string, region?: HitRegion) => void;
  onResizeHandlePointerDown: (
    event: ReactPointerEvent<SVGElement>,
    sourceId: string,
    role: ResizeRole,
    cursor: string
  ) => void;
}) {
  return (
    <g className={css.handleOverlay}>
      {handleDisplays.map((display) => {
        const onPointerDown = (event: ReactPointerEvent<SVGElement>) =>
          display.kind === "move-handle"
            ? onHandlePointerDown(event, display.handle)
            : display.kind === "move-element"
              ? onElementPointerDown(event, display.elementId)
              : onResizeHandlePointerDown(event, display.elementId, display.role, display.cursor);

        if (
          display.kind === "move-handle" &&
          (display.handle.kind === "path-control" || display.handle.kind === "path-bend")
        ) {
          return (
            <circle
              key={display.key}
              className={`${css.handle} ${css.handleControl}`}
              cx={display.x}
              cy={display.y}
              r={handleHalfSize}
              strokeWidth={handleStrokeWidth}
              style={{ cursor: display.cursor }}
              onPointerDown={onPointerDown}
            />
          );
        }

        return (
          <rect
            key={display.key}
            className={css.handle}
            x={display.x - handleHalfSize}
            y={display.y - handleHalfSize}
            width={handleHalfSize * 2}
            height={handleHalfSize * 2}
            strokeWidth={handleStrokeWidth}
            style={{ cursor: display.cursor }}
            onPointerDown={onPointerDown}
          />
        );
      })}
    </g>
  );
}

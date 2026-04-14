import type { EditAction } from "tikz-editor/edit/actions";
import type { SnapLine } from "tikz-editor/edit/snapping";
import type { EditHandle, NodeAnchorTarget, Point, SceneElement } from "tikz-editor/semantic/types";
import type { SvgViewBox } from "tikz-editor/svg/index";

import type { ScopeOverlayIndex } from "./scope-overlay";
import type { MatrixCellAnchorHint } from "./endpoint-anchor-snap";
import type { ResizeFrame } from "./resize-frames";
import type { PathToolGestureSegment } from "./path-tool";
import type {
  ApplyActionFeedback,
  Bounds,
  DragState,
  DragTooltipState,
  GridResizeSnapConfig,
  NodeAnchorOverlayState,
  PendingAddedSelection,
  PendingBezier,
  SnapDebugLogInput
} from "./types";

export type UseCanvasDragControllerParams = {
  applyActionWithFeedback: (action: EditAction, mergeKey?: string) => ApplyActionFeedback;
  dispatch: (action: any) => void;
  dispatchCanvasTransform: (transform: { translateX: number; translateY: number; scale: number }) => void;
  logSnapDebug: (input: SnapDebugLogInput) => void;
  queueSelectionForAddedElement: (preferredWorld: Point, preferredSourceId?: string) => void;
  snapshotSource: string;
  snapshotScene: { elements: SceneElement[] } | null;
  snapshotEditHandles: EditHandle[];
  nodeAnchorTargets: readonly NodeAnchorTarget[];
  matrixCellAnchorHints: readonly MatrixCellAnchorHint[];
  source: string;
  svgResult: { viewBox: SvgViewBox } | null;
  dragRef: { current: DragState | null };
  suppressNextBackgroundClickRef: { current: boolean };
  svgResultRef: { current: { viewBox: SvgViewBox } | null };
  interactionSvgRef: { current: SVGSVGElement | null };
  liveResizeFramesRef: { current: ReadonlyMap<string, ResizeFrame | null> };
  selectedElementIdsRef: { current: ReadonlySet<string> };
  sourceBoundsSvgRef: { current: ReadonlyMap<string, Bounds> };
  scopeOverlay: ScopeOverlayIndex;
  pendingAddedSelectionRef: { current: PendingAddedSelection | null };
  setDragState: (drag: DragState | null) => void;
  setSnapLines: (lines: SnapLine[]) => void;
  setToolDraft: (draft: Extract<DragState, { kind: "tool-create" }> | null) => void;
  setBezierBendDraft: (draft: Extract<DragState, { kind: "tool-bezier-bend" }> | null) => void;
  setPathSegmentDraft: (draft: Extract<DragState, { kind: "tool-path-segment" }> | null) => void;
  commitPathToolSegment: (segment: PathToolGestureSegment) => void;
  appendFreehandSamplePoint: (point: Point) => Point[] | null;
  finalizeFreehandDraft: (overridePoints?: Point[]) => void;
  setPendingBezier: (pending: PendingBezier | null) => void;
  setToolCursorWorld: (point: Point | null) => void;
  setMarqueeDraft: (draft: Extract<DragState, { kind: "marquee" }> | null) => void;
  setNodeAnchorOverlay: (overlay: NodeAnchorOverlayState | null) => void;
  setDragTooltip: (tooltip: DragTooltipState | null) => void;
  setWarning: (warning: string | null) => void;
  setPathAttachedNodePreview: (preview: { sourceId: string; dx: number; dy: number } | null) => void;
  selectedAddShape: string;
  creationStrokeColor: string;
  creationFillColor: string;
  onSnapFeedback?: () => void;
};

export type CanvasGridResizeSnapConfig = GridResizeSnapConfig;

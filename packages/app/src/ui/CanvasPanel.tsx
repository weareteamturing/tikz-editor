import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import type { AppMenuCommandId } from "../app-menu";
import type { CanvasContextMenuTarget } from "../context-menu";
import { collectGeometryInvalidation } from "tikz-editor/semantic/index";
import {
  ADORNMENT_EDIT_NOOP_REASON,
  applyEditAction,
  type EditAction,
  type ResizeRole
} from "tikz-editor/edit/actions";
import { createMathJaxNodeTextEngine } from "tikz-editor/text/mathjax-engine";
import {
  buildSnapContext,
  collectSelectionGeometry,
  snapKeyboardNudge,
  snapToolPointer,
  type SnapLine
} from "tikz-editor/edit/snapping";
import type { NodeTextEngine } from "tikz-editor/text/types";
import type { Statement } from "tikz-editor/ast/types";
import { PT_PER_CM } from "tikz-editor/edit/format";
import { resolvePropertyTarget } from "tikz-editor/edit/property-target";
import {
  finalizePrefixWidthTable,
  findNearestPrefixIndexFromTable,
  readPrefixUnitsFromTable,
  seedPrefixWidthTable,
  stabilizePrefixForMeasurement
} from "tikz-editor/text/prefix-width";
import type {
  EditHandle,
  NodeAnchorTarget,
  Point,
  SceneElement,
  ScenePath,
  SceneText
} from "tikz-editor/semantic/types";
import { renderTikzToSvg } from "tikz-editor/render/index";
import { type SvgDiffHints, type SvgViewBox } from "tikz-editor/svg/index";
import { useEditorStore } from "../store/store";
import type { CanvasDragKind } from "../store/types";
import {
  requestSourceSelection,
  SOURCE_SELECTION_CHANGED_EVENT,
  type SourceSelectionChangeDetail
} from "./source-sync";
import { buildHitRegions, type HitRegion } from "./canvas-panel/hit-regions";
import { computeDragCapability } from "./canvas-panel/drag-capability";
import { deriveCurveControlLines } from "./canvas-panel/curve-controls";
import { resolveEndpointAnchorSnap } from "./canvas-panel/endpoint-anchor-snap";
import {
  boundsFromPoints,
  collectSourceIdsInBounds,
  pickClosestSourceId,
  resolveBezierControlsFromBend,
  resolveToolCreateCurrentWorld
} from "./canvas-panel/interaction-helpers";
import { CanvasSVGLayer } from "./canvas-panel/CanvasSVGLayer";
import { useCanvasDragController } from "./canvas-panel/useCanvasDragController";
import type {
  ApplyActionFeedback,
  Bounds,
  DragState,
  DragTooltipState,
  EditableTextTarget,
  FreehandToolDraft,
  NodeAnchorOverlayState,
  PendingAddedSelection,
  PendingBezier,
  PathToolDraft,
  SelectionBounds,
  SnapDebugLogInput,
  TextEditingSession,
  TextIndexMappingTarget,
  TextSelectionOverlay
} from "./canvas-panel/types";
import {
  buildValueSequence,
  buildTicks,
  clamp,
  clientToSvgPoint,
  clientToWorldPoint,
  computeVisibleRanges,
  distanceSquared,
  fmt,
  isMultipleOfStep,
  resizeCursorForVector,
  resolveOverlayGridSteps,
  rotatePointAroundCenter,
  toViewportXFromWorld,
  toViewportYFromWorld,
  vectorLengthSquared,
  viewportToSvgPoint,
  viewportToWorldPoint,
  worldToSvgPoint,
  worldToSvgY,
  type RulerTick,
  type VisibleRanges
} from "./canvas-panel/geometry";
import {
  clampSnapDebugOverlayRect,
  summarizeSnapContextForDebug,
  summarizeSnapLinesForDebug,
  toDebugPoint,
  type SnapDebugContextSummary,
  type SnapDebugLineSummary,
  type SnapDebugOverlayRect,
  type SnapDebugPoint
} from "./canvas-panel/snap-debug";
import {
  CurveControlOverlay,
  HandleOverlay,
  HitRegionLayer,
  NodeAnchorOverlay,
  SelectionDragLayer,
  SelectionOverlay,
  SnapOverlay,
  ToolPreviewOverlay
} from "./canvas-panel/overlays";
import { resolveCanvasContextMenuTarget } from "./canvas-panel/context-menu-target";
import { resolveNodeAdornmentContextAction } from "./canvas-panel/node-adornment-context-action";
import {
  appendPathToolSegmentFromGesture,
  createPathToolDraft,
  generatePathToolSource,
  pathToolCanClose,
  pathToolCloseRadiusWorld,
  pathToolCurrentPoint,
  pathToolHasDrawableSegments,
  pathToolShouldClose,
  type PathToolGestureSegment
} from "./canvas-panel/path-tool";
import {
  appendFreehandToolPoint,
  createFreehandToolDraft,
  generateFreehandToolSource,
  resolveFreehandPreviewSegments
} from "./canvas-panel/freehand-tool";
import {
  RESIZE_FRAME_CORNER_ROLES,
  resolveResizeFrameForSource
} from "./canvas-panel/resize-frames";
import { angleDeg, resolveRotateHandlePosition } from "./canvas-panel/rotate-handle";
import {
  isToolCreateMode,
  type ToolCreateMode
} from "./tool-config";
import { CanvasContextMenu } from "./CanvasContextMenu";
import { useEditorCommandRuntime } from "./editor-command-runtime";
import {
  copySelectionToClipboardData,
  cutSelectionToClipboardData,
  pasteSelectionFromClipboardData,
  pasteSnippetsWithOffset
} from "./editor-commands";
import {
  buildScopeWrappedSnippet,
  convertSvgToScopeSnippet,
  dataTransferHasFilePayload,
  findSvgFileInDataTransfer
} from "./svg-import";
import {
  addGuide,
  buildAnchoredGridPreviewLines,
  canvasDragKindFromDragState,
  caretStrokeWidthInSvg,
  collectMatrixStatementSourceIds,
  collectNewSourceIds,
  collectSelectionBounds,
  collectSourceBounds,
  dragCursorForState,
  ellipseAspectRatioForSource,
  findWordRangeAtIndex,
  getHandleCursor,
  isPointInsideRect,
  isPointInsideRectHitRegionContentBox,
  makeMergeKey,
  moveGuide,
  preferredNodeBoundsForSource,
  previewArrowPoints,
  rectHitRegionsForTargetId,
  resolveAdornmentOwnerBoundaryPoint,
  resolveBoundsEdgePointToward,
  resolveRectHitRegionContentBox,
  removeGuide,
  removeGuideValue,
  findPathStatementById,
  resolveRotateDegreesFromOptions,
  resolveEditableTextTargetForSelectionOffsets,
  resolveFallbackTextSourceSpanForSourceId,
  resolveGridResizeSnapForHandleDrag,
  resolveScenePathShapeHint,
  resizeCursorForRole,
  selectNudgeAnchorHandle,
  selectionAnchorRatioFromPoint,
  sourceHasSingleResizablePathShape,
  upsertGuideValue
} from "./canvas-panel/panel-helpers";
import { useSettingsStore } from "../settings/useSettingsStore";
import { GRID_SIZE_MINOR_TARGET_PX } from "../settings/types";
import { RenderedTooltip } from "./RenderedTooltip";
import css from "./CanvasPanel.module.css";

type DiagnosticRow = {
  severity: "error" | "warning";
  message: string;
  code?: string;
  source: "parse" | "semantic";
};


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
      rotationDeg: number;
    }
  | {
      key: string;
      x: number;
      y: number;
      anchorX: number;
      anchorY: number;
      centerWorld: Point;
      cursor: string;
      kind: "rotate-element";
      elementId: string;
    };

type GridLines = {
  verticalMinor: number[];
  verticalMajor: number[];
  horizontalMinor: number[];
  horizontalMajor: number[];
  yMin: number;
  yMax: number;
};

type ToolPreview =
  | { kind: "cursor"; x: number; y: number }
  | { kind: "node"; x: number; y: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; arrow: boolean }
  | { kind: "bezier"; x1: number; y1: number; c1x: number; c1y: number; c2x: number; c2y: number; x2: number; y2: number }
  | {
      kind: "complex-path";
      startX: number;
      startY: number;
      closeCandidate: boolean;
      canClose: boolean;
      segments: Array<
        | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
        | { kind: "bezier"; x1: number; y1: number; c1x: number; c1y: number; c2x: number; c2y: number; x2: number; y2: number }
      >;
    }
  | {
      kind: "freehand";
      segments: Array<
        | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
        | { kind: "bezier"; x1: number; y1: number; c1x: number; c1y: number; c2x: number; c2y: number; x2: number; y2: number }
      >;
    }
  | { kind: "grid"; x: number; y: number; width: number; height: number; verticalLines: number[]; horizontalLines: number[] }
  | { kind: "rect"; x: number; y: number; width: number; height: number }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "circle"; cx: number; cy: number; r: number };

type GuideOrientation = "vertical" | "horizontal";

type GuidesState = {
  vertical: number[];
  horizontal: number[];
};

type GuidePreview = {
  orientation: GuideOrientation;
  value: number;
  hideValue?: number;
  visible?: boolean;
};

type GuideDragState = {
  pointerId: number;
  orientation: GuideOrientation;
  source: "ruler" | "guide";
  sourceValue?: number;
  value: number;
  overViewport: boolean;
  overDeleteZone: boolean;
};

type CanvasContextMenuState = {
  target: CanvasContextMenuTarget;
  anchorX: number;
  anchorY: number;
  clickedTargetId: string | null;
  clickedWorld: Point | null;
};

type SnapDebugOverlayState = {
  atIso: string;
  phase: string;
  note: string | null;
  snapshotMatchesSource: boolean;
  dragKind: DragState["kind"] | null;
  rawPoint: SnapDebugPoint | null;
  rawDelta: SnapDebugPoint | null;
  snappedPoint: SnapDebugPoint | null;
  snappedDelta: SnapDebugPoint | null;
  offset: SnapDebugPoint | null;
  context: SnapDebugContextSummary | null;
  lineCount: number;
  lineSummary: SnapDebugLineSummary[];
};

type SnapDebugOverlayDragState =
  | {
      kind: "move";
      startClientX: number;
      startClientY: number;
      startLeft: number;
      startTop: number;
    }
  | {
      kind: "resize";
      startClientX: number;
      startClientY: number;
      startWidth: number;
      startHeight: number;
    };

type RulerAlignmentOffsets = {
  topX: number;
  leftY: number;
};

const RULER_SIZE = 24;
const FIT_PADDING = 44;
const MIN_SCALE = 0.05;
const MAX_SCALE = 20;
const NUDGE_STEP_PT = 0.05 * PT_PER_CM;
const NUDGE_STEP_SHIFT_PT = 0.25 * PT_PER_CM;
const ROTATE_HANDLE_OFFSET_PX = 24;
const TOOL_PREVIEW_CIRCLE_RADIUS_PT = 0.8 * PT_PER_CM;
const TOOL_PREVIEW_GRID_STEP_PT = PT_PER_CM;
const TOOL_PREVIEW_GRID_MAX_LINES = 120;
const LEFT_RULER_DRAG_SOURCE_WIDTH_PX = 12;
const PREFIX_MEASURE_TEXT_MAX_LENGTH = 240;
const PREFIX_MEASURE_CACHE_LIMIT = 64;
const RESIZE_NOOP_REASON = "Resize would not change node constraints.";
const CANVAS_DRAG_CURSOR_LOCK_CLASS = "is-dragging-canvas-cursor-lock";
const IMPORTED_SVG_TARGET_RATIO = 0.3;
const IMPORTED_SVG_MIN_SCALE = 0.2;
const IMPORTED_SVG_MAX_SCALE = 3;

function mergeBoundsList(boundsList: readonly Bounds[]): Bounds | null {
  if (boundsList.length === 0) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const bounds of boundsList) {
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  return { minX, minY, maxX, maxY };
}

function boundsMaxDimension(bounds: Bounds): number {
  return Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
}

function formatScopeScale(scale: number): number {
  return Number(scale.toFixed(3));
}

function computeAutoScaleForImportedTikz(
  importedTikzSource: string,
  currentScene: { elements: SceneElement[] } | null,
  currentViewBox: SvgViewBox | null
): number | null {
  if (!currentScene || !currentViewBox || currentScene.elements.length === 0) {
    return null;
  }

  const currentBounds = mergeBoundsList([...collectSourceBounds(currentScene.elements, currentViewBox).values()]);
  if (!currentBounds) {
    return null;
  }
  const currentDimension = boundsMaxDimension(currentBounds);
  if (!Number.isFinite(currentDimension) || currentDimension <= 1e-6) {
    return null;
  }

  let importedRendered: ReturnType<typeof renderTikzToSvg>;
  try {
    importedRendered = renderTikzToSvg(importedTikzSource);
  } catch {
    return null;
  }

  const importedBounds = mergeBoundsList(
    [...collectSourceBounds(importedRendered.semantic.scene.elements, importedRendered.svg.viewBox).values()]
  );
  if (!importedBounds) {
    return null;
  }
  const importedDimension = boundsMaxDimension(importedBounds);
  if (!Number.isFinite(importedDimension) || importedDimension <= 1e-6) {
    return null;
  }

  const targetDimension = currentDimension * IMPORTED_SVG_TARGET_RATIO;
  const rawScale = targetDimension / importedDimension;
  const clampedScale = clamp(rawScale, IMPORTED_SVG_MIN_SCALE, IMPORTED_SVG_MAX_SCALE);
  if (!Number.isFinite(clampedScale) || Math.abs(clampedScale - 1) < 0.05) {
    return null;
  }
  return formatScopeScale(clampedScale);
}

export function CanvasPanel() {
  const assistantLockReason = useEditorStore((s) => s.documents[s.activeDocumentId]?.assistantLockReason ?? null);
  const source = useEditorStore((s) => s.source);
  const snapshot = useEditorStore((s) => s.snapshot);
  const toolMode = useEditorStore((s) => s.toolMode);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const hoveredElementId = useEditorStore((s) => s.hoveredElementId);
  const activeCanvasDragKind = useEditorStore((s) => s.activeCanvasDragKind);
  const activeSourceScrubSourceId = useEditorStore((s) => s.activeSourceScrubSourceId);
  const lastEditChangedSourceIds = useEditorStore((s) => s.lastEditChangedSourceIds);
  const lastEditChangeToken = useEditorStore((s) => s.lastEditChangeToken);
  const canvasTransform = useEditorStore((s) => s.canvasTransform);
  const fitToContentRequestToken = useEditorStore((s) => s.fitToContentRequestToken);
  const showGrid = useEditorStore((s) => s.showGrid);
  const snapToGrid = useEditorStore((s) => s.snapToGrid);
  const gridSize = useSettingsStore((s) => s.settings.canvas.gridSize);
  const handleSizePx = useSettingsStore((s) => s.settings.canvas.handleSizePx);
  const zoomSpeed = useSettingsStore((s) => s.settings.canvas.zoomSpeed);
  const gridMinorTargetPx = GRID_SIZE_MINOR_TARGET_PX[gridSize];
  const showRulers = useEditorStore((s) => s.showRulers);
  const showGuides = useEditorStore((s) => s.showGuides);
  const showDevPanel = useEditorStore((s) => s.showDevPanel);
  const dispatch = useEditorStore((s) => s.dispatch);

  const svgResult = snapshot.svg;
  const parseDiags = snapshot.parseResult?.diagnostics;
  const semanticDiags = snapshot.semanticResult?.diagnostics;

  const [warning, setWarning] = useState<string | null>(null);
  const [dragTooltip, setDragTooltip] = useState<DragTooltipState | null>(null);
  const [dragCursorLock, setDragCursorLock] = useState<string | null>(null);
  const [snapLines, setSnapLines] = useState<SnapLine[]>([]);
  const [snapDebug, setSnapDebug] = useState<SnapDebugOverlayState | null>(null);
  const [snapDebugRect, setSnapDebugRect] = useState<SnapDebugOverlayRect>({
    left: 10,
    top: 10,
    width: 460,
    height: 220
  });
  const [guides, setGuides] = useState<GuidesState>({ vertical: [], horizontal: [] });
  const [guidePreview, setGuidePreview] = useState<GuidePreview | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [rulerAlignmentOffsets, setRulerAlignmentOffsets] = useState<RulerAlignmentOffsets>({ topX: 0, leftY: 0 });
  const [toolCursorWorld, setToolCursorWorld] = useState<Point | null>(null);
  const [pathDraft, setPathDraft] = useState<PathToolDraft | null>(null);
  const [freehandDraft, setFreehandDraft] = useState<FreehandToolDraft | null>(null);
  const [pathSegmentDraft, setPathSegmentDraft] = useState<Extract<DragState, { kind: "tool-path-segment" }> | null>(null);
  const [toolDraft, setToolDraft] = useState<Extract<DragState, { kind: "tool-create" }> | null>(null);
  const [bezierBendDraft, setBezierBendDraft] = useState<Extract<DragState, { kind: "tool-bezier-bend" }> | null>(null);
  const [pendingBezier, setPendingBezier] = useState<PendingBezier | null>(null);
  const [marqueeDraft, setMarqueeDraft] = useState<Extract<DragState, { kind: "marquee" }> | null>(null);
  const [nodeAnchorOverlay, setNodeAnchorOverlay] = useState<NodeAnchorOverlayState | null>(null);
  const [textSelectionOverlay, setTextSelectionOverlay] = useState<TextSelectionOverlay | null>(null);
  const [textEditingSession, setTextEditingSession] = useState<TextEditingSession | null>(null);
  const [pendingAdornmentTextEditTargetId, setPendingAdornmentTextEditTargetId] = useState<string | null>(null);
  const [dragPatchMode, setDragPatchMode] = useState<"partial" | "full">("partial");
  const [dragAffectedSourceIds, setDragAffectedSourceIds] = useState<string[] | null>(null);
  const [contextMenuState, setContextMenuState] = useState<CanvasContextMenuState | null>(null);
  const [fitToContentModeActive, setFitToContentModeActive] = useState(true);

  const commandRuntime = useEditorCommandRuntime({
    onAddNodeAdornment: (kind) => {
      const result = resolveNodeAdornmentContextAction({
        source,
        clickedTargetId: contextMenuState?.clickedTargetId ?? null,
        selectedTargetId: selectedElementIds.size === 1 ? [...selectedElementIds][0] ?? null : null,
        clickedWorld: contextMenuState?.clickedWorld ?? null,
        sceneElements: snapshot.scene?.elements ?? [],
        viewBox: svgResult?.viewBox ?? null,
        adornmentKind: kind,
        text: kind === "pin" ? "Pin" : "Label"
      });
      if (result.kind !== "ready") {
        return;
      }
      dispatch({
        type: "APPLY_EDIT_ACTION",
        action: result.action
      });
      setPendingAdornmentTextEditTargetId(result.pendingTextTargetId);
    }
  });

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const topRulerRef = useRef<SVGSVGElement | null>(null);
  const leftRulerRef = useRef<SVGSVGElement | null>(null);
  const interactionSvgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pathDraftRef = useRef<PathToolDraft | null>(null);
  const freehandDraftRef = useRef<FreehandToolDraft | null>(null);
  const pendingAddedSelectionRef = useRef<PendingAddedSelection | null>(null);
  const canvasTransformRef = useRef(canvasTransform);
  const selectedElementIdsRef = useRef(selectedElementIds);
  const svgResultRef = useRef(svgResult);
  const fitToContentModeActiveRef = useRef(fitToContentModeActive);
  const sourceBoundsRef = useRef(new Map<string, Bounds>());
  const liveResizeFramesRef = useRef(new Map<string, ReturnType<typeof resolveResizeFrameForSource>>());
  const previousViewBoxRef = useRef<SvgViewBox | null>(null);
  const guideDragRef = useRef<GuideDragState | null>(null);
  const snapDebugDragRef = useRef<SnapDebugOverlayDragState | null>(null);
  const textEngineRef = useRef<NodeTextEngine | null>(null);
  const prefixTableCacheRef = useRef(new Map<string, readonly number[]>());

  const setActiveCanvasDragKind = useCallback(
    (kind: CanvasDragKind | null) => {
      dispatch({ type: "SET_ACTIVE_CANVAS_DRAG", kind });
    },
    [dispatch]
  );

  const setDragState = useCallback(
    (next: DragState | null) => {
      dragRef.current = next;
      if (!next) {
        setNodeAnchorOverlay(null);
        setDragTooltip(null);
      }
      setDragCursorLock(dragCursorForState(next));
      setActiveCanvasDragKind(canvasDragKindFromDragState(next));
    },
    [setActiveCanvasDragKind]
  );

  useEffect(() => {
    pathDraftRef.current = pathDraft;
  }, [pathDraft]);

  useEffect(() => {
    freehandDraftRef.current = freehandDraft;
  }, [freehandDraft]);

  const logSnapDebug = useCallback(
    (input: SnapDebugLogInput) => {
      if (!showDevPanel) {
        return;
      }

      const lines = input.lines ?? [];
      setSnapDebug({
        atIso: new Date().toISOString(),
        phase: input.phase,
        note: input.note ?? null,
        snapshotMatchesSource: input.snapshotMatchesSource,
        dragKind: input.dragKind,
        rawPoint: toDebugPoint(input.rawPoint),
        rawDelta: toDebugPoint(input.rawDelta),
        snappedPoint: toDebugPoint(input.snappedPoint),
        snappedDelta: toDebugPoint(input.snappedDelta),
        offset: toDebugPoint(input.offset),
        context: summarizeSnapContextForDebug(input.context),
        lineCount: lines.length,
        lineSummary: summarizeSnapLinesForDebug(lines)
      });
    },
    [showDevPanel]
  );

  const onSnapDebugMovePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      snapDebugDragRef.current = {
        kind: "move",
        startClientX: event.clientX,
        startClientY: event.clientY,
        startLeft: snapDebugRect.left,
        startTop: snapDebugRect.top
      };
      document.body.classList.add("is-dragging-snap-debug");
      event.preventDefault();
      event.stopPropagation();
    },
    [snapDebugRect.left, snapDebugRect.top]
  );

  const onSnapDebugResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      snapDebugDragRef.current = {
        kind: "resize",
        startClientX: event.clientX,
        startClientY: event.clientY,
        startWidth: snapDebugRect.width,
        startHeight: snapDebugRect.height
      };
      document.body.classList.add("is-resizing-snap-debug");
      event.preventDefault();
      event.stopPropagation();
    },
    [snapDebugRect.height, snapDebugRect.width]
  );

  const diagnostics = useMemo(() => {
    const result: DiagnosticRow[] = [];
    if (parseDiags) {
      for (const d of parseDiags) {
        result.push({ ...d, source: "parse" });
      }
    }
    if (semanticDiags) {
      for (const d of semanticDiags) {
        result.push({ ...d, source: "semantic" });
      }
    }
    return result;
  }, [parseDiags, semanticDiags]);

  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warnCount = diagnostics.filter((d) => d.severity === "warning").length;

  useEffect(() => {
    let cancelled = false;
    void createMathJaxNodeTextEngine()
      .then((engine) => {
        if (!cancelled) {
          textEngineRef.current = engine;
        }
      })
      .catch(() => {
        if (!cancelled) {
          textEngineRef.current = null;
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const drag = snapDebugDragRef.current;
      if (!drag) {
        return;
      }

      if (viewportSize.width <= 0 || viewportSize.height <= 0) {
        return;
      }

      if (drag.kind === "move") {
        setSnapDebugRect((current) =>
          clampSnapDebugOverlayRect(
            {
              ...current,
              left: drag.startLeft + (event.clientX - drag.startClientX),
              top: drag.startTop + (event.clientY - drag.startClientY)
            },
            viewportSize.width,
            viewportSize.height
          )
        );
        return;
      }

      setSnapDebugRect((current) =>
        clampSnapDebugOverlayRect(
          {
            ...current,
            width: drag.startWidth + (event.clientX - drag.startClientX),
            height: drag.startHeight + (event.clientY - drag.startClientY)
          },
          viewportSize.width,
          viewportSize.height
        )
      );
    }

    function clearSnapDebugDragState() {
      if (!snapDebugDragRef.current) {
        return;
      }
      snapDebugDragRef.current = null;
      document.body.classList.remove("is-dragging-snap-debug");
      document.body.classList.remove("is-resizing-snap-debug");
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", clearSnapDebugDragState);
    window.addEventListener("pointercancel", clearSnapDebugDragState);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", clearSnapDebugDragState);
      window.removeEventListener("pointercancel", clearSnapDebugDragState);
      clearSnapDebugDragState();
    };
  }, [viewportSize.height, viewportSize.width]);

  useEffect(() => {
    if (!showDevPanel) {
      return;
    }
    if (viewportSize.width <= 0 || viewportSize.height <= 0) {
      return;
    }
    setSnapDebugRect((current) =>
      clampSnapDebugOverlayRect(current, viewportSize.width, viewportSize.height)
    );
  }, [showDevPanel, viewportSize.height, viewportSize.width]);

  const selectedHandles = useMemo(
    () => snapshot.editHandles.filter((handle) => selectedElementIds.has(handle.sourceRef.sourceId)),
    [snapshot.editHandles, selectedElementIds]
  );
  const nodeAnchorTargets = useMemo<readonly NodeAnchorTarget[]>(
    () => snapshot.semanticResult?.nodeAnchorTargets ?? [],
    [snapshot.semanticResult]
  );
  const matrixSourceIds = useMemo(() => {
    const figure = snapshot.parseResult?.figure;
    if (!figure) {
      return new Set<string>();
    }
    return collectMatrixStatementSourceIds(figure.body);
  }, [snapshot.parseResult]);
  const dragCapability = useMemo(
    () => computeDragCapability(snapshot.editHandles),
    [snapshot.editHandles]
  );
  const adornmentTargetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const element of snapshot.scene?.elements ?? []) {
      if (element.adornment?.targetId) {
        ids.add(element.adornment.targetId);
      }
    }
    return ids;
  }, [snapshot.scene]);
  const draggableSourceIds = useMemo(() => {
    const ids = new Set<string>(dragCapability.draggableSourceIds);
    for (const sourceId of matrixSourceIds) {
      ids.add(sourceId);
    }
    for (const targetId of adornmentTargetIds) {
      ids.add(targetId);
    }
    return ids;
  }, [adornmentTargetIds, dragCapability.draggableSourceIds, matrixSourceIds]);

  const selectionBounds = useMemo(() => {
    if (!snapshot.scene || !svgResult) return [];
    return collectSelectionBounds(snapshot.scene.elements, selectedElementIds, svgResult.viewBox);
  }, [snapshot.scene, selectedElementIds, svgResult]);

  const sceneTextByRegionKey = useMemo(() => {
    const elements = snapshot.scene?.elements ?? [];
    const byRegionKey = new Map<string, SceneText>();
    for (const element of elements) {
      if (element.kind !== "Text") {
        continue;
      }
      byRegionKey.set(`hit:${element.id}`, element);
    }
    return byRegionKey;
  }, [snapshot.scene]);

  const sourceBounds = useMemo(() => {
    if (!snapshot.scene || !svgResult) {
      return new Map<string, Bounds>();
    }
    return collectSourceBounds(snapshot.scene.elements, svgResult.viewBox);
  }, [snapshot.scene, svgResult]);

  const selectionBoundsBySource = useMemo(() => {
    const bySource = new Map<string, Bounds>();
    for (const entry of selectionBounds) {
      bySource.set(entry.sourceId, entry.bounds);
    }
    return bySource;
  }, [selectionBounds]);

  const resizablePathShapeSourceIds = useMemo(() => {
    if (!snapshot.scene) {
      return new Set<string>();
    }

    const result = new Set<string>();
    const statements = snapshot.parseResult?.figure.body;
    for (const sourceId of selectionBoundsBySource.keys()) {
      if (matrixSourceIds.has(sourceId)) {
        continue;
      }
      if (sourceHasSingleResizablePathShape(snapshot.scene.elements, snapshot.editHandles, sourceId, statements)) {
        result.add(sourceId);
      }
    }
    return result;
  }, [matrixSourceIds, selectionBoundsBySource, snapshot.editHandles, snapshot.parseResult, snapshot.scene]);

  const nodeResizeSourceIds = useMemo(() => {
    const sourceIds = new Set<string>();
    for (const handle of selectedHandles) {
      if (handle.kind === "node-position" && !matrixSourceIds.has(handle.sourceRef.sourceId)) {
        sourceIds.add(handle.sourceRef.sourceId);
      }
    }
    return sourceIds;
  }, [matrixSourceIds, selectedHandles]);

  const resizeFrameSourceIds = useMemo(() => {
    const sourceIds = new Set<string>(resizablePathShapeSourceIds);
    for (const sourceId of nodeResizeSourceIds) {
      sourceIds.add(sourceId);
    }
    return sourceIds;
  }, [nodeResizeSourceIds, resizablePathShapeSourceIds]);

  const matrixSelectionSourceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const sourceId of selectionBoundsBySource.keys()) {
      if (matrixSourceIds.has(sourceId)) {
        ids.add(sourceId);
      }
    }
    return ids;
  }, [matrixSourceIds, selectionBoundsBySource]);

  const selectionFrameSourceIds = useMemo(() => {
    const ids = new Set<string>(resizeFrameSourceIds);
    for (const sourceId of matrixSelectionSourceIds) {
      ids.add(sourceId);
    }
    return ids;
  }, [matrixSelectionSourceIds, resizeFrameSourceIds]);

  const resizeFramesBySource = useMemo(() => {
    const frames = new Map<string, ReturnType<typeof resolveResizeFrameForSource>>();
    if (!snapshot.scene || !svgResult) {
      return frames;
    }
    const statements = snapshot.parseResult?.figure.body;
    for (const sourceId of resizeFrameSourceIds) {
      const path = snapshot.scene.elements.find(
        (element): element is ScenePath => element.sourceRef.sourceId === sourceId && element.kind === "Path"
      );
      const pathShapeHint = path ? resolveScenePathShapeHint(path, statements, sourceId) : undefined;
      const frame = resolveResizeFrameForSource(
        snapshot.scene.elements,
        snapshot.editHandles,
        sourceId,
        svgResult.viewBox,
        pathShapeHint
      );
      frames.set(sourceId, frame);
    }
    return frames;
  }, [resizeFrameSourceIds, snapshot.editHandles, snapshot.parseResult, snapshot.scene, svgResult]);

  const selectionBoxes = useMemo(
    () => {
      const boxes = [...selectionFrameSourceIds]
        .map((sourceId) => {
          const resizeFrame = resizeFramesBySource.get(sourceId) ?? null;
          if (resizeFrame) {
            return {
              key: `selection-box:${sourceId}`,
              sourceId,
              isAdornment: sourceId.startsWith("node-adornment:"),
              kind: "polygon" as const,
              points: resizeFrame.polygonSvg
            };
          }
          const bounds = selectionBoundsBySource.get(sourceId);
          return bounds
            ? {
                key: `selection-box:${sourceId}`,
                sourceId,
                isAdornment: sourceId.startsWith("node-adornment:"),
                kind: "axis-aligned" as const,
                ...bounds
              }
            : null;
        })
        .filter((bounds): bounds is NonNullable<typeof bounds> => bounds != null);
      return boxes;
    },
    [resizeFramesBySource, selectionBoundsBySource, selectionFrameSourceIds]
  );
  const selectedAdornmentConnectors = useMemo(() => {
    if (!snapshot.scene || !svgResult) {
      return [];
    }
    const highlightedAdornmentTargetIds = new Set<string>();
    for (const element of snapshot.scene.elements) {
      const adornment = element.adornment;
      if (!adornment?.ownerPoint) {
        continue;
      }
      if (selectedElementIds.has(adornment.targetId) || selectedElementIds.has(element.sourceRef.sourceId)) {
        highlightedAdornmentTargetIds.add(adornment.targetId);
      }
    }
    const connectors: Array<{ key: string; kind: "label" | "pin"; x1: number; y1: number; x2: number; y2: number }> = [];
    const seen = new Set<string>();
    for (const element of snapshot.scene.elements) {
      const adornment = element.adornment;
      if (
        !adornment ||
        adornment.kind !== "label" ||
        !highlightedAdornmentTargetIds.has(adornment.targetId) ||
        !adornment.ownerPoint ||
        seen.has(adornment.targetId)
      ) {
        continue;
      }
      const bounds = selectionBoundsBySource.get(adornment.targetId);
      if (!bounds) {
        continue;
      }
      const labelCenterWorld = {
        x: (bounds.minX + bounds.maxX) / 2,
        y: svgResult.viewBox.y + svgResult.viewBox.height - (((bounds.minY + bounds.maxY) / 2) - svgResult.viewBox.y)
      };
      const connectorOwnerPoint = resolveAdornmentOwnerBoundaryPoint(
        adornment.ownerGeometry,
        adornment.ownerPoint,
        labelCenterWorld
      );
      const owner = worldToSvgPoint(connectorOwnerPoint, svgResult.viewBox);
      const labelEdge = resolveBoundsEdgePointToward(bounds, owner);
      connectors.push({
        key: `adornment-connector:${adornment.targetId}`,
        kind: adornment.kind,
        x1: owner.x,
        y1: owner.y,
        x2: labelEdge.x,
        y2: labelEdge.y
      });
      seen.add(adornment.targetId);
    }
    return connectors;
  }, [selectedElementIds, selectionBoundsBySource, snapshot.scene, svgResult]);
  const adornmentHighlightBoxes = useMemo(() => {
    if (!snapshot.scene) {
      return [];
    }
    const boxes: Array<{ key: string; minX: number; minY: number; maxX: number; maxY: number }> = [];
    const seen = new Set<string>();
    for (const element of snapshot.scene.elements) {
      const targetId = element.adornment?.targetId;
      if (!targetId || seen.has(targetId)) {
        continue;
      }
      if (!selectedElementIds.has(targetId) && !selectedElementIds.has(element.sourceRef.sourceId)) {
        continue;
      }
      const bounds = selectionBoundsBySource.get(targetId);
      if (!bounds) {
        continue;
      }
      boxes.push({
        key: `adornment-highlight:${targetId}`,
        ...bounds
      });
      seen.add(targetId);
    }
    return boxes;
  }, [selectedElementIds, selectionBoundsBySource, snapshot.scene]);
  const curveControlLines = useMemo(
    () =>
      snapshot.scene
        ? deriveCurveControlLines(snapshot.scene.elements, selectedElementIds, snapshot.editHandles)
        : [],
    [selectedElementIds, snapshot.editHandles, snapshot.scene]
  );

  const marqueeBounds = useMemo(() => {
    if (!svgResult || !marqueeDraft) return null;
    return boundsFromPoints(
      worldToSvgPoint(marqueeDraft.startWorld, svgResult.viewBox),
      worldToSvgPoint(marqueeDraft.currentWorld, svgResult.viewBox)
    );
  }, [marqueeDraft, svgResult]);

  const handleDisplays = useMemo((): HandleDisplay[] => {
    if (!svgResult) return [];

    const displays: HandleDisplay[] = [];
    const resizeHandleSourceIds = new Set<string>(resizeFrameSourceIds);
    const singleSelectedSourceId =
      selectedElementIds.size === 1
        ? (selectedElementIds.values().next().value ?? null)
        : null;
    const rotateHandleSourceId =
      toolMode === "select" &&
      singleSelectedSourceId &&
      resizeHandleSourceIds.has(singleSelectedSourceId)
        ? singleSelectedSourceId
        : null;

    for (const handle of selectedHandles) {
      if (handle.kind === "node-position") {
        continue;
      }

      if (handle.kind === "path-point" && resizablePathShapeSourceIds.has(handle.sourceRef.sourceId)) {
        continue;
      }

      const point = worldToSvgPoint(handle.world, svgResult.viewBox);
      const isDraggable = dragCapability.draggableHandleIds.has(handle.id);
      displays.push({
        key: `handle:${handle.id}`,
        x: point.x,
        y: point.y,
        cursor: isDraggable ? getHandleCursor(handle, snapshot.scene, snapshot.editHandles) : "not-allowed",
        kind: "move-handle",
        handle
      });
    }

    for (const sourceId of resizeHandleSourceIds) {
      const resizeFrame = resizeFramesBySource.get(sourceId) ?? null;
      if (resizeFrame) {
        for (const role of RESIZE_FRAME_CORNER_ROLES) {
          const corner = resizeFrame.cornersByRole[role];
          const resizeVector = {
            x: corner.world.x - resizeFrame.centerWorld.x,
            y: corner.world.y - resizeFrame.centerWorld.y
          };
          const topLeft = resizeFrame.cornersByRole["top-left"].svg;
          const topRight = resizeFrame.cornersByRole["top-right"].svg;
          const frameRotationDeg = (Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x) * 180) / Math.PI;
          displays.push({
            key: `node-handle:${sourceId}:${role}`,
            x: corner.svg.x,
            y: corner.svg.y,
            cursor:
              vectorLengthSquared(resizeVector) > 1e-12
                ? resizeCursorForVector(resizeVector)
                : resizeCursorForRole(role),
            kind: "resize-element",
            elementId: sourceId,
            role,
            rotationDeg: frameRotationDeg
          });
        }
        continue;
      }

      const fallbackBounds = selectionBoundsBySource.get(sourceId) ?? null;
      const bounds = preferredNodeBoundsForSource(
        snapshot.scene?.elements ?? [],
        sourceId,
        svgResult.viewBox,
        fallbackBounds
      );
      if (!bounds) {
        if (resizablePathShapeSourceIds.has(sourceId)) {
          continue;
        }
        const fallback = selectedHandles.find((handle) => handle.sourceRef.sourceId === sourceId && handle.kind === "node-position");
        if (!fallback) continue;
        const point = worldToSvgPoint(fallback.world, svgResult.viewBox);
        displays.push({
          key: `node-handle:${sourceId}:center`,
          x: point.x,
          y: point.y,
          cursor: draggableSourceIds.has(sourceId) ? "move" : "not-allowed",
          kind: "move-element",
          elementId: sourceId
        });
        continue;
      }

      displays.push(
        {
          key: `node-handle:${sourceId}:top-left`,
          x: bounds.minX,
          y: bounds.minY,
          cursor: "nwse-resize",
          kind: "resize-element",
          elementId: sourceId,
          role: "top-left",
          rotationDeg: 0
        },
        {
          key: `node-handle:${sourceId}:top-right`,
          x: bounds.maxX,
          y: bounds.minY,
          cursor: "nesw-resize",
          kind: "resize-element",
          elementId: sourceId,
          role: "top-right",
          rotationDeg: 0
        },
        {
          key: `node-handle:${sourceId}:bottom-left`,
          x: bounds.minX,
          y: bounds.maxY,
          cursor: "nesw-resize",
          kind: "resize-element",
          elementId: sourceId,
          role: "bottom-left",
          rotationDeg: 0
        },
        {
          key: `node-handle:${sourceId}:bottom-right`,
          x: bounds.maxX,
          y: bounds.maxY,
          cursor: "nwse-resize",
          kind: "resize-element",
          elementId: sourceId,
          role: "bottom-right",
          rotationDeg: 0
        }
      );
    }

    if (rotateHandleSourceId) {
      const rotateFrame = resizeFramesBySource.get(rotateHandleSourceId) ?? null;
      if (rotateFrame) {
        const rotateHandlePosition = resolveRotateHandlePosition(
          rotateFrame,
          canvasTransform.scale,
          ROTATE_HANDLE_OFFSET_PX
        );
        displays.push({
          key: `node-handle:${rotateHandleSourceId}:rotate`,
          x: rotateHandlePosition.handleSvg.x,
          y: rotateHandlePosition.handleSvg.y,
          anchorX: rotateHandlePosition.anchorSvg.x,
          anchorY: rotateHandlePosition.anchorSvg.y,
          centerWorld: { ...rotateFrame.centerWorld },
          cursor: "grab",
          kind: "rotate-element",
          elementId: rotateHandleSourceId
        });
      }
    }

    return displays;
  }, [canvasTransform.scale, dragCapability.draggableHandleIds, draggableSourceIds, resizablePathShapeSourceIds, resizeFrameSourceIds, resizeFramesBySource, selectedElementIds, selectedHandles, selectionBoundsBySource, snapshot.scene, snapshot.editHandles, svgResult, toolMode]);

  const hitRegions = useMemo(() => {
    if (!snapshot.scene || !svgResult) return [];
    return buildHitRegions(snapshot.scene.elements, svgResult.viewBox, canvasTransform.scale);
  }, [snapshot.scene, svgResult, canvasTransform.scale]);

  const visibleRanges = useMemo(() => {
    if (!svgResult || viewportSize.width <= 0 || viewportSize.height <= 0) return null;
    return computeVisibleRanges(svgResult.viewBox, canvasTransform, viewportSize.width, viewportSize.height);
  }, [svgResult, canvasTransform, viewportSize]);

  const viewportWorldBounds = useMemo(
    () =>
      visibleRanges
        ? {
            minX: visibleRanges.worldMinX,
            minY: visibleRanges.worldMinY,
            maxX: visibleRanges.worldMaxX,
            maxY: visibleRanges.worldMaxY
          }
        : null,
    [visibleRanges]
  );

  const snapGuideInput = useMemo(
    () => ({
      x: showGuides ? guides.vertical : [],
      y: showGuides ? guides.horizontal : []
    }),
    [guides.horizontal, guides.vertical, showGuides]
  );

  const snapSettingsPatch = useMemo(
    () => ({
      grid: {
        enabled: snapToGrid,
        minorTargetPx: gridMinorTargetPx
      }
    }),
    [snapToGrid, gridMinorTargetPx]
  );

  const renderedGuides = useMemo(() => {
    const vertical = [...guides.vertical];
    const horizontal = [...guides.horizontal];

    if (guidePreview) {
      if (guidePreview.hideValue != null) {
        if (guidePreview.orientation === "vertical") {
          removeGuideValue(vertical, guidePreview.hideValue);
        } else {
          removeGuideValue(horizontal, guidePreview.hideValue);
        }
      }

      if (guidePreview.visible !== false) {
        if (guidePreview.orientation === "vertical") {
          upsertGuideValue(vertical, guidePreview.value);
        } else {
          upsertGuideValue(horizontal, guidePreview.value);
        }
      }
    }

    return {
      vertical: vertical.sort((a, b) => a - b),
      horizontal: horizontal.sort((a, b) => a - b)
    };
  }, [guidePreview, guides.horizontal, guides.vertical]);

  const overlayGridSteps = useMemo(() => resolveOverlayGridSteps(canvasTransform.scale, gridMinorTargetPx), [canvasTransform.scale, gridMinorTargetPx]);

  const rulers = useMemo(() => {
    if (!svgResult || !visibleRanges) {
      return {
        topTicks: [] as RulerTick[],
        leftTicks: [] as RulerTick[]
      };
    }

    const { majorStep, minorStep } = overlayGridSteps;

    const topTicks = buildTicks(
      visibleRanges.worldMinX,
      visibleRanges.worldMaxX,
      minorStep,
      majorStep,
      (value) => toViewportXFromWorld(value, svgResult.viewBox, canvasTransform) + rulerAlignmentOffsets.topX
    );

    const leftTicks = buildTicks(
      visibleRanges.worldMinY,
      visibleRanges.worldMaxY,
      minorStep,
      majorStep,
      (value) => toViewportYFromWorld(value, svgResult.viewBox, canvasTransform) + rulerAlignmentOffsets.leftY
    );

    return { topTicks, leftTicks };
  }, [canvasTransform, overlayGridSteps, rulerAlignmentOffsets.leftY, rulerAlignmentOffsets.topX, svgResult, visibleRanges]);

  const gridLines = useMemo((): GridLines | null => {
    if (!svgResult || !visibleRanges || !showGrid) return null;

    const { minorStep, majorStep } = overlayGridSteps;

    const worldXs = buildValueSequence(visibleRanges.worldMinX, visibleRanges.worldMaxX, minorStep, 1000);
    const worldYs = buildValueSequence(visibleRanges.worldMinY, visibleRanges.worldMaxY, minorStep, 1000);

    const verticalMinor: number[] = [];
    const verticalMajor: number[] = [];
    for (const worldX of worldXs) {
      if (isMultipleOfStep(worldX, majorStep)) {
        verticalMajor.push(worldX);
      } else {
        verticalMinor.push(worldX);
      }
    }

    const horizontalMinor: number[] = [];
    const horizontalMajor: number[] = [];
    for (const worldY of worldYs) {
      const svgY = worldToSvgY(worldY, svgResult.viewBox);
      if (isMultipleOfStep(worldY, majorStep)) {
        horizontalMajor.push(svgY);
      } else {
        horizontalMinor.push(svgY);
      }
    }

    return {
      verticalMinor,
      verticalMajor,
      horizontalMinor,
      horizontalMajor,
      yMin: visibleRanges.svgMinY,
      yMax: visibleRanges.svgMaxY
    };
  }, [overlayGridSteps, showGrid, svgResult, visibleRanges]);

  const toolPreview = useMemo((): ToolPreview | null => {
    if (!svgResult || toolMode === "select") {
      return null;
    }

    if (toolMode === "addNode") {
      const liveWorld = toolDraft?.currentWorld ?? toolCursorWorld;
      if (!liveWorld) {
        return null;
      }
      const point = worldToSvgPoint(liveWorld, svgResult.viewBox);
      return { kind: "node", x: point.x, y: point.y };
    }

    if (toolMode === "addFreehand") {
      if (!freehandDraft || freehandDraft.points.length < 2) {
        if (!toolCursorWorld) {
          return null;
        }
        const point = worldToSvgPoint(toolCursorWorld, svgResult.viewBox);
        return { kind: "cursor", x: point.x, y: point.y };
      }

      const segments: Extract<ToolPreview, { kind: "freehand" }>["segments"] = [];
      for (const segment of resolveFreehandPreviewSegments(freehandDraft)) {
        if (segment.kind === "line") {
          const from = worldToSvgPoint(segment.from, svgResult.viewBox);
          const to = worldToSvgPoint(segment.to, svgResult.viewBox);
          segments.push({
            kind: "line",
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y
          });
          continue;
        }

        const from = worldToSvgPoint(segment.from, svgResult.viewBox);
        const c1 = worldToSvgPoint(segment.control1, svgResult.viewBox);
        const c2 = worldToSvgPoint(segment.control2, svgResult.viewBox);
        const to = worldToSvgPoint(segment.to, svgResult.viewBox);
        segments.push({
          kind: "bezier",
          x1: from.x,
          y1: from.y,
          c1x: c1.x,
          c1y: c1.y,
          c2x: c2.x,
          c2y: c2.y,
          x2: to.x,
          y2: to.y
        });
      }

      return { kind: "freehand", segments };
    }

    const makeBezierPreview = (startWorld: Point, endWorld: Point, bendWorld: Point): ToolPreview => {
      const controls = resolveBezierControlsFromBend(startWorld, endWorld, bendWorld);
      const start = worldToSvgPoint(startWorld, svgResult.viewBox);
      const end = worldToSvgPoint(controls.endWorld, svgResult.viewBox);
      const c1 = worldToSvgPoint(controls.control1, svgResult.viewBox);
      const c2 = worldToSvgPoint(controls.control2, svgResult.viewBox);
      return {
        kind: "bezier",
        x1: start.x,
        y1: start.y,
        c1x: c1.x,
        c1y: c1.y,
        c2x: c2.x,
        c2y: c2.y,
        x2: end.x,
        y2: end.y
      };
    };

    if (toolMode === "addPath") {
      if (!pathDraft) {
        if (!toolCursorWorld) {
          return null;
        }
        const point = worldToSvgPoint(toolCursorWorld, svgResult.viewBox);
        return { kind: "cursor", x: point.x, y: point.y };
      }

      const segments: Extract<ToolPreview, { kind: "complex-path" }>["segments"] = [];
      let currentPoint = pathDraft.startWorld;
      for (const segment of pathDraft.segments) {
        const from = worldToSvgPoint(currentPoint, svgResult.viewBox);
        if (segment.kind === "line") {
          const to = worldToSvgPoint(segment.to, svgResult.viewBox);
          segments.push({
            kind: "line",
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y
          });
          currentPoint = segment.to;
          continue;
        }

        const c1 = worldToSvgPoint(segment.control1, svgResult.viewBox);
        const c2 = worldToSvgPoint(segment.control2, svgResult.viewBox);
        const to = worldToSvgPoint(segment.to, svgResult.viewBox);
        segments.push({
          kind: "bezier",
          x1: from.x,
          y1: from.y,
          c1x: c1.x,
          c1y: c1.y,
          c2x: c2.x,
          c2y: c2.y,
          x2: to.x,
          y2: to.y
        });
        currentPoint = segment.to;
      }
      if (pathSegmentDraft) {
        if (pathSegmentDraft.isBending) {
          const controls = resolveBezierControlsFromBend(
            pathSegmentDraft.startWorld,
            pathSegmentDraft.endWorld,
            pathSegmentDraft.bendWorld
          );
          const from = worldToSvgPoint(pathSegmentDraft.startWorld, svgResult.viewBox);
          const c1 = worldToSvgPoint(controls.control1, svgResult.viewBox);
          const c2 = worldToSvgPoint(controls.control2, svgResult.viewBox);
          const to = worldToSvgPoint(pathSegmentDraft.endWorld, svgResult.viewBox);
          segments.push({
            kind: "bezier",
            x1: from.x,
            y1: from.y,
            c1x: c1.x,
            c1y: c1.y,
            c2x: c2.x,
            c2y: c2.y,
            x2: to.x,
            y2: to.y
          });
        } else {
          const from = worldToSvgPoint(pathSegmentDraft.startWorld, svgResult.viewBox);
          const to = worldToSvgPoint(pathSegmentDraft.endWorld, svgResult.viewBox);
          segments.push({
            kind: "line",
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y
          });
        }
      } else if (toolCursorWorld) {
        const closeCandidate = pathToolShouldClose(
          pathDraft,
          toolCursorWorld,
          pathToolCloseRadiusWorld(canvasTransform.scale)
        );
        const candidateTarget = closeCandidate ? pathDraft.startWorld : toolCursorWorld;
        if (distanceSquared(currentPoint, candidateTarget) > 1e-6) {
          const from = worldToSvgPoint(currentPoint, svgResult.viewBox);
          const to = worldToSvgPoint(candidateTarget, svgResult.viewBox);
          segments.push({
            kind: "line",
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y
          });
        }
      }

      const start = worldToSvgPoint(pathDraft.startWorld, svgResult.viewBox);
      const closeCandidate =
        toolCursorWorld != null
          ? pathToolShouldClose(pathDraft, toolCursorWorld, pathToolCloseRadiusWorld(canvasTransform.scale))
          : false;
      return {
        kind: "complex-path",
        startX: start.x,
        startY: start.y,
        closeCandidate,
        canClose: pathToolCanClose(pathDraft),
        segments
      };
    }

    if (toolMode === "addBezier" && pendingBezier) {
      const midpoint = {
        x: (pendingBezier.startWorld.x + pendingBezier.endWorld.x) / 2,
        y: (pendingBezier.startWorld.y + pendingBezier.endWorld.y) / 2
      };
      const bendWorld = bezierBendDraft?.currentWorld ?? toolCursorWorld ?? midpoint;
      return makeBezierPreview(pendingBezier.startWorld, pendingBezier.endWorld, bendWorld);
    }

    const liveWorld = toolDraft?.currentWorld ?? toolCursorWorld;
    if (!liveWorld) {
      return null;
    }

    if (!toolDraft) {
      const point = worldToSvgPoint(liveWorld, svgResult.viewBox);
      return { kind: "cursor", x: point.x, y: point.y };
    }

    if (toolDraft.toolMode === "addBezier") {
      const midpoint = {
        x: (toolDraft.startWorld.x + toolDraft.currentWorld.x) / 2,
        y: (toolDraft.startWorld.y + toolDraft.currentWorld.y) / 2
      };
      return makeBezierPreview(toolDraft.startWorld, toolDraft.currentWorld, midpoint);
    }

    const start = worldToSvgPoint(toolDraft.startWorld, svgResult.viewBox);
    const end = worldToSvgPoint(toolDraft.currentWorld, svgResult.viewBox);

    if (toolDraft.toolMode === "addLine" || toolDraft.toolMode === "addArrow") {
      return {
        kind: "line",
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        arrow: toolDraft.toolMode === "addArrow"
      };
    }

    if (toolDraft.toolMode === "addGrid") {
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      const width = Math.abs(end.x - start.x);
      const height = Math.abs(end.y - start.y);
      const minWorldX = Math.min(toolDraft.startWorld.x, toolDraft.currentWorld.x);
      const maxWorldX = Math.max(toolDraft.startWorld.x, toolDraft.currentWorld.x);
      const minWorldY = Math.min(toolDraft.startWorld.y, toolDraft.currentWorld.y);
      const maxWorldY = Math.max(toolDraft.startWorld.y, toolDraft.currentWorld.y);
      const verticalLines = buildAnchoredGridPreviewLines(
        minWorldX,
        minWorldX,
        maxWorldX,
        TOOL_PREVIEW_GRID_STEP_PT,
        TOOL_PREVIEW_GRID_MAX_LINES
      );
      const horizontalLines = buildAnchoredGridPreviewLines(
        minWorldY,
        minWorldY,
        maxWorldY,
        TOOL_PREVIEW_GRID_STEP_PT,
        TOOL_PREVIEW_GRID_MAX_LINES
      ).map((worldY) => worldToSvgY(worldY, svgResult.viewBox));
      return {
        kind: "grid",
        x,
        y,
        width,
        height,
        verticalLines,
        horizontalLines
      };
    }

    if (toolDraft.toolMode === "addRect" || toolDraft.toolMode === "addEllipse") {
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      const width = Math.abs(end.x - start.x);
      const height = Math.abs(end.y - start.y);
      if (toolDraft.toolMode === "addRect") {
        return {
          kind: "rect",
          x,
          y,
          width,
          height
        };
      }
      return {
        kind: "ellipse",
        cx: x + width / 2,
        cy: y + height / 2,
        rx: width / 2,
        ry: height / 2
      };
    }

    const dx = toolDraft.currentWorld.x - toolDraft.startWorld.x;
    const dy = toolDraft.currentWorld.y - toolDraft.startWorld.y;
    const radius = Math.hypot(dx, dy);

    return {
      kind: "circle",
      cx: start.x,
      cy: start.y,
      r: radius > 1e-4 ? radius : TOOL_PREVIEW_CIRCLE_RADIUS_PT
    };
  }, [bezierBendDraft, canvasTransform.scale, freehandDraft, pathDraft, pathSegmentDraft, pendingBezier, svgResult, toolCursorWorld, toolDraft, toolMode]);

  const fitToContent = useCallback(() => {
    if (!svgResult || !viewportRef.current) return;

    const viewportWidth = viewportRef.current.clientWidth;
    const viewportHeight = viewportRef.current.clientHeight;

    if (
      viewportWidth <= 0 ||
      viewportHeight <= 0 ||
      svgResult.viewBox.width <= 0 ||
      svgResult.viewBox.height <= 0
    ) {
      return;
    }

    const availableWidth = Math.max(1, viewportWidth - FIT_PADDING * 2);
    const availableHeight = Math.max(1, viewportHeight - FIT_PADDING * 2);

    const scale = clamp(
      Math.min(availableWidth / svgResult.viewBox.width, availableHeight / svgResult.viewBox.height),
      MIN_SCALE,
      MAX_SCALE
    );

    const translateX = (viewportWidth - svgResult.viewBox.width * scale) / 2;
    const translateY = (viewportHeight - svgResult.viewBox.height * scale) / 2;

    dispatch({
      type: "SET_CANVAS_TRANSFORM",
      transform: { translateX, translateY, scale }
    });
  }, [dispatch, svgResult]);

  const handledFitRequestRef = useRef(0);
  useEffect(() => {
    if (fitToContentRequestToken <= 0) {
      return;
    }
    if (fitToContentRequestToken === handledFitRequestRef.current) {
      return;
    }
    handledFitRequestRef.current = fitToContentRequestToken;
    setFitToContentModeActive(true);
    fitToContent();
  }, [fitToContent, fitToContentRequestToken]);

  const copyWarningToClipboard = useCallback(() => {
    if (!warning) {
      return;
    }
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return;
    }
    void navigator.clipboard.writeText(warning);
  }, [warning]);

  const onWarningBarKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      copyWarningToClipboard();
    },
    [copyWarningToClipboard]
  );

  const applyActionWithFeedback = useCallback(
    (action: EditAction, historyMergeKey?: string): ApplyActionFeedback => {
      const result = applyEditAction(source, snapshot.editHandles, action, {
        evaluateOptions: { textEngine: textEngineRef.current }
      });

      if (result.kind === "success" || result.kind === "partial") {
        if (result.kind === "partial") {
          const skippedCount = result.skippedHandles.length;
          setWarning(`${result.reason} (${skippedCount} handle${skippedCount === 1 ? "" : "s"} skipped)`);
        }

        const sourceChanged = result.newSource !== source;
        if (sourceChanged) {
          dispatch({
            type: "APPLY_EDIT_ACTION",
            action,
            historyMergeKey,
            precomputedResult: result
          });
        }
        return { sourceChanged };
      }

      if (result.kind === "unsupported") {
        if (action.kind === "resizeElement" && result.reason === RESIZE_NOOP_REASON) {
          return { sourceChanged: false };
        }
        if (action.kind === "moveAdornment" && result.reason === ADORNMENT_EDIT_NOOP_REASON) {
          return { sourceChanged: false };
        }
        setWarning(result.reason);
      } else {
        setWarning(result.message);
      }

      return { sourceChanged: false };
    },
    [dispatch, source, snapshot.editHandles]
  );

  const queueSelectionForAddedElement = useCallback(
    (preferredWorld: Point) => {
      const beforeIds = new Set<string>();
      for (const element of snapshot.scene?.elements ?? []) {
        beforeIds.add(element.sourceRef.sourceId);
      }
      pendingAddedSelectionRef.current = { beforeIds, preferredWorld };
    },
    [snapshot.scene]
  );

  const commitPathToolSegment = useCallback((segment: PathToolGestureSegment) => {
    setPathDraft((previousDraft) => {
      if (!previousDraft) {
        return previousDraft;
      }
      return appendPathToolSegmentFromGesture(previousDraft, segment);
    });
    setPathSegmentDraft(null);
    setToolCursorWorld(segment.endWorld);
  }, []);

  const appendFreehandSamplePoint = useCallback((point: Point): Point[] | null => {
    let nextPoints: Point[] | null = null;
    setFreehandDraft((previousDraft) => {
      if (!previousDraft) {
        return previousDraft;
      }
      const nextDraft = appendFreehandToolPoint(previousDraft, point);
      nextPoints = nextDraft.points;
      return nextDraft;
    });
    return nextPoints;
  }, []);

  const finalizeFreehandDraft = useCallback((overridePoints?: Point[]) => {
    const baseDraft = freehandDraftRef.current;
    const draft =
      baseDraft && overridePoints
        ? {
            ...baseDraft,
            points: overridePoints.map((point) => ({ ...point }))
          }
        : baseDraft;
    setNodeAnchorOverlay(null);
    setSnapLines([]);
    if (dragRef.current?.kind === "tool-freehand") {
      setDragState(null);
    }

    if (!draft) {
      setFreehandDraft(null);
      setToolCursorWorld(null);
      dispatch({ type: "SET_TOOL_MODE", mode: "select" });
      return;
    }

    const snippet = generateFreehandToolSource(draft, canvasTransform.scale);
    if (snippet) {
      const firstPoint = draft.points[0]!;
      const lastPoint = draft.points[draft.points.length - 1]!;
      queueSelectionForAddedElement({
        x: (firstPoint.x + lastPoint.x) / 2,
        y: (firstPoint.y + lastPoint.y) / 2
      });
      const ok = applyActionWithFeedback({
        kind: "pasteStatements",
        snippets: [snippet],
        delta: { x: 0, y: 0 }
      });
      if (!ok.sourceChanged) {
        pendingAddedSelectionRef.current = null;
      }
    } else {
      pendingAddedSelectionRef.current = null;
    }

    setFreehandDraft(null);
    setToolCursorWorld(null);
    dispatch({ type: "SET_TOOL_MODE", mode: "select" });
  }, [applyActionWithFeedback, canvasTransform.scale, dispatch, queueSelectionForAddedElement, setDragState]);

  const finalizePathDraft = useCallback(
    (closed: boolean) => {
      const draft = pathDraftRef.current;
      setPathSegmentDraft(null);
      setNodeAnchorOverlay(null);
      setSnapLines([]);
      if (dragRef.current?.kind === "tool-path-segment") {
        setDragState(null);
      }

      if (!draft || !pathToolHasDrawableSegments(draft)) {
        setPathDraft(null);
        setToolCursorWorld(null);
        dispatch({ type: "SET_TOOL_MODE", mode: "select" });
        return;
      }

      const snippet = generatePathToolSource(draft, { closed });
      if (!snippet) {
        setPathDraft(null);
        setToolCursorWorld(null);
        dispatch({ type: "SET_TOOL_MODE", mode: "select" });
        return;
      }

      const ok = applyActionWithFeedback({
        kind: "pasteStatements",
        snippets: [snippet],
        delta: { x: 0, y: 0 }
      });
      if (!ok.sourceChanged) {
        pendingAddedSelectionRef.current = null;
      }

      setPathDraft(null);
      setToolCursorWorld(null);
      dispatch({ type: "SET_TOOL_MODE", mode: "select" });
    },
    [applyActionWithFeedback, dispatch, setDragState]
  );

  const resolveGuideFromClient = useCallback(
    (orientation: GuideOrientation, clientX: number, clientY: number): { value: number; overViewport: boolean } | null => {
      const viewport = viewportRef.current;
      const currentSvg = svgResultRef.current;
      if (!viewport || !currentSvg) {
        return null;
      }

      const rect = viewport.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const world = viewportToWorldPoint(localX, localY, canvasTransformRef.current, currentSvg.viewBox);
      return {
        value: orientation === "vertical" ? world.x : world.y,
        overViewport: isPointInsideRect(clientX, clientY, rect)
      };
    },
    []
  );

  const isPointerOverGuideDeleteZone = useCallback(
    (orientation: GuideOrientation, clientX: number, clientY: number): boolean => {
      const viewportRect = viewportRef.current?.getBoundingClientRect();
      if (!viewportRect) {
        return false;
      }
      if (orientation === "horizontal") {
        return clientY <= viewportRect.top + 0.5;
      }
      return clientX <= viewportRect.left + 0.5;
    },
    []
  );

  const onGuidePointerDown = useCallback(
    (event: ReactPointerEvent<SVGLineElement>, orientation: GuideOrientation, value: number) => {
      if (!showGuides) {
        return;
      }
      if (event.button !== 0) {
        return;
      }
      const guide = resolveGuideFromClient(orientation, event.clientX, event.clientY);
      if (!guide) {
        return;
      }

      viewportRef.current?.focus({ preventScroll: true });
      guideDragRef.current = {
        pointerId: event.pointerId,
        orientation,
        source: "guide",
        sourceValue: value,
        value: guide.value,
        overViewport: guide.overViewport,
        overDeleteZone: isPointerOverGuideDeleteZone(orientation, event.clientX, event.clientY)
      };
      setGuidePreview(
        guide.overViewport
          ? { orientation, value: guide.value, hideValue: value }
          : null
      );
      document.body.classList.add(
        orientation === "horizontal" ? "is-dragging-guide-horizontal" : "is-dragging-guide-vertical"
      );
      event.preventDefault();
      event.stopPropagation();
    },
    [isPointerOverGuideDeleteZone, resolveGuideFromClient, showGuides]
  );

  const onTopRulerPointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!showGuides) {
        return;
      }
      if (event.button !== 0) {
        return;
      }
      const guide = resolveGuideFromClient("horizontal", event.clientX, event.clientY);
      if (!guide) {
        return;
      }

      viewportRef.current?.focus({ preventScroll: true });
      guideDragRef.current = {
        pointerId: event.pointerId,
        orientation: "horizontal",
        source: "ruler",
        value: guide.value,
        overViewport: guide.overViewport,
        overDeleteZone: false
      };
      setGuidePreview(guide.overViewport ? { orientation: "horizontal", value: guide.value } : null);
      document.body.classList.add("is-dragging-guide-horizontal");
      event.preventDefault();
      event.stopPropagation();
    },
    [resolveGuideFromClient, showGuides]
  );

  const onLeftRulerPointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!showGuides) {
        return;
      }
      if (event.button !== 0) {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      // Keep guide drags on the canvas-adjacent side so the code-panel splitter
      // can still be grabbed reliably near the outer edge.
      if (localX < rect.width - LEFT_RULER_DRAG_SOURCE_WIDTH_PX) {
        return;
      }

      const guide = resolveGuideFromClient("vertical", event.clientX, event.clientY);
      if (!guide) {
        return;
      }

      viewportRef.current?.focus({ preventScroll: true });
      guideDragRef.current = {
        pointerId: event.pointerId,
        orientation: "vertical",
        source: "ruler",
        value: guide.value,
        overViewport: guide.overViewport,
        overDeleteZone: false
      };
      setGuidePreview(guide.overViewport ? { orientation: "vertical", value: guide.value } : null);
      document.body.classList.add("is-dragging-guide-vertical");
      event.preventDefault();
      event.stopPropagation();
    },
    [resolveGuideFromClient, showGuides]
  );

  const resolveEditableTextTarget = useCallback(
    (targetId: string, region: HitRegion | undefined): EditableTextTarget | null => {
      if (!region || region.shape !== "rect" || region.interactionMode === "move") {
        return null;
      }
      const sceneText = sceneTextByRegionKey.get(region.sceneTextKey ?? region.key);
      if (!sceneText) {
        return null;
      }
      if (sceneText.textRenderInfo?.mode !== "mathjax") {
        return null;
      }
      if (sceneText.textHasFixedWidth) {
        return null;
      }
      if (sceneText.text.includes("\n")) {
        return null;
      }
      const sourceSpan = sceneText.textSourceSpan ?? sceneText.sourceRef.sourceSpan;
      if (sourceSpan.to <= sourceSpan.from) {
        return null;
      }
      if (source.slice(sourceSpan.from, sourceSpan.to) !== sceneText.text) {
        return null;
      }
      if (!(sceneText.textBlockWidth != null && sceneText.textBlockWidth > 0)) {
        return null;
      }
      return {
        sourceId: targetId,
        sourceSpan,
        text: sceneText.text,
        style: sceneText.style,
        totalWidth: sceneText.textBlockWidth,
        region
      };
    },
    [sceneTextByRegionKey, source]
  );

  const editableTextRegionKeys = useMemo(() => {
    const keys = new Set<string>();
    if (toolMode !== "select") {
      return keys;
    }
    for (const region of hitRegions) {
      if (region.shape === "rect" && region.interactionMode === "move") {
        continue;
      }
      if (resolveEditableTextTarget(region.targetId, region)) {
        keys.add(region.key);
      }
    }
    return keys;
  }, [hitRegions, resolveEditableTextTarget, toolMode]);

  const resolvePrefixTableForTarget = useCallback((target: EditableTextTarget): readonly number[] | null => {
    if (target.text.length === 0 || target.totalWidth <= 0 || target.text.length > PREFIX_MEASURE_TEXT_MAX_LENGTH) {
      return null;
    }

    const cacheKey = JSON.stringify({
      text: target.text,
      fontStyle: target.style.fontStyle,
      fontWeight: target.style.fontWeight,
      fontFamily: target.style.fontFamily,
      fontSizePt: Number(target.style.fontSize.toFixed(4))
    });
    const cached = prefixTableCacheRef.current.get(cacheKey);
    if (cached) {
      prefixTableCacheRef.current.delete(cacheKey);
      prefixTableCacheRef.current.set(cacheKey, cached);
      return cached;
    }

    const textEngine = textEngineRef.current;
    if (!textEngine) {
      return null;
    }

    const table = seedPrefixWidthTable(target.text.length, target.totalWidth);
    for (let index = 1; index < target.text.length; index += 1) {
      const prefix = stabilizePrefixForMeasurement(target.text.slice(0, index));
      const measured = textEngine.measure({
        text: prefix,
        textWidthPt: null,
        fontStyle: target.style.fontStyle,
        fontWeight: target.style.fontWeight,
        fontFamily: target.style.fontFamily,
        fontSizePt: target.style.fontSize
      });
      table[index] = measured?.width ?? Number.NaN;
    }
    const finalized = finalizePrefixWidthTable(table, target.totalWidth);
    prefixTableCacheRef.current.set(cacheKey, finalized);
    while (prefixTableCacheRef.current.size > PREFIX_MEASURE_CACHE_LIMIT) {
      const oldestKey = prefixTableCacheRef.current.keys().next().value;
      if (typeof oldestKey !== "string") {
        break;
      }
      prefixTableCacheRef.current.delete(oldestKey);
    }
    return finalized;
  }, []);

  const textIndexFromClient = useCallback(
    (
      clientX: number,
      clientY: number,
      target: TextIndexMappingTarget,
      prefixTable: readonly number[] | null
    ): number | null => {
      const svgPoint = clientToSvgPoint(clientX, clientY, interactionSvgRef.current);
      if (!svgPoint) {
        return null;
      }

      const unrotatedPoint = rotatePointAroundCenter(svgPoint, target.region.cx, target.region.cy, target.region.rotation);
      const contentBox = resolveRectHitRegionContentBox(target.region);
      const ratio = clamp((unrotatedPoint.x - contentBox.x) / Math.max(contentBox.width, 1e-6), 0, 1);
      const units = ratio * target.totalWidth;
      return clamp(
        findNearestPrefixIndexFromTable(units, target.textLength, target.totalWidth, prefixTable),
        0,
        target.textLength
      );
    },
    []
  );

  const applyCanvasTextSelection = useCallback(
    (
      target: EditableTextTarget,
      anchorIndex: number,
      headIndex: number
    ) => {
      const boundedAnchor = clamp(Math.floor(anchorIndex), 0, target.text.length);
      const boundedHead = clamp(Math.floor(headIndex), 0, target.text.length);
      const anchorOffset = target.sourceSpan.from + boundedAnchor;
      const headOffset = target.sourceSpan.from + boundedHead;
      requestSourceSelection({
        from: Math.min(anchorOffset, headOffset),
        to: Math.max(anchorOffset, headOffset),
        anchor: anchorOffset,
        head: headOffset,
        sourceId: target.sourceId,
        focus: true
      });
      setTextEditingSession({
        sourceId: target.sourceId,
        anchorIndex: boundedAnchor,
        headIndex: boundedHead,
        anchorOffset: anchorOffset,
        headOffset: headOffset
      });
    },
    []
  );

  const beginTextSelectionDrag = useCallback(
    (
      event: ReactPointerEvent<SVGElement>,
      targetId: string,
      region: HitRegion | undefined
    ): boolean => {
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.button !== 0) {
        return false;
      }
      if (!svgResult || snapshot.source !== source) {
        return false;
      }
      const target = resolveEditableTextTarget(targetId, region);
      if (!target) {
        return false;
      }
      const svgPoint = clientToSvgPoint(event.clientX, event.clientY, interactionSvgRef.current);
      if (!svgPoint || !isPointInsideRectHitRegionContentBox(svgPoint, target.region)) {
        return false;
      }
      const prefixTable = resolvePrefixTableForTarget(target);
      const clickIndex = textIndexFromClient(
        event.clientX,
        event.clientY,
        {
          textLength: target.text.length,
          totalWidth: target.totalWidth,
          region: target.region
        },
        prefixTable
      );
      if (clickIndex == null) {
        return false;
      }

      dispatch({ type: "SELECT", id: targetId, additive: false });
      applyCanvasTextSelection(target, clickIndex, clickIndex);
      setDragState({
        kind: "text-select",
        pointerId: event.pointerId,
        sourceId: target.sourceId,
        sourceSpan: target.sourceSpan,
        textLength: target.text.length,
        totalWidth: target.totalWidth,
        fontSizePt: target.style.fontSize,
        rotation: target.region.rotation,
        cx: target.region.cx,
        cy: target.region.cy,
        width: target.region.width,
        height: target.region.height,
        anchorIndex: clickIndex,
        headIndex: clickIndex,
        prefixTable
      });
      setSnapLines([]);
      logSnapDebug({
        phase: "drag-start-text-select",
        snapshotMatchesSource: true,
        dragKind: "text-select",
        lines: []
      });
      return true;
    },
    [
      applyCanvasTextSelection,
      dispatch,
      logSnapDebug,
      resolveEditableTextTarget,
      resolvePrefixTableForTarget,
      setDragState,
      snapshot.source,
      source,
      svgResult,
      textIndexFromClient
    ]
  );

  const resolveEditableTextTargetById = useCallback(
    (targetId: string): EditableTextTarget | null => {
      for (const region of rectHitRegionsForTargetId(hitRegions, targetId)) {
        const target = resolveEditableTextTarget(targetId, region);
        if (target) {
          return target;
        }
      }
      return null;
    },
    [hitRegions, resolveEditableTextTarget]
  );

  const onElementPointerDown = useCallback(
    (event: ReactPointerEvent<SVGElement>, targetId: string, region?: HitRegion) => {
      if (!svgResult || toolMode !== "select" || event.button !== 0) return;
      const additiveSelection = event.shiftKey || event.ctrlKey || event.metaKey;

      viewportRef.current?.focus({ preventScroll: true });
      event.preventDefault();
      event.stopPropagation();

      if (beginTextSelectionDrag(event, targetId, region)) {
        return;
      }

      const alreadySelected = selectedElementIds.has(targetId);
      const isAdornmentTarget = targetId.startsWith("node-adornment:");
      setTextEditingSession(null);

      const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, svgResult.viewBox);
      if (!world) return;

      if (additiveSelection) {
        dispatch({ type: "SELECT", id: targetId, additive: true });
        return;
      }

      const draggedIds = alreadySelected && selectedElementIds.size > 0 ? [...selectedElementIds] : [targetId];
      if (!alreadySelected) {
        dispatch({ type: "SELECT", id: targetId, additive: false });
        if (isAdornmentTarget) {
          setSnapLines([]);
          return;
        }
      }

      if (draggedIds.some((id) => !draggableSourceIds.has(id))) {
        setSnapLines([]);
        return;
      }

      if (snapshot.source !== source) {
        setWarning("Wait for recompute to finish before dragging.");
        setSnapLines([]);
        logSnapDebug({
          phase: "drag-start-element",
          note: "blocked: snapshot/source mismatch",
          snapshotMatchesSource: false,
          dragKind: "element",
          rawPoint: world,
          lines: []
        });
        return;
      }

      const snapContext = snapshot.scene
        ? buildSnapContext({
            sceneElements: snapshot.scene.elements,
            selectedSourceIds: draggedIds,
            guides: snapGuideInput,
            settings: snapSettingsPatch,
            zoom: canvasTransform.scale,
            viewportWorld: viewportWorldBounds
          })
        : null;
      const initialSelection = snapshot.scene
        ? collectSelectionGeometry(snapshot.scene.elements, draggedIds)
        : null;
      const selectionAnchorRatio = initialSelection
        ? selectionAnchorRatioFromPoint(initialSelection.bounds, world)
        : null;
      setSnapLines([]);

      setDragState({
        kind: "element",
        pointerId: event.pointerId,
        elementIds: draggedIds,
        startWorld: world,
        snapContext,
        initialSelection,
        selectionAnchorRatio,
        historyMergeKey: makeMergeKey(
          "drag-element",
          draggedIds.slice().sort().join(","),
          event.pointerId
        )
      });
      logSnapDebug({
        phase: "drag-start-element",
        snapshotMatchesSource: true,
        dragKind: "element",
        context: snapContext,
        rawPoint: world,
        lines: []
      });
    },
    [
      beginTextSelectionDrag,
      canvasTransform.scale,
      dispatch,
      draggableSourceIds,
      logSnapDebug,
      setDragState,
      selectedElementIds,
      snapshot.scene,
      snapshot.source,
      source,
      svgResult,
      toolMode,
      snapGuideInput,
      snapSettingsPatch,
      viewportWorldBounds
    ]
  );

  const onElementDoubleClick = useCallback(
    (event: ReactMouseEvent<SVGElement>, targetId: string, region?: HitRegion) => {
      if (toolMode !== "select") return;

      const target = resolveEditableTextTarget(targetId, region);

      event.preventDefault();
      event.stopPropagation();
      viewportRef.current?.focus({ preventScroll: true });

      if (target) {
        const prefixTable = resolvePrefixTableForTarget(target);
        const clickIndex = textIndexFromClient(
          event.clientX,
          event.clientY,
          {
            textLength: target.text.length,
            totalWidth: target.totalWidth,
            region: target.region
          },
          prefixTable
        );
        if (clickIndex != null) {
          const wordRange = findWordRangeAtIndex(target.text, clickIndex);
          const startIndex = wordRange?.start ?? clickIndex;
          const endIndex = wordRange?.end ?? clickIndex;
          dispatch({ type: "SELECT", id: targetId, additive: false });
          applyCanvasTextSelection(target, startIndex, endIndex);
          return;
        }
      }

      const fallbackSpan = resolveFallbackTextSourceSpanForSourceId(targetId, hitRegions, sceneTextByRegionKey);
      if (!fallbackSpan) {
        return;
      }

      dispatch({ type: "SELECT", id: targetId, additive: false });
      requestSourceSelection({
        from: fallbackSpan.from,
        to: fallbackSpan.to,
        anchor: fallbackSpan.from,
        head: fallbackSpan.to,
        sourceId: targetId,
        focus: true
      });
      setTextEditingSession(null);
    },
    [
      applyCanvasTextSelection,
      dispatch,
      hitRegions,
      resolveEditableTextTarget,
      sceneTextByRegionKey,
      resolvePrefixTableForTarget,
      textIndexFromClient,
      toolMode
    ]
  );

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent<SVGElement>, handle: EditHandle) => {
      if (!svgResult || toolMode !== "select" || event.button !== 0) return;
      const additiveSelection = event.shiftKey || event.ctrlKey || event.metaKey;

      viewportRef.current?.focus({ preventScroll: true });
      event.preventDefault();
      event.stopPropagation();
      setTextEditingSession(null);
      setNodeAnchorOverlay(null);

      if (additiveSelection) {
        dispatch({ type: "SELECT", id: handle.sourceRef.sourceId, additive: true });
        return;
      }

      if (selectedElementIds.size !== 1 || !selectedElementIds.has(handle.sourceRef.sourceId)) {
        dispatch({ type: "SELECT", id: handle.sourceRef.sourceId, additive: false });
      }

      if (!dragCapability.draggableHandleIds.has(handle.id)) {
        setSnapLines([]);
        return;
      }

      if (snapshot.source !== source) {
        setWarning("Wait for recompute to finish before dragging.");
        setSnapLines([]);
        logSnapDebug({
          phase: "drag-start-handle",
          note: "blocked: snapshot/source mismatch",
          snapshotMatchesSource: false,
          dragKind: "handle",
          rawPoint: handle.world,
          lines: []
        });
        return;
      }

      const snapContext = snapshot.scene
        ? buildSnapContext({
            sceneElements: snapshot.scene.elements,
            selectedSourceIds: [handle.sourceRef.sourceId],
            guides: snapGuideInput,
            settings: snapSettingsPatch,
            zoom: canvasTransform.scale,
            viewportWorld: viewportWorldBounds
          })
        : null;
      setSnapLines([]);
      const handleCursor = getHandleCursor(handle, snapshot.scene, snapshot.editHandles);
      const gridResizeSnap = resolveGridResizeSnapForHandleDrag(
        handle,
        snapshot.editHandles,
        snapshot.parseResult?.figure.body
      );

      setDragState({
        kind: "handle",
        pointerId: event.pointerId,
        handleId: handle.id,
        sourceId: handle.sourceRef.sourceId,
        handleKind: handle.kind,
        cursor: handleCursor,
        lastKnownWorld: { ...handle.world },
        snapContext,
        gridResizeSnap,
        historyMergeKey: makeMergeKey("drag-handle", handle.id, event.pointerId),
        activeEndpointAnchor: null
      });
      logSnapDebug({
        phase: "drag-start-handle",
        snapshotMatchesSource: true,
        dragKind: "handle",
        context: snapContext,
        rawPoint: handle.world,
        lines: []
      });
    },
    [
      canvasTransform.scale,
      dispatch,
      dragCapability.draggableHandleIds,
      logSnapDebug,
      setDragState,
      setNodeAnchorOverlay,
      selectedElementIds,
      snapshot.editHandles,
      snapshot.parseResult,
      snapshot.scene,
      snapshot.source,
      source,
      svgResult,
      toolMode,
      snapGuideInput,
      snapSettingsPatch,
      viewportWorldBounds
    ]
  );

  const onResizeHandlePointerDown = useCallback(
    (event: ReactPointerEvent<SVGElement>, sourceId: string, role: ResizeRole, cursor: string) => {
      if (!svgResult || toolMode !== "select" || event.button !== 0) return;
      const additiveSelection = event.shiftKey || event.ctrlKey || event.metaKey;

      viewportRef.current?.focus({ preventScroll: true });
      event.preventDefault();
      event.stopPropagation();
      setTextEditingSession(null);

      if (additiveSelection) {
        dispatch({ type: "SELECT", id: sourceId, additive: true });
        return;
      }

      const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, svgResult.viewBox);
      if (!world) {
        return;
      }

      if (snapshot.source !== source) {
        setWarning("Wait for recompute to finish before dragging.");
        setSnapLines([]);
        logSnapDebug({
          phase: "drag-start-resize",
          note: "blocked: snapshot/source mismatch",
          snapshotMatchesSource: false,
          dragKind: "resize",
          rawPoint: world,
          lines: []
        });
        return;
      }

      if (selectedElementIds.size !== 1 || !selectedElementIds.has(sourceId)) {
        dispatch({ type: "SELECT", id: sourceId, additive: false });
      }

      const statements = snapshot.parseResult?.figure.body;
      const sourceElements = snapshot.scene?.elements.filter((element) => element.sourceRef.sourceId === sourceId) ?? [];
      const pathElement = sourceElements.find((element): element is ScenePath => element.kind === "Path");
      const pathShapeHint = pathElement ? resolveScenePathShapeHint(pathElement, statements, sourceId) : undefined;
      const isCircleResizeSource =
        pathShapeHint === "circle" || sourceElements.some((element) => element.kind === "Circle");
      const initialFrame = resolveResizeFrameForSource(
        snapshot.scene?.elements ?? [],
        snapshot.editHandles,
        sourceId,
        svgResult.viewBox,
        pathShapeHint
      );
      if (!initialFrame) {
        setWarning("Resize tooltip needs a resolvable resize frame.");
        return;
      }

      setSnapLines([]);
      setDragState({
        kind: "resize",
        pointerId: event.pointerId,
        elementId: sourceId,
        role,
        cursor: cursor || resizeCursorForRole(role),
        preserveAspectRatio: isCircleResizeSource ? 1 : ellipseAspectRatioForSource(snapshot.scene?.elements ?? [], sourceId),
        initialFrame,
        measurementMode: pathShapeHint === "rectangle" ? "opposite-corner" : "center",
        preserveAspectDuringResize: isCircleResizeSource,
        historyMergeKey: makeMergeKey("drag-resize", `${sourceId}:${role}`, event.pointerId)
      });
      logSnapDebug({
        phase: "drag-start-resize",
        snapshotMatchesSource: true,
        dragKind: "resize",
        rawPoint: world,
        lines: []
      });
    },
    [
      dispatch,
      logSnapDebug,
      selectedElementIds,
      setDragState,
      snapshot.scene,
      snapshot.source,
      source,
      svgResult,
      toolMode
    ]
  );

  const resolveRotateWriteTargetId = useCallback(
    (sourceId: string): string => {
      const statements = snapshot.parseResult?.figure.body;
      if (statements) {
        const statement = findPathStatementById(statements, sourceId);
        if (statement?.command === "node") {
          const inlineNode = statement.items.find((item) => item.kind === "Node");
          if (inlineNode && inlineNode.kind === "Node") {
            return inlineNode.id;
          }
        }
      }

      const sourceElements = snapshot.scene?.elements.filter((element) => element.sourceRef.sourceId === sourceId) ?? [];
      const preferredElements = sourceElements.filter((element) => element.kind !== "Text");
      const candidates = preferredElements.length > 0 ? preferredElements : sourceElements;
      let fallbackTargetId: string | null = null;
      for (const element of candidates) {
        const commandEntry = [...element.styleChain].reverse().find((entry) => entry.kind === "command");
        const targetId = commandEntry?.sourceRef?.sourceId?.trim();
        if (!targetId) {
          continue;
        }
        const resolvedTarget = resolvePropertyTarget(source, targetId);
        if (resolvedTarget.kind !== "found") {
          continue;
        }
        if (resolvedTarget.target.kind === "node-item") {
          return targetId;
        }
        if (resolvedTarget.target.options) {
          return targetId;
        }
        fallbackTargetId ??= targetId;
      }
      return fallbackTargetId ?? sourceId;
    },
    [snapshot.parseResult, snapshot.scene, source]
  );

  const onRotateHandlePointerDown = useCallback(
    (event: ReactPointerEvent<SVGElement>, sourceId: string, centerWorld: Point, cursor: string) => {
      if (!svgResult || toolMode !== "select" || event.button !== 0) return;

      viewportRef.current?.focus({ preventScroll: true });
      event.preventDefault();
      event.stopPropagation();
      setTextEditingSession(null);
      setNodeAnchorOverlay(null);

      const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, svgResult.viewBox);
      if (!world) {
        return;
      }

      if (snapshot.source !== source) {
        setWarning("Wait for recompute to finish before dragging.");
        setSnapLines([]);
        logSnapDebug({
          phase: "drag-start-rotate",
          note: "blocked: snapshot/source mismatch",
          snapshotMatchesSource: false,
          dragKind: "rotate",
          rawPoint: world,
          lines: []
        });
        return;
      }

      if (selectedElementIds.size !== 1 || !selectedElementIds.has(sourceId)) {
        dispatch({ type: "SELECT", id: sourceId, additive: false });
      }

      const rotateTargetId = resolveRotateWriteTargetId(sourceId);
      const resolvedRotateTarget = resolvePropertyTarget(source, rotateTargetId);
      const baseRotateDeg =
        resolvedRotateTarget.kind === "found"
          ? resolveRotateDegreesFromOptions(resolvedRotateTarget.target.options)
          : 0;

      setSnapLines([]);
      setDragState({
        kind: "rotate",
        pointerId: event.pointerId,
        elementId: rotateTargetId,
        cursor: cursor === "not-allowed" ? "not-allowed" : "grabbing",
        centerWorld,
        startPointerAngleDeg: angleDeg(centerWorld, world),
        baseRotateDeg,
        lastAppliedRotateDeg: baseRotateDeg,
        historyMergeKey: makeMergeKey("drag-rotate", sourceId, event.pointerId)
      });
      logSnapDebug({
        phase: "drag-start-rotate",
        snapshotMatchesSource: true,
        dragKind: "rotate",
        rawPoint: world,
        lines: []
      });
    },
    [
      dispatch,
      logSnapDebug,
      resolveRotateWriteTargetId,
      resolveRotateDegreesFromOptions,
      selectedElementIds,
      setDragState,
      setNodeAnchorOverlay,
      snapshot.source,
      source,
      svgResult,
      toolMode
    ]
  );

  const resolveWorldFromViewportClient = useCallback(
    (clientX: number, clientY: number): Point | null => {
      if (!svgResult) {
        return null;
      }
      const viewport = viewportRef.current;
      if (!viewport) {
        return null;
      }
      const rect = viewport.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      return viewportToWorldPoint(localX, localY, canvasTransform, svgResult.viewBox);
    },
    [canvasTransform, svgResult]
  );

  const startMarqueeSelection = useCallback(
    (pointerId: number, clientX: number, clientY: number, additiveSelection: boolean): boolean => {
      const world = resolveWorldFromViewportClient(clientX, clientY);
      if (!world) {
        if (!additiveSelection) {
          dispatch({ type: "CLEAR_SELECTION" });
        }
        return false;
      }

      dispatch({ type: "SET_HOVERED_ELEMENT", id: null });
      const nextMarquee: Extract<DragState, { kind: "marquee" }> = {
        kind: "marquee",
        pointerId,
        startWorld: world,
        currentWorld: world,
        additive: additiveSelection,
        baseSelectedIds: additiveSelection ? [...selectedElementIds] : []
      };
      setDragState(nextMarquee);
      setMarqueeDraft(nextMarquee);
      setSnapLines([]);
      logSnapDebug({
        phase: "marquee-start",
        snapshotMatchesSource: snapshot.source === source,
        dragKind: "marquee",
        rawPoint: world,
        lines: []
      });
      return true;
    },
    [
      dispatch,
      logSnapDebug,
      resolveWorldFromViewportClient,
      selectedElementIds,
      setDragState,
      snapshot.source,
      source
    ]
  );

  const openCanvasContextMenuAt = useCallback(
    (clientX: number, clientY: number, clickedSourceId: string | null) => {
      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }

      const rect = viewport.getBoundingClientRect();
      const resolution = resolveCanvasContextMenuTarget({
        source,
        toolMode,
        clickedSourceId,
        selectedElementIds
      });

      if (resolution.selectionAction.kind === "clear") {
        if (selectedElementIds.size > 0) {
          dispatch({ type: "CLEAR_SELECTION" });
        }
      } else if (resolution.selectionAction.kind === "select-only") {
        dispatch({ type: "SELECT", id: resolution.selectionAction.sourceId, additive: false });
      }

      setContextMenuState({
        target: resolution.target,
        anchorX: clientX - rect.left,
        anchorY: clientY - rect.top,
        clickedTargetId: clickedSourceId,
        clickedWorld:
          svgResult
            ? viewportToWorldPoint(clientX - rect.left, clientY - rect.top, canvasTransform, svgResult.viewBox)
            : null
      });
      viewport.focus({ preventScroll: true });
    },
    [canvasTransform, dispatch, selectedElementIds, source, svgResult, toolMode]
  );

  const onElementContextMenu = useCallback(
    (event: ReactMouseEvent<SVGElement>, sourceId: string) => {
      event.preventDefault();
      event.stopPropagation();
      openCanvasContextMenuAt(event.clientX, event.clientY, sourceId);
    },
    [openCanvasContextMenuAt]
  );

  const onCanvasContextMenu = useCallback(
    (event: ReactMouseEvent<SVGElement | HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setTextEditingSession(null);
      openCanvasContextMenuAt(event.clientX, event.clientY, null);
    },
    [openCanvasContextMenuAt]
  );

  const onViewportPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      viewportRef.current?.focus({ preventScroll: true });
      if (toolMode !== "select" || event.button !== 0 || event.target !== event.currentTarget) {
        return;
      }
      setTextEditingSession(null);
      const additiveSelection = event.shiftKey || event.ctrlKey || event.metaKey;
      if (startMarqueeSelection(event.pointerId, event.clientX, event.clientY, additiveSelection)) {
        event.preventDefault();
      }
    },
    [startMarqueeSelection, toolMode]
  );

  const onInteractionPointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      viewportRef.current?.focus({ preventScroll: true });
      setTextEditingSession(null);
      const additiveSelection = event.shiftKey || event.ctrlKey || event.metaKey;

      if (!svgResult) return;

      const canPan = event.button === 1 || (event.button === 0 && event.altKey);
      if (canPan) {
        setDragState({
          kind: "pan",
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startTransform: canvasTransform
        });
        event.preventDefault();
        return;
      }

      if (event.button === 0 && toolMode !== "select") {
        const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, svgResult.viewBox);
        if (!world) {
          return;
        }
        const drawDragKind: DragState["kind"] =
          toolMode === "addPath"
            ? "tool-path-segment"
            : toolMode === "addFreehand"
              ? "tool-freehand"
            : toolMode === "addBezier" && pendingBezier
              ? "tool-bezier-bend"
              : "tool-create";
        if (snapshot.source !== source) {
          setWarning("Wait for recompute to finish before starting a draw gesture.");
          setSnapLines([]);
          logSnapDebug({
            phase: "tool-start",
            note: "blocked: snapshot/source mismatch",
            snapshotMatchesSource: false,
            dragKind: drawDragKind,
            rawPoint: world,
            lines: []
          });
          return;
        }
        const shouldSnapToolStart = toolMode !== "addFreehand";
        const toolSnapContext = shouldSnapToolStart && snapshot.scene
          ? buildSnapContext({
              sceneElements: snapshot.scene.elements,
              selectedSourceIds: [],
              guides: snapGuideInput,
              settings: snapSettingsPatch,
              zoom: canvasTransform.scale,
              viewportWorld: viewportWorldBounds
            })
          : null;
        const startSnapResult = toolSnapContext && shouldSnapToolStart
          ? snapToolPointer({
              context: toolSnapContext,
              pointer: world,
              kind: toolMode === "addPath" ? "line-end" : "node",
              modifiers: { ctrlOrMeta: event.ctrlKey || event.metaKey }
            })
          : { snappedPoint: world, offset: undefined, lines: [] as SnapLine[] };
        const snappedStart = startSnapResult.snappedPoint ?? world;
        const lineToolStartAnchorSnap =
          toolMode === "addLine" || toolMode === "addArrow"
            ? resolveEndpointAnchorSnap({
                pointerWorld: world,
                zoom: toolSnapContext?.zoom ?? canvasTransform.scale,
                nodeAnchorTargets
              })
            : null;
        const startEndpointAnchor = lineToolStartAnchorSnap?.snappedAnchor ?? null;
        const resolvedStart = startEndpointAnchor?.world ?? snappedStart;

        setToolCursorWorld(resolvedStart);
        event.preventDefault();

        if (toolMode === "addFreehand") {
          const nextFreehandDraft = createFreehandToolDraft(resolvedStart, canvasTransform.scale);
          setPathDraft(null);
          setPathSegmentDraft(null);
          setToolDraft(null);
          setBezierBendDraft(null);
          setPendingBezier(null);
          setSnapLines([]);
          setNodeAnchorOverlay(null);
          setFreehandDraft(nextFreehandDraft);
          const nextFreehandDrag: Extract<DragState, { kind: "tool-freehand" }> = {
            kind: "tool-freehand",
            pointerId: event.pointerId,
            points: nextFreehandDraft.points,
            minSampleDistanceWorld: nextFreehandDraft.minSampleDistanceWorld
          };
          setDragState(nextFreehandDrag);
          logSnapDebug({
            phase: "tool-freehand-start",
            snapshotMatchesSource: true,
            dragKind: "tool-freehand",
            rawPoint: world,
            snappedPoint: resolvedStart,
            lines: []
          });
          return;
        }

        if (toolMode === "addPath") {
          const activeDraft = pathDraftRef.current;
          if (!activeDraft) {
            setPathDraft(createPathToolDraft(resolvedStart));
            setPathSegmentDraft(null);
            setToolDraft(null);
            setBezierBendDraft(null);
            setSnapLines(startSnapResult.lines);
            logSnapDebug({
              phase: "tool-path-start",
              snapshotMatchesSource: true,
              dragKind: null,
              context: toolSnapContext,
              rawPoint: world,
              snappedPoint: resolvedStart,
              offset: startSnapResult.offset,
              lines: startSnapResult.lines
            });
            return;
          }

          const closeRadiusWorld = pathToolCloseRadiusWorld(canvasTransform.scale);
          if (pathToolShouldClose(activeDraft, resolvedStart, closeRadiusWorld)) {
            finalizePathDraft(true);
            return;
          }

          const segmentStart = pathToolCurrentPoint(activeDraft);
          if (distanceSquared(segmentStart, resolvedStart) <= 1e-6) {
            setSnapLines(startSnapResult.lines);
            return;
          }

          const midpoint = {
            x: (segmentStart.x + resolvedStart.x) / 2,
            y: (segmentStart.y + resolvedStart.y) / 2
          };
          const nextPathSegmentDraft: Extract<DragState, { kind: "tool-path-segment" }> = {
            kind: "tool-path-segment",
            pointerId: event.pointerId,
            startWorld: segmentStart,
            endWorld: resolvedStart,
            startPointerWorld: resolvedStart,
            rawBendWorld: midpoint,
            bendWorld: midpoint,
            isBending: false,
            snapContext: toolSnapContext
          };
          setNodeAnchorOverlay(null);
          setToolDraft(null);
          setBezierBendDraft(null);
          setPathSegmentDraft(nextPathSegmentDraft);
          setDragState(nextPathSegmentDraft);
          setSnapLines([]);
          logSnapDebug({
            phase: "tool-path-segment-start",
            snapshotMatchesSource: true,
            dragKind: "tool-path-segment",
            context: toolSnapContext,
            rawPoint: world,
            snappedPoint: resolvedStart,
            offset: startSnapResult.offset,
            lines: startSnapResult.lines
          });
          return;
        }

        if (toolMode === "addBezier" && pendingBezier) {
          const bendSnap = toolSnapContext
            ? snapToolPointer({
                context: toolSnapContext,
                pointer: world,
                kind: "line-end",
                modifiers: { ctrlOrMeta: event.ctrlKey || event.metaKey }
              })
            : { snappedPoint: world, offset: undefined, lines: [] as SnapLine[] };
          const bendStart = bendSnap.snappedPoint ?? world;
          setToolCursorWorld(bendStart);
          setSnapLines([]);
          const nextBendDraft: Extract<DragState, { kind: "tool-bezier-bend" }> = {
            kind: "tool-bezier-bend",
            pointerId: event.pointerId,
            startWorld: pendingBezier.startWorld,
            endWorld: pendingBezier.endWorld,
            rawCurrentWorld: bendStart,
            currentWorld: bendStart,
            snapContext: toolSnapContext
          };
          setDragState(nextBendDraft);
          setBezierBendDraft(nextBendDraft);
          logSnapDebug({
            phase: "tool-bezier-bend-start",
            snapshotMatchesSource: true,
            dragKind: "tool-bezier-bend",
            context: toolSnapContext,
            rawPoint: world,
            snappedPoint: bendStart,
            offset: bendSnap.offset,
            lines: bendSnap.lines
          });
          return;
        }

        if (toolMode === "addNode") {
          const snapResult = toolSnapContext
              ? snapToolPointer({
                  context: toolSnapContext,
                  pointer: world,
                  kind: "node",
                  modifiers: { ctrlOrMeta: event.ctrlKey || event.metaKey }
                })
              : { snappedPoint: world, offset: undefined, lines: [] as SnapLine[] };
          const nodeAt = snapResult.snappedPoint ?? world;
          setSnapLines(snapResult.lines);
          logSnapDebug({
            phase: "tool-add-node",
            snapshotMatchesSource: true,
            dragKind: null,
            context: toolSnapContext,
            rawPoint: world,
            snappedPoint: nodeAt,
            offset: snapResult.offset,
            lines: snapResult.lines
          });
          queueSelectionForAddedElement(nodeAt);
          const ok = applyActionWithFeedback({
            kind: "addElement",
            template: { kind: "node" },
            at: nodeAt
          });
          if (!ok.sourceChanged) {
            pendingAddedSelectionRef.current = null;
          }
          if (ok.sourceChanged) {
            dispatch({ type: "SET_TOOL_MODE", mode: "select" });
            setToolDraft(null);
            setToolCursorWorld(null);
            setSnapLines([]);
          }
          return;
        }

        if (isToolCreateMode(toolMode)) {
          setSnapLines([]);
          const nextDraft: Extract<DragState, { kind: "tool-create" }> = {
            kind: "tool-create",
            pointerId: event.pointerId,
            toolMode,
            startWorld: resolvedStart,
            startEndpointAnchor,
            rawCurrentWorld: resolvedStart,
            currentWorld: resolvedStart,
            activeEndpointAnchor: null,
            snapContext: toolSnapContext
          };
          setNodeAnchorOverlay(
            lineToolStartAnchorSnap && lineToolStartAnchorSnap.visibleAnchors.length > 0
              ? lineToolStartAnchorSnap
              : null
          );
          setBezierBendDraft(null);
          setDragState(nextDraft);
          setToolDraft(nextDraft);
          logSnapDebug({
            phase: "tool-start",
            snapshotMatchesSource: true,
            dragKind: "tool-create",
            context: toolSnapContext,
            rawPoint: world,
            snappedPoint: resolvedStart,
            lines: []
          });
        }
        return;
      }

      if (toolMode === "select" && event.button === 0 && event.target === event.currentTarget) {
        if (startMarqueeSelection(event.pointerId, event.clientX, event.clientY, additiveSelection)) {
          event.preventDefault();
        }
      }
    },
    [
      applyActionWithFeedback,
      canvasTransform,
      dispatch,
      finalizePathDraft,
      logSnapDebug,
      queueSelectionForAddedElement,
      setDragState,
      setNodeAnchorOverlay,
      snapshot.scene,
      snapshot.source,
      source,
      svgResult,
      startMarqueeSelection,
      nodeAnchorTargets,
      pendingBezier,
      toolMode,
      snapGuideInput,
      snapSettingsPatch,
      viewportWorldBounds
    ]
  );

  const onInteractionPointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!svgResult || toolMode === "select") {
        setNodeAnchorOverlay(null);
        return;
      }
      if (pathSegmentDraft) {
        return;
      }

      const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, svgResult.viewBox);
      if (!world) {
        setNodeAnchorOverlay(null);
        return;
      }
      if (toolMode === "addFreehand") {
        setToolCursorWorld(world);
        setNodeAnchorOverlay(null);
        setSnapLines([]);
        logSnapDebug({
          phase: "tool-hover-move",
          snapshotMatchesSource: snapshot.source === source,
          dragKind: dragRef.current?.kind ?? null,
          rawPoint: world,
          lines: []
        });
        return;
      }
      if (!snapshot.scene || snapshot.source !== source) {
        setToolCursorWorld(world);
        setNodeAnchorOverlay(null);
        setSnapLines([]);
        logSnapDebug({
          phase: "tool-hover-move",
          note: !snapshot.scene ? "no scene available" : "stale snapshot/source mismatch",
          snapshotMatchesSource: snapshot.source === source,
          dragKind: null,
          rawPoint: world,
          lines: []
        });
        return;
      }

      const snapContext = buildSnapContext({
        sceneElements: snapshot.scene.elements,
        selectedSourceIds: [],
        guides: snapGuideInput,
        settings: snapSettingsPatch,
        zoom: canvasTransform.scale,
        viewportWorld: viewportWorldBounds
      });
      const snapped = snapToolPointer({
        context: snapContext,
        pointer: world,
        kind: toolMode === "addPath" ? "line-end" : "node",
        modifiers: { ctrlOrMeta: event.ctrlKey || event.metaKey }
      });
      const hoverEndpointAnchorOverlay =
        !toolDraft &&
        !bezierBendDraft &&
        !pathSegmentDraft &&
        (toolMode === "addLine" || toolMode === "addArrow")
          ? resolveEndpointAnchorSnap({
              pointerWorld: world,
              zoom: snapContext.zoom,
              nodeAnchorTargets
            })
          : null;
      const hoverEndpointAnchor = hoverEndpointAnchorOverlay?.snappedAnchor ?? null;
      setNodeAnchorOverlay(
        hoverEndpointAnchorOverlay && hoverEndpointAnchorOverlay.visibleAnchors.length > 0
          ? hoverEndpointAnchorOverlay
          : null
      );
      const closeCandidateWorld =
        toolMode === "addPath" &&
        pathDraft &&
        pathToolShouldClose(
          pathDraft,
          snapped.snappedPoint ?? world,
          pathToolCloseRadiusWorld(canvasTransform.scale)
        )
          ? pathDraft.startWorld
          : null;
      setToolCursorWorld(closeCandidateWorld ?? hoverEndpointAnchor?.world ?? snapped.snappedPoint ?? world);
      if (!toolDraft && !bezierBendDraft && !pathSegmentDraft) {
        setSnapLines(snapped.lines);
      }
      logSnapDebug({
        phase: "tool-hover-move",
        snapshotMatchesSource: true,
        dragKind: toolDraft ? "tool-create" : bezierBendDraft ? "tool-bezier-bend" : pathSegmentDraft ? "tool-path-segment" : null,
        context: snapContext,
        rawPoint: world,
        snappedPoint: snapped.snappedPoint ?? world,
        offset: snapped.offset,
        lines: snapped.lines
      });
    },
    [
      canvasTransform.scale,
      logSnapDebug,
      nodeAnchorTargets,
      snapshot.scene,
      snapshot.source,
      source,
      setNodeAnchorOverlay,
      svgResult,
      bezierBendDraft,
      pathDraft,
      pathSegmentDraft,
      toolDraft,
      toolMode,
      snapGuideInput,
      snapSettingsPatch,
      viewportWorldBounds
    ]
  );

  const onInteractionPointerLeave = useCallback(() => {
    if (toolMode === "select" || toolDraft || bezierBendDraft || pathSegmentDraft || freehandDraft) {
      return;
    }
    setNodeAnchorOverlay(null);
    setToolCursorWorld(null);
    setSnapLines([]);
  }, [bezierBendDraft, freehandDraft, pathSegmentDraft, setNodeAnchorOverlay, toolDraft, toolMode]);

  const onInteractionPointerEnter = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!svgResult || toolMode === "select") {
        setNodeAnchorOverlay(null);
        return;
      }
      if (pathSegmentDraft) {
        return;
      }
      const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, svgResult.viewBox);
      if (!world) {
        setNodeAnchorOverlay(null);
        return;
      }
      if (toolMode === "addFreehand") {
        setToolCursorWorld(world);
        setNodeAnchorOverlay(null);
        setSnapLines([]);
        logSnapDebug({
          phase: "tool-hover-enter",
          snapshotMatchesSource: snapshot.source === source,
          dragKind: dragRef.current?.kind ?? null,
          rawPoint: world,
          lines: []
        });
        return;
      }
      if (!snapshot.scene || snapshot.source !== source) {
        setToolCursorWorld(world);
        setNodeAnchorOverlay(null);
        setSnapLines([]);
        logSnapDebug({
          phase: "tool-hover-enter",
          note: !snapshot.scene ? "no scene available" : "stale snapshot/source mismatch",
          snapshotMatchesSource: snapshot.source === source,
          dragKind: null,
          rawPoint: world,
          lines: []
        });
        return;
      }

      const snapContext = buildSnapContext({
        sceneElements: snapshot.scene.elements,
        selectedSourceIds: [],
        guides: snapGuideInput,
        settings: snapSettingsPatch,
        zoom: canvasTransform.scale,
        viewportWorld: viewportWorldBounds
      });
      const snapped = snapToolPointer({
        context: snapContext,
        pointer: world,
        kind: toolMode === "addPath" ? "line-end" : "node",
        modifiers: { ctrlOrMeta: event.ctrlKey || event.metaKey }
      });
      const hoverEndpointAnchorOverlay =
        !toolDraft &&
        !bezierBendDraft &&
        !pathSegmentDraft &&
        (toolMode === "addLine" || toolMode === "addArrow")
          ? resolveEndpointAnchorSnap({
              pointerWorld: world,
              zoom: snapContext.zoom,
              nodeAnchorTargets
            })
          : null;
      const hoverEndpointAnchor = hoverEndpointAnchorOverlay?.snappedAnchor ?? null;
      setNodeAnchorOverlay(
        hoverEndpointAnchorOverlay && hoverEndpointAnchorOverlay.visibleAnchors.length > 0
          ? hoverEndpointAnchorOverlay
          : null
      );
      const closeCandidateWorld =
        toolMode === "addPath" &&
        pathDraft &&
        pathToolShouldClose(
          pathDraft,
          snapped.snappedPoint ?? world,
          pathToolCloseRadiusWorld(canvasTransform.scale)
        )
          ? pathDraft.startWorld
          : null;
      setToolCursorWorld(closeCandidateWorld ?? hoverEndpointAnchor?.world ?? snapped.snappedPoint ?? world);
      if (!toolDraft && !bezierBendDraft && !pathSegmentDraft) {
        setSnapLines(snapped.lines);
      }
      logSnapDebug({
        phase: "tool-hover-enter",
        snapshotMatchesSource: true,
        dragKind: toolDraft ? "tool-create" : bezierBendDraft ? "tool-bezier-bend" : pathSegmentDraft ? "tool-path-segment" : null,
        context: snapContext,
        rawPoint: world,
        snappedPoint: snapped.snappedPoint ?? world,
        offset: snapped.offset,
        lines: snapped.lines
      });
    },
    [
      canvasTransform.scale,
      logSnapDebug,
      nodeAnchorTargets,
      snapshot.scene,
      snapshot.source,
      source,
      setNodeAnchorOverlay,
      svgResult,
      bezierBendDraft,
      pathDraft,
      pathSegmentDraft,
      toolDraft,
      toolMode,
      snapGuideInput,
      snapSettingsPatch,
      viewportWorldBounds
    ]
  );

  const onViewportKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape" && contextMenuState) {
        setContextMenuState(null);
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (event.key === "Escape") {
        if (toolMode === "addPath") {
          finalizePathDraft(false);
          setWarning(null);
          event.preventDefault();
          return;
        }
        if (toolMode === "addFreehand") {
          setFreehandDraft(null);
          if (dragRef.current?.kind === "tool-freehand") {
            setDragState(null);
          }
          dispatch({ type: "SET_TOOL_MODE", mode: "select" });
          setToolCursorWorld(null);
          setWarning(null);
          setSnapLines([]);
          event.preventDefault();
          return;
        }

        if (toolMode !== "select") {
          dispatch({ type: "SET_TOOL_MODE", mode: "select" });
          setToolDraft(null);
          setBezierBendDraft(null);
          setPendingBezier(null);
          setToolCursorWorld(null);
        } else if (textEditingSession) {
          setTextEditingSession(null);
          event.preventDefault();
          return;
        }
        setMarqueeDraft(null);
        if (
          dragRef.current?.kind === "marquee" ||
          dragRef.current?.kind === "tool-create" ||
          dragRef.current?.kind === "tool-bezier-bend" ||
          dragRef.current?.kind === "tool-path-segment" ||
          dragRef.current?.kind === "tool-freehand"
        ) {
          setDragState(null);
        }
        dispatch({ type: "CLEAR_SELECTION" });
        setWarning(null);
        setSnapLines([]);
        event.preventDefault();
        return;
      }

      if ((event.key === "Delete" || event.key === "Backspace") && selectedElementIds.size > 0) {
        const selectedIds = [...selectedElementIds];
        const ok = applyActionWithFeedback(
          selectedIds.length === 1
            ? { kind: "deleteElement", elementId: selectedIds[0]! }
            : { kind: "deleteElements", elementIds: selectedIds }
        );
        if (ok.sourceChanged) {
          dispatch({ type: "CLEAR_SELECTION" });
        }
        event.preventDefault();
        return;
      }

      let axis: "x" | "y" | null = null;
      let direction: -1 | 1 = 1;
      const step = event.shiftKey ? NUDGE_STEP_SHIFT_PT : NUDGE_STEP_PT;
      if (event.key === "ArrowLeft") {
        axis = "x";
        direction = -1;
      }
      if (event.key === "ArrowRight") {
        axis = "x";
        direction = 1;
      }
      if (event.key === "ArrowUp") {
        axis = "y";
        direction = 1;
      }
      if (event.key === "ArrowDown") {
        axis = "y";
        direction = -1;
      }

      if (!axis) return;

      const selectedIds = [...selectedElementIds];
      if (selectedIds.length === 0) return;

      if (snapshot.source !== source) {
        setWarning("Wait for recompute to finish before nudging again.");
        logSnapDebug({
          phase: "keyboard-nudge",
          note: "blocked: snapshot/source mismatch",
          snapshotMatchesSource: false,
          dragKind: null,
          rawDelta: axis === "x" ? { x: direction * step, y: 0 } : { x: 0, y: direction * step },
          lines: []
        });
        event.preventDefault();
        return;
      }

      const sceneElements = snapshot.scene?.elements ?? [];
      if (sceneElements.length === 0) {
        return;
      }

      const selectedSet = new Set(selectedIds);
      const elementHandles = snapshot.editHandles.filter((handle) => selectedSet.has(handle.sourceRef.sourceId));
      const anchorHandle = selectNudgeAnchorHandle(elementHandles);
      const snapped = snapKeyboardNudge({
        anchor: anchorHandle?.world ?? null,
        axis,
        direction,
        step
      });
      const delta = snapped.snappedDelta ??
        (axis === "x" ? { x: direction * step, y: 0 } : { x: 0, y: direction * step });

      const moveAction: EditAction =
        selectedIds.length === 1
          ? {
              kind: "moveElement",
              elementId: selectedIds[0]!,
              delta
            }
          : {
              kind: "moveElements",
              elementIds: selectedIds,
              delta
            };

      applyActionWithFeedback(moveAction);
      setSnapLines(snapped.lines);
      logSnapDebug({
        phase: "keyboard-nudge",
        snapshotMatchesSource: true,
        dragKind: null,
        rawDelta: axis === "x" ? { x: direction * step, y: 0 } : { x: 0, y: direction * step },
        snappedDelta: delta,
        offset: snapped.offset,
        lines: snapped.lines
      });
      event.preventDefault();
    },
    [
      applyActionWithFeedback,
      contextMenuState,
      dispatch,
      finalizePathDraft,
      logSnapDebug,
      setDragState,
      selectedElementIds,
      snapshot.editHandles,
      snapshot.scene,
      snapshot.source,
      source,
      toolMode
    ]
  );

  const onViewportPaste = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) {
        return;
      }
      const svgFile = findSvgFileInDataTransfer(event.clipboardData);
      if (svgFile) {
        event.preventDefault();
        void svgFile.text().then((svgSource) => {
          const converted = convertSvgToScopeSnippet(svgSource);
          if (converted.kind === "failure") {
            setWarning(converted.message);
            return;
          }
          const scale = computeAutoScaleForImportedTikz(converted.tikzSource, snapshot.scene, snapshot.svg?.viewBox ?? null);
          const snippet = scale == null ? converted.snippet : buildScopeWrappedSnippet(converted.body, { scale });
          const pasted = pasteSnippetsWithOffset(
            {
              source,
              snapshotSource: snapshot.source,
              scene: snapshot.scene,
              editHandles: snapshot.editHandles,
              selectedElementIds,
              dispatch
            },
            [snippet]
          );
          if (!pasted) {
            setWarning("SVG import paste failed.");
          }
        });
        return;
      }
      event.preventDefault();
      void pasteSelectionFromClipboardData(
        {
          source,
          snapshotSource: snapshot.source,
          scene: snapshot.scene,
          editHandles: snapshot.editHandles,
          selectedElementIds,
          dispatch
        },
        event.clipboardData
      ).then((result) => {
        if (result.kind === "success") {
          return;
        }
        if (result.reason === "empty") {
          return;
        }
        if (result.reason === "invalid") {
          setWarning("Clipboard did not contain a valid TikZ payload.");
          return;
        }
        setWarning("Paste failed. Try copying again, then press Cmd/Ctrl+V while the canvas is focused.");
      });
    },
    [dispatch, selectedElementIds, snapshot.editHandles, snapshot.scene, snapshot.source, source]
  );

  const onViewportDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      const hasFile = dataTransferHasFilePayload(event.dataTransfer);
      if (!hasFile) {
        return;
      }
      event.preventDefault();
      if (findSvgFileInDataTransfer(event.dataTransfer)) {
        event.dataTransfer.dropEffect = "copy";
      }
    },
    []
  );

  const onViewportDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      const hasFile = dataTransferHasFilePayload(event.dataTransfer);
      if (!hasFile) {
        return;
      }
      event.preventDefault();
      const svgFile = findSvgFileInDataTransfer(event.dataTransfer);
      if (!svgFile) {
        return;
      }
      void svgFile.text().then((svgSource) => {
        const converted = convertSvgToScopeSnippet(svgSource);
        if (converted.kind === "failure") {
          setWarning(converted.message);
          return;
        }
        const scale = computeAutoScaleForImportedTikz(converted.tikzSource, snapshot.scene, snapshot.svg?.viewBox ?? null);
        const snippet = scale == null ? converted.snippet : buildScopeWrappedSnippet(converted.body, { scale });
        const pasted = pasteSnippetsWithOffset(
          {
            source,
            snapshotSource: snapshot.source,
            scene: snapshot.scene,
            editHandles: snapshot.editHandles,
            selectedElementIds,
            dispatch
          },
          [snippet]
        );
        if (!pasted) {
          setWarning("SVG import drop failed.");
        }
      });
    },
    [dispatch, selectedElementIds, snapshot.editHandles, snapshot.scene, snapshot.source, source]
  );

  const onViewportCopy = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) {
        return;
      }
      const copied = copySelectionToClipboardData(
        {
          source,
          snapshotSource: snapshot.source,
          scene: snapshot.scene,
          editHandles: snapshot.editHandles,
          selectedElementIds,
          dispatch
        },
        event.clipboardData,
        { pasteBehavior: "offset" }
      );
      if (!copied) {
        return;
      }
      event.preventDefault();
    },
    [dispatch, selectedElementIds, snapshot.editHandles, snapshot.scene, snapshot.source, source]
  );

  const onViewportCut = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented) {
        return;
      }
      const cut = cutSelectionToClipboardData(
        {
          source,
          snapshotSource: snapshot.source,
          scene: snapshot.scene,
          editHandles: snapshot.editHandles,
          selectedElementIds,
          dispatch
        },
        event.clipboardData
      );
      if (!cut) {
        return;
      }
      event.preventDefault();
    },
    [dispatch, selectedElementIds, snapshot.editHandles, snapshot.scene, snapshot.source, source]
  );

  useEffect(() => {
    const onModifierKeyChange = (event: KeyboardEvent) => {
      if (event.key !== "Shift") {
        return;
      }

      const drag = dragRef.current;
      if (!drag || drag.kind !== "tool-create") {
        return;
      }

      const nextWorld = resolveToolCreateCurrentWorld(
        drag.startWorld,
        drag.rawCurrentWorld,
        drag.toolMode,
        event.type === "keydown"
      );
      if (distanceSquared(nextWorld, drag.currentWorld) <= 1e-12) {
        return;
      }

      drag.currentWorld = nextWorld;
      setToolDraft({ ...drag });
      setToolCursorWorld(nextWorld);
    };

    window.addEventListener("keydown", onModifierKeyChange);
    window.addEventListener("keyup", onModifierKeyChange);
    return () => {
      window.removeEventListener("keydown", onModifierKeyChange);
      window.removeEventListener("keyup", onModifierKeyChange);
    };
  }, [setToolDraft]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateSize = () => {
      setViewportSize({
        width: viewport.clientWidth,
        height: viewport.clientHeight
      });
    };

    updateSize();

    const observer = new ResizeObserver(() => updateSize());
    observer.observe(viewport);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!showRulers) {
      setRulerAlignmentOffsets((current) => (current.topX === 0 && current.leftY === 0 ? current : { topX: 0, leftY: 0 }));
      return;
    }

    const viewport = viewportRef.current;
    const topRuler = topRulerRef.current;
    const leftRuler = leftRulerRef.current;
    if (!viewport || !topRuler || !leftRuler) {
      return;
    }

    const measure = () => {
      const viewportRect = viewport.getBoundingClientRect();
      const topRect = topRuler.getBoundingClientRect();
      const leftRect = leftRuler.getBoundingClientRect();
      const next = {
        topX: viewportRect.left - topRect.left,
        leftY: viewportRect.top - leftRect.top
      };
      setRulerAlignmentOffsets((current) => {
        if (Math.abs(current.topX - next.topX) < 1e-6 && Math.abs(current.leftY - next.leftY) < 1e-6) {
          return current;
        }
        return next;
      });
    };

    measure();

    const observer = new ResizeObserver(() => measure());
    observer.observe(viewport);
    observer.observe(topRuler);
    observer.observe(leftRuler);

    return () => {
      observer.disconnect();
    };
  }, [showRulers]);

  useEffect(() => {
    canvasTransformRef.current = canvasTransform;
  }, [canvasTransform]);

  useEffect(() => {
    selectedElementIdsRef.current = selectedElementIds;
  }, [selectedElementIds]);

  useEffect(() => {
    svgResultRef.current = svgResult;
  }, [svgResult]);

  useEffect(() => {
    fitToContentModeActiveRef.current = fitToContentModeActive;
  }, [fitToContentModeActive]);

  useEffect(() => {
    sourceBoundsRef.current = sourceBounds;
  }, [sourceBounds]);

  useEffect(() => {
    liveResizeFramesRef.current = resizeFramesBySource;
  }, [resizeFramesBySource]);

  useEffect(() => {
    if (!svgResult) {
      previousViewBoxRef.current = null;
      return;
    }

    const previous = previousViewBoxRef.current;
    previousViewBoxRef.current = svgResult.viewBox;
    if (!previous) return;

    const sameX = Math.abs(previous.x - svgResult.viewBox.x) < 1e-6;
    const sameY = Math.abs(previous.y - svgResult.viewBox.y) < 1e-6;
    const sameW = Math.abs(previous.width - svgResult.viewBox.width) < 1e-6;
    const sameH = Math.abs(previous.height - svgResult.viewBox.height) < 1e-6;
    if (sameX && sameY && sameW && sameH) return;

    if (activeCanvasDragKind) {
      setDragPatchMode("full");
    }

    const currentTransform = canvasTransformRef.current;
    const scale = currentTransform.scale;

    // Keep world coordinates stationary on screen when the SVG viewBox expands/shifts.
    const translateX = currentTransform.translateX + (svgResult.viewBox.x - previous.x) * scale;
    const translateY =
      currentTransform.translateY +
      ((previous.y + previous.height) - (svgResult.viewBox.y + svgResult.viewBox.height)) * scale;

    dispatch({
      type: "SET_CANVAS_TRANSFORM",
      transform: { translateX, translateY, scale }
    });
  }, [activeCanvasDragKind, dispatch, svgResult]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    // Safari trackpad pinch uses gesturestart/change/end events.
    // We use this flag to skip the companion ctrlKey wheel events that
    // some Safari versions also fire, avoiding double application of zoom.
    let inGesture = false;
    let lastGestureScale = 1;

    const onWheel = (event: WheelEvent) => {
      if (inGesture) return;
      const currentSvg = svgResultRef.current;
      if (!currentSvg) return;
      const currentTransform = canvasTransformRef.current;

      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        event.stopPropagation();
      }

      const rect = viewport.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;

      if (event.ctrlKey || event.metaKey) {
        if (fitToContentModeActiveRef.current) {
          setFitToContentModeActive(false);
        }
        const deltaModeFactor =
          event.deltaMode === 1
            ? 16
            : event.deltaMode === 2
              ? Math.max(1, viewport.clientHeight)
              : 1;
        const zoomFactor = Math.exp(-event.deltaY * deltaModeFactor * zoomSpeed);
        const nextScale = clamp(currentTransform.scale * zoomFactor, MIN_SCALE, MAX_SCALE);
        const svgPoint = viewportToSvgPoint(localX, localY, currentTransform, currentSvg.viewBox);
        const translateX = localX - (svgPoint.x - currentSvg.viewBox.x) * nextScale;
        const translateY = localY - (svgPoint.y - currentSvg.viewBox.y) * nextScale;

        dispatch({
          type: "SET_CANVAS_TRANSFORM",
          transform: { translateX, translateY, scale: nextScale }
        });
        return;
      }

      dispatch({
        type: "SET_CANVAS_TRANSFORM",
        transform: {
          translateX: currentTransform.translateX - event.deltaX,
          translateY: currentTransform.translateY - event.deltaY,
          scale: currentTransform.scale
        }
      });
    };

    const onGestureStart = (event: Event) => {
      event.preventDefault();
      inGesture = true;
      lastGestureScale = 1;
    };

    const onGestureChange = (event: Event) => {
      event.preventDefault();
      const currentSvg = svgResultRef.current;
      if (!currentSvg) return;
      const currentTransform = canvasTransformRef.current;
      // GestureEvent is Safari-specific; cast to access scale/clientX/clientY.
      const ge = event as Event & { scale: number; clientX: number; clientY: number };
      const deltaScale = ge.scale / lastGestureScale;
      lastGestureScale = ge.scale;
      const nextScale = clamp(currentTransform.scale * deltaScale, MIN_SCALE, MAX_SCALE);
      const rect = viewport.getBoundingClientRect();
      const localX = ge.clientX - rect.left;
      const localY = ge.clientY - rect.top;
      const svgPoint = viewportToSvgPoint(localX, localY, currentTransform, currentSvg.viewBox);
      const translateX = localX - (svgPoint.x - currentSvg.viewBox.x) * nextScale;
      const translateY = localY - (svgPoint.y - currentSvg.viewBox.y) * nextScale;
      if (fitToContentModeActiveRef.current) {
        setFitToContentModeActive(false);
      }
      dispatch({
        type: "SET_CANVAS_TRANSFORM",
        transform: { translateX, translateY, scale: nextScale }
      });
    };

    const onGestureEnd = (event: Event) => {
      event.preventDefault();
      inGesture = false;
    };

    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("gesturestart", onGestureStart, { passive: false });
    viewport.addEventListener("gesturechange", onGestureChange, { passive: false });
    viewport.addEventListener("gestureend", onGestureEnd, { passive: false });

    return () => {
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("gesturestart", onGestureStart);
      viewport.removeEventListener("gesturechange", onGestureChange);
      viewport.removeEventListener("gestureend", onGestureEnd);
    };
  }, [dispatch, zoomSpeed]);

  useEffect(() => {
    function clearGuideDragState() {
      if (!guideDragRef.current) {
        return;
      }
      guideDragRef.current = null;
      setGuidePreview(null);
      document.body.classList.remove("is-dragging-guide-horizontal");
      document.body.classList.remove("is-dragging-guide-vertical");
    }

    function onPointerMove(event: PointerEvent) {
      const drag = guideDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }

      const guide = resolveGuideFromClient(drag.orientation, event.clientX, event.clientY);
      if (!guide) {
        drag.overViewport = false;
        drag.overDeleteZone = isPointerOverGuideDeleteZone(drag.orientation, event.clientX, event.clientY);
        setGuidePreview(
          drag.source === "guide"
            ? {
                orientation: drag.orientation,
                value: drag.value,
                hideValue: drag.sourceValue,
                visible: false
              }
            : null
        );
        return;
      }
      drag.value = guide.value;
      drag.overViewport = guide.overViewport;
      drag.overDeleteZone = isPointerOverGuideDeleteZone(drag.orientation, event.clientX, event.clientY);
      setGuidePreview(
        drag.source === "guide"
          ? {
              orientation: drag.orientation,
              value: guide.value,
              hideValue: drag.sourceValue,
              visible: guide.overViewport && !drag.overDeleteZone
            }
          : guide.overViewport
            ? {
                orientation: drag.orientation,
                value: guide.value
              }
            : null
      );
    }

    function onPointerUp(event: PointerEvent) {
      const drag = guideDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }

      const guide = resolveGuideFromClient(drag.orientation, event.clientX, event.clientY);
      if (guide) {
        drag.value = guide.value;
        drag.overViewport = guide.overViewport;
      } else {
        drag.overViewport = false;
      }
      drag.overDeleteZone = isPointerOverGuideDeleteZone(drag.orientation, event.clientX, event.clientY);

      if (drag.source === "ruler") {
        if (drag.overViewport) {
          setGuides((current) => addGuide(current, drag.orientation, drag.value));
        }
      } else if (drag.source === "guide" && drag.sourceValue != null) {
        if (drag.overDeleteZone) {
          setGuides((current) => removeGuide(current, drag.orientation, drag.sourceValue!));
        } else if (drag.overViewport) {
          setGuides((current) =>
            moveGuide(current, drag.orientation, drag.sourceValue!, drag.value)
          );
        }
      }
      clearGuideDragState();
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      clearGuideDragState();
    };
  }, [isPointerOverGuideDeleteZone, resolveGuideFromClient]);

  useEffect(() => {
    if (showGuides) {
      return;
    }
    guideDragRef.current = null;
    setGuidePreview(null);
    document.body.classList.remove("is-dragging-guide-horizontal");
    document.body.classList.remove("is-dragging-guide-vertical");
  }, [showGuides]);

  useEffect(() => {
    if (!warning) return;

    const timer = window.setTimeout(() => setWarning(null), 3200);
    return () => window.clearTimeout(timer);
  }, [warning]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const body = document.body;
    body.classList.remove(CANVAS_DRAG_CURSOR_LOCK_CLASS);
    body.style.removeProperty("--canvas-drag-cursor");

    if (!dragCursorLock) {
      return;
    }

    body.classList.add(CANVAS_DRAG_CURSOR_LOCK_CLASS);
    body.style.setProperty("--canvas-drag-cursor", dragCursorLock);
    return () => {
      body.classList.remove(CANVAS_DRAG_CURSOR_LOCK_CLASS);
      body.style.removeProperty("--canvas-drag-cursor");
    };
  }, [dragCursorLock]);

  useEffect(() => {
    if (showDevPanel) {
      return;
    }
    snapDebugDragRef.current = null;
    document.body.classList.remove("is-dragging-snap-debug");
    document.body.classList.remove("is-resizing-snap-debug");
    setSnapDebug(null);
  }, [showDevPanel]);

  useEffect(() => {
    if (snapshot.source === source) {
      return;
    }
    setSnapLines([]);
  }, [snapshot.source, source]);

  useEffect(() => {
    if (activeCanvasDragKind) {
      return;
    }
    setDragPatchMode("partial");
    setDragAffectedSourceIds(null);
  }, [activeCanvasDragKind]);

  useEffect(() => {
    if (!activeCanvasDragKind || dragPatchMode === "full") {
      return;
    }
    const dependencies = snapshot.semanticResult?.dependencies;
    if (!dependencies) {
      return;
    }
    const changedSourceIds = lastEditChangedSourceIds;
    if (!changedSourceIds || changedSourceIds.length === 0) {
      setDragAffectedSourceIds(null);
      return;
    }

    const invalidation = collectGeometryInvalidation(dependencies, {
      changedSourceIds
    });
    if (invalidation.reachedOpaque) {
      setDragPatchMode("full");
      setDragAffectedSourceIds(null);
      return;
    }
    setDragAffectedSourceIds(invalidation.affectedSourceIds.length > 0 ? invalidation.affectedSourceIds : null);
  }, [
    activeCanvasDragKind,
    dragPatchMode,
    lastEditChangeToken,
    lastEditChangedSourceIds,
    snapshot.semanticResult
  ]);

  useEffect(() => {
    if (toolMode === "select") {
      setPathDraft(null);
      setFreehandDraft(null);
      setPathSegmentDraft(null);
      setToolDraft(null);
      setBezierBendDraft(null);
      setPendingBezier(null);
      setToolCursorWorld(null);
      setSnapLines([]);
      if (
        dragRef.current?.kind === "tool-create" ||
        dragRef.current?.kind === "tool-bezier-bend" ||
        dragRef.current?.kind === "tool-path-segment" ||
        dragRef.current?.kind === "tool-freehand"
      ) {
        setDragState(null);
      }
      return;
    }

    if (toolMode !== "addPath") {
      setPathDraft(null);
      setPathSegmentDraft(null);
      if (dragRef.current?.kind === "tool-path-segment") {
        setDragState(null);
      }
    }

    if (toolMode !== "addFreehand") {
      setFreehandDraft(null);
      if (dragRef.current?.kind === "tool-freehand") {
        setDragState(null);
      }
    }

    if (toolMode !== "addBezier") {
      setPendingBezier(null);
      setBezierBendDraft(null);
      if (dragRef.current?.kind === "tool-bezier-bend") {
        setDragState(null);
      }
    }

    setTextEditingSession(null);
    if (dragRef.current?.kind === "marquee") {
      setDragState(null);
      setMarqueeDraft(null);
    } else if (dragRef.current?.kind === "text-select") {
      setDragState(null);
    }
  }, [setDragState, toolMode]);

  // End text editing session when the edited element is deselected.
  useEffect(() => {
    if (!textEditingSession) {
      return;
    }
    if (!selectedElementIds.has(textEditingSession.sourceId)) {
      setTextEditingSession(null);
    }
  }, [selectedElementIds, textEditingSession]);

  // Listen to CodeMirror selection changes and update the text editing session.
  // We read the current session from a ref to avoid re-registering the listener on every session change.
  const textEditingSessionRef = useRef(textEditingSession);
  textEditingSessionRef.current = textEditingSession;

  useEffect(() => {
    const handleSelectionChanged = (rawEvent: Event) => {
      if (toolMode !== "select") {
        return;
      }
      const event = rawEvent as CustomEvent<SourceSelectionChangeDetail>;
      const detail = event.detail;
      const sourceId = detail?.sourceId?.trim() ?? "";
      if (!sourceId) {
        setTextEditingSession(null);
        return;
      }

      const anchorOffset = Math.floor(detail.anchor);
      const headOffset = Math.floor(detail.head);
      const currentSession = textEditingSessionRef.current;

      // If we already have an active session for this sourceId, update indices
      // without re-validating against the snapshot. This keeps the session alive
      // during recompute gaps when the source has changed but the snapshot
      // hasn't caught up yet (so resolveEditableTextTarget would fail).
      if (currentSession && currentSession.sourceId === sourceId) {
        const target = resolveEditableTextTargetForSelectionOffsets(
          sourceId,
          anchorOffset,
          headOffset,
          hitRegions,
          resolveEditableTextTarget
        );
        if (target) {
          const offsetsInRange =
            anchorOffset >= target.sourceSpan.from &&
            anchorOffset <= target.sourceSpan.to &&
            headOffset >= target.sourceSpan.from &&
            headOffset <= target.sourceSpan.to;
          if (offsetsInRange) {
            setTextEditingSession({
              sourceId,
              anchorIndex: clamp(anchorOffset - target.sourceSpan.from, 0, target.text.length),
              headIndex: clamp(headOffset - target.sourceSpan.from, 0, target.text.length),
              anchorOffset,
              headOffset
            });
            return;
          }
        }
        // Target can't be resolved (snapshot stale) — stash the latest offsets
        // so the derivation effect can re-derive indices when the snapshot catches up.
        setTextEditingSession((prev) =>
          prev && prev.sourceId === sourceId
            ? { ...prev, anchorOffset: anchorOffset, headOffset: headOffset }
            : prev
        );
        return;
      }

      // No active session — only create one if the target fully validates.
      const target = resolveEditableTextTargetForSelectionOffsets(
        sourceId,
        anchorOffset,
        headOffset,
        hitRegions,
        resolveEditableTextTarget
      );
      if (!target) {
        return;
      }
      const offsetsInRange =
        anchorOffset >= target.sourceSpan.from &&
        anchorOffset <= target.sourceSpan.to &&
        headOffset >= target.sourceSpan.from &&
        headOffset <= target.sourceSpan.to;
      if (!offsetsInRange) {
        return;
      }

      setTextEditingSession({
        sourceId,
        anchorIndex: clamp(anchorOffset - target.sourceSpan.from, 0, target.text.length),
        headIndex: clamp(headOffset - target.sourceSpan.from, 0, target.text.length),
        anchorOffset,
        headOffset
      });
    };

    window.addEventListener(SOURCE_SELECTION_CHANGED_EVENT, handleSelectionChanged as EventListener);
    return () => window.removeEventListener(SOURCE_SELECTION_CHANGED_EVENT, handleSelectionChanged as EventListener);
  }, [hitRegions, resolveEditableTextTarget, toolMode]);

  // Derive the text selection overlay from the editing session + current snapshot geometry.
  // During recompute gaps (snapshot.source !== source), we leave the last overlay in place.
  useEffect(() => {
    if (!textEditingSession) {
      setTextSelectionOverlay(null);
      return;
    }
    // Find the target in the current snapshot. If the snapshot is stale, the target
    // may not resolve (source spans won't match). In that case, keep the existing overlay.
    const target = resolveEditableTextTargetById(textEditingSession.sourceId);
    if (!target) {
      // Can't resolve — snapshot is likely stale. Preserve existing overlay.
      return;
    }
    // If we have absolute source offsets (from CodeMirror), re-derive text-relative
    // indices from them. This handles the case where the user typed and the session
    // has stale text-relative indices but fresh absolute offsets.
    let anchorIndex = textEditingSession.anchorIndex;
    let headIndex = textEditingSession.headIndex;
    if (textEditingSession.anchorOffset != null && textEditingSession.headOffset != null) {
      const ao = textEditingSession.anchorOffset;
      const ho = textEditingSession.headOffset;
      if (
        ao >= target.sourceSpan.from && ao <= target.sourceSpan.to &&
        ho >= target.sourceSpan.from && ho <= target.sourceSpan.to
      ) {
        anchorIndex = clamp(ao - target.sourceSpan.from, 0, target.text.length);
        headIndex = clamp(ho - target.sourceSpan.from, 0, target.text.length);
      }
    }

    const prefixTable = resolvePrefixTableForTarget(target);
    setTextSelectionOverlay({
      sourceId: textEditingSession.sourceId,
      textLength: target.text.length,
      totalWidth: target.totalWidth,
      fontSizePt: target.style.fontSize,
      startIndex: clamp(anchorIndex, 0, target.text.length),
      endIndex: clamp(headIndex, 0, target.text.length),
      rotation: target.region.rotation,
      cx: target.region.cx,
      cy: target.region.cy,
      width: target.region.width,
      height: target.region.height,
      prefixTable
    });
  }, [textEditingSession, resolveEditableTextTargetById, resolvePrefixTableForTarget]);

  useEffect(() => {
    if (!pendingAdornmentTextEditTargetId) {
      return;
    }
    if (snapshot.source !== source || !selectedElementIds.has(pendingAdornmentTextEditTargetId)) {
      return;
    }
    const target = resolveEditableTextTargetById(pendingAdornmentTextEditTargetId);
    if (!target) {
      return;
    }
    applyCanvasTextSelection(target, 0, target.text.length);
    setPendingAdornmentTextEditTargetId(null);
  }, [
    applyCanvasTextSelection,
    pendingAdornmentTextEditTargetId,
    resolveEditableTextTargetById,
    selectedElementIds,
    snapshot.source,
    source
  ]);

  useEffect(() => {
    const pending = pendingAddedSelectionRef.current;
    if (!pending) {
      return;
    }
    if (snapshot.source !== source) {
      return;
    }

    const sceneElements = snapshot.scene?.elements ?? [];
    const newSourceIds = collectNewSourceIds(sceneElements, pending.beforeIds);
    pendingAddedSelectionRef.current = null;
    if (newSourceIds.length === 0) {
      return;
    }

    const selectedId =
      newSourceIds.length === 1
        ? newSourceIds[0]!
        : pickClosestSourceId(sceneElements, newSourceIds, pending.preferredWorld);

    dispatch({ type: "SELECT", id: selectedId, additive: false });
  }, [dispatch, snapshot.scene, snapshot.source, source]);

  useEffect(() => {
    if (!fitToContentModeActive) {
      return;
    }
    if (!svgResult) {
      return;
    }
    if (activeCanvasDragKind || activeSourceScrubSourceId) {
      return;
    }
    if (snapshot.source !== source) {
      return;
    }
    if (viewportSize.width <= 0 || viewportSize.height <= 0) {
      return;
    }
    fitToContent();
  }, [
    activeCanvasDragKind,
    activeSourceScrubSourceId,
    fitToContent,
    fitToContentModeActive,
    lastEditChangeToken,
    snapshot.source,
    source,
    svgResult,
    viewportSize.height,
    viewportSize.width
  ]);

  useCanvasDragController({
    applyActionWithFeedback,
    dispatch,
    logSnapDebug,
    queueSelectionForAddedElement,
    snapshotSource: snapshot.source,
    snapshotScene: snapshot.scene,
    snapshotEditHandles: snapshot.editHandles,
    nodeAnchorTargets,
    source,
    svgResult,
    dragRef,
    svgResultRef,
    interactionSvgRef,
    liveResizeFramesRef,
    selectedElementIdsRef,
    sourceBoundsRef,
    pendingAddedSelectionRef,
    setDragState,
    setSnapLines,
    setToolDraft,
    setBezierBendDraft,
    setPathSegmentDraft,
    commitPathToolSegment,
    appendFreehandSamplePoint,
    finalizeFreehandDraft,
    setPendingBezier,
    setToolCursorWorld,
    setMarqueeDraft,
    setNodeAnchorOverlay,
    setDragTooltip,
    setWarning,
    setTextEditingSession,
    textIndexFromClient
  });

  useEffect(() => () => setActiveCanvasDragKind(null), [setActiveCanvasDragKind]);

  const svgDiffHints = useMemo<SvgDiffHints | undefined>(() => {
    if (!activeCanvasDragKind || dragPatchMode !== "partial") {
      return undefined;
    }
    if (!dragAffectedSourceIds || dragAffectedSourceIds.length === 0) {
      return undefined;
    }
    return {
      affectedSourceIds: dragAffectedSourceIds
    };
  }, [activeCanvasDragKind, dragAffectedSourceIds, dragPatchMode]);

  const forceSvgReplaceAll = activeCanvasDragKind != null && dragPatchMode === "full";

  const onSvgPatchFallback = useCallback(
    (reason: "replaceDefs" | "replaceAll" | "patch-failure") => {
      if (!activeCanvasDragKind) {
        return;
      }
      setDragPatchMode("full");
      if (reason === "patch-failure") {
        setWarning("SVG patching invariant failed; using full updates for this drag.");
      }
    },
    [activeCanvasDragKind]
  );

  const handleHalfSize = (handleSizePx / 2) / Math.max(canvasTransform.scale, 1e-3);
  const handleStrokeWidth = 1.2 / Math.max(canvasTransform.scale, 1e-3);
  const curveControlStrokeWidth = 1.1 / Math.max(canvasTransform.scale, 1e-3);
  const selectionStrokeWidth = 1.1 / Math.max(canvasTransform.scale, 1e-3);
  const selectionDragStrokeWidth = 12 / Math.max(canvasTransform.scale, 1e-3);
  const gridMinorStrokeWidth = 0.6 / Math.max(canvasTransform.scale, 1e-3);
  const gridMajorStrokeWidth = 0.9 / Math.max(canvasTransform.scale, 1e-3);
  const guideStrokeWidth = 1 / Math.max(canvasTransform.scale, 1e-3);
  const guideHitStrokeWidth = 12 / Math.max(canvasTransform.scale, 1e-3);
  const snapStrokeWidth = 1 / Math.max(canvasTransform.scale, 1e-3);
  const snapCrossSize = 3 / Math.max(canvasTransform.scale, 1e-3);
  const textSelectionVisual = useMemo(() => {
    if (!textSelectionOverlay) {
      return null;
    }
    if (textSelectionOverlay.textLength < 0 || textSelectionOverlay.totalWidth <= 0 || textSelectionOverlay.width <= 0) {
      return null;
    }
    const unitsStart = readPrefixUnitsFromTable(
      textSelectionOverlay.startIndex,
      textSelectionOverlay.textLength,
      textSelectionOverlay.totalWidth,
      textSelectionOverlay.prefixTable
    );
    const unitsEnd = readPrefixUnitsFromTable(
      textSelectionOverlay.endIndex,
      textSelectionOverlay.textLength,
      textSelectionOverlay.totalWidth,
      textSelectionOverlay.prefixTable
    );
    const leftEdge = textSelectionOverlay.cx - textSelectionOverlay.width / 2;
    const rightEdge = textSelectionOverlay.cx + textSelectionOverlay.width / 2;
    const mappedStart = clamp(leftEdge + (unitsStart / textSelectionOverlay.totalWidth) * textSelectionOverlay.width, leftEdge, rightEdge);
    const mappedEnd = clamp(leftEdge + (unitsEnd / textSelectionOverlay.totalWidth) * textSelectionOverlay.width, leftEdge, rightEdge);
    return {
      collapsed: textSelectionOverlay.startIndex === textSelectionOverlay.endIndex,
      caretAnimationKey: `${textSelectionOverlay.sourceId}:${textSelectionOverlay.startIndex}:${textSelectionOverlay.endIndex}`,
      x1: mappedStart,
      x2: mappedEnd,
      yTop: textSelectionOverlay.cy - textSelectionOverlay.height / 2,
      height: textSelectionOverlay.height,
      caretStrokeWidth: caretStrokeWidthInSvg(textSelectionOverlay.fontSizePt),
      rotation: textSelectionOverlay.rotation,
      cx: textSelectionOverlay.cx,
      cy: textSelectionOverlay.cy
    };
  }, [textSelectionOverlay]);

  return (
    <div className={css.panel}>
      <div className={[css.canvasGrid, showRulers ? "" : css.canvasGridNoRulers].filter(Boolean).join(" ")}>
        {showRulers ? <div className={css.rulerCorner}>cm</div> : null}

        {showRulers ? (
          <svg
            ref={topRulerRef}
            className={css.topRuler}
            viewBox={`0 0 ${Math.max(1, viewportSize.width)} ${RULER_SIZE}`}
            preserveAspectRatio="none"
            onPointerDown={onTopRulerPointerDown}
            onContextMenu={onCanvasContextMenu}
          >
            <line x1={0} y1={RULER_SIZE - 0.5} x2={viewportSize.width} y2={RULER_SIZE - 0.5} className={css.rulerAxis} />
            {rulers.topTicks.map((tick, index) => (
              <g key={`top-${index}`} transform={`translate(${tick.viewportPos},0)`}>
                <line
                  x1={0}
                  y1={RULER_SIZE}
                  x2={0}
                  y2={tick.major ? 5 : 11}
                  className={tick.major ? css.rulerTickMajor : css.rulerTickMinor}
                />
                {tick.label && (
                  <text className={css.rulerLabel} x={2} y={10}>
                    {tick.label}
                  </text>
                )}
              </g>
            ))}
          </svg>
        ) : null}

        {showRulers ? (
          <svg
            ref={leftRulerRef}
            className={css.leftRuler}
            viewBox={`0 0 ${RULER_SIZE} ${Math.max(1, viewportSize.height)}`}
            preserveAspectRatio="none"
            onPointerDown={onLeftRulerPointerDown}
            onContextMenu={onCanvasContextMenu}
          >
            <line x1={RULER_SIZE - 0.5} y1={0} x2={RULER_SIZE - 0.5} y2={viewportSize.height} className={css.rulerAxis} />
            {rulers.leftTicks.map((tick, index) => (
              <g key={`left-${index}`} transform={`translate(0,${tick.viewportPos})`}>
                <line
                  x1={RULER_SIZE}
                  y1={0}
                  x2={tick.major ? 5 : 11}
                  y2={0}
                  className={tick.major ? css.rulerTickMajor : css.rulerTickMinor}
                />
                {tick.label && (
                  <text className={css.rulerLabel} x={1} y={-2}>
                    {tick.label}
                  </text>
                )}
              </g>
            ))}
            <rect
              x={RULER_SIZE - LEFT_RULER_DRAG_SOURCE_WIDTH_PX}
              y={0}
              width={LEFT_RULER_DRAG_SOURCE_WIDTH_PX}
              height={Math.max(1, viewportSize.height)}
              className={css.leftRulerGuideStrip}
              fill="transparent"
            />
          </svg>
        ) : null}

        <div
          className={[css.viewport, toolMode === "select" ? "" : css.viewportTool].filter(Boolean).join(" ")}
          ref={viewportRef}
          data-canvas-viewport="true"
          tabIndex={0}
          onKeyDown={onViewportKeyDown}
          onCopy={onViewportCopy}
          onCut={onViewportCut}
          onPaste={onViewportPaste}
          onDragOver={onViewportDragOver}
          onDrop={onViewportDrop}
          onPointerDown={onViewportPointerDown}
          onContextMenu={(event) => {
            if (event.defaultPrevented) {
              return;
            }
            if (svgResult && event.target !== event.currentTarget) {
              return;
            }
            onCanvasContextMenu(event);
          }}
        >
          {assistantLockReason ? <div className={css.lockOverlay}>{assistantLockReason}</div> : null}
          {!svgResult ? (
            <div className={css.noSvg}>{snapshot.source ? "Computing…" : "No source"}</div>
          ) : (
            <div
              className={css.worldStage}
              style={{
                width: svgResult.viewBox.width * canvasTransform.scale,
                height: svgResult.viewBox.height * canvasTransform.scale,
                transform: `translate(${canvasTransform.translateX}px, ${canvasTransform.translateY}px)`
              }}
            >
              <CanvasSVGLayer
                model={snapshot.svgModel}
                diffHints={svgDiffHints}
                forceReplaceAll={forceSvgReplaceAll}
                onFallback={onSvgPatchFallback}
              />

              <svg
                ref={interactionSvgRef}
                className={[css.interactionLayer, toolMode === "select" ? "" : css.interactionLayerTool].filter(Boolean).join(" ")}
                viewBox={`${svgResult.viewBox.x} ${svgResult.viewBox.y} ${svgResult.viewBox.width} ${svgResult.viewBox.height}`}
                onPointerDown={onInteractionPointerDown}
                onPointerMove={onInteractionPointerMove}
                onPointerEnter={onInteractionPointerEnter}
                onPointerLeave={onInteractionPointerLeave}
                onContextMenu={onCanvasContextMenu}
              >
                {gridLines && (
                  <g className={css.gridOverlay}>
                    {gridLines.verticalMinor.map((x) => (
                      <line
                        key={`v-min-${x}`}
                        x1={x}
                        x2={x}
                        y1={gridLines.yMin}
                        y2={gridLines.yMax}
                        className={css.gridMinor}
                        strokeWidth={gridMinorStrokeWidth}
                      />
                    ))}
                    {gridLines.verticalMajor.map((x) => (
                      <line
                        key={`v-maj-${x}`}
                        x1={x}
                        x2={x}
                        y1={gridLines.yMin}
                        y2={gridLines.yMax}
                        className={css.gridMajor}
                        strokeWidth={gridMajorStrokeWidth}
                      />
                    ))}
                    {gridLines.horizontalMinor.map((y) => (
                      <line
                        key={`h-min-${y}`}
                        x1={visibleRanges?.worldMinX ?? svgResult.viewBox.x}
                        x2={visibleRanges?.worldMaxX ?? (svgResult.viewBox.x + svgResult.viewBox.width)}
                        y1={y}
                        y2={y}
                        className={css.gridMinor}
                        strokeWidth={gridMinorStrokeWidth}
                      />
                    ))}
                    {gridLines.horizontalMajor.map((y) => (
                      <line
                        key={`h-maj-${y}`}
                        x1={visibleRanges?.worldMinX ?? svgResult.viewBox.x}
                        x2={visibleRanges?.worldMaxX ?? (svgResult.viewBox.x + svgResult.viewBox.width)}
                        y1={y}
                        y2={y}
                        className={css.gridMajor}
                        strokeWidth={gridMajorStrokeWidth}
                      />
                    ))}
                  </g>
                )}

                {showGuides && (renderedGuides.vertical.length > 0 || renderedGuides.horizontal.length > 0) && (
                  <g className={css.guideOverlay}>
                    {renderedGuides.vertical.map((x) => (
                      <g key={`guide-v-${fmt(x)}`}>
                        <line
                          x1={x}
                          x2={x}
                          y1={visibleRanges?.svgMinY ?? svgResult.viewBox.y}
                          y2={visibleRanges?.svgMaxY ?? (svgResult.viewBox.y + svgResult.viewBox.height)}
                          className={css.guideLine}
                          strokeWidth={guideStrokeWidth}
                        />
                        <line
                          x1={x}
                          x2={x}
                          y1={visibleRanges?.svgMinY ?? svgResult.viewBox.y}
                          y2={visibleRanges?.svgMaxY ?? (svgResult.viewBox.y + svgResult.viewBox.height)}
                          className={`${css.guideHitLine} ${css.guideLineVertical}`}
                          strokeWidth={guideHitStrokeWidth}
                          onPointerDown={(event) => onGuidePointerDown(event, "vertical", x)}
                        />
                      </g>
                    ))}
                    {renderedGuides.horizontal.map((worldY) => {
                      const y = worldToSvgY(worldY, svgResult.viewBox);
                      return (
                        <g key={`guide-h-${fmt(worldY)}`}>
                          <line
                            x1={visibleRanges?.worldMinX ?? svgResult.viewBox.x}
                            x2={visibleRanges?.worldMaxX ?? (svgResult.viewBox.x + svgResult.viewBox.width)}
                            y1={y}
                            y2={y}
                            className={css.guideLine}
                            strokeWidth={guideStrokeWidth}
                          />
                          <line
                            x1={visibleRanges?.worldMinX ?? svgResult.viewBox.x}
                            x2={visibleRanges?.worldMaxX ?? (svgResult.viewBox.x + svgResult.viewBox.width)}
                            y1={y}
                            y2={y}
                            className={`${css.guideHitLine} ${css.guideLineHorizontal}`}
                            strokeWidth={guideHitStrokeWidth}
                            onPointerDown={(event) => onGuidePointerDown(event, "horizontal", worldY)}
                          />
                        </g>
                      );
                    })}
                  </g>
                )}

                <SnapOverlay
                  snapLines={snapLines}
                  viewBox={svgResult.viewBox}
                  snapStrokeWidth={snapStrokeWidth}
                  snapCrossSize={snapCrossSize}
                />

                <ToolPreviewOverlay
                  toolPreview={toolPreview}
                  scale={canvasTransform.scale}
                  handleStrokeWidth={handleStrokeWidth}
                  previewArrowPoints={previewArrowPoints}
                />

                <HitRegionLayer
                  hitRegions={hitRegions}
                  hoveredElementId={hoveredElementId}
                  toolMode={toolMode}
                  editableTextRegionKeys={editableTextRegionKeys}
                  draggableSourceIds={draggableSourceIds}
                  onElementPointerDown={onElementPointerDown}
                  onElementContextMenu={onElementContextMenu}
                  onElementDoubleClick={onElementDoubleClick}
                  onHoverChange={(id) => dispatch({ type: "SET_HOVERED_ELEMENT", id })}
                />

                <SelectionOverlay
                  marqueeBounds={marqueeBounds}
                  selectionBoxes={selectionBoxes}
                  adornmentHighlightBoxes={adornmentHighlightBoxes}
                  adornmentConnectors={selectedAdornmentConnectors}
                  selectionStrokeWidth={selectionStrokeWidth}
                  textSelectionVisual={textSelectionVisual}
                />

                <SelectionDragLayer
                  toolMode={toolMode}
                  selectionBoxes={selectionBoxes}
                  dragStrokeWidth={selectionDragStrokeWidth}
                  draggableSourceIds={matrixSelectionSourceIds}
                  onElementPointerDown={onElementPointerDown}
                  onElementContextMenu={onElementContextMenu}
                />

                <CurveControlOverlay
                  lines={curveControlLines}
                  viewBox={svgResult.viewBox}
                  strokeWidth={curveControlStrokeWidth}
                />

                <NodeAnchorOverlay
                  anchorOverlay={nodeAnchorOverlay}
                  viewBox={svgResult.viewBox}
                  strokeWidth={handleStrokeWidth}
                  radius={handleHalfSize}
                />

                {toolMode === "select" && (
                  <HandleOverlay
                    handleDisplays={handleDisplays}
                    handleHalfSize={handleHalfSize}
                    handleStrokeWidth={handleStrokeWidth}
                    onHandlePointerDown={onHandlePointerDown}
                    onElementPointerDown={onElementPointerDown}
                    onElementContextMenu={onElementContextMenu}
                    onResizeHandlePointerDown={onResizeHandlePointerDown}
                    onRotateHandlePointerDown={onRotateHandlePointerDown}
                  />
                )}
              </svg>
            </div>
          )}

          <CanvasContextMenu
            open={contextMenuState != null}
            anchor={{
              x: contextMenuState?.anchorX ?? 0,
              y: contextMenuState?.anchorY ?? 0
            }}
            target={contextMenuState?.target ?? "canvas-empty"}
            bindings={commandRuntime.bindings}
            containerRef={viewportRef}
            onClose={() => setContextMenuState(null)}
            onCommandRun={(commandId: AppMenuCommandId, origin) => {
              commandRuntime.runCommand(commandId, origin);
              setContextMenuState(null);
            }}
          />

          {dragTooltip ? (
            <RenderedTooltip
              open
              anchor={dragTooltip.anchor}
              boundary={
                viewportRef.current
                  ? {
                      left: viewportRef.current.getBoundingClientRect().left,
                      top: viewportRef.current.getBoundingClientRect().top,
                      right: viewportRef.current.getBoundingClientRect().right,
                      bottom: viewportRef.current.getBoundingClientRect().bottom
                    }
                  : null
              }
              content={
                <div
                  className={css.dragTooltipContent}
                  data-testid="canvas-drag-tooltip"
                  data-drag-tooltip-kind={dragTooltip.kind}
                >
                  {dragTooltip.rows.map((row) => (
                    <div
                      key={`${row.label}:${row.value}`}
                      className={css.dragTooltipRow}
                      data-testid="canvas-drag-tooltip-row"
                    >
                      <span className={css.dragTooltipLabel}>{row.label}:</span>
                      <span className={css.dragTooltipValue}>{row.value}</span>
                    </div>
                  ))}
                </div>
              }
              className={css.dragTooltip}
              data-testid="canvas-drag-tooltip-shell"
            />
          ) : null}

          {warning && (
            <RenderedTooltip content="Click to copy message" block>
              <div
                className={css.warningBar}
                onClick={copyWarningToClipboard}
                onKeyDown={onWarningBarKeyDown}
                role="button"
                tabIndex={0}
                aria-label="Warning message. Click to copy."
              >
                {warning}
              </div>
            </RenderedTooltip>
          )}
          {showDevPanel && (
            <div
              className={css.snapDebugOverlay}
              style={{
                left: snapDebugRect.left,
                top: snapDebugRect.top,
                width: snapDebugRect.width,
                height: snapDebugRect.height
              }}
            >
              <div className={css.snapDebugTitle} onPointerDown={onSnapDebugMovePointerDown}>
                Snap Debug (drag to move)
              </div>
              <pre className={css.snapDebugBody}>
                {snapDebug
                  ? JSON.stringify(snapDebug, null, 2)
                  : "Trigger a snap interaction to populate diagnostics."}
              </pre>
              <RenderedTooltip content="Drag to resize">
                <div
                  className={css.snapDebugResizeHandle}
                  onPointerDown={onSnapDebugResizePointerDown}
                />
              </RenderedTooltip>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

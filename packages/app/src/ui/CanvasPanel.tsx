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
import { CANVAS_CONTEXT_MENU_DEFINITION, type CanvasContextMenuTarget } from "../context-menu";
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
import { resolveEligibleExplicitPath } from "tikz-editor/edit/path-editing";
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
import { getActiveEditorPlatform } from "../platform/current";
import {
  requestSourceSelection,
} from "./source-sync";
import { buildHitRegions, type HitRegion } from "./canvas-panel/hit-regions";
import { computeDragCapability } from "./canvas-panel/drag-capability";
import { deriveCurveControlLines } from "./canvas-panel/curve-controls";
import { resolveBucketFillEdit } from "./canvas-panel/bucket-fill";
import { resolveEndpointAnchorSnap } from "./canvas-panel/endpoint-anchor-snap";
import {
  boundsFromPoints,
  collectSourceIdsInBounds,
  pickClosestSourceId,
  resolveBezierControlsFromBend
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
  generateAppendSegmentSource,
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
import { CanvasPanelView } from "./canvas-panel/CanvasPanelView";
import { useCanvasDerivedState } from "./canvas-panel/useCanvasDerivedState";
import { useCanvasGuidesAndRulers } from "./canvas-panel/useCanvasGuidesAndRulers";
import { useCanvasSelectionInteractions } from "./canvas-panel/useCanvasSelectionInteractions";
import { useCanvasToolInteractions } from "./canvas-panel/useCanvasToolInteractions";
import { useCanvasHandleInteractions } from "./canvas-panel/useCanvasHandleInteractions";
import { useCanvasKeyboardClipboard } from "./canvas-panel/useCanvasKeyboardClipboard";
import { useCanvasElementInteractions } from "./canvas-panel/useCanvasElementInteractions";
import { useCanvasGuideEffects } from "./canvas-panel/useCanvasGuideEffects";
import { useCanvasViewportEffects } from "./canvas-panel/useCanvasViewportEffects";
import { useCanvasTextEditingEffects } from "./canvas-panel/useCanvasTextEditingEffects";
import { useCanvasSelectionDerivedState } from "./canvas-panel/useCanvasSelectionDerivedState";
import {
  isWorldPointWithinScopeBounds,
  resolveFocusedScopeIdForSelection
} from "./canvas-panel/scope-overlay";
import {
  copySelection,
  copySelectionToClipboardData,
  cutSelection,
  cutSelectionToClipboardData,
  pasteSelectionFromPayload,
  pasteSelectionFromClipboardData,
  pasteSnippetsWithOffset
} from "./editor-commands";
import { parseClipboardPayloadJson } from "./editor-clipboard";
import {
  buildScopeWrappedSnippet,
  convertSvgToScopeSnippet,
  dataTransferHasFilePayload,
  findSvgFileInDataTransfer
} from "./svg-import";
import {
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
  preferredNodeBoundsForSource,
  previewArrowPoints,
  rectHitRegionsForTargetId,
  resolveAdornmentOwnerBoundaryPoint,
  resolveBoundsEdgePointToward,
  resolveRectHitRegionContentBox,
  removeGuideValue,
  findPathStatementById,
  resolveRotateDegreesFromOptions,
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


type BucketPreviewSession = {
  sourceId: string;
  colorToken: string;
  baseSource: string;
  previewSource: string;
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
  handleIdOverride?: string | null;
};

type PendingNativeContextMenuRequest = {
  clientX: number;
  clientY: number;
  clickedSourceId: string;
  clickedHandleId: string | null;
};

const NATIVE_CONTEXT_MENU_SELECT_DELAY_MS = 75;

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
const DESKTOP_SVG_CLIPBOARD_FORMATS = [
  "image/svg+xml",
  "public.svg-image",
  "com.microsoft.image-svg-xml"
] as const;
const DESKTOP_KEYNOTE_CLIPBOARD_FORMATS = [
  "com.apple.apps.content-language.canvas-object-1.0"
] as const;
const DESKTOP_TIKZ_CLIPBOARD_FORMATS = [
  "web application/x-tikz-editor+json",
  "application/x-tikz-editor+json",
  "com.tikzeditor.tikz-json"
] as const;
const DENSE_PATH_SEGMENT_THRESHOLD = 7;

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
  const platform = getActiveEditorPlatform();
  const assistantLockReason = useEditorStore((s) => s.documents[s.activeDocumentId]?.assistantLockReason ?? null);
  const source = useEditorStore((s) => s.source);
  const activeFigureId = useEditorStore((s) => s.activeFigureId);
  const snapshot = useEditorStore((s) => s.snapshot);
  const toolMode = useEditorStore((s) => s.toolMode);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const focusedScopeId = useEditorStore((s) => s.focusedScopeId);
  const hoveredElementId = useEditorStore((s) => s.hoveredElementId);
  const activeCanvasDragKind = useEditorStore((s) => s.activeCanvasDragKind);
  const activeSourceScrubSourceId = useEditorStore((s) => s.activeSourceScrubSourceId);
  const lastEditChangedSourceIds = useEditorStore((s) => s.lastEditChangedSourceIds);
  const lastEditChangeToken = useEditorStore((s) => s.lastEditChangeToken);
  const canvasTransform = useEditorStore((s) => s.canvasTransform);
  const fitToContentRequestToken = useEditorStore((s) => s.fitToContentRequestToken);
  const zoomRequestToken = useEditorStore((s) => s.zoomRequestToken);
  const zoomRequestDirection = useEditorStore((s) => s.zoomRequestDirection);
  const showGrid = useEditorStore((s) => s.showGrid);
  const snapModes = useEditorStore((s) => s.snapModes);
  const freehandSmoothingPx = useEditorStore((s) => s.freehandSmoothingPx);
  const bucketFillColor = useEditorStore((s) => s.bucketFillColor);
  const selectedAddShape = useEditorStore((s) => s.selectedAddShape);
  const gridSize = useSettingsStore((s) => s.settings.canvas.gridSize);
  const handleSizePx = useSettingsStore((s) => s.settings.canvas.handleSizePx);
  const zoomSpeed = useSettingsStore((s) => s.settings.canvas.zoomSpeed);
  const snapHapticsEnabled = useSettingsStore((s) => s.settings.canvas.snapHapticsEnabled);
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
  const dragTooltipBoundaryRef = useRef<{ left: number; top: number; right: number; bottom: number } | null>(null);
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
  const [pendingNativeContextMenuRequest, setPendingNativeContextMenuRequest] =
    useState<PendingNativeContextMenuRequest | null>(null);
  const [fitToContentModeActive, setFitToContentModeActive] = useState(true);
  const [expandedDensePathSourceId, setExpandedDensePathSourceId] = useState<string | null>(null);
  const bucketPreviewSessionRef = useRef<BucketPreviewSession | null>(null);
  const contextMenuContextRef = useRef<{ clickedTargetId: string | null; clickedWorld: Point | null }>({
    clickedTargetId: null,
    clickedWorld: null
  });
  const pendingNativeContextMenuTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const contextMenuHandleIdOverride =
    pendingNativeContextMenuRequest?.clickedHandleId ?? contextMenuState?.handleIdOverride;

  const commandRuntime = useEditorCommandRuntime({
    onAddNodeAdornment: (kind) => {
      const result = resolveNodeAdornmentContextAction({
        source,
        clickedTargetId: contextMenuContextRef.current.clickedTargetId,
        selectedTargetId: selectedElementIds.size === 1 ? [...selectedElementIds][0] ?? null : null,
        clickedWorld: contextMenuContextRef.current.clickedWorld,
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
    },
    activeHandleIdOverride: contextMenuHandleIdOverride
  });

  const showNativeContextMenu = useCallback(
    (target: CanvasContextMenuTarget) => {
      void platform.menu?.showNativeContextMenu?.({
        items: CANVAS_CONTEXT_MENU_DEFINITION[target],
        commandStates: commandRuntime.bindings
      });
    },
    [commandRuntime.bindings, platform.menu]
  );

  useEffect(() => {
    if (!platform.menu?.usesNativeContextMenus || !pendingNativeContextMenuRequest) {
      return;
    }
    if (!selectedElementIds.has(pendingNativeContextMenuRequest.clickedSourceId)) {
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const rect = viewport.getBoundingClientRect();
    const resolution = resolveCanvasContextMenuTarget({
      source,
      toolMode,
      clickedSourceId: pendingNativeContextMenuRequest.clickedSourceId,
      selectedElementIds
    });

    contextMenuContextRef.current = {
      clickedTargetId: pendingNativeContextMenuRequest.clickedSourceId,
      clickedWorld:
        svgResult
          ? viewportToWorldPoint(
              pendingNativeContextMenuRequest.clientX - rect.left,
              pendingNativeContextMenuRequest.clientY - rect.top,
              canvasTransform,
              svgResult.viewBox
            )
          : null
    };

    if (pendingNativeContextMenuTimeoutRef.current) {
      clearTimeout(pendingNativeContextMenuTimeoutRef.current);
    }
    dispatch({ type: "SET_ACTIVE_HANDLE", handleId: pendingNativeContextMenuRequest.clickedHandleId });

    const nativeEffectiveTarget =
      pendingNativeContextMenuRequest.clickedHandleId && resolution.target === "selection-single"
        ? "selection-single-path-point" as CanvasContextMenuTarget
        : resolution.target;

    pendingNativeContextMenuTimeoutRef.current = setTimeout(() => {
      pendingNativeContextMenuTimeoutRef.current = null;
      showNativeContextMenu(nativeEffectiveTarget);
      setPendingNativeContextMenuRequest(null);
      viewport.focus({ preventScroll: true });
    }, NATIVE_CONTEXT_MENU_SELECT_DELAY_MS);

    return () => {
      if (pendingNativeContextMenuTimeoutRef.current) {
        clearTimeout(pendingNativeContextMenuTimeoutRef.current);
        pendingNativeContextMenuTimeoutRef.current = null;
      }
    };
  }, [
    canvasTransform,
    pendingNativeContextMenuRequest,
    selectedElementIds,
    showNativeContextMenu,
    source,
    svgResult,
    toolMode
  ]);

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
  const interactionBoundsBySourceRef = useRef(new Map<string, Bounds & { sourceId: string }>());
  const liveResizeFramesRef = useRef(new Map<string, ReturnType<typeof resolveResizeFrameForSource>>());
  const previousViewBoxRef = useRef<SvgViewBox | null>(null);
  const guideDragRef = useRef<GuideDragState | null>(null);
  const snapDebugDragRef = useRef<SnapDebugOverlayDragState | null>(null);
  const textEngineRef = useRef<NodeTextEngine | null>(null);
  const prefixTableCacheRef = useRef(new Map<string, readonly number[]>());

  // Cache viewport boundary once on drag-start, clear on drag-end (avoids getBoundingClientRect per frame)
  if (dragTooltip && !dragTooltipBoundaryRef.current && viewportRef.current) {
    const r = viewportRef.current.getBoundingClientRect();
    dragTooltipBoundaryRef.current = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  } else if (!dragTooltip) {
    dragTooltipBoundaryRef.current = null;
  }

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

  const performSnapHapticFeedback = useCallback(() => {
    if (!snapHapticsEnabled) {
      return;
    }
    if (!platform.id.startsWith("desktop")) {
      return;
    }
    if (typeof navigator === "undefined" || !/(mac|iphone|ipad)/i.test(navigator.platform)) {
      return;
    }
    void platform.haptics?.performSnapFeedback?.();
  }, [platform, snapHapticsEnabled]);

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

  const densePathSourceIds = useMemo(() => {
    const dense = new Set<string>();
    for (const element of snapshot.scene?.elements ?? []) {
      if (element.kind !== "Path") {
        continue;
      }
      let segmentCount = 0;
      for (const command of element.commands) {
        if (command.kind === "L" || command.kind === "C" || command.kind === "A") {
          segmentCount += 1;
        }
      }
      if (segmentCount >= DENSE_PATH_SEGMENT_THRESHOLD) {
        dense.add(element.sourceRef.sourceId);
      }
    }
    return dense;
  }, [snapshot.scene]);

  const collapsedDensePathSourceIds = useMemo(() => {
    const collapsed = new Set<string>();
    if (toolMode !== "select") {
      return collapsed;
    }
    for (const sourceId of selectedElementIds) {
      if (densePathSourceIds.has(sourceId) && sourceId !== expandedDensePathSourceId) {
        collapsed.add(sourceId);
      }
    }
    return collapsed;
  }, [densePathSourceIds, expandedDensePathSourceId, selectedElementIds, toolMode]);

  const pathSelectionHint = useMemo(() => {
    if (warning || toolMode !== "select") return null;
    if (collapsedDensePathSourceIds.size > 0) return "Double-click path to edit points.";
    if (selectedElementIds.size !== 1) return null;
    const sourceId = [...selectedElementIds][0]!;
    // dense paths that are expanded are also eligible for add-point hint
    const element = snapshot.scene?.elements.find((e) => e.sourceRef.sourceId === sourceId);
    if (!element || element.kind !== "Path") return null;
    const parseOptions = {
      activeFigureId:
        activeFigureId == null
          ? (snapshot.figures.length > 1 ? null : undefined)
          : activeFigureId
    };
    const resolved = resolveEligibleExplicitPath(source, sourceId, parseOptions);
    if (resolved.kind !== "eligible") return null;
    if (resolved.analysis.segments.length === 0) return null;
    return "Double-click path to add a point.";
  }, [warning, toolMode, collapsedDensePathSourceIds, selectedElementIds, densePathSourceIds, snapshot.scene, snapshot.figures.length, activeFigureId, source]);

  const {
    nodeAnchorTargets,
    dragCapability,
    draggableSourceIds,
    sceneTextByRegionKey,
    sourceBounds,
    interactionBoundsBySource,
    matrixSelectionSourceIds,
    resizeFramesBySource,
    selectionBoxes,
    selectedAdornmentConnectors,
    adornmentHighlightBoxes,
    curveControlLines,
    marqueeBounds,
    handleDisplays,
    hitRegions,
    visibleRanges,
    viewportWorldBounds,
    scopeOverlay
  } = useCanvasSelectionDerivedState({
    snapshot,
    selectedElementIds,
    collapsedDensePathSourceIds,
    svgResult,
    canvasTransform,
    marqueeDraft,
    toolMode,
    viewportSize,
    ROTATE_HANDLE_OFFSET_PX
  });

  canvasTransformRef.current = canvasTransform;
  selectedElementIdsRef.current = selectedElementIds;
  svgResultRef.current = svgResult;
  fitToContentModeActiveRef.current = fitToContentModeActive;
  sourceBoundsRef.current = sourceBounds;
  interactionBoundsBySourceRef.current = interactionBoundsBySource;
  liveResizeFramesRef.current = resizeFramesBySource;

  const {
    snapGuideInput,
    snapSettingsPatch,
    renderedGuides,
    rulers,
    gridLines,
    resolveGuideFromClient,
    isPointerOverGuideDeleteZone,
    onGuidePointerDown,
    onTopRulerPointerDown,
    onLeftRulerPointerDown
  } = useCanvasGuidesAndRulers({
    showGuides,
    guides,
    guidePreview,
    snapModes,
    gridMinorTargetPx,
    canvasTransform,
    svgResult,
    visibleRanges,
    showGrid,
    viewportRef,
    svgResultRef,
    canvasTransformRef,
    guideDragRef,
    setGuidePreview,
    LEFT_RULER_DRAG_SOURCE_WIDTH_PX
  });

  const { toolPreview } = useCanvasDerivedState({
    svgResult,
    toolMode,
    toolDraft,
    toolCursorWorld,
    selectedAddShape,
    freehandDraft,
    freehandSmoothingPx,
    pathDraft,
    pathSegmentDraft,
    pendingBezier,
    bezierBendDraft,
    canvasTransform
  });

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

  const handledZoomRequestRef = useRef(0);
  useEffect(() => {
    if (zoomRequestToken <= 0) {
      return;
    }
    if (zoomRequestToken === handledZoomRequestRef.current) {
      return;
    }
    handledZoomRequestRef.current = zoomRequestToken;
    if (!zoomRequestDirection || !svgResult || !viewportRef.current) {
      return;
    }

    const currentTransform = canvasTransformRef.current;
    const centerX = viewportRef.current.clientWidth / 2;
    const centerY = viewportRef.current.clientHeight / 2;
    const zoomFactor = zoomRequestDirection === "in" ? 1.15 : 1 / 1.15;
    const nextScale = clamp(currentTransform.scale * zoomFactor, MIN_SCALE, MAX_SCALE);
    if (Math.abs(nextScale - currentTransform.scale) < 1e-9) {
      return;
    }

    const svgPoint = viewportToSvgPoint(centerX, centerY, currentTransform, svgResult.viewBox);
    const translateX = centerX - (svgPoint.x - svgResult.viewBox.x) * nextScale;
    const translateY = centerY - (svgPoint.y - svgResult.viewBox.y) * nextScale;

    if (fitToContentModeActiveRef.current) {
      setFitToContentModeActive(false);
    }
    dispatch({
      type: "SET_CANVAS_TRANSFORM",
      transform: { translateX, translateY, scale: nextScale }
    });
  }, [
    MAX_SCALE,
    MIN_SCALE,
    canvasTransformRef,
    dispatch,
    fitToContentModeActiveRef,
    setFitToContentModeActive,
    svgResult,
    zoomRequestDirection,
    zoomRequestToken
  ]);

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
        evaluateOptions: { textEngine: textEngineRef.current },
        parseOptions: {
          activeFigureId:
            activeFigureId == null
              ? (snapshot.figures.length > 1 ? null : undefined)
              : activeFigureId
        }
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
    [activeFigureId, dispatch, source, snapshot.editHandles]
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

    const snippet = generateFreehandToolSource(draft, canvasTransform.scale, freehandSmoothingPx);
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
  }, [applyActionWithFeedback, canvasTransform.scale, dispatch, freehandSmoothingPx, queueSelectionForAddedElement, setDragState]);

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

      if (draft.appendTarget) {
        const segSource = generateAppendSegmentSource(draft);
        if (!segSource) {
          setPathDraft(null);
          setToolCursorWorld(null);
          dispatch({ type: "SET_TOOL_MODE", mode: "select" });
          return;
        }
        const ok = applyActionWithFeedback({
          kind: "appendToPath",
          elementId: draft.appendTarget.elementId,
          end: draft.appendTarget.end,
          segmentSource: segSource
        });
        if (!ok.sourceChanged) {
          pendingAddedSelectionRef.current = null;
        }
      } else {
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
      }

      setPathDraft(null);
      setToolCursorWorld(null);
      dispatch({ type: "SET_TOOL_MODE", mode: "select" });
    },
    [applyActionWithFeedback, dispatch, setDragState]
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

  const { onElementPointerDown, onElementDoubleClick } = useCanvasElementInteractions({
    svgResult,
    toolMode,
    selectedElementIds,
    viewportRef,
    beginTextSelectionDrag,
    setTextEditingSession,
    interactionSvgRef,
    dispatch,
    draggableSourceIds,
    interactionBoundsBySource,
    snapshot,
    source,
    setWarning,
    onBucketFillRegion: (region: HitRegion | undefined) => {
      const resolution = resolveBucketFillEdit({
        sourceId: region?.sourceId ?? "",
        colorToken: bucketFillColor,
        source: bucketPreviewSessionRef.current?.baseSource ?? source,
        elements: snapshot.scene?.elements ?? [],
        editHandles: snapshot.editHandles,
        activeFigureId,
        figureCount: snapshot.figures.length
      });

      if (resolution.kind !== "ready") {
        if (resolution.reason !== "setProperty would not change the source.") {
          setWarning(resolution.reason ?? "This item cannot be filled.");
        }
        return;
      }

      if (resolution.result.kind === "partial") {
        const skippedCount = resolution.result.skippedHandles.length;
        setWarning(`${resolution.result.reason} (${skippedCount} handle${skippedCount === 1 ? "" : "s"} skipped)`);
      }

      dispatch({
        type: "APPLY_EDIT_ACTION",
        action: resolution.action,
        precomputedResult: resolution.result
      });
      bucketPreviewSessionRef.current = null;
    },
    setSnapLines,
    logSnapDebug,
    snapGuideInput,
    snapSettingsPatch,
    canvasTransform,
    viewportWorldBounds,
    setDragState,
    resolveEditableTextTarget,
    resolvePrefixTableForTarget,
    textIndexFromClient,
    applyCanvasTextSelection,
    hitRegions,
    sceneTextByRegionKey,
    findWordRangeAtIndex,
    densePathSourceIds,
    setExpandedDensePathSourceId,
    scopeOverlay,
    focusedScopeId,
    applyActionWithFeedback,
    activeFigureId
  });

  const {
    onHandlePointerDown,
    onResizeHandlePointerDown,
    onRotateHandlePointerDown,
    resolveRotateWriteTargetId
  } = useCanvasHandleInteractions({
    svgResult,
    toolMode,
    viewportRef,
    dispatch,
    setTextEditingSession,
    setNodeAnchorOverlay,
    selectedElementIds,
    dragCapability,
    snapshot,
    source,
    setWarning,
    setSnapLines,
    logSnapDebug,
    snapGuideInput,
    snapSettingsPatch,
    canvasTransform,
    viewportWorldBounds,
    resizeFramesBySource,
    setDragState,
    interactionSvgRef
  });

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

      if (
        !additiveSelection &&
        focusedScopeId != null &&
        !isWorldPointWithinScopeBounds(focusedScopeId, world, scopeOverlay)
      ) {
        dispatch({ type: "SET_FOCUSED_SCOPE", scopeId: null });
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
      focusedScopeId,
      logSnapDebug,
      resolveWorldFromViewportClient,
      selectedElementIds,
      setDragState,
      scopeOverlay,
      snapshot.source,
      source
    ]
  );

  const openCanvasContextMenuAt = useCallback(
    (clientX: number, clientY: number, clickedSourceId: string | null, clickedHandleId: string | null = null) => {
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
        if (selectedElementIds.size > 0 || focusedScopeId != null) {
          dispatch({ type: "CLEAR_SELECTION" });
        }
        if (clickedHandleId != null) {
          dispatch({ type: "SET_ACTIVE_HANDLE", handleId: clickedHandleId });
        }
      } else if (resolution.selectionAction.kind === "select-only") {
        if (platform.menu?.usesNativeContextMenus) {
          setPendingNativeContextMenuRequest({
            clientX,
            clientY,
            clickedSourceId: resolution.selectionAction.sourceId,
            clickedHandleId
          });
          dispatch({ type: "SET_ACTIVE_HANDLE", handleId: clickedHandleId });
          dispatch({ type: "SELECT", id: resolution.selectionAction.sourceId, additive: false });
          dispatch({
            type: "SET_FOCUSED_SCOPE",
            scopeId: resolveFocusedScopeIdForSelection(resolution.selectionAction.sourceId, scopeOverlay)
          });
          viewport.focus({ preventScroll: true });
          return;
        }
        dispatch({ type: "SET_ACTIVE_HANDLE", handleId: clickedHandleId });
        dispatch({ type: "SELECT", id: resolution.selectionAction.sourceId, additive: false });
        dispatch({
          type: "SET_FOCUSED_SCOPE",
          scopeId: resolveFocusedScopeIdForSelection(resolution.selectionAction.sourceId, scopeOverlay)
        });
      } else {
        dispatch({ type: "SET_ACTIVE_HANDLE", handleId: clickedHandleId });
      }

      contextMenuContextRef.current = {
        clickedTargetId: clickedSourceId,
        clickedWorld:
          svgResult
            ? viewportToWorldPoint(clientX - rect.left, clientY - rect.top, canvasTransform, svgResult.viewBox)
            : null
      };

      const effectiveTarget =
        clickedHandleId && resolution.target === "selection-single"
          ? "selection-single-path-point" as CanvasContextMenuTarget
          : resolution.target;

      const nextContextMenuState: CanvasContextMenuState = {
        target: effectiveTarget,
        anchorX: clientX - rect.left,
        anchorY: clientY - rect.top,
        handleIdOverride: clickedHandleId
      };

      if (platform.menu?.usesNativeContextMenus) {
        if (clickedHandleId && clickedSourceId) {
          setPendingNativeContextMenuRequest({
            clientX,
            clientY,
            clickedSourceId,
            clickedHandleId
          });
          viewport.focus({ preventScroll: true });
          return;
        }
        showNativeContextMenu(effectiveTarget);
        viewport.focus({ preventScroll: true });
        return;
      }

      setContextMenuState(nextContextMenuState);
      viewport.focus({ preventScroll: true });
    },
    [
      canvasTransform,
      dispatch,
      focusedScopeId,
      platform.menu?.usesNativeContextMenus,
      scopeOverlay,
      selectedElementIds,
      showNativeContextMenu,
      source,
      svgResult,
      toolMode
    ]
  );

  const { onElementContextMenu, onCanvasContextMenu } = useCanvasSelectionInteractions({
    openCanvasContextMenuAt,
    setTextEditingSession,
    selectedElementIds,
    scopeOverlay,
    focusedScopeId,
    snapshot,
    svgResult,
    interactionSvgRef,
    canvasTransform
  });

  const {
    onViewportPointerDown,
    onInteractionPointerDown,
    onInteractionPointerMove,
    onInteractionPointerLeave,
    onInteractionPointerEnter
  } = useCanvasToolInteractions({
    viewportRef,
    toolMode,
    setTextEditingSession,
    startMarqueeSelection,
    svgResult,
    setDragState,
    canvasTransform,
    interactionSvgRef,
    pendingBezier,
    snapshot,
    source,
    setWarning,
    setSnapLines,
    logSnapDebug,
    snapGuideInput,
    snapSettingsPatch,
    viewportWorldBounds,
    nodeAnchorTargets,
    setToolCursorWorld,
    setPathDraft,
    setPathSegmentDraft,
    setToolDraft,
    setBezierBendDraft,
    setPendingBezier,
    setNodeAnchorOverlay,
    setFreehandDraft,
    pathDraftRef,
    finalizePathDraft,
    queueSelectionForAddedElement,
    applyActionWithFeedback,
    pendingAddedSelectionRef,
    dispatch,
    selectedAddShape,
    pathDraft,
    pathSegmentDraft,
    dragRef,
    toolDraft,
    bezierBendDraft,
    freehandDraft
  });

  const {
    onViewportKeyDown,
    onViewportPaste,
    onViewportDragOver,
    onViewportDrop,
    onViewportCopy,
    onViewportCut
  } = useCanvasKeyboardClipboard({
    contextMenuState,
    setContextMenuState,
    toolMode,
    finalizePathDraft,
    setWarning,
    setFreehandDraft,
    dragRef,
    setDragState,
    dispatch,
    setToolCursorWorld,
    setSnapLines,
    setToolDraft,
    setBezierBendDraft,
    setPendingBezier,
    textEditingSession,
    setTextEditingSession,
    setMarqueeDraft,
    selectedElementIds,
    applyActionWithFeedback,
    snapshot,
    source,
    logSnapDebug,
    NUDGE_STEP_PT,
    NUDGE_STEP_SHIFT_PT,
    platform,
    DESKTOP_TIKZ_CLIPBOARD_FORMATS,
    DESKTOP_SVG_CLIPBOARD_FORMATS,
    DESKTOP_KEYNOTE_CLIPBOARD_FORMATS,
    computeAutoScaleForImportedTikz
  });

  useCanvasViewportEffects({
    dragRef,
    setToolDraft,
    setToolCursorWorld,
    viewportRef,
    setViewportSize,
    canvasTransform,
    canvasTransformRef,
    selectedElementIds,
    selectedElementIdsRef,
    svgResult,
    svgResultRef,
    fitToContentModeActive,
    fitToContentModeActiveRef,
    sourceBounds,
    sourceBoundsRef,
    interactionBoundsBySource,
    interactionBoundsBySourceRef,
    resizeFramesBySource,
    liveResizeFramesRef,
    previousViewBoxRef,
    activeCanvasDragKind,
    setDragPatchMode,
    dispatch,
    zoomSpeed,
    MIN_SCALE,
    MAX_SCALE,
    setFitToContentModeActive
  });

  useCanvasGuideEffects({
    guideDragRef,
    setGuidePreview,
    resolveGuideFromClient,
    isPointerOverGuideDeleteZone,
    setGuides,
    showGuides
  });

  useEffect(() => {
    const current = bucketPreviewSessionRef.current;
    if (toolMode !== "addBucket" || !hoveredElementId) {
      if (current && source !== current.baseSource) {
        dispatch({
          type: "SET_SOURCE_TRANSIENT",
          source: current.baseSource,
          changedSourceIds: [current.sourceId]
        });
      }
      bucketPreviewSessionRef.current = null;
      return;
    }

    const baseSource = current?.baseSource ?? source;
    const resolution = resolveBucketFillEdit({
      sourceId: hoveredElementId,
      colorToken: bucketFillColor,
      source: baseSource,
      elements: snapshot.scene?.elements ?? [],
      editHandles: snapshot.editHandles,
      activeFigureId,
      figureCount: snapshot.figures.length
    });

    if (resolution.kind !== "ready") {
      if (current && source !== current.baseSource) {
        dispatch({
          type: "SET_SOURCE_TRANSIENT",
          source: current.baseSource,
          changedSourceIds: [current.sourceId]
        });
      }
      bucketPreviewSessionRef.current = null;
      return;
    }

    const nextPreviewSource = resolution.result.newSource;
    if (
      current &&
      current.sourceId === hoveredElementId &&
      current.colorToken === bucketFillColor &&
      current.previewSource === nextPreviewSource &&
      source === nextPreviewSource
    ) {
      return;
    }

    dispatch({
      type: "SET_SOURCE_TRANSIENT",
      source: nextPreviewSource,
      changedSourceIds: [hoveredElementId]
    });
    bucketPreviewSessionRef.current = {
      sourceId: hoveredElementId,
      colorToken: bucketFillColor,
      baseSource,
      previewSource: nextPreviewSource
    };
  }, [activeFigureId, bucketFillColor, dispatch, hoveredElementId, snapshot.editHandles, snapshot.figures.length, snapshot.scene, source, toolMode]);

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
    if (toolMode !== "select") {
      setExpandedDensePathSourceId(null);
      return;
    }
    setExpandedDensePathSourceId((current) => {
      if (!current) {
        return current;
      }
      if (!selectedElementIds.has(current)) {
        return null;
      }
      if (!densePathSourceIds.has(current)) {
        return null;
      }
      return current;
    });
  }, [densePathSourceIds, selectedElementIds, toolMode]);

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

  useCanvasTextEditingEffects({
    toolMode,
    textEditingSession,
    setTextEditingSession,
    selectedElementIds,
    hitRegions,
    resolveEditableTextTarget,
    resolveEditableTextTargetById,
    resolvePrefixTableForTarget,
    setTextSelectionOverlay,
    pendingAdornmentTextEditTargetId,
    snapshot,
    source,
    applyCanvasTextSelection,
    setPendingAdornmentTextEditTargetId
  });

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
    interactionBoundsBySourceRef,
    scopeOverlay,
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
    selectedAddShape,
    textIndexFromClient,
    onSnapFeedback: performSnapHapticFeedback
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
    <CanvasPanelView
      showRulers={showRulers}
      viewportSize={viewportSize}
      topRulerRef={topRulerRef}
      leftRulerRef={leftRulerRef}
      onTopRulerPointerDown={onTopRulerPointerDown}
      onLeftRulerPointerDown={onLeftRulerPointerDown}
      onCanvasContextMenu={onCanvasContextMenu}
      rulers={rulers}
      LEFT_RULER_DRAG_SOURCE_WIDTH_PX={LEFT_RULER_DRAG_SOURCE_WIDTH_PX}
      toolMode={toolMode}
      viewportRef={viewportRef}
      onViewportKeyDown={onViewportKeyDown}
      onViewportCopy={onViewportCopy}
      onViewportCut={onViewportCut}
      onViewportPaste={onViewportPaste}
      onViewportDragOver={onViewportDragOver}
      onViewportDrop={onViewportDrop}
      onViewportPointerDown={onViewportPointerDown}
      svgResult={svgResult}
      noActiveFigure={snapshot.figures.length > 0 && snapshot.activeFigureId == null}
      assistantLockReason={assistantLockReason}
      snapshot={snapshot}
      canvasTransform={canvasTransform}
      svgDiffHints={svgDiffHints}
      forceSvgReplaceAll={forceSvgReplaceAll}
      onSvgPatchFallback={onSvgPatchFallback}
      interactionSvgRef={interactionSvgRef}
      onInteractionPointerDown={onInteractionPointerDown}
      onInteractionPointerMove={onInteractionPointerMove}
      onInteractionPointerEnter={onInteractionPointerEnter}
      onInteractionPointerLeave={onInteractionPointerLeave}
      gridLines={gridLines}
      gridMinorStrokeWidth={gridMinorStrokeWidth}
      gridMajorStrokeWidth={gridMajorStrokeWidth}
      visibleRanges={visibleRanges}
      showGuides={showGuides}
      renderedGuides={renderedGuides}
      guideStrokeWidth={guideStrokeWidth}
      guideHitStrokeWidth={guideHitStrokeWidth}
      onGuidePointerDown={onGuidePointerDown}
      snapLines={snapLines}
      snapStrokeWidth={snapStrokeWidth}
      snapCrossSize={snapCrossSize}
      toolPreview={toolPreview}
      handleStrokeWidth={handleStrokeWidth}
      previewArrowPoints={previewArrowPoints}
      hitRegions={hitRegions}
      hoveredElementId={hoveredElementId}
      editableTextRegionKeys={editableTextRegionKeys}
      draggableSourceIds={draggableSourceIds}
      onElementPointerDown={onElementPointerDown}
      onElementContextMenu={onElementContextMenu}
      onElementDoubleClick={onElementDoubleClick}
      onHoverChange={(id: string | null) => dispatch({ type: "SET_HOVERED_ELEMENT", id })}
      marqueeBounds={marqueeBounds}
      selectionBoxes={selectionBoxes}
      adornmentHighlightBoxes={adornmentHighlightBoxes}
      selectedAdornmentConnectors={selectedAdornmentConnectors}
      selectionStrokeWidth={selectionStrokeWidth}
      textSelectionVisual={textSelectionVisual}
      selectionDragStrokeWidth={selectionDragStrokeWidth}
      matrixSelectionSourceIds={matrixSelectionSourceIds}
      curveControlLines={curveControlLines}
      curveControlStrokeWidth={curveControlStrokeWidth}
      nodeAnchorOverlay={nodeAnchorOverlay}
      handleHalfSize={handleHalfSize}
      handleDisplays={handleDisplays}
      onHandlePointerDown={onHandlePointerDown}
      onResizeHandlePointerDown={onResizeHandlePointerDown}
      onRotateHandlePointerDown={onRotateHandlePointerDown}
      platform={platform}
      contextMenuState={contextMenuState}
      commandRuntimeBindings={commandRuntime.bindings}
      onContextMenuClose={() => setContextMenuState(null)}
      onContextMenuCommandRun={(commandId: AppMenuCommandId, origin: any) => {
        commandRuntime.runCommand(commandId, origin);
        setContextMenuState(null);
      }}
      dragTooltip={dragTooltip}
      dragTooltipBoundary={dragTooltipBoundaryRef.current}
      warning={warning}
      copyWarningToClipboard={copyWarningToClipboard}
      onWarningBarKeyDown={onWarningBarKeyDown}
      selectionHint={pathSelectionHint}
      showDevPanel={showDevPanel}
      snapDebugRect={snapDebugRect}
      onSnapDebugMovePointerDown={onSnapDebugMovePointerDown}
      snapDebug={snapDebug}
      onSnapDebugResizePointerDown={onSnapDebugResizePointerDown}
      RULER_SIZE={RULER_SIZE}
    />
  );
}

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { collectGeometryInvalidation } from "tikz-editor/semantic/index";
import { applyEditAction, type EditAction, type ResizeRole } from "tikz-editor/edit/actions";
import { createMathJaxNodeTextEngine } from "tikz-editor/text/mathjax-engine";
import {
  buildSnapContext,
  collectSelectionGeometry,
  snapKeyboardNudge,
  snapToolPointer,
  type SnapLine
} from "tikz-editor/edit/snapping";
import type { NodeTextEngine } from "tikz-editor/text/types";
import type { PathItem, Span, Statement } from "tikz-editor/ast/types";
import { PT_PER_CM } from "tikz-editor/edit/format";
import {
  finalizePrefixWidthTable,
  findNearestPrefixIndexFromTable,
  readPrefixUnitsFromTable,
  seedPrefixWidthTable,
  stabilizePrefixForMeasurement
} from "tikz-editor/text/prefix-width";
import type {
  EditHandle,
  Point,
  SceneElement,
  ScenePath,
  ScenePathCommand,
  SceneText
} from "tikz-editor/semantic/types";
import { type SvgDiffHints, type SvgViewBox } from "tikz-editor/svg/index";
import { useEditorStore } from "../store/store";
import type { CanvasDragKind, ToolMode } from "../store/types";
import { requestSourceSelection, SOURCE_SELECTION_CHANGED_EVENT, type SourceSelectionChangeDetail } from "./source-sync";
import { resolveTextSelectionOverlayResolution } from "./text-selection-overlay-policy";
import { buildHitRegions, type HitRegion } from "./canvas-panel/hit-regions";
import {
  boundsFromPoints,
  collectSourceIdsInBounds,
  pickClosestSourceId,
  resolveToolCreateCurrentWorld
} from "./canvas-panel/interaction-helpers";
import { CanvasSVGLayer } from "./canvas-panel/CanvasSVGLayer";
import { useCanvasDragController } from "./canvas-panel/useCanvasDragController";
import type {
  ApplyActionFeedback,
  Bounds,
  DragState,
  EditableTextTarget,
  NodeTextSelectionEntry,
  PendingAddedSelection,
  SelectionBounds,
  SnapDebugLogInput,
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
  pickStepPt,
  resizeCursorForVector,
  rotatePointAroundCenter,
  toViewportXFromWorld,
  toViewportYFromWorld,
  vectorLengthSquared,
  viewportToSvgPoint,
  viewportToWorldPoint,
  worldToSvgPoint,
  worldToSvgY,
  svgToWorldPoint,
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
  HandleOverlay,
  HitRegionLayer,
  SelectionOverlay,
  SnapOverlay,
  ToolPreviewOverlay
} from "./canvas-panel/overlays";
import {
  isToolCreateMode,
  type ToolCreateMode
} from "./tool-config";
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
const ZOOM_EXP_FACTOR = 0.0045;
const NUDGE_STEP_PT = 0.05 * PT_PER_CM;
const NUDGE_STEP_SHIFT_PT = 0.25 * PT_PER_CM;
const HANDLE_SQUARE_SIZE_PX = 9;
const TOOL_PREVIEW_CIRCLE_RADIUS_PT = 0.8 * PT_PER_CM;
const LEFT_RULER_DRAG_SOURCE_WIDTH_PX = 12;
const PREFIX_MEASURE_TEXT_MAX_LENGTH = 240;
const PREFIX_MEASURE_CACHE_LIMIT = 64;
const RESIZE_NOOP_REASON = "Resize would not change node constraints.";

export function CanvasPanel() {
  const source = useEditorStore((s) => s.source);
  const snapshot = useEditorStore((s) => s.snapshot);
  const toolMode = useEditorStore((s) => s.toolMode);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const hoveredElementId = useEditorStore((s) => s.hoveredElementId);
  const activeCanvasDragKind = useEditorStore((s) => s.activeCanvasDragKind);
  const lastEditChangedSourceIds = useEditorStore((s) => s.lastEditChangedSourceIds);
  const lastEditChangeToken = useEditorStore((s) => s.lastEditChangeToken);
  const canvasTransform = useEditorStore((s) => s.canvasTransform);
  const fitToContentRequestToken = useEditorStore((s) => s.fitToContentRequestToken);
  const showGrid = useEditorStore((s) => s.showGrid);
  const showRulers = useEditorStore((s) => s.showRulers);
  const showGuides = useEditorStore((s) => s.showGuides);
  const showDevPanel = useEditorStore((s) => s.showDevPanel);
  const dispatch = useEditorStore((s) => s.dispatch);

  const svgResult = snapshot.svg;
  const parseDiags = snapshot.parseResult?.diagnostics;
  const semanticDiags = snapshot.semanticResult?.diagnostics;

  const [warning, setWarning] = useState<string | null>(null);
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
  const [toolDraft, setToolDraft] = useState<Extract<DragState, { kind: "tool-create" }> | null>(null);
  const [marqueeDraft, setMarqueeDraft] = useState<Extract<DragState, { kind: "marquee" }> | null>(null);
  const [textSelectionOverlay, setTextSelectionOverlay] = useState<TextSelectionOverlay | null>(null);
  const [dragPatchMode, setDragPatchMode] = useState<"partial" | "full">("partial");
  const [dragAffectedSourceIds, setDragAffectedSourceIds] = useState<string[] | null>(null);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const topRulerRef = useRef<SVGSVGElement | null>(null);
  const leftRulerRef = useRef<SVGSVGElement | null>(null);
  const interactionSvgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pendingAddedSelectionRef = useRef<PendingAddedSelection | null>(null);
  const autoFitDoneRef = useRef(false);
  const canvasTransformRef = useRef(canvasTransform);
  const selectedElementIdsRef = useRef(selectedElementIds);
  const svgResultRef = useRef(svgResult);
  const sourceBoundsRef = useRef(new Map<string, Bounds>());
  const previousViewBoxRef = useRef<SvgViewBox | null>(null);
  const guideDragRef = useRef<GuideDragState | null>(null);
  const snapDebugDragRef = useRef<SnapDebugOverlayDragState | null>(null);
  const textEngineRef = useRef<NodeTextEngine | null>(null);
  const prefixTableCacheRef = useRef(new Map<string, readonly number[]>());
  const lastSourceSelectionDetailRef = useRef<SourceSelectionChangeDetail | null>(null);

  const setActiveCanvasDragKind = useCallback(
    (kind: CanvasDragKind | null) => {
      dispatch({ type: "SET_ACTIVE_CANVAS_DRAG", kind });
    },
    [dispatch]
  );

  const setDragState = useCallback(
    (next: DragState | null) => {
      dragRef.current = next;
      setActiveCanvasDragKind(next?.kind ?? null);
    },
    [setActiveCanvasDragKind]
  );

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
    () => snapshot.editHandles.filter((handle) => selectedElementIds.has(handle.sourceId)),
    [snapshot.editHandles, selectedElementIds]
  );

  const selectionBounds = useMemo(() => {
    if (!snapshot.scene || !svgResult) return [];
    return collectSelectionBounds(snapshot.scene.elements, selectedElementIds, svgResult.viewBox);
  }, [snapshot.scene, selectedElementIds, svgResult]);

  const nodeTextEntries = useMemo(() => {
    const figure = snapshot.parseResult?.figure;
    if (!figure) {
      return new Map<string, NodeTextSelectionEntry>();
    }
    return collectNodeTextEntries(figure.body);
  }, [snapshot.parseResult]);

  const sceneTextBySource = useMemo(() => {
    const elements = snapshot.scene?.elements ?? [];
    const bySource = new Map<string, SceneText>();
    const duplicates = new Set<string>();
    for (const element of elements) {
      if (element.kind !== "Text") {
        continue;
      }
      if (bySource.has(element.sourceId)) {
        duplicates.add(element.sourceId);
        continue;
      }
      bySource.set(element.sourceId, element);
    }
    for (const sourceId of duplicates) {
      bySource.delete(sourceId);
    }
    return bySource;
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
    for (const sourceId of selectionBoundsBySource.keys()) {
      if (sourceHasSingleResizablePathShape(snapshot.scene.elements, sourceId)) {
        result.add(sourceId);
      }
    }
    return result;
  }, [selectionBoundsBySource, snapshot.scene]);

  const selectionBoxes = useMemo(
    () =>
      [...resizablePathShapeSourceIds]
        .map((sourceId) => {
          const bounds = selectionBoundsBySource.get(sourceId);
          return bounds ? { key: `selection-box:${sourceId}`, ...bounds } : null;
        })
        .filter((bounds): bounds is { key: string; minX: number; minY: number; maxX: number; maxY: number } => bounds != null),
    [resizablePathShapeSourceIds, selectionBoundsBySource]
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
    const resizeHandleSourceIds = new Set<string>(resizablePathShapeSourceIds);

    for (const handle of selectedHandles) {
      if (handle.kind === "node-position") {
        resizeHandleSourceIds.add(handle.sourceId);
        continue;
      }

      if (handle.kind === "path-point" && resizablePathShapeSourceIds.has(handle.sourceId)) {
        continue;
      }

      const point = worldToSvgPoint(handle.world, svgResult.viewBox);
      displays.push({
        key: `handle:${handle.id}`,
        x: point.x,
        y: point.y,
        cursor: getHandleCursor(handle, snapshot.scene, snapshot.editHandles),
        kind: "move-handle",
        handle
      });
    }

    for (const sourceId of resizeHandleSourceIds) {
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
        const fallback = selectedHandles.find((handle) => handle.sourceId === sourceId && handle.kind === "node-position");
        if (!fallback) continue;
        const point = worldToSvgPoint(fallback.world, svgResult.viewBox);
        displays.push({
          key: `node-handle:${sourceId}:center`,
          x: point.x,
          y: point.y,
          cursor: "move",
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
          cursor: "nw-resize",
          kind: "resize-element",
          elementId: sourceId,
          role: "top-left"
        },
        {
          key: `node-handle:${sourceId}:top-right`,
          x: bounds.maxX,
          y: bounds.minY,
          cursor: "ne-resize",
          kind: "resize-element",
          elementId: sourceId,
          role: "top-right"
        },
        {
          key: `node-handle:${sourceId}:bottom-left`,
          x: bounds.minX,
          y: bounds.maxY,
          cursor: "sw-resize",
          kind: "resize-element",
          elementId: sourceId,
          role: "bottom-left"
        },
        {
          key: `node-handle:${sourceId}:bottom-right`,
          x: bounds.maxX,
          y: bounds.maxY,
          cursor: "se-resize",
          kind: "resize-element",
          elementId: sourceId,
          role: "bottom-right"
        }
      );
    }

    return displays;
  }, [resizablePathShapeSourceIds, selectedHandles, selectionBoundsBySource, snapshot.scene, svgResult]);

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

  const rulers = useMemo(() => {
    if (!svgResult || !visibleRanges) {
      return {
        topTicks: [] as RulerTick[],
        leftTicks: [] as RulerTick[]
      };
    }

    const majorStep = pickStepPt(canvasTransform.scale, 88);
    const minorStep = majorStep / 5;

    const topTicks = buildTicks(
      visibleRanges.worldMinX,
      visibleRanges.worldMaxX,
      minorStep,
      majorStep,
      (value) => toViewportXFromWorld(value, svgResult.viewBox, canvasTransform)
    );

    const leftTicks = buildTicks(
      visibleRanges.worldMinY,
      visibleRanges.worldMaxY,
      minorStep,
      majorStep,
      (value) => toViewportYFromWorld(value, svgResult.viewBox, canvasTransform)
    );

    return { topTicks, leftTicks };
  }, [canvasTransform, svgResult, visibleRanges]);

  const gridLines = useMemo((): GridLines | null => {
    if (!svgResult || !visibleRanges || !showGrid) return null;

    const minorStep = pickStepPt(canvasTransform.scale, 22);
    const majorStep = minorStep * 5;

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
  }, [canvasTransform.scale, showGrid, svgResult, visibleRanges]);

  const toolPreview = useMemo((): ToolPreview | null => {
    if (!svgResult || toolMode === "select") {
      return null;
    }

    const liveWorld = toolDraft?.currentWorld ?? toolCursorWorld;
    if (!liveWorld) {
      return null;
    }

    if (toolMode === "addNode") {
      const point = worldToSvgPoint(liveWorld, svgResult.viewBox);
      return { kind: "node", x: point.x, y: point.y };
    }

    if (!toolDraft) {
      const point = worldToSvgPoint(liveWorld, svgResult.viewBox);
      return { kind: "cursor", x: point.x, y: point.y };
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
  }, [svgResult, toolCursorWorld, toolDraft, toolMode]);

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
        beforeIds.add(element.sourceId);
      }
      pendingAddedSelectionRef.current = { beforeIds, preferredWorld };
    },
    [snapshot.scene]
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
    (sourceId: string, region: HitRegion | undefined): EditableTextTarget | null => {
      if (!region || region.shape !== "rect") {
        return null;
      }
      const nodeEntry = nodeTextEntries.get(sourceId);
      const sceneText = sceneTextBySource.get(sourceId);
      if (!nodeEntry || !sceneText) {
        return null;
      }
      if (sceneText.textRenderInfo?.mode !== "mathjax") {
        return null;
      }
      if (nodeEntry.hasTextWidth) {
        return null;
      }
      if (nodeEntry.text.includes("\n") || sceneText.text.includes("\n")) {
        return null;
      }
      if (nodeEntry.text !== sceneText.text) {
        return null;
      }
      if (source.slice(nodeEntry.span.from, nodeEntry.span.to) !== nodeEntry.text) {
        return null;
      }
      if (!(sceneText.textBlockWidth != null && sceneText.textBlockWidth > 0)) {
        return null;
      }
      return {
        sourceId,
        sourceSpan: nodeEntry.span,
        text: nodeEntry.text,
        style: sceneText.style,
        totalWidth: sceneText.textBlockWidth,
        region
      };
    },
    [nodeTextEntries, sceneTextBySource, source]
  );

  const editableTextRegionKeys = useMemo(() => {
    const keys = new Set<string>();
    if (toolMode !== "select") {
      return keys;
    }
    for (const region of hitRegions) {
      if (resolveEditableTextTarget(region.sourceId, region)) {
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
      const left = target.region.cx - target.region.width / 2;
      const ratio = clamp((unrotatedPoint.x - left) / Math.max(target.region.width, 1e-6), 0, 1);
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
      headIndex: number,
      prefixTable: readonly number[] | null
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
      setTextSelectionOverlay({
        sourceId: target.sourceId,
        textLength: target.text.length,
        totalWidth: target.totalWidth,
        fontSizePt: target.style.fontSize,
        startIndex: boundedAnchor,
        endIndex: boundedHead,
        rotation: target.region.rotation,
        cx: target.region.cx,
        cy: target.region.cy,
        width: target.region.width,
        height: target.region.height,
        prefixTable
      });
    },
    []
  );

  const beginTextSelectionDrag = useCallback(
    (
      event: ReactPointerEvent<SVGElement>,
      sourceId: string,
      region: HitRegion | undefined
    ): boolean => {
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.button !== 0) {
        return false;
      }
      if (!svgResult || snapshot.source !== source) {
        return false;
      }
      const target = resolveEditableTextTarget(sourceId, region);
      if (!target) {
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

      dispatch({ type: "SELECT", id: sourceId, additive: false });
      applyCanvasTextSelection(target, clickIndex, clickIndex, prefixTable);
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

  const onElementPointerDown = useCallback(
    (event: ReactPointerEvent<SVGElement>, sourceId: string, region?: HitRegion) => {
      if (!svgResult || toolMode !== "select" || event.button !== 0) return;
      const additiveSelection = event.shiftKey || event.ctrlKey || event.metaKey;

      viewportRef.current?.focus({ preventScroll: true });
      event.preventDefault();
      event.stopPropagation();

      if (beginTextSelectionDrag(event, sourceId, region)) {
        return;
      }

      setTextSelectionOverlay(null);

      const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, svgResult.viewBox);
      if (!world) return;

      if (additiveSelection) {
        dispatch({ type: "SELECT", id: sourceId, additive: true });
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

      const alreadySelected = selectedElementIds.has(sourceId);
      const draggedIds = alreadySelected && selectedElementIds.size > 0 ? [...selectedElementIds] : [sourceId];
      if (!alreadySelected) {
        dispatch({ type: "SELECT", id: sourceId, additive: false });
      }

      const snapContext = snapshot.scene
        ? buildSnapContext({
            sceneElements: snapshot.scene.elements,
            selectedSourceIds: draggedIds,
            guides: snapGuideInput,
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
      logSnapDebug,
      setDragState,
      selectedElementIds,
      snapshot.scene,
      snapshot.source,
      source,
      svgResult,
      toolMode,
      snapGuideInput,
      viewportWorldBounds
    ]
  );

  const onElementDoubleClick = useCallback(
    (event: ReactMouseEvent<SVGElement>, sourceId: string, region?: HitRegion) => {
      if (toolMode !== "select") return;

      const target = resolveEditableTextTarget(sourceId, region);

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
          dispatch({ type: "SELECT", id: sourceId, additive: false });
          applyCanvasTextSelection(target, startIndex, endIndex, prefixTable);
          return;
        }
      }

      const fallback = nodeTextEntries.get(sourceId);
      if (!fallback) {
        return;
      }

      dispatch({ type: "SELECT", id: sourceId, additive: false });
      requestSourceSelection({
        from: fallback.span.from,
        to: fallback.span.to,
        anchor: fallback.span.from,
        head: fallback.span.to,
        sourceId,
        focus: true
      });
      setTextSelectionOverlay(null);
    },
    [
      applyCanvasTextSelection,
      dispatch,
      nodeTextEntries,
      resolveEditableTextTarget,
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
      setTextSelectionOverlay(null);

      if (additiveSelection) {
        dispatch({ type: "SELECT", id: handle.sourceId, additive: true });
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

      if (selectedElementIds.size !== 1 || !selectedElementIds.has(handle.sourceId)) {
        dispatch({ type: "SELECT", id: handle.sourceId, additive: false });
      }

      const snapContext = snapshot.scene
        ? buildSnapContext({
            sceneElements: snapshot.scene.elements,
            selectedSourceIds: [handle.sourceId],
            guides: snapGuideInput,
            zoom: canvasTransform.scale,
            viewportWorld: viewportWorldBounds
          })
        : null;
      setSnapLines([]);

      setDragState({
        kind: "handle",
        pointerId: event.pointerId,
        handleId: handle.id,
        sourceId: handle.sourceId,
        handleKind: handle.kind,
        lastKnownWorld: { ...handle.world },
        snapContext,
        historyMergeKey: makeMergeKey("drag-handle", handle.id, event.pointerId)
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
      logSnapDebug,
      setDragState,
      selectedElementIds,
      snapshot.scene,
      snapshot.source,
      source,
      svgResult,
      toolMode,
      snapGuideInput,
      viewportWorldBounds
    ]
  );

  const onResizeHandlePointerDown = useCallback(
    (event: ReactPointerEvent<SVGElement>, sourceId: string, role: ResizeRole) => {
      if (!svgResult || toolMode !== "select" || event.button !== 0) return;
      const additiveSelection = event.shiftKey || event.ctrlKey || event.metaKey;

      viewportRef.current?.focus({ preventScroll: true });
      event.preventDefault();
      event.stopPropagation();
      setTextSelectionOverlay(null);

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

      setSnapLines([]);
      setDragState({
        kind: "resize",
        pointerId: event.pointerId,
        elementId: sourceId,
        role,
        preserveAspectRatio: ellipseAspectRatioForSource(snapshot.scene?.elements ?? [], sourceId),
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

  const onInteractionPointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      viewportRef.current?.focus({ preventScroll: true });
      setTextSelectionOverlay(null);
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
        if (snapshot.source !== source) {
          setWarning("Wait for recompute to finish before starting a draw gesture.");
          setSnapLines([]);
          logSnapDebug({
            phase: "tool-start",
            note: "blocked: snapshot/source mismatch",
            snapshotMatchesSource: false,
            dragKind: "tool-create",
            rawPoint: world,
            lines: []
          });
          return;
        }
        const toolSnapContext = snapshot.scene
          ? buildSnapContext({
              sceneElements: snapshot.scene.elements,
              selectedSourceIds: [],
              guides: snapGuideInput,
              zoom: canvasTransform.scale,
              viewportWorld: viewportWorldBounds
            })
          : null;
        const snappedStart = toolSnapContext
          ? (snapToolPointer({
              context: toolSnapContext,
              pointer: world,
              kind: "node",
              modifiers: { ctrlOrMeta: event.ctrlKey || event.metaKey }
            }).snappedPoint ?? world)
          : world;

        setToolCursorWorld(snappedStart);
        event.preventDefault();

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
            startWorld: snappedStart,
            rawCurrentWorld: snappedStart,
            currentWorld: snappedStart,
            snapContext: toolSnapContext
          };
          setDragState(nextDraft);
          setToolDraft(nextDraft);
          logSnapDebug({
            phase: "tool-start",
            snapshotMatchesSource: true,
            dragKind: "tool-create",
            context: toolSnapContext,
            rawPoint: world,
            snappedPoint: snappedStart,
            lines: []
          });
        }
        return;
      }

      if (toolMode === "select" && event.button === 0 && event.target === event.currentTarget) {
        dispatch({ type: "SET_HOVERED_ELEMENT", id: null });
        const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, svgResult.viewBox);
        if (!world) {
          if (!additiveSelection) {
            dispatch({ type: "CLEAR_SELECTION" });
          }
          return;
        }

        const nextMarquee: Extract<DragState, { kind: "marquee" }> = {
          kind: "marquee",
          pointerId: event.pointerId,
          startWorld: world,
          currentWorld: world,
          additive: additiveSelection
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
        event.preventDefault();
      }
    },
    [
      applyActionWithFeedback,
      canvasTransform.scale,
      dispatch,
      logSnapDebug,
      queueSelectionForAddedElement,
      setDragState,
      snapshot.scene,
      snapshot.source,
      source,
      svgResult,
      toolMode,
      snapGuideInput,
      viewportWorldBounds
    ]
  );

  const onInteractionPointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!svgResult || toolMode === "select") {
        return;
      }

      const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, svgResult.viewBox);
      if (!world) {
        return;
      }
      if (!snapshot.scene || snapshot.source !== source) {
        setToolCursorWorld(world);
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
        zoom: canvasTransform.scale,
        viewportWorld: viewportWorldBounds
      });
      const snapped = snapToolPointer({
        context: snapContext,
        pointer: world,
        kind: "node",
        modifiers: { ctrlOrMeta: event.ctrlKey || event.metaKey }
      });
      setToolCursorWorld(snapped.snappedPoint ?? world);
      if (!toolDraft) {
        setSnapLines(snapped.lines);
      }
      logSnapDebug({
        phase: "tool-hover-move",
        snapshotMatchesSource: true,
        dragKind: toolDraft ? "tool-create" : null,
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
      snapshot.scene,
      snapshot.source,
      source,
      svgResult,
      toolDraft,
      toolMode,
      snapGuideInput,
      viewportWorldBounds
    ]
  );

  const onInteractionPointerLeave = useCallback(() => {
    if (toolMode === "select" || toolDraft) {
      return;
    }
    setToolCursorWorld(null);
    setSnapLines([]);
  }, [toolDraft, toolMode]);

  const onInteractionPointerEnter = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!svgResult || toolMode === "select") {
        return;
      }
      const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, svgResult.viewBox);
      if (!world) return;
      if (!snapshot.scene || snapshot.source !== source) {
        setToolCursorWorld(world);
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
        zoom: canvasTransform.scale,
        viewportWorld: viewportWorldBounds
      });
      const snapped = snapToolPointer({
        context: snapContext,
        pointer: world,
        kind: "node",
        modifiers: { ctrlOrMeta: event.ctrlKey || event.metaKey }
      });
      setToolCursorWorld(snapped.snappedPoint ?? world);
      if (!toolDraft) {
        setSnapLines(snapped.lines);
      }
      logSnapDebug({
        phase: "tool-hover-enter",
        snapshotMatchesSource: true,
        dragKind: toolDraft ? "tool-create" : null,
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
      snapshot.scene,
      snapshot.source,
      source,
      svgResult,
      toolDraft,
      toolMode,
      snapGuideInput,
      viewportWorldBounds
    ]
  );

  const onViewportKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        if (toolMode !== "select") {
          dispatch({ type: "SET_TOOL_MODE", mode: "select" });
          setToolDraft(null);
          setToolCursorWorld(null);
        }
        setMarqueeDraft(null);
        if (dragRef.current?.kind === "marquee") {
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
      const elementHandles = snapshot.editHandles.filter((handle) => selectedSet.has(handle.sourceId));
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
      dispatch,
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
    canvasTransformRef.current = canvasTransform;
  }, [canvasTransform]);

  useEffect(() => {
    selectedElementIdsRef.current = selectedElementIds;
  }, [selectedElementIds]);

  useEffect(() => {
    svgResultRef.current = svgResult;
  }, [svgResult]);

  useEffect(() => {
    sourceBoundsRef.current = sourceBounds;
  }, [sourceBounds]);

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

    const onWheel = (event: WheelEvent) => {
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
        const deltaModeFactor =
          event.deltaMode === 1
            ? 16
            : event.deltaMode === 2
              ? Math.max(1, viewport.clientHeight)
              : 1;
        const zoomFactor = Math.exp(-event.deltaY * deltaModeFactor * ZOOM_EXP_FACTOR);
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

    const preventGesture = (event: Event) => {
      event.preventDefault();
    };

    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("gesturestart", preventGesture, { passive: false });
    viewport.addEventListener("gesturechange", preventGesture, { passive: false });
    viewport.addEventListener("gestureend", preventGesture, { passive: false });

    return () => {
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("gesturestart", preventGesture);
      viewport.removeEventListener("gesturechange", preventGesture);
      viewport.removeEventListener("gestureend", preventGesture);
    };
  }, [dispatch]);

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
    // Keep the current text caret/selection overlay visible while async
    // recompute catches up; we'll resync from the last source selection event
    // once snapshot.source matches source again.
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
      setToolDraft(null);
      setToolCursorWorld(null);
      setSnapLines([]);
      if (dragRef.current?.kind === "tool-create") {
        setDragState(null);
      }
      return;
    }

    lastSourceSelectionDetailRef.current = null;
    setTextSelectionOverlay(null);
    if (dragRef.current?.kind === "marquee") {
      setDragState(null);
      setMarqueeDraft(null);
    } else if (dragRef.current?.kind === "text-select") {
      setDragState(null);
    }
  }, [setDragState, toolMode]);

  useEffect(() => {
    if (!textSelectionOverlay) {
      return;
    }
    if (!selectedElementIds.has(textSelectionOverlay.sourceId)) {
      setTextSelectionOverlay(null);
    }
  }, [selectedElementIds, textSelectionOverlay]);

  const syncTextSelectionOverlayFromDetail = useCallback(
    (detail: SourceSelectionChangeDetail | null | undefined, allowTransientPreserve: boolean): boolean => {
      const anchorOffset = Math.floor(detail?.anchor ?? 0);
      const headOffset = Math.floor(detail?.head ?? 0);
      const sourceId = detail?.sourceId?.trim() ?? "";
      const hasSourceId = sourceId.length > 0;
      const region = hasSourceId
        ? hitRegions.find(
            (candidate): candidate is Extract<HitRegion, { shape: "rect" }> =>
              candidate.sourceId === sourceId && candidate.shape === "rect"
          )
        : undefined;
      const target = hasSourceId ? resolveEditableTextTarget(sourceId, region) : null;
      const offsetsInRange =
        target != null &&
        anchorOffset >= target.sourceSpan.from &&
        anchorOffset <= target.sourceSpan.to &&
        headOffset >= target.sourceSpan.from &&
        headOffset <= target.sourceSpan.to;

      const resolution = resolveTextSelectionOverlayResolution({
        hasSourceId,
        hasTarget: target != null,
        offsetsInRange,
        allowTransientPreserve,
        snapshotMatchesSource: snapshot.source === source
      });
      if (resolution === "preserve") {
        return false;
      }
      if (resolution === "clear" || !target) {
        setTextSelectionOverlay(null);
        return false;
      }

      const prefixTable = resolvePrefixTableForTarget(target);
      setTextSelectionOverlay({
        sourceId,
        textLength: target.text.length,
        totalWidth: target.totalWidth,
        fontSizePt: target.style.fontSize,
        startIndex: clamp(anchorOffset - target.sourceSpan.from, 0, target.text.length),
        endIndex: clamp(headOffset - target.sourceSpan.from, 0, target.text.length),
        rotation: target.region.rotation,
        cx: target.region.cx,
        cy: target.region.cy,
        width: target.region.width,
        height: target.region.height,
        prefixTable
      });
      return true;
    },
    [hitRegions, resolveEditableTextTarget, resolvePrefixTableForTarget, snapshot.source, source]
  );

  useEffect(() => {
    const handleSelectionChanged = (rawEvent: Event) => {
      if (toolMode !== "select") {
        return;
      }

      const event = rawEvent as CustomEvent<SourceSelectionChangeDetail>;
      lastSourceSelectionDetailRef.current = event.detail ?? null;
      syncTextSelectionOverlayFromDetail(event.detail, true);
    };

    window.addEventListener(SOURCE_SELECTION_CHANGED_EVENT, handleSelectionChanged as EventListener);
    return () => window.removeEventListener(SOURCE_SELECTION_CHANGED_EVENT, handleSelectionChanged as EventListener);
  }, [syncTextSelectionOverlayFromDetail, toolMode]);

  useEffect(() => {
    if (toolMode !== "select") {
      return;
    }
    if (snapshot.source !== source) {
      return;
    }
    const detail = lastSourceSelectionDetailRef.current;
    if (!detail) {
      return;
    }
    syncTextSelectionOverlayFromDetail(detail, false);
  }, [snapshot.source, source, syncTextSelectionOverlayFromDetail, toolMode]);

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
    if (!svgResult || autoFitDoneRef.current) return;
    if (viewportSize.width <= 0 || viewportSize.height <= 0) return;

    fitToContent();
    autoFitDoneRef.current = true;
  }, [fitToContent, svgResult, viewportSize]);

  useCanvasDragController({
    applyActionWithFeedback,
    dispatch,
    logSnapDebug,
    queueSelectionForAddedElement,
    snapshotSource: snapshot.source,
    snapshotScene: snapshot.scene,
    snapshotEditHandles: snapshot.editHandles,
    source,
    svgResult,
    dragRef,
    svgResultRef,
    interactionSvgRef,
    selectedElementIdsRef,
    sourceBoundsRef,
    pendingAddedSelectionRef,
    setDragState,
    setSnapLines,
    setToolDraft,
    setToolCursorWorld,
    setMarqueeDraft,
    setWarning,
    setTextSelectionOverlay,
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

  const handleHalfSize = (HANDLE_SQUARE_SIZE_PX / 2) / Math.max(canvasTransform.scale, 1e-3);
  const handleStrokeWidth = 1.2 / Math.max(canvasTransform.scale, 1e-3);
  const selectionStrokeWidth = 1.1 / Math.max(canvasTransform.scale, 1e-3);
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
      <div className={css.header}>
        <span>Canvas</span>
        {svgResult && (
          <span className={css.headerMeta}>
            {svgResult.viewBox.width.toFixed(0)}×{svgResult.viewBox.height.toFixed(0)} pt · {canvasTransform.scale.toFixed(2)}x
            {errorCount > 0 && (
              <>
                {" "}
                · <span className={css.errMeta}>{errorCount} err</span>
              </>
            )}
            {warnCount > 0 && (
              <>
                {" "}
                · <span className={css.warnMeta}>{warnCount} warn</span>
              </>
            )}
          </span>
        )}

        <div className={css.headerButtons}>
          <button className={css.headerBtn} onClick={() => dispatch({ type: "TOGGLE_CANVAS_AID", aid: "grid" })}>
            {showGrid ? "Grid On" : "Grid Off"}
          </button>
          <button className={css.headerBtn} onClick={fitToContent} disabled={!svgResult}>
            Fit
          </button>
        </div>
      </div>

      {diagnostics.length > 0 && (
        <div className={css.diagnostics}>
          {diagnostics.slice(0, 5).map((d, i) => (
            <div key={i} className={`${css.diagnostic} ${d.severity === "error" ? css.error : css.warning}`}>
              <code>{d.code ?? d.severity}</code>
              <span>{d.message}</span>
            </div>
          ))}
          {diagnostics.length > 5 && (
            <div className={css.diagnostic}>
              <span />
              <span>…{diagnostics.length - 5} more</span>
            </div>
          )}
        </div>
      )}

      <div className={[css.canvasGrid, showRulers ? "" : css.canvasGridNoRulers].filter(Boolean).join(" ")}>
        {showRulers ? <div className={css.rulerCorner}>cm</div> : null}

        {showRulers ? (
          <svg
            ref={topRulerRef}
            className={css.topRuler}
            viewBox={`0 0 ${Math.max(1, viewportSize.width)} ${RULER_SIZE}`}
            onPointerDown={onTopRulerPointerDown}
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
            onPointerDown={onLeftRulerPointerDown}
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
          tabIndex={0}
          onKeyDown={onViewportKeyDown}
          onPointerDown={() => viewportRef.current?.focus({ preventScroll: true })}
        >
          {!svgResult ? (
            <div className={css.noSvg}>{snapshot.source ? "Computing…" : "No source"}</div>
          ) : (
            <div
              className={css.worldStage}
              style={{
                width: svgResult.viewBox.width,
                height: svgResult.viewBox.height,
                transform: `translate(${canvasTransform.translateX}px, ${canvasTransform.translateY}px) scale(${canvasTransform.scale})`
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
                  onElementPointerDown={onElementPointerDown}
                  onElementDoubleClick={onElementDoubleClick}
                  onHoverChange={(id) => dispatch({ type: "SET_HOVERED_ELEMENT", id })}
                />

                <SelectionOverlay
                  marqueeBounds={marqueeBounds}
                  selectionBoxes={selectionBoxes}
                  selectionStrokeWidth={selectionStrokeWidth}
                  textSelectionVisual={textSelectionVisual}
                />

                {toolMode === "select" && (
                  <HandleOverlay
                    handleDisplays={handleDisplays}
                    handleHalfSize={handleHalfSize}
                    handleStrokeWidth={handleStrokeWidth}
                    onHandlePointerDown={onHandlePointerDown}
                    onElementPointerDown={onElementPointerDown}
                    onResizeHandlePointerDown={onResizeHandlePointerDown}
                  />
                )}
              </svg>
            </div>
          )}

          {warning && (
            <div
              className={css.warningBar}
              onClick={copyWarningToClipboard}
              onKeyDown={onWarningBarKeyDown}
              role="button"
              tabIndex={0}
              title="Click to copy message"
              aria-label="Warning message. Click to copy."
            >
              {warning}
            </div>
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
              <div
                className={css.snapDebugResizeHandle}
                onPointerDown={onSnapDebugResizePointerDown}
                title="Drag to resize"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function collectSelectionBounds(
  elements: SceneElement[],
  selectedIds: ReadonlySet<string>,
  viewBox: SvgViewBox
): SelectionBounds[] {
  const boundsBySource = collectSourceBounds(elements, viewBox);
  const selections: SelectionBounds[] = [];
  for (const [sourceId, bounds] of boundsBySource.entries()) {
    if (selectedIds.has(sourceId)) {
      selections.push({ sourceId, bounds });
    }
  }
  return selections;
}

function collectSourceBounds(elements: SceneElement[], viewBox: SvgViewBox): Map<string, Bounds> {
  const boundsBySource = new Map<string, Bounds>();

  for (const element of elements) {
    const bounds = elementBoundsInSvg(element, viewBox);
    if (!bounds) continue;

    const existing = boundsBySource.get(element.sourceId);
    if (!existing) {
      boundsBySource.set(element.sourceId, bounds);
    } else {
      boundsBySource.set(element.sourceId, mergeBounds(existing, bounds));
    }
  }

  return boundsBySource;
}

function elementBoundsInSvg(element: SceneElement, viewBox: SvgViewBox): Bounds | null {
  if (element.kind === "Path") {
    return pathBoundsInSvg(element, viewBox);
  }

  if (element.kind === "Circle") {
    const center = worldToSvgPoint(element.center, viewBox);
    return {
      minX: center.x - element.radius,
      maxX: center.x + element.radius,
      minY: center.y - element.radius,
      maxY: center.y + element.radius
    };
  }

  if (element.kind === "Ellipse") {
    const center = worldToSvgPoint(element.center, viewBox);
    return computeEllipseBounds(center.x, center.y, element.rx, element.ry, element.rotation ?? 0);
  }

  return textBounds(element, viewBox);
}

function textBounds(element: SceneText, viewBox: SvgViewBox): Bounds {
  const textGeometry = textGeometryInSvg(element, viewBox);
  return computeRotatedRectBounds(
    textGeometry.cx,
    textGeometry.cy,
    textGeometry.width,
    textGeometry.height,
    textGeometry.rotation
  );
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

function pathBoundsInSvg(path: ScenePath, viewBox: SvgViewBox): Bounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let previous: { x: number; y: number } | null = null;

  const includePoint = (point: { x: number; y: number }) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  };

  for (const command of path.commands) {
    if (command.kind === "Z") continue;

    if (command.kind === "C") {
      includePoint(worldToSvgPoint(command.c1, viewBox));
      includePoint(worldToSvgPoint(command.c2, viewBox));
    }

    if (command.kind === "A") {
      if (previous) {
        includePoint({ x: previous.x - command.rx, y: previous.y - command.ry });
        includePoint({ x: previous.x + command.rx, y: previous.y + command.ry });
      }
      const to = worldToSvgPoint(command.to, viewBox);
      includePoint({ x: to.x - command.rx, y: to.y - command.ry });
      includePoint({ x: to.x + command.rx, y: to.y + command.ry });
      previous = to;
      continue;
    }

    const point = worldToSvgPoint(command.to, viewBox);
    includePoint(point);
    previous = point;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

function computeEllipseBounds(cx: number, cy: number, rx: number, ry: number, rotation: number): Bounds {
  const theta = (rotation * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const extentX = Math.sqrt(rx * rx * cos * cos + ry * ry * sin * sin);
  const extentY = Math.sqrt(rx * rx * sin * sin + ry * ry * cos * cos);

  return {
    minX: cx - extentX,
    maxX: cx + extentX,
    minY: cy - extentY,
    maxY: cy + extentY
  };
}

function computeRotatedRectBounds(cx: number, cy: number, width: number, height: number, rotation: number): Bounds {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  if (Math.abs(rotation) <= 1e-6) {
    return {
      minX: cx - halfWidth,
      maxX: cx + halfWidth,
      minY: cy - halfHeight,
      maxY: cy + halfHeight
    };
  }

  const theta = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(theta));
  const sin = Math.abs(Math.sin(theta));
  const extentX = halfWidth * cos + halfHeight * sin;
  const extentY = halfWidth * sin + halfHeight * cos;

  return {
    minX: cx - extentX,
    maxX: cx + extentX,
    minY: cy - extentY,
    maxY: cy + extentY
  };
}

function mergeBounds(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY)
  };
}

function selectionAnchorRatioFromPoint(bounds: Bounds, point: Point): { x: number; y: number } {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  return {
    x: Math.abs(width) > 1e-9 ? (point.x - bounds.minX) / width : 0.5,
    y: Math.abs(height) > 1e-9 ? (point.y - bounds.minY) / height : 0.5
  };
}

function caretStrokeWidthInSvg(fontSizePt: number): number {
  if (!Number.isFinite(fontSizePt) || fontSizePt <= 0) {
    return 0.5;
  }
  return clamp(fontSizePt * 0.055, 0.45, 1.1);
}

function estimateTextBlockWidth(text: string, fontSize: number): number {
  const lines = text.split("\n");
  const maxChars = lines.reduce((max, line) => Math.max(max, line.length), 0);
  if (maxChars <= 0) {
    return 0;
  }
  return maxChars * fontSize * 0.7;
}

function makeMergeKey(prefix: string, id: string, pointerId: number): string {
  return `${prefix}:${id}:${pointerId}:${Date.now().toString(36)}`;
}

function previewArrowPoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  size: number
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len <= 1e-6) {
    return `${fmt(x2)},${fmt(y2)}`;
  }

  const ux = dx / len;
  const uy = dy / len;
  const baseX = x2 - ux * size;
  const baseY = y2 - uy * size;
  const halfWidth = size * 0.45;
  const px = -uy * halfWidth;
  const py = ux * halfWidth;

  const p1 = `${fmt(x2)},${fmt(y2)}`;
  const p2 = `${fmt(baseX + px)},${fmt(baseY + py)}`;
  const p3 = `${fmt(baseX - px)},${fmt(baseY - py)}`;
  return `${p1} ${p2} ${p3}`;
}

function collectNewSourceIds(elements: SceneElement[], beforeIds: ReadonlySet<string>): string[] {
  const newIds = new Set<string>();
  for (const element of elements) {
    if (!beforeIds.has(element.sourceId)) {
      newIds.add(element.sourceId);
    }
  }
  return [...newIds];
}

function collectNodeTextEntries(statements: readonly Statement[]): Map<string, NodeTextSelectionEntry> {
  const entries = new Map<string, NodeTextSelectionEntry>();

  const addNodeEntry = (sourceId: string, entry: NodeTextSelectionEntry) => {
    if (entry.span.to <= entry.span.from) {
      return;
    }
    entries.set(sourceId, entry);
  };

  const visitPathItems = (items: readonly PathItem[]) => {
    const nodesForStatement: Array<{ id: string; entry: NodeTextSelectionEntry }> = [];
    for (const item of items) {
      if (item.kind === "Node") {
        const entry: NodeTextSelectionEntry = {
          span: item.textSpan,
          text: item.text,
          hasTextWidth: hasTextWidthOption(item.options?.entries)
        };
        addNodeEntry(item.id, entry);
        nodesForStatement.push({ id: item.id, entry });
        continue;
      }

      if ((item.kind === "ToOperation" || item.kind === "EdgeOperation") && item.nodes) {
        for (const node of item.nodes) {
          const entry: NodeTextSelectionEntry = {
            span: node.textSpan,
            text: node.text,
            hasTextWidth: hasTextWidthOption(node.options?.entries)
          };
          addNodeEntry(node.id, entry);
          nodesForStatement.push({ id: node.id, entry });
        }
      }
    }
    return nodesForStatement;
  };

  const visitStatements = (items: readonly Statement[]) => {
    for (const statement of items) {
      if (statement.kind === "Path") {
        const statementNodes = visitPathItems(statement.items);
        if (statement.command === "node" && statementNodes.length > 0) {
          addNodeEntry(statement.id, statementNodes[0]!.entry);
        } else if (statementNodes.length === 1) {
          addNodeEntry(statement.id, statementNodes[0]!.entry);
        }
        continue;
      }
      if (statement.kind === "Scope") {
        visitStatements(statement.body);
      }
    }
  };

  visitStatements(statements);
  return entries;
}

function hasTextWidthOption(
  options: ReadonlyArray<{ kind: "kv" | "flag" | "unknown"; key?: string }> | undefined
): boolean {
  if (!options) {
    return false;
  }
  for (const entry of options) {
    if (entry.kind === "kv" && entry.key === "text width") {
      return true;
    }
  }
  return false;
}

function sourceHasSingleResizablePathShape(
  elements: readonly SceneElement[],
  sourceId: string
): boolean {
  const sourceElements = elements.filter((element) => element.sourceId === sourceId);
  const nonText = sourceElements.filter((element) => element.kind !== "Text");
  const shapes = nonText.filter((element) => element.kind === "Circle" || element.kind === "Ellipse");
  if (shapes.length !== 1) {
    return false;
  }

  const element = shapes[0];
  if (!element) {
    return false;
  }
  if (element.kind === "Circle") {
    return true;
  }
  if (element.kind === "Ellipse") {
    return isOrthogonalEllipseRotation(element.rotation ?? 0);
  }
  return false;
}

function isOrthogonalEllipseRotation(rotation: number): boolean {
  const normalized = ((rotation % 360) + 360) % 360;
  return (
    Math.abs(normalized - 0) <= 1e-6 ||
    Math.abs(normalized - 90) <= 1e-6 ||
    Math.abs(normalized - 180) <= 1e-6 ||
    Math.abs(normalized - 270) <= 1e-6
  );
}

function ellipseAspectRatioForSource(
  elements: readonly SceneElement[],
  sourceId: string
): number | null {
  const ellipses = elements.filter(
    (element): element is Extract<SceneElement, { kind: "Ellipse" }> =>
      element.sourceId === sourceId && element.kind === "Ellipse"
  );
  if (ellipses.length !== 1) {
    return null;
  }

  const ellipse = ellipses[0];
  if (!ellipse || !isOrthogonalEllipseRotation(ellipse.rotation ?? 0) || ellipse.rx <= 1e-6 || ellipse.ry <= 1e-6) {
    return null;
  }

  const normalized = (((ellipse.rotation ?? 0) % 360) + 360) % 360;
  const swapAxes = Math.abs(normalized - 90) <= 1e-6 || Math.abs(normalized - 270) <= 1e-6;
  const horizontalRadius = swapAxes ? ellipse.ry : ellipse.rx;
  const verticalRadius = swapAxes ? ellipse.rx : ellipse.ry;
  if (horizontalRadius <= 1e-6 || verticalRadius <= 1e-6) {
    return null;
  }
  return verticalRadius / horizontalRadius;
}

function findWordRangeAtIndex(text: string, index: number): { start: number; end: number } | null {
  if (text.length === 0) {
    return null;
  }

  let probe = clamp(Math.floor(index), 0, text.length);
  if (probe === text.length) {
    probe = text.length - 1;
  }
  if (probe < 0) {
    return null;
  }

  if (!isWordChar(text.charAt(probe))) {
    if (probe > 0 && isWordChar(text.charAt(probe - 1))) {
      probe -= 1;
    } else {
      return null;
    }
  }

  let start = probe;
  let end = probe + 1;
  while (start > 0 && isWordChar(text.charAt(start - 1))) {
    start -= 1;
  }
  while (end < text.length && isWordChar(text.charAt(end))) {
    end += 1;
  }

  return { start, end };
}

function isWordChar(character: string): boolean {
  return /^[A-Za-z0-9_]$/.test(character);
}

function preferredNodeBoundsForSource(
  elements: SceneElement[],
  sourceId: string,
  viewBox: SvgViewBox,
  fallback: Bounds | null
): Bounds | null {
  const sourceElements = elements.filter((element) => element.sourceId === sourceId);
  if (sourceElements.length === 0) {
    return fallback;
  }

  const nonText = sourceElements.filter((element) => element.kind !== "Text");
  const preferred = nonText.length > 0 ? nonText : sourceElements;

  let bounds: Bounds | null = null;
  for (const element of preferred) {
    const next = elementBoundsInSvg(element, viewBox);
    if (!next) continue;
    bounds = bounds ? mergeBounds(bounds, next) : next;
  }

  return bounds ?? fallback;
}

function getHandleCursor(
  handle: EditHandle,
  scene: { elements: SceneElement[] } | null,
  allHandles: EditHandle[]
): string {
  if (handle.kind !== "path-point" || !scene) {
    return "move";
  }

  const siblingPathHandles = allHandles.filter(
    (candidate) => candidate.kind === "path-point" && candidate.sourceId === handle.sourceId
  );
  if (siblingPathHandles.length === 2) {
    const other = siblingPathHandles.find((candidate) => candidate.id !== handle.id);
    if (other) {
      const vector = {
        x: other.world.x - handle.world.x,
        y: other.world.y - handle.world.y
      };
      if (vectorLengthSquared(vector) > 1e-12) {
        return resizeCursorForVector(vector);
      }
    }
  }

  const sourcePaths = scene.elements.filter(
    (element): element is ScenePath => element.kind === "Path" && element.sourceId === handle.sourceId
  );
  if (sourcePaths.length === 0) {
    return "move";
  }

  let bestVector: Point | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const path of sourcePaths) {
    let current: Point | null = null;
    let subpathStart: Point | null = null;
    for (const command of path.commands) {
      if (command.kind === "M") {
        current = command.to;
        subpathStart = command.to;
        continue;
      }

      if (command.kind === "Z") {
        if (current && subpathStart) {
          const vector = { x: subpathStart.x - current.x, y: subpathStart.y - current.y };
          const fromDist = distanceSquared(handle.world, current);
          if (fromDist < bestDistance && vectorLengthSquared(vector) > 1e-12) {
            bestDistance = fromDist;
            bestVector = vector;
          }
          const toDist = distanceSquared(handle.world, subpathStart);
          if (toDist < bestDistance && vectorLengthSquared(vector) > 1e-12) {
            bestDistance = toDist;
            bestVector = vector;
          }
          current = subpathStart;
        }
        continue;
      }

      if (!current) {
        current = command.to;
        continue;
      }

      const from = current;
      const to = command.to;

      if (command.kind === "L" || command.kind === "A") {
        const vector = { x: to.x - from.x, y: to.y - from.y };
        const fromDist = distanceSquared(handle.world, from);
        if (fromDist < bestDistance && vectorLengthSquared(vector) > 1e-12) {
          bestDistance = fromDist;
          bestVector = vector;
        }
        const toDist = distanceSquared(handle.world, to);
        if (toDist < bestDistance && vectorLengthSquared(vector) > 1e-12) {
          bestDistance = toDist;
          bestVector = vector;
        }
      } else {
        const startVector = { x: command.c1.x - from.x, y: command.c1.y - from.y };
        const endVector = { x: to.x - command.c2.x, y: to.y - command.c2.y };

        const fromDist = distanceSquared(handle.world, from);
        if (fromDist < bestDistance && vectorLengthSquared(startVector) > 1e-12) {
          bestDistance = fromDist;
          bestVector = startVector;
        }
        const toDist = distanceSquared(handle.world, to);
        if (toDist < bestDistance && vectorLengthSquared(endVector) > 1e-12) {
          bestDistance = toDist;
          bestVector = endVector;
        }
      }

      current = to;
    }
  }

  if (!bestVector) {
    return "move";
  }

  return resizeCursorForVector(bestVector);
}

function selectNudgeAnchorHandle(handles: EditHandle[]): EditHandle | null {
  if (handles.length === 0) {
    return null;
  }
  return handles.find((handle) => handle.kind === "node-position") ?? handles[0]!;
}

function isPointInsideRect(clientX: number, clientY: number, rect: DOMRect): boolean {
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function addGuide(guides: GuidesState, orientation: GuideOrientation, value: number): GuidesState {
  if (orientation === "vertical") {
    const nextVertical = [...guides.vertical];
    const added = upsertGuideValue(nextVertical, value);
    if (!added) {
      return guides;
    }
    nextVertical.sort((a, b) => a - b);
    return { ...guides, vertical: nextVertical };
  }

  const nextHorizontal = [...guides.horizontal];
  const added = upsertGuideValue(nextHorizontal, value);
  if (!added) {
    return guides;
  }
  nextHorizontal.sort((a, b) => a - b);
  return { ...guides, horizontal: nextHorizontal };
}

function removeGuide(guides: GuidesState, orientation: GuideOrientation, value: number): GuidesState {
  if (orientation === "vertical") {
    const nextVertical = [...guides.vertical];
    const removed = removeGuideValue(nextVertical, value);
    if (!removed) {
      return guides;
    }
    return { ...guides, vertical: nextVertical };
  }

  const nextHorizontal = [...guides.horizontal];
  const removed = removeGuideValue(nextHorizontal, value);
  if (!removed) {
    return guides;
  }
  return { ...guides, horizontal: nextHorizontal };
}

function moveGuide(
  guides: GuidesState,
  orientation: GuideOrientation,
  sourceValue: number,
  targetValue: number
): GuidesState {
  const withoutSource = removeGuide(guides, orientation, sourceValue);
  return addGuide(withoutSource, orientation, targetValue);
}

function upsertGuideValue(values: number[], value: number): boolean {
  const normalized = normalizeGuideValue(value);
  if (values.some((existing) => Math.abs(existing - normalized) <= 1e-4)) {
    return false;
  }
  values.push(normalized);
  return true;
}

function removeGuideValue(values: number[], value: number): boolean {
  const normalized = normalizeGuideValue(value);
  const index = values.findIndex((existing) => Math.abs(existing - normalized) <= 1e-4);
  if (index < 0) {
    return false;
  }
  values.splice(index, 1);
  return true;
}

function normalizeGuideValue(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

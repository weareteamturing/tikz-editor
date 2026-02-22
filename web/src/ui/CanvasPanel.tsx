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
import { applyEditAction, type EditAction, type ElementTemplate } from "tikz-editor/edit/actions";
import { createMathJaxNodeTextEngine } from "tikz-editor/text/mathjax-engine";
import {
  buildSnapContext,
  collectSelectionGeometry,
  snapHandlePosition,
  snapKeyboardNudge,
  snapSelectionTranslation,
  snapToolPointer,
  type SelectionGeometry,
  type SnapContext,
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
import type { SvgViewBox } from "tikz-editor/svg/types";
import { useEditorStore } from "../store/store";
import type { CanvasTransform, ToolMode } from "../store/types";
import { requestSourceSelection } from "./source-sync";
import css from "./CanvasPanel.module.css";

type DiagnosticRow = {
  severity: "error" | "warning";
  message: string;
  code?: string;
  source: "parse" | "semantic";
};

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type HitRegion =
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

type DragState =
  | {
      kind: "element";
      pointerId: number;
      elementIds: string[];
      startWorld: Point;
      snapContext: SnapContext | null;
      initialSelection: SelectionGeometry | null;
      selectionAnchorRatio: { x: number; y: number } | null;
      historyMergeKey: string;
    }
  | {
      kind: "handle";
      pointerId: number;
      handleId: string;
      sourceId: string;
      handleKind: EditHandle["kind"];
      lastKnownWorld: Point;
      snapContext: SnapContext | null;
      historyMergeKey: string;
    }
  | {
      kind: "pan";
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startTransform: CanvasTransform;
    }
  | {
      kind: "marquee";
      pointerId: number;
      startWorld: Point;
      currentWorld: Point;
      additive: boolean;
    }
  | {
      kind: "tool-create";
      pointerId: number;
      toolMode: ToolCreateMode;
      startWorld: Point;
      currentWorld: Point;
      snapContext: SnapContext | null;
    }
  | {
      kind: "text-select";
      pointerId: number;
      sourceId: string;
      sourceSpan: Span;
      textLength: number;
      totalWidth: number;
      fontSizePt: number;
      rotation: number;
      cx: number;
      cy: number;
      width: number;
      height: number;
      anchorIndex: number;
      headIndex: number;
      prefixTable: readonly number[] | null;
    };

type SelectionBounds = {
  sourceId: string;
  bounds: Bounds;
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
    };

type RulerTick = {
  worldValue: number;
  viewportPos: number;
  major: boolean;
  label?: string;
};

type GridLines = {
  verticalMinor: number[];
  verticalMajor: number[];
  horizontalMinor: number[];
  horizontalMajor: number[];
  yMin: number;
  yMax: number;
};

type VisibleRanges = {
  worldMinX: number;
  worldMaxX: number;
  worldMinY: number;
  worldMaxY: number;
  svgMinY: number;
  svgMaxY: number;
};

type ToolCreateMode = "addLine" | "addArrow" | "addRect" | "addCircle";

type ToolPreview =
  | { kind: "cursor"; x: number; y: number }
  | { kind: "node"; x: number; y: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; arrow: boolean }
  | { kind: "rect"; x: number; y: number; width: number; height: number }
  | { kind: "circle"; cx: number; cy: number; r: number };

type PendingAddedSelection = {
  beforeIds: Set<string>;
  preferredWorld: Point;
};

type NodeTextSelectionEntry = {
  span: Span;
  text: string;
  hasTextWidth: boolean;
};

type TextSelectionOverlay = {
  sourceId: string;
  textLength: number;
  totalWidth: number;
  fontSizePt: number;
  startIndex: number;
  endIndex: number;
  rotation: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
  prefixTable: readonly number[] | null;
};

type EditableTextTarget = {
  sourceId: string;
  sourceSpan: Span;
  text: string;
  style: SceneText["style"];
  totalWidth: number;
  region: Extract<HitRegion, { shape: "rect" }>;
};

type TextIndexMappingTarget = {
  textLength: number;
  totalWidth: number;
  region: Extract<HitRegion, { shape: "rect" }>;
};

type SnapDebugPoint = {
  x: number;
  y: number;
};

type SnapDebugOverlayRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type SnapDebugLineSummary =
  | {
      type: "points";
      axis: "x" | "y";
      pointCount: number;
      points: SnapDebugPoint[];
    }
  | {
      type: "pointer";
      axis: "x" | "y";
      from: SnapDebugPoint;
      to: SnapDebugPoint;
    }
  | {
      type: "gap";
      direction: "horizontal" | "vertical";
      gapKind: "center" | "equal";
      segmentCount: number;
      segments: Array<{ from: SnapDebugPoint; to: SnapDebugPoint }>;
    };

type SnapDebugContextSummary = {
  zoom: number;
  thresholdWorld: number;
  selectedSourceIds: string[];
  referencePointCount: number;
  referenceBoundsCount: number;
  horizontalGapCount: number;
  verticalGapCount: number;
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

type SnapDebugLogInput = {
  phase: string;
  note?: string;
  snapshotMatchesSource: boolean;
  dragKind: DragState["kind"] | null;
  context?: SnapContext | null;
  rawPoint?: Point | null;
  rawDelta?: Point | null;
  snappedPoint?: Point | null;
  snappedDelta?: Point | null;
  offset?: Point | null;
  lines?: readonly SnapLine[];
};

type ApplyActionFeedback = {
  sourceChanged: boolean;
};

const RULER_SIZE = 24;
const FIT_PADDING = 44;
const HIT_STROKE_PX = 10;
const MIN_SCALE = 0.05;
const MAX_SCALE = 20;
const ZOOM_EXP_FACTOR = 0.0045;
const NUDGE_STEP_PT = 0.05 * PT_PER_CM;
const NUDGE_STEP_SHIFT_PT = 0.25 * PT_PER_CM;
const HANDLE_SQUARE_SIZE_PX = 9;
const TOOL_PREVIEW_NODE_RADIUS_PX = 12;
const TOOL_PREVIEW_CIRCLE_RADIUS_PT = 0.8 * PT_PER_CM;
const SNAP_DEBUG_MIN_WIDTH_PX = 280;
const SNAP_DEBUG_MIN_HEIGHT_PX = 140;
const SNAP_DEBUG_MARGIN_PX = 8;
const SNAP_GAP_ARROW_MARKER_ID = "snap-gap-arrow-marker";
const PREFIX_MEASURE_TEXT_MAX_LENGTH = 240;
const PREFIX_MEASURE_CACHE_LIMIT = 64;

export function CanvasPanel() {
  const source = useEditorStore((s) => s.source);
  const snapshot = useEditorStore((s) => s.snapshot);
  const toolMode = useEditorStore((s) => s.toolMode);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const hoveredElementId = useEditorStore((s) => s.hoveredElementId);
  const canvasTransform = useEditorStore((s) => s.canvasTransform);
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
  const [showGrid, setShowGrid] = useState(true);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [toolCursorWorld, setToolCursorWorld] = useState<Point | null>(null);
  const [toolDraft, setToolDraft] = useState<Extract<DragState, { kind: "tool-create" }> | null>(null);
  const [marqueeDraft, setMarqueeDraft] = useState<Extract<DragState, { kind: "marquee" }> | null>(null);
  const [textSelectionOverlay, setTextSelectionOverlay] = useState<TextSelectionOverlay | null>(null);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const interactionSvgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pendingAddedSelectionRef = useRef<PendingAddedSelection | null>(null);
  const autoFitDoneRef = useRef(false);
  const canvasTransformRef = useRef(canvasTransform);
  const selectedElementIdsRef = useRef(selectedElementIds);
  const svgResultRef = useRef(svgResult);
  const sourceBoundsRef = useRef(new Map<string, Bounds>());
  const previousViewBoxRef = useRef<SvgViewBox | null>(null);
  const snapDebugDragRef = useRef<SnapDebugOverlayDragState | null>(null);
  const textEngineRef = useRef<NodeTextEngine | null>(null);
  const prefixTableCacheRef = useRef(new Map<string, readonly number[]>());

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
    const nodeSourceIds = new Set<string>();

    for (const handle of selectedHandles) {
      if (handle.kind === "node-position") {
        nodeSourceIds.add(handle.sourceId);
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

    for (const sourceId of nodeSourceIds) {
      const fallbackBounds = selectionBoundsBySource.get(sourceId) ?? null;
      const bounds = preferredNodeBoundsForSource(
        snapshot.scene?.elements ?? [],
        sourceId,
        svgResult.viewBox,
        fallbackBounds
      );
      if (!bounds) {
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
          kind: "move-element",
          elementId: sourceId
        },
        {
          key: `node-handle:${sourceId}:top-right`,
          x: bounds.maxX,
          y: bounds.minY,
          cursor: "ne-resize",
          kind: "move-element",
          elementId: sourceId
        },
        {
          key: `node-handle:${sourceId}:bottom-left`,
          x: bounds.minX,
          y: bounds.maxY,
          cursor: "sw-resize",
          kind: "move-element",
          elementId: sourceId
        },
        {
          key: `node-handle:${sourceId}:bottom-right`,
          x: bounds.maxX,
          y: bounds.maxY,
          cursor: "se-resize",
          kind: "move-element",
          elementId: sourceId
        }
      );
    }

    return displays;
  }, [selectedHandles, selectionBoundsBySource, snapshot.scene, svgResult]);

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

    if (toolDraft.toolMode === "addRect") {
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      return {
        kind: "rect",
        x,
        y,
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y)
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

  const applyActionWithFeedback = useCallback(
    (action: EditAction, historyMergeKey?: string): ApplyActionFeedback => {
      const result = applyEditAction(source, snapshot.editHandles, action);

      if (result.kind === "success" || result.kind === "partial") {
        if (result.kind === "partial") {
          const skippedCount = result.skippedHandles.length;
          setWarning(`${result.reason} (${skippedCount} handle${skippedCount === 1 ? "" : "s"} skipped)`);
        }

        const sourceChanged = result.newSource !== source;
        if (sourceChanged) {
          dispatch({ type: "APPLY_EDIT_ACTION", action, historyMergeKey });
        }
        return { sourceChanged };
      }

      if (result.kind === "unsupported") {
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
      if (event.shiftKey || event.button !== 0) {
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
      dragRef.current = {
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
      };
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
      snapshot.source,
      source,
      svgResult,
      textIndexFromClient
    ]
  );

  const onElementPointerDown = useCallback(
    (event: ReactPointerEvent<SVGElement>, sourceId: string, region?: HitRegion) => {
      if (!svgResult || toolMode !== "select" || event.button !== 0) return;

      viewportRef.current?.focus({ preventScroll: true });
      event.preventDefault();
      event.stopPropagation();

      if (beginTextSelectionDrag(event, sourceId, region)) {
        return;
      }

      setTextSelectionOverlay(null);

      const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, svgResult.viewBox);
      if (!world) return;

      if (event.shiftKey) {
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

      dragRef.current = {
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
      };
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
      selectedElementIds,
      snapshot.scene,
      snapshot.source,
      source,
      svgResult,
      toolMode,
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

      viewportRef.current?.focus({ preventScroll: true });
      event.preventDefault();
      event.stopPropagation();
      setTextSelectionOverlay(null);

      if (event.shiftKey) {
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
            zoom: canvasTransform.scale,
            viewportWorld: viewportWorldBounds
          })
        : null;
      setSnapLines([]);

      dragRef.current = {
        kind: "handle",
        pointerId: event.pointerId,
        handleId: handle.id,
        sourceId: handle.sourceId,
        handleKind: handle.kind,
        lastKnownWorld: { ...handle.world },
        snapContext,
        historyMergeKey: makeMergeKey("drag-handle", handle.id, event.pointerId)
      };
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
      selectedElementIds,
      snapshot.scene,
      snapshot.source,
      source,
      svgResult,
      toolMode,
      viewportWorldBounds
    ]
  );

  const onInteractionPointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      viewportRef.current?.focus({ preventScroll: true });
      setTextSelectionOverlay(null);

      if (!svgResult) return;

      const canPan = event.button === 1 || (event.button === 0 && event.altKey);
      if (canPan) {
        dragRef.current = {
          kind: "pan",
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startTransform: canvasTransform
        };
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
            : { snappedPoint: world, lines: [] as SnapLine[] };
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
            currentWorld: snappedStart,
            snapContext: toolSnapContext
          };
          dragRef.current = nextDraft;
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
          if (!event.shiftKey) {
            dispatch({ type: "CLEAR_SELECTION" });
          }
          return;
        }

        const nextMarquee: Extract<DragState, { kind: "marquee" }> = {
          kind: "marquee",
          pointerId: event.pointerId,
          startWorld: world,
          currentWorld: world,
          additive: event.shiftKey
        };
        dragRef.current = nextMarquee;
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
      snapshot.scene,
      snapshot.source,
      source,
      svgResult,
      toolMode,
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
          dragRef.current = null;
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
      selectedElementIds,
      snapshot.editHandles,
      snapshot.scene,
      snapshot.source,
      source,
      toolMode
    ]
  );

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
  }, [dispatch, svgResult]);

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
    setTextSelectionOverlay(null);
  }, [snapshot.source, source]);

  useEffect(() => {
    if (toolMode === "select") {
      setToolDraft(null);
      setToolCursorWorld(null);
      setSnapLines([]);
      if (dragRef.current?.kind === "tool-create") {
        dragRef.current = null;
      }
      return;
    }

    setTextSelectionOverlay(null);
    if (dragRef.current?.kind === "marquee") {
      dragRef.current = null;
      setMarqueeDraft(null);
    } else if (dragRef.current?.kind === "text-select") {
      dragRef.current = null;
    }
  }, [toolMode]);

  useEffect(() => {
    if (!textSelectionOverlay) {
      return;
    }
    if (!selectedElementIds.has(textSelectionOverlay.sourceId)) {
      setTextSelectionOverlay(null);
    }
  }, [selectedElementIds, textSelectionOverlay]);

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

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const ctrlOrMeta = event.ctrlKey || event.metaKey;

      if (drag.kind === "pan") {
        const deltaX = event.clientX - drag.startClientX;
        const deltaY = event.clientY - drag.startClientY;
        setSnapLines([]);
        logSnapDebug({
          phase: "drag-pan-move",
          snapshotMatchesSource: snapshot.source === source,
          dragKind: "pan",
          rawDelta: { x: deltaX, y: deltaY },
          lines: []
        });

        dispatch({
          type: "SET_CANVAS_TRANSFORM",
          transform: {
            ...drag.startTransform,
            translateX: drag.startTransform.translateX + deltaX,
            translateY: drag.startTransform.translateY + deltaY
          }
        });
        return;
      }

      if (drag.kind === "text-select") {
        if (snapshot.source !== source) {
          return;
        }
        const nextIndex = textIndexFromClient(
          event.clientX,
          event.clientY,
          {
            textLength: drag.textLength,
            totalWidth: drag.totalWidth,
            region: {
              shape: "rect",
              key: "",
              sourceId: drag.sourceId,
              x: drag.cx - drag.width / 2,
              y: drag.cy - drag.height / 2,
              width: drag.width,
              height: drag.height,
              cx: drag.cx,
              cy: drag.cy,
              rotation: drag.rotation
            }
          },
          drag.prefixTable
        );
        if (nextIndex == null || nextIndex === drag.headIndex) {
          return;
        }
        drag.headIndex = nextIndex;
        const anchorOffset = drag.sourceSpan.from + drag.anchorIndex;
        const headOffset = drag.sourceSpan.from + drag.headIndex;
        requestSourceSelection({
          from: Math.min(anchorOffset, headOffset),
          to: Math.max(anchorOffset, headOffset),
          anchor: anchorOffset,
          head: headOffset,
          sourceId: drag.sourceId,
          focus: true
        });
        setTextSelectionOverlay({
          sourceId: drag.sourceId,
          textLength: drag.textLength,
          totalWidth: drag.totalWidth,
          fontSizePt: drag.fontSizePt,
          startIndex: drag.anchorIndex,
          endIndex: drag.headIndex,
          rotation: drag.rotation,
          cx: drag.cx,
          cy: drag.cy,
          width: drag.width,
          height: drag.height,
          prefixTable: drag.prefixTable
        });
        setSnapLines([]);
        logSnapDebug({
          phase: "drag-text-select-move",
          snapshotMatchesSource: true,
          dragKind: "text-select",
          lines: []
        });
        return;
      }

      const currentSvg = svgResultRef.current;
      if (!currentSvg) {
        return;
      }

      const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, currentSvg.viewBox);
      if (!world) return;

      if (drag.kind === "tool-create") {
        const snapKind =
          drag.toolMode === "addRect"
            ? "rect-corner"
            : drag.toolMode === "addCircle"
              ? "circle-edge"
              : "line-end";
        const snapped = drag.snapContext
          ? snapToolPointer({
              context: drag.snapContext,
              pointer: world,
              kind: snapKind,
              anchor: drag.startWorld,
              modifiers: { ctrlOrMeta }
            })
          : { snappedPoint: world, lines: [] as SnapLine[] };
        drag.currentWorld = snapped.snappedPoint ?? world;
        setToolDraft({ ...drag });
        setToolCursorWorld(drag.currentWorld);
        setSnapLines(snapped.lines);
        logSnapDebug({
          phase: "drag-tool-create-move",
          snapshotMatchesSource: snapshot.source === source,
          dragKind: "tool-create",
          context: drag.snapContext,
          rawPoint: world,
          snappedPoint: drag.currentWorld,
          offset: snapped.offset,
          lines: snapped.lines
        });
        return;
      }

      if (drag.kind === "marquee") {
        drag.currentWorld = world;
        setMarqueeDraft({ ...drag });
        setSnapLines([]);
        logSnapDebug({
          phase: "drag-marquee-move",
          snapshotMatchesSource: snapshot.source === source,
          dragKind: "marquee",
          rawPoint: world,
          lines: []
        });
        return;
      }

      if (!svgResult || snapshot.source !== source) {
        setSnapLines([]);
        logSnapDebug({
          phase: "drag-move",
          note: "blocked: snapshot/source mismatch",
          snapshotMatchesSource: snapshot.source === source,
          dragKind: drag.kind,
          rawPoint: world,
          lines: []
        });
        return;
      }

      if (drag.kind === "element") {
        const rawTotalDelta = {
          x: world.x - drag.startWorld.x,
          y: world.y - drag.startWorld.y
        };
        const snapped = drag.snapContext && drag.initialSelection
          ? snapSelectionTranslation({
              context: drag.snapContext,
              selection: drag.initialSelection,
              rawDelta: rawTotalDelta,
              modifiers: { ctrlOrMeta }
            })
          : {
              snappedDelta: rawTotalDelta,
              lines: [] as SnapLine[]
            };
        const totalDelta = snapped.snappedDelta ?? rawTotalDelta;
        const actualTotalDelta = drag.initialSelection && snapshot.scene
          ? deriveSelectionTranslationDeltaFromAnchor(
              drag.initialSelection,
              collectSelectionGeometry(snapshot.scene.elements, drag.elementIds),
              drag.selectionAnchorRatio
            )
          : { x: 0, y: 0 };
        const incremental = {
          x: totalDelta.x - actualTotalDelta.x,
          y: totalDelta.y - actualTotalDelta.y
        };
        setSnapLines(snapped.lines);
        logSnapDebug({
          phase: "drag-element-move",
          snapshotMatchesSource: true,
          dragKind: "element",
          context: drag.snapContext,
          rawDelta: rawTotalDelta,
          snappedDelta: totalDelta,
          offset: snapped.offset,
          lines: snapped.lines
        });

        if (Math.abs(incremental.x) < 1e-6 && Math.abs(incremental.y) < 1e-6) {
          return;
        }

        applyActionWithFeedback(
          {
            kind: "moveElements",
            elementIds: drag.elementIds,
            delta: incremental
          },
          drag.historyMergeKey
        );
        return;
      }

      const resolvedHandleId = resolveHandleIdForDrag(drag, snapshot.editHandles);
      if (!resolvedHandleId) {
        setWarning("Handle is no longer available after recompute. Release and drag again.");
        return;
      }

      const snapped = drag.snapContext
        ? snapHandlePosition({
            context: drag.snapContext,
            point: world,
            sourceId: drag.sourceId,
            modifiers: { ctrlOrMeta }
          })
        : { snappedPoint: world, lines: [] as SnapLine[] };
      const nextWorld = snapped.snappedPoint ?? world;
      setSnapLines(snapped.lines);
      logSnapDebug({
        phase: "drag-handle-move",
        snapshotMatchesSource: true,
        dragKind: "handle",
        context: drag.snapContext,
        rawPoint: world,
        snappedPoint: nextWorld,
        offset: snapped.offset,
        lines: snapped.lines
      });

      const ok = applyActionWithFeedback(
        {
          kind: "moveHandle",
          handleId: resolvedHandleId,
          newWorld: nextWorld
        },
        drag.historyMergeKey
      );
      if (ok.sourceChanged) {
        drag.lastKnownWorld = nextWorld;
      }
    }

    function onPointerUp(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const ctrlOrMeta = event.ctrlKey || event.metaKey;

      const currentSvg = svgResultRef.current;
      const world =
        currentSvg == null
          ? null
          : clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, currentSvg.viewBox);

      if (drag.kind === "marquee") {
        const finalWorld = world ?? drag.currentWorld;
        const deltaSq = distanceSquared(finalWorld, drag.startWorld);
        const isClickOnly = deltaSq <= 0.25;

        if (isClickOnly) {
          if (!drag.additive) {
            dispatch({ type: "CLEAR_SELECTION" });
          }
        } else if (currentSvg) {
          const selection = boundsFromPoints(
            worldToSvgPoint(drag.startWorld, currentSvg.viewBox),
            worldToSvgPoint(finalWorld, currentSvg.viewBox)
          );
          const hitIds = collectSourceIdsInBounds(sourceBoundsRef.current, selection);
          if (drag.additive) {
            const merged = new Set(selectedElementIdsRef.current);
            for (const id of hitIds) {
              merged.add(id);
            }
            dispatch({ type: "SELECT_RANGE", ids: [...merged] });
          } else {
            dispatch({ type: "SELECT_RANGE", ids: hitIds });
          }
        }

        setMarqueeDraft(null);
        setSnapLines([]);
        dragRef.current = null;
        return;
      }

      if (drag.kind === "tool-create") {
        const rawFinalWorld = world ?? drag.currentWorld;
        const snapKind =
          drag.toolMode === "addRect"
            ? "rect-corner"
            : drag.toolMode === "addCircle"
              ? "circle-edge"
              : "line-end";
        const snapped = drag.snapContext
          ? snapToolPointer({
              context: drag.snapContext,
              pointer: rawFinalWorld,
              kind: snapKind,
              anchor: drag.startWorld,
              modifiers: { ctrlOrMeta }
            })
          : { snappedPoint: rawFinalWorld, lines: [] as SnapLine[] };
        const finalWorld = snapped.snappedPoint ?? rawFinalWorld;
        setSnapLines(snapped.lines);
        setToolCursorWorld(finalWorld);

        queueSelectionForAddedElement({
          x: (drag.startWorld.x + finalWorld.x) / 2,
          y: (drag.startWorld.y + finalWorld.y) / 2
        });
        const template = createTemplateForToolDrag(drag.toolMode, drag.startWorld, finalWorld);
        const ok = applyActionWithFeedback({
          kind: "addElement",
          template,
          at: drag.startWorld
        });
        if (!ok.sourceChanged) {
          pendingAddedSelectionRef.current = null;
        }

        if (ok.sourceChanged) {
          dispatch({ type: "SET_TOOL_MODE", mode: "select" });
          setToolCursorWorld(null);
        }
        setToolDraft(null);
        setSnapLines([]);
      }

      if (drag.kind === "text-select") {
        setSnapLines([]);
        dragRef.current = null;
        return;
      }

      setSnapLines([]);
      dragRef.current = null;
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [
    applyActionWithFeedback,
    dispatch,
    logSnapDebug,
    queueSelectionForAddedElement,
    snapshot.editHandles,
    snapshot.source,
    source,
    svgResult,
    textIndexFromClient
  ]);

  const handleHalfSize = (HANDLE_SQUARE_SIZE_PX / 2) / Math.max(canvasTransform.scale, 1e-3);
  const handleStrokeWidth = 1.2 / Math.max(canvasTransform.scale, 1e-3);
  const selectionStrokeWidth = 1.1 / Math.max(canvasTransform.scale, 1e-3);
  const gridMinorStrokeWidth = 0.6 / Math.max(canvasTransform.scale, 1e-3);
  const gridMajorStrokeWidth = 0.9 / Math.max(canvasTransform.scale, 1e-3);
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
          <button className={css.headerBtn} onClick={() => setShowGrid((v) => !v)}>
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

      <div className={css.canvasGrid}>
        <div className={css.rulerCorner}>cm</div>

        <svg className={css.topRuler} viewBox={`0 0 ${Math.max(1, viewportSize.width)} ${RULER_SIZE}`}>
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

        <svg className={css.leftRuler} viewBox={`0 0 ${RULER_SIZE} ${Math.max(1, viewportSize.height)}`}>
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
        </svg>

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
              <CanvasSVGLayer svg={svgResult.svg} />

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

                {snapLines.length > 0 && (
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
                        const points = line.points.map((point) => worldToSvgPoint(point, svgResult.viewBox));
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
                        const from = worldToSvgPoint(line.from, svgResult.viewBox);
                        const to = worldToSvgPoint(line.to, svgResult.viewBox);
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
                            const a = worldToSvgPoint(segment[0], svgResult.viewBox);
                            const b = worldToSvgPoint(segment[1], svgResult.viewBox);
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
                )}

                {toolPreview && (
                  <g className={css.toolPreview}>
                    {toolPreview.kind === "cursor" && (
                      <g>
                        <line
                          x1={toolPreview.x - TOOL_PREVIEW_NODE_RADIUS_PX / Math.max(canvasTransform.scale, 1e-3)}
                          y1={toolPreview.y}
                          x2={toolPreview.x + TOOL_PREVIEW_NODE_RADIUS_PX / Math.max(canvasTransform.scale, 1e-3)}
                          y2={toolPreview.y}
                          className={css.toolPreviewStroke}
                          strokeWidth={handleStrokeWidth}
                        />
                        <line
                          x1={toolPreview.x}
                          y1={toolPreview.y - TOOL_PREVIEW_NODE_RADIUS_PX / Math.max(canvasTransform.scale, 1e-3)}
                          x2={toolPreview.x}
                          y2={toolPreview.y + TOOL_PREVIEW_NODE_RADIUS_PX / Math.max(canvasTransform.scale, 1e-3)}
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
                          r={TOOL_PREVIEW_NODE_RADIUS_PX / Math.max(canvasTransform.scale, 1e-3)}
                          className={css.toolPreviewFill}
                          strokeWidth={handleStrokeWidth}
                        />
                        <line
                          x1={toolPreview.x - TOOL_PREVIEW_NODE_RADIUS_PX / Math.max(canvasTransform.scale, 1e-3)}
                          y1={toolPreview.y}
                          x2={toolPreview.x + TOOL_PREVIEW_NODE_RADIUS_PX / Math.max(canvasTransform.scale, 1e-3)}
                          y2={toolPreview.y}
                          className={css.toolPreviewStroke}
                          strokeWidth={handleStrokeWidth}
                        />
                        <line
                          x1={toolPreview.x}
                          y1={toolPreview.y - TOOL_PREVIEW_NODE_RADIUS_PX / Math.max(canvasTransform.scale, 1e-3)}
                          x2={toolPreview.x}
                          y2={toolPreview.y + TOOL_PREVIEW_NODE_RADIUS_PX / Math.max(canvasTransform.scale, 1e-3)}
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
                              10 / Math.max(canvasTransform.scale, 1e-3)
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
                )}

                <g className={css.hitRegions}>
                  {hitRegions.map((region) => {
                    const isHovered = hoveredElementId === region.sourceId;
                    const cursor = toolMode === "select" ? (editableTextRegionKeys.has(region.key) ? "text" : "move") : undefined;
                    const className = [
                      css.hitRegion,
                      isHovered ? css.hitRegionHovered : ""
                    ]
                      .filter(Boolean)
                      .join(" ");

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
                          onPointerEnter={() => {
                            if (toolMode === "select") {
                              dispatch({ type: "SET_HOVERED_ELEMENT", id: region.sourceId });
                            }
                          }}
                          onPointerLeave={() => {
                            if (toolMode === "select") {
                              dispatch({ type: "SET_HOVERED_ELEMENT", id: null });
                            }
                          }}
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
                          onPointerEnter={() => {
                            if (toolMode === "select") {
                              dispatch({ type: "SET_HOVERED_ELEMENT", id: region.sourceId });
                            }
                          }}
                          onPointerLeave={() => {
                            if (toolMode === "select") {
                              dispatch({ type: "SET_HOVERED_ELEMENT", id: null });
                            }
                          }}
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
                          onPointerEnter={() => {
                            if (toolMode === "select") {
                              dispatch({ type: "SET_HOVERED_ELEMENT", id: region.sourceId });
                            }
                          }}
                          onPointerLeave={() => {
                            if (toolMode === "select") {
                              dispatch({ type: "SET_HOVERED_ELEMENT", id: null });
                            }
                          }}
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
                        onPointerEnter={() => {
                          if (toolMode === "select") {
                            dispatch({ type: "SET_HOVERED_ELEMENT", id: region.sourceId });
                          }
                        }}
                        onPointerLeave={() => {
                          if (toolMode === "select") {
                            dispatch({ type: "SET_HOVERED_ELEMENT", id: null });
                          }
                        }}
                      />
                    );
                  })}
                </g>

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

                {toolMode === "select" && (
                  <g className={css.handleOverlay}>
                    {handleDisplays.map((display) => {
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
                          onPointerDown={(event) =>
                            display.kind === "move-handle"
                              ? onHandlePointerDown(event, display.handle)
                              : onElementPointerDown(event, display.elementId)
                          }
                        />
                      );
                    })}
                  </g>
                )}
              </svg>
            </div>
          )}

          {warning && <div className={css.warningBar}>{warning}</div>}
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

function CanvasSVGLayer({ svg }: { svg: string }) {
  return (
    <div
      className={css.svgLayer}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function clampSnapDebugOverlayRect(
  rect: SnapDebugOverlayRect,
  viewportWidth: number,
  viewportHeight: number
): SnapDebugOverlayRect {
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return rect;
  }

  const maxWidth = Math.max(SNAP_DEBUG_MIN_WIDTH_PX, viewportWidth - SNAP_DEBUG_MARGIN_PX * 2);
  const maxHeight = Math.max(SNAP_DEBUG_MIN_HEIGHT_PX, viewportHeight - SNAP_DEBUG_MARGIN_PX * 2);
  const width = Math.max(SNAP_DEBUG_MIN_WIDTH_PX, Math.min(rect.width, maxWidth));
  const height = Math.max(SNAP_DEBUG_MIN_HEIGHT_PX, Math.min(rect.height, maxHeight));
  const maxLeft = Math.max(SNAP_DEBUG_MARGIN_PX, viewportWidth - width - SNAP_DEBUG_MARGIN_PX);
  const maxTop = Math.max(SNAP_DEBUG_MARGIN_PX, viewportHeight - height - SNAP_DEBUG_MARGIN_PX);

  return {
    width,
    height,
    left: Math.max(SNAP_DEBUG_MARGIN_PX, Math.min(rect.left, maxLeft)),
    top: Math.max(SNAP_DEBUG_MARGIN_PX, Math.min(rect.top, maxTop))
  };
}

function roundForDebug(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

function toDebugPoint(point: Point | null | undefined): SnapDebugPoint | null {
  if (!point) {
    return null;
  }
  return {
    x: roundForDebug(point.x),
    y: roundForDebug(point.y)
  };
}

function summarizeSnapContextForDebug(context: SnapContext | null | undefined): SnapDebugContextSummary | null {
  if (!context) {
    return null;
  }

  return {
    zoom: roundForDebug(context.zoom),
    thresholdWorld: roundForDebug(context.settings.thresholdPx / Math.max(context.zoom, 1e-6)),
    selectedSourceIds: context.selectedSourceIds.slice(0, 8),
    referencePointCount: context.referencePoints.length,
    referenceBoundsCount: context.referenceBounds.length,
    horizontalGapCount: context.visibleGaps.horizontal.length,
    verticalGapCount: context.visibleGaps.vertical.length
  };
}

function summarizeSnapLinesForDebug(lines: readonly SnapLine[]): SnapDebugLineSummary[] {
  return lines.slice(0, 8).map((line) => {
    if (line.type === "points") {
      return {
        type: "points",
        axis: line.axis,
        pointCount: line.points.length,
        points: line.points.slice(0, 6).map((point) => ({
          x: roundForDebug(point.x),
          y: roundForDebug(point.y)
        }))
      };
    }

    if (line.type === "pointer") {
      return {
        type: "pointer",
        axis: line.axis,
        from: {
          x: roundForDebug(line.from.x),
          y: roundForDebug(line.from.y)
        },
        to: {
          x: roundForDebug(line.to.x),
          y: roundForDebug(line.to.y)
        }
      };
    }

    return {
      type: "gap",
      direction: line.direction,
      gapKind: line.gapKind,
      segmentCount: line.segments.length,
      segments: line.segments.slice(0, 4).map((segment) => ({
        from: {
          x: roundForDebug(segment[0].x),
          y: roundForDebug(segment[0].y)
        },
        to: {
          x: roundForDebug(segment[1].x),
          y: roundForDebug(segment[1].y)
        }
      }))
    };
  });
}

function buildHitRegions(elements: SceneElement[], viewBox: SvgViewBox, scale: number): HitRegion[] {
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

function boundsFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Bounds {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y)
  };
}

function collectSourceIdsInBounds(boundsBySource: ReadonlyMap<string, Bounds>, selection: Bounds): string[] {
  const selected: string[] = [];
  for (const [sourceId, bounds] of boundsBySource.entries()) {
    if (boundsContainedWithin(bounds, selection)) {
      selected.push(sourceId);
    }
  }
  return selected;
}

function boundsContainedWithin(inner: Bounds, outer: Bounds): boolean {
  const epsilon = 1e-6;
  return (
    inner.minX >= outer.minX - epsilon &&
    inner.maxX <= outer.maxX + epsilon &&
    inner.minY >= outer.minY - epsilon &&
    inner.maxY <= outer.maxY + epsilon
  );
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

function computeVisibleRanges(
  viewBox: SvgViewBox,
  transform: CanvasTransform,
  viewportWidth: number,
  viewportHeight: number
): VisibleRanges {
  const worldTopLeft = viewportToWorldPoint(0, 0, transform, viewBox);
  const worldBottomRight = viewportToWorldPoint(viewportWidth, viewportHeight, transform, viewBox);

  const svgTopLeft = viewportToSvgPoint(0, 0, transform, viewBox);
  const svgBottomRight = viewportToSvgPoint(viewportWidth, viewportHeight, transform, viewBox);

  return {
    worldMinX: Math.min(worldTopLeft.x, worldBottomRight.x),
    worldMaxX: Math.max(worldTopLeft.x, worldBottomRight.x),
    worldMinY: Math.min(worldTopLeft.y, worldBottomRight.y),
    worldMaxY: Math.max(worldTopLeft.y, worldBottomRight.y),
    svgMinY: Math.min(svgTopLeft.y, svgBottomRight.y),
    svgMaxY: Math.max(svgTopLeft.y, svgBottomRight.y)
  };
}

function buildTicks(
  worldMin: number,
  worldMax: number,
  minorStep: number,
  majorStep: number,
  mapWorldToViewport: (value: number) => number
): RulerTick[] {
  const values = buildValueSequence(worldMin, worldMax, minorStep, 1000);
  const ticks: RulerTick[] = [];

  for (const worldValue of values) {
    const major = isMultipleOfStep(worldValue, majorStep);
    ticks.push({
      worldValue,
      viewportPos: mapWorldToViewport(worldValue),
      major,
      label: major ? formatCm(worldValue / PT_PER_CM) : undefined
    });
  }

  return ticks;
}

function buildValueSequence(min: number, max: number, step: number, maxCount: number): number[] {
  if (!(step > 0) || !Number.isFinite(min) || !Number.isFinite(max)) return [];

  let startIndex = Math.floor(min / step) - 1;
  let endIndex = Math.ceil(max / step) + 1;

  if (endIndex < startIndex) {
    [startIndex, endIndex] = [endIndex, startIndex];
  }

  const total = endIndex - startIndex + 1;
  const stride = Math.max(1, Math.ceil(total / maxCount));

  const values: number[] = [];
  for (let i = startIndex; i <= endIndex; i += stride) {
    values.push(i * step);
  }
  return values;
}

function clientToWorldPoint(
  clientX: number,
  clientY: number,
  svgElement: SVGSVGElement | null,
  viewBox: SvgViewBox
): Point | null {
  if (!svgElement) return null;

  const ctm = svgElement.getScreenCTM();
  if (!ctm) return null;

  const point = svgElement.createSVGPoint();
  point.x = clientX;
  point.y = clientY;

  const svgPoint = point.matrixTransform(ctm.inverse());
  return svgToWorldPoint(svgPoint, viewBox);
}

function clientToSvgPoint(
  clientX: number,
  clientY: number,
  svgElement: SVGSVGElement | null
): { x: number; y: number } | null {
  if (!svgElement) {
    return null;
  }
  const ctm = svgElement.getScreenCTM();
  if (!ctm) {
    return null;
  }
  const point = svgElement.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const svgPoint = point.matrixTransform(ctm.inverse());
  return { x: svgPoint.x, y: svgPoint.y };
}

function rotatePointAroundCenter(
  point: { x: number; y: number },
  cx: number,
  cy: number,
  degrees: number
): { x: number; y: number } {
  if (Math.abs(degrees) <= 1e-6) {
    return point;
  }
  const theta = (degrees * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const dx = point.x - cx;
  const dy = point.y - cy;
  return {
    x: cx + dx * cos - dy * sin,
    y: cy + dx * sin + dy * cos
  };
}

function viewportToSvgPoint(
  viewportX: number,
  viewportY: number,
  transform: CanvasTransform,
  viewBox: SvgViewBox
): { x: number; y: number } {
  const scale = Math.max(transform.scale, 1e-6);
  return {
    x: viewBox.x + (viewportX - transform.translateX) / scale,
    y: viewBox.y + (viewportY - transform.translateY) / scale
  };
}

function viewportToWorldPoint(
  viewportX: number,
  viewportY: number,
  transform: CanvasTransform,
  viewBox: SvgViewBox
): Point {
  return svgToWorldPoint(viewportToSvgPoint(viewportX, viewportY, transform, viewBox), viewBox);
}

function toViewportXFromWorld(worldX: number, viewBox: SvgViewBox, transform: CanvasTransform): number {
  return transform.translateX + (worldX - viewBox.x) * transform.scale;
}

function toViewportYFromWorld(worldY: number, viewBox: SvgViewBox, transform: CanvasTransform): number {
  const svgY = worldToSvgY(worldY, viewBox);
  return transform.translateY + (svgY - viewBox.y) * transform.scale;
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

function svgToWorldPoint(point: { x: number; y: number }, viewBox: Pick<SvgViewBox, "y" | "height">): Point {
  return {
    x: point.x,
    y: viewBox.y + viewBox.height - (point.y - viewBox.y)
  };
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

function pointFromBoundsAnchorRatio(bounds: Bounds, ratio: { x: number; y: number }): Point {
  return {
    x: bounds.minX + (bounds.maxX - bounds.minX) * ratio.x,
    y: bounds.minY + (bounds.maxY - bounds.minY) * ratio.y
  };
}

function deriveSelectionTranslationDeltaFromAnchor(
  initialSelection: SelectionGeometry,
  currentSelection: SelectionGeometry | null,
  anchorRatio: { x: number; y: number } | null
): Point {
  if (!currentSelection) {
    return { x: 0, y: 0 };
  }

  const ratio = anchorRatio ?? { x: 0.5, y: 0.5 };
  const initialCenter = pointFromBoundsAnchorRatio(initialSelection.bounds, ratio);
  const currentCenter = pointFromBoundsAnchorRatio(currentSelection.bounds, ratio);
  return {
    x: currentCenter.x - initialCenter.x,
    y: currentCenter.y - initialCenter.y
  };
}

function hasVisibleFill(fill: string | null): boolean {
  return fill != null && fill !== "none";
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

function pickStepPt(scale: number, targetPixels: number): number {
  const cmSteps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50];
  const minStepPt = targetPixels / Math.max(scale, 1e-6);

  for (const cmStep of cmSteps) {
    const pt = cmStep * PT_PER_CM;
    if (pt >= minStepPt) return pt;
  }

  return cmSteps[cmSteps.length - 1]! * PT_PER_CM;
}

function isMultipleOfStep(value: number, step: number): boolean {
  if (!(step > 0)) return false;
  const q = value / step;
  return Math.abs(q - Math.round(q)) < 1e-4;
}

function formatCm(valueCm: number): string {
  if (Math.abs(valueCm) < 1e-8) return "0";

  const rounded2 = Math.round(valueCm * 100) / 100;
  if (Math.abs(rounded2 - Math.round(rounded2)) < 1e-8) {
    return String(Math.round(rounded2));
  }

  if (Math.abs(rounded2 * 10 - Math.round(rounded2 * 10)) < 1e-8) {
    return rounded2.toFixed(1);
  }

  return rounded2.toFixed(2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fmt(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function makeMergeKey(prefix: string, id: string, pointerId: number): string {
  return `${prefix}:${id}:${pointerId}:${Date.now().toString(36)}`;
}

function isToolCreateMode(mode: ToolMode): mode is ToolCreateMode {
  return mode === "addLine" || mode === "addArrow" || mode === "addRect" || mode === "addCircle";
}

function createTemplateForToolDrag(
  mode: ToolCreateMode,
  startWorld: Point,
  endWorld: Point
): ElementTemplate {
  const dx = endWorld.x - startWorld.x;
  const dy = endWorld.y - startWorld.y;
  const dragDistance = Math.hypot(dx, dy);
  const hasDrag = dragDistance >= 1e-3;

  if (mode === "addLine") {
    return hasDrag
      ? { kind: "line", hasArrow: false, to: endWorld }
      : { kind: "line", hasArrow: false };
  }

  if (mode === "addArrow") {
    return hasDrag
      ? { kind: "line", hasArrow: true, to: endWorld }
      : { kind: "line", hasArrow: true };
  }

  if (mode === "addRect") {
    return hasDrag
      ? { kind: "rectangle", corner: endWorld }
      : { kind: "rectangle" };
  }

  return hasDrag
    ? { kind: "circle", edge: endWorld }
    : { kind: "circle" };
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

function pickClosestSourceId(
  elements: SceneElement[],
  sourceIds: readonly string[],
  preferredWorld: Point
): string {
  let bestId = sourceIds[0]!;
  let bestDistSq = Number.POSITIVE_INFINITY;

  for (const sourceId of sourceIds) {
    const anchor = sourceIdAnchorWorld(elements, sourceId);
    const distSq = distanceSquared(anchor, preferredWorld);
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestId = sourceId;
    }
  }

  return bestId;
}

function sourceIdAnchorWorld(elements: SceneElement[], sourceId: string): Point {
  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (const element of elements) {
    if (element.sourceId !== sourceId) {
      continue;
    }
    const anchor = elementAnchorWorld(element);
    sumX += anchor.x;
    sumY += anchor.y;
    count += 1;
  }

  if (count === 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: sumX / count,
    y: sumY / count
  };
}

function elementAnchorWorld(element: SceneElement): Point {
  if (element.kind === "Circle" || element.kind === "Ellipse") {
    return element.center;
  }
  if (element.kind === "Text") {
    return element.position;
  }

  const firstPoint = firstPathPoint(element.commands);
  return firstPoint ?? { x: 0, y: 0 };
}

function firstPathPoint(commands: ScenePathCommand[]): Point | null {
  for (const command of commands) {
    if (command.kind === "Z") {
      continue;
    }
    return command.to;
  }
  return null;
}

function resolveHandleIdForDrag(
  drag: Extract<DragState, { kind: "handle" }>,
  handles: EditHandle[]
): string | null {
  const direct = handles.find((handle) => handle.id === drag.handleId);
  if (direct) {
    return direct.id;
  }

  let best: EditHandle | null = null;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (const handle of handles) {
    if (handle.sourceId !== drag.sourceId || handle.kind !== drag.handleKind) {
      continue;
    }
    const dx = handle.world.x - drag.lastKnownWorld.x;
    const dy = handle.world.y - drag.lastKnownWorld.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = handle;
    }
  }

  if (!best) {
    return null;
  }

  drag.handleId = best.id;
  drag.lastKnownWorld = { ...best.world };
  return best.id;
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

function resizeCursorForVector(vector: Point): string {
  // Convert world-space y-up vector to screen-space y-down.
  const screenVector = { x: vector.x, y: -vector.y };
  const angle = ((Math.atan2(screenVector.y, screenVector.x) * 180) / Math.PI + 180) % 180;
  const candidates: Array<{ angle: number; cursor: string }> = [
    { angle: 0, cursor: "ew-resize" },
    { angle: 45, cursor: "nwse-resize" },
    { angle: 90, cursor: "ns-resize" },
    { angle: 135, cursor: "nesw-resize" }
  ];

  let best = candidates[0]!;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const diff = Math.min(Math.abs(angle - candidate.angle), 180 - Math.abs(angle - candidate.angle));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = candidate;
    }
  }

  return best.cursor;
}

function vectorLengthSquared(vector: Point): number {
  return vector.x * vector.x + vector.y * vector.y;
}

function distanceSquared(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function selectNudgeAnchorHandle(handles: EditHandle[]): EditHandle | null {
  if (handles.length === 0) {
    return null;
  }
  return handles.find((handle) => handle.kind === "node-position") ?? handles[0]!;
}

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
import type { PathItem, Span, Statement } from "tikz-editor/ast/types";
import { PT_PER_CM } from "tikz-editor/edit/format";
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
      lastAppliedDelta: Point;
      historyMergeKey: string;
    }
  | {
      kind: "handle";
      pointerId: number;
      handleId: string;
      sourceId: string;
      handleKind: EditHandle["kind"];
      lastKnownWorld: Point;
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

export function CanvasPanel() {
  const source = useEditorStore((s) => s.source);
  const snapshot = useEditorStore((s) => s.snapshot);
  const toolMode = useEditorStore((s) => s.toolMode);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const hoveredElementId = useEditorStore((s) => s.hoveredElementId);
  const canvasTransform = useEditorStore((s) => s.canvasTransform);
  const dispatch = useEditorStore((s) => s.dispatch);

  const svgResult = snapshot.svg;
  const parseDiags = snapshot.parseResult?.diagnostics;
  const semanticDiags = snapshot.semanticResult?.diagnostics;

  const [warning, setWarning] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [toolCursorWorld, setToolCursorWorld] = useState<Point | null>(null);
  const [toolDraft, setToolDraft] = useState<Extract<DragState, { kind: "tool-create" }> | null>(null);
  const [marqueeDraft, setMarqueeDraft] = useState<Extract<DragState, { kind: "marquee" }> | null>(null);

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

  const selectedHandles = useMemo(
    () => snapshot.editHandles.filter((handle) => selectedElementIds.has(handle.sourceId)),
    [snapshot.editHandles, selectedElementIds]
  );

  const selectionBounds = useMemo(() => {
    if (!snapshot.scene || !svgResult) return [];
    return collectSelectionBounds(snapshot.scene.elements, selectedElementIds, svgResult.viewBox);
  }, [snapshot.scene, selectedElementIds, svgResult]);

  const nodeTextSpans = useMemo(() => {
    const figure = snapshot.parseResult?.figure;
    if (!figure) {
      return new Map<string, Span>();
    }
    return collectNodeTextSpans(figure.body);
  }, [snapshot.parseResult]);

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
    (action: EditAction, historyMergeKey?: string): boolean => {
      const result = applyEditAction(source, snapshot.editHandles, action);

      if (result.kind === "success" || result.kind === "partial") {
        if (result.kind === "partial") {
          const skippedCount = result.skippedHandles.length;
          setWarning(`${result.reason} (${skippedCount} handle${skippedCount === 1 ? "" : "s"} skipped)`);
        }

        dispatch({ type: "APPLY_EDIT_ACTION", action, historyMergeKey });
        return true;
      }

      if (result.kind === "unsupported") {
        setWarning(result.reason);
      } else {
        setWarning(result.message);
      }

      return false;
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

  const onElementPointerDown = useCallback(
    (event: ReactPointerEvent<SVGElement>, sourceId: string) => {
      if (!svgResult || toolMode !== "select" || event.button !== 0) return;

      viewportRef.current?.focus({ preventScroll: true });
      event.preventDefault();
      event.stopPropagation();

      const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, svgResult.viewBox);
      if (!world) return;

      if (event.shiftKey) {
        dispatch({ type: "SELECT", id: sourceId, additive: true });
        return;
      }

      const alreadySelected = selectedElementIds.has(sourceId);
      const draggedIds = alreadySelected && selectedElementIds.size > 0 ? [...selectedElementIds] : [sourceId];
      if (!alreadySelected) {
        dispatch({ type: "SELECT", id: sourceId, additive: false });
      }

      dragRef.current = {
        kind: "element",
        pointerId: event.pointerId,
        elementIds: draggedIds,
        startWorld: world,
        lastAppliedDelta: { x: 0, y: 0 },
        historyMergeKey: makeMergeKey(
          "drag-element",
          draggedIds.slice().sort().join(","),
          event.pointerId
        )
      };
    },
    [dispatch, selectedElementIds, svgResult, toolMode]
  );

  const onElementDoubleClick = useCallback(
    (event: ReactMouseEvent<SVGElement>, sourceId: string) => {
      if (toolMode !== "select") return;

      const textSpan = nodeTextSpans.get(sourceId);
      if (!textSpan) return;

      event.preventDefault();
      event.stopPropagation();
      viewportRef.current?.focus({ preventScroll: true });

      dispatch({ type: "SELECT", id: sourceId, additive: false });
      requestSourceSelection({
        from: textSpan.from,
        to: textSpan.to,
        sourceId,
        focus: true
      });
    },
    [dispatch, nodeTextSpans, toolMode]
  );

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent<SVGElement>, handle: EditHandle) => {
      if (!svgResult || toolMode !== "select" || event.button !== 0) return;

      viewportRef.current?.focus({ preventScroll: true });
      event.preventDefault();
      event.stopPropagation();

      if (event.shiftKey) {
        dispatch({ type: "SELECT", id: handle.sourceId, additive: true });
        return;
      }

      if (selectedElementIds.size !== 1 || !selectedElementIds.has(handle.sourceId)) {
        dispatch({ type: "SELECT", id: handle.sourceId, additive: false });
      }

      dragRef.current = {
        kind: "handle",
        pointerId: event.pointerId,
        handleId: handle.id,
        sourceId: handle.sourceId,
        handleKind: handle.kind,
        lastKnownWorld: { ...handle.world },
        historyMergeKey: makeMergeKey("drag-handle", handle.id, event.pointerId)
      };
    },
    [dispatch, selectedElementIds, svgResult, toolMode]
  );

  const onInteractionPointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      viewportRef.current?.focus({ preventScroll: true });

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

        setToolCursorWorld(world);
        event.preventDefault();

        if (toolMode === "addNode") {
          queueSelectionForAddedElement(world);
          const ok = applyActionWithFeedback({
            kind: "addElement",
            template: { kind: "node" },
            at: world
          });
          if (!ok) {
            pendingAddedSelectionRef.current = null;
          }
          if (ok) {
            dispatch({ type: "SET_TOOL_MODE", mode: "select" });
            setToolDraft(null);
            setToolCursorWorld(null);
          }
          return;
        }

        if (isToolCreateMode(toolMode)) {
          const nextDraft: Extract<DragState, { kind: "tool-create" }> = {
            kind: "tool-create",
            pointerId: event.pointerId,
            toolMode,
            startWorld: world,
            currentWorld: world
          };
          dragRef.current = nextDraft;
          setToolDraft(nextDraft);
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
        event.preventDefault();
      }
    },
    [applyActionWithFeedback, canvasTransform, dispatch, queueSelectionForAddedElement, svgResult, toolMode]
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
      setToolCursorWorld(world);
    },
    [svgResult, toolMode]
  );

  const onInteractionPointerLeave = useCallback(() => {
    if (toolMode === "select" || toolDraft) {
      return;
    }
    setToolCursorWorld(null);
  }, [toolDraft, toolMode]);

  const onInteractionPointerEnter = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (!svgResult || toolMode === "select") {
        return;
      }
      const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, svgResult.viewBox);
      if (world) {
        setToolCursorWorld(world);
      }
    },
    [svgResult, toolMode]
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
        if (ok) {
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
        event.preventDefault();
        return;
      }

      const selectedSet = new Set(selectedIds);
      const elementHandles = snapshot.editHandles.filter((handle) => selectedSet.has(handle.sourceId));
      const anchorHandle = selectNudgeAnchorHandle(elementHandles);
      const delta = computeNudgeDelta(axis, direction, step, anchorHandle?.world ?? null);

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
      event.preventDefault();
    },
    [applyActionWithFeedback, dispatch, selectedElementIds, snapshot.editHandles, snapshot.source, source, toolMode]
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
    if (toolMode === "select") {
      setToolDraft(null);
      setToolCursorWorld(null);
      if (dragRef.current?.kind === "tool-create") {
        dragRef.current = null;
      }
      return;
    }

    if (dragRef.current?.kind === "marquee") {
      dragRef.current = null;
      setMarqueeDraft(null);
    }
  }, [toolMode]);

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

      if (drag.kind === "pan") {
        const deltaX = event.clientX - drag.startClientX;
        const deltaY = event.clientY - drag.startClientY;

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

      const currentSvg = svgResultRef.current;
      if (!currentSvg) {
        return;
      }

      const world = clientToWorldPoint(event.clientX, event.clientY, interactionSvgRef.current, currentSvg.viewBox);
      if (!world) return;

      if (drag.kind === "tool-create") {
        drag.currentWorld = world;
        setToolDraft({ ...drag });
        setToolCursorWorld(world);
        return;
      }

      if (drag.kind === "marquee") {
        drag.currentWorld = world;
        setMarqueeDraft({ ...drag });
        return;
      }

      if (!svgResult || snapshot.source !== source) {
        return;
      }

      if (drag.kind === "element") {
        const totalDelta = {
          x: world.x - drag.startWorld.x,
          y: world.y - drag.startWorld.y
        };
        const incremental = {
          x: totalDelta.x - drag.lastAppliedDelta.x,
          y: totalDelta.y - drag.lastAppliedDelta.y
        };

        if (Math.abs(incremental.x) < 1e-6 && Math.abs(incremental.y) < 1e-6) {
          return;
        }

        const ok = applyActionWithFeedback(
          {
            kind: "moveElements",
            elementIds: drag.elementIds,
            delta: incremental
          },
          drag.historyMergeKey
        );

        if (ok) {
          drag.lastAppliedDelta = totalDelta;
        }
        return;
      }

      const resolvedHandleId = resolveHandleIdForDrag(drag, snapshot.editHandles);
      if (!resolvedHandleId) {
        setWarning("Handle is no longer available after recompute. Release and drag again.");
        return;
      }

      const ok = applyActionWithFeedback(
        {
          kind: "moveHandle",
          handleId: resolvedHandleId,
          newWorld: world
        },
        drag.historyMergeKey
      );
      if (ok) {
        drag.lastKnownWorld = world;
      }
    }

    function onPointerUp(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;

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
        dragRef.current = null;
        return;
      }

      if (drag.kind === "tool-create") {
        const finalWorld = world ?? drag.currentWorld;
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
        if (!ok) {
          pendingAddedSelectionRef.current = null;
        }

        if (ok) {
          dispatch({ type: "SET_TOOL_MODE", mode: "select" });
          setToolCursorWorld(null);
        }
        setToolDraft(null);
      }

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
  }, [applyActionWithFeedback, dispatch, queueSelectionForAddedElement, snapshot.editHandles, snapshot.source, source, svgResult]);

  const handleHalfSize = (HANDLE_SQUARE_SIZE_PX / 2) / Math.max(canvasTransform.scale, 1e-3);
  const handleStrokeWidth = 1.2 / Math.max(canvasTransform.scale, 1e-3);
  const selectionStrokeWidth = 1.1 / Math.max(canvasTransform.scale, 1e-3);
  const gridMinorStrokeWidth = 0.6 / Math.max(canvasTransform.scale, 1e-3);
  const gridMajorStrokeWidth = 0.9 / Math.max(canvasTransform.scale, 1e-3);

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
                          pointerEvents={toolMode === "select" ? (region.pointerMode === "stroke" ? "stroke" : "fill") : "none"}
                          onPointerDown={(event) => onElementPointerDown(event, region.sourceId)}
                          onDoubleClick={(event) => onElementDoubleClick(event, region.sourceId)}
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
                          pointerEvents={toolMode === "select" ? (region.pointerMode === "stroke" ? "stroke" : "fill") : "none"}
                          onPointerDown={(event) => onElementPointerDown(event, region.sourceId)}
                          onDoubleClick={(event) => onElementDoubleClick(event, region.sourceId)}
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
                          pointerEvents={toolMode === "select" ? (region.pointerMode === "stroke" ? "stroke" : "fill") : "none"}
                          onPointerDown={(event) => onElementPointerDown(event, region.sourceId)}
                          onDoubleClick={(event) => onElementDoubleClick(event, region.sourceId)}
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
                        pointerEvents={toolMode === "select" ? "all" : "none"}
                        onPointerDown={(event) => onElementPointerDown(event, region.sourceId)}
                        onDoubleClick={(event) => onElementDoubleClick(event, region.sourceId)}
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

function hasVisibleFill(fill: string | null): boolean {
  return fill != null && fill !== "none";
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

function collectNodeTextSpans(statements: readonly Statement[]): Map<string, Span> {
  const spans = new Map<string, Span>();

  const addNodeSpan = (sourceId: string, span: Span) => {
    if (span.to <= span.from) {
      return;
    }
    spans.set(sourceId, span);
  };

  const visitPathItems = (items: readonly PathItem[]) => {
    const nodesForStatement: Array<{ id: string; textSpan: Span }> = [];
    for (const item of items) {
      if (item.kind === "Node") {
        addNodeSpan(item.id, item.textSpan);
        nodesForStatement.push({ id: item.id, textSpan: item.textSpan });
        continue;
      }

      if ((item.kind === "ToOperation" || item.kind === "EdgeOperation") && item.nodes) {
        for (const node of item.nodes) {
          addNodeSpan(node.id, node.textSpan);
          nodesForStatement.push({ id: node.id, textSpan: node.textSpan });
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
          addNodeSpan(statement.id, statementNodes[0]!.textSpan);
        } else if (statementNodes.length === 1) {
          addNodeSpan(statement.id, statementNodes[0]!.textSpan);
        }
        continue;
      }
      if (statement.kind === "Scope") {
        visitStatements(statement.body);
      }
    }
  };

  visitStatements(statements);
  return spans;
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

function computeNudgeDelta(
  axis: "x" | "y",
  direction: -1 | 1,
  step: number,
  anchorWorld: Point | null
): Point {
  const fallback = direction * step;
  if (!anchorWorld) {
    return axis === "x" ? { x: fallback, y: 0 } : { x: 0, y: fallback };
  }

  const current = axis === "x" ? anchorWorld.x : anchorWorld.y;
  const snapped = snapToNextMultiple(current, step, direction);
  let axisDelta = snapped - current;
  if (Math.abs(axisDelta) < step * 1e-6) {
    axisDelta = fallback;
  }
  return axis === "x" ? { x: axisDelta, y: 0 } : { x: 0, y: axisDelta };
}

function snapToNextMultiple(value: number, step: number, direction: -1 | 1): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) {
    return value + direction * step;
  }

  const normalized = value / step;
  const epsilon = 1e-9;
  const biased = normalized + direction * epsilon;
  const nextIndex = direction > 0 ? Math.ceil(biased) : Math.floor(biased);
  return nextIndex * step;
}
